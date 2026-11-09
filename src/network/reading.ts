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
import { numberText, withArticle } from '../common.ts';
import { canonicalJSON }          from '../json/canonical.ts';
import { asText, get, isArray, isNumber, isObject, type JSONObject, type JSONValue } from '../json/value.ts';
import { caseId, caught, children, context, contextOf, currency, eMailAddressError, entityContext, enumeration, errorOf,
         evseGroupId, evseId, evseTemplateId, exactText, first, flags, freeId, givenTwice, gridOperatorId, i18n, idOf, ids,
         interpolated, keyed, languagesOf, mandatoryDecimal, mandatoryId, metadata, nonEmpty, nonNegative,
         object, objects, objectsOf, operatorId, optionalBoolean, optionalDecimal, optionalInteger, phoneNumber,
         poolGroupId, poolId, poolTemplateId, providerId, raise, Refused, signOf, stationGroupId, stationId, stationTemplateId,
         styxText, tariffGroupId, tariffId, tariffTemplateId, text, textError, texts, Thrown, thrown, timestamp, twice, url,
         valueText, withoutTimestamps, type Checked, type Id } from './poiJSON.ts';
import { LANGUAGES as LANGUAGE_NAMES } from '../qidigital/json.ts';
import { addressError, authenticationMode, brand as brandOf, brands, contact, dataLicenses, energyMix, geoLocationError, idsByName, image,
         measurementPublicKey, openingTimes, relatedLocation, transparencySoftwareAssignment } from './poiValues.ts';
import { invalidBody, invalidCertificate, invalidInstant, invalidNotifiedTexts } from './certificates.ts';
import { evTalerMerchantOf, hermodURL }  from './evTaler.ts';
import { checkPartyKeys, readPartyKeys } from './partyKeys.ts';
import { trimmed, versionTwice }         from './versionTexts.ts';
import { checkOperator }                 from './references.ts';
import { unknownTimeZone }               from './timeZones.ts';
import { ignoringCase }                  from './identifications.ts';


// What WWCP_POI3 refuses of a roaming network as it reads it (RoamingNetwork.TryParse and the TryParse of every entity it
// reads), in its order and its words: each entity as it reads it, its identification, its JSON-LD context, its properties
// one by one, then what its constructor refuses of it, named by the entity (`The given JSON representation of an EVSE is
// invalid: …`). What the roaming network refuses of the entities it makes of them, their references, `references.ts`
// tells; what WWCP_POI takes and writes otherwise than the content holds it, `writtenForm.ts`. The ETags of an entity
// within the content WWCP_POI checks as it reads it; the written form refuses them, as the content holds none.


/** An identification, then the JSON-LD context of its kind (`chargingPool`), as every entity reads them first. */
function header(json: JSONObject, description: string, parser: (text: string) => Id | undefined, kind: string, what: string): Id | Refused {

    const id = mandatoryId(json, '@id', description, parser);

    if (id instanceof Refused)
        return id;

    const error = entityContext(json, kind, what, id.text);

    return error === undefined ? id : new Refused(error);

}

/** The identifications of the given property, as their type reads them; none of those it refuses, which was read before. */
const idsAt = (json: JSONObject, property: string, parser: (text: string) => Id | undefined): Id[] => {
    const read = ids(json, property, '', parser);
    return read instanceof Refused ? [] : read;
};

/** The texts of the given property compared without case, e.g. payment options, as their type compares them. */
const namesAt = (json: JSONObject, property: string): Id[] =>
    keyed(idsAt(json, property, freeId).map(id => id.text));

/** The images of an entity, by the text of their URL (`POIJSON.Distinct(images, image => image.URL.ToString())`). */
const imagesAt = (json: JSONObject): Id[] =>
    objectsOf(get(json, 'images')).map(item => {
        const given = get(item, 'url');
        const text  = given === undefined ? '' : hermodURL(trimmed(valueText(given) ?? ''))?.text ?? '';
        return { text, key: text };
    });

/** The release of every transparency software status, as `TransparencySoftware_Id` compares them. */
const releasesAt = (json: JSONObject): Id[] =>
    objectsOf(get(json, 'transparencySoftwareStatus')).flatMap(status => {
        const id = idOf(status, freeId, 'transparencySoftwareId');
        return id === undefined ? [] : [ id ];
    });

/** The keys of measurements of an entity, by their identification, compared ordinally (`MeasurementPublicKey.Ordered`). */
const publicKeysAt = (json: JSONObject): Id[] =>
    objectsOf(get(json, 'publicKeys')).map(key => ({ text: asText(key['@id']), key: asText(key['@id']) }));

/** The children of a POICollection given twice, the later one named: "The EVSE 'X' of the charging station 'Y' must not be given twice!". */
function collection(items: readonly JSONObject[], parser: (text: string) => Id | undefined, description: string, owner?: string): void {

    const seen = new Set<string>();

    for (const item of items) {
        const id = idOf(item, parser);
        if (id === undefined)
            continue;
        if (seen.has(id.key))
            throw thrown(`The ${description} '${id.text}'${owner === undefined ? '' : ` of ${owner}`} must not be given twice!`, 'Children');
        seen.add(id.key);
    }

}

/** The names of the flags of `CurrentTypes` and `ChargingModes`. */
const CURRENT_TYPES   = [ 'AC_OnePhase', 'AC_ThreePhases', 'DC' ];
const CHARGING_MODES  = [ 'Mode_1', 'Mode_2', 'Mode_3', 'Mode_4', 'CHAdeMO' ];

/** The names of `ChargingDimensionTypes`. */
const DIMENSIONS      = [ 'ENERGY', 'FLAT', 'MAX_CURRENT', 'MIN_CURRENT', 'PARKING_TIME', 'TIME' ];


// ---------------------------------------------------------------------------------------------------------------------------
// Energy meters and their templates and groups

/** The transparency software status of an energy meter, read by its own loop: an error of one as it is. */
function meterAssignments(json: JSONObject): Checked {

    const value = get(json, 'transparencySoftwareStatus');

    if (value === undefined)
        return undefined;

    if (!isArray(value))
        return 'The transparency software status of an energy meter must be a JSON array!';

    for (const item of value) {
        if (!isObject(item))
            return 'A transparency software status must be a JSON object!';
        const error = transparencySoftwareAssignment(item);
        if (error !== undefined)
            return error;
    }

    return undefined;

}

/** An energy meter as `EnergyMeter.TryParse` reads it, also one of a grid connection point. */
export const energyMeter = (json: JSONObject): Checked =>
    caught('an energy meter', () => {

        const id = header(json, 'energy meter identification', freeId, 'energyMeter', 'energy meter');

        if (id instanceof Refused)
            return id.error;

        const error = i18n(json, 'name') ??
                      i18n(json, 'description') ??
                      text(json, 'dataSource', 'data source') ??
                      textError(json, 'role', 'energy meter role', nonEmpty) ??
                      textError(json, 'manufacturerId', 'manufacturer identification', nonEmpty) ??
                      textError(json, 'modelId', 'model identification', nonEmpty) ??
                      textError(json, 'modelURL', 'model URL', url) ??
                      textError(json, 'serialNumber', 'serial number', exactText) ??
                      textError(json, 'hardwareRevision', 'hardware revision', exactText) ??
                      textError(json, 'firmwareVersion', 'firmware version', exactText) ??
                      errorOf(ids(json, 'signatureMethods', 'signature method', nonEmpty)) ??
                      objects(json, 'publicKeys', 'public key', measurementPublicKey) ??
                      errorOf(ids(json, 'certificateIds', 'certificate identification', freeId)) ??
                      meterAssignments(json) ??
                      errorOf(ids(json, 'templateIds', 'template identification', freeId)) ??
                      metadata(json);

        if (error !== undefined)
            return error;

        const of = `the energy meter '${id.text}'`;

        raise(givenTwice(idsAt(json, 'templateIds', freeId),      `template of ${of}`));
        raise(givenTwice(releasesAt(json),                         `transparency software release of ${of}`));
        raise(givenTwice(namesAt(json, 'signatureMethods'),        `signature method of ${of}`));
        raise(givenTwice(publicKeysAt(json),                       `public key of ${of}`));
        raise(givenTwice(idsAt(json, 'certificateIds', freeId),    `certificate of ${of}`));

        return undefined;

    });

/** The energy meter an EVSE or a grid connection point embeds (`EnergyMeter.TryParseOne`). */
export function embeddedEnergyMeter(json: JSONObject): Checked {
    const value = get(json, 'energyMeter');
    if (value === undefined)
        return undefined;
    return isObject(value) ? energyMeter(value) : 'The energy meter must be a JSON object!';
}

/** The energy meters of a charging pool or a charging station. */
const energyMeters = (json: JSONObject): Checked =>
    children(json, 'energyMeters', 'energyMeterIds', 'energy meters', energyMeter);

/** An energy meter template as `EnergyMeterTemplate.TryParse` reads it. */
export const energyMeterTemplate = (json: JSONObject): Checked =>
    caught('an energy meter template', () => {

        const id = header(json, 'energy meter template identification', freeId, 'energyMeterTemplate', 'energy meter template');

        if (id instanceof Refused)
            return id.error;

        const error = i18n(json, 'name') ??
                      i18n(json, 'description') ??
                      text(json, 'dataSource', 'data source') ??
                      textError(json, 'role', 'energy meter role', nonEmpty) ??
                      textError(json, 'manufacturerId', 'manufacturer identification', nonEmpty) ??
                      textError(json, 'modelId', 'model identification', nonEmpty) ??
                      textError(json, 'modelURL', 'model URL', url) ??
                      textError(json, 'hardwareRevision', 'hardware revision', exactText) ??
                      textError(json, 'firmwareVersion', 'firmware version', exactText) ??
                      objects(json, 'transparencySoftwareStatus', 'transparency software status', transparencySoftwareAssignment) ??
                      errorOf(ids(json, 'signatureMethods', 'signature method', nonEmpty)) ??
                      errorOf(ids(json, 'certificateIds', 'certificate identification', freeId)) ??
                      metadata(json);

        if (error !== undefined)
            return error;

        const of = `the energy meter template '${id.text}'`;

        raise(givenTwice(releasesAt(json),                       `transparency software release of ${of}`));
        raise(givenTwice(namesAt(json, 'signatureMethods'),      `signature method of ${of}`));
        raise(givenTwice(idsAt(json, 'certificateIds', freeId),  `certificate of ${of}`));

        return undefined;

    });

/** The groups of members, `EVSEGroup`, `ChargingStationGroup`, `ChargingPoolGroup`, `EnergyMeterGroup` and `ChargingTariffGroup`. */
interface GroupKind {
    readonly what:     string;
    readonly article:  string;
    readonly kind:     string;
    readonly id:       (text: string) => Id | undefined;
    readonly members:  string;
    readonly member:   (text: string) => Id | undefined;
}

const EVSE_GROUP:              GroupKind = { what: 'EVSE group',              article: 'an', kind: 'evseGroup',            id: evseGroupId,     members: 'EVSEIds',            member: evseId    };
const CHARGING_STATION_GROUP:  GroupKind = { what: 'charging station group',  article: 'a',  kind: 'chargingStationGroup', id: stationGroupId,  members: 'chargingStationIds', member: stationId };
const CHARGING_POOL_GROUP:     GroupKind = { what: 'charging pool group',     article: 'a',  kind: 'chargingPoolGroup',    id: poolGroupId,     members: 'chargingPoolIds',    member: poolId    };
const ENERGY_METER_GROUP:      GroupKind = { what: 'energy meter group',      article: 'an', kind: 'energyMeterGroup',     id: freeId,          members: 'energyMeterIds',     member: freeId    };
const CHARGING_TARIFF_GROUP:   GroupKind = { what: 'charging tariff group',   article: 'a',  kind: 'chargingTariffGroup',  id: tariffGroupId,   members: 'chargingTariffIds',  member: tariffId  };

/** A group of the given kind, as its TryParse reads it: its members each once. */
const group = (kind: GroupKind) => (json: JSONObject): Checked =>
    caught(`${kind.article} ${kind.what}`, () => {

        const id = header(json, `${kind.what} identification`, kind.id, kind.kind, kind.what);

        if (id instanceof Refused)
            return id.error;

        const error = i18n(json, 'name') ??
                      i18n(json, 'description') ??
                      text(json, 'dataSource', 'data source') ??
                      errorOf(ids(json, kind.members, 'member identification', kind.member)) ??
                      metadata(json);

        if (error !== undefined)
            return error;

        raise(givenTwice(idsAt(json, kind.members, kind.member), `member of the ${kind.what} '${id.text}'`));

        return undefined;

    });

/** The groups of EVSEs, charging stations and charging pools of a charging station operator or an e-mobility provider. */
const memberGroups = (json: JSONObject): Checked =>
    children(json, 'EVSEGroups',            'EVSEGroupIds',            'EVSEGroups',            group(EVSE_GROUP)) ??
    children(json, 'chargingStationGroups', 'chargingStationGroupIds', 'ChargingStationGroups', group(CHARGING_STATION_GROUP)) ??
    children(json, 'chargingPoolGroups',    'chargingPoolGroupIds',    'ChargingPoolGroups',    group(CHARGING_POOL_GROUP));

/** The energy meter templates and groups of a charging station operator or a grid operator. */
export const energyMeterTemplates = (json: JSONObject): Checked =>
    children(json, 'energyMeterTemplates', 'energyMeterTemplateIds', 'energy meter templates', energyMeterTemplate);

