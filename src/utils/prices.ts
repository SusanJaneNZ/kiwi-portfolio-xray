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

async function fetchTickerViaCorsProxy(ticker: string): Promise<{ price: number | null; diagnostic: PriceDiagnosticItem }> {
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`;
  const proxies = [
    `https://corsproxy.io/?url=${encodeURIComponent(yahooUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`,
  ];

  let lastStatus = 0;
  let lastStatusText = 'Network Error';
  let lastError = 'All live price proxies failed';
  let lastUrl = proxies[0];

  for (const proxyUrl of proxies) {
    lastUrl = proxyUrl;
    try {
      const res = await fetch(proxyUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      lastStatus = res.status;
      lastStatusText = res.statusText || '';
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const json = await res.json();
      const meta = json?.chart?.result?.[0]?.meta;
      const rawPrice = meta?.regularMarketPrice ?? meta?.previousClose;
      if (typeof rawPrice === 'number' && Number.isFinite(rawPrice) && rawPrice > 0) {
        return {
          price: Math.round(rawPrice * 10000) / 10000,
          diagnostic: {
            ticker,
            url: proxyUrl,
            status: res.status,
            statusText: res.statusText || 'OK',
            ok: true,
            extractedPrice: Math.round(rawPrice * 10000) / 10000,
            currency: meta?.currency || null,
            error: null,
          },
        };
      }
      lastError = 'No price field in Yahoo Finance response';
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    price: null,
    diagnostic: {
      ticker,
      url: lastUrl,
      status: lastStatus,
      statusText: lastStatusText,
      ok: false,
      extractedPrice: null,
      currency: null,
      error: lastError,
    },
  };
}

async function fetchLivePricesViaPublicProxy(
  cleanTickers: string[],
  today: string,
  isStoredToday: boolean,
  stored: DailyPriceCache | null
): Promise<FetchPricesResult> {
  const results = await Promise.all(cleanTickers.map((t) => fetchTickerViaCorsProxy(t)));
  const prices: Record<string, number> = {};
  const diagnostics: PriceDiagnosticItem[] = [];
  let fetchedCount = 0;

  for (let i = 0; i < cleanTickers.length; i++) {
    const ticker = cleanTickers[i];
    const base = ticker.replace(/\.(NZ|AX)$/i, '');
    const { price, diagnostic } = results[i];
    diagnostics.push(diagnostic);
    if (typeof price === 'number' && price > 0) {
      prices[ticker] = price;
      prices[base] = price;
      fetchedCount++;
    }
  }

  const fetchTimestamp = new Date().toISOString();
  if (fetchedCount > 0) {
    const existingPrices = isStoredToday && stored ? stored.prices : {};
    saveStoredDailyPrices({
      date: today,
      lastFetchedAt: fetchTimestamp,
      prices: { ...existingPrices, ...prices },
    });
  }

  return {
    ok: fetchedCount > 0,
    prices,
    date: today,
    cached: false,
    fetchedCount,
    lastFetchedAt: fetchTimestamp,
    diagnostics,
    error: fetchedCount === 0 ? 'Could not fetch live prices from Yahoo Finance. Please try again or enter prices manually.' : undefined,
  };
}

function isLocalhostRuntime(): boolean {
  if (typeof window === 'undefined' || !window.location?.hostname) return true;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * Fetches prices for the given stock and ETF tickers in a single batched call.
 * Uses local `/api/prices` proxy on localhost, and falls back to live CORS-proxied
 * Yahoo Finance requests on static hosting (e.g. GitHub Pages).
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
  if (!isLocalhostRuntime()) {
    return fetchLivePricesViaPublicProxy(cleanTickers, today, isStoredToday, stored);
  }

  // Hit local dev server proxy /api/prices
  try {
    const query = new URLSearchParams({
      tickers: cleanTickers.join(','),
      force: force ? 'true' : 'false',
    });

    const response = await fetch(`/api/prices?${query.toString()}`);
    if (response.status === 404) {
      return fetchLivePricesViaPublicProxy(cleanTickers, today, isStoredToday, stored);
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

