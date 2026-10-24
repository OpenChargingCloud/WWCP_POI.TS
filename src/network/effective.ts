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

import { canonicalJSON, ordinal }                 from '../json/canonical.ts';
import { asText, clone, get, isArray, isObject, set, type JSONArray, type JSONObject, type JSONValue } from '../json/value.ts';
import { parseTimestamp, toTimestamp }            from '../common.ts';
import { POIError }                               from '../errors.ts';


// The effective members of a version (SPECIFICATION.md sections 8.1 and 9.2), calculated on the JSON of the content as
// ChargingStationOperator.Effective.cs, ChargingTariffTemplate.Effective and EnergyMeterTemplate.Effective of the C#
// implementation calculate them on its model: of every property a template may give, a single value is the member's own,
// else the one of its first template giving one; an array is the member's own united with those of its templates, of
// elements with the same key the member's own, else the one of the first template giving it; then each array in the order
// the member keeps it.


/** How an array the templates may give is united and kept. */
interface UnionRule {
    /** The key of an element: elements of the same key are given once, the member's own first. Without, the element itself. */
    readonly key?:   (element: JSONValue) => string;
    /** Whether the member keeps the array in the ordinal order of its keys, or as given. */
    readonly order:  'ordinal' | 'given';
}

interface MemberRules {
    readonly singles:  readonly string[];
    readonly unions:   Readonly<Record<string, UnionRule>>;
}


const byId           = (element: JSONValue): string => isObject(element) && typeof element['@id'] === 'string' ? element['@id'] : canonicalJSON(element);
const byURL          = (element: JSONValue): string => isObject(element) && typeof element['url'] === 'string' ? element['url'] : canonicalJSON(element);
const byType         = (element: JSONValue): string => isObject(element) && typeof element['type'] === 'string' ? element['type'] : canonicalJSON(element);
const byText         = (element: JSONValue): string => typeof element === 'string' ? element : canonicalJSON(element);
const byJSON         = (element: JSONValue): string => canonicalJSON(element);
const bySoftwareId   = (element: JSONValue): string => isObject(element) && typeof element['transparencySoftwareId'] === 'string' ? element['transparencySoftwareId'] : canonicalJSON(element);

const ordinalIds:   UnionRule = { key: byText, order: 'ordinal' };
const keptIds:      UnionRule = { key: byText, order: 'given'   };


/** Effective(EVSE, …) of ChargingStationOperator.Effective.cs. */
const EVSE_RULES: MemberRules = {
    singles: [ 'physicalReference', 'currentTypes', 'chargingModes', 'maxVoltage', 'maxCurrent', 'maxPower', 'geoLocation',
               'maxReservationDuration', 'reachDistance', 'operationTimeout', 'extendedOperationTimeout', 'floorLevel' ],
    unions:  {
        chargingConnectors:            { key: byId,  order: 'ordinal' },
        brands:                        { key: byId,  order: 'ordinal' },
        images:                        { key: byURL, order: 'given'   },
        standards:                     ordinalIds,
        acceptedEMobilityProviderIds:  ordinalIds,
    },
};

/** Effective(ChargingStation, …) of ChargingStationOperator.Effective.cs. */
const CHARGING_STATION_RULES: MemberRules = {
    singles: [ 'physicalReference', 'address', 'geoLocation', 'hotline', 'manufacturerId', 'modelId', 'openingTimes',
               'accessibility', 'calibrationInfo', 'certificationInfo', 'maxPower' ],
    unions:  {
        brands:               { key: byId,  order: 'ordinal' },
        images:               { key: byURL, order: 'given'   },
        vehicleTypes:         ordinalIds,
        euVehicleCategories:  ordinalIds,
        features:             ordinalIds,
        parkingSpaceIds:      ordinalIds,
    },
};

/** Effective(ChargingPool, …) of ChargingStationOperator.Effective.cs. */
const CHARGING_POOL_RULES: MemberRules = {
    singles: [ 'address', 'geoLocation', 'parkingType', 'accessibility', 'hotline', 'gridConnectionPointId', 'openingTimes',
               'energyMix', 'timeZone', 'entranceAddress', 'entranceLocation', 'exitAddress', 'exitLocation',
               'arrivalInstructions', 'chargingWhenClosed', 'assistanceServiceDetails' ],
    unions:  {
        dataLicenses:         { key: byId,   order: 'ordinal' },
        brands:               { key: byId,   order: 'ordinal' },
        images:               { key: byURL,  order: 'given'   },
        authenticationModes:  { key: byType, order: 'ordinal' },
        relatedLocations:     { key: byJSON, order: 'given'   },
        facilities:           ordinalIds,
        paymentOptions:       ordinalIds,
        uiFeatures:           ordinalIds,
        features:             ordinalIds,
        locationLanguages:    keptIds,
        parkingRestrictions:  ordinalIds,
        services:             ordinalIds,
        standards:            ordinalIds,
        nutsCodes:            ordinalIds,
    },
};

