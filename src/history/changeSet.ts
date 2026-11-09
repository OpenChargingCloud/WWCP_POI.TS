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

import { checkContext, onlyProperties, requireArray, requireObject, requireString, requireTimestamp, CONTEXT_PREFIX } from '../common.ts';
import { canonicalJSONBytes }        from '../json/canonical.ts';
import { asText, get, isArray, isObject, set, without, type JSONObject, type JSONValue } from '../json/value.ts';
import { hash }                      from '../crypto/hash.ts';
import { verifySignature }           from '../crypto/signature.ts';
import { toHex }                     from '../encoding/text.ts';
import { parseETags, type ETag }     from '../etags.ts';
import type { POIPublicKey }         from '../keys.ts';
import { trimmed }                   from '../network/versionTexts.ts';
import { parsePreconditions, type Precondition } from './preconditions.ts';
import { POIError }                  from '../errors.ts';


/** The context of a change set, also of the signature input of its signatures (4). */
export const CHANGE_SET_CONTEXT = CONTEXT_PREFIX + 'roamingNetwork/changeSet/v3';

/** The context of a change, where it is given; WWCP_POI3 writes a change within its change set without it. */
export const CHANGE_CONTEXT = CONTEXT_PREFIX + 'roamingNetwork/change/v1';

/** How the identification of the change set of a merge starts, which is identified by its parents, not by its content (5.3). */
export const MERGE_CHANGE_SET_ID_PREFIX = 'merge-';


/**
 * The identification of a change set by its content (4): the SHA-256 of its canonical JSON with its context, without
 * `@id` and its signatures, as 64 lowercase hex digits, in every epoch; of its content as WWCP_POI3 reads it (`asRead`).
 */
export function changeSetIdentification(json: JSONObject): string {

    const content = without(asRead(json), '@id', 'signatures');
    set(content, '@context', CHANGE_SET_CONTEXT);

    return toHex(hash('sha256', canonicalJSONBytes(content)));

}

/** A mandatory text of a change as WWCP_POI3 reads it: trimmed, unless nothing is left, which is refused as empty. */
const readTrimmed = (text: string): string =>
    trimmed(text) === '' ? text : trimmed(text);

/**
 * A change set as WWCP_POI3 reads it, whose content its identification is of, as WWCP_POI3 writes each change again
 * (`ToJSON(Embedded: true)`): the kind, the entity type and the entity identification of each change trimmed, as
 * `ParseMandatoryText` reads them, e.g. `DE*GEF*P1` of ` DE*GEF*P1`, and as `ChangeSet.parse` reads them; without the
 * context of a change or of a segment of its element path, without an empty element path, the property name of each
 * segment trimmed. A change set identified by them as given is identified otherwise.
 */
function asRead(json: JSONObject): JSONObject {

    const changes = get(json, 'changes');

    if (!isArray(changes))
        return json;

    const read = changes.map(change => {

        if (!isObject(change))
            return change;

        const copy: JSONObject = { ...change };
        let   changed = false;

        for (const property of [ 'kind', 'entityType', 'entityId' ]) {
            const value = change[property];
            if (typeof value === 'string' && readTrimmed(value) !== value) {
                copy[property] = readTrimmed(value);
                changed = true;
            }
        }

        if (change['@context'] === CHANGE_CONTEXT) {
            delete copy['@context'];
            changed = true;
        }

        const path = change['elementPath'];

        if (isArray(path) && path.length === 0) {
            delete copy['elementPath'];
            changed = true;
        }

        else if (isArray(path) && path.some(segment => isObject(segment) && (segment['@context'] === ELEMENT_PATH_SEGMENT_CONTEXT ||
                                                                            typeof segment['propertyName'] === 'string' && readTrimmed(segment['propertyName']) !== segment['propertyName']))) {

            copy['elementPath'] = path.map(segment => {

                if (!isObject(segment))
                    return segment;

                const segmentCopy: JSONObject = { ...segment };

                if (segment['@context'] === ELEMENT_PATH_SEGMENT_CONTEXT)
                    delete segmentCopy['@context'];

                if (typeof segment['propertyName'] === 'string')
                    segmentCopy['propertyName'] = readTrimmed(segment['propertyName']);

                return segmentCopy;

            });

            changed = true;

        }

        return changed ? copy : change;

    });

    return read.some((change, index) => change !== changes[index]) ? { ...json, changes: read } : json;

}

