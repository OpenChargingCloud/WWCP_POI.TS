import { describe, expect, it } from 'vitest';

import { AT, asText, defined, readJSON, readText } from './helpers.ts';
import { anchor as anchorOfEpoch1, anchorPQ } from './qa.ts';

import { TrustAnchor }        from '../src/proofs/trustAnchor.ts';
import { ChargingStationProof } from '../src/proofs/stationProof.ts';
import { verifyChargingStation, verifyPriceStatements } from '../src/verifier/chargingStation.ts';
import { etagToText }         from '../src/etags.ts';
import { clone, get, type JSONObject } from '../src/json/value.ts';
import { parseJSON }          from '../src/json/parse.ts';


// The use case: an EV driver's app selects a charging station, downloads its proof and the price statements of its EVSEs,
// and checks them against the trust anchor of the roaming network it pinned. Proofs made by the C# implementation
// (tests/vectors/csharp-bc3b1bd/proofs/MakeProofs.cs.txt) of the head of QA as the examples left it, revision 7 of epoch 2,
// attested by the ML-DSA signing keys of the holders of OCC, checked against the trust anchor of epoch 2.

describe('The proof of a charging station, as an app checks it', () => {

    const anchor = anchorPQ;

    it('verifies the proof of DE*GEF*S1 and shows it as it is at runtime', () => {

        const station = verifyChargingStation(anchor, readJSON('proofs/QA-proof-station-DE_GEF_S1.json'), { at: AT });

        expect(station.roamingNetwork).toEqual({ id: 'QA', name: 'Quality Assurance', description: 'The roaming network of the examples' });
        expect(station.attestedBy).toEqual([ 'AlphaOrg', 'BetaOrg', 'GammaOrg' ]);
        expect(station.revision).toBe(7);
        expect(station.commitId).toHaveLength(128);
        expect(etagToText(station.eTag)).toBe('effectiveTree:sha256:hex:2586277e12bce342d85bcd6bcfe9d841e7a5d0085876884f10d64c1d5da3e21e');
        expect(station.chargingStation['@id']).toBe('DE*GEF*S1');
        expect(station.chargingStation['maxPower']).toBe(300000);
        expect(station.evses.map(evse => evse['@id'])).toEqual([ 'DE*GEF*E1*1', 'DE*GEF*E1*2' ]);
        expect(defined(station.evses[0])['chargingConnectors']).toEqual([ { '@id': '1', type: 'IEC_62196_T2_COMBO', format: 'CABLE' } ]);
        expect(defined(station.tariffs.get('DE*GEF*E1*1')).map(tariff => tariff['@id'])).toEqual([ 'DE*GEF*T_DC' ]);
        expect(station.operatorSigningKeys).toHaveLength(3);

        // The model of the station and those of its energy meters, as their manufacturers state them.
        const madeBy = defined(station.manufacturer);
        expect(`${asText(madeBy.manufacturer['@id'])} ${asText(defined(madeBy.model)['@id'])} ${asText(defined(madeBy.model)['numberOfEVSEs'])} EVSEs`).toBe('GraphDefined GD-DC300 2 EVSEs');
        expect(get(madeBy.manufacturer, 'chargingStationModels')).toBeUndefined();
        expect([ ...station.energyMeterModels ].map(([ meterId, { manufacturer, model } ]) => `${meterId}: ${asText(manufacturer['@id'])} ${asText(defined(model)['@id'])}`))
            .toEqual([ 'DE*GEF*M1*1: KERNBERG KDM-500', 'DE*GEF*M1*2: KERNBERG KDM-500' ]);
        expect(station.warnings).toEqual([]);

    });

    it('gives the models the station and its meters name, and no other', () => {

        const proof     = readJSON('proofs/QA-proof-station-DE_GEF_S6.json') as JSONObject;
        const network   = proof['roamingNetwork'] as JSONObject;
        const leavesOf  = (array: JSONObject, models: string): string[] => (get(array, '@leaves') as JSONObject[]).map(leaf => {
                              const manufacturer = leaf['@entity'] as JSONObject;
                              const given        = get(manufacturer, models) as JSONObject;
                              return `${asText(manufacturer['@id'])}: ${(get(given, '@leaves') as JSONObject[]).map(model => asText((model['@entity'] as JSONObject)['@id'])).join(', ')} of ${asText(get(given, '@size'))}`;
                          });

        // The AC station DE*GEF*S6 is a GD-AC44 with meters SM-3: the DC models are pruned, as is KERNBERG.
        expect(leavesOf(network['chargingStationManufacturers'] as JSONObject, 'chargingStationModels')).toEqual([ 'GraphDefined: GD-AC44 of 2' ]);
        expect(leavesOf(network['energyMeterManufacturers'] as JSONObject, 'energyMeterModels')).toEqual([ 'SAALE: SM-3 of 1' ]);

        const s6 = verifyChargingStation(anchor, proof, { at: AT });
        expect(asText(defined(s6.manufacturer?.model)['@id'])).toBe('GD-AC44');
        expect([ ...s6.energyMeterModels.values() ].map(({ model }) => asText(defined(model)['@id']))).toEqual([ 'SM-3', 'SM-3' ]);

    });

    it('verifies the proof of an AC station and of the station of an EVSE', () => {

        const s6 = verifyChargingStation(anchor, readJSON('proofs/QA-proof-station-DE_GEF_S6.json'), { at: AT });
        expect(s6.chargingStation['maxPower']).toBe(22000);
        expect(s6.evses.map(evse => evse['maxPower'])).toEqual([ 11000, 11000 ]);
        expect(defined(s6.tariffs.get('DE*GEF*E6*1')).map(tariff => tariff['@id'])).toEqual([ 'DE*GEF*T_AC' ]);

        const e3 = verifyChargingStation(anchor, readJSON('proofs/QA-proof-evse-DE_GEF_E3_2.json'), { at: AT, evseId: 'DE*GEF*E3*2' });
        expect(e3.chargingStation['@id']).toBe('DE*GEF*S3');

    });

    it('verifies the price statement of an EVSE against the proof', () => {

        const station  = verifyChargingStation(anchor, readJSON('proofs/QA-proof-station-DE_GEF_S1.json'), { at: AT });
        const prices   = verifyPriceStatements(station, readJSON('published/QA-epoch-2-checkpoint-0-priceStatements.json'), { at: AT });
        const price    = defined(prices.get('EVSE:DE*GEF*E1*1'));

        expect(price.statement.sequence).toBe(3);
        expect(price.statement.algorithm).toBe('ML-DSA-65');
        const tariff   = defined(price.statement.prices[0]);
        expect(tariff['chargingTariffId']).toBe('DE*GEF*T_DC');
        const element  = defined((tariff['elements'] as JSONObject[])[0]);
        expect(asText(defined((element['priceComponents'] as JSONObject[])[0])['price'])).toBe('0.59');

        // After its validUntil there is no current price.
        expect(verifyPriceStatements(station, readJSON('published/QA-epoch-2-checkpoint-0-priceStatements.json'), { at: '2026-10-25T16:20:00.000Z' }).size).toBe(0);

    });

    it('refuses a proof whose station was changed, attested at another time, or by too few holders', () => {

        const proof   = readJSON('proofs/QA-proof-station-DE_GEF_S1.json') as JSONObject;

        // A maximum power changed: the proof leads to another root.
        const changed = parseJSON(readText('proofs/QA-proof-station-DE_GEF_S1.json').replace('"maxPower": 300000', '"maxPower": 350000'));
        expect(() => verifyChargingStation(anchor, changed, { at: AT })).toThrow(/attest the root/);

        // The attestations are valid for 15 minutes.
        expect(() => verifyChargingStation(anchor, proof, { at: '2026-10-25T16:44:00.000Z' })).toThrow(/of 0 holders/);

        // One attestation is not enough for a quorum of two.
        const one = clone(proof);
        one['attestations'] = (one['attestations'] as JSONObject[]).slice(0, 1);
        expect(() => verifyChargingStation(anchor, one, { at: AT })).toThrow(/of 1 holder attest/);

        // A trust anchor of other keys.
        const other = TrustAnchor.create('QA', anchor.urls, [ 'a'.repeat(64), 'b'.repeat(64) ], 2);
        expect(() => ChargingStationProof.parse(proof).verify(other, AT)).toThrow(/signed by trusted identity keys of 0 holders/);

        // The trust anchor of epoch 1 alone: the key statement of epoch 2 is signed by the ML-DSA identity keys only.
        expect(() => ChargingStationProof.parse(proof).verify(anchorOfEpoch1, AT)).toThrow('The key statement is signed by trusted identity keys of 0 holders, not of 2!');

    });

});
