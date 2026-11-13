/**
 * Client-side NZX price synchronization with daily lockout cache.
 */

export const PRICE_CACHE_KEY = 'kiwi_daily_prices_cache_v1';

export interface DailyPriceCache {
  date: string; // YYYY-MM-DD
  lastFetchedAt: string; // ISO string
  prices: Record<string, number>;
}

export interface FetchPricesResult {
  ok: boolean;
  prices: Record<string, number>;
  date: string;
  cached: boolean;
  fetchedCount?: number;
  lastFetchedAt?: string;
  error?: string;
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
    const clean = ticker.trim().toUpperCase().replace(/\.NZ$/i, '');
    return typeof stored.prices[clean] === 'number' && stored.prices[clean] > 0;
  });
}

/**
 * Fetches prices for the given NZX tickers in a single batched call.
 * If all tickers are cached for today and force is false, no network request is made.
 */
export async function fetchNzxPrices(tickers: string[], force = false): Promise<FetchPricesResult> {
  const cleanTickers = Array.from(
    new Set(
      tickers
        .map((t) => t.trim().toUpperCase().replace(/\.NZ$/i, ''))
        .filter(Boolean)
    )
  );

  const today = getTodayDateString();
  const stored = loadStoredDailyPrices();
  const isStoredToday = stored?.date === today;

  // Check client-side daily cache first
  if (!force && isStoredToday && stored) {
    const allCached = cleanTickers.every((t) => typeof stored.prices[t] === 'number');
    if (allCached) {
      const filtered: Record<string, number> = {};
      for (const t of cleanTickers) {
        if (typeof stored.prices[t] === 'number') filtered[t] = stored.prices[t];
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

