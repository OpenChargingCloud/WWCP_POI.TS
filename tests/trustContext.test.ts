import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { CoseCurves, CoseKey } from '@vanaheimr/cose';
import { ChargingStationProof, KeyStatement, OperatorTrust, POIPublicKey, RoamingNetworkOperator, TrustAnchor, TrustContext,
         parseJSON, toBase64, toHex, verifyChargingStation } from '../src/index.ts';
import type { JSONObject, JSONValue } from '../src/index.ts';

const at = Date.parse('2026-10-31T12:00:00.000Z');

function testKey(seed: number, holder: string): { publicKey: POIPublicKey; sign: (bytes: Uint8Array) => string } {
    const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, seed)]), format: 'der', type: 'pkcs8' });
    const raw = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32);
    const publicKey = CoseKey.fromOkpPublicKey(CoseCurves.Ed25519, raw);
    return {
        publicKey: POIPublicKey.parse({ '@id': toHex(publicKey.thumbprint()), key: toBase64(publicKey.toBytes()), holder }),
        sign: (bytes): string => sign(null, bytes, privateKey).toString('base64')
    };
}

const keys = [testKey(1, 'A'), testKey(2, 'A'), testKey(3, 'B')];
const ids = keys.map(key => key.publicKey.id);
const anchor = TrustAnchor.create('QA', ['https://poi.example/RNs/QA'], [ids.slice(0, 2), ids.slice(2)], 2);

function statement(changes: JSONObject = {}, signers: readonly number[] = [0, 1, 2]): KeyStatement {
    const value: JSONObject = {
        roamingNetworkId: 'QA', roamingNetworkOperatorId: 'RNO', minConsensus: 2,
        identityKeys: keys.map(key => key.publicKey).sort((a, b) => a.id.localeCompare(b.id)).map(key => key.json),
        signedAt: '2026-01-01T00:00:00.000Z', validUntil: '2030-01-01T00:00:00.000Z',
        signatures: [{ algorithm: 'Ed25519', keyId: ids[0] ?? '', value: 'placeholder' }], ...changes
    };
    const unsigned = KeyStatement.parse(value);
    return KeyStatement.parse({ ...value, signatures: signers.map(index => {
        const key = keys[index];
        if (key === undefined) throw new Error('Missing public test key');
        return { algorithm: 'Ed25519', keyId: key.publicKey.id,
            value: key.sign(unsigned.signingBytes('Ed25519', key.publicKey.id)) };
    }) });
}

const signed = statement();
const context = (): TrustContext => TrustContext.create(anchor, signed, { trustedIdentityKeyIds: [ids[0] ?? '', ids[2] ?? ''], at });

describe('Locally authorized TrustContext', () => {
    test('importing valid, self-signed data cannot establish authorization', () => {
        expect(() => TrustContext.create(anchor, signed, { trustedIdentityKeyIds: [], at })).toThrow();
        expect(() => TrustContext.create(anchor, signed, { trustedIdentityKeyIds: ids.slice(0, 2), at })).toThrow();
    });

    test('preserves holder groups, never promotes unselected bootstrap pins, and keeps the quorum', () => {
        const trusted = context();
        expect(trusted.requiredConsensus).toBe(2);
        expect(trusted.authorizedAnchor.keys).toEqual(expect.arrayContaining([ids[0], ids[2]]));
        expect(trusted.authorizedAnchor.keys).not.toContain(ids[1]);
        expect(trusted.trustedHolders).toEqual(anchor.holders.map(holder => holder.filter(id => id !== ids[1])));
        expect(trusted.verifyStatement(signed).signedBy.size).toBe(2);
        // A valid, quorum-authorized statement delegates its declared keys. This is not extra bootstrap trust.
        expect(trusted.verifyStatement(signed).holderOf.has(ids[1] ?? '')).toBe(true);
    });

    test('local removal takes effect on reconstruction, and objects cannot be altered into authorizations', () => {
        expect(() => TrustContext.create(anchor, signed, { trustedIdentityKeyIds: [ids[0] ?? ''], at })).toThrow();
        const trusted = context();
        expect(Object.isFrozen(trusted)).toBe(true);
        expect(Object.isFrozen(trusted.authorizedAnchor.holders[0])).toBe(true);
        expect(Object.isFrozen(trusted.trustedHolders)).toBe(true);
        expect(Reflect.set(trusted.authorizedAnchor, 'minConsensus', 1)).toBe(false);
    });

    test('does not reduce the requirement declared by the statement', () => {
        const weakerAnchor = TrustAnchor.create(anchor.id, anchor.urls, anchor.holders, 1);
        expect(() => TrustContext.create(weakerAnchor, signed, { trustedIdentityKeyIds: [ids[0] ?? ''], at })).toThrow();
    });

    test('expired, future, tampered and wrong-network statements fail despite accepted keys', () => {
        for (const value of [statement({ validUntil: '2026-01-02T00:00:00.000Z' }),
                             statement({ signedAt: '2027-01-01T00:00:00.000Z' }),
                             statement({ roamingNetworkId: 'OTHER' }),
                             KeyStatement.parse({ ...signed.json, roamingNetworkOperatorId: 'FORGED' })])
            expect(() => TrustContext.create(anchor, value, { trustedIdentityKeyIds: ids, at })).toThrow();
        expect(() => TrustContext.create(anchor, signed, { trustedIdentityKeyIds: ids, at: NaN })).toThrow();
    });

    test('binds to the RNO and exact signed statement, even if replacements have genuine signatures', () => {
        const trusted = context();
        for (const other of [statement({ roamingNetworkOperatorId: 'OTHER-RNO' }),
                             statement({ validUntil: '2029-01-01T00:00:00.000Z' })])
            expect(() => trusted.verifyStatement(other)).toThrow(/differs/);
        expect(trusted.verifyStatement(statement({}, [0, 2])).signedBy.size).toBe(2);
        expect(() => trusted.verifyStatement(statement({}, [0, 1]))).toThrow();
        expect(trusted.verifyStatement(KeyStatement.parse({ ...signed.content(),
            signatures: signed.signatures.map(signature => ({ ...signature })) })).signedBy.size).toBe(2);
    });

    test('a context is tied to its evaluation time and requires recreation for another time', () => {
        const trusted = context();
        expect(trusted.evaluationTime()).toBe(at);
        expect(() => trusted.verifyStatement(signed, [], at + 1)).toThrow(/Recreate/);
    });

    test('holder reassignment and two keys of one holder cannot turn into two consenting holders', () => {
        const split = TrustAnchor.create(anchor.id, anchor.urls, ids, 2);
        expect(() => TrustContext.create(split, signed, { trustedIdentityKeyIds: ids, at })).toThrow();
        const signedByA = statement({}, [0, 1]);
        expect(() => TrustContext.create(anchor, signedByA, { trustedIdentityKeyIds: ids, at })).toThrow();
    });

    test('diagnostics allow importing unknown signers without creating a trusted context', () => {
        expect(TrustContext.evaluate(anchor, signed, { trustedIdentityKeyIds: [], at })).toMatchObject({
            signatures: 'valid', signers: 'invalid', quorum: 'invalid', validity: 'valid', canTrustKeys: true
        });
        const extra = TrustAnchor.create(anchor.id, anchor.urls, [...anchor.holders, ['ff'.repeat(32)]], 2);
        const trusted = TrustContext.create(extra, signed, { trustedIdentityKeyIds: ids, at });
        expect(trusted.trustedHolders).toHaveLength(3);
        expect(trusted.trustedHolders.filter(holder => holder.length === 0)).toHaveLength(1);
        expect(trusted.authorizedAnchor.holders).toHaveLength(2);
        expect(trusted.requiredConsensus).toBe(2);
    });
});

