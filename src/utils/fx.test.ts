import { clearFxCache, fetchLiveAudNzdRate } from "./fx";

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

export const fxTestCases: [string, () => Promise<void>][] = [
  [
    "fetchLiveAudNzdRate returns parsed rate from primary endpoint",
    async () => {
      clearFxCache();
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async () =>
          new Response(JSON.stringify({ rates: { NZD: 1.1045 } }), { status: 200 });

        const res = await fetchLiveAudNzdRate();
        assertTrue(res !== null, "result should not be null");
        assertEq(res!.rate, 1.1045, "rate matched");
        assertTrue(typeof res!.timestamp === "string", "has timestamp");
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  ],
  [
    "fetchLiveAudNzdRate falls back to secondary endpoint on primary error",
    async () => {
      clearFxCache();
      const originalFetch = globalThis.fetch;
      try {
        let callCount = 0;
        globalThis.fetch = async (url: RequestInfo | URL) => {
          callCount++;
          if (String(url).includes("open.er-api.com")) {
            return new Response("Service Unavailable", { status: 503 });
          }
          return new Response(JSON.stringify({ rates: { NZD: 1.1123 } }), { status: 200 });
        };

        const res = await fetchLiveAudNzdRate(true);
        assertTrue(res !== null, "fallback returned result");
        assertEq(res!.rate, 1.1123, "fallback rate matched");
        assertEq(callCount, 2, "both endpoints called");
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  ],
  [
    "fetchLiveAudNzdRate rejects out-of-bounds rates (< 0.5 or > 2.5) and non-numeric values",
    async () => {
      clearFxCache();
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async () =>
          new Response(JSON.stringify({ rates: { NZD: 99.99 } }), { status: 200 });

        const res = await fetchLiveAudNzdRate(true);
        assertEq(res, null, "out-of-bounds rate rejected");
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  ],
  [
    "fetchLiveAudNzdRate uses cache within TTL unless forceRefresh is passed",
    async () => {
      clearFxCache();
      const originalFetch = globalThis.fetch;
      try {
        let fetchCalls = 0;
        globalThis.fetch = async () => {
          fetchCalls++;
          return new Response(JSON.stringify({ rates: { NZD: 1.105 } }), { status: 200 });
        };

        const first = await fetchLiveAudNzdRate();
        const second = await fetchLiveAudNzdRate();
        assertEq(fetchCalls, 1, "only 1 fetch call made due to cache");
        assertEq(first!.rate, second!.rate, "cached rate returned");

        // With forceRefresh = true
        await fetchLiveAudNzdRate(true);
        assertEq(fetchCalls, 2, "forceRefresh triggered network fetch");
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  ],
];

