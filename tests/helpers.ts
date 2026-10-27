import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { parseJSON }     from '../src/json/parse.ts';
import { canonicalJSON } from '../src/json/canonical.ts';
import { isArray, isObject, type JSONValue } from '../src/json/value.ts';
import { VECTORS_RUN }   from './at.ts';
import type { SnapshotOptions } from '../src/history/history.ts';

export { AT }            from './at.ts';


/**
 * The published artifacts of one run of the C# examples of WWCP_POI at commit dbf39b0 (examples/csharp, `dotnet run`):
 * what everybody may read, without any private key. The keys are new in every run, so are all digests.
 */
export const VECTORS = join(import.meta.dirname, 'vectors', VECTORS_RUN);

export const readText = (file: string): string =>
    readFileSync(join(VECTORS, file), 'utf8');

/** A JSON file read as POI reads JSON: decimals stay decimals, timestamps stay text. */
export const readJSON = (file: string): JSONValue =>
    parseJSON(readText(file));


/** A value the test vectors give: a test fails here, naming what is missing, and not later on a property of undefined. */
export function defined<T>(value: T | null | undefined, what = 'The value'): T {

    if (value === null || value === undefined)
        throw new Error(`${what} is missing!`);

    return value;

}

/** A JSON value as text, as String() gives it: a string as it is, a number as it reads; an object or an array as its canonical JSON. */
export const asText = (value: JSONValue | undefined): string =>
    isObject(value) || isArray(value) ? canonicalJSON(value) : String(value);


/**
 * Takes snapshots, commits and checkpoints unanchored, with their signatures unchecked: for tests and replays of their
 * content alone, whose signatures are made up or the verifier's business, never for what a verifier trusts.
 */
export const UNCHECKED: SnapshotOptions = { unanchored: true, verifyCommit: () => undefined, verifyCheckpoint: () => undefined };
