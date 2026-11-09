/**
 * Persistence adapter for browser LocalStorage and JSON/CSV import/export.
 */

import { ConsolidatedHolding, UserPortfolioState } from "../types/portfolio";

export const STORAGE_KEY_V1 = "kiwi_portfolio_xray_v1";

export const DEFAULT_PORTFOLIO_STATE: UserPortfolioState = {
  version: 1,
  timestamp: new Date().toISOString(),
  audNzdRate: 1.10,
  fundBalances: {
    TWF: 20000,
    FNZ: 15000,
    USF: 5000,
    KERNEL_CLEAN_ENERGY: 5000,
  },
  directHoldings: [
    {
      isin: "NZMCYE0001S8",
      name: "Mercury NZ Limited",
      ticker: "MCY.NZ",
      exchange: "NZX",
      country: "NZ",
      sector: "Utilities",
      currency: "NZD",
      value: 2500,
    },
    {
      isin: "AU000000BHP4",
      name: "BHP Group Limited",
      ticker: "BHP.AX",
      exchange: "ASX",
      country: "AU",
      sector: "Materials",
      currency: "AUD",
      value: 2272.73,
    },
  ],
};

export function savePortfolioState(state: UserPortfolioState): void {
  try {
    const serialized = JSON.stringify({
      ...state,
      timestamp: new Date().toISOString(),
    });
    localStorage.setItem(STORAGE_KEY_V1, serialized);
  } catch (e) {
    console.error("Failed to save portfolio state to localStorage:", e);
  }
}

export function loadPortfolioState(): UserPortfolioState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V1);
    if (!raw) return DEFAULT_PORTFOLIO_STATE;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.version === 1) {
      return parsed as UserPortfolioState;
    }
  } catch (e) {
    console.error("Failed to load portfolio state from localStorage:", e);
  }
  return DEFAULT_PORTFOLIO_STATE;
}

export function exportPortfolioJSON(state: UserPortfolioState): string {
  return JSON.stringify(
    {
      version: state.version,
      timestamp: new Date().toISOString(),
      audNzdRate: state.audNzdRate,
      fundBalances: state.fundBalances,
      directHoldings: state.directHoldings,
    },
    null,
    2
  );
}

export function importPortfolioJSON(jsonStr: string): UserPortfolioState {
  const parsed = JSON.parse(jsonStr);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid JSON format");
  }
  return {
    version: 1,
    timestamp: new Date().toISOString(),
    audNzdRate: typeof parsed.audNzdRate === "number" ? parsed.audNzdRate : 1.10,
    fundBalances: parsed.fundBalances || {},
    directHoldings: Array.isArray(parsed.directHoldings) ? parsed.directHoldings : [],
  };
}

export function exportHoldingsCSV(holdings: ConsolidatedHolding[]): string {
  const headers = [
    "Rank",
    "Company Name",
    "Ticker",
    "ISIN",
    "Country",
    "GICS Sector",
    "Exposure NZD",
    "Portfolio Weight %",
    "Equity Weight %",
  ];

  const rows = holdings.map((h, idx) => [
    idx + 1,
    `"${h.name.replace(/"/g, '""')}"`,
    h.ticker,
    h.isin,
    h.country,
    `"${h.sector}"`,
    h.valueNZD.toFixed(2),
    (h.portfolioWeight * 100).toFixed(4),
    (h.equityWeight * 100).toFixed(4),
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

