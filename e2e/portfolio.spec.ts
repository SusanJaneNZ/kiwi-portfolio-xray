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
    const portfolioHeader = page.locator('button', { hasText: /^Portfolio/ }).first();
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

    // 3b. Enter 1 Managed Fund / KiwiSaver (Panel 2)
    const fundSearch = page.getByPlaceholder(
      'Search code, scheme, or fund manager (e.g. Kernel, Fisher)...'
    );
    await fundSearch.fill('KERNEL_NZ_20');
    const fundBalanceInput = page.locator('input[type="number"][placeholder="0"]').first();
    await fundBalanceInput.fill('20000');
    await fundBalanceInput.blur();

    // 3c. Enter 1 Term Deposit (Panel 3: Fixed Interest & Cash)
    await page.getByPlaceholder('e.g. 12M PIE Term Deposit').fill('E2E 12M Term Deposit');
    await page.getByPlaceholder('e.g. 10000').fill('15000');
    await page.getByPlaceholder('e.g. 5.10').fill('5.25');
    await page.getByRole('button', { name: '+ Add Term Deposit' }).click();
    await expect(page.getByText('E2E 12M Term Deposit')).toBeVisible();

    // Total should now be $6,500 + $20,000 + $15,000 = $41,500.00 NZD
    await expect(page.getByText('$41,500.00 NZD').first()).toBeVisible({ timeout: 10_000 });

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

  test('2. Bucket Rebalancer and Cashflow panels render cleanly', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/');
    await expect(page.getByText('Kiwi Portfolio X-Ray').first()).toBeVisible({ timeout: 15_000 });

    // Verify Bucket Rebalancer and Cashflow sections render cleanly
    await expect(page.getByText(/Bucket Rebalancer/i).first()).toBeVisible();
    await expect(page.getByText(/Cashflow|Inflows/i).first()).toBeVisible();

    expect(pageErrors, `Uncaught page errors: ${pageErrors.join('; ')}`).toEqual([]);
  });
});
