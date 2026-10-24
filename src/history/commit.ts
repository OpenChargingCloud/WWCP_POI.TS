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

import { checkContext, onlyProperties, optionalString, requireArray, requireInteger, requireObject, requireString, requireTimestamp, CONTEXT_PREFIX } from '../common.ts';
import { canonicalJSONBytes }        from '../json/canonical.ts';
import { get, isArray, isObject, without, type JSONObject, type JSONValue } from '../json/value.ts';
import { toHex, isLowerHex }         from '../encoding/text.ts';
import { hash, hashAlgorithmOfIdentification, type HashAlgorithm } from '../crypto/hash.ts';
import { verifySignature }           from '../crypto/signature.ts';
import { parseETags, type ETag }     from '../etags.ts';
import { EpochProfiles, type Epoch } from './epoch.ts';
import type { POIPublicKey }         from '../keys.ts';
import { POIError }                  from '../errors.ts';


export const COMMIT_CONTEXT            = CONTEXT_PREFIX + 'roamingNetwork/commit/v3';
export const COMMIT_SIGNATURE_CONTEXT  = CONTEXT_PREFIX + 'roamingNetwork/commitSignature/v1';


/** The roles of commit and checkpoint signatures (5.4, 10.2). */
export const SignatureRoles = {
    Leader:                   'leader',
    RoamingNetworkOperator:   'roamingNetworkOperator',
    ChargingStationOperator:  'chargingStationOperator',
    Witness:                  'witness',
} as const;


/** A signature of a commit or a checkpoint (5.4, 10.2), its `signedAt` signed as written. */
export interface RoleSignature {
    readonly role:       string;
    readonly signer:     string | undefined;
    readonly signedAt:   number;
    readonly algorithm:  string;
    readonly keyId:      string;
    readonly value:      string;
    readonly json:       JSONObject;
}

export function parseRoleSignature(value: JSONValue | undefined, what: string): RoleSignature {

    const json = requireObject(value, what);

    onlyProperties(json, [ 'role', 'signer', 'signedAt', 'algorithm', 'keyId', 'value' ], what);

    return {
        role:       requireString   (json, 'role',      `The role of ${what.toLowerCase()}`),
        signer:     optionalString  (json, 'signer',    `The signer of ${what.toLowerCase()}`),
        signedAt:   requireTimestamp(json, 'signedAt',  `The signedAt of ${what.toLowerCase()}`),
        algorithm:  requireString   (json, 'algorithm', `The algorithm of ${what.toLowerCase()}`),
        keyId:      requireString   (json, 'keyId',     `The keyId of ${what.toLowerCase()}`),
        value:      requireString   (json, 'value',     `The value of ${what.toLowerCase()}`),
        json,
    };

}

/** The signature input of a commit or checkpoint signature: its own fields, and what it signs under `property`. */
export function roleSignatureBytes(context: string, signature: RoleSignature, property: string, signed: JSONObject): Uint8Array {

    const json: JSONObject = {
        '@context':  context,
        algorithm:   signature.algorithm,
        keyId:       signature.keyId,
        role:        signature.role,
        signedAt:    String(signature.json['signedAt']),
    };

    if (signature.signer !== undefined)
        json['signer'] = signature.signer;

    json[property] = signed;

    return canonicalJSONBytes(json);

}


/**
 * A commit: one step of the history of a roaming network (SPECIFICATION.md section 5). Read only when its `@id` is the
 * digest, with the identification hash of its epoch, of its content: `@context`, `roamingNetworkId`, `revision`, `eTags`,
 * `epoch` (from the second epoch on), `profiles` (the genesis of an epoch), `parentIds` and its change set without the
 * signatures of either.
 */
export class Commit {

    private constructor(
        public readonly id:                  string,
        public readonly roamingNetworkId:    string,
        public readonly revision:            number,
        public readonly eTags:               readonly ETag[],
        public readonly epoch:               number,
        public readonly parentIds:           readonly string[],
        public readonly changeSet:           JSONObject | undefined,
        public readonly signatures:          readonly RoleSignature[],
        public readonly identificationHash:  HashAlgorithm,
        /** The profiles of the epoch this commit starts, for the genesis of an epoch after the first one (11.3). */
        public readonly profiles:            EpochProfiles | undefined,
        public readonly json:                JSONObject
    ) {}


    /**
     * The genesis of an epoch after the first one (11.3): the version of the final checkpoint of the epoch before, nothing
     * applied, revision 0, naming the epoch and its profiles, identified with its identification hash. Every server
     * starting the epoch from the same final checkpoint makes the same; signatures do not change its identification.
     */
    public static genesisOf(roamingNetworkId: string, eTags: JSONValue, epoch: Epoch): Commit {

        const content: JSONObject = {
            '@context':        COMMIT_CONTEXT,
            roamingNetworkId,
            revision:          0,
            eTags,
            epoch:             epoch.number,
            profiles:          epoch.profiles.toJSON(),
        };

        return Commit.parse({ '@id': toHex(hash(epoch.profiles.identificationHash, canonicalJSONBytes(content))), ...content });

    }


