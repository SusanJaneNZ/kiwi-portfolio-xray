import {
  areTickersCachedToday,
  fetchNzxPrices,
  getTodayDateString,
  loadStoredDailyPrices,
  saveStoredDailyPrices,
} from './prices';

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// In-memory mock localStorage for Node testing environment
class MockLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

export const pricesTestCases: [string, () => Promise<void>][] = [
  [
    'getTodayDateString returns YYYY-MM-DD format',
    async () => {
      const today = getTodayDateString();
      assertTrue(/^\d{4}-\d{2}-\d{2}$/.test(today), `format matched YYYY-MM-DD: got ${today}`);
    },
  ],
  [
    'saveStoredDailyPrices and loadStoredDailyPrices persist to storage',
    async () => {
      const origWindow = (globalThis as any).window;
      const mockStorage = new MockLocalStorage();
      (globalThis as any).window = { localStorage: mockStorage };

      try {
        const today = getTodayDateString();
        saveStoredDailyPrices({
          date: today,
          lastFetchedAt: new Date().toISOString(),
          prices: { CEN: 8.5, FPH: 34.2 },
        });

        const loaded = loadStoredDailyPrices();
        assertTrue(loaded !== null, 'loaded should not be null');
        assertEq(loaded!.date, today, 'cached date matched');
        assertEq(loaded!.prices.CEN, 8.5, 'CEN price matched');
        assertEq(loaded!.prices.FPH, 34.2, 'FPH price matched');
      } finally {
        (globalThis as any).window = origWindow;
      }
    },
  ],
  [
    'areTickersCachedToday returns true only if all tickers cached for today',
    async () => {
      const origWindow = (globalThis as any).window;
      const mockStorage = new MockLocalStorage();
      (globalThis as any).window = { localStorage: mockStorage };

      try {
        const today = getTodayDateString();
        assertTrue(areTickersCachedToday([]), 'empty list returns true');

        saveStoredDailyPrices({
          date: today,
          lastFetchedAt: new Date().toISOString(),
          prices: { CEN: 8.5 },
        });

        assertTrue(areTickersCachedToday(['CEN']), 'CEN cached today');
        assertTrue(areTickersCachedToday(['CEN.NZ']), 'CEN.NZ stripped and cached');
        assertTrue(!areTickersCachedToday(['CEN', 'FPH']), 'FPH not cached');

        // Expired date
        saveStoredDailyPrices({
          date: '2020-01-01',
          lastFetchedAt: new Date().toISOString(),
          prices: { CEN: 8.5, FPH: 34.2 },
        });
        assertTrue(!areTickersCachedToday(['CEN']), 'expired date reports uncached');
      } finally {
        (globalThis as any).window = origWindow;
      }
    },
  ],
  [
    'fetchNzxPrices returns cached prices without network fetch when cached today',
    async () => {
      const origWindow = (globalThis as any).window;
      const mockStorage = new MockLocalStorage();
      (globalThis as any).window = { localStorage: mockStorage };

      const originalFetch = globalThis.fetch;
      let fetchCalled = false;

      try {
        const today = getTodayDateString();
        saveStoredDailyPrices({
          date: today,
          lastFetchedAt: new Date().toISOString(),
          prices: { CEN: 8.5, FPH: 34.2 },
        });

        globalThis.fetch = async () => {
          fetchCalled = true;
          return new Response('{}', { status: 200 });
        };

        const result = await fetchNzxPrices(['CEN', 'FPH']);
        assertTrue(result.ok, 'result ok');
        assertTrue(result.cached, 'result returned from cache');
        assertEq(result.prices.CEN, 8.5, 'CEN price matches cache');
        assertEq(result.prices.FPH, 34.2, 'FPH price matches cache');
        assertTrue(!fetchCalled, 'fetch was NOT called (0 API calls)');
      } finally {
        globalThis.fetch = originalFetch;
        (globalThis as any).window = origWindow;
      }
    },
  ],
  [
    'fetchNzxPrices loads data/prices.json when uncached and updates local cache',
    async () => {
      const origWindow = (globalThis as any).window;
      const mockStorage = new MockLocalStorage();
      (globalThis as any).window = { localStorage: mockStorage };

      const originalFetch = globalThis.fetch;
      let fetchedUrl = '';

      try {
        const today = getTodayDateString();
        globalThis.fetch = async (url: RequestInfo | URL) => {
          fetchedUrl = String(url);
          return new Response(
            JSON.stringify({
              date: today,
              updatedAt: `${today}T07:00:00Z`,
              prices: { 'AIA.NZ': 7.85 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        };

        const result = await fetchNzxPrices(['AIA']);
        assertTrue(result.ok, 'result ok');
        assertEq(result.prices.AIA, 7.85, 'AIA price parsed');
        assertTrue(fetchedUrl.includes('data/prices.json'), 'loaded data/prices.json');

        const stored = loadStoredDailyPrices();
        assertEq(stored?.prices.AIA, 7.85, 'AIA price persisted into storage');
      } finally {
        globalThis.fetch = originalFetch;
        (globalThis as any).window = origWindow;
      }
    },
  ],
  [
    'fetchNzxPrices with force=true bypasses local cache',
    async () => {
      const origWindow = (globalThis as any).window;
      const mockStorage = new MockLocalStorage();
      (globalThis as any).window = { localStorage: mockStorage };

      const originalFetch = globalThis.fetch;
      let fetchCalled = false;

      try {
        const today = getTodayDateString();
        saveStoredDailyPrices({
          date: today,
          lastFetchedAt: new Date().toISOString(),
          prices: { CEN: 8.5 },
        });

        globalThis.fetch = async () => {
          fetchCalled = true;
          return new Response(
            JSON.stringify({
              date: today,
              updatedAt: `${today}T07:00:00Z`,
              prices: { 'CEN.NZ': 8.75 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        };

        const result = await fetchNzxPrices(['CEN'], true);
        assertTrue(fetchCalled, 'force=true triggered network fetch');
        assertEq(result.prices.CEN, 8.75, 'returned newly fetched price');
      } finally {
        globalThis.fetch = originalFetch;
        (globalThis as any).window = origWindow;
      }
    },
  ],
];
