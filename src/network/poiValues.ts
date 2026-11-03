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

import { Decimal }                from '../json/decimal.ts';
import { parseJSON }              from '../json/parse.ts';
import { get, isArray, isNumber, isObject, type JSONObject, type JSONValue } from '../json/value.ts';
import { fromBase64, toBase64, toHex } from '../encoding/text.ts';
import { hash }                   from '../crypto/hash.ts';
import { LANGUAGES }              from '../qidigital/json.ts';
import { countryOf }              from './countries.ts';
import { caught, children, context, contextOf, eMailAddressError, entityContext, errorOf, freeId, i18n,
         interpolated, languagesOf, mandatoryId, nonEmpty, phoneNumber, Refused, styxText, text,
         textError, texts, Thrown, timestampOf, url, valueText, withoutTimestamps, type Checked } from './poiJSON.ts';
import { trimmed }                from './versionTexts.ts';


// The values WWCP_POI3 reads within its entities, as Styx, Hermod and WWCP_POI read them, in their words: addresses, geo
// locations, the contact of a party, data licenses, images, opening times, energy mixes, brands, measurement public keys,
// transparency software assignments, authentication modes and related locations.


// ---------------------------------------------------------------------------------------------------------------------------
// Languages, addresses and geo locations

/** A language as `Enum.TryParse<Languages>(…, ignoreCase)` takes it: by its name in any case, by a number, or a list of them. */
const isLanguage = (key: string, ignoreCase: boolean): boolean =>
    key.split(',').every(part => {
        const name = trimmed(part);
        return /^[+-]?\d+$/u.test(name) || LANGUAGES.has(ignoreCase ? name.toLowerCase() : name);
    });

/** A text in languages as Styx `ParseMandatory(…, out I18NString)` reads it, e.g. the city of an address. */
function mandatoryI18N(json: JSONObject, property: string, description: string): Checked {

    const value = get(json, property);

    if (value === undefined)
        return `Missing property '${property}'!`;

    if (!isObject(value))
        return 'Invalid i18n JSON string provided!';

    for (const [ key, item ] of Object.entries(value))
        if (!isLanguage(key, true) || valueText(item) === null)
            return `Invalid '${description}'!`;

    return undefined;

}

/** A mandatory text, as Styx `ParseMandatoryText` reads it: trimmed, also empty. */
function mandatoryText(json: JSONObject, property: string, description: string): Checked {

    const value = get(json, property);

    if (value === undefined)
        return `Missing property '${description}'!`;

    return typeof value === 'string' ? undefined : `Invalid '${description}'!`;

}

/** The comment of an address, as Styx `ParseOptional(…, out I18NString?)` reads it: languages by their exact names. */
function comment(json: JSONObject): Checked {

    const value = get(json, 'comment');

    if (value === undefined || value === null)
        return undefined;

    if (!isObject(value))
        return "JSON property 'comment' is not a I18N string!";

    for (const [ key, item ] of Object.entries(value)) {

        if (!isLanguage(key, false))
            return `Invalid language '${key}'!`;

        try {
            if (valueText(item) === null)
                return "Invalid text value ''!";
        }
        catch (e) {
            if (e instanceof Thrown)
                return "Invalid I18N value for 'comment'!";
            throw e;
        }

    }

    return undefined;

}

/** The official languages of an address, as Styx `ParseOptionalEnums<Languages>` reads them. */
function officialLanguages(json: JSONObject): Checked {

    const value = get(json, 'officialLanguages');

    if (value === undefined || value === null)
        return undefined;

    if (!isArray(value))
        return "Invalid 'official languages'!";

    for (const item of value) {
        const language = valueText(item);
        if (language === null || !isLanguage(language, true))
            return "Invalid value for 'official languages'!";
    }

    return undefined;

}

/**
 * An address as `Address.TryParse` of Styx reads it: a street, a country, a postal code and a city, then what it may name.
 */
