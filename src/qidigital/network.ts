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
import { POIPublicKey }        from '../keys.ts';
import { energyMetersOf }      from '../network/identifications.ts';
import type { RoamingNetwork } from '../network/roamingNetwork.ts';
import { idOf, sameId }        from './json.ts';


// What QI-Digital documents are checked against: the parties of a roaming network, their keys and models, its charging
// stations and energy meters as they are at runtime, with what their templates give them, as WWCP_POI finds them by
// their identifications (`TryGetConformityAssessmentBodyById`, `TryGetEffectiveChargingStation`, `AllEffectiveEnergyMeters`).


const objectsOf = (value: JSONValue | undefined): JSONObject[] =>
    isArray(value) ? value.filter(isObject) : [];

/** The identification of an entity as WWCP_POI read it: trimmed. */
export const entityId = (entity: JSONObject): string => {
    const id = get(entity, '@id');
    return typeof id === 'string' ? idOf(id) ?? '' : '';
};

/** The entity of the given array of the content with the given identification, compared without case. */
const byId = (network: RoamingNetwork, property: string, id: string): JSONObject | undefined =>
    objectsOf(get(network.content, property)).find(entity => sameId(entityId(entity), id));


/** A conformity assessment body of a roaming network, as a QI-Digital document checks it. */
export interface Body {
    readonly id:                  string;
    readonly notifiedBodyNumber:  string | undefined;
    readonly notifiedFor:         readonly string[];
    readonly signingKeys:         readonly POIPublicKey[];
}

/** The conformity assessment body with the given identification, if the roaming network has it. */
export function bodyOf(network: RoamingNetwork, id: string): Body | undefined {

    const body = byId(network, 'conformityAssessmentBodies', id);

    if (body === undefined)
        return undefined;

    const number = get(body, 'notifiedBodyNumber');

    return {
        id:                  entityId(body),
        notifiedBodyNumber:  typeof number === 'string' ? number : undefined,
        notifiedFor:         objectsOrTexts(get(body, 'notifiedFor')),
        signingKeys:         POIPublicKey.parseAll(get(body, 'signingKeys'), `signing keys of the conformity assessment body '${entityId(body)}'`),
    };

}

const objectsOrTexts = (value: JSONValue | undefined): string[] =>
    isArray(value) ? value.filter(item => typeof item === 'string') : [];


/** A charging station or energy meter manufacturer of a roaming network, with its keys and models. */
export interface Manufacturer {
    readonly id:           string;
    readonly signingKeys:  readonly POIPublicKey[];
    /** Its models by their identification, each with its hardware revisions and firmware versions. */
    readonly models:       readonly Model[];
}

export interface Model {
    readonly id:                 string;
    readonly hardwareRevisions:  readonly string[];
    readonly firmwareVersions:   readonly string[];
}

/** The charging station manufacturer, or the energy meter manufacturer, with the given identification. */
export function manufacturerOf(network: RoamingNetwork, kind: 'chargingStation' | 'energyMeter', id: string): Manufacturer | undefined {

    const manufacturer = byId(network, kind === 'chargingStation' ? 'chargingStationManufacturers' : 'energyMeterManufacturers', id);

    if (manufacturer === undefined)
        return undefined;

    return {
        id:           entityId(manufacturer),
        signingKeys:  POIPublicKey.parseAll(get(manufacturer, 'signingKeys'), `signing keys of the manufacturer '${entityId(manufacturer)}'`),
        models:       objectsOf(get(manufacturer, kind === 'chargingStation' ? 'chargingStationModels' : 'energyMeterModels')).map(model => ({
                          id:                 entityId(model),
                          hardwareRevisions:  objectsOrTexts(get(model, 'hardwareRevisions')),
                          firmwareVersions:   objectsOrTexts(get(model, 'firmwareVersions')),
                      })),
    };

}


/**
 * The identification of a charging station as `ChargingStation_Id` reads it: the identification of its operator,
 * `DE*GEF` as `DE*GEF`, `DEGEF` or `de*gef`, and its suffix after an `S`.
 */
export interface ChargingStationId {
    readonly operatorId:  string;
    readonly suffix:      string;
}

const CHARGING_STATION_ID   = /^([a-zA-Z]{2}\*?[a-zA-Z0-9]{3})\*?S([a-zA-Z0-9][a-zA-Z0-9*]{0,29})$/u;
const OPERATOR_ID           = /^([A-Z]{2})\*?([A-Z0-9]{3})$/u;

/** The identification of a charging station operator as `ChargingStationOperator_Id` reads it, in upper case: `DE*GEF`. */
export function operatorIdOf(text: string): string | undefined {
    const match = OPERATOR_ID.exec((idOf(text) ?? '').toUpperCase());
    return match === null ? undefined : `${match[1] ?? ''}*${match[2] ?? ''}`;
}

/** Reads the identification of a charging station, trimmed (`ChargingStation_Id.TryParse`). */
export function chargingStationIdOf(text: string): ChargingStationId | undefined {

    const match = CHARGING_STATION_ID.exec(idOf(text) ?? '');

    if (match === null)
        return undefined;

    const operatorId = operatorIdOf(match[1] ?? '');

    return operatorId === undefined ? undefined : { operatorId, suffix: match[2] ?? '' };

}

/** A charging station identification as WWCP_POI writes it, `DE*GEF*S1`. */
export const chargingStationIdText = (id: ChargingStationId): string =>
    `${id.operatorId}*S${id.suffix}`;

/** Whether both are the same charging station, as `ChargingStation_Id` compares them: its suffix without stars and case. */
export const sameChargingStation = (left: ChargingStationId, right: ChargingStationId): boolean =>
    left.operatorId === right.operatorId && sameId(left.suffix.replaceAll('*', ''), right.suffix.replaceAll('*', ''));

/** The effective charging station with the given identification, as it is at runtime, with what its templates give it. */
export function effectiveChargingStationOf(network: RoamingNetwork, id: ChargingStationId): JSONObject | undefined {

    const operator = objectsOf(get(network.effectiveContent, 'chargingStationOperators')).find(item => operatorIdOf(entityId(item)) === id.operatorId);

    for (const pool of objectsOf(get(operator ?? {}, 'chargingPools')))
        for (const station of objectsOf(get(pool, 'chargingStations'))) {
            const stationId = chargingStationIdOf(entityId(station));
            if (stationId !== undefined && sameChargingStation(stationId, id))
                return station;
        }

    return undefined;

}

/** The effective energy meter with the given identification, as it is at runtime: of a charging station operator or a grid operator. */
export function effectiveEnergyMeterOf(network: RoamingNetwork, id: string): JSONObject | undefined {

    const content = network.effectiveContent;

    return energyMetersOf(objectsOf(get(content, 'chargingStationOperators')), objectsOf(get(content, 'gridOperators'))).
               find(meter => sameId(entityId(meter), id));

}
