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

import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';

import { POIError } from '../errors.ts';


/** The hash algorithms of ETags, trees and identifications (SPECIFICATION.md sections 3.1, 8.3 and 11.1). */
export type HashAlgorithm = 'sha256' | 'sha384' | 'sha512';

export const HASH_ALGORITHMS: readonly HashAlgorithm[] = [ 'sha256', 'sha384', 'sha512' ];

/** The length of a digest, in bytes. */
export const DIGEST_LENGTH: Readonly<Record<HashAlgorithm, number>> = {
    sha256: 32,
    sha384: 48,
    sha512: 64,
};

export const isHashAlgorithm = (value: unknown): value is HashAlgorithm =>
    value === 'sha256' || value === 'sha384' || value === 'sha512';


/** The digest of the given bytes. */
export function hash(algorithm: HashAlgorithm, data: Uint8Array): Uint8Array {

    switch (algorithm) {
        case 'sha256': return sha256(data);
        case 'sha384': return sha384(data);
        case 'sha512': return sha512(data);
        default:       throw new POIError(`Unknown hash algorithm '${String(algorithm)}'!`);
    }

}

/** The hash algorithm of an identification, told by its length: 64, 96 or 128 hexadecimal digits (11.1). */
export function hashAlgorithmOfIdentification(id: string): HashAlgorithm {

    switch (id.length) {
        case  64: return 'sha256';
        case  96: return 'sha384';
        case 128: return 'sha512';
        default:  throw new POIError(`The identification '${id}' is no digest of 64, 96 or 128 hexadecimal digits!`);
    }

}
