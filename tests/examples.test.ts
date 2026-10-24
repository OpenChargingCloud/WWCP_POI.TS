import { describe, expect, it } from 'vitest';

import { AT, readJSON, readText } from './helpers.ts';

import { TrustAnchor }           from '../src/proofs/trustAnchor.ts';
import { RoamingNetwork }        from '../src/network/roamingNetwork.ts';
import { Commit }                from '../src/history/commit.ts';
import { ChangeSet }             from '../src/history/changeSet.ts';
import { applyChangeSet }        from '../src/history/apply.ts';
import { Checkpoint, CheckpointProof } from '../src/history/checkpoint.ts';
import { History, type HistoryOptions } from '../src/history/history.ts';
import { ArchiveSegment, parseArchiveSegmentInfo, verifySegmentLine } from '../src/history/archive.ts';
import { POIPublicKey }          from '../src/keys.ts';
import { PriceStatement, PriceStatementProof, parsePriceStatements, verifyCheckpointPriceStatements } from '../src/proofs/priceStatement.ts';
import { OperatorTrust }         from '../src/verifier/trust.ts';
import { verifyVersion }         from '../src/verifier/version.ts';
import { parseTrustedWitnesses, verifyCheckpointLine, verifyCheckpointSignatures } from '../src/verifier/checkpoints.ts';
import { canonicalJSON }         from '../src/json/canonical.ts';
import { parseJSON }             from '../src/json/parse.ts';
import { clone, get, type JSONArray, type JSONObject } from '../src/json/value.ts';
import { hash }                  from '../src/crypto/hash.ts';
import { toHex }                 from '../src/encoding/text.ts';


const sha256Hex = (text: string): string =>
    toHex(hash('sha256', new TextEncoder().encode(text)));


// The examples A2 to A9 of WWCP_POI, checked from what the C# implementation published, as their Validate() methods do.

const anchor     = TrustAnchor.parse(readText('published/QA-trustAnchor.txt'));
const head       = verifyVersion(anchor, readJSON('published/QA.json'), readJSON('published/QA-commit.json'), AT);
const trust      = head.trust;
const witnesses  = parseTrustedWitnesses(readJSON('trusted/witnesses.json'));

/** As example A4: commits signed as the roaming network operator by its quorum, checkpoints as well. */
const byOperator: HistoryOptions = {
    verifyCommit:      commit     => { trust.verifyOperatorSignatures(commit.signatures, (signature, key) => commit.verifySignature(signature, key), 'the commit'); },
    verifyCheckpoint:  checkpoint => { verifyCheckpointSignatures(checkpoint, trust); },
};

/** As example A6: and by both witnesses a verifier trusts. */
const byOperatorAndWitnesses: HistoryOptions = {
    verifyCommit:      byOperator.verifyCommit!,
    verifyCheckpoint:  checkpoint => { verifyCheckpointSignatures(checkpoint, trust, { witnesses, requiredWitnesses: 2 }); },
};

const checkpoint = (sequence: number): Checkpoint =>
    Checkpoint.parse(readJSON(`published/QA-checkpoint-${sequence}.json`));

const commits = (file: string): JSONArray =>
    readJSON(file) as JSONArray;

/** The pools of DE*GEF as they are at runtime: each station with its power and those of its EVSEs, in kW. */
function pools(network: RoamingNetwork, ...numbers: number[]): string[] {

    const operator = (get(network.effectiveContent, 'chargingStationOperators') as JSONObject[]).find(item => item['@id'] === 'DE*GEF')!;
    const lines: string[] = [];

    for (const pool of (get(operator, 'chargingPools') as JSONObject[] | undefined) ?? [])
        if (numbers.some(n => pool['@id'] === `DE*GEF*P${n}`))
            for (const station of get(pool, 'chargingStations') as JSONObject[])
                lines.push(`${String(station['@id'])} ${Number(station['maxPower']) / 1000} kW: ` +
                           (get(station, 'EVSEs') as JSONObject[]).map(evse => `${String(evse['@id'])} ${String((evse['currentTypes'] as string[])[0])} ${Number(evse['maxPower']) / 1000} kW`).join(', '));

    return lines;

}


