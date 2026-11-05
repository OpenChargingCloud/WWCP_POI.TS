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

import { ordinal }   from '../json/canonical.ts';
import { clone, get, isArray, isObject, set, unset, type JSONArray, type JSONObject, type JSONValue } from '../json/value.ts';
import { evseGroupId, evseId, evseTemplateId, freeId, caseId, operatorId, poolGroupId, poolId, poolTemplateId, providerId, stationGroupId, stationId,
         stationTemplateId, tariffId, tariffTemplateId, type Id } from '../network/poiJSON.ts';
import type { Change, ElementPathSegment } from './changeSet.ts';


// The elements of the properties of an entity, as element changes address them (SPECIFICATION.md section 4), as
// POIElements.cs of WWCP_POI3 applies them:
//
// - An element of an array is identified by its `@id` text, a text element by itself. An array is addressed element by
//   element only when every element has an identification and no two the same. The identifications of an array of
//   identifications, e.g. `EVSEIds`, or of identified objects, e.g. `chargingConnectors`, are the same as their type
//   compares them, e.g. without case; any other ordinally.
// - The first segment of an element path names a property of the entity itself, every further one a property of the
//   element the segment before addresses. A segment on an array names the element by its identification; a segment on
//   any other value may name its `@id`, which it must then have.
// - An added element goes where the ordinal order of the identifications puts it, when the array is in that order,
//   otherwise at its end; to `templateIds`, whose order is content, always at its end. An array left without elements
//   is removed, as entities write no empty arrays.


/** The property of a member naming its templates, in an order that is content: the first template giving a value wins. */
const TEMPLATE_IDS = 'templateIds';

/** The properties holding one identified object, not an array of them: the energy meter of an EVSE. */
const SINGLE_IDENTIFIED = new Set([ 'energyMeter' ]);

/** The key of an identification of a type, as that type compares it: never the same as one of another type or of a text. */
const typed = (type: string, parser: (given: string) => Id | undefined) =>
    (text: string): string | undefined => {
        const id = parser(text);
        return id === undefined ? undefined : `${type}\u0000${id.key}`;
    };

/**
 * The template identification a text names: of an EVSE, charging station, charging pool or charging tariff template by its
 * infix, otherwise of a parking space template, compared without case.
 */
const templateId = (text: string): string | undefined =>
    typed('EVSETemplate',            evseTemplateId)   (text) ??
    typed('ChargingStationTemplate', stationTemplateId)(text) ??
    typed('ChargingPoolTemplate',    poolTemplateId)   (text) ??
    typed('ChargingTariffTemplate',  tariffTemplateId) (text) ??
    typed('ParkingSpaceTemplate',    freeId)           (text);

/** The identification types of the elements of a property, by the name of the property (`ElementIdTypes`). */
const ELEMENT_ID_TYPES: Readonly<Record<string, (text: string) => string | undefined>> = {
    EVSEIds:                     typed('EVSE',                    evseId),
    chargingStationIds:          typed('ChargingStation',         stationId),
    chargingPoolIds:             typed('ChargingPool',            poolId),
    chargingTariffIds:           typed('ChargingTariff',          tariffId),
    energyMeterIds:              typed('EnergyMeter',             freeId),
    chargingStationOperatorIds:  typed('ChargingStationOperator', operatorId),
    EVSEGroupIds:                typed('EVSEGroup',               evseGroupId),
    chargingStationGroupIds:     typed('ChargingStationGroup',    stationGroupId),
    chargingPoolGroupIds:        typed('ChargingPoolGroup',       poolGroupId),
    [TEMPLATE_IDS]:              templateId,
    brands:                      typed('Brand',                   freeId),
    parkingSpaceIds:             typed('ParkingSpace',            freeId),
    parkingSensorIds:            typed('ParkingSensor',           freeId),
    parkingProductIds:           typed('ParkingProduct',          caseId),
    eMobilityProviderIds:        typed('EMobilityProvider',       providerId),
    chargingConnectors:          typed('ChargingConnector',       freeId),
    energyMeters:                typed('EnergyMeter',             freeId),
    signatureMethods:            typed('SignatureMethod',         freeId),
};


