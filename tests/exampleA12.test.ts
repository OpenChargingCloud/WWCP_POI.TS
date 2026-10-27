import { describe, expect, it } from 'vitest';

import { AT, asText, defined, readJSON, UNCHECKED } from './helpers.ts';
import { anchorPQ } from './qa.ts';

import { RoamingNetwork }     from '../src/network/roamingNetwork.ts';
import { Commit }             from '../src/history/commit.ts';
import { History }            from '../src/history/history.ts';
import { OperatorTrust }      from '../src/verifier/trust.ts';
import { RuntimeStatus, parseFrame, parseStatusUpdate, subscribeRequest } from '../src/live.ts';
import { canonicalJSON }      from '../src/json/canonical.ts';
import { toTimestamp }        from '../src/common.ts';
import { clone, get, type JSONArray, type JSONObject } from '../src/json/value.ts';


// Example A12: the atlas and the traffic report, live. What the driver's app got over the WebSocket of the mirror,
// driver/live.json, and what the mirror serves, published/QA-live-snapshot.json, checked as ExampleA12.Validate() does.

const live      = readJSON('driver/live.json') as JSONObject;
const pushes    = (live['pushes'] as JSONArray).map(frame => parseFrame(frame));
// The run is one of WWCP_POI 987fa26, before a snapshot of the head carried the attestations of its head (ff2c56f): it is
// taken unanchored here, its head checked against the trust anchor of epoch 2 by OperatorTrust.
const snapshot  = readJSON('published/QA-live-snapshot.json') as JSONObject;


describe('Example A12: the traffic report and the atlas', () => {

    it('finds the status updates unsigned, and the head before and after them the same commit (a)', () => {

        const updates = pushes.filter(push => push.type === 'push' && push.action !== 'commit');

        expect(updates.map(push => push.type === 'push' ? push.action : '')).toEqual([ 'statusUpdate', 'energyStatusUpdate', 'priceStatusUpdate', 'statusUpdate' ]);
        expect(updates.every(push => get(push.payload as JSONObject, 'signatures') === undefined)).toBe(true);

        const statuses = updates.map(push => parseStatusUpdate(push.payload));
        expect(statuses.map(update => `${update.entityId} ${update.kind}: ${typeof update.value === 'string' ? update.value : canonicalJSON(update.value)}`)).toEqual([
            'DE*GEF*E1*1 status: charging',
            'DE*GEF*E1*1 energyStatus: {"available":52000,"currentVoltage":780,"remainingChargingTime":1500,"used":98000}',
            'DE*GEF*E1*1 priceStatus: {"prices":[{"chargingTariffId":"DE*GEF*T_DC","elements":[{"priceComponents":[{"price":0.49,"stepSize":1,"type":"ENERGY"}]}]}]}',
            'DE*GEF*E1*1 status: available',
        ]);
        expect(defined(statuses[0]).oldValue).toBe('available');

        const before = live['headBefore'] as JSONObject;
        const after  = live['headAfter']  as JSONObject;
        expect([ before['revision'], after['revision'] ]).toEqual([ 2, 2 ]);
        expect(before['@id']).toBe(after['@id']);

    });

    it('checks the commit pushed against the trust anchor of epoch 2: the head of the mirror (b)', () => {

        const push    = defined(pushes.find(item => item.type === 'push' && item.action === 'commit'));
        const commit  = Commit.parse(push.payload);
        const mirror  = History.fromSnapshot(snapshot, UNCHECKED);
        const trust   = OperatorTrust.of(anchorPQ, mirror.head.network, AT);

        const signedBy = trust.verifyOperatorSignatures(commit.signatures, (signature, key) => { commit.verifySignature(signature, key); }, 'the commit');

        expect(commit.revision).toBe(3);
        expect(commit.epoch).toBe(2);
        expect(commit.description).toBe('The DC charging tariff: 0.65 €/kWh');
        expect(((defined(commit.changeSet)['signatures'] as JSONObject[]).map(signature => signature['algorithm']))).toEqual([ 'ML-DSA-65' ]);
        expect([ ...signedBy ].sort()).toEqual([ 'AlphaOrg', 'BetaOrg', 'GammaOrg' ]);
        expect(commit.signatures.map(signature => signature.algorithm)).toEqual([ 'ML-DSA-65', 'ML-DSA-65', 'ML-DSA-65' ]);
        expect(commit.id).toBe(mirror.head.commit.id);

        // And taken by a history of epoch 2 at revision 2, its change set applied: the version the mirror serves.
        const history = History.fromSnapshot(readJSON('published/QA-epoch-2-checkpoint-0-snapshot.json'), UNCHECKED);
        const version = history.append(commit);
        expect(version.network.eTags()).toEqual(RoamingNetwork.parse((snapshot['roamingNetwork'] as JSONObject)).eTags());

    });

    it('keeps the runtime status outside the version, latest first (c)', () => {

        // The runtime status the mirror serves next to its head: not part of the version, without it the same version.
        const status = RuntimeStatus.fromSnapshot(snapshot);
        const now    = defined(status.get('EVSE', 'DE*GEF*E1*1', 'status'));

        expect(`${asText(now.value)} since ${toTimestamp(now.timestamp)}`).toBe('charging since 2026-10-26T00:56:51.035Z');

        const withoutStatus = clone(snapshot);
        delete withoutStatus['runtimeStatus'];
        expect(History.fromSnapshot(withoutStatus, UNCHECKED).head.commit.id).toBe(History.fromSnapshot(snapshot, UNCHECKED).head.commit.id);

        // A report that comes late, of five minutes ago: its status stays.
        const late = parseStatusUpdate({ entityId: 'DE*GEF*E1*1', entityType: 'EVSE', kind: 'status', timestamp: '2026-10-26T00:51:51.035Z', value: 'available' });
        expect(status.apply(late)).toBe('Outdated');
        expect(defined(status.get('EVSE', 'DE*GEF*E1*1')).value).toBe('charging');

        // No checkpoint holds runtime status.
        expect(get(readJSON('published/QA-epoch-2-checkpoint-0-snapshot.json') as JSONObject, 'runtimeStatus')).toBeUndefined();

        // What the app sends to be told of changes.
        expect(subscribeRequest('1')).toBe('[2,"1","subscribe",{"topics":["statusUpdates","energyStatusUpdates","priceStatusUpdates","commits"]}]');

    });

});
