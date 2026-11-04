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

import { toHex }           from '../encoding/text.ts';
import type { PrimeCurve } from './curves.ts';


// Arithmetic of integers and of points of a prime curve, as far as checking a public key and a signature needs it: a point
// as BouncyCastle decodes it (ECCurve.DecodePoint) and validates it (ECPoint.IsValid), a signature as ECDsaSigner and
// DsaSigner verify it. Of public data only, so in variable time.


export const mod = (value: bigint, modulus: bigint): bigint => {
    const rest = value % modulus;
    return rest < 0n ? rest + modulus : rest;
};

export function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
    let result = 1n;
    base = mod(base, modulus);
    while (exponent > 0n) {
        if ((exponent & 1n) === 1n)
            result = result * base % modulus;
        base = base * base % modulus;
        exponent >>= 1n;
    }
    return modulus === 1n ? 0n : result;
}

/** The inverse modulo the given modulus; undefined, where there is none. */
export function modInverse(value: bigint, modulus: bigint): bigint | undefined {
    let [ a, b, x, y ] = [ mod(value, modulus), modulus, 1n, 0n ];
    while (b !== 0n) {
        const q = a / b;
        [ a, b ] = [ b, a - q * b ];
        [ x, y ] = [ y, x - q * y ];
    }
    return a === 1n ? mod(x, modulus) : undefined;
}

export function gcd(a: bigint, b: bigint): bigint {
    a = a < 0n ? -a : a;
    b = b < 0n ? -b : b;
    while (b !== 0n)
        [ a, b ] = [ b, a % b ];
    return a;
}

export const bitLength = (value: bigint): number =>
    value <= 0n ? 0 : value.toString(2).length;

export const bigintOf = (bytes: Uint8Array): bigint =>
    bytes.length === 0 ? 0n : BigInt(`0x${toHex(bytes)}`);

/** The square root modulo an odd prime (Tonelli and Shanks); undefined, where there is none. */
export function sqrtMod(value: bigint, p: bigint): bigint | undefined {

    value = mod(value, p);

    if (value === 0n)
        return 0n;

    if (modPow(value, (p - 1n) / 2n, p) !== 1n)
        return undefined;

    if (p % 4n === 3n)
        return modPow(value, (p + 1n) / 4n, p);

    let q = p - 1n;
    let s = 0n;
    while ((q & 1n) === 0n) {
        q >>= 1n;
        s++;
    }

    let z = 2n;
    while (modPow(z, (p - 1n) / 2n, p) !== p - 1n)
        z++;

    let [ m, c, t, r ] = [ s, modPow(z, q, p), modPow(value, q, p), modPow(value, (q + 1n) / 2n, p) ];

    while (t !== 1n) {
        let i = 0n;
        let t2 = t;
        while (t2 !== 1n) {
            t2 = t2 * t2 % p;
            i++;
        }
        const b = modPow(c, 1n << (m - i - 1n), p);
        [ m, c, t, r ] = [ i, b * b % p, t * b * b % p, r * b % p ];
    }

    return r;

}


// ---------------------------------------------------------------------------------------------------------------------------
// Points

/** A point of a curve; undefined is the point at infinity. */
export interface Point {
    readonly x: bigint;
    readonly y: bigint;
}

/** Jacobian coordinates: x = X/Z², y = Y/Z³; Z = 0 is the point at infinity. */
type Jacobian = readonly [ bigint, bigint, bigint ];

const INFINITY: Jacobian = [ 1n, 1n, 0n ];

function double(curve: PrimeCurve, [ x, y, z ]: Jacobian): Jacobian {
    const p = curve.p;
    if (z === 0n || y === 0n)
        return INFINITY;
    const yy = y * y % p;
    const s  = 4n * x * yy % p;
    const zz = z * z % p;
    const m  = mod(3n * x * x + curve.a * zz * zz, p);
    const x3 = mod(m * m - 2n * s, p);
    const y3 = mod(m * (s - x3) - 8n * yy * yy, p);
    const z3 = 2n * y * z % p;
    return [ x3, y3, z3 ];
}

function add(curve: PrimeCurve, left: Jacobian, right: Jacobian): Jacobian {
    const p = curve.p;
    const [ x1, y1, z1 ] = left;
    const [ x2, y2, z2 ] = right;
    if (z1 === 0n)
        return right;
    if (z2 === 0n)
        return left;
    const z1z1 = z1 * z1 % p;
    const z2z2 = z2 * z2 % p;
    const u1 = x1 * z2z2 % p;
    const u2 = x2 * z1z1 % p;
    const s1 = y1 * z2 % p * z2z2 % p;
    const s2 = y2 * z1 % p * z1z1 % p;
    if (u1 === u2)
        return s1 === s2 ? double(curve, left) : INFINITY;
    const h  = mod(u2 - u1, p);
    const r  = mod(s2 - s1, p);
    const hh = h * h % p;
    const hhh = h * hh % p;
    const v  = u1 * hh % p;
    const x3 = mod(r * r - hhh - 2n * v, p);
    const y3 = mod(r * (v - x3) - s1 * hhh, p);
    const z3 = z1 * z2 % p * h % p;
    return [ x3, y3, z3 ];
}

function affine(curve: PrimeCurve, [ x, y, z ]: Jacobian): Point | undefined {
    if (z === 0n)
        return undefined;
    const inverse = modInverse(z, curve.p) ?? 0n;
    const zz = inverse * inverse % curve.p;
    return { x: x * zz % curve.p, y: y * zz % curve.p * inverse % curve.p };
}

const jacobian = (point: Point): Jacobian =>
    [ point.x, point.y, 1n ];

