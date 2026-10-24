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

import { ordinal }                        from '../json/canonical.ts';
import { clone, get, isArray, isObject, sameValue, set, type JSONArray, type JSONObject, type JSONValue } from '../json/value.ts';
import { toTimestamp }                    from '../common.ts';
import { cborETag, etagToText, jsonETag, sameETag, type ETag } from '../etags.ts';
import { KeyUsages, POIPublicKey, type KeyUsage } from '../keys.ts';
import { RoamingNetwork }                 from '../network/roamingNetwork.ts';
import type { Change, ChangeSet }         from './changeSet.ts';
import { POIError }                       from '../errors.ts';


// Applying a change set to a version (SPECIFICATION.md sections 4 and 4.1), as RoamingNetwork.ChangeSets.cs,
// RoamingNetwork.InfrastructureChanges.cs and RoamingNetwork.Ownership.cs of the C# implementation do, on the JSON of the
// content: the owners of every change signed it, the change set fits the version, its changes apply, and the result has its
// after ETags. Whatever this library calculates otherwise than the C# implementation ends in other after ETags, and the
// change set is refused: it never takes a version the change set does not lead to.


/** The arrays of the roaming network holding the parties, by their entity type. */
const NETWORK_ARRAYS: Readonly<Record<string, string>> = {
    ChargingStationOperator:          'chargingStationOperators',
    EMobilityProvider:                'eMobilityProviders',
    GridOperator:                     'gridOperators',
    ParkingOperator:                  'parkingOperators',
    ChargingStationManufacturer:       'chargingStationManufacturers',
    EnergyMeterManufacturer:           'energyMeterManufacturers',
    TransparencySoftwareManufacturer:  'transparencySoftwareManufacturers',
    ConformityAssessmentBody:          'conformityAssessmentBodies',
};

/** The parties: the RNO adds and removes them, they own their other properties (4.1). */
const PARTIES = new Set([ 'ChargingStationOperator', 'EMobilityProvider', 'GridOperator', 'ParkingOperator',
                          'ChargingStationManufacturer', 'EnergyMeterManufacturer', 'TransparencySoftwareManufacturer',
                          'ConformityAssessmentBody' ]);

const REGISTRY_PROPERTIES      = [ 'name', 'description', 'dataSource', 'address', 'homepage', 'hotline', 'customData' ];
const PARTY_PROPERTIES         = [ ...REGISTRY_PROPERTIES, 'signingKeys', 'identityKeys' ];
const CONTACT_PROPERTIES       = [ 'dataLicenses', 'logos', 'geoLocation', 'telephone', 'eMailAddress', 'termsAndConditions' ];
const MANUFACTURER_PROPERTIES  = [ ...PARTY_PROPERTIES, ...CONTACT_PROPERTIES ];

/**
 * The parties and the roaming network operator in words, and the properties of theirs a change set can update or remove
 * (`ChangeableOperatorProperties` and the registries of RoamingNetwork.RegistryChanges.cs): not their identification and
 * timestamps, nor the children they change on their own.
 */
const PARTY_REGISTRIES: Readonly<Record<string, { readonly what: string, readonly article: string, readonly changeable: readonly string[] }>> = {
    RoamingNetworkOperator:            { what: 'roaming network operator',            article: 'a',  changeable: [ ...REGISTRY_PROPERTIES, 'identityKeys', 'eMailAddress', 'hotlineEMailAddress',
                                                                                                                   'minConsensus', 'keyStatement', 'signingKeyCertificates' ] },
    ChargingStationOperator:           { what: 'charging station operator',           article: 'a',  changeable: [ ...MANUFACTURER_PROPERTIES, 'brands' ] },
    EMobilityProvider:                 { what: 'e-mobility provider',                 article: 'an', changeable: MANUFACTURER_PROPERTIES },
    GridOperator:                      { what: 'grid operator',                       article: 'a',  changeable: PARTY_PROPERTIES },
    ParkingOperator:                   { what: 'parking operator',                    article: 'a',  changeable: PARTY_PROPERTIES },
    ChargingStationManufacturer:       { what: 'charging station manufacturer',       article: 'a',  changeable: MANUFACTURER_PROPERTIES },
    EnergyMeterManufacturer:           { what: 'energy meter manufacturer',           article: 'an', changeable: MANUFACTURER_PROPERTIES },
    TransparencySoftwareManufacturer:  { what: 'transparency software manufacturer',  article: 'a',  changeable: [ ...MANUFACTURER_PROPERTIES, 'craRole', 'vulnerabilityContact',
                                                                                                                   'vulnerabilityReporting', 'vulnerabilityDisclosurePolicy', 'securityAdvisories' ] },
    ConformityAssessmentBody:          { what: 'conformity assessment body',          article: 'a',  changeable: [ ...MANUFACTURER_PROPERTIES, 'notifiedBodyNumber', 'notifiedFor' ] },
};

/** The embedded children a party is not added with, but adds on its own (`PartyChildren`). */
const PARTY_CHILDREN: Readonly<Record<string, readonly string[]>> = {
    ChargingStationOperator:           [ 'chargingPools', 'chargingTariffs', 'EVSETemplates', 'chargingStationTemplates', 'chargingPoolTemplates',
                                         'chargingTariffTemplates', 'energyMeterTemplates', 'EVSEGroups', 'chargingStationGroups', 'chargingPoolGroups',
                                         'chargingTariffGroups', 'energyMeterGroups', 'chargingTariffOffers', 'parkingSpaces' ],
    EMobilityProvider:                 [ 'EVSEGroups', 'chargingStationGroups', 'chargingPoolGroups', 'chargingTariffOffers' ],
    GridOperator:                      [ 'gridConnectionPoints', 'energyMeterTemplates', 'energyMeterGroups' ],
    ParkingOperator:                   [ 'parkingGarages', 'parkingSpaces', 'parkingSensors', 'parkingSpaceTemplates', 'parkingSpaceGroups', 'parkingProducts' ],
    ChargingStationManufacturer:       [ 'chargingStationModels' ],
    EnergyMeterManufacturer:           [ 'energyMeterModels' ],
    TransparencySoftwareManufacturer:  [ 'transparencySoftware' ],
    ConformityAssessmentBody:          [ 'transparencySoftwareCertificates' ],
};

/**
 * Entities a party embeds and changes on its own, without runtime status and timestamps: the models of a charging station
 * or energy meter manufacturer, the releases of a transparency software manufacturer and the certificates of a conformity
 * assessment body (ChargingStationManufacturer.md, EnergyMeterManufacturer.md, TransparencySoftwareManufacturer.md,
 * ConformityAssessmentBody.md).
 */
interface PartyChildType {
    readonly parentType:  string;
    readonly parents:     string;
    readonly property:    string;
    readonly what:        string;
    readonly usage:       KeyUsage;
    readonly changeable:  readonly string[];
    /** Its party in words, when its identification is unique within its party only: then every change names its party. */
    readonly inParent?:   string;
}

