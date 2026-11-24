import { test } from '@playwright/test';
import { duesBrowserFlow } from '../dues-browser-flow.js';

test('fictional family dues credits, private summary and withdrawal reconcile on mobile', async ({
  page,
  browser,
}, testInfo) => {
  await duesBrowserFlow({ page, browser }, testInfo, false);
});
