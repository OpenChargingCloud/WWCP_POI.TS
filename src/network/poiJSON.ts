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

import { Decimal }                 from '../json/decimal.ts';
import { get, isArray, isNumber, isObject, toDecimal, type JSONObject, type JSONValue } from '../json/value.ts';
import { compactJSON, LANGUAGES, tokenText } from '../qidigital/json.ts';
import { hermodURL, type HermodURL } from './evTaler.ts';
import { ignoringCase }            from './identifications.ts';
import { trimmed }                 from './versionTexts.ts';


// The helpers with which WWCP_POI3 reads the entities of a roaming network (POIJSON, POIEntityMetadata, POIDataLicenses of
// WWCP_POI3; the ParseMandatory and ParseOptional overloads of Styx; the value types of Styx and Hermod they read with), as
// they refuse, in their words. A reader gives back the error C# names as `ErrorResponse`, or undefined; what C# throws
// instead, e.g. Newtonsoft when a text is read of a JSON object, or the constructor of an entity, it throws as `Thrown`, which
// the reader of the entity catching it in C# names in its words.


/** What C# throws while it reads an entity: an `ArgumentException` of a constructor, or an exception of Newtonsoft. */
export class Thrown extends Error {}

/** An `ArgumentException`, with its parameter as .NET names it in its message. */
export const thrown = (message: string, parameter?: string): Thrown =>
    new Thrown(parameter === undefined ? message : `${message} (Parameter '${parameter}')`);

/** An error a reader gives back, instead of the value it read. */
export class Refused {
    constructor(public readonly error: string) {}
}

/** The error of a reader, or undefined where it read the value. */
export type Checked = string | undefined;

/** The first error of the given steps, in their order. */
export function first(...steps: readonly (() => Checked)[]): Checked {
    for (const step of steps) {
        const error = step();
        if (error !== undefined)
            return error;
    }
    return undefined;
}

/** The first error of the given step for each of the given items, in their order. */
export function firstOf<T>(items: readonly T[], step: (item: T) => Checked): Checked {
    for (const item of items) {
        const error = step(item);
        if (error !== undefined)
            return error;
    }
    return undefined;
}

/** The given step, where C# catches what it throws and names it so: "The given JSON representation of an EVSE is invalid: …". */
export function caught(what: string, step: () => Checked): Checked {
    try {
        return step();
    }
    catch (e) {
        if (e instanceof Thrown)
            return `The given JSON representation of ${what} is invalid: ${e.message}`;
        throw e;
    }
}

/** The error a value a reader gave back is, or undefined. */
export const errorOf = (value: unknown): Checked =>
    value instanceof Refused ? value.error : undefined;


// ---------------------------------------------------------------------------------------------------------------------------
// JSON values as Newtonsoft gives them

export const objectsOf = (value: JSONValue | undefined): JSONObject[] =>
    isArray(value) ? value.filter(isObject) : [];

/** A value interpolated in a message (`$"'{token}'"`): a text as it is, null as nothing, an object or an array indented. */
export const interpolated = (value: JSONValue): string =>
    tokenText(value);

/** A value as `ToString(Formatting.None)` writes it, e.g. the element of an array in a message. */
export const compact = (value: JSONValue): string =>
    compactJSON(value);

const INT64_MAX = 9223372036854775807n;
const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;

/** Whether Newtonsoft reads the given number as an integer beyond Int64, a BigInteger. */
const isBigInteger = (value: JSONValue): boolean =>
    value instanceof Decimal && value.scale === 0 && (value.mantissa > INT64_MAX || value.mantissa < -INT64_MAX - 1n);

/** Whether Newtonsoft reads the given value as an integer (`JTokenType.Integer`). */
export const isIntegerToken = (value: JSONValue | undefined): boolean =>
    (typeof value === 'number' && Number.isInteger(value)) || (value instanceof Decimal && value.scale === 0);

