import { describe, expect, it } from 'vitest';

import { rich } from './richNetwork.ts';

import { hash } from '../src/crypto/hash.ts';
import { toHex } from '../src/encoding/text.ts';
import { applyChangeSet } from '../src/history/apply.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification } from '../src/history/changeSet.ts';
import { PRECONDITION_CONTEXT } from '../src/history/preconditions.ts';
import { canonicalJSONBytes } from '../src/json/canonical.ts';
import { etagToJSON } from '../src/etags.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';
import type { JSONObject, JSONValue } from '../src/json/value.ts';


// The preconditions of change sets (SPECIFICATION.md section 4, preconditions.ts): the ETag an entity must still have in
// the version a change set is applied to, over its representation as the roaming network embeds it. The ETags below are
// those WWCP_POI3 at c4c3c5a took as the ETags of these entities of QA, the after ETags those WWCP_POI3 at c4c3c5a
// calculated for the change (S5).

const AT     = '2026-11-05T10:00:00.000Z';
const QA     = RoamingNetwork.parse(rich());
const AFTER  = [ 'cf92356440c496faea9c7dbd2a5294cf43fd2ad6ebc2e8e05a726d96ba32fd8e', '9eb2579fa74cb901825915d6fe0edd73f42c34c26ebb31b62baf4840fdf1e0fd' ] as const;
const POOL   = 'ceb7f9feb29d1cc615e48c304be322630d3d56ae5bffd604ecc81cdfc22643c6';

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

/** The JSON of a change set of the change at AT with the given preconditions, if any, unsigned, leading to the version before. */
function plainJSON(preconditions?: JSONValue): JSONObject {
    const beforeETags = QA.changeSetETags().map(eTag => etagToJSON(eTag));
    const json: JSONObject = { '@context': CHANGE_SET_CONTEXT, roamingNetworkId: QA.id, createdAt: AT, changes: [ change ], beforeETags, afterETags: beforeETags };
    if (preconditions !== undefined)
        json['preconditions'] = preconditions;
    return json;
}

/** Why a change set of the given preconditions is refused when read, identified by the SHA-256 of its canonical JSON as given. */
function readAsGiven(preconditions: JSONValue): string {
    const json = plainJSON(preconditions);
    json['@id'] = toHex(hash('sha256', canonicalJSONBytes(json)));
    try {
        ChangeSet.parse(json);
    }
    catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
    return 'read';
}

const pre = (entityType: string, entityId: string, digest: string, format = 'json', algorithm = 'sha256'): JSONObject =>
    ({ entityType, entityId, eTag: [ format, algorithm, 'hex', digest ] });

const NOT_FIT = 'The change set does not fit this version of the roaming network: ';


