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

function assertNear(actual: number, expected: number, tolerance: number, message: string): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ~${expected} (±${tolerance}), got ${actual}`);
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
    'Portfolio-aware mode subtracts fund holdings from each stock target so combined holding matches Target Holding',
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
      assertNear(
        cen.targetAllocationNZD,
        cen.baselineTargetNZD - 4500,
        0.01,
        'CEN.NZ direct target should equal exact index slice minus $4,500 fund holding'
      );
      assertNear(
        cen.targetAllocationNZD + cen.existingIndirectNZD,
        50000 * cen.normalizedSleeveWeight,
        0.01,
        'CEN.NZ combined exposure should match exact index slice of $50,000'
      );
      assertTrue(plan.overlapCount === 1, `Expected overlapCount === 1, got ${plan.overlapCount}`);
      assertNear(
        plan.totalAllocatedNZD,
        45500,
        0.01,
        'Total direct buys should be $50,000 target minus $4,500 already held in funds'
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
  [
    'Portfolio-aware mode caps over-held fund stock at $0 direct without shrinking other stocks',
    async () => {
      const plan = generateReplicationPlan({
        model: REPLICATOR_INDEX_MODELS[0],
        constituents: [
          { isin: 'NZSPKE0001S2', name: 'Spark NZ', ticker: 'SPK.NZ', country: 'New Zealand', sector: 'Communication Services', weight: 0.5, asset_class: 'equity' },
          { isin: 'NZCENE0001S6', name: 'Contact Energy', ticker: 'CEN.NZ', country: 'New Zealand', sector: 'Utilities', weight: 0.5, asset_class: 'equity' },
        ],
        depth: 2,
        budgetNZD: 20000,
        mode: 'portfolio_aware',
        existingDirectHoldings: [],
        lookThroughHoldings: [
          {
            isin: 'NZSPKE0001S2', name: 'Spark NZ', ticker: 'SPK.NZ', country: 'New Zealand', sector: 'Communication Services',
            assetClass: 'equity', valueNZD: 12000, portfolioWeight: 0.12, equityWeight: 0.12,
            sources: [{ sourceType: 'fund', fundCode: 'FNZ', fundName: 'NZ Top 50', valueNZD: 12000 }],
          },
          {
            isin: 'NZCENE0001S6', name: 'Contact Energy', ticker: 'CEN.NZ', country: 'New Zealand', sector: 'Utilities',
            assetClass: 'equity', valueNZD: 2000, portfolioWeight: 0.02, equityWeight: 0.02,
            sources: [{ sourceType: 'fund', fundCode: 'FNZ', fundName: 'NZ Top 50', valueNZD: 2000 }],
          },
        ],
        directCatalog: [],
        pricesByTicker: { 'SPK.NZ': 4.0, 'CEN.NZ': 8.0 },
        audNzdRate: 1.09,
      });

      // Exact index slices of $20,000 are $10,000 each.
      // SPK already has $12,000 in funds -> $0 direct; CEN has $2,000 in funds -> $8,000 direct.
      assertNear(plan.rows[0].targetAllocationNZD, 0, 0.01, 'Over-held SPK direct target should be $0');
      assertNear(plan.rows[1].targetAllocationNZD, 8000, 0.01, 'CEN direct target should top up to $10k slice');
      assertNear(plan.totalAllocatedNZD, 8000, 0.01, 'Total direct allocation should be $8,000');
    },
  ],
  [
    'Drift band uses live priceNZD rather than stale saved holding price',
    async () => {
      const plan = generateReplicationPlan({
        model: REPLICATOR_INDEX_MODELS[0],
        constituents: [
          { isin: 'NZMELE0002S7', name: 'Meridian Energy', ticker: 'MEL.NZ', country: 'New Zealand', sector: 'Utilities', weight: 1.0, asset_class: 'equity' },
        ],
        depth: 1,
        budgetNZD: 5050,
        mode: 'standalone',
        existingDirectHoldings: [
          { isin: 'NZMELE0002S7', name: 'Meridian Energy', ticker: 'MEL.NZ', exchange: 'NZX', country: 'New Zealand', sector: 'Utilities', currency: 'NZD', shares: 1000, price: 5.0, value: 5000 },
        ],
        lookThroughHoldings: [],
        directCatalog: [],
        pricesByTicker: { 'MEL.NZ': 6.0 },
        audNzdRate: 1.09,
      });

      // At live price $6, 1000 shares = $6000 vs $5050 target (+18.8% overweight) -> must SELL, not HOLD
      assertTrue(plan.rows[0].action === 'SELL', `Expected SELL on live overweight, got ${plan.rows[0].action}`);
      assertTrue(!plan.rows[0].driftSuppressed, 'Drift must not be suppressed based on stale $5 price');
    },
  ],
  [
    'Dual-listed NZX holding does not pollute ASX model price or match across exchanges',
    async () => {
      const asdModel = REPLICATOR_INDEX_MODELS.find((m) => m.code === 'ASD')!;
      const plan = generateReplicationPlan({
        model: asdModel,
        constituents: [
          { isin: 'AU000000ANZ3', name: 'ANZ Group', ticker: 'ANZ.AX', country: 'Australia', sector: 'Financials', weight: 1.0, asset_class: 'equity' },
        ],
        depth: 1,
        budgetNZD: 10000,
        mode: 'standalone',
        existingDirectHoldings: [
          { isin: 'NZANZE0001S0', name: 'ANZ NZ', ticker: 'ANZ.NZ', exchange: 'NZX', country: 'New Zealand', sector: 'Financials', currency: 'NZD', shares: 100, price: 33.0, value: 3300 },
        ],
        lookThroughHoldings: [],
        directCatalog: [],
        pricesByTicker: {},
        audNzdRate: 1.1,
      });

      assertTrue(plan.rows[0].existingDirectShares === 0, 'ANZ.NZ must not match ANZ.AX');
      assertTrue(plan.rows[0].priceNative === 0, 'NZD price must not leak into AUD row');
    },
  ],
  [
    'Zero budget produces 0 active trades and no bogus BUY $0 lines in trade list',
    async () => {
      const plan = generateReplicationPlan({
        model: REPLICATOR_INDEX_MODELS[0],
        constituents: [
          { isin: 'NZSPKE0001S2', name: 'Spark NZ', ticker: 'SPK.NZ', country: 'New Zealand', sector: 'Communication Services', weight: 1.0, asset_class: 'equity' },
        ],
        depth: 1,
        budgetNZD: 0,
        mode: 'standalone',
        existingDirectHoldings: [],
        lookThroughHoldings: [],
        directCatalog: [],
        pricesByTicker: {},
        audNzdRate: 1.09,
      });

      assertTrue(plan.breakeven.activeTradeCount === 0, `Expected 0 trades on $0 budget, got ${plan.breakeven.activeTradeCount}`);
      const text = formatTradeOrderList(plan);
      assertTrue(!text.includes('BUY SPK.NZ'), 'Must not emit bogus BUY line on $0 budget');
      assertTrue(text.includes('No trades required'), 'Should indicate no trades required');
    },
  ],
  [
    'Dual-listed SEDOL in directCatalog keeps NZX ticker/currency and matches direct NZX holdings',
    () => {
      const divModel = REPLICATOR_INDEX_MODELS.find((m) => m.code === 'DIV')!;
      const plan = generateReplicationPlan({
        model: divModel,
        constituents: [
          { isin: 'SEDOL:BWFD052', name: 'Meridian Energy Limited', ticker: 'MEL.NZ', country: 'New Zealand', sector: 'Utilities', weight: 1.0, asset_class: 'equity' },
        ],
        depth: 1,
        budgetNZD: 10000,
        mode: 'portfolio_aware',
        existingDirectHoldings: [
          { isin: 'SEDOL:BWFD052', name: 'Meridian Energy Limited', ticker: 'MEL.NZ', exchange: 'NZX', country: 'New Zealand', sector: 'Utilities', currency: 'NZD', shares: 500, price: 6.0, value: 3000 },
        ],
        lookThroughHoldings: [],
        directCatalog: [
          { isin: 'SEDOL:BWFD052', name: 'Meridian Energy Limited', ticker: 'MEL.NZ', exchange: 'NZX', country: 'New Zealand', sector: 'Utilities' },
          { isin: 'SEDOL:BWFD052', name: 'MERIDIAN ENERGY LIMITED', ticker: 'MEZ.AX', exchange: 'ASX', country: 'Australia', sector: 'Utilities' },
        ],
        pricesByTicker: {},
        audNzdRate: 1.1,
      });

      const row = plan.rows[0];
      assertTrue(row.ticker === 'MEL.NZ', `Expected MEL.NZ, got ${row.ticker}`);
      assertTrue(row.exchange === 'NZX' && row.currency === 'NZD', `Expected NZX/NZD, got ${row.exchange}/${row.currency}`);
      assertNear(row.existingDirectNZD, 3000, 0.01, 'Direct MEL.NZ holding should be valued at $3,000 NZD');
      assertNear(row.priceNative, 6.0, 0.01, 'Should resolve NZD price from existing direct holding');
      assertTrue(row.action === 'BUY' && row.deltaShares === Math.floor(10000 / 6) - 500, `Expected BUY delta shares, got ${row.action} ${row.deltaShares}`);
    },
  ],
  [
    'Portfolio-aware mode includes holdings from the target ETF itself (e.g. DIV ETF)',
    () => {
      const divModel = REPLICATOR_INDEX_MODELS.find((m) => m.code === 'DIV')!;
      const plan = generateReplicationPlan({
        model: divModel,
        constituents: [
          { isin: 'SEDOL:BWFD052', name: 'Meridian Energy Limited', ticker: 'MEL.NZ', country: 'New Zealand', sector: 'Utilities', weight: 1.0, asset_class: 'equity' },
        ],
        depth: 1,
        budgetNZD: 10000,
        mode: 'portfolio_aware',
        existingDirectHoldings: [],
        lookThroughHoldings: [
          {
            isin: 'SEDOL:BWFD052',
            name: 'Meridian Energy Limited',
            ticker: 'MEL.NZ',
            country: 'New Zealand',
            sector: 'Utilities',
            assetClass: 'equity',
            valueNZD: 4000,
            portfolioWeight: 0.04,
            equityWeight: 0.04,
            sources: [{ sourceType: 'fund', fundCode: 'DIV', fundName: 'Smartshares NZ Dividend ETF', valueNZD: 4000 }],
          },
        ],
        directCatalog: [],
        pricesByTicker: { 'MEL.NZ': 6.0 },
        audNzdRate: 1.09,
      });

      assertNear(plan.rows[0].existingIndirectNZD, 4000, 0.01, 'DIV ETF holding should count in Held in Funds');
      assertNear(plan.rows[0].targetAllocationNZD, 6000, 0.01, 'Direct buy target should top up remaining $6,000');
    },
  ],
  [
    'Portfolio-aware drift band suppresses tiny cash-drag micro-buys when ETF already covers target within ±2.5%',
    () => {
      const divModel = REPLICATOR_INDEX_MODELS.find((m) => m.code === 'DIV')!;
      const plan = generateReplicationPlan({
        model: divModel,
        constituents: [
          { isin: 'SEDOL:6152529', name: 'Contact Energy Limited', ticker: 'CEN.NZ', country: 'New Zealand', sector: 'Utilities', weight: 0.9964, asset_class: 'equity' },
        ],
        depth: 1,
        budgetNZD: 100000,
        mode: 'portfolio_aware',
        existingDirectHoldings: [],
        lookThroughHoldings: [
          {
            isin: 'SEDOL:6152529',
            name: 'Contact Energy Limited',
            ticker: 'CEN.NZ',
            country: 'New Zealand',
            sector: 'Utilities',
            assetClass: 'equity',
            valueNZD: 99640,
            portfolioWeight: 0.9964,
            equityWeight: 1.0,
            sources: [{ sourceType: 'fund', fundCode: 'DIV', fundName: 'Smartshares NZ Dividend ETF', valueNZD: 99640 }],
          },
        ],
        directCatalog: [],
        pricesByTicker: { 'CEN.NZ': 8.75 },
        audNzdRate: 1.09,
      });

      assertTrue(plan.rows[0].action === 'HOLD', `Expected HOLD within ±2.5% drift band, got ${plan.rows[0].action}`);
      assertTrue(plan.rows[0].driftSuppressed, 'Expected driftSuppressed to be true');
      assertTrue(plan.rows[0].deltaShares === 0, `Expected 0 deltaShares, got ${plan.rows[0].deltaShares}`);
    },
  ],
];
