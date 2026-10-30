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
import { get, isArray, isObject, type JSONObject, type JSONValue } from '../json/value.ts';
import { isText, objectsOf, trimmed, versionTwice, MODEL_VERSIONS } from './versionTexts.ts';


// Certificates of conformity as WWCP_POI reads them, as ConformityCertificate and CertifiedEnergyMeter (WWCP_POI2), in its
// order: first what it reads as the arguments of a certificate - the model it names, its hardware revisions and firmware
// versions as texts, its releases, each energy meter it was issued with (its texts, its versions each once, at least one
// of each), its documentURL, its validity and its legislation -, then what its constructor checks: for exactly one model,
// with its manufacturer; its versions each once, at least one of each; a legislation not empty; notBefore not after
// notAfter; its releases each once, at least one, none both verified and compatible; energy meters of a charging station
// model only, each model once. Whether its model, its versions, its releases and its legislation are those of the network
// WWCP_POI checks with the references, which this library leaves to WWCP_POI; an unknown property it refuses of a
// certificate as of every entity (StrictJSON.OnlyProperties), which this library does not. The conformity assessment
// bodies issuing them as ConformityAssessmentBody reads and constructs them: a notified body number of four digits, the
// legislations they are notified for neither empty nor twice, in their ordinal order, a certificate only under one of them.


const MODEL_PROPERTIES  = [ 'chargingStationManufacturerId', 'chargingStationModel', 'energyMeterManufacturerId', 'energyMeterModel' ];

/** What ConformityCertificate and CertifiedEnergyMeter of WWCP_POI2 read: another property they refuse (StrictJSON.OnlyProperties). */
const CERTIFICATE_PROPERTIES      = [ '@context', '@id', ...MODEL_PROPERTIES, 'hardwareRevisions', 'firmwareVersions', 'verifiedTransparencySoftwareIds',
                                      'compatibleTransparencySoftwareIds', 'energyMeters', 'documentNumber', 'documentURL', 'notBefore', 'notAfter',
                                      'legislation', 'statedBy' ];
const CERTIFIED_METER_PROPERTIES  = [ 'manufacturerId', 'modelId', 'hardwareRevisions', 'firmwareVersions' ];
const RELEASES          = [ 'verifiedTransparencySoftwareIds', 'compatibleTransparencySoftwareIds' ];

/** The text of the given property, trimmed as the identifications of WWCP_POI are; empty for none. */
const idAt = (json: JSONObject, property: string): string => {
    const value = get(json, property);
    return typeof value === 'string' ? trimmed(value) : '';
};

/** Identifications as their C# types compare them, case-insensitively, once trimmed. */
const idKey = (id: string): string =>
    trimmed(id).toUpperCase();

/** Whether the given property names a value, as `StrictJSON.Text` reads it: neither missing nor null. */
const given = (json: JSONObject, property: string): boolean => {
    const value = get(json, property);
    return value !== undefined && value !== null;
};

/** The texts the given property names, read before. */
const textsOf = (json: JSONObject, property: string): string[] => {
    const value = get(json, property);
    return isArray(value) ? value.filter(text => typeof text === 'string') : [];
};

/** The error, when the given property is given, but no text, as `StrictJSON.Text` refuses it. */
const notText = (json: JSONObject, property: string): string | undefined =>
    given(json, property) && typeof get(json, property) !== 'string'
        ? `${property}: expected a string.`
        : undefined;


/** A date and a time with an explicit offset, as `StrictJSON.Date` reads it, seconds and their fraction optional. */
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * The given point in time as milliseconds since 1970 and the ticks of 100 ns within that millisecond, as `DateTimeOffset`
 * compares them, to the tick; undefined for none `StrictJSON.Date` reads.
 */
function instantOf(text: string): readonly [ number, number ] | undefined {

    const match = INSTANT.exec(text);

    if (match === null)
        return undefined;

    const [ , year, month, day, hour, minute, second = '0', fraction = '', sign = '+', offsetHours = '0', offsetMinutes = '0' ] = match;
    const digits  = fraction.padEnd(7, '0').slice(0, 7);
    const offset  = Number(offsetHours) * 60 + Number(offsetMinutes);
    const date    = new Date(0);

    date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
    date.setUTCHours(Number(hour), Number(minute), Number(second), Number(digits.slice(0, 3)));

    const valid = Number(year) >= 1 && date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 &&
                  date.getUTCDate() === Number(day) && date.getUTCHours() === Number(hour) &&
                  date.getUTCMinutes() === Number(minute) && date.getUTCSeconds() === Number(second) &&
                  Number(offsetMinutes) <= 59 && offset <= 14 * 60;

    return valid
               ? [ date.getTime() - (sign === '-' ? -offset : offset) * 60_000, Number(digits.slice(3)) ]
               : undefined;

}

