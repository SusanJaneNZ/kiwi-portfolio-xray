import { defineConfig, Plugin, Connect } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB

function createPortfolioMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (!req.url?.startsWith('/api/portfolio/')) {
      return next();
    }

    const repoRoot = process.cwd();
    const backupsDir = path.join(repoRoot, 'backups');
    const mainBackupPath = path.join(backupsDir, 'portfolio_backup.json');
    const legacyBackupPath = path.join(repoRoot, 'portfolio_backup.json');

    const ensureBackupsDir = async () => {
      await fs.promises.mkdir(backupsDir, { recursive: true });
    };

    // Protect POST endpoints against CSRF simple-request forgery from external origins
    if (req.method === 'POST') {
      const customHeader = req.headers['x-requested-with'];
      const origin = req.headers.origin || req.headers.referer;
      const host = req.headers.host;
      const isLocal = !origin || (host && origin.includes(host));
      if (!isLocal && customHeader !== 'KiwiPortfolioXRay') {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'Forbidden cross-origin request' }));
        return;
      }
    }

    // List available backups in the local backups/ directory
    if (req.method === 'GET' && req.url === '/api/portfolio/backups') {
      ensureBackupsDir()
        .then(async () => {
          const entries = await fs.promises.readdir(backupsDir, { withFileTypes: true });
          const items: Array<{ filename: string; isCurrent: boolean; modifiedAt: string; size: number }> = [];

          for (const ent of entries) {
            if (ent.isFile() && ent.name.endsWith('.json')) {
              try {
                const stat = await fs.promises.stat(path.join(backupsDir, ent.name));
                items.push({
                  filename: ent.name,
                  isCurrent: ent.name === 'portfolio_backup.json',
                  modifiedAt: stat.mtime.toISOString(),
                  size: stat.size,
                });
              } catch {
                // Ignore stat errors
              }
            }
          }

          // Also check if there is an unmigrated legacy backup in repoRoot
          try {
            if (fs.existsSync(legacyBackupPath) && !items.some((i) => i.filename === 'portfolio_backup.json')) {
              const stat = await fs.promises.stat(legacyBackupPath);
              items.push({
                filename: 'portfolio_backup.json',
                isCurrent: true,
                modifiedAt: stat.mtime.toISOString(),
                size: stat.size,
              });
            }
          } catch {
            // Ignore
          }

          // Sort current first, then newest modifiedAt
          items.sort((a, b) => {
            if (a.isCurrent && !b.isCurrent) return -1;
            if (!a.isCurrent && b.isCurrent) return 1;
            return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
          });

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, backups: items }));
        })
        .catch((err) => {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        });
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/api/portfolio/load')) {
      const parsedUrl = new URL(req.url, 'http://localhost');
      const targetFile = parsedUrl.searchParams.get('file');

      let targetPath = mainBackupPath;
      if (targetFile) {
        const safeName = path.basename(targetFile);
        targetPath = path.join(backupsDir, safeName);
      }

      fs.promises.readFile(targetPath, 'utf-8')
        .then((content) => {
          const parsed = JSON.parse(content);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ exists: true, state: parsed, file: targetFile || 'backups/portfolio_backup.json' }));
        })
        .catch(() => {
          // Fall back to legacy repo root if looking for default backup
          if (!targetFile && fs.existsSync(legacyBackupPath)) {
            fs.promises.readFile(legacyBackupPath, 'utf-8')
              .then((content) => {
                const parsed = JSON.parse(content);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ exists: true, state: parsed, file: 'portfolio_backup.json' }));
              })
              .catch(() => {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ exists: false }));
              });
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ exists: false }));
        });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/portfolio/save') {
      let body = '';
      let tooLarge = false;

      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_BODY_BYTES) {
          tooLarge = true;
          req.destroy();
          res.statusCode = 413;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'Payload Too Large (max 5MB)' }));
        }
      });

      req.on('end', async () => {
        if (tooLarge) return;
        try {
          await ensureBackupsDir();
          const parsed = JSON.parse(body);
          await fs.promises.writeFile(mainBackupPath, JSON.stringify(parsed, null, 2), 'utf-8');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, file: 'backups/portfolio_backup.json' }));
        } catch (err) {
          res.statusCode = typeof err === 'object' && err !== null && 'statusCode' in err ? 500 : 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
      });
      return;
    }

    // Export portfolio directly into local backups/ folder
    if (req.method === 'POST' && req.url === '/api/portfolio/export') {
      let body = '';
      let tooLarge = false;

      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_BODY_BYTES) {
          tooLarge = true;
          req.destroy();
          res.statusCode = 413;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'Payload Too Large (max 5MB)' }));
        }
      });

      req.on('end', async () => {
        if (tooLarge) return;
        try {
          await ensureBackupsDir();
          const parsed = JSON.parse(body);
          const now = new Date();
          const datePart = now.toISOString().split('T')[0];
          const timePart = now.toTimeString().split(' ')[0].replace(/:/g, '');
          const exportFilename = `kiwi_portfolio_${datePart}_${timePart}.json`;
          const exportPath = path.join(backupsDir, exportFilename);
          await fs.promises.writeFile(exportPath, JSON.stringify(parsed, null, 2), 'utf-8');

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, file: exportFilename, path: `backups/${exportFilename}` }));
        } catch (err) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/portfolio/backup') {
      ensureBackupsDir()
        .then(async () => {
          const sourcePath = fs.existsSync(mainBackupPath) ? mainBackupPath : fs.existsSync(legacyBackupPath) ? legacyBackupPath : null;
          if (!sourcePath) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, backupFile: null }));
            return;
          }

          const now = new Date();
          const datePart = now.toISOString().split('T')[0];
          const timePart = now.toTimeString().split(' ')[0].replace(/:/g, '');
          const datedName = `portfolio_backup_${datePart}_${timePart}.json`;
          const datedPath = path.join(backupsDir, datedName);
          await fs.promises.copyFile(sourcePath, datedPath);

          // Prune older backups keeping max 10 latest files in backupsDir
          try {
            const files = await fs.promises.readdir(backupsDir);
            const backupFiles = files
              .filter((f) => /^portfolio_backup_\d{4}-\d{2}-\d{2}_\d{6}\.json$/.test(f))
              .sort();
            if (backupFiles.length > 10) {
              const toDelete = backupFiles.slice(0, backupFiles.length - 10);
              await Promise.all(toDelete.map((f) => fs.promises.unlink(path.join(backupsDir, f)).catch(() => {})));
            }
          } catch {
            // Ignore prune errors
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, backupFile: datedName, path: `backups/${datedName}` }));
        })
        .catch(() => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, backupFile: null }));
        });
      return;
    }

    next();
  };
}

