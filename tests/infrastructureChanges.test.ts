import { describe, expect, it } from 'vitest';

import { rich } from './richNetwork.ts';

import { hash } from '../src/crypto/hash.ts';
import { toHex } from '../src/encoding/text.ts';
import { applyChangeSet, checkOwnership } from '../src/history/apply.ts';
import { canonicalJSONBytes } from '../src/json/canonical.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification } from '../src/history/changeSet.ts';
import { etagToJSON } from '../src/etags.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';
import type { JSONObject } from '../src/json/value.ts';


// Changes of the infrastructure of a charging station operator naming it in every spelling its identification type
// considers equal, e.g. `DEGEFP1` for `DE*GEF*P1`, as WWCP_POI3 finds it (RoamingNetwork.InfrastructureChanges.cs,
// `StoredId`): the entity, its parent and its operator, and who must sign the change. The words are those of WWCP_POI
// 8b0580f for the same changes of the same version (`TryApplyPendingChangeSet`, `TryCheckCoSigning`), the after ETags
// those of WWCP_POI c4c3c5a (`CreateChangeSet`).

const AT      = '2026-11-05T10:00:00.000Z';
const before  = RoamingNetwork.parse(rich());
const name    = { en: 'Renamed' };

/** The JSON of a change set of the given changes at AT, unsigned, leading to the version of the given ETags, else to the one before. */
function changeSetJSON(changes: JSONObject[], after?: readonly [ string, string ]): JSONObject {
    const beforeETags = before.changeSetETags().map(eTag => etagToJSON(eTag));
    return {
        '@context':        CHANGE_SET_CONTEXT,
        roamingNetworkId:  before.id,
        createdAt:         AT,
        changes,
        beforeETags,
        afterETags:        after === undefined ? beforeETags : [ [ 'json', 'sha256', 'hex', after[0] ], [ 'cbor', 'sha256', 'hex', after[1] ] ],
    };
}

/** A change set of the given changes, identified by its content. */
function changeSetOf(changes: JSONObject[], after?: readonly [ string, string ]): ChangeSet {
    const json = changeSetJSON(changes, after);
    json['@id'] = changeSetIdentification(json);
    return ChangeSet.parse(json);
}

/** The version the given changes lead to, as WWCP_POI3 calculated its ETags. */
const applied = (changes: JSONObject[], after: readonly [ string, string ]): RoamingNetwork =>
    applyChangeSet(before, changeSetOf(changes, after), { checkOwnership: false });

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

/** Why the given changes are refused, before their after ETags are looked at. */
const refusal = (changes: JSONObject[]): string =>
    refused(() => applyChangeSet(before, changeSetOf(changes), { checkOwnership: false }));

/** Who must sign the given changes: the refusal of them unsigned. */
const owners = (changes: JSONObject[]): string =>
    refused(() => { checkOwnership(before, changeSetOf(changes)); });

const update = (entityType: string, entityId: string, parent: JSONObject = {}): JSONObject =>
    ({ kind: 'UpdateProperty', entityType, entityId, propertyName: 'name', newValue: name, ...parent });

const add = (entityType: string, entityId: string, newValue: JSONObject, parentEntityType?: string, parentEntityId?: string): JSONObject =>
    ({ kind: 'Add', entityType, entityId, newValue, ...(parentEntityType === undefined ? {} : { parentEntityType, parentEntityId }) });

const group = (id: string): JSONObject =>
    ({ '@id': id, name: { en: 'G' }, EVSEIds: [ 'DE*GEF*E1*1' ] });


