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


// Identifications WWCP_POI keeps unique within the roaming network, not only within their party, as RoamingNetwork.cs checks
// them for every version and after the last change of every change set (`DuplicateGridConnectionPoint`, `DuplicateEnergyMeter`,
// `DuplicateParking`, `DuplicateTransparencySoftware`, `DuplicateTransparencySoftwareCertificate`, `DuplicateEnergyMeterGroup`,
// `DuplicateProviderGroup`, `DuplicateChargingTariffOffer`, `DuplicateEnergyMeterTemplate`), compared as their C# types
// compare them. One set per kind holds those of every party: within a party a valid version holds each once as well, and a
// group carries the prefix of its own party, so that two parties meet only where a provider and an operator have the same.


const objectsOf = (value: JSONValue | undefined): JSONObject[] =>
    isArray(value) ? value.filter(isObject) : [];

const idOf = (entity: JSONObject): string =>
    typeof entity['@id'] === 'string' ? entity['@id'] : '';

/** A text as `StringComparison.OrdinalIgnoreCase` compares it: every character by its simple upper case. */
const ignoringCase = (text: string): string =>
    Array.from(text, character => {
        const upper = character.toUpperCase();
        return upper.length === character.length ? upper : character;
    }).join('');

/** A text as `StringComparison.Ordinal` compares it. */
const withCase = (text: string): string =>
    text;

/**
 * An identification of a group as `EVSEGroup_Id`, `ChargingStationGroup_Id` and `ChargingPoolGroup_Id` compare it: its prefix
 * as a `ChargingStationOperator_Id`, the one of a provider (`DE-GDF`) as the one of an operator (`DE*GDF`), and its suffix,
 * both without case.
 */
const groupId = (letters: string) => {

    const pattern = new RegExp(`^([A-Za-z]{2})[*-]?([A-Za-z0-9]{3})\\*?${letters}([a-zA-Z0-9_][a-zA-Z0-9_*\\-.€$]{0,49})$`);

    return (text: string): string => {
        const match = pattern.exec(text);
        return match === null
                   ? ignoringCase(text)
                   : `${ignoringCase(match[1] ?? '')}*${ignoringCase(match[2] ?? '')}*${letters}${ignoringCase(match[3] ?? '')}`;
    };

};

/** The first of the given entities whose identification one before has, as the given key compares them. */
function twice(entities: readonly JSONObject[], key: (id: string) => string): JSONObject | undefined {

    const seen = new Set<string>();

    for (const entity of entities) {
        const id = key(idOf(entity));
        if (seen.has(id))
            return entity;
        seen.add(id);
    }

    return undefined;

}

/** The error, when two of the given entities have the same identification: they are unique within the roaming network. */
const givenTwice = (what: string, entities: readonly JSONObject[], key: (id: string) => string): string | undefined => {
    const duplicate = twice(entities, key);
    return duplicate === undefined ? undefined : `The ${what} '${idOf(duplicate)}' must not be given twice in the roaming network!`;
};

/** The children of the given parties in the given array. */
const childrenOf = (parties: readonly JSONObject[], property: string): JSONObject[] =>
    parties.flatMap(party => objectsOf(get(party, property)));

/**
 * The error, when one of the given parties has a child of the given array with the identification of a child of another
 * party, or of itself: a grid connection point, a transparency software release or certificate.
 */
function ofAnother(parties: readonly JSONObject[], property: string, message: (child: string, party: string, other: string) => string): string | undefined {

    const seen = new Map<string, string>();

    for (const party of parties)
        for (const child of objectsOf(get(party, property))) {

            const id    = ignoringCase(idOf(child));
            const other = seen.get(id);

            if (other !== undefined)
                return message(idOf(child), idOf(party), other);

            seen.set(id, idOf(party));

        }

    return undefined;

}

/**
 * The energy meters of the given charging station operators and grid operators (`AllEnergyMeters`): of their charging pools,
 * charging stations and EVSEs, and of their grid connection points.
 */