export const energyMeterGroups = (json: JSONObject): Checked =>
    children(json, 'energyMeterGroups', 'energyMeterGroupIds', 'energy meter groups', group(ENERGY_METER_GROUP));


// ---------------------------------------------------------------------------------------------------------------------------
// Charging connectors, EVSEs, charging stations, charging pools and their templates

/** A charging connector as `ChargingConnector.TryParse` reads it, then what `Validate` refuses of it. */
const chargingConnector = (json: JSONObject): Checked =>
    caught('a charging connector', () => {

        const id = header(json, 'charging connector identification', freeId, 'chargingConnector', 'charging connector');

        if (id instanceof Refused)
            return id.error;

        const cableLength  = nonNegative(json, 'cableLength', 'cable length');
        const cableWeight  = nonNegative(json, 'cableWeight', 'cable weight');
        const limits       = [ 'maxVoltage', 'maxCurrent', 'maxPower' ];

        const error = errorOf(mandatoryId(json, 'type', 'charging connector type', nonEmpty)) ??
                      optionalBoolean(json, 'lockable', 'lockable') ??
                      optionalBoolean(json, 'cableManagementSystem', 'cable management system') ??
                      enumeration(json, 'format', 'charging connector format', [ 'SOCKET', 'CABLE' ]) ??
                      errorOf(cableLength) ??
                      errorOf(cableWeight) ??
                      errorOf(ids(json, 'standards', 'standard', nonEmpty)) ??
                      objects(json, 'images', 'images', image) ??
                      flags(json, 'currentTypes', 'current type', CURRENT_TYPES) ??
                      errorOf(ids(json, 'chargingTariffIds', 'charging tariff identification', tariffId)) ??
                      errorOf(optionalDecimal(json, 'maxVoltage', 'maximum voltage')) ??
                      errorOf(optionalDecimal(json, 'maxCurrent', 'maximum current')) ??
                      errorOf(optionalDecimal(json, 'maxPower',   'maximum power'));

        if (error !== undefined)
            return error;

        const of = `the charging connector '${id.text}'`;

        raise(givenTwice(namesAt(json, 'standards'),                     `standard of ${of}`));
        raise(givenTwice(imagesAt(json),                                 `image of ${of}`));
        raise(givenTwice(idsAt(json, 'chargingTariffIds', tariffId),     `charging tariff of ${of}`));

        if (cableLength instanceof Decimal && signOf(cableLength) <= 0)
            return `The cable length of ${of} must be positive!`;

        if (cableWeight instanceof Decimal && signOf(cableWeight) <= 0)
            return `The cable weight of ${of} must be positive!`;

        if (limits.some(limit => isNegative(optionalDecimal(json, limit, ''))))
            return `The electrical limits of ${of} must not be negative!`;

        if (get(json, 'format') === 'SOCKET' && (cableLength !== undefined || cableWeight !== undefined || isGiven(get(json, 'cableManagementSystem'))))
            return `The charging connector '${id.text}' is a socket: it has no cable of its own!`;

        return undefined;

    });

const isNegative = (value: Decimal | undefined | Refused): boolean =>
    value instanceof Decimal && value.mantissa < 0n;

/** Whether a value Styx reads as optional is given: neither missing nor null. */
const isGiven = (value: JSONValue | undefined): boolean =>
    value !== undefined && value !== null;

/** The charging connectors of an EVSE or an EVSE template. */
const chargingConnectors = (json: JSONObject): Checked =>
    children(json, 'chargingConnectors', 'chargingConnectorIds', 'charging connectors', chargingConnector);

/** What an EVSE and an EVSE template both read, from their geo location on. */
const evseProperties = (json: JSONObject): Checked =>
    geoLocationError(json, 'geoLocation', 'geo location') ??
    errorOf(nonNegative(json, 'maxReservationDuration', 'maximum reservation duration')) ??
    errorOf(nonNegative(json, 'operationTimeout', 'operation timeout')) ??
    errorOf(nonNegative(json, 'reachDistance', 'reach distance')) ??
    errorOf(ids(json, 'standards', 'standard', nonEmpty)) ??
    text(json, 'floorLevel', 'floor level') ??
    errorOf(ids(json, 'acceptedEMobilityProviderIds', 'accepted e-mobility provider identification', providerId));

/** What the constructors of an EVSE and an EVSE template refuse of their electrical limits and connectors. */
function evseConstruction(json: JSONObject, of: string): void {

    if ([ 'maxVoltage', 'maxCurrent', 'maxPower' ].some(limit => isNegative(optionalDecimal(json, limit, ''))))
        throw thrown(`The electrical limits of ${of} must not be negative!`);

    if (twice(objectsOf(get(json, 'chargingConnectors')).flatMap(connector => idOf(connector, freeId) ?? [])) !== undefined)
        throw thrown(`A charging connector of ${of} must not be given twice!`, 'ChargingConnectors');

}

/** An EVSE as `EVSE.TryParse` reads it. */
const evse = (json: JSONObject): Checked =>
    caught('an EVSE', () => {

        const id = header(json, 'EVSE identification', evseId, 'evse', 'EVSE');

        if (id instanceof Refused)
            return id.error;

        const error = i18n(json, 'name') ??
                      i18n(json, 'description') ??
                      text(json, 'dataSource', 'data source') ??
                      text(json, 'physicalReference', 'physical reference') ??
                      flags(json, 'currentTypes', 'current type', CURRENT_TYPES) ??
                      flags(json, 'chargingModes', 'charging mode', CHARGING_MODES) ??
                      errorOf(optionalDecimal(json, 'maxVoltage', 'maximum voltage')) ??
                      errorOf(optionalDecimal(json, 'maxCurrent', 'maximum current')) ??
                      errorOf(optionalDecimal(json, 'maxPower',   'maximum power')) ??
                      chargingConnectors(json) ??
                      embeddedEnergyMeter(json) ??
                      errorOf(ids(json, 'chargingTariffIds', 'charging tariff identification', tariffId)) ??
                      brands(json) ??
                      objects(json, 'images', 'images', image) ??
                      evseProperties(json) ??
                      text(json, 'iso15118Certificate', 'ISO 15118 certificate') ??
                      optionalBoolean(json, 'extendedOperationTimeout', 'extended operation timeout') ??
                      errorOf(ids(json, 'templateIds', 'template identification', evseTemplateId)) ??
                      metadata(json);

        if (error !== undefined)
            return error;

        const of = `the EVSE '${id.text}'`;

        raise(givenTwice(idsAt(json, 'templateIds', evseTemplateId), `template of ${of}`));
        evseConstruction(json, of);
        raise(givenTwice(idsAt(json, 'chargingTariffIds', tariffId), `charging tariff of ${of}`));
        collection(objectsOf(get(json, 'brands')), freeId, 'brand', of);
        raise(givenTwice(imagesAt(json), `image of ${of}`));
        raise(givenTwice(namesAt(json, 'standards'), `standard of ${of}`));
        raise(givenTwice(idsAt(json, 'acceptedEMobilityProviderIds', providerId), `accepted e-mobility provider of ${of}`));

        return undefined;

    });

/** An EVSE template as `EVSETemplate.TryParse` reads it. */
const evseTemplate = (json: JSONObject): Checked =>
    caught('an EVSE template', () => {

        const id = header(json, 'EVSE template identification', evseTemplateId, 'evseTemplate', 'EVSE template');

        if (id instanceof Refused)
            return id.error;

        const error = i18n(json, 'name') ??
                      i18n(json, 'description') ??
                      text(json, 'dataSource', 'data source') ??
                      textError(json, 'chargingTariffId', 'charging tariff identification', tariffId) ??
                      text(json, 'physicalReference', 'physical reference') ??
                      flags(json, 'currentTypes', 'current type', CURRENT_TYPES) ??
                      flags(json, 'chargingModes', 'charging mode', CHARGING_MODES) ??
                      errorOf(optionalDecimal(json, 'maxVoltage', 'maximum voltage')) ??
                      errorOf(optionalDecimal(json, 'maxCurrent', 'maximum current')) ??
                      errorOf(optionalDecimal(json, 'maxPower',   'maximum power')) ??
                      chargingConnectors(json) ??
                      brands(json) ??
                      objects(json, 'images', 'images', image) ??
                      evseProperties(json) ??
                      optionalBoolean(json, 'extendedOperationTimeout', 'extended operation timeout') ??
                      metadata(json);

        if (error !== undefined)
            return error;

        const of = `the EVSE template '${id.text}'`;

        evseConstruction(json, of);
        collection(objectsOf(get(json, 'brands')), freeId, 'brand', of);
        raise(givenTwice(imagesAt(json), `image of ${of}`));
        raise(givenTwice(namesAt(json, 'standards'), `standard of ${of}`));
        raise(givenTwice(idsAt(json, 'acceptedEMobilityProviderIds', providerId), `accepted e-mobility provider of ${of}`));

        return undefined;

    });

/** What a charging station and a charging station template both read, of their model, before their own lists. */
const stationModel = (json: JSONObject, serialNumber: boolean): Checked =>
    textError(json, 'hotline', 'hotline phone number', phoneNumber) ??
    textError(json, 'webPaymentURL', 'web payment URL', url) ??
    textError(json, 'manufacturerId', 'manufacturer identification', nonEmpty) ??
    textError(json, 'modelId', 'model identification', nonEmpty) ??
    textError(json, 'modelURL', 'model URL', url) ??
    (serialNumber ? textError(json, 'serialNumber', 'serial number', exactText) : undefined) ??
    textError(json, 'hardwareRevision', 'hardware revision', exactText) ??
    textError(json, 'firmwareVersion', 'firmware version', exactText) ??
    objects(json, 'transparencySoftwareStatus', 'transparency software status', transparencySoftwareAssignment) ??
    errorOf(ids(json, 'signatureMethods', 'signature method', nonEmpty));

/** What a charging station and a charging station template both read, from their vehicle types on. */
const stationLists = (json: JSONObject): Checked =>
    errorOf(ids(json, 'vehicleTypes', 'vehicle type', nonEmpty)) ??
    errorOf(ids(json, 'euVehicleCategories', 'EU vehicle category', nonEmpty)) ??
    textError(json, 'accessibility', 'accessibility', nonEmpty) ??
    errorOf(ids(json, 'features', 'charging station feature', nonEmpty)) ??
    textError(json, 'calibrationInfo', 'calibration information', url) ??
    textError(json, 'certificationInfo', 'certification information', url) ??
    errorOf(ids(json, 'parkingSpaceIds', 'parking space identification', freeId)) ??
    errorOf(ids(json, 'certificateIds', 'certificate identification', freeId)) ??
    errorOf(optionalDecimal(json, 'maxPower', 'maximum power'));

/** What the constructors of a charging station and a charging station template refuse of their lists, from the brands on. */
function stationListsConstruction(json: JSONObject, of: string): void {
    collection(objectsOf(get(json, 'brands')), freeId, 'brand', of);
    raise(givenTwice(imagesAt(json),                            `image of ${of}`));
    raise(givenTwice(namesAt(json, 'vehicleTypes'),             `vehicle type of ${of}`));
    raise(givenTwice(namesAt(json, 'euVehicleCategories'),      `EU vehicle category of ${of}`));
    raise(givenTwice(namesAt(json, 'features'),                 `feature of ${of}`));
    raise(givenTwice(idsAt(json, 'parkingSpaceIds', freeId),    `parking space of ${of}`));
    raise(givenTwice(idsAt(json, 'certificateIds', freeId),     `certificate of ${of}`));
}

/**
 * The error, when the maximum power of a charging station exceeds the one of all its EVSEs together, each naming its own;
 * the decimals as .NET writes them, here invariantly (WWCP_POI3 in the culture of its machine).
 */
export function powerSumError(station: JSONObject, evses: readonly JSONObject[], id: string): Thrown | undefined {

    const maxPower = optionalDecimal(station, 'maxPower', '');
    const powers   = evses.map(item => optionalDecimal(item, 'maxPower', ''));

    if (!(maxPower instanceof Decimal) || powers.length === 0 || !powers.every(power => power instanceof Decimal))
        return undefined;

    const sum = powers.filter(power => power instanceof Decimal).reduce((left, right) => {
        const scale = Math.max(left.scale, right.scale);
        return new Decimal(left.mantissa * 10n ** BigInt(scale - left.scale) + right.mantissa * 10n ** BigInt(scale - right.scale), scale);
    }, new Decimal(0n, 0));

    return maxPower.compareTo(sum) > 0
               ? thrown(`The maximum power of the charging station '${id}', ${numberText(maxPower)} W, must not exceed the ${numberText(sum)} W of all its EVSEs together!`, 'MaxPower')
               : undefined;

}

