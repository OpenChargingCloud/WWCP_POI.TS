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
import { canonicalJSON }          from '../json/canonical.ts';
import { asText, get, isArray, isObject, type JSONObject, type JSONValue } from '../json/value.ts';
import { evseGroupId, evseId, evseTemplateId, freeId, idOf, idsOf, operatorId, operatorOf, optionalDecimal, poolGroupId, poolId,
         poolTemplateId, providerId, stationGroupId, stationId, stationTemplateId, tariffGroupId, tariffId, tariffTemplateId,
         thrown, Thrown, timestampOf, type Checked, type Id } from './poiJSON.ts';
import { firstOverlap, offerOf, sessionsOverlap, timeZoneNamed, UTC, type TimeZone } from './offers.ts';
import { EV_TALER_PAYMENT_OPTION, namesEVTaler } from './evTaler.ts';
import { duplicateIdentification, ignoringCase, inRoamingNetwork } from './identifications.ts';
import { readPartyKeys }          from './partyKeys.ts';
import { trimmed }                from './versionTexts.ts';


// What WWCP_POI3 refuses of the entities it read as it makes a charging station operator and the roaming network of them:
// what the constructor of a charging station operator refuses of its members, templates, tariffs, groups and offers
// (ChargingStationOperator.cs), as its TryParse names it ("The given JSON representation of a charging station operator is
// invalid: …"); then what the constructor of the roaming network refuses of its parties (RoamingNetwork.cs), each as an
// argument of its parameter, which its TryParse names ("The given JSON representation of a roaming network is invalid: …
// (Parameter 'ChargingStationManufacturers')"): an identification given twice, a reference to a party, a model, a hardware
// revision, a firmware version, a release, a certificate, a grid connection point, a charging station, a parking space or
// a maintainer the network does not have, a station or a meter contradicting its model, a key of two parties. After the
// last change of a change set it names them bare, in the order it checks them there (RoamingNetwork.ChangeSets.cs).


// ---------------------------------------------------------------------------------------------------------------------------
// Entities as the collections of WWCP_POI hold them

const objectsAt = (json: JSONObject, property: string): JSONObject[] => {
    const value = get(json, property);
    return isArray(value) ? value.filter(isObject) : [];
};

const ordinalText = (left: string, right: string): number =>
    left < right ? -1 : left > right ? 1 : 0;

/**
 * The entities of the given property in the ordinal order of their identifications, as their POICollection holds them;
 * once per holder, property and parser while the network or an operator is checked.
 */
function sortedAt(json: JSONObject, property: string, parser: (text: string) => Id | undefined): readonly JSONObject[] {

    const ofHolder = SORTED.get(json) ?? new Map<(text: string) => Id | undefined, Map<string, readonly JSONObject[]>>();
    const ofParser = ofHolder.get(parser) ?? new Map<string, readonly JSONObject[]>();
    const known    = ofParser.get(property);

    if (known !== undefined)
        return known;

    const sorted = objectsAt(json, property).
                       map(entity => ({ entity, id: idOf(entity, parser)?.text ?? '' })).
                       sort((left, right) => ordinalText(left.id, right.id)).
                       map(item => item.entity);

    ofParser.set(property, sorted);
    ofHolder.set(parser, ofParser);
    SORTED.set(json, ofHolder);

    return sorted;

}

/** The identification of an entity of the given kind, as its type reads it. */
const textOf = (entity: JSONObject, parser: (text: string) => Id | undefined = freeId): string =>
    idOf(entity, parser)?.text ?? '';

const keyOf = (entity: JSONObject, parser: (text: string) => Id | undefined = freeId): string =>
    idOf(entity, parser)?.key ?? '';

/** Identifications in the ordinal order of their texts, as `POIJSON.OrderedIds` keeps them. */
const ordered = (ids: readonly Id[]): Id[] =>
    [ ...ids ].sort((left, right) => ordinalText(left.text, right.text));

/** The first entity of the given ones whose identification one before has: the later one, as a POICollection names it. */
function laterTwice(entities: readonly JSONObject[], parser: (text: string) => Id | undefined): string | undefined {
    const seen = new Set<string>();
    for (const entity of entities) {
        const id = idOf(entity, parser);
        if (id === undefined)
            continue;
        if (seen.has(id.key))
            return id.text;
        seen.add(id.key);
    }
    return undefined;
}

/** An optional text of an entity, trimmed as its type reads it; undefined for none. */
const trimmedAt = (json: JSONObject, property: string): string | undefined => {
    const value = get(json, property);
    return typeof value === 'string' && trimmed(value) !== '' ? trimmed(value) : undefined;
};

/** A hardware revision or a firmware version, as it is. */
const versionAt = (json: JSONObject, property: string): string | undefined => {
    const value = get(json, property);
    return typeof value === 'string' ? value : undefined;
};

/** The texts of an array of the given property. */
const textsAt = (json: JSONObject, property: string): string[] => {
    const value = get(json, property);
    return isArray(value) ? value.filter(item => typeof item === 'string') : [];
};

const isGiven = (value: JSONValue | undefined): value is JSONValue =>
    value !== undefined && value !== null;


// ---------------------------------------------------------------------------------------------------------------------------
// Effective members (POITemplateValues, ChargingStationOperator.Effective.cs, EnergyMeterTemplate.Effective)

/**
 * The templates of a party of the given property by their identifications, the first of each, once per party and property
 * while the network or an operator is checked (`whileChecking`): the content may be changed between two checks.
 */
let TEMPLATES = new WeakMap<JSONObject, Map<string, Map<string, JSONObject>>>();

/** The effective charging stations of an operator, once per operator while the network or an operator is checked. */
let EFFECTIVE = new WeakMap<JSONObject, readonly EffectiveStation[]>();

/** The members, groups and time zones of an operator its offers cover, once per operator while it is checked. */
let MEMBERS = new WeakMap<JSONObject, Members>();

/** The entities of a holder, by the parser and the property `sortedAt` sorts them by, while it is checked. */
let SORTED = new WeakMap<JSONObject, Map<(text: string) => Id | undefined, Map<string, readonly JSONObject[]>>>();

/** The energy meters of an operator, and every meter of a network, effective or not, while it is checked. */
let METERS            = new WeakMap<JSONObject, readonly JSONObject[]>();
let ALL_METERS        = new WeakMap<Network, readonly { meter: JSONObject, owner: JSONObject }[]>();
let EFFECTIVE_METERS  = new WeakMap<Network, readonly JSONObject[]>();
let EFFECTIVE_METER   = new WeakMap<JSONObject, Map<JSONObject, JSONObject>>();

/** The keys of the charging stations of an operator, as parking spaces and others name them, while it is checked. */
let STATIONS          = new WeakMap<JSONObject, ReadonlySet<string>>();

/** How deep the checks of the network or of an operator are nested: they remember what they found while it is above 0. */
let checking = 0;

const fresh = (): void => {
    TEMPLATES         = new WeakMap();
    EFFECTIVE         = new WeakMap();
    MEMBERS           = new WeakMap();
    SORTED            = new WeakMap();
    METERS            = new WeakMap();
    ALL_METERS        = new WeakMap();
    EFFECTIVE_METERS  = new WeakMap();
    EFFECTIVE_METER   = new WeakMap();
    STATIONS          = new WeakMap();
};

/**
 * The given check of the network or of an operator, remembering what it found within it: nothing of a check before, as the
 * content may be changed between two checks, e.g. by a change set, and nothing after it.
 */
export function whileChecking<T>(check: () => T): T {

    if (checking === 0)
        fresh();

    checking++;

    try {
        return check();
    }
    finally {
        checking--;
        if (checking === 0)
            fresh();
    }

}

function templateIndex(owner: JSONObject, property: string, parser: (text: string) => Id | undefined): Map<string, JSONObject> {

    let ofOwner = TEMPLATES.get(owner);

    if (ofOwner === undefined) {
        ofOwner = new Map<string, Map<string, JSONObject>>();
        TEMPLATES.set(owner, ofOwner);
    }

    let index = ofOwner.get(property);

    if (index === undefined) {
        index = new Map<string, JSONObject>();
        for (const template of objectsAt(owner, property)) {
            const key = idOf(template, parser)?.key;
            if (key !== undefined && !index.has(key))
                index.set(key, template);
        }
        ofOwner.set(property, index);
    }

    return index;

}

/** The templates of the given property of its owner the given member names, in its order; unknown ones left out. */
function templatesOf(member: JSONObject, owner: JSONObject, property: string, parser: (text: string) => Id | undefined): JSONObject[] {
    const index = templateIndex(owner, property, parser);
    return idsOf(get(member, 'templateIds'), parser).flatMap(id => {
        const template = index.get(id.key);
        return template === undefined ? [] : [ template ];
    });
}

/** The member with the single values of its templates where it has none, and its lists united with theirs. */
function withTemplates(member: JSONObject, templates: readonly JSONObject[], singles: readonly string[], unions: Readonly<Record<string, (value: JSONValue) => string>>): JSONObject {

    if (templates.length === 0)
        return member;

    const effective: JSONObject = { ...member };

    // The value of the first template giving one.
    for (const property of singles)
        if (!isGiven(get(member, property)))
            for (const template of templates) {
                const given = get(template, property);
                if (isGiven(given)) {
                    effective[property] = given;
                    break;
                }
            }

    for (const [ property, key ] of Object.entries(unions)) {

        // No template adds to the list: it is the own one, as it is.
        if (!templates.some(template => isArray(get(template, property))))
            continue;

        const own   = get(member, property);
        const items = isArray(own) ? [ ...own ] : [];
        const taken = new Set(items.map(key));
        for (const template of templates) {
            const values = get(template, property);
            for (const item of isArray(values) ? values : [])
                if (!taken.has(key(item))) {
                    taken.add(key(item));
                    items.push(item);
                }
        }
        if (items.length > 0)
            effective[property] = items;
    }

    return effective;

}

const byText    = (value: JSONValue): string => typeof value === 'string' ? ignoringCase(trimmed(value)) : canonicalJSON(value);
const byRelease = (value: JSONValue): string => isObject(value) && typeof value['transparencySoftwareId'] === 'string' ? ignoringCase(trimmed(value['transparencySoftwareId'])) : canonicalJSON(value);

const METER_SINGLES   = [ 'role', 'manufacturerId', 'modelId', 'modelURL', 'hardwareRevision', 'firmwareVersion' ];
const METER_UNIONS    = { transparencySoftwareStatus: byRelease, signatureMethods: byText, certificateIds: byText };
const STATION_SINGLES = [ 'physicalReference', 'address', 'geoLocation', 'hotline', 'manufacturerId', 'modelId', 'modelURL', 'hardwareRevision',
                          'firmwareVersion', 'openingTimes', 'accessibility', 'calibrationInfo', 'certificationInfo', 'maxPower' ];
