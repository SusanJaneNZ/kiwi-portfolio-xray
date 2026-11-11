/**
 * Integer-cent Bucket Split & Minimum-Turnover Withdrawal Rebalancer test suite.
 */

import { calculateBucketRebalance } from "./rebalance";
import { PortfolioBucket } from "../types/portfolio";

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertTrue(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const SAMPLE_BUCKETS: PortfolioBucket[] = [
  { id: "td", name: "Term Deposits", targetPercent: 20 },
  { id: "hdy", name: "High Div Yield", targetPercent: 20 },
  { id: "growth", name: "Growth", targetPercent: 60 },
];

export const rebalanceTestCases: Array<[string, () => void]> = [
  [
    "withdrawal draws strictly from overweight buckets without round-trip trades",
    () => {
      const result = calculateBucketRebalance({
        buckets: SAMPLE_BUCKETS,
        bucketAssignments: {
          "td:td-1": "td",
          "fund:DIV": "hdy",
          "fund:TWF": "growth",
        },
        fundBalances: { DIV: 22000, TWF: 63000 },
        directHoldings: [],
        cashDeposits: [{ id: "td-1", institution: "ANZ", label: "TD", type: "term_deposit", valueNZD: 15000 }],
        audNzdRate: 1.10,
        plannedWithdrawalNZD: 10000,
      });

      assertEq(result.isValid, true, "isValid");
      assertEq(result.rebalanceRequired, true, "rebalanceRequired");
      assertEq(result.totalAssignedNZD, 100000, "totalAssignedNZD");
      assertEq(result.postWithdrawalTotalNZD, 90000, "postWithdrawalTotalNZD");

      const byId = Object.fromEntries(result.rows.map((r) => [r.bucket.id, r]));
      assertEq(byId.td.withdrawNZD, 0, "td withdraw");
      assertEq(byId.td.sellNZD, 0, "td sell");
      assertEq(byId.td.buyNZD, 3000, "td buy");
      assertEq(byId.td.postBalanceNZD, 18000, "td post");

      const withdrawSum = result.rows.reduce((s, r) => s + r.withdrawNZD, 0);
      assertTrue(Math.abs(withdrawSum - 10000) < 1e-9, `withdraw sum mismatch: ${withdrawSum}`);
      assertEq(result.totalSellNZD, 3000, "totalSellNZD");
      assertEq(result.totalBuyNZD, 3000, "totalBuyNZD");
      assertEq(byId.hdy.postBalanceNZD, 18000, "hdy post");
      assertEq(byId.growth.postBalanceNZD, 54000, "growth post");
    },
  ],
  [
    "withdrawal alone restoring targets reports rebalanceRequired = false",
    () => {
      const result = calculateBucketRebalance({
        buckets: SAMPLE_BUCKETS,
        bucketAssignments: {
          "td:td-1": "td",
          "fund:DIV": "hdy",
          "fund:TWF": "growth",
        },
        fundBalances: { DIV: 25000, TWF: 65000 },
        directHoldings: [],
        cashDeposits: [{ id: "td-1", institution: "ANZ", label: "TD", type: "term_deposit", valueNZD: 20000 }],
        audNzdRate: 1.10,
        plannedWithdrawalNZD: 10000,
      });

      assertEq(result.isValid, true, "isValid");
      assertEq(result.rebalanceRequired, false, "rebalanceRequired");
      assertEq(result.totalBuyNZD, 0, "totalBuyNZD");
      assertEq(result.totalSellNZD, 0, "totalSellNZD");

      const byId = Object.fromEntries(result.rows.map((r) => [r.bucket.id, r]));
      assertEq(byId.td.withdrawNZD, 0, "td withdraw");
      assertEq(byId.hdy.withdrawNZD, 5000, "hdy withdraw");
      assertEq(byId.growth.withdrawNZD, 5000, "growth withdraw");
    },
  ],
  [
    "cent rounding preserves exact withdrawal, buy/sell parity, and full-withdrawal safety",
    () => {
      const oddBuckets: PortfolioBucket[] = [
        { id: "a", name: "Bucket A", targetPercent: 33.33 },
        { id: "b", name: "Bucket B", targetPercent: 33.33 },
        { id: "c", name: "Bucket C", targetPercent: 33.34 },
      ];

      const odd = calculateBucketRebalance({
        buckets: oddBuckets,
        bucketAssignments: { "fund:A": "a", "fund:B": "b", "fund:C": "c", "fund:FREE": "deleted-id" },
        fundBalances: { A: 1000.01, B: 2000.02, C: 500.04, FREE: 250.0 },
        directHoldings: [],
        cashDeposits: [],
        audNzdRate: 1.10,
        plannedWithdrawalNZD: 500.03,
      });

      assertEq(odd.isValid, true, "odd isValid");
      assertEq(odd.totalUnassignedNZD, 250, "unassigned");
      assertEq(odd.totalAssignedNZD, 3500.07, "assigned");
      const wSumCents = odd.rows.reduce((acc, r) => acc + Math.round(r.withdrawNZD * 100), 0);
      const buySumCents = odd.rows.reduce((acc, r) => acc + Math.round(r.buyNZD * 100), 0);
      const sellSumCents = odd.rows.reduce((acc, r) => acc + Math.round(r.sellNZD * 100), 0);
      assertEq(wSumCents, 50003, "withdraw cents");
      assertEq(buySumCents, sellSumCents, "buy === sell cents");

      const full = calculateBucketRebalance({
        buckets: oddBuckets,
        bucketAssignments: { "fund:A": "a", "fund:B": "b", "fund:C": "c" },
        fundBalances: { A: 1000.01, B: 2000.02, C: 500.04 },
        directHoldings: [],
        cashDeposits: [],
        audNzdRate: 1.10,
        plannedWithdrawalNZD: 3500.07,
      });
      assertEq(full.isValid, true, "full isValid");
      assertEq(full.rebalanceRequired, false, "full rebalanceRequired");
      for (const r of full.rows) {
        assertEq(Number.isNaN(r.postPercent), false, "postPercent not NaN");
        assertEq(r.postBalanceNZD, 0, "postBalanceNZD 0");
      }
    },
  ],
  [
    "rejects unnormalized targets cleanly",
    () => {
      const badTargets = calculateBucketRebalance({
        buckets: [
          { id: "td", name: "TD", targetPercent: 50 },
          { id: "gr", name: "Growth", targetPercent: 40 },
        ],
        bucketAssignments: { "fund:TWF": "gr" },
        fundBalances: { TWF: 10000 },
        directHoldings: [],
        cashDeposits: [],
        audNzdRate: 1.10,
        plannedWithdrawalNZD: 0,
      });
      assertEq(badTargets.isValid, false, "badTargets invalid");
      assertTrue((badTargets.errorReason || "").includes("100%"), "mentions 100%");
    },
  ],
];