/** A charging station as `ChargingStation.TryParse` reads it. */
const chargingStation = (json: JSONObject): Checked =>
    caught('a charging station', () => {

        const id = header(json, 'charging station identification', stationId, 'chargingStation', 'charging station');

        if (id instanceof Refused)
            return id.error;

        const error = i18n(json, 'name') ??
                      i18n(json, 'description') ??
                      text(json, 'dataSource', 'data source') ??
                      text(json, 'physicalReference', 'physical reference') ??
                      addressError(json, 'address', 'address') ??
                      geoLocationError(json, 'geoLocation', 'geo location') ??
                      stationModel(json, true) ??
                      objects(json, 'publicKeys', 'public key', measurementPublicKey) ??
                      children(json, 'EVSEs', 'EVSEIds', 'EVSEs', evse) ??
                      energyMeters(json) ??
                      brands(json) ??
                      object(json, 'openingTimes', 'opening times', openingTimes) ??
                      objects(json, 'images', 'images', image) ??
                      stationLists(json) ??
                      errorOf(ids(json, 'templateIds', 'template identification', stationTemplateId)) ??
                      metadata(json);

        if (error !== undefined)
            return error;

        const of        = `the charging station '${id.text}'`;
        const evses     = objectsOf(get(json, 'EVSEs'));
        const operator  = id.text.slice(0, 6);

        raise(givenTwice(idsAt(json, 'templateIds', stationTemplateId), `template of ${of}`));

        if (isNegative(optionalDecimal(json, 'maxPower', '')))
            throw thrown(`The maximum power of ${of} must not be negative!`, 'MaxPower');

        for (const item of evses) {
            const evseOf = idOf(item, evseId);
            if (evseOf !== undefined && evseOf.text.slice(0, 6) !== operator)
                throw thrown(`The EVSE '${evseOf.text}' does not belong to the operator '${operator}' of ${of}!`, 'EVSEs');
        }

        raise(powerSumError(json, evses, id.text));
        raise(givenTwice(releasesAt(json),                       `transparency software release of ${of}`));
        raise(givenTwice(namesAt(json, 'signatureMethods'),      `signature method of ${of}`));
        raise(givenTwice(publicKeysAt(json),                     `public key of ${of}`));
        collection(evses, evseId, 'EVSE', of);

        if (twice(objectsOf(get(json, 'energyMeters')).flatMap(meter => idOf(meter, freeId) ?? [])) !== undefined)
            throw thrown(`An energy meter of ${of} must not be given twice!`, 'EnergyMeters');

        stationListsConstruction(json, of);

        return undefined;

    });

/** A charging station template as `ChargingStationTemplate.TryParse` reads it. */
const chargingStationTemplate = (json: JSONObject): Checked =>
    caught('a charging station template', () => {

        const id = header(json, 'charging station template identification', stationTemplateId, 'chargingStationTemplate', 'charging station template');

        if (id instanceof Refused)
            return id.error;

        const error = i18n(json, 'name') ??
                      i18n(json, 'description') ??
                      text(json, 'dataSource', 'data source') ??
                      textError(json, 'chargingTariffId', 'charging tariff identification', tariffId) ??
                      text(json, 'physicalReference', 'physical reference') ??
                      addressError(json, 'address', 'address') ??
                      geoLocationError(json, 'geoLocation', 'geo location') ??
                      stationModel(json, false) ??
                      brands(json) ??
                      object(json, 'openingTimes', 'opening times', openingTimes) ??
                      objects(json, 'images', 'images', image) ??
                      stationLists(json) ??
                      metadata(json);

        if (error !== undefined)
            return error;

        const of = `the charging station template '${id.text}'`;

        if (isNegative(optionalDecimal(json, 'maxPower', '')))
            throw thrown(`The maximum power of ${of} must not be negative!`, 'MaxPower');

        raise(givenTwice(releasesAt(json),                   `transparency software release of ${of}`));
        raise(givenTwice(namesAt(json, 'signatureMethods'),  `signature method of ${of}`));
        stationListsConstruction(json, of);

        return undefined;

    });

/** What a charging pool and a charging pool template both read, from their time zone on. */
const poolLists = (json: JSONObject): Checked =>
    textError(json, 'timeZone', 'time zone', nonEmpty) ??
    errorOf(ids(json, 'facilities', 'facility', nonEmpty)) ??
    errorOf(ids(json, 'paymentOptions', 'payment option', nonEmpty)) ??
    objects(json, 'authenticationModes', 'authentication mode', authenticationMode) ??
    errorOf(ids(json, 'uiFeatures', 'user interface feature', nonEmpty)) ??
    errorOf(ids(json, 'features', 'charging pool feature', nonEmpty)) ??
    errorOf(idsByName(json, 'locationLanguages', 'location language', [ ...LANGUAGE_NAMES ])) ??
    addressError(json, 'entranceAddress', 'entrance address') ??
    geoLocationError(json, 'entranceLocation', 'entrance location') ??
    addressError(json, 'exitAddress', 'exit address') ??
    geoLocationError(json, 'exitLocation', 'exit location') ??
    i18n(json, 'arrivalInstructions') ??
    errorOf(ids(json, 'parkingRestrictions', 'parking restriction', nonEmpty)) ??
    objects(json, 'relatedLocations', 'related location', relatedLocation) ??
    errorOf(ids(json, 'services', 'location service', nonEmpty)) ??
    i18n(json, 'assistanceServiceDetails') ??
    errorOf(ids(json, 'standards', 'standard', nonEmpty)) ??
    errorOf(ids(json, 'nutsCodes', 'NUTS code', nutsCode));

/** A NUTS code (`NUTSCode.TryParse`): two letters and up to three letters or digits, in upper case. */
const nutsCode = (given: string): string | undefined =>
    /^[A-Z]{2}[A-Z0-9]{0,3}$/u.test(trimmed(given).toUpperCase()) ? trimmed(given).toUpperCase() : undefined;

/** What the constructors of a charging pool and a charging pool template refuse of their lists, from the images on. */
function poolListsConstruction(json: JSONObject, of: string): void {

    const authenticationModes = objectsOf(get(json, 'authenticationModes')).map(mode => ({ text: asText(mode['type']), key: asText(mode['type']) }));
    const relatedLocations    = objectsOf(get(json, 'relatedLocations')).map(location => ({ text: '', key: canonicalJSON([ location['geoLocation'] ?? null, location['name'] ?? null ]) }));

    raise(givenTwice(imagesAt(json),                              `image of ${of}`));
    raise(timeZoneError(json, of));
    raise(givenTwice(namesAt(json, 'facilities'),                 `facility of ${of}`));
    raise(givenTwice(namesAt(json, 'paymentOptions'),             `payment option of ${of}`));
    raise(givenTwice(authenticationModes,                         `authentication mode of ${of}`));
    raise(givenTwice(namesAt(json, 'uiFeatures'),                 `user interface feature of ${of}`));
    raise(givenTwice(namesAt(json, 'features'),                   `feature of ${of}`));
    raise(givenTwice(keyed(idsByNameAt(json, 'locationLanguages'), name => name), `language of ${of}`));
    raise(givenTwice(namesAt(json, 'parkingRestrictions'),        `parking restriction of ${of}`));
    raise(givenTwice(relatedLocations,                            `related location of ${of}`));
    raise(givenTwice(namesAt(json, 'services'),                   `service of ${of}`));
    raise(givenTwice(namesAt(json, 'standards'),                  `standard of ${of}`));
    raise(givenTwice(keyed(idsAt(json, 'nutsCodes', freeId).map(code => code.text.toUpperCase()), name => name), `NUTS code of ${of}`));

}

/** The time zone of a charging pool or a charging pool template, if it is none it may have or this platform does not know it. */
function timeZoneError(json: JSONObject, of: string): Thrown | undefined {
    const timeZone = get(json, 'timeZone');
    const error    = typeof timeZone === 'string' ? unknownTimeZone(trimmed(timeZone), of) : undefined;
    return error === undefined ? undefined : thrown(error, 'TimeZone');
}

const idsByNameAt = (json: JSONObject, property: string): string[] => {
    const value = get(json, property);
    return isArray(value) ? value.filter(item => typeof item === 'string') : [];
};

/** A charging pool as `ChargingPool.TryParse` reads it. */
const chargingPool = (json: JSONObject): Checked =>
    caught('a charging pool', () => {

        const id = header(json, 'charging pool identification', poolId, 'chargingPool', 'charging pool');

        if (id instanceof Refused)
            return id.error;

        const error = i18n(json, 'name') ??
                      i18n(json, 'description') ??
                      text(json, 'dataSource', 'data source') ??
                      addressError(json, 'address', 'address') ??
                      geoLocationError(json, 'geoLocation', 'geo location') ??
                      textError(json, 'parkingType', 'parking type', nonEmpty) ??
                      textError(json, 'accessibility', 'accessibility', nonEmpty) ??
                      textError(json, 'hotline', 'hotline phone number', phoneNumber) ??
                      textError(json, 'webPaymentURL', 'web payment URL', url) ??
                      dataLicenses(json) ??
                      children(json, 'chargingStations', 'chargingStationIds', 'charging stations', chargingStation) ??
                      (get(json, 'gridConnectionPoint') !== undefined
                           ? `The grid connection point of the charging pool '${id.text}' is embedded in its grid operator: name it by 'gridConnectionPointId'!`
                           : undefined) ??
                      textError(json, 'gridConnectionPointId', 'grid connection point identification', nonEmpty) ??
                      energyMeters(json) ??
                      brands(json) ??
                      object(json, 'openingTimes', 'opening times', openingTimes) ??
                      object(json, 'energyMix', 'energy mix', energyMix) ??
                      objects(json, 'images', 'images', image) ??
                      poolLists(json) ??
                      optionalBoolean(json, 'chargingWhenClosed', 'charging when closed') ??
                      errorOf(ids(json, 'templateIds', 'template identification', poolTemplateId)) ??
                      metadata(json);

        if (error !== undefined)
            return error;

        const of       = `the charging pool '${id.text}'`;
        const stations = objectsOf(get(json, 'chargingStations'));
        const operator = id.text.slice(0, 6);

        raise(givenTwice(idsAt(json, 'templateIds', poolTemplateId), `template of ${of}`));

        for (const station of stations) {
            const stationOf = idOf(station, stationId);
            if (stationOf !== undefined && stationOf.text.slice(0, 6) !== operator)
                throw thrown(`The charging station '${stationOf.text}' does not belong to the operator '${operator}' of ${of}!`, 'ChargingStations');
        }

        collection(stations, stationId, 'charging station', of);

        if (twice(objectsOf(get(json, 'energyMeters')).flatMap(meter => idOf(meter, freeId) ?? [])) !== undefined)
            throw thrown(`An energy meter of ${of} must not be given twice!`, 'EnergyMeters');

        collection(objectsOf(get(json, 'brands')), freeId, 'brand', of);
        poolListsConstruction(json, of);

        return undefined;

    });

/** A charging pool template as `ChargingPoolTemplate.TryParse` reads it. */
const chargingPoolTemplate = (json: JSONObject): Checked =>
    caught('a charging pool template', () => {

        const id = header(json, 'charging pool template identification', poolTemplateId, 'chargingPoolTemplate', 'charging pool template');

        if (id instanceof Refused)
            return id.error;

        const error = i18n(json, 'name') ??
                      i18n(json, 'description') ??
                      text(json, 'dataSource', 'data source') ??
                      textError(json, 'chargingTariffId', 'charging tariff identification', tariffId) ??
                      addressError(json, 'address', 'address') ??
                      geoLocationError(json, 'geoLocation', 'geo location') ??
                      textError(json, 'parkingType', 'parking type', nonEmpty) ??
                      textError(json, 'accessibility', 'accessibility', nonEmpty) ??
                      textError(json, 'hotline', 'hotline phone number', phoneNumber) ??
                      textError(json, 'webPaymentURL', 'web payment URL', url) ??
                      dataLicenses(json) ??
                      textError(json, 'gridConnectionPointId', 'grid connection point identification', nonEmpty) ??
                      brands(json) ??
                      object(json, 'openingTimes', 'opening times', openingTimes) ??
                      object(json, 'energyMix', 'energy mix', energyMix) ??
                      objects(json, 'images', 'images', image) ??
                      poolLists(json) ??
                      optionalBoolean(json, 'chargingWhenClosed', 'charging when closed') ??
                      metadata(json);

        if (error !== undefined)
            return error;

        const of = `the charging pool template '${id.text}'`;

        collection(objectsOf(get(json, 'brands')), freeId, 'brand', of);
        poolListsConstruction(json, of);

        return undefined;

    });


// ---------------------------------------------------------------------------------------------------------------------------
// Charging tariffs, their templates, groups and offers

/** A price limit as `ChargingPriceLimit.TryParse` reads it: excluding VAT, including it. */
interface PriceLimit {
    readonly excludingVAT:  Decimal | undefined;
    readonly includingVAT:  Decimal | undefined;
}

function priceLimit(json: JSONObject): PriceLimit | Refused {

    const error = context(json, contextOf('chargingPriceLimit'), `The JSON-LD context of the price limit must be '${contextOf('chargingPriceLimit')}'!`);

    if (error !== undefined)
        return new Refused(error);

    const excludingVAT = mandatoryDecimal(json, 'excludingVAT', 'price limit excluding VAT');

    if (excludingVAT instanceof Refused)
        return excludingVAT;

    const includingVAT = optionalDecimal(json, 'includingVAT', 'price limit including VAT');

    if (includingVAT instanceof Refused)
        return includingVAT;

    if (excludingVAT !== undefined && excludingVAT.mantissa < 0n)
        return new Refused('A price limit excluding VAT must not be negative!');

    if (includingVAT !== undefined && excludingVAT !== undefined && includingVAT.compareTo(excludingVAT) < 0)
        return new Refused('A price limit including VAT must not be less than the one excluding VAT!');

    return { excludingVAT, includingVAT };

}

