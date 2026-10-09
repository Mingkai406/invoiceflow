const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:44042',
    headless: true,
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  },
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:44042',
    reuseExistingServer: false,
    env: { PORT: '44042', NODE_ENV: 'development' },
    timeout: 30000,
  },
});