/** What `JToken.Value<String>()` throws of an object, an array or a BigInteger. */
function castError(value: JSONValue): Thrown | undefined {
    if (isArray(value))
        return new Thrown('Cannot cast Newtonsoft.Json.Linq.JArray to Newtonsoft.Json.Linq.JToken.');
    if (isObject(value))
        return new Thrown('Cannot cast Newtonsoft.Json.Linq.JObject to Newtonsoft.Json.Linq.JToken.');
    if (isBigInteger(value))
        return new Thrown('Object must implement IConvertible.');
    return undefined;
}

/**
 * The text of a value as `JToken.Value<String>()` gives it: a text as it is, a number as written invariantly, a boolean as
 * `True` or `False`, null as none; it throws for an object, an array and an integer beyond Int64.
 */
export function valueText(value: JSONValue): string | null {

    const error = castError(value);

    if (error !== undefined)
        throw error;

    if (typeof value === 'string')
        return value;

    if (typeof value === 'boolean')
        return value ? 'True' : 'False';

    if (value === null)
        return null;

    return isNumber(value) ? value.toString() : null;

}


// ---------------------------------------------------------------------------------------------------------------------------
// Numbers

const NUMBER_ANY = /^([-+]?)(\(?)([-+]?)(?:¤?)([0-9][0-9,]*)?(?:\.([0-9]*))?(?:[eE]([-+]?[0-9]+))?(?:¤?)(\)?)([-+]?)$/u;

/**
 * A text as `Decimal.TryParse(…, NumberStyles.Any, CultureInfo.InvariantCulture)` reads it: whitespace around it, a sign
 * before or after it, parentheses for a negative one, thousands separated by commas, a decimal point, an exponent and the
 * currency sign ¤. Undefined for what it refuses; a text it reads, but this library can not hold as a decimal, e.g. of more
 * than 28 decimal places, which it rounds, is read as none at all, so that nothing it takes is refused.
 */
export function decimalOfText(text: string): Decimal | 'unknown' | undefined {

    const match = NUMBER_ANY.exec(trimmed(text));

    if (match === null)
        return undefined;

    const [ , leading = '', open = '', inner = '', integral = '', fraction, exponent, close = '', trailing = '' ] = match;

    if ((integral === '' && (fraction ?? '') === '') || (open === '(') !== (close === ')') || [ leading, inner, trailing ].filter(sign => sign !== '').length > 1)
        return undefined;

    const negative = open === '(' || leading === '-' || inner === '-' || trailing === '-';
    const digits   = integral.replace(/,/gu, '').replace(/^0+(?=[0-9])/u, '');

    try {
        const parsed = Decimal.parse(`${negative ? '-' : ''}${digits === '' ? '0' : digits}${(fraction ?? '') === '' ? '' : `.${fraction ?? ''}`}${exponent === undefined ? '' : `e${exponent}`}`);
        return parsed;
    }
    catch {
        return 'unknown';
    }

}

/** A number as a decimal, also an integer. */
const asDecimal = (value: number | Decimal): Decimal =>
    toDecimal(typeof value === 'number' && Object.is(value, -0) ? 0 : value);

/**
 * A value as Styx reads a decimal of it (`Decimal.TryParse(token.Value<String>(), NumberStyles.Any, …)`): a number, or a text
 * of one; undefined for none; it throws for an object, an array and a BigInteger.
 */
function decimalOf(value: JSONValue): Decimal | 'unknown' | undefined {

    const text = valueText(value);

    if (isNumber(value))
        return asDecimal(value);

    return text === null ? undefined : decimalOfText(text);

}

/** An optional decimal, as Styx `ParseOptional(…, out Decimal?)` reads it, also a Watt, a Volt or an Ampere: null is none. */
export function optionalDecimal(json: JSONObject, property: string, description: string): Decimal | undefined | Refused {

    const value = get(json, property);

    if (value === undefined || value === null)
        return undefined;

    const parsed = decimalOf(value);

    if (parsed === undefined)
        return new Refused(`Invalid value for '${description}'!`);

    return parsed === 'unknown' ? undefined : parsed;

}

