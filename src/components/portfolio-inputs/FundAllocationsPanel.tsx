import React, { useMemo, useState } from 'react';
import { CollapsiblePanel } from '../CollapsiblePanel';
import { BucketSelect } from './BucketSelect';
import { DEFAULT_STARTER_BUCKETS, FundAssetClass, FundMetadata, UserPortfolioState } from '../../types/portfolio';
import { ParsedSmartInvestorUrl, parseAndValidateFundUrl } from '../../utils/fundUrl';

export type { ParsedSmartInvestorUrl };
export { parseAndValidateFundUrl };

interface FundAllocationsPanelProps {
  portfolioState: UserPortfolioState;
  fundsRegistry: FundMetadata[];
  totalPortfolioNZD: number;
  fundSumNZD: number;
  onAssignBucket: (instrumentKey: string, bucketId: string) => void;
  onUpdateState: (state: UserPortfolioState) => void;
}

interface PresetFund {
  code: string;
  name: string;
  provider: string;
  assetClass: FundAssetClass;
  isKiwiSaver: boolean;
  url?: string;
}

const PRESET_FUNDS: PresetFund[] = [
  // KiwiSaver Schemes
  {
    code: 'FISHER_KIWISAVER_GROWTH',
    name: 'Fisher Funds KiwiSaver Growth Fund',
    provider: 'Fisher Funds',
    assetClass: 'mixed',
    isKiwiSaver: true,
    url: 'https://www.smartinvestor.sorted.org.nz/kiwisaver-and-managed-funds/SCH10713/OFR10715/FND555/',
  },
  {
    code: 'MILFORD_ACTIVE_GROWTH',
    name: 'Milford KiwiSaver Active Growth Fund',
    provider: 'Milford',
    assetClass: 'mixed',
    isKiwiSaver: true,
    url: 'https://www.smartinvestor.sorted.org.nz/kiwisaver-and-managed-funds/SCH10670/OFR10672/FND1449/',
  },
  {
    code: 'SIMPLICITY_KIWISAVER_GROWTH',
    name: 'Simplicity KiwiSaver Growth Fund',
    provider: 'Simplicity',
    assetClass: 'mixed',
    isKiwiSaver: true,
    url: 'https://www.smartinvestor.sorted.org.nz/kiwisaver-and-managed-funds/SCH11538/OFR11540/FND1981/',
  },
  {
    code: 'KERNEL_HIGH_GROWTH',
    name: 'Kernel KiwiSaver High Growth Fund',
    provider: 'Kernel',
    assetClass: 'mixed',
    isKiwiSaver: true,
    url: 'https://www.smartinvestor.sorted.org.nz/kiwisaver-and-managed-funds/SCH12697/OFR12698/FND37639/',
  },
  {
    code: 'ANZ_KIWISAVER_GROWTH',
    name: 'ANZ KiwiSaver Growth Fund',
    provider: 'ANZ',
    assetClass: 'mixed',
    isKiwiSaver: true,
  },
  {
    code: 'BOOSTER_KIWISAVER_GROWTH',
    name: 'Booster KiwiSaver Socially Responsible High Growth Fund',
    provider: 'Booster',
    assetClass: 'mixed',
    isKiwiSaver: true,
  },
  {
    code: 'GENERATE_GROWTH',
    name: 'Generate KiwiSaver Growth Fund',
    provider: 'Generate',
    assetClass: 'mixed',
    isKiwiSaver: true,
  },
  // Unlisted Managed Index Funds
  {
    code: 'SIMPLICITY_NZ_SHARE',
    name: 'Simplicity NZ Share Fund',
    provider: 'Simplicity',
    assetClass: 'equity',
    isKiwiSaver: false,
  },
  {
    code: 'KERNEL_NZ_20',
    name: 'Kernel NZ 20 Fund',
    provider: 'Kernel',
    assetClass: 'equity',
    isKiwiSaver: false,
  },
  {
    code: 'KERNEL_WORLD_EX_US',
    name: 'Kernel S&P World Ex-U.S. Fund',
    provider: 'Kernel',
    assetClass: 'equity',
    isKiwiSaver: false,
    url: 'https://www.smartinvestor.sorted.org.nz/kiwisaver-and-managed-funds/SCH12697/OFR12698/FND58860/',
  },
  {
    code: 'MILFORD_TRANS_TASMAN',
    name: 'Milford Trans-Tasman Equity Fund',
    provider: 'Milford',
    assetClass: 'equity',
    isKiwiSaver: false,
  },
];

