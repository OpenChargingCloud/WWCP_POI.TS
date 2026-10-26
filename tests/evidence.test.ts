import { describe, expect, it } from 'vitest';

import { asText, defined, readJSON } from './helpers.ts';
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
        expect(toTimestamp(started)).toBe('2026-10-26T00:56:48.676Z');
        expect(verified.station.attestedBy).toEqual([ 'AlphaOrg', 'BetaOrg', 'GammaOrg' ]);

        // c) Revision 13, the version of the station proof: in checkpoint 4, witnessed.
        expect(verified.station.revision).toBe(13);
        expect(defined(verified.versionCheckpoint).sequence).toBe(4);

        // d) The price statement, sequence 2: after checkpoint 4, before checkpoint 5, witnessed.
        const price      = defined(verified.prices.get('EVSE:DE*GEF*E1*1'));
        const statement  = defined(verified.statementCheckpoints.get(price.digest));
        expect(price.statement.sequence).toBe(2);
        expect(defined(statement.after).sequence).toBe(4);
        expect(statement.namedBy.sequence).toBe(5);

        // e) What applied: the station and its energy meter, with their manufacturers and models as the proof gives them, the
        //    key of the meter, the tariff and the price of the statement; as C# printed them.
        const station     = verified.station;
        const meter       = defined(station.evses.find(evse => evse['@id'] === 'DE*GEF*E1*1'))['energyMeter'] as JSONObject;
        const madeBy      = defined(station.manufacturer);
        const meterBy     = defined(station.energyMeterModels.get(asText(meter['@id'])));
        const model       = defined(madeBy.model);
        const meterModel  = defined(meterBy.model);
        expect(`${asText(station.chargingStation['@id'])}: ${asText((madeBy.manufacturer['name'] as JSONObject)['en'])} ${asText(model['@id'])}`).toBe('DE*GEF*S1: GraphDefined Charging Stations GD-DC300');
        expect(`${asText(meter['@id'])}: ${asText((meterBy.manufacturer['name'] as JSONObject)['en'])} ${asText(meterModel['@id'])}, serial ${asText(meter['serialNumber'])}, ${(meter['signatureMethods'] as string[]).join(', ')}, key ${asText(defined((meter['publicKeys'] as JSONObject[])[0])['@id']).slice(0, 8)}`)
            .toBe('DE*GEF*M1*1: Kernberg DC Metering KDM-500, serial DCM-2026-001-1, OCMF, key b87f0197');
        expect(`${asText(model['maxPower'])} W, hardware ${(model['hardwareRevisions'] as string[]).join('/')}, firmware ${(model['firmwareVersions'] as string[]).join('/')}; class ${asText(meterModel['accuracyClass'])}`)
            .toBe('300000 W, hardware 1.0/1.1, firmware 2.4.0/2.5.0; class B');
        expect(station.warnings).toEqual([]);

        const tariff = defined(station.tariffs.get('DE*GEF*E1*1')?.[0]);
        const priceOf = (elements: JSONValue | undefined): string => asText(defined((defined((elements as JSONObject[])[0])['priceComponents'] as JSONObject[])[0])['price']);
        expect(`${asText(tariff['@id'])} ${priceOf(tariff['elements'])} €/kWh, by the price statement ${priceOf(defined(price.statement.prices[0])['elements'])} €/kWh`)
            .toBe('DE*GEF*T_DC 0.69 €/kWh, by the price statement 0.65 €/kWh');

    });

    it('needs the checkpoints months later: the attestations alone have ended', () => {

        const monthsLater = toTimestamp(started + 90 * 24 * 60 * 60 * 1000);
        expect(monthsLater).toBe('2027-01-24T00:56:48.676Z');

        expect(() => ChargingStationProof.parse(evidence.chargingStationProof).verify(anchor, monthsLater))
            .toThrow('Valid attestations of trusted keys of 0 holders attest the root effectiveTree:sha256:hex:33e1fa205299bda1f10fc4ec40fb834f8860b48f24d1acb0831e12fd35aa1163 of the proof, not of 2!');

        // The commit proof in the witnessed checkpoint 4 still proves the version of the station proof.
        const proof  = ChargingStationProof.parse(evidence.chargingStationProof);
        proof.verifyAgainstCommitProof(CheckpointProof.parse(evidence.commitProof));

    });

    it('refuses another price, another time, another station and a checkpoint without witnesses, as C# does', () => {

        // a) A statement of another price: its signature is not the one of its content.
        const otherPrice = clone(defined(evidence.priceStatements[0]) as JSONObject);
        const element    = defined((defined(((otherPrice['priceStatus'] as JSONObject)['prices'] as JSONObject[])[0])['elements'] as JSONObject[])[0]);
        defined((element['priceComponents'] as JSONObject[])[0])['price'] = Decimal.parse('0.09');
        expect(() => verifyEvidence({ ...evidence, priceStatements: [ otherPrice ] }, { witnesses, requiredWitnesses: 2 })).toThrow('The signature of the price statement is invalid: The signature is invalid!');

        // b) A session claimed to have begun an hour earlier, before the statement was valid.
        const station = verifyChargingStation(anchor, evidence.chargingStationProof, { at: started, evseId: 'DE*GEF*E1*1' });
        expect(verifyPriceStatements(station, [ ...evidence.priceStatements ], { at: started - 60 * 60 * 1000 }).size).toBe(0);
        expect(() => PriceStatement.parse(evidence.priceStatements[0]).verify('QA', 'DE*GEF', station.operatorSigningKeys)).not.toThrow();

        // c) A station proof of 300 kW: it leads to another root than the commit.
        const other = clone(evidence.chargingStationProof as JSONObject);
        defined(evseOf(other))['maxPower'] = 300000;
        expect(() => ChargingStationProof.parse(other).verifyAgainstCommitProof(CheckpointProof.parse(evidence.commitProof)))
            .toThrow('The proof leads to effectiveTree:sha256:hex:aadc2ad6cf7e82be5325beaddaac13a6b3bb428b319d58d5ad2fccfcaf4a422d, not to effectiveTree:sha256:hex:33e1fa205299bda1f10fc4ec40fb834f8860b48f24d1acb0831e12fd35aa1163!');

        // e) Checkpoint 5 as it was before its witnesses signed it.
        const unwitnessed = clone((json['checkpoints'] as JSONArray)[1] as JSONObject);
        unwitnessed['signatures'] = (unwitnessed['signatures'] as JSONObject[]).filter(signature => signature['role'] !== 'witness');
        expect(() => verifyEvidence({ ...evidence, checkpoints: [ defined((json['checkpoints'] as JSONArray)[0]), unwitnessed ] }, { witnesses, requiredWitnesses: 2 })).toThrow(/signed by 0 of the trusted witnesses/);

    });

});