const STATION_UNIONS  = { transparencySoftwareStatus: byRelease, vehicleTypes: byText, euVehicleCategories: byText, features: byText,
                          parkingSpaceIds: byText, certificateIds: byText, signatureMethods: byText };
const EVSE_SINGLES    = [ 'physicalReference', 'maxVoltage', 'maxCurrent', 'maxPower', 'geoLocation', 'maxReservationDuration', 'reachDistance',
                          'operationTimeout', 'extendedOperationTimeout', 'floorLevel' ];

/** An energy meter with what the templates of its owner give it (`EnergyMeterTemplate.Effective`), once while it is checked. */
function effectiveMeter(meter: JSONObject, owner: JSONObject): JSONObject {

    const ofMeter = EFFECTIVE_METER.get(meter) ?? new Map<JSONObject, JSONObject>();
    const known   = ofMeter.get(owner);

    if (known !== undefined)
        return known;

    const effective = withTemplates(meter, templatesOf(meter, owner, 'energyMeterTemplates', freeId), METER_SINGLES, METER_UNIONS);

    ofMeter.set(owner, effective);
    EFFECTIVE_METER.set(meter, ofMeter);

    return effective;

}

/** A charging station of an operator as at runtime, with its effective EVSEs (`EffectiveChargingStations`). */
interface EffectiveStation {
    readonly station:   JSONObject;
    readonly id:        string;
    readonly evses:     readonly JSONObject[];
    /** Its energy meters and those of its EVSEs, effective. */
    readonly meters:    readonly JSONObject[];
    /** Whether WWCP_POI3 makes it again with what its templates or its EVSEs give it. */
    readonly rebuilt:   boolean;
    readonly with:      string;
}

/** The templates of a member as WWCP_POI3 names them in a message: "with the properties of its templates 'A', 'B'". */
const withNames = (templates: readonly JSONObject[], parser: (text: string) => Id | undefined): string =>
    templates.length === 0
        ? 'with what it embeds as it is at runtime'
        : `with the properties of its templates ${templates.map(template => `'${textOf(template, parser)}'`).join(', ')}`;

/** The charging pools of an operator, ordinally, and their charging stations, ordinally. */
const poolsOf = (operator: JSONObject): readonly JSONObject[] =>
    sortedAt(operator, 'chargingPools', poolId);

const stationsOf = (pool: JSONObject): readonly JSONObject[] =>
    sortedAt(pool, 'chargingStations', stationId);

const evsesOf = (station: JSONObject): readonly JSONObject[] =>
    sortedAt(station, 'EVSEs', evseId);

/** The effective charging stations of an operator, pools and stations ordinally. */
function effectiveStations(operator: JSONObject): readonly EffectiveStation[] {

    const known = EFFECTIVE.get(operator);

    if (known !== undefined)
        return known;

    const stations = poolsOf(operator).flatMap(pool => stationsOf(pool).map((station): EffectiveStation => {

        const ofStation  = templatesOf(station, operator, 'chargingStationTemplates', stationTemplateId);
        let   rebuilt    = ofStation.length > 0;

        const evses = evsesOf(station).map(evse => {
            const ofEVSE = templatesOf(evse, operator, 'EVSETemplates', evseTemplateId);
            const meter  = get(evse, 'energyMeter');
            if (ofEVSE.length > 0 || (isObject(meter) && idsOf(get(meter, 'templateIds'), freeId).length > 0))
                rebuilt = true;
            const effective = withTemplates(evse, ofEVSE, EVSE_SINGLES, {});
            return isObject(meter) ? { ...effective, energyMeter: effectiveMeter(meter, operator) } : effective;
        });

        const ownMeters = sortedAt(station, 'energyMeters', freeId).map(meter => effectiveMeter(meter, operator));
        const effective = withTemplates(station, ofStation, STATION_SINGLES, STATION_UNIONS);

        return {
            station:  effective,
            id:       textOf(station, stationId),
            evses,
            meters:   [ ...ownMeters, ...evses.flatMap(evse => isObject(evse['energyMeter']) ? [ evse['energyMeter'] ] : []) ],
            rebuilt:  rebuilt || objectsAt(station, 'energyMeters').some(meter => idsOf(get(meter, 'templateIds'), freeId).length > 0),
            with:     withNames(ofStation, stationTemplateId),
        };

    }));

    EFFECTIVE.set(operator, stations);

    return stations;

}

/** The energy meters of an operator (`EnergyMeters`): per pool its own, then per station its own and those of its EVSEs. */
function metersOfOperator(operator: JSONObject): readonly JSONObject[] {

    const known = METERS.get(operator);

    if (known !== undefined)
        return known;

    const meters = poolsOf(operator).flatMap(pool => [
        ...sortedAt(pool, 'energyMeters', freeId),
        ...stationsOf(pool).flatMap(station => [
            ...sortedAt(station, 'energyMeters', freeId),
            ...evsesOf(station).flatMap(evse => isObject(evse['energyMeter']) ? [ evse['energyMeter'] ] : []),
        ]),
    ]);

    METERS.set(operator, meters);

    return meters;

}

/** The energy meters of a grid operator: of its grid connection points, ordinally. */
const metersOfGridOperator = (gridOperator: JSONObject): JSONObject[] =>
    sortedAt(gridOperator, 'gridConnectionPoints', freeId).flatMap(point => isObject(point['energyMeter']) ? [ point['energyMeter'] ] : []);

/** Every energy meter of the network with its owner (`AllEnergyMeters`): of the operators, then of the grid operators. */
function allMeters(network: Network): readonly { meter: JSONObject, owner: JSONObject }[] {

    const known = ALL_METERS.get(network);

    if (known !== undefined)
        return known;

    const meters = [
        ...network.operators.flatMap(operator => metersOfOperator(operator).map(meter => ({ meter, owner: operator }))),
        ...network.gridOperators.flatMap(gridOperator => metersOfGridOperator(gridOperator).map(meter => ({ meter, owner: gridOperator }))),
    ];

    ALL_METERS.set(network, meters);

    return meters;

}

/** Every energy meter of the network as at runtime (`AllEffectiveEnergyMeters`). */
function allEffectiveMeters(network: Network): readonly JSONObject[] {

    const known = EFFECTIVE_METERS.get(network);

    if (known !== undefined)
        return known;

    const meters = allMeters(network).map(({ meter, owner }) => effectiveMeter(meter, owner));

    EFFECTIVE_METERS.set(network, meters);

    return meters;

}


// ---------------------------------------------------------------------------------------------------------------------------
// The constructor of a charging station operator (ChargingStationOperator.cs)

/** The charging tariffs of an operator by their keys. */
const keysAt = (json: JSONObject, property: string, parser: (text: string) => Id | undefined): Set<string> =>
    new Set(objectsAt(json, property).flatMap(entity => idOf(entity, parser)?.key ?? []));

/** What the constructor of a charging station operator refuses of its effective tariffs (`CalculateEffectiveChargingTariffs`). */
function effectiveTariffError(operator: JSONObject): string | undefined {

    for (const tariff of sortedAt(operator, 'chargingTariffs', tariffId)) {

        const id        = textOf(tariff, tariffId);
        const elements  = (json: JSONObject): boolean => isArray(get(json, 'elements')) && (get(json, 'elements') as JSONValue[]).length > 0;

        if (idsOf(get(tariff, 'templateIds'), tariffTemplateId).length === 0) {
            if (!isGiven(get(tariff, 'currency')))
                return `The charging tariff '${id}' has no currency, neither of its own nor of its templates!`;
            if (!elements(tariff))
                return `The charging tariff '${id}' has no elements, neither of its own nor of its templates!`;
            continue;
        }

        const ofTariff  = templatesOf(tariff, operator, 'chargingTariffTemplates', tariffTemplateId);
        const effective = withTemplates(tariff, ofTariff, [ 'currency', 'tariffURL', 'energyMix', 'tariffType', 'minPrice', 'maxPrice', 'validFrom', 'validUntil' ], {});
        const invalid   = (error: string): string => `The charging tariff '${id}' ${withNames(ofTariff, tariffTemplateId)} is invalid: ${error}`;

        const limit = (property: string, vat: string): Decimal | undefined => {
            const value = get(effective, property);
            const read  = isObject(value) ? optionalDecimal(value, vat, '') : undefined;
            return read instanceof Decimal ? read : undefined;
        };

        const exceeds = (vat: string): boolean => {
            const [ min, max ] = [ limit('minPrice', vat), limit('maxPrice', vat) ];
            return min !== undefined && max !== undefined && min.compareTo(max) > 0;
        };

        if (isObject(get(effective, 'minPrice')) && isObject(get(effective, 'maxPrice')) && (exceeds('excludingVAT') || exceeds('includingVAT')))
            return invalid(`The minimum price of the charging tariff '${id}' must not exceed its maximum price! (Parameter 'MinPrice')`);

        const [ validFrom, validUntil ] = [ get(effective, 'validFrom'), get(effective, 'validUntil') ].map(value => typeof value === 'string' ? timestampOf(value) : undefined);

        if (validFrom !== undefined && validUntil !== undefined && validFrom >= validUntil)
            return invalid(`The charging tariff '${id}' must be valid from before it is valid until! (Parameter 'ValidFrom')`);

        if (!isGiven(get(effective, 'currency')))
            return invalid('it has no currency, neither of its own nor of its templates!');

        if (!elements(tariff) && !ofTariff.some(elements))
            return invalid('it has no elements, neither of its own nor of its templates!');

    }

    return undefined;

}

/** The power of a charging station or an EVSE as a decimal, where it names one. */
const powerOf = (json: JSONObject): Decimal | undefined => {
    const value = optionalDecimal(json, 'maxPower', '');
    return value instanceof Decimal ? value : undefined;
};

/** The error, when the maximum power of a charging station exceeds the one of all its EVSEs together, each naming its own. */
function powerSum(station: JSONObject, evses: readonly JSONObject[], id: string): string | undefined {

    const maxPower = powerOf(station);
    const powers   = evses.map(powerOf);

    if (maxPower === undefined || powers.length === 0 || powers.some(power => power === undefined))
        return undefined;

    const sum = powers.filter(power => power !== undefined).reduce((left, right) => {
        const scale = Math.max(left.scale, right.scale);
        return new Decimal(left.mantissa * 10n ** BigInt(scale - left.scale) + right.mantissa * 10n ** BigInt(scale - right.scale), scale);
    }, new Decimal(0n, 0));

    const watt = (value: Decimal): string => value.mantissa === 0n ? '0' : value.toString();

    return maxPower.compareTo(sum) > 0
               ? `The maximum power of the charging station '${id}', ${watt(maxPower)} W, must not exceed the ${watt(sum)} W of all its EVSEs together! (Parameter 'MaxPower')`
               : undefined;

}

