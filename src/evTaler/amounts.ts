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

import { Decimal } from '../json/decimal.ts';
import { get, isArray, isObject, type JSONObject, type JSONValue } from '../json/value.ts';
import type { EVTalerCovers } from './step.ts';


// Amounts of EV Taler (EVTalerAmounts, EVTalerRates of WWCP_POI c2d39e5): GNU Taler's amounts, "EUR:3.25", and the
// decimals WWCP writes as texts, "3.25", calculated as System.Decimal calculates them, with the rounding of
// concepts/EVTaler.md (open point 3): a step up to the minor unit of its currency, the price of a session to the nearest
// minor unit, half away from zero.


/** A System.Decimal holds a mantissa below 2^96 and at most 28 decimal places. */
const MAX_MANTISSA  = (1n << 96n) - 1n;
const MAX_SCALE     = 28;

const pow10 = (exponent: number): bigint =>
    10n ** BigInt(exponent);

/** The quotient of the given integers rounded half to even, as System.Decimal rounds what it can not hold. */
function divideHalfEven(numerator: bigint, denominator: bigint): bigint {

    if (denominator < 0n) {
        numerator    = -numerator;
        denominator  = -denominator;
    }

    const negative   = numerator < 0n;
    const absolute   = negative ? -numerator : numerator;
    let   quotient   = absolute / denominator;
    const remainder  = absolute % denominator;
    const twice      = 2n * remainder;

    if (twice > denominator || (twice === denominator && quotient % 2n === 1n))
        quotient++;

    return negative ? -quotient : quotient;

}

/**
 * A number as System.Decimal holds and calculates it: a mantissa below 2^96 and at most 28 decimal places; a result it can
 * not hold exactly rounded half to even, to as many places as it holds (DecCalc of .NET).
 */
export class NetDecimal {

    private constructor(
        public readonly mantissa:  bigint,
        public readonly scale:     number
    ) {}

    public static readonly ZERO = new NetDecimal(0n, 0);

    /** The given mantissa and scale, rounded half to even to what System.Decimal holds. */
    private static fitted(mantissa: bigint, scale: number): NetDecimal {

        while (scale > MAX_SCALE || (scale > 0 && (mantissa < 0n ? -mantissa : mantissa) > MAX_MANTISSA)) {
            mantissa  = divideHalfEven(mantissa, 10n);
            scale--;
        }

        if ((mantissa < 0n ? -mantissa : mantissa) > MAX_MANTISSA)
            throw new RangeError('Value was either too large or too small for a Decimal.');

        return new NetDecimal(mantissa, scale);

    }

    public static of(value: number | bigint | Decimal): NetDecimal {
        return value instanceof Decimal
                   ? NetDecimal.fitted(value.mantissa, value.scale)
                   : NetDecimal.fitted(BigInt(value), 0);
    }

    /** A text of digits, as `Decimal.TryParse` with `NumberStyles.AllowDecimalPoint` reads it; undefined beyond its range. */
    public static parse(text: string): NetDecimal | undefined {

        const match = /^(-?)([0-9]+)(?:\.([0-9]*))?$/u.exec(text);

        if (match === null)
            return undefined;

        const fraction = match[3] ?? '';
        const mantissa = BigInt(`${match[1] ?? ''}${match[2] ?? ''}${fraction}`);

        try {
            return NetDecimal.fitted(mantissa, fraction.length);
        }
        catch {
            return undefined;
        }

    }

    /** An exact quotient of integers, e.g. milliseconds as seconds. */
    public static ofFraction(mantissa: bigint, scale: number): NetDecimal {
        return NetDecimal.fitted(mantissa, scale);
    }

    private aligned(other: NetDecimal): [ bigint, bigint, number ] {
        const scale = Math.max(this.scale, other.scale);
        return [ this.mantissa * pow10(scale - this.scale), other.mantissa * pow10(scale - other.scale), scale ];
    }

    public plus(other: NetDecimal): NetDecimal {
        const [ left, right, scale ] = this.aligned(other);
        return NetDecimal.fitted(left + right, scale);
    }

    public minus(other: NetDecimal): NetDecimal {
        const [ left, right, scale ] = this.aligned(other);
        return NetDecimal.fitted(left - right, scale);
    }

