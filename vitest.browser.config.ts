import { defineConfig }  from 'vitest/config';
import { playwright }    from '@vitest/browser-playwright';

// The library in a real browser: Chromium without a window, through Playwright (`npx playwright install chromium` once).
export default defineConfig({
    test: {
        name:         'browser',
        include:      ['tests/browser/**/*.test.ts'],
        // ML-DSA and Ed448 verifications in pure JavaScript, in a browser on a shared runner.
        testTimeout:  120_000,
        browser: {
            enabled:    true,
            provider:   playwright({}),
            instances:  [ { browser: 'chromium' } ],
            headless:   true,
        },
    },
});