/** The minimum and the maximum price of a tariff, read, then compared (`ValidatePriceLimits`), of the given owner. */
function priceLimits(json: JSONObject, owner: string): Checked {

    const limits = [ 'minPrice', 'maxPrice' ].map(property => get(json, property));
    const error  = object(json, 'minPrice', 'minimum price', item => errorOf(priceLimit(item))) ??
                   object(json, 'maxPrice', 'maximum price', item => errorOf(priceLimit(item)));

    if (error !== undefined)
        return error;

    const [ min, max ] = limits.map(limit => isObject(limit) ? priceLimit(limit) : undefined);

    if (min === undefined || max === undefined || min instanceof Refused || max instanceof Refused)
        return undefined;

    const exceeds = (left: Decimal | undefined, right: Decimal | undefined): boolean =>
        left !== undefined && right !== undefined && left.compareTo(right) > 0;

    return exceeds(min.excludingVAT, max.excludingVAT) || exceeds(min.includingVAT, max.includingVAT)
               ? `The minimum price of ${owner} must not exceed its maximum price!`
               : undefined;

}

/** A price component as `ChargingPriceComponent.TryParse` reads it, then what `Validate` refuses of it. */
function priceComponent(json: JSONObject): Checked {

    const type  = get(json, 'type');

    const error = context(json, contextOf('chargingPriceComponent'), `The JSON-LD context of the price component must be '${contextOf('chargingPriceComponent')}'!`) ??
                  enumeration(json, 'type', 'price component type', DIMENSIONS) ??
                  (type === undefined ? 'A price component needs its type!' : undefined);

    if (error !== undefined)
        return error;

    const price     = mandatoryDecimal(json, 'price', 'price');
    if (price instanceof Refused)
        return price.error;

    const vat       = optionalDecimal(json, 'vat', 'VAT');
    if (vat instanceof Refused)
        return vat.error;

    const stepSize  = optionalDecimal(json, 'stepSize', 'step size');
    if (stepSize instanceof Refused)
        return stepSize.error;

    if (price !== undefined && price.mantissa < 0n)
        return `The price of ${withArticle(`${asText(type)} price component`, false)} must not be negative!`;

    if (vat !== undefined && (vat.mantissa < 0n || vat.compareTo(new Decimal(100n, 0)) > 0))
        return `The VAT of ${withArticle(`${asText(type)} price component`, false)} must be between 0 and 100 percent!`;

    if (type === 'FLAT')
        return isGiven(get(json, 'stepSize')) ? 'A FLAT price component has no step size!' : undefined;

    return stepSize === undefined || signOf(stepSize) <= 0 ? `${withArticle(`${asText(type)} price component`)} needs a positive step size!` : undefined;

}

/** A time of a day or a date as `TimeOnly.TryParseExact` and `DateOnly.TryParseExact` read it; a number to compare. */
function exactTime(given: string, format: 'HH:mm' | 'yyyy-MM-dd'): number | undefined {

    if (format === 'HH:mm') {
        const match = /^(\d{2}):(\d{2})$/u.exec(given);
        return match !== null && Number(match[1]) <= 23 && Number(match[2]) <= 59 ? Number(match[1]) * 60 + Number(match[2]) : undefined;
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(given);

    if (match === null)
        return undefined;

    const [ year, month, day ] = [ match[1], match[2], match[3] ].map(Number) as [ number, number, number ];
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);

    return year >= 1 && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.getTime() : undefined;

}

const DAYS_OF_WEEK = [ 'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY' ];

/** A day of the week as `ChargingTariffRestrictions` reads it: by its name in upper case, as `Enum.TryParse` takes it. */
function dayOfWeek(value: JSONValue): number | undefined {

    if (typeof value !== 'string' || value !== value.toUpperCase() || /^\d/u.test(value))
        return undefined;

    let day = 0;

    for (const part of value.split(',')) {
        const name   = trimmed(part);
        const number = /^[+-]?\d+$/u.test(name) ? Number(name) : DAYS_OF_WEEK.indexOf(name);
        if (number < 0 && !/^[+-]?\d+$/u.test(name))
            return undefined;
        day |= number;
    }

    return day >= 0 && day <= 6 ? day : undefined;

}

/** The restrictions of a tariff element as `ChargingTariffRestrictions.TryParse` reads them, then constructs them. */
function restrictions(json: JSONObject): Checked {

    try {

        const formats = [ [ 'startTime', 'HH:mm' ], [ 'endTime', 'HH:mm' ], [ 'startDate', 'yyyy-MM-dd' ], [ 'endDate', 'yyyy-MM-dd' ] ] as const;
        const times   = new Map<string, number>();

        const error = context(json, contextOf('chargingTariffRestrictions'), `The JSON-LD context of the charging tariff restrictions must be '${contextOf('chargingTariffRestrictions')}'!`);

        if (error !== undefined)
            return error;

        for (const [ property, format ] of formats) {
            const value = get(json, property);
            if (value === undefined)
                continue;
            const time = typeof value === 'string' ? exactTime(value, format) : undefined;
            if (time === undefined)
                return `Invalid ${property} '${interpolated(value)}', expected ${format}!`;
            times.set(property, time);
        }

        const ranges = [ 'Energy', 'Current', 'Power', 'Duration' ];
        const values = new Map<string, Decimal | undefined>();

        for (const range of ranges)
            for (const bound of [ 'min', 'max' ]) {
                const value = optionalDecimal(json, `${bound}${range}`, `${bound}${range}`);
                if (value instanceof Refused)
                    return value.error;
                values.set(`${bound}${range}`, value);
            }

        const days = get(json, 'daysOfWeek');
        const read: number[] = [];

        if (days !== undefined) {
            if (!isArray(days))
                return 'The days of the week must be a JSON array!';
            for (const item of days) {
                const day = dayOfWeek(item);
                if (day === undefined)
                    return `Invalid day of the week '${interpolated(item)}'!`;
                read.push(day);
            }
        }

        const reservation = enumeration(json, 'reservation', 'reservation restriction', [ 'RESERVATION', 'RESERVATION_EXPIRES' ]);

        if (reservation !== undefined)
            return reservation;

        for (const range of ranges) {
            const min = values.get(`min${range}`);
            const max = values.get(`max${range}`);
            if ((min !== undefined && min.mantissa < 0n) || (max !== undefined && max.mantissa < 0n))
                throw new Thrown(`The ${range.toLowerCase()} of a charging tariff restriction must not be negative!`);
            if (min !== undefined && max !== undefined && min.compareTo(max) > 0)
                throw new Thrown(`The minimum ${range.toLowerCase()} of a charging tariff restriction must not exceed its maximum!`);
        }

        if (times.has('startTime') && times.get('startTime') === times.get('endTime'))
            throw new Thrown('The start and end times of a charging tariff restriction must differ!');

        const startDate = times.get('startDate');
        const endDate   = times.get('endDate');

        if (startDate !== undefined && endDate !== undefined && startDate >= endDate)
            throw new Thrown('The start date of a charging tariff restriction must be before its end date!');

        if (new Set(read).size !== read.length)
            throw new Thrown('A day of the week of a charging tariff restriction must not be given twice!');

        return undefined;

    }
    catch (e) {
        if (e instanceof Thrown)
            return `Invalid charging tariff restrictions: ${e.message}`;
        throw e;
    }

}

/** An element of a tariff as `ChargingTariffElement.TryParse` reads it: price components, at least one, and restrictions. */
export function tariffElement(json: JSONObject): Checked {

    const error = context(json, contextOf('chargingTariffElement'), `The JSON-LD context of the charging tariff element must be '${contextOf('chargingTariffElement')}'!`);

    if (error !== undefined)
        return error;

    const components = get(json, 'priceComponents');

    if (!isArray(components))
        return 'A charging tariff element needs its price components as a JSON array!';

    for (const component of components) {
        if (!isObject(component))
            return 'A price component must be a JSON object!';
        const componentError = priceComponent(component);
        if (componentError !== undefined)
            return componentError;
    }

    if (components.length === 0)
        return 'A charging tariff element needs at least one price component!';

    const restriction = get(json, 'restrictions');

    if (restriction === undefined)
        return undefined;

    return isObject(restriction) ? restrictions(restriction) : 'The restrictions of a charging tariff element must be a JSON object!';

}

/** The elements of a tariff, a tariff template or the price of an offer (`ChargingTariff.TryParseElements`). */
function tariffElements(json: JSONObject, owner: string): Checked {

    const value = get(json, 'elements');

    if (value === undefined)
        return undefined;

    if (!isArray(value))
        return `The elements of ${owner} must be a JSON array!`;

    for (const element of value) {
        if (!isObject(element))
            return 'A charging tariff element must be a JSON object!';
        const error = tariffElement(element);
        if (error !== undefined)
            return error;
    }

    return undefined;

}

/** The validity of a tariff or a tariff template, from before it is valid until. */
function validity(json: JSONObject, of: string): Checked {

    const validFrom  = timestamp(json, 'validFrom',  'start of the validity');
    const validUntil = timestamp(json, 'validUntil', 'end of the validity');

    return errorOf(validFrom) ?? errorOf(validUntil) ??
           (typeof validFrom === 'number' && typeof validUntil === 'number' && validFrom >= validUntil
                ? `The ${of} must be valid from before it is valid until!`
                : undefined);

}

/** The currency of a tariff or a tariff template: an ISO 4217 code. */
function tariffCurrency(json: JSONObject, of: string): Checked {
    const value = get(json, 'currency');
    return value === undefined || (typeof value === 'string' && currency(value) !== undefined)
               ? undefined
               : `The currency of the ${of} must be an ISO 4217 code, not '${interpolated(value)}'!`;
}

/** A charging tariff or a charging tariff template, as `ChargingTariff.TryParse` and `ChargingTariffTemplate.TryParse` read them. */
const tariff = (template: boolean) => (json: JSONObject): Checked =>
    caught(template ? 'a charging tariff template' : 'a charging tariff', () => {

        const what = template ? 'charging tariff template' : 'charging tariff';
        const id   = header(json, `${what} identification`, template ? tariffTemplateId : tariffId, template ? 'chargingTariffTemplate' : 'chargingTariff', what);

        if (id instanceof Refused)
            return id.error;

        const of    = `${what} '${id.text}'`;

        const error = tariffCurrency(json, of) ??
                      i18n(json, 'name') ??
                      i18n(json, 'description') ??
                      text(json, 'dataSource', 'data source') ??
                      textError(json, 'tariffURL', 'tariff URL', url) ??
                      tariffElements(json, `the ${of}`) ??
                      object(json, 'energyMix', 'energy mix', energyMix) ??
                      enumeration(json, 'tariffType', 'charging tariff type', [ 'AD_HOC_PAYMENT', 'PROFILE_CHEAP', 'PROFILE_FAST', 'PROFILE_GREEN', 'REGULAR' ]) ??
                      priceLimits(json, `the ${of}`) ??
                      errorOf(ids(json, 'paymentMeans', 'payment means', nonEmpty)) ??
                      errorOf(ids(json, 'paymentBrands', 'payment brand', nonEmpty)) ??
                      validity(json, of) ??
                      (template ? undefined : errorOf(ids(json, 'templateIds', 'template identification', tariffTemplateId))) ??
                      metadata(json);

        if (error !== undefined)
            return error;

        if (!template)
            raise(givenTwice(idsAt(json, 'templateIds', tariffTemplateId), `template of the ${of}`));

        raise(givenTwice(namesAt(json, 'paymentMeans'),   `payment means of the ${of}`));
        raise(givenTwice(namesAt(json, 'paymentBrands'),  `payment brand of the ${of}`));

        return undefined;

    });

export const chargingTariff          = tariff(false);
export const chargingTariffTemplate  = tariff(true);

/** The price of an offer as `ChargingTariffOfferPrice.TryParse` reads it, of the given owner. */
function offerPrice(json: JSONObject, owner: string): Checked {

    const forbidden = [ '@id', 'tariffType', 'validFrom', 'validUntil', 'templateIds', 'created', 'lastChange' ].find(property => get(json, property) !== undefined);

    if (forbidden !== undefined)
        return `The price of ${owner} must not have a '${forbidden}'!`;

    const priceCurrency = get(json, 'currency');
    const elements      = get(json, 'elements');

    const error = context(json, contextOf('chargingTariffOfferPrice'), `The JSON-LD context of the price of ${owner} must be '${contextOf('chargingTariffOfferPrice')}'!`) ??
                  (typeof priceCurrency === 'string' && currency(priceCurrency) !== undefined ? undefined : `The currency of the price of ${owner} must be an ISO 4217 code!`) ??
                  textError(json, 'tariffURL', 'tariff URL', url) ??
                  tariffElements(json, `the price of ${owner}`) ??
                  (!isArray(elements) || elements.length === 0 ? `The price of ${owner} must have at least one element!` : undefined) ??
                  object(json, 'energyMix', 'energy mix', energyMix) ??
                  priceLimits(json, `the price of ${owner}`) ??
                  errorOf(ids(json, 'paymentMeans', 'payment means', nonEmpty)) ??
                  errorOf(ids(json, 'paymentBrands', 'payment brand', nonEmpty));

    if (error !== undefined)
        return error;

    if (twice(namesAt(json, 'paymentMeans')) !== undefined)
        return 'A payment means of a charging tariff offer must not be given twice!';

    if (twice(namesAt(json, 'paymentBrands')) !== undefined)
        return 'A payment brand of a charging tariff offer must not be given twice!';

    return undefined;

}

