import React, { useState } from 'react';
import { CollapsiblePanel } from '../CollapsiblePanel';
import { BucketSelect } from './BucketSelect';
import {
  FixedInterestCategory,
  FixedInterestHolding,
  FixedInterestTaxType,
  PaymentFrequency,
  UserPortfolioState,
} from '../../types/portfolio';
import { formatNZD } from '../../utils/format';

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
  const [fiTaxSelection, setFiTaxSelection] = useState<FixedInterestTaxType>('pie');
  const [fiValue, setFiValue] = useState('');
  const [fiRate, setFiRate] = useState('');
  const [fiMaturity, setFiMaturity] = useState('');
  const [fiFrequency, setFiFrequency] = useState<PaymentFrequency>('maturity');
  const [fiDepositId, setFiDepositId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const holdingsList: FixedInterestHolding[] =
    portfolioState.fixedInterest || portfolioState.cashDeposits || [];

  const availableBuckets = React.useMemo(() => {
    return portfolioState.buckets;
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

  const handleStartEdit = (dep: FixedInterestHolding) => {
    setEditingId(dep.id);
    const cat = dep.category || (dep.type === 'cash' ? 'cash' : 'term_deposit');
    setFiCategory(cat);

    if (NZ_BANK_PRESETS.includes(dep.institution)) {
      setFiInstitution(dep.institution);
      setFiCustomInstitution('');
    } else {
      setFiInstitution('__custom');
      setFiCustomInstitution(dep.institution);
    }

    setFiName(dep.name || dep.label || '');
    setFiValue(dep.valueNZD.toString());
    setFiRate(dep.interestRate !== undefined ? dep.interestRate.toString() : '');
    setFiMaturity(dep.maturityDate || '');
    setFiFrequency(dep.frequency || 'maturity');
    setFiDepositId(dep.depositId || '');

    if (dep.category === 'bond' || dep.taxType === 'rwt') {
      setFiTaxSelection('rwt');
    } else {
      setFiTaxSelection('pie');
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setFiName('');
    setFiDepositId('');
    setFiMaturity('');
    setFiRate('');
    setFiValue('');
    setFiFrequency('maturity');
  };

  const handleRemoveHolding = (id: string) => {
    if (editingId === id) {
      handleCancelEdit();
    }
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
    const id = editingId || `fi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const rateNum = parseFloat(fiRate);

    // Bonds are strictly RWT under NZ tax law; Term Deposits/Cash can be PIE or RWT
    const taxType: FixedInterestTaxType = fiCategory === 'bond' ? 'rwt' : fiTaxSelection;

    const newHolding: FixedInterestHolding = {
      id,
      depositId: fiDepositId.trim() || undefined,
      institution,
      name,
      category: fiCategory,
      taxType,
      valueNZD,
      maturityDate: fiMaturity.trim() || undefined,
      interestRate: Number.isFinite(rateNum) && rateNum >= 0 ? rateNum : undefined,
      frequency: fiFrequency,
      label: name,
      type: fiCategory === 'cash' ? 'cash' : 'term_deposit',
    };

    const updated = editingId
      ? holdingsList.map((h) => (h.id === editingId ? newHolding : h))
      : [...holdingsList, newHolding];

    onUpdateState({
      ...portfolioState,
      fixedInterest: updated,
      cashDeposits: updated,
    });

    handleCancelEdit();
  };

  const renderHoldingForm = (isInlineEdit: boolean) => (
    <div
      className={`border rounded-xl p-3 space-y-3 transition-colors ${
        isInlineEdit
          ? 'border-amber-500/60 bg-amber-950/20 shadow-lg border-l-4 border-l-amber-500 my-2'
          : 'bg-slate-950/40 border-slate-800/60 mt-3'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
          {isInlineEdit ? (
            <span className="text-amber-400 font-semibold flex items-center gap-1.5">
              <span>✎ Editing Holding</span>
              <span className="text-slate-400 font-normal">
                ({holdingsList.find((h) => h.id === editingId)?.name || 'Selected'})
              </span>
            </span>
          ) : (
            'Add Fixed Interest or Cash'
          )}
        </div>
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
                setFiTaxSelection('pie');
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
            value={fiCategory === 'bond' ? 'rwt' : fiTaxSelection}
            disabled={fiCategory === 'bond'}
            onChange={(e) => setFiTaxSelection(e.target.value as FixedInterestTaxType)}
            className={`w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500 ${
              fiCategory === 'bond' ? 'opacity-60 cursor-not-allowed' : ''
            }`}
          >
            <option value="pie">PIE (Applies your global PIR rate)</option>
            <option value="rwt">Standard RWT (Non-PIE)</option>
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
            placeholder="e.g. 10000"
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

        {/* Submit / Save Button */}
        <div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAddHolding}
              disabled={!(parseFloat(fiValue) > 0)}
              className="flex-1 py-1.5 px-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-semibold rounded-lg text-xs transition-colors"
            >
              {isInlineEdit ? '✓ Save Changes' : `+ Add ${fiCategory === 'bond' ? 'Bond' : fiCategory === 'term_deposit' ? 'Term Deposit' : 'Cash'}`}
            </button>
            {isInlineEdit && (
              <button
                type="button"
                onClick={handleCancelEdit}
                className="py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <CollapsiblePanel
      id="input-fixed-interest"
      title={
        <span className="text-[13px] font-semibold text-slate-200">
          3. Fixed Interest &amp; Cash (NZD)
        </span>
      }
      headerRight={
        <span className="text-xs text-amber-400 font-mono">
          ${formatNZD(fixedInterestSumNZD)} (
          {totalPortfolioNZD > 0
            ? ((fixedInterestSumNZD / totalPortfolioNZD) * 100).toFixed(1)
            : 0}
          % of portfolio)
        </span>
      }
    >
      <div className="space-y-2 text-xs">
        {/* Existing Holdings List */}
        {holdingsList.map((dep) => {
          const category = dep.category || dep.type || 'term_deposit';
          const isBond = category === 'bond';
          const isCash = category === 'cash';
          const isEditingThis = editingId === dep.id;

          return (
            <React.Fragment key={dep.id}>
              <div
                className={`rounded-xl p-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 transition-colors border ${
                  isEditingThis
                    ? 'bg-amber-950/20 border-amber-500/80'
                    : 'bg-slate-950/80 border-slate-800/80'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-white flex items-center gap-1.5 flex-wrap">
                    {/* Category Badge */}
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider border whitespace-nowrap ${
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
                      <span className="bg-cyan-950 text-cyan-300 px-1.5 py-0.5 rounded text-[10px] font-mono border border-cyan-800/50 whitespace-nowrap">
                        PIE (PIR)
                      </span>
                    ) : (
                      <span className="bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded text-[10px] font-mono whitespace-nowrap">
                        RWT
                      </span>
                    )}

                    <span className="text-slate-300 font-semibold">{dep.institution}</span>
                    <span className="text-slate-400 break-words">· {dep.name || dep.label}</span>
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
                <div className="flex items-center flex-wrap gap-2 sm:shrink-0">
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

                  {/* Edit Button */}
                  <button
                    type="button"
                    onClick={() => {
                      if (isEditingThis) {
                        handleCancelEdit();
                      } else {
                        handleStartEdit(dep);
                      }
                    }}
                    title={isEditingThis ? 'Cancel editing' : 'Edit details (rate, payment frequency, maturity, etc.)'}
                    className={`p-1.5 rounded-lg transition-colors ${
                      isEditingThis
                        ? 'text-amber-400 bg-amber-950/60 border border-amber-500/50'
                        : 'text-slate-400 hover:text-amber-300 hover:bg-slate-800'
                    }`}
                  >
                    ✎
                  </button>

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

              {/* Inline Edit Panel directly below the holding being edited */}
              {isEditingThis && renderHoldingForm(true)}
            </React.Fragment>
          );
        })}

        {/* At the bottom: Add New Holding Form (shown when not editing an existing holding) */}
        {!editingId && renderHoldingForm(false)}
      </div>
    </CollapsiblePanel>
  );
};