/** ChargingTariffTemplate.Effective; `elements` are taken as a whole, below. */
const CHARGING_TARIFF_RULES: MemberRules = {
    singles: [ 'currency', 'tariffURL', 'energyMix', 'tariffType', 'minPrice', 'maxPrice', 'validFrom', 'validUntil' ],
    unions:  {
        paymentMeans:   ordinalIds,
        paymentBrands:  ordinalIds,
    },
};

/** EnergyMeterTemplate.Effective: the serial number and the public keys belong to the single device. */
const ENERGY_METER_RULES: MemberRules = {
    singles: [ 'role', 'manufacturerId', 'modelId', 'modelURL', 'hardwareVersion', 'firmwareVersion' ],
    unions:  {
        transparencySoftwareStatus:  { key: bySoftwareId, order: 'ordinal' },
        signatureMethods:            ordinalIds,
    },
};


/** Whether a value counts as given: a multilingual text without texts does not (`Given` of the C# implementation). */
function isGiven(property: string, value: JSONValue | undefined): value is JSONValue {

    if (value === undefined || value === null)
        return false;

    if ((property === 'arrivalInstructions' || property === 'assistanceServiceDetails') && isObject(value))
        return Object.keys(value).length > 0;

    return true;

}


/** The templates a member names, in the order it names them; one that does not exist is left out, as the C# implementation does. */
function templatesOf(member: JSONObject, templates: ReadonlyMap<string, JSONObject>): JSONObject[] {

    const ids = get(member, 'templateIds');

    if (ids === undefined)
        return [];

    if (!isArray(ids) || ids.some(id => typeof id !== 'string'))
        throw new POIError(`The templateIds of '${asText(member['@id'])}' must be an array of texts!`);

    return (ids as string[]).flatMap(id => {
        const template = templates.get(id);
        return template !== undefined ? [ template ] : [];
    });

}

const lastChangeOf = (entity: JSONObject): number =>
    parseTimestamp(asText(get(entity, 'lastChange')), `The lastChange of '${asText(entity['@id'])}'`);

const latest = (...times: Array<number | undefined>): number =>
    Math.max(...times.filter((time): time is number => time !== undefined));


/** The member with the single values and the arrays of its templates (POITemplateValues.Single and .Union). */
function applyTemplates(member: JSONObject, templates: readonly JSONObject[], rules: MemberRules): JSONObject {

    const effective = clone(member);

    for (const property of rules.singles) {

        if (isGiven(property, get(member, property)))
            continue;

        const given = templates.map(template => get(template, property)).find(value => isGiven(property, value));

        if (given !== undefined)
            set(effective, property, clone(given));

    }

    for (const [property, rule] of Object.entries(rules.unions)) {

        const own       = get(member, property);
        const elements: JSONArray = isArray(own) ? [ ...own ] : [];
        const key       = rule.key ?? byJSON;
        const taken     = new Set(elements.map(key));

        for (const template of templates) {
            const values = get(template, property);
            if (isArray(values))
                for (const element of values)
                    if (!taken.has(key(element))) {
                        taken.add(key(element));
                        elements.push(clone(element));
                    }
        }

        if (rule.order === 'ordinal')
            elements.sort((left, right) => ordinal(key(left), key(right)));

        if (elements.length > 0)
            set(effective, property, elements);

    }

    return effective;

}


/** EnergyMeterTemplate.Effective. */
function effectiveEnergyMeter(meter: JSONObject, templates: ReadonlyMap<string, JSONObject>): JSONObject {

    if (!hasTemplates(meter))
        return meter;

    const ofTemplates = templatesOf(meter, templates);
    const effective   = applyTemplates(meter, ofTemplates, ENERGY_METER_RULES);
    set(effective, 'lastChange', toTimestamp(latest(lastChangeOf(meter), ...ofTemplates.map(lastChangeOf))));

    return effective;

}

const hasTemplates = (entity: JSONValue | undefined): boolean =>
    isObject(entity) && isArray(get(entity, 'templateIds')) && (get(entity, 'templateIds') as JSONArray).length > 0;


