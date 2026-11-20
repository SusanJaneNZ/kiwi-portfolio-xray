# Administrator & Data Ingestion Guide: Kiwi Portfolio X-Ray

This guide details the operational procedures for sourcing fund disclosures, staging constituent files, unwrapping feeder funds, resolving unmapped companies, and publishing static look-through datasets for the Kiwi Portfolio X-Ray.

```bash
# Run the local frontend preview
npm run build && npm run preview

# Run the local Admin Web Console
python3 -m pipeline.admin_ui
# Open http://127.0.0.1:8787 in your browser
```

---

## 1. Operational Overview: Automated Ingestion vs. Manual Master ETF Maintenance

Kiwi Portfolio X-Ray divides portfolio data ingestion into two distinct operational flows:

* **NZ Fund Constituent Disclosures (`.xlsx`) — Automated Ingestion:**  
  Statutory quarterly portfolio filings for New Zealand funds (Smartshares ETFs, Kernel Wealth index funds, and KiwiSaver / managed schemes like Fisher Funds, Milford, Simplicity) are **automatically discovered, downloaded, rolled over on new quarters, and unwrapped** via the NZ Disclose Register / Sorted Smart Investor. The monthly GitHub Actions pipeline (`Upstream Ingestion & Data Compilation`) and Admin Web Console handle these automatically, including slash-stripping URL normalization (`S&P/NZX` → `S&PNZX`) and cleanup of superseded quarterly files.

* **Overseas Master ETFs (`.csv`) — Manual Periodic Maintenance:**  
  Overseas wholesale ETFs issued by Vanguard (US/AU), iShares (BlackRock), and State Street SPDR are not filed on the NZ Disclose Register. When overseas issuers update their holdings, an administrator periodically downloads the latest CSV from their respective portals, drops it into the staging directory (`data/staging/vanguard/`, `data/staging/ishares/`, or `data/staging/spdr/`) via the Admin Web UI, and clicks **`⚡ Publish Datasets (public/data/)`** to unwrap all dependent feeder funds.

---

## 2. Upstream Data Sources & Update Frequency

The application relies on 5 source streams and 2 reference directories. All data is publicly accessible without paid commercial API subscriptions.

