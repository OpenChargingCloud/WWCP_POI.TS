import { defineConfig } from 'vitest/config';

// The tests of what `npm run build` wrote to dist/: they run after the build.
export default defineConfig({
    test: {
        name:         'bundle',
        environment:  'node',
        include:      ['tests/build/**/*.test.js'],
        testTimeout:  60_000,
    },
});
