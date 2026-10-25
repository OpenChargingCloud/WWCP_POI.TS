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

import { requireArray, requireObject, requireString } from '../common.ts';
import { get, type JSONValue }             from '../json/value.ts';
import { POIPublicKey }                    from '../keys.ts';
import { SignatureRoles }                  from '../history/commit.ts';
import type { Checkpoint }                 from '../history/checkpoint.ts';
import type { OperatorTrust }              from './trust.ts';
import { POIError }                        from '../errors.ts';


/** A witness a verifier trusts, with its key: trusted independently of the network (10.2), e.g. by configuration. */
export interface TrustedWitness {
    readonly witness:  string;
    readonly key:      POIPublicKey;
}

/** Reads trusted witnesses, `[ { "witness": "…", "key": { "@id", "key" } }, … ]`, as example A6 publishes them. */
export function parseTrustedWitnesses(value: JSONValue): TrustedWitness[] {
    return requireArray(value, 'The trusted witnesses').map(item => {
        const json = requireObject(item, 'A trusted witness');
        return { witness: requireString(json, 'witness'), key: POIPublicKey.parse(get(json, 'key'), 'The key of a witness') };
    });
}


/** Who signed a checkpoint, of those a verifier trusts. */
export interface CheckpointSignatures {
    /** The holders of the roaming network operator whose trusted signing keys signed it. */
    readonly signedBy:      readonly string[];
    /** The trusted witnesses that signed it, each with its own key. */
    readonly witnessedBy:   readonly string[];
    /** Signatures that did not count: by untrusted keys, in another role, or invalid. */
    readonly ignored:       readonly string[];
}


/**
 * Verifies the signatures of a checkpoint a verifier requires (10.2): as the roaming network operator, by its trusted
 * signing keys of as many holders as its quorum requires; as witnesses, by the keys trusted for them, at least
 * `requiredWitnesses` of them. A signature in the role of a witness counts only by the key trusted for the witness it names;
 * signatures by keys the verifier does not trust are ignored, not refused, so that nobody blocks a checkpoint by adding one.
 */
export function verifyCheckpointSignatures(checkpoint:  Checkpoint,
                                           trust:       OperatorTrust,
                                           options:     { witnesses?: readonly TrustedWitness[], requiredWitnesses?: number } = {}): CheckpointSignatures {

    if (checkpoint.roamingNetworkId !== trust.anchor.id)
        throw new POIError(`the checkpoint is one of '${checkpoint.roamingNetworkId}'`);

    const signedBy     = new Set<string>();
    const witnessedBy  = new Set<string>();
    const ignored:     string[] = [];

    for (const signature of checkpoint.signatures) {

        if (signature.role === SignatureRoles.RoamingNetworkOperator) {

            // Counted for the holder of the trusted identity key that certified the key, as the trust knows it.
            const key     = trust.signingKeyOf(signature);
            const holder  = trust.holderOf(signature);

            if (key === undefined || holder === undefined) {
                ignored.push(`the key '${signature.keyId}' is no signing key a trusted identity key of its holder certifies`);
                continue;
            }

            try {
                checkpoint.verifySignature(signature, key);
                signedBy.add(holder);
            }
            catch (e) {
                ignored.push(`the signature by '${signature.keyId}' is invalid: ${e instanceof Error ? e.message : String(e)}`);
            }

            continue;

        }

        if (signature.role === SignatureRoles.Witness) {

            const witness = (options.witnesses ?? []).find(item => item.witness === signature.signer && item.key.id === signature.keyId);

            if (witness === undefined) {
                ignored.push(`the witness '${signature.signer ?? ''}' with the key '${signature.keyId}' is not trusted here`);
                continue;
            }

            try {
                checkpoint.verifySignature(signature, witness.key);
                witnessedBy.add(witness.witness);
            }
            catch (e) {
                ignored.push(`the signature of the witness '${witness.witness}' is invalid: ${e instanceof Error ? e.message : String(e)}`);
            }

            continue;

        }

        ignored.push(`a signature in the role '${signature.role}'`);

    }

    if (signedBy.size < trust.requiredConsensus)
        throw new POIError(`the checkpoint is signed by ${signedBy.size} holder(s) of the roaming network operator only`);

    if (witnessedBy.size < (options.requiredWitnesses ?? 0))
        throw new POIError(`The checkpoint '${checkpoint.id}' is signed by ${witnessedBy.size} of the trusted witnesses, not by ${options.requiredWitnesses}!`);

    return { signedBy: [ ...signedBy ].sort(), witnessedBy: [ ...witnessedBy ], ignored };

}


/** Verifies a line of checkpoints (10.1): each of the same roaming network and epoch, one sequence more, naming the one before. */
export function verifyCheckpointLine(checkpoints: readonly Checkpoint[]): void {

    checkpoints.forEach((checkpoint, index) => {

        const before = checkpoints[index - 1];

        if (before === undefined)
            return;

        if (checkpoint.roamingNetworkId !== before.roamingNetworkId || checkpoint.epoch !== before.epoch)
            throw new POIError(`The checkpoint '${checkpoint.id}' is one of another roaming network or epoch!`);

        if (checkpoint.sequence !== before.sequence + 1 || checkpoint.previousId !== before.id)
            throw new POIError(`The checkpoint '${checkpoint.id}' does not follow the checkpoint '${before.id}'!`);

        if (checkpoint.revision <= before.revision)
            throw new POIError(`The checkpoint '${checkpoint.id}' is of an earlier revision than the one before!`);

    });

}
