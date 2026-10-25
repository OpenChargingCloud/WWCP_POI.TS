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

import { checkContext, onlyProperties, requireArray, requireInteger, requireObject, requireString, toTimestamp, timeOf, CONTEXT_PREFIX } from '../common.ts';
import { get, isArray, isObject, type JSONObject, type JSONValue } from '../json/value.ts';
import { bytesEqual, isLowerHex, toHex } from '../encoding/text.ts';
import { isHashAlgorithm, type HashAlgorithm } from '../crypto/hash.ts';
import { etagToText, type ETag }     from '../etags.ts';
import { prunedTree }                from '../network/tree.ts';
import { POIPublicKey, KeyUsages }   from '../keys.ts';
import { KeyStatement }              from './keyStatement.ts';
import { SigningKeyCertificate }     from './signingKeyCertificate.ts';
import { Attestation }               from './attestation.ts';
import type { TrustAnchor }          from './trustAnchor.ts';
import type { CheckpointProof }      from '../history/checkpoint.ts';
import { POIError, required as present } from '../errors.ts';


export const PROOF_CONTEXT = CONTEXT_PREFIX + 'roamingNetwork/proof/v1';


/** What a verified proof attests, and by whom. */
export interface VerifiedProof {
    /** The root the proof leads to: the `effectiveTree` ETag of its version. */
    readonly eTag:          ETag;
    /** The roaming network with what the proof gives completely; pruned arrays as they are. */
    readonly attested:      JSONObject;
    /** The attestations that count, valid and by trusted keys. */
    readonly attestations:  readonly Attestation[];
    /** The holders of the roaming network operator whose attestations count. */
    readonly attestedBy:    readonly string[];
    /** The key statement verified against the trust anchor. */
    readonly keyStatement:  KeyStatement;
}


/**
 * A proof of entities of a roaming network (SPECIFICATION.md section 8.4): the roaming network in its effective content,
 * pruned, with the attestations of its root. A charging station proof gives the station completely, with its EVSEs, the
 * charging tariffs they take, its pool and operator as skeletons and the roaming network with its operator and keys.
 */
export class ChargingStationProof {

    private constructor(
        public readonly hashAlgorithm:   HashAlgorithm,
        public readonly commitId:        string,
        public readonly revision:        number,
        public readonly roamingNetwork:  JSONObject,
        public readonly attestations:    readonly Attestation[],
        public readonly json:            JSONObject
    ) {}


    public static parse(value: JSONValue | undefined): ChargingStationProof {

        const json = requireObject(value, 'A proof');

        checkContext(json, PROOF_CONTEXT, 'a proof');
        onlyProperties(json, [ '@context', 'hashAlgorithm', 'commitId', 'revision', 'roamingNetwork', 'attestations' ], 'A proof');

        const hashAlgorithm = get(json, 'hashAlgorithm');

        if (!isHashAlgorithm(hashAlgorithm))
            throw new POIError('The hash algorithm of a proof is sha256, sha384 or sha512!');

        const commitId = requireString(json, 'commitId', 'The commit of a proof');

        if (!isLowerHex(commitId) || ![ 64, 96, 128 ].includes(commitId.length))
            throw new POIError('The commit of a proof is the identification of a commit!');

        return new ChargingStationProof(
                   hashAlgorithm,
                   commitId,
                   requireInteger(json, 'revision', 0, Number.MAX_SAFE_INTEGER, 'The revision of a proof'),
                   requireObject(get(json, 'roamingNetwork'), 'The roaming network of a proof'),
                   get(json, 'attestations') === undefined ? [] : requireArray(get(json, 'attestations'), 'The attestations of a proof').map(attestation => Attestation.parse(attestation)),
                   json
               );

    }


    /** The `effectiveTree` ETag the proof leads to, and what it gives completely (8.4). */
    public calculate(): { eTag: ETag, attested: JSONObject } {
        const tree = prunedTree(this.roamingNetwork, this.hashAlgorithm);
        return { eTag: { format: 'effectiveTree', algorithm: this.hashAlgorithm, digest: tree.root }, attested: tree.attested };
    }


