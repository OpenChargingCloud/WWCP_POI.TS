import { describe, expect, it } from 'vitest';

import { AT, readJSON, readText } from './helpers.ts';
import { anchor, anchorPQ, checkpoint, commits, following, witnesses, witnessesPQ } from './qa.ts';

import { RoamingNetwork }     from '../src/network/roamingNetwork.ts';
import { Commit }             from '../src/history/commit.ts';
import { Checkpoint, CheckpointProof } from '../src/history/checkpoint.ts';
import { History }            from '../src/history/history.ts';
import { parsePriceStatements, verifyCheckpointPriceStatements } from '../src/proofs/priceStatement.ts';
import { OperatorTrust }      from '../src/verifier/trust.ts';
import { verifyVersion }      from '../src/verifier/version.ts';
import { verifyCheckpointSignatures } from '../src/verifier/checkpoints.ts';
import { parseJSON }          from '../src/json/parse.ts';
import { POIPublicKey }       from '../src/keys.ts';
import { clone, type JSONArray, type JSONObject } from '../src/json/value.ts';


// Example A11: new locks, same house. QA moves into epoch 2, of SHA-512 identifications and ML-DSA signatures only;
// checked as ExampleA11.Validate() does, by a verifier trusting only the old locks and by one trusting only the new ones.

const POST_QUANTUM = [ 'ML-DSA-65', 'ML-DSA-87' ];

/** A checkpoint with only the signatures of the given algorithms: a verifier checks those it can. */
function onlyOf(json: JSONObject, algorithms: (algorithm: string) => boolean): JSONObject {
    const copy = clone(json);
    copy['signatures'] = (copy['signatures'] as JSONObject[]).filter(signature => algorithms(String(signature['algorithm'])));
    return copy;
}


