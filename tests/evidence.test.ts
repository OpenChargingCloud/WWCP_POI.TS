import { describe, expect, it } from 'vitest';

import { readJSON } from './helpers.ts';
import { anchor, witnesses } from './qa.ts';

import { parseEvidence, verifyEvidence } from '../src/verifier/evidence.ts';
import { verifyChargingStation, verifyPriceStatements } from '../src/verifier/chargingStation.ts';
import { ChargingStationProof }   from '../src/proofs/stationProof.ts';
import { PriceStatement }         from '../src/proofs/priceStatement.ts';
import { CheckpointProof }        from '../src/history/checkpoint.ts';
import { POIPublicKey }           from '../src/keys.ts';
import { RoamingNetwork }         from '../src/network/roamingNetwork.ts';
import { parseTimestamp, toTimestamp } from '../src/common.ts';
import { clone, get, isArray, isObject, type JSONArray, type JSONObject, type JSONValue } from '../src/json/value.ts';
import { Decimal }                from '../src/json/decimal.ts';


// Example A10: what a driver's app keeps of a session at DE*GEF*E1*1, driver/evidence-DE_GEF_E1_1.json as the C# example
// wrote it, and checks months later, offline, against the witnesses it trusts only.

const json      = readJSON('driver/evidence-DE_GEF_E1_1.json') as JSONObject;
const evidence  = parseEvidence(json);
const started   = parseTimestamp(evidence.chargingStarted);

/** The EVSE DE*GEF*E1*1 in a copy of a station proof, wherever the proof gives it. */
function evseOf(proof: JSONValue): JSONObject | undefined {

    if (isArray(proof))
        return proof.map(evseOf).find(found => found !== undefined);

    if (!isObject(proof))
        return undefined;

    return proof['@id'] === 'DE*GEF*E1*1' && proof['maxPower'] !== undefined
               ? proof
               : Object.values(proof).map(evseOf).find(found => found !== undefined);

}


