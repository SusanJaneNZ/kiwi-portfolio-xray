/**
 * Persistence adapter for browser LocalStorage, IndexedDB backup mirror,
 * v1 -> v2 schema migration, and JSON/CSV import/export.
 */

import {
  CashDepositHolding,
  ConsolidatedHolding,
  DirectHolding,
  PortfolioBucket,
  UserPortfolioState,
} from "../types/portfolio";

export const STORAGE_KEY_V1 = "kiwi_portfolio_xray_v1";
export const STORAGE_KEY_V2 = "kiwi_portfolio_xray_v2";
export const STORAGE_KEY_BACKUP_V2 = "kiwi_portfolio_xray_backup_v2";

const IDB_DB_NAME = "kiwi_portfolio_xray_db";
const IDB_STORE_NAME = "portfolio_state";
const IDB_RECORD_KEY = "current_v2";

export type LoadSource = "v2" | "v2_backup" | "v1_migrated" | "indexeddb" | "default";

export interface LoadedPortfolioMeta {
  state: UserPortfolioState;
  source: LoadSource;
  recoveredNotice: string | null;
}

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

function isFiniteNonNegative(val: unknown): val is number {
  return typeof val === "number" && Number.isFinite(val) && val >= 0;
}

function sanitizeDirectHoldings(raw: unknown): DirectHolding[] {
  if (!Array.isArray(raw)) return [];
  const valid: DirectHolding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const h = item as Record<string, unknown>;
    if (
      typeof h.isin !== "string" ||
      !h.isin.trim() ||
      typeof h.name !== "string" ||
      typeof h.ticker !== "string" ||
      typeof h.exchange !== "string" ||
      !isFiniteNonNegative(h.value)
    ) {
      continue;
    }
    const exchange = h.exchange === "ASX" ? "ASX" : "NZX";
    const currency: "NZD" | "AUD" =
      h.currency === "AUD" || (h.currency !== "NZD" && exchange === "ASX") ? "AUD" : "NZD";
    valid.push({
      isin: h.isin,
      name: h.name,
      ticker: h.ticker,
      exchange,
      country: typeof h.country === "string" && h.country ? h.country : exchange === "ASX" ? "Australia" : "New Zealand",
      sector: typeof h.sector === "string" && h.sector ? h.sector : "Unclassified",
      ...(typeof h.issuer_key === "string" && h.issuer_key ? { issuer_key: h.issuer_key } : {}),
      ...(typeof h.issuer_name === "string" && h.issuer_name ? { issuer_name: h.issuer_name } : {}),
      currency,
      value: h.value,
    });
  }
  return valid;
}

function sanitizeCashDeposits(raw: unknown): CashDepositHolding[] {
  if (!Array.isArray(raw)) return [];
  const valid: CashDepositHolding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const d = item as Record<string, unknown>;
    if (
      typeof d.id !== "string" ||
      typeof d.institution !== "string" ||
      typeof d.label !== "string" ||
      (d.type !== "term_deposit" && d.type !== "cash") ||
      !isFiniteNonNegative(d.valueNZD)
    ) {
      continue;
    }
    valid.push({
      id: d.id,
      institution: d.institution,
      label: d.label,
      type: d.type,
      valueNZD: d.valueNZD,
      ...(typeof d.depositId === "string" && d.depositId ? { depositId: d.depositId } : {}),
      ...(typeof d.maturityDate === "string" && d.maturityDate ? { maturityDate: d.maturityDate } : {}),
      ...(isFiniteNonNegative(d.interestRate) ? { interestRate: d.interestRate } : {}),
    });
  }
  return valid;
}

function sanitizeBuckets(raw: unknown): PortfolioBucket[] {
  if (!Array.isArray(raw)) return [];
  const valid: PortfolioBucket[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const b = item as Record<string, unknown>;
    if (typeof b.id !== "string" || typeof b.name !== "string" || !isFiniteNonNegative(b.targetPercent)) {
      continue;
    }
    valid.push({ id: b.id, name: b.name, targetPercent: b.targetPercent });
  }
  return valid;
}

/**
 * Normalizes v1 or v2 saved/imported portfolio payloads into a valid v2 state.
 * Sanitizes per-field rather than discarding the entire portfolio if one entry is malformed.
 */
