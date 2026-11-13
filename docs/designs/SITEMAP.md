# Design Documents

| Document | Date | Author | Status | Description |
|---|---|---|---|---|
| [Kiwi Portfolio X-Ray](kiwi-portfolio-xray.md) | 2026-11-08 | SusanJaneNZ | Approved | Static browser-based portfolio look-through tool for NZ retail investors across Smartshares ETFs, Kernel unlisted funds, and direct NZX/ASX holdings. |
| [Asset Split, Term Deposits, Bond Funds & Bucket Rebalancer](asset-split-bonds-tds.md) | 2026-11-11 | SusanJaneNZ | Implemented | Enhancement adding Term Deposits/Cash (`v2` schema), `sorted_parser.py` + row-by-row Bond & Multi-Asset decomposition, Asset Class Split, upstream `issuer_key` cross-asset rollup, Withdrawal-First Bucket Rebalancer, and continuous repo-root background persistence. |
| [Retirement Cashflow, Fixed Interest & Future Roadmap](retirement-cashflow-and-roadmap.md) | 2026-11-14 | SusanJaneNZ | Proposed | Future roadmap addressing units/share counts, direct bonds & PIE term deposits, organic retirement income projections, self-managed indexing, automated Disclose Register ingestion, and milestone bucket drift tracking. |
| [Phase 1 (Units & Fixed Interest) & Phase 2 (Automated Ingestion Pipeline)](phase1-fixed-interest-phase2-automated-pipeline.md) | 2026-11-14 | SusanJaneNZ | Under Review | Concrete technical specification for Units/Shares dual input, Fixed Interest Panel (Direct Bonds + PIE/RWT TDs), and automated Disclose Register/Smart Investor crawler & pipeline build. |