/** The identification of an array element: its `@id` text, or the text itself; `undefined` when it has none (`IdOf`). */
function idOf(element: JSONValue | undefined): string | undefined {

    if (typeof element === 'string')
        return element;

    if (isObject(element)) {
        const id = get(element, '@id');
        return typeof id === 'string' ? id : undefined;
    }

    return undefined;

}

/**
 * An identification of an element of a property, as its identification type compares it, e.g. an EVSE identification of
 * `EVSEIds`; the text itself for any other property, or a text its type does not read (`KeyOf`).
 */
const keyOf = (property: string, id: string): string =>
    ELEMENT_ID_TYPES[property]?.(id) ?? `\u0001${id}`;

/** Whether two identifications name the same element of a property. */
const sameId = (property: string, left: string | undefined, right: string | undefined): boolean =>
    left !== undefined && right !== undefined && keyOf(property, left) === keyOf(property, right);

/** Whether every element of an array of a property has an identification, and no two the same, as its type compares them. */
function isIdentified(property: string, array: JSONArray): boolean {

    const keys = new Set<string>();

    for (const element of array) {
        const id = idOf(element);
        if (id === undefined || keys.has(keyOf(property, id)))
            return false;
        keys.add(keyOf(property, id));
    }

    return true;

}

/**
 * Inserts an element where the ordinal order of the identifications puts it, when the array is in that order, otherwise at
 * its end; into `templateIds`, whose order is content, always at its end.
 */
function insert(property: string, array: JSONArray, element: JSONValue): void {

    const id       = idOf(element) ?? '';
    const ids      = array.map(item => idOf(item) ?? '');
    const ordered  = property !== TEMPLATE_IDS && ids.every((other, index) => index === 0 || ordinal(ids[index - 1] ?? '', other) < 0);

    if (!ordered) {
        array.push(element);
        return;
    }

    const at = ids.findIndex(other => ordinal(other, id) >= 0);
    array.splice(at < 0 ? array.length : at, 0, element);

}


/** An element path as a text for messages, e.g. `chargingConnectors['1'].maxPower` (`PathText`). */
export function pathText(path: readonly ElementPathSegment[], propertyName?: string): string {
    return [ ...path.map(segment => segment.elementId === undefined ? segment.propertyName : `${segment.propertyName}['${segment.elementId}']`),
             ...(propertyName === undefined ? [] : [ propertyName ]) ].join('.');
}


/** What an element change makes of the property its path starts with, or why it does not apply. */
export type ElementApplied =
    | { readonly error: string }
    | { readonly error?: undefined, readonly newValue: JSONValue | undefined, readonly current: JSONValue | undefined };


/**
 * Applies an element change to the value of the property of the entity its path starts with (`POIElements.TryApply`):
 * the new value of that property, `undefined` when it is removed, and the value the change finds, as its old value names
 * it: the element, or the property of the element, `undefined` when absent. The given value is not changed.
 */
