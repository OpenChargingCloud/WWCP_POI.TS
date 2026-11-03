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

import { illegal, integerOf, isBitString, isNull, isSequence, octetsOf, oidOf, readBER, sequenceOf, type BER } from './ber.ts';
import { BINARY_CURVES, PRIME_CURVES, type PrimeCurve } from './curves.ts';
import { bigintOf, decodePoint, mod, modInverse, modPow, PointError, type Point } from './ecc.ts';
import { rsaKeyError }            from './rsa.ts';


// A SubjectPublicKeyInfo as BouncyCastle 2.7.0 reads it (SubjectPublicKeyInfo.GetInstance) and makes a key of it
// (PublicKeyFactory.CreateKey), refused in its words: RSA, also of PSS and OAEP, with the checks of its modulus and
// exponent; EC of the 84 named curves it knows, the point decoded and validated, on a curve over a binary field its length
// only; Ed25519 and Ed448, a point it decodes and not of a small order; X25519 and X448, ML-DSA, ML-KEM and SLH-DSA of
// their lengths; DSA in its group. Taken as given, as BouncyCastle reads them with checks this library does not port:
// explicit curve parameters, Diffie-Hellman, ElGamal, GOST and DSTU keys.


export type PublicKey =
    | { readonly kind: 'ec',     readonly curve: PrimeCurve, readonly q: Point }
    | { readonly kind: 'rsa',    readonly n: bigint, readonly e: bigint }
    | { readonly kind: 'dsa',    readonly y: bigint, readonly group: { readonly p: bigint, readonly q: bigint, readonly g: bigint } | undefined }
    | { readonly kind: 'eddsa',  readonly curve: 'Ed25519' | 'Ed448', readonly bytes: Uint8Array }
    | { readonly kind: 'ml-dsa', readonly set: 'ML-DSA-44' | 'ML-DSA-65' | 'ML-DSA-87', readonly bytes: Uint8Array }
    | { readonly kind: 'other',  readonly oid: string };

/** What BouncyCastle refuses of a key it makes, in its words. */
export class KeyError extends Error {}

/** A SubjectPublicKeyInfo as `SubjectPublicKeyInfo.GetInstance` reads it. */
export interface SubjectPublicKeyInfo {
    readonly record:      BER;
    readonly algorithm:   string;
    readonly parameters:  BER | undefined;
    readonly key:         BER;
}

/** The SubjectPublicKeyInfo of the given record: a sequence of an algorithm identifier and a bit string. */
export function subjectPublicKeyInfoOf(record: BER): SubjectPublicKeyInfo {

    const [ algorithm, key ] = sequenceOf(record, [ 2 ]);
    const [ oid, parameters ] = sequenceOf(algorithm ?? record, [ 1, 2 ]);

    if (key === undefined || !isBitString(key))
        throw illegal(key ?? record);

    return { record, algorithm: oidOf(oid ?? record), parameters, key };

}

/** The SubjectPublicKeyInfo of the given bytes, as `Asn1Object.FromByteArray` reads them: one record of BER, nothing after it. */
export const subjectPublicKeyInfo = (bytes: Uint8Array): SubjectPublicKeyInfo =>
    subjectPublicKeyInfoOf(readBER(bytes));


// ---------------------------------------------------------------------------------------------------------------------------
// Edwards curves (Ed25519PublicKeyParameters, Ed448PublicKeyParameters)

const P25519 = 2n ** 255n - 19n;
const D25519 = mod(-121665n * (modInverse(121666n, P25519) ?? 0n), P25519);
const P448   = 2n ** 448n - 2n ** 224n - 1n;
const D448   = mod(-39081n, P448);

/** The y of the points of order 8 of edwards25519 other than 0, 1 and p - 1. */
const ORDER8_Y = 0x7a03ac9277fdc74ec6cc392cfa53202a0f67100d760b3cba4fd84d3d706a17c7n;

const littleEndian = (bytes: Uint8Array): bigint =>
    bigintOf(Uint8Array.from(bytes).reverse());

/** Whether a public key of Ed25519 or Ed448 is a point BouncyCastle decodes, not one of a small order. */
function edwardsValid(curve: 'Ed25519' | 'Ed448', bytes: Uint8Array): boolean {

    const ed25519 = curve === 'Ed25519';
    const p       = ed25519 ? P25519 : P448;
    const top     = bytes[bytes.length - 1] ?? 0;

    if (!ed25519 && (top & 0x7f) !== 0)
        return false;

    const raw = Uint8Array.from(bytes);
    raw[raw.length - 1] = top & 0x7f;

    const y = littleEndian(raw);

    if (y >= p)
        return false;

    const small = ed25519 ? [ 0n, 1n, p - 1n, ORDER8_Y, p - ORDER8_Y ] : [ 0n, 1n, p - 1n ];

    if (small.includes(y))
        return false;

    const u = mod(y * y - 1n, p);
    const v = ed25519 ? mod(D25519 * y * y + 1n, p) : mod(D448 * y * y - 1n, p);
    const x2 = u * (modInverse(v, p) ?? 0n) % p;

    return x2 === 0n ? (top & 0x80) === 0 : modPow(x2, (p - 1n) / 2n, p) === 1n;

}


