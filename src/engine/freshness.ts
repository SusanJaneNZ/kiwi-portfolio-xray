/**
 * Multi-cadence disclosure freshness calculation engine.
 */

import { FreshnessEnvelope, FundMetadata } from "../types/portfolio";

export function computeFreshnessEnvelope(
  heldFundCodes: string[],
  fundsRegistry: FundMetadata[],
  referenceDate: Date = new Date()
): FreshnessEnvelope {
  const fundMap = new Map<string, FundMetadata>();
  for (const f of fundsRegistry) {
    fundMap.set(f.code, f);
  }

  const effectiveDates: Date[] = [];
  let isAnyStale = false;

  for (const code of heldFundCodes) {
    const meta = fundMap.get(code);
    if (!meta || !meta.effective_date) continue;

    const d = new Date(meta.effective_date);
    if (!isNaN(d.getTime())) {
      effectiveDates.push(d);

      // Check if older than 90 days
      const ageDays = (referenceDate.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > 90 || meta.is_stale) {
        isAnyStale = true;
      }
    }
  }

  if (effectiveDates.length === 0) {
    return {
      minEffectiveDate: "N/A",
      maxEffectiveDate: "N/A",
      spreadDays: 0,
      isAnyStale: false,
    };
  }

  effectiveDates.sort((a, b) => a.getTime() - b.getTime());
  const minDate = effectiveDates[0];
  const maxDate = effectiveDates[effectiveDates.length - 1];
  const spreadDays = Math.round((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));

  return {
    minEffectiveDate: minDate.toISOString().split("T")[0],
    maxEffectiveDate: maxDate.toISOString().split("T")[0],
    spreadDays,
    isAnyStale,
  };
}

