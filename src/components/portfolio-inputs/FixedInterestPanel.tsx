import React, { useState } from 'react';
import { CollapsiblePanel } from '../CollapsiblePanel';
import { BucketSelect } from './BucketSelect';
import {
  DEFAULT_STARTER_BUCKETS,
  FixedInterestCategory,
  FixedInterestHolding,
  FixedInterestTaxType,
  PaymentFrequency,
  UserPortfolioState,
} from '../../types/portfolio';

const NZ_BANK_PRESETS = [
  'ANZ',
  'ASB',
  'BNZ',
  'Westpac',
  'Kiwibank',
  'Heartland',
  'Rabobank',
  'TSB',
  'SBS',
  'Contact Energy',
  'Infratil',
  'Spark',
  'Meridian Energy',
  'Mercury NZ',
  'NZ Government',
  'Auckland Council',
];

interface FixedInterestPanelProps {
  portfolioState: UserPortfolioState;
  totalPortfolioNZD: number;
  fixedInterestSumNZD: number;
  onAssignBucket: (instrumentKey: string, bucketId: string) => void;
  onUpdateState: (state: UserPortfolioState) => void;
}

export const FixedInterestPanel: React.FC<FixedInterestPanelProps> = ({
  portfolioState,
  totalPortfolioNZD,
  fixedInterestSumNZD,
  onAssignBucket,
  onUpdateState,
}) => {
  const [fiCategory, setFiCategory] = useState<FixedInterestCategory>('term_deposit');
  const [fiInstitution, setFiInstitution] = useState('ANZ');
  const [fiCustomInstitution, setFiCustomInstitution] = useState('');
  const [fiName, setFiName] = useState('');
  const [fiTaxSelection, setFiTaxSelection] = useState<'rwt' | 'pie_105' | 'pie_175' | 'pie_28'>('pie_28');
  const [fiValue, setFiValue] = useState('10000');
  const [fiRate, setFiRate] = useState('');
  const [fiMaturity, setFiMaturity] = useState('');
  const [fiFrequency, setFiFrequency] = useState<PaymentFrequency>('maturity');
  const [fiDepositId, setFiDepositId] = useState('');

  const holdingsList: FixedInterestHolding[] =
    portfolioState.fixedInterest || portfolioState.cashDeposits || [];

  const availableBuckets = React.useMemo(() => {
    return portfolioState.buckets.length > 0 ? portfolioState.buckets : DEFAULT_STARTER_BUCKETS;
  }, [portfolioState.buckets]);

  const handleValueChange = (id: string, value: string) => {
    const num = parseFloat(value);
    const safeVal = Number.isFinite(num) && num >= 0 ? num : 0;
    const updated = holdingsList.map((d) => (d.id === id ? { ...d, valueNZD: safeVal } : d));
    onUpdateState({
      ...portfolioState,
      fixedInterest: updated,
      cashDeposits: updated,
    });
  };

  const handleRemoveHolding = (id: string) => {
    const updated = holdingsList.filter((d) => d.id !== id);
    const nextAssignments = { ...portfolioState.bucketAssignments };
    delete nextAssignments[`fi:${id}`];
    delete nextAssignments[`td:${id}`];
    onUpdateState({
      ...portfolioState,
      fixedInterest: updated,
      cashDeposits: updated,
      bucketAssignments: nextAssignments,
    });
  };

  const handleAddHolding = () => {
    const parsedVal = parseFloat(fiValue);
    const valueNZD = Number.isFinite(parsedVal) && parsedVal > 0 ? parsedVal : 0;
    if (valueNZD <= 0) return;

    const institution =
      (fiInstitution === '__custom' ? fiCustomInstitution : fiInstitution).trim() || 'ANZ';
    const defaultLabel =
      fiCategory === 'bond'
        ? `${institution} Bond`
        : fiCategory === 'term_deposit'
        ? `${institution} Term Deposit`
        : `${institution} On-Call Cash`;
    const name = fiName.trim() || defaultLabel;
    const id = `fi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const rateNum = parseFloat(fiRate);

    // Bonds are strictly RWT under NZ tax law; Term Deposits/Cash can be PIE or RWT
    const taxType: FixedInterestTaxType = fiCategory === 'bond' ? 'rwt' : fiTaxSelection === 'rwt' ? 'rwt' : 'pie';
    let pirRate: 0.105 | 0.175 | 0.28 | undefined = undefined;
    if (taxType === 'pie') {
      if (fiTaxSelection === 'pie_105') pirRate = 0.105;
      else if (fiTaxSelection === 'pie_175') pirRate = 0.175;
      else pirRate = 0.28;
    }

    const newHolding: FixedInterestHolding = {
      id,
      depositId: fiDepositId.trim() || undefined,
      institution,
      name,
      category: fiCategory,
      taxType,
      pirRate,
      valueNZD,
      maturityDate: fiMaturity.trim() || undefined,
      interestRate: Number.isFinite(rateNum) && rateNum >= 0 ? rateNum : undefined,
      frequency: fiFrequency,
      label: name,
      type: fiCategory === 'cash' ? 'cash' : 'term_deposit',
    };

    const updated = [...holdingsList, newHolding];
    onUpdateState({
      ...portfolioState,
      fixedInterest: updated,
      cashDeposits: updated,
    });

    setFiName('');
    setFiDepositId('');
    setFiMaturity('');
    setFiRate('');
  };

  return (
    <CollapsiblePanel
      id="input-fixed-interest"
      title={
        <span className="text-xs uppercase tracking-wider text-slate-300">
          3. Fixed Interest &amp; Cash (NZD)
        </span>
      }
      headerRight={
        <span className="text-xs text-amber-400 font-mono">
          {totalPortfolioNZD > 0
            ? ((fixedInterestSumNZD / totalPortfolioNZD) * 100).toFixed(1)
            : 0}
          % of portfolio
        </span>
      }
    >
      <div className="space-y-2 text-xs">
        {/* Tier 0 External Cash Educational Tip */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-lg p-2.5 text-[11px] text-slate-400 flex items-start gap-2">
          <span className="text-amber-400 text-sm leading-none mt-0.5">💡</span>
          <div>
            <span className="font-medium text-slate-200">Retail Portfolio Tip:</span> Only enter cash and deposits allocated to your investment portfolio (defensive anchor / dry powder). Keep your separate 1–3 year day-to-day living buffer (Tier 0) outside this tool to keep rebalancing targets accurate.
          </div>
        </div>

        {/* Existing Holdings List */}
        {holdingsList.map((dep) => {
          const category = dep.category || dep.type || 'term_deposit';
          const isBond = category === 'bond';
          const isCash = category === 'cash';

          return (
            <div
              key={dep.id}
              className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-2.5 flex items-center justify-between gap-2"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-white flex items-center gap-1.5 flex-wrap">
                  {/* Category Badge */}
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider border ${
                      isBond
                        ? 'bg-indigo-950 text-indigo-300 border-indigo-700/50'
                        : isCash
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-700/50'
                        : 'bg-amber-950 text-amber-300 border-amber-700/50'
                    }`}
                  >
                    {isBond ? 'Bond' : isCash ? 'Call Cash' : 'Term Deposit'}
                  </span>

                  {/* Tax Badge */}
                  {dep.taxType === 'pie' ? (
                    <span className="bg-cyan-950 text-cyan-300 px-1.5 py-0.5 rounded text-[10px] font-mono border border-cyan-800/50">
                      PIE {(dep.pirRate ? dep.pirRate * 100 : 28).toFixed(1)}%
                    </span>
                  ) : (
                    <span className="bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded text-[10px] font-mono">
                      RWT
                    </span>
                  )}

                  <span className="text-slate-300 font-semibold">{dep.institution}</span>
                  <span className="text-slate-400 truncate">· {dep.name || dep.label}</span>
                  {dep.depositId && (
                    <span className="text-[10px] text-slate-500 font-mono">({dep.depositId})</span>
                  )}
                </div>

                <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-3 flex-wrap">
                  {dep.interestRate !== undefined && (
                    <span className="text-emerald-400 font-mono">{dep.interestRate.toFixed(2)}% p.a.</span>
                  )}
                  {dep.maturityDate && (
                    <span className="text-slate-500 font-mono">Matures: {dep.maturityDate}</span>
                  )}
                  {dep.frequency && dep.frequency !== 'maturity' && (
                    <span className="text-slate-500 capitalize">({dep.frequency})</span>
                  )}
                </div>
              </div>

              {/* Principal / Face Value Input */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 font-mono text-xs">
                    $
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={dep.valueNZD || ''}
                    onChange={(e) => handleValueChange(dep.id, e.target.value)}
                    placeholder="0"
                    aria-label={`Principal for ${dep.institution} ${dep.name || dep.label}`}
                    className="w-28 pl-6 pr-2.5 py-1.5 bg-slate-900 border border-slate-700/80 rounded-lg text-right font-mono text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>

                {/* Bucket Assignment */}
                <BucketSelect
                  instrumentKey={`fi:${dep.id}`}
                  fallbackKey={`td:${dep.id}`}
                  buckets={availableBuckets}
                  bucketAssignments={portfolioState.bucketAssignments}
                  onAssign={onAssignBucket}
                />

                {/* Delete Button */}
                <button
                  type="button"
                  onClick={() => handleRemoveHolding(dep.id)}
                  title="Remove fixed interest holding"
                  className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}

        {/* Add New Holding Form */}
        <div className="bg-slate-950/40 border border-slate-800/60 rounded-xl p-3 space-y-3 mt-3">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
            Add Fixed Interest or Cash
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {/* Category Selector */}
            <div>
              <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                Category
              </label>
              <select
                value={fiCategory}
                onChange={(e) => {
                  const cat = e.target.value as FixedInterestCategory;
                  setFiCategory(cat);
                  if (cat === 'bond') {
                    setFiTaxSelection('rwt'); // NZDX bonds are strictly RWT
                    setFiFrequency('semi-annual');
                  } else if (cat === 'term_deposit') {
                    setFiTaxSelection('pie_28');
                    setFiFrequency('maturity');
                  }
                }}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
              >
                <option value="term_deposit">Term Deposit</option>
                <option value="bond">Direct Bond (NZDX / Corporate / Gov)</option>
                <option value="cash">Cash / On-Call Account</option>
              </select>
            </div>

            {/* Institution Selector */}
            <div>
              <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                Issuer / Bank
              </label>
              <select
                value={fiInstitution}
                onChange={(e) => setFiInstitution(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
              >
                {NZ_BANK_PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
                <option value="__custom">Custom Issuer...</option>
              </select>
              {fiInstitution === '__custom' && (
                <input
                  type="text"
                  placeholder="e.g. Contact Energy, Spark"
                  value={fiCustomInstitution}
                  onChange={(e) => setFiCustomInstitution(e.target.value)}
                  className="w-full mt-1.5 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              )}
            </div>

            {/* Tax Treatment */}
            <div>
              <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                Tax Treatment {fiCategory === 'bond' && <span className="text-slate-500">(Bonds strictly RWT)</span>}
              </label>
              <select
                value={fiTaxSelection}
                disabled={fiCategory === 'bond'}
                onChange={(e) => setFiTaxSelection(e.target.value as any)}
                className={`w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500 ${
                  fiCategory === 'bond' ? 'opacity-60 cursor-not-allowed' : ''
                }`}
              >
                <option value="pie_28">PIE (28% PIR - Default)</option>
                <option value="pie_175">PIE (17.5% PIR)</option>
                <option value="pie_105">PIE (10.5% PIR)</option>
                <option value="rwt">Standard RWT</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            {/* Description / Name */}
            <div className="sm:col-span-2">
              <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                Description / Code
              </label>
              <input
                type="text"
                placeholder={
                  fiCategory === 'bond'
                    ? 'e.g. CEN060 5.80% 2028'
                    : fiCategory === 'term_deposit'
                    ? 'e.g. 12M PIE Term Deposit'
                    : 'e.g. Tactical Reserve'
                }
                value={fiName}
                onChange={(e) => setFiName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>

            {/* Principal / Face Value NZD */}
            <div>
              <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                Principal / Face Value ($NZD)
              </label>
              <input
                type="number"
                min="0"
                step="500"
                placeholder="10000"
                value={fiValue}
                onChange={(e) => setFiValue(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white text-right font-mono focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>

            {/* Interest/Coupon Rate */}
            <div>
              <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                Interest / Coupon (%)
              </label>
              <input
                type="number"
                min="0"
                step="0.05"
                placeholder="e.g. 5.10"
                value={fiRate}
                onChange={(e) => setFiRate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white text-right font-mono focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
            {/* Maturity Date */}
            <div>
              <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                Maturity Date (optional)
              </label>
              <input
                type="date"
                value={fiMaturity}
                onChange={(e) => setFiMaturity(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>

            {/* Payment Frequency */}
            <div>
              <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                Payment Frequency
              </label>
              <select
                value={fiFrequency}
                onChange={(e) => setFiFrequency(e.target.value as PaymentFrequency)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
              >
                <option value="maturity">At Maturity</option>
                <option value="semi-annual">Semi-Annual (Standard NZDX)</option>
                <option value="quarterly">Quarterly</option>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </select>
            </div>

            {/* Add Button */}
            <div>
              <button
                type="button"
                onClick={handleAddHolding}
                className="w-full py-1.5 px-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded-lg text-xs transition-colors"
              >
                + Add {fiCategory === 'bond' ? 'Bond' : fiCategory === 'term_deposit' ? 'Term Deposit' : 'Cash'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </CollapsiblePanel>
  );
};
