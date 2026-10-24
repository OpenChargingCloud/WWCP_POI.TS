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

import { checkContext, onlyProperties, requireObject, requireString, requireTimestamp, toTimestamp, CONTEXT_PREFIX } from '../common.ts';
import { canonicalJSONBytes }    from '../json/canonical.ts';
import { without, type JSONObject, type JSONValue } from '../json/value.ts';
import { verifySignature }       from '../crypto/signature.ts';
import { POIPublicKey }          from '../keys.ts';
import { POIError }              from '../errors.ts';


export const SIGNING_KEY_CERTIFICATE_CONTEXT = CONTEXT_PREFIX + 'roamingNetwork/signingKeyCertificate/v2';

const describeHolder = (key: POIPublicKey): string =>
    key.holder !== undefined ? `'${key.holder}'` : 'no named holder';


/**
 * The certificate of a signing key of a roaming network operator (SPECIFICATION.md section 8.6): the signing key with its
 * validity, its holder and its usages, signed by an identity key of the same holder, valid at `signedAt`. It names the
 * operator, not a roaming network.
 */
export class SigningKeyCertificate {

    private constructor(
        public readonly roamingNetworkOperatorId:  string,
        public readonly signingKey:                POIPublicKey,
        public readonly signedAt:                  number,
        public readonly algorithm:                 string,
        public readonly keyId:                     string,
        public readonly value:                     string,
        public readonly json:                      JSONObject
    ) {}


    public static parse(value: JSONValue | undefined): SigningKeyCertificate {

        const json = requireObject(value, 'A certificate of a signing key');

        checkContext(json, SIGNING_KEY_CERTIFICATE_CONTEXT, 'a certificate of a signing key');
        onlyProperties(json, [ '@context', 'roamingNetworkOperatorId', 'signingKey', 'signedAt', 'algorithm', 'keyId', 'value' ], 'A certificate of a signing key');

        return new SigningKeyCertificate(
                   requireString   (json, 'roamingNetworkOperatorId', 'The roaming network operator of a certificate'),
                   POIPublicKey.parse(json['signingKey'], 'The signing key of a certificate'),
                   requireTimestamp(json, 'signedAt', 'The signedAt of a certificate'),
                   requireString   (json, 'algorithm'),
                   requireString   (json, 'keyId'),
                   requireString   (json, 'value'),
                   json
               );

    }


    /** The signature input: the certificate without `value`, with its `@context`, its signing key embedded without its. */
    public signingBytes(): Uint8Array {
        return canonicalJSONBytes({
            '@context':                SIGNING_KEY_CERTIFICATE_CONTEXT,
            roamingNetworkOperatorId:  this.roamingNetworkOperatorId,
            signingKey:                without(this.signingKey.json, '@context'),
            signedAt:                  toTimestamp(this.signedAt),
            algorithm:                 this.algorithm,
            keyId:                     this.keyId,
        });
    }


    /**
     * Verifies the certificate as `TryVerify` of the C# implementation: signed by one of the given identity keys, trusted
     * where trusted keys are given, of the same holder as the signing key, valid at `signedAt`. Returns that identity key.
     */
    public verify(identityKeys: readonly POIPublicKey[], trustedIdentityKeyIds?: ReadonlySet<string>): POIPublicKey {

        const identityKey = identityKeys.find(key => key.id === this.keyId);

        if (identityKey === undefined)
            throw new POIError(`The identity key '${this.keyId}' that certified the signing key '${this.signingKey.id}' is not given!`);

        if (trustedIdentityKeyIds !== undefined && !trustedIdentityKeyIds.has(this.keyId))
            throw new POIError(`The signing key '${this.signingKey.id}' is certified by the identity key '${this.keyId}', which is not trusted!`);

        if (identityKey.holderOrUnnamed !== this.signingKey.holderOrUnnamed)
            throw new POIError(`The signing key '${this.signingKey.id}' of ${describeHolder(this.signingKey)} is certified by the identity key '${this.keyId}' of ${describeHolder(identityKey)}: each holder certifies its own signing keys only!`);

        if (!identityKey.isValidAt(this.signedAt))
            throw new POIError(`The identity key '${this.keyId}' was not valid when it certified the signing key '${this.signingKey.id}'!`);

        try {
            verifySignature(this.algorithm, identityKey.key, this.signingBytes(), this.value);
        }
        catch (e) {
            throw new POIError(`The certificate of the signing key '${this.signingKey.id}' is invalid: ${e instanceof Error ? e.message : String(e)}`);
        }

        return identityKey;

    }

}
