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


/** The arrays of the roaming network holding the parties and registries, by their entity type. */
const NETWORK_ARRAYS: Readonly<Record<string, string>> = {
    ChargingStationOperator:          'chargingStationOperators',
    EMobilityProvider:                'eMobilityProviders',
    GridOperator:                     'gridOperators',
    ParkingOperator:                  'parkingOperators',
    ChargingStationManufacturer:      'chargingStationManufacturers',
    EnergyMeterManufacturer:          'energyMeterManufacturers',
    TransparencySoftware:             'transparencySoftware',
    TransparencySoftwareCertificate:  'transparencySoftwareCertificates',
};

/** The parties: the RNO adds and removes them, they own their other properties (4.1). */
const PARTIES = new Set([ 'ChargingStationOperator', 'EMobilityProvider', 'GridOperator', 'ParkingOperator' ]);

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


/** Removes `@context` from every object it embeds: embedded, an object names no context (1.1). */
function embedded(value: JSONValue): JSONValue {

    if (isArray(value))
        return value.map(embedded);

    if (isObject(value)) {
        const result: JSONObject = {};
        for (const [property, item] of Object.entries(value))
            if (property !== '@context')
                set(result, property, embedded(item));
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
                        : current !== undefined && sameValue(embedded(change.oldValue), embedded(current));

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
        set(entity, property, embedded(change.newValue));
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
    const what      = `${change.entityType} '${change.entityId}'`;

    if (change.parentEntityType !== undefined && (change.parentEntityType !== 'RoamingNetwork' || change.parentEntityId !== content['@id']))
        throw new POIError(`Change ${index}: a ${change.entityType} of this roaming network belongs to RoamingNetwork '${String(content['@id'])}', not to ${change.parentEntityType} '${change.parentEntityId}'!`);

    const array   = get(content, property);
    const entity  = objectsOf(array).find(item => item['@id'] === change.entityId);
    const isProperty = change.kind === 'UpdateProperty' || change.kind === 'RemoveProperty';

    if (isProperty && entity === undefined)
        throw new POIError(`Change ${index}: the ${what} does not exist!`);

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


/** Who must sign a change, as the table of section 4.1 says. */
type Owner =
    | { readonly kind: 'rno' }
    | { readonly kind: 'party', readonly type: string, readonly id: string, readonly usage: KeyUsage, readonly identity: boolean };


function ownerOf(content: JSONObject, change: Change, index: number): Owner {

    if (change.entityType === 'RoamingNetwork' || change.entityType === 'RoamingNetworkOperator' ||
        change.entityType === 'ChargingStationManufacturer' || change.entityType === 'EnergyMeterManufacturer' ||
        change.entityType === 'TransparencySoftware' || change.entityType === 'TransparencySoftwareCertificate')
        return { kind: 'rno' };

    if (PARTIES.has(change.entityType)) {

        if (change.kind === 'Add' || change.kind === 'Remove')
            return { kind: 'rno' };

        // Its keys are signed by its identity keys; everything else of its own by a signing key for the party.
        const keys = change.propertyName === 'signingKeys' || change.propertyName === 'identityKeys';
        return { kind: 'party', type: change.entityType, id: change.entityId, usage: KeyUsages.Party, identity: keys };

    }

    if (INFRASTRUCTURE_TYPES.has(change.entityType)) {

        const operator = operatorOf(content, change.entityId);

        if (operator === undefined)
            throw new POIError(`Change ${index}: the charging station operator of the ${change.entityType} '${change.entityId}' does not exist!`);

        return {
            kind:      'party',
            type:      'ChargingStationOperator',
            id:        String(operator['@id']),
            usage:     TARIFF_TYPES.has(change.entityType) ? KeyUsages.Tariffs : KeyUsages.Infrastructure,
            identity:  false,
        };

    }

    throw new POIError(`Change ${index}: changes of ${change.entityType} '${change.entityId}' are not supported by this library yet!`);

}


function describeChange(change: Change, index: number): string {
    return `Change ${index}: ${change.kind} of the ${change.entityType} '${change.entityId}'`;
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

    // The identity keys its changes enter anew: each must sign it.
    const newIdentityKeys: POIPublicKey[] = [];

    changeSet.changes.forEach((change, index) => {

        let keys: JSONValue | undefined;

        if (PARTIES.has(change.entityType) && change.kind === 'Add' && isObject(change.newValue))
            keys = get(change.newValue, 'identityKeys');

        else if ((PARTIES.has(change.entityType) || change.entityType === 'RoamingNetworkOperator' || change.entityType === 'ChargingStationManufacturer') &&
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

    // The holders of the roaming network operator signing with keys that may sign what it owns.
    const rnoHolders = (identity: boolean): Set<string> =>
        new Set([ ...(identity ? [] : rnoSigning.filter(key => key.maySign(KeyUsages.Party))), ...rnoIdentity ]
                    .filter(signedValid)
                    .map(key => key.holderOrUnnamed));

    changeSet.changes.forEach((change, index) => {

        const owner = ownerOf(before.content, change, index);

        if (owner.kind === 'rno') {

            if (rno === undefined)
                throw new POIError(`${describeChange(change, index)}: the roaming network has no roaming network operator!`);

            if (rnoHolders(false).size < minConsensus)
                throw new POIError(minConsensus > 1
                                       ? `${describeChange(change, index)} needs signatures by signing keys of ${minConsensus} holders of the roaming network operator '${rno.id}'!`
                                       : `${describeChange(change, index)} needs a signature by a signing key of the roaming network operator '${rno.id}'!`);

            return;

        }

        const party = parties.get(`${owner.type}:${owner.id}`);

        if (party === undefined)
            throw new POIError(`${describeChange(change, index)}: the ${owner.type} '${owner.id}' does not exist!`);

        // A party without signing keys is changed by the roaming network operator in its place; an identity key of the
        // roaming network operator counts for both kinds of keys of every party, for recovery.
        const byParty = owner.identity
                            ? party.identityKeys.some(signedValid)
                            : party.signingKeys.some(key => key.maySign(owner.usage) && signedValid(key));

        const byRecovery = rnoHolders(true).size >= minConsensus && rnoIdentity.some(signedValid);
        const byRNO      = party.signingKeys.length === 0 && !owner.identity && rnoHolders(false).size >= minConsensus;

        if (!byParty && !byRecovery && !byRNO) {

            const mayAnyway = party.signingKeys.some(signedValid);

            throw new POIError(owner.identity
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
