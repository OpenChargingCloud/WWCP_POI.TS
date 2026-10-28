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

import { toTimestamp }   from '../common.ts';
import { Decimal }       from '../json/decimal.ts';
import { get, isArray, isNumber, isObject, normalizeNumber, set, toDecimal, type JSONObject, type JSONValue } from '../json/value.ts';
import { isText, trimmed } from '../network/versionTexts.ts';
import { POIError }      from '../errors.ts';


// What the QI-Digital documents and their parts read and write alike, as QIDigitalJSON and POIJSON of WWCP_POI read and
// write them: only their own properties, their JSON-LD context, timestamps exactly as they are signed, decimal numbers,
// texts of their languages. A document is signed as WWCP_POI writes it again from what it read (its `Content()`), not as
// it was given: numbers without trailing zeros, identifications trimmed, what is empty or the default left out. Each part
// here therefore writes itself again as WWCP_POI does (`toJSON`), and the signature input is that.


/** The JSON-LD context of a QI-Digital object, versioned, part of its signature input (`QIDigitalJSON.Context`). */
export const qiDigitalContext = (object: string, version = 1): string =>
    `https://open.charging.cloud/contexts/wwcp/qiDigital/${object}/v${version.toString()}`;


/** Refuses a property other than the given ones, so that nothing unsigned travels with a signed document (`TryOnly`). */
export function only(json: JSONObject, description: string, ...properties: readonly string[]): void {
    for (const property of Object.keys(json))
        if (!properties.includes(property))
            throw new POIError(`Unknown property '${property}' of ${description}!`);
}

/** Refuses another JSON-LD context than the given one, if it names one: embedded it names none (`TryContext`). */
export function contextOf(json: JSONObject, context: string, description: string): void {
    const value = get(json, '@context');
    if (value !== undefined && value !== context)
        throw new POIError(`The JSON-LD context of ${description} must be '${context}'!`);
}


/** The text of the given property, or undefined when it is none (`QIDigitalJSON.Text`). */
export const textOf = (json: JSONObject, property: string): string | undefined => {
    const value = get(json, property);
    return typeof value === 'string' ? value : undefined;
};

/**
 * A value as `JToken.ToString` gives it in a message: a text as it is, a number as written, a boolean as .NET writes it,
 * null as nothing, an object or an array indented.
 */
export function tokenText(value: JSONValue): string {
    if (typeof value === 'string')
        return value;
    if (typeof value === 'boolean')
        return value ? 'True' : 'False';
    if (value === null)
        return '';
    if (isNumber(value))
        return value.toString();
    return newtonsoftJSON(value, '  ', '');
}

/** A value as Newtonsoft writes it without formatting, e.g. the item of an array in a message. */
export const compactJSON = (value: JSONValue): string =>
    newtonsoftJSON(value, undefined, '');

/** A text as Newtonsoft escapes it by default: quotes, backslashes, control characters, U+0085, U+2028 and U+2029. */
function newtonsoftString(text: string): string {

    let result = '"';

    for (const character of text) {

        const code = character.charCodeAt(0);

        switch (character) {
            case '"':   result += '\\"';  continue;
            case '\\':  result += '\\\\'; continue;
            case '\b':  result += '\\b';  continue;
            case '\f':  result += '\\f';  continue;
            case '\n':  result += '\\n';  continue;
            case '\r':  result += '\\r';  continue;
            case '\t':  result += '\\t';  continue;
        }

        result += code < 0x20 || code === 0x85 || code === 0x2028 || code === 0x2029
                      ? '\\u' + code.toString(16).padStart(4, '0')
                      : character;

    }

    return result + '"';

}

function newtonsoftJSON(value: JSONValue, indent: string | undefined, prefix: string): string {

    if (typeof value === 'string')
        return newtonsoftString(value);

    if (value === null || typeof value === 'boolean' || isNumber(value))
        return value === null ? 'null' : value.toString();

    const inner      = indent === undefined ? '' : prefix + indent;
    const newline    = indent === undefined ? '' : '\n';
    const separator  = indent === undefined ? ':' : ': ';

    if (isArray(value))
        return value.length === 0
                   ? '[]'
                   : '[' + newline + value.map(item => inner + newtonsoftJSON(item, indent, inner)).join(',' + newline) + newline + (indent === undefined ? '' : prefix) + ']';

    const entries = Object.entries(value);

    return entries.length === 0
               ? '{}'
               : '{' + newline + entries.map(([ property, item ]) => inner + newtonsoftString(property) + separator + newtonsoftJSON(item, indent, inner)).join(',' + newline) + newline + (indent === undefined ? '' : prefix) + '}';

}


