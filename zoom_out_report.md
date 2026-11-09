# Stage 5: Initial Zoom Out Review Report

**Target Document:** `docs/designs/kiwi-portfolio-xray.md` (Lines 1–692)  
**Standard:** `resources/document_standards/zoom-out-standard.md`  
**Reviewers:** Skeptical Architect (`egm-zoom-out`), Inventive Catalyst (`egm-inventive-catalyst`)

---

## 1. Skeptical Architect Review (`egm-zoom-out`)

### Executive Summary

The proposed architecture correctly identifies the root problem (intransparent feeder fund allocations, multi-fund overlapping concentration, and lack of cross-provider consolidation) and selects an appropriate macro architecture (static GitHub Pages frontend backed by an upstream GitHub Actions compilation pipeline). 

However, the design introduces several significant architectural circularities, speculative external dependencies (YAGNI), unnecessary client-side weight, and premature infrastructure over-engineering that must be simplified.

### Findings

#### Finding 1.1: Circular and Redundant Fuzzy Matching for Master Funds
* **Severity:** **Blocker**
* **Affected Scope:** Section 1.A & 1.D (Lines 111–132, 165–201), Target Files 1, 7, 10 (Lines 453–457, 493–502, 513–520)
* **Simplicity Rationale:**  
  The design routes all constituent records—including the ~9,800 holdings from Vanguard `VT` and thousands from iShares—through `fuzzy_matcher.py` against `security_master.json`. Yet, `security_master.json` is itself compiled from Vanguard `VT`, and Vanguard/iShares disclosure CSVs already contain verified ISIN/CUSIP identifiers, company names, countries, and sectors.
  Stripping canonical metadata in Tier 1 only to execute token-sort Levenshtein fuzzy matching on ~10,000 rows in Tier 2 is computationally wasteful, circular, and introduces matching error risk where none exists.
* **Remedy:** Master ETF constituent adapters (`vanguard_adapter.py`, `ishares_adapter.py`) must directly emit canonical records. The fuzzy matching engine and alias mapping should be strictly reserved for disclosures that genuinely lack ISINs (e.g., Kernel unlisted funds or Smartshares NZ direct lists that only provide local tickers or names).

