/**
 * Shared NZD formatting, AUD->NZD conversion, and query matching utilities.
 */

import { DirectHolding } from "../types/portfolio";

export function formatNZD(value: number, decimals = 2): string {
  return value.toLocaleString("en-NZ", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function directHoldingValueNZD(
  holding: Pick<DirectHolding, "currency" | "value">,
  audNzdRate: number
): number {
  const safeRate = Number.isFinite(audNzdRate) && audNzdRate > 0 ? audNzdRate : 1.10;
  return holding.currency === "AUD" ? holding.value * safeRate : holding.value;
}

export function matchesSearchQuery(query: string, ...fields: Array<string | undefined | null>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f || "").toLowerCase().includes(q));
}