function createPricesMiddleware(): Connect.NextHandleFunction {
  const repoRoot = process.cwd();
  const cacheDir = path.join(repoRoot, 'data', 'cache');
  const cacheFile = path.join(cacheDir, 'daily_prices.json');
  const logFile = path.join(cacheDir, 'yahoo_last_fetch.json');

  const resolveYahooSymbol = (ticker: string): string => {
    const upper = ticker.trim().toUpperCase();
    if (upper.includes('.')) return upper;
    return `${upper}.NZ`;
  };

  const fetchYahooQuote = async (symbol: string): Promise<{
    price: number | null;
    currency: string | null;
    rawText: string;
    status: number;
    statusText: string;
    url: string;
    ok: boolean;
    error?: string | null;
  }> => {
    const primaryUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const fallbackUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    };

    let usedUrl = primaryUrl;
    let response: Response | null = null;
    let rawText = '';

    try {
      response = await fetch(primaryUrl, { headers, signal: AbortSignal.timeout(6000) });
      rawText = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (err) {
      try {
        usedUrl = fallbackUrl;
        response = await fetch(fallbackUrl, { headers, signal: AbortSignal.timeout(6000) });
        rawText = await response.text();
      } catch (fallbackErr) {
        return {
          price: null,
          currency: null,
          rawText: String(err),
          status: response ? response.status : 0,
          statusText: response ? response.statusText : 'Network / Timeout Error',
          url: usedUrl,
          ok: false,
          error: String(err),
        };
      }
    }

    let extractedPrice: number | null = null;
    let currency: string | null = null;
    let parseError: string | null = null;

    try {
      const parsedBody = JSON.parse(rawText);
      const result = parsedBody?.chart?.result?.[0];
      const meta = result?.meta;
      currency = meta?.currency || null;

      const candidate =
        typeof meta?.regularMarketPrice === 'number' && Number.isFinite(meta.regularMarketPrice) && meta.regularMarketPrice > 0
          ? meta.regularMarketPrice
          : typeof meta?.chartPreviousClose === 'number' && Number.isFinite(meta.chartPreviousClose) && meta.chartPreviousClose > 0
          ? meta.chartPreviousClose
          : typeof meta?.previousClose === 'number' && Number.isFinite(meta.previousClose) && meta.previousClose > 0
          ? meta.previousClose
          : null;

      if (typeof candidate === 'number' && candidate > 0) {
        extractedPrice = candidate;
      } else if (Array.isArray(result?.indicators?.quote?.[0]?.close)) {
        const closes = result.indicators.quote[0].close.filter(
          (c: any) => typeof c === 'number' && Number.isFinite(c) && c > 0
        );
        if (closes.length > 0) {
          extractedPrice = closes[closes.length - 1];
        }
      }

      if (extractedPrice === null) {
        parseError = parsedBody?.chart?.error?.description || 'No numeric price found in Yahoo Finance chart payload';
      }
    } catch {
      parseError = 'Failed to parse JSON response from Yahoo Finance';
    }

    return {
      price: extractedPrice,
      currency,
      rawText: rawText.slice(0, 1000),
      status: response ? response.status : 0,
      statusText: response ? response.statusText : 'OK',
      url: usedUrl,
      ok: Boolean(response?.ok) && extractedPrice !== null,
      error: parseError,
    };
  };

  return async (req, res, next) => {
    if (!req.url?.startsWith('/api/prices')) {
      return next();
    }

    // Localhost-only: run the same pipeline/fetch_prices.py script used by GitHub Actions
    if (req.url === '/api/prices/refresh' && req.method === 'POST') {
      const repoRoot = process.cwd();
      const outputPath = path.join(repoRoot, 'public', 'data', 'prices.json');
      const distOutputPath = path.join(repoRoot, 'dist', 'data', 'prices.json');
      execFile(
        'python3',
        ['-m', 'pipeline.fetch_prices', '--data-dir', 'public/data', '--output', outputPath],
        { cwd: repoRoot, timeout: 120_000 },
        (err, stdout, stderr) => {
          res.setHeader('Content-Type', 'application/json');
          if (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: stderr || err.message }));
            return;
          }
          try {
            const raw = fs.readFileSync(outputPath, 'utf-8');
            if (fs.existsSync(path.dirname(distOutputPath))) {
              fs.writeFileSync(distOutputPath, raw, 'utf-8');
            }
            const parsed = JSON.parse(raw);
            res.end(JSON.stringify({ ok: true, count: parsed.count, date: parsed.date, log: stdout.trim() }));
          } catch (readErr) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(readErr) }));
          }
        }
      );
      return;
    }

    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
      return;
    }

    try {
      const parsedUrl = new URL(req.url, 'http://localhost');
      const tickersParam = parsedUrl.searchParams.get('tickers') || '';
      const force = parsedUrl.searchParams.get('force') === 'true';

      const tickers = tickersParam
        .split(',')
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean);

      const today = new Date().toISOString().split('T')[0];

      if (tickers.length === 0) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, prices: {}, date: today, cached: true }));
        return;
      }

      // Read local daily cache if available
      let cachedData: { date?: string; prices?: Record<string, number> } = {};
      try {
        if (fs.existsSync(cacheFile)) {
          cachedData = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        }
      } catch {
        cachedData = {};
      }

      const isToday = cachedData.date === today;
      const prices: Record<string, number> = isToday && cachedData.prices ? { ...cachedData.prices } : {};

      const missingTickers = tickers.filter((t) => {
        const sym = resolveYahooSymbol(t);
        const base = t.replace(/\.(NZ|AX)$/i, '');
        return force || (typeof prices[t] !== 'number' && typeof prices[sym] !== 'number' && typeof prices[base] !== 'number');
      });

      // If all tickers are cached for today and not forced, return cached prices directly (0 API calls!)
      if (missingTickers.length === 0) {
        const filteredPrices: Record<string, number> = {};
        for (const t of tickers) {
          const sym = resolveYahooSymbol(t);
          const base = t.replace(/\.(NZ|AX)$/i, '');
          const p = prices[t] ?? prices[sym] ?? prices[base];
          if (typeof p === 'number') {
            filteredPrices[t] = p;
            filteredPrices[sym] = p;
            filteredPrices[base] = p;
          }
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, prices: filteredPrices, date: today, cached: true }));
        return;
      }

      const diagnostics: Array<{
        ticker: string;
        symbol: string;
        url: string;
        status: number;
        statusText: string;
        ok: boolean;
        currency?: string | null;
        rawResponse: string | null;
        extractedPrice: number | null;
        error?: string | null;
      }> = [];

      // Fetch missing tickers from Yahoo Finance in parallel batches of 5
      const CHUNK_SIZE = 5;
      for (let i = 0; i < missingTickers.length; i += CHUNK_SIZE) {
        const chunk = missingTickers.slice(i, i + CHUNK_SIZE);
        await Promise.all(
          chunk.map(async (t) => {
            const symbol = resolveYahooSymbol(t);
            const base = t.replace(/\.(NZ|AX)$/i, '');
            console.log(`[Yahoo Finance] Fetching: ${symbol}`);

            try {
              const result = await fetchYahooQuote(symbol);
              if (result.price !== null && result.price > 0) {
                prices[t] = result.price;
                prices[symbol] = result.price;
                prices[base] = result.price;
              }

              diagnostics.push({
                ticker: t,
                symbol,
                url: result.url,
                status: result.status,
                statusText: result.statusText,
                ok: result.ok,
                currency: result.currency,
                rawResponse: result.rawText,
                extractedPrice: result.price,
                error: result.error,
              });
            } catch (err) {
              const errMsg = String(err);
              console.error(`[Yahoo Finance] [${symbol}] Error:`, errMsg);
              diagnostics.push({
                ticker: t,
                symbol,
                url: `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
                status: 0,
                statusText: 'Fetch Error',
                ok: false,
                currency: null,
                rawResponse: null,
                extractedPrice: null,
                error: errMsg,
              });
            }
          })
        );

        if (i + CHUNK_SIZE < missingTickers.length) {
          await new Promise((r) => setTimeout(r, 60));
        }
      }

      // Save complete diagnostics to disk in data/cache/yahoo_last_fetch.json
      try {
        if (!fs.existsSync(cacheDir)) {
          fs.mkdirSync(cacheDir, { recursive: true });
        }
        let history: Record<string, any> = {};
        try {
          if (fs.existsSync(logFile)) {
            const existing = JSON.parse(fs.readFileSync(logFile, 'utf-8'));
            if (existing && typeof existing === 'object') {
              if (existing.history && typeof existing.history === 'object') {
                history = existing.history;
              } else if (Array.isArray(existing.diagnostics)) {
                for (const d of existing.diagnostics) {
                  if (d.ticker) history[d.ticker] = d;
                }
              }
            }
          }
        } catch {}

        for (const d of diagnostics) {
          history[d.ticker] = { ...d, timestamp: new Date().toISOString() };
        }

        fs.writeFileSync(
          logFile,
          JSON.stringify(
            {
              timestamp: new Date().toISOString(),
              source: 'Yahoo Finance API (v8 chart)',
              lastTickersRequested: tickers,
              history,
              diagnostics: Object.values(history),
            },
            null,
            2
          ),
          'utf-8'
        );
      } catch (logErr) {
        console.error('Failed to write yahoo_last_fetch.json:', logErr);
      }

      // Persist daily cache to disk
      try {
        if (!fs.existsSync(cacheDir)) {
          fs.mkdirSync(cacheDir, { recursive: true });
        }
        fs.writeFileSync(
          cacheFile,
          JSON.stringify({ date: today, prices, lastUpdated: new Date().toISOString() }, null, 2),
          'utf-8'
        );
      } catch (err) {
        console.error('Failed to write daily prices cache:', err);
      }

      const finalPrices: Record<string, number> = {};
      for (const t of tickers) {
        const sym = resolveYahooSymbol(t);
        const base = t.replace(/\.(NZ|AX)$/i, '');
        const p = prices[t] ?? prices[sym] ?? prices[base];
        if (typeof p === 'number') {
          finalPrices[t] = p;
          finalPrices[sym] = p;
          finalPrices[base] = p;
        }
      }

      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          ok: true,
          prices: finalPrices,
          date: today,
          cached: false,
          fetchedCount: missingTickers.length,
          diagnostics,
          logPath: 'data/cache/yahoo_last_fetch.json',
        })
      );
    } catch (err) {
      console.error('[Yahoo Finance] Internal server error in prices middleware:', err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
  };
}

function portfolioAutoBackupPlugin(): Plugin {
  return {
    name: 'portfolio-auto-backup',
    configureServer(server) {
      server.middlewares.use(createPortfolioMiddleware());
      server.middlewares.use(createPricesMiddleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(createPortfolioMiddleware());
      server.middlewares.use(createPricesMiddleware());
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), portfolioAutoBackupPlugin()],
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});

