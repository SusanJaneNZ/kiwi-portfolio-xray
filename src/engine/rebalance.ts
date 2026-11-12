/**
 * Bucket Split & Minimum-Turnover Withdrawal Rebalance Engine (Integer-Cent Exact).
 */

import {
  AssignedHoldingSummary,
  BucketAllocationRow,
  BucketAssignmentMap,
  BucketRebalanceResult,
  CashDepositHolding,
  DirectHolding,
  PortfolioBucket,
} from "../types/portfolio";
import { directHoldingValueNZD } from "../utils/format";

export interface RebalanceInput {
  buckets: PortfolioBucket[];
  bucketAssignments: BucketAssignmentMap;
  fundBalances: Record<string, number>;
  directHoldings: DirectHolding[];
  cashDeposits: CashDepositHolding[];
  audNzdRate: number;
  plannedWithdrawalNZD: number;
}

/** Deterministic largest-remainder integer allocator (tie-breaks by original index). */
function allocateIntegerCents(totalCents: number, weights: number[]): number[] {
  if (totalCents <= 0 || weights.length === 0) return weights.map(() => 0);
  const weightSum = weights.reduce((acc, w) => acc + w, 0);
  if (weightSum <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (totalCents * w) / weightSum);
  const floors = exact.map((e) => Math.floor(e));
  const remainder = totalCents - floors.reduce((acc, f) => acc + f, 0);

  const ranked = exact
    .map((e, idx) => ({ idx, frac: e - floors[idx] }))
    .sort((a, b) => (b.frac !== a.frac ? b.frac - a.frac : a.idx - b.idx));

  for (let i = 0; i < remainder && i < ranked.length; i++) {
    floors[ranked[i].idx] += 1;
  }
  return floors;
}