/** The error, when the given timestamp is given, but none `StrictJSON.Date` reads. */
const invalidInstant = (json: JSONObject, property: string): string | undefined => {
    const value = get(json, property);
    return given(json, property) && (typeof value !== 'string' || instantOf(value) === undefined)
               ? `${property}: invalid timestamp.`
               : undefined;
};

/** Whether the given certificate, its timestamps read, ends before it begins, to the tick. */
function endsBeforeItBegins(certificate: JSONObject): boolean {

    const notBefore = get(certificate, 'notBefore');
    const notAfter  = get(certificate, 'notAfter');

    if (typeof notBefore !== 'string' || typeof notAfter !== 'string')
        return false;

    const [ beginning, beginningTicks ] = instantOf(notBefore) ?? [ 0, 0 ];
    const [ end,       endTicks       ] = instantOf(notAfter)  ?? [ 0, 0 ];

    return beginning > end || (beginning === end && beginningTicks > endTicks);

}


/**
 * The error, when the given hardware revisions or firmware versions of a certificate, or of an energy meter it was issued
 * with, are refused as `StrictJSON.Array` reads them, by their path (`hardwareRevisions[0]: Invalid text representation
 * of a hardware revision: ' 1.0'!`).
 */
function invalidCertifiedVersion(holder: JSONObject): string | undefined {

    for (const [property, description] of Object.entries(MODEL_VERSIONS)) {

        const versions = get(holder, property);

        if (versions === undefined)
            continue;

        if (!isArray(versions))
            return `${property}: expected an array.`;

        for (const [index, version] of versions.entries())
            if (!isText(version))
                return typeof version === 'string'
                           ? `${property}[${String(index)}]: Invalid text representation of a ${description}: '${version}'!`
                           : `${property}[${String(index)}]: Expected an identifier string.`;

    }

    return undefined;

}

/**
 * The error, when the releases of the given certificate are refused as `StrictJSON.Array` reads them, by their path: each
 * an identification `TransparencySoftware_Id` takes, a text not empty once trimmed.
 */
function invalidReleaseId(certificate: JSONObject): string | undefined {

    for (const property of RELEASES) {

        const ids = get(certificate, property);

        if (ids === undefined)
            continue;

        if (!isArray(ids))
            return `${property}: expected an array.`;

        for (const [index, id] of ids.entries()) {

            if (typeof id !== 'string')
                return `${property}[${String(index)}]: Expected an identifier string.`;

            if (trimmed(id) === '')
                return `${property}[${String(index)}]: Invalid text representation of a transparency software identification: '${id}'!`;

        }

    }

    return undefined;

}

/**
 * The error, when the given energy meter a certificate was issued with is refused as `CertifiedEnergyMeter.Parse` reads
 * it: an object, naming its manufacturer and its model, its hardware revisions and firmware versions as texts, each once,
 * at least one of each.
 */
function invalidEnergyMeter(meter: JSONValue): string | undefined {

    if (!isObject(meter))
        return 'Expected an object.';

    const unknown = Object.keys(meter).find(property => !CERTIFIED_METER_PROPERTIES.includes(property));

    if (unknown !== undefined)
        return `Unknown property '${unknown}'.`;

    for (const property of [ 'manufacturerId', 'modelId' ]) {
        if (meter[property] !== undefined && typeof meter[property] !== 'string')
            return `${property}: expected a string.`;
        if (idAt(meter, property) === '')
            return `${property}: expected a nonempty string.`;
    }

    const model = `certified energy meter model '${idAt(meter, 'modelId')}' of '${idAt(meter, 'manufacturerId')}'`;

    return invalidCertifiedVersion(meter) ??
           versionTwice(meter, `the ${model}`) ??
           (textsOf(meter, 'hardwareRevisions').length === 0 ? `The ${model} must name at least one hardware revision! (Parameter 'HardwareRevisions')` : undefined) ??
           (textsOf(meter, 'firmwareVersions'). length === 0 ? `The ${model} must name at least one firmware version! (Parameter 'FirmwareVersions')`  : undefined);

}

/**
 * The error, when WWCP_POI refuses what it reads as the arguments of the given certificate, by its path: the model it
 * names, the texts of its versions, its releases, each energy meter it was issued with, its document number and URL, its
 * validity and its legislation.
 */
