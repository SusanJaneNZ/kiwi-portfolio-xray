import React, { useMemo, useState } from 'react';
import { CollapsiblePanel } from './CollapsiblePanel';
import {
  calculateRetirementCashflow,
  DEFAULT_DIVIDEND_YIELDS,
  NZ_SUPER_ANNUAL_RATES,
} from '../engine/income';
import {
  FundMetadata,
  NZSuperType,
  RetirementCashflowSettings,
  UserPortfolioState,
} from '../types/portfolio';
import { formatNZD } from '../utils/format';

interface RetirementCashflowPanelProps {
  portfolioState: UserPortfolioState;
  fundsRegistry: FundMetadata[];
  onUpdateState: (state: UserPortfolioState) => void;
  onApplyDrawdownToRebalancer?: (amount: number) => void;
}

type ActiveTab = 'overview' | 'fixed-interest' | 'dividends';
type BarViewMode = 'tax' | 'source';

const fmtMoney = (v: number) => formatNZD(v, 2);

export const RetirementCashflowPanel: React.FC<RetirementCashflowPanelProps> = ({
  portfolioState,
  fundsRegistry,
  onUpdateState,
  onApplyDrawdownToRebalancer,
}) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [barViewMode, setBarViewMode] = useState<BarViewMode>('tax');
  const [editingYieldKey, setEditingYieldKey] = useState<string | null>(null);
  const [editingYieldValue, setEditingYieldValue] = useState<string>('');

  const cashflowResult = useMemo(() => {
    return calculateRetirementCashflow({
      portfolioState,
      fundsRegistry,
    });
  }, [portfolioState, fundsRegistry]);

  const { settings } = cashflowResult;

  const handleUpdateSettings = (patch: Partial<RetirementCashflowSettings>) => {
    const updatedSettings: RetirementCashflowSettings = {
      ...settings,
      ...patch,
    };
    onUpdateState({
      ...portfolioState,
      cashflowSettings: updatedSettings,
    });
  };

  const handleSetBudgetPreset = (preset: number) => {
    handleUpdateSettings({ annualLivingBudget: preset });
  };

  const handleSaveYieldOverride = (key: string) => {
    const parsed = parseFloat(editingYieldValue);
    const overrides = { ...(settings.dividendYieldOverrides || {}) };

    if (!isNaN(parsed) && parsed >= 0) {
      overrides[key] = parsed;
    } else {
      delete overrides[key];
    }

    handleUpdateSettings({ dividendYieldOverrides: overrides });
    setEditingYieldKey(null);
    setEditingYieldValue('');
  };

  const handleResetYieldOverrides = () => {
    if (window.confirm('Reset all custom dividend yield overrides back to catalog defaults?')) {
      handleUpdateSettings({ dividendYieldOverrides: {} });
    }
  };

  const hasOverrides = Object.keys(settings.dividendYieldOverrides || {}).length > 0;

  // Breakdown percentages for visual bars
  const budget = Math.max(1, cashflowResult.annualLivingBudgetNZD);

  // Source view breakdown
  const fixedNetPct = Math.min(100, (cashflowResult.totalFixedInterestNetNZD / budget) * 100);
  const divNetPct = Math.min(100 - fixedNetPct, (cashflowResult.totalDividendsNetNZD / budget) * 100);
  const superPct = Math.min(
    100 - fixedNetPct - divNetPct,
    (cashflowResult.totalExternalIncomeNZD / budget) * 100
  );
  const sourceGapPct = Math.max(0, 100 - (fixedNetPct + divNetPct + superPct));

  // Tax view breakdown (PIE vs Non-PIE vs Drawdown)
  const piePct = Math.min(100, (cashflowResult.totalPieNetNZD / budget) * 100);
  const nonPiePct = Math.min(100 - piePct, (cashflowResult.totalNonPieNetNZD / budget) * 100);
  const taxGapPct = Math.max(0, 100 - (piePct + nonPiePct));

  return (
    <CollapsiblePanel
      id="retirement-cashflow"
      title={<span>Projected Organic Cashflow</span>}
      subtitle="Analyze 12-month forward cashflow across PIE vs Non-PIE income, and determine any capital drawdown needed for living expenses."
      headerRight={
        <span className="font-mono px-2.5 py-1 rounded-full text-xs font-semibold border bg-slate-900 text-slate-300 border-slate-700">
          {cashflowResult.isFullyFunded
            ? `Income Exceeds Budget (+${fmtMoney(cashflowResult.surplusDeficitNZD)})`
            : `Capital Drawdown: $${fmtMoney(cashflowResult.netCapitalDrawdownRequiredNZD)}`}
        </span>
      }
      className="md:p-5"
    >
      <div className="space-y-4">
        {/* Executive KPI Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Card 1: Annual Living Budget (After-Tax) */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between">
            <div>
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>Living Budget</span>
                <span className="text-amber-400 font-semibold font-mono text-[10px]">After-Tax Cash</span>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <span className="text-slate-400 font-mono text-sm">$</span>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  value={settings.annualLivingBudget || ''}
                  onChange={(e) =>
                    handleUpdateSettings({
                      annualLivingBudget: Math.max(0, parseFloat(e.target.value) || 0),
                    })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-base font-mono font-bold text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
            <div className="mt-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                {[60000, 80000, 100000, 120000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handleSetBudgetPreset(preset)}
                    className={`text-[10px] px-1.5 py-0.5 rounded font-mono transition-colors ${
                      settings.annualLivingBudget === preset
                        ? 'bg-indigo-600 text-white font-semibold'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    ${preset / 1000}k
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                Net spendable cash needed in bank. Inflows below are shown net of tax.
              </p>
            </div>
          </div>

          {/* Card 2: PIE Inflows (Net) */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between">
            <div>
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>PIE Inflows</span>
                <span className="text-teal-400 font-mono font-bold text-[10px]">Net (Capped PIR)</span>
              </div>
              <div className="mt-2 font-mono text-xl font-bold text-teal-400">
                ${fmtMoney(cashflowResult.totalPieNetNZD)}
              </div>
            </div>
            <div className="mt-2 text-[11px] text-slate-400 font-mono">
              <div className="flex justify-between">
                <span>PIE TDs: ${fmtMoney(cashflowResult.pieFixedNetNZD)}</span>
                <span>PIE Funds: ${fmtMoney(cashflowResult.pieDividendsNetNZD)}</span>
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Tax capped at max 28% PIR; excluded from personal tax returns.
              </div>
            </div>
          </div>

          {/* Card 3: Non-PIE Inflows (Net) */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between">
            <div>
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>Non-PIE Inflows</span>
                <span className="text-sky-400 font-mono font-bold text-[10px]">Net</span>
              </div>
              <div className="mt-2 font-mono text-xl font-bold text-sky-400">
                ${fmtMoney(cashflowResult.totalNonPieNetNZD)}
              </div>
            </div>
            <div className="mt-2 text-[11px] text-slate-400 font-mono">
              <div className="flex justify-between">
                <span>NZ Super: ${fmtMoney(cashflowResult.nzSuperNetAnnualNZD)}</span>
                {cashflowResult.otherGrossIncomeAnnualNZD > 0 && (
                  <span>Other Net: ${fmtMoney(cashflowResult.otherNetIncomeAnnualNZD)}</span>
                )}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Direct: ${fmtMoney(cashflowResult.nonPieDividendsNetNZD + cashflowResult.nonPieFixedNetNZD)} (with 28% imputation offset)
              </div>
            </div>
          </div>

          {/* Card 4: Capital Drawdown / Net Shortfall */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider flex items-center justify-between">
                <span className={cashflowResult.isFullyFunded ? 'text-slate-300' : 'text-amber-300'}>
                  Capital Drawdown
                </span>
                <span className="text-[11px] font-mono text-slate-400">
                  {cashflowResult.coverageRatioPercent.toFixed(0)}% from Income
                </span>
              </div>
              <div
                className={`mt-2 font-mono text-xl font-bold ${
                  cashflowResult.isFullyFunded ? 'text-slate-300' : 'text-amber-300'
                }`}
              >
                ${fmtMoney(cashflowResult.netCapitalDrawdownRequiredNZD)}
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[10px] text-slate-400">
                {cashflowResult.isFullyFunded
                  ? 'Budget fully met from income'
                  : 'Funded by selling assets (CGT-free for NZ/ASX)'}
              </span>
              {onApplyDrawdownToRebalancer && !cashflowResult.isFullyFunded && (
                <button
                  type="button"
                  onClick={() => onApplyDrawdownToRebalancer(cashflowResult.netCapitalDrawdownRequiredNZD)}
                  className="text-[11px] px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded font-medium transition-colors shadow-sm whitespace-nowrap"
                  title="Push this exact drawdown amount into the Bucket Rebalancer withdrawal input"
                >
                  ⚡ Sync Drawdown
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Cashflow Summary Banner */}
        <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 space-y-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-slate-200">
              {cashflowResult.isFullyFunded
                ? `Budget Fully Met by Income: +$${fmtMoney(cashflowResult.surplusDeficitNZD)} annual cashflow surplus`
                : `Budget Funding Split: ${cashflowResult.coverageRatioPercent.toFixed(1)}% Income / ${(
                    100 - cashflowResult.coverageRatioPercent
                  ).toFixed(1)}% Capital Drawdown`}
            </span>
            {onApplyDrawdownToRebalancer && !cashflowResult.isFullyFunded && (
              <button
                type="button"
                onClick={() => onApplyDrawdownToRebalancer(cashflowResult.netCapitalDrawdownRequiredNZD)}
                className="text-xs bg-slate-900 hover:bg-slate-800 text-white border border-slate-700 px-3 py-1 rounded-lg font-medium transition-colors whitespace-nowrap"
              >
                Apply ${fmtMoney(cashflowResult.netCapitalDrawdownRequiredNZD)} Drawdown to Rebalancer ↓
              </button>
            )}
          </div>

          <p className="text-slate-400 text-[11.5px] leading-relaxed">
            {cashflowResult.isFullyFunded
              ? `Projected net cashflow ($${fmtMoney(
                  cashflowResult.totalRetirementInflowNZD
                )}) exceeds your after-tax budget ($${fmtMoney(
                  cashflowResult.annualLivingBudgetNZD
                )}) by $${fmtMoney(
                  cashflowResult.surplusDeficitNZD
                )}. Living expenses can be funded entirely from income without liquidating capital.`
              : `Net income funds $${fmtMoney(
                  cashflowResult.totalRetirementInflowNZD
                )} of your $${fmtMoney(
                  cashflowResult.annualLivingBudgetNZD
                )} after-tax budget. The remaining $${fmtMoney(
                  cashflowResult.netCapitalDrawdownRequiredNZD
                )} is funded via capital drawdown.`}
          </p>
        </div>

        {/* Visual Living Budget Funding Sources Bar */}
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-300">Annual Budget Funding Sources</span>
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setBarViewMode('tax')}
                className={`px-2 py-0.5 rounded transition-colors ${
                  barViewMode === 'tax'
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Split by Tax Regime (PIE vs Non-PIE)
              </button>
              <button
                type="button"
                onClick={() => setBarViewMode('source')}
                className={`px-2 py-0.5 rounded transition-colors ${
                  barViewMode === 'source'
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Split by Asset Class
              </button>
            </div>
          </div>

          {/* Bar 1: Tax Regime (PIE vs Non-PIE vs Capital Drawdown) */}
          {barViewMode === 'tax' ? (
            <div className="space-y-1.5">
              <div className="w-full bg-slate-900 rounded-full h-3.5 flex overflow-hidden border border-slate-800">
                {piePct > 0 && (
                  <div
                    style={{ width: `${piePct}%` }}
                    className="bg-teal-500 hover:brightness-110 transition-all"
                    title={`PIE Inflows (Net): $${fmtMoney(cashflowResult.totalPieNetNZD)} (${piePct.toFixed(1)}% of budget)`}
                  />
                )}
                {nonPiePct > 0 && (
                  <div
                    style={{ width: `${nonPiePct}%` }}
                    className="bg-sky-500 hover:brightness-110 transition-all"
                    title={`Non-PIE Inflows (Net): $${fmtMoney(cashflowResult.totalNonPieNetNZD)} (${nonPiePct.toFixed(1)}% of budget)`}
                  />
                )}
                {taxGapPct > 0 && (
                  <div
                    style={{ width: `${taxGapPct}%` }}
                    className="bg-amber-600/80 hover:brightness-110 transition-all"
                    title={`Capital Drawdown: $${fmtMoney(cashflowResult.netCapitalDrawdownRequiredNZD)} (${taxGapPct.toFixed(1)}% of budget)`}
                  />
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-400 pt-1 font-mono">
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-teal-500 inline-block" />
                    <span>PIE Net: ${fmtMoney(cashflowResult.totalPieNetNZD)} ({piePct.toFixed(0)}%)</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-sky-500 inline-block" />
                    <span>Non-PIE Net: ${fmtMoney(cashflowResult.totalNonPieNetNZD)} ({nonPiePct.toFixed(0)}%)</span>
                  </span>
                  {taxGapPct > 0 && (
                    <span className="flex items-center gap-1.5 text-amber-300 font-semibold">
                      <span className="w-2.5 h-2.5 rounded-sm bg-amber-600 inline-block" />
                      <span>Capital Drawdown: ${fmtMoney(cashflowResult.netCapitalDrawdownRequiredNZD)} ({taxGapPct.toFixed(0)}%)</span>
                    </span>
                  )}
                </div>
                <span className="text-slate-400">
                  Target: ${fmtMoney(cashflowResult.annualLivingBudgetNZD)}
                </span>
              </div>
            </div>
          ) : (
            /* Bar 2: Asset Class / Source (Fixed Interest vs Dividends vs NZ Super vs Drawdown) */
            <div className="space-y-1.5">
              <div className="w-full bg-slate-900 rounded-full h-3.5 flex overflow-hidden border border-slate-800">
                {fixedNetPct > 0 && (
                  <div
                    style={{ width: `${fixedNetPct}%` }}
                    className="bg-sky-500 hover:brightness-110 transition-all"
                    title={`Fixed Interest & TDs: $${fmtMoney(cashflowResult.totalFixedInterestNetNZD)} (${fixedNetPct.toFixed(1)}%)`}
                  />
                )}
                {divNetPct > 0 && (
                  <div
                    style={{ width: `${divNetPct}%` }}
                    className="bg-emerald-500 hover:brightness-110 transition-all"
                    title={`Dividends & Distributions: $${fmtMoney(cashflowResult.totalDividendsNetNZD)} (${divNetPct.toFixed(1)}%)`}
                  />
                )}
                {superPct > 0 && (
                  <div
                    style={{ width: `${superPct}%` }}
                    className="bg-indigo-500 hover:brightness-110 transition-all"
                    title={`NZ Super & Other External: $${fmtMoney(cashflowResult.totalExternalIncomeNZD)} (${superPct.toFixed(1)}%)`}
                  />
                )}
                {sourceGapPct > 0 && (
                  <div
                    style={{ width: `${sourceGapPct}%` }}
                    className="bg-amber-600/80 hover:brightness-110 transition-all"
                    title={`Capital Drawdown: $${fmtMoney(cashflowResult.netCapitalDrawdownRequiredNZD)} (${sourceGapPct.toFixed(1)}%)`}
                  />
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-400 pt-1 font-mono">
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-sky-500 inline-block" />
                    <span>TDs &amp; Bonds ({fixedNetPct.toFixed(0)}%)</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
                    <span>Dividends ({divNetPct.toFixed(0)}%)</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500 inline-block" />
                    <span>NZ Super &amp; Other ({superPct.toFixed(0)}%)</span>
                  </span>
                  {sourceGapPct > 0 && (
                    <span className="flex items-center gap-1.5 text-amber-300 font-semibold">
                      <span className="w-2.5 h-2.5 rounded-sm bg-amber-600 inline-block" />
                      <span>Capital Drawdown ({sourceGapPct.toFixed(0)}%)</span>
                    </span>
                  )}
                </div>
                <span className="text-slate-400">
                  Target: ${fmtMoney(cashflowResult.annualLivingBudgetNZD)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center justify-between border-b border-slate-800 text-xs">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`px-3 py-2 border-b-2 font-medium transition-colors ${
                activeTab === 'overview'
                  ? 'border-indigo-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              ⚙ External Income &amp; Tax Settings
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('fixed-interest')}
              className={`px-3 py-2 border-b-2 font-medium transition-colors ${
                activeTab === 'fixed-interest'
                  ? 'border-indigo-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              🏦 Term Deposits &amp; Bonds ({cashflowResult.fixedInterestItems.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('dividends')}
              className={`px-3 py-2 border-b-2 font-medium transition-colors ${
                activeTab === 'dividends'
                  ? 'border-indigo-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              📈 Dividends &amp; Distributions ({cashflowResult.dividendItems.length})
            </button>
          </div>

          {activeTab === 'dividends' && hasOverrides && (
            <button
              type="button"
              onClick={handleResetYieldOverrides}
              className="text-[11px] text-amber-400 hover:text-amber-300 underline"
            >
              Reset Yield Overrides
            </button>
          )}
        </div>

        {/* Tab 1: External Income & Tax Settings */}
        {activeTab === 'overview' && (
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-4 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* NZ Superannuation */}
              <div className="space-y-2">
                <label className="font-semibold text-slate-300 block">
                  NZ Superannuation (Guaranteed State Pension)
                </label>
                <select
                  value={settings.nzSuperType}
                  onChange={(e) =>
                    handleUpdateSettings({ nzSuperType: e.target.value as NZSuperType })
                  }
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white font-medium focus:outline-none focus:border-indigo-500"
                >
                  <option value="none">None ($0)</option>
                  <option value="single_alone">
                    Single, Living Alone (~${fmtMoney(NZ_SUPER_ANNUAL_RATES.single_alone)}/yr net)
                  </option>
                  <option value="single_sharing">
                    Single, Sharing Accommodation (~${fmtMoney(NZ_SUPER_ANNUAL_RATES.single_sharing)}/yr net)
                  </option>
                  <option value="couple_both">
                    Married / Partnered — Both Qualify (~${fmtMoney(NZ_SUPER_ANNUAL_RATES.couple_both)}/yr combined net)
                  </option>
                  <option value="custom">Custom Annual Net Amount...</option>
                </select>

                {settings.nzSuperType === 'custom' && (
                  <div className="pt-1 flex items-center gap-2">
                    <span className="text-slate-400">Custom Annual Amount: $</span>
                    <input
                      type="number"
                      min="0"
                      step="500"
                      value={settings.nzSuperCustomAnnual || ''}
                      onChange={(e) =>
                        handleUpdateSettings({
                          nzSuperCustomAnnual: Math.max(0, parseFloat(e.target.value) || 0),
                        })
                      }
                      className="w-40 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-white font-mono"
                      placeholder="e.g. 35000"
                    />
                  </div>
                )}
                <p className="text-[11px] text-slate-500">
                  NZ Super rates reflect standard net "M" tax code payments from Work and Income NZ.
                </p>
              </div>

              {/* Other Gross Taxable Income */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-300 block">
                    Other Gross Taxable Inflows (Annual)
                  </label>
                  {cashflowResult.otherGrossIncomeAnnualNZD > 0 && (
                    <span className="text-[11px] font-mono text-emerald-400 font-medium">
                      Net: ${fmtMoney(cashflowResult.otherNetIncomeAnnualNZD)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 font-mono">$</span>
                  <input
                    type="number"
                    min="0"
                    step="500"
                    value={settings.otherGrossIncomeAnnual ?? settings.otherIncomeAnnual ?? ''}
                    placeholder="e.g. 15000"
                    onChange={(e) => {
                      const val = Math.max(0, parseFloat(e.target.value) || 0);
                      handleUpdateSettings({
                        otherGrossIncomeAnnual: val,
                        otherIncomeAnnual: val,
                      });
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  Gross residential rental income, foreign state pensions (UK/Australian), or consulting.
                  Taxed dynamically at your personal marginal tax rate ({(settings.marginalTaxRate * 100).toFixed(1)}%: -${fmtMoney(cashflowResult.otherGrossIncomeAnnualNZD * settings.marginalTaxRate)} tax drag).
                </p>
              </div>

              {/* Investor Prescribed Investor Rate (PIR) */}
              <div className="space-y-2">
                <label className="font-semibold text-slate-300 block">
                  Investor Prescribed Investor Rate (PIR)
                </label>
                <select
                  value={(settings.pirRate ?? 0.28).toString()}
                  onChange={(e) => {
                    const pir = parseFloat(e.target.value) as 0.105 | 0.175 | 0.28;
                    handleUpdateSettings({ pirRate: pir });
                    onUpdateState({ ...portfolioState, pirRate: pir });
                  }}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white font-medium focus:outline-none focus:border-indigo-500"
                >
                  <option value="0.28">28.0% PIR (Taxable income over $48k or total income over $70k) [Default]</option>
                  <option value="0.175">17.5% PIR (Taxable income up to $48k &amp; total income up to $70k)</option>
                  <option value="0.105">10.5% PIR (Taxable income up to $14k &amp; total income up to $48k)</option>
                </select>
                <p className="text-[11px] text-slate-500">
                  Applied to all PIE Term Deposits and multi-rate unlisted PIE funds (e.g. Kernel). Listed PIE funds and ETFs (e.g. Smartshares on NZX) are legally fixed at 28% under NZ tax legislation.
                </p>
              </div>

              {/* Marginal Tax Rate for Standard RWT */}
              <div className="space-y-2">
                <label className="font-semibold text-slate-300 block">
                  Investor Marginal Tax Rate (for RWT Interest, Direct Shares &amp; Other Inflows)
                </label>
                <select
                  value={settings.marginalTaxRate.toString()}
                  onChange={(e) =>
                    handleUpdateSettings({ marginalTaxRate: parseFloat(e.target.value) })
                  }
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white font-medium focus:outline-none focus:border-indigo-500"
                >
                  <option value="0.105">10.5% (Taxable income up to $15,600)</option>
                  <option value="0.175">17.5% (Taxable income $15,601 – $53,500)</option>
                  <option value="0.30">30.0% (Taxable income $53,501 – $78,100)</option>
                  <option value="0.33">33.0% (Taxable income $78,101 – $180,000) [Default]</option>
                  <option value="0.39">39.0% (Taxable income over $180,000)</option>
                </select>
                <p className="text-[11px] text-slate-500">
                  Applied to standard Resident Withholding Tax (RWT) deposits, corporate bonds, foreign/ASX shares, and other gross taxable inflows. NZ direct shares offset this with 28% imputation credits.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Fixed Interest & Term Deposits Breakdown Table */}
        {activeTab === 'fixed-interest' && (
          <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
            {/* Tab 2 Header Note */}
            <div className="px-3 py-2 bg-slate-900/70 border-b border-slate-800 text-xs text-slate-400">
              Assumes current term deposits and bonds run for 12 months at stated rates (assuming rollover upon maturity).
            </div>

            {cashflowResult.fixedInterestItems.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-xs">
                No term deposits, corporate bonds, or cash holdings entered yet in Panel 3.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[760px]">
                  <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="py-2.5 px-3">Institution &amp; Security</th>
                      <th className="py-2.5 px-3">Category</th>
                      <th className="py-2.5 px-3">Tax Structure</th>
                      <th className="py-2.5 px-3 text-right">Principal</th>
                      <th className="py-2.5 px-3 text-right">Rate p.a.</th>
                      <th className="py-2.5 px-3 text-right">Payment Cadence</th>
                      <th className="py-2.5 px-3 text-right">Gross Annual</th>
                      <th className="py-2.5 px-3 text-right">Net Annual</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {cashflowResult.fixedInterestItems.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-900/50">
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-white">{item.name}</div>
                          <div className="text-[11px] text-slate-500">{item.institution}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="capitalize px-2 py-0.5 rounded text-[11px] bg-slate-800 text-slate-300">
                            {item.category.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px]">
                          {item.taxType === 'pie' ? (
                            <span className="text-teal-400 bg-teal-950/50 border border-teal-800/40 rounded px-1.5 py-0.5">
                              PIE ({(item.effectiveTaxRate * 100).toFixed(1)}% PIR)
                            </span>
                          ) : (
                            <span className="text-slate-400 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5">
                              Non-PIE RWT ({(item.effectiveTaxRate * 100).toFixed(1)}%)
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-white">
                          ${fmtMoney(item.principalNZD)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-sky-400 font-semibold">
                          {item.interestRate.toFixed(2)}%
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-300 font-mono text-[11px]">
                          <div className="capitalize">{item.frequency}</div>
                          {item.maturityDate && (
                            <div className="text-[10px] text-slate-500">Mat: {item.maturityDate}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-300">
                          ${fmtMoney(item.grossAnnualNZD)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-emerald-400 font-bold">
                          ${fmtMoney(item.netAnnualNZD)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-900/80 border-t border-slate-800 font-semibold text-slate-300 font-mono text-xs">
                    <tr>
                      <td colSpan={3} className="py-2.5 px-3">
                        Total Fixed Interest &amp; Cash (PIE Net: ${fmtMoney(cashflowResult.pieFixedNetNZD)} | Non-PIE Net: ${fmtMoney(cashflowResult.nonPieFixedNetNZD)})
                      </td>
                      <td className="py-2.5 px-3 text-right text-white">
                        ${fmtMoney(cashflowResult.totalFixedInterestPrincipalNZD)}
                      </td>
                      <td colSpan={2} />
                      <td className="py-2.5 px-3 text-right text-slate-300">
                        ${fmtMoney(cashflowResult.totalFixedInterestGrossNZD)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-emerald-400 font-bold">
                        ${fmtMoney(cashflowResult.totalFixedInterestNetNZD)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Equities & Fund Distributions Breakdown Table */}
        {activeTab === 'dividends' && (
          <div className="border border-slate-800 rounded-xl overflow-x-auto bg-slate-950">
            {cashflowResult.dividendItems.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-xs">
                No direct shares, listed ETFs, or pooled funds entered yet.
              </div>
            ) : (
              <table className="w-full text-left text-xs min-w-[700px]">
                <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3">Holding</th>
                    <th className="py-2.5 px-3">Tax Classification</th>
                    <th className="py-2.5 px-3 text-right">Holdings / Units</th>
                    <th className="py-2.5 px-3 text-right">Value (NZD)</th>
                    <th className="py-2.5 px-3 text-right">Div Yield %</th>
                    <th className="py-2.5 px-3 text-right">Gross Div / Yr</th>
                    <th className="py-2.5 px-3 text-right">Est. Net / Yr</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {cashflowResult.dividendItems.map((item) => {
                    const isEditing = editingYieldKey === item.key;
                    const tickerClean = (item.ticker || item.key.split(':')[1] || '').toUpperCase();
                    const defaultYield = DEFAULT_DIVIDEND_YIELDS[tickerClean];

                    return (
                      <tr key={item.key} className="hover:bg-slate-900/50">
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-white flex items-center gap-1.5">
                            {item.ticker && (
                              <span className="font-mono bg-slate-800 text-slate-300 px-1 py-0.5 rounded text-[10px]">
                                {item.ticker}
                              </span>
                            )}
                            <span className="truncate max-w-[200px]">{item.label}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-[11px]">
                          {item.isPie ? (
                            <span className="text-teal-400 bg-teal-950/60 border border-teal-800/40 rounded px-1.5 py-0.5 font-mono">
                              {item.kind === 'fund'
                                ? `Multi-Rate PIE (${((settings.pirRate ?? 0.28) * 100).toFixed(1)}% PIR)`
                                : 'Listed PIE ETF (28% Fixed)'}
                            </span>
                          ) : (
                            <span className="text-slate-400 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 font-mono">
                              Direct Non-PIE Share
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-300">
                          {item.shares !== undefined ? `${item.shares.toLocaleString()} sh` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-white">
                          ${fmtMoney(item.valueNZD)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1">
                              <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.1"
                                value={editingYieldValue}
                                onChange={(e) => setEditingYieldValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveYieldOverride(tickerClean);
                                  if (e.key === 'Escape') setEditingYieldKey(null);
                                }}
                                className="w-16 bg-slate-900 border border-indigo-500 rounded px-1.5 py-0.5 text-right text-xs text-white"
                                autoFocus
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveYieldOverride(tickerClean)}
                                className="text-emerald-400 font-bold px-1 hover:text-emerald-300"
                                title="Save yield override"
                              >
                                ✓
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingYieldKey(null)}
                                className="text-slate-500 hover:text-rose-400 px-1"
                                title="Cancel"
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingYieldKey(item.key);
                                setEditingYieldValue(item.yieldPercent.toString());
                              }}
                              className={`group inline-flex items-center gap-1 font-semibold hover:underline ${
                                item.isOverride ? 'text-amber-400' : 'text-emerald-400'
                              }`}
                              title={`Click to edit yield (catalog default is ${defaultYield ?? 3.0}%)`}
                            >
                              <span>{item.yieldPercent.toFixed(2)}%</span>
                              <span className="text-[10px] text-slate-500 group-hover:text-slate-300">✎</span>
                            </button>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-300">
                          ${fmtMoney(item.grossAnnualNZD)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-emerald-400 font-bold">
                          ${fmtMoney(item.estimatedNetAnnualNZD)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-900/80 border-t border-slate-800 font-semibold text-slate-300 font-mono text-xs">
                  <tr>
                    <td colSpan={3} className="py-2.5 px-3">
                      Total Equities &amp; Funds (PIE Net: ${fmtMoney(cashflowResult.pieDividendsNetNZD)} | Direct Non-PIE: ${fmtMoney(cashflowResult.nonPieDividendsNetNZD)})
                    </td>
                    <td className="py-2.5 px-3 text-right text-white">
                      ${fmtMoney(cashflowResult.totalEquitiesValueNZD)}
                    </td>
                    <td />
                    <td className="py-2.5 px-3 text-right text-slate-300">
                      ${fmtMoney(cashflowResult.totalDividendsGrossNZD)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-emerald-400 font-bold">
                      ${fmtMoney(cashflowResult.totalDividendsNetNZD)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        )}
      </div>
    </CollapsiblePanel>
  );
};
