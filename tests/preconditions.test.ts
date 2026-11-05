import { describe, expect, it } from 'vitest';

import { rich } from './richNetwork.ts';

import { applyChangeSet } from '../src/history/apply.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification } from '../src/history/changeSet.ts';
import { etagToJSON } from '../src/etags.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';
import type { JSONObject, JSONValue } from '../src/json/value.ts';


// The preconditions of change sets (SPECIFICATION.md section 4, preconditions.ts): the ETag an entity must still have in
// the version a change set is applied to, over its representation as the roaming network embeds it. The ETags below are
// those WWCP_POI3 at 045e180 took as the ETags of these entities of QA, the after ETags those it calculated for the change.

const AT     = '2026-11-05T10:00:00.000Z';
const QA     = RoamingNetwork.parse(rich());
const AFTER  = [ 'b1da52b953ee91ee6561a1e8f0a049950bd4fd3a9f902ce78d2ebead37296525', '465697bccb1243047f330d5898c72acd11acb587e7f0166acfa4fe66d071ed5f' ] as const;
const POOL   = 'c77c0d24dab55b8f56e9ce02776856de3cae7714cb1df55c8a80e404948674e8';

const change = { kind: 'UpdateProperty', entityType: 'ChargingStation', entityId: 'DE*GEF*S2', propertyName: 'description', newValue: { en: 'Two' } };

/** A change set of the given change at AT with the given preconditions, unsigned, leading to the version of the given ETags, else to the one before. */
function changeSetOf(preconditions: JSONValue, after?: readonly [ string, string ], changes: JSONObject[] = [ change ]): ChangeSet {

    const beforeETags = QA.changeSetETags().map(eTag => etagToJSON(eTag));
    const json: JSONObject = {
        '@context':        CHANGE_SET_CONTEXT,
        roamingNetworkId:  QA.id,
        createdAt:         AT,
        changes,
        preconditions,
        beforeETags,
        afterETags:        after === undefined ? beforeETags : [ [ 'json', 'sha256', 'hex', after[0] ], [ 'cbor', 'sha256', 'hex', after[1] ] ],
    };

    json['@id'] = changeSetIdentification(json);

    return ChangeSet.parse(json);

}

/** Why the change set of the given preconditions is refused, word for word; 'taken' when it leads to the version WWCP_POI3 calculated. */
function outcome(preconditions: JSONValue, changes?: JSONObject[], after: readonly [ string, string ] = AFTER): string {
    try {
        applyChangeSet(QA, changeSetOf(preconditions, after, changes), { checkOwnership: false });
    }
    catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
    return 'taken';
}

const pre = (entityType: string, entityId: string, digest: string, format = 'json', algorithm = 'sha256'): JSONObject =>
    ({ entityType, entityId, eTag: [ format, algorithm, 'hex', digest ] });

const NOT_FIT = 'The change set does not fit this version of the roaming network: ';


