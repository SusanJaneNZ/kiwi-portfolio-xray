/**
 * Client-side stock/ETF end-of-day price synchronization with daily lockout cache.
 * Reads the compiled `data/prices.json` dataset (refreshed daily by GitHub Actions
 * via `pipeline/fetch_prices.py`, or locally via `/api/prices/refresh`).
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

interface StaticPricesPayload {
  date?: string;
  updatedAt?: string;
  source?: string;
  count?: number;
  prices?: Record<string, number>;
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
 * Loads end-of-day closing prices for the requested tickers from `data/prices.json`.
 * Works identically on localhost and GitHub Pages.
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

  const basePath =
    (typeof import.meta !== 'undefined' &&
      (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.BASE_URL) ||
    './';

  try {
    const response = await fetch(`${basePath}data/prices.json?t=${Date.now()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return {
        ok: false,
        prices: {},
        date: today,
        cached: false,
        error: `End-of-day price dataset unavailable (HTTP ${response.status}).`,
      };
    }

    const payload = (await response.json()) as StaticPricesPayload;
    const catalog = payload?.prices || {};
    const matchedPrices: Record<string, number> = {};
    let fetchedCount = 0;

    for (const ticker of cleanTickers) {
      const base = ticker.replace(/\.(NZ|AX)$/i, '');
      const price = catalog[ticker] ?? catalog[base] ?? catalog[`${base}.NZ`] ?? catalog[`${base}.AX`];
      if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
        matchedPrices[ticker] = price;
        matchedPrices[base] = price;
        fetchedCount++;
      }
    }

    const asOfDate = payload?.date || today;
    const asOfTimestamp = payload?.updatedAt || new Date().toISOString();

    if (fetchedCount > 0) {
      const existingPrices = isStoredToday && stored ? stored.prices : {};
      saveStoredDailyPrices({
        date: asOfDate,
        lastFetchedAt: asOfTimestamp,
        prices: { ...existingPrices, ...matchedPrices },
      });
    }

    return {
      ok: fetchedCount > 0,
      prices: matchedPrices,
      date: asOfDate,
      cached: false,
      fetchedCount,
      lastFetchedAt: asOfTimestamp,
      error:
        fetchedCount === 0
          ? 'No end-of-day prices found for these tickers in data/prices.json.'
          : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      prices: {},
      date: today,
      cached: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Localhost-only helper: triggers the same `pipeline/fetch_prices.py` workflow locally
 * via Vite's `/api/prices/refresh` middleware to regenerate `public/data/prices.json`.
 */
export async function refreshLocalEndOfDayPrices(): Promise<{ ok: boolean; count?: number; date?: string; error?: string }> {
  try {
    const res = await fetch('/api/prices/refresh', {
      method: 'POST',
      headers: { 'X-Requested-With': 'KiwiPortfolioXRay' },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status} refreshing end-of-day prices` };
    }
    return { ok: true, count: data.count, date: data.date };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const fetchStockPrices = fetchNzxPrices;