function invalidArgument(certificate: JSONObject): string | undefined {

    // A property it does not read (StrictJSON.OnlyProperties), then its identification, as StrictJSON reads it.
    const unknown = Object.keys(certificate).find(property => !CERTIFICATE_PROPERTIES.includes(property));

    if (unknown !== undefined)
        return `Unknown property '${unknown}'.`;

    if (certificate['@id'] !== undefined && typeof certificate['@id'] !== 'string')
        return '@id: expected a string.';

    if (idAt(certificate, '@id') === '')
        return '@id: expected a nonempty string.';

    const modelError = MODEL_PROPERTIES.map(property => notText(certificate, property)).find(error => error !== undefined);

    if (modelError !== undefined)
        return modelError;

    const versionError = invalidCertifiedVersion(certificate) ?? invalidReleaseId(certificate);

    if (versionError !== undefined)
        return versionError;

    const energyMeters = get(certificate, 'energyMeters');

    if (energyMeters !== undefined && !isArray(energyMeters))
        return 'energyMeters: expected an array.';

    for (const [index, meter] of (energyMeters ?? []).entries()) {
        const meterError = invalidEnergyMeter(meter);
        if (meterError !== undefined)
            return `energyMeters[${String(index)}]: ${meterError}`;
    }

    const documentURL = get(certificate, 'documentURL');

    return notText(certificate, 'documentNumber') ??
           notText(certificate, 'documentURL') ??
           (typeof documentURL === 'string' && !URL.canParse(documentURL) ? 'documentURL: expected an absolute URL.' : undefined) ??
           invalidInstant(certificate, 'notBefore') ??
           invalidInstant(certificate, 'notAfter') ??
           notText(certificate, 'legislation');

}

/**
 * The error, when the constructor of `ConformityCertificate` refuses the given certificate, its arguments read: for
 * exactly one model, with its manufacturer; its versions each once, at least one of each; a legislation not empty;
 * notBefore not after notAfter; its releases each once, at least one, none both verified and compatible; energy meters of
 * a charging station model only, each model once.
 */
function invalidConstruction(certificate: JSONObject, id: string): string | undefined {

    const forStation  = given(certificate, 'chargingStationManufacturerId') || given(certificate, 'chargingStationModel');
    const forMeter    = given(certificate, 'energyMeterManufacturerId')     || given(certificate, 'energyMeterModel');

    if (forStation === forMeter)
        return `The certificate '${id}' must be for either a charging station model or an energy meter model!`;

    if (forStation && !(given(certificate, 'chargingStationManufacturerId') && given(certificate, 'chargingStationModel')))
        return `The certificate '${id}' must name the charging station model it is for with its manufacturer!`;

    if (forMeter && !(given(certificate, 'energyMeterManufacturerId') && given(certificate, 'energyMeterModel')))
        return `The certificate '${id}' must name the energy meter model it is for with its manufacturer!`;

    const twice = versionTwice(certificate, `the certificate '${id}'`);

    if (twice !== undefined)
        return twice;

    if (textsOf(certificate, 'hardwareRevisions').length === 0)
        return `The certificate '${id}' must name at least one hardware revision of its model! (Parameter 'HardwareRevisions')`;

    if (textsOf(certificate, 'firmwareVersions').length === 0)
        return `The certificate '${id}' must name at least one firmware version of its model! (Parameter 'FirmwareVersions')`;

    const legislation = get(certificate, 'legislation');

    if (typeof legislation === 'string' && trimmed(legislation) === '')
        return "A legislation must not be empty. (Parameter 'Legislation')";

    if (endsBeforeItBegins(certificate))
        return "notBefore must not exceed notAfter. (Parameter 'NotBefore')";

    // Each release once, compared ordinally once trimmed (References), but verified and compatible compared as
    // TransparencySoftware_Id compares them, case-insensitively.
    const [ verified = [], compatible = [] ] = RELEASES.map(property => textsOf(certificate, property).map(trimmed));

    if (new Set(verified).size !== verified.length || new Set(compatible).size !== compatible.length)
        return 'Empty or duplicate TransparencySoftware reference.';

    if (verified.length === 0 && compatible.length === 0)
        return 'A document must identify at least one software release.';

    const verifiedKeys = new Set(verified.map(idKey));

    if (compatible.some(release => verifiedKeys.has(idKey(release))))
        return 'A release cannot be both verified and merely compatible in the same document.';

    const energyMeters = objectsOf(get(certificate, 'energyMeters'));

    if (forMeter && energyMeters.length > 0)
        return `The certificate '${id}' of an energy meter model names no energy meters! (Parameter 'EnergyMeters')`;

    // Each model once, compared as its identifications are: of those named twice, the one named first, as it is named
    // first (GroupBy, in the order of their first meter).
    const models = new Map<string, { first: JSONObject; count: number }>();

    for (const meter of energyMeters) {
        const key   = `${idKey(idAt(meter, 'manufacturerId'))}\u0000${idKey(idAt(meter, 'modelId'))}`;
        const model = models.get(key);
        models.set(key, { first: model?.first ?? meter, count: (model?.count ?? 0) + 1 });
    }

    const twiceNamed = [ ...models.values() ].find(model => model.count > 1)?.first;

    return twiceNamed === undefined
               ? undefined
               : `The energy meter model '${idAt(twiceNamed, 'modelId')}' of '${idAt(twiceNamed, 'manufacturerId')}' must not be given twice in the certificate '${id}'! (Parameter 'EnergyMeters')`;

}

