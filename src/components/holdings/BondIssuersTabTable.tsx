import React from 'react';
import { ConsolidatedHolding } from '../../types/portfolio';
import { formatNZD } from '../../utils/format';

interface BondIssuersTabTableProps {
  bonds: ConsolidatedHolding[];
  expandedRows: Record<string, boolean>;
  onToggleRow: (key: string) => void;
}

export const BondIssuersTabTable: React.FC<BondIssuersTabTableProps> = ({
  bonds,
  expandedRows,
  onToggleRow,
}) => {
  return (
    <div className="border border-slate-800 rounded-xl overflow-auto max-h-[460px] bg-slate-950">
      <table className="w-full text-left text-xs min-w-[750px]">
        <thead className="sticky top-0 z-10 bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
          <tr>
            <th className="py-3 px-4 w-12 text-center">#</th>
            <th className="py-3 px-4">Bond Issuer / ETF</th>
            <th className="py-3 px-4">Category</th>
            <th className="py-3 px-4">Country</th>
            <th className="py-3 px-4 text-right">Tranches</th>
            <th className="py-3 px-4 text-right">Exposure (NZD)</th>
            <th className="py-3 px-4 text-right">% Portfolio</th>
            <th className="py-3 px-4 w-12 text-center">Drill</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60 font-sans">
          {bonds.length === 0 ? (
            <tr>
              <td colSpan={8} className="py-10 text-center text-slate-500">
                No bond or fixed-interest holdings in the current portfolio.
              </td>
            </tr>
          ) : (
            bonds.map((b, idx) => {
              const rowKey = `bond:${b.isin}`;
              const isExpanded = !!expandedRows[rowKey];
              return (
                <React.Fragment key={rowKey}>
                  <tr
                    onClick={() => onToggleRow(rowKey)}
                    className="hover:bg-slate-800/40 transition-colors cursor-pointer select-none"
                  >
                    <td className="py-3 px-4 text-center text-slate-500 font-mono">{idx + 1}</td>
                    <td className="py-3 px-4 font-semibold text-white">{b.name}</td>
                    <td className="py-3 px-4 text-teal-300">{b.sector}</td>
                    <td className="py-3 px-4">{b.country}</td>
                    <td className="py-3 px-4 text-right font-mono text-slate-400">{b.trancheCount || 1}</td>
                    <td className="py-3 px-4 text-right font-bold text-white font-mono">
                      ${formatNZD(b.valueNZD, 2)}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-teal-400 font-mono">
                      {(b.portfolioWeight * 100).toFixed(2)}%
                    </td>
                    <td className="py-3 px-4 text-center text-slate-400 text-xs">{isExpanded ? '▼' : '▶'}</td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-slate-900/90 text-[11px] text-slate-300">
                      <td colSpan={8} className="p-3 pl-12 border-l-2 border-teal-500">
                        <div className="space-y-1 max-w-2xl">
                          {b.sources.map((s, sIdx) => (
                            <div key={sIdx} className="flex justify-between py-1 border-b border-slate-800 last:border-0">
                              <span>
                                {s.fundName} (<strong className="text-white font-mono">{s.fundCode}</strong>)
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

