import React, { useMemo, useState } from 'react';
import { CollapsiblePanel } from '../CollapsiblePanel';
import { BucketSelect } from './BucketSelect';
import { DEFAULT_STARTER_BUCKETS, FundAssetClass, FundMetadata, UserPortfolioState } from '../../types/portfolio';

interface KiwiSaverPanelProps {
  portfolioState: UserPortfolioState;
  fundsRegistry: FundMetadata[];
  totalPortfolioNZD: number;
  kiwisaverSumNZD: number;
  onAssignBucket: (instrumentKey: string, bucketId: string) => void;
  onUpdateState: (state: UserPortfolioState) => void;
}

interface PresetFund {
  code: string;
  name: string;
  provider: string;
  assetClass: FundAssetClass;
  url?: string;
}

const PRESET_KIWISAVER_FUNDS: PresetFund[] = [
  {
    code: 'FISHER_KIWISAVER_GROWTH',
    name: 'Fisher Funds KiwiSaver Growth Fund',
    provider: 'Fisher Funds',
    assetClass: 'mixed',
    url: 'https://www.smartinvestor.sorted.org.nz/kiwisaver-and-managed-funds/SCH10713/OFR10715/FND555/',
  },
  {
    code: 'MILFORD_ACTIVE_GROWTH',
    name: 'Milford KiwiSaver Active Growth Fund',
    provider: 'Milford',
    assetClass: 'mixed',
    url: 'https://www.smartinvestor.sorted.org.nz/kiwisaver-and-managed-funds/SCH10670/OFR10672/FND1449/',
  },
  {
    code: 'SIMPLICITY_KIWISAVER_GROWTH',
    name: 'Simplicity KiwiSaver Growth Fund',
    provider: 'Simplicity',
    assetClass: 'mixed',
    url: 'https://www.smartinvestor.sorted.org.nz/kiwisaver-and-managed-funds/SCH11538/OFR11540/FND1981/',
  },
  {
    code: 'KERNEL_HIGH_GROWTH',
    name: 'Kernel KiwiSaver High Growth Fund',
    provider: 'Kernel',
    assetClass: 'mixed',
    url: 'https://www.smartinvestor.sorted.org.nz/kiwisaver-and-managed-funds/SCH12697/OFR12698/FND37639/',
  },
  {
    code: 'ANZ_KIWISAVER_GROWTH',
    name: 'ANZ KiwiSaver Growth Fund',
    provider: 'ANZ',
    assetClass: 'mixed',
  },
  {
    code: 'BOOSTER_KIWISAVER_GROWTH',
    name: 'Booster KiwiSaver Socially Responsible High Growth Fund',
    provider: 'Booster',
    assetClass: 'mixed',
  },
  {
    code: 'GENERATE_FOCUSED_GROWTH',
    name: 'Generate KiwiSaver Focused Growth Fund',
    provider: 'Generate',
    assetClass: 'mixed',
  },
];

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

  // 1. Direct Disclose XLSX download link
  const xlsxMatch = trimmed.match(/disclose-document\/full-portfolio\/(FND\d+)\/.*\.xlsx/i);
  if (xlsxMatch) {
    return {
      isValid: true,
      fundId: xlsxMatch[1].toUpperCase(),
      isDirectXlsx: true,
      message: `Verified Disclose Register XLSX download link (${xlsxMatch[1].toUpperCase()})`,
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

export const KiwiSaverPanel: React.FC<KiwiSaverPanelProps> = ({
  portfolioState,
  fundsRegistry,
  totalPortfolioNZD,
  kiwisaverSumNZD,
  onAssignBucket,
  onUpdateState,
}) => {
  const [filterQuery, setFilterQuery] = useState('');
  const [heldOnly, setHeldOnly] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  // Form states for adding custom/KiwiSaver fund
  const [selectedPreset, setSelectedPreset] = useState<string>('FISHER_KIWISAVER_GROWTH');
  const [customName, setCustomName] = useState('Fisher Funds KiwiSaver Growth Fund');
  const [customCode, setCustomCode] = useState('FISHER_KIWISAVER_GROWTH');
  const [customProvider, setCustomProvider] = useState('Fisher Funds');
  const [customAssetClass, setCustomAssetClass] = useState<FundAssetClass>('mixed');
  const [customUrl, setCustomUrl] = useState('https://www.smartinvestor.sorted.org.nz/kiwisaver-and-managed-funds/SCH10713/OFR10715/FND555/');
  const [customBalance, setCustomBalance] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const urlValidation = useMemo(() => {
    return parseAndValidateFundUrl(customUrl);
  }, [customUrl]);

  const availableBuckets = useMemo(() => {
    return portfolioState.buckets.length > 0 ? portfolioState.buckets : DEFAULT_STARTER_BUCKETS;
  }, [portfolioState.buckets]);

  // Combine registry funds that are KiwiSaver/Fisher with user-entered custom funds
  const combinedKiwiSaverFunds = useMemo(() => {
    const list: FundMetadata[] = [];
    const seenCodes = new Set<string>();

    // 1. User custom funds
    const customList = portfolioState.customFunds || [];
    for (const cf of customList) {
      if (!seenCodes.has(cf.code.toUpperCase())) {
        seenCodes.add(cf.code.toUpperCase());
        list.push(cf);
      }
    }

    // 2. Registry funds tagged as KiwiSaver or Fisher Funds
    for (const rf of fundsRegistry) {
      const codeUpper = rf.code.toUpperCase();
      const isKiwi =
        Boolean(rf.isKiwiSaver) ||
        rf.provider.toLowerCase().includes('fisher') ||
        rf.provider.toLowerCase().includes('kiwisaver') ||
        codeUpper.includes('KIWISAVER');

      if (isKiwi && !seenCodes.has(codeUpper)) {
        seenCodes.add(codeUpper);
        list.push(rf);
      }
    }

    // 3. Any fund in fundBalances matching preset KiwiSaver codes
    for (const code of Object.keys(portfolioState.fundBalances)) {
      const codeUpper = code.toUpperCase();
      if (!seenCodes.has(codeUpper)) {
        const preset = PRESET_KIWISAVER_FUNDS.find((p) => p.code.toUpperCase() === codeUpper);
        if (preset) {
          seenCodes.add(codeUpper);
          list.push({
            code: preset.code,
            name: preset.name,
            provider: preset.provider,
            effective_date: new Date().toISOString().split('T')[0],
            cash_ratio: 0.035,
            hedging_ratio: 0,
            constituent_count: 0,
            asset_class: preset.assetClass,
            isKiwiSaver: true,
            smartInvestorUrl: preset.url,
          });
        }
      }
    }

    return list;
  }, [fundsRegistry, portfolioState.customFunds, portfolioState.fundBalances]);

  const filteredFunds = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return combinedKiwiSaverFunds
      .filter((f) => {
        const hasBalance = (portfolioState.fundBalances[f.code] || 0) > 0;
        if (heldOnly && !hasBalance) return false;
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
  }, [combinedKiwiSaverFunds, filterQuery, heldOnly, portfolioState.fundBalances]);

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
      setCustomUrl('');
      return;
    }
    const preset = PRESET_KIWISAVER_FUNDS.find((p) => p.code === presetCode);
    if (preset) {
      setCustomName(preset.name);
      setCustomCode(preset.code);
      setCustomProvider(preset.provider);
      setCustomAssetClass(preset.assetClass);
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
- **Provider:** ${fund.provider}
- **Fund Code:** ${fund.code}
- **Smart Investor URL:** ${fund.smartInvestorUrl || 'N/A'}
- **Scheme ID:** ${val.schemeId || 'N/A'}
- **Offer ID:** ${val.offerId || 'N/A'}
- **Fund ID:** ${val.fundId || 'N/A'}
- **Asset Profile:** ${fund.asset_class}

\`\`\`json
{
  "fund_code": "${fund.code}",
  "fund_name": "${fund.name}",
  "provider": "${fund.provider}",
  "fnd_code": "${val.fundId || ''}",
  "scheme_id": "${val.schemeId || ''}",
  "offer_id": "${val.offerId || ''}",
  "smart_investor_url": "${fund.smartInvestorUrl || ''}",
  "is_etf": false,
  "is_kiwisaver": true
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
      const cleanProvider = customProvider.trim() || 'KiwiSaver';
      const parsedBalance = parseFloat(customBalance);
      const numBalance = Number.isFinite(parsedBalance) && parsedBalance > 0 ? parsedBalance : 0;

      if (!cleanCode) {
        setFormError('Please enter a Fund Code (e.g. FISHER_GROWTH)');
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
        isKiwiSaver: true,
        ...(customUrl.trim() ? { smartInvestorUrl: customUrl.trim() } : {}),
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

    const customCodeSet = useMemo(() => {
      return new Set((portfolioState.customFunds || []).map((c) => c.code.toUpperCase()));
    }, [portfolioState.customFunds]);

    return (
      <CollapsiblePanel
        id="input-kiwisaver"
        title={
          <span className="text-xs uppercase tracking-wider text-slate-300">
            3. KiwiSaver &amp; Custom Funds (in NZD)
          </span>
        }
        headerRight={
          <span className="text-xs text-sky-400 font-mono">
            {totalPortfolioNZD > 0 ? ((kiwisaverSumNZD / totalPortfolioNZD) * 100).toFixed(1) : 0}% of portfolio
          </span>
        }
      >
        {/* Informational Look-Through Note */}
        <div className="bg-slate-900/40 border border-slate-800/60 rounded-lg p-2 text-[11px] text-slate-400 flex items-center gap-2 mb-2.5">
          <span className="text-sky-400 text-sm">ℹ️</span>
          <span>
            Enter your current dollar balance in <strong>NZD</strong> for <strong>KiwiSaver</strong> schemes (such as <strong>Fisher Funds</strong>, <strong>Milford</strong>, <strong>Simplicity</strong>) or custom funds to look-through their underlying equities and bonds.
          </span>
        </div>

        {/* Action / Add Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 text-xs">
          <div className="flex-1 min-w-[200px] flex items-center gap-2">
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter KiwiSaver scheme or custom fund..."
              className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none whitespace-nowrap">
              <input
                type="checkbox"
                checked={heldOnly}
                onChange={(e) => setHeldOnly(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
              />
              <span>Held only</span>
            </label>
          </div>

          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="text-xs bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700/80 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <span>{showAddForm ? '✕ Close Form' : '➕ Add Custom / KiwiSaver Fund'}</span>
          </button>
        </div>

        {/* Add Custom / KiwiSaver Form */}
        {showAddForm && (
          <div className="bg-slate-900/90 border border-slate-700/60 rounded-xl p-3.5 mb-3 text-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h4 className="font-semibold text-white flex items-center gap-1.5">
                <span>➕</span> Add KiwiSaver Scheme or Custom Fund
              </h4>
              <span className="text-[11px] text-slate-400">Pulls Smart Investor data into look-through</span>
            </div>

            {formError && (
              <div className="text-rose-400 bg-rose-950/40 border border-rose-800/60 rounded px-2.5 py-1 text-xs">
                ⚠️ {formError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Select Preset Scheme</label>
                <select
                  value={selectedPreset}
                  onChange={(e) => handlePresetChange(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="custom">✏️ Custom Scheme / Other Fund...</option>
                  {PRESET_KIWISAVER_FUNDS.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name} ({p.provider})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Fund Code (Unique ID)</label>
                <input
                  type="text"
                  value={customCode}
                  onChange={(e) => setCustomCode(e.target.value)}
                  placeholder="e.g. FISHER_KIWISAVER_GROWTH"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                />
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
                <label className="block text-[11px] text-slate-400 mb-1">Provider</label>
                <input
                  type="text"
                  value={customProvider}
                  onChange={(e) => setCustomProvider(e.target.value)}
                  placeholder="e.g. Fisher Funds, Milford, ANZ"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Asset Allocation Profile</label>
                <select
                  value={customAssetClass}
                  onChange={(e) => setCustomAssetClass(e.target.value as FundAssetClass)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="mixed">Mixed Growth (80% Equities / 20% Bonds)</option>
                  <option value="equity">100% Growth Equities (Shares)</option>
                  <option value="fixed_interest">100% Defensive (Bonds &amp; Cash)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Initial Balance (NZD)</label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                  <input
                    type="number"
                    min="0"
                    value={customBalance}
                    onChange={(e) => setCustomBalance(e.target.value)}
                    placeholder="e.g. 50000"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-6 pr-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
              </div>

              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-[11px] text-slate-400 mb-1">
                  Sorted Smart Investor Link / Reference (Optional)
                </label>
                <input
                  type="text"
                  value={customUrl}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  placeholder="https://www.smartinvestor.sorted.org.nz/kiwisaver-and-managed-funds/SCH.../OFR.../FND.../"
                  className={`w-full bg-slate-950 border rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none font-mono text-[11px] ${customUrl.trim()
                      ? urlValidation.isValid
                        ? 'border-emerald-600/60 focus:border-emerald-500'
                        : 'border-amber-600/60 focus:border-amber-500'
                      : 'border-slate-800 focus:border-indigo-500'
                    }`}
                />
                {customUrl.trim() && (
                  <div
                    className={`mt-1.5 flex items-center gap-1.5 text-[11px] rounded px-2.5 py-1 border ${urlValidation.isValid
                        ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/50'
                        : 'bg-amber-950/40 text-amber-300 border-amber-800/50'
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
                    ? 'Valid Sorted Investor link detected. Ready to save or submit for nightly ingestion.'
                    : 'Enter details above to track this fund immediately.'}
                </span>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowAddForm(false)}
                    className="px-3 py-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleAddFund(false)}
                    className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-medium transition-colors"
                  >
                    Save Fund to Portfolio
                  </button>
                  {urlValidation.isValid && (
                    <button
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
            <div className="space-y-2 text-xs max-h-[380px] overflow-y-auto pr-1">
              {filteredFunds.length === 0 ? (
                <div className="text-center py-6 text-slate-500 bg-slate-950/40 rounded-xl border border-slate-800/60">
                  <p className="text-slate-400 mb-1">No KiwiSaver or custom funds found.</p>
                  <button
                    onClick={() => setShowAddForm(true)}
                    className="text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
                  >
                    Add your KiwiSaver scheme (e.g. Fisher Funds Growth)
                  </button>
                </div>
              ) : (
                filteredFunds.map((fund) => {
                  const balance = portfolioState.fundBalances[fund.code] || 0;
                  const isCustom = customCodeSet.has(fund.code.toUpperCase());

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
                          <span className="font-semibold text-white">{fund.name}</span>
                          {fund.smartInvestorUrl && (
                            <a
                              href={fund.smartInvestorUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sky-400 hover:text-sky-300 inline-flex items-center gap-0.5 text-[11px] underline ml-1"
                              title="View fund on Sorted Smart Investor"
                            >
                              Smart Investor ↗
                            </a>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                          <span className="text-slate-300 font-medium">{fund.provider}</span>
                          <span>·</span>
                          <span className="text-slate-400">
                            {fund.asset_class === 'fixed_interest'
                              ? 'Defensive (Bonds/Cash)'
                              : fund.asset_class === 'mixed'
                                ? 'Mixed (80% Equity / 20% Bonds)'
                                : 'Growth Equities'}
                          </span>
                          {fund.effective_date && (
                            <>
                              <span>·</span>
                              <span className="text-slate-500">As Of {fund.effective_date}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                        <BucketSelect
                          instrumentKey={`fund:${fund.code}`}
                          buckets={availableBuckets}
                          bucketAssignments={portfolioState.bucketAssignments}
                          onAssign={onAssignBucket}
                        />

                        <div className="w-36 sm:w-44 relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                          <input
                            type="number"
                            min="0"
                            value={balance > 0 ? balance : ''}
                            placeholder="0"
                            onChange={(e) => handleFundBalanceChange(fund.code, e.target.value)}
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-6 pr-2.5 py-1.5 text-right text-xs sm:text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
                          />
                        </div>

                        {isCustom && (
                    <div className="flex items-center gap-1.5">
                      {fund.smartInvestorUrl && (
                        <button
                          onClick={() => handleSubmitForIngestion(fund)}
                          title="Submit this fund to the public catalogue via GitHub Issue bot for automated nightly ingestion"
                          className="text-[11px] text-sky-400 hover:text-sky-300 border border-sky-800/60 bg-sky-950/40 hover:bg-sky-900/60 px-2 py-1 rounded transition-colors whitespace-nowrap flex items-center gap-1"
                        >
                          <span>🚀</span>
                          <span className="hidden md:inline">Submit for Ingestion</span>
                        </button>
                      )}
                      <button
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
