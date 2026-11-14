import React from 'react';
import { ConsolidatedHolding } from '../../types/portfolio';
import { formatNZD } from '../../utils/format';

interface EquitiesTabTableProps {
  holdings: ConsolidatedHolding[];
  viewMode: 'total' | 'equities';
  expandedRows: Record<string, boolean>;
  onToggleRow: (key: string) => void;
}

export const EquitiesTabTable: React.FC<EquitiesTabTableProps> = ({
  holdings,
  viewMode,
  expandedRows,
  onToggleRow,
}) => {
  return (
    <div className="border border-slate-800 rounded-xl overflow-auto max-h-[460px] bg-slate-950">
      <table className="w-full text-left text-xs min-w-[780px]">
        <thead className="sticky top-0 z-10 bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
          <tr>
            <th className="py-3 px-4 w-12 text-center">#</th>
            <th className="py-3 px-4">Ticker</th>
            <th className="py-3 px-4">Company Name</th>
            <th className="py-3 px-4">Canonical ISIN</th>
            <th className="py-3 px-4">Country</th>
            <th className="py-3 px-4">GICS Sector</th>
            <th className="py-3 px-4 text-right">Exposure (NZD)</th>
            <th className="py-3 px-4 text-right">Weight</th>
            <th className="py-3 px-4 w-12 text-center">Drill</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60 font-sans">
          {holdings.length === 0 ? (
            <tr>
              <td colSpan={9} className="py-10 text-center text-slate-500">
                No equity exposures matching current criteria.
              </td>
            </tr>
          ) : (
            holdings.map((h, idx) => {
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
                    <td className="py-3 px-4 font-mono text-slate-500">MICRO</td>
                    <td className="py-3 px-4 italic text-slate-300">{h.name}</td>
                    <td className="py-3 px-4 font-mono text-slate-500">—</td>
                    <td className="py-3 px-4">🌐 Multi-Country</td>
                    <td className="py-3 px-4">All 11 Sectors</td>
                    <td className="py-3 px-4 text-right font-bold text-slate-300 font-mono">
                      ${formatNZD(h.valueNZD, 2)}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-slate-400 font-mono">{weightDisplay}%</td>
                    <td className="py-3 px-4 text-center text-slate-500 text-sm">—</td>
                  </tr>
                );
              }

              const hasDirectSource = h.sources.some((s) => s.sourceType === 'direct' && !s.fundCode);
              const hasFundSource = h.sources.some((s) => s.sourceType === 'fund' || Boolean(s.fundCode));

              return (
                <React.Fragment key={h.isin}>
                  <tr
                    onClick={() => onToggleRow(h.isin)}
                    className="hover:bg-slate-800/40 transition-colors cursor-pointer select-none"
                  >
                    <td className="py-3 px-4 text-center text-slate-500 font-mono">{idx + 1}</td>
                    <td className="py-3 px-4 font-mono">
                      {h.ticker ? (
                        <span className="bg-teal-950 text-teal-300 px-1.5 py-0.5 rounded text-[11px] font-semibold border border-teal-700/50">
                          {h.ticker}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-white flex items-center gap-1.5">
                        <span>{h.name}</span>
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
                      ${formatNZD(h.valueNZD, 2)}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-emerald-400 font-mono">
                      {weightDisplay}%
                    </td>
                    <td className="py-3 px-4 text-center text-slate-400 text-xs">{isExpanded ? '▼' : '▶'}</td>
                  </tr>

                  {isExpanded && (
                    <tr className="bg-slate-900/90 text-[11px] text-slate-300">
                      <td colSpan={9} className="p-3 pl-12 border-l-2 border-indigo-500">
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
                                    s.sourceType === 'direct' && !s.fundCode ? 'bg-emerald-400' : 'bg-indigo-400'
                                  }`}
                                />
                                {s.fundCode || s.fundName ? (
                                  <span>
                                    {s.fundName || s.fundCode}
                                    {s.fundCode && s.fundName && !s.fundName.includes(s.fundCode) && (
                                      <> (<strong className="text-white font-mono">{s.fundCode}</strong>)</>
                                    )}
                                    {s.effectiveDate && <span className="text-slate-500"> · As of {s.effectiveDate}</span>}
                                  </span>
                                ) : (
                                  <span>
                                    <strong className="text-white">Direct Holding</strong> (Broker Account)
                                  </span>
                                )}
                              </span>
                              <span className="font-mono text-white">
                                ${formatNZD(s.valueNZD, 2)}{' '}
                                {s.weightInFund !== undefined && (
                                  <span className="text-slate-400">({(s.weightInFund * 100).toFixed(2)}% of fund)</span>
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
  );
};

