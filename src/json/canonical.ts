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

import { Decimal }                         from './decimal.ts';
import { isObject, type JSONValue }        from './value.ts';
import { POIError }                        from '../errors.ts';


/**
 * The characters canonical JSON of Styx writes as `\uXXXX` (Styx section 2.3), those .NET's
 * `JavaScriptEncoder.UnsafeRelaxedJsonEscaping` escapes: control characters, space separators but the space, line and
 * paragraph separators, private use characters, unassigned code points and noncharacters, and the byte order mark.
 * Which code points are unassigned depends on the Unicode version of the runtime, as in .NET (Styx section 5).
 */
const ESCAPED = /[\p{Cc}\p{Co}\p{Cn}\p{Zl}\p{Zp}\uFEFF]|(?! )\p{Zs}/u;

const SHORT_ESCAPES: Record<number, string> = {
    0x08: '\\b',
    0x09: '\\t',
    0x0A: '\\n',
    0x0C: '\\f',
    0x0D: '\\r',
    0x22: '\\"',
    0x5C: '\\\\',
};

const hex4 = (codeUnit: number): string =>
    '\\u' + codeUnit.toString(16).toUpperCase().padStart(4, '0');


/** A string as canonical JSON writes it, in double quotes. */
export function canonicalString(text: string): string {

    let result = '"';

    for (let index = 0; index < text.length; index++) {

        const codeUnit = text.charCodeAt(index);

        // A character beyond the Basic Multilingual Plane is always written as its escaped surrogate pair; an unpaired
        // surrogate as U+FFFD, as .NET does.
        if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {

            const next = text.charCodeAt(index + 1);

            if (next >= 0xDC00 && next <= 0xDFFF) {
                result += hex4(codeUnit) + hex4(next);
                index++;
            }
            else
                result += '�';

            continue;

        }

        if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
            result += '�';
            continue;
        }

        const short = SHORT_ESCAPES[codeUnit];

        if (short !== undefined) {
            result += short;
            continue;
        }

        const character = text.charAt(index);

        result += ESCAPED.test(character)
                      ? hex4(codeUnit)
                      : character;

    }

    return result + '"';

}


/** A number as canonical JSON writes it: an integer as its digits, a decimal keeping its scale, never an exponent. */
export function canonicalNumber(value: number | Decimal): string {

    if (value instanceof Decimal)
        return value.toString();

    if (!Number.isSafeInteger(value))
        throw new POIError(`The number ${value} is no safe integer and can not be written as canonical JSON: give it as a Decimal!`);

    // -0 is written 0.
    return value === 0 ? '0' : value.toString();

}


/** Compares by UTF-16 code units, as `StringComparer.Ordinal` does. */
export const ordinal = (left: string, right: string): number =>
    left < right ? -1 : left > right ? 1 : 0;


/**
 * The canonical JSON of Styx (Styx section 2): properties in the ordinal order of their names as UTF-16 code units,
 * arrays in their order, no whitespace, decimals keeping their scale, Styx's string escaping.
 */
export function canonicalJSON(value: JSONValue): string {

    if (value === null)
        return 'null';

    if (value === true)
        return 'true';

    if (value === false)
        return 'false';

    if (typeof value === 'string')
        return canonicalString(value);

    if (typeof value === 'number' || value instanceof Decimal)
        return canonicalNumber(value);

    if (Array.isArray(value))
        return '[' + value.map(canonicalJSON).join(',') + ']';

    if (isObject(value))
        return '{' + Object.entries(value).sort(([left], [right]) => ordinal(left, right)).map(([property, item]) => canonicalString(property) + ':' + canonicalJSON(item)).join(',') + '}';

    throw new POIError(`A ${typeof value} can not be written as canonical JSON!`);

}


/** The UTF-8 bytes of the canonical JSON, which POI hashes and signs. */
export function canonicalJSONBytes(value: JSONValue): Uint8Array {
    return new TextEncoder().encode(canonicalJSON(value));
}


/** Indented JSON for people to read, numbers as canonical JSON writes them. */
export function prettyJSON(value: JSONValue, indent = '  ', prefix = ''): string {

    if (Array.isArray(value)) {
        if (value.length === 0)
            return '[]';
        return '[\n' + value.map(item => prefix + indent + prettyJSON(item, indent, prefix + indent)).join(',\n') + '\n' + prefix + ']';
    }

    if (isObject(value)) {
        const properties = Object.entries(value);
        if (properties.length === 0)
            return '{}';
        return '{\n' + properties.map(([property, item]) => prefix + indent + JSON.stringify(property) + ': ' + prettyJSON(item, indent, prefix + indent)).join(',\n') + '\n' + prefix + '}';
    }

    if (typeof value === 'string')
        return JSON.stringify(value);

    return canonicalJSON(value);

}