/** The effective energy meters of an array, and the latest `lastChange` of those differing from their own. */
function effectiveEnergyMeters(meters: JSONValue | undefined, templates: ReadonlyMap<string, JSONObject>): { meters: JSONObject[] | undefined, lastChanges: number[] } {

    if (meters === undefined)
        return { meters: undefined, lastChanges: [] };

    if (!isArray(meters) || !meters.every(isObject))
        throw new POIError('The energyMeters must be an array of objects!');

    const lastChanges: number[] = [];

    const effective = meters.map(meter => {
        const result = effectiveEnergyMeter(meter, templates);
        if (result !== meter)
            lastChanges.push(lastChangeOf(result));
        return result;
    });

    return { meters: effective, lastChanges };

}


/** A charging tariff named by a template, with the `lastChange` of that template. */
interface TemplateTariff {
    readonly id:          string;
    readonly lastChange:  number;
}

function tariffOf(templates: readonly JSONObject[]): TemplateTariff | undefined {

    for (const template of templates) {
        const id = get(template, 'chargingTariffId');
        if (typeof id === 'string')
            return { id, lastChange: lastChangeOf(template) };
    }

    return undefined;

}


function mapOf(operator: JSONObject, property: string): Map<string, JSONObject> {

    const map    = new Map<string, JSONObject>();
    const values = get(operator, property);

    if (isArray(values))
        for (const value of values)
            if (isObject(value) && typeof value['@id'] === 'string')
                map.set(value['@id'], value);

    return map;

}

const objects = (value: JSONValue | undefined, what: string): JSONObject[] => {
    if (value === undefined)
        return [];
    if (!isArray(value) || !value.every(isObject))
        throw new POIError(`The ${what} must be an array of objects!`);
    return value;
};


/**
 * The charging station operator with its effective charging pools, charging stations, EVSEs and charging tariffs, as the
 * effective content embeds it (8.1): the members naming no templates, taking no charging tariff of a template and embedding
 * only members that are themselves, are as they are.
 */
