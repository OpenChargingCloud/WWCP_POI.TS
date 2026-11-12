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
// those of WWCP_POI 76d3653 (`CreateChangeSet`).

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
                    [ '603a58ccfb69a420a6b0a923c50d5de784aae7919019668f1bb95eac0522becf', 'dd9a1ed574547ca1cfc8888f258700234795556cea292b60454ce6cf1156e8c2' ]);

        // The stars of a suffix do not count.
        for (const id of [ 'DE*GEF*E1*1', 'DEGEFE11', 'DE*GEF*E11' ])
            applied([ update('EVSE', id) ],
                    [ 'fd81eb10cc435d0120e3e44fbb9433962fac068284f6ea8c878af8c75c5aa255', '7886d9376a9f9a6ccd7706d91acb5f42e83df42b37ea71c868dff441e4318032' ]);

        for (const id of [ 'DE*GEF*T_AC', 'DE*GEF*T_A*C', 'DEGEFT_AC' ])
            applied([ update('ChargingTariff', id) ],
                    [ '4b93996aecfe869b4c6e0125fd3f5765c7f1d9279f87a89aa19ecdb21a715e51', 'e37ce508bb089424772f36b460a60c01a20671dccd4717db3a575cf50adddebf' ]);

        applied([ { kind: 'Remove', entityType: 'ChargingTariffGroup', entityId: 'DEGEFTG_ALL' } ],
                [ 'b4b9fd12fa3ee51eb365763dde16e91f13b2fb76edabcff71e4ed54d5a009f7f', 'c9a166a1832513b81f7df521c590f81d84e170ec7e55e36ac0a0f44de87c1afb' ]);

        // Added by one change, changed by the next in another spelling.
        applied([ add('EVSEGroup', 'DE*GEF*EG9', group('DE*GEF*EG9')), { kind: 'UpdateProperty', entityType: 'EVSEGroup', entityId: 'DEGEFEG9', propertyName: 'name', newValue: name } ],
                [ 'cc3f0da65a858ce65203c0c3fa3af7d080430e41eec63771e13dfac0a8d0f78f', '3d10ba72a6c5e91bd6a5f4a51fe0eb9a12fa448560dcf2f0c9be4d78ed321cc1' ]);

    });

    it('below its parent, in every spelling of the parent', () => {

        applied([ update('ChargingStation', 'DE*GEF*S1', { parentEntityType: 'ChargingPool', parentEntityId: 'DEGEFP1' }) ],
                [ 'ae114a70fc9f962b1af82a0b23650a5e442829f1b5a8602b59022caef63d9d74', 'd628c96ae408397f35f774c02ee202c3be23c34047c1c5f84d7e2148f3d827d1' ]);

        for (const operator of [ 'DE*GEF', 'DEGEF', 'de*gef', ' DE*GEF' ])
            applied([ add('EVSEGroup', 'DE*GEF*EG9', group('DE*GEF*EG9'), 'ChargingStationOperator', operator) ],
                    [ '2caeb2380e6f494387b1619b06ca23144ae450a32c75eb5b87c4b0936e7b567f', '0144293e74151cf26c37677bcceb96f8fba294988982e220c5934321f1097db2' ]);

        for (const pool of [ 'DE*GEF*P1', 'DEGEFP1', 'de*gef*P1' ])
            applied([ add('ChargingStation', 'DE*GEF*S9', { '@id': 'DE*GEF*S9' }, 'ChargingPool', pool) ],
                    [ 'edc9cb8ba0576fcd6ff383b9864844c4ef77a5139089487fcfcfbd71b0da4c7c', 'd5d0c18ea64f518b2fe004f977e84afd891baec48f9c49dc512ae99aa435a09e' ]);

    });

    it('trimmed as read: its kind, entity type and identification, which its identification is of', () => {

        applied([ { kind: ' UpdateProperty', entityType: 'ChargingPool ', entityId: ' DE*GEF*P1', propertyName: 'name', newValue: name } ],
                [ '603a58ccfb69a420a6b0a923c50d5de784aae7919019668f1bb95eac0522becf', 'dd9a1ed574547ca1cfc8888f258700234795556cea292b60454ce6cf1156e8c2' ]);

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
