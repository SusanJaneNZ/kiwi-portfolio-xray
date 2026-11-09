import React, { useEffect, useMemo, useState } from 'react';
import { FreshnessHeader } from './components/FreshnessHeader';
import { HoldingsTable } from './components/HoldingsTable';
import { LiquidityCard } from './components/LiquidityCard';
import { PortfolioInputTable } from './components/PortfolioInputTable';
import { StackedBarChart } from './components/StackedBarChart';
import { UnresolvedItem, UnresolvedModal } from './components/UnresolvedModal';
import { computeFreshnessEnvelope } from './engine/freshness';
import { calculatePortfolioLookthrough } from './engine/lookthrough';
import { loadPortfolioState, savePortfolioState } from './storage/localStorage';
import { Constituent, DirectHolding, FundMetadata, UserPortfolioState } from './types/portfolio';

export const App: React.FC = () => {
  const [portfolioState, setPortfolioState] = useState<UserPortfolioState>(() => loadPortfolioState());
  const [fundsRegistry, setFundsRegistry] = useState<FundMetadata[]>([]);
  const [constituentsMap, setConstituentsMap] = useState<Record<string, Constituent[]>>({});
  const [directCatalog, setDirectCatalog] = useState<DirectHolding[]>([]);
  const [unresolvedEntries, setUnresolvedEntries] = useState<UnresolvedItem[]>([]);
  const [isUnresolvedModalOpen, setIsUnresolvedModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load static public data assets
  useEffect(() => {
    async function loadData() {
      try {
        const basePath = import.meta.env.BASE_URL || '/';
        const [fundsRes, constRes, directRes, unresRes] = await Promise.all([
          fetch(`${basePath}data/funds_registry.json`).then((r) => r.json()),
          fetch(`${basePath}data/constituents.json`).then((r) => r.json()),
          fetch(`${basePath}data/direct_equities.json`).then((r) => r.json()),
          fetch(`${basePath}data/unresolved_entries.json`).then((r) => r.json()),
        ]);

        setFundsRegistry(fundsRes);
        setConstituentsMap(constRes);
        setDirectCatalog(directRes);
        setUnresolvedEntries(unresRes);
      } catch (err) {
        console.error('Failed to load static datasets, using built-in fallbacks:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  // Persist state changes to LocalStorage
  const handleUpdateState = (newState: UserPortfolioState) => {
    setPortfolioState(newState);
    savePortfolioState(newState);
  };

  // Perform core look-through calculations
  const calculationResult = useMemo(() => {
    return calculatePortfolioLookthrough({
      fundBalances: portfolioState.fundBalances,
      directHoldings: portfolioState.directHoldings,
      audNzdRate: portfolioState.audNzdRate,
      fundsRegistry,
      constituentsMap,
    });
  }, [portfolioState, fundsRegistry, constituentsMap]);

  // Compute portfolio-level freshness envelope
  const freshnessEnvelope = useMemo(() => {
    const heldCodes = Object.entries(portfolioState.fundBalances)
      .filter(([_, bal]) => bal > 0)
      .map(([code]) => code);
    return computeFreshnessEnvelope(heldCodes, fundsRegistry);
  }, [portfolioState.fundBalances, fundsRegistry]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400 text-sm">
        <div className="flex items-center gap-3">
          <span className="text-2xl animate-spin">🥝</span>
          <span>Loading Kiwi Portfolio X-Ray data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6 font-sans antialiased">
      <div className="max-w-7xl mx-auto space-y-5">
        {/* Top Header & Freshness Envelope */}
        <FreshnessHeader
          envelope={freshnessEnvelope}
          portfolioState={portfolioState}
          holdings={calculationResult.holdings}
          onUpdateState={handleUpdateState}
          onOpenUnresolvedModal={() => setIsUnresolvedModalOpen(true)}
          unresolvedCount={unresolvedEntries.length}
        />

        {/* Liquidity Breakdown Banners */}
        <LiquidityCard
          liquidity={calculationResult.liquidity}
          constituentCount={calculationResult.holdings.length}
        />

        {/* Main 2-Column Section */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left Column: Portfolio Inputs (5 of 12 cols) */}
          <div className="lg:col-span-5">
            <PortfolioInputTable
              portfolioState={portfolioState}
              fundsRegistry={fundsRegistry}
              directEquitiesCatalog={directCatalog}
              onUpdateState={handleUpdateState}
              totalPortfolioNZD={calculationResult.denominatorD}
            />
          </div>

          {/* Right Column: Visualizations (7 of 12 cols) */}
          <div className="lg:col-span-7">
            <StackedBarChart
              sectorBreakdown={calculationResult.sectorBreakdown}
              countryBreakdown={calculationResult.countryBreakdown}
            />
          </div>
        </div>

        {/* Consolidated Look-Through Table */}
        <HoldingsTable holdings={calculationResult.holdings} />
      </div>

      {/* Unresolved Disclosures Modal */}
      <UnresolvedModal
        isOpen={isUnresolvedModalOpen}
        onClose={() => setIsUnresolvedModalOpen(false)}
        unresolvedEntries={unresolvedEntries}
      />
    </div>
  );
};

export default App;

