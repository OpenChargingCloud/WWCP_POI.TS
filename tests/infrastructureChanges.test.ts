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
// `StoredId`): the entity, its parent and its operator, and who must sign the change. The after ETags and the words are
// those of WWCP_POI 8b0580f for the same changes of the same version (`TryApplyPendingChangeSet`, `CreateChangeSet`,
// `TryCheckCoSigning`).

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
                    [ '89b41292e1cd1b459fab2ce9fd35f462001e34bc8a8d87a0e2ca74c97996995c', '521047533620f33258b299aed7dc494604191687e5bf9a47bd27ddd6cc53ecb5' ]);

        // The stars of a suffix do not count.
        for (const id of [ 'DE*GEF*E1*1', 'DEGEFE11', 'DE*GEF*E11' ])
            applied([ update('EVSE', id) ],
                    [ '7fdfd49979bd65d9559791e838b7e51b2282602283dc545daf418c960215a5db', '38258bee6607da3f98c5f24564c1adb9ce6fd85207c150441d424a78291785fa' ]);

        for (const id of [ 'DE*GEF*T_AC', 'DE*GEF*T_A*C', 'DEGEFT_AC' ])
            applied([ update('ChargingTariff', id) ],
                    [ 'f196f3beb08ba210838c574fd04b1fa219a64fb3ee37ff7c6bef6eb96a8c26fb', '4ca35dfe1b7801d112b8352c0f595cfe7ae37c19e269b779ff74d1f9e2fc8d99' ]);

        applied([ { kind: 'Remove', entityType: 'ChargingTariffGroup', entityId: 'DEGEFTG_ALL' } ],
                [ 'b6cf90ff8cbe0ba6dfa2cda232d6a1793fa6c154d4ba841bb983d63d46779529', '8e57b869a5d744b7a8bbde3ff3b58efaf129810ea2dd547cacc5ee2389ffda0e' ]);

        // Added by one change, changed by the next in another spelling.
        applied([ add('EVSEGroup', 'DE*GEF*EG9', group('DE*GEF*EG9')), { kind: 'UpdateProperty', entityType: 'EVSEGroup', entityId: 'DEGEFEG9', propertyName: 'name', newValue: name } ],
                [ 'd15735d1ebd23e4df064f8d738d234d2b6c686f477eb03f8216b16c77612d088', '51e3f4aa5b0a1d97a1ce20086c463c0c988de1e3edfe92333babdbe98116971a' ]);

    });

    it('below its parent, in every spelling of the parent', () => {

        applied([ update('ChargingStation', 'DE*GEF*S1', { parentEntityType: 'ChargingPool', parentEntityId: 'DEGEFP1' }) ],
                [ '8fa66f288fb8c2c3660fb48ed301a2cfea3173d192a7f90466bc96a2d5eef301', 'f80e3d7e833396a838e8a3b19c5f9f93495265bfd6208752c2adf6565a5469eb' ]);

        for (const operator of [ 'DE*GEF', 'DEGEF', 'de*gef', ' DE*GEF' ])
            applied([ add('EVSEGroup', 'DE*GEF*EG9', group('DE*GEF*EG9'), 'ChargingStationOperator', operator) ],
                    [ 'b573f8d7116f193cada8f0a75acbfa4ed0733a1751fc65f35eaf5e99ec83dfe2', 'ac5379a237efde3a333d73f84f1a56373e3de3b8265b43614b31aebcd41bf648' ]);

        for (const pool of [ 'DE*GEF*P1', 'DEGEFP1', 'de*gef*P1' ])
            applied([ add('ChargingStation', 'DE*GEF*S9', { '@id': 'DE*GEF*S9' }, 'ChargingPool', pool) ],
                    [ '070b46ed49f156a761f142addc67d85da58ef4edd86a36538002e2e2d386660c', 'a1de7aeac60e440a19b8fbf3f7984955d162fc8627eea0b017f4253b96e35a38' ]);

    });

    it('trimmed as read: its kind, entity type and identification, which its identification is of', () => {

        applied([ { kind: ' UpdateProperty', entityType: 'ChargingPool ', entityId: ' DE*GEF*P1', propertyName: 'name', newValue: name } ],
                [ '89b41292e1cd1b459fab2ce9fd35f462001e34bc8a8d87a0e2ca74c97996995c', '521047533620f33258b299aed7dc494604191687e5bf9a47bd27ddd6cc53ecb5' ]);

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

});
