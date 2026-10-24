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

import { Decimal } from './decimal.ts';
import { POIError } from '../errors.ts';


/**
 * A JSON document as POI reads it in order to hash it again (Styx section 1): strings stay strings, numbers are
 * never binary floating-point numbers. An integer within the safe range of JavaScript is a `number`, every other
 * number a `Decimal`, so that `1.50` stays `1.50` and `230.5` is not `230.49999…`.
 */
export type JSONValue =
    | null
    | boolean
    | string
    | number
    | Decimal
    | JSONArray
    | JSONObject;

export type JSONArray = JSONValue[];

export interface JSONObject {
    [property: string]: JSONValue;
}


export const isObject = (value: JSONValue | undefined): value is JSONObject =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Decimal);

export const isArray = (value: JSONValue | undefined): value is JSONArray =>
    Array.isArray(value);

export const isNumber = (value: JSONValue | undefined): value is number | Decimal =>
    typeof value === 'number' || value instanceof Decimal;


/** A property of an object, without inheriting anything from its prototype. */
export function get(object: JSONObject, property: string): JSONValue | undefined {
    return Object.prototype.hasOwnProperty.call(object, property) ? object[property] : undefined;
}

/** Sets a property, also one named `__proto__`. */
export function set(object: JSONObject, property: string, value: JSONValue): void {

    if (property === '__proto__')
        Object.defineProperty(object, property, { value, enumerable: true, writable: true, configurable: true });

    else
        object[property] = value;

}


/** The value as a `Decimal`, whatever its representation. */
export function toDecimal(value: number | Decimal): Decimal {
    return value instanceof Decimal ? value : Decimal.fromInteger(value);
}

/**
 * The number as POI holds it: a safe integer as a `number`, everything else as a `Decimal`.
 */
export function normalizeNumber(value: Decimal): number | Decimal {

    if (value.scale === 0 && value.mantissa >= BigInt(Number.MIN_SAFE_INTEGER) && value.mantissa <= BigInt(Number.MAX_SAFE_INTEGER))
        return Number(value.mantissa);

    return value;

}


/** A deep copy. */
export function clone<T extends JSONValue>(value: T): T {

    if (Array.isArray(value))
        return value.map(item => clone(item)) as T;

    if (isObject(value)) {
        const copy: JSONObject = {};
        for (const [property, item] of Object.entries(value))
            set(copy, property, clone(item));
        return copy as T;
    }

    return value;

}


/** The object without the given properties, a shallow copy. */
export function without(object: JSONObject, ...properties: string[]): JSONObject {

    const copy: JSONObject = {};

    for (const [property, value] of Object.entries(object))
        if (!properties.includes(property))
            set(copy, property, value);

    return copy;

}


/**
 * Whether two values are the same as their canonical JSON is (SPECIFICATION.md section 4: `22000` and `22000.0` are
 * other values, the order of properties does not matter, the order of array items does).
 */
export function sameValue(left: JSONValue | undefined, right: JSONValue | undefined): boolean {

    if (left === undefined || right === undefined)
        return left === right;

    if (isNumber(left) || isNumber(right))
        return isNumber(left) && isNumber(right) && toDecimal(left).equals(toDecimal(right));

    if (Array.isArray(left) || Array.isArray(right))
        return Array.isArray(left) && Array.isArray(right) &&
               left.length === right.length &&
               left.every((item, index) => sameValue(item, right[index]));

    if (isObject(left) || isObject(right)) {

        if (!isObject(left) || !isObject(right))
            return false;

        const leftKeys   = Object.keys(left);
        const rightKeys  = Object.keys(right);

        return leftKeys.length === rightKeys.length &&
               leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key) && sameValue(left[key], right[key]));

    }

    return left === right;

}


/** Converts a value of plain JavaScript, refusing binary floating-point numbers that are no integers. */
export function fromJavaScript(value: unknown): JSONValue {

    if (value === null || typeof value === 'boolean' || typeof value === 'string' || value instanceof Decimal)
        return value;

    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value))
            throw new POIError(`The number ${value} is no safe integer: give it as a Decimal!`);
        return value;
    }

    if (typeof value === 'bigint')
        return normalizeNumber(Decimal.fromInteger(value));

    if (Array.isArray(value))
        return value.map(fromJavaScript);

    if (typeof value === 'object') {
        const object: JSONObject = {};
        for (const [property, item] of Object.entries(value as Record<string, unknown>))
            if (item !== undefined)
                set(object, property, fromJavaScript(item));
        return object;
    }

    throw new POIError(`A ${typeof value} is no JSON value!`);

}
