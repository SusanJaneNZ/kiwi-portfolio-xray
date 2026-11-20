/**
 * Kiwi Portfolio X-Ray — live price proxy (Cloudflare Worker).
 *
 * GitHub Pages is static, so the browser cannot call Yahoo Finance directly (no CORS headers,
 * and Yahoo blocks anonymous browser traffic). This Worker fetches quotes server-side and returns
 * the same JSON shape as the local dev server's `/api/prices` endpoint.
 *
 * Usage: GET https://<worker-url>/?tickers=MCY.NZ,BHP.AX
 */

const ALLOWED_ORIGINS = ['https://susanjanenz.github.io'];
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.\-]{0,14}$/;
const MAX_TICKERS = 25;
const CACHE_SECONDS = 300;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function isAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin);
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(origin ? corsHeaders(origin) : {}) },
  });
}

async function fetchTicker(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
  const diagnostic = {
    ticker,
    url,
    status: 0,
    statusText: '',
    ok: false,
    extractedPrice: null,
    currency: null,
    error: null,
  };

  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    diagnostic.status = res.status;
    diagnostic.statusText = res.statusText || '';
    if (!res.ok) {
      diagnostic.error = `Yahoo Finance returned HTTP ${res.status}`;
      return diagnostic;
    }
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice ?? meta?.previousClose;
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
      diagnostic.ok = true;
      diagnostic.extractedPrice = Math.round(price * 10000) / 10000;
      diagnostic.currency = meta?.currency ?? null;
    } else {
      diagnostic.error = 'No price in Yahoo Finance response';
    }
  } catch (err) {
    diagnostic.error = err instanceof Error ? err.message : String(err);
  }
  return diagnostic;
}

async function fetchTickerCached(ticker, ctx) {
  const hasCache = typeof caches !== 'undefined' && caches.default;
  const cacheKey = new Request(`https://price-cache.invalid/${ticker}`);

  if (hasCache) {
    const hit = await caches.default.match(cacheKey);
    if (hit) return hit.json();
  }

  const result = await fetchTicker(ticker);

  if (hasCache && result.ok) {
    const cached = new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_SECONDS}` },
    });
    const store = caches.default.put(cacheKey, cached);
    if (ctx?.waitUntil) ctx.waitUntil(store);
    else await store;
  }
  return result;
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const originAllowed = !origin || isAllowedOrigin(origin);

    if (request.method === 'OPTIONS') {
      return originAllowed && origin
        ? new Response(null, { status: 204, headers: corsHeaders(origin) })
        : new Response(null, { status: 403 });
    }
    if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405, origin || null);
    if (!originAllowed) return json({ ok: false, error: 'Origin not allowed' }, 403, null);

    const responseOrigin = origin || null;
    const params = new URL(request.url).searchParams;
    const tickers = Array.from(
      new Set(
        (params.get('tickers') || '')
          .split(',')
          .map((t) => t.trim().toUpperCase())
          .filter(Boolean)
      )
    );

    if (tickers.length === 0) return json({ ok: false, error: 'No tickers provided' }, 400, responseOrigin);
    if (tickers.length > MAX_TICKERS) {
      return json({ ok: false, error: `Too many tickers (max ${MAX_TICKERS})` }, 400, responseOrigin);
    }
    if (tickers.some((t) => !TICKER_PATTERN.test(t))) {
      return json({ ok: false, error: 'Invalid ticker format' }, 400, responseOrigin);
    }

    const diagnostics = await Promise.all(tickers.map((t) => fetchTickerCached(t, ctx)));
    const prices = {};
    for (const d of diagnostics) {
      if (d.ok && d.extractedPrice !== null) {
        prices[d.ticker] = d.extractedPrice;
        prices[d.ticker.replace(/\.(NZ|AX)$/, '')] = d.extractedPrice;
      }
    }
    const fetchedCount = diagnostics.filter((d) => d.ok).length;

    return json(
      {
        ok: fetchedCount > 0,
        prices,
        date: new Date().toISOString().split('T')[0],
        cached: false,
        fetchedCount,
        diagnostics,
        error: fetchedCount === 0 ? 'Could not fetch any prices from Yahoo Finance' : undefined,
      },
      200,
      responseOrigin
    );
  },
};
