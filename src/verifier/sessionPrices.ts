/*
 * Copyright (c) 2014-2026 GraphDefined GmbH <achim.friedland@graphdefined.com>
 * This file is part of WWCP POI TS <https://github.com/OpenChargingCloud/WWCP_POI.TS>
 *
 * Licensed under the Affero GPL license, Version 3.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.gnu.org/licenses/agpl.html
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { requireObject, requireArray, requireString, requireTimestamp, onlyProperties } from '../common.ts';
import { asText, isObject, type JSONValue, type JSONObject } from '../json/value.ts';
import { canonicalJSONBytes } from '../json/canonical.ts';
import { isLowerHex, toHex } from '../encoding/text.ts';
import { verifySignature } from '../crypto/signature.ts';
import { TrustContext } from '../proofs/trustContext.ts';
import { ChargingStationProof } from '../proofs/stationProof.ts';
import { PriceStatement, PriceStatementProof } from '../proofs/priceStatement.ts';
import { Checkpoint } from '../history/checkpoint.ts';
import { verifyCheckpointLine } from './checkpoints.ts';
import { verifyChargingStation, verifyPriceStatements, type VerifiedChargingStation } from './chargingStation.ts';
import { HistoricalTrustContext, historicalOperatorContext, verifyAuthorizedCheckpoint, type HistoricalMeterPolicy } from './historicalMeasurements.ts';
import { POIPublicKey } from '../keys.ts';
import { verifyPricePublication, type WitnessPublicationPolicy, type PricePublicationVerification } from './pricePublication.ts';
import { POIError } from '../errors.ts';
import { grossRates } from './grossRates.ts';

export const SESSION_PRICE_EVIDENCE_CONTEXT = 'https://open.charging.cloud/contexts/wwcp/sessionPriceEvidence/v1';
export const SESSION_PRICE_AGREEMENT_CONTEXT = 'https://open.charging.cloud/contexts/wwcp/sessionPriceAgreement/v1';
export const SIMPLE_GROSS_PRICE_PROFILE = 'chargy-gross-rates/v1';
/** The same gross rates of a session started through an e-mobility provider, of a contract with it (`contract`): the
 *  rates the CPO charges the provider, not those the provider charges its customer. */
export const CONTRACT_GROSS_PRICE_PROFILE = 'chargy-contract-gross-rates/v1';
/** The profile of gross rates of each charging mode: the simple one of a session paid ad hoc, that of contracts of one
 *  through an e-mobility provider. */
