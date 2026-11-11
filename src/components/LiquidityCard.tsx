import React from 'react';
import { LiquidityBreakdown } from '../types/portfolio';

interface LiquidityCardProps {
  liquidity: LiquidityBreakdown;
  constituentCount: number;
  bondIssuerCount: number;
}

const fmtNZD = (v: number) => v.toLocaleString('en-NZ', { maximumFractionDigits: 0 });

export const LiquidityCard: React.FC<LiquidityCardProps> = ({
  liquidity,
  constituentCount,
  bondIssuerCount,
}) => {
  const segments = [
    { label: 'NZ / AU Equities', pct: liquidity.nzAuEquitiesPercentage, val: liquidity.nzAuEquitiesNZD, color: 'bg-sky-500' },
    { label: 'Intl Equities', pct: liquidity.intlEquitiesPercentage, val: liquidity.intlEquitiesNZD, color: 'bg-indigo-500' },
    { label: 'Fixed Interest (Bonds)', pct: liquidity.bondsPercentage, val: liquidity.totalBondsNZD, color: 'bg-teal-500' },
    { label: 'Term Deposits', pct: liquidity.termDepositsPercentage, val: liquidity.totalTermDepositsNZD, color: 'bg-amber-500' },
    { label: 'Cash & Hedging', pct: liquidity.cashPercentage + liquidity.hedgingPercentage, val: liquidity.totalCashNZD + liquidity.totalHedgingNZD, color: 'bg-purple-500' },
  ];

  const totalDepositsAndCash = liquidity.totalTermDepositsNZD + liquidity.totalCashNZD;
  const totalDepositsAndCashPct = liquidity.termDepositsPercentage + liquidity.cashPercentage;

  return (
    <section className="space-y-3">
      {/* Stacked Asset Split Banner */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 shadow-sm space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white uppercase tracking-wider text-[11px]">
              Asset Class Split
            </span>
            <span className="bg-slate-950 border border-slate-800 rounded-full px-2.5 py-0.5 text-[11px] font-mono">
              <span className="text-sky-400 font-semibold">Growth {liquidity.growthPercentage.toFixed(1)}%</span>
              <span className="text-slate-600 mx-1.5">|</span>
              <span className="text-amber-400 font-semibold">Defensive {liquidity.defensivePercentage.toFixed(1)}%</span>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
            {segments.map((seg) => (
              <span key={seg.label} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${seg.color}`} />
                <span>{seg.label}:</span>
                <strong className="text-slate-200 font-mono">{seg.pct.toFixed(1)}%</strong>
              </span>
            ))}
          </div>
        </div>

        <div className="h-3 w-full bg-slate-950 rounded-full overflow-hidden flex">
          {segments.map((seg) =>
            seg.pct > 0 ? (
              <div
                key={seg.label}
                style={{ width: `${seg.pct}%` }}
                className={`${seg.color} h-full transition-all`}
                title={`${seg.label}: $${fmtNZD(seg.val)} NZD (${seg.pct.toFixed(2)}%)`}
              />
            ) : null
          )}
        </div>
      </div>

      {/* 4 Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 shadow-sm">
          <span className="text-xs text-slate-400">Total Portfolio Value</span>
          <div className="text-xl font-bold text-white mt-1">${fmtNZD(liquidity.totalPortfolioNZD)} NZD</div>
          <span className="text-[11px] text-emerald-400 flex items-center gap-1 mt-0.5">
            Growth {liquidity.growthPercentage.toFixed(0)}% · Defensive {liquidity.defensivePercentage.toFixed(0)}%
          </span>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 shadow-sm">
          <span className="text-xs text-slate-400">Look-Through Equities</span>
          <div className="text-xl font-bold text-sky-400 mt-1">${fmtNZD(liquidity.totalEquitiesNZD)} NZD</div>
          <span className="text-[11px] text-slate-400 mt-0.5 block">
            {liquidity.equitiesPercentage.toFixed(2)}% across {constituentCount.toLocaleString()} stocks
          </span>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 shadow-sm">
          <span className="text-xs text-slate-400">Fixed Interest / Bonds</span>
          <div className="text-xl font-bold text-teal-400 mt-1">${fmtNZD(liquidity.totalBondsNZD)} NZD</div>
          <span className="text-[11px] text-slate-400 mt-0.5 block">
            {liquidity.bondsPercentage.toFixed(2)}% across {bondIssuerCount.toLocaleString()} issuers
          </span>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 shadow-sm">
          <span className="text-xs text-slate-400">Term Deposits &amp; Cash</span>
          <div className="text-xl font-bold text-amber-400 mt-1">${fmtNZD(totalDepositsAndCash)} NZD</div>
          <span className="text-[11px] text-slate-400 mt-0.5 block">
            {totalDepositsAndCashPct.toFixed(2)}% (Hedging: ${fmtNZD(liquidity.totalHedgingNZD)})
          </span>
        </div>
      </div>
    </section>
  );
};
