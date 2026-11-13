/**
 * Persistence, v1 -> v2 migration, backup recovery, and sanitization tests.
 */

import {
  DEFAULT_PORTFOLIO_STATE,
  LinkedFileHandle,
  STORAGE_KEY_BACKUP_V2,
  STORAGE_KEY_V1,
  STORAGE_KEY_V2,
  autoSavePortfolioToDisk,
  createDatedBackupOnDisk,
  exportHoldingsCSV,
  exportPortfolioToDisk,
  fetchBackupsList,
  importPortfolioJSON,
  isEmptyPortfolio,
  isSamplePortfolio,
  loadPortfolioFromDisk,
  loadPortfolioStateWithMeta,
  normalizePortfolioState,
  resumeLinkedFileSync,
  savePortfolioState,
  writePortfolioToLinkedFile,
} from "./localStorage";
import { ConsolidatedHolding, UserPortfolioState } from "../types/portfolio";

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
        fixedInterest: [],
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
    "preserves user discrete share counts when direct holding has zero or unknown price",
    () => {
      const normalized = normalizePortfolioState({
        version: 2,
        audNzdRate: 1.22,
        fundBalances: {},
        directHoldings: [
          {
            isin: "SEDOL:6161525",
            name: "Ryman Healthcare Limited",
            ticker: "RYM.NZ",
            exchange: "NZX",
            country: "New Zealand",
            sector: "Health Care",
            currency: "NZD",
            shares: 2550,
            price: 0,
            value: 0,
          },
          {
            isin: "AGG",
            name: "Smart Global Aggregate Bond Etf",
            ticker: "AGG.NZ",
            exchange: "NZX",
            country: "New Zealand",
            sector: "Fixed Income",
            currency: "NZD",
            isEtf: true,
            fundCode: "AGG",
            shares: 12406,
            price: 0,
            value: 0,
          },
        ],
        cashDeposits: [],
      });

      assertTrue(normalized !== null, "should normalize valid state");
      assertEq(normalized!.directHoldings.length, 2, "both direct holdings preserved");
      assertEq(normalized!.directHoldings[0].shares, 2550, "shares must not be reset to 1 when price is 0");
      assertEq(normalized!.directHoldings[0].price, 0, "price preserved as 0");
      assertEq(normalized!.directHoldings[0].value, 0, "value preserved as 0");
      assertEq(normalized!.directHoldings[1].shares, 12406, "ETF shares preserved when unpriced");
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
  [
    "linked backup file writes JSON and restores holdings when local storage is default",
    async () => {
      let diskContent = JSON.stringify({
        version: 2,
        timestamp: "2026-11-11T08:00:00Z",
        audNzdRate: 1.11,
        fundBalances: { ASIA: 33000 },
        directHoldings: [],
        fixedInterest: [],
        cashDeposits: [],
        buckets: [],
        bucketAssignments: {},
      });
      const mockHandle: LinkedFileHandle = {
        name: "my_backup.json",
        async getFile() {
          return {
            async text() {
              return diskContent;
            },
          } as File;
        },
        async createWritable() {
          return {
            async write(data: string) {
              diskContent = data;
            },
            async close() {},
          };
        },
        async requestPermission() {
          return "granted";
        },
      };

      const restored = await resumeLinkedFileSync(mockHandle, DEFAULT_PORTFOLIO_STATE, "default");
      assertEq(restored.status, "loaded_from_file", "default local state should restore from linked disk file");
      assertEq(restored.state!.fundBalances.ASIA, 33000, "restored ASIA balance from disk");

      // Even if local storage contains a newer timestamp holding Sample data (loadSource === 'v2'),
      // resumeLinkedFileSync must restore the real disk backup instead of overwriting it with Sample!
      const newerSampleState = {
        ...DEFAULT_PORTFOLIO_STATE,
        timestamp: "2099-01-01T00:00:00Z",
      };
      const protectedRestore = await resumeLinkedFileSync(mockHandle, newerSampleState, "v2");
      assertEq(protectedRestore.status, "loaded_from_file", "newer sample state must not overwrite real disk backup");
      assertEq(protectedRestore.state!.fundBalances.ASIA, 33000, "disk backup remains intact");

      const updated = {
        ...restored.state!,
        timestamp: "2026-11-11T09:00:00Z",
        fundBalances: { ASIA: 44000 },
      };
      const ok = await writePortfolioToLinkedFile(mockHandle, updated);
      assertTrue(ok, "writePortfolioToLinkedFile succeeds");
      assertTrue(diskContent.includes("44000"), "disk content updated with new balance");
    },
  ],
  [
    "autoSavePortfolioToDisk, loadPortfolioFromDisk, createDatedBackupOnDisk, fetchBackupsList, and exportPortfolioToDisk hit local endpoints",
    async () => {
      const originalFetch = globalThis.fetch;
      let postedBody: any = null;
      let snapshotCalled = false;
      let exportCalled = false;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/portfolio/save") {
          postedBody = JSON.parse(init?.body as string);
          return { ok: true, json: async () => ({ ok: true, file: "backups/portfolio_backup.json" }) } as Response;
        }
        if (url === "/api/portfolio/backup") {
          snapshotCalled = true;
          return {
            ok: true,
            json: async () => ({ ok: true, backupFile: "portfolio_backup_2026-11-13_120000.json" }),
          } as Response;
        }
        if (url === "/api/portfolio/export") {
          exportCalled = true;
          return {
            ok: true,
            json: async () => ({ ok: true, file: "kiwi_portfolio_2026-11-14_120000.json", path: "backups/kiwi_portfolio_2026-11-14_120000.json" }),
          } as Response;
        }
        if (url === "/api/portfolio/backups") {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              backups: [
                { filename: "portfolio_backup.json", isCurrent: true, modifiedAt: "2026-11-14T12:00:00Z", size: 6000 },
                { filename: "portfolio_backup_2026-11-14_110000.json", isCurrent: false, modifiedAt: "2026-11-14T11:00:00Z", size: 5500 },
              ],
            }),
          } as Response;
        }
        if (url.startsWith("/api/portfolio/load")) {
          return {
            ok: true,
            json: async () => ({
              exists: true,
              state: {
                version: 2,
                timestamp: "2026-11-13T10:00:00Z",
                fundBalances: { FNZ: 50000 },
                directHoldings: [],
                cashDeposits: [],
                buckets: [],
                bucketAssignments: {},
              },
            }),
          } as Response;
        }
        return { ok: false, status: 404 } as Response;
      }) as typeof fetch;

      try {
        const testState = {
          ...DEFAULT_PORTFOLIO_STATE,
          fundBalances: { ASIA: 25000 },
        };
        const saved = await autoSavePortfolioToDisk(testState);
        assertTrue(saved, "autoSavePortfolioToDisk succeeds");
        assertEq(postedBody.fundBalances.ASIA, 25000, "posted body preserves ASIA balance");

        const dated = await createDatedBackupOnDisk();
        assertTrue(snapshotCalled, "createDatedBackupOnDisk triggered snapshot endpoint");
        assertEq(dated, "portfolio_backup_2026-11-13_120000.json", "returns dated backup filename");

        const exported = await exportPortfolioToDisk(testState);
        assertTrue(exportCalled, "exportPortfolioToDisk triggered endpoint");
        assertTrue(exported.ok, "exportPortfolioToDisk reports ok");
        assertEq(exported.path, "backups/kiwi_portfolio_2026-11-14_120000.json", "export path in backups/");

        const backups = await fetchBackupsList();
        assertEq(backups.length, 2, "fetched 2 backups from list endpoint");
        assertEq(backups[0].filename, "portfolio_backup.json", "first backup is current auto-save");

        const loaded = await loadPortfolioFromDisk("portfolio_backup_2026-11-14_110000.json");
        assertTrue(loaded !== null, "loadPortfolioFromDisk loads state");
        assertEq(loaded!.fundBalances.FNZ, 50000, "loaded FNZ balance from disk");
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  ],
  [
    "isEmptyPortfolio and isSamplePortfolio accurately identify states",
    () => {
      const emptyState: UserPortfolioState = {
        version: 2,
        timestamp: "2026-11-13T00:00:00Z",
        audNzdRate: 1.10,
        fundBalances: {},
        directHoldings: [],
        fixedInterest: [],
        cashDeposits: [],
        buckets: [],
        bucketAssignments: {},
      };
      assertTrue(isEmptyPortfolio(emptyState), "identifies empty portfolio");
      assertTrue(!isSamplePortfolio(emptyState), "empty is not sample");

      const sampleState = { ...DEFAULT_PORTFOLIO_STATE };
      assertTrue(!isEmptyPortfolio(sampleState), "sample is not empty");
      assertTrue(isSamplePortfolio(sampleState), "sample matches isSamplePortfolio");

      const modifiedState = {
        ...DEFAULT_PORTFOLIO_STATE,
        fundBalances: { FNZ: 99999 },
      };
      assertTrue(!isSamplePortfolio(modifiedState), "modified state is not sample");
    },
  ],
  [
    "exportHoldingsCSV sanitizes spreadsheet formula triggers and escapes double quotes",
    () => {
      const maliciousHolding: ConsolidatedHolding = {
        isin: "TEST0001",
        ticker: "=CMD|' /C CALC'!A0",
        name: "@Dangerous + Company",
        country: "New Zealand",
        sector: "-Finance",
        assetClass: "equity",
        valueNZD: 1000,
        portfolioWeight: 0.5,
        equityWeight: 0.5,
        sources: [],
      };
      const csv = exportHoldingsCSV([maliciousHolding]);
      assertTrue(csv.includes("'=CMD"), "formula trigger '=' escaped with leading single quote");
      assertTrue(csv.includes("'@Dangerous"), "formula trigger '@' escaped with leading single quote");
      assertTrue(csv.includes("'-Finance"), "formula trigger '-' escaped with leading single quote");
    },
  ],
  [
    "normalizePortfolioState defends against prototype pollution keys",
    () => {
      const maliciousPayload = {
        version: 2,
        fundBalances: {
          __proto__: { polluted: true },
          constructor: 5000,
          TWF: 10000,
        },
        bucketAssignments: {
          prototype: "bkt-growth",
          "fund:TWF": "bkt-growth",
        },
      };
      const normalized = normalizePortfolioState(maliciousPayload);
      assertTrue(normalized !== null, "payload normalized");
      assertEq(Object.prototype.hasOwnProperty.call(normalized!.fundBalances, "__proto__"), false, "no __proto__");
      assertEq(Object.prototype.hasOwnProperty.call(normalized!.fundBalances, "constructor"), false, "no constructor");
      assertEq(normalized!.fundBalances.TWF, 10000, "valid balance preserved");
      assertEq(Object.prototype.hasOwnProperty.call(normalized!.bucketAssignments, "prototype"), false, "no prototype");
    },
  ],
];

