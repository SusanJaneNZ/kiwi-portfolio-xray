import React, { useMemo, useRef, useState } from 'react';
import { CollapsiblePanel } from './CollapsiblePanel';
import { CategoryBreakdown } from '../types/portfolio';
import { formatNZD } from '../utils/format';

interface StackedBarChartProps {
  sectorBreakdown: CategoryBreakdown[];
  countryBreakdown: CategoryBreakdown[];
}

const COLOR_PALETTE = [
  '#3b82f6', // blue-500
  '#f59e0b', // amber-500
  '#10b981', // emerald-500
  '#f43f5e', // rose-500
  '#8b5cf6', // violet-500
  '#06b6d4', // cyan-500
  '#f97316', // orange-500
  '#ec4899', // pink-500
  '#84cc16', // lime-500
  '#6366f1', // indigo-500
  '#14b8a6', // teal-500
  '#eab308', // yellow-500
  '#d946ef', // fuchsia-500
  '#0ea5e9', // sky-500
  '#ef4444', // red-500
  '#64748b', // slate-500
];

const MAX_LEGEND_COUNTRIES = 15;

export const StackedBarChart: React.FC<StackedBarChartProps> = ({
  sectorBreakdown,
  countryBreakdown,
}) => {
  const [activeTab, setActiveTab] = useState<'sectors' | 'countries'>('sectors');
  const [hoveredSubcategory, setHoveredSubcategory] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const handleTabChange = (tab: 'sectors' | 'countries') => {
    setActiveTab(tab);
    // Jump back to the top of the internal scrollable bar chart list
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    // Also scroll the viewport back to the top of the bar graph panel if scrolled down past it
    if (typeof document !== 'undefined') {
      const panelEl = document.getElementById('macro-charts');
      if (panelEl) {
        const rect = panelEl.getBoundingClientRect();
        if (rect.top < 0 || rect.top > (window.innerHeight || 800)) {
          panelEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }
  };

  const activeData = activeTab === 'sectors' ? sectorBreakdown : countryBreakdown;
  const isCountryKey = activeTab === 'sectors';
  const legendLabel = isCountryKey ? 'Country Key' : 'Sector Key';
  const maxCategoryPct = useMemo(
    () => activeData.reduce((max, cat) => Math.max(max, cat.portfolioPercentage), 0),
    [activeData]
  );

  // Assign a consistent color per subcategory name across all rows, ordered by total exposure.
  const { legendItems, colorBySubcategory } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const category of activeData) {
      for (const sub of category.subcategories) {
        totals.set(sub.name, (totals.get(sub.name) || 0) + sub.valueNZD);
      }
    }
    const sortedNames = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);

    const colorMap = new Map<string, string>();
    const items = sortedNames.map((name, idx) => {
      const color = COLOR_PALETTE[idx % COLOR_PALETTE.length];
      colorMap.set(name, color);
      return { name, color };
    });

    return { legendItems: items, colorBySubcategory: colorMap };
  }, [activeData]);

  const displayedLegendItems = useMemo(
    () => (isCountryKey ? legendItems.slice(0, MAX_LEGEND_COUNTRIES) : legendItems),
    [isCountryKey, legendItems]
  );
  const remainingLegendCount = legendItems.length - displayedLegendItems.length;

  return (
    <CollapsiblePanel
      id="macro-charts"
      title={
        <span className="uppercase tracking-wider text-xs text-slate-300">Sector &amp; Country Breakdown</span>
      }
      headerRight={
        <div className="flex gap-1.5">
          <button
            onClick={() => handleTabChange('sectors')}
            className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors ${
              activeTab === 'sectors'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-950 text-slate-400 hover:text-white'
            }`}
          >
            Sectors
          </button>
          <button
            onClick={() => handleTabChange('countries')}
            className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors ${
              activeTab === 'countries'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-950 text-slate-400 hover:text-white'
            }`}
          >
            Countries
          </button>
        </div>
      }
    >
      {/* Stacked bar visualization */}
      <div ref={scrollContainerRef} className="py-2 space-y-3.5 flex-1 overflow-y-auto max-h-[460px]">
        {activeData.length === 0 ? (
          <div className="text-center py-12 text-xs text-slate-500">
            No holdings entered. Add funds or shares in the Portfolio panel above to inspect look-through.
          </div>
        ) : (
          activeData.map((category) => {
            const scaledWidthPct =
              maxCategoryPct > 0
                ? Math.min(100, Math.max(0, (category.portfolioPercentage / maxCategoryPct) * 100))
                : 0;

            return (
              <div key={category.name} className="space-y-1">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-white">{category.name}</span>
                  <span className="text-slate-300 font-mono">
                    ${formatNZD(category.valueNZD, 0)} ({category.portfolioPercentage.toFixed(1)}%)
                  </span>
                </div>

                <div className="h-5 w-full bg-slate-950 rounded-md overflow-hidden shadow-inner">
                  <div
                    className="h-full flex overflow-hidden rounded-md transition-all"
                    style={{ width: `${scaledWidthPct}%` }}
                  >
                    {category.subcategories.map((sub, idx) => {
                      const color =
                        colorBySubcategory.get(sub.name) ?? COLOR_PALETTE[idx % COLOR_PALETTE.length];

                      return (
                        <div
                          key={sub.name}
                          onMouseEnter={() =>
                            setHoveredSubcategory(
                              `${category.name} -> ${sub.name}: $${sub.valueNZD.toFixed(0)} NZD (${sub.percentage.toFixed(1)}% of category)`
                            )
                          }
                          onMouseLeave={() => setHoveredSubcategory(null)}
                          style={{
                            width: `${sub.percentage}%`,
                            backgroundColor: color,
                          }}
                          className="h-full hover:opacity-90 transition-opacity cursor-pointer"
                          title={`${sub.name}: $${sub.valueNZD.toFixed(0)} NZD (${sub.percentage.toFixed(1)}%)`}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Color Key & Hover Readout Footer */}
      {displayedLegendItems.length > 0 && (
        <div className="pt-3 mt-2 border-t border-slate-800 space-y-2 text-xs">
          {hoveredSubcategory && (
            <div className="text-amber-300 font-medium font-mono">{hoveredSubcategory}</div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mr-1">
              {legendLabel}:
            </span>
            {displayedLegendItems.map((item) => (
              <span key={item.name} className="inline-flex items-center gap-1.5 text-slate-300">
                <span
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: item.color }}
                  aria-hidden="true"
                />
                <span className="text-[11px]">{item.name}</span>
              </span>
            ))}
            {remainingLegendCount > 0 && (
              <span className="text-[11px] text-slate-500 font-medium">
                +{remainingLegendCount} more
              </span>
            )}
          </div>
        </div>
      )}
    </CollapsiblePanel>
  );
};
