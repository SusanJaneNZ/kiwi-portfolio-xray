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
    const mainBackupPath = path.join(repoRoot, 'portfolio_backup.json');

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

    if (req.method === 'GET' && req.url === '/api/portfolio/load') {
      fs.promises.readFile(mainBackupPath, 'utf-8')
        .then((content) => {
          const parsed = JSON.parse(content);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ exists: true, state: parsed }));
        })
        .catch(() => {
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

      req.on('end', () => {
        if (tooLarge) return;
        try {
          const parsed = JSON.parse(body);
          fs.promises.writeFile(mainBackupPath, JSON.stringify(parsed, null, 2), 'utf-8')
            .then(() => {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true, file: 'portfolio_backup.json' }));
            })
            .catch((err) => {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, error: String(err) }));
            });
        } catch (err) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/portfolio/backup') {
      fs.promises.access(mainBackupPath)
        .then(async () => {
          const now = new Date();
          const datePart = now.toISOString().split('T')[0];
          const timePart = now.toTimeString().split(' ')[0].replace(/:/g, '');
          const datedName = `portfolio_backup_${datePart}_${timePart}.json`;
          const datedPath = path.join(repoRoot, datedName);
          await fs.promises.copyFile(mainBackupPath, datedPath);

          // Prune older backups keeping max 10 latest files
          try {
            const files = await fs.promises.readdir(repoRoot);
            const backupFiles = files
              .filter((f) => /^portfolio_backup_\d{4}-\d{2}-\d{2}_\d{6}\.json$/.test(f))
              .sort();
            if (backupFiles.length > 10) {
              const toDelete = backupFiles.slice(0, backupFiles.length - 10);
              await Promise.all(toDelete.map((f) => fs.promises.unlink(path.join(repoRoot, f)).catch(() => {})));
            }
          } catch {
            // Ignore prune errors
          }

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, backupFile: datedName }));
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
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'NZXPLORER_API_KEY is not configured in .env' }));
        return;
      }

      // Fetch missing tickers from NZXplorer widget/company API
      for (const t of missingTickers) {
        try {
          const fetchUrl = `https://nzxplorer.co.nz/api/v1/widgets/price-card?ticker=${encodeURIComponent(t)}`;
          const response = await fetch(fetchUrl, {
            headers: {
              'X-API-Key': apiKey,
              'User-Agent': 'KiwiPortfolioXRay/1.0',
            },
          });
          if (response.ok) {
            const data: any = await response.json();
            if (typeof data.price === 'number') {
              prices[t] = data.price;
            }
          }
          if (missingTickers.length > 1) {
            await new Promise((r) => setTimeout(r, 200));
          }
        } catch (err) {
          console.error(`Failed to fetch NZX price for ${t}:`, err);
        }
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
        })
      );
    } catch (err) {
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

