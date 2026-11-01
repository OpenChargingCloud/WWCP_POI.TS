import {onlyProperties,requireObject,requireString,requireInteger,requireTimestamp,requireArray} from '../common.ts';
import {canonicalJSONBytes,prettyJSON} from '../json/canonical.ts';
import {get,type JSONValue,type JSONObject} from '../json/value.ts';
import {hash} from '../crypto/hash.ts';
import {verifySignature} from '../crypto/signature.ts';
import {toHex} from '../encoding/text.ts';
import {POIPublicKey} from '../keys.ts';
import {TrustAnchor} from '../proofs/trustAnchor.ts';
import {KeyStatement} from '../proofs/keyStatement.ts';
import {TrustContext} from '../proofs/trustContext.ts';
import {Checkpoint} from '../history/checkpoint.ts';
import {Commit} from '../history/commit.ts';
import {EpochProfiles,type Epoch} from '../history/epoch.ts';
import {sameETags} from '../etags.ts';
import {historicalOperatorContext,verifyAuthorizedCheckpoint} from './historicalMeasurements.ts';
import {OperatorTrust} from './trust.ts';
import {compareObservedVersions,checkpointVersionObservation,checkpointRootVersionObservation,type ObservedVersions,type VersionComparison} from './observedVersions.ts';
import {POIError} from '../errors.ts';