/** A mandatory decimal, as Styx `ParseMandatory(…, out Decimal)` reads it. */
export function mandatoryDecimal(json: JSONObject, property: string, description: string): Decimal | undefined | Refused {

    const value = get(json, property);

    if (value === undefined)
        return new Refused(`Missing JSON property '${property}'!`);

    const parsed = decimalOf(value);

    if (parsed === undefined)
        return new Refused(`Invalid '${description}'!`);

    return parsed === 'unknown' ? undefined : parsed;

}

/** An optional boolean, as Styx `ParseOptional(…, out Boolean?)` reads it: also a number, or a text `Boolean.Parse` takes. */
export function optionalBoolean(json: JSONObject, property: string, description: string): Checked {

    const value = get(json, property);

    if (value === undefined || value === null || typeof value === 'boolean' || (isNumber(value) && !isBigInteger(value)))
        return undefined;

    if (typeof value === 'string' && /^(?:true|false)$/iu.test(trimmed(value).replace(/\0+$/u, '')))
        return undefined;

    return `Invalid value for '${description}'!`;

}

/** A decimal not negative (`POIJSON.TryParseNonNegative`, `TryParseSeconds`). */
export function nonNegative(json: JSONObject, property: string, description: string): Decimal | undefined | Refused {

    const value = optionalDecimal(json, property, description);

    if (value instanceof Decimal && value.mantissa < 0n)
        return new Refused(`The ${description} must not be negative!`);

    return value;

}

/** An integer as `POIJSON.TryParseInteger` reads it: an Int32; it throws for an integer beyond Int64. */
export function optionalInteger(json: JSONObject, property: string, description: string): number | undefined | Refused {

    const value = get(json, property);

    if (value === undefined)
        return undefined;

    if (!isIntegerToken(value))
        return new Refused(`The ${description} must be an integer!`);

    if (isBigInteger(value))
        throw new Thrown('Object must implement IConvertible.');

    const number = value instanceof Decimal ? Number(value.mantissa) : value as number;

    if (number < INT32_MIN || number > INT32_MAX)
        return new Refused(`The ${description} must be an integer from -2147483648 to 2147483647!`);

    return number;

}

/** The sign of a decimal: -1, 0 or 1. */
export const signOf = (value: Decimal): number =>
    value.mantissa < 0n ? -1 : value.mantissa > 0n ? 1 : 0;


// ---------------------------------------------------------------------------------------------------------------------------
// The readers of POIJSON and Styx

/** An identification, as Styx `ParseMandatory(…, TryParser)` reads it: its text trimmed, read by the given parser. */
export function mandatoryId<T>(json: JSONObject, property: string, description: string, parser: (text: string) => T | undefined): T | Refused {

    const value = get(json, property);

    if (value === undefined)
        return new Refused(`Missing JSON property '${property}'!`);

    const text   = valueText(value);
    const parsed = text === null || trimmed(text) === '' ? undefined : parser(trimmed(text));

    return parsed ?? new Refused(`Invalid '${description}'!`);

}

/** A text in languages, as Styx `ParseOptionalJSON` reads it (`POIJSON.TryParseI18N`): null is none, an object any. */
export function i18n(json: JSONObject, property: string): Checked {

    const value = get(json, property);

    return value === undefined || value === null || isObject(value) ? undefined : `JSON property '${property}' is not an object!`;

}

/**
 * The languages of a text in languages as `ImmutableI18NString.TryParse` of Styx keeps them: every text of a language, written
 * in any case, also by its number; the rest left out without a word.
 */
export function languagesOf(value: JSONValue | undefined): string[] {

    if (!isObject(value))
        return [];

    const languages = new Set<string>();

    for (const [ key, text ] of Object.entries(value)) {
        const language = trimmed(key).toLowerCase();
        if (key !== '' && typeof text === 'string' && (LANGUAGES.has(language) || /^[+-]?\d+$/u.test(language)))
            languages.add(language);
    }

    return [ ...languages ];

}

/** An optional text as `POIJSON.TryParseString` reads it: as it is, also empty. */
export function text(json: JSONObject, property: string, description: string): Checked {

    const value = get(json, property);

    return value === undefined || typeof value === 'string' ? undefined : `The ${description} must be a text!`;

}

