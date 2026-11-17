import { AT, defined, readJSON, readText } from './helpers.ts';

import { TrustAnchor }        from '../src/proofs/trustAnchor.ts';
import { RoamingNetwork }     from '../src/network/roamingNetwork.ts';
import { Checkpoint }         from '../src/history/checkpoint.ts';
import type { HistoryOptions, SnapshotOptions } from '../src/history/history.ts';
import { OperatorTrust }      from '../src/verifier/trust.ts';
import { parseTrustedWitnesses, verifyCheckpointSignatures, type TrustedWitness } from '../src/verifier/checkpoints.ts';
import { sameValue, type JSONArray, type JSONObject } from '../src/json/value.ts';


// What the examples of WWCP_POI publish of the roaming network QA, as a verifier reads it.


/** The trust anchor of QA as example A1 published it as a QR code, naming the identity keys of epoch 1: of its three holders, two decide. */
export const anchor       = TrustAnchor.parse(readText('published/QA-trustAnchor.txt'));

/** The trust anchor of QA as it was when QA began, with AlphaOrg alone, as example A1 published it at revision 0. */
export const anchor0      = TrustAnchor.parse(readText('published/QA-trustAnchor-revision0.txt'));

/** The trust anchor of QA after example A11 replaced its keys: the ML-DSA identity keys of epoch 2. */
export const anchorPQ     = TrustAnchor.parse(readText('published/QA-trustAnchor-mldsa.txt'));

/** The keys of the witnesses a verifier trusts by configuration, as example A6 made them, and as example A11 made them anew. */
export const witnesses    = parseTrustedWitnesses(readJSON('trusted/witnesses.json'));
export const witnessesPQ  = parseTrustedWitnesses(readJSON('trusted/witnesses-mldsa.json'));

/** The genesis of QA, revision 0 of epoch 1, as example A1 made it. */
export const genesis      = RoamingNetwork.parse((readJSON('published/QA-genesis.json') as JSONObject)['roamingNetwork']);

/** The revisions 1 and 2 of QA, as example A1 made them: BetaOrg joined AlphaOrg, two of two, then GammaOrg, two of three. */
export const revision1    = RoamingNetwork.parse(readJSON('published/QA-revision1.json'));
export const revision2    = RoamingNetwork.parse(readJSON('published/QA-revision2.json'));

/** The trust in OCC from the trust anchor of epoch 1, as example A1 builds it: valid for every version from revision 2 up to revision 17. */
export const trust        = OperatorTrust.of(anchor, revision2, AT);

/** The trust in OCC while AlphaOrg held its keys alone, from the trust anchor of revision 0, and after BetaOrg joined, following it. */
export const trust0       = OperatorTrust.of(anchor0, genesis, AT);
export const trust1       = trust0.followedBy(revision1, AT);

/** The trust in OCC as the given version states its keys: of the revisions 0 and 1, of those since. */
export const trustIn = (network: RoamingNetwork): OperatorTrust =>
    [ trust0, trust1 ].find(known => sameValue(known.keyStatement.json, network.operator?.keyStatement?.json)) ?? trust;

/** As example A4: commits signed as the roaming network operator by its quorum, as their version states its keys, checkpoints as well. */
export const byOperator: HistoryOptions = {
    verifyCommit:      (commit, _before, after) => { trustIn(after).verifyOperatorSignatures(commit.signatures, (signature, key) => { commit.verifySignature(signature, key); }, 'the commit'); },
    verifyCheckpoint:  checkpoint => verifyCheckpointSignatures(checkpoint, trust).verified,
};

/** As example A6: and by both witnesses a verifier trusts. */
export const byOperatorAndWitnesses: HistoryOptions = {
    verifyCommit:      defined(byOperator.verifyCommit),
    verifyCheckpoint:  checkpoint => verifyCheckpointSignatures(checkpoint, trust, { witnesses, requiredWitnesses: 2 }).verified,
};

/** A snapshot of a checkpoint started from as the given options check it, anchored in the given trust anchor at AT (10.5). */
export const anchoredIn = (trustAnchor: TrustAnchor, options: HistoryOptions): SnapshotOptions =>
    ({ ...options, trustAnchor, at: AT });

/**
 * A genesis started from as the given options check it, not anchored (10.5): its key statement is verified against the
 * trust anchor by the trust the options follow, as example A1 does, and every commit since by the operator's signatures.
 */
export const fromGenesis = (options: HistoryOptions): SnapshotOptions =>
    ({ ...options, unanchored: true });

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
 * signed as the roaming network operator by its quorum in the version before or, where its holders changed, e.g. as
 * BetaOrg joined AlphaOrg (example A1), in its own version, the trust following the key statements the commits change
 * (8.6, *Succession*); each checkpoint signed by the operator and by the required trusted witnesses.
 */
export function following(trustAnchor: TrustAnchor, root: RoamingNetwork, trustedWitnesses: readonly TrustedWitness[] = [], requiredWitnesses = 0): HistoryOptions & { readonly trust: OperatorTrust } {

    let current = OperatorTrust.of(trustAnchor, root, AT);

    return {
        get trust(): OperatorTrust {
            return current;
        },
        verifyCommit: (commit, _before, after): void => {
            const next     = current.followedBy(after, AT);
            const signedBy = (trusted: OperatorTrust): unknown =>
                trusted.verifyOperatorSignatures(commit.signatures, (signature, key) => { commit.verifySignature(signature, key); }, 'the commit');
            try {
                signedBy(current);
            }
            catch (e) {
                if (next === current)
                    throw e;
                signedBy(next);
            }
            current = next;
        },
        verifyCheckpoint: checkpoint =>
            verifyCheckpointSignatures(checkpoint, current, { witnesses: trustedWitnesses, requiredWitnesses }).verified,
    };

}
