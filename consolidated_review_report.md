# Consolidated Review Report: Kiwi Portfolio X-Ray

**Target Document:** [`docs/designs/kiwi-portfolio-xray.md`](file:///mnt/c/Users/susan/wsl/kiwi-portfolio-xray/docs/designs/kiwi-portfolio-xray.md) (Lines 1–692)  
**Status:** Under Review (Consolidated Goldfish Swarm)  
**Date:** 2026-11-08  
**Standards Applied:**
* `zoom-out-standard.md` (Stages 5 & 8)
* `feature-spec-standard.md` (Stage 7)
* `implementation-readiness-standard.md` (Stage 9)

---

## Executive Summary

The Kiwi Portfolio X-Ray specification successfully outlines a compelling, privacy-preserving client-side architecture that solves real visibility challenges for New Zealand retail investors. However, an exhaustive 5-stage Goldfish review across nine specialized personas identified **8 critical Blockers**, **11 Major architectural gaps**, and **6 Minor/Style improvements** that must be resolved before proceeding to implementation.

The review findings converge on a unifying principle: **Keep the client browser dumb, static, and fast; resolve all symbology and mathematical scaling deterministically upstream in GitHub Actions CI; and strictly eliminate speculative dependencies (YAGNI).**

---

## Consolidated Action Items by Priority

### 🔴 Blockers (Must Resolve Before Implementation Approval)

| ID | Finding & Action Required | Affected Files / Scope | Primary Sources |
|---|---|---|---|
| **B1** | **Commit Definitively to Frontend Stack (Zero-Decision Rule)**<br>Eliminate all "React or Svelte — TBD", "D3 or similar", and "rapidfuzz-wasm or equivalent" placeholders. Commit decisively to **React 18+ with TypeScript + Vite**, native SVG / D3 rendering, and standard JavaScript client search. Standardize all UI file extensions to `.tsx`. | Items 23–29, 31 (`src/components/`, `package.json`) | Zoom Out 1.4, Readiness 9.1.1, Codebase 9.2.1 |
| **B2** | **Add Web Application Root Entry Points**<br>Add `index.html` (HTML root) and `src/main.tsx` (DOM mount entry point) to the Milestone 3 target files list. Without these, `vite build` and `npm run build` will fail immediately. | Milestone 3 (`index.html`, `src/main.tsx`) | Codebase 9.2.1 |
| **B3** | **Add Python Pipeline Dependency Manifest**<br>Add `requirements.txt` (or `pyproject.toml`) and `requirements-dev.txt` specifying Python 3.11+, `rapidfuzz`, `requests`, `pytest`, and `ruff`. | Milestone 1 (`requirements.txt`) | Readiness 9.1.2, Codebase 9.2.4 |
| **B4** | **Add Mandatory `## Risks & Mitigations` Section**<br>The Feature Spec Standard mandates an explicit risk analysis section. Add `## Risks & Mitigations` covering upstream schema drift, multi-cadence reporting lag, mobile memory constraints, and symbology resolution edge cases. | Document Root (between lines 440 and 443) | Critic 7.1.1, Structural 7.2.1, Zoom Out 8.6 |
| **B5** | **Bypass Fuzzy Matching for Master ETFs (Vanguard & iShares)**<br>Vanguard and iShares disclosure CSVs already contain canonical ISIN/CUSIP identifiers. Passing ~10,000 rows through Levenshtein fuzzy matching is circular, slow, and introduces false-positive risks. Upstream master adapters must emit canonical records directly; reserve fuzzy matching strictly for domestic funds lacking ISINs. | Section 1.A & 1.D, Items 1, 2, 10 | Zoom Out 1.1, Zoom Out 8.2 |
| **B6** | **Resolve CI Abort vs. Client UI Contradiction for Unresolved Holdings**<br>Currently, CI exits non-zero if weights don't sum to $100\% \pm 0.5\%$, while unmapped holdings are stripped to `unresolved_entries.json`. This causes CI to abort on unmapped holdings, preventing `unresolved_entries.json` from deploying and making `UnresolvedModal.tsx` unreachable. Fix by emitting unmapped items into `constituents.json` as synthetic placeholder holdings (`isin: "UNRESOLVED_<ticker>"`, `gics_sector: "Unclassified"`). | Lines 128–132, 194–197, 352, Item 14, Item 28 | Comprehension 6.1, Catalyst 2.4, Zoom Out 8.5 |
| **B7** | **Fix Runtime Asset Path & Extract Lightweight Direct Equities Index**<br>`security_master.json` is generated in `pipeline/` (unreachable by GitHub Pages) and holds 12,000+ global stocks (too heavy for mobile). Have CI extract `public/data/direct_equities.json` containing only active NZX and ASX listings (~2,400 records, ~120KB uncompressed), and update `PortfolioInputTable.tsx` to fetch it. | Section 1.D, Section 3.A, Item 8, Item 16, Item 23 | Catalyst 2.2, Comprehension 6.3, Critic 7.1.4, Codebase 9.2.2 |
| **B8** | **Define Unified Adapter Interface and Data Contract**<br>Define a shared Python dataclass `RawHolding(raw_name: str, raw_identifier: Optional[str], exchange: Optional[str], weight_pct: float)` and standard function signature `parse_holdings(path: Path) -> List[RawHolding]` across all provider adapters. | Items 1–5 (`pipeline/adapters/*.py`) | Readiness 9.1.3 |

---

### 🟡 Major Improvements (Architectural & Technical Health)

| ID | Finding & Action Required | Affected Files / Scope | Primary Sources |
|---|---|---|---|
| **M1** | **Eliminate Speculative OpenFIGI API & Caching (YAGNI)**<br>Drop OpenFIGI API and `openfigi_cache.json`. The scope of funds is fixed; official NZX, ASX, and Vanguard VT directories cover ~100% of holdings. Use `provider_alias_map.json` for residual edge cases. | Open Questions, Section 1.D, Items 7 & 9 | Zoom Out 1.2, Zoom Out 8.2 |
| **M2** | **Eliminate Heavyweight `rapidfuzz-wasm` Client Dependency**<br>Drop WebAssembly dependency for client autocomplete. Use native JavaScript string and substring matching over the ~2,400 active NZX/ASX entries in `direct_equities.json`. | Section 3.A, Item 31 (`package.json`) | Zoom Out 1.3, Zoom Out 8.3 |
| **M3** | **Fix Master Fund Cash Leakage & Feeder Equity Scaling**<br>Master funds hold cash ($c_{\text{master}} \approx 0.2\% - 1.5\%$), causing raw equity weights to sum to $<1.0$. Normalize master ETF equity weights to sum to 1.0 upstream in Tier 1 before applying the feeder wrapper multiplier $(1 - c_f - h_f)$. Clamp the multiplier to $\min(1.0, 1 - c_f)$ if $h_f < 0$. | Section 1.F (Line 271), Section 2.A | Critic 7.1.2, Critic 7.1.6, Zoom Out 8.1 |
| **M4** | **Enforce Disambiguation Guardrails on Dual-Class Shares in Fuzzy Matcher**<br>To prevent false positive matches between distinct share classes (`GOOGL` vs `GOOG`, `BRK.A` vs `BRK.B`), require a top-1 vs top-2 score spread $\ge 15\%$ and identical leading stem tokens; otherwise divert to `unresolved_entries.json`. | Section 1.D (Line 244), Item 10 | Critic 7.1.3, Zoom Out 8.2 |
| **M5** | **Direct Equity ASX Currency Conversion Support**<br>ASX shares trade in AUD. To prevent user conversion errors and avoid an obsolete static rate, allow the user to enter their actual AUD exchange rate directly in the UI when/if ASX holdings are added. Persist the rate in `LocalStorage`. | Goals Line 46, CUJ 4, Section 3.A, Item 22, Item 23 | Comprehension 6.4, Critic 7.1.5, Zoom Out 8.4 |
| **M6** | **Simplify Administrator Validation Infrastructure**<br>Drop speculative `validate_staging.yml` workflow and automated PR bot commenting. Provide a simple local CLI dry-run flag (`python -m pipeline.ingest --dry-run`) and rely on standard pull request CI tests. | Section 5, Item 18 | Zoom Out 1.5 |
| **M7** | **Colocate Tests and Checkpoints within Milestones**<br>Move adapter and pipeline tests into Milestone 1 with a milestone verification gate (`pytest pipeline/tests/`). Move look-through engine tests into Milestone 2 (`npm test`). Reserve Milestone 4 for GitHub Pages deployment workflows. | Milestone Phasing (Lines 449–683) | Codebase 9.2.6 |
| **M8** | **Document Explicit Schemas and TypeScript Interfaces**<br>Provide concrete TypeScript interfaces (`PortfolioInput`, `AggregatedPortfolioResult`, `LocalStorageV1Payload`) and JSON schema definitions for static outputs. | Items 14, 16, 19–22 | Readiness 9.1.6, 9.1.7 |
| **M9** | **Enumerate Specific Schema Files & Test Fixtures in Target Files**<br>Replace directory entries with explicit lists of schema files (`pipeline/validate/schemas/*_schema.json`) and test fixtures (`pipeline/tests/fixtures/*.csv`). | Items 15, 33–36 | Codebase 9.2.4, Codebase 9.2.5 |
| **M10** | **Add Missing Tooling Configs to Milestone 3**<br>Add `tsconfig.json`, `tsconfig.node.json`, and `.eslintrc.cjs` to the file manifest. | Milestone 3 File List | Codebase 9.2.3 |
| **M11** | **Fix Heading Hierarchy Collision & Section Symmetry**<br>Promote Milestone headings to H3 (`### Milestone 1...`) so numbered file items remain H4. Standardize architecture subsections 4 and 5 to use the H4 hierarchy. | Milestone Headings, Architecture §4 & §5 | Structural 7.2.2, Style 9.3.1 |

---

### 🟢 Nitpicks & Copy Editing

| ID | Finding & Action Required | Scope | Primary Sources |
|---|---|---|---|
| **N1** | Rename `## The Problem` to `## Problem Statement` for exact template compliance. | Line 21 | Structural 7.2.3 |
| **N2** | Rephrase "Reason for Rejection: Rejected by author — ..." to "Reason for Rejection: [Technical Rationale]" across all alternatives. | Lines 386–440 | Structural 7.2.4, Style 7.3.3 |
| **N3** | Remove marketing buzzwords ("seamlessly", "Clean") and redundant meta-commentary in Overview (Line 15). | Lines 15, 46, 313 | Style 7.3.1, Style 7.3.3 |
| **N4** | Define domain acronyms inline (GICS, ICB, CUSIP, OpenFIGI). | Lines 31, 41, 115, 456 | Comprehension 6.5 |
| **N5** | Standardize weight units to decimal fractions (`0.0` to `1.0`) consistently across pipeline and client models. | Lines 456, 535, 541 | Codebase 9.2.7 |
| **N6** | In virtualized holdings table, collapse micro-holdings ($<0.01\%$) into an expandable row rather than permanently excising them from client memory, preserving full searchability. | Section 2.B, Section 3.C | Catalyst 2.3 |

---

## Traceability Matrix

| Consolidated Item | Stage 5 (Initial Zoom Out) | Stage 6 (Comprehension) | Stage 7 (Critic) | Stage 8 (Intermediate Zoom Out) | Stage 9 (Readiness) |
|---|:---:|:---:|:---:|:---:|:---:|
| **B1 (Frontend Stack)** | Finding 1.4 | Finding 6.6 | — | — | Finding 9.1.1, 9.2.1 |
| **B2 (Web Entry Points)** | — | — | — | — | Finding 9.2.1 |
| **B3 (Python Dependencies)** | — | — | — | — | Finding 9.1.2, 9.2.4 |
| **B4 (Risks & Mitigations)** | — | — | Finding 7.1.1, 7.2.1 | Finding 8.6 | — |
| **B5 (Master ETF Bypass)** | Finding 1.1 | — | — | Finding 8.2 | — |
| **B6 (CI Abort Contradiction)**| Finding 2.4 | Finding 6.1 | — | Finding 8.5 | — |
| **B7 (Direct Equities Index)** | Finding 2.2 | Finding 6.3 | Finding 7.1.4 | Finding 8.3 | Finding 9.2.2 |
| **B8 (Adapter Data Contract)** | — | — | — | — | Finding 9.1.3 |
| **M1 (Drop OpenFIGI)** | Finding 1.2 | Finding 6.5 | — | Finding 8.2 | Finding 9.1.5 |
| **M2 (Drop rapidfuzz-wasm)** | Finding 1.3 | — | — | Finding 8.3 | — |
| **M3 (Master Cash Leakage)** | — | — | Finding 7.1.2, 7.1.6 | Finding 8.1 | — |
| **M4 (Fuzzy Disambiguation)** | — | — | Finding 7.1.3 | Finding 8.2 | — |
| **M5 (ASX AUD Currency)** | — | Finding 6.4 | Finding 7.1.5 | Finding 8.4 | — |
| **M6 (Drop Staging Workflow)**| Finding 1.5 | — | — | — | — |
| **M7 (Colocate Testing)** | — | — | — | — | Finding 9.2.6 |
| **M8 (Concrete Schemas)** | Finding 1.7 | — | — | Finding 8.3 | Finding 9.1.6, 9.1.7 |
| **M9 (Explicit File Lists)** | — | — | — | — | Finding 9.2.4, 9.2.5 |
| **M10 (Tooling Configs)** | — | — | — | — | Finding 9.2.3 |
| **M11 (Heading Hierarchy)** | — | — | Finding 7.2.2 | — | Finding 9.3.1 |
| **N1–N6 (Style & Copy)** | Finding 1.6 | Finding 6.5 | Finding 7.2.3–7.3.3 | — | Finding 9.2.7, 9.3.2 |

---

## Next Steps for the Author

When you return from your break, the next phase in EGM is **Resolution (`/egm-resolve`)**:
1. Review the **8 Blockers** and **11 Major Items** above.
2. Direct the agent to update [`docs/designs/kiwi-portfolio-xray.md`](file:///mnt/c/Users/susan/wsl/kiwi-portfolio-xray/docs/designs/kiwi-portfolio-xray.md) with the agreed resolutions.
3. Update the document status in `docs/designs/SITEMAP.md` to **Approved**.
4. Hand off to the coding agent to begin Milestone 1 implementation.

