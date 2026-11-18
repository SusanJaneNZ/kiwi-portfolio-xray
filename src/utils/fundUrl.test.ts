import { parseAndValidateFundUrl } from './fundUrl';

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertTrue(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

export const fundUrlTestCases: [string, () => void][] = [
  [
    'parseAndValidateFundUrl validates canonical Sorted Smart Investor scheme URL',
    () => {
      const url =
        'https://www.smartinvestor.sorted.org.nz/kiwisaver-and-managed-funds/SCH10713/OFR10715/FND555/';
      const result = parseAndValidateFundUrl(url);
      assertTrue(result.isValid, 'should be valid');
      assertEq(result.schemeId, 'SCH10713', 'schemeId matches');
      assertEq(result.offerId, 'OFR10715', 'offerId matches');
      assertEq(result.fundId, 'FND555', 'fundId matches');
      assertEq(result.isDirectXlsx, false, 'not direct xlsx');
      assertTrue(result.message?.includes('SCH10713') ?? false, 'message includes scheme');
    },
  ],
  [
    'parseAndValidateFundUrl validates direct xlsx download links',
    () => {
      const url =
        'https://www.smartinvestor.sorted.org.nz/disclose-document/full-portfolio/FND555/GROWTH-FUND-FND555-Full-portfolio-holdings-30-September-2026.xlsx';
      const result = parseAndValidateFundUrl(url);
      assertTrue(result.isValid, 'should be valid');
      assertEq(result.fundId, 'FND555', 'fundId matches');
      assertEq(result.isDirectXlsx, true, 'is direct xlsx');
    },
  ],
  [
    'parseAndValidateFundUrl validates standalone FND code',
    () => {
      const result = parseAndValidateFundUrl('FND1449');
      assertTrue(result.isValid, 'should be valid');
      assertEq(result.fundId, 'FND1449', 'fundId matches');
    },
  ],
  [
    'parseAndValidateFundUrl rejects invalid or empty strings gracefully',
    () => {
      const empty = parseAndValidateFundUrl('');
      assertEq(empty.isValid, false, 'empty is invalid');

      const garbage = parseAndValidateFundUrl('https://example.com/not-a-fund');
      assertEq(garbage.isValid, false, 'garbage is invalid');
      assertTrue(garbage.message?.includes('Link format not recognized') ?? false, 'message gives guidance');
    },
  ],
];
