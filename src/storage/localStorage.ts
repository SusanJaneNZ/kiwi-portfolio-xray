/**
 * Persistence adapter for browser LocalStorage, IndexedDB backup mirror,
 * v1 -> v2 schema migration, and JSON/CSV import/export.
 */

import {
  ConsolidatedHolding,
  DirectHolding,
  FixedInterestCategory,
  FixedInterestHolding,
  FixedInterestTaxType,
  FundMetadata,
  NZSuperType,
  PaymentFrequency,
  PirRate,
  PortfolioBucket,
  ReplicatorSettings,
  RetirementCashflowSettings,
  TdProjectionMode,
  UserPortfolioState,
} from "../types/portfolio";

export const STORAGE_KEY_V1 = "kiwi_portfolio_xray_v1";
export const STORAGE_KEY_V2 = "kiwi_portfolio_xray_v2";
export const STORAGE_KEY_BACKUP_V2 = "kiwi_portfolio_xray_backup_v2";

const IDB_DB_NAME = "kiwi_portfolio_xray_db";
const IDB_STORE_NAME = "portfolio_state";
const IDB_RECORD_KEY = "current_v2";
const IDB_FILE_HANDLE_KEY = "linked_file_handle";

export interface LinkedFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: string): Promise<void>;
    close(): Promise<void>;
  }>;
  queryPermission?(desc: { mode: "read" | "readwrite" }): Promise<"granted" | "denied" | "prompt">;
  requestPermission?(desc: { mode: "read" | "readwrite" }): Promise<"granted" | "denied" | "prompt">;
}

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
      isin: "SEDOL:B8W6K56",
      name: "Mercury NZ Limited",
      ticker: "MCY.NZ",
      exchange: "NZX",
      country: "New Zealand",
      sector: "Utilities",
      issuer_key: "ISSUER_MCY",
      issuer_name: "Mercury NZ",
      currency: "NZD",
      shares: 500,
      price: 5.0,
      value: 2500,
    },
    {
      isin: "SEDOL:6144690",
      name: "BHP Group Limited",
      ticker: "BHP.AX",
      exchange: "ASX",
      country: "Australia",
      sector: "Materials",
      currency: "AUD",
      shares: 50,
      price: 45.4546,
      value: 2272.73,
    },
  ],
  fixedInterest: [
    {
      id: "td-sample-anz",
      depositId: "TD-04192",
      institution: "ANZ",
      name: "6-Month Term Deposit",
      category: "term_deposit",
      taxType: "pie",
      pirRate: 0.28,
      valueNZD: 10000,
      maturityDate: "2027-03-15",
      interestRate: 4.85,
      frequency: "maturity",
      label: "6-Month Term Deposit",
      type: "term_deposit",
    },
  ],
  cashDeposits: [
    {
      id: "td-sample-anz",
      depositId: "TD-04192",
      institution: "ANZ",
      name: "6-Month Term Deposit",
      category: "term_deposit",
      taxType: "pie",
      pirRate: 0.28,
      valueNZD: 10000,
      maturityDate: "2027-03-15",
      interestRate: 4.85,
      frequency: "maturity",
      label: "6-Month Term Deposit",
      type: "term_deposit",
    },
  ],
  buckets: [],
  bucketAssignments: {},
  cashflowSettings: {
    annualLivingBudget: 80000,
    nzSuperType: "none",
    nzSuperCustomAnnual: 0,
    otherIncomeAnnual: 0,
    otherGrossIncomeAnnual: 0,
    isManualPir: false,
    dividendYieldOverrides: {},
    tdProjectionMode: "rollover",
  },
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
      typeof h.exchange !== "string"
    ) {
      continue;
    }
    const exchange = h.exchange === "ASX" ? "ASX" : "NZX";
    const currency: "NZD" | "AUD" =
      h.currency === "AUD" || (h.currency !== "NZD" && exchange === "ASX") ? "AUD" : "NZD";

    const rawShares = isFiniteNonNegative(h.shares)
      ? (h.shares as number)
      : isFiniteNonNegative(h.units)
        ? (h.units as number)
        : undefined;
    const rawPrice = isFiniteNonNegative(h.price) ? (h.price as number) : undefined;
    const rawValue = isFiniteNonNegative(h.value) ? (h.value as number) : undefined;

    if (rawShares === undefined && rawValue === undefined) {
      continue;
    }

    let shares: number;
    let price: number;
    let value: number;

    if (rawShares !== undefined && rawShares > 0) {
      shares = rawShares;
      price = rawPrice !== undefined && rawPrice >= 0 ? rawPrice : 0;
      value = Math.round(shares * price * 100) / 100;
    } else if (rawPrice !== undefined && rawPrice > 0 && rawValue !== undefined && rawValue > 0) {
      value = rawValue;
      shares = Math.round((value / rawPrice) * 100) / 100;
      price = rawPrice;
    } else {
      value = rawValue !== undefined ? rawValue : 0;
      shares = rawShares !== undefined ? rawShares : 0;
      price = rawPrice !== undefined ? rawPrice : 0;
    }

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
      shares,
      units: shares,
      price,
      value,
      ...(h.isEtf ? { isEtf: true } : {}),
      ...(typeof h.fundCode === "string" && h.fundCode ? { fundCode: h.fundCode } : {}),
    });
  }
  return valid;
}

