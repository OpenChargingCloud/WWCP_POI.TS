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
import { canonicalJSONBytes, prettyJSON } from '../json/canonical.ts';
import { hash } from '../crypto/hash.ts';
import { toHex } from '../encoding/text.ts';
import type { JSONValue } from '../json/value.ts';
import type { ChargingStationProof } from '../proofs/stationProof.ts';
import type { Checkpoint } from '../history/checkpoint.ts';
import type { PriceStatement } from '../proofs/priceStatement.ts';
import { POIError } from '../errors.ts';

/** Authenticated observations supplied by the caller, never imported success flags. Comparison grants no authority. */
export interface VersionObservation {
    readonly kind:'station'|'checkpoint'|'price'|'live'|'policy';
    readonly chain:string;readonly epoch:string;readonly position:number;readonly digest:string;
    readonly revision?:number;readonly previous?:string;readonly identity?:string;readonly original:string;readonly final?:boolean;readonly rootDigest?:string;
}
export interface VersionConflict {
    readonly code:'fork'|'identity'|'link';readonly kind:VersionObservation['kind'];readonly chain:string;readonly epoch:string;
    readonly position:number;readonly known:string;readonly incoming:string;readonly original:string;readonly observedAt:number;
}
export interface ObservedVersions {
    readonly version:1;readonly points:readonly VersionObservation[];
    readonly transitions?:readonly {readonly id:string;readonly sequence:number;readonly fromPolicyId:string;readonly toPolicyId:string;readonly fromEpoch:number;readonly toEpoch:number;readonly original:string}[];
    readonly heads:Readonly<Record<string,{readonly epoch:string;readonly position:number;readonly digest:string}>>;
    readonly conflicts:readonly VersionConflict[];
}
export interface VersionIssue {readonly code:'fork'|'identity'|'link'|'known-fork'|'rollback'|'continuity-missing'|'epoch-transition';readonly kind:VersionObservation['kind'];readonly chain:string;readonly detail:string;}
export interface VersionComparison {
    readonly accepted:boolean;readonly status:'first-seen'|'matches'|'advanced'|'historical'|'rejected';
    readonly issues:readonly VersionIssue[];readonly state:ObservedVersions;
}
export function emptyObservedVersions():ObservedVersions {return {version:1,points:[],heads:{},conflicts:[]};}
export function observedVersionsChecksum(value:JSONValue):string {return toHex(hash('sha256',canonicalJSONBytes(value)));}
function key(point:Pick<VersionObservation,'kind'|'chain'>):string {return JSON.stringify([point.kind,point.chain]);}
function coordinate(point:VersionObservation):string {return JSON.stringify([point.kind,point.chain,point.epoch,point.position]);}
function digest(value:string):boolean {return /^(?:[0-9a-f]{64}|[0-9a-f]{96}|[0-9a-f]{128})$/u.test(value);}
function isSchema(value:unknown):boolean {return value===1;}
function valid(point:VersionObservation):void {
    if(!['station','checkpoint','price','live','policy'].includes(point.kind)||point.chain.length===0||point.chain.length>2048||point.epoch.length>128||
        !Number.isSafeInteger(point.position)||point.position<0||!digest(point.digest)||point.previous!==undefined&&!digest(point.previous)||
        point.identity!==undefined&&!digest(point.identity)||point.revision!==undefined&&(!Number.isSafeInteger(point.revision)||point.revision<0)||typeof point.original!=='string'||point.original.length===0||point.original.length>4*1024*1024)
        throw new POIError('Invalid observed version');
}
/** Deterministic negative constraints. Current selection is monotonic; historical inspection permits older coordinates, never contradictory ones. */
export function compareObservedVersions(before:ObservedVersions,candidates:readonly VersionObservation[],mode:'current'|'historical',observedAt:number):VersionComparison {
    if(!isSchema(before.version)||!Number.isFinite(observedAt)||before.points.length>4096||before.conflicts.length>128)throw new POIError('Invalid observed history');
    for(const point of [...before.points,...candidates])valid(point);
    const points=new Map(before.points.map(point=>[coordinate(point),point])),conflicts=[...before.conflicts],issues:VersionIssue[]=[];
    const heads={...before.heads};
    const issue=(point:VersionObservation,code:VersionIssue['code'],detail:string):void=>{issues.push({code,kind:point.kind,chain:point.chain,detail});};
    const conflict=(point:VersionObservation,known:VersionObservation,code:VersionConflict['code'],detail:string):void=>{
        issue(point,code,detail);
        if(!conflicts.some(item=>item.code===code&&item.kind===point.kind&&item.chain===point.chain&&item.epoch===point.epoch&&item.known===known.digest&&item.incoming===point.digest))
            conflicts.push({code,kind:point.kind,chain:point.chain,epoch:point.epoch,position:point.position,known:known.digest,incoming:point.digest,original:point.original,observedAt});
    };
    for(const point of candidates){
        const existing=points.get(coordinate(point));
        if(existing!==undefined&&existing.digest!==point.digest){conflict(point,existing,'fork','Two authenticated digests at the same coordinate');continue;}
        const identity=[...points.values()].find(item=>key(item)===key(point)&&item.identity!==undefined&&point.identity!==undefined&&item.identity!==point.identity);
        if(identity!==undefined){conflict(point,identity,'identity','The identity or pinned document keys of an observed chain changed');continue;}
        if(point.kind==='live'&&point.previous!==undefined){
            const sibling=[...points.values()].find(item=>key(item)===key(point)&&item.epoch===point.epoch&&item.previous===point.previous&&item.digest!==point.digest);
            if(sibling!==undefined){conflict(point,sibling,'link','Two authenticated live updates name the same predecessor');continue;}
        }
        if(existing===undefined)points.set(coordinate(point),point);
    }
    const groups=new Map<string,VersionObservation[]>();
    for(const point of points.values()){const group=JSON.stringify([point.kind,point.chain,point.epoch]);groups.set(group,[...groups.get(group)??[],point]);}
    for(const group of groups.values()){
        if(!candidates.some(candidate=>group.some(point=>key(point)===key(candidate))))continue;
        group.sort((a,b)=>a.position-b.position);
        for(let i=1;i<group.length;i++){
            const point=group[i],previous=group[i-1];if(point===undefined||previous===undefined||point.kind==='station')continue;
            if((point.kind==='price'||point.kind==='checkpoint')&&point.position===previous.position+1&&point.previous!==previous.digest)
                conflict(point,previous,'link','Authenticated adjacent versions contradict their predecessor link');
            if(point.kind==='checkpoint'&&point.previous===previous.digest&&point.revision!==undefined&&previous.revision!==undefined&&(point.revision<previous.revision||point.revision===previous.revision&&!(point.final===true&&point.rootDigest===previous.rootDigest)))conflict(point,previous,'link','Checkpoint revision does not increase');
        }
    }
    const selected=new Map<string,VersionObservation>();
    for(const point of candidates){const name=key(point),old=selected.get(name);if(old===undefined||old.epoch===point.epoch&&point.position>old.position)selected.set(name,point);}
    for(const point of selected.values()){
        if(conflicts.some(item=>item.kind===point.kind&&item.chain===point.chain))issue(point,'known-fork','This chain has an unresolved authenticated contradiction');
        if(mode==='historical')continue;
        if(new Set(candidates.filter(candidate=>key(candidate)===key(point)).map(candidate=>candidate.epoch)).size>1){issue(point,'epoch-transition','A current selection cannot combine epochs without a verified transition');continue;}
        const head=before.heads[key(point)];
        const closed=before.points.find(item=>item.kind==='checkpoint'&&item.epoch===point.epoch&&item.final===true);
        if(point.kind==='checkpoint'&&closed!==undefined&&point.position>closed.position){issue(point,'epoch-transition','This epoch was closed by its final checkpoint');continue;}
        if(head!==undefined&&head.epoch!==point.epoch){issue(point,'epoch-transition','An epoch change requires an explicitly verified transition');continue;}
        const prior=before.points.filter(item=>key(item)===key(point)&&item.epoch===point.epoch).sort((a,b)=>b.position-a.position)[0];
        if(prior!==undefined&&point.position<prior.position){issue(point,'rollback',`Version ${point.position} is older than locally observed ${prior.position}`);continue;}
        const anchor=head===undefined?prior:before.points.find(item=>key(item)===key(point)&&item.epoch===head.epoch&&item.digest===head.digest);
        if(anchor!==undefined&&point.position>anchor.position&&point.kind!=='station'){
            let cursor:VersionObservation|undefined=point;const visited=new Set<string>();
            while(cursor.digest!==anchor.digest&&!visited.has(cursor.digest)){
                visited.add(cursor.digest);const parent=[...points.values()].find(item=>key(item)===key(point)&&item.epoch===point.epoch&&item.digest===cursor?.previous);
                if(parent===undefined||parent.position>=cursor.position||(point.kind!=='live'&&parent.position+1!==cursor.position)){cursor=undefined;break;}
                cursor=parent;
            }
            if(cursor?.digest!==anchor.digest)issue(point,'continuity-missing','Missing authenticated predecessor path to the locally observed head');
        }
    }
    const accepted=issues.length===0;
    if(accepted&&mode==='current')for(const point of selected.values())heads[key(point)]={epoch:point.epoch,position:point.position,digest:point.digest};
    // Rollbacks/gaps may be authenticated observations, but never replace accepted current heads.
    if(points.size>4096||conflicts.length>128)throw new POIError('Observed history capacity reached; reset requires an explicit local decision');
    const state:ObservedVersions={...before,version:1,points:[...points.values()],heads,conflicts};
    const advanced=candidates.some(point=>before.points.some(old=>key(old)===key(point)&&old.epoch===point.epoch&&old.position<point.position));
    return {accepted,status:!accepted?'rejected':mode==='historical'?'historical':!before.points.some(old=>candidates.some(point=>key(point)===key(old)&&point.epoch===old.epoch))?'first-seen':advanced?'advanced':'matches',issues,state};
}

