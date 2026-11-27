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
// those WWCP_POI3 at c94c762 took as the ETags of these entities of QA, the after ETags those WWCP_POI3 at c94c762
// calculated for the change (S5).

const AT     = '2026-11-05T10:00:00.000Z';
const QA     = RoamingNetwork.parse(rich());
const AFTER  = [ '6471eef82997f388aa2b17bc788300b9e51c81951d93507bb1016ef0ee6448ca', '5c7449389e5d9a0ec1b7496e35187e3abf01dd9f548ddbcabe2b3b67ca16e46e' ] as const;
const POOL   = '4525d94470dd619760cb4e20dc17e0544e8b95208f5be9d4042f9181abd0d3e6';

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
            pre('RoamingNetwork',          'QA',                '7f3b6be49e3cc3ee63fd0b4522936d4e0fe05354c55fad59f6c5fa3f6dfd262e'),
            pre('ChargingStationOperator', 'DE*GEF',            '8d2fb902ea3e24e67b2fe5ee5bb998f2b60ebffe0310d2c7a156014524ad0ad0'),
            pre('ChargingPool',            'DE*GEF*P1',         POOL),
            pre('ChargingStation',         'DE*GEF*S1',         'd44edff00088b5d547d78947a1e3d11c61e6f07c502bb4410bac207614b200f4'),
            pre('EVSE',                    'DE*GEF*E1*1',       'b6a33bbfc6477a33cf53e4af62496e45acfcfd8b13804d2e0222d500370e57ad'),
            pre('ConformityCertificate',   'PTB:2026-0017',     'c5d39654f1eaf9c841ea9d933f49c67d63c3fc510e108faeda87fd8c848e819e'),
            pre('EVSEGroup',               'DE*GDF*EG_FAV',     '39a91c97e7f6ba258aed1356aad6f848755b8aaae3f520325dd6f8de1d7e5ba5'),
            pre('GridConnectionPoint',     'gcp-1',             '76f1a3d1eeb742e8fe68b941b0fd925cc99b9fc57d2aa24da9d292a47f704164'),
            pre('ParkingProduct',          'P1',                'e30df4421eacfaa06624ac1be72a71dd8117055c2be31f8b9580b853d17d730d'),
        ])
            expect(outcome([ precondition ])).toBe('taken');

    });

    it('of every format and hash algorithm, an entity named in any spelling its type considers equal', () => {

        expect(outcome([ pre('ChargingPool', 'DE*GEF*P1', '4c2b0277925d7141f504371baa14473d523b2fcfeab6f4178e8ec86c2b2c82da', 'cbor') ])).toBe('taken');
        expect(outcome([ pre('ChargingPool', 'DE*GEF*P1', '3d2c1cd6b73f214aa502be58cd15a3d9bb2c42c8b3bccbb1f1ad6b90f0d37a42dc55597f0ac19b5e1909ee0e974128ea0f82cca60bd2d2733f6175e4958c239b', 'cbor', 'sha512') ]))
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
                       [ 'ac8c10d2b92429d526af9a1be36ce7a73bc7ef82e36727282e0120d5f3b74fe6', '74ea8f2090bba459940ee290553b56096da36c89b0eb3b6dbb6d3ca2d8746bd0' ]))
            .toBe('taken');

    });

    it('refused in the words of WWCP_POI3 where they do not hold', () => {

        expect(outcome([ pre('ChargingPool', 'DE*GEF*P1', 'd44edff00088b5d547d78947a1e3d11c61e6f07c502bb4410bac207614b200f4') ]))
            .toBe(`${NOT_FIT}Precondition 0: the ChargingPool 'DE*GEF*P1' changed, it no longer has the ETag json:sha256:hex:d44edff00088b5d547d78947a1e3d11c61e6f07c502bb4410bac207614b200f4!`);
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

        // Another property, too, which WWCP_POI3 at c94c762 takes and leaves out (identified without it, it takes it).
        for (const invalid of [ { ...good, '@context': 'x' }, { entityType: 'ChargingPool', entityId: 'DE*GEF*P1' }, { entityId: 'DE*GEF*P1', eTag: good['eTag'] as JSONValue },
                                { ...good, entityId: 5 }, { ...good, eTag: [ 'json', 'sha256', 'base64', 'AAAA' ] }, { ...good, eTag: [ 'json', 'sha256', 'hex', 'abcd' ] },
                                { ...good, eTag: [ 'xml', 'sha256', 'hex', POOL ] }, { ...good, eTag: `json:sha256:hex:${POOL}` }, { ...good, colour: 'red' }, 'DE*GEF*P1' ] as JSONValue[])
            expect(read([ good, invalid ])).toBe('Invalid precondition 1!');

        expect(read(good)).toBe('The preconditions must be a JSON array!');

    });

    it('a change set identified by them as WWCP_POI3 writes them again: trimmed, without a context or another property, none of none', () => {

        const good = pre('ChargingPool', 'DE*GEF*P1', POOL);

        // The identifications of these change sets, of QA of the run of WWCP_POI c94c762: as WWCP_POI3 at 76d3653 gave them of
        // the run of that time (ZProbePreconditions), the rule unchanged; at c94c762 it reads the change sets of these tests
        // identified so.
        expect(changeSetIdentification(plainJSON([ good ]))).toBe('7acfa6a694dddcf3835f82b3427610717c8a723e737b3d59a3abfd1241a82568');

        for (const precondition of [ { ...good, entityId: ' DE*GEF*P1 ' }, { ...good, entityId: '\tDE*GEF*P1\n' }, { ...good, entityId: '\u00a0DE*GEF*P1\u2003' },
                                     { ...good, entityType: ' ChargingPool ' }, { '@context': PRECONDITION_CONTEXT, ...good },
                                     { '@context': PRECONDITION_CONTEXT, ...good, entityId: ' DE*GEF*P1' }, { ...good, colour: 'red' } ])
            expect(changeSetIdentification(plainJSON([ precondition ]))).toBe('7acfa6a694dddcf3835f82b3427610717c8a723e737b3d59a3abfd1241a82568');

        expect(changeSetIdentification(plainJSON([ good, { '@context': PRECONDITION_CONTEXT, ...good } ])))
            .toBe('5bd0efb0ef5f79e35b03a22b441130ce76169fc07d6dd72a31d378daf6dae89b');
        expect(changeSetIdentification(plainJSON([ { ...good, entityId: '' } ]))).toBe('d26198ab1ea8e3773db6a41520eeb9b1764c0288dd79485d8e4259c07f68c1a3');
        expect(changeSetIdentification(plainJSON([ { ...good, entityId: '   ' } ]))).toBe('d26198ab1ea8e3773db6a41520eeb9b1764c0288dd79485d8e4259c07f68c1a3');
        expect(changeSetIdentification(plainJSON([]))).toBe('4ae1eb0077b0d0dcc6b9cf62997bcd0ba2b7b43ab07b1fe7770e47e4ba702252');
        expect(changeSetIdentification(plainJSON())).toBe('4ae1eb0077b0d0dcc6b9cf62997bcd0ba2b7b43ab07b1fe7770e47e4ba702252');

        // Identified by them as given, refused in the words of WWCP_POI3.
        expect(readAsGiven([ { ...good, entityId: ' DE*GEF*P1 ' } ]))
            .toBe("The change set 'b145ff9639c99b4d2ec0dd5292e4395c8614431a819bd40e69ff244b16697a4e' is not identified by its content, '7acfa6a694dddcf3835f82b3427610717c8a723e737b3d59a3abfd1241a82568'!");
        expect(readAsGiven([ { '@context': PRECONDITION_CONTEXT, ...good } ]))
            .toBe("The change set 'd135570e758b1c9df6c6e6a3acf5384680686babb432700c8c74fdca874dc397' is not identified by its content, '7acfa6a694dddcf3835f82b3427610717c8a723e737b3d59a3abfd1241a82568'!");
        // Another property refused before the identification, as WWCP_POI3 with the change proposed for it refuses it.
        expect(readAsGiven([ { ...good, colour: 'red' } ])).toBe('Invalid precondition 0!');
        expect(readAsGiven([]))
            .toBe("The change set '7324ef5a1f26de3f2e84e32c65eec61bd97d83b19b2a829af9cccab6a5610ea9' is not identified by its content, '4ae1eb0077b0d0dcc6b9cf62997bcd0ba2b7b43ab07b1fe7770e47e4ba702252'!");

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