describe('Example A2: the charging station operator DE*GEF', () => {

    it('finds DE*GEF in QA with the keys it sent, and none other', () => {

        const sent     = readJSON('DE-GEF/operator.json') as JSONObject;
        const gef      = head.network.chargingStationOperator('DE*GEF')!;
        const keyIds   = (value: unknown) => POIPublicKey.parseAll(value as JSONArray, 'keys').map(key => key.id).sort();

        expect(keyIds(gef['signingKeys'])).toEqual(keyIds(sent['signingKeys']));
        expect(keyIds(gef['identityKeys'])).toEqual(keyIds(sent['identityKeys']));

    });

    it('refuses the change set adding DE*GEF as long as only its identity keys signed it', () => {

        // The change set as DE*GEF sent it: signed by its two identity keys, the proof that it holds them. Adding a party is
        // the roaming network operator's: two of its holders must sign it as well.
        const genesis  = readJSON('published/QA-genesis.json') as JSONObject;
        const before   = RoamingNetwork.parse(genesis['roamingNetwork']);
        const sent     = ChangeSet.parse(readJSON('DE-GEF/addGEF.json'));

        expect(sent.signatures).toHaveLength(2);
        expect(() => applyChangeSet(before, sent)).toThrow("Change 0: Add of the ChargingStationOperator 'DE*GEF' needs signatures by signing keys of 2 holders of the roaming network operator 'OCC'!");

        // As committed, signed by AlphaOrg and BetaOrg as well, it applies, and leads to the version of revision 1.
        const committed = Commit.parse((commits('published/QA-commits-since-genesis.json'))[0]);
        const after     = applyChangeSet(before, ChangeSet.parse(committed.changeSet));
        expect(after.matchesCommitETags(committed.eTags)).toBe(true);

        // Without the signatures of the identity keys of DE*GEF, there is no proof of possession.
        const withoutProof = clone(committed.changeSet!);
        withoutProof['signatures'] = (withoutProof['signatures'] as JSONObject[]).filter(signature => signature['algorithm'] === 'ES256');
        expect(() => applyChangeSet(before, ChangeSet.parse(withoutProof))).toThrow(/no proof of possession/);

    });

});


describe('Example A3: two pools, their templates and their groups', () => {

    it('shows the pools of DE*GEF as they are at runtime, with what their templates give them', () => {

        expect(pools(head.network, 1, 2)).toEqual([
            'DE*GEF*S1 300 kW: DE*GEF*E1*1 DC 150 kW, DE*GEF*E1*2 DC 150 kW',
            'DE*GEF*S2 44 kW: DE*GEF*E2*1 AC_ThreePhases 22 kW, DE*GEF*E2*2 AC_ThreePhases 22 kW',
            'DE*GEF*S3 300 kW: DE*GEF*E3*1 DC 150 kW, DE*GEF*E3*2 DC 150 kW',
            'DE*GEF*S4 44 kW: DE*GEF*E4*1 AC_ThreePhases 22 kW, DE*GEF*E4*2 AC_ThreePhases 22 kW',
        ]);

        const gef = head.network.chargingStationOperator('DE*GEF')!;
        expect((gef['chargingStationGroups'] as JSONObject[]).map(group => `${String(group['@id'])} ${(group['chargingStationIds'] as string[]).join(', ')}`))
            .toEqual([ 'DE*GEF*SG_AC DE*GEF*S2, DE*GEF*S4', 'DE*GEF*SG_DC DE*GEF*S1, DE*GEF*S3' ]);

    });

    it('refuses a pool signed by another key than the infrastructure key of DE*GEF', () => {

        const all     = commits('published/QA-commits-since-genesis.json');
        const history = History.fromSnapshot(readJSON('published/QA-genesis.json'), byOperator);
        history.append(all[0]!);
        history.append(all[1]!);

        // The commit of revision 3 with the signature of its change set claimed by the key of DE*GEF for its tariffs.
        const pool       = clone(Commit.parse(all[2]!).changeSet!);
        const signature  = (pool['signatures'] as JSONObject[])[0]!;
        signature['keyId'] = 'dd96810e7afc8df0a87489ff9c23d0026c7c1cba61494ba6d26ebe05d0a6b0c7';
        expect(() => applyChangeSet(history.head.network, ChangeSet.parse(pool))).toThrow(/is invalid/);

        // Unsigned, it needs a signature of DE*GEF.
        pool['signatures'] = [];
        expect(() => applyChangeSet(history.head.network, ChangeSet.parse(pool))).toThrow("Change 0: Add of the ChargingPool 'DE*GEF*P1' needs a signature by a signing key of the ChargingStationOperator 'DE*GEF'!");

    });

});


