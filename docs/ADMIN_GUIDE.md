# Administrator & Data Ingestion Guide: Kiwi Portfolio X-Ray

This guide details the periodic operational procedures for sourcing fund disclosures, staging constituent CSVs, resolving mapping anomalies, and publishing static look-through datasets for the Kiwi Portfolio X-Ray.

Run locally using npm run build && npm run preview
Or run the local Admin Console using:
python3 -m pipeline.admin_ui
and then open http://127.0.0.1:8787 in a browser

---

## 1. Upstream Data Sources & Cadence Matrix

The application relies on 4 primary source streams and 2 reference directories. All data is publicly accessible without paid commercial API subscriptions.

| Dataset / Source | Origin / Provider Portal | Staging Target Directory | Format & File Content | Frequency | Purpose |
|---|---|---|---|---|---|
| **Smartshares Direct & Feeder Funds** (`FNZ`, `MDZ`, `NZG`, `OZY`, `ASD`, `TWF`, `USF`, `EUF`, `APA`, `EMF`, `ESG`) | [Sorted Smart Investor](https://smartinvestor.sorted.org.nz) (Search fund → *Download the full portfolio holdings*) | `data/staging/smartshares/` | XLSX (`*.xlsx`): Asset name, % of fund net assets, Cash & payables | Semi-Annual / Quarterly | Direct NZX/ASX holdings and feeder wrapper cash/hedging buffers |
| **Vanguard US Master ETFs** (`VT`, `VOO`, `VGK`, `VPL`, `VWO`) | [Vanguard US Advisor Portal](https://advisors.vanguard.com/investments/products/vt/vanguard-total-world-stock-etf) (*Holdings details* → *Export full holdings*) | `data/staging/vanguard/` | CSV (`Holdings_details_<TICKER_OR_FUND>.csv`): Ticker, Holdings/Name, % of funds, Sub-Industry, Country, SEDOL/CUSIP/ISIN | Monthly (around the 15th) | Underlying global equities for Smartshares feeder wrappers & Global Security Master |
| **iShares (BlackRock) Master ETFs** (`IWLD`, `IVV`) | [BlackRock Australia / US](https://www.blackrock.com/au/products/investment-funds) (Product Holdings CSV) | `data/staging/ishares/` | CSV (`<TICKER>_holdings.csv`): Ticker, Name, Sector, Location, Weight (%) | Monthly / Quarterly | Underlying global equities for Smartshares ESG wrappers |
| **Kernel Wealth Index Funds** (Domestic & Global: `Kernel NZ 50`, `Aus Leaders`, `Global 100`, `World Ex-US`, `Clean Energy`) | [Sorted Smart Investor](https://smartinvestor.sorted.org.nz) (Search fund → *Download the full portfolio holdings*) | `data/staging/kernel/` | XLSX (`*.xlsx`): Asset name, % of fund net assets | Semi-Annual / Quarterly | Constituent holdings for unlisted NZ, AU, and global index funds |
| **NZX Official Directory** | [NZX Main Board Table](https://www.nzx.com/markets/NZSX) *(maintained CSV — no bulk ISIN download on NZX website)* | `data/staging/directories/` | CSV (`nzx_directory.csv`): Rank, Ticker, Company Name, Country, Sector *(or NZX Code, Company Name, ISIN, GICS Sector)* | Quarterly / As needed | Canonical security master for NZX-listed equities (auto-enriched with Vanguard VT ISINs where available) |
| **ASX Official Directory** | [ASX Listed Companies Directory](https://www.asx.com.au/markets/trade-our-cash-market/directory) (*"All ASX Listed Companies .csv"*) | `data/staging/directories/` | CSV (`ASXListedCompanies.csv`): Company name, ASX code, GICS industry group | Quarterly / As needed | Canonical security master for all ASX-listed equities |

---

## 2. Ingestion Staging Directory Layout

Place downloaded candidate files in the local staging folder matching the table above:

```text
data/
└── staging/
    ├── directories/
    │   ├── nzx_directory.csv
    │   └── ASXListedCompanies.csv
    ├── ishares/
    │   └── IWLD_holdings.csv
    ├── kernel/
    │   └── KERNEL-WORLD-EX-US-FUND-FND58860-Full-portfolio-holdings-30-September-2026.xlsx
    ├── smartshares/
    │   ├── SMART-GLOBAL-ESG-ETF-FND14633-Full-portfolio-holdings-30-September-2026.xlsx
    │   └── SMART-NZ-TOP-50-ETF-Full-portfolio-holdings.xlsx
    └── vanguard/
        ├── Holdings_details_Total_World_Stock_ETF.csv
        └── Holdings_details_S&P_500_ETF.csv
```

---

## 3. How Multi-Country Holdings in Funds (like Kernel) are Covered

A key design strength of the ingestion pipeline is that the upstream reference dataset (`security_master.json`) is **not** limited to New Zealand and Australia. 

### Global Security Master Composition:
1. **NZX Official Directory**: ~200 NZ-listed companies (ISIN, Name, Ticker, GICS Sector).
2. **ASX Official Directory**: ~2,200 Australian-listed companies (ISIN, Name, Ticker, GICS Sector).
3. **Vanguard Total World (`VT`) Master Directory**: **~9,840 global equities** spanning over 40 countries (including the US, UK, Japan, Germany, Switzerland, Taiwan, South Korea, China, Scandinavia, etc.), complete with verified 12-character ISINs, country ISO codes, and sector mappings.

### How Kernel's Global & Thematic Funds are Resolved:
* When an unlisted fund like **Kernel S&P World Ex-U.S.**, **Kernel Global Clean Energy**, or **Kernel Global 100** publishes monthly holdings (e.g. Nestlé, ASML, Vestas Wind Systems, Orsted, Samsung, TSMC), their company names and tickers match against the **9,800+ global constituents** already indexed in `security_master.json`.
* **String Normalization**: Corporate legal suffixes (e.g., `A/S`, `AG`, `SA`, `NV`, `Oyj`, `PLC`, `Ltd`) are normalized before fuzzy matching.
* **Residual / Niche Holdings**: If a specialized clean-energy stock is outside Vanguard VT or its name is reported with unusual punctuation by Kernel, the dry-run CLI flags it in `unresolved_entries.json`. The administrator maps it once in `provider_alias_map.json`, and it is permanently resolved for all future months.

---

## 4. The Dry-Run Workflow (First-Time & Routine Runs)

Before committing files or triggering production builds, always run the pipeline locally in **dry-run mode**—either via the Local Admin Web Console or the CLI:

### Option A: Local Admin Web Console (Recommended for CSV Upload & Mapping)
```bash
python3 -m pipeline.admin_ui
```
Open `http://127.0.0.1:8787` in your browser to:
* Drag-and-drop CSV files directly into `data/staging/<provider>/`
* Preview raw CSV headers and test-parse rows with each Tier 1 adapter
* Run `--dry-run` diagnostics and production builds (`public/data/`) with one click
* Search the Global Security Master (`security_master.json`) and save unresolved holdings into `provider_alias_map.json`

### Option B: CLI Dry-Run
```bash
python3 -m pipeline.ingest --dry-run --staging-dir data/staging/
```

### What the Dry-Run Performs:
1. **Schema Check**: Validates that all CSV headers match the expected columns defined in `pipeline/validate/schemas/`.
2. **Master Bypass**: Ingests Vanguard and iShares master files directly, extracting canonical ISINs without running fuzzy matching.
3. **Global Security Master Matching**: Matches Smartshares direct and Kernel (domestic + global) holdings against the 12,000-constituent global `security_master.json`.
4. **Weight Sum Integrity**: Verifies that every fund's constituents sum to $100\% \pm 0.5\%$.
5. **Diagnostics Report**: Outputs a summary directly to the terminal:
   ```text
   ================== INGESTION DRY-RUN REPORT ==================
   [PASS] Schemas validated: 9 / 9 files
   [PASS] Master ETF canonical bypass: VT (9,842), VOO (503)
   [PASS] Feeder unwrapping: TWF -> VT, USF -> VOO
   [PASS] Kernel Global Holdings matched against Global Master: 98.8%
   [WARN] Unresolved holdings detected: 2 items
          - Kernel Clean Energy: "Vestas Wind Systems A/S" (alias needed)
          - Kernel NZ 50: "Chorus Ltd" (no ticker provided)
   [PASS] Weight sum integrity: 100.0% across all 9 funds
   ==============================================================
   ```

---

## 5. Manual Mapping Resolution (`provider_alias_map.json`)

If the dry-run reports unresolved holdings, the CLI outputs formatted JSON snippets ready to copy into `pipeline/enrichment/provider_alias_map.json`.

### Step-by-Step Resolution:
1. Open [`pipeline/enrichment/provider_alias_map.json`](file:///mnt/c/Users/susan/wsl/kiwi-portfolio-xray/pipeline/enrichment/provider_alias_map.json).
2. Add the alias mapping under the specific `Provider:Fund` key using the company's canonical 12-character ISIN:
   ```json
   {
     "Kernel:NZ_50": {
       "Chorus Ltd": "NZCNUE0001S2"
     },
     "Kernel:Clean_Energy": {
       "Vestas Wind Systems A/S": "DK0061539921",
       "Orsted A/S": "DK0060094928"
     },
     "Smartshares:FNZ": {
       "FPH NZ": "NZFPHE0001S2"
     }
   }
   ```
3. Re-run the dry-run command:
   ```bash
   python -m pipeline.ingest --dry-run --staging-dir data/staging/
   ```
4. Confirm `Unresolved holdings: 0 items`.

---

## 6. Publishing to Production

Once the dry-run passes:
1. Run the production compiler:
   ```bash
   python -m pipeline.ingest --staging-dir data/staging/
   ```
   This generates the optimized static assets in `public/data/`:
   * `funds_registry.json`
   * `constituents.json`
   * `direct_equities.json`
   * `unresolved_entries.json`
2. Commit the updated `public/data/` static files and `provider_alias_map.json`:
   ```bash
   git add public/data/ pipeline/enrichment/provider_alias_map.json
   git commit -m "data: update fund constituent holdings for Oct 2026"
   git push origin main
   ```
3. GitHub Actions automatically executes `.github/workflows/deploy.yml` and updates the live GitHub Pages site.