describe('TrustContext in the public verifier APIs', () => {
    const vectors = JSON.parse(readFileSync(new URL('./vectors/poi-trust.json', import.meta.url), 'utf8')) as {
        stationProofs: { id: string; trustAnchor: string; proof: string; at: string; evseId: string }[];
    };
    const vector = vectors.stationProofs.find(item => item.id === 'trust-valid');
    if (vector === undefined) throw new Error('Missing conformance fixture');
    const pinned = TrustAnchor.fromJSON(parseJSON(vector.trustAnchor));
    const proof = ChargingStationProof.parse(parseJSON(vector.proof));
    const operator = proof.roamingNetwork['operator'];
    const verified = proof.verify(pinned, vector.at);
    const statement = RoamingNetworkOperator.parse(operator, pinned.id).keyStatement;
    if (statement === undefined) throw new Error('Missing key statement');
    const trusted = TrustContext.create(pinned, statement, { trustedIdentityKeyIds: pinned.keys, at: vector.at });

    test('the same real proof passes through the context and legacy APIs', () => {
        expect(proof.verify(trusted).attestedBy).toEqual(verified.attestedBy);
        expect(verifyChargingStation(trusted, proof, { evseId: vector.evseId }).chargingStation['@id'])
            .toBe(verifyChargingStation(pinned, proof, { evseId: vector.evseId, at: vector.at }).chargingStation['@id']);
        expect(OperatorTrust.fromOperatorJSON(trusted, operator).statementSignedBy.size).toBe(2);
    });

    test('a changed embedded statement is rejected rather than silently replacing the approved one', () => {
        const replacement = parseJSON(vector.proof) as JSONObject;
        const network = replacement['roamingNetwork'] as JSONObject;
        const changedOperator = network['operator'] as JSONObject;
        const changedStatement = changedOperator['keyStatement'] as JSONObject;
        // Reordering signatures leaves the statement unchanged; every signature and the quorum are still checked.
        const signatures = changedStatement['signatures'] as JSONValue[];
        signatures.reverse();
        expect(trusted.verifyStatement(KeyStatement.parse(changedStatement)).signedBy.size).toBe(2);
        // The Merkle root still covers the exact operator representation, including signature order.
        expect(() => ChargingStationProof.parse(replacement).verify(trusted)).toThrow(/root/);
        changedStatement['validUntil'] = '2026-11-15T00:00:00.000Z';
        expect(() => ChargingStationProof.parse(replacement).verify(trusted)).toThrow(/differs/);
    });

    test('the context accepts the same signed statement embedded or with its explicit context', () => {
        const explicit = KeyStatement.parse({ ...verified.keyStatement.content(),
            signatures: verified.keyStatement.signatures.map(signature => ({ ...signature })) });
        expect(trusted.verifyStatement(explicit).signedBy.size).toBe(2);
    });
});