    /**
     * Verifies the proof against a trust anchor (8.4 to 8.6), as `Verify(TrustAnchor)` of the C# implementation, stricter
     * where it is weak:
     *
     * - the proof is one of the roaming network of the trust anchor, and leads to a root;
     * - the key statement it gives is signed by trusted identity keys of as many holders as the trust anchor and the
     *   statement require, names this roaming network and operator, and is valid at `at`;
     * - attestations of the root, of this roaming network, commit and hash algorithm, valid at `at`, in the role of the
     *   roaming network operator, each by a signing key certified for this operator by a trusted identity key of its
     *   holder, valid when it attested and allowed to sign for the party, come from as many holders as required.
     *
     * Attestations of a subject (8.5) attest one entity, not the root: they do not count here.
     */
    public verify(anchor: TrustAnchor, at?: number | Date | string): VerifiedProof {

        const time        = timeOf(at);
        const networkId   = this.roamingNetwork['@id'];

        if (networkId !== anchor.id)
            throw new POIError(`The trust anchor is one of the roaming network '${anchor.id}'!`);

        const { eTag, attested } = this.calculate();

        const operator = get(this.roamingNetwork, 'operator');

        if (!isObject(operator))
            throw new POIError('The proof gives no roaming network operator!');

        const operatorId = requireString(operator, '@id', 'The identification of the roaming network operator');

        if (get(operator, 'keyStatement') === undefined)
            throw new POIError('The proof gives no key statement of the roaming network operator!');

        const keyStatement          = KeyStatement.parse(get(operator, 'keyStatement'));
        const operatorIdentityKeys  = POIPublicKey.parseAll(get(operator, 'identityKeys'), 'identity keys of the roaming network operator');
        const certificates          = isArray(get(operator, 'signingKeyCertificates'))
                                          ? (get(operator, 'signingKeyCertificates') as JSONValue[]).map(certificate => SigningKeyCertificate.parse(certificate))
                                          : [];

        if (keyStatement.roamingNetworkId !== networkId)
            throw new POIError(`The key statement is one of the roaming network '${keyStatement.roamingNetworkId}'!`);

        if (keyStatement.roamingNetworkOperatorId !== operatorId)
            throw new POIError(`The key statement is one of the roaming network operator '${keyStatement.roamingNetworkOperatorId}', not of '${operatorId}'!`);

        // A key statement trusted names identity keys to trust, e.g. those replacing pinned ones, with their holders, which
        // it must name as the trust anchor does.
        const { holderOf }  = keyStatement.verifyHolders(anchor.holders, operatorIdentityKeys, { minConsensus: anchor.minConsensus, at: time });
        const identityKeys  = [ ...keyStatement.identityKeys, ...operatorIdentityKeys ];
        const trustedIds    = new Set(holderOf.keys());
        const required      = Math.max(anchor.minConsensus, keyStatement.minConsensus);

        // The signing key of an attestation, certified by a trusted identity key of its holder, and that holder as the
        // verifier knows it, never as the signing key names itself.
        const certifiedSigningKeyOf = (attestation: Attestation): { key: POIPublicKey, holder: string } | undefined => {

            for (const certificate of certificates) {

                if (certificate.signingKey.id !== attestation.keyId              ||
                    certificate.roamingNetworkOperatorId !== operatorId          ||
                    !certificate.signingKey.isValidAt(attestation.signedAt)      ||
                    !certificate.signingKey.maySign(KeyUsages.Party))
                    continue;

                try {
                    certificate.verify(identityKeys, trustedIds);
                    return { key: certificate.signingKey, holder: present(holderOf.get(certificate.keyId), 'The holder of a trusted identity key') };
                }
                catch {
                    continue;
                }

            }

            return undefined;

        };

        const counted:  Attestation[] = [];
        const holders   = new Set<string>();
        const refused:  string[] = [];

        for (const attestation of this.attestations) {

            if (attestation.roamingNetworkId !== networkId     ||
                attestation.commitId         !== this.commitId ||
                attestation.revision         !== this.revision ||
                attestation.eTag.algorithm   !== this.hashAlgorithm)
                continue;

            if (attestation.subject !== undefined || !bytesEqual(attestation.eTag.digest, eTag.digest)) {
                refused.push(`an attestation by '${attestation.keyId}' attests ${attestation.subject !== undefined ? 'a subject' : 'another root'}`);
                continue;
            }

            if (!attestation.isValidAt(time)) {
                refused.push(`the attestation by '${attestation.keyId}' is not valid at ${toTimestamp(time)}`);
                continue;
            }

            if (attestation.role !== 'roamingNetworkOperator') {
                refused.push(`the attestation by '${attestation.keyId}' is in the role '${attestation.role}'`);
                continue;
            }

            const certified = certifiedSigningKeyOf(attestation);

            if (certified === undefined) {
                refused.push(`the key '${attestation.keyId}' is no signing key a trusted identity key of its holder certifies`);
                continue;
            }

            try {
                attestation.verifySignature(certified.key);
            }
            catch (e) {
                refused.push(`the attestation by '${attestation.keyId}' is invalid: ${e instanceof Error ? e.message : String(e)}`);
                continue;
            }

            counted.push(attestation);
            holders.add(certified.holder);

        }

        if (holders.size < required)
            throw new POIError(`Valid attestations of trusted keys of ${holders.size} holder${holders.size === 1 ? '' : 's'} attest the root ${etagToText(eTag)} of the proof, not of ${required}!` +
                               (refused.length > 0 ? ` (${refused.join('; ')})` : ''));

        return { eTag, attested, attestations: counted, attestedBy: [ ...holders ].sort(), keyStatement };

    }


    /**
     * Verifies the proof against the proof of its commit in a checkpoint (10.4), without an attestation: the root of the
     * proof is the leaf's `effectiveTree` ETag of the hash algorithm of the proof. The checkpoint, its signatures and the
     * proof of the commit are the caller's to verify.
     */
    public verifyAgainstCommitProof(commitProof: CheckpointProof): { eTag: ETag, attested: JSONObject } {

        const calculated = this.calculate();

        if (commitProof.commitId !== this.commitId || commitProof.revision !== this.revision)
            throw new POIError(`The proof of the commit is one of '${commitProof.commitId}', not of '${this.commitId}'!`);

        const leafETag = commitProof.eTags.find(eTag => eTag.format === 'effectiveTree' && eTag.algorithm === this.hashAlgorithm);

        if (leafETag === undefined || !bytesEqual(leafETag.digest, calculated.eTag.digest))
            throw new POIError(leafETag === undefined
                                   ? `The commit names no effectiveTree ETag of ${this.hashAlgorithm}, the hash algorithm of the proof!`
                                   : `The proof leads to ${etagToText(calculated.eTag)}, not to ${etagToText(leafETag)}!`);

        return calculated;

    }

}

export { toHex };