/**
 * The error, as WWCP_POI3 words it after the last change of a change set, when a group of a charging station operator
 * names a member it does not have, or an offer a group it does not have (`InvalidGroupOrOffer`), or a charging pool or a
 * charging pool template of it the payment option EVTaler without an EV Taler merchant (`InvalidPaymentOption`), or two of
 * its charging tariff offers overlap at an EVSE (`OverlappingOffers`).
 */
export const invalidGroupOrOffer = (operator: JSONObject): string | undefined =>
    whileChecking(() => groupOrOfferError(operator));

function groupOrOfferError(operator: JSONObject): string | undefined {

    const id        = textOf(operator, operatorId);
    const evses     = new Set(poolsOf(operator).flatMap(pool => stationsOf(pool).flatMap(station => evsesOf(station).map(evse => keyOf(evse, evseId)))));
    const stations  = new Set(poolsOf(operator).flatMap(pool => stationsOf(pool).map(station => keyOf(station, stationId))));
    const pools     = new Set(poolsOf(operator).map(pool => keyOf(pool, poolId)));
    const tariffs   = keysAt(operator, 'chargingTariffs', tariffId);
    const meters    = new Set(metersOfOperator(operator).map(meter => keyOf(meter)));

    const groups = [ [ 'EVSEGroups', evseGroupId, 'EVSEIds', evseId, evses ],
                     [ 'chargingStationGroups', stationGroupId, 'chargingStationIds', stationId, stations ],
                     [ 'chargingPoolGroups', poolGroupId, 'chargingPoolIds', poolId, pools ],
                     [ 'chargingTariffGroups', tariffGroupId, 'chargingTariffIds', tariffId, tariffs ],
                     [ 'energyMeterGroups', freeId, 'energyMeterIds', freeId, meters ] ] as const;

    for (const [ property, parser, members, memberParser, known ] of groups)
        for (const group of sortedAt(operator, property, parser))
            for (const member of ordered(idsOf(get(group, members), memberParser)))
                if (!known.has(member.key))
                    return `The member '${member.text}' of the group '${textOf(group, parser)}' is unknown at the operator '${id}'!`;

    const evseGroups     = keysAt(operator, 'EVSEGroups', evseGroupId);
    const stationGroups  = keysAt(operator, 'chargingStationGroups', stationGroupId);
    const poolGroups     = keysAt(operator, 'chargingPoolGroups', poolGroupId);

    for (const offer of sortedAt(operator, 'chargingTariffOffers', freeId))
        for (const [ property, parser, known, what ] of [ [ 'EVSEGroupIds', evseGroupId, evseGroups, 'EVSE group' ],
                                                          [ 'chargingStationGroupIds', stationGroupId, stationGroups, 'charging station group' ],
                                                          [ 'chargingPoolGroupIds', poolGroupId, poolGroups, 'charging pool group' ] ] as const)
            for (const groupId of ordered(idsOf(get(offer, property), parser)))
                if (!known.has(groupId.key))
                    return `The ${what} '${groupId.text}' of the charging tariff offer '${textOf(offer)}' is unknown at the operator '${id}'!`;

    return overlappingOffers(operator, id);

}


// ---------------------------------------------------------------------------------------------------------------------------
// Charging tariff offers that must not overlap (ChargingStationOperator.Offers.cs, RoamingNetwork.Offers.cs)

/** The EVSEs, charging stations, charging pools and groups of an operator by their keys, and the time zones of its EVSEs. */
interface Members {
    /** Its EVSEs, of its pools, stations and EVSEs ordinally, with their texts (`EVSEs`). */
    readonly evses:          ReadonlyMap<string, string>;
    readonly stations:       ReadonlyMap<string, JSONObject>;
    readonly pools:          ReadonlyMap<string, JSONObject>;
    readonly evseGroups:     ReadonlyMap<string, JSONObject>;
    readonly stationGroups:  ReadonlyMap<string, JSONObject>;
    readonly poolGroups:     ReadonlyMap<string, JSONObject>;
    /** The time zones of the EVSEs whose charging pool, with what its templates give it, names one (`TimeZoneOf`). */
    readonly timeZones:      ReadonlyMap<string, TimeZone>;
}

/** The entities of the given property of a party by their keys, the first of each. */
function indexAt(json: JSONObject, property: string, parser: (text: string) => Id | undefined): Map<string, JSONObject> {
    const index = new Map<string, JSONObject>();
    for (const entity of sortedAt(json, property, parser))
        if (!index.has(keyOf(entity, parser)))
            index.set(keyOf(entity, parser), entity);
    return index;
}

function membersOf(operator: JSONObject): Members {

    const known = MEMBERS.get(operator);

    if (known !== undefined)
        return known;

    const evses     = new Map<string, string>();
    const timeZones = new Map<string, TimeZone>();

    for (const pool of poolsOf(operator)) {

        const timeZone = [ pool, ...templatesOf(pool, operator, 'chargingPoolTemplates', poolTemplateId) ].
                             map(entity => trimmedAt(entity, 'timeZone')).
                             find(name => name !== undefined);

        for (const station of stationsOf(pool))
            for (const evse of evsesOf(station)) {
                evses.set(keyOf(evse, evseId), textOf(evse, evseId));
                if (timeZone !== undefined)
                    timeZones.set(keyOf(evse, evseId), timeZoneNamed(timeZone));
            }

    }

    const members: Members = {
        evses,
        stations:       new Map(poolsOf(operator).flatMap(pool => stationsOf(pool)).map(station => [ keyOf(station, stationId), station ])),
        pools:          indexAt(operator, 'chargingPools', poolId),
        evseGroups:     indexAt(operator, 'EVSEGroups', evseGroupId),
        stationGroups:  indexAt(operator, 'chargingStationGroups', stationGroupId),
        poolGroups:     indexAt(operator, 'chargingPoolGroups', poolGroupId),
        timeZones,
    };

    MEMBERS.set(operator, members);

    return members;

}

/** The EVSEs of a charging station or of the charging stations of a charging pool, by their keys, with their texts. */
const evsesIn = (station: JSONObject): [ string, string ][] =>
    evsesOf(station).map(evse => [ keyOf(evse, evseId), textOf(evse, evseId) ]);

/** The EVSEs the given offer covers, by their keys, each with its text as first named, as a `HashSet` unites them. */
type Covered = Map<string, string>;

const unite = (covered: Covered, evses: Iterable<readonly [ string, string ]>): void => {
    for (const [ key, text ] of evses)
        if (!covered.has(key))
            covered.set(key, text);
};

/**
 * The EVSEs of an operator a charging tariff offer of it covers (`CoveredEVSEs`): all of them, if it names the operator;
 * else those that, or whose charging station or charging pool, are members of one of its groups the offer names.
 */
function coveredByOwnOffer(operator: JSONObject, offer: JSONObject): Covered {

    const members = membersOf(operator);

    if (idsOf(get(offer, 'chargingStationOperatorIds'), operatorId).some(id => id.key === keyOf(operator, operatorId)))
        return new Map(members.evses);

    const covered: Covered = new Map();

    for (const groupId of ordered(idsOf(get(offer, 'EVSEGroupIds'), evseGroupId))) {
        const group = members.evseGroups.get(groupId.key);
        if (group !== undefined)
            unite(covered, ordered(idsOf(get(group, 'EVSEIds'), evseId)).filter(id => members.evses.has(id.key)).map(id => [ id.key, id.text ] as const));
    }

    for (const groupId of ordered(idsOf(get(offer, 'chargingStationGroupIds'), stationGroupId))) {
        const group = members.stationGroups.get(groupId.key);
        for (const id of group === undefined ? [] : ordered(idsOf(get(group, 'chargingStationIds'), stationId))) {
            const station = members.stations.get(id.key);
            if (station !== undefined)
                unite(covered, evsesIn(station));
        }
    }

    for (const groupId of ordered(idsOf(get(offer, 'chargingPoolGroupIds'), poolGroupId))) {
        const group = members.poolGroups.get(groupId.key);
        for (const id of group === undefined ? [] : ordered(idsOf(get(group, 'chargingPoolIds'), poolId))) {
            const pool = members.pools.get(id.key);
            for (const station of pool === undefined ? [] : stationsOf(pool))
                unite(covered, evsesIn(station));
        }
    }

    return covered;

}

/** The EVSEs both sets hold, with the texts of the first, in its order (`Enumerable.Intersect`). */
const bothCover = (first: Covered, second: Covered): Covered =>
    new Map([ ...first ].filter(([ key ]) => second.has(key)));

/** Two offers of one owner that overlap, at the first EVSE they overlap at, by their keys. */
interface Overlap {
    readonly first:   string;
    readonly second:  string;
    readonly evse:    string;
}

/**
 * The pairs of the given offers that overlap: they cover the same EVSE, for some of the same sessions, at some of the same
 * times in the time zone of the EVSE; each pair in the ordinal order of the offers, with the first such EVSE.
 */
function overlapsOf(offers: readonly JSONObject[], coveredBy: (offer: JSONObject) => Covered, timeZoneOf: (key: string) => TimeZone): Map<string, Overlap> {

    const read     = offers.map(offerOf);
    const covered  = new Map<number, Covered>();
    const overlaps = new Map<string, Overlap>();

    const coveredAt = (index: number): Covered => {
        let evses = covered.get(index);
        if (evses === undefined) {
            evses = coveredBy(offers[index] ?? {});
            covered.set(index, evses);
        }
        return evses;
    };

    for (let i = 0; i < read.length; i++)
        for (let j = i + 1; j < read.length; j++) {

            const [ offer1, offer2 ] = [ read[i], read[j] ];

            if (offer1 === undefined || offer2 === undefined || !sessionsOverlap(offer1, offer2))
                continue;

            const evse = firstOverlap(offer1, offer2, bothCover(coveredAt(i), coveredAt(j)), timeZoneOf);

            if (evse !== undefined && !overlaps.has(`${offer1.key}\n${offer2.key}`))
                overlaps.set(`${offer1.key}\n${offer2.key}`, { first: offer1.id, second: offer2.id, evse });

        }

    return overlaps;

}