const PARTY_CHILD_TYPES: Readonly<Record<string, PartyChildType>> = {

    ChargingStationModel: {
        parentType:  'ChargingStationManufacturer',
        parents:     'chargingStationManufacturers',
        property:    'chargingStationModels',
        what:        'charging station model',
        usage:       KeyUsages.Models,
        changeable:  [ 'name', 'description', 'versions', 'productURL', 'datasheetURL', 'images', 'maxPower', 'currentTypes', 'connectorTypes',
                       'numberOfEVSEs', 'customData' ],
        inParent:    'manufacturer',
    },

    EnergyMeterModel: {
        parentType:  'EnergyMeterManufacturer',
        parents:     'energyMeterManufacturers',
        property:    'energyMeterModels',
        what:        'energy meter model',
        usage:       KeyUsages.Models,
        changeable:  [ 'name', 'description', 'versions', 'productURL', 'datasheetURL', 'images', 'currentTypes', 'maxCurrent', 'accuracyClass',
                       'measurands', 'signatureMethods', 'customData' ],
        inParent:    'manufacturer',
    },

    TransparencySoftware: {
        parentType:  'TransparencySoftwareManufacturer',
        parents:     'transparencySoftwareManufacturers',
        property:    'transparencySoftware',
        what:        'transparency software release',
        usage:       KeyUsages.Software,
        changeable:  [ 'name', 'version', 'openSourceLicenses', 'logo', 'howToUse', 'moreInformation', 'sourceCodeRepository',
                       'supportUntil', 'declarationOfConformity', 'softwareBillOfMaterials' ],
    },

    TransparencySoftwareCertificate: {
        parentType:  'ConformityAssessmentBody',
        parents:     'conformityAssessmentBodies',
        property:    'transparencySoftwareCertificates',
        what:        'transparency software certificate',
        usage:       KeyUsages.Certificates,
        changeable:  [ 'legislation', 'chargingStationModel', 'chargingStationModelVersion', 'chargingStationManufacturerId', 'documentNumber',
                       'documentURL', 'verifiedTransparencySoftwareIds', 'compatibleTransparencySoftwareIds', 'notBefore', 'notAfter' ],
    },

};

/**
 * Energy meter templates and groups: children of the charging station operator or the grid operator embedding them, which
 * an `Add` names as its parent (`TryApplyEnergyMeterChildChange` of the C# implementation).
 */
interface EnergyMeterChildType {
    readonly property:    string;
    readonly what:        string;
    readonly changeable:  readonly string[];
}

const ENERGY_METER_CHILD_TYPES: Readonly<Record<string, EnergyMeterChildType>> = {

    EnergyMeterTemplate: {
        property:    'energyMeterTemplates',
        what:        'energy meter template',
        changeable:  [ 'name', 'description', 'dataSource', 'customData', 'role', 'manufacturerId', 'modelId', 'modelURL', 'hardwareVersion',
                       'firmwareVersion', 'transparencySoftwareStatus', 'signatureMethods' ],
    },

    EnergyMeterGroup: {
        property:    'energyMeterGroups',
        what:        'energy meter group',
        changeable:  [ 'name', 'description', 'dataSource', 'energyMeterIds', 'customData' ],
    },

};

/** Identifications of parties and their releases and certificates are compared case-insensitively, as their C# types do. */
const sameId = (left: string, right: string): boolean =>
    left.toUpperCase() === right.toUpperCase();

/** Charging tariffs, templates and groups: children of their charging station operator itself. */
const OPERATOR_CHILD_ARRAYS: Readonly<Record<string, string>> = {
    ChargingTariff:           'chargingTariffs',
    EVSETemplate:             'EVSETemplates',
    ChargingStationTemplate:  'chargingStationTemplates',
    ChargingPoolTemplate:     'chargingPoolTemplates',
    ChargingTariffTemplate:   'chargingTariffTemplates',
    EVSEGroup:                'EVSEGroups',
    ChargingStationGroup:     'chargingStationGroups',
    ChargingPoolGroup:        'chargingPoolGroups',
    ChargingTariffGroup:      'chargingTariffGroups',
};

/** What a signing key of a charging station operator must be allowed to sign, to change an entity of this type (4.1). */
const TARIFF_TYPES = new Set([ 'ChargingTariff', 'ChargingTariffTemplate', 'ChargingTariffGroup', 'ChargingTariffOffer' ]);

const INFRASTRUCTURE_TYPES = new Set([ ...Object.keys(OPERATOR_CHILD_ARRAYS), 'ChargingPool', 'ChargingStation', 'EVSE' ]);


const idOf = (value: JSONValue | undefined): string =>
    isObject(value) && typeof value['@id'] === 'string' ? value['@id'] : '';

/**
 * The arrays the C# implementation keeps in an order of its own, whatever order a change gives them in, each element once
 * (`Ordered` of POIPublicKey, EnergyMeter, EnergyMeterPublicKey and RoamingNetworkSigningKeyCertificate): it writes them
 * so, and so they are part of the content.
 */
const ORDERED_ARRAYS: Readonly<Record<string, { readonly key: (item: JSONValue) => string, readonly order: (left: JSONValue, right: JSONValue) => number }>> = {
    signingKeys:             { key: idOf, order: (left, right) => ordinal(idOf(left), idOf(right)) },
    identityKeys:            { key: idOf, order: (left, right) => ordinal(idOf(left), idOf(right)) },
    energyMeters:            { key: idOf, order: (left, right) => ordinal(idOf(left), idOf(right)) },
    publicKeys:              { key: idOf, order: (left, right) => ordinal(idOf(left), idOf(right)) },
    signingKeyCertificates:  {
        key:    item => `${idOf(isObject(item) ? item['signingKey'] : undefined)}/${isObject(item) ? String(item['keyId']) : ''}`,
        order:  (left, right) => ordinal(idOf(isObject(left)  ? left['signingKey']  : undefined), idOf(isObject(right) ? right['signingKey'] : undefined)) ||
                                 ordinal(isObject(left) ? String(left['keyId']) : '', isObject(right) ? String(right['keyId']) : ''),
    },
};

/**
 * A value a change puts into the content, as the C# implementation keeps it: without `@context` in what it embeds
 * (embedded, an object names no context, 1.1), its ordered arrays in their order.
 */
function embedded(value: JSONValue, property?: string): JSONValue {

    if (isArray(value)) {

        const items    = value.map(item => embedded(item));
        const ordered  = property === undefined ? undefined : ORDERED_ARRAYS[property];

        if (ordered === undefined || !items.every(isObject))
            return items;

        if (new Set(items.map(ordered.key)).size !== items.length)
            throw new POIError(`An element of '${property}' must not be given twice!`);

        return items.sort(ordered.order);

    }

    if (isObject(value)) {
        const result: JSONObject = {};
        for (const [name, item] of Object.entries(value))
            if (name !== '@context')
                set(result, name, embedded(item, name));
        return result;
    }

    return value;

}

