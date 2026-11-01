import {readFileSync} from 'node:fs';
import {describe,expect,test} from 'vitest';
import {TrustAnchor,TrustContext,KeyStatement,TrustTransition,VerifiedTrustTransition,initialTrustEpoch,EpochProfiles,verifyChargingStation,parseJSON,applyVerifiedTrustTransition,emptyObservedVersions,compareObservedVersions,checkpointVersionObservation,checkpointRootVersionObservation,Checkpoint,verifyChargingDocumentKeys} from '../src/index.ts';
import type {JSONObject} from '../src/index.ts';
const data=parseJSON(readFileSync(new URL('./vectors/trust-transitions.json',import.meta.url),'utf8')) as JSONObject;
const required=(name:string):JSONObject=>data[name] as JSONObject,anchor=TrustAnchor.parse(data['anchor'] as string),operator=required('operator'),now=Date.parse(data['now'] as string);
const context=():TrustContext=>TrustContext.create(anchor,KeyStatement.parse(operator['keyStatement']),{trustedIdentityKeyIds:anchor.keys,at:now});
function verified(name:string='policy'):VerifiedTrustTransition{return VerifiedTrustTransition.verify(context(),operator,TrustTransition.parse(data[name]??null),{acceptedAt:now,epoch:initialTrustEpoch(),sequence:0});}
describe('Experimental compact trust succession',()=>{
    test('both independently counted holder quorums authorize the exact target policy and identity keys',()=>{
        const result=verified();expect(result.context.requiredConsensus).toBe(2);expect(result.signedBy.old).toHaveLength(2);expect(result.signedBy.next).toHaveLength(2);
        expect(result.context.anchor.urls[0]).toContain('next.poi.example');expect(result.context.anchor.keys.some(id=>anchor.keys.includes(id))).toBe(false);
    });
    test('a new-only or old-only signature set cannot establish succession',()=>{
        for(const side of ['old','new']){const original=required('policy'),changed={...original,signatures:(original['signatures'] as JSONObject[]).filter(signature=>signature['side']===side)};
            expect(()=>VerifiedTrustTransition.verify(context(),operator,TrustTransition.parse(changed),{acceptedAt:now,epoch:initialTrustEpoch(),sequence:0})).toThrow(/quorum/);}
    });
    test('changing target URLs, sequence, parent, statement or interval does not preserve authorization',()=>{
        for(const change of ([{toAnchor:anchor.toQRCode()},{fromStatementDigest:'00'.repeat(32)},{signedAt:'2031-01-01T00:00:00.000Z'}] as JSONObject[]))
            expect(()=>VerifiedTrustTransition.verify(context(),operator,TrustTransition.parse({...required('policy'),...change}),{acceptedAt:now,epoch:initialTrustEpoch(),sequence:0})).toThrow();
        expect(()=>VerifiedTrustTransition.verify(context(),operator,TrustTransition.parse(data['policy']??null),{acceptedAt:now,epoch:initialTrustEpoch(),sequence:1})).toThrow();
    });
    test('policy succession preserves old points and is idempotent when reverified',()=>{
        const cp=Checkpoint.parse(data['head']),state=compareObservedVersions(emptyObservedVersions(),[checkpointVersionObservation(cp),checkpointRootVersionObservation(cp)],'current',now).state;
        const changed=applyVerifiedTrustTransition(state,verified(),now);expect(changed.accepted).toBe(true);expect(changed.state.points.some(point=>point.digest===cp.id)).toBe(true);
        expect(changed.state.transitions).toHaveLength(1);expect(applyVerifiedTrustTransition(changed.state,verified(),now).state.transitions).toHaveLength(1);
    });
    test('a final checkpoint may close the same root; the exact deterministic genesis opens the next epoch without clearing old points',()=>{
        const cp=Checkpoint.parse(data['head']),before=compareObservedVersions(emptyObservedVersions(),[checkpointVersionObservation(cp),checkpointRootVersionObservation(cp)],'current',now).state;
        const result=applyVerifiedTrustTransition(before,verified('epoch'),now);expect(result.accepted).toBe(true);
        expect(result.state.heads[JSON.stringify(['checkpoint','network'])]?.epoch).toBe('2');expect(result.state.heads[JSON.stringify(['station','network'])]?.epoch).toBe('2');
        expect(result.state.points.some(point=>point.digest===cp.id)).toBe(true);expect(result.state.points.some(point=>point.kind==='checkpoint'&&point.final===true)).toBe(true);
        expect(compareObservedVersions(result.state,[checkpointVersionObservation(cp)],'current',now).accepted).toBe(false);
    });
    test('an epoch jump does not erase a previously authenticated fork',()=>{
        const cp=Checkpoint.parse(data['head']),point=checkpointVersionObservation(cp),before=compareObservedVersions(emptyObservedVersions(),[point],'current',now).state;
        const fork=compareObservedVersions(before,[{...point,digest:'ab'.repeat(32)}],'historical',now).state;
        expect(applyVerifiedTrustTransition(fork,verified('epoch'),now).accepted).toBe(false);
    });
});
describe('POI-authorized CPO document keys',()=>{
    test('maps real COSE keys without imposing the meter pilot on CPO signatures',()=>{
        const keys=verifyChargingDocumentKeys(context(),data['baseProof']??null,{evseId:'DE*POI*E1*1',operatorId:'DE*POI',at:Date.parse('2026-11-01T00:05:01.000Z')});
        expect(keys.keys[0]?.algorithm).toBe('EdDSA-Ed25519');expect(keys.keys[0]?.encodings).toEqual(['COSE_Key','CBOR','base64']);
        expect(()=>verifyChargingDocumentKeys(context(),data['baseProof']??null,{evseId:'DE*POI*E1*1',operatorId:'FOREIGN',at:now})).toThrow();
    });
});

test('verified epoch profiles constrain current station identifications, signature algorithms and epoch start',()=>{
    const result=verified('epoch');
    expect(verifyChargingStation(result.context,data['epochProof']??null,{evseId:'DE*POI*E1*1'}).attestedBy).toHaveLength(2);
    expect(()=>verifyChargingStation(result.context,data['baseProof']??null,{evseId:'DE*POI*E1*1'})).toThrow();
    const epoch={...result.epoch,profiles:EpochProfiles.parse({...result.epoch.profiles.toJSON(),signatureAlgorithms:['ML-DSA-65']})};
    expect(()=>verifyChargingStation(TrustContext.withEpoch(result.context,epoch),data['epochProof']??null,{evseId:'DE*POI*E1*1'})).toThrow();
});

 test('even a dual-quorum wrapper does not authorize a malformed target operational certificate',()=>{expect(()=>verified('invalidCertificate')).toThrow();});
