import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:5174', headless: false, trace: 'off' },
  reporter: 'list',
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      PROTOTYPE_DATA_DIR: '.local-e2e',
      PROTOTYPE_API_PORT: '3101',
      PROTOTYPE_WEB_PORT: '5174',
    },
  },
});
