import { describe, expect, it, vi } from 'vitest';

import { AT, asText, defined, readJSON } from './helpers.ts';
import { anchorPQ } from './qa.ts';

import { applyChangeSet } from '../src/history/apply.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification } from '../src/history/changeSet.ts';
import { etagToJSON } from '../src/etags.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';
import { ChargingStationProof } from '../src/proofs/stationProof.ts';
import { verifyChargingStation } from '../src/verifier/chargingStation.ts';
import { clone, get, isArray, isObject, without, type JSONArray, type JSONObject, type JSONValue } from '../src/json/value.ts';


// Who states a certificate (WWCP_POI, csharp-review 15): the roaming network operator, adding or changing one in place of a
// conformity assessment body without signing keys, says so by its statedBy; a body with keys names none. QA of example
// A13 has the PTB with keys and the BSI without.

const T0 = '2026-10-27T12:00:00.000Z';

const qa = (): JSONObject => without(readJSON('published/QA.json') as JSONObject, 'eTags');

const bodyOf = (content: JSONObject, id: string): JSONObject =>
    defined((get(content, 'conformityAssessmentBodies') as JSONObject[]).find(body => body['@id'] === id), id);

const certificateOf = (body: JSONObject, id: string): JSONObject =>
    defined((get(body, 'certificates') as JSONObject[]).find(certificate => certificate['@id'] === id), id);

/** A certificate of the given body, as the PTB:2026-0017 of the PTB, stated by the roaming network operator or not. */
const certificate = (id: string, statedBy?: JSONValue): JSONObject => {
    const meter = without(certificateOf(bodyOf(qa(), 'PTB'), 'PTB:2026-0017'), 'legislation');
    return statedBy === undefined ? { ...meter, '@id': id } : { ...meter, '@id': id, statedBy };
};

const add = (entityId: string, newValue: JSONObject, parentEntityId: string): JSONObject =>
    ({ kind: 'Add', entityType: 'ConformityCertificate', entityId, newValue, parentEntityType: 'ConformityAssessmentBody', parentEntityId });

/** An unsigned change set of the given changes, created at T0, ending in the ETags of the given content. */
function changeSet(before: RoamingNetwork, changes: JSONArray, after: JSONObject = before.content): ChangeSet {

    const json: JSONObject = {
        '@context':        CHANGE_SET_CONTEXT,
        roamingNetworkId:  'QA',
        createdAt:         T0,
        changes,
        beforeETags:       before.changeSetETags().map(eTag => etagToJSON(eTag)),
        afterETags:        RoamingNetwork.parse(after).changeSetETags().map(eTag => etagToJSON(eTag)),
    };

    json['@id'] = changeSetIdentification(json);

    return ChangeSet.parse(json);

}

/**
 * The content after the given certificates were added to or changed in the given body by a change set created at T0: stamped
 * with T0, or with the lastChange of the version, where that is later, as no lastChange goes back (S5).
 */
function withCertificate(content: JSONObject, bodyId: string, given: JSONObject): JSONObject {

    const last   = asText(content['lastChange']);
    const stamp  = Date.parse(last) > Date.parse(T0) ? last : T0;
    const after  = clone(content);
    const body   = bodyOf(after, bodyId);
    const others = ((get(body, 'certificates') ?? []) as JSONObject[]).filter(item => item['@id'] !== given['@id']);

    body['certificates']  = [ ...others, given ].sort((left, right) => asText(left['@id']) < asText(right['@id']) ? -1 : 1);
    body['lastChange']    = stamp;
    after['lastChange']   = stamp;

    return after;

}


