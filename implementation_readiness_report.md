# Stage 9: Implementation Readiness Report

**Target Document:** `docs/designs/kiwi-portfolio-xray.md`  
**Scope:** `DetailedRange` (Lines 443–692)  
**Standard:** `resources/document_standards/implementation-readiness-standard.md`  
**Reviewers:** Implementation Readiness Goldfish (`egm-implementation-readiness`), Codebase Details Goldfish (`egm-codebase-details`), Style & Copy Editor (`egm-style`)

---

## 1. Implementation Readiness Review (`egm-implementation-readiness`)

### Executive Verdict: REJECTED (Zero-Decision Rule Violations)

The Detailed Implementation Plan provides a coherent high-level architectural roadmap, but it fails the Zero-Decision Rule. Multiple technical decisions are explicitly left to the implementer—most critically, the frontend framework itself is marked "TBD", Python dependencies and adapter interfaces are omitted, and data transfer objects / schemas lack explicit field-level contracts.

### Findings

#### Finding 9.1.1: Explicit TBDs & Architectural Ambiguity in Frontend Stack
* **Severity:** **Blocker**
* **Affected Scope:** Items 23–29, 31 (Lines 607–651)
* **Finding & Guidance:**
  Item 31 states `"framework (React or Svelte — TBD)"`, `"charting library (D3 or similar lightweight option)"`, and `"rapidfuzz-wasm or equivalent JS fuzzy library"`. Item 29 lists `"src/App.tsx / src/App.svelte"`, and Items 23–28 declare components as `"React/Svelte UI component"`.
  * **Guidance:** An implementer cannot write a single component without making major architectural decisions. Commit definitively to one UI framework (e.g., React 18+ with TypeScript), fix all component file extensions to match (`.tsx`), select the exact charting approach (native SVG / D3), and specify exact search packages.

#### Finding 9.1.2: Missing Python Dependency Manifest
* **Severity:** **Blocker**
* **Affected Scope:** Milestone 1 & Milestone 4 (Lines 445–569, 663–676)
* **Finding & Guidance:**
  The plan specifies `package.json` for frontend tooling (Item 31), but completely omits any dependency definition file for the Python pipeline (`pyproject.toml` or `requirements.txt`).
  * **Guidance:** Add `requirements.txt` (or `pyproject.toml`) and `requirements-dev.txt` to the target file list detailing approved packages (`rapidfuzz`, `requests`, `pytest`, `ruff`) and Python version (3.11+).

#### Finding 9.1.3: Unspecified Adapter Contract & Intermediate Data Structure
* **Severity:** **Blocker**
* **Affected Scope:** Items 1–5 (`pipeline/adapters/*.py`, Lines 453–477)
* **Finding & Guidance:**
  Items 1–5 describe parsing logic for Vanguard, iShares, Smartshares, Kernel, and Disclose Register, but do not define a common adapter interface or signature. Each adapter description extracts different ad-hoc tuples.
  * **Guidance:** Define a unified Python dataclass (e.g., `RawHolding(raw_name: str, raw_identifier: Optional[str], exchange: Optional[str], weight_pct: float)`) and a standard adapter function signature (e.g., `def parse_holdings(file_path: Path) -> List[RawHolding]:`).

#### Finding 9.1.4: Ambiguous Data Ingestion Mechanism in Disclose Register Adapter
* **Severity:** **Major**
* **Affected Scope:** Item 5 (`pipeline/adapters/disclose_register_adapter.py`, Lines 473–477)
* **Finding & Guidance:**
  Item 5 states that the adapter `"Fetches or parses Smartshares scheme disclosure exports..."`.
  * **Guidance:** State explicitly whether the adapter reads local staged files (`data/staging/disclose/`) or calls a remote endpoint. Document the expected format (XML vs CSV) and exact field names/XPath selectors for cash buffer and hedging forward ratios.

#### Finding 9.1.5: Missing External Endpoint Details & OpenFIGI Request Contracts
* **Severity:** **Major**
* **Affected Scope:** Items 7 & 9 (`build_security_master.py`, `openfigi_cache.json`, Lines 493–512)
* **Finding & Guidance:**
  Item 7 mentions downloading NZX and ASX official directories via `"public data endpoint"`, but provides no URLs or fallback static paths. For OpenFIGI, payload structure, rate limits, and cache schema are not documented.
  * **Guidance:** Document exact download URLs or staging locations for NZX/ASX directories. Specify OpenFIGI request payload format, secret name (`OPENFIGI_API_KEY`), and retry/backoff policy (or eliminate OpenFIGI per Zoom Out recommendation).

