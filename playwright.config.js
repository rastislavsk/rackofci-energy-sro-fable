import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: 'test/e2e',
    fullyParallel: true,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: 'http://127.0.0.1:8080',
        locale: 'sk-SK',
        timezoneId: 'Europe/Bratislava',
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        trace: 'retain-on-failure',
    },
    webServer: {
        command: 'npx http-server -p 8080 -c-1 -s .',
        url: 'http://127.0.0.1:8080/index.html',
        reuseExistingServer: !process.env.CI,
    },
});