/**
 * The error, when WWCP_POI refuses the given certificate, as `ConformityCertificate.TryParse` reads it, in its words: what
 * it reads as its arguments, by their path, then what its constructor checks, as an argument of its parameter where it
 * names one.
 */
export function invalidCertificate(certificate: JSONObject): string | undefined {
    return invalidArgument(certificate) ?? invalidConstruction(certificate, idAt(certificate, '@id'));
}

/** A notified body number: four digits, nothing after them, also no line feed (`^[0-9]{4}\z` since WWCP_POI f53d220). */
const NOTIFIED_BODY_NUMBER = /^[0-9]{4}$/u;

/**
 * The error, when WWCP_POI refuses the given conformity assessment body as `ConformityAssessmentBody.TryParse` reads its
 * notifiedBodyNumber and notifiedFor, a text and an array of texts; undefined for none. The legislations notified for as the
 * content holds them, in their ordinal order (Achim's decision of 2026-10-29, as D13 decided it for keys): WWCP_POI writes
 * them so, and another order, written again, would be another text than the one hashed. A legislation given twice its
 * constructor refuses.
 */
function invalidNotifiedTexts(body: JSONObject): string | undefined {

    const number      = get(body, 'notifiedBodyNumber');
    const notifiedFor = get(body, 'notifiedFor');

    if (number !== undefined && typeof number !== 'string')
        return 'The notified body number must be a text!';

    if (notifiedFor !== undefined && (!isArray(notifiedFor) || notifiedFor.some(legislation => typeof legislation !== 'string')))
        return 'The legislations notified for must be a JSON array of texts!';

    const legislations = textsOf(body, 'notifiedFor');

    if (legislations.slice(1).some((legislation, index) => ordinal(legislations[index] ?? '', legislation) > 0))
        return `The legislations the conformity assessment body '${typeof body['@id'] === 'string' ? body['@id'] : ''}' is notified for are written in their ordinal order!`;

    return undefined;

}

/**
 * The error, when WWCP_POI refuses the given conformity assessment body as its constructor checks it, in its words and
 * order: a notifiedBodyNumber not of four digits, a legislation it is notified for empty or given twice (with case), a
 * certificate issued under a legislation it is not notified for (exactly as written), its certificates in the ordinal order
 * of their identifications. Legislations notified for in another order WWCP_POI writes in their ordinal order; they are
 * taken here as given.
 */
function invalidBody(body: JSONObject): string | undefined {

    const id       = typeof body['@id'] === 'string' ? body['@id'] : '';
    const invalid  = (message: string, parameter: string): string =>
        `The given JSON representation of a conformity assessment body is invalid: ${message} (Parameter '${parameter}')`;

    const number   = get(body, 'notifiedBodyNumber');

    if (typeof number === 'string' && !NOTIFIED_BODY_NUMBER.test(number))
        return invalid(`The notified body number '${number}' of the conformity assessment body '${id}' must be four digits!`, 'NotifiedBodyNumber');

    const notifiedFor = textsOf(body, 'notifiedFor');

    if (notifiedFor.some(legislation => trimmed(legislation) === ''))
        return invalid(`A legislation the conformity assessment body '${id}' is notified for must not be empty!`, 'NotifiedFor');

    if (new Set(notifiedFor).size !== notifiedFor.length)
        return invalid(`A legislation the conformity assessment body '${id}' is notified for must not be given twice!`, 'NotifiedFor');

    // A certificate issued under a legislation is one of a notified body for it.
    const notNotified = objectsOf(get(body, 'certificates'))
                            .sort((left, right) => ordinal(idAt(left, '@id'), idAt(right, '@id')))
                            .find(certificate => typeof certificate['legislation'] === 'string' && !notifiedFor.includes(certificate['legislation']));

    if (notNotified !== undefined)
        return invalid(`The certificate '${idAt(notNotified, '@id')}' is issued under the legislation '${notNotified['legislation'] as string}', which the conformity assessment body '${id}' is not notified for!`, 'Certificates');

    return undefined;

}

/**
 * The error, when the given content names a certificate WWCP_POI refuses to read, or a conformity assessment body naming
 * them it refuses, as WWCP_POI says it; undefined for none. Body by body, as WWCP_POI reads them: what it reads of the
 * body, its certificates, then what its constructor checks.
 */
export function invalidCertificates(content: JSONObject): string | undefined {

    for (const body of objectsOf(get(content, 'conformityAssessmentBodies'))) {

        const error = invalidNotifiedTexts(body) ??
                      objectsOf(get(body, 'certificates')).map(invalidCertificate).find(certificateError => certificateError !== undefined) ??
                      invalidBody(body);

        if (error !== undefined)
            return error;

    }

    return undefined;

}