/**
 * The error, when two charging tariff offers of an operator overlap (`OverlappingOffers`): they cover the same EVSE, for
 * some of the same sessions, at some of the same times in the time zone of the EVSE.
 */
function overlappingOffers(operator: JSONObject, id: string): string | undefined {

    const offers = sortedAt(operator, 'chargingTariffOffers', freeId);

    if (offers.length < 2)
        return undefined;

    const timeZones = membersOf(operator).timeZones;

    for (const overlap of overlapsOf(offers, offer => coveredByOwnOffer(operator, offer), key => timeZones.get(key) ?? UTC).values())
        return `The charging tariff offers '${overlap.first}' and '${overlap.second}' of the operator '${id}' overlap at the EVSE '${overlap.evse}': they must not cover the same EVSE for the same sessions at the same times!`;

    return undefined;

}

/**
 * The EVSEs of the given operators a charging tariff offer of an e-mobility provider covers (`CoveredEVSEs` of the roaming
 * network): all of the operators it names, and those that, or whose charging station or charging pool, are members of one
 * of the groups it names, a group of the operator its identification names, else of the first provider having it.
 */
function coveredByProviderOffer(offer: JSONObject, operators: ReadonlyMap<string, JSONObject>, providers: readonly JSONObject[]): Covered {

    const covered: Covered = new Map();
    const membersAt = (id: Id): Members | undefined => {
        const operator = operators.get(operatorOf(id));
        return operator === undefined ? undefined : membersOf(operator);
    };

    // A group of the operator of its identification, else of the first provider having one of it.
    const groupOf = (groupId: Id, property: 'EVSEGroups' | 'chargingStationGroups' | 'chargingPoolGroups', parser: (text: string) => Id | undefined): JSONObject | undefined => {
        const members = membersAt(groupId);
        const ofOperator = members === undefined ? undefined
                         : property === 'EVSEGroups' ? members.evseGroups.get(groupId.key)
                         : property === 'chargingStationGroups' ? members.stationGroups.get(groupId.key)
                         : members.poolGroups.get(groupId.key);
        return ofOperator ?? providers.map(provider => indexAt(provider, property, parser).get(groupId.key)).find(group => group !== undefined);
    };

    for (const id of ordered(idsOf(get(offer, 'chargingStationOperatorIds'), operatorId))) {
        const operator = operators.get(id.key);
        if (operator !== undefined)
            unite(covered, membersOf(operator).evses);
    }

    for (const groupId of ordered(idsOf(get(offer, 'EVSEGroupIds'), evseGroupId))) {
        const group = groupOf(groupId, 'EVSEGroups', evseGroupId);
        for (const id of group === undefined ? [] : ordered(idsOf(get(group, 'EVSEIds'), evseId)))
            if (membersAt(id)?.evses.has(id.key) === true)
                unite(covered, [ [ id.key, id.text ] ]);
    }

    for (const groupId of ordered(idsOf(get(offer, 'chargingStationGroupIds'), stationGroupId))) {
        const group = groupOf(groupId, 'chargingStationGroups', stationGroupId);
        for (const id of group === undefined ? [] : ordered(idsOf(get(group, 'chargingStationIds'), stationId))) {
            const station = membersAt(id)?.stations.get(id.key);
            if (station !== undefined)
                unite(covered, evsesIn(station));
        }
    }

    for (const groupId of ordered(idsOf(get(offer, 'chargingPoolGroupIds'), poolGroupId))) {
        const group = groupOf(groupId, 'chargingPoolGroups', poolGroupId);
        for (const id of group === undefined ? [] : ordered(idsOf(get(group, 'chargingPoolIds'), poolId))) {
            const pool = membersAt(id)?.pools.get(id.key);
            for (const station of pool === undefined ? [] : stationsOf(pool))
                unite(covered, evsesIn(station));
        }
    }

    return covered;

}

/** The pairs of charging tariff offers of an e-mobility provider that overlap at EVSEs of the given operators. */
function providerOverlaps(provider: JSONObject, operators: readonly JSONObject[], providers: readonly JSONObject[]): Map<string, Overlap> {

    const byKey = new Map(operators.map(operator => [ keyOf(operator, operatorId), operator ]));

    const timeZoneOf = (key: string): TimeZone => {
        const operator = byKey.get(key.slice(0, 6));
        return operator === undefined ? UTC : membersOf(operator).timeZones.get(key) ?? UTC;
    };

    return overlapsOf(sortedAt(provider, 'chargingTariffOffers', freeId), offer => coveredByProviderOffer(offer, byKey, providers), timeZoneOf);

}

/**
 * The error, when a change set makes two charging tariff offers of an e-mobility provider it changed overlap which did not
 * overlap in the version before (`NewProviderOfferOverlap`): they may come to overlap by the changes of others only.
 */
function newProviderOfferOverlap(network: Network, before: JSONObject | undefined): string | undefined {

    const previous = before === undefined ? undefined : networkOf(before);

    for (const provider of network.providers) {

        const earlier = previous?.providers.find(party => keyOf(party, providerId) === keyOf(provider, providerId));

        if (earlier !== undefined && canonicalJSON(earlier) === canonicalJSON(provider))
            continue;

        if (objectsAt(provider, 'chargingTariffOffers').length < 2)
            continue;

        const overlapsBefore = earlier === undefined || previous === undefined
                                   ? new Map<string, Overlap>()
                                   : providerOverlaps(earlier, previous.operators, previous.providers);

        for (const [ pair, overlap ] of providerOverlaps(provider, network.operators, network.providers))
            if (!overlapsBefore.has(pair))
                return `The charging tariff offers '${overlap.first}' and '${overlap.second}' of the e-mobility provider '${textOf(provider, providerId)}' must not overlap: they cover the EVSE '${overlap.evse}' for the same sessions at the same times!`;

    }

    return undefined;

}

/** The error, when a charging pool or a charging pool template names the payment option EVTaler, but its operator has no merchant. */
export const invalidPaymentOption = (operator: JSONObject): string | undefined =>
    whileChecking(() => paymentOptionError(operator));

function paymentOptionError(operator: JSONObject): string | undefined {

    if (get(operator, 'evTaler') !== undefined)
        return undefined;

    const id = textOf(operator, operatorId);

    for (const [ property, parser, what ] of [ [ 'chargingPools', poolId, 'charging pool' ], [ 'chargingPoolTemplates', poolTemplateId, 'charging pool template' ] ] as const)
        for (const entity of sortedAt(operator, property, parser))
            if (namesEVTaler(get(entity, 'paymentOptions')))
                return `The ${what} '${textOf(entity, parser)}' names the payment option '${EV_TALER_PAYMENT_OPTION}', but its operator '${id}' has no EV Taler merchant!`;

    return undefined;

}

/**
 * What the constructor of a charging station operator of the given identification refuses of what it read, thrown as WWCP_POI3
 * throws it, in its order: charging pools and charging tariffs of another operator or given twice, tariffs of EVSEs and
 * connectors unknown; groups and templates given twice or of another operator, tariffs and templates they name unknown;
 * offers given twice or naming another operator; tariffs without a currency or elements, also of their templates; stations
 * whose templates give them more power than their EVSEs have; members of groups and groups of offers unknown; the payment
 * option EVTaler without a merchant. Of a version only: after a change set, WWCP_POI3 checks its groups, offers and payment
 * options after the last change (`invalidGroupOrOffer`).
 */
export function operatorConstruction(operator: JSONObject, id: string, of: 'version' | 'change set'): void {
    whileChecking(() => { construct(operator, id, of); });
}