export function normalizePortfolioState(candidate: unknown): UserPortfolioState | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const obj = candidate as Record<string, unknown>;

  if (obj.version !== undefined && obj.version !== 1 && obj.version !== 2) {
    return null;
  }

  const hasRecognizableSection =
    (obj.fundBalances && typeof obj.fundBalances === "object" && !Array.isArray(obj.fundBalances)) ||
    Array.isArray(obj.directHoldings) ||
    Array.isArray(obj.cashDeposits) ||
    Array.isArray(obj.buckets);

  if (!hasRecognizableSection) return null;

  const audNzdRate =
    typeof obj.audNzdRate === "number" && Number.isFinite(obj.audNzdRate) && obj.audNzdRate > 0
      ? obj.audNzdRate
      : 1.10;

  const fundBalances: Record<string, number> = {};
  if (obj.fundBalances && typeof obj.fundBalances === "object" && !Array.isArray(obj.fundBalances)) {
    for (const [code, val] of Object.entries(obj.fundBalances as Record<string, unknown>)) {
      if (code.trim() && isFiniteNonNegative(val) && val > 0) {
        fundBalances[code] = val;
      }
    }
  }

  const bucketAssignments: Record<string, string> = {};
  if (obj.bucketAssignments && typeof obj.bucketAssignments === "object" && !Array.isArray(obj.bucketAssignments)) {
    for (const [k, v] of Object.entries(obj.bucketAssignments as Record<string, unknown>)) {
      if (typeof k === "string" && typeof v === "string" && v) {
        bucketAssignments[k] = v;
      }
    }
  }

  return {
    version: 2,
    timestamp: typeof obj.timestamp === "string" && obj.timestamp ? obj.timestamp : new Date().toISOString(),
    audNzdRate,
    fundBalances,
    directHoldings: sanitizeDirectHoldings(obj.directHoldings),
    cashDeposits: sanitizeCashDeposits(obj.cashDeposits),
    buckets: sanitizeBuckets(obj.buckets),
    bucketAssignments,
  };
}

function writeStorageKeys(serialized: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY_V2, serialized);
  localStorage.setItem(STORAGE_KEY_BACKUP_V2, serialized);
}

function openIndexedDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(IDB_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function mirrorToIndexedDB(state: UserPortfolioState): Promise<void> {
  const db = await openIndexedDB();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE_NAME, "readwrite");
      tx.objectStore(IDB_STORE_NAME).put(state, IDB_RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore IndexedDB quota/privacy errors
  } finally {
    db.close();
  }
}

export async function loadFromIndexedDBBackup(): Promise<UserPortfolioState | null> {
  const db = await openIndexedDB();
  if (!db) return null;
  try {
    const raw = await new Promise<unknown>((resolve) => {
      const tx = db.transaction(IDB_STORE_NAME, "readonly");
      const req = tx.objectStore(IDB_STORE_NAME).get(IDB_RECORD_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
    return normalizePortfolioState(raw);
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export function savePortfolioState(state: UserPortfolioState): void {
  const payload: UserPortfolioState = {
    ...state,
    version: 2,
    timestamp: new Date().toISOString(),
  };
  try {
    const serialized = JSON.stringify(payload);
    writeStorageKeys(serialized);
  } catch (e) {
    console.error("Failed to save portfolio state to localStorage:", e);
  }
  void mirrorToIndexedDB(payload);
}

function tryReadAndNormalize(key: string): UserPortfolioState | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  return normalizePortfolioState(parsed);
}

export function loadPortfolioStateWithMeta(): LoadedPortfolioMeta {
  try {
    const v2 = tryReadAndNormalize(STORAGE_KEY_V2);
    if (v2) {
      return { state: v2, source: "v2", recoveredNotice: null };
    }
  } catch (e) {
    console.error("Failed to parse primary v2 portfolio state:", e);
  }

  try {
    const backup = tryReadAndNormalize(STORAGE_KEY_BACKUP_V2);
    if (backup) {
      writeStorageKeys(JSON.stringify(backup));
      return {
        state: backup,
        source: "v2_backup",
        recoveredNotice: "Recovered portfolio from backup storage.",
      };
    }
  } catch (e) {
    console.error("Failed to parse backup v2 portfolio state:", e);
  }

  try {
    const v1 = tryReadAndNormalize(STORAGE_KEY_V1);
    if (v1) {
      // Persist migrated v2 copy while preserving v1 untouched
      writeStorageKeys(JSON.stringify(v1));
      return {
        state: v1,
        source: "v1_migrated",
        recoveredNotice: "Migrated saved v1 portfolio to v2.",
      };
    }
  } catch (e) {
    console.error("Failed to migrate v1 portfolio state:", e);
  }

  return {
    state: DEFAULT_PORTFOLIO_STATE,
    source: "default",
    recoveredNotice: null,
  };
}

export function loadPortfolioState(): UserPortfolioState {
  return loadPortfolioStateWithMeta().state;
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
  const normalized = normalizePortfolioState(parsed);
  if (!normalized) {
    throw new Error("Invalid portfolio JSON: expected a v1 or v2 portfolio backup.");
  }
  return {
    ...normalized,
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
