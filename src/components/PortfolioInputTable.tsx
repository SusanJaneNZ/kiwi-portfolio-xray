import React, { useState } from 'react';
import {
  CashDepositHolding,
  DirectEquityCatalogItem,
  FundMetadata,
  UserPortfolioState,
} from '../types/portfolio';

interface PortfolioInputTableProps {
  portfolioState: UserPortfolioState;
  fundsRegistry: FundMetadata[];
  directEquitiesCatalog: DirectEquityCatalogItem[];
  onUpdateState: (state: UserPortfolioState) => void;
  totalPortfolioNZD: number;
}

const NZ_BANK_PRESETS = ['ANZ', 'ASB', 'BNZ', 'Westpac', 'Kiwibank', 'Heartland', 'Rabobank', 'TSB', 'SBS'];

export const PortfolioInputTable: React.FC<PortfolioInputTableProps> = ({
  portfolioState,
  fundsRegistry,
  directEquitiesCatalog,
  onUpdateState,
  totalPortfolioNZD,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEquity, setSelectedEquity] = useState<DirectEquityCatalogItem | null>(null);
  const [newShareValue, setNewShareValue] = useState<string>('1000');

  // New Term Deposit / Call Cash form state
  const [depInstitution, setDepInstitution] = useState('ANZ');
  const [depCustomBank, setDepCustomBank] = useState('');
  const [depType, setDepType] = useState<'term_deposit' | 'cash'>('term_deposit');
  const [depLabel, setDepLabel] = useState('');
  const [depId, setDepId] = useState('');
  const [depValue, setDepValue] = useState('10000');
  const [depMaturity, setDepMaturity] = useState('');
  const [depRate, setDepRate] = useState('');

  const hasASXHoldings = portfolioState.directHoldings.some((h) => h.exchange === 'ASX');
  const hasBuckets = portfolioState.buckets.length > 0;

  const setBucketForKey = (instrumentKey: string, bucketId: string) => {
    const nextAssignments = { ...portfolioState.bucketAssignments };
    if (!bucketId) {
      delete nextAssignments[instrumentKey];
    } else {
      nextAssignments[instrumentKey] = bucketId;
    }
    onUpdateState({ ...portfolioState, bucketAssignments: nextAssignments });
  };

  const renderBucketSelect = (instrumentKey: string) => {
    if (!hasBuckets) return null;
    const current = portfolioState.bucketAssignments[instrumentKey] || '';
    return (
      <select
        value={current}
        onChange={(e) => setBucketForKey(instrumentKey, e.target.value)}
        aria-label={`Assign bucket for ${instrumentKey}`}
        className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-slate-300 focus:outline-none focus:border-indigo-500 max-w-[120px]"
      >
        <option value="">Unassigned</option>
        {portfolioState.buckets.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    );
  };

  const handleFundChange = (code: string, value: string) => {
    const num = parseFloat(value) || 0;
    const newBalances = { ...portfolioState.fundBalances };
    if (num <= 0) {
      delete newBalances[code];
    } else {
      newBalances[code] = num;
    }
    onUpdateState({ ...portfolioState, fundBalances: newBalances });
  };

  const handleDirectHoldingChange = (isin: string, value: string) => {
    const num = parseFloat(value) || 0;
    const updated = portfolioState.directHoldings
      .map((h) => (h.isin === isin ? { ...h, value: num } : h))
      .filter((h) => h.value > 0);
    onUpdateState({ ...portfolioState, directHoldings: updated });
  };

  const handleRemoveDirect = (isin: string) => {
    const updated = portfolioState.directHoldings.filter((h) => h.isin !== isin);
    const nextAssignments = { ...portfolioState.bucketAssignments };
    delete nextAssignments[`direct:${isin}`];
    onUpdateState({ ...portfolioState, directHoldings: updated, bucketAssignments: nextAssignments });
  };

  const handleAddDirect = () => {
    if (!selectedEquity) return;
    const val = parseFloat(newShareValue) || 1000;
    const existingIndex = portfolioState.directHoldings.findIndex((h) => h.isin === selectedEquity.isin);
    const updated = [...portfolioState.directHoldings];
    if (existingIndex >= 0) {
      updated[existingIndex] = { ...updated[existingIndex], value: updated[existingIndex].value + val };
    } else {
      updated.push({
        ...selectedEquity,
        currency: selectedEquity.exchange === 'ASX' ? 'AUD' : 'NZD',
        value: val,
      });
    }
    onUpdateState({ ...portfolioState, directHoldings: updated });
    setSelectedEquity(null);
    setSearchQuery('');
  };

  const handleDepositValueChange = (id: string, value: string) => {
    const num = parseFloat(value);
    const safeVal = Number.isFinite(num) && num >= 0 ? num : 0;
    // Retain $0 TD/cash rows so users can track reinvested deposits & keep depositId/bucket assignments
    const updated = portfolioState.cashDeposits.map((d) => (d.id === id ? { ...d, valueNZD: safeVal } : d));
    onUpdateState({ ...portfolioState, cashDeposits: updated });
  };

  const handleRemoveDeposit = (id: string) => {
    const updated = portfolioState.cashDeposits.filter((d) => d.id !== id);
    const nextAssignments = { ...portfolioState.bucketAssignments };
    delete nextAssignments[`td:${id}`];
    onUpdateState({ ...portfolioState, cashDeposits: updated, bucketAssignments: nextAssignments });
  };

  const handleAddDeposit = () => {
    const institution = (depInstitution === '__custom' ? depCustomBank : depInstitution).trim() || 'ANZ';
    const valueNZD = Math.max(0, parseFloat(depValue) || 0);
    const label = depLabel.trim() || `${depType === 'term_deposit' ? 'Term Deposit' : 'Call Cash'}`;
    const id = `td-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const rateNum = parseFloat(depRate);

    const newDeposit: CashDepositHolding = {
      id,
      depositId: depId.trim() || undefined,
      institution,
      label,
      type: depType,
      valueNZD,
      maturityDate: depMaturity.trim() || undefined,
      interestRate: Number.isFinite(rateNum) && rateNum >= 0 ? rateNum : undefined,
    };

    onUpdateState({
      ...portfolioState,
      cashDeposits: [...portfolioState.cashDeposits, newDeposit],
    });
    setDepLabel('');
    setDepId('');
    setDepMaturity('');
    setDepRate('');
  };

  const filteredCatalog = searchQuery.trim()
    ? directEquitiesCatalog
        .filter(
          (eq) =>
            eq.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            eq.ticker.toLowerCase().includes(searchQuery.toLowerCase())
        )
        .slice(0, 6)
    : [];

  const fundSumNZD = Object.values(portfolioState.fundBalances).reduce((acc, v) => acc + v, 0);
  const directSumNZD = portfolioState.directHoldings.reduce(
    (acc, h) => acc + (h.currency === 'AUD' ? h.value * portfolioState.audNzdRate : h.value),
    0
  );
  const depositSumNZD = portfolioState.cashDeposits.reduce((acc, d) => acc + Math.max(0, d.valueNZD), 0);

  return (
    <div className="space-y-4">
      {/* 1. Fund Allocations Section */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            1. Fund Allocations (NZD)
          </h2>
          <span className="text-xs text-sky-400 font-mono">
            {totalPortfolioNZD > 0 ? ((fundSumNZD / totalPortfolioNZD) * 100).toFixed(1) : 0}% of portfolio
          </span>
        </div>

        <div className="space-y-2 text-xs">
          {fundsRegistry.map((fund) => {
            const balance = portfolioState.fundBalances[fund.code] || 0;
            return (
              <div
                key={fund.code}
                className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-2.5 flex items-center justify-between gap-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-white flex items-center gap-1.5 truncate">
                    <span className="bg-indigo-950 text-indigo-300 px-1.5 py-0.5 rounded text-[11px] font-mono border border-indigo-700/50">
                      {fund.code}
                    </span>
                    <span className="truncate">{fund.name}</span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {fund.provider} · {fund.asset_class === 'fixed_interest' ? 'Bonds' : fund.asset_class === 'mixed' ? 'Mixed' : 'Equity'} · As Of {fund.effective_date}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {renderBucketSelect(`fund:${fund.code}`)}
                  <div className="w-24 relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                    <input
                      type="number"
                      value={balance > 0 ? balance : ''}
                      placeholder="0"
                      onChange={(e) => handleFundChange(fund.code, e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-6 pr-2 py-1 text-right text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Direct Shares Section */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            2. Direct Shares (NZX / ASX)
          </h2>
          <span className="text-xs text-emerald-400 font-mono">
            {totalPortfolioNZD > 0 ? ((directSumNZD / totalPortfolioNZD) * 100).toFixed(1) : 0}% of portfolio
          </span>
        </div>

        {hasASXHoldings && (
          <div className="bg-amber-950/30 border border-amber-600/40 rounded-xl p-2.5 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-base">💱</span>
              <div>
                <span className="font-semibold text-amber-300">ASX Holdings Detected:</span>
                <p className="text-[11px] text-amber-200/70">Custom AUD / NZD Exchange Rate</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400">1 AUD =</span>
              <input
                type="number"
                value={portfolioState.audNzdRate}
                step="0.005"
                onChange={(e) =>
                  onUpdateState({
                    ...portfolioState,
                    audNzdRate: parseFloat(e.target.value) || 1.10,
                  })
                }
                className="w-20 bg-slate-950 border border-amber-500/50 rounded px-2 py-1 text-right text-xs text-amber-300 font-mono focus:outline-none focus:border-amber-400"
              />
              <span className="text-xs text-amber-300 font-mono">NZD</span>
            </div>
          </div>
        )}

        <div className="space-y-2 text-xs">
          {portfolioState.directHoldings.map((dh) => {
            const isAud = dh.currency === 'AUD';
            const convertedNZD = isAud ? dh.value * portfolioState.audNzdRate : dh.value;

            return (
              <div
                key={dh.isin}
                className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-2.5 flex items-center justify-between gap-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-white flex items-center gap-1.5 truncate">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[11px] font-mono border ${
                        dh.exchange === 'ASX'
                          ? 'bg-amber-950 text-amber-300 border-amber-700/50'
                          : 'bg-teal-950 text-teal-300 border-teal-700/50'
                      }`}
                    >
                      {dh.ticker}
                    </span>
                    <span className="truncate">{dh.name}</span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {dh.exchange} · {dh.isin}
                    {isAud && ` (${dh.value.toFixed(2)} AUD -> $${convertedNZD.toFixed(2)} NZD)`}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {renderBucketSelect(`direct:${dh.isin}`)}
                  <div className="w-24 relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
                      {isAud ? 'A$' : '$'}
                    </span>
                    <input
                      type="number"
                      value={dh.value}
                      onChange={(e) => handleDirectHoldingChange(dh.isin, e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-6 pr-2 py-1 text-right text-xs text-white focus:outline-none font-mono"
                    />
                  </div>
                  <button
                    onClick={() => handleRemoveDirect(dh.isin)}
                    className="text-slate-500 hover:text-rose-400 text-xs p-1"
                    title="Remove holding"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}

          <div className="pt-2 relative">
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSelectedEquity(null);
                }}
                placeholder="Search direct share e.g. AIA, CSL..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              {selectedEquity && (
                <div className="w-24 relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
                    {selectedEquity.exchange === 'ASX' ? 'A$' : '$'}
                  </span>
                  <input
                    type="number"
                    value={newShareValue}
                    onChange={(e) => setNewShareValue(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-6 pr-2 py-1.5 text-xs text-white"
                  />
                </div>
              )}
              <button
                disabled={!selectedEquity}
                onClick={handleAddDirect}
                className="bg-indigo-600 disabled:opacity-40 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
              >
                + Add
              </button>
            </div>

            {filteredCatalog.length > 0 && !selectedEquity && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden divide-y divide-slate-800">
                {filteredCatalog.map((item) => (
                  <div
                    key={item.isin}
                    onClick={() => {
                      setSelectedEquity(item);
                      setSearchQuery(`${item.ticker} - ${item.name}`);
                    }}
                    className="p-2 text-xs hover:bg-slate-800 cursor-pointer flex justify-between items-center"
                  >
                    <div>
                      <strong className="text-white font-mono">{item.ticker}</strong> · {item.name}
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">{item.exchange}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. Term Deposits & Call Cash Section */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            3. Term Deposits &amp; Call Cash (NZD)
          </h2>
          <span className="text-xs text-amber-400 font-mono">
            {totalPortfolioNZD > 0 ? ((depositSumNZD / totalPortfolioNZD) * 100).toFixed(1) : 0}% of portfolio
          </span>
        </div>

        <div className="space-y-2 text-xs">
          {portfolioState.cashDeposits.map((dep) => (
            <div
              key={dep.id}
              className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-2.5 flex items-center justify-between gap-2"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-white flex items-center gap-1.5 flex-wrap">
                  <span className="bg-amber-950 text-amber-300 px-1.5 py-0.5 rounded text-[11px] font-mono border border-amber-700/50">
                    {dep.institution}
                  </span>
                  <span className="truncate">{dep.label}</span>
                  {dep.depositId && (
                    <span className="bg-slate-900 text-slate-300 px-1.5 py-0.5 rounded text-[10px] font-mono border border-slate-700">
                      #{dep.depositId}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">
                  {dep.type === 'term_deposit' ? 'Term Deposit' : 'Call / Notice Cash'}
                  {dep.maturityDate && ` · Maturing ${dep.maturityDate}`}
                  {dep.interestRate !== undefined && ` · ${dep.interestRate.toFixed(2)}% p.a.`}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {renderBucketSelect(`td:${dep.id}`)}
                <div className="w-24 relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                  <input
                    type="number"
                    min="0"
                    value={dep.valueNZD}
                    onChange={(e) => handleDepositValueChange(dep.id, e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-6 pr-2 py-1 text-right text-xs text-white focus:outline-none focus:border-amber-500 font-mono"
                  />
                </div>
                <button
                  onClick={() => handleRemoveDeposit(dep.id)}
                  className="text-slate-500 hover:text-rose-400 text-xs p-1"
                  title="Remove deposit"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}

          {/* Add Deposit Form */}
          <div className="pt-2 border-t border-slate-800/70 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <select
                value={depInstitution}
                onChange={(e) => setDepInstitution(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
              >
                {NZ_BANK_PRESETS.map((bank) => (
                  <option key={bank} value={bank}>
                    {bank}
                  </option>
                ))}
                <option value="__custom">Other Institution...</option>
              </select>

              <select
                value={depType}
                onChange={(e) => setDepType(e.target.value as 'term_deposit' | 'cash')}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
              >
                <option value="term_deposit">Term Deposit</option>
                <option value="cash">On-Call / Notice Cash</option>
              </select>
            </div>

            {depInstitution === '__custom' && (
              <input
                type="text"
                value={depCustomBank}
                onChange={(e) => setDepCustomBank(e.target.value)}
                placeholder="Institution name (e.g. Co-operative Bank)"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500"
              />
            )}

            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={depLabel}
                onChange={(e) => setDepLabel(e.target.value)}
                placeholder="Label (e.g. 6-Month TD)"
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500"
              />
              <input
                type="text"
                value={depId}
                onChange={(e) => setDepId(e.target.value)}
                placeholder="Ref ID (optional, non-sensitive)"
                title="Use a bank certificate/receipt reference tag rather than full account numbers"
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 font-mono"
              />
            </div>

            <div className="flex gap-2 items-center">
              <div className="relative flex-1">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                <input
                  type="number"
                  min="0"
                  value={depValue}
                  onChange={(e) => setDepValue(e.target.value)}
                  placeholder="NZD Amount"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-6 pr-2 py-1.5 text-xs text-white font-mono"
                />
              </div>
              <input
                type="date"
                value={depMaturity}
                onChange={(e) => setDepMaturity(e.target.value)}
                title="Maturity date (optional)"
                className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-300"
              />
              <input
                type="number"
                step="0.05"
                value={depRate}
                onChange={(e) => setDepRate(e.target.value)}
                placeholder="Rate %"
                className="w-20 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white font-mono"
              />
              <button
                onClick={handleAddDeposit}
                className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
              >
                + Add
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
