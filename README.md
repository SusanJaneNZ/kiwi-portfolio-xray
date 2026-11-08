# Kiwi Portfolio X-Ray

A static, browser-based portfolio look-through analyzer hosted on GitHub Pages for New Zealand retail investors holding portfolios across NZX Smartshares ETFs, Kernel unlisted index funds, and direct NZX/ASX shares.

## Documentation

* **Technical Design Document:** [docs/designs/kiwi-portfolio-xray.md](docs/designs/kiwi-portfolio-xray.md)
* **Design Sitemap:** [docs/designs/SITEMAP.md](docs/designs/SITEMAP.md)
* **Initial Concept Brief:** [concepts_brief.md](concepts_brief.md)

## Key Capabilities

* **Recursive Feeder Fund Unwrapping:** Unpacks feeder funds (e.g. Smartshares `TWF`, `USF`, `EUF`, `APA`, `ESG`) to their underlying master ETF holdings (Vanguard `VT`, `VOO`, `VGK`, `VPL`, iShares `IWLD`).
* **Multi-Fund Aggregation:** Consolidates overlapping company equities across multiple funds and managers using ISO 6166 ISIN canonical keys.
* **Direct NZX / ASX Holdings:** Incorporates direct shareholdings (e.g. Mercury, Fisher & Paykel Healthcare, BHP) seamlessly alongside fund investments.
* **GICS Sector Normalization:** Standardizes disparate provider taxonomies into the 11 GICS Level 1 sectors.
* **Liquidity & Hedging Segregation:** Maintains 100% portfolio base denominator integrity while isolating cash reserves and FX hedging contracts.
* **Subcategory Visualizations:** Interactive horizontal stacked bar charts (Sectors by Country, Countries by Sector) and a virtualized company look-through table.
* **Zero Backend:** Runs entirely client-side on GitHub Pages with local browser storage and JSON/CSV export/import.