describe('ECDSA twins of price statements', () => {

    it('finds the twin (r, n − s) of a statement valid and of the same digest: the same statement', () => {

        const statements = readJSON('published/QA-checkpoint-4-priceStatements.json') as JSONArray;
        const original   = PriceStatement.parse(statements[0]);
        const twin       = PriceStatement.parse(readJSON('proofs/QA-priceStatement-malleated-twin.json'));
        const snapshot4  = readJSON('published/QA-checkpoint-4-snapshot.json') as JSONObject;
        const keys       = POIPublicKey.parseAll(defined(RoamingNetwork.parse(snapshot4['roamingNetwork']).chargingStationOperator('DE*GEF'))['signingKeys'], 'keys');

        original.verify('QA', 'DE*GEF', keys);
        twin.verify('QA', 'DE*GEF', keys);

        // The digest leaves the signature value out (12.1).
        expect(twin.value).not.toBe(original.value);
        expect(twin.digestHex()).toBe(original.digestHex());

        // Given both, the app takes them as one statement, not as two of one sequence, a split view.
        const station  = verifyChargingStation(anchor, evidence.chargingStationProof, { at: started });
        const prices   = verifyPriceStatements(station, [ defined(statements[0]), readJSON('proofs/QA-priceStatement-malleated-twin.json') ], { at: get(original.json, 'signedAt') as string });
        expect(defined(prices.get('EVSE:DE*GEF*E1*1')).statement.sequence).toBe(0);

    });

});
