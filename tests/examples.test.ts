import { describe, expect, it } from 'vitest';

import { AT, asText, defined, readJSON, readText } from './helpers.ts';
import { anchor, byOperator, byOperatorAndWitnesses, checkpoint, commits, trust, witnesses } from './qa.ts';

import { RoamingNetwork }        from '../src/network/roamingNetwork.ts';
import { Commit }                from '../src/history/commit.ts';
import { ChangeSet, changeSetIdentification } from '../src/history/changeSet.ts';
import { applyChangeSet }        from '../src/history/apply.ts';
import { Checkpoint, CheckpointProof } from '../src/history/checkpoint.ts';
import { History }               from '../src/history/history.ts';
import { ArchiveSegment, parseArchiveSegmentInfo, verifySegmentLine } from '../src/history/archive.ts';
import { POIPublicKey }          from '../src/keys.ts';
import { PriceStatement, PriceStatementProof, parsePriceStatements, verifyCheckpointPriceStatements } from '../src/proofs/priceStatement.ts';
import { verifyVersion }         from '../src/verifier/version.ts';
import { verifyCheckpointLine, verifyCheckpointSignatures } from '../src/verifier/checkpoints.ts';
import { canonicalJSON }         from '../src/json/canonical.ts';
import { parseJSON }             from '../src/json/parse.ts';
import { clone, get, without, type JSONArray, type JSONObject } from '../src/json/value.ts';
import { hash }                  from '../src/crypto/hash.ts';
import { toHex }                 from '../src/encoding/text.ts';


const sha256Hex = (text: string): string =>
    toHex(hash('sha256', new TextEncoder().encode(text)));


// The examples A2 to A9 of WWCP_POI, checked from what the C# implementation published, as their Validate() methods do.
// They are of epoch 1; QA as A8 and A9 left it, revision 13, is the version of checkpoint 4.

const snapshot4  = readJSON('published/QA-checkpoint-4-snapshot.json') as JSONObject;
const head       = verifyVersion(anchor, defined(snapshot4['roamingNetwork']), defined(snapshot4['commit']), AT);

/** The pools of DE*GEF as they are at runtime: each station with its power and those of its EVSEs, in kW. */
function pools(network: RoamingNetwork, ...numbers: number[]): string[] {

    const operator = defined((get(network.effectiveContent, 'chargingStationOperators') as JSONObject[]).find(item => item['@id'] === 'DE*GEF'));
    const lines: string[] = [];

    for (const pool of (get(operator, 'chargingPools') as JSONObject[] | undefined) ?? [])
        if (numbers.some(n => pool['@id'] === `DE*GEF*P${n}`))
            for (const station of get(pool, 'chargingStations') as JSONObject[])
                lines.push(`${asText(station['@id'])} ${Number(station['maxPower']) / 1000} kW: ` +
                           (get(station, 'EVSEs') as JSONObject[]).map(evse => `${asText(evse['@id'])} ${String((evse['currentTypes'] as string[])[0])} ${Number(evse['maxPower']) / 1000} kW`).join(', '));

    return lines;

}


