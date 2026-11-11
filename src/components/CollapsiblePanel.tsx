import React, { useEffect, useState } from 'react';

const PANEL_STORAGE_KEY = 'kiwi_xray_panel_state_v1';
const TOGGLE_ALL_EVENT = 'kiwi:panels-toggle';

function readPanelState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(PANEL_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function dispatchToggleAllPanels(open: boolean): void {
  try {
    const state = readPanelState();
    for (const key of Object.keys(state)) {
      state[key] = open;
    }
    localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage quota errors
  }
  window.dispatchEvent(new CustomEvent<boolean>(TOGGLE_ALL_EVENT, { detail: open }));
}

interface CollapsiblePanelProps {
  id: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  headerRight?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}

export const CollapsiblePanel: React.FC<CollapsiblePanelProps> = ({
  id,
  title,
  subtitle,
  headerRight,
  defaultOpen = true,
  className = '',
  children,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    const saved = readPanelState();
    return typeof saved[id] === 'boolean' ? saved[id] : defaultOpen;
  });

  useEffect(() => {
    const onToggleAll = (evt: Event) => {
      const custom = evt as CustomEvent<boolean>;
      const next = Boolean(custom.detail);
      setIsOpen(next);
      try {
        const state = readPanelState();
        state[id] = next;
        localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(state));
      } catch {
        // ignore
      }
    };
    window.addEventListener(TOGGLE_ALL_EVENT, onToggleAll);
    return () => window.removeEventListener(TOGGLE_ALL_EVENT, onToggleAll);
  }, [id]);

  const handleToggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    try {
      const state = readPanelState();
      state[id] = next;
      localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  };

  return (
    <section className={`bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-sm ${className}`}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onClick={handleToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleToggle();
          }
        }}
        className="flex flex-wrap items-center justify-between gap-2 cursor-pointer select-none"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-[11px] text-slate-400 transition-transform ${isOpen ? '' : '-rotate-90'}`}>
            ▼
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white flex items-center gap-2 flex-wrap">{title}</div>
            {subtitle && <div className="text-xs text-slate-400 mt-0.5">{subtitle}</div>}
          </div>
        </div>
        {headerRight && (
          <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-2 flex-wrap">
            {headerRight}
          </div>
        )}
      </div>

      {isOpen && <div className="mt-3">{children}</div>}
    </section>
  );
};