/** Inserts an entity into an array of entities in the ordinal order of their identifications. */
function insertOrdered(array: JSONArray, entity: JSONObject): void {
    const id    = String(entity['@id']);
    const index = array.findIndex(item => isObject(item) && ordinal(String(item['@id']), id) > 0);
    array.splice(index < 0 ? array.length : index, 0, entity);
}

const objectsOf = (value: JSONValue | undefined): JSONObject[] =>
    isArray(value) ? value.filter(isObject) : [];


/** Where an infrastructure entity is: the object, the array holding it, and its parent. */
interface Found {
    readonly entity:      JSONObject | undefined;
    readonly container:   JSONArray  | undefined;
    readonly holder:      JSONObject | undefined;
    readonly property:    string     | undefined;
    readonly parentType:  string     | undefined;
    readonly parentId:    string     | undefined;
}

const NOT_FOUND: Found = { entity: undefined, container: undefined, holder: undefined, property: undefined, parentType: undefined, parentId: undefined };


/** Finds an infrastructure entity within its charging station operator (`Find` of the C# implementation). */
function find(operator: JSONObject, entityType: string, entityId: string): Found {

    const operatorId  = String(operator['@id']);
    const childArray  = OPERATOR_CHILD_ARRAYS[entityType];

    if (childArray !== undefined) {
        const children = get(operator, childArray);
        for (const child of objectsOf(children))
            if (child['@id'] === entityId)
                return { entity: child, container: children as JSONArray, holder: operator, property: childArray, parentType: 'ChargingStationOperator', parentId: operatorId };
        return NOT_FOUND;
    }

    const pools = get(operator, 'chargingPools');

    for (const pool of objectsOf(pools)) {

        if (entityType === 'ChargingPool') {
            if (pool['@id'] === entityId)
                return { entity: pool, container: pools as JSONArray, holder: operator, property: 'chargingPools', parentType: 'ChargingStationOperator', parentId: operatorId };
            continue;
        }

        const stations = get(pool, 'chargingStations');

        for (const station of objectsOf(stations)) {

            if (entityType === 'ChargingStation') {
                if (station['@id'] === entityId)
                    return { entity: station, container: stations as JSONArray, holder: pool, property: 'chargingStations', parentType: 'ChargingPool', parentId: String(pool['@id']) };
                continue;
            }

            const evses = get(station, 'EVSEs');

            for (const evse of objectsOf(evses))
                if (evse['@id'] === entityId)
                    return { entity: evse, container: evses as JSONArray, holder: station, property: 'EVSEs', parentType: 'ChargingStation', parentId: String(station['@id']) };

        }

    }

    return NOT_FOUND;

}


/** The charging station operator an identification names: the one whose identification and a '*' it starts with. */
function operatorOf(content: JSONObject, entityId: string): JSONObject | undefined {

    let found: JSONObject | undefined;

    for (const operator of objectsOf(get(content, 'chargingStationOperators'))) {
        const id = String(operator['@id']);
        if (entityId.startsWith(id + '*') && (found === undefined || id.length > String(found['@id']).length))
            found = operator;
    }

    return found;

}


/** Sets `lastChange` of what embeds a changed entity: its charging station and charging pool, and its operator (`TouchParents`). */
function touchParents(operator: JSONObject, parentType: string | undefined, parentId: string | undefined, lastChange: string): void {

    while ((parentType === 'ChargingStation' || parentType === 'ChargingPool') && parentId !== undefined) {

        const parent = find(operator, parentType, parentId);

        if (parent.entity === undefined)
            break;

        parent.entity['lastChange'] = lastChange;
        parentType = parent.parentType;
        parentId   = parent.parentId;

    }

    operator['lastChange'] = lastChange;

}


/** Compares an old value as the C# implementation does: JSON `null` expects the value absent. */
function checkOldValue(change: Change, current: JSONValue | undefined, index: number, what: string): void {

    if (change.oldValue === undefined)
        return;

    const matches = change.oldValue === null
                        ? current === undefined
                        : current !== undefined && sameValue(embedded(change.oldValue, change.propertyName), embedded(current, change.propertyName));

    if (!matches)
        throw new POIError(change.propertyName !== undefined && (change.kind === 'UpdateProperty' || change.kind === 'RemoveProperty')
                               ? `Change ${index}: the property '${change.propertyName}' of the ${what} is no longer the expected old value!`
                               : `Change ${index}: the ${what} is no longer the expected old value${current === undefined ? ': it does not exist' : ''}!`);

}


/** Applies an `UpdateProperty` or a `RemoveProperty` to an entity. */
function applyProperty(entity: JSONObject, change: Change, index: number, what: string, lastChange: string): void {

    const property = change.propertyName;

    if (property === undefined || property === '@id' || property === 'created' || property === 'lastChange')
        throw new POIError(`Change ${index}: the property '${property ?? ''}' of a ${what} can not be changed!`);

    if (change.kind === 'RemoveProperty') {
        if (get(entity, property) === undefined)
            throw new POIError(`Change ${index}: the property '${property}' of the ${what} does not exist!`);
        delete entity[property];
    }
    else {
        if (change.newValue === undefined)
            throw new POIError(`Change ${index}: an UpdateProperty needs its newValue!`);
        set(entity, property, embedded(change.newValue, property));
    }

    entity['lastChange'] = lastChange;

}


/** The entity to add of a change: an object of the identification the change names, with its timestamps. */
function entityToAdd(change: Change, index: number, what: string, createdAt: string): JSONObject {

    if (!isObject(change.newValue) || change.newValue['@id'] !== change.entityId)
        throw new POIError(`Change ${index}: the ${what} to add must be a JSON object with the identification '${change.entityId}'!`);

    const added = embedded(clone(change.newValue)) as JSONObject;

    if (get(added, 'created') === undefined)
        added['created'] = createdAt;

    added['lastChange'] = createdAt;

    return added;

}


