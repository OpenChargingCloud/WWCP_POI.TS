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
import { prunedTree, skeleton }      from '../network/tree.ts';
import type { RoamingNetwork }       from '../network/roamingNetwork.ts';
import { POIPublicKey, KeyUsages }   from '../keys.ts';
import { KeyStatement }              from './keyStatement.ts';
import { SigningKeyCertificate }     from './signingKeyCertificate.ts';
import { Attestation }               from './attestation.ts';
import { TrustContext } from './trustContext.ts';
import type { TrustAnchor }          from './trustAnchor.ts';
import type { Checkpoint, CheckpointProof } from '../history/checkpoint.ts';
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

/** The signing keys of the roaming network operator of a proof, as a verifier trusting a trust anchor finds them. */
interface CertifiedSigningKeys {
    /** The key statement verified against the trust anchor. */
    readonly keyStatement:  KeyStatement;
    /** How many holders must sign: the larger quorum of the trust anchor and the key statement. */
    readonly required:      number;
    /**
     * The signing key a signature names by its key and the time it was signed, certified by a trusted identity key of its
     * holder, valid then and at the time verified, and allowed to sign for the party; with that holder as the verifier
     * knows it, never as the signing key names itself. Undefined unless all of that holds.
     */
    readonly signingKeyOf:  (keyId: string, signedAt: number) => { key: POIPublicKey, holder: string } | undefined;
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

