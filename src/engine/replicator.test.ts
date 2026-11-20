import {
  REPLICATOR_INDEX_MODELS,
  calculateBreakevenMetrics,
  formatTradeOrderList,
  generateReplicationPlan,
} from './replicator';
import { ConsolidatedHolding, Constituent, DirectHolding } from '../types/portfolio';

function assertTrue(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

const SAMPLE_DIV_CONSTITUENTS: Constituent[] = [
  { isin: 'NZMELE0002S7', name: 'Meridian Energy Limited', ticker: 'MEL.NZ', country: 'New Zealand', sector: 'Utilities', weight: 0.0969, asset_class: 'equity' },
  { isin: 'NZMCYE0001S8', name: 'Mercury NZ Limited', ticker: 'MCY.NZ', country: 'New Zealand', sector: 'Utilities', weight: 0.093, asset_class: 'equity' },
  { isin: 'NZCENE0001S6', name: 'Contact Energy Limited', ticker: 'CEN.NZ', country: 'New Zealand', sector: 'Utilities', weight: 0.093, asset_class: 'equity' },
  { isin: 'NZCNUE0001S2', name: 'Chorus Limited', ticker: 'CNU.NZ', country: 'New Zealand', sector: 'Communication Services', weight: 0.0884, asset_class: 'equity' },
  { isin: 'NZAPTE0001S3', name: 'Precinct Properties Group', ticker: 'PCT.NZ', country: 'New Zealand', sector: 'Real Estate', weight: 0.0625, asset_class: 'equity' },
  { isin: 'NZFCGE0001S7', name: 'Fonterra Co-operative Group', ticker: 'FCG.NZ', country: 'New Zealand', sector: 'Consumer Staples', weight: 0.0543, asset_class: 'equity' },
  { isin: 'NZGNEE0001S7', name: 'Genesis Energy Limited', ticker: 'GNE.NZ', country: 'New Zealand', sector: 'Utilities', weight: 0.0507, asset_class: 'equity' },
  { isin: 'NZKPGE0001S9', name: 'Kiwi Property Group Limited', ticker: 'KPG.NZ', country: 'New Zealand', sector: 'Real Estate', weight: 0.0489, asset_class: 'equity' },
  { isin: 'NZTWRE0011S2', name: 'Tower Limited', ticker: 'TWR.NZ', country: 'New Zealand', sector: 'Financials', weight: 0.0434, asset_class: 'equity' },
  { isin: 'NZSKXE0001S8', name: 'Skellerup Holdings Limited', ticker: 'SKL.NZ', country: 'New Zealand', sector: 'Industrials', weight: 0.0353, asset_class: 'equity' },
];

const SAMPLE_PRICES: Record<string, number> = {
  'MEL.NZ': 6.0,
  'MCY.NZ': 6.6,
  'CEN.NZ': 8.5,
  'CNU.NZ': 8.8,
  'PCT.NZ': 1.2,
  'FCG.NZ': 4.2,
  'GNE.NZ': 2.2,
  'KPG.NZ': 0.85,
};

export const replicatorTestCases: Array<[string, () => void]> = [
  [
    'Replicator re-normalizes top-K constituent weights to exactly 1.0',
    () => {
      const divModel = REPLICATOR_INDEX_MODELS.find((m) => m.code === 'DIV')!;
      const plan = generateReplicationPlan({
        model: divModel,
        constituents: SAMPLE_DIV_CONSTITUENTS,
        depth: 8,
        budgetNZD: 50000,
        mode: 'standalone',
        existingDirectHoldings: [],
        lookThroughHoldings: [],
        directCatalog: [],
        pricesByTicker: SAMPLE_PRICES,
        audNzdRate: 1.09,
      });

      assertTrue(plan.rows.length === 8, `Expected 8 rows, got ${plan.rows.length}`);
      const normSum = plan.rows.reduce((acc, r) => acc + r.normalizedSleeveWeight, 0);
      assertTrue(Math.abs(normSum - 1.0) < 1e-6, `Normalized weight sum should be 1.0, got ${normSum}`);
      assertTrue(Math.abs(plan.totalAllocatedNZD - 50000) < 0.01, `Allocated budget mismatch: ${plan.totalAllocatedNZD}`);
      for (const r of plan.rows) {
        assertTrue(Number.isInteger(r.targetShares), `Target shares must be integer for ${r.ticker}`);
        assertTrue(r.targetShares * r.priceNZD <= r.targetAllocationNZD + 0.01, `Discrete buy exceeds target for ${r.ticker}`);
      }
    },
  ],
  [
    'Whole-portfolio overlap guard trims KiwiSaver-held company and redistributes budget without exceeding total',
    () => {
      const divModel = REPLICATOR_INDEX_MODELS.find((m) => m.code === 'DIV')!;
      const lookThrough: ConsolidatedHolding[] = [
        {
          isin: 'NZCENE0001S6',
          name: 'Contact Energy Limited',
          ticker: 'CEN.NZ',
          country: 'New Zealand',
          sector: 'Utilities',
          assetClass: 'equity',
          valueNZD: 4500,
          portfolioWeight: 0.045,
          equityWeight: 0.06,
          sources: [
            {
              sourceType: 'fund',
              fundCode: 'SIMPLICITY_KIWISAVER_GROWTH',
              fundName: 'Simplicity KiwiSaver Growth Fund',
              valueNZD: 4500,
            },
          ],
        },
      ];

      const plan = generateReplicationPlan({
        model: divModel,
        constituents: SAMPLE_DIV_CONSTITUENTS,
        depth: 8,
        budgetNZD: 50000,
        mode: 'portfolio_aware',
        existingDirectHoldings: [],
        lookThroughHoldings: lookThrough,
        directCatalog: [],
        pricesByTicker: SAMPLE_PRICES,
        audNzdRate: 1.09,
      });

      const cen = plan.rows.find((r) => r.ticker === 'CEN.NZ')!;
      assertTrue(cen.overlapTrimmed, 'CEN.NZ should be flagged as overlapTrimmed');
      assertTrue(
        cen.targetAllocationNZD < cen.baselineTargetNZD - 4000,
        `CEN.NZ target should be reduced by ~$4500, got ${cen.targetAllocationNZD} vs baseline ${cen.baselineTargetNZD}`
      );
      assertTrue(plan.overlapCount === 1, `Expected overlapCount === 1, got ${plan.overlapCount}`);
      assertTrue(
        Math.abs(plan.totalAllocatedNZD - 50000) < 0.01,
        `Total allocated should stay $50,000 after redistribution, got ${plan.totalAllocatedNZD}`
      );
    },
  ],
  [
    'Inactivity drift band (±2.5%) suppresses unnecessary micro-trades on existing holdings',
    () => {
      const divModel = REPLICATOR_INDEX_MODELS.find((m) => m.code === 'DIV')!;
      const existingDirect: DirectHolding[] = [
        {
          isin: 'NZMELE0002S7',
          name: 'Meridian Energy Limited',
          ticker: 'MEL.NZ',
          exchange: 'NZX',
          country: 'New Zealand',
          sector: 'Utilities',
          currency: 'NZD',
          shares: 1370,
          price: 6.0,
          value: 8220,
        },
      ];

      const plan = generateReplicationPlan({
        model: divModel,
        constituents: SAMPLE_DIV_CONSTITUENTS,
        depth: 8,
        budgetNZD: 50000,
        mode: 'standalone',
        existingDirectHoldings: existingDirect,
        lookThroughHoldings: [],
        directCatalog: [],
        pricesByTicker: SAMPLE_PRICES,
        audNzdRate: 1.09,
      });

      const mel = plan.rows.find((r) => r.ticker === 'MEL.NZ')!;
      assertTrue(mel.action === 'HOLD', `Expected MEL.NZ to HOLD within drift band, got ${mel.action}`);
      assertTrue(mel.driftSuppressed, 'Expected driftSuppressed to be true');
      assertTrue(mel.deltaShares === 0, `Expected 0 deltaShares, got ${mel.deltaShares}`);
    },
  ],
  [
    'Breakeven payoff mathematics match expected horizons at $15k, $50k, and $100k',
    () => {
      const m50 = calculateBreakevenMetrics(50000, 0.0054, 8, 4.5);
      assertTrue(Math.abs(m50.annualFeeDragNZD - 270) < 0.01, `Expected $270/yr fee drag, got ${m50.annualFeeDragNZD}`);
      assertTrue(Math.abs(m50.estimatedBrokerageNZD - 36) < 0.01, `Expected $36 brokerage, got ${m50.estimatedBrokerageNZD}`);
      assertTrue(Math.abs(m50.breakevenMonths - 1.6) < 0.05, `Expected 1.6 months breakeven, got ${m50.breakevenMonths}`);

      const m15 = calculateBreakevenMetrics(15000, 0.0054, 8, 4.5);
      assertTrue(Math.abs(m15.breakevenMonths - (36 / (81 / 12))) < 0.05, `Unexpected $15k breakeven: ${m15.breakevenMonths}`);

      const m100 = calculateBreakevenMetrics(100000, 0.0054, 8, 4.5);
      assertTrue(m100.breakevenMonths < 1.0, `Expected <1 month breakeven at $100k, got ${m100.breakevenMonths}`);
    },
  ],
  [
    'ASX model (ASD) flags Trans-Tasman FIF exemption and formats clipboard trade list cleanly',
    () => {
      const asdModel = REPLICATOR_INDEX_MODELS.find((m) => m.code === 'ASD')!;
      assertTrue(asdModel.taxBadge.includes('FIF Exempt'), 'ASD model must indicate FIF Exempt status');
      const plan = generateReplicationPlan({
        model: asdModel,
        constituents: [
          { isin: 'AU000000TLS2', name: 'Telstra Group Limited', ticker: 'TLS.AX', country: 'Australia', sector: 'Communication Services', weight: 0.1014, asset_class: 'equity' },
          { isin: 'AU000000WES1', name: 'Wesfarmers Limited', ticker: 'WES.AX', country: 'Australia', sector: 'Consumer Discretionary', weight: 0.0887, asset_class: 'equity' },
        ],
        depth: 2,
        budgetNZD: 20000,
        mode: 'standalone',
        existingDirectHoldings: [],
        lookThroughHoldings: [],
        directCatalog: [],
        pricesByTicker: { 'TLS.AX': 4.0, 'WES.AX': 70.0 },
        audNzdRate: 1.1,
      });

      const text = formatTradeOrderList(plan);
      assertTrue(text.includes('TLS.AX'), 'Trade sheet should include TLS.AX');
      assertTrue(text.includes('BUY'), 'Trade sheet should include BUY instructions');
    },
  ],
];
