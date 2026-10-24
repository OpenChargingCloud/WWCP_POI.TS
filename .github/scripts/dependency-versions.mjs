// Writes a Markdown table of the runtime dependencies to stdout: the range package.json names, the version the lockfile
// pins, the version installed now, and whether that one is newer or outside the range. The nightly runs append it to
// the step summary.
//
//   node .github/scripts/dependency-versions.mjs "<title>" "<what the table is about>"

import { readFileSync } from 'node:fs';

const [ title, about ] = process.argv.slice(2);
const read             = file => JSON.parse(readFileSync(file, 'utf8'));
const packageJSON      = read('package.json');
const lockfile         = read('package-lock.json');

/** Whether a version is within a caret range: the same major version, or below 1.0.0 the same minor version. */
function withinCaret(range, version) {
    const [ rangeMajor, rangeMinor ] = range.replace(/^\^/, '').split('.').map(Number);
    const [ major, minor ]           = version.split('.').map(Number);
    return range.startsWith('^') && major === rangeMajor && (rangeMajor > 0 || minor === rangeMinor);
}

const lines = [ `## ${title}`, '', about, '', '| Package | Range | Locked | Installed |', '| --- | --- | --- | --- |' ];

for (const [ name, range ] of Object.entries(packageJSON.dependencies ?? {})) {

    let installed = '(missing)';

    try {
        installed = read(`node_modules/${name}/package.json`).version;
    }
    catch {
        // Missing: reported as such.
    }

    const locked = lockfile.packages?.[`node_modules/${name}`]?.version ?? '?';
    const mark   = installed === locked ? '' : withinCaret(range, installed) ? ' **↑**' : ' **↑ beyond the range**';

    lines.push(`| \`${name}\` | \`${range}\` | ${locked} | ${installed}${mark} |`);

}

console.log(lines.join('\n') + '\n');
