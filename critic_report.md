# Stage 7: Critic Review Report

**Target Document:** `docs/designs/kiwi-portfolio-xray.md`  
**Scope:** `FeatureRange` (Lines 1–442)  
**Standard:** `resources/document_standards/feature-spec-standard.md`  
**Reviewers:** Design Critic (`egm-design`), Structural Layout Validator (`egm-structural`), Style & Copy Editor (`egm-style`)

---

## 1. Design Critic Review (`egm-design`)

### Findings

#### Finding 7.1.1: Missing Mandatory Section: Risks & Mitigations
* **Severity:** **Blocker**
* **Affected Scope:** Document Structure / Missing Section (between lines 384 and 386 or following line 440)
* **Finding & Recommendation:**
  The Feature Specification Standard mandates an explicit evaluation of constraints, failure modes, security implications, and scalability limits. Lines 1–442 transition directly from Architecture into Alternatives Considered with no dedicated `## Risks & Mitigations` section.
  * **Recommendation:** Add a formal `## Risks & Mitigations` section detailing:
    1. Upstream schema drift and network failures during GitHub Actions execution.
    2. Data inconsistency from multi-cadence disclosure lag.
    3. Scalability limits of client-side payload parsing on mobile devices.
    4. False positive identifier resolution risks and mitigation safeguards.

#### Finding 7.1.2: Feeder Unwrapping Equation Omits Master Fund Cash (Denominator Leakage)
* **Severity:** **Major**
* **Affected Scope:** Section 1.F (Lines 269–275) & Section 2.A (Lines 282–300)
* **Finding & Recommendation:**
  Line 271 calculates constituent weight in feeder funds as:
  $$\text{Constituent Weight in Feeder} = \text{Constituent Weight in Master} \times (1 - c_f - h_f)$$
  However, master funds (e.g. Vanguard `VT`, `VOO`) also maintain internal liquidity and cash reserves ($c_{\text{master}} \approx 0.2\% - 1.5\%$), meaning $\sum w_{\text{master}} = 1 - c_{\text{master}} < 1.0$. Consequently, the feeder constituent sum equals $(1 - c_f - h_f)(1 - c_{\text{master}})$. When combined with wrapper cash ($c_f$) and hedging ($h_f$), the total sum does not equal 1.0. The master fund's internal cash is lost from the model, creating a persistent reconciliation leak in the total portfolio denominator ($D$).
  * **Recommendation:** Explicitly extract or normalize master-fund cash: either credit $c_{\text{master}}$ to the total cash buffer ($c_f^{\text{eff}} = c_f + c_{\text{master}} \times (1 - c_f - h_f)$), or re-normalize master equity constituent weights to sum to 100% before scaling by the feeder equity fraction $(1 - c_f - h_f)$.

#### Finding 7.1.3: False Positives in Fuzzy Matching on Dual-Class Shares
* **Severity:** **Major**
* **Affected Scope:** Section 1.D (Lines 241–245)
* **Finding & Recommendation:**
  Line 244 specifies: *"High-confidence matches ($\ge 90\%$) are accepted automatically."* Token-sort Levenshtein distances exceeding 90% frequently occur between distinct share classes or corporate entities that share common names:
  - `Alphabet Inc Class A` (`GOOGL`, Voting) vs `Alphabet Inc Class C` (`GOOG`, Non-Voting) have similarity $>95\%$.
  - `Berkshire Hathaway Inc Class A` vs `Berkshire Hathaway Inc Class B` have similarity $>95\%$.
  - `Fonterra Co-operative Group` vs `Fonterra Shareholders' Fund` (`FSF`).
  Automating acceptance at $\ge 90\%$ without ticker or share-class qualifier checks will silently misassign ISINs and collapse distinct holdings.
  * **Recommendation:** Mandate share-class token disambiguation (e.g., `Class A`, `Class C`, `Ord`, `Pref`, `Units`) prior to fuzzy matching. Require that any match where multiple candidates share the same corporate stem (or where similarity difference between top-1 and top-2 candidates is $<10\%$) be routed to `unresolved_entries.json` for human review.

#### Finding 7.1.4: Monolithic Dataset Footprint & Mobile Memory
* **Severity:** **Major**
* **Affected Scope:** Section 2 & Section 3.A (Lines 134–154, 272–275, 313–314)
* **Finding & Recommendation:**
  Distributing full `constituents.json` and shipping `security_master.json` for direct equity autocomplete introduces $>12,000$ records with ISINs, tickers, company names, and GICS sectors (approx. 2.5MB–4MB uncompressed JSON). Downloading and parsing multi-megabyte JSON payloads on mobile devices on GitHub Pages re-introduces browser memory and performance bottlenecks.
  * **Recommendation:**
    - Split `security_master.json`: Provide a lightweight client-side search index containing only NZX and ASX listings (~2,400 records, ~200KB) for direct equity autocomplete.
    - Structure `constituents.json` into columnar arrays or per-fund chunks loaded on-demand.