describe('Example A2: the charging station operator DE*GEF and the manufacturers of its stations and meters', () => {

    it('finds DE*GEF in QA with the keys it sent, and none other, and the manufacturers added with it', () => {

        const sent     = readJSON('DE-GEF/operator.json') as JSONObject;
        const gef      = defined(head.network.chargingStationOperator('DE*GEF'));
        const keyIds   = (value: unknown): string[] => POIPublicKey.parseAll(value as JSONArray, 'keys').map(key => key.id).sort();

        expect(keyIds(gef['signingKeys'])).toEqual(keyIds(sent['signingKeys']));
        expect(keyIds(gef['identityKeys'])).toEqual(keyIds(sent['identityKeys']));
        expect(POIPublicKey.parseAll(gef['signingKeys'], 'keys').map(key => `${key.id} for ${key.usages.join(', ')}`)).toEqual([
            '5b01e325c84a23cf22931f3c9306cd196bf02988647b2b65272cd55cc595aea5 for party',
            '7d497d32997732a58dbc993bcb86bf0834095ec1b85cba9e5e7acb2ff8c8e616 for infrastructure',
            'baecd4ef7e9b059569e01369c8807438856b89b8e2b32d84cc68b0f6319ff986 for priceStatements, tariffs',
        ]);

        // The manufacturers with the models they stated, as C# printed them.
        const names = (property: string, models: string, model: (item: JSONObject) => string): string[] =>
            (get(head.network.content, property) as JSONObject[]).map(item => `${asText(item['@id'])}: ${asText((item['name'] as JSONObject)['en'])}, models ` +
                                                                              (get(item, models) as JSONObject[]).map(model).join(', '));
        expect(names('chargingStationManufacturers', 'chargingStationModels', model => `${asText(model['@id'])} (${Number(model['maxPower']) / 1000} kW, versions ${(model['versions'] as string[]).join('/')})`))
            .toEqual([ 'GraphDefined: GraphDefined Charging Stations, models GD-AC44 (44 kW, versions 1.0), GD-DC300 (300 kW, versions 1.0/1.1)' ]);
        expect(names('energyMeterManufacturers', 'energyMeterModels', model => `${asText(model['@id'])} (class ${asText(model['accuracyClass'])}, ${(model['signatureMethods'] as string[]).join(', ')})`))
            .toEqual([ 'KERNBERG: Kernberg DC Metering, models KDM-500 (class B, OCMF)', 'SAALE: Saale Metering, models SM-3 (class B, OCMF)' ]);

    });

    it('refuses the change set adding DE*GEF as long as only its identity keys signed it', () => {

        // The change set as DE*GEF sent it: signed by its two identity keys and by the one of each manufacturer, the proof
        // that they hold them. Adding parties is the roaming network operator's: two of its holders must sign it as well.
        const genesis  = readJSON('published/QA-genesis.json') as JSONObject;
        const before   = RoamingNetwork.parse(genesis['roamingNetwork']);
        const sent     = ChangeSet.parse(readJSON('DE-GEF/addGEF.json'));

        expect(sent.signatures.map(signature => signature.algorithm)).toEqual([ 'ES512', 'Ed448', 'ES512', 'ES512', 'ES512' ]);
        expect(sent.changes.map(change => `${change.kind} ${change.entityType} ${change.entityId}`)).toEqual([
            'Add ChargingStationOperator DE*GEF', 'Add ChargingStationManufacturer GraphDefined', 'Add EnergyMeterManufacturer SAALE', 'Add EnergyMeterManufacturer KERNBERG',
        ]);
        expect(() => applyChangeSet(before, sent)).toThrow("Change 0: Add of the ChargingStationOperator 'DE*GEF' needs signatures by signing keys of 2 holders of the roaming network operator 'OCC'!");

        // As committed, signed by AlphaOrg and BetaOrg as well, it applies, and leads to the version of revision 1.
        const committed = Commit.parse((commits('published/QA-commits-since-genesis.json'))[0]);
        const after     = applyChangeSet(before, ChangeSet.parse(committed.changeSet));
        expect(after.matchesCommitETags(committed.eTags)).toBe(true);
        expect(committed.id).toBe('7d3a82ad3cdd2bcce52cad94bd341e5bc80e11134db20c203f56a991420ceaf8');

        // Without the signatures of the identity keys of DE*GEF, there is no proof of possession.
        const withoutProof = clone(defined(committed.changeSet));
        withoutProof['signatures'] = (withoutProof['signatures'] as JSONObject[]).filter(signature => signature['algorithm'] === 'ES256');
        expect(() => applyChangeSet(before, ChangeSet.parse(withoutProof))).toThrow(/no proof of possession/);

    });

    it('takes the models each manufacturer stated with its key for models, and refuses them otherwise', () => {

        const all      = commits('published/QA-commits-since-genesis.json');
        const history  = History.fromSnapshot(readJSON('published/QA-genesis.json'), byOperator);
        history.append(defined(all[0]));

        const before   = history.head.network;
        const models   = Commit.parse(all[1]);
        expect(models.revision).toBe(2);
        expect(models.id).toBe('92bcffd9be95aa881cba63a82c4a7e83ebfafabc501447148fa501c196adb599');
        expect(ChangeSet.parse(models.changeSet).changes.map(change => `${change.kind} ${change.entityType} ${change.entityId} of ${change.parentEntityId ?? ''}`)).toEqual([
            'Add ChargingStationModel GD-DC300 of GraphDefined', 'Add ChargingStationModel GD-AC44 of GraphDefined', 'Add EnergyMeterModel KDM-500 of KERNBERG', 'Add EnergyMeterModel SM-3 of SAALE',
        ]);

        // Signed by the key for models of each manufacturer, by no key of the roaming network operator.
        const modelsKeyOf = (manufacturers: string, id: string): string =>
            defined(POIPublicKey.parseAll(get(defined((get(before.content, manufacturers) as JSONObject[]).find(item => item['@id'] === id)), 'signingKeys'), 'signing keys').find(key => key.usages.includes('models'))).id;
        const keys = [ modelsKeyOf('chargingStationManufacturers', 'GraphDefined'), modelsKeyOf('energyMeterManufacturers', 'KERNBERG'), modelsKeyOf('energyMeterManufacturers', 'SAALE') ];
        expect(ChangeSet.parse(models.changeSet).signatures.map(signature => signature.keyId)).toEqual(keys);
        expect(applyChangeSet(before, ChangeSet.parse(models.changeSet)).matchesCommitETags(models.eTags)).toBe(true);

        // Without the signature of GraphDefined: as C# refuses the models signed by the roaming network operator only, which
        // does not state them in the place of a manufacturer with signing keys.
        const withoutGraphDefined = clone(defined(models.changeSet));
        withoutGraphDefined['signatures'] = (withoutGraphDefined['signatures'] as JSONObject[]).filter(signature => signature['keyId'] !== keys[0]);
        expect(() => applyChangeSet(before, ChangeSet.parse(withoutGraphDefined))).toThrow("Change 0: Add of the ChargingStationModel 'GD-DC300' needs a signature by a signing key of the ChargingStationManufacturer 'GraphDefined'!");

        // A model is unique within its manufacturer only: every change of it names the manufacturer. Changed, a change set
        // is identified anew by its content (4).
        const withoutParent = clone(defined(models.changeSet));
        withoutParent['signatures'] = [];
        delete defined((withoutParent['changes'] as JSONObject[])[0])['parentEntityType'];
        delete defined((withoutParent['changes'] as JSONObject[])[0])['parentEntityId'];
        withoutParent['@id'] = changeSetIdentification(withoutParent);
        expect(() => applyChangeSet(before, ChangeSet.parse(withoutParent))).toThrow("Change 0: the ChargingStationModel 'GD-DC300' needs its ChargingStationManufacturer as its parent!");

        // Nor are the models changed as a property of their manufacturer, by a key that may not sign them.
        const asProperty = clone(defined(models.changeSet));
        asProperty['changes'] = [ { kind: 'UpdateProperty', entityType: 'ChargingStationManufacturer', entityId: 'GraphDefined', propertyName: 'chargingStationModels', newValue: [] } ];
        asProperty['@id']     = changeSetIdentification(asProperty);
        expect(() => applyChangeSet(before, ChangeSet.parse(asProperty), { checkOwnership: false })).toThrow("Change 0: the property 'chargingStationModels' of a charging station manufacturer can not be changed!");

    });

});


