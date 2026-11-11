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

import { CONTEXT_PREFIX }     from '../common.ts';
import { canonicalJSONBytes } from '../json/canonical.ts';
import { get, isArray, isObject, type JSONObject, type JSONValue } from '../json/value.ts';
import { hash }               from '../crypto/hash.ts';
import { cborETag, etagToText, parseETag, sameETag, type ETag } from '../etags.ts';
import { caseId, evseGroupId, evseId, evseTemplateId, freeId, gridOperatorId, operatorId, poolGroupId, poolId, poolTemplateId, providerId,
         stationGroupId, stationId, stationTemplateId, tariffGroupId, tariffId, tariffTemplateId, type Id } from '../network/poiJSON.ts';
import { trimmed }            from '../network/versionTexts.ts';
import { POIError }           from '../errors.ts';


// The preconditions of change sets (SPECIFICATION.md section 4), as RoamingNetwork.Preconditions.cs of WWCP_POI3 checks
// them: the ETag an entity must still have in the version a change set is applied to, e.g. the one of the charging pool a
// client read and changed. The ETag of an entity is the one of its representation as the roaming network embeds it, with
// everything it embeds: over its canonical JSON, or the deterministic CBOR of its keys and values. The entity is found by
// its type and identification, compared as its type compares it.


/** The context of a precondition, where it is given. */
export const PRECONDITION_CONTEXT = CONTEXT_PREFIX + 'roamingNetwork/precondition/v1';

/** A precondition of a change set: the entity of a type and identification still has the given ETag. */
export interface Precondition {
    readonly entityType:  string;
    readonly entityId:    string;
    readonly eTag:        ETag;
}


/**
 * The preconditions of a change set as WWCP_POI3 reads them (`RoamingNetworkPrecondition.TryParse`): an array of objects,
 * each with its entity type and identification, texts trimmed as `ParseMandatoryText` reads them, also to nothing, which
 * no entity has, and its ETag, written in hex; refused in its words, which name only the index of the precondition it
 * does not read.
 */
export function parsePreconditions(value: JSONValue | undefined): Precondition[] {

    if (value === undefined)
        return [];

    if (!isArray(value))
        throw new POIError('The preconditions must be a JSON array!');

    return value.map((item, index) => {

        const invalid = new POIError(`Invalid precondition ${index}!`);

        if (!isObject(item) || Object.keys(item).some(key => key !== '@context' && key !== 'entityType' && key !== 'entityId' && key !== 'eTag'))
            throw invalid;

        const context     = get(item, '@context');
        const entityType  = get(item, 'entityType');
        const entityId    = get(item, 'entityId');

        if ((context !== undefined && context !== PRECONDITION_CONTEXT) || typeof entityType !== 'string' || typeof entityId !== 'string')
            throw invalid;

        try {
            return { entityType: trimmed(entityType), entityId: trimmed(entityId), eTag: parseETag(get(item, 'eTag'), true) };
        }
        catch {
            throw invalid;
        }

    });

}


/** The entity types a change set addresses on their own, by the type embedding them, with the property holding them (`MergeChildren`). */
const CHILDREN: Readonly<Record<string, readonly (readonly [ string, string ])[]>> = {
    RoamingNetwork:                    [ [ 'operator', 'RoamingNetworkOperator' ], [ 'chargingStationOperators', 'ChargingStationOperator' ],
                                         [ 'chargingStationManufacturers', 'ChargingStationManufacturer' ], [ 'eMobilityProviders', 'EMobilityProvider' ],
                                         [ 'gridOperators', 'GridOperator' ], [ 'parkingOperators', 'ParkingOperator' ],
                                         [ 'energyMeterManufacturers', 'EnergyMeterManufacturer' ],
                                         [ 'transparencySoftwareManufacturers', 'TransparencySoftwareManufacturer' ],
                                         [ 'conformityAssessmentBodies', 'ConformityAssessmentBody' ] ],
    ChargingStationOperator:           [ [ 'chargingTariffTemplates', 'ChargingTariffTemplate' ], [ 'chargingTariffs', 'ChargingTariff' ],
                                         [ 'EVSETemplates', 'EVSETemplate' ], [ 'chargingStationTemplates', 'ChargingStationTemplate' ],
                                         [ 'chargingPoolTemplates', 'ChargingPoolTemplate' ], [ 'energyMeterTemplates', 'EnergyMeterTemplate' ],
                                         [ 'chargingPools', 'ChargingPool' ], [ 'EVSEGroups', 'EVSEGroup' ], [ 'chargingStationGroups', 'ChargingStationGroup' ],
                                         [ 'chargingPoolGroups', 'ChargingPoolGroup' ], [ 'chargingTariffGroups', 'ChargingTariffGroup' ],
                                         [ 'energyMeterGroups', 'EnergyMeterGroup' ], [ 'chargingTariffOffers', 'ChargingTariffOffer' ],
                                         [ 'parkingSpaces', 'ParkingSpace' ] ],
    ChargingStationManufacturer:       [ [ 'chargingStationModels', 'ChargingStationModel' ] ],
    EnergyMeterManufacturer:           [ [ 'energyMeterModels', 'EnergyMeterModel' ] ],
    TransparencySoftwareManufacturer:  [ [ 'transparencySoftware', 'TransparencySoftware' ] ],
    ConformityAssessmentBody:          [ [ 'certificates', 'ConformityCertificate' ] ],
    ChargingPool:                      [ [ 'chargingStations', 'ChargingStation' ] ],
    ChargingStation:                   [ [ 'EVSEs', 'EVSE' ] ],
    EMobilityProvider:                 [ [ 'EVSEGroups', 'EVSEGroup' ], [ 'chargingStationGroups', 'ChargingStationGroup' ],
                                         [ 'chargingPoolGroups', 'ChargingPoolGroup' ], [ 'chargingTariffOffers', 'ChargingTariffOffer' ] ],
    GridOperator:                      [ [ 'energyMeterTemplates', 'EnergyMeterTemplate' ], [ 'gridConnectionPoints', 'GridConnectionPoint' ],
                                         [ 'energyMeterGroups', 'EnergyMeterGroup' ] ],
    ParkingOperator:                   [ [ 'parkingGarages', 'ParkingGarage' ], [ 'parkingSpaceTemplates', 'ParkingSpaceTemplate' ],
                                         [ 'parkingSpaces', 'ParkingSpace' ], [ 'parkingSensors', 'ParkingSensor' ],
                                         [ 'parkingSpaceGroups', 'ParkingSpaceGroup' ], [ 'parkingProducts', 'ParkingProduct' ] ],
};

