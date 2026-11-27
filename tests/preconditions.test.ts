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
// those WWCP_POI3 at 039303b took as the ETags of these entities of QA, the after ETags those WWCP_POI3 at 039303b
// calculated for the change (S5).

const AT     = '2026-11-05T10:00:00.000Z';
const QA     = RoamingNetwork.parse(rich());
const AFTER  = [ '6312e6d0127db4a552a52b55efccbab6ed58f2205808b5347820e268f861a51f', 'f91cb278e70f189d73ca076cde2193911257c586992e669cdc2146195372fdbe' ] as const;
const POOL   = 'eafe3c67f6ead64227be0c08c73c58a47b1ec3b1f037aa4810ecc49e74bb8aad';

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
            pre('RoamingNetwork',          'QA',                'd1f3560a0747fef2bd4c8802aa2e597762a627f3ba1d5d03dd01c11019a4013c'),
            pre('ChargingStationOperator', 'DE*GEF',            '12b4089ecd0aa0dac03ae7979660ef5a1562809464c3c2d819b320f211950f62'),
            pre('ChargingPool',            'DE*GEF*P1',         POOL),
            pre('ChargingStation',         'DE*GEF*S1',         'ac0d6669f9eab56d3471485b22b3804e0dfee87f8fc2d3accd4f43c3a3565cf0'),
            pre('EVSE',                    'DE*GEF*E1*1',       '1d00bbb8b0af3c1b80993d9039f0e4b4dd80079c1d6d57af6de9a55c28036c08'),
            pre('ConformityCertificate',   'PTB:2026-0017',     '7b307c1a0920eb01a1c02b36621a3b7595d6bfe3ab82916fe87c8eac30301f47'),
            pre('EVSEGroup',               'DE*GDF*EG_FAV',     '27e4e6c7f7dd2654cf2a8c6d19d7bf33d74d4ec8b275c7f18fb6a71aa38a1531'),
            pre('GridConnectionPoint',     'gcp-1',             '5f9abcfe6f2c5f5fe6923994ca7311837c63ab810084824088c7c0fe0cfa3f53'),
            pre('ParkingProduct',          'P1',                'e30df4421eacfaa06624ac1be72a71dd8117055c2be31f8b9580b853d17d730d'),
        ])
            expect(outcome([ precondition ])).toBe('taken');

    });

    it('of every format and hash algorithm, an entity named in any spelling its type considers equal', () => {

        expect(outcome([ pre('ChargingPool', 'DE*GEF*P1', '1d39aa47b30cf330517a2fecead1793643805d584e7c9a921fbc49c144501cfb', 'cbor') ])).toBe('taken');
        expect(outcome([ pre('ChargingPool', 'DE*GEF*P1', '47aac0fce42f96b79e030e8abfde43fefb2fb49f41e22bd5016ea13cc76391dd2538cf86f29af45116faa206ed52248f154607b233b9a6c86fb65c0a11cc4627', 'cbor', 'sha512') ]))
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
                       [ 'd8b29e2d62c6b866adb8a48094688764e3e26fa858841efb22ad0837c9136857', 'de6f372ec91068d0075e0e51e004b152dc8a9df03bfce82a0265eee02efbdfe6' ]))
            .toBe('taken');

    });

    it('refused in the words of WWCP_POI3 where they do not hold', () => {

        expect(outcome([ pre('ChargingPool', 'DE*GEF*P1', 'ac0d6669f9eab56d3471485b22b3804e0dfee87f8fc2d3accd4f43c3a3565cf0') ]))
            .toBe(`${NOT_FIT}Precondition 0: the ChargingPool 'DE*GEF*P1' changed, it no longer has the ETag json:sha256:hex:ac0d6669f9eab56d3471485b22b3804e0dfee87f8fc2d3accd4f43c3a3565cf0!`);
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

        // Another property, too, which WWCP_POI3 at 039303b takes and leaves out (identified without it, it takes it).
        for (const invalid of [ { ...good, '@context': 'x' }, { entityType: 'ChargingPool', entityId: 'DE*GEF*P1' }, { entityId: 'DE*GEF*P1', eTag: good['eTag'] as JSONValue },
                                { ...good, entityId: 5 }, { ...good, eTag: [ 'json', 'sha256', 'base64', 'AAAA' ] }, { ...good, eTag: [ 'json', 'sha256', 'hex', 'abcd' ] },
                                { ...good, eTag: [ 'xml', 'sha256', 'hex', POOL ] }, { ...good, eTag: `json:sha256:hex:${POOL}` }, { ...good, colour: 'red' }, 'DE*GEF*P1' ] as JSONValue[])
            expect(read([ good, invalid ])).toBe('Invalid precondition 1!');

        expect(read(good)).toBe('The preconditions must be a JSON array!');

    });

    it('a change set identified by them as WWCP_POI3 writes them again: trimmed, without a context or another property, none of none', () => {

        const good = pre('ChargingPool', 'DE*GEF*P1', POOL);

        // The identifications of these change sets, of QA of the run of WWCP_POI 039303b: as WWCP_POI3 at 76d3653 gave them of
        // the run of that time (ZProbePreconditions), the rule unchanged; at 039303b it reads the change sets of these tests
        // identified so.
        expect(changeSetIdentification(plainJSON([ good ]))).toBe('280666f954ac75fef755d5ee5cc0feb2bab1fcbcc9e3355809d30f88d4ea57ab');

        for (const precondition of [ { ...good, entityId: ' DE*GEF*P1 ' }, { ...good, entityId: '\tDE*GEF*P1\n' }, { ...good, entityId: '\u00a0DE*GEF*P1\u2003' },
                                     { ...good, entityType: ' ChargingPool ' }, { '@context': PRECONDITION_CONTEXT, ...good },
                                     { '@context': PRECONDITION_CONTEXT, ...good, entityId: ' DE*GEF*P1' }, { ...good, colour: 'red' } ])
            expect(changeSetIdentification(plainJSON([ precondition ]))).toBe('280666f954ac75fef755d5ee5cc0feb2bab1fcbcc9e3355809d30f88d4ea57ab');

        expect(changeSetIdentification(plainJSON([ good, { '@context': PRECONDITION_CONTEXT, ...good } ])))
            .toBe('44e9fab5d717d79e5639c8b584cd1debdfc23156d6b0dcc81b63ec11ec604e46');
        expect(changeSetIdentification(plainJSON([ { ...good, entityId: '' } ]))).toBe('66d2140b6cdb4146cc11fc4e3b865ae676493d2f93e4b788da6aac05578133ee');
        expect(changeSetIdentification(plainJSON([ { ...good, entityId: '   ' } ]))).toBe('66d2140b6cdb4146cc11fc4e3b865ae676493d2f93e4b788da6aac05578133ee');
        expect(changeSetIdentification(plainJSON([]))).toBe('4221be4ddbd5fd1090a4e372878cf50b4861e6ba66bac04a62519349d600f0ac');
        expect(changeSetIdentification(plainJSON())).toBe('4221be4ddbd5fd1090a4e372878cf50b4861e6ba66bac04a62519349d600f0ac');

        // Identified by them as given, refused in the words of WWCP_POI3.
        expect(readAsGiven([ { ...good, entityId: ' DE*GEF*P1 ' } ]))
            .toBe("The change set '142c4f8aa48cebc1cce0bdc5788b620e04c65bcc2b7d6fd6455d1f27848c08c1' is not identified by its content, '280666f954ac75fef755d5ee5cc0feb2bab1fcbcc9e3355809d30f88d4ea57ab'!");
        expect(readAsGiven([ { '@context': PRECONDITION_CONTEXT, ...good } ]))
            .toBe("The change set '68c61fff84440430fd326aeb8b97f6cc23a78f545a31d68acb1e6995df1924ad' is not identified by its content, '280666f954ac75fef755d5ee5cc0feb2bab1fcbcc9e3355809d30f88d4ea57ab'!");
        // Another property refused before the identification, as WWCP_POI3 with the change proposed for it refuses it.
        expect(readAsGiven([ { ...good, colour: 'red' } ])).toBe('Invalid precondition 0!');
        expect(readAsGiven([]))
            .toBe("The change set '461bdd35202671f5c4cff2b583fbbc37310e1401cb28b82f1a5b9ed0c63c8409' is not identified by its content, '4221be4ddbd5fd1090a4e372878cf50b4861e6ba66bac04a62519349d600f0ac'!");

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