    public times(other: NetDecimal): NetDecimal {
        return NetDecimal.fitted(this.mantissa * other.mantissa, this.scale + other.scale);
    }

    /** The quotient as System.Decimal divides: exact where it holds it, else rounded half to even to as many places as it holds. */
    public dividedBy(other: NetDecimal): NetDecimal {

        if (other.mantissa === 0n)
            throw new RangeError('Attempted to divide by zero.');

        // this / other = (m1 · 10^s2) / (m2 · 10^s1), scaled to the most places that hold it.
        const numerator    = this. mantissa * pow10(other.scale);
        const denominator  = other.mantissa * pow10(this. scale);

        for (let scale = MAX_SCALE; scale >= 0; scale--) {

            const scaled    = numerator * pow10(scale);
            const quotient  = divideHalfEven(scaled, denominator);

            if ((quotient < 0n ? -quotient : quotient) <= MAX_MANTISSA) {

                // Exact at fewer places: the same value, as System.Decimal keeps it.
                let mantissa = quotient;
                let places   = scale;

                while (places > 0 && mantissa % 10n === 0n && scaled % denominator === 0n) {
                    mantissa /= 10n;
                    places--;
                }

                return new NetDecimal(mantissa, places);

            }

        }

        throw new RangeError('Value was either too large or too small for a Decimal.');

    }

    public compareTo(other: NetDecimal): -1 | 0 | 1 {
        const [ left, right ] = this.aligned(other);
        return left < right ? -1 : left > right ? 1 : 0;
    }

    public equals(other: NetDecimal): boolean {
        return this.compareTo(other) === 0;
    }

    public isNegative(): boolean {
        return this.mantissa < 0n;
    }

    /** `Math.Round` to the given number of decimal places in the given way. */
    public round(places: number, mode: 'toEven' | 'awayFromZero' | 'toPositiveInfinity' | 'toZero'): NetDecimal {

        if (this.scale <= places)
            return this;

        const divisor    = pow10(this.scale - places);
        const negative   = this.mantissa < 0n;
        const absolute   = negative ? -this.mantissa : this.mantissa;
        let   quotient   = absolute / divisor;
        const remainder  = absolute % divisor;

        if (remainder !== 0n) {
            const twice = 2n * remainder;
            switch (mode) {
                case 'toPositiveInfinity':  if (!negative) quotient++;                                                             break;
                case 'awayFromZero':        if (twice >= divisor) quotient++;                                                      break;
                case 'toEven':              if (twice > divisor || (twice === divisor && quotient % 2n === 1n)) quotient++;        break;
                case 'toZero':                                                                                                     break;
            }
        }

        return new NetDecimal(negative ? -quotient : quotient, places);

    }

    /** `Math.Ceiling`. */
    public ceiling(): NetDecimal {
        return this.round(0, 'toPositiveInfinity');
    }

    /** The digits of the given number of decimal places, as `ToString("F" + places)` writes a value that has no more. */
    public toFixed(places: number): string {
        const value = this.scale < places ? new NetDecimal(this.mantissa * pow10(places - this.scale), places) : this;
        return written(value.mantissa, value.scale);
    }

    /** As `ToString("0.############################")` writes it: without trailing zeros, "-0" as "0". */
    public toString(): string {

        let mantissa = this.mantissa;
        let scale    = this.scale;

        while (scale > 0 && mantissa % 10n === 0n) {
            mantissa /= 10n;
            scale--;
        }

        return written(mantissa, scale);

    }

}

function written(mantissa: bigint, scale: number): string {

    const negative  = mantissa < 0n;
    const digits    = (negative ? -mantissa : mantissa).toString().padStart(scale + 1, '0');
    const integral  = digits.slice(0, digits.length - scale);
    const fraction  = digits.slice(digits.length - scale);

    return (negative && mantissa !== 0n ? '-' : '') + integral + (scale > 0 ? `.${fraction}` : '');

}


/** The ISO 4217 codes whose minor unit is not the hundredth. */
const MINOR_UNITS: ReadonlyMap<string, number> = new Map([
    ...[ 'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF' ].map(code => [ code, 0 ] as const),
    ...[ 'BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND' ].map(code => [ code, 3 ] as const),
    ...[ 'CLF', 'UYW' ].map(code => [ code, 4 ] as const),
]);