describe('Who states a certificate', () => {

    it('is the roaming network operator in place of a body without keys, and says so', () => {

        const before  = RoamingNetwork.parse(qa());
        const stated  = certificate('BSI:2026-1', 'roamingNetworkOperator');

        const after   = applyChangeSet(before, changeSet(before, [ add('BSI:2026-1', stated, 'BSI') ], withCertificate(before.content, 'BSI', stated)), { checkOwnership: false });
        expect(certificateOf(bodyOf(after.content, 'BSI'), 'BSI:2026-1')['statedBy']).toBe('roamingNetworkOperator');

        expect(() => applyChangeSet(before, changeSet(before, [ add('BSI:2026-1', certificate('BSI:2026-1'), 'BSI') ]), { checkOwnership: false }))
            .toThrow("The certificate 'BSI:2026-1' of the conformity assessment body 'BSI' without signing keys is stated by the roaming network operator in its place: its statedBy is 'roamingNetworkOperator'!");

    });

    it('is no other: a certificate naming another is refused when read, of a version and after the change that names it', () => {

        // The verdicts and words of WWCP_POI3 at 464e712 (RoamingNetwork.TryParse, TryApplyPendingChangeSet) for these and
        // more versions and change sets of QA, 28, the same for each.
        const NOT_BY  = (id: string, by: string): string =>
            `The certificate '${id}' is stated by its conformity assessment body, or by the roaming network operator in its place, 'roamingNetworkOperator', not by '${by}'!`;

        const before  = RoamingNetwork.parse(qa());

        const refusal = (changes: JSONArray): string => {
            try {
                applyChangeSet(before, changeSet(before, changes), { checkOwnership: false });
            }
            catch (e) {
                return e instanceof Error ? e.message : String(e);
            }
            return 'taken';
        };

        const read = (statedBy: JSONValue, bodyId = 'BSI'): string => {
            const content = qa();
            if (bodyId === 'BSI')
                bodyOf(content, 'BSI')['certificates'] = [ certificate('BSI:2026-1', statedBy) ];
            else
                certificateOf(bodyOf(content, bodyId), 'PTB:2026-0017')['statedBy'] = statedBy;
            try {
                RoamingNetwork.parse(content);
            }
            catch (e) {
                return e instanceof Error ? e.message : String(e);
            }
            return 'taken';
        };

        // A version: the body, in another case, untrimmed, empty; no text; of a body with keys as well.
        expect(read('roamingNetworkOperator')).toBe('taken');
        expect(read('BSI')).toBe(NOT_BY('BSI:2026-1', 'BSI'));
        expect(read('RoamingNetworkOperator')).toBe(NOT_BY('BSI:2026-1', 'RoamingNetworkOperator'));
        expect(read(' roamingNetworkOperator ')).toBe(NOT_BY('BSI:2026-1', ' roamingNetworkOperator '));
        expect(read('')).toBe(NOT_BY('BSI:2026-1', ''));
        expect(read(5)).toBe('statedBy: expected a string.');
        expect(read([ 'roamingNetworkOperator' ])).toBe('statedBy: expected a string.');
        expect(read(null)).toBe("'conformityAssessmentBodies[0].certificates[0].statedBy' is not written as the content holds it: a property without a value is left out!");
        expect(read('PTB', 'PTB')).toBe(NOT_BY('PTB:2026-0017', 'PTB'));

        // A change set: refused at the change after which the certificate names another, before what the change set is
        // checked for as a whole.
        const other = { kind: 'UpdateProperty', entityType: 'ChargingStation', entityId: 'DE*GEF*S2', propertyName: 'description', newValue: { en: 'Two' } };
        const state = (statedBy: JSONValue, id = 'PTB:2026-0017'): JSONObject =>
            ({ kind: 'UpdateProperty', entityType: 'ConformityCertificate', entityId: id, propertyName: 'statedBy', newValue: statedBy });

        expect(refusal([ add('BSI:2026-1', certificate('BSI:2026-1', 'BSI'), 'BSI') ])).toBe('Change 0: ' + NOT_BY('BSI:2026-1', 'BSI'));
        expect(refusal([ other, add('BSI:2026-1', certificate('BSI:2026-1', 'BSI'), 'BSI') ])).toBe('Change 1: ' + NOT_BY('BSI:2026-1', 'BSI'));
        expect(refusal([ add('BSI:2026-1', certificate('BSI:2026-1', 'roamingNetworkOperator'), 'BSI'), state('BSI', 'BSI:2026-1') ])).toBe('Change 1: ' + NOT_BY('BSI:2026-1', 'BSI'));
        expect(refusal([ state('X') ])).toBe('Change 0: ' + NOT_BY('PTB:2026-0017', 'X'));
        expect(refusal([ state(5) ])).toBe('Change 0: statedBy: expected a string.');
        expect(refusal([ add('BSI:2026-1', certificate('BSI:2026-1', 5), 'BSI') ])).toBe('Change 0: statedBy: expected a string.');

        // Before a certificate of a change before it that names none where it must name the roaming network operator.
        expect(refusal([ add('BSI:2026-1', certificate('BSI:2026-1'), 'BSI'), add('BSI:2026-2', certificate('BSI:2026-2', 'BSI'), 'BSI') ]))
            .toBe('Change 1: ' + NOT_BY('BSI:2026-2', 'BSI'));
        expect(refusal([ add('PTB:2026-0099', certificate('PTB:2026-0099', 'roamingNetworkOperator'), 'PTB'), add('BSI:2026-1', certificate('BSI:2026-1', 'BSI'), 'BSI') ]))
            .toBe('Change 1: ' + NOT_BY('BSI:2026-1', 'BSI'));

    });

    it('is a body with keys itself, which names none, also of one the roaming network operator stated before it had keys', () => {

        const before  = RoamingNetwork.parse(qa());

        expect(() => applyChangeSet(before, changeSet(before, [ add('PTB:2026-0099', certificate('PTB:2026-0099', 'roamingNetworkOperator'), 'PTB') ]), { checkOwnership: false }))
            .toThrow("The certificate 'PTB:2026-0099' of the conformity assessment body 'PTB' is stated by the body itself, with its keys: it names no statedBy!");

        // PTB:2026-0017, as if the roaming network operator stated it before the PTB had keys.
        const content = qa();
        certificateOf(bodyOf(content, 'PTB'), 'PTB:2026-0017')['statedBy'] = 'roamingNetworkOperator';
        const earlier = RoamingNetwork.parse(content);

        const newNumber = { kind: 'UpdateProperty', entityType: 'ConformityCertificate', entityId: 'PTB:2026-0017', propertyName: 'documentNumber', oldValue: null, newValue: 'PTB-17' };
        const itsOwn    = { kind: 'RemoveProperty', entityType: 'ConformityCertificate', entityId: 'PTB:2026-0017', propertyName: 'statedBy', oldValue: 'roamingNetworkOperator' };

        expect(() => applyChangeSet(earlier, changeSet(earlier, [ newNumber ]), { checkOwnership: false }))
            .toThrow("The certificate 'PTB:2026-0017' of the conformity assessment body 'PTB' is stated by the body itself, with its keys: it names no statedBy!");

        const restated = { ...without(certificateOf(bodyOf(content, 'PTB'), 'PTB:2026-0017'), 'statedBy'), documentNumber: 'PTB-17' };
        const after    = applyChangeSet(earlier, changeSet(earlier, [ newNumber, itsOwn ], withCertificate(earlier.content, 'PTB', restated)), { checkOwnership: false });

        expect(certificateOf(bodyOf(after.content, 'PTB'), 'PTB:2026-0017')).toEqual(restated);

    });

    it('is shown by the proof of a station, as the certificate says', () => {

        // The station proof of example A13, as verified, PTB:2026-0042 stated by the roaming network operator: no run of the
        // examples has one, so the attested content is changed here.
        const proof     = ChargingStationProof.parse(readJSON('published/QA-DE-GEF-E1-1-proof.json'));
        const verified  = proof.verify(anchorPQ, AT);
        const attested  = clone(verified.attested);

        const find = (value: JSONValue | undefined): JSONObject | undefined =>
            isArray(value)  ? value.map(find).find(found => found !== undefined)
          : isObject(value) ? (value['@id'] === 'PTB:2026-0042' ? value : Object.values(value).map(find).find(found => found !== undefined))
          : undefined;

        defined(find(attested), 'PTB:2026-0042')['statedBy'] = 'roamingNetworkOperator';

        vi.spyOn(proof, 'verify').mockReturnValue({ ...verified, attested });

        const station = verifyChargingStation(anchorPQ, proof, { at: AT, evseId: 'DE*GEF*E1*1' });

        expect(station.certificates.map(({ namedBy, certificate, statedBy }) => `${namedBy.entityId} ${asText(certificate['@id'])}: ${statedBy}`))
            .toEqual([ 'DE*GEF*S1 PTB:2026-0042: RoamingNetworkOperator',
                       'DE*GEF*M1*1 PTB:2026-0017: ConformityAssessmentBody',
                       'DE*GEF*M1*2 PTB:2026-0017: ConformityAssessmentBody' ]);

    });

});
