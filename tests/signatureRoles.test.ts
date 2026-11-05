import { describe, expect, it } from 'vitest';

import { asText, defined, readJSON } from './helpers.ts';
import { anchor, commits, following } from './qa.ts';

import { RoamingNetwork }     from '../src/network/roamingNetwork.ts';
import { History, type HistoryOptions } from '../src/history/history.ts';
import { ChargingStationProof } from '../src/proofs/stationProof.ts';
import { givesCompletely, sizeOf } from '../src/network/tree.ts';
import { clone, get, isArray, type JSONObject, type JSONValue } from '../src/json/value.ts';


// Required signature roles (WWCP_POI 12e993a, POI3-ISSUES.md S24): a commit is signed in every required role, by a
// signature whose key the version it leads to lets sign in it (keyMaySignIn): in the role of the roaming network operator
// a signing key certified for it, in the role of a charging station operator a signing key of the operator its signer
// names; leaders and witnesses are the verifier's. A role is no more than what a signature says otherwise. Checked as
// WWCP_POI3 checks them, in its words: whether it is signed in the role before it is applied, whether by such a key once
// its signatures are verified in its version. QA of epoch 2, from its genesis up to the head, followed from the trust
// anchor of epoch 1 through the key statements of its commits, as a verifier follows it.

const genesis   = readJSON('published/QA-epoch-2-genesis.json') as JSONObject;
const toHead    = commits('proofs/QA-epoch-2-commits-to-head.json') as JSONObject[];
const root      = RoamingNetwork.parse(genesis['roamingNetwork']);

/** A history of epoch 2 from the given snapshot of its genesis, followed as a verifier follows it, with the given options besides. */
const historyOf = (more: Partial<HistoryOptions> = {}, verifier: HistoryOptions = following(anchor, root), snapshot = genesis): History =>
    History.fromSnapshot(snapshot, { ...verifier, unanchored: true, ...more });

/**
 * The snapshot of the genesis, its commit signed in the given role besides, as a signature of the roaming network operator
 * says it, of the given signer and key: the verifier of the operator leaves it to others, a required role counts it.
 */
function genesisSignedIn(role: string, signer?: string, keyId?: string): JSONObject {
    const copy       = clone(genesis);
    const signatures = (copy['commit'] as JSONObject)['signatures'] as JSONObject[];
    const signature  = clone(defined(signatures[0]));
    signatures.push({ ...signature, role, ...(signer === undefined ? {} : { signer }), ...(keyId === undefined ? {} : { keyId }) });
    return copy;
}

/** The first signing key of DE*GEF in the genesis of epoch 2. */
const GEF_KEY = asText(defined((root.chargingStationOperator('DE*GEF')?.['signingKeys'] as JSONObject[] | undefined)?.[0])['@id']);

const refusal = (check: () => unknown): string => {
    try {
        check();
    }
    catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
    return 'taken';
};