describe('Example A3: two pools, their templates, their energy meters and their groups', () => {

    it('shows the pools of DE*GEF as they are at runtime, with what their templates give them', () => {

        expect(pools(head.network, 1, 2)).toEqual([
            'DE*GEF*S1 300 kW: DE*GEF*E1*1 DC 150 kW, DE*GEF*E1*2 DC 150 kW',
            'DE*GEF*S2 44 kW: DE*GEF*E2*1 AC_ThreePhases 22 kW, DE*GEF*E2*2 AC_ThreePhases 22 kW',
            'DE*GEF*S3 300 kW: DE*GEF*E3*1 DC 150 kW, DE*GEF*E3*2 DC 150 kW',
            'DE*GEF*S4 44 kW: DE*GEF*E4*1 AC_ThreePhases 22 kW, DE*GEF*E4*2 AC_ThreePhases 22 kW',
        ]);

        const gef = defined(head.network.chargingStationOperator('DE*GEF'));
        expect((gef['chargingStationGroups'] as JSONObject[]).map(group => `${asText(group['@id'])} ${(group['chargingStationIds'] as string[]).join(', ')}`))
            .toEqual([ 'DE*GEF*SG_AC DE*GEF*S2, DE*GEF*S4', 'DE*GEF*SG_DC DE*GEF*S1, DE*GEF*S3' ]);
        expect((gef['EVSEGroups'] as JSONObject[]).map(group => `${asText(group['@id'])} ${(group['evseIds'] as string[] | undefined ?? group['EVSEIds'] as string[]).join(', ')}`))
            .toEqual([ 'DE*GEF*EG_AC DE*GEF*E2*1, DE*GEF*E2*2, DE*GEF*E4*1, DE*GEF*E4*2', 'DE*GEF*EG_DC DE*GEF*E1*1, DE*GEF*E1*2, DE*GEF*E3*1, DE*GEF*E3*2' ]);

    });

    it('gives every EVSE its energy meter with what its energy meter template gives it, as C# printed them', () => {

        const operator  = defined((get(head.network.effectiveContent, 'chargingStationOperators') as JSONObject[]).find(item => item['@id'] === 'DE*GEF'));
        const meters: string[] = [];

        for (const pool of get(operator, 'chargingPools') as JSONObject[])
            if (pool['@id'] === 'DE*GEF*P1')
                for (const station of get(pool, 'chargingStations') as JSONObject[])
                    for (const evse of get(station, 'EVSEs') as JSONObject[]) {
                        const meter = evse['energyMeter'] as JSONObject;
                        const key   = defined((meter['publicKeys'] as JSONObject[])[0]);
                        meters.push(`${asText(meter['@id'])} ${asText(meter['manufacturerId'])} ${asText(meter['modelId'])}, serial ${asText(meter['serialNumber'])}, ` +
                                    `${(meter['signatureMethods'] as string[]).join(', ')}, key ${asText(key['@id']).slice(0, 8)}`);
                    }

        expect(meters).toEqual([
            'DE*GEF*M1*1 KERNBERG KDM-500, serial DCM-2026-001-1, OCMF, key ab51684c',
            'DE*GEF*M1*2 KERNBERG KDM-500, serial DCM-2026-001-2, OCMF, key 049e6c63',
            'DE*GEF*M2*1 SAALE SM-3, serial ACM-2026-002-1, OCMF, key 51b7a92e',
            'DE*GEF*M2*2 SAALE SM-3, serial ACM-2026-002-2, OCMF, key 0a90e4ff',
        ]);

    });

    it('refuses a pool signed by another key than the infrastructure key of DE*GEF', () => {

        const all     = commits('published/QA-commits-since-genesis.json');
        const history = History.fromSnapshot(readJSON('published/QA-genesis.json'), byOperator);
        history.append(defined(all[0]));
        history.append(defined(all[1]));
        history.append(defined(all[2]));

        // The commit of revision 4 with the signature of its change set claimed by the key of DE*GEF for its tariffs.
        const pool       = clone(defined(Commit.parse(all[3]).changeSet));
        const signature  = defined((pool['signatures'] as JSONObject[])[0]);
        signature['keyId'] = 'baecd4ef7e9b059569e01369c8807438856b89b8e2b32d84cc68b0f6319ff986';
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
        expect(checkpoint0.id).toBe('aac0abbbc490ae299c94abbe5b3ace917d0a6192cea19a01a4e253c25a986961');
        expect(checkpoint0.revision).toBe(7);
        expect(checkpoint0.commits.size).toBe(8);

        const joined = History.fromSnapshot(readJSON('published/QA-checkpoint-0-snapshot.json'), byOperator);
        expect(joined.head.commit.id).toBe(checkpoint0.commitId);
        expect(joined.checkpoints).toHaveLength(1);

        for (const commit of commits('published/QA-commits-since-checkpoint-0.json'))
            joined.append(commit);

        expect(joined.head.commit.revision).toBe(9);
        expect(joined.head.commit.id).toBe('604cab1aca16afd4daf3d257a7ba66f6c495c913455f466fe38665be5b0b5207');

        expect(pools(joined.head.network, 3, 4)).toEqual([
            'DE*GEF*S5 300 kW: DE*GEF*E5*1 DC 150 kW, DE*GEF*E5*2 DC 150 kW',
            'DE*GEF*S6 44 kW: DE*GEF*E6*1 AC_ThreePhases 22 kW, DE*GEF*E6*2 AC_ThreePhases 22 kW',
            'DE*GEF*S7 300 kW: DE*GEF*E7*1 DC 150 kW, DE*GEF*E7*2 DC 150 kW',
            'DE*GEF*S8 44 kW: DE*GEF*E8*1 AC_ThreePhases 22 kW, DE*GEF*E8*2 AC_ThreePhases 22 kW',
        ]);

    });

    it('proves the commit of revision 4 to be part of checkpoint 0, and refuses what is changed, as C# does', () => {

        const checkpoint0 = checkpoint(0);
        const proof       = CheckpointProof.parse(readJSON('published/QA-proof-revision-4.json'));

        expect(proof.revision).toBe(4);
        proof.verify(checkpoint0);

        // A checkpoint of another revision: its @id is no longer the digest of its content.
        const changedCheckpoint = clone(readJSON('published/QA-checkpoint-0.json') as JSONObject);
        changedCheckpoint['revision'] = 5;
        expect(() => Checkpoint.parse(changedCheckpoint)).toThrow("The checkpoint identification 'aac0abbbc490ae299c94abbe5b3ace917d0a6192cea19a01a4e253c25a986961' is not the one of its content, 'b842c907ffdf60f17dd85a9a9168cd5342494dfe43210d7135276097b2fb5a26'!");

        // A version of the checkpoint changed: it does not lead to the ETags of the checkpoint.
        const changedSnapshot = parseJSON(readText('published/QA-checkpoint-0-snapshot.json').replace('"en": "Jena Paradies"', '"en": "Jena Paradies, moved"'));
        expect(() => History.fromSnapshot(changedSnapshot, byOperator)).toThrow(/The JSON ETag|json ETag \(sha256\) differs/);

        // A proof of another position: it leads to another root.
        const changedProof = clone(readJSON('published/QA-proof-revision-4.json') as JSONObject);
        changedProof['@index'] = 5;
        expect(() => { CheckpointProof.parse(changedProof).verify(checkpoint0); }).toThrow('The proof does not lead to the commits of the checkpoint!');

    });

    it('finds epoch 1 named by its checkpoints, not by its commits, and refuses the other forms, as C# does', () => {

        // Every checkpoint names its epoch, a commit only from the second one on (SPECIFICATION.md 5.1, 10.1, 11).
        const checkpoint0 = readJSON('published/QA-checkpoint-0.json') as JSONObject;
        const revision1   = commits('published/QA-commits-since-genesis.json')[0] as JSONObject;

        const checkpoint  = Checkpoint.parse(checkpoint0);
        const commit      = Commit.parse(revision1);

        expect(checkpoint0['epoch']).toBe(1);
        expect(checkpoint.epoch).toBe(1);
        expect(get(revision1, 'epoch')).toBeUndefined();
        expect(commit.epoch).toBe(1);

        expect(() => Checkpoint.parse(without(checkpoint0, 'epoch')))
            .toThrow(`The epoch of the checkpoint '${checkpoint.id}' must be a whole number from 1 to 4294967295!`);
        expect(() => Commit.parse({ ...revision1, epoch: 1 }))
            .toThrow(`The epoch of the commit '${commit.id}' must be a whole number from 2 to 9007199254740991!`);

    });

});