describe('Infrastructure named in every spelling its identification type considers equal', () => {

    it('changed as the entity of the identification it is kept with', () => {

        // Without the stars of the operator, in lower case where the type compares without case.
        for (const id of [ 'DE*GEF*P1', 'DEGEFP1', 'DEGEF*P1', 'degefP1' ])
            applied([ update('ChargingPool', id) ],
                    [ 'c9c69fbe6cff8eba1a8f190b02d99c8e2c6d7f074d307cf1d51bf9c7e45113db', '1484586debf9bfd7bbc94db4ae7dfaf4685ba5d00b9e9cd162f57a758c5381ac' ]);

        // The stars of a suffix do not count.
        for (const id of [ 'DE*GEF*E1*1', 'DEGEFE11', 'DE*GEF*E11' ])
            applied([ update('EVSE', id) ],
                    [ '2ce57b75106da70d56db4feb31b04cba2cafc8f7d62a5d90aeeefc6f1c641549', '0e3a78fd03f2f63d4573347a5afc09d250faab81aaddc04fe2dcbdead9d819a9' ]);

        for (const id of [ 'DE*GEF*T_AC', 'DE*GEF*T_A*C', 'DEGEFT_AC' ])
            applied([ update('ChargingTariff', id) ],
                    [ 'ac79066c38fa8150a5c80166673db5d498706064ad55f528b60901db79d51c03', 'bd6e76433190b365bf0a0872bc2ba2b7a6e044ea9e58a3840d9a2fab8acbb46c' ]);

        applied([ { kind: 'Remove', entityType: 'ChargingTariffGroup', entityId: 'DEGEFTG_ALL' } ],
                [ '511d41340e4c68936ea79a3f932dfba9488260b55a2575ba0d20caabe1fe94d8', '3890994044d0f9ef961008d4741719316d06fd9ac6e0de4a34ea37dd4a604d38' ]);

        // Added by one change, changed by the next in another spelling.
        applied([ add('EVSEGroup', 'DE*GEF*EG9', group('DE*GEF*EG9')), { kind: 'UpdateProperty', entityType: 'EVSEGroup', entityId: 'DEGEFEG9', propertyName: 'name', newValue: name } ],
                [ 'c1794f32440d24db5b058a93a7a87e5e8e9516719ae021847ed8f8f042ea23ca', 'afc3dc443a2615e18be6d9863f1a957d692658a54686fb36f0c5d7ce06053392' ]);

    });

    it('below its parent, in every spelling of the parent', () => {

        applied([ update('ChargingStation', 'DE*GEF*S1', { parentEntityType: 'ChargingPool', parentEntityId: 'DEGEFP1' }) ],
                [ 'e397de2c3636e58f7b50c8400467d537a0ac79da0bfa4031d9dba71aa5f545c7', '38f76cd7ab411c752f22dd1743304a1119b1ae160a88cdcbd5c6ffec91ae72ab' ]);

        for (const operator of [ 'DE*GEF', 'DEGEF', 'de*gef', ' DE*GEF' ])
            applied([ add('EVSEGroup', 'DE*GEF*EG9', group('DE*GEF*EG9'), 'ChargingStationOperator', operator) ],
                    [ '9aab3c1fb2c0832fd21f46a4ef78e55095f287025e78b1f76da3b87a8c33045a', '85861356e6541cc8259abe6e424bf797895a2f4a69d3adb450640688d12588d7' ]);

        for (const pool of [ 'DE*GEF*P1', 'DEGEFP1', 'de*gef*P1' ])
            applied([ add('ChargingStation', 'DE*GEF*S9', { '@id': 'DE*GEF*S9' }, 'ChargingPool', pool) ],
                    [ 'def2d1302f4503bb4c01d7d69769d9c618b78b036534b4c33c0aed969890ce1f', '6b591cd741bf51eb8fcf59c056086a49d6a4d56debc628b69fdebf918281347c' ]);

    });

    it('trimmed as read: its kind, entity type and identification, which its identification is of', () => {

        applied([ { kind: ' UpdateProperty', entityType: 'ChargingPool ', entityId: ' DE*GEF*P1', propertyName: 'name', newValue: name } ],
                [ 'c9c69fbe6cff8eba1a8f190b02d99c8e2c6d7f074d307cf1d51bf9c7e45113db', '1484586debf9bfd7bbc94db4ae7dfaf4685ba5d00b9e9cd162f57a758c5381ac' ]);

        // Identified by them untrimmed, the SHA-256 of its canonical JSON as given, it is identified otherwise.
        const json  = changeSetJSON([ update('ChargingPool', ' DE*GEF*P1') ]);
        const given = toHex(hash('sha256', canonicalJSONBytes(json)));
        json['@id'] = given;

        expect(refused(() => ChangeSet.parse(json)))
            .toBe(`The change set '${given}' is not identified by its content, '${changeSetIdentification(json)}'!`);

    });

});


