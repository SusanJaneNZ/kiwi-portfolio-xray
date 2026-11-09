import React from 'react';
import { LiquidityBreakdown } from '../types/portfolio';

interface LiquidityCardProps {
  liquidity: LiquidityBreakdown;
  constituentCount: number;
}

export const LiquidityCard: React.FC<LiquidityCardProps> = ({ liquidity, constituentCount }) => {
  return (
    <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 shadow-sm">
        <span className="text-xs text-slate-400">Total Portfolio Value</span>
        <div className="text-xl font-bold text-white mt-1">
          ${liquidity.totalPortfolioNZD.toLocaleString('en-NZ', { maximumFractionDigits: 0 })} NZD
        </div>
        <span className="text-[11px] text-emerald-400 flex items-center gap-1 mt-0.5">
          100% Capital Allocated
        </span>
      </div>

      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 shadow-sm">
        <span className="text-xs text-slate-400">Look-Through Equities</span>
        <div className="text-xl font-bold text-sky-400 mt-1">
          ${liquidity.totalEquitiesNZD.toLocaleString('en-NZ', { maximumFractionDigits: 0 })} NZD
        </div>
        <span className="text-[11px] text-slate-400 mt-0.5">
          {liquidity.equitiesPercentage.toFixed(2)}% across {constituentCount.toLocaleString()} stocks
        </span>
      </div>

      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 shadow-sm">
        <span className="text-xs text-slate-400">Fund Cash Reserves</span>
        <div className="text-xl font-bold text-amber-400 mt-1">
          ${liquidity.totalCashNZD.toLocaleString('en-NZ', { maximumFractionDigits: 0 })} NZD
        </div>
        <span className="text-[11px] text-slate-400 mt-0.5">
          {liquidity.cashPercentage.toFixed(2)}% retained for liquidity
        </span>
      </div>

      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 shadow-sm">
        <span className="text-xs text-slate-400">Currency Hedging Contracts</span>
        <div className="text-xl font-bold text-purple-400 mt-1">
          ${liquidity.totalHedgingNZD.toLocaleString('en-NZ', { maximumFractionDigits: 0 })} NZD
        </div>
        <span className="text-[11px] text-slate-400 mt-0.5">
          {liquidity.hedgingPercentage.toFixed(2)}% forward hedging contracts
        </span>
      </div>
    </section>
  );
};