function applyInfrastructureChange(content: JSONObject, change: Change, index: number, createdAt: string): void {

    const what      = `${change.entityType} '${change.entityId}'`;
    const operator  = operatorOf(content, change.entityId);

    if (operator === undefined)
        throw new POIError(`Change ${index}: the charging station operator of the ${what} does not exist!`);

    const found = find(operator, change.entityType, change.entityId);

    if (found.entity !== undefined && change.parentEntityType !== undefined &&
       (change.parentEntityType !== found.parentType || change.parentEntityId !== found.parentId))
        throw new POIError(`Change ${index}: the ${what} belongs to ${found.parentType} '${found.parentId}', not to ${change.parentEntityType} '${change.parentEntityId}'!`);

    if (change.kind !== 'Add' && found.entity === undefined)
        throw new POIError(`Change ${index}: the ${what} does not exist!`);

    const isProperty = change.kind === 'UpdateProperty' || change.kind === 'RemoveProperty';

    checkOldValue(change, isProperty ? get(found.entity!, change.propertyName ?? '') : found.entity, index, what);

    let parentType  = found.parentType;
    let parentId    = found.parentId;

    switch (change.kind) {

        case 'UpdateProperty':
        case 'RemoveProperty':
            applyProperty(found.entity!, change, index, what, createdAt);
            break;

        case 'Add': {

            if (found.entity !== undefined)
                throw new POIError(`Change ${index}: the ${what} already exists!`);

            const added = entityToAdd(change, index, what, createdAt);

            // The parent it is added to: its operator, charging pool or charging station.
            parentType  = change.parentEntityType ?? 'ChargingStationOperator';
            parentId    = change.parentEntityId   ?? String(operator['@id']);

            let holder: JSONObject | undefined;
            let property: string;

            if (OPERATOR_CHILD_ARRAYS[change.entityType] !== undefined || change.entityType === 'ChargingPool') {
                if (parentType !== 'ChargingStationOperator' || parentId !== operator['@id'])
                    throw new POIError(`Change ${index}: the ${what} is added to its charging station operator '${String(operator['@id'])}', not to ${parentType} '${parentId}'!`);
                holder   = operator;
                property = OPERATOR_CHILD_ARRAYS[change.entityType] ?? 'chargingPools';
            }
            else if (change.entityType === 'ChargingStation') {
                if (parentType !== 'ChargingPool')
                    throw new POIError(`Change ${index}: a charging station is added to a charging pool!`);
                holder   = find(operator, 'ChargingPool', parentId).entity;
                property = 'chargingStations';
            }
            else {
                if (parentType !== 'ChargingStation')
                    throw new POIError(`Change ${index}: an EVSE is added to a charging station!`);
                holder   = find(operator, 'ChargingStation', parentId).entity;
                property = 'EVSEs';
            }

            if (holder === undefined)
                throw new POIError(`Change ${index}: the ${parentType} '${parentId}' to add the ${what} to does not exist!`);

            const children = get(holder, property);

            if (children === undefined)
                set(holder, property, [ added ]);
            else if (isArray(children))
                insertOrdered(children, added);
            else
                throw new POIError(`Change ${index}: '${property}' of ${parentType} '${parentId}' is no array!`);

            break;

        }

        case 'Remove': {
            const container = found.container!;
            container.splice(container.indexOf(found.entity!), 1);
            if (container.length === 0)
                delete found.holder![found.property!];
            break;
        }

        default:
            throw new POIError(`Change ${index}: ${change.kind} of a ${change.entityType} is not supported by this library yet!`);

    }

    // What embeds it changed with it, at the time of the change set.
    touchParents(operator, parentType, parentId, createdAt);

}


function applyNetworkArrayChange(content: JSONObject, change: Change, index: number, createdAt: string): void {

    const property  = NETWORK_ARRAYS[change.entityType]!;
    const registry  = PARTY_REGISTRIES[change.entityType]!;
    const what      = `${registry.what} '${change.entityId}'`;

    if (change.parentEntityType !== undefined && (change.parentEntityType !== 'RoamingNetwork' || change.parentEntityId !== content['@id']))
        throw new POIError(`Change ${index}: ${registry.article} ${registry.what} of this roaming network belongs to RoamingNetwork '${String(content['@id'])}', not to ${change.parentEntityType} '${change.parentEntityId}'!`);

    const array   = get(content, property);
    const entity  = objectsOf(array).find(item => item['@id'] === change.entityId);
    const isProperty = change.kind === 'UpdateProperty' || change.kind === 'RemoveProperty';

    if (isProperty && entity === undefined)
        throw new POIError(`Change ${index}: the ${what} does not exist!`);

    // Its children, e.g. its models, are changed on their own: by a key that may sign them.
    if (isProperty && !registry.changeable.includes(change.propertyName ?? ''))
        throw new POIError(`Change ${index}: the property '${change.propertyName ?? ''}' of ${registry.article} ${registry.what} can not be changed!`);

    checkOldValue(change, isProperty ? get(entity!, change.propertyName ?? '') : entity, index, what);

    switch (change.kind) {

        case 'UpdateProperty':
        case 'RemoveProperty':
            applyProperty(entity!, change, index, what, createdAt);
            break;

        case 'Add': {
            if (entity !== undefined)
                throw new POIError(`Change ${index}: the ${what} already exists!`);
            const added = entityToAdd(change, index, what, createdAt);
            if (array === undefined)
                set(content, property, [ added ]);
            else if (isArray(array))
                insertOrdered(array, added);
            break;
        }

        case 'Remove': {
            if (entity === undefined)
                throw new POIError(`Change ${index}: the ${what} does not exist!`);
            const items = array as JSONArray;
            items.splice(items.indexOf(entity), 1);
            if (items.length === 0)
                delete content[property];
            break;
        }

        default:
            throw new POIError(`Change ${index}: ${change.kind} of a ${change.entityType} is not supported by this library yet!`);

    }

}


/** The party of a type embedding a release or a certificate of an identification, and where. */
function partyChildOf(content: JSONObject, type: PartyChildType, childId: string): { party: JSONObject, children: JSONArray, child: JSONObject } | undefined {

    for (const party of objectsOf(get(content, type.parents))) {
        const children = get(party, type.property);
        const child    = objectsOf(children).find(item => typeof item['@id'] === 'string' && sameId(item['@id'], childId));
        if (child !== undefined)
            return { party, children: children as JSONArray, child };
    }

    return undefined;

}

/** The party of a type an identification names, in any spelling its identification considers equal. */
function partyNamed(content: JSONObject, type: string, id: string | undefined): JSONObject | undefined {
    const property = NETWORK_ARRAYS[type];
    return property === undefined || id === undefined
               ? undefined
               : objectsOf(get(content, property)).find(party => typeof party['@id'] === 'string' && sameId(party['@id'], id));
}


/** A model of the manufacturer a change names as its parent, and where: its identification is unique within it only. */
function partyChildIn(content: JSONObject, type: PartyChildType, change: Change, index: number): { party: JSONObject, found: { party: JSONObject, children: JSONArray, child: JSONObject } | undefined } {

    const party = change.parentEntityType === type.parentType ? partyNamed(content, type.parentType, change.parentEntityId) : undefined;

    if (party === undefined)
        throw new POIError(`Change ${index}: the ${type.what} '${change.entityId}' needs its ${type.parentType}, an existing one!`);

    const children  = get(party, type.property);
    const child     = objectsOf(children).find(item => typeof item['@id'] === 'string' && sameId(item['@id'], change.entityId));

    return { party, found: child === undefined ? undefined : { party, children: children as JSONArray, child } };

}


/**
 * Applies a change of a model of a charging station or energy meter manufacturer, of a release of a transparency software
 * manufacturer or of a certificate of a conformity assessment body (`TryApplyModelChange`,
 * `TryApplyTransparencySoftwareChange`, `TryApplyTransparencySoftwareCertificateChange`): added to the party an `Add` names
 * as its parent, changed and removed in the one embedding it, a model in the manufacturer every change of it names; the
 * party changes with it.
 */