function construct(operator: JSONObject, id: string, of: 'version' | 'change set'): void {

    const fail = (message: string, parameter?: string): never => {
        throw thrown(message, parameter);
    };

    const ofOperator = (entities: readonly JSONObject[], parser: (text: string) => Id | undefined, description: string): void => {
        const later = laterTwice(entities, parser);
        if (later !== undefined)
            fail(`The ${description} '${later}' of the operator '${id}' must not be given twice!`, 'Children');
    };

    const operatorOf = (entity: JSONObject, parser: (text: string) => Id | undefined): string =>
        textOf(entity, parser).slice(0, 6);

    // Charging pools, in their order, then each once.
    for (const pool of objectsAt(operator, 'chargingPools'))
        if (operatorOf(pool, poolId) !== id)
            fail(`The charging pool '${textOf(pool, poolId)}' does not belong to the operator '${id}'!`, 'ChargingPools');

    ofOperator(objectsAt(operator, 'chargingPools'), poolId, 'charging pool');

    // Charging tariffs, in their order, then each once; then those of every EVSE and its connectors.
    for (const tariff of objectsAt(operator, 'chargingTariffs'))
        if (operatorOf(tariff, tariffId) !== id)
            fail(`The charging tariff '${textOf(tariff, tariffId)}' does not belong to the operator '${id}'!`, 'ChargingTariffs');

    ofOperator(objectsAt(operator, 'chargingTariffs'), tariffId, 'charging tariff');

    const tariffs = keysAt(operator, 'chargingTariffs', tariffId);

    for (const pool of poolsOf(operator))
        for (const station of stationsOf(pool))
            for (const evse of evsesOf(station)) {
                for (const tariff of ordered(idsOf(get(evse, 'chargingTariffIds'), tariffId)))
                    if (!tariffs.has(tariff.key))
                        fail(`The charging tariff '${tariff.text}' of the EVSE '${textOf(evse, evseId)}' is unknown at the operator '${id}'!`, 'ChargingTariffs');
                for (const connector of sortedAt(evse, 'chargingConnectors', freeId))
                    for (const tariff of ordered(idsOf(get(connector, 'chargingTariffIds'), tariffId)))
                        if (!tariffs.has(tariff.key))
                            fail(`The charging tariff '${tariff.text}' of the charging connector '${textOf(connector)}' of the EVSE '${textOf(evse, evseId)}' is unknown at the operator '${id}'!`, 'ChargingTariffs');
            }

    // Groups, each once, then of this operator; energy meter groups and parking spaces; brands.
    for (const [ property, parser, description, parameter ] of [ [ 'EVSEGroups', evseGroupId, 'EVSE group', 'EVSEGroups' ],
                                                                 [ 'chargingStationGroups', stationGroupId, 'charging station group', 'ChargingStationGroups' ],
                                                                 [ 'chargingPoolGroups', poolGroupId, 'charging pool group', 'ChargingPoolGroups' ],
                                                                 [ 'chargingTariffGroups', tariffGroupId, 'charging tariff group', 'ChargingTariffGroups' ] ] as const) {
        ofOperator(objectsAt(operator, property), parser, description);
        for (const group of sortedAt(operator, property, parser))
            if (operatorOf(group, parser) !== id)
                fail(`The group '${textOf(group, parser)}' does not belong to the operator '${id}'!`, parameter);
    }

    ofOperator(objectsAt(operator, 'energyMeterGroups'), freeId, 'energy meter group');
    ofOperator(objectsAt(operator, 'parkingSpaces'), freeId, 'parking space');

    for (const space of sortedAt(operator, 'parkingSpaces', freeId))
        if (isGiven(get(space, 'parkingGarageId')) || textsAt(space, 'parkingSensorIds').length > 0 || textsAt(space, 'parkingProductIds').length > 0)
            fail(`The parking space '${textOf(space)}' of the operator '${id}' can be in no parking garage, and have no parking sensors or parking products: only those of a parking operator can!`, 'ParkingSpaces');

    ofOperator(objectsAt(operator, 'brands'), freeId, 'brand');

    // Templates, each once; of this operator, naming known tariffs; then the templates members name.
    const templateKinds = [ [ 'EVSETemplates', evseTemplateId, 'EVSE template', 'EVSETemplates' ],
                            [ 'chargingStationTemplates', stationTemplateId, 'charging station template', 'ChargingStationTemplates' ],
                            [ 'chargingPoolTemplates', poolTemplateId, 'charging pool template', 'ChargingPoolTemplates' ],
                            [ 'chargingTariffTemplates', tariffTemplateId, 'charging tariff template', 'ChargingTariffTemplates' ] ] as const;

    for (const [ property, parser, description ] of templateKinds)
        ofOperator(objectsAt(operator, property), parser, description);

    ofOperator(objectsAt(operator, 'energyMeterTemplates'), freeId, 'energy meter template');

    for (const [ property, parser, , parameter ] of templateKinds)
        for (const template of sortedAt(operator, property, parser)) {
            if (operatorOf(template, parser) !== id)
                fail(`The template '${textOf(template, parser)}' does not belong to the operator '${id}'!`, parameter);
            const tariff = property === 'chargingTariffTemplates' ? undefined : idOf(template, tariffId, 'chargingTariffId');
            if (tariff !== undefined && !tariffs.has(tariff.key))
                fail(`The charging tariff '${tariff.text}' of the template '${textOf(template, parser)}' is unknown at the operator '${id}'!`, parameter);
        }

    const unknownTemplate = (member: JSONObject, memberParser: (text: string) => Id | undefined, what: string, property: string, parser: (text: string) => Id | undefined, parameter: string): void => {
        const known = templateIndex(operator, property, parser);
        for (const template of idsOf(get(member, 'templateIds'), parser))
            if (!known.has(template.key))
                fail(`The template '${template.text}' of the ${what} '${textOf(member, memberParser)}' is unknown at the operator '${id}'!`, parameter);
    };

    for (const pool of poolsOf(operator))
        for (const station of stationsOf(pool))
            for (const evse of evsesOf(station))
                unknownTemplate(evse, evseId, 'EVSE', 'EVSETemplates', evseTemplateId, 'EVSETemplates');

    for (const pool of poolsOf(operator))
        for (const station of stationsOf(pool))
            unknownTemplate(station, stationId, 'charging station', 'chargingStationTemplates', stationTemplateId, 'ChargingStationTemplates');

    for (const pool of poolsOf(operator))
        unknownTemplate(pool, poolId, 'charging pool', 'chargingPoolTemplates', poolTemplateId, 'ChargingPoolTemplates');

    for (const tariff of sortedAt(operator, 'chargingTariffs', tariffId))
        unknownTemplate(tariff, tariffId, 'charging tariff', 'chargingTariffTemplates', tariffTemplateId, 'ChargingTariffTemplates');

    for (const meter of metersOfOperator(operator))
        unknownTemplate(meter, freeId, 'energy meter', 'energyMeterTemplates', freeId, 'EnergyMeterTemplates');

    // Offers, each once, naming no other operator.
    ofOperator(objectsAt(operator, 'chargingTariffOffers'), freeId, 'charging tariff offer');

    for (const offer of sortedAt(operator, 'chargingTariffOffers', freeId))
        for (const other of ordered(idsOf(get(offer, 'chargingStationOperatorIds'), operatorId)))
            if (other.text !== id)
                fail(`The charging tariff offer '${textOf(offer)}' of the operator '${id}' must not name the operator '${other.text}'!`, 'ChargingTariffOffers');

    // Its effective tariffs and charging stations.
    const tariffError = effectiveTariffError(operator);

    if (tariffError !== undefined)
        fail(tariffError);

    for (const station of effectiveStations(operator)) {
        const error = station.rebuilt ? powerSum(station.station, station.evses, station.id) : undefined;
        if (error !== undefined)
            fail(`The charging station '${station.id}' ${station.with} is invalid: ${error}`);
    }

    if (of === 'change set')
        return;

    const groupOrOffer = invalidGroupOrOffer(operator);

    if (groupOrOffer !== undefined)
        fail(groupOrOffer, 'ChargingTariffOffers');

    const paymentOption = invalidPaymentOption(operator);

    if (paymentOption !== undefined)
        fail(paymentOption, 'EVTaler');

}

/** What the constructor of the given charging station operator refuses, as its TryParse names it; undefined for nothing. */
export function checkOperator(operator: JSONObject, id: string, of: 'version' | 'change set' = 'version'): Checked {
    try {
        operatorConstruction(operator, id, of);
        return undefined;
    }
    catch (e) {
        if (e instanceof Thrown)
            return `The given JSON representation of a charging station operator is invalid: ${e.message}`;
        throw e;
    }
}


// ---------------------------------------------------------------------------------------------------------------------------
// The constructor of the roaming network (RoamingNetwork.cs)

/** The parties of a roaming network, each list in the ordinal order of their identifications. */
interface Network {
    readonly operators:              readonly JSONObject[];
    readonly manufacturers:          readonly JSONObject[];
    readonly providers:              readonly JSONObject[];
    readonly gridOperators:          readonly JSONObject[];
    readonly parkingOperators:       readonly JSONObject[];
    readonly softwareManufacturers:  readonly JSONObject[];
    readonly bodies:                 readonly JSONObject[];
    readonly meterManufacturers:     readonly JSONObject[];
}

/** The parties another network resolves references with, e.g. the version before a change set: who is named. */
interface Named {
    readonly manufacturers:       readonly JSONObject[];
    readonly gridOperators:       readonly JSONObject[];
    readonly operators:           readonly JSONObject[];
    readonly parkingOperators:    readonly JSONObject[];
    readonly releases:            ReadonlySet<string>;
    readonly certificates:        ReadonlyMap<string, JSONObject>;
    readonly meterManufacturers:  readonly JSONObject[];
}

function networkOf(content: JSONObject): Network {
    return {
        operators:              sortedAt(content, 'chargingStationOperators', operatorId),
        manufacturers:          sortedAt(content, 'chargingStationManufacturers', freeId),
        providers:              sortedAt(content, 'eMobilityProviders', freeId),
        gridOperators:          sortedAt(content, 'gridOperators', operatorId),
        parkingOperators:       sortedAt(content, 'parkingOperators', freeId),
        softwareManufacturers:  sortedAt(content, 'transparencySoftwareManufacturers', freeId),
        bodies:                 sortedAt(content, 'conformityAssessmentBodies', freeId),
        meterManufacturers:     sortedAt(content, 'energyMeterManufacturers', freeId),
    };
}

/** The releases of the given manufacturers, by their keys. */
const releasesOf = (network: Network): Set<string> =>
    new Set(network.softwareManufacturers.flatMap(manufacturer => sortedAt(manufacturer, 'transparencySoftware', freeId).map(release => keyOf(release))));

/** The certificates of the given bodies by their keys, the first of each, in the order of the bodies and their certificates. */
function certificatesOf(network: Network): Map<string, JSONObject> {
    const certificates = new Map<string, JSONObject>();
    for (const body of network.bodies)
        for (const certificate of sortedAt(body, 'certificates', freeId))
            if (!certificates.has(keyOf(certificate)))
                certificates.set(keyOf(certificate), certificate);
    return certificates;
}

const namedBy = (network: Network): Named => ({
    manufacturers:       network.manufacturers,
    gridOperators:       network.gridOperators,
    operators:           network.operators,
    parkingOperators:    network.parkingOperators,
    releases:            releasesOf(network),
    certificates:        certificatesOf(network),
    meterManufacturers:  network.meterManufacturers,
});

/** The first entity of the given ones of the given key, by the given property of identifications. */
const entityOf = (entities: readonly JSONObject[], key: string | undefined, parser: (text: string) => Id | undefined = freeId): JSONObject | undefined =>
    key === undefined ? undefined : entities.find(entity => keyOf(entity, parser) === key);

/** A model of a manufacturer: of charging stations or of energy meters. */
interface Model {
    readonly manufacturer:  JSONObject;
    readonly model:         JSONObject | undefined;
}

/** The error of a charging station or a charging station template naming a manufacturer, a model, versions the network does not have. */
function unknownStationModel(item: JSONObject, named: string, versions: boolean, manufacturers: readonly JSONObject[]): string | undefined {

    const manufacturerId  = trimmedAt(item, 'manufacturerId');
    const modelId         = trimmedAt(item, 'modelId');
    const hardware        = versions ? versionAt(item, 'hardwareRevision') : undefined;
    const firmware        = versions ? versionAt(item, 'firmwareVersion')  : undefined;

    if (modelId === undefined && hardware !== undefined)
        return `The hardware revision '${hardware}' of ${named} is named without its model!`;

    if (modelId === undefined && firmware !== undefined)
        return `The firmware version '${firmware}' of ${named} is named without its model!`;

    if (manufacturerId === undefined)
        return modelId === undefined ? undefined : `The model '${modelId}' of ${named} is named without its manufacturer!`;

    const manufacturer = entityOf(manufacturers, ignoringCase(manufacturerId));

    if (manufacturer === undefined)
        return `The manufacturer '${manufacturerId}' of ${named} is unknown in the roaming network!`;

    if (modelId === undefined)
        return undefined;

    const model = entityOf(objectsAt(manufacturer, 'chargingStationModels'), ignoringCase(modelId));

    if (model === undefined)
        return `The model '${modelId}' of ${named} is unknown at its manufacturer '${textOf(manufacturer)}'!`;

    if (hardware !== undefined && !textsAt(model, 'hardwareRevisions').includes(hardware))
        return `The hardware revision '${hardware}' of ${named} is no hardware revision of its model '${textOf(model)}' of '${textOf(manufacturer)}'!`;

    if (firmware !== undefined && !textsAt(model, 'firmwareVersions').includes(firmware))
        return `The firmware version '${firmware}' of ${named} is no firmware version of its model '${textOf(model)}' of '${textOf(manufacturer)}'!`;

    return undefined;

}

