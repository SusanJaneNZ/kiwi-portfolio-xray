# Goldfish Annotated Review Report

**Target:** `docs/designs/kiwi-portfolio-xray.md` (full file, Lines 1–692)  
**Status:** resolved (Approved by Author)  

## Prioritized Findings & AI Suggestions

### B1 [Implementation Readiness & Codebase Details] - Severity: Blocker
* **Affected Scope:** Lines 607–651 ([`src/components/*.tsx`](file:///mnt/c/Users/susan/wsl/kiwi-portfolio-xray/docs/designs/kiwi-portfolio-xray.md#L607-L635), [`package.json`](file:///mnt/c/Users/susan/wsl/kiwi-portfolio-xray/docs/designs/kiwi-portfolio-xray.md#L647-L651))
* **Discrepancy Description:** The specification contains explicit TBDs and architectural indecision regarding the frontend stack ("React or Svelte — TBD", `src/App.tsx / src/App.svelte`, "D3 or similar", "rapidfuzz-wasm or equivalent").
* **Rationale:** Violates the Zero-Decision Rule. An implementer cannot write components without making fundamental architectural decisions.
* **AI Suggestion:** **PROPOSE FIX**
* **Justification:** Committing decisively to React 18+ with TypeScript, Vite, native SVG / D3 charting, and native JavaScript search resolves all ambiguity.
* **Proposed Edit:**
  * Location: Detailed Implementation Plan, Items 23–31 (Milestone 3)
  * Change: Standardize all components to React 18+ (`.tsx`), specify Vite + React + TypeScript, remove Svelte alternatives, specify native SVG/D3 for charts, and specify native JS token search in `package.json`.

---

### B2 [Codebase Details] - Severity: Blocker
* **Affected Scope:** Milestone 3 (Lines 607–651)
* **Discrepancy Description:** Omission of web application root entry points (`index.html` and `src/main.tsx`).
* **Rationale:** Without `index.html` and `src/main.tsx`, Vite cannot build or serve the application.
* **AI Suggestion:** **PROPOSE FIX**
* **Justification:** Standard web application files must be explicitly declared in the implementation plan.
* **Proposed Edit:**
  * Location: Milestone 3 File Manifest
  * Change: Add `index.html` (Vite HTML root with `<div id="root"></div>`) and `src/main.tsx` (React DOM mount entry point) as explicit files to create.

---

### B3 [Implementation Readiness & Codebase Details] - Severity: Blocker
* **Affected Scope:** Milestone 1 (Lines 445–569)
* **Discrepancy Description:** Missing Python dependency manifest (`requirements.txt` or `pyproject.toml`).
* **Rationale:** The pipeline relies on third-party libraries (`rapidfuzz`, `requests`, `pytest`, `ruff`), but no dependency manifest is declared in the file manifest.
* **AI Suggestion:** **PROPOSE FIX**
* **Justification:** Pipeline dependencies must be pinned and reproducible in CI.
* **Proposed Edit:**
  * Location: Milestone 1 File Manifest
  * Change: Add `requirements.txt` (`rapidfuzz>=3.0.0`, `requests>=2.31.0`) and `requirements-dev.txt` (`pytest>=8.0.0`, `ruff>=0.3.0`) for Python 3.11+.

---

### B4 [Design Critic & Structural Validator] - Severity: Blocker
* **Affected Scope:** Document Root (between lines 440 and 443)
* **Discrepancy Description:** Missing mandatory `## Risks & Mitigations` section.
* **Rationale:** The Feature Specification Standard mandates explicit analysis of constraints, failure modes, data drift, and scalability limits.
* **AI Suggestion:** **PROPOSE FIX**
* **Justification:** Adding this section directly addresses operational risks (upstream schema drift, cadence lag, mobile memory, symbology edge cases).
* **Proposed Edit:**
  * Location: Preceding `## Detailed Implementation Plan` (Line 442)
  * Change: Add `## Risks & Mitigations` covering Upstream Schema Drift & Pipeline Resilience, Disclosure Cadence Lag & Freshness Skew, Client-Side Memory & Virtualization Bounds, and Symbology Disambiguation Edge Cases.

---

### B5 [Skeptical Architect (Zoom Out)] - Severity: Blocker
* **Affected Scope:** Section 1.A & 1.D (Lines 111–132, 165–201), Items 1, 2, 10
* **Discrepancy Description:** Routing master ETFs (Vanguard VT/VOO, iShares IWLD) through fuzzy matching when disclosures already contain canonical ISINs/CUSIPs is circular, slow, and introduces false-positive risks.
* **Rationale:** ~9,800 Vanguard constituents have verified ISINs/CUSIPs. Stripping metadata to run Levenshtein matching on 10,000 rows is an anti-pattern.
* **AI Suggestion:** **PROPOSE FIX**
* **Justification:** Master adapters must emit canonical records directly; reserve fuzzy matching strictly for domestic disclosures lacking ISINs.
* **Proposed Edit:**
  * Location: Section 1.A & 1.D, and Items 1, 2, 10
  * Change: Update architecture flow to bypass fuzzy matching for master ETFs with verified ISINs. Reserve fuzzy matcher strictly for unmapped domestic records.

---

### B6 [Comprehension Goldfish & Inventive Catalyst] - Severity: Blocker
* **Affected Scope:** Lines 128–132, 194–197, 352, Items 14, 28
* **Discrepancy Description:** Structural contradiction: CI aborts with non-zero exit code if weights do not sum to $100\% \pm 0.5\%$, but stripping unmapped rows to `unresolved_entries.json` causes weight check to fail, preventing deployment and making `UnresolvedModal.tsx` unreachable.
* **Rationale:** Unresolved holdings must not break the 100% denominator baseline or prevent unaffected funds from deploying.
* **AI Suggestion:** **PROPOSE FIX**
* **Justification:** Emitting unmapped items into `constituents.json` as synthetic placeholder holdings preserves denominator integrity and populates the client review modal.
* **Proposed Edit:**
  * Location: Section 1.D, Section 5, Items 14, 16, 28
  * Change: Upstream pipeline emits unresolved items into `constituents.json` as synthetic records (`isin: "UNRESOLVED_<ticker>"`, `gics_sector: "Unclassified"`, `country: "Unknown"`). Weight check passes, and `UnresolvedModal.tsx` consumes these records.

---

### B7 [Inventive Catalyst, Comprehension, Critic, Codebase Details] - Severity: Blocker
* **Affected Scope:** Section 1.D, Section 3.A, Items 8, 16, 23
* **Discrepancy Description:** `security_master.json` is generated in `pipeline/` (unreachable by GitHub Pages) and holds 12,000+ global stocks (too heavy for mobile autocomplete).
* **Rationale:** Direct equity search is scoped strictly to NZX and ASX shares (CUJ 4). Shipping 10,000 Vanguard stocks to the browser for direct share search bloats memory.
* **AI Suggestion:** **PROPOSE FIX**
* **Justification:** Upstream CI extracts an active NZX/ASX index (`public/data/direct_equities.json`) of ~2,400 records (~120KB uncompressed), and client autocomplete fetches this file.
* **Proposed Edit:**
  * Location: Section 1.D, Section 3.A, Items 8, 16, 23
  * Change: CI outputs `public/data/direct_equities.json` (NZX + ASX active listings only). Client `PortfolioInputTable.tsx` loads `direct_equities.json` via base URL.

---

### B8 [Implementation Readiness] - Severity: Blocker
* **Affected Scope:** Items 1–5 (`pipeline/adapters/*.py`)
* **Discrepancy Description:** Unspecified adapter interface and inconsistent intermediate return tuples.
* **Rationale:** Without a unified data model, Tier 2 enrichment cannot consume adapter outputs uniformly.
* **AI Suggestion:** **PROPOSE FIX**
* **Justification:** Define a standard dataclass and signature for all provider adapters.
* **Proposed Edit:**
  * Location: Items 1–5
  * Change: Define Python dataclass `RawHolding(raw_name: str, raw_identifier: Optional[str], exchange: Optional[str], weight_pct: float)` and standard signature `parse_holdings(path: Path) -> List[RawHolding]`.

---

### M1 [Skeptical Architect (Zoom Out)] - Severity: Major
* **Affected Scope:** Open Questions (Lines 62–64), Section 1.D, Items 7 & 9
* **Discrepancy Description:** Speculative OpenFIGI API dependency with rate limiting, CI cache files (`openfigi_cache.json`), and network failure points.
* **Rationale:** YAGNI violation. Official NZX, ASX, and Vanguard VT directories cover ~100% of equities. Residual items are easily handled by `provider_alias_map.json`.
* **AI Suggestion:** **PROPOSE FIX**
* **Justification:** Eliminates external network dependency, secret keys, rate-limit workarounds, and Open Questions.
* **Proposed Edit:**
  * Location: Open Questions, Section 1.D, Items 7 & 9
  * Change: Remove OpenFIGI API and `openfigi_cache.json`. Rely on official exchange directories, Vanguard VT master directory, and `provider_alias_map.json`. Remove the OpenFIGI open question.

---

### M2 [Skeptical Architect (Zoom Out)] - Severity: Major
* **Affected Scope:** Section 3.A, Item 31 (`package.json`)
* **Discrepancy Description:** Heavyweight client WebAssembly dependency (`rapidfuzz-wasm`) for direct equity autocomplete.
* **Rationale:** Premature optimization. 2,400 NZX/ASX items can be filtered via native JavaScript substring search in under 2ms.
* **AI Suggestion:** **PROPOSE FIX**
* **Justification:** Drop WASM dependency, avoiding bundle bloat, Vite WASM plugins, and CSP restrictions.
* **Proposed Edit:**
  * Location: Section 3.A, Item 31
  * Change: Drop `rapidfuzz-wasm`. Use native JavaScript string matching over `direct_equities.json`.

---

### M3 [Design Critic & Intermediate Zoom Out] - Severity: Major
* **Affected Scope:** Section 1.F (Line 271), Section 2.A
* **Discrepancy Description:** Master fund internal cash ($c_{\text{master}} \approx 0.2\% - 1.5\%$) causes raw equity weights to sum to $<1.0$, creating an unexplained reconciliation leak in the feeder unwrapping equation.
* **Rationale:** Feeder multiplier $(1 - c_f - h_f)$ assumes master equity weights sum to 100%.
* **AI Suggestion:** **PROPOSE FIX**
* **Justification:** Upstream in Tier 1, normalize master ETF equity weights to sum to 1.0 of the equity basket before applying feeder scaling. Clamp scaling factor to $\min(1.0, 1 - c_f)$ if $h_f < 0$.
* **Proposed Edit:**
  * Location: Section 1.F, Section 2.A, Item 13
  * Change: Explicitly specify master ETF equity weight normalization ($\sum w_{m,i} = 1.0$) in Tier 1. Update feeder unwrapping equation and clamp negative hedging.

---

### M4 [Design Critic & Intermediate Zoom Out] - Severity: Major
* **Affected Scope:** Section 1.D (Line 244), Item 10
* **Discrepancy Description:** High-confidence threshold ($\ge 90\%$) causes false positive matches on distinct share classes (`GOOGL` vs `GOOG`, `BRK.A` vs `BRK.B`).
* **Rationale:** Token similarity exceeds 95% on distinct financial securities.
* **AI Suggestion:** **PROPOSE FIX**
* **Justification:** Enforce disambiguation guardrails: top-1 vs top-2 score spread $\ge 15\%$ and identical stem tokens; otherwise route to `unresolved_entries.json`.
* **Proposed Edit:**
  * Location: Section 1.D, Item 10
  * Change: Add rule requiring $\ge 15\%$ spread between top-1 and top-2 candidates, and identical leading tokens. Route collisions to `unresolved_entries.json` / `provider_alias_map.json`.

---

### M5 [Comprehension, Critic, Intermediate Zoom Out] - Severity: Major
* **Affected Scope:** Goals Line 46, CUJ 4, Section 3.A, Item 23
* **Discrepancy Description:** ASX direct shares trade in AUD, but application requires NZD without defining FX conversion mechanism.
* **Rationale:** Expecting retail users to perform manual external conversions for each holding leads to user error, while a static build-time benchmark rate is immediately obsolete.
* **AI Suggestion:** **PROPOSE FIX**
* **Justification:** User can enter their actual AUD exchange rate (e.g. 1 AUD = X.XX NZD) directly in the UI when ASX holdings are added. The rate is persisted in LocalStorage alongside the portfolio inputs.
* **Proposed Edit:**
  * Location: Goals Line 46, CUJ 4, Section 3.A, Item 22, Item 23
  * Change: Update Direct Equities specification to show an editable AUD/NZD exchange rate input field dynamically when/if any ASX individual holdings are added. Users enter ASX share values in AUD, and the client engine scales them to NZD using the user-specified rate. Persist the user's AUD/NZD rate in `LocalStorageV1Payload`.

---

### M6 [Skeptical Architect (Zoom Out)] - Severity: Major
* **Affected Scope:** Section 5 (Lines 342–360), Item 18
* **Discrepancy Description:** Over-engineered administrator staging infrastructure (`validate_staging.yml` with automated PR bot commenting).
* **Rationale:** Speculative infrastructure for a static open-source tool.
* **AI Suggestion:** **PROPOSE FIX**
* **Justification:** Replace with a single CLI dry-run flag (`python -m pipeline.ingest --dry-run`) and standard PR CI tests.
* **Proposed Edit:**
  * Location: Section 5, Item 18
  * Change: Drop `validate_staging.yml`. Document `python -m pipeline.ingest --dry-run` and standard `ingest.yml` PR checks.

---

### M7 [Codebase Details] - Severity: Major
* **Affected Scope:** Milestone Phasing (Lines 449–683)
* **Discrepancy Description:** Testing deferred entirely to Milestone 4, violating incremental verification standard.
* **Rationale:** Milestones 1 and 2 cannot be validated upon completion.
* **AI Suggestion:** **PROPOSE FIX**
* **Justification:** Colocate tests within their respective milestones.
* **Proposed Edit:**
  * Location: Milestone Phasing
  * Change: Move adapter and pipeline tests to Milestone 1 with verification gate `pytest pipeline/tests/`. Move look-through engine tests to Milestone 2 with verification gate `npm test`.

---

### M8 [Implementation Readiness] - Severity: Major
* **Affected Scope:** Items 14, 16, 19–22
* **Discrepancy Description:** Missing explicit schemas and TypeScript interfaces for engine inputs, outputs, and storage.
* **Rationale:** Implementer must invent data models, risking schema drift.
* **AI Suggestion:** **PROPOSE FIX**
* **Justification:** Provide concrete TypeScript interfaces and JSON schema definitions.
* **Proposed Edit:**
  * Location: Items 14, 16, 19–22
  * Change: Include TypeScript interface declarations (`PortfolioInput`, `AggregatedPortfolioResult`, `LocalStorageV1Payload`) and JSON schema models.

---

### M9 [Codebase Details] - Severity: Major
* **Affected Scope:** Items 15, 33–36
* **Discrepancy Description:** Directory entries instead of explicit file paths in file manifest.
* **Rationale:** Violates Target Scope & File Boundary requirement.
* **AI Suggestion:** **PROPOSE FIX**
* **Justification:** Enumerate concrete schema files and test fixtures.
* **Proposed Edit:**
  * Location: Items 15, 33–36
  * Change: Enumerate all 5 schema files (`pipeline/validate/schemas/*_schema.json`) and test fixtures (`pipeline/tests/fixtures/*.csv`).

---

### M10 [Codebase Details] - Severity: Major
* **Affected Scope:** Milestone 3 File Manifest
* **Discrepancy Description:** Missing tooling configs (`tsconfig.json`, `tsconfig.node.json`, `.eslintrc.cjs`).
* **Rationale:** Mandated TypeScript and linting require configuration files.
* **AI Suggestion:** **PROPOSE FIX**
* **Justification:** Add standard Vite TypeScript and ESLint configuration files.
* **Proposed Edit:**
  * Location: Milestone 3 File Manifest
  * Change: Add `tsconfig.json`, `tsconfig.node.json`, and `.eslintrc.cjs` to target files list.

---

### M11 [Structural Validator & Style Goldfish] - Severity: Major
* **Affected Scope:** Milestone Headings, Architecture §4 & §5
* **Discrepancy Description:** Heading hierarchy collisions between milestones and file items (both H4), and asymmetric architecture subsections.
* **Rationale:** Flattens outline in markdown parsers.
* **AI Suggestion:** **PROPOSE FIX**
* **Justification:** Promote Milestone headings to H3 (`### Milestone 1...`) and adopt H4 subsections in architecture.
* **Proposed Edit:**
  * Location: Detailed Implementation Plan headings, Architecture §4 & §5
  * Change: Promote Milestone headers to H3; convert architecture sections 4 and 5 to H4 subsections.

---

### N1–N6 [Structural, Style, Comprehension, Inventive Catalyst] - Severity: Nit
* **Affected Scope:** Various lines across document
* **Discrepancy Description:** Minor naming, attribution, buzzwords, acronym definitions, and micro-holding bucketing:
  - N1: Rename `## The Problem` to `## Problem Statement`.
  - N2: Strip "Rejected by author —" in Alternatives Considered.
  - N3: Remove marketing buzzwords ("seamlessly", "Clean") and redundant editorializing (Overview Line 15).
  - N4: Define domain acronyms inline (GICS, ICB, CUSIP).
  - N5: Standardize weight units to decimal fractions (`0.0`–`1.0`).
  - N6: Collapse micro-holdings ($<0.01\%$) into expandable table row rather than deleting from memory.
* **AI Suggestion:** **PROPOSE FIX**
* **Justification:** Polish and clean engineering precision across the specification.
* **Proposed Edit:**
  * Location: Lines 15, 21, 31, 46, 313, 386–440, 541
  * Change: Apply revisions N1 through N6 across the document.