export function effectiveChargingStationOperator(operator: JSONObject): JSONObject {

    const evseTemplates      = mapOf(operator, 'EVSETemplates');
    const stationTemplates   = mapOf(operator, 'chargingStationTemplates');
    const poolTemplates      = mapOf(operator, 'chargingPoolTemplates');
    const tariffTemplates    = mapOf(operator, 'chargingTariffTemplates');
    const meterTemplates     = mapOf(operator, 'energyMeterTemplates');

    const result             = clone(operator);

    /** Whether a mapping changed anything: an entity without anything to apply is given back as it is. */
    const anyChanged = (effective: readonly JSONObject[], given: readonly JSONObject[]): boolean =>
        effective.some((entity, index) => entity !== given[index]);

    // Charging pools, their charging stations and EVSEs.
    const pools           = objects(get(operator, 'chargingPools'), 'charging pools');
    const effectivePools  = pools.map(pool => {

        const ofPool            = templatesOf(pool, poolTemplates);
        const stations          = objects(get(pool, 'chargingStations'), 'charging stations');

        const effectiveStations = stations.map(station => {

            const ofStation   = templatesOf(station, stationTemplates);
            const evses       = objects(get(station, 'EVSEs'), 'EVSEs');

            const effectiveEVSEs = evses.map(evse => {

                const ownTariffs  = get(evse, 'chargingTariffIds');
                const ofEVSE      = templatesOf(evse, evseTemplates);
                const tariff      = isArray(ownTariffs) && ownTariffs.length > 0
                                        ? undefined
                                        : tariffOf(ofEVSE) ?? tariffOf(ofStation) ?? tariffOf(ofPool);

                if (!hasTemplates(evse) && tariff === undefined && !hasTemplates(get(evse, 'energyMeter')))
                    return evse;

                const effective  = applyTemplates(evse, ofEVSE, EVSE_RULES);
                const meter      = get(evse, 'energyMeter');
                let   meterTime: number | undefined;

                if (tariff !== undefined)
                    set(effective, 'chargingTariffIds', [ tariff.id ]);

                if (isObject(meter)) {
                    const effectiveMeter = effectiveEnergyMeter(meter, meterTemplates);
                    set(effective, 'energyMeter', effectiveMeter);
                    if (effectiveMeter !== meter)
                        meterTime = lastChangeOf(effectiveMeter);
                }

                set(effective, 'lastChange', toTimestamp(latest(lastChangeOf(evse), ...ofEVSE.map(lastChangeOf), tariff?.lastChange, meterTime)));

                return effective;

            });

            const meters = effectiveEnergyMeters(get(station, 'energyMeters'), meterTemplates);

            if (!hasTemplates(station) && !anyChanged(effectiveEVSEs, evses) && meters.lastChanges.length === 0)
                return station;

            const effective = applyTemplates(station, ofStation, CHARGING_STATION_RULES);

            if (effectiveEVSEs.length > 0)
                set(effective, 'EVSEs', effectiveEVSEs);

            if (meters.meters !== undefined)
                set(effective, 'energyMeters', meters.meters);

            set(effective, 'lastChange', toTimestamp(latest(lastChangeOf(station), ...ofStation.map(lastChangeOf), ...effectiveEVSEs.map(lastChangeOf), ...meters.lastChanges)));

            return effective;

        });

        const meters = effectiveEnergyMeters(get(pool, 'energyMeters'), meterTemplates);

        if (!hasTemplates(pool) && !anyChanged(effectiveStations, stations) && meters.lastChanges.length === 0)
            return pool;

        const effective = applyTemplates(pool, ofPool, CHARGING_POOL_RULES);

        if (effectiveStations.length > 0)
            set(effective, 'chargingStations', effectiveStations);

        if (meters.meters !== undefined)
            set(effective, 'energyMeters', meters.meters);

        set(effective, 'lastChange', toTimestamp(latest(lastChangeOf(pool), ...ofPool.map(lastChangeOf), ...effectiveStations.map(lastChangeOf), ...meters.lastChanges)));

        return effective;

    });

    if (pools.length > 0)
        set(result, 'chargingPools', effectivePools);

    // Charging tariffs, with the properties of their templates.
    const tariffs           = objects(get(operator, 'chargingTariffs'), 'charging tariffs');
    const effectiveTariffs  = tariffs.map(tariff => {

        const ofTariff = templatesOf(tariff, tariffTemplates);

        if (!hasTemplates(tariff)) {
            if (get(tariff, 'currency') === undefined || !isArray(get(tariff, 'elements')) || (get(tariff, 'elements') as JSONArray).length === 0)
                throw new POIError(`The charging tariff '${asText(tariff['@id'])}' has no currency or no elements, neither of its own nor of its templates!`);
            return tariff;
        }

        const effective  = applyTemplates(tariff, ofTariff, CHARGING_TARIFF_RULES);
        const own        = get(tariff, 'elements');

        if (!isArray(own) || own.length === 0) {
            const elements = ofTariff.map(template => get(template, 'elements')).find(elements => isArray(elements) && elements.length > 0);
            if (elements !== undefined)
                set(effective, 'elements', clone(elements));
        }

        if (get(effective, 'currency') === undefined || !isArray(get(effective, 'elements')))
            throw new POIError(`The charging tariff '${asText(tariff['@id'])}' has no currency or no elements, neither of its own nor of its templates!`);

        set(effective, 'lastChange', toTimestamp(latest(lastChangeOf(tariff), ...ofTariff.map(lastChangeOf))));

        return effective;

    });

    if (tariffs.length > 0)
        set(result, 'chargingTariffs', effectiveTariffs);

    return anyChanged(effectivePools, pools) || anyChanged(effectiveTariffs, tariffs) ? result : operator;

}


/** Parking operators and grid operators whose members take properties of templates are not calculated here yet. */
function refuseUnsupportedTemplates(network: JSONObject): void {

    for (const parkingOperator of objects(get(network, 'parkingOperators'), 'parking operators'))
        for (const space of objects(get(parkingOperator, 'parkingSpaces'), 'parking spaces'))
            if (hasTemplates(space))
                throw new POIError(`The parking space '${asText(space['@id'])}' takes properties of templates, which this library does not calculate yet!`);

    for (const gridOperator of objects(get(network, 'gridOperators'), 'grid operators'))
        for (const point of objects(get(gridOperator, 'gridConnectionPoints'), 'grid connection points'))
            for (const meter of objects(get(point, 'energyMeters'), 'energy meters'))
                if (hasTemplates(meter))
                    throw new POIError(`The energy meter '${asText(meter['@id'])}' of the grid connection point '${asText(point['@id'])}' takes properties of templates, which this library does not calculate yet!`);

}


/**
 * The effective content of a version (8.1): its content with every charging pool, charging station, EVSE and charging
 * tariff replaced by its effective one; templates, groups, offers and every other entity as in the content.
 */
export function effectiveContent(content: JSONObject): JSONObject {

    refuseUnsupportedTemplates(content);

    const operators = get(content, 'chargingStationOperators');

    if (!isArray(operators))
        return content;

    const effective = clone(content);
    set(effective, 'chargingStationOperators', objects(operators, 'charging station operators').map(effectiveChargingStationOperator));

    return effective;

}
