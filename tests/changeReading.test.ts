import { describe, expect, it } from 'vitest';

import { rich } from './richNetwork.ts';

import { hash } from '../src/crypto/hash.ts';
import { toHex } from '../src/encoding/text.ts';
import { applyChangeSet } from '../src/history/apply.ts';
import { canonicalJSONBytes } from '../src/json/canonical.ts';
import { ChangeSet, CHANGE_CONTEXT, CHANGE_SET_CONTEXT, ELEMENT_PATH_SEGMENT_CONTEXT, changeSetIdentification } from '../src/history/changeSet.ts';
import { etagToJSON } from '../src/etags.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';
import type { JSONObject, JSONValue } from '../src/json/value.ts';


// A change of a change set read as WWCP_POI3 reads it (RoamingNetworkChange.TryParse, POIElementPathSegment.TryParse),
// refused in the words of its refusal after "Change N: ", as WWCP_POI3 refuses it when read with the C# patch
// cs-change-refusal (RoamingNetworkChange.Refusal, on WWCP_POI 8b0580f), and the content a change set is identified by,
// as WWCP_POI3 writes each change again (ToJSON(Embedded: true)). Probed with ZProbeChanges: the same verdicts as
// WWCP_POI 8b0580f, the same words as with the patch.

const AT      = '2026-11-05T10:00:00.000Z';
const before  = RoamingNetwork.parse(rich());
const P1      = 'DE*GEF*P1';

const rename: JSONObject = { kind: 'UpdateProperty', entityType: 'ChargingPool', entityId: P1, propertyName: 'name', newValue: { en: 'Renamed' } };

const removeBrand = (segment: JSONObject): JSONObject =>
    ({ kind: 'RemoveElement', entityType: 'ChargingStationOperator', entityId: 'DE*GEF', elementPath: [ segment ] });

/** The JSON of a change set of the given changes at AT, unsigned, leading to the version before. */
function changeSetJSON(changes: JSONValue[]): JSONObject {
    const beforeETags = before.changeSetETags().map(eTag => etagToJSON(eTag));
    return { '@context': CHANGE_SET_CONTEXT, roamingNetworkId: before.id, createdAt: AT, changes, beforeETags, afterETags: beforeETags };
}

/** Why something is refused, word for word. */
function refused(action: () => unknown): string {
    try {
        action();
    }
    catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
    return 'taken';
}

/** Why a change set of the given changes, identified by its content, is refused when read. */
const read = (...changes: JSONValue[]): string =>
    refused(() => {
        const json = changeSetJSON(changes);
        json['@id'] = changeSetIdentification(json);
        return ChangeSet.parse(json);
    });

/** Why the given changes are refused when applied: of changes taken, the version they lead to, as its ETags differ. */
const applied = (...changes: JSONValue[]): string =>
    refused(() => {
        const json = changeSetJSON(changes);
        json['@id'] = changeSetIdentification(json);
        return applyChangeSet(before, ChangeSet.parse(json), { checkOwnership: false });
    });

/** Why a change set of the given changes, changed so, identified by its content, is refused when read, or applied. */
function readOtherwise(changes: JSONValue[], change: (json: JSONObject) => void, apply = false): string {
    const json = changeSetJSON(changes);
    change(json);
    json['@id'] = changeSetIdentification(json);
    return refused(() => apply ? applyChangeSet(before, ChangeSet.parse(json), { checkOwnership: false }) : ChangeSet.parse(json));
}

/** Why a change set of the given changes is refused, identified by the SHA-256 of its canonical JSON as given. */
function identifiedAsGiven(...changes: JSONValue[]): string {
    const json  = changeSetJSON(changes);
    const given = toHex(hash('sha256', canonicalJSONBytes(json)));
    json['@id'] = given;
    return refused(() => ChangeSet.parse(json)).replace(given, '<given>').replace(changeSetIdentification(json), '<content>');
}