/** The identification types of the entity types, as they read and compare identifications (`TypedId`); free texts without case. */
const ID_TYPES: Readonly<Record<string, (given: string) => Id | undefined>> = {
    ChargingStationOperator:  operatorId,
    EMobilityProvider:        providerId,
    GridOperator:             gridOperatorId,
    ChargingTariff:           tariffId,
    ChargingPool:             poolId,
    ChargingStation:          stationId,
    EVSE:                     evseId,
    EVSETemplate:             evseTemplateId,
    ChargingStationTemplate:  stationTemplateId,
    ChargingPoolTemplate:     poolTemplateId,
    ChargingTariffTemplate:   tariffTemplateId,
    EVSEGroup:                evseGroupId,
    ChargingStationGroup:     stationGroupId,
    ChargingPoolGroup:        poolGroupId,
    ChargingTariffGroup:      tariffGroupId,
    ParkingProduct:           caseId,
    ...Object.fromEntries([ 'RoamingNetwork', 'RoamingNetworkOperator', 'ChargingStationManufacturer', 'ChargingStationModel', 'ParkingOperator',
                            'EnergyMeterManufacturer', 'EnergyMeterModel', 'TransparencySoftwareManufacturer', 'TransparencySoftware',
                            'ConformityAssessmentBody', 'ConformityCertificate', 'EnergyMeterTemplate', 'GridConnectionPoint', 'EnergyMeterGroup',
                            'ChargingTariffOffer', 'ParkingGarage', 'ParkingSpace', 'ParkingSensor', 'ParkingSpaceTemplate', 'ParkingSpaceGroup' ].
                          map(type => [ type, freeId ])),
};

/**
 * The key of an entity of a type and identification (`MergeKey.Of`): its identification as its type reads it, or as a text
 * where its type does not read it. A model is unique within its manufacturer only and keyed with it, so that a precondition,
 * which names no parent, never finds one, as in WWCP_POI3.
 */
function keyOf(type: string, id: string, parent?: string): string {
    const typed = ID_TYPES[type]?.(id);
    const own   = typed === undefined ? `\u0001${id}` : `\u0000${typed.key}`;
    return (type === 'ChargingStationModel' || type === 'EnergyMeterModel') && parent !== undefined
               ? `${type}\u0002${parent}\u0002${own}`
               : `${type}\u0002${own}`;
}

/**
 * The entities of a version by their key, each as the roaming network embeds it, with everything it embeds (`Flatten`): the
 * roaming network itself, and every entity a change set addresses on their own. A later one of the same key replaces one before.
 */
function entitiesOf(content: JSONObject): Map<string, JSONObject> {

    const entities = new Map<string, JSONObject>();

    const walk = (type: string, id: string, parent: string | undefined, json: JSONObject): void => {

        const key = keyOf(type, id, parent);
        entities.set(key, json);

        for (const [ property, childType ] of CHILDREN[type] ?? []) {
            const children = get(json, property);
            for (const child of isObject(children) ? [ children ] : isArray(children) ? children.filter(isObject) : [])
                walk(childType, typeof child['@id'] === 'string' ? child['@id'] : '', key, child);
        }

    };

    walk('RoamingNetwork', typeof content['@id'] === 'string' ? content['@id'] : '', undefined, content);

    return entities;

}

/** The ETag of an entity as a precondition names it: over its canonical JSON, or over its deterministic CBOR (`EntityETag`). */
const entityETag = (json: JSONObject, like: ETag): ETag =>
    like.format === 'cbor'
        ? cborETag(json, like.algorithm)
        : { format: like.format, algorithm: like.algorithm, digest: hash(like.algorithm, canonicalJSONBytes(json)) };


/**
 * The error, when a precondition does not hold in the given content of a version (`TryCheckPreconditions`): the entity it
 * names does not exist, or has another ETag.
 */
export function brokenPrecondition(content: JSONObject, preconditions: readonly Precondition[]): string | undefined {

    if (preconditions.length === 0)
        return undefined;

    const entities = entitiesOf(content);

    for (const [ index, precondition ] of preconditions.entries()) {

        const entity = entities.get(keyOf(precondition.entityType, precondition.entityId));

        if (entity === undefined)
            return `Precondition ${index}: the ${precondition.entityType} '${precondition.entityId}' does not exist!`;

        if (!sameETag(entityETag(entity, precondition.eTag), precondition.eTag))
            return `Precondition ${index}: the ${precondition.entityType} '${precondition.entityId}' changed, it no longer has the ETag ${etagToText(precondition.eTag)}!`;

    }

    return undefined;

}
