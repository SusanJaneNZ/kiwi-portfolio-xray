import React, { useState } from 'react';

export interface UnresolvedItem {
  provider: string;
  fund_code: string;
  raw_name: string;
  raw_ticker: string;
  weight: number;
  reason: string;
  suggested_snippet?: Record<string, Record<string, string>>;
}

interface UnresolvedModalProps {
  isOpen: boolean;
  onClose: () => void;
  unresolvedEntries: UnresolvedItem[];
}

export const UnresolvedModal: React.FC<UnresolvedModalProps> = ({
  isOpen,
  onClose,
  unresolvedEntries,
}) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  if (!isOpen) return null;

  const handleCopy = (snippet: Record<string, Record<string, string>> | undefined, idx: number) => {
    if (!snippet) return;
    navigator.clipboard.writeText(JSON.stringify(snippet, null, 2));
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full p-5 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
        <div className="flex justify-between items-center border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span className="text-amber-400">⚠</span> Unresolved Disclosure Holdings Audit
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              These constituent lines could not be matched against the Global Security Master with $\ge 90\%$ confidence and $\ge 15\%$ spread.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-lg p-1 transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs">
          {unresolvedEntries.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              ✨ No unresolved holdings detected! All constituent equities are resolved canonically.
            </div>
          ) : (
            unresolvedEntries.map((item, idx) => (
              <div
                key={idx}
                className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-white flex items-center gap-2">
                    <span className="bg-indigo-950 text-indigo-300 px-1.5 py-0.5 rounded text-[11px] font-mono border border-indigo-700/50">
                      {item.provider}:{item.fund_code}
                    </span>
                    <span>{item.raw_name}</span>
                    {item.raw_ticker && (
                      <span className="text-slate-400 font-mono">({item.raw_ticker})</span>
                    )}
                  </div>
                  <span className="text-slate-400 font-mono">
                    Weight: {(item.weight * 100).toFixed(2)}%
                  </span>
                </div>

                <div className="text-[11px] text-amber-300/80">
                  Reason flagged: <span className="font-mono">{item.reason}</span>
                </div>

                {item.suggested_snippet && (
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[11px] text-slate-400">
                      <span>Ready-to-paste alias snippet for <code className="text-slate-300">pipeline/enrichment/provider_alias_map.json</code>:</span>
                      <button
                        onClick={() => handleCopy(item.suggested_snippet, idx)}
                        className="text-indigo-400 hover:text-indigo-300 font-medium"
                      >
                        {copiedIndex === idx ? '✓ Copied' : 'Copy Snippet'}
                      </button>
                    </div>
                    <pre className="bg-slate-900 border border-slate-800 p-2 rounded text-[11px] text-emerald-400 font-mono overflow-x-auto">
                      {JSON.stringify(item.suggested_snippet, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="pt-3 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

