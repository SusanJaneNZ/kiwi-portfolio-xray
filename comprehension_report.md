# Stage 6: Comprehension Test Report

**Target Document:** `docs/designs/kiwi-portfolio-xray.md`  
**FeatureRange:** Lines 1–442  
**DetailedRange:** Lines 443–692  
**Reviewer:** Comprehension Goldfish (`egm-comprehension`)

---

### What this proposes
The Kiwi Portfolio X-Ray proposes a client-side, zero-backend single-page web application hosted on GitHub Pages that provides New Zealand retail investors with a consolidated look-through view of their investments across multiple funds and direct NZX/ASX shareholdings. An upstream Python pipeline running on GitHub Actions periodically ingests disclosures from fund managers and master exchange-traded funds (ETFs), resolves feeder fund structures, normalizes company identifiers to canonical ISINs, maps industry classifications to the 11 standard GICS sectors, and generates static JSON datasets. The in-browser application consumes these static datasets to calculate aggregate company exposures, isolate liquidity reserves (cash and currency hedges), and render interactive stacked country/sector visualizations without sending user financial data to any server.

### How the existing system works, per this document
Fund managers and retail investment platforms in New Zealand currently report investor portfolio holdings only on an isolated, per-fund basis without cross-fund or cross-provider constituent aggregation. Investors who hold multiple funds—such as separate New Zealand and Australian equity funds—cannot see consolidated exposures to dual-listed equities, and funds wrapping offshore master ETFs disclose only the top-level wrapper rather than the thousands of underlying company equities. Holdings data is fragmented across statutory government filings (the Disclose Register), manager CSV exports, and global ETF disclosures using incompatible ticker symbols and conflicting sector classification taxonomies. As this is a proposed greenfield design, no automated software currently unifies these sources for New Zealand retail investors.

---

### Findings

#### Finding 6.1: Unresolved Entries Disconnect Between CI Validation and Client Display
* **Severity**: **Blocker**
* **Affected Scope**: Lines 128–132, 149–152, 194–197, 352, 541, 563–564, 632–636 (Sections 1.A, 5, and Milestone 3, Component 28)
* **Discrepancy Description & Rationale**:
  The document contains a direct structural contradiction regarding how unmatched holdings are handled between CI and the browser:
  1. Lines 352, 541, and 563–564 specify that CI validates constituent weights summing to $100\% \pm 0.5\%$, and on failure or weight sum breach, the workflow exits non-zero without committing output files to production.
  2. Lines 194–197 and 554 state that any holding failing resolution is diverted to `unresolved_entries.json`. If unresolved rows are excluded from `constituents.json`, the remaining resolved weights will fail the $100\% \pm 0.5\%$ integrity check, preventing any deployment.
  3. Conversely, lines 149–152 and 632–636 introduce a client-side UI modal (`UnresolvedModal.tsx`) intended to inform end-users of unresolved holdings in their held funds and prompt them to submit pull requests. If CI aborts on unresolved/missing weights, `unresolved_entries.json` is never committed to GitHub Pages, making this UI state unreachable. The document must clarify whether unresolved entries are included in `constituents.json` with fallback placeholder metadata, or define the exact weight threshold allowed for `unresolved_entries.json` before CI fails a build.

#### Finding 6.2: Unstated Ingestion Source Retrieval Mechanism in Scheduled CI
* **Severity**: **Major**
* **Affected Scope**: Section 1.B (Lines 204–218), Section 5 (Lines 347–349), and Milestone 1 (Lines 453–477, 559–562)
* **Discrepancy Description & Rationale**:
  The document describes parsing logic for five distinct source formats (Vanguard, iShares, Smartshares direct CSVs, Kernel, and Disclose Register filings), but does not state *how* these raw disclosures are acquired during the automated monthly cron job (`0 6 1 * *`). Section 5 (Line 348) describes an administrator manually committing CSV files to `data/staging/`, but Section 1 (Line 158) claims the scheduled pipeline "downloads raw disclosures". It is unstated whether the adapters download files via HTTP/REST endpoints, scrape known file paths, or whether the automated monthly cron assumes disclosures have already been manually committed to the repository.

#### Finding 6.3: Missing Distribution and Sizing Strategy for `security_master.json` on the Client
* **Severity**: **Major**
* **Affected Scope**: Section 3.A (Lines 314–315), Section 1.D (Lines 235–240), and Milestone 1/3 (Lines 503–507, 550–555, 609–610)
* **Discrepancy Description & Rationale**:
  The Direct Equities input section uses an autocomplete search backed by `security_master.json`. However, `security_master.json` is compiled from the Vanguard VT constituent list (~10,000 global equities) plus NZX and ASX directories (Lines 496–501). Line 550 (`build_output.py`) does not publish `security_master.json` into `public/data/`, leaving the client without an identified data path to load it. Furthermore, downloading a 10,000+ entry master directory in the browser conflicts with the stated goal of avoiding memory bottlenecks on mobile devices (Line 33). The design should specify whether a lightweight client-specific subset (e.g., NZX and ASX listings only) is compiled and emitted to `public/data/` for direct share search.

#### Finding 6.4: Direct Equity Currency Conversion and Valuation Prerequisites
* **Severity**: **Major**
* **Affected Scope**: Section 3.A (Lines 314–315) and Section 2.A (Lines 283–287)
* **Discrepancy Description & Rationale**:
  Direct share entry allows searching both NZX and ASX tickers (e.g., `BHP.AX`), but instructs users to enter their holding value as "total NZD holding value". Non-Goals (Line 56) explicitly states that the application provides "No Real-Time or Intraday Pricing", and no FX conversion service or exchange rate feed is defined. The document assumes users will manually look up foreign exchange rates and current share prices to pre-calculate their total NZD position value, but never explicitly documents this workflow prerequisite or clarifies whether ASX share quantities can be entered directly.

#### Finding 6.5: Undefined Acronyms and Technical Nomenclature
* **Severity**: **Nit**
* **Affected Scope**: Lines 31, 41, 115, 239, 240, 456
* **Discrepancy Description & Rationale**:
  Several domain-specific acronyms and industry standards are introduced without definition or external links:
  - **GICS** (Lines 31, 41): Not expanded to *Global Industry Classification Standard* or linked to MSCI/S&P documentation.
  - **ICB** (Lines 31, 239): Introduced as "FTSE ICB" without expansion to *Industry Classification Benchmark*.
  - **CUSIP** (Line 456): Introduced abruptly in `vanguard_adapter.py` (`cusip_or_isin`) without explanation of what a CUSIP is or how it maps to canonical ISINs.
  - **OpenFIGI** (Lines 115, 240, 500): Introduced without specifying whether an API key/token is required or if it relies strictly on unauthenticated tier rate limits.

#### Finding 6.6: Unconfirmed Frontend UI Framework Specification
* **Severity**: **Nit**
* **Affected Scope**: Milestone 3 (Lines 609, 614, 619, 624, 628, 634, 637, 650)
* **Discrepancy Description & Rationale**:
  Throughout Milestone 3 and `package.json`, the design repeatedly hedges between two different component frameworks: "React/Svelte UI component", "`src/App.tsx` / `src/App.svelte`", and "framework (React or Svelte — TBD)". Leaving the framework undecided in an otherwise detailed implementation plan introduces ambiguity for downstream tooling, dependencies (`vite.config.ts`), and unit testing libraries.

