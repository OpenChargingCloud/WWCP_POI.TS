import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { parseJSON }     from '../src/json/parse.ts';
import { clone, isArray, isObject, type JSONValue } from '../src/json/value.ts';


// The golden vectors of WWCPPOIConformanceTests (https://github.com/OpenChargingCloud/WWCPPOIConformanceTests), vendored
// in tests/vectors: generated there, never edited here. That repository runs the very same files against the C#
// implementation of WWCP_POI as well, and its VendoredCopiesTests fail when the copies here drift. Refresh them there:
//
//     node tools/generate-test-vectors.mjs --mirror libs/WWCP_POI.TS/tests/vectors
//
// The frozen run they name (runs/csharp-bc3b1bd there) is vendored next to them, as tests/vectors/csharp-bc3b1bd.


/** The name this library is known by within the vector files ("knownDeviations", "notApplicable"). */
export const IMPLEMENTATION_NAME = 'wwcp-poi.ts';

/** The capabilities this library provides ("requires" of vectors): it verifies, it does not sign. */
const CAPABILITIES: ReadonlySet<string> = new Set<string>();

/** Every capability the vector format knows: a vector requiring another one is newer than these tests. */
const KNOWN_CAPABILITIES: ReadonlySet<string> = new Set([ 'signing' ]);

const VECTORS = join(import.meta.dirname, 'vectors');

const load = (file: string): unknown =>
    JSON.parse(readFileSync(join(VECTORS, file), 'utf8'));


// ---- Who a vector applies to --------------------------------------------------------------------------------------

export interface Applicability {
    readonly knownDeviations?:  readonly string[];
    readonly notApplicable?:    readonly string[];
    readonly requires?:         readonly string[];
}

/** Whether this library is known to deviate from the vector: it is then held to its deviation, not the vector. */
export const deviates = (vector: Applicability): boolean =>
    vector.knownDeviations?.includes(IMPLEMENTATION_NAME) ?? false;

/** Whether these tests run the vector: not when it requires what this library lacks, or does not apply to it. */
export function applies(vector: Applicability): boolean {

    const unknown = vector.requires?.find(capability => !KNOWN_CAPABILITIES.has(capability));

    if (unknown !== undefined)
        throw new Error(`A vector requires the capability '${unknown}', which these tests do not know: the vector files are newer than the tests!`);

    return (vector.requires ?? []).every(capability => CAPABILITIES.has(capability)) &&
           !(vector.notApplicable?.includes(IMPLEMENTATION_NAME) ?? false);

}


// ---- The vector files ---------------------------------------------------------------------------------------------

interface Vector extends Applicability {
    readonly id:           string;
    readonly description:  string;
}

/** A document of the frozen run: a file and a JSON pointer (RFC 6901) into it, "" for the whole file. */
export interface DocumentRef { readonly file: string, readonly pointer: string }

export interface PublicKeyOf { readonly coseKey: string, readonly keyId: string }

export const canonical = load('poi-canonical-json.json') as {
    readonly vectors:        ReadonlyArray<Vector & { input: string, expected: { canonical: string, cborHex?: string } }>;
    readonly invalidInputs:  ReadonlyArray<Vector & { input: string, expectedError: string }>;
};

export const encodings = load('poi-encodings.json') as {
    readonly base64:         ReadonlyArray<Vector & { text: string, hex: string }>;
    readonly base64Invalid:  ReadonlyArray<Vector & { text: string }>;
    readonly base45:         ReadonlyArray<Vector & { text: string, hex: string }>;
    readonly base45Invalid:  ReadonlyArray<Vector & { text: string }>;
};

export const specification = load('poi-specification.json') as {
    readonly contents:           ReadonlyArray<Vector & { content: string, eTags: string[] }>;
    readonly skeletons:          ReadonlyArray<Vector & { skeleton: string, hashAlgorithm: string, digest: string }>;
    readonly commits:            ReadonlyArray<Vector & { commit: unknown, content: string, hashAlgorithm: string, commitId: string }>;
    readonly keys:               ReadonlyArray<Vector & PublicKeyOf>;
    readonly signatures:         ReadonlyArray<Vector & PublicKeyOf & { algorithm: string, input: string, value: string }>;
    readonly invalidSignatures:  ReadonlyArray<Vector & PublicKeyOf & { algorithm: string, input: string, value: string }>;
    readonly priceStatements:    ReadonlyArray<Vector & { statement: string, digest: string }>;
    readonly trustAnchors:       ReadonlyArray<Vector & { json: string, qrCode: string, roamingNetworkId: string, urls: string[], keys: string[], minConsensus: number }>;
};

export const trust = load('poi-trust.json') as {
    readonly stationProofs:  ReadonlyArray<Vector & { expected: 'accepted' | 'refused', trustAnchor: string, proof: string, at: string, evseId: string, root: string }>;
};