/**
 * Refuses a change set naming change sets in `metadata.rebasedFrom` it was not rebased from (4): each entry names one,
 * the latest last, by its `@id`, `beforeETags` and `afterETags`, which is this change set with these ETags and with the
 * entries before it as its `rebasedFrom`, none for the first one; and one that was not rebased so: a change of it, but
 * an `Add` or `AddElement`, names no `oldValue`.
 */
function checkRebasedFrom(json: JSONObject, id: string): void {

    const metadata    = get(json, 'metadata');
    const rebasedFrom = isObject(metadata) ? get(metadata, 'rebasedFrom') : undefined;

    if (!isObject(metadata) || rebasedFrom === undefined)
        return;

    if (!isArray(rebasedFrom) || rebasedFrom.length === 0)
        throw new POIError(`The rebasedFrom of the change set '${id}' must be an array of the change sets it was rebased from!`);

    rebasedFrom.forEach((entry, index) => {

        const malformed = `Entry ${index} of the rebasedFrom of the change set '${id}' must name the @id, the beforeETags and the afterETags of a change set it was rebased from!`;

        if (!isObject(entry) || Object.keys(entry).some(key => key !== '@id' && key !== 'beforeETags' && key !== 'afterETags'))
            throw new POIError(malformed);

        const namedId     = get(entry, '@id');
        const beforeETags = get(entry, 'beforeETags');
        const afterETags  = get(entry, 'afterETags');

        if (typeof namedId !== 'string' || beforeETags === undefined || afterETags === undefined)
            throw new POIError(malformed);

        try {
            parseETags(beforeETags, true);
            parseETags(afterETags,  true);
        }
        catch {
            throw new POIError(malformed);
        }

        const originalMetadata = without(metadata, 'rebasedFrom');

        if (index > 0)
            set(originalMetadata, 'rebasedFrom', rebasedFrom.slice(0, index));

        const original = without(json, 'metadata', 'beforeETags', 'afterETags');
        set(original, 'beforeETags', beforeETags);
        set(original, 'afterETags',  afterETags);

        // Metadata without properties is not written.
        if (Object.keys(originalMetadata).length > 0)
            set(original, 'metadata', originalMetadata);

        const originalId = changeSetIdentification(original);

        if (namedId !== originalId)
            throw new POIError(`Entry ${index} of the rebasedFrom of the change set '${id}' names '${namedId}', not the change set it was rebased from with these ETags, '${originalId}'!`);

    });

    // Rebased, every change but an Add or AddElement names the old value it expects: only old values tell that a change set
    // committed meanwhile changed what it changes, which a rebase would overwrite (`RebasedFromError`).
    const changes = get(json, 'changes');

    (isArray(changes) ? changes : []).forEach((change, index) => {
        if (isObject(change) && get(change, 'oldValue') === undefined && ![ 'Add', 'AddElement' ].includes(readTrimmed(asText(change['kind']))))
            throw new POIError(`Change ${index} of the change set '${id}', which was rebased, has no old value: the rebase may have overwritten a concurrent change!`);
    });

}


/** The kinds of changes (SPECIFICATION.md section 4). */
export type ChangeKind =
    | 'Add' | 'Remove' | 'UpdateProperty' | 'RemoveProperty'
    | 'AddElement' | 'RemoveElement' | 'ReplaceElement' | 'UpdateElementProperty' | 'RemoveElementProperty';

const KINDS: readonly ChangeKind[] = [ 'Add', 'Remove', 'UpdateProperty', 'RemoveProperty',
                                       'AddElement', 'RemoveElement', 'ReplaceElement', 'UpdateElementProperty', 'RemoveElementProperty' ];

const ELEMENT_KINDS: readonly ChangeKind[] = [ 'AddElement', 'RemoveElement', 'ReplaceElement', 'UpdateElementProperty', 'RemoveElementProperty' ];

