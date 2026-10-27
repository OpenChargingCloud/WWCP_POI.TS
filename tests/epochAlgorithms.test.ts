import { describe, expect, it } from 'vitest';

import { asText, defined, readJSON, UNCHECKED } from './helpers.ts';

import { History }               from '../src/history/history.ts';
import { commitsRoot }           from '../src/history/checkpoint.ts';
import { canonicalJSONBytes }    from '../src/json/canonical.ts';
import { hash }                  from '../src/crypto/hash.ts';
import { toHex }                 from '../src/encoding/text.ts';
import { merkleTreeHeadToJSON }  from '../src/merkle.ts';
import type { Commit }           from '../src/history/commit.ts';
import type { JSONObject, JSONValue } from '../src/json/value.ts';


// The epoch 2 of QA takes ML-DSA-65 and ML-DSA-87; closed here by a final checkpoint naming an epoch 3 of ML-DSA-87 alone,
// the first checkpoint of the epoch 3 takes the algorithms of both epochs, and no other (11.3). The checkpoints are made
// here, signed by nobody: no signature is verified, the algorithms they name are what is checked.

const CHECKPOINT_CONTEXT  = 'https://open.charging.cloud/contexts/wwcp/roamingNetwork/checkpoint/v1';

const genesis2            = readJSON('published/QA-epoch-2-genesis.json') as JSONObject;
const epoch2JSON          = genesis2['epoch'] as JSONObject;
const profiles3           = { ...(epoch2JSON['profiles'] as JSONObject), signatureAlgorithms: [ 'ML-DSA-87' ] };
const template            = ((readJSON('published/QA-epoch-2-checkpoint-0.json') as JSONObject)['signatures'] as JSONObject[])[0];

/** A signature naming the given algorithm, of a key of its own. */
const signedWith = (algorithm: string, index: number): JSONObject =>
    ({ ...template, algorithm, keyId: index.toString(16).padStart(64, '0') });

/** The checkpoint of the given content, identified with SHA-512, as the epochs 2 and 3 identify theirs, with signatures of the given algorithms. */
function checkpointOf(content: JSONObject, algorithms: readonly string[]): JSONObject {
    const withContext = { '@context': CHECKPOINT_CONTEXT, ...content };
    return { '@id': toHex(hash('sha512', canonicalJSONBytes(withContext))), ...withContext, signatures: algorithms.map(signedWith) };
}

/** The first or only checkpoint of the given epoch, of its genesis. */
const firstOf = (epoch: number, genesis: Commit, more: JSONObject, algorithms: readonly string[]): JSONObject =>
    checkpointOf({ roamingNetworkId: 'QA', epoch, sequence: 0, commitId: genesis.id, revision: 0, eTags: defined(genesis.json['eTags']),
                   commits: merkleTreeHeadToJSON({ size: 1, root: commitsRoot([ genesis ], 'sha512') }), createdAt: '2026-10-26T03:00:00.000Z', ...more },
                 algorithms);

function epochs(): { epoch3: History, previous: JSONObject } {

    const epoch2  = History.fromSnapshot(genesis2, UNCHECKED);
    const final2  = epoch2.takeCheckpoint(firstOf(2, epoch2.root.commit, { final: true, next: { epoch: 3, profiles: profiles3 }, previous: defined(epoch2JSON['previous']) }, [ 'ML-DSA-65' ]));

    return { epoch3: epoch2.startNextEpoch(), previous: { epoch: 2, checkpointId: final2.id, eTags: defined(final2.json['eTags']) } };

}

/** A snapshot of the genesis of the epoch 3, with the given epoch beside its profiles. */
const snapshotOf = (genesis: Commit, epoch: JSONObject): JSONValue =>
    ({ commit: genesis.json, roamingNetwork: defined(genesis2['roamingNetwork']), epoch: { epoch: 3, profiles: profiles3, ...epoch } });


describe('The first checkpoint of a later epoch', () => {

    it('takes the algorithms of the epoch before and of its own, no other', () => {

        const { epoch3, previous } = epochs();
        const genesis = epoch3.root.commit;

        expect(epoch3.previousEpochProfiles?.signatureAlgorithms).toEqual([ 'ML-DSA-65', 'ML-DSA-87' ]);

        const withEd25519 = firstOf(3, genesis, { previous }, [ 'ML-DSA-87', 'Ed25519' ]);
        expect(() => epoch3.takeCheckpoint(withEd25519))
            .toThrow(`The signature algorithm 'Ed25519' of a signature of the checkpoint '${asText(withEd25519['@id'])}' is neither one of the epoch 3, ML-DSA-87, nor of the epoch 2, ML-DSA-65, ML-DSA-87!`);

        expect(epoch3.takeCheckpoint(firstOf(3, genesis, { previous }, [ 'ML-DSA-87', 'ML-DSA-65' ])).sequence).toBe(0);

    });

    it('knows the profiles of the epoch before from the snapshot it starts from, and takes its own algorithms alone without them', () => {

        const { epoch3, previous } = epochs();
        const genesis = epoch3.root.commit;
        const first   = firstOf(3, genesis, { previous }, [ 'ML-DSA-87', 'ML-DSA-65' ]);

        const joined  = History.fromSnapshot(snapshotOf(genesis, { previous, previousProfiles: defined(epoch2JSON['profiles']) }), UNCHECKED);
        expect(joined.previousEpochProfiles?.signatureAlgorithms).toEqual([ 'ML-DSA-65', 'ML-DSA-87' ]);
        expect(joined.takeCheckpoint(first).sequence).toBe(0);

        const unknowing = History.fromSnapshot(snapshotOf(genesis, { previous }), UNCHECKED);
        expect(unknowing.previousEpochProfiles).toBeUndefined();
        expect(() => unknowing.takeCheckpoint(first))
            .toThrow(`The signature algorithm 'ML-DSA-65' of a signature of the checkpoint '${asText(first['@id'])}' is not one of the epoch 3, ML-DSA-87, and the profiles of the epoch 2 are not known here!`);

    });

    it('of the epoch 2 follows the first epoch, whose profiles a snapshot does not name', () => {

        expect(History.fromSnapshot(genesis2, UNCHECKED).previousEpochProfiles?.signatureAlgorithms).toEqual([]);
        expect(() => History.fromSnapshot({ ...genesis2, epoch: { ...epoch2JSON, previousProfiles: defined(epoch2JSON['profiles']) } }, UNCHECKED))
            .toThrow('The epoch before the epoch 2 is the first one, of the default profiles: they are not given!');

    });

});