/** `UnknownManufacturer`: the charging station templates, then the effective charging stations. */
function unknownManufacturer(network: Network, named: Named): string | undefined {

    for (const operator of network.operators)
        for (const template of sortedAt(operator, 'chargingStationTemplates', stationTemplateId)) {
            const error = unknownStationModel(template, `the charging station template '${textOf(template, stationTemplateId)}'`, trimmedAt(template, 'modelId') !== undefined, named.manufacturers);
            if (error !== undefined)
                return error;
        }

    for (const operator of network.operators)
        for (const station of effectiveStations(operator)) {
            const error = unknownStationModel(station.station, `the charging station '${station.id}'`, true, named.manufacturers);
            if (error !== undefined)
                return error;
        }

    return undefined;

}

/** The model the given item names of the given manufacturers, where both are known. */
function modelOf(item: JSONObject, manufacturers: readonly JSONObject[], models: string): Model | undefined {
    const manufacturer = entityOf(manufacturers, trimmedAt(item, 'manufacturerId') === undefined ? undefined : ignoringCase(trimmedAt(item, 'manufacturerId') ?? ''));
    const modelId      = trimmedAt(item, 'modelId');
    if (manufacturer === undefined || modelId === undefined)
        return undefined;
    return { manufacturer, model: entityOf(objectsAt(manufacturer, models), ignoringCase(modelId)) };
}

/** A power in kW, as `Watt.kW` of Styx writes it: the watts divided by 1000, as .NET divides decimals. */
function kW(value: Decimal): string {
    let mantissa = value.mantissa;
    let scale    = value.scale + 3;
    while (scale > 0 && mantissa % 10n === 0n && scale > value.scale) {
        mantissa /= 10n;
        scale--;
    }
    return `${new Decimal(mantissa, scale).toString()} kW`;
}

/** `ContradictedChargingStationModel`: a station, or an EVSE of it, of more power than its model. */
function contradictedStationModel(network: Network): string | undefined {

    for (const operator of network.operators)
        for (const station of effectiveStations(operator)) {

            const found = modelOf(station.station, network.manufacturers, 'chargingStationModels');
            const model = found?.model;
            const rated = model === undefined ? undefined : powerOf(model);

            if (found === undefined || model === undefined || rated === undefined)
                continue;

            const power = powerOf(station.station);

            if (power !== undefined && power.compareTo(rated) > 0)
                return `The maximum power of the charging station '${station.id}', ${kW(power)}, is above the one of its model '${textOf(model)}' of '${textOf(found.manufacturer)}', ${kW(rated)}!`;

            for (const evse of station.evses) {
                const evsePower = powerOf(evse);
                if (evsePower !== undefined && evsePower.compareTo(rated) > 0)
                    return `The maximum power of the EVSE '${textOf(evse, evseId)}', ${kW(evsePower)}, is above the one of the model '${textOf(model)}' of '${textOf(found.manufacturer)}' of its charging station '${station.id}', ${kW(rated)}!`;
            }

        }

    return undefined;

}

/** `UnknownGridConnectionPoint`: the grid connection points charging pools and their templates name. */
function unknownGridConnectionPoint(network: Network, named: Named): string | undefined {

    const points = new Set(named.gridOperators.flatMap(gridOperator => objectsAt(gridOperator, 'gridConnectionPoints').map(point => keyOf(point))));

    for (const [ property, parser, what ] of [ [ 'chargingPools', poolId, 'charging pool' ], [ 'chargingPoolTemplates', poolTemplateId, 'charging pool template' ] ] as const)
        for (const operator of network.operators)
            for (const entity of sortedAt(operator, property, parser)) {
                const point = idOf(entity, freeId, 'gridConnectionPointId');
                if (point !== undefined && !points.has(point.key))
                    return `The grid connection point '${point.text}' of the ${what} '${textOf(entity, parser)}' is unknown in the roaming network!`;
            }

    return undefined;

}

/** Whether the given operators have the given charging station, at the operator its identification names. */
function hasStation(operators: readonly JSONObject[], station: Id): boolean {
    const operator = entityOf(operators, station.text.slice(0, 6), operatorId);
    return operator !== undefined && stationKeysOf(operator).has(station.key);
}

/** The keys of the charging stations of the pools of an operator, once while it is checked. */
function stationKeysOf(operator: JSONObject): ReadonlySet<string> {

    let keys = STATIONS.get(operator);

    if (keys === undefined) {
        keys = new Set(poolsOf(operator).flatMap(pool => objectsAt(pool, 'chargingStations').map(item => keyOf(item, stationId))));
        STATIONS.set(operator, keys);
    }

    return keys;

}

/** `UnknownChargingStation`: the charging stations of parking garages, spaces, space templates and sensors. */
function unknownChargingStation(network: Network, named: Named): string | undefined {

    const kinds = [ [ 'parkingGarages', 'parking garage' ], [ 'parkingSpaces', 'parking space' ], [ 'parkingSpaceTemplates', 'parking space template' ], [ 'parkingSensors', 'parking sensor' ] ] as const;

    for (const parkingOperator of network.parkingOperators)
        for (const [ property, kind ] of kinds)
            for (const owner of sortedAt(parkingOperator, property, freeId))
                for (const station of ordered(idsOf(get(owner, 'chargingStationIds'), stationId)))
                    if (!hasStation(named.operators, station))
                        return `The charging station '${station.text}' of the ${kind} '${textOf(owner)}' is unknown in the roaming network!`;

    for (const operator of network.operators)
        for (const space of sortedAt(operator, 'parkingSpaces', freeId))
            for (const station of ordered(idsOf(get(space, 'chargingStationIds'), stationId)))
                if (!hasStation(named.operators, station))
                    return `The charging station '${station.text}' of the parking space '${textOf(space)}' is unknown in the roaming network!`;

    return undefined;

}

/** `UnknownParkingSpace`: the parking spaces charging station templates and charging stations name. */
function unknownParkingSpace(network: Network, named: Named): string | undefined {

    const spaces = new Set([ ...named.parkingOperators, ...network.operators ].flatMap(party => objectsAt(party, 'parkingSpaces').map(space => keyOf(space))));

    for (const operator of network.operators)
        for (const template of sortedAt(operator, 'chargingStationTemplates', stationTemplateId))
            for (const space of ordered(idsOf(get(template, 'parkingSpaceIds'), freeId)))
                if (!spaces.has(space.key))
                    return `The parking space '${space.text}' of the charging station template '${textOf(template, stationTemplateId)}' is unknown in the roaming network!`;

    for (const operator of network.operators)
        for (const pool of poolsOf(operator))
            for (const station of stationsOf(pool))
                for (const space of ordered(idsOf(get(station, 'parkingSpaceIds'), freeId)))
                    if (!spaces.has(space.key))
                        return `The parking space '${space.text}' of the charging station '${textOf(station, stationId)}' is unknown in the roaming network!`;

    return undefined;

}

/** `UnknownMaintainer`: the maintainers of grid connection points, a charging station operator or a parking operator. */
function unknownMaintainer(network: Network, named: Named): string | undefined {

    for (const gridOperator of network.gridOperators)
        for (const point of sortedAt(gridOperator, 'gridConnectionPoints', freeId)) {

            const by = get(point, 'maintainedBy');

            if (!isObject(by))
                continue;

            const type     = asText(by['entityType']);
            const entityId = asText(by['entityId']);
            const known    = type === 'ChargingStationOperator' ? entityOf(named.operators, operatorId(entityId)?.key, operatorId) !== undefined
                           : type === 'ParkingOperator'         ? entityOf(named.parkingOperators, freeId(entityId)?.key) !== undefined
                           : false;

            if (!known)
                return `The maintainer of the grid connection point '${textOf(point)}', the ${type} '${entityId}', is unknown in the roaming network!`;

        }

    return undefined;

}

/** What a certificate is for, as it names it (`ConformityCertificate.Subject`). */
const subjectOf = (certificate: JSONObject): string =>
    trimmedAt(certificate, 'chargingStationModel') !== undefined
        ? `the charging station model '${trimmedAt(certificate, 'chargingStationModel') ?? ''}' of '${trimmedAt(certificate, 'chargingStationManufacturerId') ?? ''}'`
        : `the energy meter model '${trimmedAt(certificate, 'energyMeterModel') ?? ''}' of '${trimmedAt(certificate, 'energyMeterManufacturerId') ?? ''}'`;

/** The error of a certificate a model does not have its versions of, by their words. */
function versionsOf(versions: JSONObject, model: JSONObject, message: (description: string, version: string) => string): string | undefined {
    for (const [ property, description, of ] of [ [ 'hardwareRevisions', 'hardware revision', 'hardwareRevisions' ], [ 'firmwareVersions', 'firmware version', 'firmwareVersions' ] ] as const)
        for (const version of textsAt(versions, property))
            if (!textsAt(model, of).includes(version))
                return message(description, version);
    return undefined;
}

