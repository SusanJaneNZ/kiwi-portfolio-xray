# Live price proxy (Cloudflare Worker)

GitHub Pages can't call Yahoo Finance from the browser, so **Update Prices** on the hosted site goes through this free Worker. (On localhost the app uses the built-in `/api/prices` dev server instead and never needs this.)

## One-time deploy

1. Create a free Cloudflare account: https://dash.cloudflare.com/sign-up
2. From this folder:
   ```bash
   cd worker
   npx wrangler login
   npx wrangler deploy
   ```
3. Wrangler prints a URL like `https://kiwi-price-proxy.<your-subdomain>.workers.dev`.
4. In GitHub: **Settings → Secrets and variables → Actions → Variables tab → New repository variable**
   - Name: `PRICE_PROXY_URL`
   - Value: the Worker URL (no trailing slash)
5. Re-run the **Deploy** workflow (push to `main` or *Run workflow*). The site is rebuilt with the URL baked in.

## Test it

```bash
curl "https://kiwi-price-proxy.<your-subdomain>.workers.dev/?tickers=MCY.NZ,BHP.AX"
```
(Browser requests are only accepted from `https://susanjanenz.github.io` and localhost. Plain `curl` has no Origin header and is allowed.)

To try the Worker locally: `npx wrangler dev` (serves on `http://127.0.0.1:8787`), then build the app with `VITE_PRICE_PROXY_URL=http://127.0.0.1:8787`.

## Notes

- Quotes are cached 5 minutes per ticker at the Cloudflare edge.
- Only ticker-like strings are accepted (max 25 per request); the Worker is not an open proxy.
- If you fork the repo to another GitHub Pages URL, add that origin to `ALLOWED_ORIGINS` in `price-proxy.js`.
- Yahoo Finance is an unofficial data source and can rate-limit or change without notice.