/** The discount of an offer as `ChargingTariffDiscount.TryParse` reads it; the percentage as .NET writes it, here invariantly. */
function discount(json: JSONObject): Checked {

    const percent = get(json, 'percent');

    const error = context(json, contextOf('chargingTariffDiscount'), `The JSON-LD context of the discount must be '${contextOf('chargingTariffDiscount')}'!`) ??
                  (isNumber(percent) ? undefined : 'The percentage of a discount must be a number!') ??
                  (percent instanceof Decimal && percent.scale === 0 && (percent.mantissa > 79228162514264337593543950335n || percent.mantissa < -79228162514264337593543950335n)
                       ? 'The percentage of a discount must be above 0 and at most 100!'
                       : undefined) ??
                  errorOf(idsByName(json, 'dimensions', 'dimension of a discount', DIMENSIONS)) ??
                  (isArray(get(json, 'dimensions')) && (get(json, 'dimensions') as JSONValue[]).length === 0
                       ? 'The dimensions of a discount must not be empty: without them, it reduces all of them!'
                       : undefined);

    if (error !== undefined || !isNumber(percent))
        return error;

    const value = percent instanceof Decimal ? percent : new Decimal(BigInt(percent), 0);

    if (value.mantissa <= 0n || value.compareTo(new Decimal(100n, 0)) > 0)
        return `The percentage of a discount must be above 0 and at most 100, not ${numberText(value)}! (Parameter 'Percent')`;

    const dimensions = idsByName(json, 'dimensions', '', []) as string[];

    return new Set(dimensions).size !== dimensions.length ? "A dimension of a discount must not be given twice! (Parameter 'Dimensions')" : undefined;

}

/** A charging tariff offer as `ChargingTariffOffer.TryParse` reads it, of a charging station operator or an e-mobility provider. */
export const chargingTariffOffer = (json: JSONObject): Checked =>
    caught('a charging tariff offer', () => {

        const id = header(json, 'charging tariff offer identification', freeId, 'chargingTariffOffer', 'charging tariff offer');

        if (id instanceof Refused)
            return id.error;

        const owner      = `the charging tariff offer '${id.text}'`;
        const price      = get(json, 'chargingTariff');
        const reduction  = get(json, 'discount');
        const notBefore  = timestamp(json, 'notBefore', 'notBefore of the charging tariff offer');
        const notAfter   = timestamp(json, 'notAfter',  'notAfter of the charging tariff offer');
        const maximum    = optionalInteger(json, 'maxSessionsPerContract', 'maximum of sessions per contract');

        const error = i18n(json, 'name') ??
                      i18n(json, 'description') ??
                      text(json, 'dataSource', 'data source') ??
                      (price === undefined ? undefined : isObject(price) ? offerPrice(price, owner) : `The price of ${owner} must be a JSON object!`) ??
                      (reduction === undefined ? undefined : isObject(reduction) ? discount(reduction) : `The discount of ${owner} must be a JSON object!`) ??
                      errorOf(ids(json, 'EVSEGroupIds', 'EVSE group identification', evseGroupId)) ??
                      errorOf(ids(json, 'chargingStationGroupIds', 'charging station group identification', stationGroupId)) ??
                      errorOf(ids(json, 'chargingPoolGroupIds', 'charging pool group identification', poolGroupId)) ??
                      errorOf(ids(json, 'chargingStationOperatorIds', 'charging station operator identification', operatorId)) ??
                      errorOf(ids(json, 'eMobilityProviderIds', 'e-mobility provider identification', providerId)) ??
                      errorOf(notBefore) ??
                      errorOf(notAfter) ??
                      object(json, 'openingTimes', 'opening times', openingTimes) ??
                      enumeration(json, 'sessions', 'sessions of the charging tariff offer', [ 'adHoc', 'contract' ]) ??
                      errorOf(maximum) ??
                      (typeof maximum === 'number' && maximum < 1 ? `The maximum of sessions per contract of ${owner} must be at least 1!` : undefined) ??
                      metadata(json);

        if (error !== undefined)
            return error;

        if ((price === undefined) === (reduction === undefined))
            throw thrown(`The charging tariff offer '${id.text}' must have exactly one of a price of its own and a discount!`, 'ChargingTariff');

        raise(givenTwice(idsAt(json, 'EVSEGroupIds', evseGroupId),                   `EVSE group of ${owner}`));
        raise(givenTwice(idsAt(json, 'chargingStationGroupIds', stationGroupId),     `charging station group of ${owner}`));
        raise(givenTwice(idsAt(json, 'chargingPoolGroupIds', poolGroupId),           `charging pool group of ${owner}`));
        raise(givenTwice(idsAt(json, 'chargingStationOperatorIds', operatorId),      `charging station operator of ${owner}`));
        raise(givenTwice(idsAt(json, 'eMobilityProviderIds', providerId),            `e-mobility provider of ${owner}`));

        if ([ 'EVSEGroupIds', 'chargingStationGroupIds', 'chargingPoolGroupIds', 'chargingStationOperatorIds' ].every(property => idsAt(json, property, freeId).length === 0))
            throw thrown(`The charging tariff offer '${id.text}' must name at least one EVSE group, charging station group, charging pool group or charging station operator!`, 'EVSEGroupIds');

        if (typeof notBefore === 'number' && typeof notAfter === 'number' && notAfter < notBefore)
            throw thrown(`The notAfter of the charging tariff offer '${id.text}' must not be before its notBefore!`, 'NotAfter');

        return undefined;

    });


// ---------------------------------------------------------------------------------------------------------------------------
// Parking

/** A parking space, of a parking operator or of a charging station operator, as `ParkingSpace.TryParse` reads it. */
export const parkingSpace = (json: JSONObject): Checked =>
    caught('a parking space', () => {

        const id = header(json, 'parking space identification', freeId, 'parkingSpace', 'parking space');

        if (id instanceof Refused)
            return id.error;

        const dimensions = [ 'maxVehicleHeight', 'maxVehicleLength', 'maxVehicleWidth', 'length', 'width' ];

        const error = i18n(json, 'name') ??
                      i18n(json, 'description') ??
                      text(json, 'dataSource', 'data source') ??
                      geoLocationError(json, 'geoLocation', 'geo location') ??
                      textError(json, 'parkingGarageId', 'parking garage identification', nonEmpty) ??
                      errorOf(ids(json, 'parkingSensorIds', 'parking sensor identification', freeId)) ??
                      errorOf(ids(json, 'chargingStationIds', 'charging station identification', stationId)) ??
                      errorOf(ids(json, 'parkingProductIds', 'parking product identification', caseId)) ??
                      errorOf(ids(json, 'parkingRestrictions', 'parking restriction', nonEmpty)) ??
                      errorOf(ids(json, 'euVehicleCategories', 'EU vehicle category', nonEmpty)) ??
                      text(json, 'physicalReference', 'physical reference') ??
                      text(json, 'apdsReference', 'APDS reference') ??
                      errorOf(ids(json, 'vehicleTypes', 'vehicle type', nonEmpty)) ??
                      errorOf(ids(json, 'standards', 'standard', nonEmpty)) ??
                      objects(json, 'images', 'images', image) ??
                      errorOf(nonNegative(json, 'timeLimit', 'time limit')) ??
                      errorOf(nonNegative(json, 'maxVehicleWeight', 'maximum vehicle weight')) ??
                      first(...dimensions.map(property => (): Checked => errorOf(nonNegative(json, property, property)))) ??
                      parkingEnums(json) ??
                      parkingFlags(json) ??
                      errorOf(ids(json, 'templateIds', 'template identification', freeId)) ??
                      metadata(json);

        if (error !== undefined)
            return error;

        const of = `the parking space '${id.text}'`;

        raise(givenTwice(idsAt(json, 'templateIds', freeId),              `template of ${of}`));
        raise(givenTwice(idsAt(json, 'parkingSensorIds', freeId),         `parking sensor of ${of}`));
        raise(givenTwice(idsAt(json, 'chargingStationIds', stationId),    `charging station of ${of}`));
        raise(givenTwice(idsAt(json, 'parkingProductIds', caseId),        `parking product of ${of}`));
        raise(givenTwice(namesAt(json, 'parkingRestrictions'),            `parking restriction of ${of}`));
        raise(givenTwice(namesAt(json, 'euVehicleCategories'),            `EU vehicle category of ${of}`));

        if (notPositive(json, 'maxVehicleWeight'))
            throw thrown(`The maximum vehicle weight of ${of} must be positive!`, 'MaxVehicleWeight');

        for (const property of dimensions)
            if (notPositive(json, property))
                throw thrown(`The ${property} of ${of} must be positive!`, property.charAt(0).toUpperCase() + property.slice(1));

        raise(givenTwice(namesAt(json, 'vehicleTypes'),  `vehicle type of ${of}`));
        raise(givenTwice(namesAt(json, 'standards'),     `standard of ${of}`));
        raise(givenTwice(imagesAt(json),                 `image of ${of}`));

        return undefined;

    });

/** Whether a decimal of the given property is given and not positive. */
const notPositive = (json: JSONObject, property: string): boolean => {
    const value = optionalDecimal(json, property, property);
    return value instanceof Decimal && signOf(value) <= 0;
};

const parkingEnums = (json: JSONObject): Checked =>
    enumeration(json, 'evsePosition', 'evsePosition', [ 'LEFT', 'RIGHT', 'CENTER' ]) ??
    enumeration(json, 'direction', 'direction', [ 'PARALLEL', 'PERPENDICULAR', 'ANGLE' ]) ??
    enumeration(json, 'surface', 'surface', [ 'ASPHALT', 'CONCRETE', 'TILES', 'GRAVEL', 'GRASS', 'SOIL' ]) ??
    enumeration(json, 'slope', 'slope', [ 'FLAT', 'SLOPED', 'STEEPLY_SLOPED' ]);

const parkingFlags = (json: JSONObject): Checked =>
    first(...[ 'restrictedToVehicleTypes', 'driveThrough', 'reservationRequired', 'roofed', 'illuminated', 'refrigerationOutlet', 'dangerousGoodsAllowed', 'protectedArea' ].
              map(property => () => optionalBoolean(json, property, property)));

/** A parking space template as `ParkingSpaceTemplate.TryParse` reads it. */
const parkingSpaceTemplate = (json: JSONObject): Checked =>
    caught('a parking space template', () => {

        const id = header(json, 'parking space template identification', freeId, 'parkingSpaceTemplate', 'parking space template');

        if (id instanceof Refused)
            return id.error;

        const dimensions = [ 'maxVehicleHeight', 'maxVehicleLength', 'maxVehicleWidth', 'length', 'width' ];

        const error = i18n(json, 'name') ??
                      i18n(json, 'description') ??
                      text(json, 'dataSource', 'data source') ??
                      errorOf(ids(json, 'parkingProductIds', 'parking product identification', caseId)) ??
                      geoLocationError(json, 'geoLocation', 'geo location') ??
                      textError(json, 'parkingGarageId', 'parking garage identification', nonEmpty) ??
                      errorOf(ids(json, 'parkingSensorIds', 'parking sensor identification', freeId)) ??
                      errorOf(ids(json, 'chargingStationIds', 'charging station identification', stationId)) ??
                      errorOf(ids(json, 'parkingRestrictions', 'parking restriction', nonEmpty)) ??
                      errorOf(ids(json, 'euVehicleCategories', 'EU vehicle category', nonEmpty)) ??
                      text(json, 'physicalReference', 'physical reference') ??
                      errorOf(ids(json, 'vehicleTypes', 'vehicle type', nonEmpty)) ??
                      errorOf(ids(json, 'standards', 'standard', nonEmpty)) ??
                      objects(json, 'images', 'images', image) ??
                      errorOf(nonNegative(json, 'timeLimit', 'time limit')) ??
                      errorOf(nonNegative(json, 'maxVehicleWeight', 'maximum vehicle weight')) ??
                      first(...dimensions.map(property => (): Checked => errorOf(nonNegative(json, property, property)))) ??
                      parkingEnums(json) ??
                      parkingFlags(json) ??
                      metadata(json);

        if (error !== undefined)
            return error;

        const of = `the parking space template '${id.text}'`;

        if ([ 'maxVehicleWeight', ...dimensions ].some(property => notPositive(json, property)))
            throw thrown(`The vehicle limits and dimensions of ${of} must be positive!`);

        raise(givenTwice(idsAt(json, 'parkingProductIds', caseId),        `parking product of ${of}`));
        raise(givenTwice(idsAt(json, 'parkingSensorIds', freeId),         `parking sensor of ${of}`));
        raise(givenTwice(idsAt(json, 'chargingStationIds', stationId),    `charging station of ${of}`));
        raise(givenTwice(namesAt(json, 'parkingRestrictions'),            `parking restriction of ${of}`));
        raise(givenTwice(namesAt(json, 'euVehicleCategories'),            `EU vehicle category of ${of}`));
        raise(givenTwice(namesAt(json, 'vehicleTypes'),                   `vehicle type of ${of}`));
        raise(givenTwice(namesAt(json, 'standards'),                      `standard of ${of}`));
        raise(givenTwice(imagesAt(json),                                  `image of ${of}`));

        return undefined;

    });