function applyPartyChildChange(content: JSONObject, change: Change, index: number, createdAt: string): void {

    const type   = PARTY_CHILD_TYPES[change.entityType]!;
    const what   = `${type.what} '${change.entityId}'`;

    if (type.inParent !== undefined) {

        const { party, found } = partyChildIn(content, type, change, index);

        if (change.kind === 'Add' && found !== undefined)
            throw new POIError(`Change ${index}: the ${what} already exists, at the ${type.inParent} '${String(party['@id'])}'!`);

        if (change.kind !== 'Add' && found === undefined)
            throw new POIError(`Change ${index}: the ${what} of the ${type.inParent} '${String(party['@id'])}' does not exist!`);

        applyPartyChild(type, party, found, change, index, what, createdAt);
        return;

    }

    const found  = partyChildOf(content, type, change.entityId);
    let   party: JSONObject;

    if (change.kind === 'Add') {

        if (found !== undefined)
            throw new POIError(`Change ${index}: the ${what} already exists, at the ${type.parentType} '${String(found.party['@id'])}'!`);

        const parent = change.parentEntityType === type.parentType ? partyNamed(content, type.parentType, change.parentEntityId) : undefined;

        if (parent === undefined)
            throw new POIError(`Change ${index}: the ${what} to add needs its ${type.parentType}, an existing one!`);

        party = parent;

    }

    else {

        if (found === undefined)
            throw new POIError(`Change ${index}: the ${what} does not exist!`);

        if (change.parentEntityType !== undefined &&
           (change.parentEntityType !== type.parentType || change.parentEntityId === undefined || !sameId(change.parentEntityId, String(found.party['@id']))))
            throw new POIError(`Change ${index}: the ${what} belongs to ${type.parentType} '${String(found.party['@id'])}', not to ${change.parentEntityType} '${change.parentEntityId ?? ''}'!`);

        party = found.party;

    }

    applyPartyChild(type, party, found, change, index, what, createdAt);

}

/** Applies a change of a model, a release or a certificate to the party embedding it, or adding it. */
function applyPartyChild(type: PartyChildType, party: JSONObject, found: { children: JSONArray, child: JSONObject } | undefined, change: Change, index: number,
                         what: string, createdAt: string): void {

    const isProperty = change.kind === 'UpdateProperty' || change.kind === 'RemoveProperty';

    checkOldValue(change, isProperty ? get(found!.child, change.propertyName ?? '') : found?.child, index, what);

    switch (change.kind) {

        // Models, releases and certificates have no timestamps of their own.
        case 'UpdateProperty':
        case 'RemoveProperty': {

            const property = change.propertyName ?? '';

            if (!type.changeable.includes(property))
                throw new POIError(`Change ${index}: the property '${property}' of a ${type.what} can not be changed!`);

            if (change.kind === 'RemoveProperty') {
                if (get(found!.child, property) === undefined)
                    throw new POIError(`Change ${index}: the property '${property}' of the ${what} does not exist!`);
                delete found!.child[property];
            }
            else {
                if (change.newValue === undefined)
                    throw new POIError(`Change ${index}: an UpdateProperty needs its newValue!`);
                set(found!.child, property, embedded(change.newValue, property));
            }

            break;

        }

        case 'Add': {

            if (!isObject(change.newValue) || typeof change.newValue['@id'] !== 'string' || !sameId(change.newValue['@id'], change.entityId))
                throw new POIError(`Change ${index}: the ${type.what} to add must be a JSON object with the identification '${change.entityId}'!`);

            const added    = embedded(clone(change.newValue)) as JSONObject;
            const children = get(party, type.property);

            if (children === undefined)
                set(party, type.property, [ added ]);
            else if (isArray(children))
                insertOrdered(children, added);
            else
                throw new POIError(`Change ${index}: '${type.property}' of ${type.parentType} '${String(party['@id'])}' is no array!`);

            break;

        }

        case 'Remove': {
            const children = found!.children;
            children.splice(children.indexOf(found!.child), 1);
            if (children.length === 0)
                delete party[type.property];
            break;
        }

        default:
            throw new POIError(`Change ${index}: ${change.kind} of a ${type.what} is not supported by this library yet!`);

    }

    // The party embedding it changed with it, at the time of the change set.
    party['lastChange'] = createdAt;

}


/** The party embedding an energy meter template or group: a charging station operator, or else a grid operator. */
function energyMeterChildOf(content: JSONObject, type: EnergyMeterChildType, childId: string): { party: JSONObject, partyType: string, children: JSONArray, child: JSONObject } | undefined {

    for (const [partyType, parties] of [ [ 'ChargingStationOperator', 'chargingStationOperators' ], [ 'GridOperator', 'gridOperators' ] ] as const)
        for (const party of objectsOf(get(content, parties))) {
            const children = get(party, type.property);
            const child    = objectsOf(children).find(item => typeof item['@id'] === 'string' && sameId(item['@id'], childId));
            if (child !== undefined)
                return { party, partyType, children: children as JSONArray, child };
        }

    return undefined;

}

/**
 * Applies a change of an energy meter template or group: added to the charging station operator or grid operator an `Add`
 * names as its parent, changed and removed in the one embedding it, with its timestamps; the party changes with it.
 */
function applyEnergyMeterChildChange(content: JSONObject, change: Change, index: number, createdAt: string): void {

    const type   = ENERGY_METER_CHILD_TYPES[change.entityType]!;
    const what   = `${type.what} '${change.entityId}'`;
    const found  = energyMeterChildOf(content, type, change.entityId);
    let   party: JSONObject;

    if (change.kind === 'Add') {

        if (found !== undefined)
            throw new POIError(`Change ${index}: the ${what} already exists!`);

        const parent = change.parentEntityType === 'ChargingStationOperator' || change.parentEntityType === 'GridOperator'
                           ? partyNamed(content, change.parentEntityType, change.parentEntityId)
                           : undefined;

        if (parent === undefined)
            throw new POIError(`Change ${index}: the ${what} to add needs its ChargingStationOperator or GridOperator, an existing one!`);

        party = parent;

    }

    else {

        if (found === undefined)
            throw new POIError(`Change ${index}: the ${what} does not exist!`);

        if (change.parentEntityType !== undefined &&
           (change.parentEntityType !== found.partyType || change.parentEntityId === undefined || !sameId(change.parentEntityId, String(found.party['@id']))))
            throw new POIError(`Change ${index}: the ${what} belongs to ${found.partyType} '${String(found.party['@id'])}', not to ${change.parentEntityType} '${change.parentEntityId ?? ''}'!`);

        party = found.party;

    }

    const isProperty = change.kind === 'UpdateProperty' || change.kind === 'RemoveProperty';

    checkOldValue(change, isProperty ? get(found!.child, change.propertyName ?? '') : found?.child, index, what);

    switch (change.kind) {

        case 'UpdateProperty':
        case 'RemoveProperty':
            if (!type.changeable.includes(change.propertyName ?? ''))
                throw new POIError(`Change ${index}: the property '${change.propertyName ?? ''}' of an ${type.what} can not be changed!`);
            applyProperty(found!.child, change, index, what, createdAt);
            break;

        case 'Add': {

            const added    = entityToAdd(change, index, what, createdAt);
            const children = get(party, type.property);

            if (children === undefined)
                set(party, type.property, [ added ]);
            else if (isArray(children))
                insertOrdered(children, added);
            else
                throw new POIError(`Change ${index}: '${type.property}' of '${String(party['@id'])}' is no array!`);

            break;

        }

        case 'Remove': {
            const children = found!.children;
            children.splice(children.indexOf(found!.child), 1);
            if (children.length === 0)
                delete party[type.property];
            break;
        }

        default:
            throw new POIError(`Change ${index}: ${change.kind} of an ${type.what} is not supported by this library yet!`);

    }

    // The party embedding it changed with it, at the time of the change set.
    party['lastChange'] = createdAt;

}


