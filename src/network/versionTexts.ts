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

import { get, isArray, isObject, type JSONObject, type JSONValue } from '../json/value.ts';
import { energyMetersOf }                                           from './identifications.ts';


// Hardware revisions, firmware versions and serial numbers as WWCP_POI reads them, as HardwareRevision, FirmwareVersion and
// SerialNumber (WWCP_POI2, since c31e5e3 and 3672b06): a text exactly as it is given, not empty and neither beginning nor
// ending with whitespace, compared ordinally, case included. The models of charging stations and energy meters, the
// certificates and the energy meters a certificate was issued with name each of their hardware revisions and firmware
// versions once (`ModelVersions.Of`). WWCP_POI refuses a version naming another where it reads it; whether a station, a
// meter or a certificate names a revision or version of its model it checks with the references, which this library
// leaves to WWCP_POI.


const objectsOf = (value: JSONValue | undefined): JSONObject[] =>
    isArray(value) ? value.filter(isObject) : [];

const textOf = (entity: JSONObject, property: string): string => {
    const value = entity[property];
    return typeof value === 'string' ? value : '';
};

const idOf = (entity: JSONObject): string =>
    textOf(entity, '@id');

/**
 * Whitespace as `Char.IsWhiteSpace` tells it, which `String.Trim` and `String.IsNullOrWhiteSpace` take: not quite what
 * `String.prototype.trim` takes, as U+0085 is whitespace there and U+FEFF is not.
 */
const WHITESPACE  = '\\t\\n\\v\\f\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000';
const AS_GIVEN    = new RegExp(`^[^${WHITESPACE}](?:.*[^${WHITESPACE}])?$`, 'su');

/** Whether the given value is a text `TryParse` takes: not empty, neither beginning nor ending with whitespace. */
const isText = (value: JSONValue): boolean =>
    typeof value === 'string' && AS_GIVEN.test(value);

/** A value as `JToken.ToString` gives it in a message: a text as it is, anything else as JSON. */
const shown = (value: JSONValue): string =>
    typeof value === 'string' ? value : JSON.stringify(value);

/**
 * The error, when the given entity names a hardware revision, firmware version or serial number `TryParseText` refuses
 * (`Invalid hardware revision ' 1.0'!`): of a charging station, an energy meter and their templates.
 */
function invalidText(what: string, entity: JSONObject, properties: Readonly<Record<string, string>>): string | undefined {

    for (const [property, description] of Object.entries(properties)) {
        const value = get(entity, property);
        if (value !== undefined && !isText(value))
            return `The ${what} '${idOf(entity)}': Invalid ${description} '${shown(value)}'!`;
    }

    return undefined;

}

const DEVICE_TEXTS    = { serialNumber: 'serial number', hardwareRevision: 'hardware revision', firmwareVersion: 'firmware version' };
const TEMPLATE_TEXTS  = { hardwareRevision: 'hardware revision', firmwareVersion: 'firmware version' };
const MODEL_VERSIONS  = { hardwareRevisions: 'hardware revision', firmwareVersions: 'firmware version' };

/**
 * The error, when the given holder names a hardware revision or firmware version twice, which `ModelVersions.Of` refuses
 * once both were read (`A hardware revision of the charging station model 'GD-DC300' must not be given twice!`): a model,
 * a certificate or an energy meter a certificate was issued with, `whose` in words, after its path where it has one.
 */
function versionTwice(holder: JSONObject, whose: string, path = ''): string | undefined {

    for (const [property, description] of Object.entries(MODEL_VERSIONS)) {
        const versions = get(holder, property);
        if (isArray(versions) && new Set(versions).size !== versions.length)
            return `${path}A ${description} of ${whose} must not be given twice!`;
    }

    return undefined;

}

/**
 * The error, when the given model names a hardware revision or firmware version `TryParseIds` refuses, or then one twice,
 * which `ModelVersions.Of` refuses: of a charging station or energy meter model.
 */
function invalidModelVersion(what: string, model: JSONObject): string | undefined {

    for (const [property, description] of Object.entries(MODEL_VERSIONS)) {

        const versions = get(model, property);

        if (versions === undefined)
            continue;

        if (!isArray(versions))
            return `The ${what} '${idOf(model)}': The ${description} must be a JSON array!`;

        const invalid = versions.find(version => !isText(version));

        if (invalid !== undefined)
            return `The ${what} '${idOf(model)}': Invalid ${description} '${shown(invalid)}'!`;

    }

    return versionTwice(model, `the ${what} '${idOf(model)}'`);

}