#### Finding 1.2: Speculative External API Dependency & CI Caching (OpenFIGI API)
* **Severity:** **Major**
* **Affected Scope:** Open Questions (Lines 62–64), Section 1.D.1 (Lines 182–184, 240), Target Files 7 & 9 (Lines 493–512)
* **Simplicity Rationale:**  
  The document incorporates the OpenFIGI API into `build_security_master.py`, which brings external network failure modes, rate-limiting hurdles (flagged in the document's own Open Questions), and the need for persistent Git-tracked cache files (`openfigi_cache.json`).
  This is a classic YAGNI violation. The scope of funds is fixed: Smartshares NZ/AU funds, Smartshares global feeders (wrapping Vanguard/iShares), Kernel index funds, and direct NZX/ASX equities. The NZX official directory, ASX official directory, and Vanguard `VT` directory already cover ~100% of these equities. For the handful of unlisted or ambiguous securities in Kernel funds, the human-editable `provider_alias_map.json` is already specified and completely solves the problem. An external API integration with staging build caches is unnecessary complexity.
* **Remedy:** Eliminate the OpenFIGI API dependency and `openfigi_cache.json`. Use the static official exchange directories and Vanguard VT as primary sources, with manual fallback via `provider_alias_map.json`.

#### Finding 1.3: Heavyweight Client-Side Dependency (`rapidfuzz-wasm` for Autocomplete)
* **Severity:** **Major**
* **Affected Scope:** Target File 31 (`package.json`, Lines 647–652), Section 3.A (Lines 313–315)
* **Simplicity Rationale:**  
  Proposing `rapidfuzz-wasm` or an equivalent WebAssembly fuzzy library for client-side direct equity autocomplete is premature optimization.
  The total universe of NZX (~180) and ASX (~2,200) listed equities is roughly 2,400 items. Modern browser JavaScript engines filter an in-memory array of 2,400 objects using standard `.filter()` and `String.prototype.includes()` or prefix matching in under 2 milliseconds. Pulling in a WebAssembly dependency introduces unnecessary bundle bloat, Vite WASM plugin configuration overhead, and potential Content Security Policy (CSP) headaches on GitHub Pages for zero real-world performance gain.
* **Remedy:** Autocomplete direct equities using standard JavaScript string and token matching over a static JSON lookup list. Drop `rapidfuzz-wasm`.

#### Finding 1.4: Technology Stack Indecision ("React or Svelte TBD")
* **Severity:** **Major**
* **Affected Scope:** Detailed Implementation Plan: Target Files 23–31 (Lines 607–652)
* **Simplicity Rationale:**  
  The design document leaves the frontend framework undecided ("React/Svelte UI component", `src/App.tsx / src/App.svelte`, "framework (React or Svelte — TBD)").
  An architectural design document should establish foundational technology decisions. React and Svelte involve fundamentally divergent reactivity models, build tooling configurations, component lifecycles, and testing stacks. Deferring this decision into the file manifest creates ambiguity across all UI milestones.
* **Remedy:** Commit decisively to one framework (e.g., React + TypeScript + Vite, given its standard ecosystem maturity and charting library compatibility) and standardize all file paths (`.tsx`) and dependencies.

#### Finding 1.5: Over-Engineered Administrator Staging Infrastructure
* **Severity:** **Major**
* **Affected Scope:** Section 5 (Lines 342–360), Target File 18 (Lines 565–569)
* **Simplicity Rationale:**  
  The design specifies a dedicated secondary workflow (`validate_staging.yml`) featuring automated Markdown PR commentary, staging folder routing, and programmatic JSON snippet generation for `provider_alias_map.json`.
  For a static open-source tool, orchestrating multiple GitHub Actions dispatch workflows with automated bot PR commenting is speculative infrastructure. A simple local CLI flag (`python -m pipeline.ingest --dry-run`) combined with standard pull request CI tests (`pytest` and schema validation) provides immediate feedback without workflow orchestration complexity.
* **Remedy:** Consolidate validation into a single dry-run execution path. Drop `validate_staging.yml` and automated PR snippet generation.

#### Finding 1.6: Altitude Drop & Excessive Micro-File Decomposition
* **Severity:** **Nit**
* **Affected Scope:** Target Files 14–15, 19–21, 26–28 (Lines 538–547, 576–595, 622–636)
* **Simplicity Rationale:**  
  The implementation plan breaks down simple, tightly related operations into hyper-granular individual files, expanding the plan to 36 distinct files:
  * `microfilter.ts`: isolated for a single post-aggregation threshold check (`weight < 0.0001`).
  * `freshness.ts`: isolated for calculating the `min` and `max` date across held funds.
  * `pipeline/validate/schemas/`: a sprawling directory of separate JSON Schema files for 4–5 CSV formats.
  * Separate tiny presentation components (`FreshnessHeader.tsx`, `LiquidityCard.tsx`, `UnresolvedModal.tsx`).
* **Remedy:** Consolidate `microfilter` and `freshness` logic directly into `lookthrough.ts` (or an adjacent utility), and consolidate validation into simple Pydantic/dataclass models inside `pipeline/validate/`. Keep architectural components cohesive rather than splitting trivial one-line helpers into distinct modules.

#### Finding 1.7: Client Static Asset Redundancy
* **Severity:** **Nit**
* **Affected Scope:** Section 1.F (Lines 272–275), Target File 16 (Lines 548–555)
* **Simplicity Rationale:**  
  The output schema defines `constituents.json` as containing full holding objects `{ isin, name, ticker, country, gics_sector, weight }` repeated across all funds. For Vanguard `VT` alone (~9,800 constituents), duplicating names and sectors will yield an uncompressed file of 1.5–2 MB.
  Because `security_master.json` already contains `{ isin, name, ticker, country, gics_sector }` (and is shipped to the client anyway for direct equity search), `constituents.json` only needs to map `fund_id -> [{ isin, weight }]`.
* **Remedy:** Reference `isin` as a foreign key in `constituents.json` and resolve metadata against `security_master.json` client-side, reducing client JSON payload sizes significantly.

---

## 2. Inventive Catalyst Review (`egm-inventive-catalyst`)

### Findings

#### Finding 2.1: Monolithic Constituent Payload vs. Segmented On-Demand Fetching
* **Severity:** **Major**
* **Affected Scope:** Section 1.F (*Feeder Unwrapping and Output Generation*), Section 2 (*Client-Side Calculation Engine*), and Milestone 1 (File 16: `pipeline/output/build_output.py`)
* **False Compromise:** To achieve zero-server look-through aggregation, the design assumes the client must download and parse a single monolithic `constituents.json` containing the normalized constituent arrays for all tracked funds (including 9,800+ constituents from Vanguard VT/TWF). This forces mobile and low-bandwidth clients to ingest multi-megabyte JSON payloads even if the user holds only one or two compact NZ domestic funds (e.g., `FNZ` with 50 holdings).
* **Proposed Resolution:** **Segmentation** (Pattern 1) combined with **Inversion** (Pattern 5). Split constituent data into a lightweight `funds_registry.json` metadata index (~10 KB) and isolated per-fund constituent files (`public/data/constituents/{fund_id}.json`). Invert client data loading so the browser fetches constituent chunks on demand only for the specific funds the user has allocated capital to.
* **Secondary Liabilities:** Introduces asynchronous network coordination in the UI (handling loading states, partial fetch failures, and offline caching per fund rather than a single atomic startup fetch).

#### Finding 2.2: Global Security Master vs. Extracted Direct Equities Index
* **Severity:** **Major**
* **Affected Scope:** Section 3.A (*Portfolio Input Table — Direct Equities Section*), Section 1.D (*Security Master Enrichment*), Milestone 1 (File 8: `security_master.json`), and Milestone 3 (File 31: `package.json`)
* **False Compromise:** The design specifies that the client-side direct equity autocomplete input is backed by `security_master.json` paired with `rapidfuzz-wasm`. However, `security_master.json` merges ~10,000 global Vanguard VT equities alongside NZX and ASX listings for CI pipeline enrichment. Shipping the entire global security master to the browser client to support direct equity search—which is scoped strictly to NZX and ASX listed equities (CUJ 4)—unnecessarily inflates the client bundle and search heap.
* **Proposed Resolution:** **Extraction / Taking Out** (Pattern 2). Extract a client-optimized `direct_equities_index.json` containing exclusively active NZX and ASX listings (~2,400 securities, ~150 KB uncompressed) during build time. Retain the heavy 12,000+ security master exclusively within the upstream GitHub Actions CI environment.
* **Secondary Liabilities:** The build pipeline must produce and synchronize an additional static distribution asset, and retail users cannot search or input international direct shares (e.g., US stocks) unless deliberately whitelisted into the extracted index.

#### Finding 2.3: Destructive Post-Aggregation Bucketing Destroys Searchability
* **Severity:** **Major**
* **Affected Scope:** Section 2.B (*Post-Aggregation Micro-Holding Consolidation*), Section 3.C (*Virtualized Company Look-Through Table*), and CUJ 2 (*Duplicate Exposure and Overlap Inspection*)
* **False Compromise:** The design assumes that preventing client rendering lag requires permanently discarding positions $<0.01\%$ into an opaque `"Other Micro-Holdings"` bucket prior to table rendering. This destroys searchability and overlap inspection (CUJ 2) for smaller dual-listed or small-cap holdings (e.g., dual-listed companies in broad global wrappers), even though Section 3.C and Milestone 3 (File 25) already mandate a virtualized DOM table (`react-window`/`svelte-virtual`), which naturally bounds DOM node counts to 20–30 visible rows regardless of total array length.
* **Proposed Resolution:** **Dynamics** (Pattern 6) paired with **Beforehand Cushioning** (Pattern 4). Retain all aggregated holdings in the virtualized table's in-memory index. In the default unfiltered table view, collapse micro-holdings ($<0.01\%$) into a single expandable row to eliminate visual clutter, but allow the search filter to dynamically query the complete underlying dataset so searches for any company present in the portfolio resolve accurately.
* **Secondary Liabilities:** Client-side text filtering must scan ~10,000 records on keystrokes (requiring debouncing or simple substring indexing), and the client heap retains all constituent records rather than discarding them after aggregation.

#### Finding 2.4: Unresolved Disclosures Aborting Entire CI Ingestion Pipeline
* **Severity:** **Nit**
* **Affected Scope:** Section 1.D (*Normalization & Fuzzy Matching Engine*), Section 1.F, Section 5 (*Administrator Verification*), and Milestone 1 (File 14: `schema_validator.py`, File 17: `ingest.yml`)
* **False Compromise:** Any unmapped constituent diverted to `unresolved_entries.json` causes the strict constituent weight integrity check ($100\% \pm 0.5\%$) to fail, aborting the monthly automated CI ingestion pipeline (`ingest.yml`) and preventing all valid, unaffected funds from receiving fresh data until an administrator manually commits an override to `provider_alias_map.json`.
* **Proposed Resolution:** **Blessing in Disguise** (Pattern 7) paired with **Beforehand Cushioning** (Pattern 4). Instead of excising unresolved entries from the output, emit them into `constituents.json` as synthetic placeholder holdings (e.g., `isin: "UNRESOLVED_<fund>_<ticker>"`, `gics_sector: "Unclassified"`, `country: "Unknown"`). This preserves the 100% denominator baseline and weight sum integrity, enables automated CI updates to proceed uninterrupted for all other funds, and surfaces the unresolved items directly in the client UI's Unresolved Disclosures Review Modal (File 28).
* **Secondary Liabilities:** UI macro charts (country and sector breakdowns) must render an "Unclassified / Pending Resolution" segment when unmapped holdings are present.