describe('Preconditions', () => {

    it('hold for an entity of every kind, as the roaming network embeds it, with everything it embeds', () => {

        for (const precondition of [
            pre('RoamingNetwork',          'QA',                '4b64d88969eef1b593f62a03b641a8d182e952942139be8b837e1cc31d896046'),
            pre('ChargingStationOperator', 'DE*GEF',            '0d2590a0b80d4d6056c84c0203d49ffe8257dcdd693c3070455469281215c418'),
            pre('ChargingPool',            'DE*GEF*P1',         POOL),
            pre('ChargingStation',         'DE*GEF*S1',         'f19bd8c00da4528ac926449c0fb80c1db0319a4b0a4b98b97305f529d849edaf'),
            pre('EVSE',                    'DE*GEF*E1*1',       '80961d1fbd5d1f64c68d710af0efb31f4e727f4001baa326caf1f631c555d7c0'),
            pre('ConformityCertificate',   'PTB:2026-0017',     'c271228904626b51cd05f5205e17c94d81ad3adcb91490bb1db44d8dfc93bd49'),
            pre('EVSEGroup',               'DE*GDF*EG_FAV',     '80b242d2a13b8a063221deb1fd55475b1ab041c47163c7b30496305a5ffe658d'),
            pre('GridConnectionPoint',     'gcp-1',             '3f1e8e8024f6620ab49b759c203673b095f4f2b33476ad0f8b115a32e28977ab'),
            pre('ParkingProduct',          'P1',                'e30df4421eacfaa06624ac1be72a71dd8117055c2be31f8b9580b853d17d730d'),
        ])
            expect(outcome([ precondition ])).toBe('taken');

    });

    it('of every format and hash algorithm, an entity named in any spelling its type considers equal', () => {

        expect(outcome([ pre('ChargingPool', 'DE*GEF*P1', '1dbb8566123f0b44b18a86ea285ecf45d947263e1dcee84004faddaa80c20c81', 'cbor') ])).toBe('taken');
        expect(outcome([ pre('ChargingPool', 'DE*GEF*P1', '1e8c077dc7ed64df6425bf14a4494bcbf3bd14c667c3ee33d71cf3512abda45b97284ff73151f0b88c21ff5bd675ccec28645fdd0c71590be3bb50eb62b82cac', 'cbor', 'sha512') ]))
            .toBe('taken');

        // An entity has no effectiveTree ETag: WWCP_POI3 takes one over its canonical JSON.
        expect(outcome([ pre('ChargingPool', 'DE*GEF*P1', POOL, 'effectiveTree') ])).toBe('taken');

        expect(outcome([ pre('ChargingPool', 'DEGEFP1', POOL) ])).toBe('taken');

        // Its texts trimmed, as WWCP_POI3 reads them (ParseMandatoryText).
        expect(outcome([ pre('ChargingPool', ' DE*GEF*P1 ', POOL) ])).toBe('taken');
        expect(outcome([ pre('ChargingPool', '\tDE*GEF*P1\n', POOL) ])).toBe('taken');
        expect(outcome([ pre(' ChargingPool ', 'DE*GEF*P1', POOL) ])).toBe('taken');

        // Checked against the version before the change set, also for the entity it changes.
        expect(outcome([ pre('ChargingPool', 'DE*GEF*P1', POOL) ], [ { kind: 'UpdateProperty', entityType: 'ChargingPool', entityId: 'DE*GEF*P1', propertyName: 'description', newValue: { en: 'One' } } ],
                       [ '5c2e7f01d78a41107c542e87e9ed0e7969662b4d20b903d71baf5c38457db5c7', '033e7bedfb96805a6c90e7873f74c6627ae214385293348725fb8a2e5aeb573e' ]))
            .toBe('taken');

    });

    it('refused in the words of WWCP_POI3 where they do not hold', () => {

        expect(outcome([ pre('ChargingPool', 'DE*GEF*P1', 'f19bd8c00da4528ac926449c0fb80c1db0319a4b0a4b98b97305f529d849edaf') ]))
            .toBe(`${NOT_FIT}Precondition 0: the ChargingPool 'DE*GEF*P1' changed, it no longer has the ETag json:sha256:hex:f19bd8c00da4528ac926449c0fb80c1db0319a4b0a4b98b97305f529d849edaf!`);
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

        // Nothing left of a text, as of an empty one: read, as WWCP_POI3 reads it, but no entity has it.
        expect(outcome([ pre('ChargingPool', '', POOL) ])).toBe(`${NOT_FIT}Precondition 0: the ChargingPool '' does not exist!`);
        expect(outcome([ pre('ChargingPool', '   ', POOL) ])).toBe(`${NOT_FIT}Precondition 0: the ChargingPool '' does not exist!`);
        expect(outcome([ pre(' ', 'DE*GEF*P1', POOL) ])).toBe(`${NOT_FIT}Precondition 0: the  'DE*GEF*P1' does not exist!`);

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

        // Another property, too, which WWCP_POI3 at c4c3c5a takes and leaves out (identified without it, it takes it).
        for (const invalid of [ { ...good, '@context': 'x' }, { entityType: 'ChargingPool', entityId: 'DE*GEF*P1' }, { entityId: 'DE*GEF*P1', eTag: good['eTag'] as JSONValue },
                                { ...good, entityId: 5 }, { ...good, eTag: [ 'json', 'sha256', 'base64', 'AAAA' ] }, { ...good, eTag: [ 'json', 'sha256', 'hex', 'abcd' ] },
                                { ...good, eTag: [ 'xml', 'sha256', 'hex', POOL ] }, { ...good, eTag: `json:sha256:hex:${POOL}` }, { ...good, colour: 'red' }, 'DE*GEF*P1' ] as JSONValue[])
            expect(read([ good, invalid ])).toBe('Invalid precondition 1!');

        expect(read(good)).toBe('The preconditions must be a JSON array!');

    });

    it('a change set identified by them as WWCP_POI3 writes them again: trimmed, without a context or another property, none of none', () => {

        const good = pre('ChargingPool', 'DE*GEF*P1', POOL);

        // The identifications WWCP_POI3 at c4c3c5a gave these change sets (ZProbePreconditions).
        expect(changeSetIdentification(plainJSON([ good ]))).toBe('8c3cf49fc494dd7e1324b62bafc9b79b7ec50130dc88539a5cd9254c14949748');

        for (const precondition of [ { ...good, entityId: ' DE*GEF*P1 ' }, { ...good, entityId: '\tDE*GEF*P1\n' }, { ...good, entityId: '\u00a0DE*GEF*P1\u2003' },
                                     { ...good, entityType: ' ChargingPool ' }, { '@context': PRECONDITION_CONTEXT, ...good },
                                     { '@context': PRECONDITION_CONTEXT, ...good, entityId: ' DE*GEF*P1' }, { ...good, colour: 'red' } ])
            expect(changeSetIdentification(plainJSON([ precondition ]))).toBe('8c3cf49fc494dd7e1324b62bafc9b79b7ec50130dc88539a5cd9254c14949748');

        expect(changeSetIdentification(plainJSON([ good, { '@context': PRECONDITION_CONTEXT, ...good } ])))
            .toBe('b795a9ba8dcfe459bff8628706a1d965ae34b1a11465442c726e9043f61eaaa7');
        expect(changeSetIdentification(plainJSON([ { ...good, entityId: '' } ]))).toBe('e4c59637f861bf10560afd22a7e6910dfdce69c076b342a51463000a9db75b6e');
        expect(changeSetIdentification(plainJSON([ { ...good, entityId: '   ' } ]))).toBe('e4c59637f861bf10560afd22a7e6910dfdce69c076b342a51463000a9db75b6e');
        expect(changeSetIdentification(plainJSON([]))).toBe('a883d201b887a7a6d9e3b7f8fa0ab2b1f90dd469656f71c979fb2ad0ec001235');
        expect(changeSetIdentification(plainJSON())).toBe('a883d201b887a7a6d9e3b7f8fa0ab2b1f90dd469656f71c979fb2ad0ec001235');

        // Identified by them as given, refused in the words of WWCP_POI3.
        expect(readAsGiven([ { ...good, entityId: ' DE*GEF*P1 ' } ]))
            .toBe("The change set 'd8c334e0f83726b4e18f356cffbc37de6663edbcaec40e9e7c658b1a3b9dbbec' is not identified by its content, '8c3cf49fc494dd7e1324b62bafc9b79b7ec50130dc88539a5cd9254c14949748'!");
        expect(readAsGiven([ { '@context': PRECONDITION_CONTEXT, ...good } ]))
            .toBe("The change set '3380d064394579e5688820df6f908147fd4d8aff84a9d141d47d39225034aaa8' is not identified by its content, '8c3cf49fc494dd7e1324b62bafc9b79b7ec50130dc88539a5cd9254c14949748'!");
        // Another property refused before the identification, as WWCP_POI3 with the change proposed for it refuses it.
        expect(readAsGiven([ { ...good, colour: 'red' } ])).toBe('Invalid precondition 0!');
        expect(readAsGiven([]))
            .toBe("The change set 'e1aa768a3da4eea49b07c70e798ca0fdcd76e70184f130102a54e6446919c787' is not identified by its content, 'a883d201b887a7a6d9e3b7f8fa0ab2b1f90dd469656f71c979fb2ad0ec001235'!");

        // Signed as identified, as WWCP_POI3 writes it again (ToJSON(Embedded: true, IncludeSignatures: false)).
        const signature = { algorithm: 'Ed25519', keyId: 'DE*GEF', value: 'AAAA' };
        const parsed    = (preconditions?: JSONValue): ChangeSet => {
            const json = plainJSON(preconditions);
            json['@id'] = changeSetIdentification(json);
            return ChangeSet.parse(json);
        };

        expect(parsed([ { '@context': PRECONDITION_CONTEXT, ...good, entityId: ' DE*GEF*P1' } ]).signingBytes(signature)).toEqual(parsed([ good ]).signingBytes(signature));
        expect(parsed([]).signingBytes(signature)).toEqual(parsed().signingBytes(signature));

    });

});
