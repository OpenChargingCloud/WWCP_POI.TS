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

import { Decimal }                                   from './json/decimal.ts';
import { get, isArray, isObject, type JSONArray, type JSONObject, type JSONValue } from './json/value.ts';
import { POIError }                                  from './errors.ts';


/** The prefix of every JSON-LD context of POI (SPECIFICATION.md section 1.1). */
export const CONTEXT_PREFIX = 'https://open.charging.cloud/contexts/wwcp/';


// Reading the properties of a JSON object, refusing what is not of the expected type.


export function requireObject(value: JSONValue | undefined, what: string): JSONObject {
    if (!isObject(value))
        throw new POIError(`${what} must be a JSON object!`);
    return value;
}

export function requireArray(value: JSONValue | undefined, what: string): JSONArray {
    if (!isArray(value))
        throw new POIError(`${what} must be a JSON array!`);
    return value;
}

export function requireString(object: JSONObject, property: string, what?: string): string {
    const value = get(object, property);
    if (typeof value !== 'string')
        throw new POIError(`${what ?? `The property '${property}'`} must be a text!`);
    return value;
}

export function optionalString(object: JSONObject, property: string, what?: string): string | undefined {
    const value = get(object, property);
    if (value === undefined)
        return undefined;
    if (typeof value !== 'string')
        throw new POIError(`${what ?? `The property '${property}'`} must be a text!`);
    return value;
}

/** A whole number from `min` to `max`, written without decimal places. */
export function requireInteger(object: JSONObject, property: string, min = 0, max = Number.MAX_SAFE_INTEGER, what?: string): number {
    const value = get(object, property);
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
        throw new POIError(`${what ?? `The property '${property}'`} must be a whole number from ${min} to ${max}!`);
    return value;
}

export function optionalInteger(object: JSONObject, property: string, min = 0, max = Number.MAX_SAFE_INTEGER, what?: string): number | undefined {
    return get(object, property) === undefined
               ? undefined
               : requireInteger(object, property, min, max, what);
}

/** A number of the content, as decimal. */
export function optionalDecimal(object: JSONObject, property: string): Decimal | undefined {
    const value = get(object, property);
    if (value === undefined)
        return undefined;
    if (typeof value === 'number')
        return Decimal.fromInteger(value);
    if (value instanceof Decimal)
        return value;
    throw new POIError(`The property '${property}' must be a number!`);
}

/** Refuses an object naming a property other than the given ones. */
export function onlyProperties(object: JSONObject, allowed: readonly string[], what: string): void {
    for (const property of Object.keys(object))
        if (!allowed.includes(property))
            throw new POIError(`${what} must not name the property '${property}'!`);
}

/**
 * Checks the JSON-LD context of an object: it may be left out, and MUST be the given one where it is given
 * (SPECIFICATION.md section 1.1).
 */
export function checkContext(object: JSONObject, context: string, what: string): void {
    const value = get(object, '@context');
    if (value !== undefined && value !== context)
        throw new POIError(`The JSON-LD context of ${what} must be '${context}'!`);
}


// Timestamps: UTC to the millisecond, `yyyy-MM-ddTHH:mm:ss.fffZ`, signed as written (SPECIFICATION.md section 5.4).


const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;

/**
 * The milliseconds since 1970 of a timestamp written as POI writes it, `yyyy-MM-ddTHH:mm:ss.fffZ`; any other form is
 * refused, as it is signed and hashed as written.
 */
export function parseTimestamp(text: string, what = 'A timestamp'): number {

    const match = TIMESTAMP.exec(text);

    if (match === null)
        throw new POIError(`${what} must be written as yyyy-MM-ddTHH:mm:ss.fffZ, not '${text}'!`);

    const [ , year, month, day, hour, minute, second, millisecond ] = match.map(Number) as [number, number, number, number, number, number, number, number];
    const time = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);

    if (Number.isNaN(time) || toTimestamp(time) !== text)
        throw new POIError(`${what} '${text}' is no point in time!`);

    return time;

}

/** A point in time as POI writes it. */
export function toTimestamp(time: number | Date): string {

    const date  = typeof time === 'number' ? new Date(time) : time;
    const year  = date.getUTCFullYear();

    if (year < 0 || year > 9999)
        throw new POIError('A timestamp of POI is within the years 0000 to 9999!');

    return date.toISOString().replace(/^\+0*(?=\d{4})/, '');

}

export function requireTimestamp(object: JSONObject, property: string, what?: string): number {
    return parseTimestamp(requireString(object, property, what), what ?? `The timestamp '${property}'`);
}

export function optionalTimestamp(object: JSONObject, property: string, what?: string): number | undefined {
    const text = optionalString(object, property, what);
    return text === undefined ? undefined : parseTimestamp(text, what ?? `The timestamp '${property}'`);
}

/** Now, or the given point in time, as milliseconds since 1970. */
export const timeOf = (at?: number | Date | string): number =>
    at === undefined          ? Date.now()
  : typeof at === 'number'    ? at
  : typeof at === 'string'    ? parseTimestamp(at)
  :                             at.getTime();


/** The first text of a multilingual text, e.g. `{"en": "Quality Assurance"}`. */
export function firstText(i18n: JSONValue | undefined): string | undefined {
    if (!isObject(i18n))
        return undefined;
    const first = Object.values(i18n)[0];
    return typeof first === 'string' ? first : undefined;
}
