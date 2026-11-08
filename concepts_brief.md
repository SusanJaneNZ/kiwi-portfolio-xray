# Kiwi Portfolio X-Ray

* **Author:** SusanJaneNZ
* **Date:** 2026-11-08

## Overview

A static, browser-based portfolio look-through analyzer hosted on GitHub Pages for New Zealand retail investors holding portfolios across NZX Smartshares ETFs, Kernel unlisted index funds, and direct NZX/ASX shares.

Users enter their portfolio allocations in New Zealand Dollars, which are saved in local browser storage. The application unpacks wrapper funds, aggregates overlapping equity holdings, reconciles duplicate company exposures across funds, segregates non-equity assets (cash buffers and currency hedging contracts), and visualizes the portfolio's underlying company holdings, sector allocations by country, and country allocations by sector.

## Analysis

### 1. Feeder Fund Recursion & Upstream Formats
Smartshares global equity funds (e.g., Total World `TWF`, US 500 `USF`) are feeder funds wrapping overseas Vanguard ETFs (e.g., `VT`, `VOO`). Statutory New Zealand filings report the wrapper asset as a single line item.
* **Resolution:** An upstream build-time pipeline in GitHub Actions unpacks feeder funds into their underlying master holdings and scales weights proportionally.
* **Format Ingestion:** The build system supports approximately 5 distinct constituent source formats:
  1. Smartshares direct NZ/AU statutory holdings exports.
  2. Smartshares wrapper fund statutory filings (Disclose Register).
  3. Vanguard US master fund constituent CSVs (for `VT`, `VOO`, `VWO`).
  4. Kernel unlisted fund portfolio exports.
  5. Canonical override/alias mapping table.

### 2. Entity Identification & Canonical Primary Key
* **ISIN Primary Key with Fallback Mapping:** Unique 12-character ISINs (ISO 6166) serve as the primary key across exchanges to eliminate ticker collisions (e.g., distinguishing identical ticker codes across NZX, ASX, and US markets, and linking dual-listed stocks like Fisher & Paykel Healthcare `NZX:FPH` / `ASX:FPH`).
* Where fund disclosures provide ISINs directly (Disclose Register and Vanguard), they are ingested automatically. Where disclosures list only local exchange codes or company names, the build pipeline cross-references a static build-time alias dictionary (`provider_alias_map.json`) to resolve the canonical ISIN.

### 3. Sector Taxonomy Normalization
* **GICS Sector Standard:** Incompatible classification schemes across fund managers (e.g., Kernel using S&P GICS versus Vanguard using FTSE ICB) are normalized into the standard 11 GICS Level 1 sectors: *Energy, Materials, Industrials, Consumer Discretionary, Consumer Staples, Health Care, Financials, Information Technology, Communication Services, Utilities, Real Estate*.
* **Licensing & Usage:** High-level GICS sector names and definitions are standard public industry terminology used across financial reporting and open-source tools without licensing fees. Sector assignments are extracted directly from public fund disclosures and normalized upstream.

### 4. Denominator Integrity & Asset Segregation
* **Preserving the $100\%$ Base:** All calculations preserve total invested NZD capital as the base denominator.
* **Liquidity & Hedging:** Funds hold 0.2%–2.5% in cash reserves, and hedged funds hold foreign exchange forward contracts. These are segregated into a dedicated "Bonds, Cash and Other" liquidity summary card rather than discarding them or artificially inflating equity percentages.
* **User Toggle:** Look-through tables support viewing allocations both as **"% of Total Portfolio"** (inclusive of cash/bonds) and **"% of Equities"**.

### 5. Micro-Holdings Filtering Post-Aggregation
* Broad global index funds (such as Vanguard `VT`) contain thousands of positions under $0.01\%$.
* Filtering is applied **strictly post-aggregation**. Holdings that represent $<0.01\%$ across the combined portfolio are bucketed into an `"Other Micro-Holdings"` summary entry.
* Macro country and sector classifications for micro-holdings are preserved so macro allocation totals remain mathematically exact.

