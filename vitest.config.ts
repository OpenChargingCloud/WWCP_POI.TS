import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        name:         'node',
        environment:  'node',
        include:      ['tests/**/*.test.ts'],
        // The browser and the bundle have configurations of their own: vitest.browser.config.ts, vitest.bundle.config.ts.
        exclude:      ['tests/browser/**', 'tests/build/**'],
        // ML-DSA and Ed448 verifications in pure JavaScript take their time on a loaded machine, and the Windows runners
        // of GitHub are slower than a desktop by far.
        testTimeout:  60_000,
        coverage: {
            reporter:  ['text', 'html'],
            include:   ['src/**/*.ts'],
            exclude:   ['src/index.ts'],
        },
    },
});