/** An optional text as Styx `ParseOptional(…, out String?)` reads it: null is none, a number or a boolean its text. */
export function styxText(json: JSONObject, property: string, description: string): Checked {

    const value = get(json, property);

    return value === undefined || castError(value) === undefined ? undefined : `Invalid value for '${description}'!`;

}

/** An optional value given as a text, read by the given parser (`POIJSON.TryParseText`). */
export function parsedText<T>(json: JSONObject, property: string, description: string, parser: (text: string) => T | undefined): T | undefined | Refused {

    const value = get(json, property);

    if (value === undefined)
        return undefined;

    const parsed = typeof value === 'string' ? parser(value) : undefined;

    return parsed ?? new Refused(`Invalid ${description} '${interpolated(value)}'!`);

}

/** The error of an optional value given as a text, read by the given parser (`POIJSON.TryParseText`). */
export const textError = (json: JSONObject, property: string, description: string, parser: (text: string) => unknown): Checked =>
    errorOf(parsedText(json, property, description, parser));

/** Identifications or other values given as texts, read by the given parser (`POIJSON.TryParseIds`). */
export function ids<T>(json: JSONObject, property: string, description: string, parser: (text: string) => T | undefined): T[] | Refused {

    const value = get(json, property);

    if (value === undefined)
        return [];

    if (!isArray(value))
        return new Refused(`The ${description} must be a JSON array!`);

    const parsed: T[] = [];

    for (const item of value) {
        const id = typeof item === 'string' ? parser(item) : undefined;
        if (id === undefined)
            return new Refused(`Invalid ${description} '${interpolated(item)}'!`);
        parsed.push(id);
    }

    return parsed;

}

/** Values of an enumeration of flags by their exact names (`POIJSON.TryParseFlags`). */
export function flags(json: JSONObject, property: string, description: string, names: readonly string[]): Checked {

    const value = get(json, property);

    if (value === undefined)
        return undefined;

    if (!isArray(value))
        return `The ${description} must be a JSON array!`;

    const invalid = value.find(item => typeof item !== 'string' || !names.includes(item));

    return invalid === undefined ? undefined : `Invalid ${description} '${interpolated(invalid)}'!`;

}

/** A value of an enumeration by its exact name (`POIJSON.TryParseEnum`). */
export function enumeration(json: JSONObject, property: string, description: string, names: readonly string[]): Checked {

    const value = get(json, property);

    return value === undefined || (typeof value === 'string' && names.includes(value)) ? undefined : `Invalid ${description} '${interpolated(value)}'!`;

}

/** Texts as `POIJSON.TryParseStrings` reads them: as they are, in their order. */
export function texts(json: JSONObject, property: string, description: string): string[] | Refused {

    const value = get(json, property);

    if (value === undefined)
        return [];

    if (!isArray(value) || value.some(item => typeof item !== 'string'))
        return new Refused(`The ${description} must be a JSON array of texts!`);

    return value as string[];

}

/** Objects read by the given reader (`POIJSON.TryParseObjects`): an error of one named with it. */
export function objects(json: JSONObject, property: string, description: string, reader: (item: JSONObject) => Checked): Checked {

    const value = get(json, property);

    if (value === undefined)
        return undefined;

    if (!isArray(value))
        return `The ${description} must be a JSON array!`;

    for (const item of value) {

        if (!isObject(item))
            return `Invalid ${description} '${compact(item)}'!`;

        const error = reader(item);

        if (error !== undefined)
            return `Invalid ${description} '${compact(item)}': ${error}`;

    }

    return undefined;

}

/** An object read by the given reader (`POIJSON.TryParseObject`). */
export function object(json: JSONObject, property: string, description: string, reader: (item: JSONObject) => Checked): Checked {

    const value = get(json, property);

    if (value === undefined)
        return undefined;

    if (!isObject(value))
        return `The ${description} must be a JSON object!`;

    const error = reader(value);

    return error === undefined ? undefined : `Invalid ${description}: ${error}`;

}

