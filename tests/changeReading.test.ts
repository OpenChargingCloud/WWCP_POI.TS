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