function applyNetworkChange(content: JSONObject, change: Change, index: number, createdAt: string): void {

    const what = `roaming network '${String(content['@id'])}'`;

    if (change.kind !== 'UpdateProperty' && change.kind !== 'RemoveProperty')
        throw new POIError(`Change ${index}: ${change.kind} of the roaming network itself is not possible!`);

    if (![ 'name', 'description', 'dataSource', 'dataLicenses', 'treeHashAlgorithms', 'customData' ].includes(change.propertyName ?? ''))
        throw new POIError(`Change ${index}: the property '${change.propertyName ?? ''}' of a roaming network can not be changed!`);

    checkOldValue(change, get(content, change.propertyName!), index, what);
    applyProperty(content, change, index, what, createdAt);

}


function applyOperatorChange(content: JSONObject, change: Change, index: number, createdAt: string): void {

    const operator = get(content, 'operator');

    if (!isObject(operator) || operator['@id'] !== change.entityId)
        throw new POIError(`Change ${index}: the roaming network operator '${change.entityId}' is not the one of this roaming network!`);

    if (change.kind !== 'UpdateProperty' && change.kind !== 'RemoveProperty')
        throw new POIError(`Change ${index}: the roaming network operator is neither added nor removed!`);

    if (!PARTY_REGISTRIES['RoamingNetworkOperator']!.changeable.includes(change.propertyName ?? ''))
        throw new POIError(`Change ${index}: the property '${change.propertyName ?? ''}' of a roaming network operator can not be changed!`);

    checkOldValue(change, get(operator, change.propertyName ?? ''), index, `roaming network operator '${change.entityId}'`);
    applyProperty(operator, change, index, `roaming network operator '${change.entityId}'`, createdAt);

}


// Owners and their signatures (4.1)


interface PartyKeys {
    readonly type:          string;
    readonly id:            string;
    readonly signingKeys:   readonly POIPublicKey[];
    readonly identityKeys:  readonly POIPublicKey[];
}

function partiesOf(network: RoamingNetwork): Map<string, PartyKeys> {

    const parties = new Map<string, PartyKeys>();

    for (const [type, property] of Object.entries(NETWORK_ARRAYS))
        if (PARTIES.has(type))
            for (const party of objectsOf(get(network.content, property)))
                parties.set(`${type}:${String(party['@id'])}`, {
                    type,
                    id:            String(party['@id']),
                    signingKeys:   POIPublicKey.parseAll(get(party, 'signingKeys'),  `signing keys of the ${type} '${String(party['@id'])}'`),
                    identityKeys:  POIPublicKey.parseAll(get(party, 'identityKeys'), `identity keys of the ${type} '${String(party['@id'])}'`),
                });

    return parties;

}


/**
 * Who must sign a change, as the table of section 4.1 says. A party signs with a signing key that may sign the usage, with
 * an identity key, or with either; an identity key of the roaming network operator recovers the keys of every party.
 */
type OwnerKeys = 'signing' | 'identity' | 'signingOrIdentity';

type Owner =
    | { readonly kind: 'rno', readonly keys: OwnerKeys }
    | { readonly kind: 'party', readonly type: string, readonly id: string, readonly usage: KeyUsage, readonly keys: OwnerKeys };


function ownerOf(content: JSONObject, change: Change, index: number, addedEnergyMeterChildren: Map<string, { type: string, id: string }>): Owner {

    // The roaming network operator: its keys and its quorum by its identity keys, the certificates of its signing keys by
    // either kind, everything else by its signing keys.
    if (change.entityType === 'RoamingNetworkOperator')
        return {
            kind:  'rno',
            keys:  change.propertyName === 'signingKeyCertificates'                                        ? 'signingOrIdentity'
                 : [ 'signingKeys', 'identityKeys', 'minConsensus' ].includes(change.propertyName ?? '')  ? 'identity'
                 :                                                                                          'signing',
        };

    if (change.entityType === 'RoamingNetwork')
        return { kind: 'rno', keys: 'signing' };

    if (PARTIES.has(change.entityType)) {

        if (change.kind === 'Add' || change.kind === 'Remove')
            return { kind: 'rno', keys: 'signing' };

        // As its keys name it: a change may name it in every spelling its identification considers equal.
        const id = String(partyNamed(content, change.entityType, change.entityId)?.['@id'] ?? change.entityId);

        // Signing keys are rotated by the signing keys they replace or by an identity key, identity keys only by an
        // identity key; everything else of its own by a signing key for the party.
        return {
            kind:   'party',
            type:   change.entityType,
            id,
            usage:  KeyUsages.Party,
            keys:   change.propertyName === 'signingKeys'  ? 'signingOrIdentity'
                  : change.propertyName === 'identityKeys' ? 'identity'
                  :                                          'signing',
        };

    }

    // A model of its manufacturer, which every change of it names, a release of its transparency software manufacturer, a
    // certificate of the conformity assessment body issuing it.
    const childType = PARTY_CHILD_TYPES[change.entityType];

    if (childType !== undefined) {

        let party: JSONObject | undefined;

        if (childType.inParent !== undefined) {
            if (change.parentEntityType !== childType.parentType || change.parentEntityId === undefined)
                throw new POIError(`Change ${index}: the ${change.entityType} '${change.entityId}' needs its ${childType.parentType} as its parent!`);
            party = partyNamed(content, childType.parentType, change.parentEntityId);
        }

        else if (change.kind === 'Add') {
            if (change.parentEntityType !== childType.parentType || change.parentEntityId === undefined)
                throw new POIError(`Change ${index}: adding the ${change.entityType} '${change.entityId}' needs its ${childType.parentType} as its parent!`);
            party = partyNamed(content, childType.parentType, change.parentEntityId);
        }
        else
            party = partyChildOf(content, childType, change.entityId)?.party;

        if (party === undefined)
            throw new POIError(`Change ${index}: the ${change.entityType} '${change.entityId}' is unknown!`);

        return { kind: 'party', type: childType.parentType, id: String(party['@id']), usage: childType.usage, keys: 'signing' };

    }

    // An energy meter template or group of the charging station operator or grid operator embedding it, or adding it, also
    // by an earlier change of the same change set.
    const energyMeterChild = ENERGY_METER_CHILD_TYPES[change.entityType];

    if (energyMeterChild !== undefined) {

        const key = `${change.entityType}:${change.entityId.toUpperCase()}`;
        let owner: { type: string, id: string } | undefined;

        if (change.kind === 'Add') {
            if ((change.parentEntityType !== 'ChargingStationOperator' && change.parentEntityType !== 'GridOperator') || change.parentEntityId === undefined)
                throw new POIError(`Change ${index}: adding the ${change.entityType} '${change.entityId}' needs its ChargingStationOperator or GridOperator as its parent!`);
            const party = partyNamed(content, change.parentEntityType, change.parentEntityId);
            owner = { type: change.parentEntityType, id: String(party?.['@id'] ?? change.parentEntityId) };
            addedEnergyMeterChildren.set(key, owner);
        }
        else {
            const found = energyMeterChildOf(content, energyMeterChild, change.entityId);
            owner = addedEnergyMeterChildren.get(key) ?? (found === undefined ? undefined : { type: found.partyType, id: String(found.party['@id']) });
        }

        if (owner === undefined)
            throw new POIError(`Change ${index}: the ${change.entityType} '${change.entityId}' belongs to no charging station operator and no grid operator!`);

        return { kind: 'party', type: owner.type, id: owner.id, usage: KeyUsages.Infrastructure, keys: 'signing' };

    }

    if (INFRASTRUCTURE_TYPES.has(change.entityType)) {

        const operator = operatorOf(content, change.entityId);

        if (operator === undefined)
            throw new POIError(`Change ${index}: the charging station operator of the ${change.entityType} '${change.entityId}' does not exist!`);

        return {
            kind:   'party',
            type:   'ChargingStationOperator',
            id:     String(operator['@id']),
            usage:  TARIFF_TYPES.has(change.entityType) ? KeyUsages.Tariffs : KeyUsages.Infrastructure,
            keys:   'signing',
        };

    }

    throw new POIError(`Change ${index}: changes of ${change.entityType} '${change.entityId}' are not supported by this library yet!`);

}


