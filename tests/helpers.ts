import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { parseJSON }     from '../src/json/parse.ts';
import type { JSONValue } from '../src/json/value.ts';


/**
 * The published artifacts of one run of the C# examples of WWCP_POI at commit bbd4cbd (examples/csharp, `dotnet run`):
 * what everybody may read, without any private key. The keys are new in every run, so are all digests.
 */
export const VECTORS = join(import.meta.dirname, 'vectors', 'csharp-bbd4cbd');

/** A point in time while the key statement and the keys of that run are valid. */
export const AT = '2026-10-24T14:20:00.000Z';

export const readText = (file: string): string =>
    readFileSync(join(VECTORS, file), 'utf8');

/** A JSON file read as POI reads JSON: decimals stay decimals, timestamps stay text. */
export const readJSON = (file: string): JSONValue =>
    parseJSON(readText(file));
