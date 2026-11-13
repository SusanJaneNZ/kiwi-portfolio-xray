import { defineConfig, Plugin, Connect } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

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

  return async (req, res, next) => {
    if (!req.url?.startsWith('/api/prices')) {
      return next();
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
        .map((t) => t.trim().toUpperCase().replace(/\.NZ$/i, ''))
        .filter(Boolean);

      const today = new Date().toISOString().split('T')[0];

      if (tickers.length === 0) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, prices: {}, date: today, cached: true }));
        return;
      }

      // Read .env for API key
      const envPath = path.join(repoRoot, '.env');
      let apiKey = process.env.NZXPLORER_API_KEY;
      if (!apiKey && fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const match = envContent.match(/^NZXPLORER_API_KEY=["']?([^"'\r\n]+)["']?/m);
        if (match) apiKey = match[1].trim();
      }
      if (apiKey) {
        apiKey = apiKey.replace(/^["']|["']$/g, '').trim();
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

      const missingTickers = tickers.filter((t) => force || typeof prices[t] !== 'number');

      // If all tickers are cached for today and not forced, return cached prices directly (0 API calls!)
      if (missingTickers.length === 0) {
        const filteredPrices: Record<string, number> = {};
        for (const t of tickers) {
          if (typeof prices[t] === 'number') filteredPrices[t] = prices[t];
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, prices: filteredPrices, date: today, cached: true }));
        return;
      }

      if (!apiKey) {
        console.warn('[NZXplorer] Cannot fetch prices: NZXPLORER_API_KEY is not configured in .env');
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'NZXPLORER_API_KEY is not configured in .env' }));
        return;
      }

      const diagnostics: Array<{
        ticker: string;
        url: string;
        status: number;
        statusText: string;
        ok: boolean;
        requestHeaders: Record<string, string>;
        rawResponse: string | null;
        extractedPrice: number | null;
        error?: string | null;
      }> = [];

      const sanitizeSecret = (text: string | null | undefined): string => {
        if (!text) return '';
        if (!apiKey) return text;
        return text.split(apiKey).join('[REDACTED]');
      };

      // Fetch missing tickers from NZXplorer widget/company API
      for (const t of missingTickers) {
        const fetchUrl = `https://nzxplorer.co.nz/api/v1/widgets/price-card?ticker=${encodeURIComponent(t)}`;
        const headersSent = {
          'X-API-Key': '[REDACTED]',
          'User-Agent': 'KiwiPortfolioXRay/1.0',
        };

        console.log(`[NZXplorer] Fetching: ${fetchUrl} (X-API-Key: [CONFIGURED])`);

        try {
          const response = await fetch(fetchUrl, {
            headers: {
              'X-API-Key': apiKey,
              'User-Agent': 'KiwiPortfolioXRay/1.0',
            },
          });

          const rawTextUnsanitized = await response.text();
          const rawText = sanitizeSecret(rawTextUnsanitized);
          console.log(`[NZXplorer] [${t}] Response Status: ${response.status} ${response.statusText}`);
          console.log(`[NZXplorer] [${t}] Raw Body: ${rawText.slice(0, 300)}`);

          let extractedPrice: number | null = null;
          let parsedBody: any = null;
          try {
            parsedBody = JSON.parse(rawTextUnsanitized);
            // Official NZXplorer /api/v1/widgets/price-card schema:
            // { "widget": "price-card", "ticker": "AIR", "name": "...", "price": 0.38, "change_pct": -1.3, ... }
            if (typeof parsedBody?.price === 'number' && Number.isFinite(parsedBody.price) && parsedBody.price > 0) {
              extractedPrice = parsedBody.price;
            }
          } catch {
            // Raw text is not valid JSON
          }

          if (typeof extractedPrice === 'number' && extractedPrice > 0) {
            prices[t] = extractedPrice;
          }

          diagnostics.push({
            ticker: t,
            url: fetchUrl,
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
            requestHeaders: headersSent,
            rawResponse: rawText.slice(0, 1000),
            extractedPrice,
            error: response.ok
              ? extractedPrice === null
                ? 'Response JSON missing numeric "price" attribute'
                : null
              : sanitizeSecret(`HTTP ${response.status}: ${response.statusText}`),
          });

          if (missingTickers.length > 1) {
            await new Promise((r) => setTimeout(r, 200));
          }
        } catch (err) {
          const errMsg = sanitizeSecret(String(err));
          console.error(`[NZXplorer] [${t}] Fetch Error:`, errMsg);
          diagnostics.push({
            ticker: t,
            url: fetchUrl,
            status: 0,
            statusText: 'Network / Fetch Error',
            ok: false,
            requestHeaders: headersSent,
            rawResponse: null,
            extractedPrice: null,
            error: errMsg,
          });
        }
      }

      // Save complete diagnostics to disk in data/cache/nzxplorer_last_fetch.json
      const logFile = path.join(cacheDir, 'nzxplorer_last_fetch.json');
      try {
        if (!fs.existsSync(cacheDir)) {
          fs.mkdirSync(cacheDir, { recursive: true });
        }
        fs.writeFileSync(
          logFile,
          JSON.stringify(
            {
              timestamp: new Date().toISOString(),
              tickersRequested: tickers,
              missingTickers,
              diagnostics,
            },
            null,
            2
          ),
          'utf-8'
        );
      } catch (logErr) {
        console.error('Failed to write nzxplorer_last_fetch.json:', logErr);
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
        if (typeof prices[t] === 'number') finalPrices[t] = prices[t];
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
          logPath: 'data/cache/nzxplorer_last_fetch.json',
        })
      );
    } catch (err) {
      console.error('[NZXplorer] Internal server error in prices middleware:', err);
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