/** `UnknownReferenceOf`: the releases, the model and its versions of a certificate, and of the energy meters it was issued with. */
function unknownReferenceOf(certificate: JSONObject, named: Named): string | undefined {

    const id = textOf(certificate);

    for (const release of [ ...textsAt(certificate, 'verifiedTransparencySoftwareIds'), ...textsAt(certificate, 'compatibleTransparencySoftwareIds') ])
        if (!named.releases.has(ignoringCase(trimmed(release))))
            return `The transparency software release '${trimmed(release)}' of the certificate '${id}' is unknown in the roaming network!`;

    const forStation = isGiven(get(certificate, 'chargingStationModel'));
    const manufacturerProperty = forStation ? 'chargingStationManufacturerId' : 'energyMeterManufacturerId';
    const modelProperty        = forStation ? 'chargingStationModel' : 'energyMeterModel';
    const manufacturers        = forStation ? named.manufacturers : named.meterManufacturers;
    const kind                 = forStation ? 'charging station model' : 'energy meter model';

    const manufacturer = entityOf(manufacturers, ignoringCase(trimmedAt(certificate, manufacturerProperty) ?? ''));

    if (manufacturer === undefined)
        return `The manufacturer '${trimmedAt(certificate, manufacturerProperty) ?? ''}' of the certificate '${id}' is unknown in the roaming network!`;

    const model = entityOf(objectsAt(manufacturer, forStation ? 'chargingStationModels' : 'energyMeterModels'), ignoringCase(trimmedAt(certificate, modelProperty) ?? ''));

    if (model === undefined)
        return `The ${kind} '${trimmedAt(certificate, modelProperty) ?? ''}' of the certificate '${id}' is unknown at its manufacturer '${textOf(manufacturer)}'!`;

    const versionError = versionsOf(certificate, model, (description, version) =>
        `The ${description} '${version}' of the certificate '${id}' is no ${description} of the ${kind} '${textOf(model)}' of '${textOf(manufacturer)}'!`);

    if (versionError !== undefined || !forStation)
        return versionError;

    for (const meter of objectsAt(certificate, 'energyMeters')) {

        const meterManufacturer = entityOf(named.meterManufacturers, ignoringCase(trimmedAt(meter, 'manufacturerId') ?? ''));

        if (meterManufacturer === undefined)
            return `The energy meter manufacturer '${trimmedAt(meter, 'manufacturerId') ?? ''}' of the certificate '${id}' is unknown in the roaming network!`;

        const meterModel = entityOf(objectsAt(meterManufacturer, 'energyMeterModels'), ignoringCase(trimmedAt(meter, 'modelId') ?? ''));

        if (meterModel === undefined)
            return `The energy meter model '${trimmedAt(meter, 'modelId') ?? ''}' of the certificate '${id}' is unknown at its manufacturer '${textOf(meterManufacturer)}'!`;

        const meterError = versionsOf(meter, meterModel, (description, version) =>
            `The ${description} '${version}' of the energy meter model '${textOf(meterModel)}' the certificate '${id}' was issued with is no ${description} of the energy meter model '${textOf(meterModel)}' of '${textOf(meterManufacturer)}'!`);

        if (meterError !== undefined)
            return meterError;

    }

    return undefined;

}

/** `CertificateOf`: a certificate the network has, of the kind of model expected. */
function certificateOf(named: string, certificateId: Id, ofStationModel: boolean, certificates: ReadonlyMap<string, JSONObject>): JSONObject | string {

    const certificate = certificates.get(certificateId.key);

    if (certificate === undefined)
        return `The certificate '${certificateId.text}' of ${named} is unknown in the roaming network!`;

    if (isGiven(get(certificate, 'chargingStationModel')) !== ofStationModel)
        return `The certificate '${certificateId.text}' of ${named} is for ${subjectOf(certificate)}, not for a model of ${ofStationModel ? 'charging stations' : 'energy meters'}!`;

    return certificate;

}

/** Whether two optional identifications are one, as their nullable types compare them: none is none only. */
const sameOptional = (left: string | undefined, right: string | undefined): boolean =>
    left === undefined || right === undefined ? left === right : ignoringCase(left) === ignoringCase(right);

/** Whether a certificate covers the given hardware revision and firmware version: both given and named by it. */
const covers = (certificate: JSONObject, hardware: string | undefined, firmware: string | undefined): boolean =>
    hardware !== undefined && firmware !== undefined && textsAt(certificate, 'hardwareRevisions').includes(hardware) && textsAt(certificate, 'firmwareVersions').includes(firmware);

const versionName = (version: string | undefined): string =>
    version === undefined ? '(none)' : `'${version}'`;

/** `UnknownCertificateReference`, in its phases: certificates, releases of meters, templates and stations, certificates of them. */
function unknownCertificateReference(network: Network, named: Named): string | undefined {

    for (const certificate of named.certificates.values()) {
        const error = unknownReferenceOf(certificate, named);
        if (error !== undefined)
            return error;
    }

    const releaseError = (item: JSONObject, what: string): string | undefined => {
        for (const status of objectsAt(item, 'transparencySoftwareStatus')) {
            const release = idOf(status, freeId, 'transparencySoftwareId');
            if (release !== undefined && !named.releases.has(release.key))
                return `The transparency software release '${release.text}' of ${what} is unknown in the roaming network!`;
        }
        return undefined;
    };

    for (const { meter } of allMeters(network)) {
        const error = releaseError(meter, `the energy meter '${textOf(meter)}'`);
        if (error !== undefined)
            return error;
    }

    const templates = network.operators.flatMap(operator => sortedAt(operator, 'chargingStationTemplates', stationTemplateId));
    const stations  = network.operators.flatMap(effectiveStations);

    for (const template of templates) {
        const error = releaseError(template, `the charging station template '${textOf(template, stationTemplateId)}'`);
        if (error !== undefined)
            return error;
    }

    for (const station of stations) {
        const error = releaseError(station.station, `the charging station '${station.id}'`);
        if (error !== undefined)
            return error;
    }

    for (const template of templates)
        for (const certificateId of ordered(idsOf(get(template, 'certificateIds'), freeId))) {
            const certificate = certificateOf(`the charging station template '${textOf(template, stationTemplateId)}'`, certificateId, true, named.certificates);
            if (typeof certificate === 'string')
                return certificate;
        }

    for (const station of stations)
        for (const certificateId of ordered(idsOf(get(station.station, 'certificateIds'), freeId))) {

            const certificate = certificateOf(`the charging station '${station.id}'`, certificateId, true, named.certificates);

            if (typeof certificate === 'string')
                return certificate;

            const certificateText = textOf(certificate);

            if (!sameOptional(trimmedAt(certificate, 'chargingStationManufacturerId'), trimmedAt(station.station, 'manufacturerId')) ||
                !sameOptional(trimmedAt(certificate, 'chargingStationModel'), trimmedAt(station.station, 'modelId')))
                return `The certificate '${certificateText}' of the charging station '${station.id}' is for ${subjectOf(certificate)}, not for the model of the station!`;

            const [ hardware, firmware ] = [ versionAt(station.station, 'hardwareRevision'), versionAt(station.station, 'firmwareVersion') ];

            if (!covers(certificate, hardware, firmware))
                return `The certificate '${certificateText}' of the charging station '${station.id}' does not cover its hardware revision ${versionName(hardware)} and firmware version ${versionName(firmware)}!`;

            const certified = objectsAt(certificate, 'energyMeters');

            if (certified.length > 0)
                for (const meter of station.meters)
                    if (!certified.some(item => sameOptional(trimmedAt(item, 'manufacturerId'), trimmedAt(meter, 'manufacturerId')) &&
                                                sameOptional(trimmedAt(item, 'modelId'), trimmedAt(meter, 'modelId')) &&
                                                covers(item, versionAt(meter, 'hardwareRevision'), versionAt(meter, 'firmwareVersion'))))
                        return `The energy meter '${textOf(meter)}' of the charging station '${station.id}' is none of the energy meters the certificate '${certificateText}' was issued with!`;

        }

    for (const meter of allEffectiveMeters(network))
        for (const certificateId of ordered(idsOf(get(meter, 'certificateIds'), freeId))) {

            const certificate = certificateOf(`the energy meter '${textOf(meter)}'`, certificateId, false, named.certificates);

            if (typeof certificate === 'string')
                return certificate;

            const certificateText = textOf(certificate);

            if (!sameOptional(trimmedAt(certificate, 'energyMeterManufacturerId'), trimmedAt(meter, 'manufacturerId')) ||
                !sameOptional(trimmedAt(certificate, 'energyMeterModel'), trimmedAt(meter, 'modelId')))
                return `The certificate '${certificateText}' of the energy meter '${textOf(meter)}' is for ${subjectOf(certificate)}, not for the model of the meter!`;

            const [ hardware, firmware ] = [ versionAt(meter, 'hardwareRevision'), versionAt(meter, 'firmwareVersion') ];

            if (!covers(certificate, hardware, firmware))
                return `The certificate '${certificateText}' of the energy meter '${textOf(meter)}' does not cover its hardware revision ${versionName(hardware)} and firmware version ${versionName(firmware)}!`;

        }

    return undefined;

}

/** `UnknownEnergyMeterModel`: a manufacturer, a model, versions of an energy meter or its template the network does not have. */
function unknownMeterModel(item: JSONObject, named: string, versions: boolean, manufacturers: readonly JSONObject[]): string | undefined {

    const manufacturerId  = trimmedAt(item, 'manufacturerId');
    const modelId         = trimmedAt(item, 'modelId');
    const hardware        = versions ? versionAt(item, 'hardwareRevision') : undefined;
    const firmware        = versions ? versionAt(item, 'firmwareVersion')  : undefined;

    if (modelId === undefined && hardware !== undefined)
        return `${named} names the hardware revision '${hardware}' without its model!`;

    if (modelId === undefined && firmware !== undefined)
        return `${named} names the firmware version '${firmware}' without its model!`;

    if (manufacturerId === undefined)
        return modelId === undefined ? undefined : `${named} names the model '${modelId}' without its manufacturer!`;

    const manufacturer = entityOf(manufacturers, ignoringCase(manufacturerId));

    if (manufacturer === undefined)
        return `${named} names the unknown energy meter manufacturer '${manufacturerId}'!`;

    if (modelId === undefined)
        return undefined;

    const model = entityOf(objectsAt(manufacturer, 'energyMeterModels'), ignoringCase(modelId));

    if (model === undefined)
        return `${named} names the model '${modelId}', unknown at its manufacturer '${textOf(manufacturer)}'!`;

    if (hardware !== undefined && !textsAt(model, 'hardwareRevisions').includes(hardware))
        return `${named} names the hardware revision '${hardware}', no hardware revision of its model '${textOf(model)}' of '${textOf(manufacturer)}'!`;

    if (firmware !== undefined && !textsAt(model, 'firmwareVersions').includes(firmware))
        return `${named} names the firmware version '${firmware}', no firmware version of its model '${textOf(model)}' of '${textOf(manufacturer)}'!`;

    return undefined;

}

/** The energy meter templates of the network: of the operators, then of the grid operators (`AllEnergyMeterTemplates`). */
const allMeterTemplates = (network: Network): JSONObject[] =>
    [ ...network.operators, ...network.gridOperators ].flatMap(party => sortedAt(party, 'energyMeterTemplates', freeId));

