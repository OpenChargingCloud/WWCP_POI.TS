import { describe, expect, it } from 'vitest';

import { readJSON, readText } from './helpers.ts';

import { verifyEvidence, type Evidence } from '../src/verifier/evidence.ts';
import { parseTrustedWitnesses }  from '../src/verifier/checkpoints.ts';
import { verifyChargingStation, verifyPriceStatements } from '../src/verifier/chargingStation.ts';
import { PriceStatement }         from '../src/proofs/priceStatement.ts';
import { TrustAnchor }            from '../src/proofs/trustAnchor.ts';
import { POIPublicKey }           from '../src/keys.ts';
import { RoamingNetwork }         from '../src/network/roamingNetwork.ts';
import { clone, type JSONArray, type JSONObject } from '../src/json/value.ts';


// What a driver's app keeps of a session at DE*GEF*E1*1, and checks months later, as example A10 (in progress at the time
// of writing) describes it: the station proof attested as charging began, the price statement valid then, the proof of the
// commit of the station proof in checkpoint 4 and the proof of the statement in it, and the witnessed checkpoints 3 and 4.

const statements = readJSON('published/QA-checkpoint-4-priceStatements.json') as JSONArray;
const witnesses  = parseTrustedWitnesses(readJSON('trusted/witnesses.json'));

const evidence: Evidence = {
    trustAnchor:           readText('published/QA-trustAnchor.txt'),
    evseId:                'DE*GEF*E1*1',
    chargingStarted:       '2026-10-24T04:05:00.000Z',
    chargingStationProof:  readJSON('proofs/QA-proof-station-DE_GEF_S1.json'),
    priceStatements:       [ statements[0]! ],
    commitProof:           readJSON('proofs/QA-proof-revision-12.json'),
    priceStatementProofs:  [ readJSON('published/QA-priceStatementProof-E1_1-0.json') ],
    checkpoints:           [ readJSON('published/QA-checkpoint-3.json'), readJSON('published/QA-checkpoint-4.json') ],
};


describe('The evidence of a charging session, months later', () => {

    it('proves the station, its tariff and the price that applied, witnessed', () => {

        const verified = verifyEvidence(evidence, { witnesses, requiredWitnesses: 2 });

        expect(verified.station.chargingStation['@id']).toBe('DE*GEF*S1');
        expect(verified.station.tariffs.get('DE*GEF*E1*1')!.map(tariff => tariff['@id'])).toEqual([ 'DE*GEF*T_DC' ]);
        expect(verified.prices.get('EVSE:DE*GEF*E1*1')!.statement.sequence).toBe(0);
        expect(verified.versionCheckpoint!.sequence).toBe(4);
        expect(verified.checkpoints.map(item => item.signatures.witnessedBy)).toEqual([ [ 'calibration.example', 'association.example' ], [ 'calibration.example', 'association.example' ] ]);

        const statement = [ ...verified.statementCheckpoints.values() ][0]!;
        expect(statement.after!.sequence).toBe(3);
        expect(statement.namedBy.sequence).toBe(4);

    });

    it('refuses a statement of another price, a session begun when nothing was attested, and checkpoints without witnesses', () => {

        const otherPrice = clone(statements[0]! as JSONObject);
        ((((otherPrice['priceStatus'] as JSONObject)['prices'] as JSONObject[])[0]!['elements'] as JSONObject[])[0]!['priceComponents'] as JSONObject[])[0]!['price'] = 0;
        expect(() => verifyEvidence({ ...evidence, priceStatements: [ otherPrice ] }, { witnesses, requiredWitnesses: 2 })).toThrow('The signature of the price statement is invalid: The signature is invalid!');

        // Charging begun after the attestations of the station proof ended: the app would have asked for a fresh proof.
        expect(() => verifyEvidence({ ...evidence, chargingStarted: '2026-10-24T04:20:00.000Z' }, { witnesses, requiredWitnesses: 2 })).toThrow(/of 0 holders attest the root/);

        // Before the key statement was signed.
        expect(() => verifyEvidence({ ...evidence, chargingStarted: '2026-10-24T03:30:00.000Z' }, { witnesses, requiredWitnesses: 2 })).toThrow(/The key statement is not valid at/);

        const unwitnessed = clone(readJSON('published/QA-checkpoint-4.json') as JSONObject);
        unwitnessed['signatures'] = (unwitnessed['signatures'] as JSONObject[]).filter(signature => signature['role'] !== 'witness');
        expect(() => verifyEvidence({ ...evidence, checkpoints: [ readJSON('published/QA-checkpoint-3.json'), unwitnessed ] }, { witnesses, requiredWitnesses: 2 })).toThrow(/signed by 0 of the trusted witnesses/);

    });

});


describe('ECDSA twins of price statements', () => {

    it('finds the twin (r, n − s) of a statement valid, of another digest, but the same statement as signed', () => {

        const original  = PriceStatement.parse(statements[0]);
        const twin      = PriceStatement.parse(readJSON('proofs/QA-priceStatement-malleated-twin.json'));
        const keys      = POIPublicKey.parseAll(RoamingNetwork.parse(readJSON('published/QA.json')).chargingStationOperator('DE*GEF')!['signingKeys'], 'keys');

        original.verify('QA', 'DE*GEF', keys);
        twin.verify('QA', 'DE*GEF', keys);

        expect(twin.value).not.toBe(original.value);
        expect(twin.digestHex()).not.toBe(original.digestHex());
        expect(twin.sameSignedContent(original)).toBe(true);

        // Given both, the app takes them as one statement, not as two of one sequence, a split view.
        const anchor   = TrustAnchor.parse(readText('published/QA-trustAnchor.txt'));
        const station  = verifyChargingStation(anchor, readJSON('proofs/QA-proof-station-DE_GEF_S1.json'), { at: '2026-10-24T04:05:00.000Z' });
        const prices   = verifyPriceStatements(station, [ statements[0]!, readJSON('proofs/QA-priceStatement-malleated-twin.json') ], { at: '2026-10-24T04:05:00.000Z' });
        expect(prices.get('EVSE:DE*GEF*E1*1')!.statement.sequence).toBe(0);

    });

});
