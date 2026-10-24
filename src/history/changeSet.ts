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
import { get, isObject, without, type JSONObject, type JSONValue } from '../json/value.ts';
import { verifySignature }           from '../crypto/signature.ts';
import { parseETags, type ETag }     from '../etags.ts';
import type { POIPublicKey }         from '../keys.ts';
import { POIError }                  from '../errors.ts';


/** The context of a change set, also of the signature input of its signatures (4). */
export const CHANGE_SET_CONTEXT = CONTEXT_PREFIX + 'roamingNetwork/changeSet/v3';


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