#### Finding 7.1.5: Currency Mismatch on ASX Direct Equities
* **Severity:** **Major**
* **Affected Scope:** Goals (Line 46), CUJ 4 (Lines 87–93), Section 3.A (Line 314)
* **Finding & Recommendation:**
  The design allows entering ASX shares directly (e.g. `BHP.AX`) but requires the value in NZD. ASX shares trade in AUD, and NZ brokerage statements often display ASX holdings in AUD. Because Non-Goals specifies "No Real-Time or Intraday Pricing", no FX conversion mechanism is defined.
  * **Recommendation:** Provide an AUD/NZD toggle, or include a daily/static build-time AUD/NZD benchmark exchange rate in `funds_registry.json` so users can enter ASX holdings in AUD without manual math.

#### Finding 7.1.6: Derivative Liabilities & Negative Hedging Values
* **Severity:** **Major**
* **Affected Scope:** Section 1.F (Line 271) & Section 2.A (Lines 283–299)
* **Finding & Recommendation:**
  In currency-hedged funds, forward foreign exchange contracts routinely hold negative net asset values during foreign currency depreciation against NZD (unrealized forward liabilities), yielding $h_f < 0$. If $h_f = -0.05$, the multiplier $(1 - c_f - h_f)$ evaluates to $(1 - c_f + 0.05) > 1.0$, inflating underlying equity weights beyond the fund's gross equity assets.
  * **Recommendation:** Clarify whether gross equity constituent weights are extracted directly from the provider's equity portfolio rather than back-calculated from net hedging balances, and define UI representation for net derivative liabilities in the liquidity summary.

---

## 2. Structural Review (`egm-structural`)

### Findings

#### Finding 7.2.1: Missing Mandatory Section: Risks & Mitigations
* **Severity:** **Blocker**
* **Affected Scope:** Document Root Level (between Lines 440 and 443)
* **Discrepancy & Remediation:** The standard mandates a dedicated risk analysis section. Insert `## Risks & Mitigations` covering Data Integrity, Symbology, Client Performance, and Freshness Skew before line 443.

#### Finding 7.2.2: Heading Hierarchy Asymmetry in Architecture Subsections
* **Severity:** **Major**
* **Affected Scope:** Lines 334–359 (`### 4. Persistence and Data Portability` & `### 5. Administrator Verification`)
* **Discrepancy & Remediation:** Sections 4 and 5 break the H4 alphabetical sub-heading pattern established by Sections 1, 2, 3, and 6. Refactor sections 4 and 5 to adopt standard H4 subheadings (`#### A`, `#### B`, etc.).

#### Finding 7.2.3: Section Naming Deviation (`## The Problem` vs `## Problem Statement`)
* **Severity:** **Nit**
* **Affected Scope:** Line 21
* **Discrepancy & Remediation:** Rename `## The Problem` to `## Problem Statement` for exact standard alignment.

#### Finding 7.2.4: Maintainer Attribution in Rejection Rationales
* **Severity:** **Nit**
* **Affected Scope:** Lines 386–440 (`### Alternative A–F`)
* **Discrepancy & Remediation:** Rephrase `Reason for Rejection: Rejected by author — [rationale]` to `Reason for Rejection: [technical rationale]`.

#### Finding 7.2.5: Section Demarcation at Implementation Boundary
* **Severity:** **Nit**
* **Affected Scope:** Lines 440–442
* **Discrepancy & Remediation:** Ensure clean horizontal rule dividers around the new `## Risks & Mitigations` section.

---

## 3. Style & Copy Editor Review (`egm-style`)

### Findings

#### Finding 7.3.1: Redundant Meta-Commentary in Overview
* **Severity:** **Major**
* **Affected Scope:** Overview (Line 15)
* **Style Finding:** The sentence *"Reconciling overlapping holdings and unwrapping multi-tier feeders is a critical capability, but the primary function is enabling investors to see their complete consolidated asset allocation across all combined funds at their personal investment amounts."* introduces subjective praise and repeats earlier statements.
* **Suggested Revision:** Remove the third sentence of line 15.

#### Finding 7.3.2: Rhetorical and Pejorative Framing
* **Severity:** **Major**
* **Affected Scope:** Lines 11, 13, 32
* **Style Finding:** "true underlying company", "true concentration", and "Naively dropping these assets" introduce subjective and rhetorical framing.
* **Suggested Revision:** Replace with objective language: "underlying company", "higher aggregate company concentration than individual fund reports indicate", and "Omitting these non-equity assets".

#### Finding 7.3.3: First-Person Pronouns & Promotional Buzzwords
* **Severity:** **Nit**
* **Affected Scope:** Lines 46, 204, 244, 313, 318, 357–358
* **Style Finding:** "We do not require" (first person), "seamlessly", "Clean", "Matching prototype layout", "Borderline matches", and "ready-to-paste".
* **Suggested Revision:** Convert to dry, objective engineering phrasing (e.g. "The pipeline does not require", remove "seamlessly", change "Clean numeric inputs" to "Numeric input fields").

