import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './qa', timeout: 30000, use: { baseURL: 'http://localhost:3000', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH === 'bundled' ? undefined : (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome'), args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } },
  webServer: { command: 'npm start', url: 'http://localhost:3000', reuseExistingServer: !process.env.CI }
});