describe('A change refused when read, in the words of its refusal after "Change N: "', () => {

    it('of its texts: anything but a text, also JSON null', () => {

        expect(read({ ...rename, kind: 42 })).toBe('Change 0: the kind must be a text!');
        expect(read({ entityType: 'ChargingPool', entityId: P1 })).toBe('Change 0: the kind must be a text!');
        expect(read({ ...rename, entityType: 1 })).toBe('Change 0: the entity type must be a text!');
        expect(read({ ...rename, entityId: null })).toBe('Change 0: the entity identification must be a text!');
        expect(read({ ...rename, propertyName: null })).toBe('Change 0: the property name must be a text!');
        expect(read({ ...rename, parentEntityType: null, parentEntityId: 'DE*GEF' })).toBe('Change 0: the parent entity type must be a text!');
        expect(read({ ...rename, parentEntityType: 'ChargingStationOperator', parentEntityId: 1 })).toBe('Change 0: the parent entity identification must be a text!');

        // The kind trimmed, also when nothing is left.
        expect(read({ ...rename, kind: 'Rename' })).toBe("Change 0: unknown kind 'Rename'!");
        expect(read({ ...rename, kind: '  ' })).toBe("Change 0: unknown kind ''!");

    });

    it('of its context, also JSON null, before its kind', () => {

        const context = `the JSON-LD context of the roaming network change must be '${CHANGE_CONTEXT}'!`;

        expect(read({ ...rename, '@context': 'x' })).toBe(`Change 0: ${context}`);
        expect(read({ ...rename, '@context': null })).toBe(`Change 0: ${context}`);
        expect(read({ ...rename, '@context': 'x', kind: 'Rename' })).toBe(`Change 0: ${context}`);
        expect(read({ ...rename, '@context': CHANGE_CONTEXT })).toBe('taken');

    });

    it('of its parent: both or none, neither empty', () => {

        expect(read({ ...rename, parentEntityType: 'ChargingStationOperator' })).toBe('Change 0: parent type and parent identifier must be supplied together!');
        expect(read({ ...rename, parentEntityId: 'DE*GEF' })).toBe('Change 0: parent type and parent identifier must be supplied together!');
        expect(read({ ...rename, parentEntityType: '  ', parentEntityId: 'DE*GEF' })).toBe('Change 0: its parent entity type and identification must not be empty!');
        expect(read({ ...rename, parentEntityType: 'ChargingStationOperator', parentEntityId: ' ' })).toBe('Change 0: its parent entity type and identification must not be empty!');

    });

    it('in the order WWCP_POI3 reads it: its texts before its element path, its parent before its values', () => {

        expect(read({ ...rename, elementPath: {}, entityType: 1 })).toBe('Change 0: the entity type must be a text!');
        expect(read({ ...rename, elementPath: [ 1 ], entityId: 1 })).toBe('Change 0: the entity identification must be a text!');
        expect(read({ ...rename, elementPath: [ {} ], propertyName: 1 })).toBe('Change 0: the property name must be a text!');
        expect(read({ ...rename, elementPath: [ {} ], parentEntityType: 1, parentEntityId: 'DE*GEF' })).toBe('Change 0: the parent entity type must be a text!');
        expect(read({ ...rename, parentEntityType: 'ChargingStationOperator', parentEntityId: ' ', newValue: null }))
            .toBe('Change 0: its parent entity type and identification must not be empty!');
        expect(read({ ...rename, parentEntityType: 'ChargingStationOperator', entityId: ' ' })).toBe('Change 0: its entity type and identification must not be empty!');

    });

    it('of the segments of its element path', () => {

        expect(read(removeBrand({ propertyName: 'brands', elementId: 1 })))   .toBe('Change 0: invalid element path segment: an element identifier must not be empty!');
        expect(read(removeBrand({ propertyName: 'brands', elementId: null }))).toBe('Change 0: invalid element path segment: an element identifier must not be empty!');
        expect(read(removeBrand({ propertyName: 1 })))                         .toBe('Change 0: invalid element path segment: a schema property name is required!');
        expect(read(removeBrand({ propertyName: '  ' })))                      .toBe('Change 0: invalid element path segment: a schema property name is required!');

    });

});


describe('A change set identified by its changes as WWCP_POI3 writes them again', () => {

    it('without the context of a change or of a segment, without an empty element path, the property name of a segment trimmed', () => {

        const plain = removeBrand({ propertyName: 'brands', elementId: 'GEF-Brand' });

        // Taken as without them, leading to the same version.
        expect(applied(rename)).toMatch(/^The result does not match the change set: the json ETag/u);
        expect(applied({ ...rename, '@context': CHANGE_CONTEXT })).toBe(applied(rename));
        expect(applied({ ...rename, elementPath: [] })).toBe(applied(rename));
        expect(applied(plain)).toMatch(/^The result does not match the change set: the json ETag/u);
        expect(applied(removeBrand({ '@context': ELEMENT_PATH_SEGMENT_CONTEXT, propertyName: 'brands', elementId: 'GEF-Brand' }))).toBe(applied(plain));
        expect(applied(removeBrand({ propertyName: ' brands ', elementId: 'GEF-Brand' }))).toBe(applied(plain));

        // Identified by them as given, otherwise: WWCP_POI3 identifies it by what it writes.
        const otherwise = "The change set '<given>' is not identified by its content, '<content>'!";

        expect(identifiedAsGiven({ ...rename, '@context': CHANGE_CONTEXT })).toBe(otherwise);
        expect(identifiedAsGiven({ ...rename, elementPath: [] })).toBe(otherwise);
        expect(identifiedAsGiven(removeBrand({ '@context': ELEMENT_PATH_SEGMENT_CONTEXT, propertyName: 'brands', elementId: 'GEF-Brand' }))).toBe(otherwise);
        expect(identifiedAsGiven(removeBrand({ propertyName: ' brands ', elementId: 'GEF-Brand' }))).toBe(otherwise);

        // An element identification is kept as given.
        expect(identifiedAsGiven(removeBrand({ propertyName: 'brands', elementId: ' GEF-Brand ' }))).toBe('taken');

    });

});