describe('Example A4: the first checkpoint, and joining from it', () => {

    it('checks checkpoint 0, joins from its snapshot and takes the commits since', () => {

        const checkpoint0 = checkpoint(0);
        expect(verifyCheckpointSignatures(checkpoint0, trust).signedBy).toEqual([ 'AlphaOrg', 'BetaOrg', 'GammaOrg' ]);
        expect(checkpoint0.revision).toBe(6);
        expect(checkpoint0.commits.size).toBe(7);

        const joined = History.fromSnapshot(readJSON('published/QA-checkpoint-0-snapshot.json'), byOperator);
        expect(joined.head.commit.id).toBe(checkpoint0.commitId);
        expect(joined.checkpoints).toHaveLength(1);

        for (const commit of commits('published/QA-commits-since-checkpoint-0.json'))
            joined.append(commit);

        expect(joined.head.commit.revision).toBe(8);
        expect(joined.head.commit.id).toBe(checkpoint(1).commitId);

        expect(pools(joined.head.network, 3, 4)).toEqual([
            'DE*GEF*S5 300 kW: DE*GEF*E5*1 DC 150 kW, DE*GEF*E5*2 DC 150 kW',
            'DE*GEF*S6 44 kW: DE*GEF*E6*1 AC_ThreePhases 22 kW, DE*GEF*E6*2 AC_ThreePhases 22 kW',
            'DE*GEF*S7 300 kW: DE*GEF*E7*1 DC 150 kW, DE*GEF*E7*2 DC 150 kW',
            'DE*GEF*S8 44 kW: DE*GEF*E8*1 AC_ThreePhases 22 kW, DE*GEF*E8*2 AC_ThreePhases 22 kW',
        ]);

    });

    it('proves the commit of revision 3 to be part of checkpoint 0, and refuses what is changed', () => {

        const checkpoint0 = checkpoint(0);
        const proof       = CheckpointProof.parse(readJSON('published/QA-proof-revision-3.json'));

        expect(proof.revision).toBe(3);
        proof.verify(checkpoint0);

        // A checkpoint of another revision: its @id is no longer the digest of its content.
        const changedCheckpoint = clone(readJSON('published/QA-checkpoint-0.json') as JSONObject);
        changedCheckpoint['revision'] = 5;
        expect(() => Checkpoint.parse(changedCheckpoint)).toThrow(/The checkpoint identification '38c1d4bbb34bc699f8dcf9a425475406b034b5cb721d39b732251eb60337e861' is not the one of its content, '34a3eb227337ede5d83687198dd90393b63fda4012b4d98da2441133bad9f237'!/);

        // A version of the checkpoint changed: it does not lead to the ETags of the checkpoint.
        const changedSnapshot = parseJSON(readText('published/QA-checkpoint-0-snapshot.json').replace('"en": "Jena Paradies"', '"en": "Jena Paradies, moved"'));
        expect(() => History.fromSnapshot(changedSnapshot, byOperator)).toThrow(/The JSON ETag|json ETag \(sha256\) differs/);

        // A proof of another position: it leads to another root.
        const changedProof = clone(readJSON('published/QA-proof-revision-3.json') as JSONObject);
        changedProof['@index'] = 4;
        expect(() => CheckpointProof.parse(changedProof).verify(checkpoint0)).toThrow('The proof does not lead to the commits of the checkpoint!');

    });

});