/** A parking garage as `ParkingGarage.TryParse` reads it. */
const parkingGarage = (json: JSONObject): Checked =>
    caught('a parking garage', () => {

        const id = header(json, 'parking garage identification', freeId, 'parkingGarage', 'parking garage');

        if (id instanceof Refused)
            return id.error;

        const error = i18n(json, 'name') ??
                      i18n(json, 'description') ??
                      text(json, 'dataSource', 'data source') ??
                      addressError(json, 'address', 'address') ??
                      geoLocationError(json, 'geoLocation', 'geo location') ??
                      errorOf(ids(json, 'chargingStationIds', 'charging station identification', stationId)) ??
                      object(json, 'openingTimes', 'opening times', openingTimes) ??
                      objects(json, 'images', 'images', image) ??
                      errorOf(ids(json, 'parkingProductIds', 'parking product identification', caseId)) ??
                      metadata(json);

        if (error !== undefined)
            return error;

        const of = `the parking garage '${id.text}'`;

        raise(givenTwice(idsAt(json, 'chargingStationIds', stationId),  `charging station of ${of}`));
        raise(givenTwice(imagesAt(json),                                `image of ${of}`));
        raise(givenTwice(idsAt(json, 'parkingProductIds', caseId),      `parking product of ${of}`));

        return undefined;

    });

/** A parking sensor as `ParkingSensor.TryParse` reads it. */
const parkingSensor = (json: JSONObject): Checked =>
    caught('a parking sensor', () => {

        const id = header(json, 'parking sensor identification', freeId, 'parkingSensor', 'parking sensor');

        if (id instanceof Refused)
            return id.error;

        const error = i18n(json, 'name') ??
                      i18n(json, 'description') ??
                      text(json, 'dataSource', 'data source') ??
                      geoLocationError(json, 'geoLocation', 'geo location') ??
                      errorOf(ids(json, 'chargingStationIds', 'charging station identification', stationId)) ??
                      metadata(json);

        if (error !== undefined)
            return error;

        raise(givenTwice(idsAt(json, 'chargingStationIds', stationId), `charging station of the parking sensor '${id.text}'`));

        return undefined;

    });

/** A parking space group as `ParkingSpaceGroup.TryParse` reads it. */
const parkingSpaceGroup = (json: JSONObject): Checked =>
    caught('a parking space group', () => {

        const id = header(json, 'parking space group identification', freeId, 'parkingSpaceGroup', 'parking space group');

        if (id instanceof Refused)
            return id.error;

        const error = i18n(json, 'name') ??
                      i18n(json, 'description') ??
                      text(json, 'dataSource', 'data source') ??
                      errorOf(ids(json, 'parkingSpaceIds', 'member identification', freeId)) ??
                      metadata(json);

        if (error !== undefined)
            return error;

        raise(givenTwice(idsAt(json, 'parkingSpaceIds', freeId), `member of the parking space group '${id.text}'`));

        return undefined;

    });

/** A parking product as `ParkingProduct.TryParse` reads it: its durations, in seconds. */
const parkingProduct = (json: JSONObject): Checked =>
    caught('a parking product', () => {

        const id = header(json, 'parking product identification', caseId, 'parkingProduct', 'parking product');

        if (id instanceof Refused)
            return id.error;

        const minDuration = optionalDecimal(json, 'minDuration', 'minimum duration');
        const stopAfter   = optionalDecimal(json, 'stopParkingAfterTime', 'stop parking after time');

        const error = i18n(json, 'name') ??
                      i18n(json, 'description') ??
                      errorOf(minDuration) ??
                      errorOf(stopAfter) ??
                      withoutTimestamps(json);

        if (error !== undefined)
            return error;

        // In ticks of 100 ns, truncated toward zero.
        const ticks = (value: Decimal | undefined | Refused): bigint | undefined =>
            value instanceof Decimal ? value.mantissa * 10_000_000n / 10n ** BigInt(value.scale) : undefined;

        const [ min, stop ] = [ ticks(minDuration), ticks(stopAfter) ];

        if ((min !== undefined && min < 0n) || (stop !== undefined && stop < 0n))
            throw thrown(`The durations of the parking product '${id.text}' must not be negative!`);

        if (min !== undefined && stop !== undefined && min > stop)
            throw thrown(`The minimum duration of the parking product '${id.text}' must not exceed its stopParkingAfterTime!`);

        return undefined;

    });


// ---------------------------------------------------------------------------------------------------------------------------
// Parties

/** The name, the description and the data source of a party, as most read them. */
const named = (json: JSONObject): Checked =>
    i18n(json, 'name') ?? i18n(json, 'description') ?? text(json, 'dataSource', 'data source');

/** The keys of a party as `POIPartyKeys.TryParse` reads them. */
const keysError = (json: JSONObject): Checked => {
    const keys = readPartyKeys(json);
    return typeof keys === 'string' ? keys : undefined;
};

/** The error of the keys of a party as its constructor checks them, thrown. */
function keysChecked(json: JSONObject, name: string): void {
    const keys = readPartyKeys(json);
    const error = typeof keys === 'string' ? undefined : checkPartyKeys(keys, name);
    if (error !== undefined)
        throw thrown(error);
}

/** What the constructor of a party refuses of its data licenses: one given twice, of the given name. */
function licensesChecked(json: JSONObject, name: string): void {
    const licenses = objectsOf(get(json, 'dataLicenses')).flatMap(license => idOf(license, freeId, get(license, '@id') === undefined ? 'id' : '@id') ?? []);
    if (twice([ ...licenses, ...idsAt(json, 'dataLicenseIds', freeId) ]) !== undefined)
        throw thrown(`A data license of ${name} must not be given twice!`, 'DataLicenses');
}

/** A charging station model or an energy meter model, as `ChargingStationModel.TryParse` and `EnergyMeterModel.TryParse` read them. */
const model = (meter: boolean) => (json: JSONObject): Checked =>
    caught(meter ? 'an energy meter model' : 'a charging station model', () => {

        const what = meter ? 'energy meter model' : 'charging station model';
        const id   = header(json, `${what} identification`, freeId, meter ? 'energyMeterModel' : 'chargingStationModel', what);

        if (id instanceof Refused)
            return id.error;

        const of        = `the ${what} '${id.text}'`;
        const maximum   = optionalDecimal(json, meter ? 'maxCurrent' : 'maxPower', meter ? 'maximum current' : 'maximum power');
        const evses     = meter ? undefined : optionalInteger(json, 'numberOfEVSEs', 'number of EVSEs');
        const measurands = texts(json, 'measurands', 'measurands');

        const error = (get(json, 'manufacturerId') !== undefined ? `The ${what} '${id.text}' is embedded in its manufacturer: it names none!` : undefined) ??
                      i18n(json, 'name') ??
                      i18n(json, 'description') ??
                      errorOf(ids(json, 'hardwareRevisions', 'hardware revision', exactText)) ??
                      errorOf(ids(json, 'firmwareVersions', 'firmware version', exactText)) ??
                      textError(json, 'productURL', 'product URL', url) ??
                      textError(json, 'datasheetURL', 'datasheet URL', url) ??
                      objects(json, 'images', 'images', image) ??
                      flags(json, 'currentTypes', 'current type', CURRENT_TYPES) ??
                      (meter
                           ? text(json, 'accuracyClass', 'accuracy class') ??
                             errorOf(measurands) ??
                             errorOf(ids(json, 'signatureMethods', 'signature method', nonEmpty)) ??
                             errorOf(maximum)
                           : errorOf(ids(json, 'connectorTypes', 'connector type', nonEmpty)) ??
                             errorOf(evses) ??
                             errorOf(maximum)) ??
                      withoutTimestamps(json);

        if (error !== undefined)
            return error;

        if (maximum instanceof Decimal && signOf(maximum) <= 0)
            throw thrown(`The ${meter ? 'maximum current' : 'maximum power'} of ${of} must be positive!`, meter ? 'MaxCurrent' : 'MaxPower');

        if (typeof evses === 'number' && evses < 1)
            throw thrown(`The number of EVSEs of ${of} must be at least one!`, 'NumberOfEVSEs');

        if (meter) {

            const accuracyClass = get(json, 'accuracyClass');

            if (typeof accuracyClass === 'string' && (trimmed(accuracyClass) === '' || trimmed(accuracyClass) !== accuracyClass))
                throw thrown(`The accuracy class of ${of} must not be empty nor begin or end with whitespace!`, 'AccuracyClass');

            const given = measurands instanceof Refused ? [] : measurands;

            if (given.some(measurand => trimmed(measurand) === '' || trimmed(measurand) !== measurand))
                throw thrown(`A measurand of ${of} must not be empty nor begin or end with whitespace!`, 'Measurands');

            if (new Set(given).size !== given.length)
                throw thrown(`A measurand of ${of} must not be given twice!`, 'Measurands');

        }

        const versions = versionTwice(json, of);

        if (versions !== undefined)
            throw new Thrown(versions);

        raise(givenTwice(imagesAt(json), `image of ${of}`));
        raise(givenTwice(namesAt(json, meter ? 'signatureMethods' : 'connectorTypes'), `${meter ? 'signature method' : 'connector type'} of ${of}`));

        return undefined;

    });

/** A charging station manufacturer or an energy meter manufacturer, with its models. */
const manufacturer = (meter: boolean) => (json: JSONObject): Checked =>
    caught(meter ? 'an energy meter manufacturer' : 'a charging station manufacturer', () => {

        const what = meter ? 'energy meter manufacturer' : 'charging station manufacturer';
        const id   = header(json, `${what} identification`, freeId, meter ? 'energyMeterManufacturer' : 'chargingStationManufacturer', what);

        if (id instanceof Refused)
            return id.error;

        const models = meter ? 'energyMeterModels' : 'chargingStationModels';

        const error = named(json) ??
                      contact(json) ??
                      children(json, models, meter ? 'energyMeterModelIds' : 'chargingStationModelIds', meter ? 'energy meter models' : 'charging station models', model(meter)) ??
                      keysError(json) ??
                      metadata(json);

        if (error !== undefined)
            return error;

        const name = `the ${what} '${id.text}'`;

        licensesChecked(json, name);
        collection(objectsOf(get(json, models)), freeId, meter ? 'energy meter model' : 'charging station model', name);
        keysChecked(json, name);

        return undefined;

    });

/** A link of a release or a license (`StrictJSON.Link`): a text of an absolute URL, as `Uri.TryCreate` and Hermod take it. */
function link(json: JSONObject, property: string, label = property): Checked {

    const value = get(json, property);

    if (value === undefined || value === null)
        return undefined;

    if (typeof value !== 'string')
        return `${label}: expected a string.`;

    return URL.canParse(trimmed(value)) && /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(trimmed(value)) && hermodURL(value) !== undefined ? undefined : `${label}: expected an absolute URL.`;

}

/** A text a release requires (`StrictJSON.RequiredText`): a text not empty. */
function requiredText(json: JSONObject, property: string): Checked {
    const value = get(json, property);
    if (value !== undefined && value !== null && typeof value !== 'string')
        return `${property}: expected a string.`;
    return typeof value === 'string' && trimmed(value) !== '' ? undefined : `${property}: expected a nonempty string.`;
}

const RELEASE_PROPERTIES  = [ '@id', '@context', 'name', 'version', 'openSourceLicenses', 'logo', 'howToUse', 'moreInformation', 'sourceCodeRepository',
                              'supportUntil', 'declarationOfConformity', 'softwareBillOfMaterials' ];

/** An open source license of a release (`TransparencyJSON.License`). */
function openSourceLicense(license: JSONValue): Checked {

    if (license === null)
        return 'license: missing license object.';

    if (!isObject(license))
        return 'license: expected an object.';

    if (get(license, 'exception') !== undefined)
        return 'Cannot parse a serializer error document.';

    if (get(license, '@context') !== undefined && get(license, '@context') !== 'https://opendata.social/contexts/wwcp+json/openSourceLicenses')
        return "Invalid '@context'.";

    const unknown = Object.keys(license).find(property => ![ '@id', '@context', 'description', 'URLs' ].includes(property));

    if (unknown !== undefined)
        return `Unknown property '${unknown}'.`;

    const id = get(license, '@id');

    if (id !== undefined && id !== null && typeof id !== 'string')
        return '@id: expected a string.';

    if (typeof id !== 'string' || trimmed(id) === '')
        return 'license.@id: invalid or missing license identifier.';

    const description = get(license, 'description');

    if (description !== undefined && description !== null && !isObject(description))
        return 'description: expected an object.';

    const urls = get(license, 'URLs');

    if (urls === undefined || urls === null)
        return undefined;

    if (!isArray(urls))
        return 'URLs: expected an array.';

    for (const [ index, item ] of urls.entries()) {
        const at = `URLs[${String(index)}]: `;
        if (item === null)
            return `${at}URLs: expected a URL.`;
        const error = link({ url: item }, 'url');
        if (error !== undefined)
            return `${at}${error}`;
    }

    return undefined;

}

/** A transparency software release as `TransparencySoftware.TryParse` of WWCP_POI2 reads it, strictly: "TransparencySoftware: …". */
function release(json: JSONObject): Checked {

    const error = ((): Checked => {

        const unknown = Object.keys(json).find(property => !RELEASE_PROPERTIES.includes(property));

        if (unknown !== undefined)
            return `Unknown property '${unknown}'.`;

        if (get(json, '@context') !== undefined && get(json, '@context') !== contextOf('transparencySoftware'))
            return `The JSON-LD context of the transparency software must be '${contextOf('transparencySoftware')}'!`;

        const name     = get(json, 'name');
        const licenses = get(json, 'openSourceLicenses');

        const read = requiredText(json, '@id') ??
                     (!isObject(name) ? 'name: expected a multi-language object.' : undefined) ??
                     (languagesOf(name).length === 0 || Object.values(name ?? {}).some(item => typeof item === 'string' && trimmed(item) === '')
                          ? 'name: expected a nonempty text in each language.'
                          : undefined) ??
                     requiredText(json, 'version') ??
                     (!isArray(licenses) || licenses.length === 0 ? 'openSourceLicenses: expected a nonempty array of license objects.' : undefined) ??
                     (isArray(licenses)
                          ? licenses.map((license, index) => {
                                const licenseError = openSourceLicense(license);
                                return licenseError === undefined ? undefined : `openSourceLicenses[${String(index)}]: ${licenseError}`;
                            }).find(found => found !== undefined)
                          : undefined) ??
                     link(json, 'logo') ??
                     link(json, 'howToUse') ??
                     link(json, 'moreInformation') ??
                     link(json, 'sourceCodeRepository') ??
                     invalidInstant(json, 'supportUntil') ??
                     link(json, 'declarationOfConformity') ??
                     link(json, 'softwareBillOfMaterials');

        if (read !== undefined)
            return read;

        const licenseIds = objectsOf(licenses).map(license => ignoringCase(trimmed(asText(license['@id']))));

        return new Set(licenseIds).size !== licenseIds.length ? "A license must not be given twice. (Parameter 'OpenSourceLicenses')" : undefined;

    })();

    return error === undefined ? undefined : `TransparencySoftware: ${error}`;

}

