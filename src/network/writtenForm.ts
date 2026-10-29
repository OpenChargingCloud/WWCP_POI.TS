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

import { ordinal }    from '../json/canonical.ts';
import { asText, isArray, isObject, type JSONArray, type JSONObject, type JSONValue } from '../json/value.ts';
import { LANGUAGES }  from '../qidigital/json.ts';
import { trimmed }    from './versionTexts.ts';


// The written form of the content (SPECIFICATION.md 2, Written forms): a value as WWCP_POI writes it again once it has read
// it, which is how the content holds it. A change set gives its new values so (section 4, "New values"), as WWCP_POI checks
// by reading and writing them again (TryHeldAsGiven). A version WWCP_POI takes in another form and writes in its own, which
// written again would be another text than the one hashed; this library refuses it (Achim's decision of 2026-10-29, as D13
// decided it for keys). Of the written form it checks what it can tell without the types of the values: what the content
// orders is given in its order, the texts of its ordered lists trimmed, a list WWCP_POI leaves out where it is empty is
// not given empty, a property is not given as null, which WWCP_POI reads as none, no embedded object names a JSON-LD
// context, a text in languages names each language as Styx writes it, and timestamps are UTC to the millisecond. Custom
// data is held as given.


const idOf = (value: JSONValue | undefined): string =>
    isObject(value) && typeof value['@id'] === 'string' ? value['@id'] : '';

/**
 * The lists of identifications and of predefined values the content holds in the ordinal order of their texts, each once,
 * each trimmed as its type writes it (`POIJSON.OrderedIds` of the C# implementation).
 */
const ORDERED_TEXTS = new Set([
    'facilities', 'paymentOptions', 'uiFeatures', 'features', 'parkingRestrictions', 'services', 'standards', 'nutsCodes',
    'vehicleTypes', 'euVehicleCategories', 'parkingSpaceIds', 'certificateIds', 'chargingTariffIds', 'acceptedEMobilityProviderIds',
    'paymentMeans', 'paymentBrands', 'signatureMethods', 'connectorTypes', 'EVSEIds', 'chargingStationIds', 'chargingPoolIds',
    'energyMeterIds', 'EVSEGroupIds', 'chargingStationGroupIds', 'chargingPoolGroupIds', 'chargingStationOperatorIds',
    'eMobilityProviderIds', 'parkingSensorIds', 'parkingProductIds', 'measurands', 'notifiedFor',
    'verifiedTransparencySoftwareIds', 'compatibleTransparencySoftwareIds', 'cardTypes', 'dimensions', 'usages',
]);

/**
 * The lists WWCP_POI writes only where they have an element (the ToJSON of its entities): given empty, they are none. Not
 * among them, as WWCP_POI writes them also empty: the hardware revisions, firmware versions, releases and energy meters of
 * a certificate, the elements of a price, the exchanges of an EV Taler merchant and the identity keys of a key statement.
 */
const LEFT_OUT_WHEN_EMPTY = new Set([
    'acceptedEMobilityProviderIds', 'authenticationModes', 'brands', 'cardTypes', 'certificateIds', 'certificates',
    'chargingConnectors', 'chargingPoolGroupIds', 'chargingPoolGroups', 'chargingPoolIds', 'chargingPoolTemplates',
    'chargingPools', 'chargingStationGroupIds', 'chargingStationGroups', 'chargingStationIds', 'chargingStationManufacturers',
    'chargingStationModels', 'chargingStationOperatorIds', 'chargingStationOperators', 'chargingStationTemplates',
    'chargingStations', 'chargingTariffGroups', 'chargingTariffIds', 'chargingTariffOffers', 'chargingTariffTemplates',
    'chargingTariffs', 'conditions', 'conformityAssessmentBodies', 'connectorTypes', 'daysOfWeek', 'dimensions',
    'eMobilityProviderIds', 'eMobilityProviders', 'euVehicleCategories', 'EVSEGroupIds', 'EVSEGroups', 'EVSEIds',
    'EVSETemplates', 'EVSEs', 'energyMeterGroups', 'energyMeterIds', 'energyMeterManufacturers', 'energyMeterModels',
    'energyMeterTemplates', 'facilities', 'features', 'gridConnectionPoints', 'gridOperators', 'identityKeys', 'images',
    'locationLanguages', 'marketLocationIds', 'measurands', 'meteringLocationIds', 'models', 'notifiedFor', 'nutsCodes',
    'parkingGarages', 'parkingOperators', 'parkingProductIds', 'parkingProducts', 'parkingRestrictions', 'parkingSensorIds',
    'parkingSensors', 'parkingSpaceGroups', 'parkingSpaceIds', 'parkingSpaceTemplates', 'parkingSpaces', 'paymentBrands',
    'paymentMeans', 'paymentOptions', 'publicKeys', 'relatedLocations', 'services', 'signatureMethods', 'signingKeys',
    'standards', 'templateIds', 'transparencySoftware', 'transparencySoftwareManufacturers', 'transparencySoftwareStatus',
    'uiFeatures', 'usages', 'vehicleTypes',
]);

/**
 * The texts in languages of the content, as Styx reads them (`ImmutableI18NString.TryParse`): every text of a language,
 * written in any case, also by its number, the rest left out without a word; and as it writes them, each language by its
 * name in lower case.
 */
