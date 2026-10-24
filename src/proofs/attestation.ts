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

import { checkContext, onlyProperties, optionalString, optionalTimestamp, requireInteger, requireObject, requireString, requireTimestamp, toTimestamp, CONTEXT_PREFIX } from '../common.ts';
import { canonicalJSONBytes }        from '../json/canonical.ts';
import { get, type JSONObject, type JSONValue } from '../json/value.ts';
import { verifySignature }           from '../crypto/signature.ts';
import { etagToJSON, parseETag, type ETag } from '../etags.ts';
import type { POIPublicKey }         from '../keys.ts';
import { POIError }                  from '../errors.ts';


export const ATTESTATION_CONTEXT = CONTEXT_PREFIX + 'roamingNetwork/attestation/v1';


/**
 * An attestation (SPECIFICATION.md section 8.5): states that a version is the one its signer has, at a point in time, with
 * the `effectiveTree` ETag of one hash algorithm. Small and fresh, unlike a commit signature.
 */
export class Attestation {

    private constructor(
        public readonly roamingNetworkId:  string,
        public readonly commitId:          string,
        public readonly revision:          number,
        public readonly eTag:              ETag,
        public readonly role:              string,
        public readonly signer:            string | undefined,
        public readonly signedAt:          number,
        public readonly validUntil:        number | undefined,
        public readonly subject:           JSONObject | undefined,
        public readonly algorithm:         string,
        public readonly keyId:             string,
        public readonly value:             string,
        public readonly json:              JSONObject
    ) {}


    public static parse(value: JSONValue | undefined): Attestation {

        const json = requireObject(value, 'An attestation');

        checkContext(json, ATTESTATION_CONTEXT, 'an attestation');
        onlyProperties(json, [ '@context', 'roamingNetworkId', 'commitId', 'revision', 'eTag', 'role', 'signer', 'signedAt', 'validUntil', 'subject', 'algorithm', 'keyId', 'value' ], 'An attestation');

        const eTag = parseETag(get(json, 'eTag'), true);

        if (eTag.format !== 'effectiveTree')
            throw new POIError('An attestation attests an effectiveTree ETag!');

        const signedAt    = requireTimestamp (json, 'signedAt',   'The signedAt of an attestation');
        const validUntil  = optionalTimestamp(json, 'validUntil', 'The validUntil of an attestation');

        if (validUntil !== undefined && validUntil < signedAt)
            throw new POIError('An attestation is not valid until before it was signed!');

        const subject = get(json, 'subject');

        return new Attestation(
                   requireString (json, 'roamingNetworkId', 'The roaming network of an attestation'),
                   requireString (json, 'commitId',         'The commit of an attestation'),
                   requireInteger(json, 'revision', 0, Number.MAX_SAFE_INTEGER, 'The revision of an attestation'),
                   eTag,
                   requireString (json, 'role',             'The role of an attestation'),
                   optionalString(json, 'signer',           'The signer of an attestation'),
                   signedAt,
                   validUntil,
                   subject === undefined ? undefined : requireObject(subject, 'The subject of an attestation'),
                   requireString (json, 'algorithm'),
                   requireString (json, 'keyId'),
                   requireString (json, 'value'),
                   json
               );

    }


    /** The signature input (8.5): its fields without `value`, the ETag in hex, with the context. */
    public signingBytes(): Uint8Array {

        const json: JSONObject = {
            '@context':        ATTESTATION_CONTEXT,
            algorithm:         this.algorithm,
            keyId:             this.keyId,
            role:              this.role,
            signedAt:          toTimestamp(this.signedAt),
            roamingNetworkId:  this.roamingNetworkId,
            commitId:          this.commitId,
            revision:          this.revision,
            eTag:              etagToJSON(this.eTag),
        };

        if (this.signer !== undefined)
            json['signer'] = this.signer;

        if (this.validUntil !== undefined)
            json['validUntil'] = toTimestamp(this.validUntil);

        if (this.subject !== undefined)
            json['subject'] = this.subject;

        return canonicalJSONBytes(json);

    }

    /** Verifies the signature with a trusted key, refusing one by another key. */
    public verifySignature(key: POIPublicKey): void {

        if (this.keyId !== key.id)
            throw new POIError('The attestation is signed by another key.');

        verifySignature(this.algorithm, key.key, this.signingBytes(), this.value);

    }

    /** Whether it is valid at the given point in time: signed then or before, and not after its `validUntil`. */
    public isValidAt(time: number): boolean {
        return this.signedAt <= time && (this.validUntil === undefined || time <= this.validUntil);
    }

}