export function applyElement(change: Change, propertyValue: JSONValue | undefined): ElementApplied {

    const path = change.elementPath ?? [];
    const first = path[0];
    const last  = path[path.length - 1];

    if (first === undefined || last === undefined)
        return { error: `${change.kind} needs an element path!` };

    // The property of the entity, held by an object, so that every step has an object holding it.
    const root: JSONObject = {};

    if (propertyValue !== undefined)
        set(root, first.propertyName, clone(propertyValue));

    let holder = root;

    // Down to the object holding the addressed value.
    for (let index = 0; index < path.length - 1; index++) {

        const segment  = path[index] as ElementPathSegment;
        const here     = pathText(path.slice(0, index + 1));
        const value    = get(holder, segment.propertyName);
        let   element: JSONValue | undefined;

        if (isArray(value)) {

            if (segment.elementId === undefined)
                return { error: `'${here}' is an array: its elements are addressed by their identifications!` };

            if (!isIdentified(segment.propertyName, value))
                return { error: `The elements of '${pathText([ ...path.slice(0, index), { propertyName: segment.propertyName, elementId: undefined } ])}' have no identifications of their own: it is changed as a whole!` };

            element = value.find(item => sameId(segment.propertyName, idOf(item), segment.elementId));

        }
        else
            element = value !== undefined && (segment.elementId === undefined || sameId(segment.propertyName, idOf(value), segment.elementId)) ? value : undefined;

        if (element === undefined)
            return { error: `'${here}' does not exist!` };

        if (!isObject(element))
            return { error: `'${here}' is no JSON object!` };

        holder = element;

    }

    const target       = pathText(path);
    const targetValue  = get(holder, last.propertyName);
    const targetArray  = isArray(targetValue) ? targetValue : undefined;
    let   elementIndex = -1;
    let   addressed:   JSONValue | undefined;

    // The addressed value: an element of an array, or the value of a property.
    if (targetArray !== undefined) {

        if (last.elementId === undefined)
            return { error: `'${target}' is an array: its elements are addressed by their identifications!` };

        if (!isIdentified(last.propertyName, targetArray))
            return { error: `The elements of '${pathText([ ...path.slice(0, -1), { propertyName: last.propertyName, elementId: undefined } ])}' have no identifications of their own: it is changed as a whole!` };

        elementIndex = targetArray.findIndex(item => sameId(last.propertyName, idOf(item), last.elementId));
        addressed    = elementIndex >= 0 ? targetArray[elementIndex] : undefined;

    }
    else if (targetValue !== undefined) {

        if (last.elementId !== undefined && !sameId(last.propertyName, idOf(targetValue), last.elementId))
            return { error: `'${target}' does not exist: the value of '${last.propertyName}' is not '${last.elementId}'!` };

        addressed = targetValue;

    }

    let current: JSONValue | undefined;

    switch (change.kind) {

        case 'AddElement': {

            if (addressed !== undefined)
                return { error: `'${target}' already exists!` };

            const newElement = clone(change.newValue as JSONValue);

            // An element of an array, existing or new, or the value of an absent property.
            if (targetArray !== undefined || last.elementId !== undefined) {

                if (!sameId(last.propertyName, idOf(newElement), last.elementId))
                    return { error: `The element to add to '${last.propertyName}' must have the identification '${last.elementId ?? ''}'!` };

                // An absent array is empty: the first element makes it, but a property of one identified object is set.
                if (targetArray === undefined)
                    set(holder, last.propertyName, SINGLE_IDENTIFIED.has(last.propertyName) ? newElement : [ newElement ]);
                else
                    insert(last.propertyName, targetArray, newElement);

            }
            else
                set(holder, last.propertyName, newElement);

            break;

        }

        case 'RemoveElement':

            if (addressed === undefined)
                return { error: `'${target}' does not exist!` };

            current = clone(addressed);

            if (targetArray !== undefined) {
                targetArray.splice(elementIndex, 1);
                if (targetArray.length === 0)
                    unset(holder, last.propertyName);
            }
            else
                unset(holder, last.propertyName);

            break;

        case 'ReplaceElement': {

            if (addressed === undefined)
                return { error: `'${target}' does not exist!` };

            current = clone(addressed);

            const replacement = clone(change.newValue as JSONValue);

            if (targetArray !== undefined) {

                if (!sameId(last.propertyName, idOf(replacement), last.elementId))
                    return { error: `'${target}' must keep its identification: another element is removed and added!` };

                targetArray[elementIndex] = replacement;

            }
            else {

                // One identified object keeps its identification as well.
                const addressedId = isObject(addressed) ? idOf(addressed) : undefined;

                if (addressedId !== undefined && !sameId(last.propertyName, idOf(replacement), addressedId))
                    return { error: `'${target}' must keep its identification '${addressedId}': another one is removed and added!` };

                set(holder, last.propertyName, replacement);

            }

            break;

        }

        case 'UpdateElementProperty':
        case 'RemoveElementProperty': {

            if (!isObject(addressed))
                return { error: addressed === undefined ? `'${target}' does not exist!` : `'${target}' is no JSON object!` };

            const propertyName = change.propertyName ?? '';

            if (propertyName === '@id')
                return { error: `The identification of '${target}' can not be changed: another element is removed and added!` };

            const found = get(addressed, propertyName);
            current     = found === undefined ? undefined : clone(found);

            if (change.kind === 'RemoveElementProperty') {
                if (current === undefined)
                    return { error: `'${pathText(path, propertyName)}' does not exist!` };
                unset(addressed, propertyName);
            }
            else
                set(addressed, propertyName, clone(change.newValue as JSONValue));

            break;

        }

        default:
            return { error: `${change.kind} is no element change!` };

    }

    return { newValue: get(root, first.propertyName), current };

}
