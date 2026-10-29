import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir }                           from 'node:os';
import { dirname, join, relative }          from 'node:path';
import { fileURLToPath }                    from 'node:url';
import { describe, expect, test }           from 'vitest';

import { AT, VECTORS_RUN }                  from '../at.ts';


// What `npm run build` wrote to dist/, as a consumer gets it: run after the build, never against the sources.

const projectRoot  = fileURLToPath(new URL('../..', import.meta.url));
const packageJSON  = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
const bundle       = readFileSync(join(projectRoot, 'dist', 'index.js'), 'utf8');

/** Every file below a directory, recursively. */
const filesBelow = directory =>
    readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
        entry.isDirectory() ? filesBelow(join(directory, entry.name)) : [ join(directory, entry.name) ]);

/**
 * The module specifiers a JavaScript or declaration file imports or exports from: of import and export statements, and of
 * dynamic imports; not a text that reads alike, e.g. "can not be changed from '1.5.0'".
 */
const specifiersOf = text =>
    [ ...text.matchAll(/(?:(?:^|[;}])\s*(?:import|export)\b[^;'"]*?\bfrom\s*|(?:^|[;}])\s*import\s*|\bimport\s*\(\s*)(['"])([^'"]+)\1/gm) ].map(match => match[2]);


describe('the bundle', () => {

    test('imports only the dependencies package.json names, and no node:* module', () => {

        const dependencies  = Object.keys(packageJSON.dependencies);
        const specifiers    = specifiersOf(bundle);

        expect(specifiers.length).toBeGreaterThan(0);
        expect(specifiers.filter(specifier => specifier.startsWith('node:'))).toEqual([]);
        expect(specifiers.filter(specifier => !dependencies.some(dependency => specifier === dependency || specifier.startsWith(dependency + '/')))).toEqual([]);

    });

    test('uses no Buffer and no process, so that it runs in browsers and React Native as in Node', () => {
        expect(bundle).not.toMatch(/(?<![\w$.])Buffer\b/);
        expect(bundle).not.toMatch(/(?<![\w$.])process\./);
    });

    test('is what an app imports by the name of the package, in plain Node', () => {

        const output = execFileSync(process.execPath, [ join('tests', 'build', 'consumer.mjs'), join('tests', 'vectors', VECTORS_RUN), AT ],
                                    { cwd: projectRoot, encoding: 'utf8' });

        expect(JSON.parse(output)).toEqual({
            revision:    0,
            signedBy:    [ 'AlphaOrg', 'BetaOrg', 'GammaOrg' ],
            station:     'DE*GEF*S1',
            model:       'GD-DC300',
            attestedBy:  [ 'AlphaOrg', 'BetaOrg', 'GammaOrg' ],
        });

    });

});


describe('the declarations', () => {

    test('exist for the entry package.json names', () => {
        expect(packageJSON.exports['.'].types).toBe('./dist/index.d.ts');
        expect(existsSync(join(projectRoot, 'dist', 'index.d.ts'))).toBe(true);
    });

    test('import each other by specifiers that resolve to a declaration', () => {

        const unresolved = [];

        // TypeScript keeps the .ts of a relative specifier in a declaration, and resolves it to the .d.ts beside it.
        for (const file of filesBelow(join(projectRoot, 'dist')).filter(file => file.endsWith('.d.ts')))
            for (const specifier of specifiersOf(readFileSync(file, 'utf8')).filter(specifier => specifier.startsWith('.')))
                if (!/\.(ts|js)$/.test(specifier) || !existsSync(join(dirname(file), specifier.replace(/\.(ts|js)$/, '.d.ts'))))
                    unresolved.push(`${relative(projectRoot, file)}: ${specifier}`);

        expect(unresolved).toEqual([]);

    });

    // A TypeScript app importing the package by its name, with either resolution an app uses: the types it gets are
    // the declared ones, not `any` (each @ts-expect-error must find its error), and the declarations check without
    // skipLibCheck.
    test.each([ [ 'nodenext', 'nodenext' ], [ 'esnext', 'bundler' ] ])('give an app their types (module %s, moduleResolution %s)', (module, moduleResolution) => {

        const app = mkdtempSync(join(tmpdir(), 'wwcp-poi-types-'));

        try {

            mkdirSync(join(app, 'node_modules', '@open-charging-cloud'), { recursive: true });
            symlinkSync(projectRoot, join(app, 'node_modules', '@open-charging-cloud', 'wwcp-poi'), 'junction');

            writeFileSync(join(app, 'package.json'), JSON.stringify({ type: 'module' }));
            writeFileSync(join(app, 'tsconfig.json'), JSON.stringify({
                compilerOptions: { strict: true, skipLibCheck: false, noEmit: true, target: 'es2022', lib: [ 'es2023', 'dom' ], module, moduleResolution, types: [] },
                files: [ 'app.ts' ],
            }));
            writeFileSync(join(app, 'app.ts'), [
                "import { TrustAnchor, verifyChargingStation, type VerifiedChargingStation } from '@open-charging-cloud/wwcp-poi';",
                "export function check(qrCode: string, proof: unknown): VerifiedChargingStation {",
                "    const anchor = TrustAnchor.parse(qrCode);",
                "    // @ts-expect-error: the identity keys a trust anchor pins are texts.",
                "    const keys: number = anchor.keys;",
                "    void keys;",
                "    // @ts-expect-error: a proof is JSON, not unknown.",
                "    return verifyChargingStation(anchor, proof);",
                "}",
            ].join('\n'));

            const typescript = join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');
            const result     = spawnSync(process.execPath, [ typescript, '-p', join(app, 'tsconfig.json') ], { cwd: app, encoding: 'utf8' });

            expect(result.stdout + result.stderr).toBe('');
            expect(result.status).toBe(0);

        }
        finally {
            rmSync(app, { recursive: true, force: true });
        }

    });

});


describe('the package', () => {

    test('publishes the bundle, its declarations and the documents, and neither sources nor test vectors', () => {

        // npm 10 answers with an array of packages, npm 11 and later with an object of them by name.
        const report  = JSON.parse(execSync('npm pack --dry-run --json --ignore-scripts', { cwd: projectRoot, encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'ignore' ] }));
        const packed  = Array.isArray(report) ? report[0] : report[packageJSON.name];
        const files   = packed.files.map(file => file.path.replaceAll('\\', '/'));

        for (const file of [ 'package.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'dist/index.js', 'dist/index.d.ts' ])
            expect(files).toContain(file);

        expect(files.filter(file => !file.startsWith('dist/') && ![ 'package.json', 'README.md', 'LICENSE', 'CHANGELOG.md' ].includes(file))).toEqual([]);

    });

});