describe('Preconditions', () => {

    it('hold for an entity of every kind, as the roaming network embeds it, with everything it embeds', () => {

        for (const precondition of [
            pre('RoamingNetwork',          'QA',                'f75b07d72c437c0fca96a49ca36d2da139424ccc87f29b6590a13b5a55214f61'),
            pre('ChargingStationOperator', 'DE*GEF',            '2425a31f9b6a5602cce84fd9cf804ab0b038e2d93c64d402d2c5787c01f5788d'),
            pre('ChargingPool',            'DE*GEF*P1',         POOL),
            pre('ChargingStation',         'DE*GEF*S1',         '29db04ef6000058af583be364477919fb6fce896b53406cf90eaf627faf03ec4'),
            pre('EVSE',                    'DE*GEF*E1*1',       '1364b20fb0253528dc4c55f1fc57c259c48a21aa97fbba846cb669bea65371ce'),
            pre('ConformityCertificate',   'PTB:2026-0017',     'f0c986637b8de6b9dbdc5271ee8566db9fcb015c909965f0e320c78714ddbf1c'),
            pre('EVSEGroup',               'DE*GDF*EG_FAV',     '080fcca09cf9aeecf614b1c12e971ce403bca4190987b44a9109e75ed8edbd0a'),
            pre('GridConnectionPoint',     'gcp-1',             'ac927fc6ddceac6daff7b7efe9fa4cbb2c50b6e9071c128fd3e8248d9327ea67'),
            pre('ParkingProduct',          'P1',                'e30df4421eacfaa06624ac1be72a71dd8117055c2be31f8b9580b853d17d730d'),
        ])
            expect(outcome([ precondition ])).toBe('taken');

    });

    it('of every format and hash algorithm, an entity named in any spelling its type considers equal', () => {

        expect(outcome([ pre('ChargingPool', 'DE*GEF*P1', 'ffc175c08b954ba9c53b3676e4cc8c300761fa7bf2c2c02fb10ee1ce2d9b59c9', 'cbor') ])).toBe('taken');
        expect(outcome([ pre('ChargingPool', 'DE*GEF*P1', 'dfc1a421866aeeb98631353abcee89415236d60745f491a46c259cdd43ef83fb5ca7de536edcf8e99a9fc515301c75fc92ebe66db6781bbc94cc8e0a6c748631', 'cbor', 'sha512') ]))
            .toBe('taken');

        // An entity has no effectiveTree ETag: WWCP_POI3 takes one over its canonical JSON.
        expect(outcome([ pre('ChargingPool', 'DE*GEF*P1', POOL, 'effectiveTree') ])).toBe('taken');

        expect(outcome([ pre('ChargingPool', 'DEGEFP1', POOL) ])).toBe('taken');
        expect(outcome([ pre('ChargingPool', ' DE*GEF*P1 ', POOL) ])).toBe('taken');

        // Checked against the version before the change set, also for the entity it changes.
        expect(outcome([ pre('ChargingPool', 'DE*GEF*P1', POOL) ], [ { kind: 'UpdateProperty', entityType: 'ChargingPool', entityId: 'DE*GEF*P1', propertyName: 'description', newValue: { en: 'One' } } ],
                       [ '7431fc2ae779214c422fafa404947fac5bc54d4d5c646aca7337540ee8a7f25e', 'e8857bd774eff455794bba3ca426f865b125dca5916866140a15916b6f07216a' ]))
            .toBe('taken');

    });

    it('refused in the words of WWCP_POI3 where they do not hold', () => {

        expect(outcome([ pre('ChargingPool', 'DE*GEF*P1', '29db04ef6000058af583be364477919fb6fce896b53406cf90eaf627faf03ec4') ]))
            .toBe(`${NOT_FIT}Precondition 0: the ChargingPool 'DE*GEF*P1' changed, it no longer has the ETag json:sha256:hex:29db04ef6000058af583be364477919fb6fce896b53406cf90eaf627faf03ec4!`);
        expect(outcome([ pre('ChargingPool', 'DE*GEF*P1', POOL), pre('ChargingStation', 'DE*GEF*S1', POOL) ]))
            .toBe(`${NOT_FIT}Precondition 1: the ChargingStation 'DE*GEF*S1' changed, it no longer has the ETag json:sha256:hex:${POOL}!`);
        expect(outcome([ pre('ChargingPool', 'DE*GEF*P9', POOL) ]))
            .toBe(`${NOT_FIT}Precondition 0: the ChargingPool 'DE*GEF*P9' does not exist!`);
        expect(outcome([ pre('ChargingPool', 'de*gef*p1', POOL) ]))
            .toBe(`${NOT_FIT}Precondition 0: the ChargingPool 'de*gef*p1' does not exist!`);

        // Neither what a change set does not address on its own, nor a model, which is unique within its manufacturer only.
        expect(outcome([ pre('EnergyMeter', 'DE*GEF*M1*1', POOL) ]))
            .toBe(`${NOT_FIT}Precondition 0: the EnergyMeter 'DE*GEF*M1*1' does not exist!`);
        expect(outcome([ pre('ChargingStationModel', 'GD-AC44', POOL) ]))
            .toBe(`${NOT_FIT}Precondition 0: the ChargingStationModel 'GD-AC44' does not exist!`);

    });

    it('read as WWCP_POI3 reads them in a change set', () => {

        const read = (preconditions: JSONValue): string => {
            try {
                changeSetOf(preconditions);
            }
            catch (e) {
                return e instanceof Error ? e.message : String(e);
            }
            return 'read';
        };

        const good = pre('ChargingPool', 'DE*GEF*P1', POOL);

        expect(read([ { '@context': 'https://open.charging.cloud/contexts/wwcp/roamingNetwork/precondition/v1', ...good } ])).toBe('read');
        expect(read([])).toBe('read');

        for (const invalid of [ { ...good, '@context': 'x' }, { entityType: 'ChargingPool', entityId: 'DE*GEF*P1' }, { entityId: 'DE*GEF*P1', eTag: good['eTag'] as JSONValue },
                                { ...good, entityId: '' }, { ...good, eTag: [ 'json', 'sha256', 'base64', 'AAAA' ] }, { ...good, eTag: [ 'json', 'sha256', 'hex', 'abcd' ] },
                                { ...good, eTag: [ 'xml', 'sha256', 'hex', POOL ] }, { ...good, eTag: `json:sha256:hex:${POOL}` }, { ...good, colour: 'red' }, 'DE*GEF*P1' ] as JSONValue[])
            expect(read([ good, invalid ])).toBe('Invalid precondition 1!');

        expect(read(good)).toBe('The preconditions must be a JSON array!');

    });

});
