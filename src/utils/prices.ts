/**
 * Client-side stock/ETF price synchronization with daily lockout cache.
 * Powered by Yahoo Finance API via local dev server proxy.
 */

export const PRICE_CACHE_KEY = 'kiwi_daily_prices_cache_v1';

export interface DailyPriceCache {
  date: string; // YYYY-MM-DD
  lastFetchedAt: string; // ISO string
  prices: Record<string, number>;
}

export interface PriceDiagnosticItem {
  ticker: string;
  url: string;
  status: number;
  statusText: string;
  ok: boolean;
  requestHeaders?: Record<string, string>;
  rawResponse?: string | null;
  extractedPrice: number | null;
  currency?: string | null;
  error?: string | null;
}

export interface FetchPricesResult {
  ok: boolean;
  prices: Record<string, number>;
  date: string;
  cached: boolean;
  fetchedCount?: number;
  lastFetchedAt?: string;
  error?: string;
  diagnostics?: PriceDiagnosticItem[];
  logPath?: string;
}

export function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0];
}

export function loadStoredDailyPrices(): DailyPriceCache | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(PRICE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DailyPriceCache;
    if (parsed && typeof parsed === 'object' && typeof parsed.date === 'string' && parsed.prices) {
      return parsed;
    }
  } catch {
    // Ignore corrupt cache
  }
  return null;
}

export function saveStoredDailyPrices(cache: DailyPriceCache): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Checks whether all requested tickers are already cached for today.
 */
export function areTickersCachedToday(tickers: string[]): boolean {
  if (tickers.length === 0) return true;
  const today = getTodayDateString();
  const stored = loadStoredDailyPrices();
  if (!stored || stored.date !== today) return false;

  return tickers.every((ticker) => {
    const raw = ticker.trim().toUpperCase();
    const base = raw.replace(/\.(NZ|AX)$/i, '');
    const price = stored.prices[raw] ?? stored.prices[base];
    return typeof price === 'number' && price > 0;
  });
}

/**
 * Optional Cloudflare Worker URL (see /worker). Set at build time via VITE_PRICE_PROXY_URL.
 * Used only when the local `/api/prices` dev server is unavailable (e.g. GitHub Pages).
 */
const PRICE_PROXY_URL: string = (
  (typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_PRICE_PROXY_URL) ||
  ''
).replace(/\/+$/, '');

async function fetchLivePricesViaWorker(
  cleanTickers: string[],
  today: string,
  isStoredToday: boolean,
  stored: DailyPriceCache | null
): Promise<FetchPricesResult> {
  if (!PRICE_PROXY_URL) {
    return {
      ok: false,
      prices: {},
      date: today,
      cached: false,
      error: 'Live prices are not available on this site. Enter prices manually, or run the app locally.',
    };
  }

  try {
    const res = await fetch(`${PRICE_PROXY_URL}/?tickers=${encodeURIComponent(cleanTickers.join(','))}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    const data = (await res.json().catch(() => null)) as FetchPricesResult | null;
    if (!res.ok || !data) {
      return {
        ok: false,
        prices: {},
        date: today,
        cached: false,
        error: data?.error || `Price service returned HTTP ${res.status}`,
        diagnostics: data?.diagnostics,
      };
    }

    const fetchTimestamp = new Date().toISOString();
    if (data.ok && data.prices) {
      const existingPrices = isStoredToday && stored ? stored.prices : {};
      saveStoredDailyPrices({
        date: today,
        lastFetchedAt: fetchTimestamp,
        prices: { ...existingPrices, ...data.prices },
      });
    }
    return { ...data, lastFetchedAt: fetchTimestamp };
  } catch (err) {
    return {
      ok: false,
      prices: {},
      date: today,
      cached: false,
      error: `Could not reach the price service: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** True only on known static hosts (no `/api/prices` server). Everything else tries the local server first. */
function isStaticHostRuntime(): boolean {
  if (typeof window === 'undefined' || !window.location?.hostname) return false;
  return window.location.hostname.endsWith('.github.io');
}

/**
 * Fetches prices for the given stock and ETF tickers in a single batched call.
 * Uses local `/api/prices` proxy on localhost, and falls back to the Cloudflare Worker price proxy (see /worker)
 * on static hosting (e.g. GitHub Pages).
 */
export async function fetchNzxPrices(tickers: string[], force = false): Promise<FetchPricesResult> {
  const cleanTickers = Array.from(
    new Set(
      tickers
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean)
    )
  );

  const today = getTodayDateString();
  const stored = loadStoredDailyPrices();
  const isStoredToday = stored?.date === today;

  // Check client-side daily cache first
  if (!force && isStoredToday && stored) {
    const allCached = cleanTickers.every((t) => {
      const base = t.replace(/\.(NZ|AX)$/i, '');
      return typeof stored.prices[t] === 'number' || typeof stored.prices[base] === 'number';
    });
    if (allCached) {
      const filtered: Record<string, number> = {};
      for (const t of cleanTickers) {
        const base = t.replace(/\.(NZ|AX)$/i, '');
        const p = stored.prices[t] ?? stored.prices[base];
        if (typeof p === 'number') {
          filtered[t] = p;
          filtered[base] = p;
        }
      }
      return {
        ok: true,
        prices: filtered,
        date: today,
        cached: true,
        fetchedCount: 0,
        lastFetchedAt: stored.lastFetchedAt,
      };
    }
  }

  // On static hosting (e.g. GitHub Pages), skip /api/prices 404 and fetch live via CORS proxy
  if (isStaticHostRuntime()) {
    return fetchLivePricesViaWorker(cleanTickers, today, isStoredToday, stored);
  }

  // Hit local dev server proxy /api/prices
  try {
    const query = new URLSearchParams({
      tickers: cleanTickers.join(','),
      force: force ? 'true' : 'false',
    });

    const response = await fetch(`/api/prices?${query.toString()}`);
    if (response.status === 404) {
      return fetchLivePricesViaWorker(cleanTickers, today, isStoredToday, stored);
    }
    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({}));
      return {
        ok: false,
        prices: {},
        date: today,
        cached: false,
        error: errorJson.error || `HTTP ${response.status} fetching prices`,
      };
    }

    const data = (await response.json()) as FetchPricesResult;
    const fetchTimestamp = new Date().toISOString();

    // Log complete diagnostics to browser console for immediate visibility
    if (data.diagnostics && data.diagnostics.length > 0) {
      console.groupCollapsed(`[Yahoo Finance Pricing API] Request/Response details for ${cleanTickers.length} ticker(s)`);
      console.table(
        data.diagnostics.map((d) => ({
          Ticker: d.ticker,
          Status: `${d.status} ${d.statusText}`,
          OK: d.ok,
          Price: d.extractedPrice !== null ? `$${d.extractedPrice}` : 'N/A',
          Currency: d.currency || 'N/A',
          Error: d.error || (d.ok ? 'None' : 'Failed'),
          URL: d.url,
        }))
      );
      console.log('Full Diagnostics Objects:', data.diagnostics);
      console.groupEnd();
    }

    if (data.ok && data.prices) {
      const existingPrices = isStoredToday && stored ? stored.prices : {};
      const mergedPrices = { ...existingPrices, ...data.prices };
      saveStoredDailyPrices({
        date: today,
        lastFetchedAt: fetchTimestamp,
        prices: mergedPrices,
      });
    }

    return {
      ...data,
      lastFetchedAt: fetchTimestamp,
    };
  } catch (err) {
    return {
      ok: false,
      prices: {},
      date: today,
      cached: false,
      error: String(err),
    };
  }
}

export const fetchStockPrices = fetchNzxPrices;