/** `UnknownEnergyMeterTemplateReference`: the model, releases and certificates of every energy meter template. */
function unknownMeterTemplateReference(network: Network, named: Named): string | undefined {

    for (const template of allMeterTemplates(network)) {

        const id    = textOf(template);
        const error = unknownMeterModel(template, `The energy meter template '${id}'`, trimmedAt(template, 'modelId') !== undefined, named.meterManufacturers);

        if (error !== undefined)
            return error;

        for (const status of objectsAt(template, 'transparencySoftwareStatus')) {
            const release = idOf(status, freeId, 'transparencySoftwareId');
            if (release !== undefined && !named.releases.has(release.key))
                return `The transparency software release '${release.text}' of the energy meter template '${id}' is unknown in the roaming network!`;
        }

        for (const certificateId of ordered(idsOf(get(template, 'certificateIds'), freeId))) {
            const certificate = certificateOf(`the energy meter template '${id}'`, certificateId, false, named.certificates);
            if (typeof certificate === 'string')
                return certificate;
        }

    }

    return undefined;

}

/** `UnknownEnergyMeterManufacturer`: the model and versions of every effective energy meter. */
const unknownMeterManufacturer = (network: Network, named: Named): string | undefined =>
    allEffectiveMeters(network).map(meter => unknownMeterModel(meter, `The energy meter '${textOf(meter)}'`, true, named.meterManufacturers)).find(error => error !== undefined);

/** The signature methods of `SignatureMethod`, by their names, as it reads them without case. */
const SIGNATURE_METHODS = [ 'OCMF', 'EDL40', 'AlfenCrypt01', 'AlfenCrypt03', 'ChargePointCrypt01', 'EMHCrypt01', 'MennekesCrypt01', 'PCDF' ];

const signatureMethod = (text: string): string =>
    SIGNATURE_METHODS.find(name => ignoringCase(name) === ignoringCase(trimmed(text))) ?? trimmed(text);

/** `ContradictedEnergyMeterModel`: an energy meter signing with a method its model does not name. */
function contradictedMeterModel(network: Network): string | undefined {

    for (const meter of allEffectiveMeters(network)) {

        const found = modelOf(meter, network.meterManufacturers, 'energyMeterModels');
        const model = found?.model;

        if (found === undefined || model === undefined || textsAt(model, 'signatureMethods').length === 0)
            continue;

        const methods = new Set(textsAt(model, 'signatureMethods').map(method => ignoringCase(signatureMethod(method))));
        const signing = [ ...new Set(textsAt(meter, 'signatureMethods').map(signatureMethod)) ].sort(ordinalText).find(method => !methods.has(ignoringCase(method)));

        if (signing !== undefined)
            return `The energy meter '${textOf(meter)}' signs with '${signing}', no signature method of its model '${textOf(model)}' of '${textOf(found.manufacturer)}'!`;

    }

    return undefined;

}

/** `DuplicateKeyAcrossParties`: a key of two parties, in the order of the parties, their signing and identity keys. */
function duplicateKeyAcrossParties(content: JSONObject, network: Network): string | undefined {

    const parties: (readonly [ string, string[] ])[] = [];
    const operator = get(content, 'operator');

    const keysOf = (party: JSONObject): string[] => {
        const keys = readPartyKeys(party);
        return typeof keys === 'string'
                   ? []
                   : [ ...keys.signingKeys.map(key => key.id).sort(ordinalText), ...keys.identityKeys.map(key => key.id).sort(ordinalText) ];
    };

    if (isObject(operator)) {
        const signing  = [ ...new Set(objectsAt(operator, 'signingKeyCertificates').flatMap(certificate => isObject(certificate['signingKey']) && typeof certificate['signingKey']['@id'] === 'string' ? [ certificate['signingKey']['@id'] ] : [])) ].sort(ordinalText);
        const identity = objectsAt(operator, 'identityKeys').flatMap(key => typeof key['@id'] === 'string' ? [ key['@id'] ] : []).sort(ordinalText);
        parties.push([ `the roaming network operator '${trimmed(asText(operator['@id']))}'`, [ ...signing, ...identity ] ]);
    }

    for (const [ list, type, parser ] of [ [ network.operators, 'ChargingStationOperator', operatorId ], [ network.providers, 'EMobilityProvider', freeId ],
                                           [ network.gridOperators, 'GridOperator', operatorId ], [ network.parkingOperators, 'ParkingOperator', freeId ],
                                           [ network.manufacturers, 'ChargingStationManufacturer', freeId ], [ network.meterManufacturers, 'EnergyMeterManufacturer', freeId ],
                                           [ network.softwareManufacturers, 'TransparencySoftwareManufacturer', freeId ], [ network.bodies, 'ConformityAssessmentBody', freeId ] ] as const)
        for (const party of list)
            parties.push([ `the ${type} '${type === 'EMobilityProvider' ? textOf(party, providerId) : textOf(party, parser)}'`, keysOf(party) ]);

    const seen = new Map<string, string>();

    for (const [ party, keys ] of parties)
        for (const key of keys) {
            const first = seen.get(key);
            if (first !== undefined)
                return `The key '${key}' of ${party} is a key of ${first} as well: a key belongs to one party only!`;
            seen.set(key, party);
        }

    return undefined;

}

/** A collection of the network given twice: "The charging station manufacturer 'X' must not be given twice!". */
const rootTwice = (entities: readonly JSONObject[], parser: (text: string) => Id | undefined, description: string): string | undefined => {
    const later = laterTwice(entities, parser);
    return later === undefined ? undefined : inRoamingNetwork(`The ${description} '${later}' must not be given twice!`, 'Children');
};

/**
 * The error, when the constructor of the roaming network refuses the parties of the given content, as WWCP_POI3 words it of a
 * version, in its order, each as an argument of its parameter, or bare after the last change of a change set, in the order it
 * checks them there; undefined for none. After a change set, a reference the version before the given one resolves names
 * what the change set withdrew while another party still names it.
 */
export const invalidReferences = (content: JSONObject, of: 'version' | 'change set', before?: JSONObject): string | undefined =>
    whileChecking(() => referenceError(content, of, before));

function referenceError(content: JSONObject, of: 'version' | 'change set', before?: JSONObject): string | undefined {

    const network = networkOf(content);
    const named   = namedBy(network);

    // As it was before the change set: the parties it resolves the references the change set leaves with.
    const withdrawn = (error: string, unknown: (resolving: Named) => string | undefined): string => {
        if (before === undefined || unknown(named) !== error)
            return error;
        const previous     = namedBy(networkOf(before));
        const certificates = new Map(previous.certificates);
        for (const [ key, certificate ] of named.certificates)
            certificates.set(key, certificate);
        return unknown({ ...previous, certificates }) === undefined
                   ? `${error.replace(/!+$/u, '')}: the change set withdraws it while it is still named; the party naming it changes first, or both sign one change set!`
                   : error;
    };

    if (of === 'change set') {

        const unknownReference = (resolving: Named): string | undefined =>
            unknownManufacturer(network, resolving) ?? unknownGridConnectionPoint(network, resolving) ?? unknownMaintainer(network, resolving) ??
            unknownChargingStation(network, resolving) ?? unknownParkingSpace(network, resolving) ?? unknownCertificateReference(network, resolving) ??
            unknownMeterTemplateReference(network, resolving) ?? unknownMeterManufacturer(network, resolving);

        const duplicate = (kind: string): string | undefined =>
            duplicateIdentification(content, 'change set', kind);

        const error = unknownManufacturer(network, named) ?? duplicate('gridConnectionPoint') ?? unknownGridConnectionPoint(network, named) ??
                      unknownMaintainer(network, named) ?? duplicate('energyMeter') ?? duplicate('parking') ?? unknownChargingStation(network, named) ??
                      unknownParkingSpace(network, named) ?? duplicate('release') ?? duplicate('certificate') ?? duplicate('number') ??
                      unknownCertificateReference(network, named) ?? duplicate('energyMeterGroup') ?? duplicate('providerGroup') ??
                      duplicate('tariffOffer') ?? newProviderOfferOverlap(network, before) ?? duplicate('energyMeterTemplate') ??
                      unknownMeterTemplateReference(network, named) ??
                      unknownMeterManufacturer(network, named);

        if (error !== undefined)
            return withdrawn(error, unknownReference);

        return contradictedStationModel(network) ?? contradictedMeterModel(network);

    }

    const ofParameter = (parameter: string, error: string | undefined): string | undefined =>
        error === undefined ? undefined : inRoamingNetwork(error, parameter);

    const duplicate = (kind: string): string | undefined =>
        duplicateIdentification(content, 'change set', kind);

    return rootTwice(objectsAt(content, 'chargingStationOperators'), operatorId, 'charging station operator') ??
           rootTwice(objectsAt(content, 'chargingStationManufacturers'), freeId, 'charging station manufacturer') ??
           ofParameter('ChargingStationManufacturers',       unknownManufacturer(network, named)) ??
           ofParameter('ChargingStationOperators',           contradictedStationModel(network)) ??
           rootTwice(objectsAt(content, 'eMobilityProviders'), providerId, 'e-mobility provider') ??
           rootTwice(objectsAt(content, 'gridOperators'), operatorId, 'grid operator') ??
           ofParameter('GridOperators',                      duplicate('gridConnectionPoint') ?? unknownGridConnectionPoint(network, named)) ??
           ofParameter('ChargingStationOperators',           duplicate('energyMeter')) ??
           rootTwice(objectsAt(content, 'energyMeterManufacturers'), freeId, 'energy meter manufacturer') ??
           rootTwice(objectsAt(content, 'parkingOperators'), freeId, 'parking operator') ??
           ofParameter('ParkingOperators',                   duplicate('parking') ?? unknownChargingStation(network, named) ?? unknownParkingSpace(network, named)) ??
           ofParameter('GridOperators',                      unknownMaintainer(network, named)) ??
           ofParameter('EMobilityProviders',                 duplicate('providerGroup') ?? duplicate('tariffOffer')) ??
           rootTwice(objectsAt(content, 'transparencySoftwareManufacturers'), freeId, 'transparency software manufacturer') ??
           ofParameter('TransparencySoftwareManufacturers',  duplicate('release')) ??
           rootTwice(objectsAt(content, 'conformityAssessmentBodies'), freeId, 'conformity assessment body') ??
           ofParameter('ConformityAssessmentBodies',         duplicate('certificate') ?? duplicate('number')) ??
           ofParameter('TransparencySoftwareManufacturers',  unknownCertificateReference(network, named)) ??
           ofParameter('ChargingStationOperators',           duplicate('energyMeterGroup') ?? duplicate('energyMeterTemplate') ?? unknownMeterTemplateReference(network, named)) ??
           ofParameter('EnergyMeterManufacturers',           unknownMeterManufacturer(network, named) ?? contradictedMeterModel(network)) ??
           ofParameter('ChargingStationOperators',           duplicateKeyAcrossParties(content, network));

}