    /**
     * The proof of the root of a version alone (8.4), as `RootProof` of the C# implementation makes it: the roaming network
     * in its effective content, with its own properties, its operator and its keys, every child array pruned, for the given
     * attestations of its commit, e.g. those of a snapshot of the head (8.5, 10.5).
     */
    public static ofRoot(network: RoamingNetwork, commit: { readonly id: string, readonly revision: number }, hashAlgorithm: HashAlgorithm, attestations: readonly Attestation[] = []): ChargingStationProof {

        const roamingNetwork  = skeleton(network.effectiveContent, 'roamingNetwork', hashAlgorithm);
        const json: JSONObject = { '@context': PROOF_CONTEXT, hashAlgorithm, commitId: commit.id, revision: commit.revision, roamingNetwork };

        if (attestations.length > 0)
            json['attestations'] = attestations.map(attestation => attestation.json);

        return new ChargingStationProof(hashAlgorithm, commit.id, commit.revision, roamingNetwork, attestations, json);

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
     *   holder, valid when it attested and at `at`, and allowed to sign for the party, come from as many holders as
     *   required.
     *
     * Attestations of a subject (8.5) attest one entity, not the root: they do not count here.
     */
    public verify(basis: TrustAnchor | TrustContext, at?: number | Date | string): VerifiedProof {

        const anchor      = basis instanceof TrustContext ? basis.authorizedAnchor : basis;
        const time        = basis instanceof TrustContext ? basis.evaluationTime(at) : timeOf(at);
        const networkId   = this.roamingNetwork['@id'];

        if (networkId !== anchor.id)
            throw new POIError(`The trust anchor is one of the roaming network '${anchor.id}'!`);

        const { eTag, attested } = this.calculate();

        const { keyStatement, required, signingKeyOf } = this.certifiedSigningKeys(basis, time);

        // Valid when it attested and at `at`: the signedAt of an attestation is the choice of its signer.
        const certifiedSigningKeyOf = (attestation: Attestation): { key: POIPublicKey, holder: string } | undefined =>
            signingKeyOf(attestation.keyId, attestation.signedAt);

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
                refused.push(`the key '${attestation.keyId}' is no signing key a trusted identity key of its holder certifies, valid at ${toTimestamp(attestation.signedAt)}, when it attested, and at ${toTimestamp(time)}, that may sign for the party`);
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
     * Verifies a checkpoint against a trust anchor with this proof of the version of its commit (10.5), as
     * `Verify(Checkpoint, TrustAnchor)` of the C# implementation, e.g. with the proof of the root of the snapshot of the
     * checkpoint a history starts from: the proof leads to the `effectiveTree` ETag of its hash algorithm the checkpoint
     * names, and the checkpoint is signed in the role of the roaming network operator by signing keys of as many holders as
     * the trust anchor and the key statement require, each certified by a trusted identity key of its holder, valid when it
     * signed and at `at`, and allowed to sign for the party, as attestations are verified. Signatures that do not count are
     * ignored, not refused; the other signatures, e.g. of witnesses, are not checked here. Returns the holders that signed.
     */
    public verifyCheckpoint(checkpoint: Checkpoint, basis: TrustAnchor | TrustContext, at?: number | Date | string): string[] {

        const anchor = basis instanceof TrustContext ? basis.authorizedAnchor : basis;
        const time = basis instanceof TrustContext ? basis.evaluationTime(at) : timeOf(at);

        if (this.roamingNetwork['@id'] !== anchor.id || checkpoint.roamingNetworkId !== anchor.id)
            throw new POIError(`The trust anchor is one of the roaming network '${anchor.id}'!`);

        if (checkpoint.commitId !== this.commitId)
            throw new POIError(`The checkpoint '${checkpoint.id}' is one of the commit '${checkpoint.commitId}', not of '${this.commitId}'!`);

        const named = checkpoint.eTags.find(eTag => eTag.format === 'effectiveTree' && eTag.algorithm === this.hashAlgorithm);

        if (named === undefined)
            throw new POIError(`The checkpoint '${checkpoint.id}' names no effectiveTree ETag of ${this.hashAlgorithm}!`);

        const { eTag } = this.calculate();

        if (!bytesEqual(eTag.digest, named.digest))
            throw new POIError(`The proof leads to ${etagToText(eTag)}, not to ${etagToText(named)}!`);

        const { required, signingKeyOf } = this.certifiedSigningKeys(basis, time);
        const holders = new Set<string>();

        for (const signature of checkpoint.signatures) {

            const certified = signature.role === 'roamingNetworkOperator' ? signingKeyOf(signature.keyId, signature.signedAt) : undefined;

            if (certified === undefined)
                continue;

            try {
                checkpoint.verifySignature(signature, certified.key);
                holders.add(certified.holder);
            }
            catch {
                continue;
            }

        }

        if (holders.size < required)
            throw new POIError(`Valid signatures of trusted keys of ${holders.size} holder${holders.size === 1 ? '' : 's'} sign the checkpoint '${checkpoint.id}' as its roaming network operator, not of ${required}!`);

        return [ ...holders ].sort();

    }


    /**
     * The signing keys of the roaming network operator the proof gives, as a verifier trusting the trust anchor finds them
     * (4.1, 8.5, 8.6), as `TryGetCertifiedSigningKeys` of the C# implementation: the key statement of the operator is signed
     * by trusted identity keys of as many holders as the trust anchor and the statement require, names this roaming network
     * and operator and their holders as the trust anchor does, and is valid at `time`; its identity keys are trusted then
     * as well. A signing key counts where a trusted identity key of its holder certifies it for this operator.
     */
    private certifiedSigningKeys(basis: TrustAnchor | TrustContext, time: number): CertifiedSigningKeys {

        const anchor = basis instanceof TrustContext ? basis.authorizedAnchor : basis;
        const networkId = this.roamingNetwork['@id'];
        const operator  = get(this.roamingNetwork, 'operator');

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
        const { holderOf }  = basis instanceof TrustContext
            ? basis.verifyStatement(keyStatement, operatorIdentityKeys, time)
            : keyStatement.verifyHolders(anchor.holders, operatorIdentityKeys, { minConsensus: anchor.minConsensus, at: time });
        const identityKeys  = [ ...keyStatement.identityKeys, ...operatorIdentityKeys ];
        const trustedIds    = new Set(holderOf.keys());

        const signingKeyOf = (keyId: string, signedAt: number): { key: POIPublicKey, holder: string } | undefined => {

            for (const certificate of certificates) {

                if (certificate.signingKey.id !== keyId                          ||
                    certificate.roamingNetworkOperatorId !== operatorId          ||
                    !certificate.signingKey.isValidAt(signedAt)                  ||
                    !certificate.signingKey.isValidAt(time)                      ||
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

        return { keyStatement, required: Math.max(anchor.minConsensus, keyStatement.minConsensus), signingKeyOf };

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
