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

import { md5, sha1 }                from '@noble/hashes/legacy.js';
import { sha224, sha256, sha384, sha512, sha512_224, sha512_256 } from '@noble/hashes/sha2.js';
import { sha3_224, sha3_256, sha3_384, sha3_512 } from '@noble/hashes/sha3.js';

import { bigintOf, bitLength, gcd, modPow } from './ecc.ts';


// RSA public keys as BouncyCastle 2.7.0 checks them (RsaKeyParameters), and signatures of PKCS #1 v1.5 (RsaDigestSigner)
// and of PSS (PssSigner) as it verifies them; with the digests a certificate may name.


/** A digest by the object identifier of its algorithm. */
export interface Digest {
    readonly oid:    string;
    readonly size:   number;
    readonly digest: (data: Uint8Array) => Uint8Array;
}

const digest = (oid: string, size: number, of: (data: Uint8Array) => Uint8Array): Digest =>
    ({ oid, size, digest: of });

export const DIGESTS = {
    md5:        digest('1.2.840.113549.2.5',         16, md5),
    sha1:       digest('1.3.14.3.2.26',              20, sha1),
    sha224:     digest('2.16.840.1.101.3.4.2.4',     28, sha224),
    sha256:     digest('2.16.840.1.101.3.4.2.1',     32, sha256),
    sha384:     digest('2.16.840.1.101.3.4.2.2',     48, sha384),
    sha512:     digest('2.16.840.1.101.3.4.2.3',     64, sha512),
    sha512_224: digest('2.16.840.1.101.3.4.2.5',     28, sha512_224),
    sha512_256: digest('2.16.840.1.101.3.4.2.6',     32, sha512_256),
    sha3_224:   digest('2.16.840.1.101.3.4.2.7',     28, sha3_224),
    sha3_256:   digest('2.16.840.1.101.3.4.2.8',     32, sha3_256),
    sha3_384:   digest('2.16.840.1.101.3.4.2.9',     48, sha3_384),
    sha3_512:   digest('2.16.840.1.101.3.4.2.10',    64, sha3_512),
} as const;

export const digestByOid = (oid: string): Digest | undefined =>
    Object.values(DIGESTS).find(candidate => candidate.oid === oid);


// ---------------------------------------------------------------------------------------------------------------------------
// Keys

/** The odd primes from 3 to 743, multiplied: a modulus sharing one of them is refused. */
const SMALL_PRIMES_PRODUCT = ((): bigint => {
    let product = 1n;
    for (let candidate = 3; candidate <= 743; candidate += 2) {
        let prime = true;
        for (let divisor = 3; divisor * divisor <= candidate; divisor += 2)
            if (candidate % divisor === 0)
                prime = false;
        if (prime)
            product *= BigInt(candidate);
    }
    return product;
})();

/** The largest modulus BouncyCastle takes, `Org.BouncyCastle.Rsa.MaxSize`. */
const MAX_BITS = 16384;

/** A random integer from 2 to the given bound, of the platform's random numbers. */
function randomBelow(bound: bigint): bigint {
    const bytes = new Uint8Array(Math.ceil(bitLength(bound) / 8) + 8);
    globalThis.crypto.getRandomValues(bytes);
    return 2n + bigintOf(bytes) % (bound - 3n);
}

/** Whether an odd integer above 3 is probably prime, by rounds of Miller and Rabin with random bases. */
export function isProbablePrime(candidate: bigint, rounds = 20): boolean {

    let d = candidate - 1n;
    let s = 0;
    while ((d & 1n) === 0n) {
        d >>= 1n;
        s++;
    }

    witnesses: for (let round = 0; round < rounds; round++) {
        let x = modPow(randomBelow(candidate - 1n), d, candidate);
        if (x === 1n || x === candidate - 1n)
            continue;
        for (let i = 1; i < s; i++) {
            x = x * x % candidate;
            if (x === candidate - 1n)
                continue witnesses;
        }
        return false;
    }

    return true;

}

/** The error, when RsaKeyParameters of BouncyCastle refuses a public key, in its words and order; undefined for none. */
export function rsaKeyError(modulus: bigint, exponent: bigint): string | undefined {

    if (modulus <= 0n)
        return "Not a valid RSA modulus (Parameter 'modulus')";

    if (exponent <= 0n)
        return "Not a valid RSA exponent (Parameter 'exponent')";

    if ((exponent & 1n) === 0n)
        return "RSA publicExponent is even (Parameter 'exponent')";

    if ((modulus & 1n) === 0n)
        return "RSA modulus is even (Parameter 'modulus')";

    if (gcd(modulus, SMALL_PRIMES_PRODUCT) !== 1n)
        return "RSA modulus has a small prime factor (Parameter 'modulus')";

    if (bitLength(modulus) > MAX_BITS)
        return "RSA modulus out of range (Parameter 'modulus')";

    if (modulus < 2n)
        return "must be non-null and >= 2 (Parameter 'candidate')";

    // As many rounds as BouncyCastle takes for the primes of a modulus of its width (`GetMRIterations`).
    const half   = Math.floor(bitLength(modulus) / 2);
    const rounds = half >= 1536 ? 3 : half >= 1024 ? 4 : half >= 512 ? 7 : 50;

    return isProbablePrime(modulus, rounds) ? "RSA modulus is not composite (Parameter 'modulus')" : undefined;

}