describe('Example A5: a correction between two checkpoints', () => {

    it('checks the line of checkpoints, and the AC stations at every checkpoint, commit by commit', () => {

        const line = [ checkpoint(0), checkpoint(1), checkpoint(2) ];
        verifyCheckpointLine(line);
        expect(line.map(item => item.revision)).toEqual([ 7, 9, 10 ]);

        const history = History.fromSnapshot(readJSON('published/QA-checkpoint-0-snapshot.json'), byOperator);
        expect(pools(history.head.network, 3, 4)).toEqual([]);

        for (const commit of [ ...commits('published/QA-commits-since-checkpoint-0.json'), ...commits('published/QA-commits-since-checkpoint-1.json') ])
            history.append(commit);

        history.takeCheckpoint(defined(line[1]));
        history.takeCheckpoint(defined(line[2]));
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

        CheckpointProof.parse(readJSON('published/QA-proof-revision-8.json')).verify(checkpoint(1));
        CheckpointProof.parse(readJSON('published/QA-proof-revision-10.json')).verify(checkpoint(2));

        expect(() => { CheckpointProof.parse(readJSON('published/QA-proof-revision-10.json')).verify(checkpoint(1)); })
            .toThrow("The proof is for the checkpoint 'f65d4b106aefac5a08469d5eccd1e613e36ac16440637ac3aca46d053b195b13', not for '8d3e9f2b57a3006ea25c6ede506a30756ede4cd1601c3b7f2f6db66003a6b2f8'!");

        // Checkpoint 2 without checkpoint 1: it does not follow the latest one taken.
        const history = History.fromSnapshot(readJSON('published/QA-checkpoint-0-snapshot.json'), byOperator);
        for (const commit of [ ...commits('published/QA-commits-since-checkpoint-0.json'), ...commits('published/QA-commits-since-checkpoint-1.json') ])
            history.append(commit);
        expect(() => history.takeCheckpoint(checkpoint(2)))
            .toThrow("The checkpoint does not follow the latest checkpoint 'aac0abbbc490ae299c94abbe5b3ace917d0a6192cea19a01a4e253c25a986961' of the sequence 0 here!");

    });

});


