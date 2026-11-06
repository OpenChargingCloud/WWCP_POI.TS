import { describe, expect, it } from 'vitest';

import { asText, defined, readJSON } from './helpers.ts';
import { anchor, commits, following, witnessesPQ } from './qa.ts';

import { RoamingNetwork }     from '../src/network/roamingNetwork.ts';
import { History, type HistoryOptions } from '../src/history/history.ts';
import { Commit }             from '../src/history/commit.ts';
import { Checkpoint }         from '../src/history/checkpoint.ts';
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

});


describe('A checkpoint taken with the signatures that verify here (S39)', () => {

    // WWCP_POI 399b7c8, POI3-ISSUES.md S39: a history takes a checkpoint with those of its signatures that verify here, the
    // first of each key and role, by keys trusted here for their roles; one that does not, invalid or by a key not trusted
    // here, is left out, not refused, so that nobody blocks a checkpoint by adding a signature, and a witness trusted
    // elsewhere and not here keeps none from it. The roles it must be signed in are counted among those it is taken with.
    // The first checkpoint of epoch 2 carries six signatures of the roaming network operator and four of witnesses: a
    // verifier following epoch 2 from the trust anchor of epoch 1 verifies three of the operator (the keys of the others
    // no identity key it trusts certifies), and, trusting the ML-DSA keys of both witnesses, two of theirs.
    const checkpoint  = readJSON('published/QA-epoch-2-checkpoint-0.json') as JSONObject;
    const id          = asText(checkpoint['@id']);
    const signatures  = checkpoint['signatures'] as JSONObject[];
    const upTo        = (history: History): History => {
        for (const commit of toHead.slice(0, Number(checkpoint['revision'])))
            history.append(commit);
        return history;
    };

    /** A verifier following epoch 2, trusting both witnesses by their ML-DSA keys, both of them required. */
    const witnessed   = (): HistoryOptions => following(anchor, root, witnessesPQ, 2);

    /** The signatures of a checkpoint, short. */
    const named       = (taken: Checkpoint): string[] =>
        taken.signatures.map(signature => `${signature.role} ${signature.signer ?? ''} ${signature.keyId.slice(0, 8)}`);

    const VERIFIED    = [ 'roamingNetworkOperator OCC 2cfca673', 'roamingNetworkOperator OCC b93748c4', 'roamingNetworkOperator OCC b915bcc3',
                          'witness calibration.example 984dd74a', 'witness association.example d8c15249' ];

    /** Why the first signature not verified here was left out, as WWCP_POI says it: by a key of the operator not trusted here. */
    const first       = defined(signatures[3]);
    const LEFT_OUT    = `The signature of the checkpoint '${id}' by roamingNetworkOperator OCC with '${asText(first['keyId'])}' at ${asText(first['signedAt'])} is invalid, or its key is not trusted!`;

    it('takes it with the signatures that verify here only, the others left out', () => {

        expect(asText(first['keyId'])).toMatch(/^d76d4d4e/);

        const taken = upTo(historyOf({ requiredCheckpointSignatureRoles: [ 'roamingNetworkOperator', 'witness' ] }, witnessed())).takeCheckpoint(checkpoint);

        expect([ taken.id, taken.signatures.length, signatures.length ]).toEqual([ id, 5, 10 ]);
        expect(named(taken)).toEqual(VERIFIED);
        expect((taken.json['signatures'] as JSONValue[]).length).toBe(5);

    });

    it('refuses it not signed in a required role by a signature that verifies here, saying why the first one was left out', () => {

        // Signed by witnesses, by keys not trusted here: no role of a witness.
        expect(refusal(() => upTo(historyOf({ requiredCheckpointSignatureRoles: [ 'roamingNetworkOperator', 'witness' ] })).takeCheckpoint(checkpoint)))
            .toBe(`The checkpoint '${id}' is not signed in the role 'witness' by a signature that verifies here! ${LEFT_OUT}`);

        expect(refusal(() => upTo(historyOf({ requiredCheckpointSignatureRoles: [ 'leader' ] }, witnessed())).takeCheckpoint(checkpoint)))
            .toBe(`The checkpoint '${id}' is not signed in the role 'leader' by a signature that verifies here! ${LEFT_OUT}`);

        // Every signature verified, as a verifier taking them all tells: nothing left out to say.
        expect(refusal(() => upTo(historyOf({ requiredCheckpointSignatureRoles: [ 'leader' ] }, { verifyCommit: () => undefined, verifyCheckpoint: () => undefined })).takeCheckpoint(checkpoint)))
            .toBe(`The checkpoint '${id}' is not signed in the role 'leader' by a signature that verifies here!`);

    });

    it('is blocked by no signature added, a forged one before the genuine one of its key and role included', () => {

        const genuine  = defined(signatures[0]);
        const forged   = { ...clone(genuine), value: asText(signatures[1]?.['value']) };
        const stranger = { ...clone(genuine), role: 'witness', signer: 'stranger.example' };
        const added    = { ...clone(checkpoint), signatures: [ forged, ...clone(signatures), stranger ] };

        const taken    = upTo(historyOf({ requiredCheckpointSignatureRoles: [ 'roamingNetworkOperator', 'witness' ] }, witnessed())).takeCheckpoint(added);

        expect(named(taken)).toEqual(VERIFIED);
        expect(taken.signatures[0]?.value).toBe(genuine['value']);

    });

    it('starts a history from the snapshot of a checkpoint, held with the signatures that verify here', () => {

        // Verified before the commit of the snapshot, by the trust in the genesis the verifier follows from: there every key
        // of the operator is certified, so its six signatures verify; the witnesses' by their keys of epoch 1 do not.
        const history = History.fromSnapshot(readJSON('published/QA-epoch-2-checkpoint-0-snapshot.json'), { ...witnessed(), unanchored: true, requiredCheckpointSignatureRoles: [ 'witness' ] });

        expect(named(defined(history.checkpoints[0]))).toEqual([ ...VERIFIED.slice(0, 3),
                                                                 'roamingNetworkOperator OCC d76d4d4e', 'roamingNetworkOperator OCC c9f38055', 'roamingNetworkOperator OCC 823d28d5',
                                                                 ...VERIFIED.slice(3) ]);

    });

});