/** A mandatory value given as a text, e.g. an identification (`TryParseRequiredText`). */
export function requiredText<T>(json: JSONObject, property: string, description: string, parser: (text: string) => T | undefined): T {

    const text = textOf(json, property);

    if (text === undefined)
        throw new POIError(`The ${description} is missing!`);

    const value = parser(text);

    if (value === undefined)
        throw new POIError(`Invalid ${description} '${text}'!`);

    return value;

}

/** An optional value given as a text, e.g. an identification or a hardware revision (`POIJSON.TryParseText`). */
export function optionalText<T>(json: JSONObject, property: string, description: string, parser: (text: string) => T | undefined): T | undefined {

    const value = get(json, property);

    if (value === undefined)
        return undefined;

    const parsed = typeof value === 'string' ? parser(value) : undefined;

    if (parsed === undefined)
        throw new POIError(`Invalid ${description} '${tokenText(value)}'!`);

    return parsed;

}

/** An optional text (`POIJSON.TryParseString`). */
export function optionalString(json: JSONObject, property: string, description: string): string | undefined {

    const value = get(json, property);

    if (value === undefined)
        return undefined;

    if (typeof value !== 'string')
        throw new POIError(`The ${description} must be a text!`);

    return value;

}

/** Optional texts, given as an array, in their given order (`POIJSON.TryParseStrings`). */
export function optionalStrings(json: JSONObject, property: string, description: string): string[] {

    const value = get(json, property);

    if (value === undefined)
        return [];

    if (!isArray(value) || value.some(item => typeof item !== 'string'))
        throw new POIError(`The ${description} must be a JSON array of texts!`);

    return value as string[];

}

/** Optional identifications or versions, given as an array of texts, in their given order (`POIJSON.TryParseIds`). */
export function optionalIds<T>(json: JSONObject, property: string, description: string, parser: (text: string) => T | undefined): T[] {

    const value = get(json, property);

    if (value === undefined)
        return [];

    if (!isArray(value))
        throw new POIError(`The ${description} must be a JSON array!`);

    return value.map(item => {
        const parsed = typeof item === 'string' ? parser(item) : undefined;
        if (parsed === undefined)
            throw new POIError(`Invalid ${description} '${tokenText(item)}'!`);
        return parsed;
    });

}

/** An optional value given by the exact name of one of the given values (`POIJSON.TryParseEnum`). */
export function optionalEnum<T extends string>(json: JSONObject, property: string, description: string, names: readonly T[]): T | undefined {

    const value = get(json, property);

    if (value === undefined)
        return undefined;

    if (typeof value !== 'string' || !(names as readonly string[]).includes(value))
        throw new POIError(`Invalid ${description} '${tokenText(value)}'!`);

    return value as T;

}

/** An optional embedded object, read by the given parser (`POIJSON.TryParseObject`). */
export function optionalObject<T>(json: JSONObject, property: string, description: string, parser: (json: JSONObject) => T): T | undefined {

    const value = get(json, property);

    if (value === undefined)
        return undefined;

    if (!isObject(value))
        throw new POIError(`The ${description} must be a JSON object!`);

    try {
        return parser(value);
    }
    catch (e) {
        throw new POIError(`Invalid ${description}: ${messageOf(e)}`);
    }

}

/** Optional embedded objects, given as an array, in their given order, each read by the given parser (`POIJSON.TryParseObjects`). */
export function optionalObjects<T>(json: JSONObject, property: string, description: string, parser: (json: JSONObject) => T): T[] {

    const value = get(json, property);

    if (value === undefined)
        return [];

    if (!isArray(value))
        throw new POIError(`The ${description} must be a JSON array!`);

    return value.map(item => {

        if (!isObject(item))
            throw new POIError(`Invalid ${description} '${compactJSON(item)}'!`);

        try {
            return parser(item);
        }
        catch (e) {
            throw new POIError(`Invalid ${description} '${compactJSON(item)}': ${messageOf(e)}`);
        }

    });

}

