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

import { algorithmByName, verifyWith, KEY_TYPE_AKP, KEY_TYPE_EC2, KEY_TYPE_OKP, type CoseAlgorithm, type CoseKey } from '@vanaheimr/cose';

import { fromBase64 } from '../encoding/text.ts';
import { POIError }   from '../errors.ts';


/**
 * The signature algorithms POI accepts, by their COSE names as Styx writes them (SPECIFICATION.md section 4).
 * ECDSA signs the digest of the signature input, deterministically (RFC 6979), its value the concatenation `r ‖ s`;
 * EdDSA and ML-DSA sign the signature input itself, Ed448 with an empty context, ML-DSA in its pure variant.
 */
export const SIGNATURE_ALGORITHMS = [
    'Ed25519', 'Ed448', 'EdDSA',
    'ES256', 'ES384', 'ES512', 'ES256K',
    'ESP256', 'ESP384', 'ESP512',
    'ESB256', 'ESB320', 'ESB384', 'ESB512',
    'ML-DSA-44', 'ML-DSA-65', 'ML-DSA-87',
] as const;

export type SignatureAlgorithm = typeof SIGNATURE_ALGORITHMS[number];


/** The COSE algorithm of a name, refusing a name that is not canonical, e.g. `es256`. */
export function signatureAlgorithm(name: string): CoseAlgorithm {

    const algorithm = (SIGNATURE_ALGORITHMS as readonly string[]).includes(name)
                          ? algorithmByName(name)
                          : null;

    if (algorithm?.name !== name)
        throw new POIError(`Unknown or noncanonical signature algorithm '${name}'!`);

    return algorithm;

}


/** The public key bytes `verifyWith` takes: `04 ‖ x ‖ y` of an EC2 key, `x` of an OKP key, `pub` of an AKP key. */
function publicKeyBytes(key: CoseKey, algorithm: CoseAlgorithm): Uint8Array {

    switch (algorithm.family) {

        case 'ecdsa':
            if (key.keyType !== KEY_TYPE_EC2 || key.x === null || key.y === null)
                throw new POIError(`The algorithm '${algorithm.name}' needs an elliptic curve key with x and y!`);
            return Uint8Array.of(0x04, ...key.x, ...key.y);

        case 'eddsa':
            if (key.keyType !== KEY_TYPE_OKP || key.x === null)
                throw new POIError(`The algorithm '${algorithm.name}' needs an octet key pair!`);
            return key.x;

        case 'mldsa':
            if (key.keyType !== KEY_TYPE_AKP || key.pub === null)
                throw new POIError(`The algorithm '${algorithm.name}' needs an algorithm key pair!`);
            if (key.algorithm?.name !== algorithm.name)
                throw new POIError(`The algorithm '${algorithm.name}' differs from the one of its key, '${key.algorithm?.name ?? 'none'}'!`);
            return key.pub;

        default:
            throw new POIError(`'${algorithm.name}' is no signature algorithm!`);

    }

}


/**
 * Verifies a signature of POI: over the given signature input, by the given public key, with the named algorithm, its
 * value in canonical standard Base64. Throws a POIError unless it is valid.
 */
export function verifySignature(algorithmName: string,
                                publicKey:     CoseKey,
                                input:         Uint8Array,
                                value:         string): void {

    const algorithm = signatureAlgorithm(algorithmName);

    if (publicKey.isPrivate)
        throw new POIError('Verification requires a public key!');

    if (publicKey.algorithm !== null && publicKey.algorithm.name !== algorithm.name)
        throw new POIError(`The signature algorithm '${algorithm.name}' differs from the algorithm '${publicKey.algorithm.name}' of the key!`);

    let signature: Uint8Array;

    try {
        signature = fromBase64(value);
    }
    catch {
        throw new POIError('The signature value must be nonempty canonical standard Base64!');
    }

    if (signature.length === 0)
        throw new POIError('The signature value must be nonempty canonical standard Base64!');

    const keyBytes = publicKeyBytes(publicKey, algorithm);
    let   valid:     boolean;

    try {
        valid = verifyWith(algorithm, publicKey.curve, input, signature, keyBytes);
    }
    catch (e) {
        throw new POIError(`The signature is invalid: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (!valid)
        throw new POIError('The signature is invalid!');

}