/** The children of an entity given completely, each read by the given reader, its error as it is (`POIJSON.TryParseChildren`). */
export function children(json: JSONObject, property: string, idsProperty: string, description: string, reader: (child: JSONObject) => Checked): Checked {

    if (get(json, idsProperty) !== undefined)
        return `The ${description} must be given completely in '${property}', not by '${idsProperty}'!`;

    const value = get(json, property);

    if (value === undefined)
        return undefined;

    if (!isArray(value))
        return `The ${description} must be a JSON array!`;

    for (const item of value) {

        if (!isObject(item))
            return `The ${description} must be JSON objects!`;

        const error = reader(item);

        if (error !== undefined)
            return error;

    }

    return undefined;

}

/** The JSON-LD context of an entity: none, or the one of its kind, exactly. */
export const context = (json: JSONObject, expected: string, message: string): Checked => {
    const value = get(json, '@context');
    return value === undefined || value === expected ? undefined : message;
};

/** The JSON-LD context of a kind of entity of a roaming network, e.g. `chargingPool`. */
export const contextOf = (kind: string): string =>
    `https://open.charging.cloud/contexts/wwcp/roamingNetwork/${kind}/v1`;

/** The error, when an entity names another JSON-LD context than the one of its kind, as WWCP_POI3 names it with its id. */
export const entityContext = (json: JSONObject, kind: string, what: string, id: string): Checked =>
    context(json, contextOf(kind), `The JSON-LD context of the ${what} '${id}' must be '${contextOf(kind)}'!`);


// ---------------------------------------------------------------------------------------------------------------------------
// Timestamps (POIEntityMetadata)

const DAYS = [ 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 ];

const TIMESTAMP = /^(\d{4})-(\d{2})(?:-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?)?\s*(?:([Zz])|([+-])(\d{2})(?::?(\d{2}))?)?$/u;

/**
 * A point in time as `DateTimeOffset.TryParse(…, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal)` reads it, as
 * far as this library tells it: a date, a date and a time in the forms of ISO 8601 with a T, a space or a lower case t, an
 * optional fraction of a second, a time zone or none for UTC, whitespace around it; the milliseconds since 1970, floored.
 * .NET takes more, e.g. `10/27/2026` or `27 Oct 2026`, which this library refuses: the written form refuses them anyway.
 */
export function timestampOf(given: string): number | undefined {

    const match = TIMESTAMP.exec(given.replace(/^[\s\0]+|[\s\0]+$/gu, ''));

    if (match === null)
        return undefined;

    const [ , year, month, day = '01', hour = '00', minute = '00', second = '00', fraction = '', , sign, offsetHours = '00', offsetMinutes = '00' ] = match;

    const y = Number(year), m = Number(month), d = Number(day), h = Number(hour), min = Number(minute), s = Number(second);
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

    if (y < 1 || m < 1 || m > 12 || d < 1 || d > (m === 2 && leap ? 29 : DAYS[m - 1] ?? 0) || h > 23 || min > 59 || s > 59)
        return undefined;

    const offset = (Number(offsetHours) * 60 + Number(offsetMinutes)) * (sign === '-' ? -1 : 1);

    if (Number(offsetMinutes) > 59 || Math.abs(offset) > 14 * 60)
        return undefined;

    const date = new Date(0);
    date.setUTCFullYear(y, m - 1, d);
    date.setUTCHours(h, min, s, Number(fraction.padEnd(3, '0').slice(0, 3)));

    const time = date.getTime() - offset * 60_000;

    return time < MIN_TIME || time > MAX_TIME ? undefined : time;

}

/** The earliest and the latest point in time a `DateTimeOffset` holds, in UTC, to the millisecond. */
const MIN_TIME = -62135596800000;
const MAX_TIME = 253402300799999;

