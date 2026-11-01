import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { CoseKey } from '@vanaheimr/cose';
import { parseJSON, isObject, KeyStatement, TrustAnchor, TrustContext, verifyMeterKey, parseMeasurementPublicKey, toBase64, toHex, clone, Attestation, SigningKeyCertificate, ChargingStationProof, etagToJSON, hash } from '../src/index.ts';
import type { JSONObject } from '../src/index.ts';

const raw = parseJSON(readFileSync(new URL('./vectors/meter-session.json', import.meta.url), 'utf8')) as JSONObject;
const metadata = JSON.parse(readFileSync(new URL('./vectors/meter-session-meta.json', import.meta.url), 'utf8')) as { generatedAt: string };
const evidence = raw['poiEvidence'] as JSONObject;
const bootstrap = evidence['bootstrap'] as JSONObject;
const anchor = TrustAnchor.parse(bootstrap['trustAnchor'] as string);
const operator = bootstrap['keyStatement'] as JSONObject;
const statement = KeyStatement.parse(operator['keyStatement']);
const context = TrustContext.create(anchor, statement, { trustedIdentityKeyIds: anchor.keys, at: metadata.generatedAt });
const request = { evseId: 'DE*POI*E1*1', meterSerialNumber: 'CHARGY-POI-METER-001', keyFormat: 'spki-der' as const };
const proof = evidence['chargingStationProof'] ?? null;

describe('Measurement keys from a locally authorized EVSE proof', () => {
    test('binds exactly the selected meter and key with conservative snapshot freshness', () => {
        const binding = verifyMeterKey(context, proof, request);
        expect(binding.meterId).toBe('DE*POI*M1');
        expect(binding.evidence.association).toBe('current-snapshot');
        expect(binding.evidence.verifiedAt).toBe(Date.parse(metadata.generatedAt));
        expect(binding.evidence.validUntil).toBeLessThan(context.validUntil);
        expect(binding.key.idScheme).toBe('sha256-spki');
        expect(binding.key.canonicalId).not.toBe(binding.key.id);
        expect(Object.isFrozen(binding.evidence)).toBe(true);
        expect(Object.isFrozen(binding.key.encodings)).toBe(true);
    });
    test('a short-lived certified signing key caps the observation even when its root attestation lasts longer', () => {
        const changed = clone(proof) as JSONObject;
        const network = changed['roamingNetwork'] as JSONObject;
        const rno = network['operator'] as JSONObject;
        const certificates = rno['signingKeyCertificates'] as JSONObject[];
        const first = certificates[0];
        if (first === undefined) throw new Error('Missing signing certificate');
        (first['signingKey'] as JSONObject)['notAfter'] = new Date(Date.parse(metadata.generatedAt) + 1000).toISOString();
        const privateKey = (seed: number): ReturnType<typeof createPrivateKey> => createPrivateKey({
            key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, seed)]), type: 'pkcs8', format: 'der' });
        first['value'] = sign(null, SigningKeyCertificate.parse(first).signingBytes(), privateKey(41)).toString('base64');
        const root = ChargingStationProof.parse(changed).calculate().eTag;
        const commit = toHex(hash('sha256', root.digest));
        changed['commitId'] = commit; changed['revision'] = 2;
        const attestations = changed['attestations'] as JSONObject[];
        for (const [index, attestation] of attestations.entries()) {
            attestation['eTag'] = etagToJSON(root); attestation['commitId'] = commit; attestation['revision'] = 2;
            attestation['value'] = sign(null, Attestation.parse(attestation).signingBytes(), privateKey(index === 0 ? 42 : 44)).toString('base64');
        }
        const binding = verifyMeterKey(context, changed, request);
        expect(binding.evidence.validUntil).toBe(Date.parse(metadata.generatedAt) + 1000);
    });
    test('never looks for another EVSE or a different meter/key until signatures happen to work', () => {
        expect(() => verifyMeterKey(context, proof, { ...request, evseId: 'FOREIGN' })).toThrow();
        expect(() => verifyMeterKey(context, proof, { ...request, meterSerialNumber: 'FOREIGN' })).toThrow(/identity/);
        expect(() => verifyMeterKey(context, proof, { ...request, meterId: 'FOREIGN' })).toThrow(/identity/);
        expect(() => verifyMeterKey(context, proof, { ...request, keyId: 'FOREIGN' })).toThrow(/exactly one/);
    });
    test('canonical identity agrees between SPKI and COSE without conflating declared ID schemes', () => {
        const binding = verifyMeterKey(context, proof, request);
        const cose = CoseKey.parse(Uint8Array.from(Buffer.from(binding.key.value, 'base64')));
        const other = parseMeasurementPublicKey({ '@id': toHex(cose.thumbprint()), key: toBase64(cose.toBytes()) }, 'cose-key');
        expect(other.canonicalId).toBe(binding.key.canonicalId);
        expect(other.idScheme).toBe('sha256-cose-key-thumbprint');
        expect(other.value).toBe(binding.key.value);
        expect(other.id).not.toBe(binding.key.id);
    });
    test('rejects substituted material, invalid fingerprints, trailing DER and wrong format', () => {
        const binding = verifyMeterKey(context, proof, request);
        const key = { '@id': binding.key.id, key: raw['publicKey'] ?? null };
        expect(() => parseMeasurementPublicKey({ ...key, '@id': 'ff'.repeat(32) }, 'spki-der')).toThrow(/hash/);
        expect(() => parseMeasurementPublicKey({ ...key, key: binding.key.value }, 'spki-der')).toThrow();
        expect(() => parseMeasurementPublicKey(key, 'cose-key')).toThrow();
        expect(() => parseMeasurementPublicKey({ ...key, key: Buffer.concat([Buffer.from(raw['publicKey'] as string, 'base64'), Buffer.from([0])]).toString('base64') }, 'spki-der')).toThrow();
    });
    test('rejects modified proof data, expired attestations and insufficient local trust', () => {
        const changed = parseJSON(readFileSync(new URL('./vectors/meter-session.json', import.meta.url), 'utf8').replace('Chargy POI demo station', 'forged station'));
        if (!isObject(changed) || !isObject(changed['poiEvidence'])) throw new Error('Invalid test vector');
        expect(() => verifyMeterKey(context, (changed['poiEvidence'] as JSONObject)['chargingStationProof'] ?? null, request)).toThrow();
        const later = TrustContext.create(anchor, statement, { trustedIdentityKeyIds: anchor.keys, at: Date.parse(metadata.generatedAt) + 25 * 3600000 });
        expect(() => verifyMeterKey(later, proof, request)).toThrow();
        expect(() => TrustContext.create(anchor, statement, { trustedIdentityKeyIds: anchor.keys.slice(0, 1), at: metadata.generatedAt })).toThrow();
    });
});
