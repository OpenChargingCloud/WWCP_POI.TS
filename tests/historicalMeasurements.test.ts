import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseJSON, isObject, TrustAnchor, TrustContext, KeyStatement, verifyHistoricalMeterEvidence, parseTrustedWitnesses, HistoricalTrustContext } from '../src/index.ts';
import type { JSONObject } from '../src/index.ts';
const input = parseJSON(readFileSync(new URL('./vectors/history-session.json', import.meta.url),'utf8')) as JSONObject;
const poi = input['poiEvidence'] as JSONObject;
const bootstrap = poi['bootstrap'] as JSONObject;
const anchor = TrustAnchor.parse(bootstrap['trustAnchor'] as string);
const operator = bootstrap['keyStatement'] as JSONObject;
const context = TrustContext.create(anchor, KeyStatement.parse(operator['keyStatement']), { trustedIdentityKeyIds: anchor.keys, at: '2026-11-01T00:16:21.000Z' });
const evidence = poi['historicalEvidence'] ?? null;
const request = { evseId: 'DE*POI*E1*1', meterSerialNumber: 'CHARGY-POI-METER-001',
    measurementTimes: [Date.parse('2026-06-01T10:00:00.000Z'),Date.parse('2026-06-01T10:30:00.000Z')], keyFormat: 'spki-der' as const };
const witnesses = parseTrustedWitnesses(parseJSON(readFileSync(new URL('./vectors/history-witnesses.json',import.meta.url),'utf8')));
const copy = (): JSONObject => parseJSON(readFileSync(new URL('./vectors/history-session.json',import.meta.url),'utf8')) as JSONObject;
describe('Historical meter evidence under current local authority', () => {
    test('expired historical statements/certificates still verify at their own times; later checkpoints use their own authority', () => {
        const result = verifyHistoricalMeterEvidence(context,evidence,request);
        expect(result.bindings).toHaveLength(2);
        expect(result.bindings[0]?.evidence.association).toBe('historical-attestation');
        expect(result.bindings[0]?.evidence.attestationValidUntil).toBeLessThan(context.evaluatedAt);
        expect(result.bindings[0]?.evidence.verifiedAt).toBe(context.evaluatedAt);
        expect(result.versions[0]?.publication).toBe('rno-checkpoint');
        expect(result.independentTime).toBe('not-proven');
    });
    test('witnesses require an explicit external policy; witness signatures in the bundle do not authorize themselves', () => {
        expect(() => verifyHistoricalMeterEvidence(context,evidence,request,{requiredWitnesses:1})).toThrow(/quorum/);
        expect(verifyHistoricalMeterEvidence(context,evidence,request,{witnesses,requiredWitnesses:1}).versions[0]?.publication).toBe('witnessed-checkpoint');
    });
    test('missing inclusion stays pending, required inclusion fails, and malformed supplied inclusion cannot be ignored', () => {
        const changed=copy(); const item=((changed['poiEvidence'] as JSONObject)['historicalEvidence'] as JSONObject);
        const version=(item['versions'] as JSONObject[])[0]; if(version===undefined) throw new Error('Missing version');
        delete version['commitProof']; delete version['checkpoints'];
        expect(verifyHistoricalMeterEvidence(context,item,request).versions[0]?.publication).toBe('missing');
        expect(() => verifyHistoricalMeterEvidence(context,item,request,{requirePublication:true})).toThrow(/missing/);
        const original=copy();const originalEvidence=(original['poiEvidence'] as JSONObject)['historicalEvidence'] as JSONObject;
        const proof=((originalEvidence['versions'] as JSONObject[])[0]?.['commitProof']) as JSONObject;
        (proof['leaf'] as JSONObject)['commitId']='ff'.repeat(32);
        expect(() => verifyHistoricalMeterEvidence(context,originalEvidence,request)).toThrow();
    });
    test('wrong EVSE, wrong time, insufficient local trust and compromise do not establish historical association', () => {
        expect(() => verifyHistoricalMeterEvidence(context,evidence,{...request,evseId:'FOREIGN'})).toThrow();
        expect(() => verifyHistoricalMeterEvidence(context,evidence,{...request,measurementTimes:[Date.parse('2026-06-02T00:00:00Z')]})).toThrow(/coverage/);
        expect(() => TrustContext.create(anchor,KeyStatement.parse(operator['keyStatement']),{trustedIdentityKeyIds:[],at:context.evaluatedAt})).toThrow();
        const result=verifyHistoricalMeterEvidence(context,evidence,request);
        expect(() => verifyHistoricalMeterEvidence(context,evidence,request,{revocations:[{keyId:result.bindings[0]?.key.id??'',invalidFrom:0}]})).toThrow(/coverage/);
        expect(verifyHistoricalMeterEvidence(context,evidence,request,{revocations:[{keyId:result.bindings[0]?.key.id??'',invalidFrom:Date.parse('2026-07-01T00:00:00Z')}]}).bindings).toHaveLength(2);
    });
    test('the immutable historical observation preserves its actual statement digest and finite exact coverage', () => {
        const result=verifyHistoricalMeterEvidence(context,evidence,request);
        expect(result.bindings[0]?.evidence.historicalStatementDigest).not.toBe(context.keyStatementDigest);
        expect(Object.isFrozen(result.bindings[0]?.evidence.measurementTimes)).toBe(true);
        expect(() => verifyHistoricalMeterEvidence(context,evidence,{...request,measurementTimes:[NaN]})).toThrow();
        expect(isObject(evidence)).toBe(true);
    });
});


test('historical permission remains offline-capable when the saved reference statement has expired today',()=>{
    if(!isObject(evidence)) throw new Error('Missing historical evidence');
    const version=(evidence['versions'] as JSONObject[])[0];
    const oldOperator=(version?.['chargingStationProof'] as JSONObject)['roamingNetwork'] as JSONObject;
    const oldStatement=KeyStatement.parse((oldOperator['operator'] as JSONObject)['keyStatement']);
    expect(oldStatement.validUntil).toBeLessThan(context.evaluatedAt);
    const permission=HistoricalTrustContext.create(anchor,oldStatement,{trustedIdentityKeyIds:anchor.keys,now:context.evaluatedAt});
    expect(verifyHistoricalMeterEvidence(permission,evidence,request).bindings).toHaveLength(2);
    expect(permission.validUntil).toBe(context.evaluatedAt+60000);
    expect(()=>HistoricalTrustContext.create(anchor,oldStatement,{trustedIdentityKeyIds:[],now:context.evaluatedAt})).toThrow();
});
