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

import { firstText, timeOf }           from '../common.ts';
import { get, isObject, sameValue, type JSONValue } from '../json/value.ts';
import { KeyUsages, type KeyUsage, type POIPublicKey } from '../keys.ts';
import { SignatureRoles, type RoleSignature } from '../history/commit.ts';
import { RoamingNetworkOperator, type RoamingNetwork } from '../network/roamingNetwork.ts';
import type { KeyStatement }            from '../proofs/keyStatement.ts';
import type { TrustAnchor }             from '../proofs/trustAnchor.ts';
import { POIError }                     from '../errors.ts';


/**
 * The trust a verifier has in the roaming network operator of a version, from a trust anchor it pinned (SPECIFICATION.md
 * section 8.6), as example A1 builds it: the key statement the version embeds is signed by trusted identity keys of as
 * many holders as the trust anchor and the statement require and valid now; then the identity keys it names are trusted
 * as well, and a signing key of the operator is trusted where a trusted identity key of its holder certifies it.
 */
export class OperatorTrust {

    private constructor(
        public readonly anchor:             TrustAnchor,
        public readonly operator:           RoamingNetworkOperator,
        public readonly keyStatement:       KeyStatement,
        /** The `@id`s of the identity keys of the trust anchor and of the verified key statement. */
        public readonly trustedIdentityKeyIds: ReadonlySet<string>,
        /** The holders whose trusted identity keys signed the key statement. */
        public readonly statementSignedBy:  ReadonlySet<string>
    ) {}


    /** The number of holders of the roaming network operator a signature must come from: the larger quorum. */
    public get requiredConsensus(): number {
        return Math.max(this.anchor.minConsensus, this.keyStatement.minConsensus);
    }


    /**
     * Verifies the key statement of the operator of the given version against the trust anchor (A1 step e) and returns the
     * trust in its keys. `at` is when the statement must be valid, now by default.
     */
    public static of(anchor: TrustAnchor, network: RoamingNetwork, at?: number | Date | string): OperatorTrust {

        if (network.id !== anchor.id)
            throw new POIError('this is not the roaming network of the trust anchor');

        return OperatorTrust.ofOperator(anchor, network.operator, at);

    }

    /**
     * The same from the roaming network operator alone, e.g. as a proof of a charging station gives it (8.4): its key
     * statement verified against the trust anchor at `at`.
     */
    public static fromOperatorJSON(anchor: TrustAnchor, operatorJSON: JSONValue | undefined, at?: number | Date | string): OperatorTrust {
        return OperatorTrust.ofOperator(anchor, operatorJSON === undefined ? undefined : RoamingNetworkOperator.parse(operatorJSON, anchor.id), at);
    }

    /**
     * The trust in the operator of a later version of a history this trust follows (8.6, *Succession*): its key statement
     * signed by identity keys trusted here, of as many holders as required, e.g. after the operator stated new keys signed
     * by its old ones, as before a new epoch (example A11). Its own identity keys are then trusted, those it dropped not.
     * Only for a version the history took commit by commit, each signed by the owners of its changes in the version before.
     */
    public followedBy(network: RoamingNetwork, at?: number | Date | string): OperatorTrust {

        const operator   = network.operator;
        const statement  = operator?.keyStatement;

        if (network.id !== this.anchor.id)
            throw new POIError('this is not the roaming network of the trust anchor');

        if (operator === undefined || statement === undefined)
            throw new POIError('the roaming network operator states no keys');

        if (sameValue(statement.json, this.keyStatement.json))
            return new OperatorTrust(this.anchor, operator, statement, this.trustedIdentityKeyIds, this.statementSignedBy);

        const signedBy = statement.verify(this.trustedIdentityKeyIds, operator.identityKeys, { minConsensus: this.requiredConsensus, at: timeOf(at) });

        return new OperatorTrust(this.anchor,
                                 operator,
                                 statement,
                                 new Set([ ...this.anchor.keys, ...statement.identityKeys.map(key => key.id) ]),
                                 signedBy);

    }

    private static ofOperator(anchor: TrustAnchor, operator: RoamingNetworkOperator | undefined, at?: number | Date | string): OperatorTrust {

        const statement  = operator?.keyStatement;

        if (operator === undefined || statement === undefined)
            throw new POIError('the roaming network operator states no keys');

        const signedBy = statement.verify(anchor.keys, operator.identityKeys, { minConsensus: anchor.minConsensus, at: timeOf(at) });

        return new OperatorTrust(anchor,
                                 operator,
                                 statement,
                                 new Set([ ...anchor.keys, ...statement.identityKeys.map(key => key.id) ]),
                                 signedBy);

    }


    /**
     * The signing key of the roaming network operator a signature names, as example A1 checks those of a commit: in the
     * role of the roaming network operator, certified by a trusted identity key of its holder, valid when it signed, and one
     * that may sign the given usage, the `party` by default. Undefined unless all of that holds.
     */
    public signingKeyOf(signature: RoleSignature, usage: KeyUsage = KeyUsages.Party): POIPublicKey | undefined {

        if (signature.role !== SignatureRoles.RoamingNetworkOperator)
            return undefined;

        const identityPool = [ ...this.keyStatement.identityKeys, ...this.operator.identityKeys ];

        for (const certificate of this.operator.signingKeyCertificates) {

            if (certificate.signingKey.id !== signature.keyId     ||
                !certificate.signingKey.isValidAt(signature.signedAt) ||
                !certificate.signingKey.maySign(usage))
                continue;

            try {
                certificate.verify(identityPool, this.trustedIdentityKeyIds);
                return certificate.signingKey;
            }
            catch {
                continue;
            }

        }

        return undefined;

    }


    /**
     * Verifies the signatures in the role of the roaming network operator (A1 step f), each by a trusted signing key, and
     * that they come from as many holders as required. Returns the holders.
     */
    public verifyOperatorSignatures(signatures: readonly RoleSignature[],
                                    verify:     (signature: RoleSignature, key: POIPublicKey) => void,
                                    what:       string): Set<string> {

        const signedBy = new Set<string>();

        for (const signature of signatures.filter(signature => signature.role === SignatureRoles.RoamingNetworkOperator)) {

            const key = this.signingKeyOf(signature);

            if (key === undefined)
                throw new POIError(`the key '${signature.keyId}' is no signing key a trusted identity key of its holder certifies`);

            verify(signature, key);
            signedBy.add(key.holderOrUnnamed);

        }

        if (signedBy.size < this.requiredConsensus)
            throw new POIError(`${what} is signed by ${signedBy.size} holder(s) of the roaming network operator only`);

        return signedBy;

    }


    /**
     * Warnings where the trust anchor names the network otherwise than the verified version (A1 step g): the texts of a
     * QR code are not trusted, those of the verified version are what to show.
     */
    public textWarnings(network: RoamingNetwork): string[] {

        const warnings: string[] = [];

        for (const [kind, shown, checked] of [ [ 'name', this.anchor.name, network.name ], [ 'description', this.anchor.description, network.description ] ] as const)
            for (const [language, text] of Object.entries(shown))
                if (!isObject(checked) || get(checked, language) !== text)
                    warnings.push(`the QR code shows the ${kind} '${text}' (${language}), not the one of the network!`);

        return warnings;

    }

    /** The name of the operator, which the signatures cover. */
    public get operatorName(): string | undefined {
        return firstText(get(this.operator.json, 'name'));
    }

}