/** A transparency software manufacturer as `TransparencySoftwareManufacturer.TryParse` reads it, with its releases. */
const softwareManufacturer = (json: JSONObject): Checked =>
    caught('a transparency software manufacturer', () => {

        const id = header(json, 'transparency software manufacturer identification', freeId, 'transparencySoftwareManufacturer', 'transparency software manufacturer');

        if (id instanceof Refused)
            return id.error;

        const role = get(json, 'craRole');

        const error = named(json) ??
                      contact(json) ??
                      text(json, 'craRole', 'role under the Cyber Resilience Act') ??
                      (typeof role === 'string' && ![ 'manufacturer', 'openSourceSoftwareSteward' ].includes(role)
                           ? `The role '${role}' under the Cyber Resilience Act must be one of manufacturer, openSourceSoftwareSteward!`
                           : undefined) ??
                      eMailAddressError(json, 'vulnerabilityContact', 'vulnerability contact') ??
                      textError(json, 'vulnerabilityReporting', 'vulnerability reporting URL', url) ??
                      textError(json, 'vulnerabilityDisclosurePolicy', 'vulnerability disclosure policy URL', url) ??
                      textError(json, 'securityAdvisories', 'security advisories URL', url) ??
                      children(json, 'transparencySoftware', 'transparencySoftwareIds', 'transparency software releases', release) ??
                      keysError(json) ??
                      metadata(json);

        if (error !== undefined)
            return error;

        const name = `the transparency software manufacturer '${id.text}'`;

        licensesChecked(json, name);
        collection(objectsOf(get(json, 'transparencySoftware')), freeId, 'transparency software release', name);
        keysChecked(json, name);

        return undefined;

    });

/** A conformity assessment body as `ConformityAssessmentBody.TryParse` reads it, with its certificates (`certificates.ts`). */
const conformityAssessmentBody = (json: JSONObject): Checked =>
    caught('a conformity assessment body', () => {

        const id = header(json, 'conformity assessment body identification', freeId, 'conformityAssessmentBody', 'conformity assessment body');

        if (id instanceof Refused)
            return id.error;

        const error = named(json) ??
                      contact(json) ??
                      invalidNotifiedTexts(json) ??
                      children(json, 'certificates', 'certificateIds', 'certificates', invalidCertificate) ??
                      keysError(json) ??
                      metadata(json);

        if (error !== undefined)
            return error;

        const name = `the conformity assessment body '${id.text}'`;

        licensesChecked(json, name);

        // What its constructor refuses of its number, its legislations and its certificates, in its words already.
        const body = invalidBody(json);

        if (body !== undefined)
            return body;

        keysChecked(json, name);

        return undefined;

    });

/** An e-mobility provider as `EMobilityProvider.TryParse` reads it. */
const eMobilityProvider = (json: JSONObject): Checked =>
    caught('an e-mobility provider', () => {

        const id = header(json, 'e-mobility provider identification', providerId, 'eMobilityProvider', 'e-mobility provider');

        if (id instanceof Refused)
            return id.error;

        const error = named(json) ??
                      contact(json) ??
                      keysError(json) ??
                      memberGroups(json) ??
                      children(json, 'chargingTariffOffers', 'chargingTariffOfferIds', 'charging tariff offers', chargingTariffOffer) ??
                      metadata(json);

        if (error !== undefined)
            return error;

        const name = `the e-mobility provider '${id.text}'`;

        licensesChecked(json, name);
        keysChecked(json, name);

        const groups = [ [ 'EVSEGroups', evseGroupId, 'EVSE group' ], [ 'chargingStationGroups', stationGroupId, 'charging station group' ],
                         [ 'chargingPoolGroups', poolGroupId, 'charging pool group' ] ] as const;

        for (const [ property, parser, description ] of groups)
            collection(objectsOf(get(json, property)), parser, description, name);

        for (const [ property, parser ] of groups)
            for (const groupId of objectsOf(get(json, property)).flatMap(item => idOf(item, parser) ?? []).sort((left, right) => left.text < right.text ? -1 : left.text > right.text ? 1 : 0)) {
                const ofProvider = providerId(groupId.text.slice(0, 6));
                if (ofProvider?.key !== id.key)
                    throw thrown(`The group '${groupId.text}' does not belong to ${name}!`, 'EVSEGroups');
            }

        const offers = objectsOf(get(json, 'chargingTariffOffers'));

        collection(offers, freeId, 'charging tariff offer', name);

        for (const offer of [ ...offers ].sort((left, right) => ordinalOf(left, right)))
            if (get(offer, 'sessions') !== undefined || idsAt(offer, 'eMobilityProviderIds', providerId).length > 0)
                throw thrown(`The charging tariff offer '${idOf(offer, freeId)?.text ?? ''}' of ${name} is for sessions with its own contracts: it must name neither sessions nor e-mobility providers!`, 'ChargingTariffOffers');

        return undefined;

    });

/** Two entities in the ordinal order of their identifications, as a POICollection holds them. */
const ordinalOf = (left: JSONObject, right: JSONObject): number => {
    const [ a, b ] = [ idOf(left, freeId)?.text ?? '', idOf(right, freeId)?.text ?? '' ];
    return a < b ? -1 : a > b ? 1 : 0;
};

/** The maintainer of a grid connection point (`POIPartyId.TryParse`): a type and an identification of a party. */
function maintainer(value: JSONValue, id: string): Checked {

    const error = ((): Checked => {

        if (isObject(value) && get(value, '@context') !== undefined && get(value, '@context') !== contextOf('partyId'))
            return `The JSON-LD context of the party must be '${contextOf('partyId')}'!`;

        if (!isObject(value))
            return 'A party must be { "entityType", "entityId" }!';

        const type     = get(value, 'entityType');
        const entityId = get(value, 'entityId');

        return typeof type !== 'string' || typeof entityId !== 'string' || Object.keys(value).length !== (get(value, '@context') === undefined ? 2 : 3) ||
               trimmed(type) === '' || trimmed(entityId) === ''
                   ? 'A party must be { "entityType", "entityId" }!'
                   : undefined;

    })();

    return error === undefined ? undefined : `Invalid maintainer of the grid connection point '${id}': ${error}`;

}

/** A grid connection point as `GridConnectionPoint.TryParse` reads it. */
const gridConnectionPoint = (json: JSONObject): Checked =>
    caught('a grid connection point', () => {

        const id = header(json, 'grid connection point identification', freeId, 'gridConnectionPoint', 'grid connection point');

        if (id instanceof Refused)
            return id.error;

        const powers = [ [ 'contractedImportPower', 'contracted import power' ], [ 'contractedExportPower', 'contracted export power' ],
                         [ 'contractedImportApparentPower', 'contracted import apparent power' ], [ 'contractedExportApparentPower', 'contracted export apparent power' ] ] as const;

        const by = get(json, 'maintainedBy');

        const error = (get(json, 'gridOperator') !== undefined || get(json, 'gridOperatorId') !== undefined
                           ? `The grid connection point '${id.text}' is embedded in its grid operator: it names none!`
                           : undefined) ??
                      (by === undefined ? undefined : maintainer(by, id.text)) ??
                      i18n(json, 'name') ??
                      i18n(json, 'description') ??
                      addressError(json, 'address', 'address') ??
                      geoLocationError(json, 'geoLocation', 'geo location') ??
                      enumeration(json, 'voltageLevel', 'voltage level', [ 'LowVoltage', 'MediumVoltage', 'HighVoltage', 'ExtraHighVoltage' ]) ??
                      enumeration(json, 'connectionType', 'grid connection type', [ 'Unknown', 'AC_SinglePhase', 'AC_SinglePhase_L0', 'AC_SinglePhase_L1', 'AC_SinglePhase_L2', 'AC_ThreePhases' ]) ??
                      text(json, 'connectionAgreementId', 'connection agreement identification') ??
                      text(json, 'networkLocationId', 'network location identification') ??
                      errorOf(texts(json, 'marketLocationIds', 'market location identifications')) ??
                      errorOf(texts(json, 'meteringLocationIds', 'metering location identifications')) ??
                      embeddedEnergyMeter(json) ??
                      errorOf(optionalDecimal(json, 'nominalVoltage', 'nominal voltage')) ??
                      errorOf(optionalDecimal(json, 'nominalFrequency', 'nominal frequency')) ??
                      first(...powers.map(([ property, description ]) => (): Checked => errorOf(optionalDecimal(json, property, description)))) ??
                      withoutTimestamps(json);

        if (error !== undefined)
            return error;

        const of = `the grid connection point '${id.text}'`;

        if (isObject(by) && by['entityType'] !== 'ChargingStationOperator' && by['entityType'] !== 'ParkingOperator')
            throw thrown(`Besides its grid operator, the grid connection point '${id.text}' can only be maintained by a charging station operator or a parking operator, not by ${partyText(by)}!`);

        if ([ 'nominalVoltage', 'nominalFrequency' ].some(property => notPositive(json, property)))
            throw thrown(`The nominal voltage and frequency of ${of} must be positive!`);

        const contracted = powers.map(([ property ]) => optionalDecimal(json, property, property));

        if (contracted.some(isNegative))
            throw thrown(`The contracted powers of ${of} must not be negative!`);

        const [ importPower, exportPower, importApparent, exportApparent ] = contracted;
        const exceeds = (power: Decimal | undefined | Refused, apparent: Decimal | undefined | Refused): boolean =>
            power instanceof Decimal && apparent instanceof Decimal && power.compareTo(apparent) > 0;

        if (exceeds(importPower, importApparent) || exceeds(exportPower, exportApparent))
            throw thrown(`A contracted active power of ${of} must not exceed its apparent power!`);

        for (const [ property, description ] of [ [ 'connectionAgreementId', 'connection agreement identification' ], [ 'networkLocationId', 'network location identification' ] ] as const) {
            const value = get(json, property);
            if (typeof value === 'string' && trimmed(value) === '')
                throw thrown(`A ${description} must not be empty!`);
        }

        for (const [ property, description ] of [ [ 'marketLocationIds', 'market location identification' ], [ 'meteringLocationIds', 'metering location identification' ] ] as const) {
            const given = texts(json, property, '');
            const list  = given instanceof Refused ? [] : given.map(trimmed);
            if (list.some(item => item === ''))
                throw thrown(`A ${description} must not be empty!`);
            if (new Set(list).size !== list.length)
                throw thrown(`A ${description} must not be given twice!`);
        }

        return undefined;

    });

/** A party as `POIPartyId.ToString` names it: "the ChargingStationOperator 'DE*GEF'". */
export const partyText = (party: JSONObject): string =>
    party['entityType'] === 'RoamingNetworkOperator'
        ? asText(party['entityId']) === '' ? 'the roaming network operator, of which this roaming network has none' : `the roaming network operator '${asText(party['entityId'])}'`
        : `the ${asText(party['entityType'])} '${asText(party['entityId'])}'`;

/** The meters of the grid connection points of a grid operator, by their identifications. */
const gridMeters = (json: JSONObject): JSONObject[] =>
    objectsOf(get(json, 'gridConnectionPoints')).flatMap(point => isObject(point['energyMeter']) ? [ point['energyMeter'] ] : []);

/** A grid operator as `GridOperator.TryParse` reads it. */
const gridOperator = (json: JSONObject): Checked =>
    caught('a grid operator', () => {

        const id = header(json, 'grid operator identification', gridOperatorId, 'gridOperator', 'grid operator');

        if (id instanceof Refused)
            return id.error;

        const error = text(json, 'dataSource', 'data source') ??
                      i18n(json, 'name') ??
                      i18n(json, 'description') ??
                      addressError(json, 'address', 'address') ??
                      textError(json, 'homepage', 'homepage', url) ??
                      textError(json, 'hotline', 'hotline phone number', phoneNumber) ??
                      children(json, 'gridConnectionPoints', 'gridConnectionPointIds', 'grid connection points', gridConnectionPoint) ??
                      energyMeterTemplates(json) ??
                      energyMeterGroups(json) ??
                      keysError(json) ??
                      metadata(json);

        if (error !== undefined)
            return error;

        const name = `the grid operator '${id.text}'`;

        keysChecked(json, name);
        collection(objectsOf(get(json, 'gridConnectionPoints')), freeId, 'grid connection point', name);
        collection(objectsOf(get(json, 'energyMeterGroups')), freeId, 'energy meter group', name);

        const meters = new Set(gridMeters(json).flatMap(meter => idOf(meter, freeId)?.key ?? []));

        for (const meterGroup of sorted(objectsOf(get(json, 'energyMeterGroups'))))
            for (const member of sortedIds(idsAt(meterGroup, 'energyMeterIds', freeId)))
                if (!meters.has(member.key))
                    throw thrown(`The member '${member.text}' of the group '${idOf(meterGroup, freeId)?.text ?? ''}' is unknown at ${name}!`, 'EnergyMeterGroups');

        collection(objectsOf(get(json, 'energyMeterTemplates')), freeId, 'energy meter template', name);

        const templates = new Set(objectsOf(get(json, 'energyMeterTemplates')).flatMap(template => idOf(template, freeId)?.key ?? []));

        for (const point of sorted(objectsOf(get(json, 'gridConnectionPoints')))) {
            const meter = point['energyMeter'];
            if (!isObject(meter))
                continue;
            for (const templateId of idsAt(meter, 'templateIds', freeId))
                if (!templates.has(templateId.key))
                    throw thrown(`The template '${templateId.text}' of the energy meter '${idOf(meter, freeId)?.text ?? ''}' is unknown at ${name}!`, 'EnergyMeterTemplates');
        }

        return undefined;

    });