    public static parse(value: JSONValue | undefined): Commit {

        const json = requireObject(value, 'A commit');

        checkContext(json, COMMIT_CONTEXT, 'a commit');
        onlyProperties(json, [ '@id', '@context', 'roamingNetworkId', 'revision', 'eTags', 'epoch', 'profiles', 'parentIds', 'changeSet', 'signatures' ], 'A commit');

        const id = requireString(json, '@id', 'The identification of a commit');

        if (!isLowerHex(id) || ![ 64, 96, 128 ].includes(id.length))
            throw new POIError('Missing or invalid commit identification!');

        const roamingNetworkId  = requireString (json, 'roamingNetworkId', `The roaming network of the commit '${id}'`);
        const revision          = requireInteger(json, 'revision', 0, Number.MAX_SAFE_INTEGER, `The revision of the commit '${id}'`);
        const eTags             = parseETags(get(json, 'eTags'), true, `The ETags of the commit '${id}'`);
        const epoch             = get(json, 'epoch') === undefined ? 1 : requireInteger(json, 'epoch', 2, Number.MAX_SAFE_INTEGER, `The epoch of the commit '${id}'`);

        const parentIdsJSON     = get(json, 'parentIds');
        const parentIds         = parentIdsJSON === undefined
                                      ? []
                                      : requireArray(parentIdsJSON, 'The parent commit identifications').map(parentId => {
                                            if (!isLowerHex(parentId) || ![ 64, 96, 128 ].includes(parentId.length))
                                                throw new POIError('Invalid parent commit identification!');
                                            return parentId;
                                        });

        if (parentIdsJSON !== undefined && (parentIds.length === 0 || parentIds.length > 2))
            throw new POIError('A commit has one parent, or two for a merge!');

        const changeSet = get(json, 'changeSet');

        if (changeSet !== undefined && !isObject(changeSet))
            throw new POIError('The change set must be a JSON object!');

        if ((parentIds.length === 0) !== (changeSet === undefined))
            throw new POIError(`The commit '${id}' must have parents and a change set, or neither, as a genesis commit!`);

        if (!eTags.some(eTag => eTag.format === 'effectiveTree'))
            throw new POIError(`The commit '${id}' names no effectiveTree ETag!`);

        const signaturesJSON  = get(json, 'signatures');
        const signatures      = signaturesJSON === undefined
                                    ? []
                                    : requireArray(signaturesJSON, 'The signatures of a commit').map(signature => parseRoleSignature(signature, 'A signature of a commit'));

        // The identification hash of the epoch: SHA-256 in the first one, told by the length of the identification; the
        // genesis of a later epoch names its profiles (11.3), no other commit does.
        const identificationHash  = hashAlgorithmOfIdentification(id);
        let   profiles: EpochProfiles | undefined;

        try {
            profiles = get(json, 'profiles') === undefined ? undefined : EpochProfiles.parse(get(json, 'profiles'));
        }
        catch (e) {
            throw new POIError(`Invalid profiles of the epoch of the commit '${id}': ${e instanceof Error ? e.message : String(e)}`);
        }

        if ((profiles !== undefined) !== (parentIds.length === 0 && epoch > 1))
            throw new POIError(`The genesis of an epoch after the first one names the profiles of the epoch, no other commit does: '${id}'!`);

        if (profiles !== undefined ? profiles.identificationHash !== identificationHash : epoch === 1 && identificationHash !== 'sha256')
            throw new POIError(`The commit '${id}' is not identified with the identification hash of its epoch!`);

        if (parentIds.some(parentId => hashAlgorithmOfIdentification(parentId) !== identificationHash))
            throw new POIError(`The commit '${id}' and its parents are not identified with the same hash, the one of their epoch!`);

        const commit   = new Commit(id, roamingNetworkId, revision, eTags, epoch, parentIds, changeSet, signatures, identificationHash, profiles, json);
        const computed = toHex(hash(identificationHash, canonicalJSONBytes(commit.identificationContent())));

        if (computed !== id)
            throw new POIError(`The commit identification '${id}' is not the one of its content, '${computed}'!`);

        if (revision === 0 && parentIds.length > 0)
            throw new POIError(`The commit '${id}' of revision 0 has parents!`);

        return commit;

    }


    /** What the identification is the digest of: the commit without `@id`, its signatures and those of its change set. */
    public identificationContent(): JSONObject {

        const content = without(this.json, '@id', 'signatures', 'changeSet');
        content['@context'] = COMMIT_CONTEXT;

        if (this.changeSet !== undefined)
            content['changeSet'] = without(this.changeSet, 'signatures', '@context');

        return content;

    }

    /** The commit as a signature of it signs it: with its `@context`, its `@id` and the signatures of its change set (5.4). */
    public signedContent(): JSONObject {

        const content = without(this.json, 'signatures', 'changeSet');
        content['@context'] = COMMIT_CONTEXT;

        if (this.changeSet !== undefined)
            content['changeSet'] = without(this.changeSet, '@context');

        return content;

    }

    /** The signature input of one of its signatures (5.4). */
    public signingBytes(signature: RoleSignature): Uint8Array {
        return roleSignatureBytes(COMMIT_SIGNATURE_CONTEXT, signature, 'commit', this.signedContent());
    }

    /** Verifies one signature with a trusted key, refusing one by another key. */
    public verifySignature(signature: RoleSignature, key: POIPublicKey): void {

        if (signature.keyId !== key.id)
            throw new POIError('The signature key ID does not match the trusted key ID.');

        verifySignature(signature.algorithm, key.key, this.signingBytes(signature), signature.value);

    }

    /** The description of its change set, in its first language. */
    public get description(): string | undefined {
        const description = this.changeSet === undefined ? undefined : get(this.changeSet, 'description');
        return isObject(description) && typeof Object.values(description)[0] === 'string' ? Object.values(description)[0] as string : undefined;
    }

    /** The leaf of the commit in the tree of the commits of a checkpoint (10.1): `{commitId, eTags, revision}`. */
    public checkpointLeaf(): JSONObject {
        return { commitId: this.id, eTags: [ ...this.json['eTags'] as JSONValue[] ], revision: this.revision };
    }

}

export { isArray };