// ---------------------------------------------------------------------------------------------------------------------------
// Signatures

const bytesOf = (value: bigint, length: number): Uint8Array => {
    const bytes = new Uint8Array(length);
    for (let i = length - 1; i >= 0; i--) {
        bytes[i] = Number(value & 0xffn);
        value >>= 8n;
    }
    return bytes;
};

const equal = (left: Uint8Array, right: Uint8Array): boolean =>
    left.length === right.length && left.every((octet, index) => octet === right[index]);

/** The message a signature is the RSA of, `s^e mod n`, as wide as the modulus; undefined, where the signature is not below it. */
function opened(modulus: bigint, exponent: bigint, signature: Uint8Array): Uint8Array | undefined {
    const width = Math.ceil(bitLength(modulus) / 8);
    const s     = bigintOf(signature);
    return signature.length > width || s >= modulus ? undefined : bytesOf(modPow(s, exponent, modulus), width);
}

/** The DER of a DigestInfo of the given digest, with NULL parameters or without. */
function digestInfo(algorithm: Digest, hash: Uint8Array, withNull: boolean): Uint8Array {
    const arcs = algorithm.oid.split('.').map(Number);
    const oid: number[] = [ (arcs[0] ?? 0) * 40 + (arcs[1] ?? 0) ];
    for (const arc of arcs.slice(2)) {
        const parts = [ arc & 0x7f ];
        for (let rest = arc >> 7; rest > 0; rest >>= 7)
            parts.unshift((rest & 0x7f) | 0x80);
        oid.push(...parts);
    }
    const identifier = [ 0x06, oid.length, ...oid, ...(withNull ? [ 0x05, 0x00 ] : []) ];
    const algorithmId = [ 0x30, identifier.length, ...identifier ];
    const octets = [ 0x04, hash.length, ...hash ];
    return new Uint8Array([ 0x30, algorithmId.length + octets.length, ...algorithmId, ...octets ]);
}

/** Whether the signature of PKCS #1 v1.5 is of the message, its DigestInfo with NULL parameters or without (`RsaDigestSigner`). */
export function verifyPKCS1(modulus: bigint, exponent: bigint, algorithm: Digest, message: Uint8Array, signature: Uint8Array): boolean {

    const block = opened(modulus, exponent, signature);

    if (block?.[0] !== 0x00 || block[1] !== 0x01)
        return false;

    let at = 2;
    while (block[at] === 0xff)
        at++;

    if (at < 10 || block[at] !== 0x00)
        return false;

    const encoded = block.subarray(at + 1);
    const hash    = algorithm.digest(message);

    return equal(encoded, digestInfo(algorithm, hash, true)) || equal(encoded, digestInfo(algorithm, hash, false));

}

/** MGF1 of the given digest. */
function mgf1(algorithm: Digest, seed: Uint8Array, length: number): Uint8Array {
    const mask = new Uint8Array(length);
    for (let counter = 0, at = 0; at < length; counter++) {
        const block = algorithm.digest(new Uint8Array([ ...seed, ...bytesOf(BigInt(counter), 4) ]));
        mask.set(block.subarray(0, Math.min(block.length, length - at)), at);
        at += block.length;
    }
    return mask;
}

/** Whether the signature of PSS is of the message, with its digest, the digest of its mask and its salt length (`PssSigner`). */
export function verifyPSS(modulus: bigint, exponent: bigint, algorithm: Digest, maskDigest: Digest, saltLength: number, message: Uint8Array, signature: Uint8Array): boolean {

    const emBits = bitLength(modulus) - 1;
    const emLen  = Math.ceil(emBits / 8);
    const block  = opened(modulus, exponent, signature);
    const hLen   = algorithm.size;

    if (block === undefined || emLen < hLen + saltLength + 2)
        return false;

    const em = block.subarray(block.length - emLen);

    if (block.length > emLen && block[0] !== 0)
        return false;

    if (em.at(-1) !== 0xbc)
        return false;

    const maskedDB = em.subarray(0, emLen - hLen - 1);
    const h        = em.subarray(emLen - hLen - 1, emLen - 1);
    const unused   = 8 * emLen - emBits;

    if (((maskedDB[0] ?? 0) >> (8 - unused)) !== 0 && unused > 0)
        return false;

    const db = mgf1(maskDigest, h, maskedDB.length).map((octet, index) => octet ^ (maskedDB[index] ?? 0));

    db[0] = (db[0] ?? 0) & (0xff >> unused);

    const padding = emLen - hLen - saltLength - 2;

    if (db.subarray(0, padding).some(octet => octet !== 0) || db[padding] !== 0x01)
        return false;

    const salt = db.subarray(db.length - saltLength);

    return equal(h, algorithm.digest(new Uint8Array([ 0, 0, 0, 0, 0, 0, 0, 0, ...algorithm.digest(message), ...salt ])));

}
