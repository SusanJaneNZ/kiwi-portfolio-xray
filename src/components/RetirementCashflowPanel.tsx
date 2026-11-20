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
  PirRate,
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

type ActiveTab = 'external-income' | 'tax-assessment' | 'fixed-interest' | 'dividends';
type BarViewMode = 'tax' | 'source';

const fmtMoney = (v: number) => formatNZD(v, 2);

export const RetirementCashflowPanel: React.FC<RetirementCashflowPanelProps> = ({
  portfolioState,
  fundsRegistry,
  onUpdateState,
  onApplyDrawdownToRebalancer: _onApplyDrawdownToRebalancer,
}) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('external-income');
  const [barViewMode, setBarViewMode] = useState<BarViewMode>('tax');
  const [editingYieldKey, setEditingYieldKey] = useState<string | null>(null);
  const [editingYieldValue, setEditingYieldValue] = useState<string>('');

  const cashflowResult = useMemo(() => {
    return calculateRetirementCashflow({
      portfolioState,
      fundsRegistry,
    });
  }, [portfolioState, fundsRegistry]);

  const sortedFixedInterestItems = useMemo(() => {
    return [...cashflowResult.fixedInterestItems].sort(
      (a, b) => b.grossAnnualNZD - a.grossAnnualNZD || b.principalNZD - a.principalNZD
    );
  }, [cashflowResult.fixedInterestItems]);

  const sortedDividendItems = useMemo(() => {
    return [...cashflowResult.dividendItems].sort(
      (a, b) => b.grossAnnualNZD - a.grossAnnualNZD || b.valueNZD - a.valueNZD
    );
  }, [cashflowResult.dividendItems]);

  const { settings } = cashflowResult;

  const handleUpdateSettings = (patch: Partial<RetirementCashflowSettings>) => {
    const updatedSettings: RetirementCashflowSettings = {
      ...settings,
      ...patch,
    };
    const nextState: UserPortfolioState = {
      ...portfolioState,
      cashflowSettings: updatedSettings,
    };
    if (patch.isManualPir === false || (patch.pirRate === undefined && 'pirRate' in patch)) {
      delete nextState.pirRate;
    } else if (patch.pirRate !== undefined) {
      nextState.pirRate = patch.pirRate;
    }
    onUpdateState(nextState);
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

  // Breakdown percentages for visual bars (normalized across total funding basis)
  const totalBasis = Math.max(
    1,
    Math.max(cashflowResult.annualLivingBudgetNZD, cashflowResult.totalRetirementInflowNZD)
  );

  // Source view breakdown (TDs & Bonds, Dividends, NZ Super, Other Inflows, Capital Drawdown)
  const fixedNetPct = (cashflowResult.totalFixedInterestNetNZD / totalBasis) * 100;
  const divNetPct = (cashflowResult.totalDividendsNetNZD / totalBasis) * 100;
  const superNetPct = (cashflowResult.nzSuperNetAnnualNZD / totalBasis) * 100;
  const otherNetPct = (cashflowResult.otherNetIncomeAnnualNZD / totalBasis) * 100;
  const sourceGapPct = (cashflowResult.netCapitalDrawdownRequiredNZD / totalBasis) * 100;

  // Tax view breakdown (PIE vs Non-PIE vs Drawdown)
  const piePct = (cashflowResult.totalPieNetNZD / totalBasis) * 100;
  const nonPiePct = (cashflowResult.totalNonPieNetNZD / totalBasis) * 100;
  const taxGapPct = (cashflowResult.netCapitalDrawdownRequiredNZD / totalBasis) * 100;

  return (
    <CollapsiblePanel
      id="retirement-cashflow"
      title={<span>Projected Organic Cashflow</span>}
      subtitle="12-month projected after-tax income vs living budget."
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          {/* Card 1: Annual Living Budget (After-Tax) */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
            <div>
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>Living Budget</span>
                <span className="text-amber-400 font-semibold font-mono text-[10px]">After-Tax Cash</span>
              </div>
              <div className="mt-2.5 flex items-center gap-1.5">
                <span className="text-slate-400 font-mono text-base font-bold">$</span>
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
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xl font-mono font-bold text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
            <div className="mt-3">
              <div className="flex items-center gap-1.5 flex-wrap">
                {[60000, 80000, 100000, 120000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handleSetBudgetPreset(preset)}
                    className={`text-[11px] px-2 py-0.5 rounded font-mono transition-colors ${
                      settings.annualLivingBudget === preset
                        ? 'bg-indigo-600 text-white font-semibold'
                        : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    ${preset / 1000}k
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-2">
                Net spendable cash needed in bank. Inflows are evaluated against this budget.
              </p>
            </div>
          </div>

          {/* Card 2: PIE Inflows */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
            <div>
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                <span>PIE Inflows</span>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-3">
                <div>
                  <div className="font-mono text-2xl font-bold text-teal-400">
                    ${fmtMoney(cashflowResult.totalPieNetNZD)}
                  </div>
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Net Spendable Cash</div>
                </div>
                <div className="text-right bg-slate-900/80 px-2.5 py-1 rounded-lg border border-slate-800">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider">Gross PIE</div>
                  <div className="text-sm font-bold font-mono text-teal-300">
                    ${fmtMoney(cashflowResult.totalPieGrossNZD)}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3 text-xs">
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2.5 gap-y-1">
                <span className="text-slate-300 py-0.5 border-b border-slate-800/40">PIE Term Deposits:</span>
                <strong className="text-white font-mono text-right py-0.5 border-b border-slate-800/40">${fmtMoney(cashflowResult.pieFixedNetNZD)}</strong>
                <span className="text-slate-400 font-mono text-[11px] text-right py-0.5 border-b border-slate-800/40">(${fmtMoney(cashflowResult.pieFixedGrossNZD)} gross)</span>

                <span className="text-slate-300 py-0.5 border-b border-slate-800/40">PIE Funds &amp; ETFs:</span>
                <strong className="text-white font-mono text-right py-0.5 border-b border-slate-800/40">${fmtMoney(cashflowResult.pieDividendsNetNZD)}</strong>
                <span className="text-slate-400 font-mono text-[11px] text-right py-0.5 border-b border-slate-800/40">(${fmtMoney(cashflowResult.pieDividendsGrossNZD)} gross)</span>
              </div>
              <div className="text-[10px] text-slate-500 pt-1.5">
                Tax capped at max 28% PIR; excluded from personal tax returns.
              </div>
            </div>
          </div>

          {/* Card 3: Non-PIE Inflows */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
            <div>
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                <span>Non-PIE Inflows</span>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-3">
                <div>
                  <div className="font-mono text-2xl font-bold text-sky-400">
                    ${fmtMoney(cashflowResult.totalNonPieNetNZD)}
                  </div>
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Net Spendable Cash</div>
                </div>
                <div className="text-right bg-slate-900/80 px-2.5 py-1 rounded-lg border border-slate-800">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider">Gross Taxable</div>
                  <div className="text-sm font-bold font-mono text-sky-300">
                    ${fmtMoney(cashflowResult.totalNonPieGrossAnnualNZD)}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3 text-xs">
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2.5 gap-y-1">
                <span className="text-slate-300 py-0.5 border-b border-slate-800/40">Non-PIE TDs &amp; Cash:</span>
                <strong className="text-white font-mono text-right py-0.5 border-b border-slate-800/40">${fmtMoney(cashflowResult.nonPieFixedNetNZD)}</strong>
                <span className="text-slate-400 font-mono text-[11px] text-right py-0.5 border-b border-slate-800/40">(${fmtMoney(cashflowResult.nonPieFixedGrossNZD)} gross)</span>

                <span className="text-slate-300 py-0.5 border-b border-slate-800/40">Direct Share Dividends:</span>
                <strong className="text-white font-mono text-right py-0.5 border-b border-slate-800/40">${fmtMoney(cashflowResult.nonPieDividendsNetNZD)}</strong>
                <span className="text-slate-400 font-mono text-[11px] text-right py-0.5 border-b border-slate-800/40">(${fmtMoney(cashflowResult.nonPieDividendsGrossNZD)} gross)</span>

                <span className="text-slate-300 py-0.5 border-b border-slate-800/40">NZ Superannuation:</span>
                <strong className="text-white font-mono text-right py-0.5 border-b border-slate-800/40">${fmtMoney(cashflowResult.nzSuperNetAnnualNZD)}</strong>
                <span className="text-slate-400 font-mono text-[11px] text-right py-0.5 border-b border-slate-800/40">(${fmtMoney(cashflowResult.nzSuperGrossAnnualNZD)} gross)</span>

                {cashflowResult.otherGrossIncomeAnnualNZD > 0 && (
                  <>
                    <span className="text-slate-300 py-0.5 border-b border-slate-800/40">Other Inflows:</span>
                    <strong className="text-white font-mono text-right py-0.5 border-b border-slate-800/40">${fmtMoney(cashflowResult.otherNetIncomeAnnualNZD)}</strong>
                    <span className="text-slate-400 font-mono text-[11px] text-right py-0.5 border-b border-slate-800/40">(${fmtMoney(cashflowResult.otherGrossIncomeAnnualNZD)} gross)</span>
                  </>
                )}
              </div>
              <div className="text-[10px] text-slate-500 pt-1.5">
                Taxed via personal brackets{cashflowResult.nzImputationCreditsNZD > 0 ? ` (less $${fmtMoney(cashflowResult.nzImputationCreditsNZD)} imputation credits)` : ''}
              </div>
            </div>
          </div>
        </div>

        {/* Visual Living Budget Funding Sources Bar */}
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-300">Annual Cash Inflows &amp; Funding Sources</span>
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
                {superNetPct > 0 && (
                  <div
                    style={{ width: `${superNetPct}%` }}
                    className="bg-indigo-500 hover:brightness-110 transition-all"
                    title={`NZ Super: $${fmtMoney(cashflowResult.nzSuperNetAnnualNZD)} (${superNetPct.toFixed(1)}%)`}
                  />
                )}
                {otherNetPct > 0 && (
                  <div
                    style={{ width: `${otherNetPct}%` }}
                    className="bg-violet-500 hover:brightness-110 transition-all"
                    title={`Other Inflows: $${fmtMoney(cashflowResult.otherNetIncomeAnnualNZD)} (${otherNetPct.toFixed(1)}%)`}
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
                    <span>TDs &amp; Bonds: ${fmtMoney(cashflowResult.totalFixedInterestNetNZD)} ({fixedNetPct.toFixed(0)}%)</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />
                    <span>Dividends: ${fmtMoney(cashflowResult.totalDividendsNetNZD)} ({divNetPct.toFixed(0)}%)</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500 inline-block" />
                    <span>NZ Super: ${fmtMoney(cashflowResult.nzSuperNetAnnualNZD)} ({superNetPct.toFixed(0)}%)</span>
                  </span>
                  {(cashflowResult.otherGrossIncomeAnnualNZD > 0 || otherNetPct > 0) && (
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-violet-500 inline-block" />
                      <span>Other Inflows: ${fmtMoney(cashflowResult.otherNetIncomeAnnualNZD)} ({otherNetPct.toFixed(0)}%)</span>
                    </span>
                  )}
                  {sourceGapPct > 0 && (
                    <span className="flex items-center gap-1.5 text-amber-300 font-semibold">
                      <span className="w-2.5 h-2.5 rounded-sm bg-amber-600 inline-block" />
                      <span>Capital Drawdown: ${fmtMoney(cashflowResult.netCapitalDrawdownRequiredNZD)} ({sourceGapPct.toFixed(0)}%)</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center justify-between border-b border-slate-800 text-xs">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('external-income')}
              className={`px-3 py-2 border-b-2 font-medium transition-colors ${
                activeTab === 'external-income'
                  ? 'border-indigo-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              💼 External Income
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('tax-assessment')}
              className={`px-3 py-2 border-b-2 font-medium transition-colors ${
                activeTab === 'tax-assessment'
                  ? 'border-indigo-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              📋 Tax Assessment
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
              🏦 Fixed Interest &amp; Cash ({cashflowResult.fixedInterestItems.length})
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

        {/* Tab 1: External Income */}
        {activeTab === 'external-income' && (
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
                  Standard net M-code rates (Work and Income NZ).
                </p>
              </div>

              {/* Other Gross Taxable Income */}
              <div className="space-y-2">
                <label className="font-semibold text-slate-300 block">
                  Other Gross Taxable Inflows (Annual)
                </label>
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
                  Pre-tax rental, overseas pensions, or consulting (taxed at NZ personal brackets).
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Tax Assessment */}
        {activeTab === 'tax-assessment' && (
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-4 text-xs">
            {/* Prescribed Investor Rate (PIR) for PIE Inflows */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-slate-200 text-xs flex items-center gap-2">
                  <span>Prescribed Investor Rate (PIR) on PIE Inflows</span>
                  <span className="text-[10px] text-slate-400 font-normal">
                    (Multi-rate PIE funds &amp; PIE Term Deposits)
                  </span>
                </div>
                <span className="text-xs font-mono font-semibold text-emerald-400">
                  Active PIR: {(cashflowResult.pirRate * 100).toFixed(1)}% {!cashflowResult.isManualPir ? '(Auto-Default)' : '(Manual Override)'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
                <div className="md:col-span-2">
                  <select
                    value={settings.isManualPir && settings.pirRate !== undefined ? settings.pirRate.toString() : 'auto'}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === 'auto') {
                        handleUpdateSettings({ pirRate: undefined, isManualPir: false });
                      } else {
                        const pir = parseFloat(val) as PirRate;
                        handleUpdateSettings({ pirRate: pir, isManualPir: true });
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-medium focus:outline-none focus:border-indigo-500 text-xs"
                  >
                    <option value="auto">
                      Auto ({(cashflowResult.eligiblePirRate * 100).toFixed(1)}% PIR — Recommended)
                    </option>
                    <option value="0.28">28.0% PIR (Taxable income over $48k or total income over $70k)</option>
                    <option value="0.175">17.5% PIR (Taxable income up to $48k &amp; total income up to $70k)</option>
                    <option value="0.105">10.5% PIR (Taxable income up to $14k &amp; total income up to $48k)</option>
                  </select>
                </div>

                <div className="text-[11px] text-slate-400 bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                  <span>Eligible Tier: </span>
                  <strong className="text-white font-mono">{(cashflowResult.eligiblePirRate * 100).toFixed(1)}%</strong>
                  <span className="text-slate-500 block text-[10px] mt-0.5">
                    {cashflowResult.eligiblePirRate === 0.105
                      ? 'Taxable ≤ $14k & Total ≤ $48k'
                      : cashflowResult.eligiblePirRate === 0.175
                      ? 'Taxable ≤ $48k & Total ≤ $70k'
                      : 'Taxable > $48k or Total > $70k'}
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-slate-500 leading-relaxed">
                Applies to PIE Term Deposits and unlisted PIE funds (e.g. Kernel). Listed PIE ETFs (e.g. Smartshares on NZX) are fixed at 28%. Under IRD rules, PIR is based on your previous two tax years.
              </p>
            </div>

            {/* Progressive NZ Personal Income Tax Assessment Card */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-slate-200 text-xs flex items-center gap-2">
                  <span>NZ Income Tax Assessment on Non-PIE Inflows</span>
                  <span className="text-[10px] text-slate-400 font-normal">
                    (Statutory Brackets · {cashflowResult.nonPieTaxpayerCount === 2 ? 'Couple 2-Taxpayer Split' : 'Individual'})
                  </span>
                </div>
                <span className="text-xs font-mono font-semibold text-slate-300">
                  Effective Non-PIE Tax: {cashflowResult.effectivePersonalTaxRate.toFixed(1)}%
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800/80">
                  <div className="text-[10px] text-slate-400">Total Non-PIE Gross</div>
                  <div className="text-white font-mono font-semibold mt-0.5">
                    ${fmtMoney(cashflowResult.totalNonPieGrossAnnualNZD)}
                  </div>
                </div>
                <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800/80">
                  <div className="text-[10px] text-slate-400">Tax Payable</div>
                  <div className="text-white font-mono font-semibold mt-0.5">
                    -${fmtMoney(cashflowResult.nonPieGrossTaxPayableNZD)}
                  </div>
                </div>
                <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800/80">
                  <div className="text-[10px] text-slate-400">Imputation Credits</div>
                  <div className="text-white font-mono font-semibold mt-0.5">
                    +${fmtMoney(cashflowResult.nzImputationCreditsNZD)}
                  </div>
                </div>
                <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800/80">
                  <div className="text-[10px] text-slate-400">Net Spendable Non-PIE</div>
                  <div className="text-sky-400 font-mono font-bold mt-0.5">
                    ${fmtMoney(cashflowResult.totalNonPieNetNZD)}
                  </div>
                </div>
              </div>

              {/* Itemized Non-PIE Inflows Breakdown Table */}
              <div className="border border-slate-800/80 rounded-lg overflow-hidden bg-slate-950/50">
                <div className="px-3 py-1.5 bg-slate-900/60 border-b border-slate-800/80 text-[11px] font-semibold text-slate-300 flex items-center justify-between">
                  <span>Non-PIE Inflow Sources</span>
                  <span className="text-slate-500 font-normal text-[10px]">Taxed under personal progressive brackets</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs font-mono">
                    <thead>
                      <tr className="border-b border-slate-800/60 text-slate-400 text-[11px]">
                        <th className="py-2 px-3 font-medium">Flow / Source</th>
                        <th className="py-2 px-3 text-right font-medium">Gross Annual</th>
                        <th className="py-2 px-3 text-right font-medium">Share of Non-PIE</th>
                        <th className="py-2 px-3 text-right font-medium">Net Spendable</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40 text-slate-300 text-xs">
                      <tr>
                        <td className="py-2 px-3 text-white font-sans flex items-center gap-2">
                          <span className="w-2 h-2 rounded-sm bg-sky-500 inline-block" />
                          <span>Non-PIE Term Deposits &amp; Cash</span>
                        </td>
                        <td className="py-2 px-3 text-right text-slate-200">
                          ${fmtMoney(cashflowResult.nonPieFixedGrossNZD)}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-400">
                          {cashflowResult.totalNonPieGrossAnnualNZD > 0
                            ? ((cashflowResult.nonPieFixedGrossNZD / cashflowResult.totalNonPieGrossAnnualNZD) * 100).toFixed(1)
                            : '0.0'}%
                        </td>
                        <td className="py-2 px-3 text-right text-sky-400 font-semibold">
                          ${fmtMoney(cashflowResult.nonPieFixedNetNZD)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 text-white font-sans flex items-center gap-2">
                          <span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" />
                          <span>Direct NZ/ASX Share Dividends</span>
                        </td>
                        <td className="py-2 px-3 text-right text-slate-200">
                          ${fmtMoney(cashflowResult.nonPieDividendsGrossNZD)}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-400">
                          {cashflowResult.totalNonPieGrossAnnualNZD > 0
                            ? ((cashflowResult.nonPieDividendsGrossNZD / cashflowResult.totalNonPieGrossAnnualNZD) * 100).toFixed(1)
                            : '0.0'}%
                        </td>
                        <td className="py-2 px-3 text-right text-sky-400 font-semibold">
                          ${fmtMoney(cashflowResult.nonPieDividendsNetNZD)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 text-white font-sans flex items-center gap-2">
                          <span className="w-2 h-2 rounded-sm bg-indigo-500 inline-block" />
                          <span>NZ Superannuation</span>
                        </td>
                        <td className="py-2 px-3 text-right text-slate-200">
                          ${fmtMoney(cashflowResult.nzSuperGrossAnnualNZD)}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-400">
                          {cashflowResult.totalNonPieGrossAnnualNZD > 0
                            ? ((cashflowResult.nzSuperGrossAnnualNZD / cashflowResult.totalNonPieGrossAnnualNZD) * 100).toFixed(1)
                            : '0.0'}%
                        </td>
                        <td className="py-2 px-3 text-right text-sky-400 font-semibold">
                          ${fmtMoney(cashflowResult.nzSuperNetAnnualNZD)}
                        </td>
                      </tr>
                      {(cashflowResult.otherGrossIncomeAnnualNZD > 0 || cashflowResult.otherNetIncomeAnnualNZD > 0) && (
                        <tr>
                          <td className="py-2 px-3 text-white font-sans flex items-center gap-2">
                            <span className="w-2 h-2 rounded-sm bg-violet-500 inline-block" />
                            <span>Other Taxable Inflows</span>
                          </td>
                          <td className="py-2 px-3 text-right text-slate-200">
                            ${fmtMoney(cashflowResult.otherGrossIncomeAnnualNZD)}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-400">
                            {cashflowResult.totalNonPieGrossAnnualNZD > 0
                              ? ((cashflowResult.otherGrossIncomeAnnualNZD / cashflowResult.totalNonPieGrossAnnualNZD) * 100).toFixed(1)
                              : '0.0'}%
                          </td>
                          <td className="py-2 px-3 text-right text-sky-400 font-semibold">
                            ${fmtMoney(cashflowResult.otherNetIncomeAnnualNZD)}
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot className="bg-slate-900/70 border-t border-slate-800 text-xs font-semibold text-white">
                      <tr>
                        <td className="py-2 px-3 font-sans">Total Non-PIE Flows</td>
                        <td className="py-2 px-3 text-right">${fmtMoney(cashflowResult.totalNonPieGrossAnnualNZD)}</td>
                        <td className="py-2 px-3 text-right text-slate-400">100.0%</td>
                        <td className="py-2 px-3 text-right text-sky-400 font-bold">
                          ${fmtMoney(cashflowResult.totalNonPieNetNZD)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <p className="text-[11px] text-slate-500 leading-relaxed">
                Calculated using NZ statutory brackets (10.5%–39%) on non-PIE income. NZ company imputation credits (28%) directly reduce tax payable.
              </p>
            </div>
          </div>
        )}

        {/* Tab 3: Fixed Interest & Term Deposits Breakdown Table */}
        {activeTab === 'fixed-interest' && (
          <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
            {/* Tab 2 Header Note */}
            <div className="px-3 py-2 bg-slate-900/70 border-b border-slate-800 text-xs text-slate-400">
              Assumes 12-month rollover at current stated rates.
            </div>

            {cashflowResult.fixedInterestItems.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-xs">
                No fixed interest or cash entered. Add them under Portfolio → 3. Fixed Interest &amp; Cash.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[760px]">
                  <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="py-2.5 px-3">Institution &amp; Holding</th>
                      <th className="py-2.5 px-3">Category</th>
                      <th className="py-2.5 px-3">Tax Treatment</th>
                      <th className="py-2.5 px-3 text-right">Principal</th>
                      <th className="py-2.5 px-3 text-right">Rate p.a.</th>
                      <th className="py-2.5 px-3 text-right">Payment Frequency</th>
                      <th className="py-2.5 px-3 text-right">Gross Annual</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {sortedFixedInterestItems.map((item) => (
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
                              Non-PIE RWT
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
                        <td className="py-2.5 px-3 text-right font-mono text-emerald-400 font-bold">
                          ${fmtMoney(item.grossAnnualNZD)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-900/80 border-t border-slate-800 font-semibold text-slate-300 font-mono text-xs">
                    <tr>
                      <td colSpan={3} className="py-2.5 px-3">
                        Total Fixed Interest &amp; Cash ({cashflowResult.fixedInterestItems.length} holdings)
                        <span className="text-[10px] text-slate-400 block font-normal mt-0.5">
                          PIE Gross: ${fmtMoney(cashflowResult.pieFixedGrossNZD)} | Non-PIE Gross: ${fmtMoney(cashflowResult.nonPieFixedGrossNZD)}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-white">
                        ${fmtMoney(cashflowResult.totalFixedInterestPrincipalNZD)}
                      </td>
                      <td colSpan={2} />
                      <td className="py-2.5 px-3 text-right text-emerald-400 font-bold">
                        ${fmtMoney(cashflowResult.totalFixedInterestGrossNZD)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Equities & Fund Distributions Breakdown Table */}
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
                    <th className="py-2.5 px-3">Tax Treatment</th>
                    <th className="py-2.5 px-3 text-right">Holdings / Units</th>
                    <th className="py-2.5 px-3 text-right">Value (NZD)</th>
                    <th className="py-2.5 px-3 text-right">Div Yield %</th>
                    <th className="py-2.5 px-3 text-right">Gross Annual</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {sortedDividendItems.map((item) => {
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
                                ? `Multi-Rate PIE (${(cashflowResult.pirRate * 100).toFixed(1)}% PIR)`
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
                        <td className="py-2.5 px-3 text-right font-mono text-emerald-400 font-bold">
                          ${fmtMoney(item.grossAnnualNZD)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-900/80 border-t border-slate-800 font-semibold text-slate-300 font-mono text-xs">
                  <tr>
                    <td colSpan={3} className="py-2.5 px-3">
                      Total Equities &amp; Funds ({cashflowResult.dividendItems.length} holdings)
                      <span className="text-[10px] text-slate-400 block font-normal mt-0.5">
                        PIE Gross: ${fmtMoney(cashflowResult.pieDividendsGrossNZD)} | Direct Non-PIE Gross: ${fmtMoney(cashflowResult.nonPieDividendsGrossNZD)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right text-white">
                      ${fmtMoney(cashflowResult.totalEquitiesValueNZD)}
                    </td>
                    <td />
                    <td className="py-2.5 px-3 text-right text-emerald-400 font-bold">
                      ${fmtMoney(cashflowResult.totalDividendsGrossNZD)}
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