describe('Required signature roles (S24)', () => {

    it('takes commits signed in the role of the roaming network operator by keys certified for it, up to the head', () => {

        const history = historyOf({ requiredSignatureRoles: [ 'roamingNetworkOperator' ] });

        for (const commit of toHead)
            history.append(commit);

        expect(history.head.commit.revision).toBe(11);

    });

    it('refuses a commit not signed in a required role, before it is applied', () => {

        const first = defined(toHead[0]);

        expect(refusal(() => historyOf({ requiredSignatureRoles: [ 'roamingNetworkOperator', 'leader' ] }, undefined, genesisSignedIn('leader')).append(first)))
            .toBe(`The commit '${asText(first['@id'])}' is not signed in the role 'leader'!`);

        // So is the commit of a snapshot.
        expect(refusal(() => historyOf({ requiredSignatureRoles: [ 'leader' ] })))
            .toBe(`The snapshot is not signed as required: The commit '${asText((genesis['commit'] as JSONObject)['@id'])}' is not signed in the role 'leader'!`);

        // A signed commit without a verifier of commit signatures, first of all.
        expect(refusal(() => History.fromSnapshot(genesis, { unanchored: true, requiredSignatureRoles: [ 'leader' ] })))
            .toBe(`The snapshot is not signed as required: The commit '${asText((genesis['commit'] as JSONObject)['@id'])}' is signed, but there is no verifier of commit signatures!`);

    });

    it('counts a role only by a key the version lets sign in it, not by what a signature says', () => {

        const first     = defined(toHead[0]);
        const signature = defined((first['signatures'] as JSONObject[])[0]);

        // A signature of the roaming network operator, said to be one of DE*GEF: its key is no signing key of DE*GEF.
        const asOperator = clone(first);
        (asOperator['signatures'] as JSONValue[]).push({ ...clone(signature), role: 'chargingStationOperator', signer: 'DE*GEF' });

        expect(refusal(() => historyOf({ requiredSignatureRoles: [ 'chargingStationOperator' ] }, undefined, genesisSignedIn('chargingStationOperator', 'DE*GEF', GEF_KEY)).append(asOperator)))
            .toBe(`The commit '${asText(first['@id'])}' is not signed in the role 'chargingStationOperator' by a key that may sign in it!`);

        // Signatures in the role of the roaming network operator by a key no certificate of the version names, which a
        // verifier took: not signed in the role as required.
        const uncertified = clone(first);
        for (const item of uncertified['signatures'] as JSONObject[])
            item['keyId'] = 'ab'.repeat(32);

        expect(refusal(() => historyOf({ requiredSignatureRoles: [ 'roamingNetworkOperator' ] }, { verifyCommit: () => undefined, verifyCheckpoint: () => undefined }).append(uncertified)))
            .toBe(`The commit '${asText(first['@id'])}' is not signed in the role 'roamingNetworkOperator' by a key that may sign in it!`);

    });

    it('refuses a checkpoint not signed in a required role, once its signatures are verified', () => {

        const checkpoint = readJSON('published/QA-epoch-2-checkpoint-0.json') as JSONObject;
        const upTo       = (history: History): History => {
            for (const commit of toHead.slice(0, Number(checkpoint['revision'])))
                history.append(commit);
            return history;
        };

        expect(upTo(historyOf({ requiredCheckpointSignatureRoles: [ 'roamingNetworkOperator', 'witness' ] })).takeCheckpoint(checkpoint).id).toBe(checkpoint['@id']);
        expect(refusal(() => upTo(historyOf({ requiredCheckpointSignatureRoles: [ 'leader' ] })).takeCheckpoint(checkpoint)))
            .toBe(`The checkpoint '${asText(checkpoint['@id'])}' is not signed in the role 'leader'!`);

    });

});


describe('What a proof gives of a child array (S29)', () => {

    it('tells whether it gives it completely, and its size also where it gives some or none of its children', () => {

        const proof     = ChargingStationProof.parse(readJSON('proofs/QA-proof-station-DE_GEF_S1.json'));
        const network   = proof.roamingNetwork;
        const operators = get(network, 'chargingStationOperators') as JSONObject;

        // The operators of QA partially, as leaves: one of them given, the others not.
        expect([ givesCompletely(network, 'chargingStationOperators'), isArray(operators) ]).toEqual([ false, false ]);
        expect(sizeOf(network, 'chargingStationOperators')).toBe(operators['@size']);

        // A property no child array of it is given: none, so given completely.
        expect([ givesCompletely(network, 'parkingOperators'), sizeOf(network, 'parkingOperators') ]).toEqual([ true, 0 ]);

        // As an array, completely; a size that is no whole number, none.
        expect([ givesCompletely({ EVSEs: [ {}, {} ] }, 'EVSEs'), sizeOf({ EVSEs: [ {}, {} ] }, 'EVSEs') ]).toEqual([ true, 2 ]);
        expect(sizeOf({ EVSEs: { '@size': -1, '@merkleRoot': 'x' } }, 'EVSEs')).toBeUndefined();

    });

});