// ---------------------------------------------------------------------------------------------------------------------------
// Keys (PublicKeyFactory.CreateKey)

const RSA_OIDS = new Set([ '1.2.840.113549.1.1.1', '1.2.840.113549.1.1.10', '1.2.840.113549.1.1.7', '2.5.8.1.1' ]);

/** What BouncyCastle reads with checks this library does not port: Diffie-Hellman, ElGamal, GOST, DSTU. */
const UNCHECKED_OIDS = new Set([ '1.2.840.113549.1.3.1', '1.2.840.10046.2.1', '1.3.14.7.2.1.1', '1.2.643.2.2.19', '1.2.643.2.2.20',
                                 '1.2.643.7.1.1.1.1', '1.2.643.7.1.1.1.2', '1.2.804.2.1.1.1.1.3.1.1', '1.2.804.2.1.1.1.1.3.1.1.1' ]);

/** Keys of a length each, with BouncyCastle's name of their algorithm. */
const OF_LENGTH = new Map<string, readonly [ string, number ]>([
    [ '1.3.101.110', [ 'X25519', 32 ] ],
    [ '1.3.101.111', [ 'X448', 56 ] ],
    [ '2.16.840.1.101.3.4.3.17', [ 'ML-DSA-44', 1312 ] ],
    [ '2.16.840.1.101.3.4.3.18', [ 'ML-DSA-65', 1952 ] ],
    [ '2.16.840.1.101.3.4.3.19', [ 'ML-DSA-87', 2592 ] ],
    [ '2.16.840.1.101.3.4.3.32', [ 'ML-DSA-44-WITH-SHA512', 1312 ] ],
    [ '2.16.840.1.101.3.4.3.33', [ 'ML-DSA-65-WITH-SHA512', 1952 ] ],
    [ '2.16.840.1.101.3.4.3.34', [ 'ML-DSA-87-WITH-SHA512', 2592 ] ],
    [ '2.16.840.1.101.3.4.4.1', [ 'ML-KEM-512', 800 ] ],
    [ '2.16.840.1.101.3.4.4.2', [ 'ML-KEM-768', 1184 ] ],
    [ '2.16.840.1.101.3.4.4.3', [ 'ML-KEM-1024', 1568 ] ],
    ...[ 'SHA2-128S', 'SHA2-128F', 'SHA2-192S', 'SHA2-192F', 'SHA2-256S', 'SHA2-256F',
         'SHAKE-128S', 'SHAKE-128F', 'SHAKE-192S', 'SHAKE-192F', 'SHAKE-256S', 'SHAKE-256F' ].map((name, index) =>
        [ `2.16.840.1.101.3.4.3.${String(20 + index)}`, [ `SLH-DSA-${name}`, [ 32, 48, 64 ][Math.floor(index % 6 / 2)] ?? 0 ] ] as const),
    ...[ 'SHA2-128S-WITH-SHA256', 'SHA2-128F-WITH-SHA256', 'SHA2-192S-WITH-SHA512', 'SHA2-192F-WITH-SHA512', 'SHA2-256S-WITH-SHA512',
         'SHA2-256F-WITH-SHA512', 'SHAKE-128S-WITH-SHAKE128', 'SHAKE-128F-WITH-SHAKE128', 'SHAKE-192S-WITH-SHAKE256',
         'SHAKE-192F-WITH-SHAKE256', 'SHAKE-256S-WITH-SHAKE256', 'SHAKE-256F-WITH-SHAKE256' ].map((name, index) =>
        [ `2.16.840.1.101.3.4.3.${String(35 + index)}`, [ `SLH-DSA-${name}`, [ 32, 48, 64 ][Math.floor(index % 6 / 2)] ?? 0 ] ] as const),
]);

const ML_DSA = new Map<string, 'ML-DSA-44' | 'ML-DSA-65' | 'ML-DSA-87'>([ [ '2.16.840.1.101.3.4.3.17', 'ML-DSA-44' ], [ '2.16.840.1.101.3.4.3.18', 'ML-DSA-65' ], [ '2.16.840.1.101.3.4.3.19', 'ML-DSA-87' ] ]);

