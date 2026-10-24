import { describe, expect, it } from 'vitest';

import { AT, readJSON, readText } from './helpers.ts';

import { TrustAnchor }        from '../src/proofs/trustAnchor.ts';
import { RoamingNetwork }     from '../src/network/roamingNetwork.ts';
import { History }            from '../src/history/history.ts';
import { OperatorTrust }      from '../src/verifier/trust.ts';
import type { JSONArray, JSONObject } from '../src/json/value.ts';


describe('Replaying the history of QA commit by commit', () => {

    const anchor  = TrustAnchor.parse(readText('published/QA-trustAnchor.txt'));
    const trust   = OperatorTrust.of(anchor, RoamingNetwork.parse(readJSON('published/QA.json')), AT);

    it('takes the genesis snapshot and every commit since, as a witness does', () => {

        const history = History.fromSnapshot(readJSON('published/QA-genesis.json'), {
            verifyCommit: commit => trust.verifyOperatorSignatures(commit.signatures, (signature, key) => commit.verifySignature(signature, key), 'the commit'),
        });

        for (const commit of readJSON('published/QA-commits-since-genesis.json') as JSONArray)
            history.append(commit);

        expect(history.head.commit.revision).toBe(9);

        for (const commit of readJSON('published/QA-commits-since-checkpoint-2.json') as JSONArray)
            history.append(commit);

        expect(history.head.commit.revision).toBe(12);
        expect(history.head.commit.id).toBe((readJSON('published/QA-commit.json') as JSONObject)['@id']);

    });

});
