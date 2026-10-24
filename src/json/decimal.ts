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

import { POIError } from '../errors.ts';


/** The most decimal places a System.Decimal holds, and so a number POI hashes. */
export const MAX_DECIMAL_SCALE = 28;

/** A System.Decimal holds a mantissa below 2^96. */
const MAX_DECIMAL_MANTISSA = (1n << 96n) - 1n;


/**
 * A number as POI hashes it: a mantissa and the number of its decimal places, `mantissa × 10^-scale`.
 *
 * Canonical JSON keeps the scale (`1.50` stays `1.50`, Styx section 2.4), deterministic CBOR writes a number
 * with decimal places as a decimal fraction `4([-scale, mantissa])` and one without as the integer it equals
 * (Styx section 3). An integer and a decimal without decimal places are therefore the same number here.
 *
 * Integers within the safe range of JavaScript are read as plain `number`s (see `JSONValue`), everything else
 * as a `Decimal`: never as a binary floating-point number, which can hold neither `0.1` nor a scale.
 */
export class Decimal {

    public readonly mantissa: bigint;
    public readonly scale:    number;

    constructor(mantissa: bigint, scale: number) {

        if (!Number.isInteger(scale) || scale < 0 || scale > MAX_DECIMAL_SCALE)
            throw new POIError(`A decimal has from 0 to ${MAX_DECIMAL_SCALE} decimal places, not ${scale}!`);

        this.mantissa  = mantissa;
        this.scale     = scale;

    }


    /** An integer of any size. */
    public static fromInteger(value: bigint | number): Decimal {

        if (typeof value === 'number' && !Number.isSafeInteger(value))
            throw new POIError(`${value} is no safe integer!`);

        return new Decimal(BigInt(value), 0);

    }


    /**
     * Reads a JSON number as Newtonsoft reads it with `FloatParseHandling.Decimal`, and System.Decimal holds it:
     * the decimal places as written (`1.50`), an exponent moving them (`1.5e2` is `150`, `1e-7` is `0.0000001`).
     * A number System.Decimal can not hold as written, more than 28 decimal places or a mantissa above 96 bits,
     * is refused, not rounded (SPECIFICATION.md section 1).
     */
    public static parse(text: string): Decimal {

        const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(text);

        if (match === null)
            throw new POIError(`'${text}' is no JSON number!`);

        const negative   = match[1] === '-';
        const integral   = match[2] ?? '';
        const fraction   = match[3] ?? '';
        const exponent   = match[4] !== undefined ? Number.parseInt(match[4], 10) : 0;

        let   mantissa   = BigInt(integral + fraction);
        let   scale      = fraction.length - exponent;

        if (!Number.isSafeInteger(scale))
            throw new POIError(`The number '${text}' can not be held as a decimal!`);

        // Only an integer literal without fraction and exponent may be of any size: Newtonsoft reads it as a BigInteger.
        const isIntegerLiteral = match[3] === undefined && match[4] === undefined;

        if (scale < 0) {

            if (-scale > 1000)
                throw new POIError(`The number '${text}' can not be held as a decimal!`);

            mantissa *= 10n ** BigInt(-scale);
            scale     = 0;

        }

        if (scale > MAX_DECIMAL_SCALE)
            throw new POIError(`The number '${text}' has more than ${MAX_DECIMAL_SCALE} decimal places, which a decimal can not hold!`);

        if (!isIntegerLiteral && mantissa > MAX_DECIMAL_MANTISSA)
            throw new POIError(`The mantissa of the number '${text}' is above 96 bits, which a decimal can not hold!`);

        return new Decimal(negative ? -mantissa : mantissa, scale);

    }


    /** Whether it has no decimal places: then it is the integer it equals, in JSON as in CBOR. */
    public get isInteger(): boolean {
        return this.scale === 0;
    }


    /**
     * Plain decimal notation keeping the scale, never an exponent; a negative zero loses its sign (Styx section 2.4).
     */
    public toString(): string {

        const negative  = this.mantissa < 0n;
        const digits    = (negative ? -this.mantissa : this.mantissa).toString();

        if (this.scale === 0)
            return (negative ? '-' : '') + digits;

        const padded    = digits.padStart(this.scale + 1, '0');
        const integral  = padded.slice(0, padded.length - this.scale);
        const fraction  = padded.slice(padded.length - this.scale);

        return (negative ? '-' : '') + integral + '.' + fraction;

    }


    /** The nearest binary floating-point number, for display only: never hash or compare it. */
    public toNumber(): number {
        return Number(this.toString());
    }


    /** The same mantissa and the same scale: `1.5` and `1.50` are other values (SPECIFICATION.md section 4). */
    public equals(other: Decimal): boolean {
        return this.mantissa === other.mantissa && this.scale === other.scale;
    }


    /** Compares the values, whatever their scales: -1, 0 or 1. */
    public compareTo(other: Decimal): -1 | 0 | 1 {

        const scale  = Math.max(this.scale, other.scale);
        const left   = this. mantissa * 10n ** BigInt(scale - this. scale);
        const right  = other.mantissa * 10n ** BigInt(scale - other.scale);

        return left < right ? -1 : left > right ? 1 : 0;

    }

}
