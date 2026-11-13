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

function portfolioAutoBackupPlugin(): Plugin {
  return {
    name: 'portfolio-auto-backup',
    configureServer(server) {
      server.middlewares.use(createPortfolioMiddleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(createPortfolioMiddleware());
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