#### Finding 9.1.6: Missing Explicit Schemas for Validation and Static Outputs
* **Severity:** **Major**
* **Affected Scope:** Items 14, 15, 16 (Lines 538–555)
* **Finding & Guidance:**
  Item 15 mentions a directory of JSON Schema files without defining expected column headers or types. Item 16 specifies static assets (`funds_registry.json`, `constituents.json`, `unresolved_entries.json`) with informal descriptions rather than exact JSON schemas.
  * **Guidance:** Include concrete JSON schema snippets or TypeScript type definitions for `funds_registry.json`, `constituents.json`, and `unresolved_entries.json`.

#### Finding 9.1.7: Lack of TypeScript Interfaces for Calculation Engine and Storage
* **Severity:** **Major**
* **Affected Scope:** Items 19–22 (Lines 576–600)
* **Finding & Guidance:**
  The plan mathematically outlines look-through calculations but specifies no TypeScript interfaces for engine inputs/outputs, `LocalStorage` key `kiwi_portfolio_xray_v1` payload, or CSV export headers.
  * **Guidance:** Provide explicit TypeScript interface declarations: `PortfolioInput`, `AggregatedPortfolioResult`, `LocalStorageV1Payload`, and CSV export header specifications.

#### Finding 9.1.8: Underspecified Test Inputs & Assertions
* **Severity:** **Nit**
* **Affected Scope:** Items 33–36 & Verification Plan (Lines 663–692)
* **Finding & Guidance:**
  Test descriptions state broad scenarios without concrete fixture paths, sample input rows, or expected mathematical results.
  * **Guidance:** Document test fixture paths (`pipeline/tests/fixtures/`) and at least one concrete numeric assertion per test.

---

## 2. Codebase Details Review (`egm-codebase-details`)

### Findings

#### Finding 9.2.1: Missing Web Application Entry Points (`index.html` and `src/main.tsx`)
* **Severity:** **Blocker**
* **Affected Scope:** Lines 607–651 (Milestone 3 Target Files)
* **Finding & Guidance:**
  Item 30 specifies `vite.config.ts`, but the plan omits `index.html` (the primary HTML root entry point required by Vite) and `src/main.tsx` (the TypeScript DOM mount entry point). Without these, `vite dev` and `npm run build` fail immediately.
  * **Guidance:** Add `index.html` and `src/main.tsx` to the Milestone 3 file list.

#### Finding 9.2.2: Runtime Asset Path Disconnect: Direct Equity Autocomplete Cannot Access `security_master.json`
* **Severity:** **Blocker**
* **Affected Scope:** Item 8 (Lines 503–507), Item 16 (Lines 548–555), and Item 23 (Lines 607–611)
* **Finding & Guidance:**
  Item 23 states that autocomplete is "backed by `security_master.json`". However, Item 8 places `security_master.json` in `pipeline/security_master/security_master.json`, and Item 16 (`build_output.py`) only outputs to `public/data/funds_registry.json`, `public/data/constituents.json`, and `public/data/unresolved_entries.json`. The client application hosted on GitHub Pages only serves files from `public/` (copied to `dist/`).
  * **Guidance:** Update `pipeline/output/build_output.py` to write a client-ready search dataset to `public/data/direct_equities.json` (or `public/data/security_master.json`), and update `PortfolioInputTable.tsx` to fetch it via `import.meta.env.BASE_URL + 'data/direct_equities.json'`.

#### Finding 9.2.3: Missing Tooling Configs (`tsconfig.json`, `tsconfig.node.json`, `.eslintrc.cjs`)
* **Severity:** **Major**
* **Affected Scope:** Lines 647–651, 685–692
* **Finding & Guidance:**
  The plan mandates TypeScript and static analysis (`eslint src/`), but omits `tsconfig.json`, `tsconfig.node.json`, and `.eslintrc.cjs` from the file manifest.
  * **Guidance:** Add `tsconfig.json`, `tsconfig.node.json`, and `.eslintrc.cjs` to the Milestone 3 target files.