describe('Example A6: witnesses sign the checkpoints', () => {

    it('takes the history from its genesis, commit by commit, and the three checkpoints, as a witness does', () => {

        const witness = History.fromSnapshot(readJSON('published/QA-genesis.json'), byOperator);

        for (const commit of commits('published/QA-commits-since-genesis.json'))
            witness.append(commit);

        for (const sequence of [ 0, 1, 2 ])
            witness.takeCheckpoint(checkpoint(sequence));

        expect(witness.head.commit.revision).toBe(10);
        expect(witness.checkpoints).toHaveLength(3);

        // Another checkpoint 2, made for another view of the history: a split view.
        const other = clone(readJSON('published/QA-checkpoint-2.json') as JSONObject);
        other['createdAt'] = '2026-10-25T16:25:30.000Z';
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
        expect(History.fromSnapshot(snapshot, byOperatorAndWitnesses).head.commit.revision).toBe(10);

        // The proof of revision 8 in checkpoint 1 is witnessed evidence.
        CheckpointProof.parse(readJSON('published/QA-proof-revision-8.json')).verify(checkpoint(1));

        // Checkpoint 2 without its witnesses.
        const withoutWitnesses = clone(readJSON('published/QA-checkpoint-2.json') as JSONObject);
        withoutWitnesses['signatures'] = (withoutWitnesses['signatures'] as JSONObject[]).filter(signature => signature['role'] !== 'witness');
        expect(() => verifyCheckpointSignatures(Checkpoint.parse(withoutWitnesses), trust, { witnesses, requiredWitnesses: 2 })).toThrow(/signed by 0 of the trusted witnesses/);

        // A signature of calibration.example by the key of another witness: it does not count.
        const otherKey = clone(readJSON('published/QA-checkpoint-2.json') as JSONObject);
        const witnessSignature = defined((otherKey['signatures'] as JSONObject[]).find(signature => signature['signer'] === 'calibration.example'));
        witnessSignature['keyId'] = defined(witnesses.find(witness => witness.witness === 'association.example')).key.id;
        expect(() => verifyCheckpointSignatures(Checkpoint.parse(otherKey), trust, { witnesses, requiredWitnesses: 2 })).toThrow(/signed by 1 of the trusted witnesses/);

    });

});