/** A point in time as `POIEntityMetadata.TryParseTimestamp` reads it, of the given description, e.g. "creation timestamp". */
export function timestamp(json: JSONObject, property: string, description: string): number | undefined | Refused {

    const value = get(json, property);

    if (value === undefined)
        return undefined;

    const time = typeof value === 'string' ? timestampOf(value) : undefined;

    return time ?? new Refused(`Invalid ${description} '${interpolated(value)}'!`);

}

/** The identification of an entity as its metadata names it: ` of 'DE*GEF'`, where it is a value. */
const ofId = (json: JSONObject): string => {
    const id = get(json, '@id');
    return id === undefined || isObject(id) || isArray(id) ? '' : ` of '${interpolated(id)}'`;
};

/** The custom data of an entity: an object. */
const customData = (json: JSONObject): Checked =>
    get(json, 'customData') === undefined || isObject(get(json, 'customData')) ? undefined : 'The custom data must be a JSON object!';

/** The timestamps and the custom data of an entity (`POIEntityMetadata.TryParse`): created, then lastChange, then custom data. */
export function metadata(json: JSONObject): Checked {

    if (get(json, 'created') === undefined)
        return `The creation timestamp 'created'${ofId(json)} is missing!`;

    return errorOf(timestamp(json, 'created', 'creation timestamp')) ??
           errorOf(timestamp(json, 'lastChange', 'last change timestamp')) ??
           customData(json);

}

/** The custom data of what has no timestamps (`POIEntityMetadata.TryParse(JSON, out CustomData, …)`). */
export function withoutTimestamps(json: JSONObject): Checked {

    for (const property of [ 'created', 'lastChange' ])
        if (get(json, property) !== undefined)
            return `'${interpolated(get(json, '@id') ?? '')}' has no timestamps: '${property}' is not allowed!`;

    return customData(json);

}


// ---------------------------------------------------------------------------------------------------------------------------
// Value types of Styx and Hermod

/** A URL as Hermod reads it (`URL.TryParse`). */
export const url = (text: string): HermodURL | undefined =>
    hermodURL(text);

/** A phone number as Styx reads it (`PhoneNumber.TryParse`): five digits, spaces, dashes or slashes in a row, somewhere. */
export const phoneNumber = (given: string): string | undefined =>
    trimmed(given) !== '' && /\+?[0-9 \-/]{5,30}/u.test(trimmed(given)) ? trimmed(given) : undefined;

/** An e-mail address as Hermod reads it (`EMailAddress.Parse`): a user and a domain, a name before it in angle brackets. */
export function eMailAddress(given: string): string | undefined {

    const text  = trimmed(given);

    if (text === '')
        return undefined;

    const open  = text.indexOf('<');
    const close = text.indexOf('>');
    const address = open >= 0 && close > open ? trimmed(text.slice(open + 1, close)) : text;

    return address.includes('@') && /^<?([^@]+)@([^@>]+)>?$/u.test(trimmed(address)) ? text : undefined;

}

/** An optional e-mail address (`POIJSON.TryParseEMailAddress`). */
export function eMailAddressError(json: JSONObject, property: string, description: string): Checked {

    const value = get(json, property);

    if (value === undefined)
        return undefined;

    if (typeof value !== 'string')
        return `Invalid ${description} '${interpolated(value)}'!`;

    return eMailAddress(value) === undefined ? `Invalid ${description} '${value}'!` : undefined;

}

/** A text not empty once trimmed, trimmed: the identifications WWCP_POI takes as free texts. */
export const nonEmpty = (text: string): string | undefined =>
    trimmed(text) === '' ? undefined : trimmed(text);

/** A text not empty, without whitespace around it, as it is: HardwareRevision, FirmwareVersion, SerialNumber. */
export const exactText = (text: string): string | undefined =>
    trimmed(text) === '' || trimmed(text) !== text ? undefined : text;

/** The ISO 3166 alpha-2 codes of the countries of Styx (`Country.TryParseAlpha2Code`), with AN, CP, UK and YY. */
export const COUNTRIES = new Set(`AD AE AF AG AI AL AM AN AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BR BS BT BV
    BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CP CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE
    GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ
    LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ
    OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SY SZ TC TD TF TG TH
    TJ TK TL TM TN TO TR TT TV TW TZ UA UG UK UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT YY ZA ZM ZW`.trim().split(/\s+/u));

