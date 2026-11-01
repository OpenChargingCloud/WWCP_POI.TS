import {readFileSync} from 'node:fs';
import {createPrivateKey,sign} from 'node:crypto';
import {describe,expect,test} from 'vitest';
import {defined} from './helpers.ts';
import {parseJSON,prettyJSON,TrustAnchor,KeyStatement,HistoricalTrustContext,parseWitnessPublicationPolicy,PricePublicationReceipt,verifySessionPriceEvidence,type JSONObject,type JSONValue,type SessionPriceRequest} from '../src/index.ts';
const vectors=():JSONObject=>parseJSON(readFileSync(new URL('./vectors/price-publication.json',import.meta.url),'utf8')) as JSONObject;
function example(name='session-before-start.chargy'): {raw:JSONObject;context:HistoricalTrustContext;evidence:JSONObject;policy:ReturnType<typeof parseWitnessPublicationPolicy>;request:SessionPriceRequest}{
    const raw=vectors(),session=raw['session'] as JSONObject,poi=session['poiEvidence'] as JSONObject,bootstrap=poi['bootstrap'] as JSONObject;
    const anchor=TrustAnchor.parse(bootstrap['trustAnchor'] as string),statement=(bootstrap['keyStatement'] as JSONObject)['keyStatement'];
    const context=HistoricalTrustContext.create(anchor,KeyStatement.parse(statement),{trustedIdentityKeyIds:anchor.keys,now:Date.parse(raw['now'] as string)});
    const evidence=(raw['variants'] as JSONObject)[name] as JSONObject,policy=parseWitnessPublicationPolicy(raw['policy'] as JSONObject),request=raw['request'] as unknown as SessionPriceRequest;
    return {raw,context,evidence,policy,request};
}
describe('Independent public price retrieval before the signed start',()=>{
    test('Ed25519 and ML-DSA-65 witnesses meet the separately authorized organization/time quorum',()=>{
        const e=example(),result=verifySessionPriceEvidence(e.context,e.evidence,e.request,{publicationPolicy:e.policy});
        expect(result.publication).toBe('valid');expect(result.applicability).toBe('bound');expect(result.publicationBeforeStart).toBe('witnessed-before-signed-start');
        expect(result.publicationWitnesses?.organizations).toHaveLength(2);expect(result.publicationWitnesses?.actualStartTime).toBe('not-independently-proven');
        expect(result.customerConsent).toBe('not-proven');expect(result.latestOrSoleOffer).toBe('not-proven');
        expect(result.publicationWitnesses?.receipts.every(item=>typeof item.latestPublicationAt==='number'&&item.latestPublicationAt<e.request.chargingStarted)).toBe(true);
    });
    test('supplied recommendations and genuinely signed receipts do not authorize themselves',()=>{
        const e=example(),result=verifySessionPriceEvidence(e.context,e.evidence,e.request);
        expect(result.publication).toBe('valid');expect(result.publicationBeforeStart).toBe('not-proven');
        expect(result.publicationWitnesses?.receipts.every(item=>item.status==='untrusted')).toBe(true);
    });
    test.each(['late-receipt','clock-overlap','same-organization','unknown-witness','no-receipts'])('%s cannot establish a two-organization pre-start claim',name=>{
        const e=example(name+'.chargy'),result=verifySessionPriceEvidence(e.context,e.evidence,e.request,{publicationPolicy:e.policy});
        expect(result.signatures).toBe('valid');expect(result.publication).toBe('valid');expect(result.publicationBeforeStart).toBe('not-proven');
        expect(defined(result.publicationWitnesses).organizations.length).toBeLessThan(2);
    });
    test.each(['wrong-price','wrong-signed-price','wrong-tariff','wrong-checkpoint','tampered-receipt','future-receipt','private-source'])('%s is refused separately from the valid CPO price',name=>{
        const e=example(name+'.chargy'),result=verifySessionPriceEvidence(e.context,e.evidence,e.request,{publicationPolicy:e.policy});
        expect(result.signatures).toBe('valid');expect(result.publication).toBe('valid');expect(result.publicationBeforeStart).toBe('invalid');
    });
    test('duplicate receipts and witness aliases do not add organization votes',()=>{
        const e=example('same-organization.chargy'),receipts=e.evidence['publicationReceipts'] as JSONValue[];
        receipts.push(...receipts);expect(verifySessionPriceEvidence(e.context,e.evidence,e.request,{publicationPolicy:e.policy}).publicationWitnesses?.organizations).toHaveLength(1);
        const json=parseJSON(prettyJSON(e.policy.json)) as JSONObject,witnesses=json['witnesses'] as JSONObject[];
        witnesses.push({...witnesses[0],id:'ALIAS',organization:'FAKE-SECOND-ORGANIZATION'});
        expect(()=>parseWitnessPublicationPolicy(json)).toThrow(/same witness key/);
    });
    test('wrong role, scope, validity, quorum and private endpoints cannot relax local authorization',()=>{
        for(const edit of [
            (json:JSONObject):void=>{json['requiredOrganizations']=0;},
            (json:JSONObject):void=>{const witness=defined((json['witnesses'] as JSONObject[])[0]);const key=defined((witness['keys'] as JSONObject[])[0]);key['usages']=['priceStatements'];},
            (json:JSONObject):void=>{defined((json['witnesses'] as JSONObject[])[0])['role']='roamingNetworkOperator';},
            (json:JSONObject):void=>{defined((json['witnesses'] as JSONObject[])[0])['endpoints']=['https://127.0.0.1/receipts'];}
        ]){const json=parseJSON(prettyJSON(example().policy.json)) as JSONObject;edit(json);expect(()=>parseWitnessPublicationPolicy(json)).toThrow();}
        for(const edit of [
            (json:JSONObject):void=>{defined((json['witnesses'] as JSONObject[])[1])['networks']=['OTHER-NETWORK'];},
            (json:JSONObject):void=>{defined((json['witnesses'] as JSONObject[])[1])['notBefore']='2026-07-01T00:00:00.000Z';},
            (json:JSONObject):void=>{defined((json['witnesses'] as JSONObject[])[1])['clockErrorMs']=30000;}
        ]){const e=example(),json=parseJSON(prettyJSON(e.policy.json)) as JSONObject;edit(json);expect(verifySessionPriceEvidence(e.context,e.evidence,e.request,{publicationPolicy:parseWitnessPublicationPolicy(json)}).publicationBeforeStart).not.toBe('witnessed-before-signed-start');}
    });
    test('a CPO key re-labeled as an independent witness is excluded even with a genuine receipt signature',()=>{
        const e=example(),json=parseJSON(prettyJSON(e.policy.json)) as JSONObject,witness=defined((json['witnesses'] as JSONObject[])[0]);
        const cpo=((e.evidence['chargingStationProof'] as JSONObject)['roamingNetwork'] as JSONObject)['chargingStationOperators'] as JSONObject[];
        const key=defined((defined(cpo[0])['signingKeys'] as JSONObject[])[0]);witness['keys']=[{...key,usages:['witnessPublications']}];witness['id']='CPO-ALIAS';
        const receipt=defined((e.evidence['publicationReceipts'] as JSONObject[])[0]);receipt['witnessId']='CPO-ALIAS';receipt['keyId']=defined(key['@id']);
        const privateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.alloc(32,161)]),format:'der',type:'pkcs8'});
        receipt['value']=sign(null,PricePublicationReceipt.parse(receipt).signingBytes(),privateKey).toString('base64');
        const result=verifySessionPriceEvidence(e.context,e.evidence,e.request,{publicationPolicy:parseWitnessPublicationPolicy(json)});
        expect(result.publicationBeforeStart).toBe('invalid');expect(result.publicationWitnesses?.receipts[0]?.detail).toMatch(/RNO\/CPO/);
    });
    test('receipts cannot replace inclusion, genuine CPO signatures or a verified start association',()=>{
        const e=example();delete e.evidence['priceStatementProofs'];delete e.evidence['checkpoints'];
        const result=verifySessionPriceEvidence(e.context,e.evidence,e.request,{publicationPolicy:e.policy});
        expect(result.publication).toBe('missing');expect(result.publicationBeforeStart).not.toBe('witnessed-before-signed-start');
        const bad=example();defined((bad.evidence['priceStatements'] as JSONObject[])[0])['value']='AAAA';
        expect(verifySessionPriceEvidence(bad.context,bad.evidence,bad.request,{publicationPolicy:bad.policy}).publicationBeforeStart).toBe('not-proven');
    });
});
