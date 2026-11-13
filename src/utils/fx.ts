/**
 * Live FX utilities for AUD/NZD currency conversion.
 */

export interface FxRateResult {
  rate: number;
  timestamp: string;
}

/**
 * Fetches the live AUD -> NZD exchange rate from free, CORS-enabled market data APIs.
 * Falls back across multiple public providers with zero authentication required.
 */
export async function fetchLiveAudNzdRate(): Promise<FxRateResult | null> {
  if (typeof fetch === 'undefined') return null;

  // Primary: Open Exchange Rates public mirror (open.er-api.com)
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/AUD', {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      const nzd = data?.rates?.NZD;
      if (typeof nzd === 'number' && Number.isFinite(nzd) && nzd > 0.5 && nzd < 2.5) {
        return {
          rate: Math.round(nzd * 10000) / 10000,
          timestamp: new Date().toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' }),
        };
      }
    }
  } catch {
    // Ignore and try fallback
  }

  // Fallback: Frankfurter API (European Central Bank reference rates)
  try {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=AUD&symbols=NZD', {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      const nzd = data?.rates?.NZD;
      if (typeof nzd === 'number' && Number.isFinite(nzd) && nzd > 0.5 && nzd < 2.5) {
        return {
          rate: Math.round(nzd * 10000) / 10000,
          timestamp: new Date().toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' }),
        };
      }
    }
  } catch {
    // Both unavailable
  }

  return null;
}

