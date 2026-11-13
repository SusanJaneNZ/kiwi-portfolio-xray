import { defineConfig, Plugin, Connect } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

function createPortfolioMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (!req.url?.startsWith('/api/portfolio/')) {
      return next();
    }

    const repoRoot = process.cwd();
    const mainBackupPath = path.join(repoRoot, 'portfolio_backup.json');

    if (req.method === 'GET' && req.url === '/api/portfolio/load') {
      if (fs.existsSync(mainBackupPath)) {
        try {
          const content = fs.readFileSync(mainBackupPath, 'utf-8');
          const parsed = JSON.parse(content);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ exists: true, state: parsed }));
          return;
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ exists: false, error: String(err) }));
          return;
        }
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ exists: false }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/portfolio/save') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          fs.writeFileSync(mainBackupPath, JSON.stringify(parsed, null, 2), 'utf-8');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, file: 'portfolio_backup.json' }));
        } catch (err) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/portfolio/backup') {
      if (fs.existsSync(mainBackupPath)) {
        try {
          const now = new Date();
          const datePart = now.toISOString().split('T')[0];
          const timePart = now.toTimeString().split(' ')[0].replace(/:/g, '');
          const datedName = `portfolio_backup_${datePart}_${timePart}.json`;
          const datedPath = path.join(repoRoot, datedName);
          fs.copyFileSync(mainBackupPath, datedPath);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, backupFile: datedName }));
          return;
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: String(err) }));
          return;
        }
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, backupFile: null }));
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

