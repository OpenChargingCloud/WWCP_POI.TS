import { describe, expect, it } from 'vitest';

import { defined } from './helpers.ts';
import { qa, refusal } from './richNetwork.ts';

import { applyChangeSet } from '../src/history/apply.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification } from '../src/history/changeSet.ts';
import { etagToJSON } from '../src/etags.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';
import { clone, isArray, isObject, type JSONObject, type JSONValue } from '../src/json/value.ts';


// Releases and certificates identified under their owners (SPECIFICATION.md 4.1, POI3-ISSUES.md S36, WWCP_POI 045e180):
// the @id of a transparency software release is the @id of its manufacturer, a colon and a name without one, of a
// certificate the @id of the body issuing it alike; the prefix compared without case, both trimmed as read. A version or
// change set holding one identified otherwise is refused in the words of WWCP_POI3 (ForeignTransparencySoftware,
// ForeignConformityCertificate), before releases or certificates given twice; the change sets taken lead to the versions
// WWCP_POI3 at c4c3c5a calculated for the same changes of the same version (CreateChangeSet).

const AT       = '2026-11-05T21:00:00.000Z';
const RELEASE  = 'GraphDefined:chargy-1.5.0';

// The versions WWCP_POI3 at c4c3c5a calculated for these change sets of QA: their json and cbor ETags.
const ADD_RELEASE      = [ 'dd32e5efc098d25b04ee6aeb0df49e0bc003f648db2afc16cddc4e2b04d18c57', '91d4a149c2f89c04546f306a5fb9befddc0e43be1bccd8f166a4c3131949a734' ] as const;
const ADD_CERTIFICATE  = [ '79c834990fccfba2f307779a3a973ef7316918c82f16d4700adc0eabdab706bf', '2510c0f1a00fb34ccc7da1b9b1476d2415bc682350d9007ed05c4fa7d23840e9' ] as const;

/** The given JSON with every text the given identification is replaced by the other one: the entity and what names it. */
function renamed(json: JSONValue, from: string, to: string): JSONValue {
    if (json === from)
        return to;
    if (isArray(json))
        return json.map(item => renamed(item, from, to));
    if (isObject(json))
        return Object.fromEntries(Object.entries(json).map(([ property, value ]) => [ property, renamed(value, from, to) ]));
    return json;
}

/** QA with the release or certificate of the given identification identified otherwise, everywhere. */
const qaWith = (...renames: [ string, string ][]): JSONObject =>
    renames.reduce((json, [ from, to ]) => renamed(json, from, to) as JSONObject, qa());

const bodyOf = (network: JSONObject, id: string): JSONObject =>
    defined((network['conformityAssessmentBodies'] as JSONObject[]).find(body => body['@id'] === id), id);

const inNetwork = (error: string, parameter: string): string =>
    `The given JSON representation of a roaming network is invalid: ${error} (Parameter '${parameter}')`;

const foreignRelease = (id: string, manufacturer = 'GraphDefined'): string =>
    `The transparency software release '${id}' of the manufacturer '${manufacturer}' is not identified as one of it: by '${manufacturer}:' and a name without a colon!`;

const foreignCertificate = (id: string, body = 'PTB'): string =>
    `The certificate '${id}' of the conformity assessment body '${body}' is not identified as one of it: by '${body}:' and a name without a colon!`;


