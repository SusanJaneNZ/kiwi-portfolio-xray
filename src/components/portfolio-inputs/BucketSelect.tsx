import React from 'react';
import { BucketAssignmentMap, PortfolioBucket } from '../../types/portfolio';

interface BucketSelectProps {
  instrumentKey: string;
  buckets: PortfolioBucket[];
  bucketAssignments: BucketAssignmentMap;
  onAssign: (instrumentKey: string, bucketId: string) => void;
  fallbackKey?: string;
}

export const BucketSelect: React.FC<BucketSelectProps> = ({
  instrumentKey,
  buckets,
  bucketAssignments,
  onAssign,
  fallbackKey,
}) => {
  if (buckets.length === 0) return null;
  const current = bucketAssignments[instrumentKey] || (fallbackKey ? bucketAssignments[fallbackKey] : '') || '';
  return (
    <select
      value={current}
      onChange={(e) => onAssign(instrumentKey, e.target.value)}
      aria-label={`Assign bucket for ${instrumentKey}`}
      className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-slate-300 focus:outline-none focus:border-indigo-500 max-w-[130px]"
    >
      <option value="">Unassigned</option>
      {buckets.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
};