/** The message of an error, as WWCP_POI's TryParse gives the one of what it catches. */
export const messageOf = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);


/** A whole number of an optional property, e.g. a revision: a JSON integer from 0 to the given maximum. */
export function optionalInteger(json: JSONObject, property: string, maximum: number, message: string): number | undefined {

    const value = get(json, property);

    if (value === undefined)
        return undefined;

    if (typeof value !== 'number' || value < 0 || value > maximum)
        throw new POIError(message);

    return value;

}


// Timestamps: written exactly as yyyy-MM-ddTHH:mm:ss.fffZ, as they are signed.


const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** An optional timestamp, written exactly as it is signed (`QIDigitalJSON.TryParseTimestamp`), in milliseconds since 1970. */
export function optionalTimestamp(json: JSONObject, property: string, description: string): number | undefined {

    const value = get(json, property);

    if (value === undefined)
        return undefined;

    const time = typeof value === 'string' && TIMESTAMP.test(value) ? Date.parse(value) : Number.NaN;

    // A DateTimeOffset begins with the year 1.
    if (typeof value !== 'string' || Number.isNaN(time) || value.startsWith('0000') || toTimestamp(time) !== value)
        throw new POIError(`The ${description} must be written as yyyy-MM-ddTHH:mm:ss.fffZ!`);

    return time;

}


// Numbers: decimals, written without trailing zeros, a whole number as an integer.


/** A System.Decimal holds a mantissa below 2^96. */
const MAX_DECIMAL_MANTISSA = (1n << 96n) - 1n;

/** An optional number, e.g. a measurement error: a JSON number, not a text (`QIDigitalJSON.TryParseDecimal`), without trailing zeros. */
export function optionalDecimal(json: JSONObject, property: string, description: string): Decimal | undefined {

    const value = get(json, property);

    if (value === undefined)
        return undefined;

    if (!isNumber(value))
        throw new POIError(`The ${description} must be a number!`);

    const decimal = toDecimal(value);

    if (decimal.mantissa > MAX_DECIMAL_MANTISSA || -decimal.mantissa > MAX_DECIMAL_MANTISSA)
        throw new POIError(`The ${description} is out of range!`);

    return withoutTrailingZeros(decimal);

}

/** The given number without trailing zeros, e.g. 0.50 as 0.5: as it is written, read back and signed (`QIDigitalJSON.Number`). */
export function withoutTrailingZeros(value: Decimal): Decimal {

    let { mantissa, scale } = value;

    while (scale > 0 && mantissa % 10n === 0n) {
        mantissa /= 10n;
        scale--;
    }

    return new Decimal(mantissa, scale);

}

const MIN_INT64 = -(1n << 63n);
const MAX_INT64 = (1n << 63n) - 1n;

/** A number as WWCP_POI writes it, a whole one as an integer (`POIJSON.Number`), of one without trailing zeros. */
export function numberJSON(value: Decimal): JSONValue {

    if (value.scale > 0)
        return value;

    // WWCP_POI casts a whole number to Int64.
    if (value.mantissa < MIN_INT64 || value.mantissa > MAX_INT64)
        throw new POIError('Value was either too large or too small for an Int64.');

    return normalizeNumber(value);

}

/** The sum of two decimals, exactly. */
export function sum(left: Decimal, right: Decimal): Decimal {
    const scale = Math.max(left.scale, right.scale);
    return new Decimal(left.mantissa * 10n ** BigInt(scale - left.scale) + right.mantissa * 10n ** BigInt(scale - right.scale), scale);
}

/** The decimal negated. */
export const negated = (value: Decimal): Decimal =>
    new Decimal(-value.mantissa, value.scale);

/** Whether the decimal is below zero. */
export const isNegative = (value: Decimal): boolean =>
    value.mantissa < 0n;


// Texts of languages: ImmutableI18NString, as the languages of Styx name them.


/** A text in its languages, in their given order, each language once. */
export type I18NText = readonly (readonly [ language: string, text: string ])[];

