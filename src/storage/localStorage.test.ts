/**
 * Persistence, v1 -> v2 migration, backup recovery, and sanitization tests.
 */

import {
  DEFAULT_PORTFOLIO_STATE,
  STORAGE_KEY_BACKUP_V2,
  STORAGE_KEY_V1,
  STORAGE_KEY_V2,
  importPortfolioJSON,
  loadPortfolioStateWithMeta,
  normalizePortfolioState,
  savePortfolioState,
} from "./localStorage";

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertTrue(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function installMockLocalStorage(initial: Record<string, string> = {}): Map<string, string> {
  const store = new Map<string, string>(Object.entries(initial));
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  return store;
}

export const storageTestCases: Array<[string, () => void]> = [
  [
    "migrates saved v1 localStorage portfolio into v2 without overwriting holdings",
    () => {
      const store = installMockLocalStorage({
        [STORAGE_KEY_V1]: JSON.stringify({
          version: 1,
          timestamp: "2026-11-10T01:00:00Z",
          audNzdRate: 1.09,
          fundBalances: { ASIA: 12000, FNZ: 8000 },
          directHoldings: [
            {
              isin: "AU000000BHP4",
              name: "BHP Group Limited",
              ticker: "BHP.AX",
              exchange: "ASX",
              country: "Australia",
              sector: "Materials",
              currency: "AUD",
              value: 5000,
            },
          ],
        }),
      });

      const loaded = loadPortfolioStateWithMeta();
      assertEq(loaded.source, "v1_migrated", "source should indicate v1 migration");
      assertEq(loaded.state.version, 2, "migrated version must be 2");
      assertEq(loaded.state.audNzdRate, 1.09, "audNzdRate preserved");
      assertEq(loaded.state.fundBalances.ASIA, 12000, "ASIA holding preserved");
      assertEq(loaded.state.fundBalances.FNZ, 8000, "FNZ holding preserved");
      assertEq(loaded.state.directHoldings.length, 1, "direct holding preserved");
      assertTrue(store.has(STORAGE_KEY_V2), "v2 key written during migration");
      assertTrue(store.has(STORAGE_KEY_V1), "v1 key retained untouched");
    },
  ],
  [
    "recovers from backup key if primary v2 key is corrupted",
    () => {
      const validSaved = {
        ...DEFAULT_PORTFOLIO_STATE,
        fundBalances: { TWF: 42000 },
        directHoldings: [],
        cashDeposits: [],
      };
      installMockLocalStorage({
        [STORAGE_KEY_V2]: "{corrupt json",
        [STORAGE_KEY_BACKUP_V2]: JSON.stringify(validSaved),
      });

      const loaded = loadPortfolioStateWithMeta();
      assertEq(loaded.source, "v2_backup", "source should fall back to backup");
      assertEq(loaded.state.fundBalances.TWF, 42000, "TWF balance recovered");
    },
  ],
  [
    "sanitizes partial/malformed fields instead of discarding valid holdings",
    () => {
      const normalized = normalizePortfolioState({
        version: 2,
        audNzdRate: -5,
        fundBalances: { USF: 9000, BAD: null, ZERO: 0 },
        directHoldings: [
          {
            isin: "NZMCYE0001S8",
            name: "Mercury NZ Limited",
            ticker: "MCY.NZ",
            exchange: "NZX",
            country: "New Zealand",
            sector: "Utilities",
            currency: "NZD",
            value: 3000,
          },
          { broken: true },
        ],
        cashDeposits: null,
        buckets: [{ id: "b1", name: "Core", targetPercent: 100 }],
      });

      assertTrue(normalized !== null, "should normalize partial object");
      assertEq(normalized!.audNzdRate, 1.10, "invalid FX falls back safely");
      assertEq(normalized!.fundBalances.USF, 9000, "valid fund preserved");
      assertEq(normalized!.fundBalances.BAD, undefined, "malformed fund dropped");
      assertEq(normalized!.directHoldings.length, 1, "valid direct holding preserved");
      assertEq(normalized!.cashDeposits.length, 0, "missing array defaults empty");
      assertEq(normalized!.buckets.length, 1, "valid bucket preserved");
    },
  ],
  [
    "savePortfolioState writes both v2 primary and backup keys and import accepts v1 JSON",
    () => {
      const store = installMockLocalStorage();
      savePortfolioState({
        ...DEFAULT_PORTFOLIO_STATE,
        fundBalances: { NZG: 25000 },
      });
      assertTrue(store.has(STORAGE_KEY_V2), "primary key written");
      assertTrue(store.has(STORAGE_KEY_BACKUP_V2), "backup key written");

      const importedV1 = importPortfolioJSON(
        JSON.stringify({
          version: 1,
          audNzdRate: 1.08,
          fundBalances: { TWF: 10000 },
          directHoldings: [],
        })
      );
      assertEq(importedV1.version, 2, "v1 import upgraded to v2");
      assertEq(importedV1.fundBalances.TWF, 10000, "v1 import preserves fund balance");
    },
  ],
];