function describeChange(change: Change, index: number): string {
    return `Change ${index}: ${change.kind} of the ${change.entityType} '${change.entityId}'`;
}


/**
 * A party is added with at least one signing and one identity key, a grid operator or a conformity assessment body not
 * taking part with none at all, and without the children it adds on its own; it always keeps at least one of each kind
 * (`TryCheckPartyChange`).
 */
function checkPartyChange(change: Change, index: number): void {

    if (change.entityType !== 'RoamingNetworkOperator' && !PARTIES.has(change.entityType))
        return;

    if (change.kind === 'Add') {

        const party = change.newValue;

        if (!isObject(party))
            return;

        const withoutKeys = (change.entityType === 'GridOperator' || change.entityType === 'ConformityAssessmentBody') &&
                            get(party, 'signingKeys') === undefined && get(party, 'identityKeys') === undefined;

        if (!withoutKeys)
            for (const property of [ 'signingKeys', 'identityKeys' ]) {
                const keys = get(party, property);
                if (!isArray(keys) || keys.length === 0)
                    throw new POIError(`Change ${index}: the ${change.entityType} '${change.entityId}' must be added with its ${property}!`);
            }

        const child = (PARTY_CHILDREN[change.entityType] ?? []).find(property => {
            const children = get(party, property);
            return isArray(children) && children.length > 0;
        });

        if (child !== undefined)
            throw new POIError(`Change ${index}: the ${change.entityType} '${change.entityId}' must be added without its ${child}: they are its own to add!`);

        return;

    }

    const keyProperty = change.propertyName === 'signingKeys' || change.propertyName === 'identityKeys' ||
                       (change.entityType === 'RoamingNetworkOperator' && change.propertyName === 'signingKeyCertificates');

    if (keyProperty && (change.kind === 'RemoveProperty' || (change.kind === 'UpdateProperty' && !(isArray(change.newValue) && change.newValue.length > 0))))
        throw new POIError(`Change ${index}: the ${change.entityType} '${change.entityId}' must keep at least one of its ${change.propertyName ?? ''}!`);

}


/**
 * Checks the signatures of a change set against the version it is applied to (4.1): every signature valid, by a key of a
 * party of the version valid at `createdAt` or by a new identity key of one of its changes (proof of possession); for every
 * owner of one of its changes a signature by a key that owner names that may sign the usage of what it changes; where the
 * roaming network operator owns a change, signatures of `minConsensus` of its holders.
 */
