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
// those WWCP_POI3 at c1b641b took as the ETags of these entities of QA, the after ETags those WWCP_POI3 at c1b641b
// calculated for the change (S5).

const AT     = '2026-11-05T10:00:00.000Z';
const QA     = RoamingNetwork.parse(rich());
const AFTER  = [ '657f7860ae5c77c9fedaefd399733cf6d5538d6fed9683fed2f8d9f3bec1ba48', '484705d3e89e42a35a9f74b473ed4c169049de3acc4a1aa0b3a2ba79daa3e098' ] as const;
const POOL   = '3d8cf98d80be80f4bdc6c5d0203924752faac487f9f43b5638c9a73e32f3df62';

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
            pre('RoamingNetwork',          'QA',                '82624bab4216cf92d33082106c00dd7879c2109c3a1d793b8dd9aa503214b8a4'),
            pre('ChargingStationOperator', 'DE*GEF',            'b1db650bdb21c7f4c43841cdc3b446ff0ecd0e244f0cc42829e0ccf32ac29e32'),
            pre('ChargingPool',            'DE*GEF*P1',         POOL),
            pre('ChargingStation',         'DE*GEF*S1',         '1b585944c4bd0c0fd0b7fc84961675703790a41dda7dd4f872e304ad897f0587'),
            pre('EVSE',                    'DE*GEF*E1*1',       '3189fd8fb0ee3bb8026b50e22d5b79584de3e0f84661e482da212679d89a6f13'),
            pre('ConformityCertificate',   'PTB:2026-0017',     '1d204dc36f0469e62c09f44e18f1bd3d4054fc92323eb9fb155d5db34ddb5d2e'),
            pre('EVSEGroup',               'DE*GDF*EG_FAV',     'b66826b096ed2db8a09ec7c24a0c6352732744a98b0ffbe9e4bb4020e21073ff'),
            pre('GridConnectionPoint',     'gcp-1',             'ee5bffa52b9819be4ab78fe19f827a8068baa3400868cf8eda07323b74f9e053'),
            pre('ParkingProduct',          'P1',                'e30df4421eacfaa06624ac1be72a71dd8117055c2be31f8b9580b853d17d730d'),
        ])
            expect(outcome([ precondition ])).toBe('taken');

    });

    it('of every format and hash algorithm, an entity named in any spelling its type considers equal', () => {

        expect(outcome([ pre('ChargingPool', 'DE*GEF*P1', 'e3c5cde789312cef3e40f0c246e0e331b22dde01446790247203000000ed5819', 'cbor') ])).toBe('taken');
        expect(outcome([ pre('ChargingPool', 'DE*GEF*P1', 'd95d3cc21b8f6be216c6d3904fbfe6deca6991d8c2a793e27a62a55e206149c5f45aae8e97738c9ac0d9ad25c65d689ccc40782df8484306b2e667c6ef67e641', 'cbor', 'sha512') ]))
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
                       [ '32ccec48f673b9eca985327b8dacafc168256a875b3956db10995b8189bf20cf', '99fc2a66312b75c4e10cad31652e069200ccd26d8d703f0a096e346e842c0e85' ]))
            .toBe('taken');

    });

    it('refused in the words of WWCP_POI3 where they do not hold', () => {

        expect(outcome([ pre('ChargingPool', 'DE*GEF*P1', '1b585944c4bd0c0fd0b7fc84961675703790a41dda7dd4f872e304ad897f0587') ]))
            .toBe(`${NOT_FIT}Precondition 0: the ChargingPool 'DE*GEF*P1' changed, it no longer has the ETag json:sha256:hex:1b585944c4bd0c0fd0b7fc84961675703790a41dda7dd4f872e304ad897f0587!`);
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

        // Another property, too, which WWCP_POI3 at c1b641b takes and leaves out (identified without it, it takes it).
        for (const invalid of [ { ...good, '@context': 'x' }, { entityType: 'ChargingPool', entityId: 'DE*GEF*P1' }, { entityId: 'DE*GEF*P1', eTag: good['eTag'] as JSONValue },
                                { ...good, entityId: 5 }, { ...good, eTag: [ 'json', 'sha256', 'base64', 'AAAA' ] }, { ...good, eTag: [ 'json', 'sha256', 'hex', 'abcd' ] },
                                { ...good, eTag: [ 'xml', 'sha256', 'hex', POOL ] }, { ...good, eTag: `json:sha256:hex:${POOL}` }, { ...good, colour: 'red' }, 'DE*GEF*P1' ] as JSONValue[])
            expect(read([ good, invalid ])).toBe('Invalid precondition 1!');

        expect(read(good)).toBe('The preconditions must be a JSON array!');

    });

    it('a change set identified by them as WWCP_POI3 writes them again: trimmed, without a context or another property, none of none', () => {

        const good = pre('ChargingPool', 'DE*GEF*P1', POOL);

        // The identifications of these change sets, of QA of the run of WWCP_POI c1b641b: as WWCP_POI3 at 76d3653 gave them of
        // the run of that time (ZProbePreconditions), the rule unchanged; at c1b641b it reads the change sets of these tests
        // identified so.
        expect(changeSetIdentification(plainJSON([ good ]))).toBe('ae9bf8c1365b1e58239e25c6284f8189cade5934f62aa5f3fc192d77a755eebd');

        for (const precondition of [ { ...good, entityId: ' DE*GEF*P1 ' }, { ...good, entityId: '\tDE*GEF*P1\n' }, { ...good, entityId: '\u00a0DE*GEF*P1\u2003' },
                                     { ...good, entityType: ' ChargingPool ' }, { '@context': PRECONDITION_CONTEXT, ...good },
                                     { '@context': PRECONDITION_CONTEXT, ...good, entityId: ' DE*GEF*P1' }, { ...good, colour: 'red' } ])
            expect(changeSetIdentification(plainJSON([ precondition ]))).toBe('ae9bf8c1365b1e58239e25c6284f8189cade5934f62aa5f3fc192d77a755eebd');

        expect(changeSetIdentification(plainJSON([ good, { '@context': PRECONDITION_CONTEXT, ...good } ])))
            .toBe('1085d312d76e6e3f30258233b8f5cc2c936fa291e68bd7f897c47b265d4e8314');
        expect(changeSetIdentification(plainJSON([ { ...good, entityId: '' } ]))).toBe('5e564d9a8e84e08f4416ede96b00d4633863bced4eba7f1675e4f16e39ece7ab');
        expect(changeSetIdentification(plainJSON([ { ...good, entityId: '   ' } ]))).toBe('5e564d9a8e84e08f4416ede96b00d4633863bced4eba7f1675e4f16e39ece7ab');
        expect(changeSetIdentification(plainJSON([]))).toBe('96579d6728d730ce5607ee12dc626ee1125dc774ca8ffed3f1ad256f89ea274b');
        expect(changeSetIdentification(plainJSON())).toBe('96579d6728d730ce5607ee12dc626ee1125dc774ca8ffed3f1ad256f89ea274b');

        // Identified by them as given, refused in the words of WWCP_POI3.
        expect(readAsGiven([ { ...good, entityId: ' DE*GEF*P1 ' } ]))
            .toBe("The change set 'bcc876f3b7c1a2a6883ea1a6d51b7103b69c65f0f26b869563b0a7315c118eff' is not identified by its content, 'ae9bf8c1365b1e58239e25c6284f8189cade5934f62aa5f3fc192d77a755eebd'!");
        expect(readAsGiven([ { '@context': PRECONDITION_CONTEXT, ...good } ]))
            .toBe("The change set '90f09ec079e7362a7a178e88f165b8639aca792988a70e70cfb2913186909c13' is not identified by its content, 'ae9bf8c1365b1e58239e25c6284f8189cade5934f62aa5f3fc192d77a755eebd'!");
        // Another property refused before the identification, as WWCP_POI3 with the change proposed for it refuses it.
        expect(readAsGiven([ { ...good, colour: 'red' } ])).toBe('Invalid precondition 0!');
        expect(readAsGiven([]))
            .toBe("The change set '1faaf98d4343d0a78865b683b1d1ee016e614a303e76d136698965361ca0187f' is not identified by its content, '96579d6728d730ce5607ee12dc626ee1125dc774ca8ffed3f1ad256f89ea274b'!");

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