const GROSS_PRICE_PROFILES: ReadonlyMap<string, string> = new Map([ [ 'adhoc', SIMPLE_GROSS_PRICE_PROFILE ], [ 'contract', CONTRACT_GROSS_PRICE_PROFILE ] ]);
/** Experimental CPO assertion, distinct from customer consent. */
export class SessionPriceAgreement {
    private constructor(public readonly json: JSONObject, public readonly chargingStarted: number, public readonly signedAt: number) {}
    public static parse(value: JSONValue): SessionPriceAgreement {
        const json = requireObject(value,'A session price assignment');
        onlyProperties(json,['@context','roamingNetworkId','EVSEId','meterSerialNumber','chargingStarted','startDocumentSHA256','chargingMode','chargingTariffId','priceStatementDigest','priceBinding','pricingProfile','role','signer','signedAt','algorithm','keyId','value'],'A session price assignment');
        if(json['@context']!==SESSION_PRICE_AGREEMENT_CONTEXT || json['role']!=='chargingStationOperator') throw new POIError('Unsupported price assignment context/role');
        for(const field of ['roamingNetworkId','EVSEId','meterSerialNumber','chargingMode','chargingTariffId','priceBinding','pricingProfile','signer','algorithm','keyId','value']) requireString(json,field);
        for(const field of ['startDocumentSHA256','priceStatementDigest']) if(!isLowerHex(requireString(json,field),32)) throw new POIError('Invalid price assignment digest');
        return new SessionPriceAgreement(json,requireTimestamp(json,'chargingStarted'),requireTimestamp(json,'signedAt'));
    }
    public signingBytes(): Uint8Array { const { value:_,...signed }=this.json; return canonicalJSONBytes(signed); }
    public verify(station: VerifiedChargingStation): void {
        if(this.json['roamingNetworkId']!==station.roamingNetwork.id || this.json['signer']!==station.operator['@id']) throw new POIError('Foreign price assignment authority');
        const key=station.operatorSigningKeys.find(item=>item.id===this.json['keyId']);
        if(key===undefined || !key.isValidAt(this.signedAt) || !key.isValidAt(this.chargingStarted) || !key.maySign('priceStatements')) throw new POIError('Unauthorized/expired price assignment key');
        verifySignature(requireString(this.json,'algorithm'),key.key,this.signingBytes(),requireString(this.json,'value'));
    }
}
export interface SessionPriceEvidence {
    readonly evseId: string; readonly proof: JSONValue; readonly priceStatements: readonly JSONValue[];
    readonly publicationReceipts: readonly JSONValue[]; readonly witnessCandidates: readonly JSONValue[];
    readonly agreement?: JSONValue; readonly priceProofs: readonly JSONValue[];
    readonly checkpoints: readonly { readonly checkpoint: JSONValue; readonly operator: JSONValue }[];
}
export function parseSessionPriceEvidence(value: JSONValue): SessionPriceEvidence {
    const json=requireObject(value,'Session price evidence');
    onlyProperties(json,['@context','EVSEId','chargingStationProof','priceStatements','agreement','priceStatementProofs','checkpoints','publicationReceipts','witnessCandidates'],'Session price evidence');
    if(json['@context']!==SESSION_PRICE_EVIDENCE_CONTEXT) throw new POIError('Unsupported session price evidence');
    const publicationReceipts=json['publicationReceipts']===undefined?[]:requireArray(json['publicationReceipts'],'Publication receipts');
    const witnessCandidates=json['witnessCandidates']===undefined?[]:requireArray(json['witnessCandidates'],'Untrusted witness recommendations');
    if(publicationReceipts.length>64||witnessCandidates.length>32)throw new POIError('Too many publication receipts or recommendations');
    return { publicationReceipts,witnessCandidates,evseId:requireString(json,'EVSEId'),proof:requireObject(json['chargingStationProof'],'The priced station proof'),priceStatements:requireArray(json['priceStatements'],'Price statements'),
        ...(json['agreement']===undefined?{}:{agreement:json['agreement']}),priceProofs:json['priceStatementProofs']===undefined?[]:requireArray(json['priceStatementProofs'],'Price inclusion proofs'),
        checkpoints:(json['checkpoints']===undefined?[]:requireArray(json['checkpoints'],'Price checkpoints')).map(item=>{
            const entry=requireObject(item,'A price checkpoint entry');onlyProperties(entry,['checkpoint','operator'],'A price checkpoint entry');
            return {checkpoint:requireObject(entry['checkpoint'],'A price checkpoint'),operator:requireObject(entry['operator'],'The checkpoint authority')};
        }) };
}
export interface SessionPriceRequest { readonly evseId:string;readonly meterSerialNumber:string;readonly chargingStarted:number;readonly startDocumentSHA256:string; }
export interface SessionPriceVerification {
    readonly station:VerifiedChargingStation;readonly signatures:'valid'|'invalid'|'missing';
    readonly applicability:'bound'|'unbound'|'missing'|'invalid'|'ambiguous'|'unsupported';readonly agreement:'valid'|'invalid'|'missing';
    readonly publication:'valid'|'invalid'|'missing'|'incomplete';readonly publicationBeforeStart:'not-proven'|'witnessed-before-signed-start'|'invalid';readonly publicationWitnesses?:PricePublicationVerification;readonly customerConsent:'not-proven';readonly latestOrSoleOffer:'not-proven';
    readonly chainGaps:boolean;readonly checkedAt:number;readonly checkpointIds:readonly string[];readonly witnessedBy:readonly string[];readonly diagnostics:readonly string[];
    readonly selected?:{readonly statement:JSONObject;readonly digest:string;readonly tariff:JSONObject;readonly currency:string;readonly elements:readonly JSONObject[];
        readonly rates?:{readonly currency:string;readonly energyPerKWh?:string;readonly flatFee?:string;readonly timePerHour?:string}};
}
export function verifySessionPriceEvidence(current:TrustContext|HistoricalTrustContext,value:JSONValue,request:SessionPriceRequest,
    policy:HistoricalMeterPolicy&{readonly publicationPolicy?:WitnessPublicationPolicy;readonly relatedCheckpoints?:readonly {readonly checkpoint:JSONValue;readonly operator:JSONValue}[]}={}):SessionPriceVerification {
    if(!(current instanceof TrustContext)&&!(current instanceof HistoricalTrustContext))throw new POIError('Session prices require current local authorization');
    if(!Number.isFinite(request.chargingStarted)||request.chargingStarted>current.evaluatedAt||!isLowerHex(request.startDocumentSHA256,32))throw new POIError('Invalid original price context');
    for(const item of policy.revocations??[])if(!Number.isFinite(item.invalidFrom))throw new POIError('Invalid compromise time');
    const evidence=parseSessionPriceEvidence(value);if(evidence.evseId!==request.evseId)throw new POIError('Price evidence belongs to another EVSE');
    const proof=ChargingStationProof.parse(evidence.proof),context=historicalOperatorContext(current,proof.roamingNetwork['operator']??null,request.chargingStarted);
    const station=verifyChargingStation(context,evidence.proof,{evseId:request.evseId}),diagnostics:string[]=[];
    const base={station,publicationBeforeStart:'not-proven' as const,customerConsent:'not-proven' as const,latestOrSoleOffer:'not-proven' as const,checkedAt:current.evaluatedAt,checkpointIds:[] as string[],witnessedBy:[] as string[]};
    const fail=(signatures:SessionPriceVerification['signatures'],applicability:SessionPriceVerification['applicability'],message:string):SessionPriceVerification=>({...base,signatures,applicability,agreement:'missing',publication:'missing',chainGaps:false,diagnostics:[message]});
    if(evidence.priceStatements.length===0)return fail('missing','missing','No signed price statement supplied');
    let statements:PriceStatement[];
    try{statements=evidence.priceStatements.map(item=>PriceStatement.parse(item));for(const statement of statements){
        statement.verify(station.roamingNetwork.id,asText(station.operator['@id']),station.operatorSigningKeys);
        if(statement.signedAt>current.evaluatedAt||(policy.revocations??[]).some(item=>item.keyId===statement.keyId&&statement.signedAt>=item.invalidFrom))throw new POIError('Future/revoked CPO price signature');
    }}catch(error){return fail('invalid','invalid',error instanceof Error?error.message:String(error));}
    let active:ReturnType<typeof verifyPriceStatements>;
    try{active=verifyPriceStatements(station,[...evidence.priceStatements],{at:request.chargingStarted});}
    catch(error){return fail('valid','invalid',error instanceof Error?error.message:String(error));}
    const chainGaps=statements.some(statement=>statement.sequence>0&&!statements.some(before=>statement.follows(before)));
    let agreement:SessionPriceAgreement|undefined;
    if(evidence.agreement!==undefined){try{
        agreement=SessionPriceAgreement.parse(evidence.agreement);agreement.verify(station);const a=agreement.json;
        if(a['EVSEId']!==request.evseId||a['meterSerialNumber']!==request.meterSerialNumber||agreement.chargingStarted!==request.chargingStarted||a['startDocumentSHA256']!==request.startDocumentSHA256||agreement.signedAt>current.evaluatedAt||
            (policy.revocations??[]).some(item=>item.keyId===a['keyId']&&agreement!==undefined&&agreement.signedAt>=item.invalidFrom))throw new POIError('Price assignment does not match this original session');
    }catch(error){return {...fail('valid','invalid',error instanceof Error?error.message:String(error)),agreement:'invalid',chainGaps};}}
    const tariffs=station.tariffs.get(request.evseId)??[];
    const candidates=[...active.values()].flatMap(({statement,digest})=>statement.prices.flatMap(price=>{const tariff=tariffs.find(item=>item['@id']===price['chargingTariffId']);return tariff===undefined?[]:[{statement,digest,tariff,price}];}));
    const eligible=agreement===undefined?candidates:candidates.filter(item=>item.digest===agreement.json['priceStatementDigest']&&item.tariff['@id']===agreement.json['chargingTariffId']);
    if(eligible.length!==1)return {...fail('valid',eligible.length===0?'missing':'ambiguous',eligible.length===0?'No selected tariff/price is active at charging start':'Competing price/tariff candidates need a signed selection'),agreement:agreement===undefined?'missing':'invalid',chainGaps};
    const selected=eligible[0];if(selected===undefined)throw new POIError('Missing selected price');
    const currency=requireString(selected.tariff,'currency'),elements=requireArray(selected.price['elements'],'Signed price elements').map(item=>requireObject(item,'A signed price element')),rates=grossRates(currency,elements);
    let applicability:SessionPriceVerification['applicability']=agreement===undefined?'unbound':'bound';
    if(agreement!==undefined&&(agreement.json['pricingProfile']!==GROSS_PRICE_PROFILES.get(asText(agreement.json['chargingMode']))||agreement.json['priceBinding']!=='fixed-at-start'||rates===undefined)){
        applicability='unsupported';diagnostics.push('EMP/contract terms, variable binding, unknown price profile or conditional elements are not established by this profile');
    }
    let publication:SessionPriceVerification['publication']='missing';const checkpointIds:string[]=[],witnessed=new Set<string>();
    if(evidence.priceProofs.length>0||evidence.checkpoints.length>0){try{
        const entries=evidence.checkpoints.map(entry=>({...entry,checked:verifyAuthorizedCheckpoint(current,Checkpoint.parse(entry.checkpoint),entry.operator,policy)})),byId=new Map(entries.map(entry=>[entry.checked.checkpoint.id,entry.checked])),heads=new Map<string,string>();
        for(const checked of [...entries.map(entry=>entry.checked),...(policy.relatedCheckpoints??[]).map(entry=>verifyAuthorizedCheckpoint(current,Checkpoint.parse(entry.checkpoint),entry.operator,policy))]){
            const cp=checked.checkpoint,coordinate=`${cp.epoch}:${cp.sequence}`;if(heads.has(coordinate)&&heads.get(coordinate)!==cp.id)throw new POIError('Conflicting station/price checkpoint heads');heads.set(coordinate,cp.id);
        }
        let selectedProof=false;
        for(const raw of evidence.priceProofs){const p=PriceStatementProof.parse(raw),checked=byId.get(p.checkpointId);if(checked===undefined)throw new POIError('Missing price checkpoint');
            p.priceStatement.verify(station.roamingNetwork.id,asText(station.operator['@id']),station.operatorSigningKeys);
            if(!statements.some(statement=>statement.digestHex()===p.priceStatement.digestHex()))throw new POIError('Price proof belongs to an unsupplied statement');p.verify(checked.checkpoint);
            if(p.priceStatement.digestHex()!==selected.digest)continue;selectedProof=true;checkpointIds.push(checked.checkpoint.id);for(const name of checked.witnessedBy)witnessed.add(name);
            if(p.priceStatement.after!==undefined){const after=byId.get(p.priceStatement.after)?.checkpoint;
                if(after===undefined){publication='incomplete';diagnostics.push('Missing checkpoint named by after-link');continue;}
                if(after.epoch!==checked.checkpoint.epoch||after.sequence>=checked.checkpoint.sequence)throw new POIError('Invalid checkpoint temporal order');
                verifyCheckpointLine(entries.map(entry=>entry.checked.checkpoint).filter(cp=>cp.epoch===after.epoch&&cp.sequence>=after.sequence&&cp.sequence<=checked.checkpoint.sequence).sort((a,b)=>a.sequence-b.sequence));
            }
        }
        if(publication!=='incomplete')publication=selectedProof?'valid':'missing';
    }catch(error){publication='invalid';diagnostics.push(error instanceof Error?error.message:String(error));}}
    const operator=proof.roamingNetwork['operator'];
    const operatorJSON=isObject(operator)?operator:{};
    const authorities=[operatorJSON,...evidence.checkpoints.map(entry=>isObject(entry.operator)?entry.operator:{})];
    const partyKeys=[...station.operatorSigningKeys,...POIPublicKey.parseAll(station.operator['identityKeys']??[],'CPO identity keys')];
    for(const authority of authorities){
        partyKeys.push(...POIPublicKey.parseAll(authority['identityKeys']??[],'RNO identity keys'));
        const certificates=Array.isArray(authority['signingKeyCertificates'])?authority['signingKeyCertificates']:[];
        for(const certificate of certificates)if(isObject(certificate)&&certificate['signingKey']!==undefined)partyKeys.push(POIPublicKey.parse(certificate['signingKey']));
    }
    const publicationWitnesses=verifyPricePublication(evidence.publicationReceipts,policy.publicationPolicy,{
        roamingNetworkId:station.roamingNetwork.id,evseId:request.evseId,statement:selected.statement,tariff:selected.tariff,chargingStarted:request.chargingStarted,now:current.evaluatedAt,
        checkpoints:publication==='valid'?evidence.checkpoints.map(entry=>Checkpoint.parse(entry.checkpoint)).filter(cp=>checkpointIds.includes(cp.id)):[],
        excludedKeyMaterial:partyKeys.map(key=>toHex(key.key.thumbprint())),excludedIdentities:[asText(station.operator['@id']),...authorities.map(authority=>asText(authority['@id']))]
    });
    if(policy.requirePublication===true&&publication!=='valid')diagnostics.push('Required price publication evidence is incomplete');
    return {...base,publicationWitnesses,publicationBeforeStart:publicationWitnesses.status,signatures:'valid',applicability,agreement:agreement===undefined?'missing':'valid',publication,chainGaps,diagnostics,checkpointIds,witnessedBy:[...witnessed],
        selected:{statement:selected.statement.json,digest:selected.digest,tariff:selected.tariff,currency,elements,...(rates===undefined||![...GROSS_PRICE_PROFILES.values()].includes(asText(agreement?.json['pricingProfile']))?{}:{rates})}};
}
