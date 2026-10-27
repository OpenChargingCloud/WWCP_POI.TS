import { describe, expect, it } from 'vitest';

import { AT, defined, readJSON, UNCHECKED } from './helpers.ts';
import { anchor, anchorPQ, byOperator, commits } from './qa.ts';

import { RoamingNetwork }     from '../src/network/roamingNetwork.ts';
import { History, type HistoryOptions } from '../src/history/history.ts';
import { OperatorTrust }      from '../src/verifier/trust.ts';
import { clone, type JSONObject, type JSONValue } from '../src/json/value.ts';


// Starting from a snapshot of another server (SPECIFICATION.md 10.5, *Anchored*), as the peer of WWCP_POI ff2c56f starts:
// only anchored in the trust anchor of the roaming network, fail closed. A snapshot of the head by the attestations it
// carries (8.5), a snapshot of a checkpoint by the checkpoint, signed as the roaming network operator. And signatures it
// cannot check are not taken unchecked (WWCPPOIConformanceTests O3).


// The head of QA, revision 7 of epoch 2, as a snapshot of the head carries it since WWCP_POI ff2c56f: with the attestations
// MakeProofs made of it at AT, valid for 15 minutes, by the three holders of the roaming network operator.
const network       = readJSON('published/QA.json') as JSONObject;
const attestations  = readJSON('proofs/QA-epoch-2-attestations.json') as JSONObject[];
const ofHead = (more: JSONObject = {}): JSONObject => ({
    timestamp:       AT,
    commit:          readJSON('published/QA-commit.json'),
    roamingNetwork:  network,
    epoch:           defined((readJSON('published/QA-live-snapshot.json') as JSONObject)['epoch']),
    attestations,
    ...more,
});

/** As example A11 checks the commits of epoch 2: signed as the roaming network operator by its quorum. */
const trustPQ       = OperatorTrust.of(anchorPQ, RoamingNetwork.parse(network), AT);
const byOperatorPQ: HistoryOptions = {
    verifyCommit: commit => { trustPQ.verifyOperatorSignatures(commit.signatures, (signature, key) => { commit.verifySignature(signature, key); }, 'the commit'); },
};

const anchoredPQ    = { ...byOperatorPQ, trustAnchor: anchorPQ, at: AT };
const headId        = '57c1b756c7a2';

/** The attestations of the head changed as given. */
const changed = (change: (attestation: JSONObject) => void, which = attestations.length): JSONObject[] =>
    attestations.map((attestation, index) => {
        const copy = clone(attestation);
        if (index < which)
            change(copy);
        return copy;
    });


