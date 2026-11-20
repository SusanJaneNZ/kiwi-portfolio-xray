import React from 'react';
import { IssuerRollupEntry } from '../../types/portfolio';
import { formatNZD } from '../../utils/format';

interface InstitutionRollupTabTableProps {
  institutions: IssuerRollupEntry[];
  expandedRows: Record<string, boolean>;
  onToggleRow: (key: string) => void;
}

export const InstitutionRollupTabTable: React.FC<InstitutionRollupTabTableProps> = ({
  institutions,
  expandedRows,
  onToggleRow,
}) => {
  return (
    <div className="border border-slate-800 rounded-xl overflow-auto max-h-[460px] bg-slate-950">
      <table className="w-full text-left text-xs min-w-[750px]">
        <thead className="sticky top-0 z-10 bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
          <tr>
            <th className="py-3 px-4 w-12 text-center">#</th>
            <th className="py-3 px-4">Institution / Group</th>
            <th className="py-3 px-4 text-right">Equities (NZD)</th>
            <th className="py-3 px-4 text-right">Bonds (NZD)</th>
            <th className="py-3 px-4 text-right">Deposits &amp; Cash (NZD)</th>
            <th className="py-3 px-4 text-right">Total Exposure (NZD)</th>
            <th className="py-3 px-4 text-right">% Portfolio</th>
            <th className="py-3 px-4 w-12 text-center">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60 font-sans">
          {institutions.length === 0 ? (
            <tr>
              <td colSpan={8} className="py-10 text-center text-slate-500">
                No institutional exposures matching current criteria.
              </td>
            </tr>
          ) : (
            institutions.map((inst, idx) => {
              const rowKey = `inst:${inst.issuerKey}`;
              const isExpanded = !!expandedRows[rowKey];
              return (
                <React.Fragment key={rowKey}>
                  <tr
                    onClick={() => onToggleRow(rowKey)}
                    className="hover:bg-slate-800/40 transition-colors cursor-pointer select-none"
                  >
                    <td className="py-3 px-4 text-center text-slate-500 font-mono">{idx + 1}</td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-white flex items-center gap-2">
                        <span>{inst.issuerName}</span>
                        {inst.assetClassCount >= 2 && (
                          <span className="bg-amber-950 text-amber-300 border border-amber-700/50 px-1.5 py-0.5 rounded text-[10px]">
                            Multi-Asset ({inst.assetClassCount})
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-sky-300">
                      ${formatNZD(inst.equityNZD, 2)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-teal-300">
                      ${formatNZD(inst.bondNZD, 2)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-amber-300">
                      ${formatNZD(inst.depositNZD, 2)}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-white font-mono">
                      ${formatNZD(inst.totalNZD, 2)}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-amber-400 font-mono">
                      {(inst.portfolioWeight * 100).toFixed(2)}%
                    </td>
                    <td className="py-3 px-4 text-center text-slate-400 text-xs">{isExpanded ? '▼' : '▶'}</td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-slate-900/90 text-[11px] text-slate-300">
                      <td colSpan={8} className="p-3 pl-12 border-l-2 border-amber-500">
                        <div className="space-y-1 max-w-2xl">
                          {inst.sources.map((s, sIdx) => (
                            <div key={sIdx} className="flex justify-between py-1 border-b border-slate-800 last:border-0">
                              <span>
                                <strong className="text-white uppercase text-[10px] mr-1.5">
                                  [{s.sourceType === 'deposit' ? 'Deposit' : s.assetClass || s.sourceType}]
                                </strong>
                                {s.fundName || (s.sourceType === 'deposit' ? 'Direct Deposit / Bond' : 'Direct Equity')} {s.depositId ? `· ID: ${s.depositId}` : ''}
                              </span>
                              <span className="font-mono text-white">
                                ${formatNZD(s.valueNZD, 2)}
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