/** The context of a segment of an element path, where it is given. */
export const ELEMENT_PATH_SEGMENT_CONTEXT = CONTEXT_PREFIX + 'roamingNetwork/elementPathSegment/v1';


/**
 * One step of an element path (`POIElementPathSegment`): a property of the entity, or of the element the step before
 * addresses, and the identification of an element of it, which an array needs and one identified object may name.
 */
export interface ElementPathSegment {
    readonly propertyName:  string;
    readonly elementId:     string | undefined;
}

/** Whether a change addresses an element of a property of its entity by its element path. */
export const isElementChange = (change: Change): boolean =>
    change.elementPath !== undefined;

/** The property of the entity itself a change changes: of an element change the one its path starts with. */
export const entityPropertyName = (change: Change): string | undefined =>
    change.elementPath?.[0]?.propertyName ?? change.propertyName;


/** Whether a text is empty or whitespace only, as `String.IsNullOrWhiteSpace` tells it. */
const blank = (text: string): boolean =>
    trimmed(text) === '';

/**
 * A segment of an element path as WWCP_POI3 reads it (`POIElementPathSegment.TryParse`), or the error: its property name
 * trimmed, as `ParseMandatoryText` reads it, its element identification as given.
 */
function elementPathSegment(value: JSONValue, index: number): ElementPathSegment {

    if (!isObject(value))
        throw new POIError(`Change ${index}: an element path segment must be a JSON object!`);

    onlyProperties(value, [ '@context', 'propertyName', 'elementId' ], `Change ${index}: an element path segment`);

    const context = get(value, '@context');

    if (context !== undefined && context !== ELEMENT_PATH_SEGMENT_CONTEXT)
        throw new POIError(`Change ${index}: invalid element path segment: the JSON-LD context of the element path segment must be '${ELEMENT_PATH_SEGMENT_CONTEXT}'!`);

    const propertyName  = get(value, 'propertyName');
    const elementId     = get(value, 'elementId');

    if (typeof propertyName !== 'string' || blank(propertyName))
        throw new POIError(`Change ${index}: invalid element path segment: a schema property name is required!`);

    if (elementId !== undefined && (typeof elementId !== 'string' || blank(elementId)))
        throw new POIError(`Change ${index}: invalid element path segment: an element identifier must not be empty!`);

    return { propertyName: trimmed(propertyName), elementId };

}

/**
 * Refuses a change WWCP_POI3 does not make of what it names (`RoamingNetworkChange.Refusal`): an empty entity type or
 * identification, a parent type without its identification or the other way round, either of them empty, an element
 * change without an element path, another change with one, a new value of JSON `null`, and of each kind what it does
 * not take: `Add` an entity object, no old value, no property; `Remove` no new value, no property; `UpdateProperty` a
 * property and a new value; `RemoveProperty` and `RemoveElementProperty` a property and no new value; `AddElement` a new
 * value, no old value, no property; `RemoveElement` no new value, no property; `ReplaceElement` a new value, no
 * property; `UpdateElementProperty` a property and a new value.
 */
function checkChange(change: Change, index: number): void {

    const refused = (reason: string): never => {
        throw new POIError(`Change ${index}: ${reason}`);
    };

    if (blank(change.entityType) || blank(change.entityId))
        refused('its entity type and identification must not be empty!');

    if ((change.parentEntityType === undefined) !== (change.parentEntityId === undefined))
        refused('parent type and parent identifier must be supplied together!');

    if (change.parentEntityType !== undefined && (blank(change.parentEntityType) || blank(change.parentEntityId ?? '')))
        refused('its parent entity type and identification must not be empty!');

    if (change.newValue === null)
        refused('a new JSON value must not be null; a property is cleared by RemoveProperty!');

    const elementKind = ELEMENT_KINDS.includes(change.kind);

    if (elementKind && change.elementPath === undefined)
        refused(`${change.kind} requires a nonempty element path!`);

    if (!elementKind && change.elementPath !== undefined)
        refused('only element changes may contain an element path!');

    const newValue  = change.newValue !== undefined;
    const oldValue  = change.oldValue !== undefined;
    const property  = change.propertyName !== undefined;
    const named     = change.propertyName !== undefined && !blank(change.propertyName);

    switch (change.kind) {

        case 'Add':
            if (!isObject(change.newValue) || oldValue || property)
                refused('Add requires an entity object and no old value or property name!');
            break;

        case 'Remove':
            if (newValue || property)
                refused('Remove must not contain a new value or property name!');
            break;

        case 'UpdateProperty':
            if (!newValue || !named)
                refused('UpdateProperty requires a property name and a new JSON value!');
            break;

        case 'AddElement':
            if (!newValue || oldValue || property)
                refused('AddElement requires a new value and no old value or property name!');
            break;

        case 'RemoveElement':
            if (newValue || property)
                refused('RemoveElement must not contain a new value or property name!');
            break;

        case 'ReplaceElement':
            if (!newValue || property)
                refused('ReplaceElement requires a new value and no property name!');
            break;

        case 'UpdateElementProperty':
            if (!newValue || !named)
                refused('UpdateElementProperty requires a property name and a new value!');
            break;

        case 'RemoveProperty':
        case 'RemoveElementProperty':
            if (newValue || !named)
                refused('property removal requires a property name and no new value!');
            break;

    }

}