describe('Infrastructure changes refused in the words of WWCP_POI3', () => {

    it('of an identification its type does not read, or of an operator that does not exist', () => {

        // The letter of a charging pool is upper case.
        expect(refusal([ update('ChargingPool', 'de*gef*p1') ]))
            .toBe("Change 0: invalid charging pool identification 'de*gef*p1'!");
        expect(refusal([ update('ChargingPool', 'DE*XXX*P1') ]))
            .toBe("Change 0: the charging station operator 'DE*XXX' of the charging pool 'DE*XXX*P1' does not exist!");
        expect(refusal([ update('ChargingStation', 'DE*GEF*S1', { parentEntityType: 'ChargingPool', parentEntityId: 'de*gef*p1' }) ]))
            .toBe("Change 0: the charging station 'DE*GEF*S1' belongs to ChargingPool 'DE*GEF*P1', not to ChargingPool 'de*gef*p1'!");
        expect(refusal([ update('ChargingPool', 'DE*GEF*P1', { parentEntityType: 'ChargingStationOperator', parentEntityId: 'de-gef' }) ]))
            .toBe("Change 0: the charging pool 'DE*GEF*P1' belongs to ChargingStationOperator 'DE*GEF', not to ChargingStationOperator 'de-gef'!");

    });

    it('added without its parent, below a parent that does not exist, or named otherwise than its type writes it', () => {

        expect(refusal([ add('ChargingStation', 'DE*GEF*S9', { '@id': 'DE*GEF*S9' }, 'ChargingStationOperator', 'DE*GEF') ]))
            .toBe("Change 0: adding the charging station 'DE*GEF*S9' needs its ChargingPool as its parent!");
        expect(refusal([ add('EVSE', 'DE*GEF*E1*9', { '@id': 'DE*GEF*E1*9' }) ]))
            .toBe("Change 0: adding the EVSE 'DE*GEF*E1*9' needs its ChargingStation as its parent!");
        expect(refusal([ add('ChargingStation', 'DE*GEF*S9', { '@id': 'DE*GEF*S9' }, 'ChargingPool', 'DE*GEF*P9') ]))
            .toBe("Change 0: the charging pool 'DE*GEF*P9' of the charging station 'DE*GEF*S9' does not exist!");
        expect(refusal([ add('EVSE', 'DE*GEF*E1*9', { '@id': 'DE*GEF*E1*9' }, 'ChargingStation', 'DE*GEF*S9') ]))
            .toBe("Change 0: the charging station 'DE*GEF*S9' of the EVSE 'DE*GEF*E1*9' does not exist!");
        expect(refusal([ add('EVSEGroup', 'DEGEFEG9', group('DEGEFEG9')) ]))
            .toBe("Change 0: the EVSE group 'DEGEFEG9' to add is not given as the content holds it, '{\"@id\":\"DE*GEF*EG9\",\"EVSEIds\":[\"DE*GEF*E1*1\"],\"name\":{\"en\":\"G\"}}'!");

    });

    it('signed by the operator its identification names, whether it exists or not', () => {

        expect(owners([ update('ChargingPool', 'DEGEFP1') ]))
            .toBe("Change 0: UpdateProperty of the ChargingPool 'DEGEFP1' ('name') needs a signature by a signing key of the ChargingStationOperator 'DE*GEF'!");
        expect(owners([ update('ChargingPool', 'DE*XXX*P1') ]))
            .toBe("Change 0: UpdateProperty of the ChargingPool 'DE*XXX*P1' ('name') needs a signature by a signing key of the ChargingStationOperator 'DE*XXX'!");
        expect(owners([ update('ChargingPool', 'de*gef*p1') ]))
            .toBe("Change 0: the identification 'de*gef*p1' of the ChargingPool names no charging station operator!");

    });

    it('of a party without signing keys by the roaming network operator in its place, by as many holders as its quorum needs', () => {

        // DE-GDF has no signing keys: the roaming network operator signs in its place (`SignerOf`).
        expect(owners([ { kind: 'UpdateProperty', entityType: 'EVSEGroup', entityId: 'DE*GDF*EG_FAV', propertyName: 'chargingStationIds', newValue: [ 'DE*GEF*S1' ] } ]))
            .toBe("Change 0: UpdateProperty of the EVSEGroup 'DE*GDF*EG_FAV' ('chargingStationIds') needs signatures by signing keys of 2 holders of the roaming network operator 'OCC'!");

    });

});
