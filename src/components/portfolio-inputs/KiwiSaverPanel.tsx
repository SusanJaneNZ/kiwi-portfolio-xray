/**
 * KiwiSaver & Custom Funds have been unified into FundAllocationsPanel ("2. Managed Funds & KiwiSaver (in NZD)").
 * This file re-exports the unified panel for backward compatibility.
 */
export { FundAllocationsPanel as KiwiSaverPanel, parseAndValidateFundUrl } from './FundAllocationsPanel';
export type { ParsedSmartInvestorUrl } from './FundAllocationsPanel';