/** The largest integer part of a GNU Taler amount, 2^52. */
const MAX_TALER_VALUE = NetDecimal.of(4503599627370496n);

/** The number of decimal digits of the minor unit of the given ISO 4217 currency: 2 unless it is known otherwise. */
export const minorUnitDigits = (currency: string): number =>
    MINOR_UNITS.get(currency) ?? 2;

/** The given value rounded up to the minor unit of the given currency, as the amount of a step. */
export const roundUp = (value: NetDecimal, currency: string): NetDecimal =>
    value.round(minorUnitDigits(currency), 'toPositiveInfinity');

/** The given value rounded to the nearest minor unit of the given currency, half away from zero, as the price of a session. */
export const roundToNearest = (value: NetDecimal, currency: string): NetDecimal =>
    value.round(minorUnitDigits(currency), 'awayFromZero');

/** The given amount with the digits of the minor unit of its currency, e.g. "3.20", or with all of its digits where it has more. */
export function writeAmount(value: NetDecimal, currency: string): string {
    const digits = minorUnitDigits(currency);
    return value.round(digits, 'toEven').equals(value) ? value.toFixed(digits) : value.toString();
}

/** The given value as a text without trailing zeros, e.g. "13.412". */
export const writeDecimal = (value: NetDecimal): string =>
    value.toString();

/**
 * An amount as GNU Taler writes it, e.g. "EUR:3.25": a currency of at most 11 letters, no sign, at most 8 fractional
 * digits, an integer part of at most 2^52; its error otherwise, as WWCP_POI words it.
 */
