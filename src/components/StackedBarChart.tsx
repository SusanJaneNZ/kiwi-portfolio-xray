import React, { useState } from 'react';
import { CollapsiblePanel } from './CollapsiblePanel';
import { CategoryBreakdown } from '../types/portfolio';

interface StackedBarChartProps {
  sectorBreakdown: CategoryBreakdown[];
  countryBreakdown: CategoryBreakdown[];
}

const COLOR_PALETTE = [
  '#3b82f6', // blue-500
  '#14b8a6', // teal-500
  '#f43f5e', // rose-500
  '#06b6d4', // cyan-500
  '#f59e0b', // amber-500
  '#10b981', // emerald-500
  '#8b5cf6', // purple-500
  '#ec4899', // pink-500
  '#6366f1', // indigo-500
  '#64748b', // slate-500
];

export const StackedBarChart: React.FC<StackedBarChartProps> = ({
  sectorBreakdown,
  countryBreakdown,
}) => {
  const [activeTab, setActiveTab] = useState<'sectors' | 'countries'>('sectors');
  const [hoveredSubcategory, setHoveredSubcategory] = useState<string | null>(null);

  const activeData = activeTab === 'sectors' ? sectorBreakdown : countryBreakdown;

  return (
    <CollapsiblePanel
      id="macro-charts"
      title={
        <span className="uppercase tracking-wider text-xs text-slate-300">Sector &amp; Country Breakdown</span>
      }
      headerRight={
        <div className="flex gap-1.5">
          <button
            onClick={() => setActiveTab('sectors')}
            className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors ${
              activeTab === 'sectors'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-950 text-slate-400 hover:text-white'
            }`}
          >
            Sectors
          </button>
          <button
            onClick={() => setActiveTab('countries')}
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
      <div className="py-2 space-y-3.5 flex-1 overflow-y-auto max-h-[460px]">
        {activeData.length === 0 ? (
          <div className="text-center py-12 text-xs text-slate-500">
            No holdings entered. Add funds or shares on the left to inspect portfolio look-through.
          </div>
        ) : (
          activeData.map((category) => (
            <div key={category.name} className="space-y-1">
              <div className="flex justify-between text-xs font-medium">
                <span className="text-white">{category.name}</span>
                <span className="text-slate-300 font-mono">
                  ${category.valueNZD.toLocaleString('en-NZ', { maximumFractionDigits: 0 })} (
                  {category.portfolioPercentage.toFixed(1)}%)
                </span>
              </div>

              <div className="h-5 w-full bg-slate-950 rounded-md overflow-hidden shadow-inner">
                <div
                  className="h-full flex overflow-hidden rounded-md transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, category.portfolioPercentage))}%` }}
                >
                  {category.subcategories.map((sub, idx) => {
                    const color = COLOR_PALETTE[idx % COLOR_PALETTE.length];
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
          ))
        )}
      </div>

      {/* Hover Inspection / Legend Footer */}
      <div className="pt-3 mt-2 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 min-h-[36px]">
        {hoveredSubcategory ? (
          <span className="text-amber-300 font-medium font-mono">{hoveredSubcategory}</span>
        ) : (
          <span>Hover over any stacked segment to inspect subcategory dollar exposures and proportions.</span>
        )}
      </div>
    </CollapsiblePanel>
  );
};