/** The ISO 4217 codes of the currencies of Styx, as `Currency.TryParseISO` takes them, trimmed, with case. */
export const CURRENCIES = new Set(`EUR CHF USD CZK GBP HRK PLN RON RSD RUB SEK AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF
    BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CLP CNY COP CRC CUP CVE DJF DKK DOP DZD EGP ERN ETB FJD FKP GEL GHS GIP GMD GNF GTQ GYD HKD
    HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP
    MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PYG QAR RWF SAR SBD SCR SDG SGD SHP SLE SOS SRD SSP STN SVC
    SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX UYU UZS VED VES VND VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW ZWG`.trim().split(/\s+/u));

/** A currency as `Currency.TryParseISO` reads it. */
export const currency = (text: string): string | undefined =>
    CURRENCIES.has(trimmed(text)) ? trimmed(text) : undefined;


// ---------------------------------------------------------------------------------------------------------------------------
// Identifications

/** An identification as its C# type reads it: its text (`ToString`) and the key its `Equals` compares. */
export interface Id {
    readonly text:  string;
    readonly key:   string;
}

/** An identification of a free text: trimmed, compared without case, e.g. `EnergyMeter_Id`. */
export const freeId = (given: string): Id | undefined => {
    const id = nonEmpty(given);
    return id === undefined ? undefined : { text: id, key: ignoringCase(id) };
};

/** An identification of a free text compared with case, e.g. `ParkingProduct_Id`. */
export const caseId = (given: string): Id | undefined => {
    const id = nonEmpty(given);
    return id === undefined ? undefined : { text: id, key: id };
};

/** The identification of a charging station operator (`ChargingStationOperator_Id`), e.g. `DE*GEF`. */
export function operatorId(given: string): Id | undefined {

    const match = /^([A-Z]{2})\*?([A-Z0-9]{3})$/u.exec(trimmed(given).toUpperCase());

    if (match === null || !COUNTRIES.has(match[1] ?? ''))
        return undefined;

    const text = `${match[1] ?? ''}*${match[2] ?? ''}`;

    return { text, key: text };

}

/** The identification of an e-mobility provider (`EMobilityProvider_Id`): its separator kept, compared without it. */
export function providerId(given: string): Id | undefined {

    const match = /^([A-Z]{2})([*-]?)([A-Z0-9]{3})$/u.exec(trimmed(given).toUpperCase());

    if (match === null || !COUNTRIES.has(match[1] ?? ''))
        return undefined;

    return { text: `${match[1] ?? ''}${match[2] ?? ''}${match[3] ?? ''}`, key: `${match[1] ?? ''}*${match[3] ?? ''}` };

}

/** The identification of a grid operator (`GridOperator_Id`), as one of a charging station operator. */
export const gridOperatorId = operatorId;

/**
 * The identification of a member of a charging station operator: a charging pool (`P`), a charging station (`S`), an EVSE
 * (`E`), with its operator, compared without case and without the stars of its suffix.
 */
const memberId = (letter: string) => {

    const pattern = new RegExp(`^([a-zA-Z]{2}\\*?[a-zA-Z0-9]{3})\\*?${letter}([a-zA-Z0-9][a-zA-Z0-9*]{0,29})$`, 'u');

    return (given: string): Id | undefined => {

        const match = pattern.exec(trimmed(given));
        const op    = match === null ? undefined : operatorId(match[1] ?? '');

        if (match === null || op === undefined)
            return undefined;

        return { text: `${op.text}*${letter}${match[2] ?? ''}`, key: `${op.key}*${letter}${ignoringCase((match[2] ?? '').replace(/\*/gu, ''))}` };

    };

};

export const poolId     = memberId('P');
export const stationId  = memberId('S');
export const evseId     = memberId('E');