#### Finding 9.2.4: Directory Entry Instead of Explicit Schema Files
* **Severity:** **Major**
* **Affected Scope:** Item 15 (Lines 543–547)
* **Finding & Guidance:**
  Item 15 defines `pipeline/validate/schemas/ (Create)` as a directory rather than explicit file paths, violating the Implementation Readiness Standard.
  * **Guidance:** Explicitly enumerate the schema files:
    - `pipeline/validate/schemas/vanguard_schema.json`
    - `pipeline/validate/schemas/ishares_schema.json`
    - `pipeline/validate/schemas/smartshares_schema.json`
    - `pipeline/validate/schemas/kernel_schema.json`
    - `pipeline/validate/schemas/disclose_register_schema.json`

#### Finding 9.2.5: Missing Test Fixtures in Target File List
* **Severity:** **Major**
* **Affected Scope:** Milestone 4 (Lines 663–683)
* **Finding & Guidance:**
  Unit tests and CI workflows explicitly rely on fixtures, but no fixture files are declared in the target file list.
  * **Guidance:** Declare fixture files in the Target Files list:
    - `pipeline/tests/fixtures/vanguard_vt_sample.csv`
    - `pipeline/tests/fixtures/ishares_iwld_sample.csv`
    - `pipeline/tests/fixtures/smartshares_fnz_sample.csv`
    - `pipeline/tests/fixtures/kernel_sample.csv`
    - `pipeline/tests/fixtures/security_master_fixture.json`
    - `src/engine/__fixtures__/test_portfolio.json`

#### Finding 9.2.6: Violation of Phasing & Checkpoints Standard: Testing Deferred to Milestone 4
* **Severity:** **Major**
* **Affected Scope:** Milestone Phasing (Lines 449, 572, 603, 654)
* **Finding & Guidance:**
  All pipeline and engine unit tests are placed in Milestone 4, after Milestones 1, 2, and 3. Milestones 1 and 2 cannot be verified upon completion.
  * **Guidance:** Colocate test files and verification checkpoints within their respective milestones:
    - Move adapter and pipeline tests into Milestone 1 with a verification checkpoint (`pytest pipeline/tests/`).
    - Move `src/engine/lookthrough.test.ts` into Milestone 2 with a verification checkpoint (`npm test`).
    - Reserve Milestone 4 for CI/CD deployment workflows and end-to-end integration tests.

#### Finding 9.2.7: Inconsistent Weight Representation (Percentage vs. Decimal Fraction)
* **Severity:** **Nit**
* **Affected Scope:** Item 1 (Line 456), Item 13 (Line 535), Item 14 (Line 541)
* **Finding & Guidance:**
  Item 1 states `weight_pct` and Item 14 tests weight sum against `$100\% \pm 0.5\%$`, whereas Item 13 uses $(1 - c_f - h_f)$ which implies decimal representation ($0.0 \dots 1.0$).
  * **Guidance:** Standardize on decimal fractions (`0.0` to `1.0`) or percentages (`0.0` to `100.0`) consistently across schemas.

---

## 3. Style & Copy Editor Review (`egm-style`)

### Findings

#### Finding 9.3.1: Heading Hierarchy Collision Between Milestones and File Entries
* **Severity:** **Major**
* **Affected Scope:** Lines 449–683 (Milestone headings and Items 1–36)
* **Style Finding:** Milestone headings and numbered file items both use H4 (`####`), flattening the outline.
* **Correction:** Promote Milestone headings to H3 (`### Milestone 1...`) under `## Detailed Implementation Plan`, and keep file items as H4 (`#### 1. ...`).

#### Finding 9.3.2: Numerical Count Mismatch in Static Output List
* **Severity:** **Major**
* **Affected Scope:** Line 551 (Item 16: `pipeline/output/build_output.py`)
* **Style Finding:** The text states *"writes the two production static assets:"*, but lists **three** bulleted output files.
* **Correction:** Update text to state *"writes three production static assets:"*.

#### Finding 9.3.3: Subjective Editorializing & Promotional Phrasing
* **Severity:** **Nit**
* **Affected Scope:** Line 481, Line 541, Line 630
* **Style Finding:** "Adding a new feeder fund requires only a new entry here with no code changes" (promotional), "Surfacing this prominently ensures users understand data currency before drawing conclusions" (editorializing), and "Prevents silently corrupted outputs from reaching constituents.json" (defensive justification).
* **Correction:** Convert to neutral declarative specifications.

