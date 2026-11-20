import { test, expect } from '@playwright/test';
import fs from 'node:fs';

/**
 * End-to-end Playwright smoke suite for Kiwi Portfolio X-Ray.
 * Runs against the production `dist/` build via `vite preview`.
 * Intercepts `/api/portfolio/*` so local test runs NEVER touch `backups/portfolio_backup.json`.
 */

test.describe('Kiwi Portfolio X-Ray — Live Portfolio UI E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Isolate from local filesystem backup middleware so tests run strictly in browser localStorage
    await page.route('**/api/portfolio/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/api/portfolio/load')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ exists: false }),
        });
      } else if (url.includes('/api/portfolio/backups')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, backups: [] }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, file: 'test_export.json', path: 'test_export.json' }),
        });
      }
    });

    // Stub live Yahoo prices & FX calls so tests are deterministic and offline-safe
    await page.route('**/api/prices**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          prices: { 'MEL.NZ': 6.0, 'MCY.NZ': 6.5, 'CEN.NZ': 8.5, 'CNU.NZ': 8.8 },
          date: '2026-11-20',
          cached: true,
        }),
      });
    });

    await page.route('**/*er-api.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rates: { NZD: 1.09 } }),
      });
    });

    await page.route('**/*frankfurter*/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rates: { NZD: 1.09 } }),
      });
    });

    // Accept confirmation dialogs cleanly (Clear Portfolio / Load Sample)
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });
  });

  test('1. Clean boot, sample portfolio panels, clear, enter 1 of each holding type, reload persistence & export/import backup', async ({
    page,
  }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/');

    // Wait for static datasets (funds_registry.json, direct_equities.json) to load
    await expect(page.getByText('Kiwi Portfolio X-Ray').first()).toBeVisible({ timeout: 15_000 });

    // Open Portfolio Inputs group if collapsed
    const portfolioHeader = page.getByRole('button', { name: /Portfolio\s+\$/ }).first();
    await portfolioHeader.click();

    // Verify sample portfolio loads (or click Load Sample Portfolio if empty)
    const loadSampleBtn = page.getByRole('button', { name: 'Load Sample Portfolio' });
    if (await loadSampleBtn.isVisible().catch(() => false)) {
      await loadSampleBtn.click();
    }

    // Verify sample panels display $ and % in headers
    await expect(page.getByText(/% of portfolio\)/).first()).toBeVisible({ timeout: 10_000 });

    // 2. Clear the sample portfolio before entering our own holdings
    await page.getByRole('button', { name: 'Clear Portfolio' }).click();
    await expect(page.getByText('$0.00 NZD').first()).toBeVisible({ timeout: 10_000 });

    // 3a. Enter 1 Direct Share (Panel 1: Mercury NZ Ltd / MCY)
    const shareSearch = page.getByPlaceholder('Search share or listed ETF e.g. CEN, FPH, USF, BHP...');
    await shareSearch.fill('MCY');
    await page.locator('div', { hasText: /Mercury NZ/i }).filter({ hasText: 'MCY' }).last().click();
    await page.getByPlaceholder('Shares').first().fill('1000');
    await page.getByPlaceholder('<unknown>').first().fill('6.50');
    await page.getByRole('button', { name: '+ Add', exact: true }).click();
    await expect(page.getByText('$6,500.00').first()).toBeVisible();

    // 3b. Enter 1 Managed Fund / KiwiSaver (Panel 2 — uncheck 'Held only' since MCY made totalPortfolio > 0)
    const heldOnlyCheckbox = page.getByLabel('Held only');
    if (await heldOnlyCheckbox.isChecked()) {
      await heldOnlyCheckbox.uncheck();
    }
    const fundSearch = page.getByPlaceholder(
      'Search code, scheme, or fund manager (e.g. Kernel, Fisher)...'
    );
    await fundSearch.fill('KERNEL_NZ_20');
    const fundBalanceInput = page.getByLabel('Balance in NZD for KERNEL_NZ_20');
    await fundBalanceInput.fill('20000');
    await fundBalanceInput.blur();

    // 3c. Enter 1 Term Deposit (Panel 3: Fixed Interest & Cash)
    await page.getByPlaceholder('e.g. 12M PIE Term Deposit').fill('E2E 12M Term Deposit');
    await page.getByPlaceholder('e.g. 10000').fill('15000');
    await page.getByPlaceholder('e.g. 5.10').fill('5.25');
    await page.getByRole('button', { name: '+ Add Term Deposit' }).click();
    await expect(page.getByText('E2E 12M Term Deposit').first()).toBeVisible();

    // Total should now be $6,500 + $20,000 + $15,000 = $41,500.00 NZD
    await expect(page.getByText('$41,500.00 NZD').first()).toBeVisible({ timeout: 10_000 });

    // Assert Projected Organic Cashflow reflects the entered interest & dividend rates:
    // MCY $6,500 @ 4.8% = $312.00 gross direct dividends
    // KERNEL_NZ_20 $20,000 @ 2.5% fallback = $500.00 gross PIE dividends
    // E2E 12M Term Deposit $15,000 @ 5.25% = $787.50 gross PIE interest
    await expect(page.getByText('($312.00 gross)').first()).toBeVisible();
    await expect(page.getByText('($500.00 gross)').first()).toBeVisible();
    await expect(page.getByText('($787.50 gross)').first()).toBeVisible();

    // 4. Reload page and verify browser localStorage persistence
    await page.reload();
    await expect(page.getByText('$41,500.00 NZD').first()).toBeVisible({ timeout: 10_000 });

    // 5. Export Portfolio JSON backup, clear portfolio, then Import the exported JSON
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Portfolio' }).click();
    const download = await downloadPromise;
    const exportPath = testInfo.outputPath('exported_portfolio.json');
    await download.saveAs(exportPath);
    const exportedJson = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
    expect(exportedJson.directHoldings.length).toBeGreaterThanOrEqual(1);
    expect(exportedJson.fixedInterest.length).toBeGreaterThanOrEqual(1);

    // Clear portfolio -> $0.00 NZD
    await page.getByRole('button', { name: 'Clear Portfolio' }).click();
    await expect(page.getByText('$0.00 NZD').first()).toBeVisible({ timeout: 10_000 });

    // Import via the hidden file input inside PortfolioInputTable
    const fileInput = page.locator('input[type="file"][accept=".json"]');
    await fileInput.setInputFiles(exportPath);
    await expect(page.getByText('$41,500.00 NZD').first()).toBeVisible({ timeout: 10_000 });

    expect(pageErrors, `Uncaught page errors: ${pageErrors.join('; ')}`).toEqual([]);
  });

  test('2. Buckets 70/30 assignment, rebalancing math, and planned withdrawal rebalancing', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/');
    await expect(page.getByText('Kiwi Portfolio X-Ray').first()).toBeVisible({ timeout: 15_000 });

    // Open Portfolio Inputs and clear sample data so we start with exact $100,000 ($80k / $20k)
    await page.getByRole('button', { name: /Portfolio\s+\$/ }).first().click();
    await page.getByRole('button', { name: 'Clear Portfolio' }).click();
    await expect(page.getByText('$0.00 NZD').first()).toBeVisible({ timeout: 10_000 });

    // Add $80,000 in KERNEL_NZ_20 (Panel 2)
    const heldOnly = page.getByLabel('Held only');
    if (await heldOnly.isChecked()) {
      await heldOnly.uncheck();
    }
    await page
      .getByPlaceholder('Search code, scheme, or fund manager (e.g. Kernel, Fisher)...')
      .fill('KERNEL_NZ_20');
    const kernelInput = page.getByLabel('Balance in NZD for KERNEL_NZ_20');
    await kernelInput.fill('80000');
    await kernelInput.blur();

    // Add $20,000 in ANZ Term Deposit (Panel 3)
    await page.getByPlaceholder('e.g. 12M PIE Term Deposit').fill('Bucket Test TD');
    await page.getByPlaceholder('e.g. 10000').fill('20000');
    await page.getByPlaceholder('e.g. 5.10').fill('5.00');
    await page.getByRole('button', { name: '+ Add Term Deposit' }).click();
    await expect(page.getByText('$100,000.00 NZD').first()).toBeVisible({ timeout: 10_000 });

    // Verify Buckets & Withdrawal Rebalancer and Projected Organic Cashflow are visible
    await expect(page.getByText(/Buckets & Withdrawal Rebalancer/i).first()).toBeVisible();
    await expect(page.getByText(/Projected Organic Cashflow/i).first()).toBeVisible();

    // Assert Cashflow values for $80k KERNEL_NZ_20 (2.5% = $2,000 gross / $1,790 net @ 10.5% PIR)
    // + $20k PIE TD (5.0% = $1,000 gross / $895 net @ 10.5% PIR) -> Total PIE $3,000 gross / $2,685 net
    await expect(page.getByText('$3,000.00').first()).toBeVisible();
    await expect(page.getByText('$2,685.00').first()).toBeVisible();
    await expect(page.getByText('($1,000.00 gross)').first()).toBeVisible();
    await expect(page.getByText('($2,000.00 gross)').first()).toBeVisible();

    // Remove any existing starter buckets so we start fresh
    const deleteBucketBtns = page.getByTitle('Delete bucket');
    while ((await deleteBucketBtns.count()) > 0) {
      await deleteBucketBtns.first().click();
    }

    // Create two buckets: Growth 70 (70%) and Defensive 30 (30%)
    const bucketNameInput = page.getByPlaceholder('New bucket name (e.g. Growth Equities)');
    const bucketPctInput = page.getByLabel('New bucket target percent');
    const addBucketBtn = page.getByRole('button', { name: '+ Add Bucket' });

    await bucketNameInput.fill('Growth 70');
    await bucketPctInput.fill('70');
    await addBucketBtn.click();

    await bucketNameInput.fill('Defensive 30');
    await bucketPctInput.fill('30');
    await addBucketBtn.click();

    await expect(page.getByText('Target Sum: 100.0%')).toBeVisible();

    // Assign KERNEL_NZ_20 ($80k) -> Growth 70, and Bucket Test TD ($20k) -> Defensive 30
    await page.getByLabel('Assign bucket for KERNEL_NZ_20', { exact: true }).selectOption({ label: 'Growth 70' });
    await page.getByLabel(/Assign bucket for .*Bucket Test TD/i).selectOption({ label: 'Defensive 30' });

    // Assert 70/30 allocation & $0-withdrawal rebalancing:
    // Growth 70: $80,000 (80.0%) vs 70.0% (+10.0%) -> Sell -$10,000.00 -> Post $70,000.00
    // Defensive 30: $20,000 (20.0%) vs 30.0% (-10.0%) -> Buy +$10,000.00 -> Post $30,000.00
    const growthRow = page.locator('tbody tr', { hasText: 'Growth 70' });
    const defensiveRow = page.locator('tbody tr', { hasText: 'Defensive 30' });

    await expect(growthRow).toContainText('$80,000.00');
    await expect(growthRow).toContainText('80.0%');
    await expect(growthRow).toContainText('Sell -$10,000.00');
    await expect(growthRow).toContainText('$70,000.00');

    await expect(defensiveRow).toContainText('$20,000.00');
    await expect(defensiveRow).toContainText('20.0%');
    await expect(defensiveRow).toContainText('Buy +$10,000.00');
    await expect(defensiveRow).toContainText('$30,000.00');

    // Enter Planned Withdrawal of $10,000 -> Post-withdrawal total = $90,000 ($63k / $27k)
    // Withdrawal draws strictly from overweight Growth 70 (-$10,000.00), leaving Sell -$7,000.00 / Buy +$7,000.00
    await page.getByLabel('Planned Withdrawal (NZD):').fill('10000');

    await expect(page.getByText('After Withdrawal: $90,000.00')).toBeVisible();
    await expect(growthRow).toContainText('-$10,000.00');
    await expect(growthRow).toContainText('Sell -$7,000.00');
    await expect(growthRow).toContainText('$63,000.00');

    await expect(defensiveRow).toContainText('$0.00');
    await expect(defensiveRow).toContainText('Buy +$7,000.00');
    await expect(defensiveRow).toContainText('$27,000.00');

    expect(pageErrors, `Uncaught page errors: ${pageErrors.join('; ')}`).toEqual([]);
  });

  test('3. DIY Direct Index Rebalancer (DIV & ASD) renders breakeven cards and constituent table', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/');
    await expect(page.getByText('Kiwi Portfolio X-Ray').first()).toBeVisible({ timeout: 15_000 });

    // Expand DIY Direct Index Rebalancer panel (below Bucket Rebalancer)
    const replicatorHeader = page.locator('button', { hasText: /DIY Direct Index Rebalancer/i });
    await expect(replicatorHeader).toBeVisible();
    await replicatorHeader.click();

    // Verify DIV model loads with breakeven cards, Actual $ Held column & NZ Imputation badge
    await expect(page.getByText('Annual Passive Fee Drag')).toBeVisible();
    await expect(page.getByText('Breakeven Payoff Time')).toBeVisible();
    await expect(page.getByText('Actual $ Held')).toBeVisible();
    await expect(page.getByText('NZ Imputation Credits · Zero FIF').first()).toBeVisible();

    // Switch Target Index to ASD and verify Trans-Tasman FIF Exempt badge appears
    const indexSelect = page.locator('select').filter({ hasText: 'Smartshares NZ Dividend ETF (DIV)' });
    await indexSelect.selectOption('ASD');
    await expect(page.getByText('Trans-Tasman FIF Exempt (ASX)').first()).toBeVisible();

    expect(pageErrors, `Uncaught page errors: ${pageErrors.join('; ')}`).toEqual([]);
  });
});
