import { DirectEquityCatalogItem, DirectHolding } from '../types/portfolio';

export interface ParsedRegistryHolding {
  holding: DirectHolding;
  matchedCatalog: boolean;
  sourceRowCount: number;
}

export interface RegistryCsvParseResult {
  items: ParsedRegistryHolding[];
  skippedZeroBalance: number;
  skippedInvalidRows: number;
  detectedHeaders: number;
  warnings: string[];
}

const KNOWN_SMARTSHARES_ETFS = new Set([
  'USF', 'FNZ', 'DIV', 'TWF', 'NPF', 'MDZ', 'TNZ', 'NZB', 'AGG', 'GBF',
  'APA', 'EUF', 'EMF', 'ESG', 'EUG', 'USA', 'USS', 'USM', 'AUS', 'ASD', 'ASF', 'MZY', 'OZY',
]);
const KNOWN_BETASHARES_ETFS = new Set(['ASIA']);

/** RFC-4180 CSV parser supporting quoted commas, escaped double quotes, and CRLF/LF. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const clean = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normHeader(h: string): string {
  return h.trim().replace(/\s+/g, ' ').toLowerCase();
}

function parseNumericCell(raw: string | undefined): number {
  if (!raw) return NaN;
  const cleaned = raw.replace(/[$€£¥,\s]/g, '').replace(/^(NZD|AUD|NZ|AU)/i, '');
  if (!cleaned) return NaN;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : NaN;
}

interface HeaderMapping {
  codeIdx: number;
  balanceIdx: number;
  priceIdx: number;
  valueIdx: number;
  currencyIdx: number;
  exchangeIdx: number;
  nameIdx: number;
  inferredCurrency: 'NZD' | 'AUD' | null;
}

function detectHeaderMapping(cells: string[]): HeaderMapping | null {
  const norm = cells.map(normHeader);

  const codeIdx = norm.findIndex((h) =>
    [
      'security code',
      'asx code',
      'nzx code',
      'issuer code',
      'ticker',
      'code',
      'symbol',
      'security',
      'stock code',
    ].includes(h)
  );

  // Prefer tradeable/available balance, then generic balance/units/shares/quantity
  let balanceIdx = norm.findIndex((h) =>
    ['tradeable balance', 'available balance', 'holding balance', 'current balance', 'total balance'].includes(h)
  );
  if (balanceIdx < 0) {
    balanceIdx = norm.findIndex((h) =>
      ['balance', 'units', 'shares', 'quantity', 'qty', 'holding', 'securities'].includes(h)
    );
  }

  if (codeIdx < 0 || balanceIdx < 0 || codeIdx === balanceIdx) {
    return null;
  }

  const priceIdx = norm.findIndex(
    (h) =>
      h.startsWith('last close') ||
      h.startsWith('market price') ||
      h.startsWith('share price') ||
      h.startsWith('unit price') ||
      h.startsWith('close price') ||
      h === 'price' ||
      h === 'last price'
  );

  const valueIdx = norm.findIndex(
    (h) =>
      h.startsWith('value') ||
      h.startsWith('market value') ||
      h.startsWith('total value') ||
      h.startsWith('holding value')
  );

  const currencyIdx = norm.findIndex((h) => h === 'currency' || h === 'ccy');
  const exchangeIdx = norm.findIndex((h) => h === 'exchange' || h === 'market');
  const nameIdx = norm.findIndex((h) =>
    ['security name', 'company', 'company name', 'issuer', 'issuer name', 'name', 'description'].includes(h)
  );

  // Infer currency from column headers such as "Last Close (NZD)", "Value NZD", "Last Close (AUD)", "Value AUD"
  let inferredCurrency: 'NZD' | 'AUD' | null = null;
  for (const idx of [priceIdx, valueIdx]) {
    if (idx < 0) continue;
    const h = norm[idx];
    if (/\baud\b|\(aud\)/.test(h)) {
      inferredCurrency = 'AUD';
      break;
    }
    if (/\bnzd\b|\(nzd\)/.test(h)) {
      inferredCurrency = 'NZD';
      break;
    }
  }

  return {
    codeIdx,
    balanceIdx,
    priceIdx,
    valueIdx,
    currencyIdx,
    exchangeIdx,
    nameIdx,
    inferredCurrency,
  };
}

function normBaseTicker(raw: string): string {
  return raw.trim().toUpperCase().replace(/\.(NZ|AX)$/i, '');
}

/**
 * Parses share registry CSV exports (Computershare NZ/AU, MUFG Corporate Markets / Link,
 * Automic, BoardRoom, or generic ticker/shares CSVs) into DirectHolding entries.
 * Supports preamble lines, multi-table CSVs, double-spaced headers, and skips 0-balance rows.
 */
