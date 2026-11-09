# Stage 8: Intermediate Zoom Out Review Report

**Target Document:** `docs/designs/kiwi-portfolio-xray.md`  
**Scope:** Full File (Lines 1–692)  
**Standard:** `resources/document_standards/zoom-out-standard.md`  
**Reviewer:** Skeptical Architect (`egm-zoom-out`)

---

### Executive Evaluation

The findings and proposals raised in the Comprehension (Stage 6) and Critic (Stage 7) reviews correctly surface critical edge cases in mathematical accounting, symbology disambiguation, payload bloat, and document structure. However, there is an immediate risk of **architectural over-engineering** if these issues are resolved by introducing complex multi-tier pipelines, dynamic API integrations, or heavyweight client libraries.

The overarching design principle must remain: **Keep the client browser completely dumb, static, and fast; resolve all symbology and math upstream in CI with simple, deterministic Python transformations; and strictly avoid speculative features (YAGNI).**

---

### Findings & Architectural Simplification Guidance

#### Finding 8.1: Master Fund Cash Accounting vs. Over-Engineered Currency/Derivative Modeling
* **Severity:** **Major**
* **Affected Scope:** Section 1.F (Lines 269–275) & Section 2.A (Lines 282–300) [Critic Finding 7.1.2 & 7.1.6]
* **Simplicity Evaluation & Guidance:**
  - **Risk:** Critic Findings 7.1.2 and 7.1.6 suggest adding complex derivative modeling for negative net asset values ($h_f < 0$) and tracking multi-layered cash fractions ($c_f^{\text{eff}} = c_f + c_{\text{master}} \times (1 - c_f - h_f)$). Over-modeling currency forward liabilities and multi-tier cash flows adds needless cognitive and mathematical complexity to what is fundamentally an asset allocation visibility tool.
  - **Minimalist Architecture:**
    1. **Master Fund Equity Normalization:** Master ETFs disclose equity constituents whose raw weights sum to $1 - c_{\text{master}}$. Upstream in Tier 1 (`vanguard_adapter.py`, `ishares_adapter.py`), simply normalize equity constituent weights to sum to 100% of the equity basket ($\sum w_{m, i} = 1.0$) prior to wrapping.
    2. **Feeder Proportions:** The feeder wrapper's equity fraction is simply $(1 - c_f - h_f)$. Any fund-level cash or derivative balance remains segregated in the fund's top-level metadata (`c_f`, `h_f`). If $h_f < 0$ (unrealized liability), clamp the equity scaling factor to $\min(1.0, 1 - c_f)$ so equity exposures are never artificially leveraged/inflated above the fund's gross equity assets.
    3. **Client Simplicity:** The client browser calculation engine remains dead simple: $E_i = \sum B_f \times w_{f, i}$, where $\sum w_f \le 1.0$. No derivative liability engines or multi-tier cash reconciliation calculations in browser JavaScript.

#### Finding 8.2: Disambiguation Guardrails vs. Heuristic Bloat in Fuzzy Matching
* **Severity:** **Major**
* **Affected Scope:** Section 1.D (Lines 241–245) [Critic Finding 7.1.3]
* **Simplicity Evaluation & Guidance:**
  - **Risk:** Critic Finding 7.1.3 points out that Levenshtein similarity $>90\%$ will cause false-positive matches on share classes (`GOOGL` vs `GOOG`, Berkshire `BRK.A` vs `BRK.B`). While true, attempting to write an elaborate NLP / heuristic token disambiguation parser in Python is an anti-pattern that leads to endless maintenance and edge-case patching.
  - **Minimalist Architecture:**
    1. **Bypass Matching for Master Funds (Recall Finding 1.1):** As established in Initial Zoom Out, Vanguard and iShares disclosures *already have canonical ISINs/CUSIPs*. They must bypass the fuzzy matcher entirely. This immediately eliminates 95% of all matching operations (including `Alphabet` and `Berkshire`).
    2. **Strict Rule for Residuals:** For the remaining domestic funds (Smartshares NZ/AU, Kernel): If an exact ticker or alias match does not exist in `provider_alias_map.json`, require that any fuzzy candidate difference between top-1 and top-2 scores be $\ge 15\%$, AND require that the candidate shares identical leading words. If not, route directly to `unresolved_entries.json`.
    3. **Human-in-the-Loop Override:** Do not write speculative parsing algorithms for share classes. Rely on the existing static `provider_alias_map.json` for edge cases.

