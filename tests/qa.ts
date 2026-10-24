import { AT, defined, readJSON, readText } from './helpers.ts';

import { TrustAnchor }        from '../src/proofs/trustAnchor.ts';
import { RoamingNetwork }     from '../src/network/roamingNetwork.ts';
import { Checkpoint }         from '../src/history/checkpoint.ts';
import type { HistoryOptions } from '../src/history/history.ts';
import { OperatorTrust }      from '../src/verifier/trust.ts';
import { parseTrustedWitnesses, verifyCheckpointSignatures, type TrustedWitness } from '../src/verifier/checkpoints.ts';
import type { JSONArray, JSONObject } from '../src/json/value.ts';


// What the examples of WWCP_POI publish of the roaming network QA, as a verifier reads it.


/** The trust anchor of QA as example A1 published it as a QR code, naming the identity keys of epoch 1. */
export const anchor       = TrustAnchor.parse(readText('published/QA-trustAnchor.txt'));

/** The trust anchor of QA after example A11 replaced its keys: the ML-DSA identity keys of epoch 2. */
export const anchorPQ     = TrustAnchor.parse(readText('published/QA-trustAnchor-mldsa.txt'));

/** The keys of the witnesses a verifier trusts by configuration, as example A6 made them, and as example A11 made them anew. */
export const witnesses    = parseTrustedWitnesses(readJSON('trusted/witnesses.json'));
export const witnessesPQ  = parseTrustedWitnesses(readJSON('trusted/witnesses-mldsa.json'));

/** The genesis of QA, revision 0 of epoch 1, as example A1 made it. */
export const genesis      = RoamingNetwork.parse((readJSON('published/QA-genesis.json') as JSONObject)['roamingNetwork']);

/** The trust in OCC from the trust anchor of epoch 1, as example A1 builds it: valid for every version up to revision 15. */
export const trust        = OperatorTrust.of(anchor, genesis, AT);

/** As example A4: commits signed as the roaming network operator by its quorum, checkpoints as well. */
export const byOperator: HistoryOptions = {
    verifyCommit:      commit     => { trust.verifyOperatorSignatures(commit.signatures, (signature, key) => { commit.verifySignature(signature, key); }, 'the commit'); },
    verifyCheckpoint:  checkpoint => { verifyCheckpointSignatures(checkpoint, trust); },
};

/** As example A6: and by both witnesses a verifier trusts. */
export const byOperatorAndWitnesses: HistoryOptions = {
    verifyCommit:      defined(byOperator.verifyCommit),
    verifyCheckpoint:  checkpoint => { verifyCheckpointSignatures(checkpoint, trust, { witnesses, requiredWitnesses: 2 }); },
};

/** The checkpoint of a sequence of epoch 1. */
export const checkpoint = (sequence: number): Checkpoint =>
    Checkpoint.parse(readJSON(`published/QA-checkpoint-${sequence}.json`));

export const commits = (file: string): JSONArray =>
    readJSON(file) as JSONArray;

/** Every commit of epoch 1 since its genesis, revisions 1 to 15, as the examples published them in parts. */
export const commitsOfEpoch1 = (): JSONArray => [
    ...commits('published/QA-commits-since-genesis.json'),
    ...commits('published/QA-commits-since-checkpoint-2.json'),
    ...commits('published/QA-commits-since-checkpoint-4.json'),
    ...commits('published/QA-commits-since-checkpoint-5.json'),
];


/**
 * A verifier following the history of QA from a version it trusts by a trust anchor (examples A6 and A11): each commit
 * signed as the roaming network operator by its quorum in the version before, the trust following the key statements the
 * commits change (8.6, *Succession*); each checkpoint signed by the operator and by the required trusted witnesses.
 */
export function following(trustAnchor: TrustAnchor, root: RoamingNetwork, trustedWitnesses: readonly TrustedWitness[] = [], requiredWitnesses = 0): HistoryOptions & { readonly trust: OperatorTrust } {

    let current = OperatorTrust.of(trustAnchor, root, AT);

    return {
        get trust(): OperatorTrust {
            return current;
        },
        verifyCommit: (commit, _before, after): void => {
            current.verifyOperatorSignatures(commit.signatures, (signature, key) => { commit.verifySignature(signature, key); }, 'the commit');
            current = current.followedBy(after, AT);
        },
        verifyCheckpoint: (checkpoint): void => {
            verifyCheckpointSignatures(checkpoint, current, { witnesses: trustedWitnesses, requiredWitnesses });
        },
    };

}
