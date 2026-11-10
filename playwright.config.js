import { defineConfig } from '@playwright/test';
const baseURL = 'http://localhost:4274';
export default defineConfig({
  testDir: './tests/scribeforge/browser',
  use: { baseURL, channel: 'chrome', viewport: { width: 1440, height: 1000 } },
  webServer: { command: 'npm run dev:browser', env: { PORT: '4274' }, url: baseURL, reuseExistingServer: false },
});