const SUFFIX     = '([a-zA-Z0-9_][a-zA-Z0-9_*\\-.€$]{0,49})';
const TARIFF_ID  = new RegExp(`^([a-zA-Z]{2}\\*?[a-zA-Z0-9]{3})\\*?T${SUFFIX}$`, 'u');

/** The identification of a charging tariff (`ChargingTariff_Id`): trimmed, compared without case and the stars of its suffix. */
export function tariffId(given: string): Id | undefined {

    const match = TARIFF_ID.exec(trimmed(given));
    const op    = match === null ? undefined : operatorId(match[1] ?? '');

    if (match === null || op === undefined)
        return undefined;

    return { text: `${op.text}*T${match[2] ?? ''}`, key: `${op.key}*T${ignoringCase((match[2] ?? '').replace(/\*/gu, ''))}` };

}

/**
 * The identification of a template or a group of a charging station operator, e.g. `ST` of a charging station template:
 * untrimmed, compared without case; a group may separate its operator with a dash.
 */
const ownedId = (letters: string, dash = false) => {

    const pattern = new RegExp(`^([A-Za-z]{2}${dash ? '[*\\-]' : '\\*'}?[A-Za-z0-9]{3})\\*?${letters}${SUFFIX}$`, 'u');

    return (given: string): Id | undefined => {

        if (trimmed(given) === '')
            return undefined;

        const match = pattern.exec(given);
        const op    = match === null ? undefined : operatorId((match[1] ?? '').replace('-', '*'));

        if (match === null || op === undefined)
            return undefined;

        return { text: `${op.text}*${letters}${match[2] ?? ''}`, key: `${op.key}*${letters}${ignoringCase(match[2] ?? '')}` };

    };

};

export const evseTemplateId     = ownedId('ET');
export const stationTemplateId  = ownedId('ST');
export const poolTemplateId     = ownedId('PT');
export const tariffTemplateId   = ownedId('TT');
export const tariffGroupId      = ownedId('TG');
export const evseGroupId        = ownedId('EG', true);
export const stationGroupId     = ownedId('SG', true);
export const poolGroupId        = ownedId('PG', true);

/** The operator of an identification of a member, a template or a group, e.g. `DE*GEF` of `DE*GEF*E1*1`. */
export const operatorOf = (id: Id): string =>
    id.text.slice(0, 6);

/** The identifications of the given kind the given texts are, as their type reads them; those it refuses left out. */
export const idsOf = (values: JSONValue | undefined, parser: (text: string) => Id | undefined): Id[] =>
    (isArray(values) ? values : []).flatMap(value => {
        const id = typeof value === 'string' ? parser(value) : undefined;
        return id === undefined ? [] : [ id ];
    });

/** The identification of the given kind of an entity, as its type reads it; undefined for none. */
export const idOf = (entity: JSONObject, parser: (text: string) => Id | undefined, property = '@id'): Id | undefined => {
    const value = get(entity, property);
    const text  = typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' || value instanceof Decimal ? valueText(value) : null;
    return text === null ? undefined : parser(property === '@id' ? trimmed(text) : text);
};

/** The first of the given identifications given before, by the key of its type (`POIJSON.OrderedIds`, `UniqueIds`). */
export function twice<T extends { readonly key: string }>(items: readonly T[]): T | undefined {
    const seen = new Set<string>();
    for (const item of items) {
        if (seen.has(item.key))
            return item;
        seen.add(item.key);
    }
    return undefined;
}

/** The error of `POIJSON.OrderedIds`, `UniqueIds` and `Distinct`, of the given description, e.g. "A facility of the charging pool 'X'". */
export const givenTwice = (items: readonly { readonly key: string }[], description: string): Thrown | undefined =>
    twice(items) === undefined ? undefined : new Thrown(`${description} must not be given twice!`);

/** Throws the given exception, if any. */
export function raise(error: Thrown | undefined): void {
    if (error !== undefined)
        throw error;
}

/** Texts compared as their type compares them, e.g. without case. */
export const keyed = (values: readonly string[], key: (text: string) => string = ignoringCase): Id[] =>
    values.map(value => ({ text: value, key: key(value) }));