const address = (json: JSONObject): Checked =>
    caught('an address', () => {

        if (Object.keys(json).length === 0)
            return 'The given JSON object must not be null or empty!';

        return mandatoryText(json, 'street', 'street') ??
               errorOf(mandatoryId(json, 'country', 'country', countryOf)) ??
               mandatoryText(json, 'postalCode', 'postal code') ??
               mandatoryI18N(json, 'city', 'city') ??
               styxText(json, 'houseNumber',   'house number') ??
               styxText(json, 'floorLevel',    'floor level') ??
               styxText(json, 'region',        'region') ??
               styxText(json, 'postalCodeSub', 'postal code sub') ??
               timeZone(json) ??
               comment(json) ??
               officialLanguages(json);

    });

/** The time zone of an address, as `Time_Zone.TryParse` takes it: a text not empty, also of a value given otherwise. */
function timeZone(json: JSONObject): Checked {
    const value = get(json, 'timeZone');
    return typeof value === 'string' && trimmed(value) === '' ? 'Invalid time zone!' : undefined;
}

/** An optional address (`POIJSON.TryParseAddress`). */
export function addressError(json: JSONObject, property: string, description: string): Checked {

    const value = get(json, property);

    if (value === undefined)
        return undefined;

    if (!isObject(value))
        return `The ${description} must be a JSON object!`;

    const error = address(value);

    return error === undefined ? undefined : `Invalid ${description}: ${error}`;

}

/**
 * A number of a geo location as `JToken.Value<Double>()` reads it: a number, a boolean, or a text `Double.Parse` takes,
 * thousands separated by commas; its error otherwise, as .NET words it.
 */
