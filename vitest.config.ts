import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include:     ['tests/**/*.test.ts'],
        environment: 'node',
        // ML-DSA and Ed448 verifications in pure JavaScript take their time on a loaded machine.
        testTimeout: 60_000,
    },
});