/** The sum of k1·P1 and k2·P2. */
function sumOfTwoMultiplies(curve: PrimeCurve, p1: Point, k1: bigint, p2: Point, k2: bigint): Point | undefined {
    const both = add(curve, jacobian(p1), jacobian(p2));
    let result = INFINITY;
    for (let bit = BigInt(Math.max(bitLength(k1), bitLength(k2)) - 1); bit >= 0n; bit--) {
        result = double(curve, result);
        const b1 = (k1 >> bit) & 1n;
        const b2 = (k2 >> bit) & 1n;
        if (b1 === 1n && b2 === 1n)
            result = add(curve, result, both);
        else if (b1 === 1n)
            result = add(curve, result, jacobian(p1));
        else if (b2 === 1n)
            result = add(curve, result, jacobian(p2));
    }
    return affine(curve, result);
}

/** k·P. */
export const multiply = (curve: PrimeCurve, point: Point, k: bigint): Point | undefined =>
    sumOfTwoMultiplies(curve, point, k, point, 0n);

export const onCurve = (curve: PrimeCurve, { x, y }: Point): boolean =>
    mod(y * y - (x * x * x + curve.a * x + curve.b), curve.p) === 0n;

/** Whether a point is of the order of the curve, of a curve of a cofactor 1 always (`SatisfiesOrder`). */
export const satisfiesOrder = (curve: PrimeCurve, point: Point): boolean =>
    curve.h === 1n || multiply(curve, point, curve.n) === undefined;

export class PointError extends Error {}

/**
 * A point of a prime curve as `ECCurve.DecodePoint` of BouncyCastle decodes it, compressed (02, 03), uncompressed (04) or
 * hybrid (06, 07), and refuses it in its words; undefined for the point at infinity (00).
 */
export function decodePoint(curve: PrimeCurve, encoded: Uint8Array): Point | undefined {

    const length = Math.ceil(curve.bits / 8);
    const type   = encoded[0];

    if (type === undefined)
        throw new PointError('Index was outside the bounds of the array.');

    const element = (value: bigint): bigint => {
        if (value >= curve.p)
            throw new PointError(`value invalid for ${curve.field} (Parameter 'x')`);
        return value;
    };

    const valid = (point: Point, message: string): Point => {
        if (!onCurve(curve, point) || !satisfiesOrder(curve, point))
            throw new PointError(message);
        return point;
    };

    switch (type) {

        case 0x00:
            if (encoded.length !== 1)
                throw new PointError("Incorrect length for infinity encoding (Parameter 'encoded')");
            return undefined;

        case 0x02:
        case 0x03: {
            if (encoded.length !== length + 1)
                throw new PointError("Incorrect length for compressed encoding (Parameter 'encoded')");
            const x = element(bigintOf(encoded.subarray(1)));
            const root = sqrtMod(x * x * x + curve.a * x + curve.b, curve.p);
            if (root === undefined)
                throw new PointError('Invalid point compression');
            const y = (root & 1n) === BigInt(type & 1) ? root : mod(-root, curve.p);
            const point = { x, y };
            if (!satisfiesOrder(curve, point))
                throw new PointError('Invalid point');
            return point;
        }

        case 0x04:
        case 0x06:
        case 0x07: {
            if (encoded.length !== 2 * length + 1)
                throw new PointError(`Incorrect length for ${type === 0x04 ? 'uncompressed' : 'hybrid'} encoding (Parameter 'encoded')`);
            const x = bigintOf(encoded.subarray(1, 1 + length));
            const y = bigintOf(encoded.subarray(1 + length));
            if (type !== 0x04 && (y & 1n) !== BigInt(type & 1))
                throw new PointError("Inconsistent Y coordinate in hybrid encoding (Parameter 'encoded')");
            return valid({ x: element(x), y: element(y) }, 'Invalid point coordinates');
        }

        default:
            throw new PointError(`Invalid point encoding ${String(type)}`);

    }

}

/** The leftmost bits of a digest as wide as the order, as `CalculateE` of ECDsaSigner and DsaSigner takes them. */
export function truncatedDigest(order: bigint, digest: Uint8Array): bigint {
    const value = bigintOf(digest);
    const bits  = digest.length * 8;
    const width = bitLength(order);
    return width < bits ? value >> BigInt(bits - width) : value;
}

/** Whether (r, s) is a signature of the digest by the key Q of the curve (`ECDsaSigner.VerifySignature`). */
export function verifyECDSA(curve: PrimeCurve, q: Point, digest: Uint8Array, r: bigint, s: bigint): boolean {

    const n = curve.n;

    if (r < 1n || s < 1n || r >= n || s >= n)
        return false;

    const c  = modInverse(s, n);

    if (c === undefined)
        return false;

    const e  = truncatedDigest(n, digest);
    const point = sumOfTwoMultiplies(curve, { x: curve.gx, y: curve.gy }, mod(e * c, n), q, mod(r * c, n));

    return point !== undefined && mod(point.x, n) === r;

}

/** Whether (r, s) is a signature of the digest by the key y of the group (p, q, g) (`DsaSigner.VerifySignature`). */
export function verifyDSA(p: bigint, q: bigint, g: bigint, y: bigint, digest: Uint8Array, r: bigint, s: bigint): boolean {

    if (r <= 0n || r >= q || s <= 0n || s >= q)
        return false;

    const w = modInverse(s, q);

    if (w === undefined)
        return false;

    const m = truncatedDigest(q, digest);

    return mod(modPow(g, mod(m * w, q), p) * modPow(y, mod(r * w, q), p) % p, q) === r;

}