describe('Example A11: a verifier trusting only the old locks', () => {

    it('follows QA from checkpoint 5 through the final checkpoint 6 into epoch 2 (a to e)', () => {

        // a) The trust anchor it scanned once, the witnesses it trusts since, QA as of checkpoint 5, joined from its snapshot.
        const snapshot5  = readJSON('published/QA-checkpoint-5-snapshot.json') as JSONObject;
        const verifier   = following(anchor, RoamingNetwork.parse(snapshot5['roamingNetwork']), witnesses, 2);
        const epoch1     = History.fromSnapshot(snapshot5, verifier);

        // b) The commits since, each checked in the version before: the one stating the new keys signed by the old quorum,
        //    so the new keys are trusted as well; and the final checkpoint 6, signed by OCC and both witnesses.
        for (const commit of commits('published/QA-commits-since-checkpoint-5.json'))
            epoch1.append(commit);

        const final = epoch1.takeCheckpoint(checkpoint(6));

        expect(epoch1.head.commit.revision).toBe(16);
        expect(final.id).toBe('0b4391780648d82fde3ef5b268f1af938ef890b60f3b7e99af02443633c65d24');
        expect(final.isFinal).toBe(true);
        expect(final.next!.number).toBe(2);
        expect(final.next!.profiles.toString()).toBe('sha512, ML-DSA-65, ML-DSA-87');
        expect(verifyCheckpointSignatures(final, verifier.trust, { witnesses, requiredWitnesses: 2 }).witnessedBy).toEqual([ 'calibration.example', 'association.example' ]);
        expect(epoch1.epochStatus).toBe('closing');

        // Epoch 1 takes no commit after it.
        const firstOfEpoch2 = commits('published/QA-epoch-2-commits-since-genesis.json')[0]!;
        expect(() => epoch1.append(firstOfEpoch2))
            .toThrow("The epoch 1 of the roaming network 'QA' is closed by its final checkpoint '0b4391780648d82fde3ef5b268f1af938ef890b60f3b7e99af02443633c65d24': what follows belongs to the epoch 2!");

        // c) It starts epoch 2 itself: the genesis the server published, 128 hexadecimal digits.
        const epoch2     = epoch1.startNextEpoch();
        const published  = readJSON('published/QA-epoch-2-genesis.json') as JSONObject;

        expect(epoch2.root.commit.id).toBe('f6e9c5676841edb1dcb4289a7431fb6cce626cc2b85c87a94ea381fa9cf40dcfa261db615ce585c27b25ab98c3baeeeb36d8e8692f3d3057174c108601c50db6');
        expect(epoch2.root.commit.id).toBe((published['commit'] as JSONObject)['@id']);
        expect(epoch2.root.commit.revision).toBe(0);
        expect(epoch2.epoch.number).toBe(2);
        expect(epoch1.epochStatus).toBe('closed');

        // d) The commits of epoch 2 and its checkpoint 0, after the final checkpoint it took; the signatures by the old keys
        //    of OCC, as the genesis certifies them, by AlphaOrg, BetaOrg and GammaOrg.
        const genesisTrust = verifier.trust;

        for (const commit of commits('published/QA-epoch-2-commits-since-genesis.json'))
            epoch2.append(commit);

        const first = epoch2.takeCheckpoint(readJSON('published/QA-epoch-2-checkpoint-0.json'));

        expect(first.previous!.checkpointId).toBe(final.id);
        expect(first.previous!.epoch).toBe(1);

        const withOldKeys = Checkpoint.parse(onlyOf(readJSON('published/QA-epoch-2-checkpoint-0.json') as JSONObject, algorithm => !POST_QUANTUM.includes(algorithm)));
        const oldSigned   = verifyCheckpointSignatures(withOldKeys, genesisTrust, { witnesses, requiredWitnesses: 2 });
        expect(oldSigned.signedBy).toEqual([ 'AlphaOrg', 'BetaOrg', 'GammaOrg' ]);
        expect(oldSigned.witnessedBy).toEqual([ 'calibration.example', 'association.example' ]);

        // e) The head of epoch 2 with the old trust anchor alone: its key statement is signed by the ML-DSA identity keys of
        //    AlphaOrg and BetaOrg, which the old trust anchor does not name. The new trust anchor names the identity keys and
        //    the quorum of the key statement the verifier followed.
        const head = RoamingNetwork.parse(readJSON('published/QA.json'));
        expect(() => OperatorTrust.of(anchor, head, AT)).toThrow('The key statement is signed by trusted identity keys of 0 holders, not of 2!');

        const followed = verifier.trust.keyStatement;
        expect([ ...anchorPQ.keys ].sort()).toEqual(followed.identityKeys.map(key => key.id).sort());
        expect(anchorPQ.minConsensus).toBe(followed.minConsensus);
        expect(readText('published/QA-trustAnchor-mldsa.txt').trim()).toHaveLength(511);

        // And with the new trust anchor, the head as published, revision 7 of epoch 2.
        const version = verifyVersion(anchorPQ, readJSON('published/QA.json'), readJSON('published/QA-commit.json'), AT);
        expect(version.commit.epoch).toBe(2);
        expect(version.commit.revision).toBe(7);
        expect(version.signedBy).toEqual([ 'AlphaOrg', 'BetaOrg', 'GammaOrg' ]);

    });

    it('refuses what epoch 2 refuses: old algorithms, and a change set signed with them', () => {

        const genesis = History.fromSnapshot(readJSON('published/QA-epoch-2-genesis.json'));
        const commit1 = clone(commits('published/QA-epoch-2-commits-since-genesis.json')[0] as JSONObject);

        // The signatures of a change set are not part of the identification of its commit: an ES512 one is refused by the epoch.
        ((commit1['changeSet'] as JSONObject)['signatures'] as JSONObject[])[0]!['algorithm'] = 'ES512';
        expect(() => genesis.append(commit1)).toThrow(/^The signature algorithm 'ES512' of a signature of the change set of the commit '[0-9a-f]{128}' is not one of the epoch 2, ML-DSA-65, ML-DSA-87!$/);

    });

});


