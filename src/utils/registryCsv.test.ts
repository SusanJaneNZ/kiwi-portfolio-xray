import { DirectEquityCatalogItem } from '../types/portfolio';
import { parseRegistryCsv } from './registryCsv';

function assertTrue(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertNear(actual: number, expected: number, tol: number, message: string): void {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${message}: expected ~${expected} (±${tol}), got ${actual}`);
  }
}

const SAMPLE_CATALOG: DirectEquityCatalogItem[] = [
  {
    isin: 'NZX:AGG',
    name: 'Smart Global Aggregate Bond ETF',
    ticker: 'AGG.NZ',
    exchange: 'NZX',
    country: 'New Zealand',
    sector: 'Fixed Income',
    isEtf: true,
    fundCode: 'AGG',
  },
  {
    isin: 'NZAIAD0001S5',
    name: 'Auckland International Airport Limited',
    ticker: 'AIA.NZ',
    exchange: 'NZX',
    country: 'New Zealand',
    sector: 'Industrials',
  },
  {
    isin: 'AU0000023701',
    name: 'BetaShares Asia Technology Tigers ETF',
    ticker: 'ASIA.AX',
    exchange: 'ASX',
    country: 'Australia',
    sector: 'ETF',
    isEtf: true,
    fundCode: 'ASIA',
  },
  {
    isin: 'SEDOL:6152529',
    name: 'Contact Energy Limited',
    ticker: 'CEN.NZ',
    exchange: 'NZX',
    country: 'New Zealand',
    sector: 'Utilities',
  },
  {
    isin: 'SEDOL:6152529',
    name: 'CONTACT ENERGY LIMITED',
    ticker: 'CEN.AX',
    exchange: 'ASX',
    country: 'Australia',
    sector: 'Utilities',
  },
];

export const registryCsvTestCases: Array<[string, () => void]> = [
  [
    'parseRegistryCsv parses NZ registry CSV with preamble, double-spaced header, and skips 0-balance rows',
    () => {
      const csv = [
        'View name:,"All Holdings"',
        '',
        '',
        'CSN/HRN,Registered Details,Security Code,Dividend,Last Close (NZD),Tradeable  Balance,Value NZD',
        '330609xxxx,SAMPLE INVESTOR,AGG,False,1.185,12406,14701.11',
        '330609xxx,SAMPLE INVESTOR,AIA,False,9.09,0,0.00',
      ].join('\n');

      const res = parseRegistryCsv(csv, SAMPLE_CATALOG);
      assertTrue(res.warnings.length === 0, `Unexpected warnings: ${res.warnings.join('; ')}`);
      assertTrue(res.skippedZeroBalance === 1, `Expected 1 skipped zero-balance row, got ${res.skippedZeroBalance}`);
      assertTrue(res.items.length === 1, `Expected 1 imported holding, got ${res.items.length}`);

      const agg = res.items[0];
      assertTrue(agg.matchedCatalog, 'AGG should match catalog');
      assertTrue(agg.holding.ticker === 'AGG.NZ', `Expected AGG.NZ, got ${agg.holding.ticker}`);
      assertTrue(agg.holding.exchange === 'NZX' && agg.holding.currency === 'NZD', 'Expected NZX/NZD');
      assertTrue(agg.holding.isEtf === true && agg.holding.fundCode === 'AGG', 'Expected AGG ETF metadata');
      assertNear(agg.holding.shares, 12406, 0.001, 'Shares');
      assertNear(agg.holding.price, 1.185, 0.0001, 'Price');
      assertNear(agg.holding.value, 14701.11, 0.01, 'Value');
    },
  ],
  [
    'parseRegistryCsv parses AU registry CSV (Holding number / Last Close (AUD) / Balance) and matches ASX ETF',
    () => {
      const csv = [
        'Holding number,Registered Details,Security Code,Dividend,Last Close (AUD),Balance,Value AUD',
        'X*******5436,SAMPLE INVESTOR,ASIA,False,15.64,1800,28152.00',
      ].join('\n');

      const res = parseRegistryCsv(csv, SAMPLE_CATALOG);
      assertTrue(res.items.length === 1, `Expected 1 holding, got ${res.items.length}`);
      const asia = res.items[0];
      assertTrue(asia.matchedCatalog, 'ASIA should match catalog');
      assertTrue(asia.holding.ticker === 'ASIA.AX', `Expected ASIA.AX, got ${asia.holding.ticker}`);
      assertTrue(asia.holding.exchange === 'ASX' && asia.holding.currency === 'AUD', 'Expected ASX/AUD');
      assertTrue(asia.holding.isEtf === true && asia.holding.fundCode === 'ASIA', 'Expected ASIA ETF metadata');
      assertNear(asia.holding.shares, 1800, 0.001, 'Shares');
      assertNear(asia.holding.price, 15.64, 0.001, 'Price');
    },
  ],
  [
    'parseRegistryCsv handles multi-table NZD+AUD CSV, quoted commas, dual-listed tickers, and duplicate rows',
    () => {
      const csv = [
        'CSN/HRN,Security Code,Last Close (NZD),Tradeable  Balance,Value NZD',
        '111,CEN,"$8.75","1,000","$8,750.00"',
        '222,CEN,8.75,500,4375.00',
        '',
        'Holding number,Security Code,Last Close (AUD),Balance,Value AUD',
        'X123,CEN,8.00,200,1600.00',
        'X124,NEWCO,2.50,400,1000.00',
      ].join('\n');

      const res = parseRegistryCsv(csv, SAMPLE_CATALOG);
      assertTrue(res.detectedHeaders === 2, `Expected 2 header sections, got ${res.detectedHeaders}`);
      assertTrue(res.items.length === 3, `Expected 3 merged items, got ${res.items.length}`);

      const cenNz = res.items.find((i) => i.holding.ticker === 'CEN.NZ')!;
      const cenAx = res.items.find((i) => i.holding.ticker === 'CEN.AX')!;
      const newco = res.items.find((i) => i.holding.ticker === 'NEWCO.AX')!;

      assertNear(cenNz.holding.shares, 1500, 0.001, 'Duplicate CEN.NZ rows should sum to 1500');
      assertTrue(cenNz.sourceRowCount === 2, 'CEN.NZ sourceRowCount should be 2');
      assertNear(cenAx.holding.shares, 200, 0.001, 'CEN.AX kept separate from CEN.NZ');
      assertTrue(!newco.matchedCatalog && newco.holding.currency === 'AUD', 'Unknown ASX ticker falls back cleanly');
    },
  ],
  [
    'parseRegistryCsv reports helpful warning when CSV has no recognised headers',
    () => {
      const res = parseRegistryCsv('foo,bar\n1,2', SAMPLE_CATALOG);
      assertTrue(res.items.length === 0, 'Should return 0 items');
      assertTrue(res.warnings.length === 1, 'Should return 1 warning');
    },
  ],
];