/** The languages of Styx (`Languages`), as it writes them. */
const LANGUAGES = new Set(`unknown aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en
                           eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki
                           kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv
                           ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk
                           tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu`.split(/\s+/u));

/**
 * An optional text in languages (`QIDigitalJSON.TryParseI18N`): an object of languages and their texts, each language
 * once, as Styx names it, written as it writes it, in lower case. Empty, it is none, as WWCP_POI leaves it out. What is no
 * text, or of no language Styx knows, is refused, as WWCP_POI refuses it since `bbe8fb8`: left out, it would be no part
 * of what is signed, and travel with a signed document unsigned.
 */
export function optionalI18N(json: JSONObject, property: string, description: string): I18NText | undefined {

    const value = get(json, property);

    // "property": null is left out.
    if (value === undefined || value === null)
        return undefined;

    if (!isObject(value))
        throw new POIError(`JSON property '${property}' is not an object!`);

    return i18nOf(value, `JSON property '${property}' (${description}) could not be parsed: `);

}

/** A text in languages of the given object, e.g. the condition of a certificate of conformity; undefined when it is empty. */
export function i18nOf(value: JSONObject, prefix: string): I18NText | undefined {

    const texts: [ string, string ][] = [];

    for (const [ key, text ] of Object.entries(value)) {

        const language = key.toLowerCase();

        if (!LANGUAGES.has(language))
            throw new POIError(`${prefix}'${key}' is no language!`);

        if (typeof text !== 'string')
            throw new POIError(`${prefix}the text in '${key}' must be a text!`);

        if (texts.some(([ other ]) => other === language))
            throw new POIError(`${prefix}the language '${language}' is given twice!`);

        texts.push([ language, text ]);

    }

    return texts.length === 0 ? undefined : texts;

}

/** The JSON of a text in languages, as Styx writes it. */
export function i18nJSON(text: I18NText): JSONObject {
    const json: JSONObject = {};
    for (const [ language, value ] of text)
        set(json, language, value);
    return json;
}

/** The first text of a text in languages, or the empty text (`FirstText`). */
export const firstText = (text: I18NText | undefined): string =>
    text?.[0]?.[1] ?? '';


// Identifications, versions and their comparison.


/** An identification as WWCP_POI reads most of them: trimmed, not empty (`*_Id.TryParse`). */
export const idOf = (text: string): string | undefined => {
    const id = trimmed(text);
    return id.length > 0 ? id : undefined;
};

/** A hardware revision, firmware version or serial number: exactly as it is given, not empty, no whitespace at its ends. */
export const versionOf = (text: string): string | undefined =>
    isText(text) ? text : undefined;

/** A text as `StringComparison.OrdinalIgnoreCase` compares it: every character by its simple upper case. */
const ignoringCase = (text: string): string =>
    Array.from(text, character => {
        const upper = character.toUpperCase();
        return upper.length === character.length ? upper : character;
    }).join('');

/** Whether both are the same identification, as identifications compare: without case (`QIDigitalModel.SameId`). */
export const sameId = (left: string | undefined, right: string | undefined): boolean =>
    left !== undefined && right !== undefined && ignoringCase(left) === ignoringCase(right);

/** Whether both are the same optional text without case, or both none (`QIDigitalItem.SameText`). */
export const sameText = (left: string | undefined, right: string | undefined): boolean =>
    left === undefined ? right === undefined : sameId(left, right);

/** The given values in their given order, none twice by its key, compared ordinally (`POIJSON.Distinct`). */
export function distinct<T>(values: readonly T[], key: (value: T) => string, description: string): T[] {
    if (new Set(values.map(key)).size !== values.length)
        throw new POIError(`An ${description} must not be given twice!`);
    return [ ...values ];
}

/** Whether the text is empty or of whitespace alone, as `String.IsNullOrWhiteSpace` takes it. */
export const isBlank = (text: string): boolean =>
    trimmed(text).length === 0;

/** Whether the text contains whitespace, as `Char.IsWhiteSpace` takes it. */
export const hasWhitespace = (text: string): boolean =>
    Array.from(text).some(character => trimmed(character).length === 0);

/** The text, beginning with a capital letter (`Capitalized`). */
export const capitalized = (text: string): string =>
    text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text;
