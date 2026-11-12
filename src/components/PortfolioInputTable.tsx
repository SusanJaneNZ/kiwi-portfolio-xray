import React from 'react';
import {
  DirectEquityCatalogItem,
  FundMetadata,
  UserPortfolioState,
} from '../types/portfolio';
import { directHoldingValueNZD } from '../utils/format';
import { FundAllocationsPanel } from './portfolio-inputs/FundAllocationsPanel';
import { DirectSharesPanel } from './portfolio-inputs/DirectSharesPanel';
import { CashDepositsPanel } from './portfolio-inputs/CashDepositsPanel';

interface PortfolioInputTableProps {
  portfolioState: UserPortfolioState;
  fundsRegistry: FundMetadata[];
  directEquitiesCatalog: DirectEquityCatalogItem[];
  onUpdateState: (state: UserPortfolioState) => void;
  totalPortfolioNZD: number;
}

export const PortfolioInputTable: React.FC<PortfolioInputTableProps> = ({
  portfolioState,
  fundsRegistry,
  directEquitiesCatalog,
  onUpdateState,
  totalPortfolioNZD,
}) => {
  const setBucketForKey = (instrumentKey: string, bucketId: string) => {
    const nextAssignments = { ...portfolioState.bucketAssignments };
    if (!bucketId) {
      delete nextAssignments[instrumentKey];
    } else {
      nextAssignments[instrumentKey] = bucketId;
    }
    onUpdateState({ ...portfolioState, bucketAssignments: nextAssignments });
  };

  const fundSumNZD = Object.values(portfolioState.fundBalances).reduce((acc, v) => acc + v, 0);
  const directSumNZD = portfolioState.directHoldings.reduce(
    (acc, h) => acc + directHoldingValueNZD(h, portfolioState.audNzdRate),
    0
  );
  const depositSumNZD = portfolioState.cashDeposits.reduce((acc, d) => acc + Math.max(0, d.valueNZD), 0);

  return (
    <div className="space-y-4">
      <FundAllocationsPanel
        portfolioState={portfolioState}
        fundsRegistry={fundsRegistry}
        totalPortfolioNZD={totalPortfolioNZD}
        fundSumNZD={fundSumNZD}
        onAssignBucket={setBucketForKey}
        onUpdateState={onUpdateState}
      />

      <DirectSharesPanel
        portfolioState={portfolioState}
        directEquitiesCatalog={directEquitiesCatalog}
        totalPortfolioNZD={totalPortfolioNZD}
        directSumNZD={directSumNZD}
        onAssignBucket={setBucketForKey}
        onUpdateState={onUpdateState}
      />

      <CashDepositsPanel
        portfolioState={portfolioState}
        totalPortfolioNZD={totalPortfolioNZD}
        depositSumNZD={depositSumNZD}
        onAssignBucket={setBucketForKey}
        onUpdateState={onUpdateState}
      />
    </div>
  );
};