### 6. Pragmatic Persistence & Data Portability
* User fund balances are saved locally in browser `LocalStorage` with a minimal schema version tag.
* A single-click **Export Portfolio (JSON / CSV)** and **Import Portfolio** feature provides cross-device portability and user backup without requiring cloud accounts or remote database infrastructure.

### 7. Visualizations: Subcategory Stacked Bar Charts
* User testing and prototype validation confirm that horizontal stacked bar charts with country subcategories within sectors (and sector subcategories within countries) provide the exact visual density and analytical depth desired.
* Interactive tooltips display precise dollar amounts and percentages on segment hover, accompanied by an explicit legend and consistent country/sector color palettes.

## Goals vs. Non-Goals

### In-Scope Goals
* **Client-Side Analytical Engine:** Static single-page application executing weighted matrix multiplication of user fund balances against pre-compiled canonical JSON holdings.
* **Build-Time Ingestion Pipeline:** GitHub Actions workflow normalizing ~5 provider disclosure formats, unpacking feeder funds, and generating lean static JSON files.
* **Look-Through Table:** Searchable, sortable table of consolidated company holdings showing total value, portfolio percentage, and underlying fund contribution breakdown.
* **Stacked Subcategory Bar Charts:**
  * Sector exposure bar chart broken down by Country.
  * Country exposure bar chart broken down by Sector.
  * Dedicated "Bonds, Cash and Other" asset view.
* **LocalStorage & Backup:** In-browser input persistence with local JSON/CSV export and import.

### Out-of-Scope Non-Goals
* **No Server Backend or Remote Database:** Zero user authentication, server-side APIs, or cloud hosting costs.
* **No Direct-Indexing or Trade Execution (Phase 1):** No automated trade sizing, broker integration, or order execution for replicating indices directly (deferred due to retail transaction fees and tax complexity).
* **No Tax Calculations:** No Foreign Investment Fund (FIF) calculations (FDR/CV) or dividend imputation credit tracking.

## Alternatives Weighed

* **In-Browser Raw CSV Parsing (Rejected by author & review):** Parsing large raw CSVs (e.g. 9,800+ rows for Vanguard `VT`) in browser memory causes UI freezing and mobile browser crashes. Replaced by build-time pre-compilation into lean static JSON.
* **Flattening Subcategory Charts to Simple Independent Bars (Rejected by author):** Author prototype demonstrated that horizontal stacked bar charts displaying country subcategories within sectors are clear, functional, and meet user requirements without excessive visual confusion.
* **Shared Google Sheets MVP (Rejected):** Cannot handle multi-tier recursive look-through across thousands of constituents from multiple fund managers without reaching performance limits.
* **Direct Indexing Execution Engine (Deferred):** Self-managing indices directly by purchasing 20–50 shares was set aside for future evaluation; brokerage costs and tax administration outweigh management fee savings at typical retail investment amounts.

## Key Decisions & Staging for Next Steps

1. **Architecture:** Static web application (Vite + TypeScript / Svelte or React) hosted on GitHub Pages.
2. **Build Tooling:** Python or Node.js pre-processing scripts running in GitHub Actions to parse the ~5 CSV source formats, resolve feeder funds, and commit optimized `funds.json` and `constituents.json` artifacts.
3. **Primary Key:** ISIN for all equity constituents, with build-time alias lookup for disclosures lacking native ISINs.
4. **Visualizations:** Horizontal stacked bar charts matching the prototype layout with tooltips, plus a virtualized table for underlying stock holdings.
5. **Implementation Staging:**
   * **Milestone 1:** Upstream Ingestion & CI Normalization Pipeline (handling the ~5 provider CSV schemas, feeder fund unpacking, ISIN resolution, and GICS taxonomy mapping).
   * **Milestone 2:** Calculation Engine & Local Storage Adapter (weighted look-through calculations, post-aggregation micro-holding bucketing, and import/export).
   * **Milestone 3:** UI & Visualization Implementation (portfolio input table, stacked horizontal bar charts matching prototype, and expandable company look-through table).
   * **Milestone 4:** GitHub Actions deployment workflow to GitHub Pages and automated data integrity tests.