export function calculateBucketRebalance(input: RebalanceInput): BucketRebalanceResult {
  const {
    buckets,
    bucketAssignments,
    fundBalances,
    directHoldings,
    cashDeposits,
    audNzdRate,
    plannedWithdrawalNZD,
  } = input;

  const targetSumPercent = buckets.reduce((acc, b) => acc + b.targetPercent, 0);
  const validBucketIds = new Set(buckets.map((b) => b.id));
  const bucketTotalsCents = new Map<string, number>(buckets.map((b) => [b.id, 0]));
  const bucketHoldingsMap = new Map<string, AssignedHoldingSummary[]>(buckets.map((b) => [b.id, []]));
  const bucketHasTDMap = new Map<string, boolean>(buckets.map((b) => [b.id, false]));

  let unassignedCents = 0;
  const unassignedHoldings: AssignedHoldingSummary[] = [];

  const assignItem = (item: AssignedHoldingSummary, isTermDeposit = false) => {
    const cents = Math.round(item.valueNZD * 100);
    if (cents <= 0) return;
    const assignedBucketId = bucketAssignments[item.key];
    if (assignedBucketId && validBucketIds.has(assignedBucketId)) {
      bucketTotalsCents.set(assignedBucketId, (bucketTotalsCents.get(assignedBucketId) || 0) + cents);
      bucketHoldingsMap.get(assignedBucketId)!.push(item);
      if (isTermDeposit) bucketHasTDMap.set(assignedBucketId, true);
    } else {
      unassignedCents += cents;
      unassignedHoldings.push(item);
    }
  };

  for (const [code, balance] of Object.entries(fundBalances)) {
    if (balance > 0) {
      assignItem({ key: `fund:${code}`, label: code, valueNZD: balance, kind: "fund" });
    }
  }
  for (const dh of directHoldings) {
    const valNZD = directHoldingValueNZD(dh, audNzdRate);
    if (valNZD > 0) {
      assignItem({ key: `direct:${dh.isin}`, label: `${dh.ticker} (${dh.name})`, valueNZD: valNZD, kind: "direct" });
    }
  }
  for (const dep of cashDeposits) {
    if (dep.valueNZD > 0) {
      assignItem(
        {
          key: `td:${dep.id}`,
          label: `${dep.institution} · ${dep.label}`,
          valueNZD: dep.valueNZD,
          kind: "deposit",
        },
        dep.type === "term_deposit"
      );
    }
  }

  const currentCentsList = buckets.map((b) => bucketTotalsCents.get(b.id) || 0);
  const totalAssignedCents = currentCentsList.reduce((acc, c) => acc + c, 0);
  const totalPortfolioCents = totalAssignedCents + unassignedCents;
  const withdrawalCents = Math.round((Number.isFinite(plannedWithdrawalNZD) ? plannedWithdrawalNZD : 0) * 100);

  let errorReason: string | undefined;
  if (buckets.length === 0) {
    errorReason = "Create at least one bucket and assign holdings to calculate rebalancing.";
  } else if (Math.abs(targetSumPercent - 100) > 0.01) {
    errorReason = `Target percentages currently sum to ${targetSumPercent.toFixed(1)}% (must equal 100%).`;
  } else if (totalAssignedCents <= 0) {
    errorReason = "Assign at least one funded holding or deposit to a bucket.";
  } else if (withdrawalCents < 0 || withdrawalCents > totalAssignedCents) {
    errorReason = "Planned withdrawal must be between $0 and the total assigned bucket balance.";
  }

  const buildResult = (
    isValid: boolean,
    withdrawCentsList: number[],
    sellCentsList: number[],
    buyCentsList: number[],
    postTotalCents: number,
    err?: string
  ): BucketRebalanceResult => {
    const totalSellCents = sellCentsList.reduce((acc, s) => acc + s, 0);
    const totalBuyCents = buyCentsList.reduce((acc, b) => acc + b, 0);

    const rows: BucketAllocationRow[] = buckets.map((b, i) => {
      const currCents = currentCentsList[i];
      const currAssignedPct = totalAssignedCents > 0 ? (currCents / totalAssignedCents) * 100 : 0;
      const currPortfolioPct = totalPortfolioCents > 0 ? (currCents / totalPortfolioCents) * 100 : 0;
      const postCents = isValid
        ? currCents - withdrawCentsList[i] - sellCentsList[i] + buyCentsList[i]
        : currCents;
      const postPercent = isValid
        ? postTotalCents > 0
          ? (postCents / postTotalCents) * 100
          : 0
        : currAssignedPct;
      const action: "buy" | "sell" | "hold" = !isValid
        ? "hold"
        : buyCentsList[i] > 0
        ? "buy"
        : sellCentsList[i] > 0
        ? "sell"
        : "hold";

      return {
        bucket: b,
        currentNZD: currCents / 100,
        currentAssignedPercent: currAssignedPct,
        currentPortfolioPercent: currPortfolioPct,
        driftPercent: currAssignedPct - b.targetPercent,
        withdrawNZD: withdrawCentsList[i] / 100,
        sellNZD: sellCentsList[i] / 100,
        buyNZD: buyCentsList[i] / 100,
        postBalanceNZD: postCents / 100,
        postPercent,
        action,
        assignedHoldings: bucketHoldingsMap.get(b.id) || [],
        hasTermDeposits: bucketHasTDMap.get(b.id) || false,
      };
    });

    return {
      isValid,
      ...(err ? { errorReason: err } : {}),
      targetSumPercent,
      totalPortfolioNZD: totalPortfolioCents / 100,
      totalAssignedNZD: totalAssignedCents / 100,
      totalUnassignedNZD: unassignedCents / 100,
      unassignedHoldings,
      plannedWithdrawalNZD: withdrawalCents / 100,
      postWithdrawalTotalNZD: Math.max(0, postTotalCents) / 100,
      totalSellNZD: totalSellCents / 100,
      totalBuyNZD: totalBuyCents / 100,
      rebalanceRequired: isValid && (totalBuyCents > 0 || totalSellCents > 0),
      rows,
    };
  };

  const zeros = buckets.map(() => 0);
  if (errorReason) {
    return buildResult(false, zeros, zeros, zeros, totalAssignedCents - withdrawalCents, errorReason);
  }

  const postTotalCents = totalAssignedCents - withdrawalCents;

  // Guard: full withdrawal (T_post = 0 -> no post-withdrawal rebalancing needed, no 0/0 NaN)
  if (postTotalCents === 0) {
    return buildResult(true, currentCentsList, zeros, zeros, 0);
  }

  // Exact integer-cent targets, excesses, withdrawals, sells, and buys
  const targetWeights = buckets.map((b) => Math.max(0, b.targetPercent));
  const targetCentsList = allocateIntegerCents(postTotalCents, targetWeights);
  const excessCentsList = currentCentsList.map((curr, i) => Math.max(0, curr - targetCentsList[i]));
  const shortfallCentsList = currentCentsList.map((curr, i) => Math.max(0, targetCentsList[i] - curr));

  const withdrawCentsList = allocateIntegerCents(withdrawalCents, excessCentsList);
  const sellCentsList = excessCentsList.map((exc, i) => exc - withdrawCentsList[i]);
  const buyCentsList = shortfallCentsList;

  return buildResult(true, withdrawCentsList, sellCentsList, buyCentsList, postTotalCents);
}