describe('A change set read and identified as WWCP_POI3 writes it again: its roaming network, description and metadata', () => {

    // The identifications WWCP_POI3 at 76d3653 gave a change set of this change (ZProbePreconditions), so changed.
    const two: JSONObject = { kind: 'UpdateProperty', entityType: 'ChargingStation', entityId: 'DE*GEF*S2', propertyName: 'description', newValue: { en: 'Two' } };

    const identification = (change: (json: JSONObject) => void): string => {
        const json = changeSetJSON([ two ]);
        change(json);
        return changeSetIdentification(json);
    };

    it('its roaming network trimmed, without a description or metadata with nothing in them, a description as Styx reads a text in languages', () => {

        expect(identification(() => undefined)).toBe('400da75dd218b7f2930ac6f4294e0bf7ea562f8f71abd40d0e258f9ae8c0dbf8');

        for (const change of [ (json: JSONObject): void => { json['roamingNetworkId'] = ' QA '; },
                               (json: JSONObject): void => { json['description'] = {}; },
                               (json: JSONObject): void => { json['description'] = null; },
                               (json: JSONObject): void => { json['description'] = { en: 5, '': 'x', de: null, fr: { a: 1 } }; },
                               (json: JSONObject): void => { json['metadata'] = {}; } ])
            expect(identification(change)).toBe('400da75dd218b7f2930ac6f4294e0bf7ea562f8f71abd40d0e258f9ae8c0dbf8');

        expect(identification(json => { json['description'] = { en: 'x' }; })).toBe('2cc52ac9adb5006a2bab39248b9d789d13383b4cf8457bc5208b82d0c1b3346b');
        expect(identification(json => { json['description'] = { EN: 'x' }; })).toBe('2cc52ac9adb5006a2bab39248b9d789d13383b4cf8457bc5208b82d0c1b3346b');
        expect(identification(json => { json['description'] = { en: '' }; })).toBe('f8156a9dd58615291baf46a6d770c7745f88751e836becad6a45299606f9bd6a');
        expect(identification(json => { json['metadata'] = { a: 1 }; })).toBe('14839971a6012946783d89c15196f6a5e8987b898a4aabfd27476efd0b18d2fa');

        // Identified by them as given, refused in the words of WWCP_POI3.
        const asGiven = (change: (json: JSONObject) => void): string => {
            const json = changeSetJSON([ two ]);
            change(json);
            json['@id'] = toHex(hash('sha256', canonicalJSONBytes(json)));
            return refused(() => ChangeSet.parse(json));
        };

        expect(asGiven(json => { json['roamingNetworkId'] = ' QA '; }))
            .toBe("The change set '383a6641931d30d834f8da1c618f6fcfee50b1d5d0e78a1a9f7248176574c0ea' is not identified by its content, '400da75dd218b7f2930ac6f4294e0bf7ea562f8f71abd40d0e258f9ae8c0dbf8'!");
        expect(asGiven(json => { json['description'] = {}; }))
            .toBe("The change set '0fd10d0acb4a20654c4e52fada058f838f652c690d84bc237431ea80adb70d03' is not identified by its content, '400da75dd218b7f2930ac6f4294e0bf7ea562f8f71abd40d0e258f9ae8c0dbf8'!");
        expect(asGiven(json => { json['metadata'] = {}; }))
            .toBe("The change set '904e4bb84cb101d06cfd50b44409744bdba0d3252dd4e1c7b7fe27d5a6d0488a' is not identified by its content, '400da75dd218b7f2930ac6f4294e0bf7ea562f8f71abd40d0e258f9ae8c0dbf8'!");

    });

    it('its roaming network compared without case, as RoamingNetwork_Id compares it; refused in the words of WWCP_POI3', () => {

        const taken = readOtherwise([ two ], () => undefined, true);

        expect(taken).toMatch(/^The result does not match the change set: the json ETag/u);
        expect(readOtherwise([ two ], json => { json['roamingNetworkId'] = 'qa'; }, true)).toBe(taken);
        expect(readOtherwise([ two ], json => { json['roamingNetworkId'] = ' QA '; }, true)).toBe(taken);
        expect(readOtherwise([ two ], json => { json['roamingNetworkId'] = 'QB'; }, true)).toBe("The change set is for the roaming network 'QB', not for 'QA'!");

        expect(readOtherwise([ two ], json => { delete json['roamingNetworkId']; })).toBe("Missing JSON property 'roamingNetworkId'!");

        for (const id of [ null, '', '  ' ])
            expect(readOtherwise([ two ], json => { json['roamingNetworkId'] = id; })).toBe("Invalid 'roaming network identification'!");

        for (const description of [ 5, [], 'x' ])
            expect(readOtherwise([ two ], json => { json['description'] = description; })).toBe("JSON property 'description' is not an object!");

        for (const metadata of [ null, [], 'x', 5 ])
            expect(readOtherwise([ two ], json => { json['metadata'] = metadata; })).toBe('The metadata must be a JSON object!');

    });

});
