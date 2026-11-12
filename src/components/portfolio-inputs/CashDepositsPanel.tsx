import React, { useState } from 'react';
import { CollapsiblePanel } from '../CollapsiblePanel';
import { BucketSelect } from './BucketSelect';
import { CashDepositHolding, UserPortfolioState } from '../../types/portfolio';

const NZ_BANK_PRESETS = ['ANZ', 'ASB', 'BNZ', 'Westpac', 'Kiwibank', 'Heartland', 'Rabobank', 'TSB', 'SBS'];

interface CashDepositsPanelProps {
  portfolioState: UserPortfolioState;
  totalPortfolioNZD: number;
  depositSumNZD: number;
  onAssignBucket: (instrumentKey: string, bucketId: string) => void;
  onUpdateState: (state: UserPortfolioState) => void;
}

export const CashDepositsPanel: React.FC<CashDepositsPanelProps> = ({
  portfolioState,
  totalPortfolioNZD,
  depositSumNZD,
  onAssignBucket,
  onUpdateState,
}) => {
  const [depInstitution, setDepInstitution] = useState('ANZ');
  const [depCustomBank, setDepCustomBank] = useState('');
  const [depType, setDepType] = useState<'term_deposit' | 'cash'>('term_deposit');
  const [depLabel, setDepLabel] = useState('');
  const [depId, setDepId] = useState('');
  const [depValue, setDepValue] = useState('10000');
  const [depMaturity, setDepMaturity] = useState('');
  const [depRate, setDepRate] = useState('');

  const handleDepositValueChange = (id: string, value: string) => {
    const num = parseFloat(value);
    const safeVal = Number.isFinite(num) && num >= 0 ? num : 0;
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

  return (
    <CollapsiblePanel
      id="input-deposits"
      title={
        <span className="text-xs uppercase tracking-wider text-slate-300">
          3. Term Deposits &amp; Call Cash (NZD)
        </span>
      }
      headerRight={
        <span className="text-xs text-amber-400 font-mono">
          {totalPortfolioNZD > 0 ? ((depositSumNZD / totalPortfolioNZD) * 100).toFixed(1) : 0}% of portfolio
        </span>
      }
    >
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

            <div className="flex items-center gap-2">
              <BucketSelect
                instrumentKey={`td:${dep.id}`}
                buckets={portfolioState.buckets}
                bucketAssignments={portfolioState.bucketAssignments}
                onAssign={onAssignBucket}
              />
              <div className="w-36 sm:w-44 relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                <input
                  type="number"
                  min="0"
                  value={dep.valueNZD > 0 ? dep.valueNZD : ''}
                  placeholder="0"
                  onChange={(e) => handleDepositValueChange(dep.id, e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-6 pr-2.5 py-1.5 text-right text-xs sm:text-sm text-white focus:outline-none focus:border-amber-500 font-mono"
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

          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[170px]">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
              <input
                type="number"
                min="0"
                value={depValue}
                onChange={(e) => setDepValue(e.target.value)}
                placeholder="NZD Amount"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-6 pr-2.5 py-1.5 text-right text-xs sm:text-sm text-white font-mono"
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
              className="w-24 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white font-mono"
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
    </CollapsiblePanel>
  );
};

