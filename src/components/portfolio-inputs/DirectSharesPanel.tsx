import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CollapsiblePanel } from '../CollapsiblePanel';
import { BucketSelect } from './BucketSelect';
import {
  DEFAULT_STARTER_BUCKETS,
  DirectEquityCatalogItem,
  DirectHolding,
  PortfolioBucket,
  UserPortfolioState,
} from '../../types/portfolio';
import { directHoldingValueNZD, formatNZD } from '../../utils/format';
import { fetchLiveAudNzdRate } from '../../utils/fx';
import {
  fetchNzxPrices,
  getTodayDateString,
  loadStoredDailyPrices,
} from '../../utils/prices';

interface DirectSharesPanelProps {
  portfolioState: UserPortfolioState;
  directEquitiesCatalog: DirectEquityCatalogItem[];
  totalPortfolioNZD: number;
  directSumNZD: number;
  onAssignBucket: (instrumentKey: string, bucketId: string) => void;
  onUpdateState: (state: UserPortfolioState) => void;
}

export const DirectSharesPanel: React.FC<DirectSharesPanelProps> = ({
  portfolioState,
  directEquitiesCatalog,
  totalPortfolioNZD,
  directSumNZD,
  onAssignBucket,
  onUpdateState,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEquity, setSelectedEquity] = useState<DirectEquityCatalogItem | null>(null);
  const [newShareCount, setNewShareCount] = useState<string>('');
  const [newSharePrice, setNewSharePrice] = useState<string>('');
  const [newShareCurrency, setNewShareCurrency] = useState<'NZD' | 'AUD'>('NZD');

  const availableBuckets = useMemo<PortfolioBucket[]>(() => {
    return portfolioState.buckets.length > 0 ? portfolioState.buckets : DEFAULT_STARTER_BUCKETS;
  }, [portfolioState.buckets]);

  const defaultBucketId = useMemo<string>(() => {
    const growth = availableBuckets.find(
      (b) => b.name.toLowerCase().includes('growth') || b.id.toLowerCase().includes('growth')
    );
    return growth ? growth.id : availableBuckets[0]?.id || '';
  }, [availableBuckets]);

  const [newShareBucket, setNewShareBucket] = useState<string>(() => defaultBucketId);

  useEffect(() => {
    if (!newShareBucket || !availableBuckets.some((b) => b.id === newShareBucket)) {
      setNewShareBucket(defaultBucketId);
    }
  }, [availableBuckets, defaultBucketId]);

  const [isFetchingPrices, setIsFetchingPrices] = useState(false);
  const [cachedDate, setCachedDate] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(() => {
    const cached = loadStoredDailyPrices();
    return cached?.lastFetchedAt || null;
  });
  const [priceNotice, setPriceNotice] = useState<string | null>(null);

  const [isFetchingFx, setIsFetchingFx] = useState(false);
  const [fxTimestamp, setFxTimestamp] = useState<string | null>(null);
  const [rateInput, setRateInput] = useState<string>(() => portfolioState.audNzdRate.toString());
  const hasAutoFetchedFx = useRef(false);

  // Check if current NZX direct holdings have cached date/time
  useEffect(() => {
    const cached = loadStoredDailyPrices();
    if (cached?.lastFetchedAt) {
      setLastFetchedAt(cached.lastFetchedAt);
    }
    const isToday = cached?.date === getTodayDateString();
    if (isToday && cached?.date) {
      setCachedDate(cached.date);
    }
  }, [portfolioState.directHoldings]);

  // Synchronize local rateInput when external/live audNzdRate updates
  useEffect(() => {
    setRateInput(portfolioState.audNzdRate.toString());
  }, [portfolioState.audNzdRate]);

  // Check if any direct holdings are currently entered in AUD
  const hasAudHoldings = useMemo(
    () => portfolioState.directHoldings.some((h) => h.currency === 'AUD'),
    [portfolioState.directHoldings]
  );

  const nzxHoldingsCount = useMemo(
    () => portfolioState.directHoldings.filter((h) => h.exchange === 'NZX').length,
    [portfolioState.directHoldings]
  );

  const unpricedNzxCount = useMemo(() => {
    return portfolioState.directHoldings.filter(
      (h) => h.exchange === 'NZX' && (typeof h.price !== 'number' || h.price <= 0)
    ).length;
  }, [portfolioState.directHoldings]);

  const currentAsAtText = useMemo(() => {
    if (!lastFetchedAt) return null;
    try {
      const d = new Date(lastFetchedAt);
      if (!isNaN(d.getTime())) {
        return d.toLocaleString('en-NZ', {
          day: 'numeric',
          month: 'short',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
      }
    } catch {
      // fallback
    }
    return cachedDate;
  }, [lastFetchedAt, cachedDate]);

  const fetchFxRate = async () => {
    setIsFetchingFx(true);
    try {
      const result = await fetchLiveAudNzdRate(true);
      if (result && result.rate > 0) {
        hasAutoFetchedFx.current = true;
        setFxTimestamp(result.timestamp);
        onUpdateState({ ...portfolioState, audNzdRate: result.rate });
      }
    } catch {
      // Fallback silently to existing rate
    } finally {
      setIsFetchingFx(false);
    }
  };

  const handleUpdatePrices = async () => {
    const nzxTickers = portfolioState.directHoldings
      .filter((h) => h.exchange === 'NZX')
      .map((h) => h.ticker.split('.')[0].toUpperCase());

    if (nzxTickers.length === 0) {
      setPriceNotice('No NZX holdings in portfolio to update.');
      return;
    }

    setIsFetchingPrices(true);
    setPriceNotice(null);
    try {
      const res = await fetchNzxPrices(nzxTickers, true);
      if (res.ok && res.prices) {
        let updatedCount = 0;
        const updated = portfolioState.directHoldings.map((h) => {
          if (h.exchange !== 'NZX') return h;
          const clean = h.ticker.split('.')[0].toUpperCase();
          const newPrice = res.prices[clean];
          if (typeof newPrice === 'number' && newPrice > 0) {
            updatedCount++;
            return {
              ...h,
              price: newPrice,
              value: Math.round(h.shares * newPrice * 100) / 100,
            };
          }
          return h;
        });

        onUpdateState({ ...portfolioState, directHoldings: updated });
        setCachedDate(res.date);
        if (res.lastFetchedAt) {
          setLastFetchedAt(res.lastFetchedAt);
        }
        setPriceNotice(`Updated ${updatedCount} prices from NZXplorer`);
      } else if (res.error) {
        setPriceNotice(res.error);
      }
    } catch (err) {
      setPriceNotice(String(err));
    } finally {
      setIsFetchingPrices(false);
    }
  };

  // Automatically fetch live FX rate if AUD holdings exist and we haven't fetched yet
  useEffect(() => {
    if (hasAudHoldings && !hasAutoFetchedFx.current) {
      fetchFxRate();
    }
  }, [hasAudHoldings]);

  const sortedDirectHoldings = useMemo(
    () => [...portfolioState.directHoldings].sort((a, b) => a.ticker.localeCompare(b.ticker)),
    [portfolioState.directHoldings]
  );

  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const matches = directEquitiesCatalog.filter(
      (eq) =>
        eq.name.toLowerCase().includes(q) ||
        eq.ticker.toLowerCase().includes(q) ||
        eq.isin.toLowerCase().includes(q)
    );
    const rankMatch = (eq: DirectEquityCatalogItem) => {
      const t = eq.ticker.toLowerCase();
      const baseTicker = t.split('.')[0];
      if (t === q || baseTicker === q || eq.isin.toLowerCase() === q) return 0;
      if (t.startsWith(q)) return 1;
      if (eq.name.toLowerCase().startsWith(q)) return 2;
      return 3;
    };
    return matches.sort((a, b) => rankMatch(a) - rankMatch(b) || a.ticker.localeCompare(b.ticker)).slice(0, 6);
  }, [searchQuery, directEquitiesCatalog]);

  const handleSharesChange = (isin: string, sharesStr: string) => {
    const parsedShares = parseFloat(sharesStr);
    const shares = Number.isFinite(parsedShares) && parsedShares >= 0 ? parsedShares : 0;
    const updated = portfolioState.directHoldings.map((h) => {
      if (h.isin !== isin) return h;
      const currentPrice = h.price > 0 ? h.price : (h.shares > 0 && h.value > 0 ? h.value / h.shares : 0);
      return {
        ...h,
        shares,
        price: currentPrice,
        value: Math.round(shares * currentPrice * 100) / 100,
      };
    });
    onUpdateState({ ...portfolioState, directHoldings: updated });
  };

  const handlePriceChange = (isin: string, priceStr: string) => {
    const parsedPrice = parseFloat(priceStr);
    const price = Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : 0;
    const updated = portfolioState.directHoldings.map((h) => {
      if (h.isin !== isin) return h;
      const currentShares = h.shares > 0 ? h.shares : (price > 0 && h.value > 0 ? h.value / price : 0);
      return {
        ...h,
        shares: currentShares,
        price,
        value: Math.round(currentShares * price * 100) / 100,
      };
    });
    onUpdateState({ ...portfolioState, directHoldings: updated });
  };

  const handleCurrencyChange = (isin: string, newCurrency: 'NZD' | 'AUD') => {
    const safeRate = Number.isFinite(portfolioState.audNzdRate) && portfolioState.audNzdRate > 0 ? portfolioState.audNzdRate : 1.10;
    const updated = portfolioState.directHoldings.map((h) => {
      if (h.isin !== isin || h.currency === newCurrency) return h;
      // Convert unit price and value dynamically to preserve economic worth
      const convertedPrice = h.price > 0 ? (newCurrency === 'NZD' ? h.price * safeRate : h.price / safeRate) : 0;
      return {
        ...h,
        currency: newCurrency,
        price: Math.round(convertedPrice * 10000) / 10000,
        value: Math.round(h.shares * convertedPrice * 100) / 100,
      };
    });
    onUpdateState({ ...portfolioState, directHoldings: updated });
  };

  const handleRemoveDirect = (isin: string) => {
    const updated = portfolioState.directHoldings.filter((h) => h.isin !== isin);
    const nextAssignments = { ...portfolioState.bucketAssignments };
    delete nextAssignments[`direct:${isin}`];
    onUpdateState({ ...portfolioState, directHoldings: updated, bucketAssignments: nextAssignments });
  };

  const handleAddDirect = () => {
    if (!selectedEquity) return;
    const sharesNum = parseFloat(newShareCount);
    const priceNum = parseFloat(newSharePrice);
    const shares = Number.isFinite(sharesNum) && sharesNum > 0 ? sharesNum : 0;
    const price = Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : 0;
    if (shares <= 0) return;

    const val = Math.round(shares * price * 100) / 100;
    const baseTicker = selectedEquity.ticker.split('.')[0].toUpperCase();
    const KNOWN_SMARTSHARES_ETFS = new Set([
      'USF', 'FNZ', 'DIV', 'TWF', 'NPF', 'MDZ', 'TNZ', 'NZB', 'AGG', 'GBF',
      'APA', 'EUF', 'EMF', 'ESG', 'EUG', 'USA', 'USS', 'USM', 'AUS', 'ASD', 'ASF', 'MZY', 'OZY'
    ]);
    const KNOWN_BETASHARES_ETFS = new Set(['ASIA']);
    const isEtf = Boolean(
      selectedEquity.isEtf ||
      KNOWN_SMARTSHARES_ETFS.has(baseTicker) ||
      KNOWN_BETASHARES_ETFS.has(baseTicker)
    );
    const fundCode = selectedEquity.fundCode || (isEtf ? baseTicker : undefined);

    const existingIndex = portfolioState.directHoldings.findIndex(
      (h) =>
        h.isin === selectedEquity.isin ||
        (h.exchange === selectedEquity.exchange &&
          h.ticker.toUpperCase() === selectedEquity.ticker.toUpperCase())
    );

    const updated = [...portfolioState.directHoldings];
    if (existingIndex >= 0) {
      const existing = updated[existingIndex];
      const safeRate = Number.isFinite(portfolioState.audNzdRate) && portfolioState.audNzdRate > 0 ? portfolioState.audNzdRate : 1.10;
      let addedVal = val;
      if (existing.currency !== newShareCurrency) {
        addedVal = newShareCurrency === 'AUD' ? val * safeRate : val / safeRate;
      }
      const totalVal = Math.round((existing.value + addedVal) * 100) / 100;
      const totalShares = existing.shares + shares;
      let resolvedPrice = existing.price;
      if (totalShares > 0 && totalVal > 0) {
        resolvedPrice = Math.round((totalVal / totalShares) * 10000) / 10000;
      } else if (price > 0) {
        resolvedPrice = price;
      }
      updated[existingIndex] = {
        ...existing,
        shares: totalShares,
        price: resolvedPrice,
        value: totalVal,
        isEtf: existing.isEtf || isEtf,
        fundCode: existing.fundCode || fundCode || (isEtf ? baseTicker : undefined),
      };
    } else {
      const newHolding: DirectHolding = {
        ...selectedEquity,
        currency: newShareCurrency,
        shares,
        price,
        value: val,
        isEtf,
        fundCode: fundCode || (isEtf ? baseTicker : undefined),
      };
      updated.push(newHolding);
    }

    const nextAssignments = { ...portfolioState.bucketAssignments };
    const bucketToAssign = newShareBucket || defaultBucketId;
    if (bucketToAssign) {
      nextAssignments[`direct:${selectedEquity.isin}`] = bucketToAssign;
    }
    const nextBuckets = portfolioState.buckets.length > 0 ? portfolioState.buckets : availableBuckets;

    onUpdateState({
      ...portfolioState,
      directHoldings: updated,
      buckets: nextBuckets,
      bucketAssignments: nextAssignments,
    });
    setSelectedEquity(null);
    setSearchQuery('');
    setNewShareCount('');
    setNewSharePrice('');
    setNewShareBucket(defaultBucketId);
  };

  return (
    <CollapsiblePanel
      id="input-direct"
      title={
        <span className="text-xs uppercase tracking-wider text-slate-300">
          1. Exchange-Traded Shares &amp; Listed ETFs (NZX / ASX)
        </span>
      }
      headerRight={
        <span className="text-xs text-emerald-400 font-mono">
          {totalPortfolioNZD > 0 ? ((directSumNZD / totalPortfolioNZD) * 100).toFixed(1) : 0}% of portfolio
        </span>
      }
    >
      <div className="space-y-3">
        {/* Only display exchange rate panel if user has holdings entered in AUD */}
        {hasAudHoldings && (
          <div className="bg-slate-900/90 border border-indigo-900/40 rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-base">💱</span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-200">AUD / NZD Exchange Rate</span>
                  {fxTimestamp && (
                    <span className="text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 rounded px-1.5 py-0.5">
                      ● Live ({fxTimestamp})
                    </span>
                  )}
                  {isFetchingFx && (
                    <span className="text-[10px] text-indigo-400 animate-pulse">
                      Updating...
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">
                  Applied automatically to ASX shares held in AUD
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={fetchFxRate}
                disabled={isFetchingFx}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded text-[11px] font-medium border border-slate-700 transition-colors flex items-center gap-1"
                title="Fetch current rate from live exchange API"
              >
                <span className={isFetchingFx ? 'animate-spin inline-block' : 'inline-block'}>↻</span>
                <span>Live Rate</span>
              </button>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400">1 AUD =</span>
                <input
                  type="number"
                  min="0.01"
                  value={rateInput}
                  step="0.001"
                  onChange={(e) => {
                    setRateInput(e.target.value);
                    const nextRate = parseFloat(e.target.value);
                    if (Number.isFinite(nextRate) && nextRate > 0) {
                      onUpdateState({ ...portfolioState, audNzdRate: nextRate });
                    }
                  }}
                  onBlur={() => {
                    const parsed = parseFloat(rateInput);
                    if (!Number.isFinite(parsed) || parsed <= 0) {
                      setRateInput(portfolioState.audNzdRate.toString());
                    }
                  }}
                  className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-right text-xs text-white font-mono"
                />
                <span className="text-xs text-slate-400">NZD</span>
              </div>
            </div>
          </div>
        )}

        {/* NZX Live Pricing Panel (when NZX holdings exist) */}
        {nzxHoldingsCount > 0 && (
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-base">📈</span>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-200">NZX Pricing</span>
                  {currentAsAtText && unpricedNzxCount === 0 ? (
                    <span
                      className="text-[11px] text-emerald-400 font-medium bg-emerald-950/60 border border-emerald-800/40 rounded px-2 py-0.5"
                    >
                      ✓ Prices are current as at {currentAsAtText}
                    </span>
                  ) : currentAsAtText && unpricedNzxCount > 0 ? (
                    <span
                      className="text-[11px] text-amber-300 font-medium bg-amber-950/60 border border-amber-800/40 rounded px-2 py-0.5"
                    >
                      Prices are current as at {currentAsAtText} ({unpricedNzxCount} unpriced)
                    </span>
                  ) : (
                    <span className="text-[11px] text-amber-400 italic">
                      Prices not yet fetched for {unpricedNzxCount > 0 ? `${unpricedNzxCount} holding${unpricedNzxCount > 1 ? 's' : ''}` : 'current holdings'}
                    </span>
                  )}
                  {isFetchingPrices && (
                    <span className="text-[10px] text-indigo-400 animate-pulse">
                      Updating prices...
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">
                  Batches all NZX tickers in one call to NZXplorer.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleUpdatePrices}
                disabled={isFetchingPrices}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 shadow-sm"
                title="Fetch latest prices for all NZX direct shares"
              >
                <span className={isFetchingPrices ? 'animate-spin inline-block' : 'inline-block'}>↻</span>
                <span>Update NZX Prices</span>
              </button>
            </div>
          </div>
        )}

        {/* Price Update Notice / Status Banner */}
        {priceNotice && (
          <div
            className={`text-[11px] px-2.5 py-1.5 rounded-lg border flex items-center justify-between ${
              priceNotice.toLowerCase().includes('error') || priceNotice.includes('HTTP')
                ? 'bg-rose-950/40 border-rose-800/50 text-rose-300'
                : 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300'
            }`}
          >
            <span>{priceNotice}</span>
            <button
              type="button"
              onClick={() => setPriceNotice(null)}
              className="text-slate-400 hover:text-white ml-2 text-xs"
              title="Dismiss notice"
            >
              ✕
            </button>
          </div>
        )}

        {/* Informational Look-Through Note */}
        <div className="bg-slate-900/40 border border-slate-800/60 rounded-lg p-2 text-[11px] text-slate-400 flex items-center gap-2">
          <span className="text-emerald-400 text-sm">ℹ️</span>
          <span>
            Enter your exact <strong>Share / Unit Count</strong>. Listed ETFs (e.g. Smartshares USF, FNZ, DIV) automatically unwrap into their underlying companies with 100% look-through.
          </span>
        </div>

        {/* Direct Holdings Table */}
        <div className="space-y-2">
          {sortedDirectHoldings.map((dh) => {
            const isAud = dh.currency === 'AUD';
            const valueNZD = directHoldingValueNZD(dh, portfolioState.audNzdRate);
            const safeShares = dh.shares > 0 ? dh.shares : (dh.price > 0 && dh.value > 0 ? Math.round((dh.value / dh.price) * 100) / 100 : 0);
            const safePrice = dh.price > 0 ? dh.price : (safeShares > 0 && dh.value > 0 ? Math.round((dh.value / safeShares) * 10000) / 10000 : 0);
            const isPriceUnknown = safePrice <= 0;

            return (
              <div
                key={dh.isin}
                className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-white flex items-center gap-1.5 flex-wrap">
                    <span className="bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded text-[11px] font-mono">
                      {dh.ticker}
                    </span>
                    {dh.isEtf && (
                      <span className="bg-indigo-950 text-indigo-300 border border-indigo-700/50 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase">
                        ETF Unwrapped
                      </span>
                    )}
                    <span className="truncate">{dh.name}</span>
                    <span className="text-[10px] text-slate-500 font-mono">({dh.exchange})</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                    <span>{dh.sector}</span>
                    <span>•</span>
                    <span>{dh.country}</span>
                    {isAud && (
                      <>
                        <span>•</span>
                        {isPriceUnknown ? (
                          <span className="text-amber-400/80 italic text-[11px]">&lt;unknown&gt;</span>
                        ) : (
                          <span className="text-emerald-400 font-mono">
                            NZD ${formatNZD(valueNZD)}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                  <BucketSelect
                    instrumentKey={`direct:${dh.isin}`}
                    buckets={availableBuckets}
                    bucketAssignments={portfolioState.bucketAssignments}
                    onAssign={onAssignBucket}
                  />

                  {/* Currency selector */}
                  <select
                    value={dh.currency || 'NZD'}
                    onChange={(e) => handleCurrencyChange(dh.isin, e.target.value as 'NZD' | 'AUD')}
                    className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-indigo-500"
                    title="Select native currency for this holding"
                  >
                    <option value="NZD">NZD</option>
                    <option value="AUD">AUD</option>
                  </select>

                  {/* Share Count Input */}
                  <div className="w-24 relative" title="Number of Shares / Units held">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={safeShares > 0 ? safeShares : ''}
                      placeholder="Shares"
                      onChange={(e) => handleSharesChange(dh.isin, e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-right text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
                    />
                    <span className="text-[9px] text-slate-500 block text-right pr-1">shares</span>
                  </div>

                  <span className="text-slate-600 font-mono text-xs">×</span>

                  {/* Price Input */}
                  <div className="w-24 relative" title={`Price per share in ${dh.currency || 'NZD'}`}>
                    <input
                      type="number"
                      min="0"
                      step="0.0001"
                      value={safePrice > 0 ? safePrice : ''}
                      placeholder="<unknown>"
                      onChange={(e) => handlePriceChange(dh.isin, e.target.value)}
                      className={`w-full bg-slate-900 border ${
                        isPriceUnknown ? 'border-amber-700/60 placeholder-amber-400/70' : 'border-slate-800'
                      } rounded-lg px-2 py-1.5 text-right text-xs text-white focus:outline-none focus:border-emerald-500 font-mono`}
                    />
                    <span className="text-[9px] text-slate-500 block text-right pr-1">
                      {isAud ? 'A$/sh' : 'NZ$/sh'}
                    </span>
                  </div>

                  <span className="text-slate-600 font-mono text-xs">=</span>

                  {/* Computed Read-Only Value */}
                  <div
                    className="w-28 py-1.5 px-2 bg-slate-900/60 border border-slate-800/80 rounded-lg text-right text-xs font-mono font-medium flex items-center justify-end"
                    title={isPriceUnknown ? 'Price unknown — click Update NZX Prices or enter price manually' : 'Calculated Total Value (Shares × Price)'}
                  >
                    {isPriceUnknown ? (
                      <span className="text-amber-400 italic text-[11px]">&lt;unknown&gt;</span>
                    ) : (
                      <span className="text-emerald-400">
                        {isAud ? 'A$' : '$'}{formatNZD(dh.value)}
                      </span>
                    )}
                  </div>

                  {/* Remove Button */}
                  <button
                    type="button"
                    onClick={() => handleRemoveDirect(dh.isin)}
                    className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition-colors"
                    title="Remove holding"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}

          {/* Add New Holding Form */}
          <div className="pt-2 relative">
            <div className="flex gap-2 flex-wrap sm:flex-nowrap">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSelectedEquity(null);
                }}
                placeholder="Search share or listed ETF e.g. CEN, FPH, USF, BHP..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 min-w-[200px]"
              />

              {selectedEquity && (
                <>
                  <select
                    value={newShareBucket}
                    onChange={(e) => setNewShareBucket(e.target.value)}
                    className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-indigo-500 max-w-[130px]"
                    title="Assign to target bucket (defaults to Growth)"
                  >
                    {availableBuckets.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                    <option value="">Unassigned</option>
                  </select>

                  <select
                    value={newShareCurrency}
                    onChange={(e) => setNewShareCurrency(e.target.value as 'NZD' | 'AUD')}
                    className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-indigo-500"
                    title="Select currency for new holding"
                  >
                    <option value="NZD">NZD</option>
                    <option value="AUD">AUD</option>
                  </select>

                  <div className="w-24 relative">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="Shares"
                      value={newShareCount}
                      onChange={(e) => setNewShareCount(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-right text-xs text-white font-mono"
                      title="Number of shares to add"
                    />
                    <span className="text-[9px] text-slate-500 block text-right pr-1">shares</span>
                  </div>

                  <div className="w-24 relative">
                    <input
                      type="number"
                      min="0"
                      step="0.0001"
                      placeholder="<unknown>"
                      value={newSharePrice}
                      onChange={(e) => setNewSharePrice(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-right text-xs text-white font-mono placeholder-amber-400/60"
                      title={`Price per share in ${newShareCurrency} (leave empty to fetch via NZXplorer)`}
                    />
                    <span className="text-[9px] text-slate-500 block text-right pr-1">
                      {newShareCurrency === 'AUD' ? 'A$/sh' : 'NZ$/sh'}
                    </span>
                  </div>

                  <div className="w-28 py-1.5 px-2 bg-slate-950 border border-slate-800 rounded-lg text-right text-xs font-mono flex items-center justify-end">
                    {parseFloat(newShareCount) > 0 && parseFloat(newSharePrice) > 0 ? (
                      <span className="text-emerald-400">
                        {newShareCurrency === 'AUD' ? 'A$' : '$'}
                        {formatNZD(
                          (parseFloat(newShareCount) || 0) * (parseFloat(newSharePrice) || 0)
                        )}
                      </span>
                    ) : parseFloat(newShareCount) > 0 ? (
                      <span className="text-amber-400/80 italic text-[11px]">&lt;unknown&gt;</span>
                    ) : (
                      <span className="text-slate-600 font-mono text-xs">-</span>
                    )}
                  </div>
                </>
              )}

              <button
                disabled={!selectedEquity || (parseFloat(newShareCount) || 0) <= 0}
                onClick={handleAddDirect}
                className="bg-indigo-600 disabled:opacity-40 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
              >
                + Add
              </button>
            </div>

            {filteredCatalog.length > 0 && !selectedEquity && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden divide-y divide-slate-800">
                {filteredCatalog.map((item) => (
                  <div
                    key={item.isin}
                    onClick={() => {
                      setSelectedEquity(item);
                      setNewShareCurrency(item.exchange === 'ASX' ? 'AUD' : 'NZD');
                      setSearchQuery(`${item.ticker} - ${item.name}`);
                      const clean = item.ticker.split('.')[0].toUpperCase();
                      const cached = loadStoredDailyPrices();
                      if (cached?.date === getTodayDateString() && typeof cached.prices[clean] === 'number' && cached.prices[clean] > 0) {
                        setNewSharePrice(cached.prices[clean].toString());
                      } else {
                        setNewSharePrice('');
                      }
                    }}
                    className="p-2 text-xs hover:bg-slate-800 cursor-pointer flex justify-between items-center"
                  >
                    <div>
                      <strong className="text-white font-mono">{item.ticker}</strong> · {item.name}
                      <span className="text-slate-500 text-[10px] ml-2 font-mono">
                        ({item.exchange} · {item.country})
                      </span>
                    </div>
                    <span className="text-slate-400 text-[10px]">{item.sector}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </CollapsiblePanel>
  );
};
