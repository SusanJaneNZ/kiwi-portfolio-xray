/**
 * Live FX utilities for AUD/NZD currency conversion.
 */

export interface FxRateResult {
  rate: number;
  timestamp: string;
}

// In-memory module cache to avoid rate abuse and redundant network queries (15-min TTL)
let cachedResult: { result: FxRateResult; expiresAt: number } | null = null;
const CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Fetches the live AUD -> NZD exchange rate from free, CORS-enabled market data APIs.
 * Falls back across multiple public providers with zero authentication required.
 * Includes timeout and boundary validation (0.5 < rate < 2.5).
 */
export async function fetchLiveAudNzdRate(forceRefresh = false): Promise<FxRateResult | null> {
  const now = Date.now();
  if (!forceRefresh && cachedResult && cachedResult.expiresAt > now) {
    return cachedResult.result;
  }

  if (typeof fetch === 'undefined') return null;

  // Primary: Open Exchange Rates public mirror (open.er-api.com)
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/AUD', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      const nzd = data?.rates?.NZD;
      if (typeof nzd === 'number' && Number.isFinite(nzd) && nzd > 0.5 && nzd < 2.5) {
        const result: FxRateResult = {
          rate: Math.round(nzd * 10000) / 10000,
          timestamp: new Date().toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' }),
        };
        cachedResult = { result, expiresAt: now + CACHE_TTL_MS };
        return result;
      }
    }
  } catch {
    // Primary failed or timed out — proceed to fallback
  }

  // Fallback: Frankfurter API (European Central Bank reference rates)
  try {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=AUD&symbols=NZD', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      const nzd = data?.rates?.NZD;
      if (typeof nzd === 'number' && Number.isFinite(nzd) && nzd > 0.5 && nzd < 2.5) {
        const result: FxRateResult = {
          rate: Math.round(nzd * 10000) / 10000,
          timestamp: new Date().toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' }),
        };
        cachedResult = { result, expiresAt: now + CACHE_TTL_MS };
        return result;
      }
    }
  } catch {
    // Both endpoints failed or timed out
  }

  return null;
}

/** Clear memory cache for testing or manual refresh */
export function clearFxCache(): void {
  cachedResult = null;
}