export function talerAmountOf(text: string | undefined): { currency: string, value: NetDecimal } | string {

    const match  = text === undefined ? null : /^([A-Za-z]{1,11}):((?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?)$/u.exec(text);
    const value  = match === null ? undefined : NetDecimal.parse(match[2] ?? '');

    if (match === null || value === undefined || value.round(0, 'toZero').compareTo(MAX_TALER_VALUE) > 0)
        return `'${text ?? ''}' is no amount as GNU Taler writes it, e.g. 'EUR:3.25'!`;

    return { currency: match[1] ?? '', value };

}

/** The given property as a decimal written as a text, not negative, e.g. "13.412"; its error otherwise. */
export function decimalTextOf(json: JSONObject, name: string): NetDecimal | string {

    const text   = get(json, name);
    const value  = typeof text === 'string' && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(text) ? NetDecimal.parse(text) : undefined;

    return value ?? `The '${name}' must be a decimal written as a text, not negative, e.g. "3.25"!`;

}


/** A number of JSON, an integer or one with decimal places, as System.Decimal holds it; undefined for any other value. */
const numberOf = (value: JSONValue | undefined): NetDecimal | undefined =>
    typeof value === 'number' || value instanceof Decimal ? NetDecimal.of(value) : undefined;


/**
 * The gross rates an EV Taler session is priced by, where its prices are those of the simple profile (`EVTalerRates`): one
 * element, without restrictions, of ENERGY, TIME and FLAT components each at most once, with their VAT added; no minimum
 * or maximum price. A session of other prices is paid in steps all the same, but its amounts and its price are not
 * recalculated by a reader.
 */
export class EVTalerRates {

    private constructor(
        public readonly currency:         string,
        /** The gross price of a kWh, if the tariff prices energy. */
        public readonly energyPerKWh:     NetDecimal | undefined,
        /** The billing increment of energy, in Wh. */
        public readonly energyStepWh:     NetDecimal | undefined,
        /** The gross price of an hour of charging, if the tariff prices time. */
        public readonly timePerHour:      NetDecimal | undefined,
        /** The billing increment of time, in seconds. */
        public readonly timeStepSeconds:  NetDecimal | undefined,
        /** The gross flat fee, if any. */
        public readonly flatFee:          NetDecimal | undefined
    ) {}

    /** The rates of the simple profile of the given elements of the given charging tariff, or why there are none. */
    public static of(currency: string, tariff: JSONObject, elements: readonly JSONObject[]): EVTalerRates | { readonly reason: string } {

        if (get(tariff, 'minPrice') !== undefined || get(tariff, 'maxPrice') !== undefined)
            return { reason: 'the charging tariff has a minimum or maximum price' };

        if (elements.length !== 1)
            return { reason: 'the session is priced by more than one element' };

        const element      = elements[0] ?? {};
        const restrictions = get(element, 'restrictions');
        const components   = get(element, 'priceComponents');

        if (Object.keys(element).some(property => property !== 'priceComponents' && property !== 'restrictions') ||
            (restrictions !== undefined && (!isObject(restrictions) || Object.keys(restrictions).length > 0)) ||
            !isArray(components) || components.length === 0)
            return { reason: 'the element of the session has restrictions' };

        let energy: NetDecimal | undefined, energyStep: NetDecimal | undefined, time: NetDecimal | undefined, timeStep: NetDecimal | undefined, flat: NetDecimal | undefined;

        const HUNDRED = NetDecimal.of(100);

        for (const component of components) {

            const price = isObject(component) ? numberOf(get(component, 'price')) : undefined;

            if (!isObject(component) || price === undefined ||
                Object.keys(component).some(property => property !== 'type' && property !== 'price' && property !== 'vat' && property !== 'stepSize'))
                return { reason: 'a price component is not one of the simple profile' };

            const vat    = numberOf(get(component, 'vat')) ?? NetDecimal.ZERO;
            const step   = numberOf(get(component, 'stepSize'));
            const gross  = price.times(HUNDRED.plus(vat)).dividedBy(HUNDRED);

            if (price.isNegative() || vat.isNegative() || vat.compareTo(HUNDRED) > 0)
                return { reason: 'a price component has a negative price or a VAT outside 0..100' };

            const type   = get(component, 'type');
            const stepped = step !== undefined && step.compareTo(NetDecimal.ZERO) > 0;

            if (type === 'ENERGY' && energy === undefined && stepped) {
                energy      = gross;
                energyStep  = step;
            }
            else if (type === 'TIME' && time === undefined && stepped) {
                time        = gross;
                timeStep    = step;
            }
            else if (type === 'FLAT' && flat === undefined && step === undefined)
                flat        = gross;
            else
                return { reason: 'a price component is not ENERGY, TIME or FLAT once each, with its step size' };

        }

        return new EVTalerRates(currency, energy, energyStep, time, timeStep, flat);

    }

    /** The price of what a step covers, rounded up to the minor unit: its kWh at the price of energy, its minutes at the price of time. */
    public stepPrice(covers: EVTalerCovers): NetDecimal | string {

        const quantity = covers.to.minus(covers.from);

        // Multiplied before divided, as WWCP_POI a374855 does: a decimal holds no rate of a minute such as 0.40 / 60
        // exactly, and rounding up would take its last digit for a cent.
        const price    = covers.unit === 'kWh' ? (this.energyPerKWh === undefined ? undefined : quantity.times(this.energyPerKWh))
                                               : (this.timePerHour  === undefined ? undefined : quantity.times(this.timePerHour).dividedBy(NetDecimal.of(60)));

        if (price === undefined)
            return `The charging tariff does not price what a step covers, '${covers.unit}'!`;

        return roundUp(price, this.currency);

    }

    /**
     * The price of a session of the given energy, in kWh, and duration, in milliseconds: the flat fee, the energy and the
     * time each billed in its increments, rounded to the nearest minor unit of the currency.
     */
    public sessionPrice(energy: NetDecimal, durationMs: number): NetDecimal {

        const billed = (quantity: NetDecimal, step: NetDecimal): NetDecimal =>
            quantity.dividedBy(step).ceiling().times(step);

        let price = this.flatFee ?? NetDecimal.ZERO;

        if (this.energyPerKWh !== undefined && this.energyStepWh !== undefined)
            price = price.plus(this.energyPerKWh.times(billed(energy.times(NetDecimal.of(1000)), this.energyStepWh)).dividedBy(NetDecimal.of(1000)));

        if (this.timePerHour !== undefined && this.timeStepSeconds !== undefined)
            price = price.plus(this.timePerHour.times(billed(NetDecimal.ofFraction(BigInt(durationMs), 3), this.timeStepSeconds)).dividedBy(NetDecimal.of(3600)));

        return roundToNearest(price, this.currency);

    }

}
