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
// those of WWCP_POI c94c762 (`CreateChangeSet`).

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
                    [ 'd39b1c4836f02ba08448bf528ebbcb731b654f1540b82feb21ac7c382c47985e', 'af65aa2671632a57db291c6c6dd0e9dfba343d50cb2f77d14ac0b8dbdee0be7c' ]);

        // The stars of a suffix do not count.
        for (const id of [ 'DE*GEF*E1*1', 'DEGEFE11', 'DE*GEF*E11' ])
            applied([ update('EVSE', id) ],
                    [ 'f65fe4f53ecce630f59fdf7782dd78530a81d786edd38df7e1f45d04c87ea781', '03f015633412c5ec64ee4c6d700a9294ddd418d0e212f230fe2234ca98b47396' ]);

        for (const id of [ 'DE*GEF*T_AC', 'DE*GEF*T_A*C', 'DEGEFT_AC' ])
            applied([ update('ChargingTariff', id) ],
                    [ '17fb3c34bf862ef8c71bf6ee6bc98d50dcb2bf9e0b76b048655579d8623ef8e2', '238fcd0a52b81ac1dbc423dd74c1aad9e0e1819c307462c735b0b708a35107fb' ]);

        applied([ { kind: 'Remove', entityType: 'ChargingTariffGroup', entityId: 'DEGEFTG_ALL' } ],
                [ 'cb56439aad5175302c2d21a652b16143ea424965dcf3a4db42f5082733d26017', '34116d5e76a0f8aa0aeaf90ab57c52a105f19f55f06f0a764e56fc7c18fd2647' ]);

        // Added by one change, changed by the next in another spelling.
        applied([ add('EVSEGroup', 'DE*GEF*EG9', group('DE*GEF*EG9')), { kind: 'UpdateProperty', entityType: 'EVSEGroup', entityId: 'DEGEFEG9', propertyName: 'name', newValue: name } ],
                [ 'ec2df6ac66722989d5fe2efae1ad5a6fc71a2730166808c17d569dba6b34bcc5', 'f59e5a27167e07a46eaf4e75f6bfa54ba2a7b509eb50613e725b3811a91bd04d' ]);

    });

    it('below its parent, in every spelling of the parent', () => {

        applied([ update('ChargingStation', 'DE*GEF*S1', { parentEntityType: 'ChargingPool', parentEntityId: 'DEGEFP1' }) ],
                [ 'a3e877c7883d143fed6ac8fa27eb2c86d1eb14d86015ddd3b5eda2f0430df6a2', '9994c6ef27ef830c633ca9d588bf9727f59e19b92faec2bc9d9c3c567dcb997f' ]);

        for (const operator of [ 'DE*GEF', 'DEGEF', 'de*gef', ' DE*GEF' ])
            applied([ add('EVSEGroup', 'DE*GEF*EG9', group('DE*GEF*EG9'), 'ChargingStationOperator', operator) ],
                    [ 'd814fb2aa0ef62ef592f7bfa914cd7f8eab1f2150e12ea2e86afe1395709fe6b', '99cec3e6ab4bff07da1749a89cf816c68795ca3a9cff18b8cc1c05b53873fc93' ]);

        for (const pool of [ 'DE*GEF*P1', 'DEGEFP1', 'de*gef*P1' ])
            applied([ add('ChargingStation', 'DE*GEF*S9', { '@id': 'DE*GEF*S9' }, 'ChargingPool', pool) ],
                    [ 'c298768f748e2e0366448dac914e69645eb429c3915d926c7439705be41a2179', '9898b795092397b6e683641a86138c47ce383d9de37a612b99412ff8075dc175' ]);

    });

    it('trimmed as read: its kind, entity type and identification, which its identification is of', () => {

        applied([ { kind: ' UpdateProperty', entityType: 'ChargingPool ', entityId: ' DE*GEF*P1', propertyName: 'name', newValue: name } ],
                [ 'd39b1c4836f02ba08448bf528ebbcb731b654f1540b82feb21ac7c382c47985e', 'af65aa2671632a57db291c6c6dd0e9dfba343d50cb2f77d14ac0b8dbdee0be7c' ]);

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