describe('Example A7: compaction with an archive, after the checkpoints', () => {

    it('gives the versions of each segment again, its end the commit of its checkpoint', () => {

        const infos = (readJSON('published/QA-archive.json') as JSONArray).map(parseArchiveSegmentInfo);
        verifySegmentLine(infos);
        expect(infos.map(info => `${info.number}: revisions ${info.fromRevision} to ${info.toRevision}`)).toEqual([ '1: revisions 0 to 7', '2: revisions 7 to 9' ]);

        for (const [number, sequence] of [ [ 1, 0 ], [ 2, 1 ] ] as const) {
            const segment = ArchiveSegment.parse(readJSON(`published/QA-archive-${number}.json`));
            const history = segment.replay(byOperator);
            segment.verifyAgainst(checkpoint(sequence), history);
        }

        // The proof of revision 4, from the archive, in checkpoint 0.
        CheckpointProof.parse(readJSON('published/QA-proof-revision-4-archived.json')).verify(checkpoint(0));

    });

    it('refuses a segment with a commit changed, and one with another base', () => {

        const changedCommit = clone(readJSON('published/QA-archive-2.json') as JSONObject);
        defined((changedCommit['commits'] as JSONObject[])[0])['revision'] = 17;
        expect(() => ArchiveSegment.parse(changedCommit).replay(byOperator)).toThrow("The commit identification 'bcc98fd2eb7ce4e46841925bce413899b79e48531c8b056b3cf7de79bc70f11b' is not the one of its content, '29da4354a49fa6494cadcc9a72c5ccdb3700c83c87b6c2aad036adca957a7b28'!");

        const otherBase = parseJSON(readText('published/QA-archive-2.json').replace('"en": "Jena Nord"', '"en": "Jena Nord, moved"'));
        expect(() => ArchiveSegment.parse(otherBase).replay(byOperator)).toThrow(/ETag/);

    });

});


