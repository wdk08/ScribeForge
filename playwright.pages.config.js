import { defineConfig } from '@playwright/test';

const baseURL = 'http://localhost:4275/StoryForge/';
export default defineConfig({
  testDir: './tests/storyforge/production',
  use: { baseURL, channel: 'chrome' },
  webServer: {
    command: 'npm exec vite -- preview --host 127.0.0.1 --port 4275 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
  },
});