/** Experimental compact trust delegation; not a replacement for History.followedBy or full owner/change-set replay. */
export const TRUST_TRANSITION_CONTEXT='https://open.charging.cloud/contexts/wwcp/trustTransition/v1';
export const trustStatementDigest=(statement:KeyStatement):string=>toHex(hash('sha256',canonicalJSONBytes(statement.content())));
/** Same complete policy identity used by Chargy before this extension. */
export function trustPolicyId(anchor:TrustAnchor):string {
    return toHex(hash('sha256',new TextEncoder().encode(JSON.stringify({network:anchor.id,holders:anchor.holders,minConsensus:anchor.minConsensus,
        urls:anchor.urls.map(url=>new URL(url).href.replace(/\/+$/u,'')).sort()}))));
}
export class TrustTransition {
    private constructor(public readonly json:JSONObject,public readonly sequence:number,public readonly previous:string|undefined,
        public readonly signedAt:number,public readonly validUntil:number,public readonly fromPolicyId:string,public readonly fromStatementDigest:string,
        public readonly anchor:TrustAnchor,public readonly operator:JSONObject){}
    public static parse(value:JSONValue):TrustTransition {
        const json=requireObject(value,'A trust transition');onlyProperties(json,['@context','sequence','previous','fromPolicyId','fromStatementDigest','toAnchor','toOperator','signedAt','validUntil','checkpoints','epochChange','signatures'],'A trust transition');
        if(json['@context']!==TRUST_TRANSITION_CONTEXT||new TextEncoder().encode(prettyJSON(json)).length>2*1024*1024)throw new POIError('Unsupported or excessive trust transition');
        const previous=get(json,'previous'),sequence=requireInteger(json,'sequence',0,31);
        if((previous!==undefined)!==(sequence>0)||previous!==undefined&&(typeof previous!=='string'||!/^[0-9a-f]{64}$/u.test(previous)))throw new POIError('Invalid predecessor of a trust transition');
        const signedAt=requireTimestamp(json,'signedAt'),validUntil=requireTimestamp(json,'validUntil');if(validUntil<signedAt)throw new POIError('Invalid transition validity');
        return new TrustTransition(json,sequence,previous,signedAt,validUntil,requireString(json,'fromPolicyId'),requireString(json,'fromStatementDigest'),
            TrustAnchor.parse(requireString(json,'toAnchor')),requireObject(json['toOperator'],'The target operator'));
    }
    public content():JSONObject {const {signatures:_,...content}=this.json;return content;}
    public digest():string{return toHex(hash('sha256',canonicalJSONBytes(this.content())));}
    public signingBytes(side:string,algorithm:string,keyId:string):Uint8Array{return canonicalJSONBytes({...this.content(),side,algorithm,keyId});}
}
export interface TransitionVerificationOptions {readonly acceptedAt:number;readonly epoch:Epoch;readonly sequence:number;readonly previous?:string|undefined;}
/** Only produced after both holder quorums and the exact policies/evidence were authenticated. Never restored from a JSON flag. */
export class VerifiedTrustTransition {
    private constructor(public readonly source:TrustTransition,public readonly context:TrustContext,public readonly epoch:Epoch,
        public readonly checkpoints:readonly Checkpoint[],public readonly first:Checkpoint|undefined,public readonly oldEpoch:Epoch,
        public readonly signedBy:{readonly old:readonly number[];readonly next:readonly number[]}){}
    public static verify(basis:TrustContext,fromOperator:JSONValue,transition:TrustTransition,options:TransitionVerificationOptions):VerifiedTrustTransition {
        if(!Number.isFinite(options.acceptedAt)||options.acceptedAt<transition.signedAt||options.acceptedAt>transition.validUntil||transition.sequence!==options.sequence||transition.previous!==options.previous)
            throw new POIError('Transition is expired, out of order or not accepted within its signed interval');
        if(transition.fromPolicyId!==trustPolicyId(basis.anchor)||transition.fromStatementDigest!==basis.keyStatementDigest||transition.anchor.id!==basis.roamingNetworkId||transition.operator['@id']!==basis.roamingNetworkOperatorId)
            throw new POIError('Transition does not continue the exact authorized policy/network/operator');
        const oldOperator=requireObject(fromOperator,'Previous operator'),oldStatement=KeyStatement.parse(oldOperator['keyStatement']);
        OperatorTrust.fromOperatorJSON(basis,oldOperator);
        const nextStatement=KeyStatement.parse(transition.operator['keyStatement']);
        const identities=POIPublicKey.parseAll(transition.operator['identityKeys'],'Target identity keys');
        const next=TrustContext.create(transition.anchor,nextStatement,{trustedIdentityKeyIds:transition.anchor.keys,otherIdentityKeys:identities,at:transition.signedAt});
        OperatorTrust.fromOperatorJSON(next,transition.operator);
        if(next.roamingNetworkOperatorId!==basis.roamingNetworkOperatorId||next.requiredConsensus<basis.requiredConsensus)throw new POIError('A trust transition must not silently reduce the required holder quorum');
        // Existing holder groups cannot be split merely by relabeling the same previously trusted keys.
        for(const holder of basis.authorizedAnchor.holders)if(transition.anchor.holders.filter(group=>group.some(id=>holder.includes(id))).length>1)throw new POIError('A transition splits a previously known holder');
        const oldPool=[...oldStatement.identityKeys,...POIPublicKey.parseAll(oldOperator['identityKeys'],'Previous identity keys')],nextPool=[...nextStatement.identityKeys,...identities];
        const old=new Set<number>(),target=new Set<number>();
        for(const raw of requireArray(transition.json['signatures'],'Transition signatures')){
            const signature=requireObject(raw,'A transition signature');onlyProperties(signature,['side','algorithm','keyId','value'],'A transition signature');
            const side=requireString(signature,'side'),algorithm=requireString(signature,'algorithm'),id=requireString(signature,'keyId');
            if(side!=='old'&&side!=='new')throw new POIError('Invalid transition signature side');
            const groups=side==='old'?basis.trustedHolders:next.trustedHolders,pool=side==='old'?oldPool:nextPool,holder=groups.findIndex(group=>group.includes(id)),key=pool.find(key=>key.id===id);
            if(key?.isValidAt(transition.signedAt)!==true)throw new POIError('Transition signer is not an authorized valid identity key');
            verifySignature(algorithm,key.key,transition.signingBytes(side,algorithm,id),requireString(signature,'value'));
            if(holder>=0)(side==='old'?old:target).add(holder);
        }
        if(old.size<basis.requiredConsensus||target.size<next.requiredConsensus)throw new POIError('Both old and new holder quorums must sign the trust transition');
        const checkpoints=(transition.json['checkpoints']===undefined?[]:requireArray(transition.json['checkpoints'],'Transition checkpoints')).map(raw=>{
            const cp=Checkpoint.parse(raw),context=historicalOperatorContext(basis,oldOperator,cp.createdAt);
            verifyAuthorizedCheckpoint(context,cp,oldOperator);if(cp.epoch!==options.epoch.number)throw new POIError('The transition checkpoint line belongs to another epoch');return cp;
        });
        let epoch=options.epoch,first:Checkpoint|undefined;
        if(transition.json['epochChange']!==undefined){
            const change=requireObject(transition.json['epochChange'],'An epoch change');onlyProperties(change,['genesis','firstCheckpoint'],'An epoch change');
            const final=checkpoints.at(-1);if(final?.next===undefined)throw new POIError('An epoch transition needs the signed final checkpoint');
            if(final.createdAt>transition.signedAt)throw new POIError('The final checkpoint postdates the transition');
            const genesis=Commit.parse(change['genesis']),expected=Commit.genesisOf(basis.roamingNetworkId,final.json['eTags']??null,final.next);
            first=Checkpoint.parse(change['firstCheckpoint']);
            if(genesis.id!==expected.id||!first.isOf(expected)||first.sequence!==0||first.epoch!==final.next.number||first.previous?.checkpointId!==final.id||first.previous.epoch!==final.epoch||!sameETags(first.previous.eTags,final.eTags))
                throw new POIError('The next epoch must start from the exact deterministic genesis and final checkpoint');
            if((trustPolicyId(next.anchor)!==trustPolicyId(basis.anchor)||next.keyStatementDigest!==basis.keyStatementDigest)&&first.createdAt!==transition.signedAt)throw new POIError('A combined policy/epoch handoff must activate at its first checkpoint time');
            if(first.createdAt<final.createdAt||first.createdAt>transition.signedAt)throw new POIError('Invalid epoch-transition checkpoint times');
            const context=historicalOperatorContext(next,transition.operator,first.createdAt),trust=OperatorTrust.fromOperatorJSON(context,transition.operator);
            for(const profile of [options.epoch.profiles,final.next.profiles]){
                const signatures=first.signatures.filter(signature=>signature.role==='roamingNetworkOperator'&&profile.allowsSignatureAlgorithm(signature.algorithm));
                trust.verifyOperatorSignatures(signatures,(signature,key)=>first?.verifySignature(signature,key),'epoch-transition checkpoint');
            }
            for(const signature of first.signatures)if(!options.epoch.profiles.allowsSignatureAlgorithm(signature.algorithm)&&!final.next.profiles.allowsSignatureAlgorithm(signature.algorithm))throw new POIError('An epoch-transition signature uses neither accepted profile');
            epoch={...final.next,startedAt:first.createdAt};
        }
        return new VerifiedTrustTransition(transition,TrustContext.withEpoch(next,epoch,[...basis.epochs.filter(item=>item.number!==epoch.number),epoch]),epoch,checkpoints,first,options.epoch,{old:[...old],next:[...target]});
    }
}
/** Persist only original evidence and negative coordinates; authority is recreated on every resolver operation. */
export function applyVerifiedTrustTransition(before:ObservedVersions,verified:VerifiedTrustTransition,at:number):VersionComparison {
    const id=verified.source.digest(),known=before.transitions?.find(entry=>entry.id===id);
    const policy=compareObservedVersions(before,[{kind:'policy',chain:'trust',epoch:'',position:verified.source.sequence,digest:id,original:prettyJSON(verified.source.json),...(verified.source.previous===undefined?{}:{previous:verified.source.previous})}],'historical',at);
    if(!policy.accepted)return policy;before=policy.state;
    if(known!==undefined)return {accepted:true,status:'matches',issues:[],state:before};
    if((before.transitions?.length??0)!==verified.source.sequence)throw new POIError('The observed journal has another transition predecessor');
    const oldPoints=verified.checkpoints.flatMap(cp=>[checkpointVersionObservation(cp),checkpointRootVersionObservation(cp)]);
    const prior=compareObservedVersions(before,oldPoints,'current',at);if(!prior.accepted)return prior;
    let state=prior.state;
    if(verified.first!==undefined){
        const points=[checkpointVersionObservation(verified.first),checkpointRootVersionObservation(verified.first)],checked=compareObservedVersions(state,points,'historical',at);
        if(!checked.accepted)return checked;
        const heads={...checked.state.heads};for(const point of points)heads[JSON.stringify([point.kind,point.chain])]={epoch:point.epoch,position:point.position,digest:point.digest};
        state={...checked.state,heads};
    }
    return {accepted:true,status:'advanced',issues:[],state:{...state,transitions:[...state.transitions??[],{id,sequence:verified.source.sequence,
        fromPolicyId:verified.source.fromPolicyId,toPolicyId:trustPolicyId(verified.source.anchor),fromEpoch:verified.oldEpoch.number,toEpoch:verified.epoch.number,original:prettyJSON(verified.source.json)}]}};
}
export const initialTrustEpoch=():Epoch=>({number:1,profiles:EpochProfiles.FIRST});
