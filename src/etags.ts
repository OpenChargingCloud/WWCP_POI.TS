/*
 * Copyright (c) 2014-2026 GraphDefined GmbH <achim.friedland@graphdefined.com>
 * This file is part of WWCP POI TS <https://github.com/OpenChargingCloud/WWCP_POI.TS>
 *
 * Licensed under the Affero GPL license, Version 3.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.gnu.org/licenses/agpl.html
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { canonicalJSONBytes }                    from './json/canonical.ts';
import { deterministicCbor }                     from './encoding/cbor.ts';
import { bytesEqual, fromBase64, fromHex, toBase64, toHex } from './encoding/text.ts';
import { DIGEST_LENGTH, hash, isHashAlgorithm, type HashAlgorithm } from './crypto/hash.ts';
import { isArray, type JSONValue }               from './json/value.ts';
import { POIError }                              from './errors.ts';


/** What an ETag is a digest of (SPECIFICATION.md section 3). */
export type ETagFormat = 'json' | 'cbor' | 'effectiveTree';

const FORMATS: readonly ETagFormat[] = [ 'json', 'cbor', 'effectiveTree' ];


/**
 * An ETag: the digest of a content in one of three formats, the canonical JSON, the deterministic CBOR, or the root of
 * the hash tree of the effective content (section 8).
 */
export interface ETag {
    readonly format:     ETagFormat;
    readonly algorithm:  HashAlgorithm;
    readonly digest:     Uint8Array;
}


/**
 * Reads an ETag as JSON writes it, `["json", "sha256", "hex", "<digest>"]`; with `hexOnly`, as change sets, commits and
 * checkpoints MUST write it, as their identifications and signatures are calculated over it as written (3.1).
 */
export function parseETag(value: JSONValue | undefined, hexOnly = false): ETag {

    if (!isArray(value) || value.length !== 4 || value.some(item => typeof item !== 'string'))
        throw new POIError('An ETag is written as [ format, hash algorithm, encoding, digest ]!');

    const [ format, algorithm, encoding, text ] = value as [string, string, string, string];

    if (!(FORMATS as readonly string[]).includes(format))
        throw new POIError(`Unknown ETag format '${format}'!`);

    if (!isHashAlgorithm(algorithm))
        throw new POIError(`Unknown ETag hash algorithm '${algorithm}'!`);

    let digest: Uint8Array;

    if (encoding === 'hex')
        digest = fromHex(text, true);

    else if (encoding === 'base64' && !hexOnly)
        digest = fromBase64(text);

    else
        throw new POIError(hexOnly
                               ? `An ETag of a change set, commit or checkpoint must be written in hex, not in '${encoding}'!`
                               : `Unknown ETag encoding '${encoding}'!`);

    if (digest.length !== DIGEST_LENGTH[algorithm])
        throw new POIError(`A ${algorithm} ETag has ${DIGEST_LENGTH[algorithm]} bytes, not ${digest.length}!`);

    return { format: format as ETagFormat, algorithm, digest };

}

/** Reads an array of ETags. */
export function parseETags(value: JSONValue | undefined, hexOnly = false, what = 'The ETags'): ETag[] {

    if (!isArray(value))
        throw new POIError(`${what} must be a JSON array!`);

    return value.map(item => parseETag(item, hexOnly));

}

/** An ETag as JSON writes it, in hex unless asked otherwise. */
export function etagToJSON(etag: ETag, encoding: 'hex' | 'base64' = 'hex'): JSONValue {
    return [ etag.format, etag.algorithm, encoding, encoding === 'hex' ? toHex(etag.digest) : toBase64(etag.digest) ];
}

/** An ETag as text, `json:sha256:hex:<digest>`. */
export function etagToText(etag: ETag): string {
    return `${etag.format}:${etag.algorithm}:hex:${toHex(etag.digest)}`;
}

export function sameETag(left: ETag, right: ETag): boolean {
    return left.format    === right.format    &&
           left.algorithm === right.algorithm &&
           bytesEqual(left.digest, right.digest);
}

/** Whether two lists of ETags are the same, in the same order. */
export function sameETags(left: readonly ETag[], right: readonly ETag[]): boolean {
    return left.length === right.length &&
           left.every((etag, index) => sameETag(etag, right[index]!));
}


/** The `json` ETag of a content: the digest of its canonical JSON. */
export function jsonETag(content: JSONValue, algorithm: HashAlgorithm = 'sha256'): ETag {
    return { format: 'json', algorithm, digest: hash(algorithm, canonicalJSONBytes(content)) };
}

/** The `cbor` ETag of a content: the digest of its deterministic CBOR. */
export function cborETag(content: JSONValue, algorithm: HashAlgorithm = 'sha256'): ETag {
    return { format: 'cbor', algorithm, digest: hash(algorithm, deterministicCbor(content)) };
}