describe('Example A8: price statements, named by checkpoints', () => {

    it('checks the checkpoints 3 and 4, and the price statements checkpoint 4 names', () => {

        const line = [ checkpoint(2), checkpoint(3), checkpoint(4) ];
        verifyCheckpointLine(line);
        expect(defined(line[2]).id).toBe('546bd23e2e01e79ccf8e02c1d5388c4c815f205a7abd2d1ac6b85deeba2b87cf');

        const statements = parsePriceStatements(readJSON('published/QA-checkpoint-4-priceStatements.json'));
        expect(statements).toHaveLength(3);

        verifyCheckpointPriceStatements(defined(line[2]), statements);

        const gef          = defined(head.network.chargingStationOperator('DE*GEF'));
        const signingKeys  = POIPublicKey.parseAll(gef['signingKeys'], 'signing keys');
        for (const statement of statements) {
            statement.verify('QA', 'DE*GEF', signingKeys);
            expect(statement.after).toBe(defined(line[1]).id);
        }

        // The current statement of DE*GEF*E1*1: sequence 1, 0.79 €/kWh, after checkpoint 3, valid now.
        const current = PriceStatement.parse((readJSON('published/QA-priceStatements-DE_GEF_E1_1.json') as JSONArray)[0]);
        current.verify('QA', 'DE*GEF', signingKeys);
        expect(current.sequence).toBe(1);
        expect(current.isValidAt(Date.parse(AT))).toBe(true);
        expect(current.follows(defined(statements.find(statement => statement.entityId === 'DE*GEF*E1*1' && statement.sequence === 0)))).toBe(true);

        // The proof of DE*GEF*E1*1, sequence 0, in checkpoint 4.
        const proof = PriceStatementProof.parse(readJSON('published/QA-priceStatementProof-E1_1-0.json'));
        proof.verify(defined(line[2]));
        proof.priceStatement.verify('QA', 'DE*GEF', signingKeys);

        // Joined with a statement less, or with a statement of another price.
        expect(() => { verifyCheckpointPriceStatements(defined(line[2]), statements.slice(1)); }).toThrow("The price statements are not those the checkpoint '546bd23e2e01e79ccf8e02c1d5388c4c815f205a7abd2d1ac6b85deeba2b87cf' names!");

        const changed = readText('published/QA-checkpoint-4-priceStatements.json').replace('"price": 0.59', '"price": 0.49');
        const other   = parsePriceStatements(parseJSON(changed));
        expect(() => defined(other[0]).verify('QA', 'DE*GEF', signingKeys)).toThrow('The signature of the price statement is invalid: The signature is invalid!');

        // A statement signed by the infrastructure key would be refused: that key may not sign price statements.
        const infrastructureKey = defined(signingKeys.find(key => key.usages.includes('infrastructure')));
        expect(infrastructureKey.id).toBe('7d497d32997732a58dbc993bcb86bf0834095ec1b85cba9e5e7acb2ff8c8e616');
        expect(infrastructureKey.maySign('priceStatements')).toBe(false);

    });

    it('joins from checkpoint 4 with its price statements', () => {

        const joined = History.fromSnapshot(readJSON('published/QA-checkpoint-4-snapshot.json'), byOperator);
        expect(joined.head.commit.revision).toBe(13);
        expect(joined.head.commit.id).toBe('1f674963183da4c9e0beaab61f14d25465b3c9dcae8b4711bf4fb0e680ba7e62');
        verifyCheckpointPriceStatements(defined(joined.checkpoints[0]), parsePriceStatements(readJSON('published/QA-checkpoint-4-priceStatements.json')));

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

        verifyCheckpointPriceStatements(defined(witness.checkpoints[4]), parsePriceStatements(readJSON('published/QA-checkpoint-4-priceStatements.json')));

        const proof = PriceStatementProof.parse(readJSON('published/QA-priceStatementProof-E1_1-0.json'));
        proof.verify(defined(witness.checkpoints[4]));

    });

});