describe('How a signature of a commit or checkpoint is read', () => {

    // As WWCP_POI3 reads it (RoamingNetworkCommitSignature): its role, its signer when it names one, its algorithm, key and
    // value not empty, nor whitespace alone as String.IsNullOrWhiteSpace tells it, so that no role or signer of nothing is
    // counted. U+FEFF is no whitespace there: a role of it is only a role nobody requires.
    const first       = defined(toHead[0]);
    const checkpoint  = readJSON('published/QA-epoch-2-checkpoint-0.json') as JSONObject;

    /** The given document, its first signature with the given properties. */
    const withFirst = (document: JSONObject, properties: JSONObject): JSONObject => {
        const copy       = clone(document);
        const signatures = copy['signatures'] as JSONObject[];
        signatures[0]    = { ...clone(defined(signatures[0])), ...properties };
        return copy;
    };

    it('refuses an empty role, signer, algorithm, key or value', () => {

        for (const [ property, text ] of [ [ 'role', '' ], [ 'role', ' ' ], [ 'role', '\t' ], [ 'role', '\u00A0' ], [ 'signer', '' ], [ 'signer', '\u3000' ],
                                           [ 'algorithm', ' ' ], [ 'keyId', '' ], [ 'value', '\n' ] ] as const) {

            expect(refusal(() => Commit.parse(withFirst(first, { [property]: text }))))
                .toBe(`The ${property} of a signature of a commit must not be empty!`);

            expect(refusal(() => Checkpoint.parse(withFirst(checkpoint, { [property]: text }))))
                .toBe(`The ${property} of a signature of a checkpoint must not be empty!`);

        }

        // So is the commit of a snapshot.
        const snapshot = clone(genesis);
        snapshot['commit'] = withFirst(genesis['commit'] as JSONObject, { signer: ' ' });

        expect(refusal(() => historyOf({}, undefined, snapshot)))
            .toBe('Invalid commit of the snapshot: The signer of a signature of a commit must not be empty!');

    });

    it('reads its role, time, algorithm, key and value trimmed, its signer as given, and verifies what it read', () => {

        // Whitespace around what the operator signed: read trimmed (ParseMandatoryText), the signature verifies as it was
        // made, and the role counts for the role required.
        const signature = defined((first['signatures'] as JSONObject[])[0]);
        const padded    = withFirst(first, { role:      ' roamingNetworkOperator\t',
                                             signedAt:  `\n${asText(signature['signedAt'])} `,
                                             algorithm: ` ${asText(signature['algorithm'])}`,
                                             keyId:     `${asText(signature['keyId'])}\u00A0`,
                                             value:     ` ${asText(signature['value'])} ` });

        const read = defined(Commit.parse(padded).signatures[0]);

        expect([ read.role, read.algorithm, read.keyId, read.value ])
            .toEqual([ 'roamingNetworkOperator', signature['algorithm'], signature['keyId'], signature['value'] ]);

        expect(historyOf({ requiredSignatureRoles: [ 'roamingNetworkOperator' ] }).append(padded).commit.id).toBe(first['@id']);

        // The signer is read as given: around it whitespace stays, so it names no operator that may sign as one.
        expect(Commit.parse(withFirst(first, { signer: ' OCC ' })).signatures[0]?.signer).toBe(' OCC ');

    });

    it('takes a role of U+FEFF, which is no whitespace, as a role nobody requires', () => {

        expect(Commit.parse(withFirst(first, { role: '\uFEFF' })).signatures[0]?.role).toBe('\uFEFF');

        // Its role counted for nobody: by a verifier taking every signature, a history takes the commit.
        expect(refusal(() => historyOf({}, { verifyCommit: () => undefined, verifyCheckpoint: () => undefined }).append(withFirst(first, { role: '\uFEFF' })))).toBe('taken');

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
