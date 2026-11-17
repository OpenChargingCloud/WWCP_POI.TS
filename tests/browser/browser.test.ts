import { describe, expect, test } from 'vitest';

import { AT }                   from '../at.ts';
import { readJSON, readText }   from './vectors.ts';

import { ChargingStationProof, RoamingNetworkOperator, TrustContext, TrustAnchor, parseEvidence, parseTrustedWitnesses, verifyChargingStation, verifyEvidence, verifyPriceStatements, verifyVersion } from '../../src/index.ts';

// The library in a real browser, Chromium without a window through Playwright, as an EV driver's app runs it: the
// cryptography of the @noble family and the CBOR of MetrologicalCBOR.TS, without Buffer, WebCrypto or node:* modules.


describe('The library in Chromium', () => {

    test('runs in a browser, where there is neither Buffer nor process', () => {
        expect('window' in globalThis).toBe(true);
        expect('Buffer' in globalThis).toBe(false);
        expect('process' in globalThis).toBe(false);
    });

    test('checks QA from its trust anchor: the key statement, the signatures of the commit, its JSON, CBOR and effective tree ETags', () => {

        // QA as example A1 left it, revision 2: AlphaOrg, BetaOrg and GammaOrg hold the keys of OCC.
        const version = verifyVersion(TrustAnchor.parse(readText('published/QA-trustAnchor.txt')), readJSON('published/QA-revision2.json'), readJSON('published/QA-revision2-commit.json'), AT);

        expect(version.commit.revision).toBe(2);
        expect(version.signedBy).toEqual([ 'AlphaOrg', 'BetaOrg', 'GammaOrg' ]);
        expect(version.warnings).toEqual([]);

    });

    test('checks the proof of a charging station of epoch 2 and the price of its EVSE: ML-DSA and SHA-256 trees', () => {

        const station = verifyChargingStation(TrustAnchor.parse(readText('published/QA-trustAnchor-mldsa.txt')), readJSON('proofs/QA-proof-station-DE_GEF_S1.json'), { at: AT });
        const prices  = verifyPriceStatements(station, readJSON('published/QA-epoch-2-checkpoint-0-priceStatements.json'), { at: AT });

        expect(station.attestedBy).toEqual([ 'AlphaOrg', 'BetaOrg', 'GammaOrg' ]);
        expect(station.chargingStation['@id']).toBe('DE*GEF*S1');
        expect(station.manufacturer?.model?.['@id']).toBe('GD-DC300');
        expect(station.warnings).toEqual([]);
        expect(prices.get('EVSE:DE*GEF*E1*1')?.statement.algorithm).toBe('ML-DSA-65');

    });

    test('uses locally authorized trust contexts in the browser', () => {
        const anchor = TrustAnchor.parse(readText('published/QA-trustAnchor-mldsa.txt'));
        const proof = ChargingStationProof.parse(readJSON('proofs/QA-proof-station-DE_GEF_S1.json'));
        const statement = RoamingNetworkOperator.parse(proof.roamingNetwork['operator'], anchor.id).keyStatement;
        if (statement === undefined) throw new Error('Missing key statement');
        const unknown = TrustContext.evaluate(anchor, statement, { trustedIdentityKeyIds: [], at: AT });
        expect(unknown.signatures).toBe('valid');
        expect(unknown.quorum).toBe('invalid');
        expect(unknown.context).toBeUndefined();
        const context = TrustContext.create(anchor, statement, { trustedIdentityKeyIds: anchor.keys, at: AT });
        expect(verifyChargingStation(context, proof).chargingStation['@id']).toBe('DE*GEF*S1');
    });

    test('checks the evidence of a session months later, against the checkpoints its witnesses signed', () => {

        const verified = verifyEvidence(parseEvidence(readJSON('driver/evidence-DE_GEF_E1_1.json')),
                                        { witnesses: parseTrustedWitnesses(readJSON('trusted/witnesses.json')), requiredWitnesses: 2 });

        expect(verified.checkpoints.map(({ checkpoint, signatures }) => `checkpoint ${checkpoint.sequence}, witnessed by ${signatures.witnessedBy.join(', ')}`)).toEqual([
            'checkpoint 4, witnessed by calibration.example, association.example',
            'checkpoint 5, witnessed by calibration.example, association.example',
        ]);
        expect(verified.prices.get('EVSE:DE*GEF*E1*1')?.statement.sequence).toBe(2);

    });

});
