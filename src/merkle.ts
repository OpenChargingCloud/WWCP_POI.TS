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

import { concat, fromHex, isLowerHex, toHex } from './encoding/text.ts';
import { DIGEST_LENGTH, hash, type HashAlgorithm } from './crypto/hash.ts';
import { get, isArray, isObject, type JSONObject, type JSONValue } from './json/value.ts';
import { POIError } from './errors.ts';


// The Merkle tree hash of RFC 9162, section 2.1, which the effective tree (SPECIFICATION.md section 8.2), the commits of a
// checkpoint (10.1) and its price statements (12.3) are calculated with.


/** The hash of a leaf, `H(0x00 || data)`. */
export const leafHash = (algorithm: HashAlgorithm, data: Uint8Array): Uint8Array =>
    hash(algorithm, concat(Uint8Array.of(0x00), data));

/** The hash of an inner node, `H(0x01 || left || right)`. */
export const nodeHash = (algorithm: HashAlgorithm, left: Uint8Array, right: Uint8Array): Uint8Array =>
    hash(algorithm, concat(Uint8Array.of(0x01), left, right));

/** The largest power of two smaller than `n`, for `n > 1`. */
function split(n: number): number {
    let k = 1;
    while (k * 2 < n)
        k *= 2;
    return k;
}

/** `MTH(D[n])` of the leaves given by their leaf hashes: `H("")` of none. */
export function merkleRootOfLeafHashes(algorithm: HashAlgorithm, leafHashes: readonly Uint8Array[]): Uint8Array {

    if (leafHashes.length === 0)
        return hash(algorithm, new Uint8Array(0));

    if (leafHashes.length === 1)
        return leafHashes[0]!;

    const k = split(leafHashes.length);

    return nodeHash(algorithm,
                    merkleRootOfLeafHashes(algorithm, leafHashes.slice(0, k)),
                    merkleRootOfLeafHashes(algorithm, leafHashes.slice(k)));

}

/** `MTH(D[n])` of the given leaves. */
export const merkleRoot = (algorithm: HashAlgorithm, leaves: readonly Uint8Array[]): Uint8Array =>
    merkleRootOfLeafHashes(algorithm, leaves.map(leaf => leafHash(algorithm, leaf)));


/** The audit path of the leaf at `index` (RFC 9162, section 2.1.3.1), given the leaf hashes of all leaves. */
export function auditPath(algorithm: HashAlgorithm, leafHashes: readonly Uint8Array[], index: number): Uint8Array[] {

    if (index < 0 || index >= leafHashes.length)
        throw new POIError(`The index ${index} is not below the size ${leafHashes.length} of the tree!`);

    if (leafHashes.length === 1)
        return [];

    const k = split(leafHashes.length);

    return index < k
               ? [ ...auditPath(algorithm, leafHashes.slice(0, k), index),     merkleRootOfLeafHashes(algorithm, leafHashes.slice(k)) ]
               : [ ...auditPath(algorithm, leafHashes.slice(k),    index - k), merkleRootOfLeafHashes(algorithm, leafHashes.slice(0, k)) ];

}


/**
 * The root an inclusion proof leads to (RFC 9162, section 2.1.3.2): from the hash of a leaf, its index, the size of the
 * tree and its audit path. Throws unless the proof is well formed: the index below the size, the path neither too short
 * nor too long.
 */
export function rootFromAuditPath(algorithm: HashAlgorithm,
                                  leaf:      Uint8Array,
                                  index:     number,
                                  size:      number,
                                  path:      readonly Uint8Array[]): Uint8Array {

    if (!Number.isSafeInteger(index) || !Number.isSafeInteger(size) || index < 0 || index >= size)
        throw new POIError(`The index ${index} of a proof must be below its size ${size}!`);

    let fn = BigInt(index);
    let sn = BigInt(size - 1);
    let r  = leaf;

    for (const p of path) {

        if (p.length !== DIGEST_LENGTH[algorithm])
            throw new POIError(`A hash of an audit path has ${DIGEST_LENGTH[algorithm]} bytes, not ${p.length}!`);

        if (sn === 0n)
            throw new POIError('The audit path is longer than the tree is deep!');

        if ((fn & 1n) === 1n || fn === sn) {

            r = nodeHash(algorithm, p, r);

            if ((fn & 1n) === 0n)
                while ((fn & 1n) === 0n && fn !== 0n) {
                    fn >>= 1n;
                    sn >>= 1n;
                }

        }
        else
            r = nodeHash(algorithm, r, p);

        fn >>= 1n;
        sn >>= 1n;

    }

    if (sn !== 0n)
        throw new POIError('The audit path is shorter than the tree is deep!');

    return r;

}


/** A tree as POI writes it, `{"@merkleRoot": "<hex>", "@size": n}`. */
export interface MerkleTreeHead {
    readonly root:  Uint8Array;
    readonly size:  number;
}

/** Reads `{"@merkleRoot", "@size"}` and nothing else; `@size` 0 only with the root `H("")` (8.4). */
export function parseMerkleTreeHead(value: JSONValue | undefined, algorithm: HashAlgorithm, what: string): MerkleTreeHead {

    if (!isObject(value) || Object.keys(value).length !== 2)
        throw new POIError(`${what} must be exactly {"@merkleRoot", "@size"}!`);

    const root = get(value, '@merkleRoot');
    const size = get(value, '@size');

    if (!isLowerHex(root, DIGEST_LENGTH[algorithm]))
        throw new POIError(`The @merkleRoot of ${what.toLowerCase()} must be ${2 * DIGEST_LENGTH[algorithm]} lowercase hexadecimal digits!`);

    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0)
        throw new POIError(`The @size of ${what.toLowerCase()} must be a whole number!`);

    const rootBytes = fromHex(root, true);

    if (size === 0 && toHex(rootBytes) !== toHex(hash(algorithm, new Uint8Array(0))))
        throw new POIError(`An empty tree of ${what.toLowerCase()} has the root H(""), not ${root}!`);

    return { root: rootBytes, size };

}

export const merkleTreeHeadToJSON = (head: MerkleTreeHead): JSONObject =>
    ({ '@merkleRoot': toHex(head.root), '@size': head.size });


/** Reads an audit path, an array of lowercase hexadecimal digests. */
export function parseAuditPath(value: JSONValue | undefined, algorithm: HashAlgorithm, what: string): Uint8Array[] {

    if (!isArray(value))
        throw new POIError(`The @auditPath of ${what} must be a JSON array!`);

    return value.map(item => {
        if (!isLowerHex(item, DIGEST_LENGTH[algorithm]))
            throw new POIError(`A hash of the @auditPath of ${what} must be ${2 * DIGEST_LENGTH[algorithm]} lowercase hexadecimal digits!`);
        return fromHex(item, true);
    });

}
