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

const fmtMoney = (v: number) => formatNZD(v, 2);

export const RetirementCashflowPanel: React.FC<RetirementCashflowPanelProps> = ({
  portfolioState,
  fundsRegistry,
  onUpdateState,
  onApplyDrawdownToRebalancer,
}) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
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

  // Breakdown percentages for the visual coverage bar
  const budget = Math.max(1, cashflowResult.annualLivingBudgetNZD);
  const fixedNetPct = Math.min(100, (cashflowResult.totalFixedInterestNetNZD / budget) * 100);
  const divNetPct = Math.min(100 - fixedNetPct, (cashflowResult.totalDividendsNetNZD / budget) * 100);
  const superPct = Math.min(
    100 - fixedNetPct - divNetPct,
    (cashflowResult.totalExternalIncomeNZD / budget) * 100
  );
  const gapPct = Math.max(0, 100 - (fixedNetPct + divNetPct + superPct));

  return (
    <CollapsiblePanel
      id="retirement-cashflow"
      title={<span>Retirement Cashflow &amp; Drawdown</span>}
      subtitle="Project 12-month forward dividends, interest, and NZ Superannuation to fund retirement spending before liquidating capital."
      headerRight={
        <span
          className={`font-mono px-2.5 py-1 rounded-full text-xs font-semibold border ${
            cashflowResult.isFullyFunded
              ? 'bg-emerald-950/70 text-emerald-300 border-emerald-700/60'
              : 'bg-amber-950/70 text-amber-300 border-amber-700/60'
          }`}
        >
          {cashflowResult.isFullyFunded
            ? `✓ 100% Fully Funded (+${fmtMoney(cashflowResult.surplusDeficitNZD)})`
            : `⚠ Shortfall: ${fmtMoney(cashflowResult.netCapitalDrawdownRequiredNZD)} Drawdown`}
        </span>
      }
      className="md:p-5"
    >
      <div className="space-y-4">
        {/* Executive KPI Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Card 1: Annual Living Budget */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between">
            <div>
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>Living Budget</span>
                <span className="text-slate-500 font-normal">Target / Yr</span>
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
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
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
          </div>

          {/* Card 2: Organic Portfolio Cashflow */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between">
            <div>
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>Organic Cashflow</span>
                <span className="text-emerald-400 font-mono font-bold">Net</span>
              </div>
              <div className="mt-2 font-mono text-xl font-bold text-emerald-400">
                ${fmtMoney(cashflowResult.totalOrganicNetNZD)}
              </div>
            </div>
            <div className="mt-2 text-[11px] text-slate-400 font-mono flex items-center justify-between">
              <span>Gross: ${fmtMoney(cashflowResult.totalOrganicGrossNZD)}</span>
              <span>
                TDs ${fmtMoney(cashflowResult.totalFixedInterestNetNZD)} + Divs ${fmtMoney(cashflowResult.totalDividendsNetNZD)}
              </span>
            </div>
          </div>

          {/* Card 3: Guaranteed External Income */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between">
            <div>
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>External Inflows</span>
                <span className="text-sky-400 font-mono font-bold">Net</span>
              </div>
              <div className="mt-2 font-mono text-xl font-bold text-sky-400">
                ${fmtMoney(cashflowResult.totalExternalIncomeNZD)}
              </div>
            </div>
            <div className="mt-2 text-[11px] text-slate-400 font-mono flex items-center justify-between">
              <span>NZ Super: ${fmtMoney(cashflowResult.nzSuperAnnualNZD)}</span>
              {cashflowResult.otherIncomeAnnualNZD > 0 && (
                <span>Other: ${fmtMoney(cashflowResult.otherIncomeAnnualNZD)}</span>
              )}
            </div>
          </div>

          {/* Card 4: Net Capital Drawdown Needed */}
          <div
            className={`border rounded-xl p-3.5 flex flex-col justify-between ${
              cashflowResult.isFullyFunded
                ? 'bg-emerald-950/30 border-emerald-800/60'
                : 'bg-amber-950/30 border-amber-800/60'
            }`}
          >
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider flex items-center justify-between">
                <span className={cashflowResult.isFullyFunded ? 'text-emerald-300' : 'text-amber-300'}>
                  Net Capital Drawdown
                </span>
                <span className="text-[11px] font-mono text-slate-400">
                  {cashflowResult.coverageRatioPercent.toFixed(0)}% Funded
                </span>
              </div>
              <div
                className={`mt-2 font-mono text-xl font-bold ${
                  cashflowResult.isFullyFunded ? 'text-emerald-400' : 'text-amber-300'
                }`}
              >
                ${fmtMoney(cashflowResult.netCapitalDrawdownRequiredNZD)}
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400">
                {cashflowResult.isFullyFunded
                  ? `+$${fmtMoney(cashflowResult.surplusDeficitNZD)} surplus buffer`
                  : 'Liquidation required'}
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

        {/* Coverage Status Banner */}
        <div
          className={`border rounded-xl p-3 text-xs flex flex-wrap items-center justify-between gap-3 ${
            cashflowResult.isFullyFunded
              ? 'bg-emerald-950/40 border-emerald-700/50 text-emerald-200'
              : 'bg-amber-950/40 border-amber-700/50 text-amber-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-base">{cashflowResult.isFullyFunded ? '🎉' : '🛡'}</span>
            <div>
              <strong>
                {cashflowResult.isFullyFunded
                  ? 'Living Budget 100% Funded by Organic Cashflows & Pensions!'
                  : `Living Budget ${cashflowResult.coverageRatioPercent.toFixed(1)}% Covered by Inflows.`}
              </strong>
              <div className="text-[11px] opacity-90 mt-0.5">
                {cashflowResult.isFullyFunded
                  ? `Your total net cashflow of $${fmtMoney(
                      cashflowResult.totalRetirementInflowNZD
                    )} covers your $${fmtMoney(
                      cashflowResult.annualLivingBudgetNZD
                    )} budget with a $${fmtMoney(
                      cashflowResult.surplusDeficitNZD
                    )} surplus buffer. Zero shares need to be sold this year.`
                  : `Net inflows fund $${fmtMoney(
                      cashflowResult.totalRetirementInflowNZD
                    )} of your $${fmtMoney(
                      cashflowResult.annualLivingBudgetNZD
                    )} budget. Only the remaining $${fmtMoney(
                      cashflowResult.netCapitalDrawdownRequiredNZD
                    )} shortfall needs to be liquidated via bucket rebalancing.`}
              </div>
            </div>
          </div>
          {onApplyDrawdownToRebalancer && (
            <button
              type="button"
              onClick={() => onApplyDrawdownToRebalancer(cashflowResult.netCapitalDrawdownRequiredNZD)}
              className="text-xs bg-slate-900 hover:bg-slate-800 text-white border border-slate-700 px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap ml-auto"
            >
              Apply ${fmtMoney(cashflowResult.netCapitalDrawdownRequiredNZD)} to Rebalancer ↓
            </button>
          )}
        </div>

        {/* Visual Living Budget Cashflow Coverage Bar */}
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold text-slate-300">Annual Budget Funding Sources</span>
            <span className="font-mono text-[11px]">
              Total Inflows: ${fmtMoney(cashflowResult.totalRetirementInflowNZD)} / Target: ${fmtMoney(cashflowResult.annualLivingBudgetNZD)}
            </span>
          </div>

          <div className="w-full bg-slate-900 rounded-full h-3 flex overflow-hidden border border-slate-800">
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
            {gapPct > 0 && (
              <div
                style={{ width: `${gapPct}%` }}
                className="bg-amber-600/70 hover:brightness-110 transition-all pattern-diagonal-stripes"
                title={`Capital Drawdown Shortfall: $${fmtMoney(cashflowResult.netCapitalDrawdownRequiredNZD)} (${gapPct.toFixed(1)}%)`}
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
              {gapPct > 0 && (
                <span className="flex items-center gap-1.5 text-amber-300 font-semibold">
                  <span className="w-2.5 h-2.5 rounded-sm bg-amber-600 inline-block" />
                  <span>Capital Drawdown ({gapPct.toFixed(0)}%)</span>
                </span>
              )}
            </div>
            {cashflowResult.isFullyFunded && (
              <span className="text-emerald-400 font-semibold">✓ 100% Organic Funded</span>
            )}
          </div>
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

              {/* Other Net Guaranteed Income */}
              <div className="space-y-2">
                <label className="font-semibold text-slate-300 block">
                  Other Net Guaranteed Inflows (Annual)
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 font-mono">$</span>
                  <input
                    type="number"
                    min="0"
                    step="500"
                    value={settings.otherIncomeAnnual || ''}
                    placeholder="e.g. 12000"
                    onChange={(e) =>
                      handleUpdateSettings({
                        otherIncomeAnnual: Math.max(0, parseFloat(e.target.value) || 0),
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  Net residential rental income, foreign state pensions (UK/Australian), or private lifetime annuities.
                </p>
              </div>

              {/* Marginal Tax Rate for Standard RWT */}
              <div className="space-y-2">
                <label className="font-semibold text-slate-300 block">
                  Investor Marginal Tax Rate (for RWT Interest &amp; Bonds)
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
                  Applied strictly to standard Resident Withholding Tax (RWT) deposits and corporate bonds. Variable-rate PIE deposits use their own configured PIR (10.5%, 17.5%, or 28%).
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Fixed Interest & Term Deposits Breakdown Table */}
        {activeTab === 'fixed-interest' && (
          <div className="border border-slate-800 rounded-xl overflow-x-auto bg-slate-950">
            {cashflowResult.fixedInterestItems.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-xs">
                No term deposits, corporate bonds, or cash holdings entered yet in Panel 3.
              </div>
            ) : (
              <table className="w-full text-left text-xs min-w-[700px]">
                <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3">Institution &amp; Security</th>
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3">Tax Structure</th>
                    <th className="py-2.5 px-3 text-right">Principal</th>
                    <th className="py-2.5 px-3 text-right">Rate</th>
                    <th className="py-2.5 px-3 text-right">Cadence</th>
                    <th className="py-2.5 px-3 text-right">Gross / Yr</th>
                    <th className="py-2.5 px-3 text-right">Net / Yr</th>
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
                          <span className="text-emerald-400">
                            PIE ({(item.effectiveTaxRate * 100).toFixed(1)}% PIR)
                          </span>
                        ) : (
                          <span className="text-slate-400">
                            RWT ({(item.effectiveTaxRate * 100).toFixed(1)}%)
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-white">
                        ${fmtMoney(item.principalNZD)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-sky-400 font-semibold">
                        {item.interestRate.toFixed(2)}%
                      </td>
                      <td className="py-2.5 px-3 text-right capitalize text-slate-400">
                        {item.frequency}
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
                      Total Fixed Interest &amp; Cash ({cashflowResult.fixedInterestItems.length} holdings)
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
                    <th className="py-2.5 px-3">Type</th>
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
                        <td className="py-2.5 px-3 capitalize text-slate-400">
                          {item.kind === 'direct' ? 'Direct / ETF' : 'Pooled Fund'}
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
                      Total Equities &amp; Funds ({cashflowResult.dividendItems.length} holdings)
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