#### Finding 8.3: Direct Equity Autocomplete & Client Payload Sizing
* **Severity:** **Major**
* **Affected Scope:** Section 1.D (Lines 235–240), Section 3.A (Lines 314–315), File 8 & 31 [Comprehension 6.3, Critic 7.1.4, Catalyst 2.2]
* **Simplicity Evaluation & Guidance:**
  - **Risk:** Shipping `security_master.json` (10,000+ global stocks, ~2–4MB) to the browser along with a WASM search library (`rapidfuzz-wasm`) violates both mobile performance constraints and YAGNI.
  - **Minimalist Architecture:**
    1. **Pre-build `direct_equities_index.json`:** Direct equity input is strictly scoped to NZX and ASX shares (CUJ 4). Upstream CI extracts an active NZX + ASX lookup table (~2,400 records, ~120KB uncompressed, ~25KB gzip): `[{ isin, ticker, name, country, gics_sector }]`.
    2. **Zero-Dependency Native Search:** The browser performs vanilla JavaScript substring filtering (`name.toLowerCase().includes(q) || ticker.startsWith(q)`). Drop `rapidfuzz-wasm` entirely.
    3. **Lightweight Constituents:** As recommended in Finding 1.7, `constituents.json` should reference `isin` and `weight`, relying on compact static dictionaries rather than repeating company names and sectors thousands of times.

#### Finding 8.4: Direct Equity Currency Conversion Simplicity
* **Severity:** **Major**
* **Affected Scope:** Goals (Line 46), Section 2.A (Lines 283–287), Section 3.A (Lines 314–315) [Comprehension 6.4, Critic 7.1.5]
* **Simplicity Evaluation & Guidance:**
  - **Risk:** Adding dynamic FX rate feeds or third-party exchange rate APIs violates Non-Goal 1 & 4 (no server APIs, no real-time pricing) and introduces external network failure points.
  - **Minimalist Architecture:**
    - Provide a simple build-time daily/monthly AUD/NZD benchmark exchange rate embedded directly into `funds_registry.json` (or static config).
    - In the UI, allow the user to input ASX holdings in either AUD or NZD via a toggle. If entered in AUD, the client multiplies by the static benchmark rate.
    - Zero live FX APIs, zero infrastructure overhead, solves 100% of user friction for ASX shares.

#### Finding 8.5: Unresolved Holdings Handling: CI Integrity vs. Client UI
* **Severity:** **Major**
* **Affected Scope:** Lines 194–197, 352, 541, 563–564, 632–636 [Comprehension 6.1, Catalyst 2.4]
* **Simplicity Evaluation & Guidance:**
  - **Risk:** The design currently has a fatal contradiction: CI exits with code 1 if weights don't sum to $100\% \pm 0.5\%$, but simultaneously routes unmapped items to `unresolved_entries.json` and promises an `UnresolvedModal.tsx` in the frontend. If CI aborts, no data is published, rendering the UI modal unreachable.
  - **Minimalist Architecture:**
    - Upstream pipeline should emit unresolved items into `constituents.json` as placeholder records:  
      `{ isin: "UNRESOLVED_<ticker>", name: "<raw_name> (Unresolved)", country: "Unknown", gics_sector: "Unclassified", weight: ... }`
    - This satisfies the $100\% \pm 0.5\%$ integrity check, allows GitHub Actions to deploy cleanly for all funds, isolates unresolved holdings into an `"Unclassified"` sector segment in macro charts, and populates the `UnresolvedModal.tsx` so users and contributors can easily see what needs a manual alias entry.

#### Finding 8.6: Risks & Mitigations Section Placement & Proportionality
* **Severity:** **Major**
* **Affected Scope:** Lines 440–443 [Critic 7.1.1, Structural 7.2.1]
* **Simplicity Evaluation & Guidance:**
  - Critic and Structural reviewers rightly require a `## Risks & Mitigations` section.
  - **Guidance:** Ensure this section remains high-altitude and concise. It should cover:
    1. *Upstream Schema Drift & Pipeline Resilience* (schema validation, fallback to previous snapshot).
    2. *Disclosure Reporting Cadence Lag* (freshness indicator in UI).
    3. *Client-side Memory & Payload Limits* (compact JSON structures, virtualized rendering).
    4. *Symbology Disambiguation* (manual alias overrides, strict distance thresholds).
    Avoid turning this section into sprawling implementation pseudocode.

---

### Conclusion

The core architecture remains fundamentally sound and minimal. By applying these simplification guardrails—normalizing master fund equity weights at Tier 1, avoiding NLP fuzzy-matching sprawl, compiling a lightweight NZX/ASX index for zero-dependency native client search, using a static benchmark FX rate for ASX shares, and passing synthetic unresolved placeholders through CI—the Kiwi Portfolio X-Ray avoids architectural dead-ends and stays strictly within YAGNI boundaries.