describe('Example A11: a verifier trusting only the new locks', () => {

    it('joins epoch 2 from checkpoint 0, checking the signatures of the algorithms of epoch 2 only (a, b)', () => {

        const snapshot0 = clone(readJSON('published/QA-epoch-2-checkpoint-0-snapshot.json') as JSONObject);
        snapshot0['checkpoint'] = onlyOf(snapshot0['checkpoint'] as JSONObject, algorithm => POST_QUANTUM.includes(algorithm));

        const verifier  = following(anchorPQ, RoamingNetwork.parse(snapshot0['roamingNetwork']), witnessesPQ, 2);
        const joined    = History.fromSnapshot(snapshot0, verifier);
        const first     = joined.checkpoints[0]!;

        expect(joined.epoch.number).toBe(2);
        expect(joined.head.commit.revision).toBe(2);
        expect(first.id).toHaveLength(128);
        expect([ ...new Set(first.signatures.map(signature => signature.algorithm)) ]).toEqual([ 'ML-DSA-65' ]);
        expect(verifyCheckpointSignatures(first, verifier.trust, { witnesses: witnessesPQ, requiredWitnesses: 2 }).witnessedBy).toEqual([ 'calibration.example', 'association.example' ]);

        // b) The price statement of DE*GEF*E1*1 in checkpoint 0: ML-DSA, after the final checkpoint of epoch 1.
        const statements = parsePriceStatements(readJSON('published/QA-epoch-2-checkpoint-0-priceStatements.json'));
        verifyCheckpointPriceStatements(first, statements);

        const statement = statements.find(item => item.entityId === 'DE*GEF*E1*1')!;
        expect(statement.sequence).toBe(3);
        expect(statement.algorithm).toBe('ML-DSA-65');
        expect(statement.after).toBe(first.previous!.checkpointId);
        expect(String((((statement.prices[0]!['elements'] as JSONObject[])[0]!['priceComponents'] as JSONObject[])[0]!)['price'])).toBe('0.59');

        // Signed by the ML-DSA tariffs key of DE*GEF.
        const signingKeys = POIPublicKey.parseAll(joined.head.network.chargingStationOperator('DE*GEF')!['signingKeys'], 'the signing keys of DE*GEF');
        expect(statement.verify('QA', 'DE*GEF', signingKeys).usages).toEqual([ 'priceStatements', 'tariffs' ]);

    });

    it('refuses a commit of epoch 1 and a genesis of another version, and the evidence of epoch 1 stays valid (c to e)', () => {

        const snapshot0 = readJSON('published/QA-epoch-2-checkpoint-0-snapshot.json') as JSONObject;
        const joined    = History.fromSnapshot(snapshot0);

        // c) A commit of epoch 1, the last one, given as one of epoch 2.
        const ofEpoch1 = commits('published/QA-commits-since-checkpoint-5.json').at(-1)!;
        expect(() => joined.append(ofEpoch1)).toThrow("The commit '48449019fb609c58f9f1e739096eabda1ba6c1d87991918fbf7cf22979b68b20' is one of the epoch 1, but this history is of the epoch 2!");

        // d) A genesis of epoch 2 of another version, of another name: its ETags are not those of its content.
        const other = parseJSON(readText('published/QA-epoch-2-genesis.json').replace('"en": "Quality Assurance"', '"en": "Quality Assurance, otherwise"'));
        expect(() => History.fromSnapshot(other)).toThrow(/^Invalid roaming network of the snapshot: The ETags of the roaming network 'QA' do not match its content/);

        // e) The evidence of the driver of example A10, in epoch 1: its commit proof against checkpoint 4, as before.
        const evidence = readJSON('driver/evidence-DE_GEF_E1_1.json') as JSONObject;
        const proof    = CheckpointProof.parse(evidence['commitProof']);
        proof.verify(Checkpoint.parse((evidence['checkpoints'] as JSONArray)[0]));
        expect(proof.revision).toBe(13);

        // The genesis commit names the epoch and its profiles; every later commit of epoch 2 names the epoch.
        const genesis = Commit.parse((readJSON('published/QA-epoch-2-genesis.json') as JSONObject)['commit']);
        expect(genesis.profiles!.toString()).toBe('sha512, ML-DSA-65, ML-DSA-87');
        expect(Commit.parse(commits('published/QA-epoch-2-commits-since-genesis.json')[0]).epoch).toBe(2);

    });

});