function energyMetersOf(operators: readonly JSONObject[], gridOperators: readonly JSONObject[]): JSONObject[] {

    const meters: JSONObject[] = [];

    for (const operator of operators)
        for (const pool of objectsOf(get(operator, 'chargingPools'))) {

            meters.push(...objectsOf(get(pool, 'energyMeters')));

            for (const station of objectsOf(get(pool, 'chargingStations'))) {

                meters.push(...objectsOf(get(station, 'energyMeters')));

                for (const evse of objectsOf(get(station, 'EVSEs'))) {
                    const meter = get(evse, 'energyMeter');
                    if (isObject(meter))
                        meters.push(meter);
                }

            }

        }

    for (const gridOperator of gridOperators)
        for (const gridConnectionPoint of objectsOf(get(gridOperator, 'gridConnectionPoints'))) {
            const meter = get(gridConnectionPoint, 'energyMeter');
            if (isObject(meter))
                meters.push(meter);
        }

    return meters;

}

/** The parking entities of parking operators and the parking spaces of charging station operators, unique within the network. */
function duplicateParking(parkingOperators: readonly JSONObject[], operators: readonly JSONObject[]): string | undefined {

    return givenTwice('parking garage',          childrenOf(parkingOperators, 'parkingGarages'),        ignoringCase) ??
           givenTwice('parking space',           [ ...childrenOf(parkingOperators, 'parkingSpaces'),
                                                   ...childrenOf(operators,        'parkingSpaces') ],    ignoringCase) ??
           givenTwice('parking sensor',          childrenOf(parkingOperators, 'parkingSensors'),        ignoringCase) ??
           givenTwice('parking space group',     childrenOf(parkingOperators, 'parkingSpaceGroups'),    ignoringCase) ??
           givenTwice('parking space template',  childrenOf(parkingOperators, 'parkingSpaceTemplates'), ignoringCase) ??
           // Parking products compare with case.
           givenTwice('parking product',         childrenOf(parkingOperators, 'parkingProducts'),       withCase);

}

/**
 * The error, when the given content names an identification twice that WWCP_POI keeps unique within the roaming network,
 * as WWCP_POI says it; undefined for none.
 */
export function duplicateIdentification(content: JSONObject): string | undefined {

    const operators              = objectsOf(get(content, 'chargingStationOperators'));
    const providers              = objectsOf(get(content, 'eMobilityProviders'));
    const gridOperators          = objectsOf(get(content, 'gridOperators'));
    const parkingOperators       = objectsOf(get(content, 'parkingOperators'));
    const softwareManufacturers  = objectsOf(get(content, 'transparencySoftwareManufacturers'));
    const bodies                 = objectsOf(get(content, 'conformityAssessmentBodies'));

    const meterOwners            = [ ...operators, ...gridOperators ];
    const groupOwners            = [ ...operators, ...providers ];

    return ofAnother(gridOperators, 'gridConnectionPoints', (point, gridOperator, other) =>
               `The grid connection point '${point}' of the grid operator '${gridOperator}' must be unique within the roaming network, but the grid operator '${other}' has it too!`) ??
           givenTwice('energy meter', energyMetersOf(operators, gridOperators), ignoringCase) ??
           duplicateParking(parkingOperators, operators) ??
           ofAnother(softwareManufacturers, 'transparencySoftware', (release, manufacturer, other) =>
               `The transparency software release '${release}' of the manufacturer '${manufacturer}' is one of the manufacturer '${other}' already!`) ??
           ofAnother(bodies, 'transparencySoftwareCertificates', (certificate, body, other) =>
               `The transparency software certificate '${certificate}' of the conformity assessment body '${body}' is one of the conformity assessment body '${other}' already!`) ??
           givenTwice('energy meter group',      childrenOf(meterOwners, 'energyMeterGroups'),      ignoringCase) ??
           givenTwice('EVSE group',              childrenOf(groupOwners, 'EVSEGroups'),             groupId('EG')) ??
           givenTwice('charging station group',  childrenOf(groupOwners, 'chargingStationGroups'),  groupId('SG')) ??
           givenTwice('charging pool group',     childrenOf(groupOwners, 'chargingPoolGroups'),     groupId('PG')) ??
           givenTwice('charging tariff offer',   childrenOf(groupOwners, 'chargingTariffOffers'),   ignoringCase) ??
           givenTwice('energy meter template',   childrenOf(meterOwners, 'energyMeterTemplates'),   ignoringCase);

}
