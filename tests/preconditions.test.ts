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
// those WWCP_POI3 at 76d3653 took as the ETags of these entities of QA, the after ETags those WWCP_POI3 at 76d3653
// calculated for the change (S5).

const AT     = '2026-11-05T10:00:00.000Z';
const QA     = RoamingNetwork.parse(rich());
const AFTER  = [ 'aac704fa9bdfecf8554f41cc7f012cb883831a303ad1631d2c562a2ab87f2bd7', '6b89517307db99d57b85955375094220fc1d15e71fb021817b3f07d5ce6d19f8' ] as const;
const POOL   = '9a7644eae79e84e92e61c42dca16a49a58ea502bfe578baa5c1ab61e5ae9fc7a';

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
            pre('RoamingNetwork',          'QA',                '6a9fbd9af20bb5f720cd30f8865345cec3dabaa0c8d448da7985accc08cb5580'),
            pre('ChargingStationOperator', 'DE*GEF',            'e70d84e5206daae764ca16e25a8e00e2715ff694b1f48713d608af19bc7bea7d'),
            pre('ChargingPool',            'DE*GEF*P1',         POOL),
            pre('ChargingStation',         'DE*GEF*S1',         '84cd3dfbc69f97995f6854009dc011471f9a19b9f3a93d6ae9c2d1b4a911b23a'),
            pre('EVSE',                    'DE*GEF*E1*1',       '206e72e350138af6a630ecfb2836a37f76158fcd51177461fe2cd109fadea668'),
            pre('ConformityCertificate',   'PTB:2026-0017',     '136e85102640c53cb2cdd7b81001019701b9cd731e22514232f272dd60835b95'),
            pre('EVSEGroup',               'DE*GDF*EG_FAV',     '197bc239b63684aaafa06c5367183409057aefa81c75e5fe8868244f9f7d14a5'),
            pre('GridConnectionPoint',     'gcp-1',             'e9ae358af4da83bf2c342ada4b237032afe36c9463b20d7ed49f6e11eda7e6d0'),
            pre('ParkingProduct',          'P1',                'e30df4421eacfaa06624ac1be72a71dd8117055c2be31f8b9580b853d17d730d'),
        ])
            expect(outcome([ precondition ])).toBe('taken');

    });

    it('of every format and hash algorithm, an entity named in any spelling its type considers equal', () => {

        expect(outcome([ pre('ChargingPool', 'DE*GEF*P1', 'e500360848d78dbc94477eef5b2f8adc1dbedee5c62c456ff795367f374e8d48', 'cbor') ])).toBe('taken');
        expect(outcome([ pre('ChargingPool', 'DE*GEF*P1', '1e654eaa528f533c4ad46034eb361c496d468466f3cb0bb6ae5a157a0b2abfe507855dd32e856b10dff580d7c021b6df631ae2610092d33ef4c216ce33033512', 'cbor', 'sha512') ]))
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
                       [ '430e4a05dc17893e9d097052a1c472214ad043e38f9231a25cb21d20f6cd957c', '6c8b06834c3be29f15da8960985e774767bd9e5037a2f6d083f42a35fcfed9b6' ]))
            .toBe('taken');

    });

    it('refused in the words of WWCP_POI3 where they do not hold', () => {

        expect(outcome([ pre('ChargingPool', 'DE*GEF*P1', '84cd3dfbc69f97995f6854009dc011471f9a19b9f3a93d6ae9c2d1b4a911b23a') ]))
            .toBe(`${NOT_FIT}Precondition 0: the ChargingPool 'DE*GEF*P1' changed, it no longer has the ETag json:sha256:hex:84cd3dfbc69f97995f6854009dc011471f9a19b9f3a93d6ae9c2d1b4a911b23a!`);
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

        // Another property, too, which WWCP_POI3 at 76d3653 takes and leaves out (identified without it, it takes it).
        for (const invalid of [ { ...good, '@context': 'x' }, { entityType: 'ChargingPool', entityId: 'DE*GEF*P1' }, { entityId: 'DE*GEF*P1', eTag: good['eTag'] as JSONValue },
                                { ...good, entityId: 5 }, { ...good, eTag: [ 'json', 'sha256', 'base64', 'AAAA' ] }, { ...good, eTag: [ 'json', 'sha256', 'hex', 'abcd' ] },
                                { ...good, eTag: [ 'xml', 'sha256', 'hex', POOL ] }, { ...good, eTag: `json:sha256:hex:${POOL}` }, { ...good, colour: 'red' }, 'DE*GEF*P1' ] as JSONValue[])
            expect(read([ good, invalid ])).toBe('Invalid precondition 1!');

        expect(read(good)).toBe('The preconditions must be a JSON array!');

    });

    it('a change set identified by them as WWCP_POI3 writes them again: trimmed, without a context or another property, none of none', () => {

        const good = pre('ChargingPool', 'DE*GEF*P1', POOL);

        // The identifications WWCP_POI3 at 76d3653 gave these change sets (ZProbePreconditions).
        expect(changeSetIdentification(plainJSON([ good ]))).toBe('a191411c0e227048bbd1375ae9fc43fc70e830d5c04b9b30cac8d4045b4ec714');

        for (const precondition of [ { ...good, entityId: ' DE*GEF*P1 ' }, { ...good, entityId: '\tDE*GEF*P1\n' }, { ...good, entityId: '\u00a0DE*GEF*P1\u2003' },
                                     { ...good, entityType: ' ChargingPool ' }, { '@context': PRECONDITION_CONTEXT, ...good },
                                     { '@context': PRECONDITION_CONTEXT, ...good, entityId: ' DE*GEF*P1' }, { ...good, colour: 'red' } ])
            expect(changeSetIdentification(plainJSON([ precondition ]))).toBe('a191411c0e227048bbd1375ae9fc43fc70e830d5c04b9b30cac8d4045b4ec714');

        expect(changeSetIdentification(plainJSON([ good, { '@context': PRECONDITION_CONTEXT, ...good } ])))
            .toBe('7021f95915864f7cf84c26b4fdf85910b8c93eae1074f490f8fd59edd4ea9d74');
        expect(changeSetIdentification(plainJSON([ { ...good, entityId: '' } ]))).toBe('58a80c46371db64cf7b347f358332b238235d3bf56977b81ac535132e172cb54');
        expect(changeSetIdentification(plainJSON([ { ...good, entityId: '   ' } ]))).toBe('58a80c46371db64cf7b347f358332b238235d3bf56977b81ac535132e172cb54');
        expect(changeSetIdentification(plainJSON([]))).toBe('400da75dd218b7f2930ac6f4294e0bf7ea562f8f71abd40d0e258f9ae8c0dbf8');
        expect(changeSetIdentification(plainJSON())).toBe('400da75dd218b7f2930ac6f4294e0bf7ea562f8f71abd40d0e258f9ae8c0dbf8');

        // Identified by them as given, refused in the words of WWCP_POI3.
        expect(readAsGiven([ { ...good, entityId: ' DE*GEF*P1 ' } ]))
            .toBe("The change set '3544b9ab0dc9944631ebbd1baf579b4fca00b110f84851699aec01e067d83f22' is not identified by its content, 'a191411c0e227048bbd1375ae9fc43fc70e830d5c04b9b30cac8d4045b4ec714'!");
        expect(readAsGiven([ { '@context': PRECONDITION_CONTEXT, ...good } ]))
            .toBe("The change set 'ac589137f3dfcff5dcb1c020cfe8e1257edb44ae9d3d2561636dde2c217c987c' is not identified by its content, 'a191411c0e227048bbd1375ae9fc43fc70e830d5c04b9b30cac8d4045b4ec714'!");
        // Another property refused before the identification, as WWCP_POI3 with the change proposed for it refuses it.
        expect(readAsGiven([ { ...good, colour: 'red' } ])).toBe('Invalid precondition 0!');
        expect(readAsGiven([]))
            .toBe("The change set '7ee95cb743e577b5e2ec3dcf33ab0330421295a780cb0beff92acf4e20e035fc' is not identified by its content, '400da75dd218b7f2930ac6f4294e0bf7ea562f8f71abd40d0e258f9ae8c0dbf8'!");

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