describe('Example A5: a correction between two checkpoints', () => {

    it('checks the line of checkpoints, and the AC stations at every checkpoint, commit by commit', () => {

        const line = [ checkpoint(0), checkpoint(1), checkpoint(2) ];
        verifyCheckpointLine(line);
        expect(line.map(item => item.revision)).toEqual([ 6, 8, 9 ]);

        const history = History.fromSnapshot(readJSON('published/QA-checkpoint-0-snapshot.json'), byOperator);
        expect(pools(history.head.network, 3, 4)).toEqual([]);

        for (const commit of [ ...commits('published/QA-commits-since-checkpoint-0.json'), ...commits('published/QA-commits-since-checkpoint-1.json') ])
            history.append(commit);

        history.takeCheckpoint(line[1]!);
        history.takeCheckpoint(line[2]!);
        expect(history.checkpoints).toHaveLength(3);

        expect(pools(history.head.network, 3, 4)).toEqual([
            'DE*GEF*S5 300 kW: DE*GEF*E5*1 DC 150 kW, DE*GEF*E5*2 DC 150 kW',
            'DE*GEF*S6 22 kW: DE*GEF*E6*1 AC_ThreePhases 11 kW, DE*GEF*E6*2 AC_ThreePhases 11 kW',
            'DE*GEF*S7 300 kW: DE*GEF*E7*1 DC 150 kW, DE*GEF*E7*2 DC 150 kW',
            'DE*GEF*S8 22 kW: DE*GEF*E8*1 AC_ThreePhases 11 kW, DE*GEF*E8*2 AC_ThreePhases 11 kW',
        ]);

    });

    it('joins from each checkpoint on its own, and proves commits in them', () => {

        const fromOne = History.fromSnapshot(readJSON('published/QA-checkpoint-1-snapshot.json'), byOperator);
        expect(pools(fromOne.head.network, 3)[1]).toBe('DE*GEF*S6 44 kW: DE*GEF*E6*1 AC_ThreePhases 22 kW, DE*GEF*E6*2 AC_ThreePhases 22 kW');

        const fromTwo = History.fromSnapshot(readJSON('published/QA-checkpoint-2-snapshot.json'), byOperator);
        expect(pools(fromTwo.head.network, 3)[1]).toBe('DE*GEF*S6 22 kW: DE*GEF*E6*1 AC_ThreePhases 11 kW, DE*GEF*E6*2 AC_ThreePhases 11 kW');

        CheckpointProof.parse(readJSON('published/QA-proof-revision-7.json')).verify(checkpoint(1));
        CheckpointProof.parse(readJSON('published/QA-proof-revision-9.json')).verify(checkpoint(2));

        expect(() => CheckpointProof.parse(readJSON('published/QA-proof-revision-9.json')).verify(checkpoint(1)))
            .toThrow("The proof is for the checkpoint 'df9d6417ecd0bd911dd7383786660d5a76d2a9ef29158c8c65bec21de1cd0df5', not for '0526089b950c12f3907b54636bd4516e36e4e913abbb481a40388d5948b9750b'!");

        // Checkpoint 2 without checkpoint 1: it does not follow the latest one taken.
        const history = History.fromSnapshot(readJSON('published/QA-checkpoint-0-snapshot.json'), byOperator);
        for (const commit of [ ...commits('published/QA-commits-since-checkpoint-0.json'), ...commits('published/QA-commits-since-checkpoint-1.json') ])
            history.append(commit);
        expect(() => history.takeCheckpoint(checkpoint(2)))
            .toThrow("The checkpoint does not follow the latest checkpoint '38c1d4bbb34bc699f8dcf9a425475406b034b5cb721d39b732251eb60337e861' of the sequence 0 here!");

    });

});


