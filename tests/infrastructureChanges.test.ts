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
// those of WWCP_POI 039303b (`CreateChangeSet`).

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
                    [ '5503a51270de770b1204227acc95ba8d17ec0c3e44bd2edbc66babcce762988b', '65a11cc293518181394473deb03d3511494b83d5636df008092a2eacc8125ce5' ]);

        // The stars of a suffix do not count.
        for (const id of [ 'DE*GEF*E1*1', 'DEGEFE11', 'DE*GEF*E11' ])
            applied([ update('EVSE', id) ],
                    [ 'cf4977149be62419b1a0b6a4bf1beefd15cbd9a0e717ff3305720740542c43a1', 'dde24235310352799863319eec3501aec1650b2af4693ef5d02f766e838652e2' ]);

        for (const id of [ 'DE*GEF*T_AC', 'DE*GEF*T_A*C', 'DEGEFT_AC' ])
            applied([ update('ChargingTariff', id) ],
                    [ '36912a70216b346abc1df1d68c1458ed8f4bd7a30e009f9fca3daf08a1e18d1f', 'fbd641fb813dd904f534e83bfb90e0b04237b2d418a1b0c123e6fb76af37bd57' ]);

        applied([ { kind: 'Remove', entityType: 'ChargingTariffGroup', entityId: 'DEGEFTG_ALL' } ],
                [ 'df25ee788696711816190358043738c3dcaf5c92d2f396e913258084c75a2881', 'bc9e1a462fa9050521a505df806d213bbc71dfe09de828ee4cbdbbbf6997b18d' ]);

        // Added by one change, changed by the next in another spelling.
        applied([ add('EVSEGroup', 'DE*GEF*EG9', group('DE*GEF*EG9')), { kind: 'UpdateProperty', entityType: 'EVSEGroup', entityId: 'DEGEFEG9', propertyName: 'name', newValue: name } ],
                [ '44e171d1734fe7830944f26c00113ca1c8cd8f0e883339c8a3f4beeb7b737bfe', '6a1bdc39d55e2f445df1b6b520f1b8f4af22dddf67ed6c96d8ee1e2d60cbbb30' ]);

    });

    it('below its parent, in every spelling of the parent', () => {

        applied([ update('ChargingStation', 'DE*GEF*S1', { parentEntityType: 'ChargingPool', parentEntityId: 'DEGEFP1' }) ],
                [ '29de7521f4475741e957802e235848d8bb73c12e094a549ad16ef0aac0d0011b', '626ff1d40ef9da7a13e4a3f2b722924ad76490e965efc39ddf2aee81e022bc3f' ]);

        for (const operator of [ 'DE*GEF', 'DEGEF', 'de*gef', ' DE*GEF' ])
            applied([ add('EVSEGroup', 'DE*GEF*EG9', group('DE*GEF*EG9'), 'ChargingStationOperator', operator) ],
                    [ 'e7a8d0bc8a5cf07d35ee1172543cfa99deaafda90c94341cf62e98e8fe93eac2', '936e4a74855764ce0f5ca397c6718b80c9167599a68495a1d7d283c74f29cbfb' ]);

        for (const pool of [ 'DE*GEF*P1', 'DEGEFP1', 'de*gef*P1' ])
            applied([ add('ChargingStation', 'DE*GEF*S9', { '@id': 'DE*GEF*S9' }, 'ChargingPool', pool) ],
                    [ '4d9bef2a0b39e570bd7680ca4cb82797027e59aa59b8e6ef9999bef522d354cf', 'a396f9952bbf1c643e777de1d0551803f3e364036d5128d75c35ee9e3f072248' ]);

    });

    it('trimmed as read: its kind, entity type and identification, which its identification is of', () => {

        applied([ { kind: ' UpdateProperty', entityType: 'ChargingPool ', entityId: ' DE*GEF*P1', propertyName: 'name', newValue: name } ],
                [ '5503a51270de770b1204227acc95ba8d17ec0c3e44bd2edbc66babcce762988b', '65a11cc293518181394473deb03d3511494b83d5636df008092a2eacc8125ce5' ]);

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
