import {describe,expect,test} from 'vitest';
import {compareObservedVersions,emptyObservedVersions,type VersionObservation} from '../src/index.ts';
const point=(position:number,digest:string,previous?:string):VersionObservation=>({kind:'checkpoint',chain:'network',epoch:'1',position,revision:position,digest:digest.repeat(64),original:'signed original',...(previous===undefined?{}:{previous:previous.repeat(64)})});
describe('Local authenticated version comparisons (no authorization granted)',()=>{
    test('persists negative constraints across independent comparisons, idempotently matching exact versions',()=>{
        const a=compareObservedVersions(emptyObservedVersions(),[point(0,'a')],'current',1);expect(a.accepted).toBe(true);
        expect(compareObservedVersions(a.state,[point(0,'a')],'current',2).status).toBe('matches');
        const b=compareObservedVersions(a.state,[point(1,'b','a')],'current',3);expect(b.accepted).toBe(true);
        expect(compareObservedVersions(b.state,[point(0,'a')],'current',4).issues.some(issue=>issue.code==='rollback')).toBe(true);
        expect(compareObservedVersions(b.state,[point(0,'a')],'historical',4).accepted).toBe(true);
    });
    test('a fork is retained and quarantines later source switches',()=>{
        const a=compareObservedVersions(emptyObservedVersions(),[point(0,'a')],'current',1);
        const fork=compareObservedVersions(a.state,[point(0,'b')],'current',2);expect(fork.accepted).toBe(false);expect(fork.state.points[0]?.digest).toBe('a'.repeat(64));
        expect(fork.state.conflicts).toHaveLength(1);expect(compareObservedVersions(fork.state,[point(0,'a')],'current',3).issues.some(issue=>issue.code==='known-fork')).toBe(true);
    });
    test('missing links do not advance an accepted head and may subsequently be supplied',()=>{
        const a=compareObservedVersions(emptyObservedVersions(),[point(0,'a')],'current',1);
        const gap=compareObservedVersions(a.state,[point(2,'c','b')],'current',2);expect(gap.issues.some(issue=>issue.code==='continuity-missing')).toBe(true);
        expect(gap.state.heads[JSON.stringify(['checkpoint','network'])]?.position).toBe(0);
        const filled=compareObservedVersions(gap.state,[point(1,'b','a'),point(2,'c','b')],'current',3);expect(filled.accepted).toBe(true);
    });
    test('known adjacent predecessor contradictions and epoch resets cannot hide behind valid hashes',()=>{
        const a=compareObservedVersions(emptyObservedVersions(),[point(0,'a')],'current',1);
        expect(compareObservedVersions(a.state,[point(1,'b','c')],'current',2).issues.some(issue=>issue.code==='link')).toBe(true);
        expect(compareObservedVersions(a.state,[{...point(0,'b'),epoch:'2'}],'current',2).issues.some(issue=>issue.code==='epoch-transition')).toBe(true);
    });
    test('ordered snapshots and irregular live timestamps have different continuity rules',()=>{
        const a=compareObservedVersions(emptyObservedVersions(),[{...point(5,'a'),kind:'station'}],'current',1);
        expect(compareObservedVersions(a.state,[{...point(90,'b'),kind:'station'}],'current',2).accepted).toBe(true);
        const live=compareObservedVersions(emptyObservedVersions(),[{...point(1000,'a'),kind:'live'}],'current',1);
        expect(compareObservedVersions(live.state,[{...point(9000,'b','a'),kind:'live'}],'current',2).accepted).toBe(true);
    });
});

test('a rejected gap cannot become accepted just by submitting its tip again',()=>{
    const start=compareObservedVersions(emptyObservedVersions(),[point(0,'a')],'current',1);
    const gap=compareObservedVersions(start.state,[point(2,'c','b')],'current',2);
    expect(compareObservedVersions(gap.state,[point(2,'c','b')],'current',3).accepted).toBe(false);
    const filler=compareObservedVersions(gap.state,[point(1,'b','a')],'current',4);expect(filler.accepted).toBe(false);
    expect(compareObservedVersions(filler.state,[point(2,'c','b')],'current',5).accepted).toBe(true);
});
test('mixed current epochs are not merged and historical observations never advance current heads',()=>{
    expect(compareObservedVersions(emptyObservedVersions(),[point(0,'a'),{...point(0,'b'),epoch:'2'}],'current',1).accepted).toBe(false);
    const history=compareObservedVersions(emptyObservedVersions(),[point(0,'a')],'historical',2);expect(history.state.heads).toEqual({});
    expect(compareObservedVersions(history.state,[point(1,'b','a')],'current',3).accepted).toBe(true);
});
test('known forks quarantine only their own chain and identity changes cannot pin a new live key',()=>{
    const live={...point(0,'a'),kind:'live' as const,identity:'1'.repeat(64)};
    const initial=compareObservedVersions(emptyObservedVersions(),[live],'current',1);
    const changed=compareObservedVersions(initial.state,[{...live,position:1,digest:'b'.repeat(64),previous:live.digest,identity:'2'.repeat(64)}],'current',2);
    expect(changed.issues.some(issue=>issue.code==='identity')).toBe(true);
    expect(compareObservedVersions(changed.state,[point(0,'c')],'current',3).accepted).toBe(true);
});
test('capacity limits do not silently evict observations and larger standardized hash sizes remain supported',()=>{
    expect(compareObservedVersions(emptyObservedVersions(),[{...point(0,'a'),digest:'b'.repeat(96)}],'current',1).accepted).toBe(true);
    const history={...emptyObservedVersions(),points:Array.from({length:4096},(_,index)=>({...point(index,'a'),chain:String(index)}))};
    expect(()=>compareObservedVersions(history,[{...point(0,'b'),chain:'overflow'}],'historical',1)).toThrow(/capacity/);
});

test('different live timestamps do not hide two children of the same authenticated predecessor',()=>{
    const first={...point(0,'a'),kind:'live' as const},second={...point(1000,'b','a'),kind:'live' as const};
    const accepted=compareObservedVersions(emptyObservedVersions(),[first,second],'current',1);
    const sibling={...point(2000,'c','a'),kind:'live' as const};
    expect(compareObservedVersions(accepted.state,[sibling],'historical',2).issues.some(issue=>issue.code==='link')).toBe(true);
});