describe('Example A6: witnesses sign the checkpoints', () => {

    it('takes the history from its genesis, commit by commit, and the three checkpoints, as a witness does', () => {

        const witness = History.fromSnapshot(readJSON('published/QA-genesis.json'), byOperator);

        for (const commit of commits('published/QA-commits-since-genesis.json'))
            witness.append(commit);

        for (const sequence of [ 0, 1, 2 ])
            witness.takeCheckpoint(checkpoint(sequence));

        expect(witness.head.commit.revision).toBe(9);
        expect(witness.checkpoints).toHaveLength(3);

        // Another checkpoint 2, made for another view of the history: a split view.
        const other = clone(readJSON('published/QA-checkpoint-2.json') as JSONObject);
        other['createdAt'] = '2026-10-24T03:35:58.000Z';
        delete other['signatures'];
        const content  = { ...other };
        delete content['@id'];
        other['@id']   = (sha256Hex(canonicalJSON({ ...content, '@context': 'https://open.charging.cloud/contexts/wwcp/roamingNetwork/checkpoint/v1' })));
        expect(() => witness.takeCheckpoint(other)).toThrow('This history has another checkpoint of the sequence 2: two checkpoints of one sequence are a split view!');

    });

    it('requires the roaming network operator and both witnesses, each with the key trusted for it', () => {

        for (const sequence of [ 0, 1, 2 ]) {
            const signatures = verifyCheckpointSignatures(checkpoint(sequence), trust, { witnesses, requiredWitnesses: 2 });
            expect(signatures.signedBy).toEqual([ 'AlphaOrg', 'BetaOrg', 'GammaOrg' ]);
            expect(signatures.witnessedBy).toEqual([ 'calibration.example', 'association.example' ]);
        }

        // Joined from checkpoint 2, signed by the roaming network operator and its witnesses.
        const snapshot = clone(readJSON('published/QA-checkpoint-2-snapshot.json') as JSONObject);
        snapshot['checkpoint'] = readJSON('published/QA-checkpoint-2.json');
        expect(History.fromSnapshot(snapshot, byOperatorAndWitnesses).head.commit.revision).toBe(9);

        // The proof of revision 7 in checkpoint 1 is witnessed evidence.
        CheckpointProof.parse(readJSON('published/QA-proof-revision-7.json')).verify(checkpoint(1));

        // Checkpoint 2 without its witnesses.
        const withoutWitnesses = clone(readJSON('published/QA-checkpoint-2.json') as JSONObject);
        withoutWitnesses['signatures'] = (withoutWitnesses['signatures'] as JSONObject[]).filter(signature => signature['role'] !== 'witness');
        expect(() => verifyCheckpointSignatures(Checkpoint.parse(withoutWitnesses), trust, { witnesses, requiredWitnesses: 2 })).toThrow(/signed by 0 of the trusted witnesses/);

        // A signature of calibration.example by another key: it does not count.
        const otherKey = clone(readJSON('published/QA-checkpoint-2.json') as JSONObject);
        const witnessSignature = (otherKey['signatures'] as JSONObject[]).find(signature => signature['signer'] === 'calibration.example')!;
        witnessSignature['keyId'] = '52ceb36c8fec2e9691556acd5fc4441c1504d5a07767cccb6150ef78d701c93c';
        expect(() => verifyCheckpointSignatures(Checkpoint.parse(otherKey), trust, { witnesses, requiredWitnesses: 2 })).toThrow(/signed by 1 of the trusted witnesses/);

    });

});


describe('Example A7: compaction with an archive, after the checkpoints', () => {

    it('gives the versions of each segment again, its end the commit of its checkpoint', () => {

        const infos = (readJSON('published/QA-archive.json') as JSONArray).map(parseArchiveSegmentInfo);
        verifySegmentLine(infos);
        expect(infos.map(info => `${info.number}: revisions ${info.fromRevision} to ${info.toRevision}`)).toEqual([ '1: revisions 0 to 6', '2: revisions 6 to 8' ]);

        for (const [number, sequence] of [ [ 1, 0 ], [ 2, 1 ] ] as const) {
            const segment = ArchiveSegment.parse(readJSON(`published/QA-archive-${number}.json`));
            const history = segment.replay(byOperator);
            segment.verifyAgainst(checkpoint(sequence), history);
        }

        // The proof of revision 3, from the archive, in checkpoint 0.
        CheckpointProof.parse(readJSON('published/QA-proof-revision-3-archived.json')).verify(checkpoint(0));

    });

    it('refuses a segment with a commit changed, and one with another base', () => {

        const changedCommit = clone(readJSON('published/QA-archive-2.json') as JSONObject);
        ((changedCommit['commits'] as JSONObject[])[0]!)['revision'] = 8;
        expect(() => ArchiveSegment.parse(changedCommit).replay(byOperator)).toThrow(/is not the one of its content/);

        const otherBase = parseJSON(readText('published/QA-archive-2.json').replace('"en": "Jena Nord"', '"en": "Jena Nord, moved"'));
        expect(() => ArchiveSegment.parse(otherBase).replay(byOperator)).toThrow(/ETag/);

    });

});


