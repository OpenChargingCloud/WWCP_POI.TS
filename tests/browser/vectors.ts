/// <reference types="vite/client" />

import { parseJSON }      from '../../src/json/parse.ts';
import type { JSONValue } from '../../src/json/value.ts';
import { VECTORS_RUN }    from '../at.ts';


// The test vectors in the browser: the files the tests read, bundled as text by Vite, as an app downloads them.

const files: Record<string, string> = import.meta.glob([
    '../vectors/*/published/QA-trustAnchor.txt',
    '../vectors/*/published/QA-trustAnchor-mldsa.txt',
    '../vectors/*/published/QA-genesis.json',
    '../vectors/*/published/QA-epoch-2-checkpoint-0-priceStatements.json',
    '../vectors/*/proofs/QA-proof-station-DE_GEF_S1.json',
    '../vectors/*/driver/evidence-DE_GEF_E1_1.json',
    '../vectors/*/trusted/witnesses.json',
], { query: '?raw', import: 'default', eager: true });

/** A file of the test vectors of the run the tests check, as text. */
export function readText(file: string): string {

    const text = files[`../vectors/${VECTORS_RUN}/${file}`];

    if (text === undefined)
        throw new Error(`The test vector '${file}' is not bundled for the browser!`);

    return text;

}

/** A file of the test vectors as POI reads JSON: decimals stay decimals, timestamps stay text. */
export const readJSON = (file: string): JSONValue =>
    parseJSON(readText(file));