type FundTypeFilter = 'all' | 'kiwisaver' | 'managed';

export const FundAllocationsPanel: React.FC<FundAllocationsPanelProps> = ({
  portfolioState,
  fundsRegistry,
  totalPortfolioNZD,
  fundSumNZD,
  onAssignBucket,
  onUpdateState,
}) => {
  const [filterQuery, setFilterQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<FundTypeFilter>('all');
  const [userToggledHeldOnly, setUserToggledHeldOnly] = useState<boolean | null>(null);
  const isPortfolioEntered = totalPortfolioNZD > 0;
  const heldOnly = isPortfolioEntered ? (userToggledHeldOnly ?? true) : false;

  const [showAddForm, setShowAddForm] = useState(false);

  // Form states for adding custom / unlisted fund
  const [selectedPreset, setSelectedPreset] = useState<string>('FISHER_KIWISAVER_GROWTH');
  const [customName, setCustomName] = useState('Fisher Funds KiwiSaver Growth Fund');
  const [customCode, setCustomCode] = useState('FISHER_KIWISAVER_GROWTH');
  const [customProvider, setCustomProvider] = useState('Fisher Funds');
  const [customAssetClass, setCustomAssetClass] = useState<FundAssetClass>('mixed');
  const [customIsKiwiSaver, setCustomIsKiwiSaver] = useState(true);
  const [customUrl, setCustomUrl] = useState(
    'https://www.smartinvestor.sorted.org.nz/kiwisaver-and-managed-funds/SCH10713/OFR10715/FND555/'
  );
  const [customBalance, setCustomBalance] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const urlValidation = useMemo(() => {
    return parseAndValidateFundUrl(customUrl);
  }, [customUrl]);

  const availableBuckets = useMemo(() => {
    return portfolioState.buckets.length > 0 ? portfolioState.buckets : DEFAULT_STARTER_BUCKETS;
  }, [portfolioState.buckets]);

  const customCodeSet = useMemo(() => {
    const s = new Set<string>();
    for (const c of portfolioState.customFunds || []) {
      s.add(c.code.toUpperCase());
    }
    return s;
  }, [portfolioState.customFunds]);

  // Combine custom funds, static registry funds, and preset funds
  const combinedFunds = useMemo(() => {
    const list: FundMetadata[] = [];
    const seenCodes = new Set<string>();

    // 1. User custom funds (highest priority)
    for (const cf of portfolioState.customFunds || []) {
      const codeUpper = cf.code.toUpperCase();
      if (!seenCodes.has(codeUpper)) {
        seenCodes.add(codeUpper);
        list.push(cf);
      }
    }

    // 2. Static funds registry (exclude pure listed ETFs unless user has existing fund balance)
    for (const rf of fundsRegistry) {
      const codeUpper = rf.code.toUpperCase();
      const isListedEtf =
        rf.provider?.toLowerCase().includes('smartshares') ||
        rf.provider?.toLowerCase().includes('betashares') ||
        Boolean(rf.isEtf);
      const hasBalance = (portfolioState.fundBalances[rf.code] || 0) > 0;
      if (isListedEtf && !hasBalance) continue;

      if (!seenCodes.has(codeUpper)) {
        seenCodes.add(codeUpper);
        list.push(rf);
      }
    }

    // 3. Any remaining custom or legacy code present in fundBalances
    for (const code of Object.keys(portfolioState.fundBalances)) {
      const codeUpper = code.toUpperCase();
      if (!seenCodes.has(codeUpper)) {
        seenCodes.add(codeUpper);
        list.push({
          code: codeUpper,
          name: codeUpper.replace(/_/g, ' '),
          provider: 'Other',
          effective_date: new Date().toISOString().split('T')[0],
          cash_ratio: 0,
          hedging_ratio: 0,
          constituent_count: 0,
          asset_class: 'equity',
        });
      }
    }

    return list;
  }, [fundsRegistry, portfolioState.customFunds, portfolioState.fundBalances]);

  const isKiwiFund = (f: FundMetadata) => {
    if (typeof f.isKiwiSaver === 'boolean') {
      return f.isKiwiSaver;
    }
    const codeUpper = f.code.toUpperCase();
    const provLower = (f.provider || '').toLowerCase();
    return Boolean(
      provLower.includes('kiwisaver') ||
      codeUpper.includes('KIWISAVER') ||
      (provLower.includes('fisher') && codeUpper.includes('GROWTH'))
    );
  };

  const filteredFunds = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return combinedFunds
      .filter((f) => {
        const hasBalance = (portfolioState.fundBalances[f.code] || 0) > 0;
        if (heldOnly && !hasBalance) return false;

        const isKiwi = isKiwiFund(f);
        if (typeFilter === 'kiwisaver' && !isKiwi) return false;
        if (typeFilter === 'managed' && isKiwi) return false;

        if (!q) return true;
        return (
          f.code.toLowerCase().includes(q) ||
          f.name.toLowerCase().includes(q) ||
          f.provider.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const balA = portfolioState.fundBalances[a.code] || 0;
        const balB = portfolioState.fundBalances[b.code] || 0;
        if (balB !== balA) return balB - balA;
        return a.name.localeCompare(b.name);
      });
  }, [combinedFunds, filterQuery, typeFilter, heldOnly, portfolioState.fundBalances]);

  const handleFundBalanceChange = (code: string, value: string) => {
    const parsed = parseFloat(value);
    const num = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    const newBalances = { ...portfolioState.fundBalances };
    const nextAssignments = { ...portfolioState.bucketAssignments };
    if (num <= 0) {
      delete newBalances[code];
      delete nextAssignments[`fund:${code}`];
    } else {
      newBalances[code] = num;
    }
    onUpdateState({ ...portfolioState, fundBalances: newBalances, bucketAssignments: nextAssignments });
  };

  const handlePresetChange = (presetCode: string) => {
    setSelectedPreset(presetCode);
    if (presetCode === 'custom') {
      setCustomName('');
      setCustomCode('');
      setCustomProvider('');
      setCustomAssetClass('mixed');
      setCustomIsKiwiSaver(false);
      setCustomUrl('');
      return;
    }

    const preset = PRESET_FUNDS.find((p) => p.code === presetCode);
    if (preset) {
      setCustomName(preset.name);
      setCustomCode(preset.code);
      setCustomProvider(preset.provider);
      setCustomAssetClass(preset.assetClass);
      setCustomIsKiwiSaver(preset.isKiwiSaver);
      setCustomUrl(preset.url || '');
    }
  };

  const handleUrlChange = (val: string) => {
    setCustomUrl(val);
    const parsed = parseAndValidateFundUrl(val);
    if (parsed.isValid && parsed.fundId) {
      if (!customCode || customCode === 'FISHER_KIWISAVER_GROWTH') {
        const prefix = customProvider ? customProvider.toUpperCase().replace(/[^A-Z0-9]/g, '_') : 'FUND';
        setCustomCode(`${prefix}_${parsed.fundId}`);
      }
    }
  };

  const handleSubmitForIngestion = (fund: FundMetadata) => {
    const val = parseAndValidateFundUrl(fund.smartInvestorUrl || '');
    const title = `[Fund Request] ${fund.name}`;
    const body = `### Crowdsourced Fund Ingestion Request

Please add this fund to \`pipeline/fund_catalog.json\` so it is ingested into the global look-through catalogue.

- **Fund Name:** ${fund.name}
- **Fund Manager:** ${fund.provider}
- **Fund Code:** ${fund.code}
- **Smart Investor Link:** ${fund.smartInvestorUrl || 'N/A'}
- **Scheme ID:** ${val.schemeId || 'N/A'}
- **Offer ID:** ${val.offerId || 'N/A'}
- **Fund ID:** ${val.fundId || 'N/A'}
- **Asset Profile:** ${fund.asset_class}
- **Is KiwiSaver:** ${fund.isKiwiSaver ? 'Yes' : 'No'}

\`\`\`json
{
  "fund_code": "${fund.code}",
  "fund_name": "${fund.name}",
  "fund_manager": "${fund.provider}",
  "provider": "${fund.provider}",
  "fnd_code": "${val.fundId || ''}",
  "scheme_id": "${val.schemeId || ''}",
  "offer_id": "${val.offerId || ''}",
  "smart_investor_url": "${fund.smartInvestorUrl || ''}",
  "is_etf": false,
  "is_kiwisaver": ${Boolean(fund.isKiwiSaver)}
}
\`\`\`
`;
    const issueUrl = `https://github.com/SusanJaneNZ/kiwi-portfolio-xray/issues/new?title=${encodeURIComponent(
      title
    )}&body=${encodeURIComponent(body)}&labels=new-fund`;
    window.open(issueUrl, '_blank', 'noopener,noreferrer');
  };

  const handleAddFund = (andSubmit: boolean = false) => {
    setFormError(null);
    const cleanCode = customCode.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const cleanName = customName.trim();
    const cleanProvider = customProvider.trim() || 'Managed Fund';
    const parsedBalance = parseFloat(customBalance);
    const numBalance = Number.isFinite(parsedBalance) && parsedBalance > 0 ? parsedBalance : 0;

    if (!cleanCode) {
      setFormError('Please enter a Fund Code (e.g. FISHER_GROWTH or KRN_NZ20)');
      return;
    }
    if (!cleanName) {
      setFormError('Please enter a Fund Name');
      return;
    }

    const newFund: FundMetadata = {
      code: cleanCode,
      name: cleanName,
      provider: cleanProvider,
      effective_date: new Date().toISOString().split('T')[0],
      cash_ratio: 0.035,
      hedging_ratio: 0,
      constituent_count: 0,
      asset_class: customAssetClass,
      isKiwiSaver: customIsKiwiSaver,
      smartInvestorUrl: customUrl.trim() || undefined,
    };

    const existingCustom = portfolioState.customFunds || [];
    const updatedCustom = [
      ...existingCustom.filter((c) => c.code.toUpperCase() !== cleanCode),
      newFund,
    ];

    const newBalances = { ...portfolioState.fundBalances };
    if (numBalance > 0) {
      newBalances[cleanCode] = numBalance;
    }

    onUpdateState({
      ...portfolioState,
      customFunds: updatedCustom,
      fundBalances: newBalances,
    });

    // Reset form
    setCustomBalance('');
    setShowAddForm(false);
    if (numBalance <= 0) {
      setUserToggledHeldOnly(false);
    }

    if (andSubmit) {
      handleSubmitForIngestion(newFund);
    }
  };

  const handleRemoveCustomFund = (code: string) => {
    if (!window.confirm(`Remove custom fund ${code} from your portfolio?`)) {
      return;
    }
    const existingCustom = portfolioState.customFunds || [];
    const updatedCustom = existingCustom.filter((c) => c.code.toUpperCase() !== code.toUpperCase());
    const newBalances = { ...portfolioState.fundBalances };
    delete newBalances[code];
    const nextAssignments = { ...portfolioState.bucketAssignments };
    delete nextAssignments[`fund:${code}`];

    onUpdateState({
      ...portfolioState,
      customFunds: updatedCustom,
      fundBalances: newBalances,
      bucketAssignments: nextAssignments,
    });
  };

  return (
    <CollapsiblePanel
      id="input-managed-funds"
      title={
        <span className="text-xs uppercase tracking-wider text-slate-300">
          2. Managed Funds &amp; KiwiSaver (in NZD)
        </span>
      }
      headerRight={
        <span className="text-xs text-sky-400 font-mono">
          {totalPortfolioNZD > 0 ? ((fundSumNZD / totalPortfolioNZD) * 100).toFixed(1) : 0}% of portfolio
        </span>
      }
    >
      {/* Informational Look-Through Note */}
      <div className="bg-slate-900/40 border border-slate-800/60 rounded-lg p-2.5 text-[11px] text-slate-400 flex items-start gap-2 mb-3">
        <span className="text-sky-400 text-sm mt-0.5">ℹ️</span>
        <div className="space-y-1">
          <div>
            Enter your current total dollar balance in <strong>NZD</strong> for off-market managed funds and KiwiSaver schemes (e.g. <strong>Kernel</strong>, <strong>Simplicity</strong>, <strong>Fisher Funds</strong>, <strong>Milford</strong>).
          </div>
          <div className="text-slate-500 text-[10px]">
            Market-traded shares and ETFs are in <strong>Panel 1</strong> by share count. Don’t see your fund? Click <strong>➕ Add New Fund</strong> to add it instantly via Sorted Smart Investor and request automated nightly ingestion.
          </div>
        </div>
      </div>

      {/* Control Bar: Filters & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 mb-3 text-xs">
        <div className="flex-1 min-w-[240px] flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Search code, scheme, or fund manager (e.g. Kernel, Fisher)..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-2.5 pr-8 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            {filterQuery && (
              <button
                type="button"
                onClick={() => setFilterQuery('')}
                title="Clear search"
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5 rounded hover:bg-slate-800 transition-colors text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Type filter pills */}
          <div className="inline-flex rounded-lg border border-slate-800 bg-slate-950 p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setTypeFilter('all')}
              className={`px-2 py-0.5 rounded-md transition-colors ${
                typeFilter === 'all'
                  ? 'bg-indigo-600 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter('kiwisaver')}
              className={`px-2 py-0.5 rounded-md transition-colors ${
                typeFilter === 'kiwisaver'
                  ? 'bg-emerald-600 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              KiwiSaver
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter('managed')}
              className={`px-2 py-0.5 rounded-md transition-colors ${
                typeFilter === 'managed'
                  ? 'bg-indigo-600 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Index / Managed
            </button>
          </div>

          <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none whitespace-nowrap ml-1">
            <input
              type="checkbox"
              checked={heldOnly}
              onChange={(e) => setUserToggledHeldOnly(e.target.checked)}
              className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
            />
            <span>Held only</span>
          </label>
        </div>

        <button
          type="button"
          onClick={() => setShowAddForm(!showAddForm)}
          className="text-xs bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700/80 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shadow-sm"
        >
          <span>{showAddForm ? '✕ Close Form' : '➕ Add Fund / Request Ingestion'}</span>
        </button>
      </div>

      {/* Add Custom / KiwiSaver Form */}
      {showAddForm && (
        <div className="bg-slate-900/90 border border-slate-700/60 rounded-xl p-3.5 mb-3 text-xs space-y-3 shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h4 className="font-semibold text-white flex items-center gap-1.5">
              <span>➕</span> Add Fund / Scheme to Portfolio
            </h4>
            <span className="text-[11px] text-slate-400">
              Crowdsourced catalog submission via Sorted Smart Investor
            </span>
          </div>

          {formError && (
            <div className="bg-rose-950/40 border border-rose-800 text-rose-300 rounded-lg p-2 text-xs">
              ⚠️ {formError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Preset Template or Custom</label>
              <select
                value={selectedPreset}
                onChange={(e) => handlePresetChange(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <optgroup label="KiwiSaver Schemes">
                  {PRESET_FUNDS.filter((p) => p.isKiwiSaver).map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name} ({p.provider})
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Unlisted Managed / Index Funds">
                  {PRESET_FUNDS.filter((p) => !p.isKiwiSaver).map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name} ({p.provider})
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Custom Entry">
                  <option value="custom">✏️ Custom / Other Fund (Enter URL below)</option>
                </optgroup>
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Fund Name</label>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g. Fisher Funds KiwiSaver Growth Fund"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Fund Code (Unique identifier)</label>
              <input
                type="text"
                value={customCode}
                onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
                placeholder="e.g. FISHER_KIWISAVER_GROWTH"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Fund Manager (Issuer)</label>
              <input
                type="text"
                value={customProvider}
                onChange={(e) => setCustomProvider(e.target.value)}
                placeholder="e.g. Fisher Funds, Kernel, Simplicity"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Asset Profile</label>
              <select
                value={customAssetClass}
                onChange={(e) => setCustomAssetClass(e.target.value as FundAssetClass)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="mixed">Mixed (80% Equity / 20% Bonds - Standard Growth)</option>
                <option value="equity">Growth Equities (100% Equities)</option>
                <option value="fixed_interest">Defensive (Fixed Interest / Cash)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Fund Category</label>
              <div className="flex items-center gap-4 pt-1">
                <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer text-xs">
                  <input
                    type="radio"
                    name="fundCategory"
                    checked={customIsKiwiSaver}
                    onChange={() => setCustomIsKiwiSaver(true)}
                    className="text-emerald-500 focus:ring-emerald-500"
                  />
                  <span>KiwiSaver Scheme</span>
                </label>
                <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer text-xs">
                  <input
                    type="radio"
                    name="fundCategory"
                    checked={!customIsKiwiSaver}
                    onChange={() => setCustomIsKiwiSaver(false)}
                    className="text-indigo-500 focus:ring-indigo-500"
                  />
                  <span>Unlisted Index / Managed Fund</span>
                </label>
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-[11px] text-slate-400 mb-1">Initial Holding Balance in NZD (Optional)</label>
              <div className="relative max-w-xs">
                <span className="absolute left-2.5 top-1.5 text-slate-500">$</span>
                <input
                  type="number"
                  step="any"
                  value={customBalance}
                  onChange={(e) => setCustomBalance(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-6 pr-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-[11px] text-slate-400 mb-1">
                Sorted Smart Investor Link or Disclose URL
              </label>
              <input
                type="text"
                value={customUrl}
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder="https://www.smartinvestor.sorted.org.nz/kiwisaver-and-managed-funds/SCH.../OFR.../FND.../"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />

              {/* Real-time validation feedback */}
              {customUrl && (
                <div
                  className={`mt-1.5 text-[11px] px-2 py-1 rounded flex items-center gap-1.5 ${
                    urlValidation.isValid
                      ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/60'
                      : 'bg-amber-950/50 text-amber-300 border border-amber-800/50'
                  }`}
                >
                  <span>{urlValidation.isValid ? '✓' : '⚠️'}</span>
                  <span>{urlValidation.message}</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
            <span className="text-[11px] text-slate-500">
              {urlValidation.isValid
                ? 'Valid Sorted link detected. Ready to save or submit for automated ingestion.'
                : 'Enter details above to track this fund immediately.'}
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleAddFund(false)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-medium transition-colors"
              >
                Save Fund to Portfolio
              </button>
              {urlValidation.isValid && (
                <button
                  type="button"
                  onClick={() => handleAddFund(true)}
                  title="Saves fund to your portfolio and opens a pre-filled GitHub Issue for automated nightly ingestion"
                  className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <span>🚀</span>
                  <span>Save &amp; Submit for Ingestion</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Funds Table / Card List */}
      <div className="space-y-2 text-xs max-h-[420px] overflow-y-auto pr-1">
        {filteredFunds.length === 0 ? (
          <div className="text-center py-6 text-slate-500 bg-slate-950/40 rounded-xl border border-slate-800/60">
            <p className="text-slate-400 mb-1">
              {heldOnly
                ? typeFilter === 'kiwisaver'
                  ? 'No KiwiSaver schemes currently held.'
                  : typeFilter === 'managed'
                  ? 'No managed funds currently held.'
                  : 'No managed funds or KiwiSaver schemes currently held.'
                : 'No funds match current filter.'}
            </p>
            <div className="flex items-center justify-center gap-3 mt-1 flex-wrap">
              {heldOnly && (
                <>
                  <button
                    type="button"
                    onClick={() => setUserToggledHeldOnly(false)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
                  >
                    Browse all funds
                  </button>
                  <span className="text-slate-600">·</span>
                </>
              )}
              {filterQuery && (
                <>
                  <button
                    type="button"
                    onClick={() => setFilterQuery('')}
                    className="text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
                  >
                    Clear search
                  </button>
                  <span className="text-slate-600">·</span>
                </>
              )}
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
              >
                ➕ Add Fund / Scheme
              </button>
            </div>
          </div>
        ) : (
          filteredFunds.map((fund) => {
            const balance = portfolioState.fundBalances[fund.code] || 0;
            const isCustom = customCodeSet.has(fund.code.toUpperCase());
            const isKiwi = isKiwiFund(fund);

            return (
              <div
                key={fund.code}
                className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-2.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 hover:border-slate-700/80 transition-colors"
              >
                <div className="flex-1 min-w-[220px]">
                  <div className="font-medium text-white flex items-center gap-1.5 flex-wrap">
                    <span className="bg-indigo-950 text-indigo-300 px-1.5 py-0.5 rounded text-[11px] font-mono border border-indigo-700/50">
                      {fund.code}
                    </span>
                    <span className="truncate">{fund.name}</span>
                    {isKiwi && (
                      <span className="text-[10px] bg-emerald-950/80 text-emerald-300 border border-emerald-700/50 px-1.5 py-0.2 rounded-full font-medium">
                        KiwiSaver
                      </span>
                    )}
                    {isCustom && (
                      <span className="text-[10px] bg-amber-950/80 text-amber-300 border border-amber-700/50 px-1.5 py-0.2 rounded-full">
                        Custom
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span>{fund.provider}</span>
                    <span>·</span>
                    <span className="text-slate-400">
                      {fund.asset_class === 'fixed_interest'
                        ? 'Defensive (Bonds/Cash)'
                        : fund.asset_class === 'mixed'
                        ? 'Mixed (80% Equity / 20% Bonds)'
                        : 'Growth Equities'}
                    </span>
                    {fund.effective_date && fund.constituent_count > 0 && (
                      <>
                        <span>·</span>
                        <span className="text-slate-500">As Of {fund.effective_date}</span>
                      </>
                    )}
                    {fund.constituent_count === 0 && (
                      <span
                        className="text-[10px] bg-sky-950/70 text-sky-300 border border-sky-800/60 px-1.5 py-0.5 rounded flex items-center gap-1 font-medium"
                        title="Holding constituents not yet compiled into public data. Modeled using synthetic asset allocation."
                      >
                        <span>⏳</span>
                        <span>Awaiting constituent processing</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  <div className="w-28 relative">
                    <span className="absolute left-2.5 top-1.5 text-slate-500 text-xs">$</span>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={balance > 0 ? balance : ''}
                      onChange={(e) => handleFundBalanceChange(fund.code, e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-6 pr-2 py-1 text-xs text-right font-mono text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="w-28">
                    <BucketSelect
                      instrumentKey={`fund:${fund.code}`}
                      buckets={availableBuckets}
                      bucketAssignments={portfolioState.bucketAssignments}
                      onAssign={onAssignBucket}
                    />
                  </div>

                  {isCustom && (
                    <div className="flex items-center gap-1.5">
                      {fund.smartInvestorUrl && (
                        <button
                          type="button"
                          onClick={() => handleSubmitForIngestion(fund)}
                          title="Submit this fund to the public catalogue via GitHub Issue bot for automated nightly ingestion"
                          className="text-[11px] text-sky-400 hover:text-sky-300 border border-sky-800/60 bg-sky-950/40 hover:bg-sky-900/60 px-2 py-1 rounded transition-colors whitespace-nowrap flex items-center gap-1"
                        >
                          <span>🚀</span>
                          <span className="hidden md:inline">Submit for Ingestion</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveCustomFund(fund.code)}
                        title="Remove custom fund"
                        className="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </CollapsiblePanel>
  );
};