/** One change of a change set. */
export interface Change {
    readonly kind:              ChangeKind;
    readonly entityType:        string;
    readonly entityId:          string;
    readonly propertyName:      string | undefined;
    /** The old value, `null` for absent; `undefined` where the change names none. */
    readonly oldValue:          JSONValue | undefined;
    readonly newValue:          JSONValue | undefined;
    readonly parentEntityType:  string | undefined;
    readonly parentEntityId:    string | undefined;
    /** The element path of an element change, not empty; `undefined` for every other change. */
    readonly elementPath:       readonly ElementPathSegment[] | undefined;
    readonly json:              JSONObject;
}

/** A signature of a change set: by an owner of one of its changes, or a new identity key as its proof of possession. */
export interface ChangeSetSignature {
    readonly algorithm:  string;
    readonly keyId:      string;
    readonly value:      string;
}


/**
 * A change set (SPECIFICATION.md section 4): leads from the version of its `beforeETags` to the version of its
 * `afterETags`, signed by the owners of what it changes.
 */
export class ChangeSet {

    private constructor(
        public readonly id:                string,
        public readonly roamingNetworkId:  string,
        public readonly createdAt:         number,
        public readonly changes:           readonly Change[],
        public readonly preconditions:     readonly Precondition[],
        public readonly beforeETags:       readonly ETag[],
        public readonly afterETags:        readonly ETag[],
        public readonly signatures:        readonly ChangeSetSignature[],
        public readonly json:              JSONObject
    ) {}


