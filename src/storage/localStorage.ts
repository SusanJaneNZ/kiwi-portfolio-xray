/**
 * Persistence adapter for browser LocalStorage and JSON/CSV import/export (v2).
 */

import {
  CashDepositHolding,
  ConsolidatedHolding,
  PortfolioBucket,
  UserPortfolioState,
} from "../types/portfolio";

export const STORAGE_KEY_V2 = "kiwi_portfolio_xray_v2";

export const DEFAULT_PORTFOLIO_STATE: UserPortfolioState = {
  version: 2,
  timestamp: new Date().toISOString(),
  audNzdRate: 1.10,
  fundBalances: {
    TWF: 20000,
    FNZ: 15000,
    USF: 5000,
  },
  directHoldings: [
    {
      isin: "NZMCYE0001S8",
      name: "Mercury NZ Limited",
      ticker: "MCY.NZ",
      exchange: "NZX",
      country: "New Zealand",
      sector: "Utilities",
      issuer_key: "ISSUER_MCY",
      issuer_name: "Mercury NZ",
      currency: "NZD",
      value: 2500,
    },
    {
      isin: "AU000000BHP4",
      name: "BHP Group Limited",
      ticker: "BHP.AX",
      exchange: "ASX",
      country: "Australia",
      sector: "Materials",
      currency: "AUD",
      value: 2272.73,
    },
  ],
  cashDeposits: [
    {
      id: "td-sample-anz",
      depositId: "TD-04192",
      institution: "ANZ",
      label: "6-Month Term Deposit",
      type: "term_deposit",
      valueNZD: 10000,
      maturityDate: "2027-03-15",
      interestRate: 4.85,
    },
  ],
  buckets: [],
  bucketAssignments: {},
};

function isValidPortfolioStateV2(candidate: unknown): candidate is UserPortfolioState {
  if (!candidate || typeof candidate !== "object") return false;
  const obj = candidate as Record<string, unknown>;
  if (obj.version !== 2) return false;
  if (typeof obj.audNzdRate !== "number" || !Number.isFinite(obj.audNzdRate) || obj.audNzdRate <= 0) return false;
  if (!obj.fundBalances || typeof obj.fundBalances !== "object" || Array.isArray(obj.fundBalances)) return false;
  if (!Array.isArray(obj.directHoldings) || !Array.isArray(obj.cashDeposits) || !Array.isArray(obj.buckets)) return false;
  if (!obj.bucketAssignments || typeof obj.bucketAssignments !== "object" || Array.isArray(obj.bucketAssignments)) return false;

  for (const val of Object.values(obj.fundBalances as Record<string, unknown>)) {
    if (typeof val !== "number" || !Number.isFinite(val) || val < 0) return false;
  }

  for (const d of obj.cashDeposits as CashDepositHolding[]) {
    if (!d || typeof d !== "object") return false;
    if (typeof d.id !== "string" || typeof d.institution !== "string" || typeof d.label !== "string") return false;
    if (d.type !== "term_deposit" && d.type !== "cash") return false;
    if (typeof d.valueNZD !== "number" || !Number.isFinite(d.valueNZD) || d.valueNZD < 0) return false;
  }

  for (const b of obj.buckets as PortfolioBucket[]) {
    if (!b || typeof b !== "object") return false;
    if (typeof b.id !== "string" || typeof b.name !== "string") return false;
    if (typeof b.targetPercent !== "number" || !Number.isFinite(b.targetPercent) || b.targetPercent < 0) return false;
  }

  return true;
}

export function savePortfolioState(state: UserPortfolioState): void {
  try {
    const serialized = JSON.stringify({
      ...state,
      version: 2,
      timestamp: new Date().toISOString(),
    });
    localStorage.setItem(STORAGE_KEY_V2, serialized);
  } catch (e) {
    console.error("Failed to save portfolio state to localStorage:", e);
  }
}

export function loadPortfolioState(): UserPortfolioState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V2);
    if (!raw) return DEFAULT_PORTFOLIO_STATE;
    const parsed = JSON.parse(raw);
    if (isValidPortfolioStateV2(parsed)) {
      return parsed;
    }
  } catch (e) {
    console.error("Failed to load portfolio state from localStorage:", e);
  }
  return DEFAULT_PORTFOLIO_STATE;
}

export function exportPortfolioJSON(state: UserPortfolioState): string {
  return JSON.stringify(
    {
      version: 2,
      timestamp: new Date().toISOString(),
      audNzdRate: state.audNzdRate,
      fundBalances: state.fundBalances,
      directHoldings: state.directHoldings,
      cashDeposits: state.cashDeposits,
      buckets: state.buckets,
      bucketAssignments: state.bucketAssignments,
    },
    null,
    2
  );
}

export function importPortfolioJSON(jsonStr: string): UserPortfolioState {
  const parsed = JSON.parse(jsonStr);
  if (!isValidPortfolioStateV2(parsed)) {
    throw new Error("Invalid portfolio JSON: expected version 2 schema with valid funds, holdings, deposits, and buckets.");
  }
  return {
    ...parsed,
    version: 2,
    timestamp: new Date().toISOString(),
  };
}

export function exportHoldingsCSV(holdings: ConsolidatedHolding[]): string {
  const headers = [
    "Rank",
    "Asset Class",
    "Company / Issuer Name",
    "Ticker",
    "Canonical ISIN",
    "Country",
    "Category / Sector",
    "Value (NZD)",
    "% of Portfolio",
    "% of Equities",
  ];

  const rows = holdings.map((h, idx) => [
    idx + 1,
    h.assetClass,
    `"${h.name.replace(/"/g, '""')}"`,
    h.ticker,
    h.isin,
    h.country,
    `"${h.sector.replace(/"/g, '""')}"`,
    h.valueNZD.toFixed(2),
    (h.portfolioWeight * 100).toFixed(4),
    (h.equityWeight * 100).toFixed(4),
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}
