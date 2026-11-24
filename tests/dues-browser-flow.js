import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

export async function duesBrowserFlow({ page, browser }, testInfo, pilot) {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const login = await page.request.post('/api/login', {
    headers: { 'X-Prototype': 'local' },
    data: pilot
      ? { email: 'owner@example.test', password: 'fictional-owner-password' }
      : { email: 'coach@tvvc.example', password: 'prototype-only' },
  });
  expect(login.ok()).toBeTruthy();
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Dues', exact: true }).click();
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/admin/dues-rehearsal') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create fictional dues rehearsal', exact: true }).click();
  const { campaignId } = await (await created).json();
  await expect(page.getByRole('combobox', { name: 'Campaign', exact: true })).toHaveValue(
    campaignId,
  );
  await expect(
    page.getByRole('heading', { name: 'Sample Riley · season dues', exact: true }),
  ).toBeVisible();
  const row = (label) =>
    page
      .locator('.dues-balances > div')
      .filter({ has: page.locator('dt', { hasText: label }) })
      .locator('dd');
  await expect(row('Available net funds')).toHaveText('$97.00');
  await page
    .getByRole('combobox', { name: 'Contribution', exact: true })
    .selectOption({ index: 1 });
  await page.getByLabel('Amount ($)', { exact: true }).fill('60');
  await page
    .getByLabel('External posting / payment / refund reference', { exact: true })
    .fill(`FICTIONAL-POST-${randomUUID()}`);
  await page
    .getByLabel('Dues audit note', { exact: true })
    .fill('Matched fictional dues statement.');
  await page.getByRole('button', { name: 'Save dues action', exact: true }).click();
  await expect(row('Applied dues credit')).toHaveText('$60.00');
  await expect(row('Remaining dues')).toHaveText('$940.00');
  await page.reload();
  await page.getByRole('button', { name: 'Dues', exact: true }).click();
  await page.getByRole('combobox', { name: 'Campaign', exact: true }).selectOption(campaignId);
  await expect(row('Applied dues credit')).toHaveText('$60.00');
  await page
    .getByRole('combobox', { name: 'Dues action', exact: true })
    .selectOption('family-link');
  await page
    .getByLabel('Dues audit note')
    .fill('Verified fictional guardian through an established channel.');
  await page.getByRole('button', { name: 'Save dues action', exact: true }).click();
  const href = await page
    .getByRole('link', { name: 'Open private family summary', exact: true })
    .getAttribute('href');
  const familyContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const family = await familyContext.newPage();
    await family.goto(new URL(href, page.url()).href);
    await expect(
      family.getByRole('heading', { name: 'Private family season summary' }),
    ).toBeVisible();
    await expect(
      family
        .locator('.dues-balances > div')
        .filter({ hasText: 'Applied dues credit' })
        .locator('dd'),
    ).toHaveText('$60.00');
    await expect(family.getByText('fictional-donor@example.test')).toHaveCount(0);
    expect(
      await family.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    ).toBeTruthy();
    await family.screenshot({
      path: testInfo.outputPath('family-summary-390.png'),
      fullPage: true,
    });
    await page.getByRole('combobox', { name: 'Dues action', exact: true }).selectOption('withdraw');
    await page.getByLabel('Total eligible season obligation after withdrawal ($)').fill('20');
    await page
      .getByLabel('Dues audit note')
      .fill('Fictional withdrawal agreement retains a $20 obligation.');
    await page.getByRole('button', { name: 'Save dues action', exact: true }).click();
    await expect(row('Applied dues credit')).toHaveText('$20.00');
    await expect(row('External reversals awaiting reconciliation')).toHaveText('$40.00');
    await family.reload();
    await expect(
      family.getByRole('status').filter({ hasText: 'expired or was revoked' }),
    ).toHaveCount(0); // error uses alert
    await expect(family.getByRole('alert')).toHaveText(/expired or was revoked/);
    await page
      .getByRole('combobox', { name: 'Dues action', exact: true })
      .selectOption('reversal-posted');
    await page
      .getByRole('combobox', { name: 'Outstanding reversal', exact: true })
      .selectOption({ index: 1 });
    await page
      .getByLabel('External posting / payment / refund reference')
      .fill(`FICTIONAL-REVERSAL-${randomUUID()}`);
    await page.getByLabel('Dues audit note').fill('Fictional external reversal reconciled.');
    await page.getByRole('button', { name: 'Save dues action', exact: true }).click();
    await expect(row('External reversals awaiting reconciliation')).toHaveText('$0.00');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    ).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath('dues-admin-390.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    ).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath('dues-admin-desktop.png'), fullPage: true });
    if (pilot) {
      const mode = await (await page.request.get('/api/runtime')).json();
      expect(mode.paymentsEnabled).toBe(false);
      expect(mode.emailEnabled).toBe(false);
      expect((await page.request.get('/api/public/not-open')).status()).toBe(403);
      expect(
        (
          await page.request.post('/api/simulator/payments', {
            headers: { 'X-Prototype': 'local' },
            data: {},
          })
        ).status(),
      ).toBe(403);
    }
  } finally {
    await familyContext.close();
  }
  expect(errors).toEqual([]);
}