    public static parse(value: JSONValue | undefined): ChangeSet {

        const json = requireObject(value, 'A change set');

        checkContext(json, CHANGE_SET_CONTEXT, 'a change set');
        onlyProperties(json, [ '@id', '@context', 'roamingNetworkId', 'createdAt', 'description', 'metadata', 'changes', 'preconditions',
                               'beforeETags', 'afterETags', 'signatures' ], 'A change set');

        const id = requireString(json, '@id', 'The identification of a change set');

        // Identified by its content, and rebased from what it names; the change set of a merge by its parents.
        if (!id.startsWith(MERGE_CHANGE_SET_ID_PREFIX)) {

            const contentId = changeSetIdentification(json);

            if (id !== contentId)
                throw new POIError(`The change set '${id}' is not identified by its content, '${contentId}'!`);

            checkRebasedFrom(json, id);

        }

        const changes = requireArray(get(json, 'changes'), `The changes of the change set '${id}'`).map((item, index) => {

            const change = requireObject(item, `Change ${index}`);

            onlyProperties(change, [ '@context', 'kind', 'entityType', 'entityId', 'propertyName', 'oldValue', 'newValue', 'parentEntityType', 'parentEntityId', 'elementPath' ], `Change ${index}`);

            const refused = (reason: string): never => {
                throw new POIError(`Change ${index}: ${reason}`);
            };

            const context = get(change, '@context');

            if (context !== undefined && context !== CHANGE_CONTEXT)
                refused(`the JSON-LD context of the roaming network change must be '${CHANGE_CONTEXT}'!`);

            // Its texts as WWCP_POI3 reads them (`TryParseText`): anything but a text refused, also JSON null; the kind,
            // the entity type and the entity identification trimmed, the others as given; in this order.
            const text = (property: string, description: string): string | undefined => {
                const value = get(change, property);
                return value === undefined || typeof value === 'string' ? value : refused(`the ${description} must be a text!`);
            };

            const mandatory = (property: string, description: string): string =>
                readTrimmed(text(property, description) ?? refused(`the ${description} must be a text!`));

            const kind = mandatory('kind', 'kind');

            if (!(KINDS as readonly string[]).includes(kind))
                refused(`unknown kind '${trimmed(kind)}'!`);

            const entityType        = mandatory('entityType', 'entity type');
            const entityId          = mandatory('entityId',   'entity identification');
            const propertyName      = text('propertyName',     'property name');
            const parentEntityType  = text('parentEntityType', 'parent entity type');
            const parentEntityId    = text('parentEntityId',   'parent entity identification');

            // An empty element path is none, as WWCP_POI3 takes it.
            const pathJSON = get(change, 'elementPath');

            if (pathJSON !== undefined && !isArray(pathJSON))
                refused('the element path must be a JSON array!');

            const elementPath = !isArray(pathJSON) || pathJSON.length === 0 ? undefined : pathJSON.map(segment => elementPathSegment(segment, index));

            const parsed: Change = {
                kind:              kind as ChangeKind,
                entityType,
                entityId,
                propertyName,
                oldValue:          get(change, 'oldValue'),
                newValue:          get(change, 'newValue'),
                parentEntityType,
                parentEntityId,
                elementPath,
                json:              change,
            };

            checkChange(parsed, index);

            return parsed;

        });

        const preconditions = parsePreconditions(get(json, 'preconditions'));

        const signatures = get(json, 'signatures') === undefined
                               ? []
                               : requireArray(get(json, 'signatures'), `The signatures of the change set '${id}'`).map(item => {
                                     const signature = requireObject(item, 'A signature of a change set');
                                     onlyProperties(signature, [ 'algorithm', 'keyId', 'value' ], 'A signature of a change set');
                                     const read = {
                                         algorithm:  requireString(signature, 'algorithm'),
                                         keyId:      requireString(signature, 'keyId'),
                                         value:      requireString(signature, 'value'),
                                     };
                                     // Not empty, nor whitespace alone, as WWCP_POI3 reads them (RoamingNetworkChangeSetSignature).
                                     for (const [ property, given ] of Object.entries(read))
                                         if (blank(given))
                                             throw new POIError(`The ${property} of a signature of the change set '${id}' must not be empty!`);
                                     return read;
                                 });

        return new ChangeSet(id,
                             requireString   (json, 'roamingNetworkId', `The roaming network of the change set '${id}'`),
                             requireTimestamp(json, 'createdAt',        `The createdAt of the change set '${id}'`),
                             changes,
                             preconditions,
                             parseETags(get(json, 'beforeETags'), true, `The beforeETags of the change set '${id}'`),
                             parseETags(get(json, 'afterETags'),  true, `The afterETags of the change set '${id}'`),
                             signatures,
                             json);

    }


    /** The description in its first language. */
    public get description(): string | undefined {
        const description = get(this.json, 'description');
        return isObject(description) && typeof Object.values(description)[0] === 'string' ? Object.values(description)[0] as string : undefined;
    }

    /** The signature input of one of its signatures (4): the context, its algorithm and key, and the change set without signatures. */
    public signingBytes(signature: ChangeSetSignature): Uint8Array {
        return canonicalJSONBytes({
            '@context':  CHANGE_SET_CONTEXT,
            algorithm:   signature.algorithm,
            keyId:       signature.keyId,
            changeSet:   without(this.json, 'signatures', '@context'),
        });
    }

    /** Verifies one signature with the given key. */
    public verifySignature(signature: ChangeSetSignature, key: POIPublicKey): void {

        if (signature.keyId !== key.id)
            throw new POIError('The signature key ID does not match the key ID.');

        verifySignature(signature.algorithm, key.key, this.signingBytes(signature), signature.value);

    }

}
