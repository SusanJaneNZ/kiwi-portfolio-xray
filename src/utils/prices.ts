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
 * Fetches prices for the given stock and ETF tickers in a single batched call.
 * If all tickers are cached for today and force is false, no network request is made.
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

  // Hit local dev server proxy /api/prices
  try {
    const query = new URLSearchParams({
      tickers: cleanTickers.join(','),
      force: force ? 'true' : 'false',
    });

    const response = await fetch(`/api/prices?${query.toString()}`);
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