export function checkOwnership(before: RoamingNetwork, changeSet: ChangeSet): void {

    const createdAt     = changeSet.createdAt;
    const parties       = partiesOf(before);
    const rno           = before.operator;
    const rnoSigning    = rno?.signingKeys ?? [];
    const rnoIdentity   = rno?.identityKeys ?? [];
    const minConsensus  = rno?.minConsensus ?? 1;

    // Energy meter templates and groups an earlier change of this change set adds, by their owners.
    const addedEnergyMeterChildren = new Map<string, { type: string, id: string }>();

    // The identity keys its changes enter anew: each must sign it.
    const newIdentityKeys: POIPublicKey[] = [];

    changeSet.changes.forEach((change, index) => {

        let keys: JSONValue | undefined;

        if (PARTIES.has(change.entityType) && change.kind === 'Add' && isObject(change.newValue))
            keys = get(change.newValue, 'identityKeys');

        else if ((PARTIES.has(change.entityType) || change.entityType === 'RoamingNetworkOperator') &&
                 change.kind === 'UpdateProperty' && change.propertyName === 'identityKeys')
            keys = change.newValue;

        if (keys === undefined)
            return;

        const known = change.entityType === 'RoamingNetworkOperator'
                          ? rnoIdentity
                          : parties.get(`${change.entityType}:${change.entityId}`)?.identityKeys ?? [];

        for (const key of POIPublicKey.parseAll(keys, `identity keys of change ${index}`))
            if (!known.some(knownKey => knownKey.id === key.id))
                newIdentityKeys.push(key);

    });

    const allKeys = new Map<string, POIPublicKey>();

    for (const key of [ ...rnoSigning, ...rnoIdentity, ...[ ...parties.values() ].flatMap(party => [ ...party.signingKeys, ...party.identityKeys ]), ...newIdentityKeys ])
        allKeys.set(key.id, key);

    // Every signature valid, by a known key.
    const valid = new Set<string>();

    changeSet.signatures.forEach((signature, index) => {

        const key = allKeys.get(signature.keyId);

        if (key === undefined)
            throw new POIError(`Signature ${index} is by the key '${signature.keyId}', which is no key of a party of this roaming network!`);

        try {
            changeSet.verifySignature(signature, key);
        }
        catch (e) {
            throw new POIError(`Signature ${index} ('${signature.keyId}') is invalid: ${e instanceof Error ? e.message : String(e)}`);
        }

        valid.add(signature.keyId);

    });

    // Proof of possession.
    for (const key of newIdentityKeys)
        if (!valid.has(key.id))
            throw new POIError(`The new identity key '${key.id}' did not sign the change set: no proof of possession!`);

    const signedValid = (key: POIPublicKey): boolean =>
        valid.has(key.id) && key.isValidAt(createdAt);

    // The holders of the roaming network operator signing with keys of the kinds named, its signing keys only those that may
    // sign what it owns.
    const rnoHolders = (keys: OwnerKeys, usage: KeyUsage = KeyUsages.Party): Set<string> =>
        new Set([ ...(keys !== 'identity' ? rnoSigning.filter(key => key.maySign(usage))           : []),
                  ...(keys !== 'signing'  ? rnoIdentity                                            : []) ]
                    .filter(signedValid)
                    .map(key => key.holderOrUnnamed));

    changeSet.changes.forEach((change, index) => {

        checkPartyChange(change, index);

        const owner = ownerOf(before.content, change, index, addedEnergyMeterChildren);

        if (owner.kind === 'rno') {

            if (rno === undefined)
                throw new POIError(`${describeChange(change, index)}: the roaming network has no roaming network operator!`);

            const kind = owner.keys === 'identity' ? 'identity keys' : owner.keys === 'signing' ? 'signing keys' : 'signing or identity keys';

            if (rnoHolders(owner.keys).size < minConsensus)
                throw new POIError(minConsensus > 1
                                       ? `${describeChange(change, index)} needs signatures by ${kind} of ${minConsensus} holders of the roaming network operator '${rno.id}'!`
                                       : `${describeChange(change, index)} needs a signature by one of the ${kind} of the roaming network operator '${rno.id}'!`);

            return;

        }

        const party = parties.get(`${owner.type}:${owner.id}`);

        if (party === undefined)
            throw new POIError(`${describeChange(change, index)}: the ${owner.type} '${owner.id}' does not exist!`);

        // A party without signing keys is changed by the roaming network operator in its place (`SignerOf`); identity
        // keys of the roaming network operator recover both kinds of keys of every party, and nothing else of it.
        const bySigningKey   = owner.keys !== 'identity'  && party.signingKeys.some(key => key.maySign(owner.usage) && signedValid(key));
        const byIdentityKey  = owner.keys !== 'signing'   && party.identityKeys.some(signedValid);
        const byRecovery     = owner.keys !== 'signing'   && rnoHolders('identity').size >= minConsensus && rnoIdentity.some(signedValid);
        const byRNO          = owner.keys === 'signing'   && party.signingKeys.length === 0 && rnoHolders('signing', owner.usage).size >= minConsensus;

        if (!bySigningKey && !byIdentityKey && !byRecovery && !byRNO) {

            const mayAnyway = party.signingKeys.some(signedValid);

            throw new POIError(owner.keys === 'identity'
                                   ? `${describeChange(change, index)} needs a signature by an identity key of the ${owner.type} '${owner.id}'!`
                                   : mayAnyway
                                         ? `${describeChange(change, index)} needs a signature by a signing key of the ${owner.type} '${owner.id}' that may sign '${owner.usage}'!`
                                         : `${describeChange(change, index)} needs a signature by a signing key of the ${owner.type} '${owner.id}'!`);

        }

    });

}


/** Checks given ETags against those of a version: each the one of its format and algorithm (`MatchETags`). */
function matchETags(given: readonly ETag[], version: RoamingNetwork, what: string): void {

    for (const eTag of given) {

        const expected = eTag.format === 'json'          ? jsonETag(version.content, eTag.algorithm)
                       : eTag.format === 'cbor'          ? cborETag(version.content, eTag.algorithm)
                       :                                   version.effectiveTreeETag(eTag.algorithm);

        if (!sameETag(eTag, expected))
            throw new POIError(`${what}: the ${eTag.format} ETag (${eTag.algorithm}) is ${etagToText(expected)}, not ${etagToText(eTag)}!`);

    }

    if (!given.some(eTag => eTag.format === 'json') || !given.some(eTag => eTag.format === 'cbor'))
        throw new POIError(`${what}: a change set names the json and the cbor ETags!`);

}


/**
 * Applies a change set to the version it fits (4, 5.2): its owners signed it (unless `checkOwnership` is false), its
 * `beforeETags` are those of the version, its changes apply, and the result has its `afterETags`. Returns the new version.
 */
export function applyChangeSet(before: RoamingNetwork, changeSet: ChangeSet, options: { checkOwnership?: boolean } = {}): RoamingNetwork {

    if (changeSet.roamingNetworkId !== before.id)
        throw new POIError(`The change set is for the roaming network '${changeSet.roamingNetworkId}', not for '${before.id}'!`);

    if (options.checkOwnership ?? true)
        checkOwnership(before, changeSet);

    matchETags(changeSet.beforeETags, before, 'The change set does not fit this version of the roaming network');

    if (changeSet.preconditions.length > 0)
        throw new POIError('Change sets with preconditions are not supported by this library yet!');

    const content    = clone(before.content);
    const createdAt  = toTimestamp(changeSet.createdAt);

    changeSet.changes.forEach((change, index) => {

        if (change.elementPath !== undefined || change.kind.endsWith('Element') || change.kind.endsWith('ElementProperty'))
            throw new POIError(`Change ${index}: element changes are not supported by this library yet!`);

        if (change.entityType === 'RoamingNetwork' && change.entityId === before.id)
            applyNetworkChange(content, change, index, createdAt);

        else if (change.entityType === 'RoamingNetworkOperator')
            applyOperatorChange(content, change, index, createdAt);

        else if (NETWORK_ARRAYS[change.entityType] !== undefined)
            applyNetworkArrayChange(content, change, index, createdAt);

        else if (PARTY_CHILD_TYPES[change.entityType] !== undefined)
            applyPartyChildChange(content, change, index, createdAt);

        else if (ENERGY_METER_CHILD_TYPES[change.entityType] !== undefined)
            applyEnergyMeterChildChange(content, change, index, createdAt);

        else if (INFRASTRUCTURE_TYPES.has(change.entityType))
            applyInfrastructureChange(content, change, index, createdAt);

        else
            throw new POIError(`Change ${index}: changes of ${change.entityType} '${change.entityId}' are not supported by this library yet!`);

    });

    // A change set sets the lastChange of the roaming network always (4).
    content['lastChange'] = createdAt;

    const after = RoamingNetwork.parse(content);

    matchETags(changeSet.afterETags, after, 'The result does not match the change set');

    return after;

}