export function parseRegistryCsv(
  csvText: string,
  catalog: DirectEquityCatalogItem[]
): RegistryCsvParseResult {
  const rows = parseCsvRows(csvText);

  const catalogByExchangeTicker = new Map<string, DirectEquityCatalogItem>();
  const catalogByBaseTicker = new Map<string, DirectEquityCatalogItem[]>();
  for (const item of catalog || []) {
    const base = normBaseTicker(item.ticker);
    if (!base) continue;
    catalogByExchangeTicker.set(`${item.exchange}:${base}`, item);
    const list = catalogByBaseTicker.get(base) || [];
    list.push(item);
    catalogByBaseTicker.set(base, list);
  }

  let activeMapping: HeaderMapping | null = null;
  let detectedHeaders = 0;
  let skippedZeroBalance = 0;
  let skippedInvalidRows = 0;
  const warnings: string[] = [];

  const merged = new Map<string, ParsedRegistryHolding>();

  for (const row of rows) {
    const nonEmpty = row.some((c) => c.trim().length > 0);
    if (!nonEmpty) continue;

    // Check if this row starts a new header section (handles preambles & multi-table exports)
    const maybeHeader = detectHeaderMapping(row);
    if (maybeHeader) {
      activeMapping = maybeHeader;
      detectedHeaders++;
      continue;
    }

    if (!activeMapping) continue;

    const rawCode = (row[activeMapping.codeIdx] || '').trim().toUpperCase();
    const rawBalance = row[activeMapping.balanceIdx];

    // Skip summary/total rows or blank code rows
    if (!rawCode || /^(TOTAL|SUBTOTAL|GRAND TOTAL|VIEW NAME)/i.test(rawCode)) {
      continue;
    }

    const shares = parseNumericCell(rawBalance);
    if (!Number.isFinite(shares) || shares < 0) {
      skippedInvalidRows++;
      continue;
    }
    if (shares === 0) {
      skippedZeroBalance++;
      continue;
    }

    const baseTicker = normBaseTicker(rawCode);
    const explicitSuffix = rawCode.endsWith('.AX')
      ? 'ASX'
      : rawCode.endsWith('.NZ')
      ? 'NZX'
      : null;

    const rowExchangeCell =
      activeMapping.exchangeIdx >= 0 ? (row[activeMapping.exchangeIdx] || '').trim().toUpperCase() : '';
    const rowCurrencyCell =
      activeMapping.currencyIdx >= 0 ? (row[activeMapping.currencyIdx] || '').trim().toUpperCase() : '';

    let preferredExchange: 'NZX' | 'ASX' | null =
      explicitSuffix ||
      (rowExchangeCell === 'ASX' || rowExchangeCell === 'AU'
        ? 'ASX'
        : rowExchangeCell === 'NZX' || rowExchangeCell === 'NZ'
        ? 'NZX'
        : rowCurrencyCell === 'AUD'
        ? 'ASX'
        : rowCurrencyCell === 'NZD'
        ? 'NZX'
        : activeMapping.inferredCurrency === 'AUD'
        ? 'ASX'
        : activeMapping.inferredCurrency === 'NZD'
        ? 'NZX'
        : null);

    let catItem: DirectEquityCatalogItem | undefined;
    if (preferredExchange) {
      catItem = catalogByExchangeTicker.get(`${preferredExchange}:${baseTicker}`);
    }
    if (!catItem) {
      const candidates = catalogByBaseTicker.get(baseTicker) || [];
      if (candidates.length === 1) {
        catItem = candidates[0];
      } else if (candidates.length > 1) {
        catItem =
          (preferredExchange ? candidates.find((c) => c.exchange === preferredExchange) : undefined) ||
          candidates.find((c) => c.exchange === 'NZX') ||
          candidates[0];
      }
    }

    const exchange: 'NZX' | 'ASX' = preferredExchange || catItem?.exchange || 'NZX';
    const currency: 'NZD' | 'AUD' =
      rowCurrencyCell === 'AUD'
        ? 'AUD'
        : rowCurrencyCell === 'NZD'
        ? 'NZD'
        : activeMapping.inferredCurrency || (exchange === 'ASX' ? 'AUD' : 'NZD');

    const rawPrice = activeMapping.priceIdx >= 0 ? parseNumericCell(row[activeMapping.priceIdx]) : NaN;
    const rawValue = activeMapping.valueIdx >= 0 ? parseNumericCell(row[activeMapping.valueIdx]) : NaN;

    let price = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : 0;
    if (price === 0 && Number.isFinite(rawValue) && rawValue > 0) {
      price = Math.round((rawValue / shares) * 10000) / 10000;
    }
    const value = Math.round(shares * price * 100) / 100;

    const isEtf = Boolean(
      catItem?.isEtf ||
        (exchange === 'NZX' && KNOWN_SMARTSHARES_ETFS.has(baseTicker)) ||
        (exchange === 'ASX' && KNOWN_BETASHARES_ETFS.has(baseTicker))
    );
    const fundCode = catItem?.fundCode || (isEtf ? baseTicker : undefined);
    const ticker = catItem?.ticker || `${baseTicker}.${exchange === 'ASX' ? 'AX' : 'NZ'}`;
    const nameFromCsv = activeMapping.nameIdx >= 0 ? (row[activeMapping.nameIdx] || '').trim() : '';
    const name = catItem?.name || nameFromCsv || `${baseTicker} (${exchange})`;

    const holding: DirectHolding = {
      isin: catItem?.isin || `${exchange}:${baseTicker}`,
      name,
      ticker,
      exchange,
      country: catItem?.country || (exchange === 'ASX' ? 'Australia' : 'New Zealand'),
      sector: catItem?.sector || (isEtf ? 'ETF' : 'Unclassified'),
      ...(catItem?.issuer_key ? { issuer_key: catItem.issuer_key } : {}),
      ...(catItem?.issuer_name ? { issuer_name: catItem.issuer_name } : {}),
      currency,
      shares,
      price,
      value,
      ...(isEtf ? { isEtf: true } : {}),
      ...(fundCode ? { fundCode } : {}),
    };

    const mergeKey = `${exchange}:${baseTicker}`;
    const existing = merged.get(mergeKey);
    if (existing) {
      const combinedShares = existing.holding.shares + shares;
      const combinedPrice = price > 0 ? price : existing.holding.price;
      existing.holding = {
        ...existing.holding,
        shares: combinedShares,
        price: combinedPrice,
        value: Math.round(combinedShares * combinedPrice * 100) / 100,
      };
      existing.sourceRowCount += 1;
    } else {
      merged.set(mergeKey, {
        holding,
        matchedCatalog: Boolean(catItem),
        sourceRowCount: 1,
      });
    }
  }

  if (detectedHeaders === 0) {
    warnings.push(
      'Could not find a recognised holdings header row (expected columns like "Security Code" / "Ticker" and "Balance" / "Tradeable Balance" / "Shares").'
    );
  }

  return {
    items: Array.from(merged.values()),
    skippedZeroBalance,
    skippedInvalidRows,
    detectedHeaders,
    warnings,
  };
}