const TEXTS_IN_LANGUAGES = new Set([ 'name', 'description', 'comment', 'assistanceServiceDetails', 'arrivalInstructions', 'additionalInformation' ]);

/** The days of a week as the content holds them: Monday first. */
const DAYS_OF_WEEK = [ 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY' ];

/** The timestamps of the content: UTC to the millisecond (section 2). */
const TIMESTAMP_PROPERTIES = new Set([ 'created', 'lastChange', 'validFrom', 'validUntil', 'notBefore', 'notAfter', 'signedAt', 'supportUntil' ]);
const TIMESTAMP            = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The keys the content orders the given array by, if it orders it: identified elements by their identification, the
 * certificates of signing keys by their keys, authentication modes by their type, the transparency software status of an
 * energy meter or a charging station by its release, the exchanges of an EV Taler merchant by their master public keys,
 * the lists of ORDERED_TEXTS by their texts, the days of a week Monday first.
 */
function orderKeys(items: JSONArray, property: string | undefined): string[] | undefined {

    if (property === 'signingKeyCertificates' && items.every(isObject))
        return items.map(item => `${idOf(isObject(item) ? item['signingKey'] : undefined)}\u0000${isObject(item) ? asText(item['keyId']) : ''}`);

    if (property === 'authenticationModes' && items.every(isObject))
        return items.map(item => isObject(item) ? asText(item['type']) : '');

    if (property === 'transparencySoftwareStatus' && items.every(isObject))
        return items.map(item => isObject(item) ? asText(item['transparencySoftwareId']) : '');

    if (property === 'exchanges' && items.every(isObject))
        return items.map(item => isObject(item) ? asText(item['masterPublicKey']) : '');

    if (property === 'daysOfWeek')
        return items.map(item => String(DAYS_OF_WEEK.indexOf(typeof item === 'string' ? item : '')).padStart(2, '0'));

    if (items.length > 0 && items.every(item => isObject(item) && typeof item['@id'] === 'string'))
        return items.map(idOf);

    if (property !== undefined && ORDERED_TEXTS.has(property) && items.every(item => typeof item === 'string'))
        return items.map(item => typeof item === 'string' ? item : '');

    return undefined;

}


/** Where a value is not written as the content holds it, e.g. "chargingPools[1].paymentOptions", and how it is held. */
export interface NotWritten {
    readonly path:    string;
    readonly reason:  string;
}

/**
 * Where the given value of the given property, at the given path, is not written as the content holds it; undefined where
 * it is. A new value names each element of an ordered list once (`eachOnce`); a version leaves an element given twice to
 * what refuses it in the words of WWCP_POI.
 */
export function notWritten(value: JSONValue, property: string | undefined, path: string, eachOnce: boolean): NotWritten | undefined {

    const check = (item: JSONValue, name: string | undefined, holder: string | undefined, at: string): NotWritten | undefined => {

        if (name === 'customData')
            return undefined;

        if (isArray(item)) {

            if (item.length === 0 && name !== undefined && LEFT_OUT_WHEN_EMPTY.has(name) && !(name === 'identityKeys' && holder === 'keyStatement'))
                return { path: at, reason: 'a list without elements is left out' };

            if (name !== undefined && ORDERED_TEXTS.has(name) && item.some(element => typeof element === 'string' && trimmed(element) !== element))
                return { path: at, reason: 'the texts of its elements are trimmed' };

            const keys = orderKeys(item, name);

            if (keys?.some((key, index) => index > 0 && ordinal(keys[index - 1] ?? '', key) >= (eachOnce ? 0 : 1)) === true)
                return { path: at, reason: eachOnce ? 'its elements are in the order the content holds them in, each once'
                                                    : 'its elements are in the order the content holds them in' };

            for (const [ index, element ] of item.entries()) {
                const found = check(element, undefined, name, `${at}[${String(index)}]`);
                if (found !== undefined)
                    return found;
            }

        }

        else if (isObject(item)) {

            if (name !== undefined && TEXTS_IN_LANGUAGES.has(name) &&
                Object.entries(item).some(([ language, text ]) => !LANGUAGES.has(language) || typeof text !== 'string'))
                return { path: at, reason: 'a text in languages names each language as Styx writes it, in lower case, with a text' };

            for (const [ key, element ] of Object.entries(item)) {

                if (key === '@context')
                    return { path: at, reason: 'embedded, an object names no JSON-LD context' };

                if (element === null)
                    return { path: at === '' ? key : `${at}.${key}`, reason: 'a property without a value is left out' };

                const found = check(element, key, name, at === '' ? key : `${at}.${key}`);
                if (found !== undefined)
                    return found;

            }

        }

        else if (typeof item === 'string' && name !== undefined && TIMESTAMP_PROPERTIES.has(name) && !TIMESTAMP.test(item))
            return { path: at, reason: 'a timestamp is UTC to the millisecond, yyyy-MM-ddTHH:mm:ss.fffZ' };

        return undefined;

    };

    return check(value, property, undefined, path);

}

/**
 * The error, when the given content of a version is not written as the content holds it, its own JSON-LD context aside;
 * undefined where it is.
 */
export function notWrittenAsHeld(content: JSONObject): string | undefined {

    for (const [ property, value ] of Object.entries(content)) {

        if (property === '@context')
            continue;

        const found = notWritten(value, property, property, false);

        if (found !== undefined)
            return `'${found.path}' is not written as the content holds it: ${found.reason}!`;

    }

    return undefined;

}