/**
 * The error, when the given hardware revisions or firmware versions of a certificate, or of an energy meter it was issued
 * with, are refused as `StrictJSON.Array` reads them, by its path (`hardwareRevisions[0]: Invalid text representation of
 * a hardware revision: ' 1.0'!`).
 */
function invalidCertifiedVersion(holder: JSONObject, path: string): string | undefined {

    for (const [property, description] of Object.entries(MODEL_VERSIONS)) {

        const versions = get(holder, property);

        if (versions === undefined)
            continue;

        if (!isArray(versions))
            return `${path}${property}: expected an array.`;

        for (const [index, version] of versions.entries())
            if (!isText(version))
                return typeof version === 'string'
                           ? `${path}${property}[${String(index)}]: Invalid text representation of a ${description}: '${version}'!`
                           : `${path}${property}[${String(index)}]: Expected an identifier string.`;

    }

    return undefined;

}

/**
 * The error, when the given certificate or one of the energy meters it was issued with names a version WWCP_POI refuses,
 * in the order `ConformityCertificate` and `CertifiedEnergyMeter` read them: the texts of the certificate, each energy
 * meter with its texts and then the versions it names twice, and last the versions the certificate names twice.
 */
function invalidCertificateVersion(certificate: JSONObject): string | undefined {

    const meterError = (meter: JSONObject, index: number): string | undefined =>
        invalidCertifiedVersion(meter, `energyMeters[${String(index)}]: `) ??
        versionTwice(meter, `the certified energy meter model '${textOf(meter, 'modelId')}' of '${textOf(meter, 'manufacturerId')}'`,
                     `energyMeters[${String(index)}]: `);

    const error = invalidCertifiedVersion(certificate, '') ??
                  objectsOf(get(certificate, 'energyMeters')).
                      map(meterError).
                      find(found => found !== undefined);

    return error !== undefined
               ? `The certificate '${idOf(certificate)}': ${error}`
               : versionTwice(certificate, `the certificate '${idOf(certificate)}'`);

}

/**
 * The error, when the given content names a hardware revision, firmware version or serial number WWCP_POI refuses where it
 * reads it, as WWCP_POI says it, after what names it; undefined for none. The charging stations and energy meters, their
 * templates, the models of their manufacturers and the certificates of conformity assessment bodies name them.
 */
export function invalidVersionText(content: JSONObject): string | undefined {

    const operators      = objectsOf(get(content, 'chargingStationOperators'));
    const gridOperators  = objectsOf(get(content, 'gridOperators'));
    const stations       = operators.flatMap(operator => objectsOf(get(operator, 'chargingPools'))).
                                     flatMap(pool     => objectsOf(get(pool,     'chargingStations')));

    const children = (parties: readonly JSONObject[], property: string): JSONObject[] =>
        parties.flatMap(party => objectsOf(get(party, property)));

    const first = <T>(items: readonly T[], error: (item: T) => string | undefined): string | undefined =>
        items.map(error).find(found => found !== undefined);

    return first(stations,                                                                         station  => invalidText('charging station',          station,  DEVICE_TEXTS))   ??
           first(children(operators, 'chargingStationTemplates'),                                  template => invalidText('charging station template', template, TEMPLATE_TEXTS)) ??
           first(energyMetersOf(operators, gridOperators),                                         meter    => invalidText('energy meter',              meter,    DEVICE_TEXTS))   ??
           first(children([ ...operators, ...gridOperators ], 'energyMeterTemplates'),             template => invalidText('energy meter template',     template, TEMPLATE_TEXTS)) ??
           first(children(objectsOf(get(content, 'chargingStationManufacturers')), 'chargingStationModels'), model => invalidModelVersion('charging station model', model)) ??
           first(children(objectsOf(get(content, 'energyMeterManufacturers')),     'energyMeterModels'),     model => invalidModelVersion('energy meter model',     model)) ??
           first(children(objectsOf(get(content, 'conformityAssessmentBodies')),   'certificates'),          invalidCertificateVersion);

}