describe('Releases and certificates identified under their owners (S36)', () => {

    it('of a version: a release by its manufacturer, a colon and a name without one, the prefix without case', () => {

        expect(refusal(qa())).toBe('taken');
        expect(refusal(qaWith([ RELEASE, 'graphdefined:chargy-1.5.0' ]))).toBe('taken');
        expect(refusal(qaWith([ RELEASE, 'GRAPHDEFINED:chargy-1.5.0' ]))).toBe('taken');
        expect(refusal(qaWith([ RELEASE, 'GraphDefined:chärgy' ]))).toBe('taken');

        for (const id of [ 'chargy-1.5.0', 'OpenChargingCloud:chargy-1.5.0', 'GraphDefinedX:chargy-1.5.0', 'GraphDefined/chargy-1.5.0',
                           'GraphDefined:chargy:1.5.0', 'GraphDefined:', 'GraphDefined' ])
            expect(refusal(qaWith([ RELEASE, id ]))).toBe(inNetwork(foreignRelease(id), 'TransparencySoftwareManufacturers'));

        // Trimmed as read: given with whitespace, it is the release of its manufacturer, refused as not written as held.
        expect(refusal(qaWith([ RELEASE, ` ${RELEASE}` ])))
            .toBe(`'chargingStationOperators[0].energyMeterTemplates[1].transparencySoftwareStatus[0].transparencySoftwareId' is not written as the content holds it: the content holds it as '"${RELEASE}"'!`);

    });

    it('of a version: a certificate by the body issuing it, so that two bodies may number theirs alike', () => {

        expect(refusal(qaWith([ 'PTB:2026-0042', 'ptb:2026-0042' ]))).toBe('taken');

        for (const id of [ 'PTB-2026-0042', 'EM-LAB:2026-0042', 'PTB:2026:0042' ])
            expect(refusal(qaWith([ 'PTB:2026-0042', id ]))).toBe(inNetwork(foreignCertificate(id), 'ConformityAssessmentBodies'));

        // The release before the certificates, the first certificate first.
        expect(refusal(qaWith([ RELEASE, 'chargy-1.5.0' ], [ 'PTB:2026-0042', 'PTB-2026-0042' ])))
            .toBe(inNetwork(foreignRelease('chargy-1.5.0'), 'TransparencySoftwareManufacturers'));
        expect(refusal(qaWith([ 'PTB:2026-0017', 'X-0017' ], [ 'PTB:2026-0042', 'Y-0042' ])))
            .toBe(inNetwork(foreignCertificate('X-0017'), 'ConformityAssessmentBodies'));

        // Two bodies numbering alike, each under its own identification; another one's certificate is none of its own.
        const twoBodies = qa();
        const copy      = clone(defined((bodyOf(twoBodies, 'PTB')['certificates'] as JSONObject[])[0]));
        bodyOf(twoBodies, 'EM-LAB')['certificates'] = [ { ...copy, '@id': 'EM-LAB:2026-0017' } ];
        expect(refusal(twoBodies)).toBe('taken');

        bodyOf(twoBodies, 'EM-LAB')['certificates'] = [ copy ];
        expect(refusal(twoBodies)).toBe(inNetwork(foreignCertificate('PTB:2026-0017', 'EM-LAB'), 'ConformityAssessmentBodies'));

    });

    describe('of a change set, after its last change, as WWCP_POI3 checks it there', () => {

        const before   = RoamingNetwork.parse(qa());
        const release  = (id: string): JSONObject =>
            ({ ...clone(defined((defined((before.content['transparencySoftwareManufacturers'] as JSONObject[])[0])['transparencySoftware'] as JSONObject[])[0])),
               '@id': id, version: '2.0.0' });
        const certificate = (id: string): JSONObject =>
            ({ ...clone(defined((bodyOf(before.content, 'PTB')['certificates'] as JSONObject[])[0])), '@id': id });

        const addRelease = (id: string): JSONObject =>
            ({ kind: 'Add', entityType: 'TransparencySoftware', entityId: id, newValue: release(id),
               parentEntityType: 'TransparencySoftwareManufacturer', parentEntityId: 'GraphDefined' });
        const addCertificate = (id: string, body: string): JSONObject =>
            ({ kind: 'Add', entityType: 'ConformityCertificate', entityId: id, newValue: certificate(id), parentEntityType: 'ConformityAssessmentBody', parentEntityId: body });

        /** A change set of the given changes at AT, unsigned, leading to the version of the given ETags, else to the one before. */
        function changeSetOf(changes: JSONObject[], after?: readonly [ string, string ]): ChangeSet {
            const beforeETags = before.changeSetETags().map(eTag => etagToJSON(eTag));
            const json: JSONObject = {
                '@context': CHANGE_SET_CONTEXT, roamingNetworkId: before.id, createdAt: AT, changes, beforeETags,
                afterETags: after === undefined ? beforeETags : [ [ 'json', 'sha256', 'hex', after[0] ], [ 'cbor', 'sha256', 'hex', after[1] ] ],
            };
            json['@id'] = changeSetIdentification(json);
            return ChangeSet.parse(json);
        }

        /** Why the given changes are refused, word for word; 'taken' when they lead to the version WWCP_POI3 calculated. */
        function outcome(changes: JSONObject[], after?: readonly [ string, string ]): string {
            try {
                applyChangeSet(before, changeSetOf(changes, after), { checkOwnership: false });
            }
            catch (e) {
                return e instanceof Error ? e.message : String(e);
            }
            return 'taken';
        }

        it('takes a release and a certificate identified under their owners', () => {

            expect(outcome([ addRelease('GraphDefined:chargy-2.0') ], ADD_RELEASE)).toBe('taken');
            expect(outcome([ addCertificate('EM-LAB:2026-0017', 'EM-LAB') ], ADD_CERTIFICATE)).toBe('taken');

        });

        it('refuses one identified otherwise, bare, before what it names', () => {

            expect(outcome([ addRelease('chargy-2.0') ])).toBe(foreignRelease('chargy-2.0'));
            expect(outcome([ addRelease('Other:chargy-2.0') ])).toBe(foreignRelease('Other:chargy-2.0'));
            expect(outcome([ addCertificate('PTB-2026-0099', 'PTB') ])).toBe(foreignCertificate('PTB-2026-0099'));
            expect(outcome([ addCertificate('EM-LAB:2026-0099', 'PTB') ])).toBe(foreignCertificate('EM-LAB:2026-0099'));

            // Its releases stay those of the manufacturer it was: renamed, it has none of its own.
            const manufacturer = defined((before.content['transparencySoftwareManufacturers'] as JSONObject[])[0]);
            expect(outcome([ { kind: 'Remove', entityType: 'TransparencySoftwareManufacturer', entityId: 'GraphDefined' },
                             { kind: 'Add', entityType: 'TransparencySoftwareManufacturer', entityId: 'GraphDefinedGmbH', newValue: { ...clone(manufacturer), '@id': 'GraphDefinedGmbH' } } ]))
                .toBe(foreignRelease(RELEASE, 'GraphDefinedGmbH'));

        });

    });

});