/** Entities in the ordinal order of their identifications, as their POICollection holds them. */
export const sorted = (entities: readonly JSONObject[]): JSONObject[] =>
    [ ...entities ].sort(ordinalOf);

/** Identifications in the ordinal order of their texts. */
export const sortedIds = (list: readonly Id[]): Id[] =>
    [ ...list ].sort((left, right) => left.text < right.text ? -1 : left.text > right.text ? 1 : 0);

/** A parking operator as `ParkingOperator.TryParse` reads it, with its garages, spaces, sensors, templates, groups and products. */
const parkingOperator = (json: JSONObject): Checked =>
    caught('a parking operator', () => {

        const id = header(json, 'parking operator identification', freeId, 'parkingOperator', 'parking operator');

        if (id instanceof Refused)
            return id.error;

        const lists = [ [ 'parkingGarages', 'parkingGarageIds', 'parking garages', parkingGarage, 'parking garage', freeId ],
                        [ 'parkingSpaces', 'parkingSpaceIds', 'parking spaces', parkingSpace, 'parking space', freeId ],
                        [ 'parkingSensors', 'parkingSensorIds', 'parking sensors', parkingSensor, 'parking sensor', freeId ],
                        [ 'parkingSpaceTemplates', 'parkingSpaceTemplateIds', 'parking space templates', parkingSpaceTemplate, 'parking space template', freeId ],
                        [ 'parkingSpaceGroups', 'parkingSpaceGroupIds', 'parking space groups', parkingSpaceGroup, 'parking space group', freeId ],
                        [ 'parkingProducts', 'parkingProductIds', 'parking products', parkingProduct, 'parking product', caseId ] ] as const;

        const error = text(json, 'dataSource', 'data source') ??
                      i18n(json, 'name') ??
                      i18n(json, 'description') ??
                      addressError(json, 'address', 'address') ??
                      textError(json, 'homepage', 'homepage', url) ??
                      textError(json, 'hotline', 'hotline phone number', phoneNumber) ??
                      first(...lists.map(([ property, idsProperty, description, reader ]) => (): Checked => children(json, property, idsProperty, description, reader))) ??
                      keysError(json) ??
                      metadata(json);

        if (error !== undefined)
            return error;

        const name = `the parking operator '${id.text}'`;

        keysChecked(json, name);

        for (const [ property, , , , description, parser ] of lists)
            collection(objectsOf(get(json, property)), parser, description, name);

        const known = (property: string, parser: (text: string) => Id | undefined): Set<string> =>
            new Set(objectsOf(get(json, property)).flatMap(item => idOf(item, parser)?.key ?? []));

        const products = known('parkingProducts', caseId);
        const garages  = known('parkingGarages', freeId);
        const sensors  = known('parkingSensors', freeId);
        const spaces   = known('parkingSpaces', freeId);
        const templates = known('parkingSpaceTemplates', freeId);

        for (const [ property, kind ] of [ [ 'parkingGarages', 'parking garage' ], [ 'parkingSpaces', 'parking space' ], [ 'parkingSpaceTemplates', 'parking space template' ] ] as const)
            for (const owner of sorted(objectsOf(get(json, property))))
                for (const product of sortedIds(idsAt(owner, 'parkingProductIds', caseId)))
                    if (!products.has(product.key))
                        throw thrown(`The parking product '${product.text}' of the ${kind} '${idOf(owner, freeId)?.text ?? ''}' is unknown at ${name}!`, 'ParkingProducts');

        for (const spaceGroup of sorted(objectsOf(get(json, 'parkingSpaceGroups'))))
            for (const member of sortedIds(idsAt(spaceGroup, 'parkingSpaceIds', freeId)))
                if (!spaces.has(member.key))
                    throw thrown(`The parking space '${member.text}' of the parking space group '${idOf(spaceGroup, freeId)?.text ?? ''}' is unknown at ${name}!`, 'ParkingSpaceGroups');

        for (const [ property, kind, parameter ] of [ [ 'parkingSpaces', 'parking space', 'ParkingSpaces' ], [ 'parkingSpaceTemplates', 'parking space template', 'ParkingSpaceTemplates' ] ] as const)
            for (const owner of sorted(objectsOf(get(json, property)))) {
                const ownerId = idOf(owner, freeId)?.text ?? '';
                const garage  = idOf(owner, freeId, 'parkingGarageId');
                if (garage !== undefined && !garages.has(garage.key))
                    throw thrown(`The parking garage '${garage.text}' of the ${kind} '${ownerId}' is unknown at ${name}!`, parameter);
                for (const sensor of sortedIds(idsAt(owner, 'parkingSensorIds', freeId)))
                    if (!sensors.has(sensor.key))
                        throw thrown(`The parking sensor '${sensor.text}' of the ${kind} '${ownerId}' is unknown at ${name}!`, parameter);
            }

        for (const space of sorted(objectsOf(get(json, 'parkingSpaces'))))
            for (const template of idsAt(space, 'templateIds', freeId))
                if (!templates.has(template.key))
                    throw thrown(`The template '${template.text}' of the parking space '${idOf(space, freeId)?.text ?? ''}' is unknown at ${name}!`, 'ParkingSpaceTemplates');

        return undefined;

    });


// ---------------------------------------------------------------------------------------------------------------------------
// The charging station operator

/** A charging station operator as `ChargingStationOperator.TryParse` reads it, then constructs it (`references.ts`). */
const chargingStationOperator = (of: 'version' | 'change set') => (json: JSONObject): Checked =>
    caught('a charging station operator', () => {

        if (Object.keys(json).length === 0)
            return 'The given JSON object must not be null or empty!';

        const id = header(json, 'charging station operator identification', operatorId, 'chargingStationOperator', 'charging station operator');

        if (id instanceof Refused)
            return id.error;

        const merchant = get(json, 'evTaler');

        const error = i18n(json, 'name') ??
                      i18n(json, 'description') ??
                      styxText(json, 'dataSource', 'data source') ??
                      dataLicenses(json) ??
                      addressError(json, 'address', 'address') ??
                      geoLocationError(json, 'geoLocation', 'geo location') ??
                      operatorLogos(json) ??
                      textError(json, 'telephone', 'telephone number', phoneNumber) ??
                      eMailAddressError(json, 'eMailAddress', 'e-mail address') ??
                      textError(json, 'homepage', 'homepage', url) ??
                      textError(json, 'hotline', 'hotline phone number', phoneNumber) ??
                      textError(json, 'termsAndConditions', 'terms and conditions URL', url) ??
                      textError(json, 'webPaymentURL', 'web payment URL', url) ??
                      (merchant === undefined ? undefined : ((): Checked => { const read = evTalerMerchantOf(merchant); return typeof read === 'string' ? read : undefined; })()) ??
                      children(json, 'chargingPools',            'chargingPoolIds',            'charging pools',              chargingPool) ??
                      children(json, 'EVSEGroups',               'EVSEGroupIds',               'EVSEGroups',                  group(EVSE_GROUP)) ??
                      children(json, 'chargingStationGroups',    'chargingStationGroupIds',    'ChargingStationGroups',       group(CHARGING_STATION_GROUP)) ??
                      children(json, 'chargingPoolGroups',       'chargingPoolGroupIds',       'ChargingPoolGroups',          group(CHARGING_POOL_GROUP)) ??
                      children(json, 'chargingTariffGroups',     'chargingTariffGroupIds',     'ChargingTariffGroups',        group(CHARGING_TARIFF_GROUP)) ??
                      energyMeterGroups(json) ??
                      children(json, 'EVSETemplates',            'EVSETemplateIds',            'EVSE templates',              evseTemplate) ??
                      children(json, 'chargingStationTemplates', 'chargingStationTemplateIds', 'charging station templates',  chargingStationTemplate) ??
                      children(json, 'chargingPoolTemplates',    'chargingPoolTemplateIds',    'charging pool templates',     chargingPoolTemplate) ??
                      children(json, 'chargingTariffTemplates',  'chargingTariffTemplateIds',  'charging tariff templates',   chargingTariffTemplate) ??
                      energyMeterTemplates(json) ??
                      children(json, 'parkingSpaces',            'parkingSpaceIds',            'parking spaces',              parkingSpace) ??
                      children(json, 'chargingTariffOffers',     'chargingTariffOfferIds',     'charging tariff offers',      chargingTariffOffer) ??
                      children(json, 'brands',                   'brandIds',                   'brands',                      brandOf) ??
                      children(json, 'chargingTariffs',          'chargingTariffIds',          'charging tariffs',            chargingTariff) ??
                      keysError(json) ??
                      metadata(json);

        if (error !== undefined)
            return error;

        keysChecked(json, `the charging station operator '${id.text}'`);

        return checkOperator(json, id.text, of);

    });

/** The logos of a charging station operator, read by its own `TryParseOptionalText`. */
function operatorLogos(json: JSONObject): Checked {
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


// ---------------------------------------------------------------------------------------------------------------------------
// The roaming network

/** What the roaming network reads of itself before its operator (RoamingNetwork.TryParse): its texts, its metadata, its licenses. */
export const invalidNetworkProperties = (content: JSONObject): Checked =>
    i18n(content, 'name') ??
    i18n(content, 'description') ??
    styxText(content, 'dataSource', 'data source') ??
    metadata(content) ??
    dataLicenses(content);

/**
 * What the roaming network operator reads of itself (RoamingNetworkOperator.TryParse), besides its keys, its key statement
 * and the certificates of its signing keys, which `RoamingNetworkOperator.parse` reads: its texts and its contact, before its
 * keys; its metadata, after them.
 */
export const invalidOperatorTexts = (json: JSONObject): Checked =>
    i18n(json, 'name') ??
    i18n(json, 'description') ??
    styxText(json, 'dataSource', 'data source') ??
    addressError(json, 'address', 'address') ??
    textError(json, 'homepage', 'homepage', url) ??
    textError(json, 'hotline', 'hotline phone number', phoneNumber) ??
    eMailAddressError(json, 'eMailAddress', 'e-mail address') ??
    eMailAddressError(json, 'hotlineEMailAddress', 'hotline e-mail address');

export const invalidOperatorMetadata = (json: JSONObject): Checked =>
    metadata(json);

/**
 * The error, when WWCP_POI3 refuses a party of the given content as it reads it, in its order: the charging station
 * manufacturers, e-mobility providers, grid operators, parking operators, transparency software manufacturers, conformity
 * assessment bodies and energy meter manufacturers, then the charging station operators; undefined for none.
 */
export function invalidReading(content: JSONObject, of: 'version' | 'change set' = 'version'): Checked {

    try {

        const error = children(content, 'chargingStationManufacturers',       'chargingStationManufacturerIds',       'charging station manufacturers',       manufacturer(false)) ??
                      children(content, 'eMobilityProviders',                 'eMobilityProviderIds',                 'e-mobility providers',                 eMobilityProvider) ??
                      children(content, 'gridOperators',                      'gridOperatorIds',                      'grid operators',                       gridOperator) ??
                      children(content, 'parkingOperators',                   'parkingOperatorIds',                   'parking operators',                    parkingOperator) ??
                      children(content, 'transparencySoftwareManufacturers',  'transparencySoftwareManufacturerIds',  'transparency software manufacturers',  softwareManufacturer) ??
                      children(content, 'conformityAssessmentBodies',         'conformityAssessmentBodyIds',          'conformity assessment bodies',         conformityAssessmentBody) ??
                      children(content, 'energyMeterManufacturers',           'energyMeterManufacturerIds',           'energy meter manufacturers',           manufacturer(true));

        if (error !== undefined)
            return error;

        if (get(content, 'chargingStationOperatorIds') !== undefined)
            return "Charging station operators given only by their identifications can not be read; they must be given completely as 'chargingStationOperators'!";

        const operators = get(content, 'chargingStationOperators');

        if (operators === undefined)
            return undefined;

        if (!isArray(operators))
            return 'The charging station operators must be a JSON array!';

        for (const operator of operators) {
            if (!isObject(operator))
                return 'A charging station operator must be a JSON object!';
            const operatorError = chargingStationOperator(of)(operator);
            if (operatorError !== undefined)
                return operatorError;
        }

        return undefined;

    }
    catch (e) {
        if (e instanceof Thrown)
            return `The given JSON representation of a roaming network is invalid: ${e.message}`;
        throw e;
    }

}

