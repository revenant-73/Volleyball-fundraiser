import { test } from '@playwright/test';
import { duesBrowserFlow } from '../dues-browser-flow.js';

test('pilot fictional family dues rehearsal preserves balances and closed live-service gates', async ({
  page,
  browser,
}, testInfo) => {
  await duesBrowserFlow({ page, browser }, testInfo, true);
});
