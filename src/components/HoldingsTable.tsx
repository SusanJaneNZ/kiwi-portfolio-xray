import React, { useState } from 'react';
import { ConsolidatedHolding } from '../types/portfolio';
import { filterAndGroupHoldings } from '../engine/microfilter';

interface HoldingsTableProps {
  holdings: ConsolidatedHolding[];
}

export const HoldingsTable: React.FC<HoldingsTableProps> = ({ holdings }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [groupMicro, setGroupMicro] = useState(true);
  const [viewMode, setViewMode] = useState<'total' | 'equities'>('total');
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({
    NZMCYE0001S8: true, // Expand Mercury NZ by default for demonstrative clarity
  });

  const toggleRow = (isin: string) => {
    setExpandedRows((prev) => ({ ...prev, [isin]: !prev[isin] }));
  };

  const { visibleHoldings } = filterAndGroupHoldings(holdings, {
    searchQuery,
    groupMicroHoldings: groupMicro,
  });

  return (
    <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 md:p-5 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Consolidated Company Look-Through Exposure</h2>
          <p className="text-xs text-slate-400">
            All multi-fund holdings and direct equities deduplicated and aggregated by canonical ISIN.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Search box */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search company, ticker, ISIN..."
              className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-56"
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">🔍</span>
          </div>

          {/* Group micro-holdings toggle */}
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={groupMicro}
              onChange={(e) => setGroupMicro(e.target.checked)}
              className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0"
            />
            <span>Group micro-holdings (&lt; 0.01%)</span>
          </label>

          {/* Weight view toggle */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-0.5 flex text-xs">
            <button
              onClick={() => setViewMode('total')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                viewMode === 'total' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              % Total
            </button>
            <button
              onClick={() => setViewMode('equities')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                viewMode === 'equities' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              % Equities
            </button>
          </div>
        </div>
      </div>

      {/* Table container */}
      <div className="border border-slate-800 rounded-xl overflow-x-auto bg-slate-950">
        <table className="w-full text-left text-xs min-w-[750px]">
          <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
            <tr>
              <th className="py-3 px-4 w-12 text-center">#</th>
              <th className="py-3 px-4">Company Name & Ticker</th>
              <th className="py-3 px-4">Canonical ISIN</th>
              <th className="py-3 px-4">Country</th>
              <th className="py-3 px-4">GICS Sector</th>
              <th className="py-3 px-4 text-right">Exposure (NZD)</th>
              <th className="py-3 px-4 text-right">Weight</th>
              <th className="py-3 px-4 w-12 text-center">Drill</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-sans">
            {visibleHoldings.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-slate-500">
                  No company exposures matching current criteria.
                </td>
              </tr>
            ) : (
              visibleHoldings.map((h, idx) => {
                const isAggregate = h.isin === 'MICRO_HOLDINGS_AGGREGATE';
                const isExpanded = !!expandedRows[h.isin];
                const weightDisplay =
                  viewMode === 'total'
                    ? (h.portfolioWeight * 100).toFixed(2)
                    : (h.equityWeight * 100).toFixed(2);

                if (isAggregate) {
                  return (
                    <tr key={h.isin} className="bg-slate-900/60 font-semibold text-slate-400">
                      <td className="py-3 px-4 text-center font-mono">—</td>
                      <td className="py-3 px-4 italic text-slate-300">{h.name}</td>
                      <td className="py-3 px-4 font-mono text-slate-500">—</td>
                      <td className="py-3 px-4">🌐 Multi-Country</td>
                      <td className="py-3 px-4">All 11 Sectors</td>
                      <td className="py-3 px-4 text-right font-bold text-slate-300 font-mono">
                        ${h.valueNZD.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-slate-400 font-mono">
                        {weightDisplay}%
                      </td>
                      <td className="py-3 px-4 text-center text-slate-500 text-sm">—</td>
                    </tr>
                  );
                }

                const hasDirectSource = h.sources.some((s) => s.sourceType === 'direct');
                const hasFundSource = h.sources.some((s) => s.sourceType === 'fund');

                return (
                  <React.Fragment key={h.isin}>
                    <tr
                      onClick={() => toggleRow(h.isin)}
                      className="hover:bg-slate-800/40 transition-colors cursor-pointer select-none"
                    >
                      <td className="py-3 px-4 text-center text-slate-500 font-mono">{idx + 1}</td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-white flex items-center gap-1.5">
                          <span>{h.name}</span>
                          {h.ticker && (
                            <span className="bg-teal-950 text-teal-300 px-1.5 py-0.2 rounded text-[10px] font-mono border border-teal-700/50">
                              {h.ticker}
                            </span>
                          )}
                          {hasDirectSource && hasFundSource && (
                            <span className="bg-slate-800 text-slate-300 px-1 rounded text-[10px]">
                              Direct + Fund
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-400">{h.isin}</td>
                      <td className="py-3 px-4">{h.country}</td>
                      <td className="py-3 px-4 text-slate-300">{h.sector}</td>
                      <td className="py-3 px-4 text-right font-bold text-white font-mono">
                        ${h.valueNZD.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-emerald-400 font-mono">
                        {weightDisplay}%
                      </td>
                      <td className="py-3 px-4 text-center text-slate-400 text-xs">
                        {isExpanded ? '▼' : '▶'}
                      </td>
                    </tr>

                    {/* Expandable Drill-Down Sub-Rows */}
                    {isExpanded && (
                      <tr className="bg-slate-900/90 text-[11px] text-slate-300">
                        <td colSpan={8} className="p-3 pl-12 border-l-2 border-indigo-500">
                          <div className="space-y-1.5 max-w-2xl">
                            <span className="text-xs font-semibold text-indigo-300">
                              Contributing Sources for {h.name}:
                            </span>
                            {h.sources.map((s, sIdx) => (
                              <div
                                key={sIdx}
                                className="flex items-center justify-between py-1 border-b border-slate-800 last:border-0"
                              >
                                <span className="flex items-center gap-2">
                                  <span
                                    className={`w-2 h-2 rounded-full ${
                                      s.sourceType === 'direct' ? 'bg-emerald-400' : 'bg-indigo-400'
                                    }`}
                                  />
                                  {s.sourceType === 'direct' ? (
                                    <span>
                                      <strong className="text-white">Direct Holding</strong> (Broker Account)
                                    </span>
                                  ) : (
                                    <span>
                                      {s.fundName} (<strong className="text-white font-mono">{s.fundCode}</strong>)
                                      {s.effectiveDate && (
                                        <span className="text-slate-500"> · As of {s.effectiveDate}</span>
                                      )}
                                    </span>
                                  )}
                                </span>
                                <span className="font-mono text-white">
                                  ${s.valueNZD.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                                  {s.weightInFund !== undefined && (
                                    <span className="text-slate-400">
                                      ({(s.weightInFund * 100).toFixed(2)}% of fund)
                                    </span>
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