describe('A snapshot of the head', () => {

    it('is taken anchored in the trust anchor by the attestations of its head', () => {

        const history = History.fromSnapshot(ofHead(), anchoredPQ);

        expect(history.epoch.number).toBe(2);
        expect(history.head.commit.revision).toBe(7);
        expect(history.head.commit.id.startsWith(headId)).toBe(true);

        // Valid until 15 minutes after AT, by every holder.
        expect(History.fromSnapshot(ofHead(), { ...anchoredPQ, at: '2026-10-26T01:13:00.000Z' }).head.commit.revision).toBe(7);

    });

    it('is not taken without a trust anchor, unless taken unanchored explicitly: fail closed', () => {

        expect(() => History.fromSnapshot(ofHead(), byOperatorPQ))
            .toThrow('Without the trust anchor of the roaming network (trustAnchor) no history starts from a snapshot, unless it is taken unanchored explicitly (unanchored)!');

        expect(() => History.fromSnapshot(ofHead(), { ...anchoredPQ, unanchored: true }))
            .toThrow('A snapshot is taken anchored in a trust anchor, or unanchored, not both!');

        expect(History.fromSnapshot(ofHead(), { ...byOperatorPQ, unanchored: true }).head.commit.revision).toBe(7);

    });

    it('is refused without attestations of its head, or with one it cannot read', () => {

        const without = ofHead();
        delete without['attestations'];

        expect(() => History.fromSnapshot(without, anchoredPQ))
            .toThrow(/^The snapshot is not anchored in the trust anchor of the roaming network 'QA': No attestation of the head '57c1b756c7a2[0-9a-f]+' of the roaming network 'QA' is given!$/);

        expect(() => History.fromSnapshot(ofHead({ attestations: [] }), anchoredPQ))
            .toThrow("No attestation of the head '57c1b756c7a2");

        // Every attestation read as POI reads it: one it cannot read is refused, not left out.
        expect(() => History.fromSnapshot(ofHead({ attestations: [ ...attestations, { ...defined(attestations[0]), validUntil: '2026-10-28T00:58:00.000Z' } ] }), anchoredPQ))
            .toThrow('Invalid attestation of the snapshot: An attestation is valid for 24 hours at most');

        expect(() => History.fromSnapshot(ofHead({ attestations: {} }), anchoredPQ))
            .toThrow('The attestations of a snapshot');

    });

    it('is refused when its attestations are not valid at the time it is checked', () => {

        expect(() => History.fromSnapshot(ofHead(), { ...anchoredPQ, at: '2026-10-26T01:13:00.001Z' }))
            .toThrow(/Valid attestations of trusted keys of 0 holders attest the root effectiveTree:sha256:hex:[0-9a-f]+ of the proof, not of 2! \(the attestation by '[0-9a-f]+' is not valid at 2026-10-26T01:13:00.001Z;/);

        expect(() => History.fromSnapshot(ofHead(), { ...anchoredPQ, at: '2026-10-26T00:57:59.999Z' }))
            .toThrow('Valid attestations of trusted keys of 0 holders attest the root');

    });

    it('is refused when its attestations attest another head, in another role, or come from too few holders', () => {

        // Another commit, its revision kept: not an attestation of this head at all.
        expect(() => History.fromSnapshot(ofHead({ attestations: changed(attestation => { attestation['revision'] = 6; }) }), anchoredPQ))
            .toThrow('Valid attestations of trusted keys of 0 holders attest the root');

        // Another root of the head.
        expect(() => History.fromSnapshot(ofHead({ attestations: changed(attestation => { (attestation['eTag'] as JSONValue[])[3] = '00'.repeat(32); }) }), anchoredPQ))
            .toThrow(/of 0 holders attest the root .* not of 2! \(an attestation by '[0-9a-f]+' attests another root;/);

        // In another role than the roaming network operator.
        expect(() => History.fromSnapshot(ofHead({ attestations: changed(attestation => { attestation['role'] = 'leader'; }) }), anchoredPQ))
            .toThrow(/of 0 holders attest the root .* \(the attestation by '[0-9a-f]+' is in the role 'leader';/);

        // An attestation of a subject attests one entity, not the root.
        expect(() => History.fromSnapshot(ofHead({ attestations: changed(attestation => { attestation['subject'] = { chargingStationId: 'DE*GEF*S1' }; }) }), anchoredPQ))
            .toThrow(/of 0 holders attest the root .* \(an attestation by '[0-9a-f]+' attests a subject;/);

        // One holder of a quorum of two.
        expect(() => History.fromSnapshot(ofHead({ attestations: attestations.slice(0, 1) }), anchoredPQ))
            .toThrow(/^The snapshot is not anchored in the trust anchor of the roaming network 'QA': Valid attestations of trusted keys of 1 holder attest the root effectiveTree:sha256:hex:[0-9a-f]+ of the proof, not of 2!$/);

        // A signature that does not verify.
        expect(() => History.fromSnapshot(ofHead({ attestations: changed(attestation => { attestation['validUntil'] = '2026-10-26T01:12:59.999Z'; }, 2) }), anchoredPQ))
            .toThrow(/of 1 holder attest the root .* \(the attestation by '[0-9a-f]+' is invalid:/);

    });

    it('is refused against a trust anchor whose identity keys did not sign the key statement of its head', () => {

        // The trust anchor of epoch 1: the head states the ML-DSA keys of epoch 2, signed by those keys alone.
        expect(() => History.fromSnapshot(ofHead(), { ...anchoredPQ, trustAnchor: anchor }))
            .toThrow("The snapshot is not anchored in the trust anchor of the roaming network 'QA': ");

    });

});


describe('A snapshot of a checkpoint', () => {

    const snapshot0 = readJSON('published/QA-checkpoint-0-snapshot.json') as JSONObject;

    /** The snapshot of checkpoint 0 with the signatures of its checkpoint chosen. */
    const signedBy = (keep: (signature: JSONObject, index: number) => boolean): JSONObject => {
        const copy       = clone(snapshot0);
        const checkpoint = copy['checkpoint'] as JSONObject;
        checkpoint['signatures'] = (checkpoint['signatures'] as JSONObject[]).filter(keep);
        return copy;
    };

    /** Anchored in the trust anchor of epoch 1, its checkpoint taken by whatever signed it: the anchoring is what checks it. */
    const anchoredAlone = { ...byOperator, verifyCheckpoint: (): void => undefined, trustAnchor: anchor, at: AT };

    it('is taken anchored in the trust anchor by its checkpoint, signed as the roaming network operator', () => {

        const history = History.fromSnapshot(snapshot0, anchoredAlone);
        expect(history.checkpoints.map(checkpoint => checkpoint.sequence)).toEqual([ 0 ]);

        // As many holders as the quorum, two of three.
        expect(History.fromSnapshot(signedBy((_, index) => index !== 0), anchoredAlone).checkpoints).toHaveLength(1);

    });

    it('is refused when its checkpoint is signed as the roaming network operator by too few holders, or not at all', () => {

        expect(() => History.fromSnapshot(signedBy(signature => signature['role'] !== 'roamingNetworkOperator'), anchoredAlone))
            .toThrow(/^The checkpoint '[0-9a-f]+' of the snapshot is not anchored in the trust anchor of the roaming network 'QA': Valid signatures of trusted keys of 0 holders sign the checkpoint '[0-9a-f]+' as its roaming network operator, not of 2!$/);

        expect(() => History.fromSnapshot(signedBy((signature, index) => signature['role'] !== 'roamingNetworkOperator' || index === 0), anchoredAlone))
            .toThrow(/Valid signatures of trusted keys of 1 holder sign the checkpoint '[0-9a-f]+' as its roaming network operator, not of 2!$/);

        // A signature that does not verify does not count, nor does it block the checkpoint.
        const broken = signedBy(() => true);
        const first  = defined(((broken['checkpoint'] as JSONObject)['signatures'] as JSONObject[])[0]);
        first['signedAt'] = '2026-10-25T23:00:00.000Z';
        expect(History.fromSnapshot(broken, anchoredAlone).checkpoints).toHaveLength(1);

    });

    it('is refused against the trust anchor of another epoch, and when its keys are no longer valid', () => {

        expect(() => History.fromSnapshot(snapshot0, { ...anchoredAlone, trustAnchor: anchorPQ }))
            .toThrow(/^The checkpoint '[0-9a-f]+' of the snapshot is not anchored in the trust anchor of the roaming network 'QA': /);

        expect(() => History.fromSnapshot(snapshot0, { ...anchoredAlone, at: '2126-10-26T00:58:00.000Z' }))
            .toThrow(/^The checkpoint '[0-9a-f]+' of the snapshot is not anchored in the trust anchor of the roaming network 'QA': /);

    });

    it('carries no attestations: its checkpoint anchors it', () => {

        expect(() => History.fromSnapshot({ ...snapshot0, attestations }, anchoredAlone))
            .toThrow('A snapshot of a checkpoint carries no attestations: the checkpoint anchors it!');

    });

});


describe('Signatures without a verifier (O3)', () => {

    const genesis = readJSON('published/QA-genesis.json') as JSONObject;

    it('refuses a signed commit or checkpoint without a verifier, as WWCP_POI does', () => {

        // The genesis is signed by the roaming network operator.
        expect(() => History.fromSnapshot(genesis, { unanchored: true }))
            .toThrow(/^The snapshot is not signed as required: The commit '[0-9a-f]+' is signed, but there is no verifier of commit signatures!$/);

        const history = History.fromSnapshot(genesis, { unanchored: true, verifyCommit: (): void => undefined });

        // Taken by a history with a verifier of commits, but none of checkpoints.
        const first = defined(commits('published/QA-commits-since-genesis.json')[0]);
        expect(history.append(first).commit.revision).toBe(1);

        // Without one, from the genesis taken unsigned.
        const unsigned = clone(genesis);
        delete (unsigned['commit'] as JSONObject)['signatures'];

        const withoutVerifier = History.fromSnapshot(unsigned, { ...UNCHECKED, verifyCommit: undefined });
        expect(() => withoutVerifier.append(first)).toThrow(/^The commit '[0-9a-f]+' is signed, but there is no verifier of commit signatures!$/);

        expect(() => History.fromSnapshot(readJSON('published/QA-checkpoint-0-snapshot.json'), { unanchored: true, verifyCommit: (): void => undefined }))
            .toThrow(/^The checkpoint of the snapshot can not be taken: The checkpoint '[0-9a-f]+' is signed, but there is no verifier of checkpoint signatures!$/);

    });

    it('takes an unsigned commit without a verifier', () => {

        const unsigned = clone(genesis);
        delete (unsigned['commit'] as JSONObject)['signatures'];

        expect(History.fromSnapshot(unsigned, { unanchored: true }).head.commit.signatures).toEqual([]);

    });

    it('verifies the commit of a snapshot, whose version before is unknown', () => {

        const seen: (RoamingNetwork | undefined)[] = [];

        History.fromSnapshot(ofHead(), { ...anchoredPQ, verifyCommit: (commit, before, after) => { seen.push(before, after); byOperatorPQ.verifyCommit?.(commit, before, after); } });

        expect(seen[0]).toBeUndefined();
        expect(seen[1]?.id).toBe('QA');

        expect(() => History.fromSnapshot(ofHead(), { ...anchoredPQ, verifyCommit: () => { throw new Error('not by its quorum'); } }))
            .toThrow('The snapshot is not signed as required: not by its quorum');

    });

});