export type ReplayStep =
    | { readonly op: 'fromSnapshot',    readonly file: string }
    | { readonly op: 'append',          readonly file: string }
    | { readonly op: 'takeCheckpoint',  readonly file: string }
    | { readonly op: 'startNextEpoch',  readonly genesisCommitId: string }
    | { readonly op: 'expectHead',      readonly epoch: number, readonly revision: number, readonly commitId: string, readonly eTags?: string[] };

export const history = load('poi-history.json') as {
    readonly run:               string;
    readonly versions:          ReadonlyArray<Vector & DocumentRef & { roamingNetworkId: string, eTags: string[] }>;
    readonly commits:           ReadonlyArray<Vector & DocumentRef & { commitId: string, roamingNetworkId: string, epoch: number, revision: number, hashAlgorithm: string, eTags: string[] }>;
    readonly checkpoints:       ReadonlyArray<Vector & DocumentRef & { checkpointId: string, roamingNetworkId: string, epoch: number, sequence: number, revision: number, commitId: string, final: boolean }>;
    readonly checkpointProofs:  ReadonlyArray<Vector & DocumentRef & { checkpoint: DocumentRef, checkpointId: string, commitId: string }>;
    readonly priceStatements:   ReadonlyArray<Vector & DocumentRef & { sequence: number, digest: string, previous?: string }>;
    readonly trustAnchors:      ReadonlyArray<Vector & { file: string, roamingNetworkId: string, urls: string[], keys: string[], minConsensus: number, json: string }>;
    readonly stationProofs:     ReadonlyArray<Vector & DocumentRef & { trustAnchor: string, at: string, commitId: string, revision: number, root: string, chargingStations: Array<{ chargingStationId: string | null, evseIds: string[] }> }>;
    readonly replays:           ReadonlyArray<Vector & { commitAndCheckpointSignatures: string, steps: ReplayStep[] }>;
};

export interface PatchOperation { readonly op: 'add' | 'replace' | 'remove', readonly path: string, readonly value?: unknown }

export type RefusalKind = 'commit' | 'checkpoint' | 'version' | 'checkpointProof' | 'stationProof' | 'priceStatement' | 'trustAnchor';

export interface RefusalVector extends Vector {
    readonly kind:          RefusalKind;
    readonly basis:         string;
    readonly document?:     DocumentRef & { readonly patch: readonly PatchOperation[] };
    readonly checkpoint?:   DocumentRef;
    readonly trustAnchor?:  string;
    readonly at?:           string;
    readonly keysFrom?:     DocumentRef;
    readonly text?:         string;
}

export const refusals = load('poi-refusals.json') as { readonly vectors: readonly RefusalVector[] };


// ---- Documents of the frozen run ----------------------------------------------------------------------------------

/** The vendored run: next to the vector files, by its name. */
const RUN = join(VECTORS, history.run.split('/').pop() ?? history.run);

/** A file of the run as text. */
export const runText = (file: string): string =>
    readFileSync(join(RUN, file), 'utf8');

function tokens(pointer: string): string[] {
    return pointer === '' ? [] : pointer.slice(1).split('/').map(token => token.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function step(value: JSONValue, token: string, where: string): JSONValue {
    const next = isArray(value) ? value[Number(token)] : isObject(value) ? value[token] : undefined;
    if (next === undefined)
        throw new Error(`${where}: the pointer names nothing at '${token}'`);
    return next;
}

/** A document of the run, read as POI reads JSON: a copy of its own. */
export function runDocument(ref: DocumentRef | string): JSONValue {
    const { file, pointer } = typeof ref === 'string' ? { file: ref, pointer: '' } : ref;
    return clone(tokens(pointer).reduce((value, token) => step(value, token, file), parseJSON(runText(file))));
}

/** A document of the run with a JSON patch (RFC 6902: add, replace, remove) applied, its values read as POI reads JSON. */
export function patched(ref: DocumentRef & { readonly patch: readonly PatchOperation[] }): JSONValue {

    const document = runDocument(ref);

    for (const operation of ref.patch) {

        const path    = tokens(operation.path);
        const last    = path.pop();

        if (last === undefined)
            throw new Error('No vector patches a whole document');

        const parent  = path.reduce((value, token) => step(value, token, ref.file), document);
        const value   = parseJSON(JSON.stringify(operation.value ?? null));

        if (isArray(parent)) {
            const index = last === '-' ? parent.length : Number(last);
            if      (operation.op === 'remove') parent.splice(index, 1);
            else if (operation.op === 'add')    parent.splice(index, 0, value);
            else                                parent[index] = value;
        }
        else if (isObject(parent)) {
            if (operation.op === 'remove') Reflect.deleteProperty(parent, last);
            else                           parent[last] = value;
        }
        else
            throw new Error(`${ref.file}: the patch path '${operation.path}' names no container`);

    }

    return document;

}