describe('Example A8: price statements, named by checkpoints', () => {

    it('checks the checkpoints 3 and 4, and the price statements checkpoint 4 names', () => {

        const line = [ checkpoint(2), checkpoint(3), checkpoint(4) ];
        verifyCheckpointLine(line);

        const statements = parsePriceStatements(readJSON('published/QA-checkpoint-4-priceStatements.json'));
        expect(statements).toHaveLength(3);

        verifyCheckpointPriceStatements(line[2]!, statements);

        const gef          = head.network.chargingStationOperator('DE*GEF')!;
        const signingKeys  = POIPublicKey.parseAll(gef['signingKeys'], 'signing keys');
        for (const statement of statements) {
            statement.verify('QA', 'DE*GEF', signingKeys);
            expect(statement.after).toBe(line[1]!.id);
        }

        // The current statement of DE*GEF*E1*1: sequence 1, 0.79 €/kWh, after checkpoint 3, valid now.
        const current = PriceStatement.parse((readJSON('published/QA-priceStatements-DE_GEF_E1_1.json') as JSONArray)[0]);
        current.verify('QA', 'DE*GEF', signingKeys);
        expect(current.sequence).toBe(1);
        expect(current.isValidAt(Date.parse(AT))).toBe(true);
        expect(current.follows(statements.find(statement => statement.entityId === 'DE*GEF*E1*1' && statement.sequence === 0)!)).toBe(true);

        // The proof of DE*GEF*E1*1, sequence 0, in checkpoint 4.
        const proof = PriceStatementProof.parse(readJSON('published/QA-priceStatementProof-E1_1-0.json'));
        proof.verify(line[2]!);
        proof.priceStatement.verify('QA', 'DE*GEF', signingKeys);

        // Joined with a statement less, or with a statement of another price.
        expect(() => verifyCheckpointPriceStatements(line[2]!, statements.slice(1))).toThrow(/are not those the checkpoint/);

        const changed = readText('published/QA-checkpoint-4-priceStatements.json').replace('"price": 0.59', '"price": 0.49');
        const other   = parsePriceStatements(parseJSON(changed));
        expect(() => other[0]!.verify('QA', 'DE*GEF', signingKeys)).toThrow('The signature of the price statement is invalid: The signature is invalid!');

        // A statement signed by the infrastructure key would be refused: that key may not sign price statements.
        const infrastructureKey = signingKeys.find(key => key.usages.includes('infrastructure'))!;
        expect(infrastructureKey.maySign('priceStatements')).toBe(false);

    });

    it('joins from checkpoint 4 with its price statements', () => {

        const joined = History.fromSnapshot(readJSON('published/QA-checkpoint-4-snapshot.json'), byOperator);
        expect(joined.head.commit.revision).toBe(12);
        verifyCheckpointPriceStatements(joined.checkpoints[0]!, parsePriceStatements(readJSON('published/QA-checkpoint-4-priceStatements.json')));

    });

});


describe('Example A9: witnesses check the price statements', () => {

    it('finds checkpoints 3 and 4 signed by both witnesses, and the proof of a price statement witnessed evidence', () => {

        for (const sequence of [ 3, 4 ])
            expect(verifyCheckpointSignatures(checkpoint(sequence), trust, { witnesses, requiredWitnesses: 2 }).witnessedBy)
                .toEqual([ 'calibration.example', 'association.example' ]);

        // A witness going on with its copy of the history: the commits of A8, then the checkpoints 3 and 4 with their
        // price statements checked.
        const witness = History.fromSnapshot(readJSON('published/QA-genesis.json'), byOperator);
        for (const commit of [ ...commits('published/QA-commits-since-genesis.json'), ...commits('published/QA-commits-since-checkpoint-2.json') ])
            witness.append(commit);
        for (const sequence of [ 0, 1, 2, 3, 4 ])
            witness.takeCheckpoint(checkpoint(sequence));

        verifyCheckpointPriceStatements(witness.checkpoints[4]!, parsePriceStatements(readJSON('published/QA-checkpoint-4-priceStatements.json')));

        const proof = PriceStatementProof.parse(readJSON('published/QA-priceStatementProof-E1_1-0.json'));
        proof.verify(witness.checkpoints[4]!);

    });

});

