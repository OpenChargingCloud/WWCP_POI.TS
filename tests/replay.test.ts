import { describe, expect, it } from 'vitest';

import { defined, readJSON } from './helpers.ts';
import { anchor, checkpoint, commits, commitsOfEpoch1, following, fromGenesis, genesis, witnesses } from './qa.ts';

import { RoamingNetwork }     from '../src/network/roamingNetwork.ts';
import { Checkpoint }         from '../src/history/checkpoint.ts';
import { History }            from '../src/history/history.ts';
import type { JSONObject }    from '../src/json/value.ts';


// The whole history of QA, as a witness trusting the trust anchor of epoch 1 and its own keys of epoch 1 takes it: every
// commit of both epochs, each change set applied with the signatures of its owners checked, each commit signed by the
// quorum of OCC in the version before, the checkpoints signed by OCC and both witnesses.

describe('Replaying the history of QA commit by commit, through both epochs', () => {

    it('takes epoch 1 from its genesis, its checkpoints up to the final one, epoch 2 since its genesis, and reaches the head', () => {

        const verifier = following(anchor, genesis, witnesses, 2);
        const epoch1   = History.fromSnapshot(readJSON('published/QA-genesis.json'), fromGenesis(verifier));

        for (const commit of commitsOfEpoch1())
            epoch1.append(commit);

        for (const sequence of [ 0, 1, 2, 3, 4, 5, 6 ])
            epoch1.takeCheckpoint(checkpoint(sequence));

        expect(epoch1.head.commit.revision).toBe(16);
        expect(epoch1.finalCheckpoint?.sequence).toBe(6);
        expect(epoch1.epochStatus).toBe('closing');

        // Epoch 2 from the version of the final checkpoint: the genesis the server published.
        const epoch2 = epoch1.startNextEpoch();
        const published = readJSON('published/QA-epoch-2-genesis.json') as JSONObject;

        expect(epoch1.epochStatus).toBe('closed');
        expect(epoch2.root.commit.id).toBe((published['commit'] as JSONObject)['@id']);
        expect(epoch2.root.commit.id).toHaveLength(128);

        for (const commit of commits('proofs/QA-epoch-2-commits-to-head.json'))
            epoch2.append(commit);

        epoch2.takeCheckpoint(Checkpoint.parse(readJSON('published/QA-epoch-2-checkpoint-0.json')));

        // The head of epoch 2, as example A14 published it.
        expect(epoch2.head.commit.revision).toBe(8);
        expect(epoch2.head.commit.id).toBe((readJSON('published/QA-commit.json') as JSONObject)['@id']);
        expect(epoch2.head.network.matchesCommitETags(RoamingNetwork.parse(readJSON('published/QA.json')).eTags())).toBe(true);

        // Its trust followed OCC from the identity keys of the trust anchor of epoch 1 to those of epoch 2.
        expect([ ...verifier.trust.keyStatement.identityKeys.map(key => key.id) ].sort())
            .toEqual([ ...defined(epoch2.head.network.operator?.keyStatement).identityKeys.map(key => key.id) ].sort());

    });

});
