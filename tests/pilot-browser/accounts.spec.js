import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });
test('TVVC owner manages individual access on mobile and fundraising remains closed', async ({
  page,
  browser,
}) => {
  await page.goto('/admin');
  await page.getByLabel('Administrator email', { exact: true }).fill('owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('fictional-owner-password');
  await page.getByRole('button', { name: 'Open administration' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  const email = `coach-${Date.now()}@example.test`;
  await page.getByLabel('Your current password', { exact: true }).fill('fictional-owner-password');
  await page.getByLabel('New administrator email', { exact: true }).fill(email);
  await page
    .getByLabel('New administrator password', { exact: true })
    .fill('fictional-coach-password');
  await page.getByRole('button', { name: 'Create administrator', exact: true }).click();
  await expect(
    page.getByText('Administrator created. No email was sent.', { exact: true }),
  ).toBeVisible();
  const coachContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const coach = await coachContext.newPage();
  await coach.goto('/admin');
  await coach.getByLabel('Administrator email', { exact: true }).fill(email);
  await coach.getByLabel('Password', { exact: true }).fill('fictional-coach-password');
  await coach.getByRole('button', { name: 'Open administration' }).click();
  await coach.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(coach.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  await expect(
    coach.getByRole('heading', { name: 'Administrator access', exact: true }),
  ).toHaveCount(0);
  await page.getByLabel('Your current password', { exact: true }).fill('fictional-owner-password');
  await page
    .getByRole('listitem')
    .filter({ hasText: email })
    .getByRole('button', { name: 'Disable access' })
    .click();
  await expect(
    page.getByText('Account access updated. Disabled accounts are signed out.', { exact: true }),
  ).toBeVisible();
  await coach.reload();
  await expect(coach.getByLabel('Administrator email', { exact: true })).toBeVisible();
  await page.getByLabel('Your current password', { exact: true }).fill('fictional-owner-password');
  await page
    .getByRole('listitem')
    .filter({ hasText: email })
    .getByRole('button', { name: 'Enable access' })
    .click();
  await coach.getByLabel('Administrator email', { exact: true }).fill(email);
  await coach.getByLabel('Password', { exact: true }).fill('fictional-coach-password');
  await coach.getByRole('button', { name: 'Open administration' }).click();
  await coach.getByRole('button', { name: 'Account', exact: true }).click();
  await coach.getByLabel('Your current password', { exact: true }).fill('fictional-coach-password');
  await coach.getByLabel('New password', { exact: true }).fill('fictional-replacement-password');
  await coach.getByRole('button', { name: 'Change password and sign out', exact: true }).click();
  await expect(coach.getByLabel('Administrator email', { exact: true })).toBeVisible();
  await coach.getByLabel('Administrator email', { exact: true }).fill(email);
  await coach.getByLabel('Password', { exact: true }).fill('fictional-replacement-password');
  await coach.getByRole('button', { name: 'Open administration' }).click();
  await expect(coach.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
  await expect(coach.getByText(`Signed in as ${email} · admin`, { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: email })
      .getByRole('button', { name: 'Disable access' }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByText('Preparation only.', { exact: false })).toBeVisible();
  await page.screenshot({ path: 'artifacts/pilot-account-mobile.png', fullPage: true });
  await coachContext.close();
});