function sanitizeFixedInterest(raw: unknown): FixedInterestHolding[] {
  if (!Array.isArray(raw)) return [];
  const valid: FixedInterestHolding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const d = item as Record<string, unknown>;
    const id = typeof d.id === "string" && d.id ? d.id : `fi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const institution = typeof d.institution === "string" && d.institution ? d.institution : "NZ Institution";
    const name = typeof d.name === "string" && d.name ? d.name : typeof d.label === "string" && d.label ? d.label : "Fixed Interest";
    const category: FixedInterestCategory =
      d.category === "bond" || d.category === "cash" || d.category === "term_deposit"
        ? d.category
        : d.type === "cash"
          ? "cash"
          : "term_deposit";
    const taxType: FixedInterestTaxType = category === "bond" ? "rwt" : d.taxType === "pie" ? "pie" : "rwt";
    const pirRate =
      taxType === "pie"
        ? d.pirRate === 0.105 || d.pirRate === 0.175 || d.pirRate === 0.28
          ? d.pirRate
          : 0.28
        : undefined;
    const valueNZD = isFiniteNonNegative(d.valueNZD) ? (d.valueNZD as number) : 0;
    if (valueNZD < 0) continue;

    const validFreqs = new Set<string>(["monthly", "quarterly", "semi-annual", "annual", "maturity"]);
    const frequency = typeof d.frequency === "string" && validFreqs.has(d.frequency) ? (d.frequency as PaymentFrequency) : undefined;

    valid.push({
      id,
      institution,
      name,
      category,
      taxType,
      pirRate,
      valueNZD,
      ...(typeof d.depositId === "string" && d.depositId ? { depositId: d.depositId } : {}),
      ...(typeof d.maturityDate === "string" && d.maturityDate ? { maturityDate: d.maturityDate } : {}),
      ...(isFiniteNonNegative(d.interestRate) ? { interestRate: d.interestRate } : {}),
      ...(frequency ? { frequency } : {}),
      ...(typeof d.issuerKey === "string" && d.issuerKey ? { issuerKey: d.issuerKey } : {}),
      label: name,
      type: category === "cash" ? "cash" : "term_deposit",
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

function sanitizeCustomFunds(raw: unknown): FundMetadata[] {
  if (!Array.isArray(raw)) return [];
  const valid: FundMetadata[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const code = String(f.code || "").trim().toUpperCase();
    if (!code) continue;
    valid.push({
      code,
      name: String(f.name || code).trim(),
      provider: String(f.provider || "Custom").trim(),
      effective_date: String(f.effective_date || new Date().toISOString().split("T")[0]).trim(),
      cash_ratio: Number.isFinite(f.cash_ratio) ? Number(f.cash_ratio) : 0,
      hedging_ratio: Number.isFinite(f.hedging_ratio) ? Number(f.hedging_ratio) : 0,
      constituent_count: Number.isFinite(f.constituent_count) ? Number(f.constituent_count) : 0,
      asset_class: (f.asset_class === "fixed_interest" || f.asset_class === "mixed") ? f.asset_class : "equity",
      ...(f.cadence ? { cadence: String(f.cadence) } : {}),
      ...(f.is_stale !== undefined ? { is_stale: Boolean(f.is_stale) } : {}),
      ...(f.isEtf !== undefined ? { isEtf: Boolean(f.isEtf) } : {}),
      ...(f.isKiwiSaver !== undefined ? { isKiwiSaver: Boolean(f.isKiwiSaver) } : {}),
      ...(typeof f.smartInvestorUrl === "string" && f.smartInvestorUrl ? { smartInvestorUrl: f.smartInvestorUrl } : {}),
    });
  }
  return valid;
}

function sanitizeCashflowSettings(raw: unknown): RetirementCashflowSettings | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const s = raw as Record<string, unknown>;

  const annualLivingBudget =
    typeof s.annualLivingBudget === "number" && Number.isFinite(s.annualLivingBudget) && s.annualLivingBudget >= 0
      ? s.annualLivingBudget
      : 80000;

  const validSuperTypes = new Set<NZSuperType>(['none', 'single_alone', 'single_sharing', 'couple_both', 'custom']);
  const nzSuperType: NZSuperType =
    typeof s.nzSuperType === "string" && validSuperTypes.has(s.nzSuperType as NZSuperType)
      ? (s.nzSuperType as NZSuperType)
      : 'none';

  const nzSuperCustomAnnual =
    typeof s.nzSuperCustomAnnual === "number" && Number.isFinite(s.nzSuperCustomAnnual) && s.nzSuperCustomAnnual >= 0
      ? s.nzSuperCustomAnnual
      : 0;

  const otherGrossVal =
    typeof s.otherGrossIncomeAnnual === "number" && Number.isFinite(s.otherGrossIncomeAnnual) && s.otherGrossIncomeAnnual >= 0
      ? s.otherGrossIncomeAnnual
      : (typeof s.otherIncomeAnnual === "number" && Number.isFinite(s.otherIncomeAnnual) && s.otherIncomeAnnual >= 0
        ? s.otherIncomeAnnual
        : 0);

  const isManualPir = Boolean(s.isManualPir);
  let pirRate: PirRate | undefined = undefined;
  if (s.pirRate === 0.105 || s.pirRate === 0.175 || s.pirRate === 0.28) {
    pirRate = s.pirRate;
  }

  const tdProjectionMode: TdProjectionMode =
    s.tdProjectionMode === 'term_only' ? 'term_only' : 'rollover';

  const dividendYieldOverrides: Record<string, number> = {};
  if (s.dividendYieldOverrides && typeof s.dividendYieldOverrides === "object" && !Array.isArray(s.dividendYieldOverrides)) {
    const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
    for (const [k, v] of Object.entries(s.dividendYieldOverrides as Record<string, unknown>)) {
      if (typeof k === "string" && !DANGEROUS_KEYS.has(k) && typeof v === "number" && Number.isFinite(v) && v >= 0) {
        dividendYieldOverrides[k] = v;
      }
    }
  }

  return {
    annualLivingBudget,
    nzSuperType,
    nzSuperCustomAnnual,
    otherGrossIncomeAnnual: otherGrossVal,
    otherIncomeAnnual: otherGrossVal,
    ...(pirRate !== undefined ? { pirRate } : {}),
    ...(isManualPir ? { isManualPir: true } : {}),
    tdProjectionMode,
    dividendYieldOverrides,
  };
}

function sanitizeReplicatorSettings(raw: unknown): ReplicatorSettings | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: ReplicatorSettings = {};
  if (typeof r.selectedCode === "string" && r.selectedCode.trim()) {
    out.selectedCode = r.selectedCode.trim().toUpperCase();
  }
  if (typeof r.depth === "number" && Number.isFinite(r.depth) && r.depth >= 1) {
    out.depth = Math.floor(r.depth);
  }
  if (isFiniteNonNegative(r.targetHoldingNZD)) {
    out.targetHoldingNZD = r.targetHoldingNZD;
  }
  if (isFiniteNonNegative(r.brokerageNZD)) {
    out.brokerageNZD = r.brokerageNZD;
  }
  if (r.mode === "portfolio_aware" || r.mode === "standalone") {
    out.mode = r.mode;
  }
  return Object.keys(out).length > 0 ? out : undefined;
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
    Array.isArray(obj.fixedInterest) ||
    Array.isArray(obj.cashDeposits) ||
    Array.isArray(obj.buckets);

  if (!hasRecognizableSection) return null;

  const audNzdRate =
    typeof obj.audNzdRate === "number" && Number.isFinite(obj.audNzdRate) && obj.audNzdRate > 0
      ? obj.audNzdRate
      : 1.10;

  const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

  const fundBalances: Record<string, number> = {};
  if (obj.fundBalances && typeof obj.fundBalances === "object" && !Array.isArray(obj.fundBalances)) {
    for (const [code, val] of Object.entries(obj.fundBalances as Record<string, unknown>)) {
      if (code.trim() && !DANGEROUS_KEYS.has(code) && isFiniteNonNegative(val) && val > 0) {
        fundBalances[code] = val;
      }
    }
  }

  const bucketAssignments: Record<string, string> = {};
  if (obj.bucketAssignments && typeof obj.bucketAssignments === "object" && !Array.isArray(obj.bucketAssignments)) {
    for (const [k, v] of Object.entries(obj.bucketAssignments as Record<string, unknown>)) {
      if (typeof k === "string" && !DANGEROUS_KEYS.has(k) && typeof v === "string" && v) {
        const canonicalKey = k.startsWith("td:") ? `fi:${k.slice(3)}` : k;
        bucketAssignments[canonicalKey] = v;
      }
    }
  }

  const fi = sanitizeFixedInterest(obj.fixedInterest || obj.cashDeposits);
  const cashflowSettings = sanitizeCashflowSettings(obj.cashflowSettings);
  const replicatorSettings = sanitizeReplicatorSettings(obj.replicatorSettings);
  const customFunds = sanitizeCustomFunds(obj.customFunds);
  let pirRate: PirRate | undefined = undefined;
  if (obj.pirRate === 0.105 || obj.pirRate === 0.175 || obj.pirRate === 0.28) {
    pirRate = obj.pirRate;
  } else if (cashflowSettings?.pirRate) {
    pirRate = cashflowSettings.pirRate;
  }

  return {
    version: 2,
    timestamp: typeof obj.timestamp === "string" && obj.timestamp ? obj.timestamp : new Date().toISOString(),
    audNzdRate,
    fundBalances,
    directHoldings: sanitizeDirectHoldings(obj.directHoldings),
    fixedInterest: fi,
    cashDeposits: fi,
    buckets: sanitizeBuckets(obj.buckets),
    bucketAssignments,
    ...(customFunds.length > 0 ? { customFunds } : {}),
    ...(cashflowSettings ? { cashflowSettings } : {}),
    ...(replicatorSettings ? { replicatorSettings } : {}),
    ...(pirRate !== undefined ? { pirRate } : {}),
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

/**
 * Serializes the canonical portfolio representation for backup, disk sync, and file export.
 */
export function serializePortfolioPayload(state: UserPortfolioState): Record<string, unknown> {
  return {
    version: 2,
    timestamp: state.timestamp || new Date().toISOString(),
    audNzdRate: state.audNzdRate,
    fundBalances: state.fundBalances,
    directHoldings: state.directHoldings,
    fixedInterest: state.fixedInterest || state.cashDeposits,
    cashDeposits: state.fixedInterest || state.cashDeposits,
    buckets: state.buckets,
    bucketAssignments: state.bucketAssignments,
    ...(state.customFunds && state.customFunds.length > 0 ? { customFunds: state.customFunds } : {}),
    ...(state.cashflowSettings ? { cashflowSettings: state.cashflowSettings } : {}),
    ...(state.replicatorSettings ? { replicatorSettings: state.replicatorSettings } : {}),
    ...(state.pirRate !== undefined ? { pirRate: state.pirRate } : {}),
  };
}

/**
 * Persists the current portfolio state to the repo-root `portfolio_backup.json`
 * via the local server API endpoint (/api/portfolio/save).
 */
export async function autoSavePortfolioToDisk(state: UserPortfolioState): Promise<boolean> {
  if (typeof fetch === "undefined") return false;
  try {
    const res = await fetch("/api/portfolio/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "KiwiPortfolioXRay",
      },
      body: JSON.stringify(serializePortfolioPayload(state), null, 2),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Creates a timestamped backup copy on disk (e.g. portfolio_backup_YYYY-MM-DD_HHMMSS.json)
 * before Clear or Load Sample operations so existing data is never wiped out.
 */
export async function createDatedBackupOnDisk(): Promise<string | null> {
  if (typeof fetch === "undefined") return null;
  try {
    const res = await fetch("/api/portfolio/backup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "KiwiPortfolioXRay",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.backupFile || null;
  } catch {
    return null;
  }
}

/**
 * Metadata for a local backup file discovered on disk in backups/.
 */
export interface DiskBackupInfo {
  filename: string;
  isCurrent: boolean;
  modifiedAt: string;
  size: number;
}

/**
 * Fetches the list of all available backups in the local backups/ folder.
 */
export async function fetchBackupsList(): Promise<DiskBackupInfo[]> {
  if (typeof fetch === "undefined") return [];
  try {
    const res = await fetch("/api/portfolio/backups");
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.backups) ? data.backups : [];
  } catch {
    return [];
  }
}

/**
 * Exports the current portfolio directly into a timestamped file in the local backups/ folder.
 */
export async function exportPortfolioToDisk(
  state: UserPortfolioState
): Promise<{ ok: boolean; file?: string; path?: string }> {
  if (typeof fetch === "undefined") return { ok: false };
  try {
    const res = await fetch("/api/portfolio/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "KiwiPortfolioXRay",
      },
      body: JSON.stringify(serializePortfolioPayload(state), null, 2),
    });
    if (!res.ok) return { ok: false };
    const data = await res.json();
    return { ok: true, file: data.file, path: data.path };
  } catch {
    return { ok: false };
  }
}

/**
 * Loads the auto-saved portfolio from the local `backups/` folder (or optional specific file).
 */
export async function loadPortfolioFromDisk(filename?: string): Promise<UserPortfolioState | null> {
  if (typeof fetch === "undefined") return null;
  try {
    const url = filename
      ? `/api/portfolio/load?file=${encodeURIComponent(filename)}`
      : "/api/portfolio/load";
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.exists && data.state) {
      return normalizePortfolioState(data.state);
    }
    return null;
  } catch {
    return null;
  }
}

export function isFileSyncSupported(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

export async function saveLinkedFileHandle(handle: LinkedFileHandle | null): Promise<void> {
  const db = await openIndexedDB();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE_NAME, "readwrite");
      const store = tx.objectStore(IDB_STORE_NAME);
      if (handle) {
        store.put(handle, IDB_FILE_HANDLE_KEY);
      } else {
        store.delete(IDB_FILE_HANDLE_KEY);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore IndexedDB errors
  } finally {
    db.close();
  }
}

export async function loadLinkedFileHandle(): Promise<LinkedFileHandle | null> {
  const db = await openIndexedDB();
  if (!db) return null;
  try {
    const raw = await new Promise<unknown>((resolve) => {
      const tx = db.transaction(IDB_STORE_NAME, "readonly");
      const req = tx.objectStore(IDB_STORE_NAME).get(IDB_FILE_HANDLE_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
    if (raw && typeof raw === "object" && "getFile" in raw && "createWritable" in raw) {
      return raw as LinkedFileHandle;
    }
    return null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function writePortfolioToLinkedFile(
  handle: LinkedFileHandle,
  state: UserPortfolioState
): Promise<boolean> {
  try {
    const writable = await handle.createWritable();
    const payload = JSON.stringify(serializePortfolioPayload(state), null, 2);
    await writable.write(payload);
    await writable.close();
    return true;
  } catch (err) {
    console.warn("Failed writing to linked backup file:", err);
    return false;
  }
}

export async function readPortfolioFromLinkedFile(
  handle: LinkedFileHandle
): Promise<UserPortfolioState | null> {
  try {
    const file = await handle.getFile();
    const text = await file.text();
    if (!text.trim()) return null;
    const parsed = JSON.parse(text);
    return normalizePortfolioState(parsed);
  } catch (err) {
    console.warn("Failed reading linked backup file:", err);
    return null;
  }
}

export async function pickAndLinkBackupFile(
  currentState: UserPortfolioState
): Promise<LinkedFileHandle | null> {
  if (!isFileSyncSupported()) return null;
  const picker = (
    window as unknown as {
      showSaveFilePicker: (opts: unknown) => Promise<LinkedFileHandle>;
    }
  ).showSaveFilePicker;

  const handle = await picker({
    suggestedName: "kiwi_portfolio_backup.json",
    types: [
      {
        description: "JSON Portfolio Backup",
        accept: { "application/json": [".json"] },
      },
    ],
  });
  const ok = await writePortfolioToLinkedFile(handle, currentState);
  if (!ok) {
    throw new Error("Could not write to selected backup file.");
  }
  await saveLinkedFileHandle(handle);
  return handle;
}

export async function pickExistingAndLinkBackupFile(): Promise<{
  handle: LinkedFileHandle;
  loadedState: UserPortfolioState | null;
} | null> {
  if (typeof window === "undefined" || !("showOpenFilePicker" in window)) return null;
  const picker = (
    window as unknown as {
      showOpenFilePicker: (opts: unknown) => Promise<LinkedFileHandle[]>;
    }
  ).showOpenFilePicker;
  const [handle] = await picker({
    multiple: false,
    types: [
      {
        description: "JSON Portfolio Backup",
        accept: { "application/json": [".json"] },
      },
    ],
  });
  if (!handle) return null;
  if (handle.requestPermission) {
    const perm = await handle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") {
      throw new Error("Read/write permission is required to sync this backup file.");
    }
  }
  const loadedState = await readPortfolioFromLinkedFile(handle);
  await saveLinkedFileHandle(handle);
  return { handle, loadedState };
}

export function isEmptyPortfolio(state: UserPortfolioState): boolean {
  const fiList = state.fixedInterest || state.cashDeposits || [];
  return (
    Object.values(state.fundBalances).every((v) => v <= 0) &&
    state.directHoldings.every((d) => (d.shares ?? 0) <= 0 && d.value <= 0) &&
    fiList.every((c) => c.valueNZD <= 0) &&
    state.buckets.length === 0
  );
}

export function isSamplePortfolio(state: UserPortfolioState): boolean {
  const funds = Object.entries(state.fundBalances).filter(([, v]) => v > 0);
  if (
    funds.length !== 3 ||
    state.fundBalances.TWF !== 20000 ||
    state.fundBalances.FNZ !== 15000 ||
    state.fundBalances.USF !== 5000
  ) {
    return false;
  }
  if (state.directHoldings.length !== 2) return false;
  const hasMcy = state.directHoldings.some(
    (d) => d.ticker === "MCY.NZ" && Math.abs(d.value - 2500) < 0.01
  );
  const hasBhp = state.directHoldings.some(
    (d) => d.ticker === "BHP.AX" && Math.abs(d.value - 2272.73) < 0.01
  );
  if (!hasMcy || !hasBhp) return false;
  const fiList = state.fixedInterest || state.cashDeposits || [];
  if (
    fiList.length !== 1 ||
    fiList[0].id !== "td-sample-anz" ||
    Math.abs(fiList[0].valueNZD - 10000) >= 0.01
  ) {
    return false;
  }
  return state.buckets.length === 0;
}

export async function resumeLinkedFileSync(
  handle: LinkedFileHandle,
  currentState: UserPortfolioState,
  loadSource: LoadSource
): Promise<{ status: "loaded_from_file" | "synced_to_file" | "denied"; state?: UserPortfolioState }> {
  if (handle.requestPermission) {
    const perm = await handle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") {
      return { status: "denied" };
    }
  }

  const fileState = await readPortfolioFromLinkedFile(handle);
  const fileTime = fileState ? Date.parse(fileState.timestamp) || 0 : 0;
  const localTime = Date.parse(currentState.timestamp) || 0;
  const localIsDefaultOrBlank =
    loadSource === "default" || isSamplePortfolio(currentState) || isEmptyPortfolio(currentState);
  const fileHasRealPortfolio =
    fileState !== null && !isSamplePortfolio(fileState) && !isEmptyPortfolio(fileState);

  if (fileState && (localIsDefaultOrBlank || fileTime > localTime)) {
    // Never overwrite a real disk backup with sample or empty state
    if (fileHasRealPortfolio || loadSource === "default" || fileTime > localTime) {
      return { status: "loaded_from_file", state: fileState };
    }
  }

  const ok = await writePortfolioToLinkedFile(handle, currentState);
  return { status: ok ? "synced_to_file" : "denied" };
}

export function exportPortfolioJSON(state: UserPortfolioState): string {
  return JSON.stringify(serializePortfolioPayload(state), null, 2);
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

function sanitizeCsvCell(value: string | number): string {
  const str = String(value);
  // Defend against spreadsheet formula injection (=, +, -, @, \t, \r)
  const safeStr = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${safeStr.replace(/"/g, '""')}"`;
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
    sanitizeCsvCell(h.assetClass),
    sanitizeCsvCell(h.name),
    sanitizeCsvCell(h.ticker),
    sanitizeCsvCell(h.isin),
    sanitizeCsvCell(h.country),
    sanitizeCsvCell(h.sector),
    h.valueNZD.toFixed(2),
    (h.portfolioWeight * 100).toFixed(4),
    (h.equityWeight * 100).toFixed(4),
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}
