/**
 * Utility functions for parsing and validating Sorted Smart Investor and Disclose register fund URLs.
 */

export interface ParsedSmartInvestorUrl {
  isValid: boolean;
  schemeId?: string;
  offerId?: string;
  fundId?: string;
  isDirectXlsx?: boolean;
  message?: string;
}

export function parseAndValidateFundUrl(url: string): ParsedSmartInvestorUrl {
  const trimmed = (url || '').trim();
  if (!trimmed) {
    return { isValid: false };
  }

  // 1. Direct Disclose / Sorted .xlsx download URL
  if (/\.xlsx?($|\?)/i.test(trimmed)) {
    const fndMatch = trimmed.match(/(FND\d+)/i);
    return {
      isValid: true,
      fundId: fndMatch ? fndMatch[1].toUpperCase() : undefined,
      isDirectXlsx: true,
      message: 'Direct holdings spreadsheet (.xlsx) link detected',
    };
  }

  // 2. Canonical Sorted Smart Investor scheme/offer/fund URL
  // e.g. https://www.smartinvestor.sorted.org.nz/kiwisaver-and-managed-funds/SCH10713/OFR10715/FND555/
  const m = trimmed.match(/(SCH\d+)\/(OFR\d+)\/(FND\d+)/i);
  if (m) {
    return {
      isValid: true,
      schemeId: m[1].toUpperCase(),
      offerId: m[2].toUpperCase(),
      fundId: m[3].toUpperCase(),
      isDirectXlsx: false,
      message: `Verified Sorted Scheme (${m[1].toUpperCase()} · ${m[2].toUpperCase()} · ${m[3].toUpperCase()})`,
    };
  }

  // 3. FND code only
  const fndOnly = trimmed.match(/^(FND\d+)$/i);
  if (fndOnly) {
    return {
      isValid: true,
      fundId: fndOnly[1].toUpperCase(),
      message: `Valid Disclose Fund ID (${fndOnly[1].toUpperCase()})`,
    };
  }

  return {
    isValid: false,
    message: 'Link format not recognized. Must contain SCH..., OFR..., and FND... or direct .xlsx download link',
  };
}
