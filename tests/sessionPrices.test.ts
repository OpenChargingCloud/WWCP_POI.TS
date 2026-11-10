import {readFileSync} from 'node:fs';
import {createHash,createPrivateKey,sign} from 'node:crypto';
import {describe,expect,test} from 'vitest';
import {parseJSON,prettyJSON,TrustAnchor,KeyStatement,HistoricalTrustContext,verifySessionPriceEvidence,parseTrustedWitnesses,verifyAuthorizedCheckpoint,Checkpoint,SessionPriceAgreement,type JSONObject} from '../src/index.ts';
import {grossRates,type GrossRates} from '../src/verifier/grossRates.ts';
const input=(name:string):JSONObject=>parseJSON(readFileSync(new URL(`./vectors/session-price-${name}.json`,import.meta.url),'utf8')) as JSONObject;
function example(name:string='ed'): {context:HistoricalTrustContext;evidence:JSONObject;request:{evseId:string;meterSerialNumber:string;chargingStarted:number;startDocumentSHA256:string}} {
    const raw=input(name),poi=raw['poiEvidence'] as JSONObject,bootstrap=poi['bootstrap'] as JSONObject,anchor=TrustAnchor.parse(bootstrap['trustAnchor'] as string);
    const context=HistoricalTrustContext.create(anchor,KeyStatement.parse((bootstrap['keyStatement'] as JSONObject)['keyStatement']),{trustedIdentityKeyIds:anchor.keys,now:Date.parse('2026-11-01T00:16:21Z')});
    return {context,evidence:poi['priceEvidence'] as JSONObject,request:{evseId:'DE*POI*E1*1',meterSerialNumber:'CHARGY-POI-METER-001',chargingStarted:Date.parse('2026-06-01T10:00:00Z'),startDocumentSHA256:createHash('sha256').update(raw['ocmfBegin'] as string).digest('hex')}};
}
describe('CPO price assignment and separate publication evidence',()=>{
    test.each(['ed','pqc'])('%s uses the existing generic signature algorithms and a fixed price at the original start',name=>{
        const e=example(name),result=verifySessionPriceEvidence(e.context,e.evidence,e.request);
        expect(result.signatures).toBe('valid');expect(result.agreement).toBe('valid');expect(result.applicability).toBe('bound');expect(result.publication).toBe('valid');
        expect(result.selected?.statement['algorithm']).toBe(name==='ed'?'Ed25519':'ML-DSA-65');
        expect(result.publicationBeforeStart).toBe('not-proven');expect(result.customerConsent).toBe('not-proven');
        expect(result.witnessedBy).toEqual([]);
    });
    test('signed decimals survive serialization and are never normalized through binary floating point',()=>{
        const e=example('decimal'),result=verifySessionPriceEvidence(e.context,parseJSON(prettyJSON(e.evidence)),e.request);
        expect(result.selected?.rates?.energyPerKWh).toBe('0.3500');expect(result.applicability).toBe('bound');
    });
    test('missing or tampered assignment cannot establish binding',()=>{
        const e=example();delete e.evidence['agreement'];expect(verifySessionPriceEvidence(e.context,e.evidence,e.request).applicability).toBe('unbound');
        const changed=example();(changed.evidence['agreement'] as JSONObject)['startDocumentSHA256']='ff'.repeat(32);
        expect(verifySessionPriceEvidence(changed.context,changed.evidence,changed.request).agreement).toBe('invalid');
    });
    test('publication is separate and requires supplied inclusion and explicit witness authority',()=>{
        const e=example();delete e.evidence['priceStatementProofs'];delete e.evidence['checkpoints'];
        const pending=verifySessionPriceEvidence(e.context,e.evidence,e.request);expect(pending.applicability).toBe('bound');expect(pending.publication).toBe('missing');
        const complete=example();expect(verifySessionPriceEvidence(complete.context,complete.evidence,complete.request,{requiredWitnesses:1}).publication).toBe('invalid');
        const witnesses=parseTrustedWitnesses(parseJSON(readFileSync(new URL('./vectors/history-witnesses.json',import.meta.url),'utf8')));
        expect(verifySessionPriceEvidence(complete.context,complete.evidence,complete.request,{witnesses,requiredWitnesses:1}).publication).toBe('valid');
    });
    test('the shared checkpoint authority independently rejects malformed compromise times',()=>{
        const e=example(),entry=(e.evidence['checkpoints'] as JSONObject[])[0];if(entry===undefined)throw new Error('Missing checkpoint');
        expect(()=>verifyAuthorizedCheckpoint(e.context,Checkpoint.parse(entry['checkpoint']),entry['operator']??null,{revocations:[{keyId:'test',invalidFrom:NaN}]})).toThrow(/compromise/);
    });
    test('foreign subjects and revoked CPO keys are refused without importing authority from evidence',()=>{
        const e=example();expect(()=>verifySessionPriceEvidence(e.context,e.evidence,{...e.request,evseId:'FOREIGN'})).toThrow();
        const keyId=((e.evidence['priceStatements'] as JSONObject[])[0] as JSONObject)['keyId'] as string;
        expect(verifySessionPriceEvidence(e.context,e.evidence,e.request,{revocations:[{keyId,invalidFrom:0}]}).signatures).toBe('invalid');
        expect(()=>HistoricalTrustContext.create(e.context.authorizedAnchor,KeyStatement.parse((((input('ed')['poiEvidence'] as JSONObject)['bootstrap'] as JSONObject)['keyStatement'] as JSONObject)['keyStatement']),{trustedIdentityKeyIds:[]})).toThrow();
    });
    test('a flat fee without a step size is a gross rate, as a FLAT price component has none; energy and time need one',()=>{
        const rates=(components:string):GrossRates|undefined=>grossRates('EUR',[parseJSON(`{"priceComponents":[${components}]}`) as JSONObject]);
        expect(rates('{"type":"FLAT","price":1.00},{"type":"ENERGY","price":0.65,"stepSize":1}')).toEqual({currency:'EUR',flatFee:'1.00',energyPerKWh:'0.65'});
        expect(rates('{"type":"FLAT","price":1.00},{"type":"TIME","price":2.40,"stepSize":60}')).toEqual({currency:'EUR',flatFee:'1.00',timePerHour:'2.40'});
        expect(rates('{"type":"FLAT","price":1.00,"stepSize":1}')).toBeUndefined();
        expect(rates('{"type":"FLAT","price":1.00,"stepSize":null}')).toBeUndefined();
        expect(rates('{"type":"ENERGY","price":0.65}')).toBeUndefined();
        expect(rates('{"type":"TIME","price":2.40,"stepSize":0}')).toBeUndefined();
    });
    test.each([
        ['contract','chargy-contract-gross-rates/v1','bound'],
        ['adhoc','chargy-gross-rates/v1','bound'],
        ['contract','chargy-gross-rates/v1','unsupported'],
        ['adhoc','chargy-contract-gross-rates/v1','unsupported'],
        ['subscription','chargy-contract-gross-rates/v1','unsupported'],
    ])('an assignment of a session %s of the profile %s is %s: through an e-mobility provider, of the price its CPO charges the provider, of the profile of contracts',(mode,profile,applicability)=>{
        // The CPO test key of the vector: Ed25519 of the seed 161, signing deterministically.
        const key=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.alloc(32,161)]),format:'der',type:'pkcs8'});
        const e=example(),agreement=e.evidence['agreement'] as JSONObject;agreement['chargingMode']=mode;agreement['pricingProfile']=profile;
        agreement['value']=sign(null,SessionPriceAgreement.parse(agreement).signingBytes(),key).toString('base64');
        const result=verifySessionPriceEvidence(e.context,e.evidence,e.request);
        expect(result.agreement).toBe('valid');expect(result.applicability).toBe(applicability);expect(result.selected?.rates?.energyPerKWh).toBe('0.35');
    });
});