describe('Example A10: the evidence of a charging session, months later', () => {

    it('proves the station, its tariff and the price that applied as charging began, witnessed (a to e)', () => {

        const verified = verifyEvidence(evidence, { witnesses, requiredWitnesses: 2 });

        // a) Checkpoints 4 and 5, signed by the quorum of OCC with its keys as the station proof gives them, and by both witnesses.
        expect(verified.checkpoints.map(({ checkpoint, signatures }) => `Checkpoint ${checkpoint.sequence}: revision ${checkpoint.revision}, signed by ${signatures.signedBy.join(', ')}, witnessed by ${signatures.witnessedBy.join(', ')}`)).toEqual([
            'Checkpoint 4: revision 13, signed by AlphaOrg, BetaOrg, GammaOrg, witnessed by calibration.example, association.example',
            'Checkpoint 5: revision 14, signed by AlphaOrg, BetaOrg, GammaOrg, witnessed by calibration.example, association.example',
        ]);

        // b) As charging began: the station proof attested, the price statement valid.
        expect(toTimestamp(started)).toBe('2026-10-24T16:57:08.707Z');
        expect(verified.station.attestedBy).toEqual([ 'AlphaOrg', 'BetaOrg', 'GammaOrg' ]);

        // c) Revision 13, the version of the station proof: in checkpoint 4, witnessed.
        expect(verified.station.revision).toBe(13);
        expect(verified.versionCheckpoint!.sequence).toBe(4);

        // d) The price statement, sequence 2: after checkpoint 4, before checkpoint 5, witnessed.
        const price      = verified.prices.get('EVSE:DE*GEF*E1*1')!;
        const statement  = verified.statementCheckpoints.get(price.digest)!;
        expect(price.statement.sequence).toBe(2);
        expect(statement.after!.sequence).toBe(4);
        expect(statement.namedBy.sequence).toBe(5);

        // e) What applied: the station and its energy meter, with their manufacturers and models as the proof gives them, the
        //    key of the meter, the tariff and the price of the statement; as C# printed them.
        const station  = verified.station;
        const meter    = station.evses.find(evse => evse['@id'] === 'DE*GEF*E1*1')!['energyMeter'] as JSONObject;
        const madeBy   = station.manufacturer!;
        const meterBy  = station.energyMeterModels.get(String(meter['@id']))!;
        expect(`${String(station.chargingStation['@id'])}: ${String((madeBy.manufacturer['name'] as JSONObject)['en'])} ${String(madeBy.model!['@id'])}`).toBe('DE*GEF*S1: GraphDefined Charging Stations GD-DC300');
        expect(`${String(meter['@id'])}: ${String((meterBy.manufacturer['name'] as JSONObject)['en'])} ${String(meterBy.model!['@id'])}, serial ${String(meter['serialNumber'])}, ${(meter['signatureMethods'] as string[]).join(', ')}, key ${String((meter['publicKeys'] as JSONObject[])[0]!['@id']).slice(0, 8)}`)
            .toBe('DE*GEF*M1*1: Kernberg DC Metering KDM-500, serial DCM-2026-001-1, OCMF, key 17614ce1');
        expect(`${String(madeBy.model!['maxPower'])} W, versions ${(madeBy.model!['versions'] as string[]).join('/')}; class ${String(meterBy.model!['accuracyClass'])}`).toBe('300000 W, versions 1.0/1.1; class B');
        expect(station.warnings).toEqual([]);

        const tariff = station.tariffs.get('DE*GEF*E1*1')![0]!;
        const priceOf = (elements: JSONValue | undefined) => String(((elements as JSONObject[])[0]!['priceComponents'] as JSONObject[])[0]!['price']);
        expect(`${String(tariff['@id'])} ${priceOf(tariff['elements'])} €/kWh, by the price statement ${priceOf(price.statement.prices[0]!['elements'])} €/kWh`)
            .toBe('DE*GEF*T_DC 0.69 €/kWh, by the price statement 0.65 €/kWh');

    });

    it('needs the checkpoints months later: the attestations alone have ended', () => {

        const monthsLater = toTimestamp(started + 90 * 24 * 60 * 60 * 1000);
        expect(monthsLater).toBe('2027-01-22T16:57:08.707Z');

        expect(() => ChargingStationProof.parse(evidence.chargingStationProof).verify(anchor, monthsLater))
            .toThrow('Valid attestations of trusted keys of 0 holders attest the root effectiveTree:sha256:hex:f5523684327b1e6081bb31ffb1d64e74a03253992963e47dbd9af083cf1be0d0 of the proof, not of 2!');

        // The commit proof in the witnessed checkpoint 4 still proves the version of the station proof.
        const proof  = ChargingStationProof.parse(evidence.chargingStationProof);
        proof.verifyAgainstCommitProof(CheckpointProof.parse(evidence.commitProof));

    });

    it('refuses another price, another time, another station and a checkpoint without witnesses, as C# does', () => {

        // a) A statement of another price: its signature is not the one of its content.
        const otherPrice = clone(evidence.priceStatements[0]! as JSONObject);
        ((((otherPrice['priceStatus'] as JSONObject)['prices'] as JSONObject[])[0]!['elements'] as JSONObject[])[0]!['priceComponents'] as JSONObject[])[0]!['price'] = Decimal.parse('0.09');
        expect(() => verifyEvidence({ ...evidence, priceStatements: [ otherPrice ] }, { witnesses, requiredWitnesses: 2 })).toThrow('The signature of the price statement is invalid: The signature is invalid!');

        // b) A session claimed to have begun an hour earlier, before the statement was valid.
        const station = verifyChargingStation(anchor, evidence.chargingStationProof, { at: started, evseId: 'DE*GEF*E1*1' });
        expect(verifyPriceStatements(station, [ ...evidence.priceStatements ], { at: started - 60 * 60 * 1000 }).size).toBe(0);
        expect(() => PriceStatement.parse(evidence.priceStatements[0]).verify('QA', 'DE*GEF', station.operatorSigningKeys)).not.toThrow();

        // c) A station proof of 300 kW: it leads to another root than the commit.
        const other = clone(evidence.chargingStationProof as JSONObject);
        evseOf(other)!['maxPower'] = 300000;
        expect(() => ChargingStationProof.parse(other).verifyAgainstCommitProof(CheckpointProof.parse(evidence.commitProof)))
            .toThrow('The proof leads to effectiveTree:sha256:hex:b425b72f7b71615f616c6c71514934c6a82881feda17e8d949541766eda9fc64, not to effectiveTree:sha256:hex:f5523684327b1e6081bb31ffb1d64e74a03253992963e47dbd9af083cf1be0d0!');

        // e) Checkpoint 5 as it was before its witnesses signed it.
        const unwitnessed = clone((json['checkpoints'] as JSONArray)[1] as JSONObject);
        unwitnessed['signatures'] = (unwitnessed['signatures'] as JSONObject[]).filter(signature => signature['role'] !== 'witness');
        expect(() => verifyEvidence({ ...evidence, checkpoints: [ (json['checkpoints'] as JSONArray)[0]!, unwitnessed ] }, { witnesses, requiredWitnesses: 2 })).toThrow(/signed by 0 of the trusted witnesses/);

    });

});


describe('ECDSA twins of price statements', () => {

    it('finds the twin (r, n − s) of a statement valid, of another digest, but the same statement as signed', () => {

        const statements = readJSON('published/QA-checkpoint-4-priceStatements.json') as JSONArray;
        const original   = PriceStatement.parse(statements[0]);
        const twin       = PriceStatement.parse(readJSON('proofs/QA-priceStatement-malleated-twin.json'));
        const snapshot4  = readJSON('published/QA-checkpoint-4-snapshot.json') as JSONObject;
        const keys       = POIPublicKey.parseAll(RoamingNetwork.parse(snapshot4['roamingNetwork']).chargingStationOperator('DE*GEF')!['signingKeys'], 'keys');

        original.verify('QA', 'DE*GEF', keys);
        twin.verify('QA', 'DE*GEF', keys);

        // The digests C# printed for both (proofs/MakeProofs-output.log).
        expect(original.digestHex()).toBe('25a93a8691f67fc8bbea368d4a10e9f562379c7b96b1e315883280aba42ebf3e');
        expect(twin.digestHex()).toBe('ad682ed917dccce9558c5d905201890bd7452f5ae3a6d9c565003c917c636d00');
        expect(twin.sameSignedContent(original)).toBe(true);

        // Given both, the app takes them as one statement, not as two of one sequence, a split view.
        const station  = verifyChargingStation(anchor, evidence.chargingStationProof, { at: started });
        const prices   = verifyPriceStatements(station, [ statements[0]!, readJSON('proofs/QA-priceStatement-malleated-twin.json') ], { at: get(original.json, 'signedAt') as string });
        expect(prices.get('EVSE:DE*GEF*E1*1')!.statement.sequence).toBe(0);

    });

});
