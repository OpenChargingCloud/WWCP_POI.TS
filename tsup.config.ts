import { defineConfig } from 'tsup';

export default defineConfig({
    entry:      ['src/index.ts'],
    // ESM only, as the @noble family and the Vanaheimr codecs this library builds on.
    format:     ['esm'],
    target:     'es2023',
    platform:   'neutral',
    dts:        false,
    sourcemap:  true,
    clean:      true,
    treeshake:  true,
    splitting:  false,
    tsconfig:   'tsconfig.build.json',
});
