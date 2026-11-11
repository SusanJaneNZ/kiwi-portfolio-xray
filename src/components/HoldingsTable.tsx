import React, { useState } from 'react';
import { CollapsiblePanel } from './CollapsiblePanel';
import { ConsolidatedHolding, IssuerRollupEntry } from '../types/portfolio';
import { filterAndGroupHoldings } from '../engine/microfilter';

interface HoldingsTableProps {
  holdings: ConsolidatedHolding[];
  bondIssuerHoldings: ConsolidatedHolding[];
  issuerRollup: IssuerRollupEntry[];
}

export const HoldingsTable: React.FC<HoldingsTableProps> = ({
  holdings,
  bondIssuerHoldings,
  issuerRollup,
}) => {
  const [activeTab, setActiveTab] = useState<'equities' | 'bonds' | 'institutions'>('equities');
  const [searchQuery, setSearchQuery] = useState('');
  const [groupMicro, setGroupMicro] = useState(true);
  const [viewMode, setViewMode] = useState<'total' | 'equities'>('total');
  const [sortBy, setSortBy] = useState<'value' | 'ticker'>('value');
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({
    NZMCYE0001S8: true,
  });

  const toggleRow = (key: string) => {
    setExpandedRows((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const q = searchQuery.trim().toLowerCase();

  const { visibleHoldings: groupedEquities } = filterAndGroupHoldings(holdings, {
    searchQuery,
    groupMicroHoldings: groupMicro,
  });

  const visibleHoldings =
    sortBy === 'ticker'
      ? [
          ...groupedEquities
            .filter((h) => h.isin !== 'MICRO_HOLDINGS_AGGREGATE')
            .sort((a, b) => (a.ticker || a.name).localeCompare(b.ticker || b.name)),
          ...groupedEquities.filter((h) => h.isin === 'MICRO_HOLDINGS_AGGREGATE'),
        ]
      : groupedEquities;

  const filteredBonds = q
    ? bondIssuerHoldings.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.isin.toLowerCase().includes(q) ||
          b.sector.toLowerCase().includes(q) ||
          b.country.toLowerCase().includes(q)
      )
    : bondIssuerHoldings;

  const visibleBonds =
    sortBy === 'ticker'
      ? [...filteredBonds].sort((a, b) => a.name.localeCompare(b.name))
      : filteredBonds;

  const filteredInstitutions = q
    ? issuerRollup.filter(
        (inst) =>
          inst.issuerName.toLowerCase().includes(q) ||
          inst.issuerKey.toLowerCase().includes(q)
      )
    : issuerRollup;

  const visibleInstitutions =
    sortBy === 'ticker'
      ? [...filteredInstitutions].sort((a, b) => a.issuerName.localeCompare(b.issuerName))
      : filteredInstitutions;

  const subtitle =
    activeTab === 'equities'
      ? 'Multi-fund holdings and direct NZX/ASX shares deduplicated by canonical ISIN.'
      : activeTab === 'bonds'
        ? 'Fixed-interest debt tranches consolidated per normalized issuer and bond category.'
        : 'Combined institutional concentration across Equities, Bonds, and Term Deposits / Call Cash.';

  return (
    <CollapsiblePanel
      id="holdings-table"
      title={<span>Look-Through Exposures</span>}
      subtitle={subtitle}
      headerRight={
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-0.5 flex text-xs">
          <button
            onClick={() => setActiveTab('equities')}
            className={`px-2.5 py-1 rounded font-medium transition-colors ${
              activeTab === 'equities' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Equities ({holdings.length})
          </button>
          <button
            onClick={() => setActiveTab('bonds')}
            className={`px-2.5 py-1 rounded font-medium transition-colors ${
              activeTab === 'bonds' ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Bond Issuers ({bondIssuerHoldings.length})
          </button>
          <button
            onClick={() => setActiveTab('institutions')}
            className={`px-2.5 py-1 rounded font-medium transition-colors ${
              activeTab === 'institutions' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Institution Rollup ({issuerRollup.length})
          </button>
        </div>
      }
      className="md:p-5"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter ticker, issuer, country..."
                className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-56"
              />
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">🔍</span>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-lg p-0.5 flex text-xs">
              <button
                onClick={() => setSortBy('value')}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  sortBy === 'value' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Value ↓
              </button>
              <button
                onClick={() => setSortBy('ticker')}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  sortBy === 'ticker' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {activeTab === 'equities' ? 'Ticker A–Z' : 'Name A–Z'}
              </button>
            </div>
          </div>

          {activeTab === 'equities' && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={groupMicro}
                  onChange={(e) => setGroupMicro(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0"
                />
                <span>Group micro-holdings (&lt; 0.01%)</span>
              </label>

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
          )}
        </div>

        {/* Tab 1: Equities Table */}
        {activeTab === 'equities' && (
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
                {visibleHoldings.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-10 text-center text-slate-500">
                      No equity exposures matching current criteria.
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
                          <td className="py-3 px-4 font-mono text-slate-500">MICRO</td>
                          <td className="py-3 px-4 italic text-slate-300">{h.name}</td>
                          <td className="py-3 px-4 font-mono text-slate-500">—</td>
                          <td className="py-3 px-4">🌐 Multi-Country</td>
                          <td className="py-3 px-4">All 11 Sectors</td>
                          <td className="py-3 px-4 text-right font-bold text-slate-300 font-mono">
                            ${h.valueNZD.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-slate-400 font-mono">{weightDisplay}%</td>
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
                            ${h.valueNZD.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                                          {s.effectiveDate && <span className="text-slate-500"> · As of {s.effectiveDate}</span>}
                                        </span>
                                      )}
                                    </span>
                                    <span className="font-mono text-white">
                                      ${s.valueNZD.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
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
        )}

        {/* Tab 2: Bond Issuers Table */}
        {activeTab === 'bonds' && (
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
                {visibleBonds.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-slate-500">
                      No bond or fixed-interest holdings in the current portfolio.
                    </td>
                  </tr>
                ) : (
                  visibleBonds.map((b, idx) => {
                    const rowKey = `bond:${b.isin}`;
                    const isExpanded = !!expandedRows[rowKey];
                    return (
                      <React.Fragment key={rowKey}>
                        <tr
                          onClick={() => toggleRow(rowKey)}
                          className="hover:bg-slate-800/40 transition-colors cursor-pointer select-none"
                        >
                          <td className="py-3 px-4 text-center text-slate-500 font-mono">{idx + 1}</td>
                          <td className="py-3 px-4 font-semibold text-white">{b.name}</td>
                          <td className="py-3 px-4 text-teal-300">{b.sector}</td>
                          <td className="py-3 px-4">{b.country}</td>
                          <td className="py-3 px-4 text-right font-mono text-slate-400">{b.trancheCount || 1}</td>
                          <td className="py-3 px-4 text-right font-bold text-white font-mono">
                            ${b.valueNZD.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                                      ${s.valueNZD.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
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
        )}

        {/* Tab 3: Cross-Asset Institution Rollup */}
        {activeTab === 'institutions' && (
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
                  <th className="py-3 px-4 w-12 text-center">Drill</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {visibleInstitutions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-slate-500">
                      No multi-asset or deposit institutional exposures found.
                    </td>
                  </tr>
                ) : (
                  visibleInstitutions.map((inst, idx) => {
                    const rowKey = `inst:${inst.issuerKey}`;
                    const isExpanded = !!expandedRows[rowKey];
                    return (
                      <React.Fragment key={rowKey}>
                        <tr
                          onClick={() => toggleRow(rowKey)}
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
                            ${inst.equityNZD.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-teal-300">
                            ${inst.bondNZD.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-amber-300">
                            ${inst.depositNZD.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-white font-mono">
                            ${inst.totalNZD.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                                      {s.fundName || 'Direct Equity'} {s.depositId ? `· ID: ${s.depositId}` : ''}
                                    </span>
                                    <span className="font-mono text-white">
                                      ${s.valueNZD.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
        )}
      </div>
    </CollapsiblePanel>
  );
};