export function doubleOf(value: JSONValue): number | Refused {

    if (value === null)
        return new Refused('Null object cannot be converted to a value type.');

    const given = valueText(value) ?? '';

    if (typeof value === 'boolean')
        return value ? 1 : 0;

    if (isNumber(value))
        return Number(given);

    const number = trimmed(given);

    if (/^[-+]?(?:infinity|∞)$/iu.test(number))
        return number.startsWith('-') ? -Infinity : Infinity;

    if (/^[-+]?nan$/iu.test(number))
        return NaN;

    if (!/^[-+]?(?=[0-9,]*\.?[0-9])[0-9,]*(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/u.test(number) || number.replace(/^[-+]/u, '').startsWith(','))
        return new Refused(`The input string '${given}' was not in a correct format.`);

    return Number(number.replace(/,/gu, ''));

}

/** A geo coordinate as `GeoCoordinate.TryParse` of Styx reads it: a latitude and a longitude in their ranges, an altitude. */
function geoCoordinate(json: JSONObject): Checked {

    // JSON null is a value of Newtonsoft, which `??` of C# does not pass by.
    const component = (short: string, long: string): JSONValue | undefined =>
        get(json, short) !== undefined ? get(json, short) : get(json, long);

    const lat = component('lat', 'latitude');
    const lng = component('lng', 'longitude');
    const alt = component('alt', 'altitude');

    if (lat === undefined || lng === undefined)
        return 'error!';

    try {

        const values = [ lat, lng, ...(alt === undefined ? [] : [ alt ]) ].map(doubleOf);
        const error  = values.find(value => value instanceof Refused);

        if (error !== undefined)
            return error.error;

        const [ latitude = 0, longitude = 0 ] = values as number[];

        if (latitude < -90 || latitude > 90)
            return "Invalid 'latitude' value!";

        if (longitude < -180 || longitude > 180)
            return "Invalid 'longitude' value!";

        return undefined;

    }
    catch (e) {
        if (e instanceof Thrown)
            return e.message;
        throw e;
    }

}

/** An optional geo location (`POIJSON.TryParseGeoLocation`), e.g. "geo location". */
export function geoLocationError(json: JSONObject, property: string, description: string): Checked {

    const value = get(json, property);

    if (value === undefined)
        return undefined;

    if (!isObject(value))
        return `The ${description} must be a JSON object!`;

    const error = geoCoordinate(value);

    return error === undefined ? undefined : `Invalid ${description}: ${error}`;

}


// ---------------------------------------------------------------------------------------------------------------------------
// Data licenses and the contact of a party

/** The data licenses WWCP_POI knows by their identifications alone. */
const KNOWN_DATA_LICENSES = [ 'None', 'PDDL', 'ODC-By', 'ODbL', 'dl-de/by-2-0', 'dl-de/zero-2-0', 'GeoLizenz_V1.3', 'CC BY 4.0', 'CC BY-SA 4.0',
                              'CC BY-ND 4.0', 'CC BY-NC 4.0', 'CC BY-NC-SA 4.0', 'CC BY-NC-ND 4.0' ].map(id => id.toUpperCase());

/** A data license given completely, as `DataLicense.TryParse` of Hermod reads it; its identification, or its error. */
function dataLicense(json: JSONObject): string | Refused {

    try {

        if (Object.keys(json).length === 0)
            return new Refused('The given JSON object must not be null or empty!');

        const id = mandatoryId(json, get(json, '@id') === undefined ? 'id' : '@id', 'Open Data license identification', nonEmpty);

        if (id instanceof Refused)
            return id;

        const description = get(json, 'description');

        if (description !== undefined && description !== null && !isObject(description)) {
            const given = typeof description === 'string' ? description : valueText(description) ?? '';
            if (trimmed(given) === '')
                return new Refused(`The value '${interpolated(description)}' is not valid for JSON property 'Open Data license description': Empty input!`);
            let parsed: JSONValue | undefined;
            try { parsed = parseJSON(given); } catch { parsed = undefined; }
            if (!isObject(parsed))
                return new Refused(`The value '${interpolated(description)}' is not valid for JSON property 'Open Data license description': Error reading JObject from JsonReader.`);
        }

        const urls = get(json, 'URLs');

        if (urls !== undefined && urls !== null) {

            if (!isArray(urls))
                return new Refused("The given property 'Open Data license URLs' is not a valid JSON array!");

            let failures = 0;

            for (const item of urls) {
                const given = trimmed(valueText(item) ?? '');
                if (given === '')
                    return new Refused('A given value within the array is null or empty!');
                if (url(given) === undefined)
                    failures++;
            }

            if (failures > 0)
                return new Refused(Array.from({ length: failures }, () => 'Could not parse the given item!').join('\n'));

        }

        return id;

    }
    catch (e) {
        if (e instanceof Thrown)
            return new Refused(`The given JSON representation of an Open Data license is invalid: ${e.message}`);
        throw e;
    }

}

/** The data licenses of an entity (`POIDataLicenses.TryParse`): given completely, then by their identifications, each once. */
export function dataLicenses(json: JSONObject): Checked {

    const given      = new Set<string>();
    const licenses   = get(json, 'dataLicenses');
    const licenseIds = get(json, 'dataLicenseIds');

    if (licenses !== undefined) {

        if (!isArray(licenses))
            return 'The data licenses must be a JSON array!';

        for (const license of licenses) {

            if (!isObject(license))
                return 'A data license must be a JSON object!';

            const id = dataLicense(license);

            if (id instanceof Refused)
                return `Invalid data license: ${id.error}`;

            if (given.has(id))
                return `The data license '${id}' must not be given twice!`;

            given.add(id);

        }

    }

    if (licenseIds !== undefined) {

        if (!isArray(licenseIds))
            return 'The data license identifications must be a JSON array!';

        for (const item of licenseIds) {

            const id = typeof item === 'string' ? nonEmpty(item) : undefined;

            if (id === undefined)
                return `Invalid data license identification '${interpolated(item)}'!`;

            if (!KNOWN_DATA_LICENSES.includes(id.toUpperCase()))
                return `The data license '${id}' is not well-known, so it must be given completely!`;

            if (given.has(id))
                return `The data license '${id}' must not be given twice!`;

            given.add(id);

        }

    }

    return undefined;

}

/** The logos of a party: one at most, with its URI. */
function logos(json: JSONObject): Checked {

    const value = get(json, 'logos');

    if (value === undefined)
        return undefined;

    if (!isArray(value) || value.length > 1 || (value.length === 1 && !isObject(value[0])))
        return 'The logos must be a JSON array of at most one logo object!';

    const logo = value[0];

    if (!isObject(logo))
        return undefined;

    return textError(logo, 'uri', 'logo URI', url) ?? (get(logo, 'uri') === undefined ? 'A logo requires an URI!' : undefined);

}

/** The contact of a party (`POIJSON.TryParseContact`), in its order. */
export const contact = (json: JSONObject): Checked =>
    logos(json) ??
    addressError(json, 'address', 'address') ??
    geoLocationError(json, 'geoLocation', 'geo location') ??
    textError(json, 'telephone', 'telephone number', phoneNumber) ??
    eMailAddressError(json, 'eMailAddress', 'e-mail address') ??
    textError(json, 'homepage', 'homepage', url) ??
    textError(json, 'hotline', 'hotline phone number', phoneNumber) ??
    textError(json, 'termsAndConditions', 'terms and conditions URL', url) ??
    dataLicenses(json);


// ---------------------------------------------------------------------------------------------------------------------------
// Images, opening times, energy mixes

/** A content type as Hermod reads it (`HTTPContentType.TryParse`): a main and a sub type, a boundary of a multipart one. */
function contentType(given: string): string | undefined {

    const parts = given.split(';').map(part => trimmed(part)).filter(part => part !== '');

    if ((parts[0] ?? '').split('/').length < 2 || parts.some(part => part.toLowerCase().startsWith('boundary') && !part.includes('----')))
        return undefined;

    return given;

}

/** A number of an image as Styx `ParseOptional(…, out UInt16?)` reads it. */
function uint16(json: JSONObject, property: string, description: string): Checked {

    const value = get(json, property);

    if (value === undefined || value === null)
        return undefined;

    const given = trimmed(valueText(value) ?? '');

    return /^(?:\+?\d+|-0+)$/u.test(given) && Number(given) <= 65535 ? undefined : `Invalid value for '${description}'!`;

}

/** An image as `Image.TryParse` of WWCP_POI2 reads it. */
export const image = (json: JSONObject): Checked =>
    caught('an image', () => {

        if (Object.keys(json).length === 0)
            return 'The given JSON object must not be null or empty!';

        const thumbnail = get(json, 'thumbnail');

        return context(json, 'https://open.charging.cloud/contexts/wwcp+json/image', "The JSON-LD context of the image must be 'https://open.charging.cloud/contexts/wwcp+json/image'!") ??
               errorOf(mandatoryId(json, 'url', 'url', url)) ??
               errorOf(mandatoryId(json, 'category', 'image category', nonEmpty)) ??
               errorOf(mandatoryId(json, 'type', 'image type', contentType)) ??
               uint16(json, 'width',  'image width') ??
               uint16(json, 'height', 'image height') ??
               (thumbnail === undefined || thumbnail === null || url(valueText(thumbnail) ?? '') !== undefined
                    ? undefined
                    : `The value '${interpolated(thumbnail)}' is not valid for JSON property 'image thumbnail'!`);

    });

const WEEKDAYS = [ 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday' ];

/** An hour and a minute as `HourMin.TryParse` of Styx reads them, e.g. `08:00`; [ hour, minute ] or undefined. */
export function hourMin(given: string): readonly [ number, number ] | undefined {

    const parts = given.split(':');

    if (trimmed(given) === '' || parts.length !== 2 || parts.some(part => !/^\s*(?:\+?\d+|-0+)\s*$/u.test(part)))
        return undefined;

    const [ hour = 0, minute = 0 ] = parts.map(part => Number(trimmed(part)));

    return hour <= 23 && minute <= 59 ? [ hour, minute ] : undefined;

}

export const hhmm = ([ hour, minute ]: readonly [ number, number ]): string =>
    `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

/** Opening times as `OpeningTimes.TryParse` of Styx reads them; what its constructors throw named by it once more. */
export function openingTimes(json: JSONObject): Checked {

    const unknown = Object.keys(json).find(key => ![ '24/7', 'regularOpenings', 'exceptionalOpenings', 'exceptionalClosings', 'freeText' ].includes(key));

    if (unknown !== undefined)
        return `Unknown property '${unknown}' of opening times!`;

    const regular = get(json, 'regularOpenings');
    const days    = new Set<string>();

    if (regular !== undefined) {

        if (!isArray(regular))
            return 'The regular openings must be a JSON array!';

        for (const opening of regular) {

            if (!isObject(opening) || Object.keys(opening).length !== 1)
                return 'A regular opening must be a JSON object with one weekday!';

            const [ day = '', periods ] = Object.entries(opening)[0] ?? [];

            if (!WEEKDAYS.includes(day) || !isArray(periods))
                return `Invalid regular opening '${day}'!`;

            if (days.has(day))
                return `The weekday '${day}' must not be given twice!`;

            days.add(day);

            for (const period of periods) {

                const begin = isObject(period) && typeof period['begin'] === 'string' ? hourMin(period['begin']) : undefined;
                const end   = isObject(period) && typeof period['end']   === 'string' ? hourMin(period['end'])   : undefined;

                if (begin === undefined || end === undefined)
                    return `Invalid regular hours '${interpolated(period)}' on ${day}!`;

                if ((end[0] < begin[0] && end[0] !== 0) || (end[0] === begin[0] && end[1] < begin[1] && end[1] !== 0))
                    return `Invalid opening times: The end period '${hhmm(end)}h' must be after the start period '${hhmm(begin)}h'! (Parameter 'PeriodEnd')`;

            }

        }

    }

    const always = get(json, '24/7');

    if (always !== undefined && always !== (days.size === 0))
        return days.size === 0 ? "'24/7' must be true without regular openings!" : "'24/7' must be false with regular openings!";

    for (const key of [ 'exceptionalOpenings', 'exceptionalClosings' ]) {

        const periods = get(json, key);

        if (periods === undefined)
            continue;

        if (!isArray(periods))
            return `The ${key} must be a JSON array!`;

        for (const period of periods) {
            const parts = typeof period === 'string' ? period.split(' -> ') : [];
            const [ begin, end ] = parts.map(part => timestampOf(part));
            if (parts.length !== 2 || begin === undefined || end === undefined || end < begin)
                return `Invalid period '${interpolated(period)}' of the ${key}, expected 'begin -> end'!`;
        }

    }

    const freeText = get(json, 'freeText');

    return freeText === undefined || typeof freeText === 'string' ? undefined : 'The free text of opening times must be a text!';

}

/** A percentage as `Single.TryParse(…, NumberStyles.Float, …)` reads it; undefined for none. */
function single(given: string): number | undefined {
    const number = trimmed(given);
    if (/^[-+]?(?:infinity|∞)$/iu.test(number)) return number.startsWith('-') ? -Infinity : Infinity;
    if (/^[-+]?nan$/iu.test(number)) return NaN;
    return /^[-+]?(?=\.?[0-9])[0-9]*(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/u.test(number) ? Math.fround(Number(number)) : undefined;
}

/** The pairs of an energy mix, e.g. its energy sources (`PercentageOfExtensions.TryParse`, `EnvironmentalImpactAmountExtensions.TryParse`). */
function pairs(json: JSONObject, property: string, what: string, valueError: (value: JSONValue | undefined) => string | undefined, valueMessage: string, kind: string): Checked {

    const value = get(json, property);

    if (!isArray(value))
        return `The '${property}' property must be an array!`;

    const seen = new Set<string>();

    for (const [ index, pair ] of value.entries()) {

        const at = `${property}[${String(index)}]`;

        if (!isArray(pair))
            return `${at}: expected an array of the ${what}!`;

        if (pair.length !== 2)
            return property === 'energySources'
                       ? `${at}: Expected an array of exactly two elements: the value and the percentage, e.g. ["solar", "42.5 %"]!`
                       : `${at}: expected an array of exactly two elements: the environmental impact and its amount, e.g. ["CarbonDioxide", "350 g/kWh"]!`;

        const [ name, amount ] = pair;
        const category = typeof name === 'string' ? nonEmpty(name) : undefined;

        if (category === undefined)
            return `${at}[0]: expected a valid ${kind} string!`;

        const error = valueError(amount);

        if (error !== undefined)
            return `${at}[1]: ${error === '' ? valueMessage : error}`;

        if (seen.has(category.toUpperCase()))
            return `${at}[0]: the ${property === 'energySources' ? 'energy source' : 'environmental impact'} '${category}' must not be given twice!`;

        seen.add(category.toUpperCase());

    }

    return undefined;

}

/** An energy mix as `EnergyMix.TryParse` of WWCP_POI2 reads it: its error without a word of its own. */
export function energyMix(json: JSONObject): Checked {

    try {

        if (Object.keys(json).length === 0)
            return 'The given JSON object must not be null or empty!';

        const percentage = (value: JSONValue | undefined): string | undefined => {
            const given = typeof value === 'string' ? trimmed(value) : undefined;
            const share = given?.endsWith('%') === true ? single(given.slice(0, -1)) : undefined;
            if (share === undefined)
                return '';
            return !Number.isFinite(share) || share < 0 || share > 100 ? 'expected a percentage between 0 and 100!' : undefined;
        };

        const amountOf = (value: JSONValue | undefined): string | undefined => {
            const given  = typeof value === 'string' ? trimmed(value) : undefined;
            const number = given?.endsWith('g/kWh') === true ? trimmed(given.slice(0, -5)) : undefined;
            if (number === undefined || !/^[-+]?(?=\.?[0-9])[0-9]*(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/u.test(number))
                return '';
            return Number(number) < 0 ? 'expected an amount not below 0!' : undefined;
        };

        const remarks = get(json, 'additionalRemarks');

        return pairs(json, 'energySources', 'energy source and its percentage', percentage, 'expected a percentage string with \'%\' unit, e.g. "42.5 %"!', 'EnergySourceCategory') ??
               pairs(json, 'environmentalImpacts', 'environmental impact and its amount', amountOf, 'expected an amount string with \'g/kWh\' unit, e.g. "350 g/kWh"!', 'environmental impact') ??
               mandatoryI18N(json, 'supplierName', 'supplier name') ??
               mandatoryI18N(json, 'productName', 'product name') ??
               additionalRemarks(remarks);

    }
    catch (e) {
        if (e instanceof Thrown)
            return e.message;
        throw e;
    }

}

/** The additional remarks of an energy mix: a text in languages, also as a JSON text of one. */
function additionalRemarks(value: JSONValue | undefined): Checked {

    if (value === undefined || value === null || isObject(value))
        return undefined;

    const given = valueText(value) ?? '';
    const of    = `The value '${interpolated(value)}' is not valid for JSON property 'additional remarks': `;

    if (trimmed(given) === '')
        return `${of}Empty input!`;

    let parsed: JSONValue | undefined;
    try { parsed = parseJSON(given); } catch { parsed = undefined; }

    return isObject(parsed) ? undefined : `${of}Error reading JObject from JsonReader.`;

}


// ---------------------------------------------------------------------------------------------------------------------------
// Brands, keys of measurements, transparency software assignments, authentication modes, related locations

/** A brand as `Brand.TryParse` reads it: with its name. */
export const brand = (json: JSONObject): Checked =>
    caught('a brand', () => {

        const id = mandatoryId(json, '@id', 'brand identification', freeId);

        if (id instanceof Refused)
            return id.error;

        return entityContext(json, 'brand', 'brand', id.text) ??
               i18n(json, 'name') ??
               i18n(json, 'description') ??
               textError(json, 'logo', 'logo', url) ??
               textError(json, 'homepage', 'homepage', url) ??
               (languagesOf(get(json, 'name')).length === 0 ? `The brand '${id.text}' needs its name!` : undefined) ??
               withoutTimestamps(json);

    });

/** The brands of an entity (`POIJSON.TryParseChildren` of `brands`). */
export const brands = (json: JSONObject): Checked =>
    children(json, 'brands', 'brandIds', 'brands', brand);

/** The bytes of a text in Base64 as `Convert.FromBase64String` reads it; an error naming what it is otherwise. */
function base64(given: string, what: string): Uint8Array | Refused {

    let bytes: Uint8Array;

    try {
        bytes = fromBase64(given.replace(/[ \t\r\n]/gu, ''));
    }
    catch {
        return new Refused(`The ${what} of a measurement public key must be given as Base64!`);
    }

    return toBase64(bytes) === given ? bytes : new Refused(`The ${what} of a measurement public key must be given as canonical Base64!`);

}

/**
 * A key of measurements as `MeasurementPublicKey.TryParse` reads it: its identification the SHA-256 of its key, in Base64.
 * Whether it is a SubjectPublicKeyInfo in DER and its certificate chain one of it WWCP_POI3 tells with BouncyCastle, in its
 * words, which this library leaves to it.
 */
export function measurementPublicKey(json: JSONObject): Checked {

    const id   = get(json, '@id');
    const key  = get(json, 'key');

    const error = context(json, contextOf('measurementPublicKey'), `The JSON-LD context of a measurement public key must be '${contextOf('measurementPublicKey')}'!`) ??
                  text(json, '@id', 'public key identification') ??
                  text(json, 'key', 'public key') ??
                  errorOf(texts(json, 'certificateChain', 'certificate chain')) ??
                  (typeof id !== 'string' || typeof key !== 'string' ? 'A measurement public key needs its identification and its key!' : undefined);

    if (error !== undefined || typeof id !== 'string' || typeof key !== 'string')
        return error;

    const bytes = base64(key, 'public key');

    if (bytes instanceof Refused)
        return bytes.error;

    const chain = texts(json, 'certificateChain', 'certificate chain');

    for (const certificate of chain instanceof Refused ? [] : chain) {
        const certificateBytes = base64(certificate, 'certificate');
        if (certificateBytes instanceof Refused)
            return certificateBytes.error;
    }

    const computed = toHex(hash('sha256', bytes));

    return computed === id ? undefined : `The identification '${id}' of a measurement public key is not the SHA-256 '${computed}' of its key!`;

}

/** A transparency software assignment as `TransparencySoftwareAssignment.TryParse` reads it: a release and its legal status. */
export const transparencySoftwareAssignment = (json: JSONObject): Checked =>
    context(json, contextOf('transparencySoftwareAssignment'), `The JSON-LD context of the transparency software status must be '${contextOf('transparencySoftwareAssignment')}'!`) ??
    (get(json, 'certificateId') !== undefined ? 'A transparency software status names no certificateId: the certificates of the energy meter and of its charging station prove it!' : undefined) ??
    textError(json, 'transparencySoftwareId', 'transparency software identification', nonEmpty) ??
    textError(json, 'legalStatus', 'legal status', nonEmpty) ??
    (get(json, 'transparencySoftwareId') === undefined || get(json, 'legalStatus') === undefined
         ? 'A transparency software status needs its transparencySoftwareId and its legalStatus!'
         : undefined);

/** An authentication mode as `AuthenticationMode.TryParse` reads it: of a type, the cards and brands of RFID. */
export function authenticationMode(json: JSONObject): Checked {

    try {

        const type = get(json, 'type');

        const error = context(json, contextOf('authenticationMode'), `The JSON-LD context of the authentication mode must be '${contextOf('authenticationMode')}'!`) ??
                      text(json, 'type', 'authentication mode type') ??
                      errorOf(idsByName(json, 'cardTypes', 'RFID card type', [ 'MifareClassic', 'MifareDESFire', 'Calypso' ])) ??
                      brands(json) ??
                      text(json, 'number', 'number') ??
                      text(json, 'stationCode', 'station code') ??
                      (type === undefined ? 'An authentication mode needs its type!' : undefined);

        if (error !== undefined || typeof type !== 'string')
            return error;

        if (trimmed(type) === '' || trimmed(type) !== type)
            throw new Thrown("The type of an authentication mode must be a text without surrounding whitespace! (Parameter 'Type')");

        const cardTypes = idsByName(json, 'cardTypes', 'RFID card type', []) as string[];

        if (new Set(cardTypes).size !== cardTypes.length)
            throw new Thrown("An RFID card type must not be given twice! (Parameter 'CardTypes')");

        const brandIds = (isArray(get(json, 'brands')) ? get(json, 'brands') as JSONValue[] : []).flatMap(item => {
            const id = isObject(item) && typeof item['@id'] === 'string' ? freeId(item['@id']) : undefined;
            return id === undefined ? [] : [ id ];
        });
        const seen = new Set<string>();
        for (const brandId of brandIds) {
            if (seen.has(brandId.key))
                throw new Thrown(`The brand '${brandId.text}' of an RFID authentication mode must not be given twice! (Parameter 'Children')`);
            seen.add(brandId.key);
        }

        if ((cardTypes.length > 0 || brandIds.length > 0) && type !== 'RFID')
            throw new Thrown(`Only RFID names card types and brands, not '${type}'!`);

        const number = get(json, 'number');

        if (type === 'SMS' || type === 'PhoneCall') {
            if (typeof number !== 'string' || trimmed(number) === '')
                throw new Thrown(`The authentication mode '${type}' needs its number! (Parameter 'Number')`);
        }
        else if (number !== undefined)
            throw new Thrown(`Only SMS and PhoneCall name a number, not '${type}'! (Parameter 'Number')`);

        if (get(json, 'stationCode') !== undefined && type !== 'SMS')
            throw new Thrown(`Only SMS names a station code, not '${type}'! (Parameter 'StationCode')`);

        return undefined;

    }
    catch (e) {
        if (e instanceof Thrown)
            return `Invalid authentication mode: ${e.message}`;
        throw e;
    }

}

/** Values given by their exact names (`POIJSON.TryParseIds` with `POIJSON.TryParseName`). */
export const idsByName = (json: JSONObject, property: string, description: string, names: readonly string[]): string[] | Refused => {
    const value = get(json, property);
    if (value === undefined)
        return [];
    if (!isArray(value))
        return new Refused(`The ${description} must be a JSON array!`);
    const invalid = names.length === 0 ? undefined : value.find(item => typeof item !== 'string' || !names.includes(item));
    return invalid === undefined ? value.filter(item => typeof item === 'string') : new Refused(`Invalid ${description} '${interpolated(invalid)}'!`);
};

/** A related location as `AdditionalGeoLocation.TryParse` reads it: a geo location and a name. */
export const relatedLocation = (json: JSONObject): Checked =>
    context(json, contextOf('additionalGeoLocation'), `The JSON-LD context of the related location must be '${contextOf('additionalGeoLocation')}'!`) ??
    geoLocationError(json, 'geoLocation', 'geo location') ??
    i18n(json, 'name') ??
    (get(json, 'geoLocation') === undefined ? 'A related location needs its geo location!' : undefined);

/** A decimal as Styx reads it, compared: whether the given one is below zero. */
export const negative = (value: Decimal | undefined | Refused): boolean =>
    value instanceof Decimal && value.mantissa < 0n;

/** The texts of an entity's array of the given property, as they are. */
export const textsAt = (json: JSONObject, property: string): string[] => {
    const value = get(json, property);
    return isArray(value) ? value.filter(item => typeof item === 'string') : [];
};

