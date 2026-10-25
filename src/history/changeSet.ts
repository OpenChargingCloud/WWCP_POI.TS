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

import { checkContext, onlyProperties, optionalString, requireArray, requireObject, requireString, requireTimestamp, CONTEXT_PREFIX } from '../common.ts';
import { canonicalJSONBytes }        from '../json/canonical.ts';
import { get, isArray, isObject, set, without, type JSONObject, type JSONValue } from '../json/value.ts';
import { hash }                      from '../crypto/hash.ts';
import { verifySignature }           from '../crypto/signature.ts';
import { toHex }                     from '../encoding/text.ts';
import { parseETags, type ETag }     from '../etags.ts';
import type { POIPublicKey }         from '../keys.ts';
import { POIError }                  from '../errors.ts';


/** The context of a change set, also of the signature input of its signatures (4). */
export const CHANGE_SET_CONTEXT = CONTEXT_PREFIX + 'roamingNetwork/changeSet/v3';

/** How the identification of the change set of a merge starts, which is identified by its parents, not by its content (5.3). */
export const MERGE_CHANGE_SET_ID_PREFIX = 'merge-';


/**
 * The identification of a change set by its content (4): the SHA-256 of its canonical JSON with its context, without
 * `@id` and its signatures, as 64 lowercase hex digits, in every epoch.
 */
export function changeSetIdentification(json: JSONObject): string {

    const content = without(json, '@id', 'signatures');
    set(content, '@context', CHANGE_SET_CONTEXT);

    return toHex(hash('sha256', canonicalJSONBytes(content)));

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
        if (isObject(change) && get(change, 'oldValue') === undefined && change['kind'] !== 'Add' && change['kind'] !== 'AddElement')
            throw new POIError(`Change ${index} of the change set '${id}', which was rebased, has no old value: the rebase may have overwritten a concurrent change!`);
    });

}


/** The kinds of changes (SPECIFICATION.md section 4). */
export type ChangeKind =
    | 'Add' | 'Remove' | 'UpdateProperty' | 'RemoveProperty'
    | 'AddElement' | 'RemoveElement' | 'ReplaceElement' | 'UpdateElementProperty' | 'RemoveElementProperty';

const KINDS: readonly ChangeKind[] = [ 'Add', 'Remove', 'UpdateProperty', 'RemoveProperty',
                                       'AddElement', 'RemoveElement', 'ReplaceElement', 'UpdateElementProperty', 'RemoveElementProperty' ];


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
    readonly elementPath:       readonly JSONObject[] | undefined;
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
        public readonly preconditions:     readonly JSONObject[],
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

            const kind = requireString(change, 'kind', `The kind of change ${index}`);

            if (!(KINDS as readonly string[]).includes(kind))
                throw new POIError(`Change ${index}: unknown kind '${kind}'!`);

            const elementPath = get(change, 'elementPath');

            return {
                kind:              kind as ChangeKind,
                entityType:        requireString (change, 'entityType',       `The entity type of change ${index}`),
                entityId:          requireString (change, 'entityId',         `The entity of change ${index}`),
                propertyName:      optionalString(change, 'propertyName',     `The property of change ${index}`),
                oldValue:          get(change, 'oldValue'),
                newValue:          get(change, 'newValue'),
                parentEntityType:  optionalString(change, 'parentEntityType', `The parent entity type of change ${index}`),
                parentEntityId:    optionalString(change, 'parentEntityId',   `The parent entity of change ${index}`),
                elementPath:       elementPath === undefined ? undefined : requireArray(elementPath, `The element path of change ${index}`).map(segment => requireObject(segment, `A segment of the element path of change ${index}`)),
                json:              change,
            };

        });

        const preconditions = get(json, 'preconditions') === undefined
                                  ? []
                                  : requireArray(get(json, 'preconditions'), `The preconditions of the change set '${id}'`).map(item => requireObject(item, 'A precondition'));

        const signatures = get(json, 'signatures') === undefined
                               ? []
                               : requireArray(get(json, 'signatures'), `The signatures of the change set '${id}'`).map(item => {
                                     const signature = requireObject(item, 'A signature of a change set');
                                     onlyProperties(signature, [ 'algorithm', 'keyId', 'value' ], 'A signature of a change set');
                                     return {
                                         algorithm:  requireString(signature, 'algorithm'),
                                         keyId:      requireString(signature, 'keyId'),
                                         value:      requireString(signature, 'value'),
                                     };
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