| Dataset / Source | Source Portal | Staging Target Directory | Format & File Content | Frequency | Automation Level | Purpose |
|---|---|---|---|---|---|---|
| **NZ Statutory Fund Disclosures**<br>• **Smartshares ETFs & Feeder Funds** (`FNZ`, `NZG`, `TWF`, `USF`, `NGB`, etc.)<br>• **Kernel Wealth Index Funds** (`Kernel NZ 50`, `World Ex-US`, `Global ESG`, etc.)<br>• **KiwiSaver & Managed Funds** (`Fisher Funds`, `Milford`, `Simplicity`, `Generate`, `Booster`, `ANZ`, etc.) | [Sorted Smart Investor](https://smartinvestor.sorted.org.nz)<br>*(Disclose Register)* | `data/staging/smartshares/`<br>`data/staging/kernel/`<br>`data/staging/<manager>/` | XLSX (`*.xlsx`): Statutory asset names, % of net assets, Cash & payables | Quarterly / Semi-Annual | **Automated**<br>(Monthly CI / Bot / Admin UI `📥 Fetch`) | Official statutory quarterly portfolio holdings for all domestic funds, ETFs, and KiwiSaver schemes; ingested and parsed automatically |
| **Vanguard US Master ETFs** (`VT`, `VOO`, `VGK`, `VPL`, `VWO`, `VO`, `VB`) | [Vanguard US Advisor Portal](https://advisors.vanguard.com/investments/products/vt/vanguard-total-world-stock-etf) (*Holdings details* → *Export full holdings*) | `data/staging/vanguard/` | CSV (`Holdings_details_<TICKER_OR_FUND>.csv`): Ticker, Holdings/Name, % of funds, Sub-Industry, Country, SEDOL/CUSIP/ISIN | Monthly (around the 15th) | **Manual Admin Action Required** | Underlying global companies for Smartshares feeder wrappers & Known Companies Register |
| **iShares (BlackRock) Master ETFs** (`IWLD`, `IVV`, `SAEU`, `SASU`) | [BlackRock Australia / US](https://www.blackrock.com/au/products/investment-funds) (Product Holdings CSV) | `data/staging/ishares/` | CSV (`<TICKER>_holdings.csv`): Ticker, Name, Sector, Location, Weight (%) | Monthly / Quarterly | **Manual Admin Action Required** | Underlying global companies for Smartshares ESG wrappers |
| **SPDR (State Street) Master ETFs** (e.g., `SPEM` — SPDR Portfolio Emerging Markets ETF) | [State Street Global Advisors (SSGA) SPEM Portal](https://www.ssga.com/us/en/intermediary/etfs/state-street-spdr-portfolio-emerging-markets-etf-spem) (*Holdings* → *Daily / Export Holdings CSV*) | `data/staging/spdr/` | CSV (`SPEM_holdings.csv`): Ticker, Name, Weight, Sector, Country | Monthly / Quarterly | **Manual Admin Action Required** | Underlying global emerging markets companies for Kernel Emerging Markets feeder wrapper |
| **BetaShares ASX ETFs** (e.g., `ASIA` — [Asia Technology Tigers ETF](https://www.betashares.com.au/fund/asia-technology-tigers-etf/)) | [betashares.com.au](https://www.betashares.com.au/fund/asia-technology-tigers-etf/) (*Holdings & allocation* → *Download CSV*) | `data/staging/betashares/` | CSV (`ASIA_Portfolio_Holdings.csv`): Ticker, Name, Asset Class, Sector, Country, Weight (%) | Monthly / Quarterly | Manual / Semi-Annual | Look-through holdings for ASX-listed BetaShares ETFs (balances entered in NZD) |
| **NZX Official Directory** | [NZX Main Board Table](https://www.nzx.com/markets/NZSX) | `data/staging/directories/` | CSV (`nzx_directory.csv`): Rank, Ticker, Company Name, Country, Sector | Quarterly / As needed | Semi-Annual | Canonical directory for NZX-listed companies (auto-enriched with Vanguard VT ISINs where available) |
| **ASX Official Directory** | [ASX Listed Companies Directory](https://www.asx.com.au/markets/trade-our-cash-market/directory) | `data/staging/directories/` | CSV (`ASXListedCompanies.csv`): Company name, ASX code, GICS industry group | Quarterly / As needed | Semi-Annual | Canonical directory for all ASX-listed companies |

---

## 3. Ingestion Staging Directory Layout

Staged files are organized into subdirectories by Fund Manager or Master ETF Issuer:

```text
data/
└── staging/
    ├── betashares/
    │   └── ASIA_Portfolio_Holdings.csv
    ├── directories/
    │   ├── nzx_directory.csv
    │   └── ASXListedCompanies.csv
    ├── fisher_funds/ (or kiwisaver/)
    │   └── GROWTH-FUND-FND555-Full-portfolio-holdings-30-September-2026.xlsx
    ├── ishares/                        <-- Manual Admin Download from BlackRock
    │   └── IWLD_holdings.csv
    ├── kernel/                         <-- Automated Download from Sorted Smart Investor
    │   └── KERNEL-WORLD-EX-US-FUND-FND58860-Full-portfolio-holdings-30-September-2026.xlsx
    ├── simplicity/                     <-- Automated Download from Sorted Smart Investor
    │   └── SIMPLICITY-GROWTH-FUND-FND1981-Full-portfolio-holdings.xlsx
    ├── smartshares/                    <-- Automated Download from Sorted Smart Investor
    │   ├── SMART-GLOBAL-ESG-ETF-FND14633-Full-portfolio-holdings-30-September-2026.xlsx
    │   └── SMART-NZ-TOP-50-ETF-Full-portfolio-holdings.xlsx
    ├── spdr/                           <-- Manual Admin Download from State Street (SSGA)
    │   └── SPEM_holdings.csv
    └── vanguard/                       <-- Manual Admin Download from Vanguard
        ├── Holdings_details_Total_World_Stock_ETF.csv
        └── Holdings_details_S&P_500_ETF.csv
```

---

## 4. How Multi-Country Holdings (like Kernel & Simplicity) are Mapped & Unwrapped

A key design feature of Kiwi Portfolio X-Ray is that the reference dataset (**Known Companies Register**) is **not** limited to New Zealand and Australia. 

### Known Companies Register Composition:
1. **NZX Official Directory**: ~200 NZ-listed companies (ISIN, Name, Ticker, GICS Sector).
2. **ASX Official Directory**: ~2,200 Australian-listed companies (ISIN, Name, Ticker, GICS Sector).
3. **Vanguard Total World (`VT`) Master Directory**: **~9,840 global companies** spanning over 40 countries (including the US, UK, Japan, Germany, Switzerland, Taiwan, South Korea, China, Scandinavia, etc.), complete with verified SEDOL/ISINs, country ISO codes, and sector mappings.
4. **SPDR & iShares Master ETFs** (`SPEM`, `IWLD`, etc.): Automatically contributes any missing emerging market and overseas companies with verified SEDOLs, local tickers, and countries (expanding the Known Companies Register to **14,680+ companies**). Priority is strictly maintained so Vanguard VT's verified GICS sectors always prevail on overlapping holdings.

### How Multi-Country Equities are Mapped:
* **Direct Matching**: When an unlisted fund like **Kernel S&P World Ex-U.S.**, **Kernel Global Clean Energy**, or **Kernel Global 100** publishes quarterly holdings (e.g. Nestlé, ASML, Vestas Wind Systems, Orsted, Samsung, TSMC), their company names and tickers are mapped directly against the **14,680+ global companies** in the Known Companies Register.
* **String Normalization**: Corporate legal suffixes (e.g., `A/S`, `AG`, `SA`, `NV`, `Oyj`, `PLC`, `Ltd`) are stripped before matching so formatting differences do not prevent a match.
* **Unmapped Holdings & Materiality Bucketing**: If a material equity ($\ge 0.05\%$ weight) is outside the Known Companies Register, the pipeline flags it in `unresolved_entries.json`. Mapping it once in the Admin UI saves a global `"*"` alias in `company_alias_map.json` that automatically applies across all funds and future quarters. Immaterial unmatched rows ($< 0.05\%$ each) are rolled into `OTHER:MINOR_UNMAPPED` (with an automatic warning if a fund's aggregate minor tail exceeds `2.5%`).
* **Bonds, Mortgages, FRNs, Term Deposits & Accounting Rows**: Direct bonds, NZ residential mortgages (`BOND:NZ_RESIDENTIAL_MORTGAGES`), floating-rate notes (`NFIX3FRA`/`BKBM`/`Float`), ABS trusts, bank term deposits, and accounting rows (`Debtors`/`Creditors`/`Capital Call`) are classified upstream via [`bond_normalizer.py`](file:///mnt/c/Users/susan/wsl/kiwi-portfolio-xray/pipeline/enrichment/bond_normalizer.py) and rolled up by institutional issuer ([`issuer_alias_map.json`](file:///mnt/c/Users/susan/wsl/kiwi-portfolio-xray/pipeline/enrichment/issuer_alias_map.json)) without generating false unmapped company entries.

---

## 5. The Dry-Run Workflow (First-Time & Routine Runs)

Before committing files or triggering production builds, always run the pipeline in **dry-run mode**—either via the Local Admin Web Console or the CLI:

### Option A: Local Admin Web Console (Recommended)
```bash
python3 -m pipeline.admin_ui
```
Open `http://127.0.0.1:8787` in your browser to:
* **Managed Fund Catalogue (Panel 5)**: Monitor all registered funds with real-time **Status (`⏳ Awaiting Processing` vs `✔ Processed`)**, **As Of Dates**, constituent counts, and one-click `📥 Fetch` actions. Unprocessed funds are automatically prioritized at the top, followed by oldest disclosure dates first.
* **Filter & Search**: Quickly filter by `All`, `⏳ Awaiting Processing`, `Simplicity`, `Kernel`, `Smartshares`, or `Fisher Funds`, with instant search and one-click `✕` query clearing.
* **Stage Master ETF Files (Panel 1)**: Drag-and-drop downloaded Vanguard, iShares, or SPDR files directly into `data/staging/vanguard/`, `data/staging/ishares/`, or `data/staging/spdr/`.
* **Map Unmapped Companies (Panel 6)**: Search the Known Companies Register and save company mappings into `company_alias_map.json`.
* **Publish Datasets (Header / Panel 3)**: Run `--dry-run` diagnostics and publish production datasets (`public/data/`) with one click via **⚡ Publish Datasets (public/data/)**.

### Option B: CLI Dry-Run
```bash
python3 -m pipeline.ingest --dry-run --staging-dir data/staging/
```

### What the Dry-Run Performs:
1. **Schema Check**: Validates that all CSV/XLSX headers match expected schemas.
2. **Master ETF Bypass**: Ingests Vanguard, iShares, and SPDR master files directly, extracting canonical ISINs without fuzzy matching.
3. **Feeder Unwrapping**: Unwraps all configured Feeder Funds (`TWF`, `USF`, etc.) into their Master ETF company constituents.
4. **Known Companies Register Matching**: Matches direct Smartshares and Kernel holdings against the 14,600+ entry Known Companies Register.
5. **Weight Sum Integrity**: Verifies that every fund's constituents sum to $100\% \pm 0.5\%$.

---

## 6. Diagnosing Awaiting Funds: Step-by-Step Interactive Badges

In **Panel 5 (Managed Fund Catalogue)**, each awaiting fund displays a specific, interactive status link pointing directly to the panel where that action is taken:

| Status Badge Link | Meaning | Click Action / Target Panel |
| :--- | :--- | :--- |
| `⏳ Awaiting Disclosure File ↗` | Statutory `.xlsx` quarterly file is missing from `data/staging/` | Opens **Panel 1: Stage Disclosures**, selects the fund manager's folder, and prompts upload or `📥 Fetch` |
| `⏳ Awaiting Master Fund Mapping ↗` | Fund holds $\ge 75\%$ overseas ETF but is not yet mapped | Opens **Panel 4: Feeder Fund Pairings**, pre-filling Feeder Code and Fund Name for immediate ticker entry |
| `⏳ Awaiting Master Fund Disclosure File ↗` | Feeder fund is mapped, but the Master ETF holdings file (e.g. `IAU`, `VT`, `SPEM`) is missing | Opens **Panel 1: Stage Disclosures**, auto-selecting the Master ETF issuer folder (`vanguard`, `ishares`, or `spdr`) |
| `⏳ Awaiting Master Fund Publish ↗` | Feeder and Master ETF disclosures are both staged and ready | Opens **Panel 3: Pipeline Dry-Run & Publishing Diagnostics**, pulsing the **⚡ Publish Datasets** button |
| `⏳ Awaiting Publish ↗` | Domestic disclosures are staged and ready | Opens **Panel 3: Pipeline Dry-Run & Publishing Diagnostics**, pulsing the **⚡ Publish Datasets** button |

> [!NOTE]
> **Non-Blocking Build Philosophy**: Unmapped constituent companies **never block compilation or dataset publishing**. Any holding not yet linked in the Known Companies Register automatically falls into country `"Unknown"` and sector `"Unclassified"` with its full statutory weight intact. The fund compiles and publishes immediately. **Panel 6 (Unresolved Company Holdings Mapper)** serves as an optional refinement queue for administrators to link unknown entities to canonical ISINs over time without impeding fund releases.

```mermaid
flowchart TD
    Start["Fund in Catalogue (Panel 5)"] --> CheckFile{"Is statutory disclosure file staged in data/staging/<manager>/?"}
    CheckFile -- "No" --> Badge1["'⏳ Awaiting Disclosure File ↗' (Click to open Panel 1 / Fetch)"]
    CheckFile -- "Yes" --> CheckFeeder{"Is the fund a Feeder Fund (holds ≥ 75% overseas ETF)?"}
    CheckFeeder -- "Yes" --> CheckPair{"Is pairing configured in feeder_registry.json?"}
    CheckPair -- "No" --> Badge2["'⏳ Awaiting Master Fund Mapping ↗' (Click to pre-fill Panel 4)"]
    CheckPair -- "Yes" --> CheckMasterFile{"Is Master ETF file staged in data/staging/<master_provider>/?"}
    CheckMasterFile -- "No" --> Badge3["'⏳ Awaiting Master Fund Disclosure File ↗' (Click to open Panel 1)"]
    CheckMasterFile -- "Yes" --> Badge4["'⏳ Awaiting Master Fund Publish ↗' (Click to pulse Publish in Panel 3)"]
    CheckFeeder -- "No (Direct Holdings)" --> Badge5["'⏳ Awaiting Publish ↗' (Click to pulse Publish in Panel 3)"]
    Badge4 & Badge5 --> ActionCompile["⚡ Publish Datasets (public/data/)"]
    ActionCompile --> Done["✔ Processed (Constituent count > 0)"]
    Done -.-> OptionalEnrich["Optional: Refine unmapped entities in Panel 6 (Defaults to Unknown / Unclassified)"]
```

### Stage 1: Constituent Disclosure Download
* **How to tell:** Look at the fund's row in **Panel 5: Managed Fund Catalogue**. Check if a disclosure file and date are listed. Also check if an `.xlsx` file exists in `data/staging/<manager>/`.
* **Action:** Click the `📥 Fetch` button on that fund's row to download the latest statutory disclosure from Sorted Smart Investor. If the fetch succeeds, the file will be saved to `data/staging/` and displayed. If it fails (e.g. fund has no disclosure or network timeout), the error modal displays full debug details.

### Stage 2: Feeder Pairing & Master ETF Staging (Feeder Funds Only)
* **How to tell:** 
  1. **Unconfigured Feeder:** If the fund holds $\ge 75\%$ of an overseas ETF and has not been paired, it will appear in the amber warning box in **Panel 4: Feeder Fund Pairings**.
  2. **Missing Master ETF File:** If the fund is paired in `feeder_registry.json` but the corresponding CSV/XLSX (e.g. `SPEM_holdings.csv` or `VT.csv`) is missing from `data/staging/spdr/`, `data/staging/vanguard/`, or `data/staging/ishares/`, running **Dry Run** will output:
     `Feeder '<FUND_CODE>' disclosure staged, awaiting master ETF '<TICKER>' in data/staging/<provider>/`.
* **Action:**
  1. If unconfigured: Click **Configure** in Panel 4, select the Master ETF Issuer (`Vanguard`, `iShares`, or `SPDR`), enter the Master Ticker (e.g. `SPEM`), and click **Save Pairing**.
  2. If missing file: Download the holdings file from the issuer portal (e.g. SSGA SPEM or Vanguard VT) and drop/upload it into `data/staging/<provider>/` via **Panel 1: Stage Disclosures**.

### Stage 3: Dataset Publishing & Optional Post-Publish Enrichment
* **How to tell:** The `.xlsx` disclosure and any required Master ETF file are both staged. The fund displays `⏳ Awaiting Publish ↗` or `⏳ Awaiting Master Fund Publish ↗`.
* **Action:**
  1. Click the status badge or **⚡ Publish Datasets (public/data/)** in header / Panel 3. The pipeline validates, unwraps feeder holdings, and writes the published look-through records to `public/data/`. The constituent count becomes $> 0$, and the fund's badge updates to `✔ Processed`.
  2. Any unmapped companies automatically fall into country `"Unknown"` and sector `"Unclassified"`. To improve classification granularity whenever time permits, open **Panel 6: Unresolved Company Holdings Mapper**, search the Known Companies Register, and click **Save Alias** to persist the mapping in `company_alias_map.json`. Subsequent publications will pick up the new aliases.

---

## 7. Manual Company Mapping (`company_alias_map.json`)

If the dry-run reports unmapped company holdings, map them in the Admin Web UI (**Panel 6: Unmapped Companies**) or directly in `pipeline/enrichment/company_alias_map.json`:

```json
{
  "Kernel:KERNEL_NZ_50": {
    "Chorus Ltd": "NZCNUE0001S2"
  },
  "Kernel:KERNEL_CLEAN_ENERGY": {
    "Vestas Wind Systems A/S": "DK0061539921",
    "Orsted A/S": "DK0060094928"
  },
  "Smartshares:FNZ": {
    "FPH NZ": "NZFPHE0001S2"
  }
}
```

---

## 8. Configuring a New Feeder Fund Pairing (`feeder_registry.json`)

### When is this needed?
23 standard New Zealand feeder funds are already pre-configured in [`pipeline/feeder_registry.json`](file:///mnt/c/Users/susan/wsl/kiwi-portfolio-xray/pipeline/feeder_registry.json) (including `TWF`/`TWH` $\rightarrow$ `VT`, `USF`/`USE` $\rightarrow$ `VOO`, `EUF` $\rightarrow$ `VGK`, `APA` $\rightarrow$ `VPL`, `EMF` $\rightarrow$ `VWO`, `ESG` $\rightarrow$ `IWLD`, `KERNEL_EMERGING_MARKETS` $\rightarrow$ `SPEM`, and more).

You **only** need to configure a new feeder pairing if a Fund Manager introduces a **new equity wrapper fund** that invests $\ge 75\%$ of its assets into a single overseas Master ETF. Physical commodity/bullion trusts (such as `GLD` / Smart Gold ETF) are automatically bypassed and compile directly without requiring a master ETF file.

### Step-by-Step Procedure:
1. **Check the Feeder Fund's Disclosure:**
   In the Admin Console, preview the fund's Sorted `.xlsx` file to identify the underlying Master ETF it holds (e.g., `Vanguard Total World Stock ETF (VT)` or `SPDR Portfolio Emerging Markets ETF (SPEM)`).
2. **Ensure Master ETF is Staged:**
   Verify that the Master ETF's holdings file (CSV or XLSX) exists in `data/staging/vanguard/`, `data/staging/ishares/`, or `data/staging/spdr/`. If not, download it from Vanguard, BlackRock, or State Street and drop it into the staging folder via the Admin UI (**Panel 1: Stage Disclosures**).
3. **Register the Pairing:**
   In Admin Console **Panel 4: Feeder Fund Pairings**, enter:
   * **Feeder Code** (e.g. `TWH` or `KERNEL_EMERGING_MARKETS`)
   * **Fund Name** (e.g. `Smart Total World (NZD Hedged) ETF` or `Kernel Emerging Markets`)
   * **Master ETF Issuer** (`Vanguard`, `iShares`, or `SPDR`)
   * **Master Ticker** (e.g. `VT` or `SPEM`)
   Click **Save Pairing**.
4. **Run Dry-Run:**
   Confirm that the Feeder Fund unwraps to 100% total weight and shows the Master ETF's underlying company constituents.

---

## 9. Publishing to Production

Once dry-run validation passes with zero critical errors:

```bash
# 1. Validate and publish production datasets into public/data/
python3 -m pipeline.ingest --staging-dir data/staging/ --output-dir public/data/

# 2. Run test suites
npm test
python3 -m unittest discover -s pipeline/tests

# 3. Build frontend bundle
npm run build
```

---

## 10. Crowdsourced Issue Ingestion Bot & Automated CI/CD Workflows

To eliminate the manual bottleneck of administrators individually discovering, cataloging, and registering every KiwiSaver and off-market managed fund in New Zealand, the platform features a crowdsourced submission bot powered by GitHub Actions.

```mermaid
flowchart TD
    User["Retail User (Panel 2: Managed Funds & KiwiSaver)"] -->|"➕ Add Fund & Validate Sorted Link"| UIForm["parseAndValidateFundUrl() (SCH.../OFR.../FND...)"]
    UIForm -->|"🚀 Save & Submit for Ingestion"| GHIssue["Pre-populated GitHub Issue (label: 'new-fund')"]
    GHIssue -->|"Event: issues [opened, labeled]"| BotAction[".github/workflows/fund-request-bot.yml"]
    BotAction -->|"Parse Title / Body / JSON"| Parser["pipeline/automation/process_fund_request.py"]
    Parser -->|"Atomically update & sort"| Catalog["pipeline/fund_catalog.json"]
    BotAction -->|"git commit & push [skip ci]"| MainBranch["Branch: main"]
    BotAction -->|"Add confirmation comment & close"| ClosedIssue["Closed GitHub Issue"]
    BotAction -->|"gh workflow run (or monthly cron)"| IngestAction[".github/workflows/ingest.yml"]
    IngestAction -->|"python -m pipeline.ingest --fetch"| Compile["Fetch Disclose .xlsx & compile to public/data/"]
    Compile -->|"Deploy update"| GitHubPages["Production Web App"]
```

### A. How the Automated Flow Operates

1. **Client-Side Request Submission:**
   - In **Panel 2 (Managed Funds & KiwiSaver)**, the user enters a Sorted Smart Investor link or Disclose `.xlsx` URL.
   - The UI parses and validates the link in real time (`parseAndValidateFundUrl`) and unlocks **"🚀 Save & Submit for Ingestion"**.
   - Clicking this opens a pre-formatted GitHub issue on the repository with:
     - Issue Title: `[Fund Request] <Fund Name>`
     - Labels: `new-fund`
     - Markdown bullet summary (`Fund Name`, `Fund Manager`, `Fund Code`, `Smart Investor Link`, `Scheme ID`, `Offer ID`, `Fund ID`, `Is KiwiSaver`)
     - An embedded, machine-readable JSON code block containing verified metadata.
   - *In the meantime, the user's browser immediately models the fund using the synthetic 80% Growth Equities / 20% Bonds look-through fallback so their portfolio balance and asset class split remain 100% accurate without waiting.*

2. **Automated Issue Processing:**
   - The GitHub Action `.github/workflows/fund-request-bot.yml` (**Process Crowdsourced Fund Requests**) activates on `issues: [opened, labeled]` when `labels contains 'new-fund'`.
   - It executes `python pipeline/automation/process_fund_request.py` using the issue title and body environment variables.
   - The parser checks for JSON blocks, falls back to markdown lines and URLs, verifies that a valid `FND...` code exists, and safely adds or updates the entry in `pipeline/fund_catalog.json`.
   - The action commits `pipeline/fund_catalog.json` directly to `main` (`chore(catalog): add fund from issue #<number> [skip ci]`).
   - The bot posts an automated markdown comment acknowledging the addition, closes the issue, and triggers `.github/workflows/ingest.yml` via `gh workflow run ingest.yml`.

3. **Downstream Ingestion & Production Compilation:**
   - `.github/workflows/ingest.yml` (**Upstream Ingestion & Data Compilation**) runs via monthly scheduled cron (`0 6 1 * *`), manual `workflow_dispatch`, or `gh workflow run` triggered by the bot.
   - It runs `python -m pipeline.ingest --fetch --staging-dir data/staging --output-dir public/data`.
   - `GenericDomesticAdapter` dynamically compiles and unwraps the newly added fund's quarterly holdings into `public/data/funds_registry.json` and `constituents.json`.
   - Once published, any user who holds that fund automatically sees full line-item company look-through instead of the synthetic fallback!

---

### B. Administrator Monitoring: How to Check Bot & Ingestion Runs

Administrators can monitor the health of automated fund processing via standard GitHub interfaces:

1. **Viewing Active and Past Ingestion Runs:**
   - Go to your repository on GitHub: `https://github.com/<owner>/kiwi-portfolio-xray/actions`.
   - Check the two relevant workflows:
     - **Process Crowdsourced Fund Requests** (`.github/workflows/fund-request-bot.yml`): Runs on issue submission. Typical execution time: ~15–30 seconds.
     - **Upstream Ingestion & Data Compilation** (`.github/workflows/ingest.yml`): Runs monthly (1st of each month), via manual trigger, or when triggered by the bot. Typical execution time: ~1–3 minutes.
   - A green checkmark (✓) indicates successful metadata extraction, catalog commit, and ingestion.

2. **Tracking User Fund Requests:**
   - Navigate to the **Issues** tab (`/issues?q=label%3Anew-fund`).
   - **Closed issues**: Successfully processed by the bot with an automated confirmation comment.
   - **Open issues**: Either awaiting bot execution, manually submitted without the `new-fund` label, or encountered a validation error.

---

### C. Troubleshooting Runbook: What to Do When Failures Occur

GitHub sends automated email notifications to administrators when an Action fails (e.g., *"Run failed: Fund Request Ingestion Bot"*). Follow this guide to diagnose and resolve failures rapidly:

#### Scenario 1: Bot Fails with "Validation Error: Could not detect valid FND code"
* **Symptom:** The action fails on the step `Process Fund Request` with exit code 1. The issue remains open without an automated comment.
* **Root Cause:** A user manually opened an issue or modified the issue template, leaving out the Disclose Fund ID (`FND...`) or Sorted Smart Investor link.
* **Resolution:**
  1. Open the failed GitHub Issue.
  2. Search for the scheme on [Sorted Smart Investor](https://smartinvestor.sorted.org.nz) to obtain its canonical URL (e.g., `https://www.smartinvestor.sorted.org.nz/kiwisaver-and-managed-funds/SCH10713/OFR10715/FND555/`).
  3. Edit the issue body to include `- **Smart Investor Link:** <URL>` and the embedded JSON block.
  4. In the issue sidebar, remove the `new-fund` label and re-add `new-fund`. The bot will trigger immediately and process the fund.

#### Scenario 2: Upstream Smart Investor / Disclose Register Fetch Failure (HTTP 404 / 503 / Rate Limit)
* **Symptom:** In `.github/workflows/ingest.yml`, the step `Run Ingestion Pipeline` reports an HTTP error downloading disclosures from `smartinvestor.sorted.org.nz` or `disclose-register.companiesoffice.govt.nz`.
* **Root Cause:** Sorted or Disclose Register is undergoing temporary maintenance or rate-limiting.
* **Protection Built into Architecture:**
  - During fetching, `SmartInvestorFetcher` retains existing staged files on HTTP errors so temporary outages never wipe cached disclosures.
  - During compilation, `PipelineCompiler.compile()` enforces a **circuit breaker**: if a staged file is corrupt or fails schema validation, `validation_report.is_valid` is set to `False` and production writes to `public/data/` are aborted (unless `--force` is explicitly passed) so corrupted datasets never overwrite production.
  - The front-end automatically retains the synthetic 80/20 look-through fallback for un-ingested funds.
* **Resolution:**
  1. Check if Sorted Smart Investor is accessible in a web browser.
  2. Once the upstream site is back online, navigate to **Actions** → **Upstream Ingestion & Data Compilation** → click **Run workflow** (`workflow_dispatch`).
  3. The pipeline will retry the download, update `public/data/`, and push changes to `main`.

#### Scenario 3: Unmapped Holdings or Schema Mismatch in a Newly Ingested Fund
* **Symptom:** The ingestion pipeline succeeds, but `unresolved_entries.json` contains unmapped company names, or a fund manager uses non-standard column headers.
* **Resolution:**
  1. Pull the latest `main` branch locally: `git pull origin main`.
  2. Launch the local Admin Console:
     ```bash
     python3 -m pipeline.admin_ui
     ```
  3. Open `http://127.0.0.1:8787` in your browser.
  4. View the unmapped item in **Panel 6: Unmapped Companies**, search the Known Companies Register for the company's canonical ISIN, and click **Save Alias**.
  5. Click **⚡ Publish Datasets (public/data/)**.
  6. Commit and push the updated alias map:
     ```bash
     git add pipeline/enrichment/company_alias_map.json public/data/
     git commit -m "fix(mapping): add company alias for <fund_code>"
     git push origin main
     ```

#### Scenario 4: Git Concurrency Conflict / Non-Fast-Forward Push
* **Symptom:** The bot fails at step `Commit and Push Catalogue Update` with `error: failed to push some refs to ... (fetch first)`.
* **Root Cause:** Two users submitted fund requests at the exact same second, or an administrator pushed a commit while the bot was executing.
* **Resolution:**
  1. Re-trigger the failed workflow from the GitHub Actions run page by clicking **Re-run all jobs**.
  2. The action will fetch the fresh `main` branch and cleanly append the entry.

---

## 11. System Concepts & Architecture Glossary

This glossary defines the authoritative naming conventions for Kiwi Portfolio X-Ray, establishing a clear reference for all terminology across the documentation and administrative tooling:

| Canonical Term | What It Means | Examples |
|---|---|---|
| **Fund Manager** *(or Scheme Issuer)* | The New Zealand financial institution issuing and managing the fund for Kiwi investors. Files statutory quarterly disclosures on the Disclose Register. | Kernel Wealth, Smartshares, Fisher Funds, Simplicity, Milford. |
| **Fund** | The investment product held by an investor. Can be a **Listed ETF** (traded on NZX) or an **Unlisted Managed Fund / KiwiSaver Scheme** (priced at NAV). | Smartshares US 500 (`USF`), Kernel S&P 500 (`KERNEL_SP_500_UNHEDGED`), Fisher Growth KiwiSaver. |
| **Constituent Disclosure (`.xlsx`)** | The statutory quarterly portfolio disclosure published to Sorted Smart Investor under NZ law, containing asset names, percentages, cash, and receivables. | `KERNEL_GLOBAL_DIVIDEND_FND19302_2026-09-30.xlsx` |
| **Direct Holding** | An individual **Company share**, **Bond**, or **Cash deposit** held directly by the Fund Manager. | Infratil, Apple, Microsoft, Spark, NZ Government Bond, ANZ Cash. |
| **Feeder Fund** *(Wrapper Fund)* | A New Zealand fund that does not buy individual stocks directly; instead, it invests **$\ge 75\%$** of its portfolio into a single overseas wholesale Master ETF. | Smartshares Total World (`TWF`, holding 99.8% Vanguard `VT`), Smartshares US 500 (`USF`, holding 99.8% Vanguard `VOO`). |
| **Master ETF** *(Wholesale Target)* | The massive overseas ETF (issued by Vanguard US/AU, iShares / BlackRock, or State Street SPDR) that holds the actual thousands of underlying companies. | Vanguard Total World (`VT`), Vanguard S&P 500 (`VOO`), iShares Global ESG (`IWLD`), SPDR Portfolio Emerging Markets (`SPEM`). |
| **Feeder Unwrapping** | The pipeline process of replacing a single Feeder Fund line item with the Master ETF's thousands of underlying companies, scaled to the feeder's portfolio weight. | `TWF` $\rightarrow$ Vanguard `VT` $\rightarrow$ 9,800+ underlying global companies; `KERNEL_EMERGING_MARKETS` $\rightarrow$ SPDR `SPEM` $\rightarrow$ 3,000+ emerging market companies. |
| **Minor Fund Holding** | A fund constituent holding that represents **$< 75\%$** of a portfolio (e.g. a multi-asset balanced fund allocating 5% to an emerging markets fund). Modeled by broad asset class rather than wholesale unwrapping. | 4% allocation to an international bond fund inside a balanced fund. |
| **Known Companies Register** *(formerly Security Master)* | The master reference dictionary of ~14,600+ public companies globally, providing canonical ISIN, Ticker, Company Name, GICS Sector, and Country. | Built from: NZX Directory + ASX Directory + Vanguard Total World (`VT`) + SPDR (`SPEM`) + iShares (`IWLD`). |
| **Manual Company Mapping** *(formerly Provider Alias Map)* | A mapping table (`company_alias_map.json`) configured in the Admin UI that links non-standard company names or unlisted assets to their canonical ISIN in the Known Companies Register. | Mapping `"Arm Holdings plc ADR"` $\rightarrow$ `US0420682058`. |

