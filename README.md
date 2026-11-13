# Kiwi Portfolio X-Ray

A static, browser-based portfolio look-through analyzer hosted on GitHub Pages for New Zealand retail investors holding portfolios across NZX Smartshares ETFs, Kernel unlisted index funds, bank term deposits, and direct NZX/ASX shares.

## Documentation

* **Technical Design Document:** [docs/designs/kiwi-portfolio-xray.md](docs/designs/kiwi-portfolio-xray.md)
* **Asset Split, Bond Funds & Bucket Rebalancer Spec:** [docs/designs/asset-split-bonds-tds.md](docs/designs/asset-split-bonds-tds.md)
* **Design Sitemap:** [docs/designs/SITEMAP.md](docs/designs/SITEMAP.md)
* **Administrator & Ingestion Guide:** [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md)
* **Initial Concept Brief:** [concepts_brief.md](concepts_brief.md)

## Key Capabilities

* **Recursive Feeder Fund Unwrapping:** Unpacks feeder funds (e.g. Smartshares `TWF`, `USF`, `EUF`, `APA`, `ESG`, `EMF`) to their underlying master ETF holdings (Vanguard `VT`, `VOO`, `VGK`, `VPL`, iShares `IWLD`).
* **Multi-Fund Aggregation:** Consolidates overlapping company equities across multiple funds and managers using ISO 6166 ISIN canonical keys.
* **Direct NZX / ASX Holdings & Live FX:** Incorporates direct shareholdings (e.g. Mercury, Fisher & Paykel Healthcare, BHP, CSL) with per-holding NZD/AUD currency selection and automatic live AUD/NZD rate lookup with manual override.
* **Asset Class Split & Multi-Asset Funds:** Decomposes bond and balanced/conservative funds row-by-row into true underlying Equities, Fixed Interest, Term Deposits, and Cash reserves, rendering a 5-segment Asset Split bar and Growth vs. Defensive ratio.
* **Cross-Asset Institutional Concentration:** Rolls up combined exposure across equities, bonds, and bank deposits by institution (e.g., ANZ, ASB, Westpac).
* **Semi-Annual Bucket Rebalancer:** User-defined portfolio buckets (e.g., Term Deposits, High Dividend Yield, Growth) with minimum-turnover withdrawal planning and exact cent buy/sell rebalancing.
* **Continuous Background Persistence:** All holdings, term deposits, and buckets automatically persist to a local repo backup file (`portfolio_backup.json`, git-ignored), browser `localStorage`, and IndexedDB, with automated safety backups created before destructive operations.
* **GICS Sector Normalization:** Standardizes disparate provider taxonomies into the 11 GICS Level 1 sectors.
* **Zero Backend:** Runs entirely client-side on GitHub Pages with local browser storage and JSON/CSV export/import.
