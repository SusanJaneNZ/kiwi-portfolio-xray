/**
 * Multi-cadence freshness engine unit tests.
 */

import { computeFreshnessEnvelope } from "./freshness";
import { FundMetadata } from "../types/portfolio";

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const REGISTRY: FundMetadata[] = [
  {
    code: "TWF",
    name: "Total World Fund",
    provider: "Smartshares",
    effective_date: "2026-10-31",
    cash_ratio: 0.015,
    hedging_ratio: 0,
    constituent_count: 100,
    asset_class: "equity",
    cadence: "monthly",
    is_stale: false,
  },
  {
    code: "OLD",
    name: "Old Fund",
    provider: "Kernel",
    effective_date: "2026-05-01",
    cash_ratio: 0.01,
    hedging_ratio: 0,
    constituent_count: 50,
    asset_class: "equity",
    cadence: "quarterly",
    is_stale: false,
  },
];

export const freshnessTestCases: Array<[string, () => void]> = [
  [
    "returns N/A dates and not stale when no held funds resolve",
    () => {
      const env = computeFreshnessEnvelope(["UNKNOWN"], REGISTRY, new Date("2026-11-11"));
      assertEq(env.minEffectiveDate, "N/A", "minEffectiveDate should be N/A");
      assertEq(env.maxEffectiveDate, "N/A", "maxEffectiveDate should be N/A");
      assertEq(env.spreadDays, 0, "spreadDays should be 0");
      assertEq(env.isAnyStale, false, "unknown funds should not mark stale");
    },
  ],
  [
    "detects stale disclosure (>90d) and calculates multi-cadence date spread",
    () => {
      const env = computeFreshnessEnvelope(["TWF", "OLD"], REGISTRY, new Date("2026-11-11"));
      assertEq(env.minEffectiveDate, "2026-05-01", "minEffectiveDate");
      assertEq(env.maxEffectiveDate, "2026-10-31", "maxEffectiveDate");
      assertEq(env.spreadDays, 183, "spreadDays across May 1 -> Oct 31");
      assertEq(env.isAnyStale, true, "May 1 should be flagged stale on Nov 11");
    },
  ],
  [
    "does not mark fresh fund (<=90d) as stale",
    () => {
      const env = computeFreshnessEnvelope(["TWF"], REGISTRY, new Date("2026-11-11"));
      assertEq(env.isAnyStale, false, "11-day old disclosure is fresh");
      assertEq(env.spreadDays, 0, "single fund spread is 0");
    },
  ],
];

