import React, { useState } from 'react';
import { CollapsiblePanel } from './CollapsiblePanel';
import { ConsolidatedHolding, IssuerRollupEntry } from '../types/portfolio';
import { filterAndGroupHoldings } from '../engine/microfilter';
import { matchesSearchQuery } from '../utils/format';
import { EquitiesTabTable } from './holdings/EquitiesTabTable';
import { BondIssuersTabTable } from './holdings/BondIssuersTabTable';
import { InstitutionRollupTabTable } from './holdings/InstitutionRollupTabTable';

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
    'SEDOL:B8W6K56': true,
  });

  const toggleRow = (key: string) => {
    setExpandedRows((prev) => ({ ...prev, [key]: !prev[key] }));
  };

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

  const filteredBonds = bondIssuerHoldings.filter((b) =>
    matchesSearchQuery(searchQuery, b.name, b.isin, b.sector, b.country)
  );
  const visibleBonds =
    sortBy === 'ticker'
      ? [...filteredBonds].sort((a, b) => a.name.localeCompare(b.name))
      : filteredBonds;

  const filteredInstitutions = issuerRollup.filter((inst) =>
    matchesSearchQuery(searchQuery, inst.issuerName, inst.issuerKey)
  );
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

        {activeTab === 'equities' && (
          <EquitiesTabTable
            holdings={visibleHoldings}
            viewMode={viewMode}
            expandedRows={expandedRows}
            onToggleRow={toggleRow}
          />
        )}

        {activeTab === 'bonds' && (
          <BondIssuersTabTable
            bonds={visibleBonds}
            expandedRows={expandedRows}
            onToggleRow={toggleRow}
          />
        )}

        {activeTab === 'institutions' && (
          <InstitutionRollupTabTable
            institutions={visibleInstitutions}
            expandedRows={expandedRows}
            onToggleRow={toggleRow}
          />
        )}
      </div>
    </CollapsiblePanel>
  );
};