/** A key of a named curve, as `X9ECPoint` decodes its point and `ECPublicKeyParameters` validates it. */
function ecKey(info: SubjectPublicKeyInfo): PublicKey {

    const parameters = info.parameters;

    if (parameters === undefined)
        throw new KeyError('Object reference not set to an instance of an object.');

    if (isNull(parameters))
        throw new KeyError('implicitlyCA');

    if (isSequence(parameters))
        return { kind: 'other', oid: info.algorithm };

    const oid = oidOf(parameters);

    // `GetBytes` of the bit string: its unused bits as zero.
    const pad    = info.key.content[0] ?? 0;
    const octets = Uint8Array.from(info.key.content.subarray(1));
    if (octets.length > 0 && pad > 0 && pad < 8)
        octets[octets.length - 1] = (octets.at(-1) ?? 0) & (0xff << pad);

    const prime = PRIME_CURVES.get(oid);

    if (prime !== undefined) {

        let q: Point | undefined;

        try {
            q = decodePoint(prime, octets);
        }
        catch (e) {
            throw new KeyError(e instanceof PointError ? e.message : String(e));
        }

        if (q === undefined)
            throw new KeyError("Point at infinity (Parameter 'q')");

        return { kind: 'ec', curve: prime, q };

    }

    const binary = BINARY_CURVES.get(oid);

    if (binary === undefined)
        throw new KeyError("OID is not a valid public key parameter set (Parameter 'oid')");

    // Of a curve over a binary field, the length of its point and its coordinates below 2^m.
    const length = Math.ceil(binary.bits / 8);
    const type   = octets[0];
    const limit  = 1n << BigInt(binary.bits);
    const below  = (bytes: Uint8Array): void => {
        if (bigintOf(bytes) >= limit)
            throw new KeyError(`value invalid for ${binary.field} (Parameter 'x')`);
    };

    if (type === undefined)
        throw new KeyError('Index was outside the bounds of the array.');

    if (type === 0x00)
        throw new KeyError(octets.length === 1 ? "Point at infinity (Parameter 'q')" : "Incorrect length for infinity encoding (Parameter 'encoded')");

    if (type === 0x02 || type === 0x03) {
        if (octets.length !== length + 1)
            throw new KeyError("Incorrect length for compressed encoding (Parameter 'encoded')");
        below(octets.subarray(1));
    }
    else if (type === 0x04 || type === 0x06 || type === 0x07) {
        if (octets.length !== 2 * length + 1)
            throw new KeyError(`Incorrect length for ${type === 0x04 ? 'uncompressed' : 'hybrid'} encoding (Parameter 'encoded')`);
        below(octets.subarray(1, 1 + length));
        below(octets.subarray(1 + length));
    }
    else
        throw new KeyError(`Invalid point encoding ${String(type)}`);

    return { kind: 'other', oid: info.algorithm };

}

/** The record of the octets of the bit string of a key, as `ParsePublicKey` reads it. */
const parsedKey = (info: SubjectPublicKeyInfo): BER =>
    readBER(octetsOf(info.key));

/**
 * The key of the given SubjectPublicKeyInfo, as `PublicKeyFactory.CreateKey` of BouncyCastle makes it; what it refuses
 * thrown as a `KeyError` or a `BERError` in its words.
 */
export function publicKeyOf(info: SubjectPublicKeyInfo): PublicKey {

    const oid = info.algorithm;

    if (RSA_OIDS.has(oid)) {
        const [ modulus, exponent ] = sequenceOf(parsedKey(info), [ 2 ]).map(integerOf);
        const error = rsaKeyError(modulus ?? 0n, exponent ?? 0n);
        if (error !== undefined)
            throw new KeyError(error);
        return { kind: 'rsa', n: modulus ?? 0n, e: exponent ?? 0n };
    }

    if (oid === '1.2.840.10045.2.1')
        return ecKey(info);

    if (oid === '1.3.101.112' || oid === '1.3.101.113') {
        const curve  = oid === '1.3.101.112' ? 'Ed25519' : 'Ed448';
        const bytes  = octetsOf(info.key);
        const length = curve === 'Ed25519' ? 32 : 57;
        if (bytes.length !== length)
            throw new KeyError(`must have length ${String(length)} (Parameter 'buf')`);
        if (!edwardsValid(curve, bytes))
            throw new KeyError('invalid public key');
        return { kind: 'eddsa', curve, bytes };
    }

    const ofLength = OF_LENGTH.get(oid);

    if (ofLength !== undefined) {
        const [ name, length ] = ofLength;
        const bytes = octetsOf(info.key);
        if (bytes.length !== length)
            throw new KeyError(name.startsWith('X') ? `must have length ${String(length)} (Parameter 'buf')` : `invalid ${name} public key`);
        const set = ML_DSA.get(oid);
        return set === undefined ? { kind: 'other', oid } : { kind: 'ml-dsa', set, bytes };
    }

    if (oid === '1.2.840.10040.4.1') {

        const y = integerOf(parsedKey(info));

        if (info.parameters === undefined)
            return { kind: 'dsa', y, group: undefined };

        const [ p = 0n, q = 0n, g = 0n ] = sequenceOf(info.parameters, [ 3 ]).map(integerOf);

        if (y < 2n || y > p - 2n || modPow(y, q, p) !== 1n)
            throw new KeyError('y value does not appear to be in correct group');

        return { kind: 'dsa', y, group: { p, q, g } };

    }

    if (UNCHECKED_OIDS.has(oid))
        return { kind: 'other', oid };

    throw new KeyError(`algorithm identifier in public key not recognised: ${oid}`);

}