/** Metadata projection only: callers must authenticate each original with the normal role/quorum verifiers first. */
export function stationVersionObservation(proof:ChargingStationProof,epoch:string=''):VersionObservation {
    return {kind:'station',chain:'network',epoch,position:proof.revision,digest:proof.commitId,original:prettyJSON(proof.json)};
}
export function checkpointVersionObservation(checkpoint:Checkpoint):VersionObservation {
    return {kind:'checkpoint',chain:'network',epoch:String(checkpoint.epoch),position:checkpoint.sequence,revision:checkpoint.revision,digest:checkpoint.id,final:checkpoint.isFinal,rootDigest:checkpoint.commitId,
        ...(checkpoint.previousId===undefined?{}:{previous:checkpoint.previousId}),original:prettyJSON(checkpoint.json)};
}
export function priceVersionObservation(statement:PriceStatement):VersionObservation {
    return {kind:'price',chain:statement.chain,epoch:'',position:statement.sequence,digest:statement.digestHex(),
        ...(statement.previous===undefined?{}:{previous:statement.previous}),original:prettyJSON(statement.json)};
}

export function checkpointRootVersionObservation(checkpoint:Checkpoint):VersionObservation {
    return {kind:'station',chain:'network',epoch:checkpoint.epoch===1?'':String(checkpoint.epoch),position:checkpoint.revision,digest:checkpoint.commitId,original:prettyJSON(checkpoint.json)};
}
