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

import { mandatoryText, nonemptyText, onlyProperties, requireObject, timestampAt, toTimestamp, CONTEXT_PREFIX } from '../common.ts';
import { canonicalJSONBytes }    from '../json/canonical.ts';
import { get, isObject, without, type JSONObject, type JSONValue } from '../json/value.ts';
import { verifySignature }       from '../crypto/signature.ts';
import { POIPublicKey }          from '../keys.ts';
import { POIError }              from '../errors.ts';


export const SIGNING_KEY_CERTIFICATE_CONTEXT = CONTEXT_PREFIX + 'roamingNetwork/signingKeyCertificate/v2';

/** The holder of a key, as WWCP_POI3 names it (`HolderText`). */
const describeHolder = (key: POIPublicKey): string =>
    key.holder !== undefined ? `the holder '${key.holder}'` : 'no named holder';


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


    /**
     * Reads a certificate as `RoamingNetworkSigningKeyCertificate.TryParse` of WWCP_POI3 reads it, in its words and order:
     * its context, the roaming network operator, the signing key it certifies, `signedAt` as POI writes it, the algorithm,
     * key identification and value of its signature; then a property it does not know, which is not signed.
     */
    public static parse(value: JSONValue | undefined): SigningKeyCertificate {

        const json = requireObject(value, 'A certificate of a signing key');

        if (get(json, '@context') !== undefined && get(json, '@context') !== SIGNING_KEY_CERTIFICATE_CONTEXT)
            throw new POIError(`The JSON-LD context of a signing key certificate must be '${SIGNING_KEY_CERTIFICATE_CONTEXT}'!`);

        const roamingNetworkOperatorId = mandatoryText(json, 'roamingNetworkOperatorId', 'The roaming network operator of a certificate');

        let signingKey: POIPublicKey;

        try {
            signingKey = POIPublicKey.parse(isObject(json['signingKey']) ? json['signingKey'] : undefined);
        }
        catch {
            throw new POIError('A signing key certificate requires the signingKey it certifies!');
        }

        const signedAt = timestampAt(json, 'signedAt');

        if (signedAt === undefined)
            throw new POIError('The signedAt of a signing key certificate must be written as yyyy-MM-ddTHH:mm:ss.fffZ!');

        const algorithm  = nonemptyText(json, 'algorithm');
        const keyId      = nonemptyText(json, 'keyId');
        const signature  = nonemptyText(json, 'value');

        if (algorithm === undefined || keyId === undefined || signature === undefined)
            throw new POIError('A signing key certificate requires the algorithm, the key identification and the value of its signature!');

        onlyProperties(json, [ '@context', 'roamingNetworkOperatorId', 'signingKey', 'signedAt', 'algorithm', 'keyId', 'value' ], 'A certificate of a signing key');

        return new SigningKeyCertificate(roamingNetworkOperatorId, signingKey, signedAt, algorithm, keyId, signature, json);

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
