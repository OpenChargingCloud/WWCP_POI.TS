import { describe, expect, it } from 'vitest';

import { rich } from './richNetwork.ts';

import { applyChangeSet, checkOwnership } from '../src/history/apply.ts';
import { Decimal } from '../src/json/decimal.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification } from '../src/history/changeSet.ts';
import { etagToJSON } from '../src/etags.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';
import type { JSONObject } from '../src/json/value.ts';


// Changes of the entities a party embeds (SPECIFICATION.md section 4, apply.ts): the charging tariff offers of charging
// station operators and e-mobility providers, the groups of e-mobility providers, the grid connection points of grid
// operators, the parking data of parking operators and the parking spaces of charging station operators. The after ETags
// are those WWCP_POI3 at c94c762 calculated for the same changes of the same version (`CreateChangeSet`): a change set is
// taken only where this library ends in the very same content.

const AT     = '2026-11-05T10:00:00.000Z';
const before = RoamingNetwork.parse(rich());

/** A change set of the given changes at AT, unsigned, leading to the version of the given json and cbor ETags, else to the one before. */
function changeSetOf(changes: JSONObject[], after?: readonly [ string, string ]): ChangeSet {

    const beforeETags = before.changeSetETags().map(eTag => etagToJSON(eTag));
    const json: JSONObject = {
        '@context':        CHANGE_SET_CONTEXT,
        roamingNetworkId:  before.id,
        createdAt:         AT,
        changes,
        beforeETags,
        afterETags:        after === undefined ? beforeETags : [ [ 'json', 'sha256', 'hex', after[0] ], [ 'cbor', 'sha256', 'hex', after[1] ] ],
    };

    json['@id'] = changeSetIdentification(json);

    return ChangeSet.parse(json);

}

/** The version the given changes lead to, as WWCP_POI3 calculated its ETags. */
const applied = (changes: JSONObject[], after: readonly [ string, string ]): RoamingNetwork =>
    applyChangeSet(before, changeSetOf(changes, after), { checkOwnership: false });

/** Why the given changes are refused, word for word, before their after ETags are looked at. */
function refusal(changes: JSONObject[]): string {
    try {
        applyChangeSet(before, changeSetOf(changes), { checkOwnership: false });
    }
    catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
    return 'taken';
}

/** Who must sign the given changes: the refusal of them unsigned. */
function owners(changes: JSONObject[]): string {
    try {
        checkOwnership(before, changeSetOf(changes));
    }
    catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
    return 'signed';
}

const update = (entityType: string, entityId: string, propertyName: string, newValue: JSONObject[keyof JSONObject], parent: JSONObject = {}): JSONObject =>
    ({ kind: 'UpdateProperty', entityType, entityId, propertyName, newValue, ...parent });

const removeProperty = (entityType: string, entityId: string, propertyName: string): JSONObject =>
    ({ kind: 'RemoveProperty', entityType, entityId, propertyName });

const add = (entityType: string, entityId: string, newValue: JSONObject, parentEntityType?: string, parentEntityId?: string): JSONObject =>
    ({ kind: 'Add', entityType, entityId, newValue, ...(parentEntityType === undefined ? {} : { parentEntityType, parentEntityId }) });

const remove = (entityType: string, entityId: string): JSONObject =>
    ({ kind: 'Remove', entityType, entityId });

const offer = (id: string): JSONObject =>
    ({ '@id': id, name: { en: id }, discount: { percent: 10 }, EVSEGroupIds: [ 'DE*GEF*EG_DC' ] });


describe('Changes of charging tariff offers', () => {

    it('of an operator: added, changed and removed as WWCP_POI3 applies them', () => {

        expect(applied([ add('ChargingTariffOffer', 'offer-2', offer('offer-2'), 'ChargingStationOperator', 'DE*GEF') ],
                       [ 'c682de48103cd55701ddc3f27a5e2b93d4732a463f671e656b95b6241989cdaa', '1982b22316bf551f7b16e36ebb8b2a53691ab9f41e92b656935aa6a6829dea76' ]).id).toBe(before.id);

        applied([ update('ChargingTariffOffer', 'offer-1', 'discount', { percent: 20 }) ],
                [ 'a498b98cac46c71d0741b224d87b3bbdf3a053bb3dd33e83815e25f14383aeea', '68462842e80fa00649a1c1c64f078d8dfcac000f065f6e77741f6bfb712ca06e' ]);

        applied([ remove('ChargingTariffOffer', 'offer-1') ],
                [ '0eabbdac716ec54ac733a3eda75e76d42654093b5e1a843f361442bb81c37fee', '0a337956b7d311572b07d5eee2662b312d947a1fb707ea1ca78660ecfd0c583b' ]);

        // Added and changed by one change set: changed as added by the earlier change.
        applied([ add('ChargingTariffOffer', 'offer-2', offer('offer-2'), 'ChargingStationOperator', 'DE*GEF'), update('ChargingTariffOffer', 'offer-2', 'name', { en: 'Two' }) ],
                [ 'e8ee42790712027c440df7728bf03bfdf090c37249b7f023a3b7764b11aeb181', 'ee685c6c246ea2961a25219bff35e6b8edab1d6a0c04946ca4b5e3b46e98091f' ]);

    });

    it('of a provider', () => {
        applied([ update('ChargingTariffOffer', 'gdf-offer', 'name', { en: 'Six off' }) ],
                [ '195f862d5008da38838d1984ff2283f3e1a035a385b70105b6c048336fcb2b52', 'fb180da6da7bdd5c5af7662e1d5efe54f104cc9ea95a55a2d404a40f97ef780c' ]);
    });

    it('refused in the words of WWCP_POI3', () => {

        expect(refusal([ add('ChargingTariffOffer', 'OFFER-1', offer('OFFER-1'), 'ChargingStationOperator', 'DE*GEF') ]))
            .toBe("Change 0: the charging tariff offer 'OFFER-1' already exists!");
        expect(refusal([ add('ChargingTariffOffer', 'offer-2', offer('offer-2'), 'ChargingStationOperator', 'DE*XXX') ]))
            .toBe("Change 0: the charging tariff offer 'offer-2' to add needs its ChargingStationOperator, an existing one!");
        expect(refusal([ add('ChargingTariffOffer', 'offer-2', offer('offer-2'), 'GridOperator', 'DE*NET') ]))
            .toBe("Change 0: the charging tariff offer 'offer-2' to add needs its ChargingStationOperator or EMobilityProvider, an existing one!");
        expect(refusal([ add('ChargingTariffOffer', 'offer-2', offer('offer-3'), 'ChargingStationOperator', 'DE*GEF') ]))
            .toBe("Change 0: the charging tariff offer to add must be a JSON object with the identification 'offer-2'!");
        expect(refusal([ update('ChargingTariffOffer', 'offer-1', 'name', { en: 'x' }, { parentEntityType: 'EMobilityProvider', parentEntityId: 'DE-GDF' }) ]))
            .toBe("Change 0: the charging tariff offer 'offer-1' belongs to ChargingStationOperator 'DE*GEF', not to EMobilityProvider 'DE-GDF'!");
        expect(refusal([ update('ChargingTariffOffer', 'offer-1', 'created', AT) ]))
            .toBe("Change 0: the property 'created' of a charging tariff offer can not be changed!");
        expect(refusal([ removeProperty('ChargingTariffOffer', 'offer-1', 'dataSource') ]))
            .toBe("Change 0: the property 'dataSource' of the charging tariff offer 'offer-1' does not exist!");
        expect(refusal([ remove('ChargingTariffOffer', 'offer-9') ]))
            .toBe("Change 0: the charging tariff offer 'offer-9' does not exist!");

        // Two offers of an operator overlapping, as the operator refuses them.
        expect(refusal([ add('ChargingTariffOffer', 'offer-2', { ...offer('offer-2'), EVSEGroupIds: [ 'DE*GEF*EG_AC' ] }, 'ChargingStationOperator', 'DE*GEF') ]))
            .toContain("The charging tariff offers 'offer-1' and 'offer-2' of the operator 'DE*GEF' overlap at the EVSE");

    });

});


describe('Changes of the groups of e-mobility providers', () => {

    it('added and removed as WWCP_POI3 applies them; a group of an operator otherwise', () => {

        applied([ add('EVSEGroup', 'DE*GDF*EG_NEW', { '@id': 'DE*GDF*EG_NEW', name: { en: 'New' }, EVSEIds: [ 'DE*GEF*E2*1' ] }, 'EMobilityProvider', 'DE-GDF') ],
                [ '06dec8ad39070d27f72080f01c508e7533ef9b4b8a57e5c80e385735eda4e942', '9e8f416eb1800e4dabf8c2bd9d1d4bc14bf387261a0463d2035776256619337b' ]);

        applied([ remove('ChargingTariffOffer', 'gdf-offer'), remove('EVSEGroup', 'DE*GDF*EG_FAV') ],
                [ '702f2efc1d25821ef528fa69609a91ff1d8578b54f2d8df4c450277e933c8f82', '8b433080c22cad00380974d9160b320dead1cf674a6a7d7bb2f413ec7c4dddd5' ]);

        expect(refusal([ update('EVSEGroup', 'DE*GDF*EG_FAV', 'chargingStationIds', [ 'DE*GEF*S1' ]) ]))
            .toBe("Change 0: the property 'chargingStationIds' of an EVSE group can not be changed!");
        expect(refusal([ add('EVSEGroup', 'DE*GDF*EG_NEW', { '@id': 'DE*GDF*EG_NEW', name: { en: 'New' } }, 'EMobilityProvider', 'DE-XXX') ]))
            .toBe("Change 0: the EVSE group 'DE*GDF*EG_NEW' to add needs its EMobilityProvider, an existing one!");

    });

});


describe('The refusal of a property no change set changes', () => {

    // "a" or "an" as the description begins, as WWCP_POI 8b0580f says it (POIJSON.WithArticle).
    it('names what it belongs to with its article', () => {

        expect(refusal([ update('EVSEGroup', 'DE*GEF*EG_AC', 'maxPower', 22000) ]))
            .toBe("Change 0: the property 'maxPower' of an EVSE group can not be changed!");
        expect(refusal([ update('EVSETemplate', 'DE*GEF*ET_AC', 'created', AT) ]))
            .toBe("Change 0: the property 'created' of an EVSE template can not be changed!");
        expect(refusal([ update('EVSE', 'DE*GEF*E1*1', 'created', AT) ]))
            .toBe("Change 0: the property 'created' of an EVSE can not be changed!");
        expect(refusal([ update('ChargingPool', 'DE*GEF*P1', 'created', AT) ]))
            .toBe("Change 0: the property 'created' of a charging pool can not be changed!");
        expect(refusal([ update('EnergyMeterModel', 'KDM-500', 'manufacturerId', 'ACME', { parentEntityType: 'EnergyMeterManufacturer', parentEntityId: 'KERNBERG' }) ]))
            .toBe("Change 0: the property 'manufacturerId' of an energy meter model can not be changed!");
        expect(refusal([ update('ChargingStationModel', 'GD-AC44', 'manufacturerId', 'ACME', { parentEntityType: 'ChargingStationManufacturer', parentEntityId: 'GraphDefined' }) ]))
            .toBe("Change 0: the property 'manufacturerId' of a charging station model can not be changed!");
        expect(refusal([ update('EnergyMeterTemplate', 'net-meter-template', 'created', AT) ]))
            .toBe("Change 0: the property 'created' of an energy meter template can not be changed!");
        expect(refusal([ update('EnergyMeterGroup', 'net-meters', 'created', AT) ]))
            .toBe("Change 0: the property 'created' of an energy meter group can not be changed!");

    });

    // A group, a template, a tariff or a pool belongs to its operator, and is refused in the words of its siblings.
    it('and of what belongs to its operator, added below another parent', () => {

        expect(refusal([ add('EVSEGroup', 'DE*GEF*EG9', { '@id': 'DE*GEF*EG9' }, 'ChargingPool', 'DE*GEF*P1') ]))
            .toBe("Change 0: an EVSE group 'DE*GEF*EG9' belongs to ChargingStationOperator 'DE*GEF', not to ChargingPool 'DE*GEF*P1'!");
        expect(refusal([ add('ChargingPool', 'DE*GEF*P9', { '@id': 'DE*GEF*P9' }, 'ChargingStationOperator', 'DE*XXX') ]))
            .toBe("Change 0: a charging pool 'DE*GEF*P9' belongs to ChargingStationOperator 'DE*GEF', not to ChargingStationOperator 'DE*XXX'!");

    });

});


describe('Changes of grid connection points', () => {

    it('changed and added as WWCP_POI3 applies them, without timestamps, named by their identifications as read', () => {

        applied([ update('GridConnectionPoint', 'gcp-1', 'name', { en: 'Point one' }) ],
                [ '9a59157b71fc82bbbdce3fd6465ca244480850297bb483a981a9996a196ef697', '17458892a37344166df9d16c3d1317a4b666bc343434fe57c5de64e0a717551e' ]);

        applied([ removeProperty('GridConnectionPoint', 'gcp-1', 'maintainedBy') ],
                [ 'd0c9fc9dbef8480ab777ffdb907b3618f5c5688cc7be58a0633b99b7503278ff', 'a0e73b1f4a5a6e58b9ac469c54953b0945d9f7f60b6cea933443ec204ba6ccdd' ]);

        applied([ add('GridConnectionPoint', ' gcp-2 ', { '@id': 'gcp-2', name: { en: 'Two' } }, 'GridOperator', 'DE*NET') ],
                [ '2e37857a179a661b7326bf7d6dc08defae468417aa16ca4cbb4787eed1f5d5cb', 'c8ec186466905892812772c21ca4a4aa81c294bb563b0b082b0aa420e4fcbcd2' ]);

        expect(refusal([ add('GridConnectionPoint', 'GCP-1', { '@id': 'GCP-1' }, 'GridOperator', 'DE*NET') ]))
            .toBe("Change 0: the grid connection point 'GCP-1' already exists, at the grid operator 'DE*NET'!");
        expect(refusal([ update('GridConnectionPoint', 'gcp-1', 'gridOperatorId', 'DE*NET') ]))
            .toBe("Change 0: the property 'gridOperatorId' of a grid connection point can not be changed!");
        expect(refusal([ add('GridConnectionPoint', 'gcp-2', { '@id': 'gcp-2', name: { en: 'Two' }, created: AT }, 'GridOperator', 'DE*NET') ]))
            .toBe("Change 0: 'gcp-2' has no timestamps: 'created' is not allowed!");

    });

});


describe('Changes of parking data', () => {

    it('of parking operators and the parking spaces of charging station operators, as WWCP_POI3 applies them', () => {

        applied([ add('ParkingGarage', 'garage-2', { '@id': 'garage-2', name: { en: 'Two' } }, 'ParkingOperator', 'DE*PRK') ],
                [ 'd4fb23fc30d5c4f1c9e54a2358a51ef2b76c403ad8aa88685e77edc4ea21fc54', '9ce0db85f3920493fc94691ee1564ade568d9c9b33073e8a6feb2d4ed073a7b8' ]);

        applied([ update('ParkingSensor', 'sensor-1', 'geoLocation', { lat: Decimal.parse('50.9'), lng: Decimal.parse('11.6') }) ],
                [ '3c4e0f4815064769a767baf3f6f436c248d5c302f08372b929a370ca503a39ff', '1ba2ed5a0ffec45da265b0394ac347ee39a4f1d2fe56dec214e51ed7b4a2d26c' ]);

        applied([ remove('ParkingSpaceGroup', 'space-group-1') ],
                [ 'fe29fb9999f38c5b82aefcec3221fc357ced08599db8d57f6237e6e723724dae', '6270526ff5ca37b307504476e41ffa613c6b29ec37c6ff24a0fb86e899f562a7' ]);

        applied([ add('ParkingSpace', 'gef-space-2', { '@id': 'gef-space-2' }, 'ChargingStationOperator', 'DE*GEF') ],
                [ 'd58a6b114e963ab2de0a12141db65c5c43582db52618b7b1a63bdb427f0223c2', 'd1f8f4045d1c5f5bbb743f1c47078d58eb0dec265f935ec9e76c0e81fc3d11ba' ]);

        // A parking product has no timestamps; its identification is compared with case.
        applied([ add('ParkingProduct', 'P2', { '@id': 'P2', minDuration: 0 }, 'ParkingOperator', 'DE*PRK') ],
                [ '96ed60124fa3f6ba3912acaee861ec60431811e7e34d49f7b1ee8a64faea69a0', 'b6416ca4b298aecd2f3bde46bb6ab70088bb57d00beecd21dba90c9b2404490f' ]);

        expect(refusal([ update('ParkingProduct', 'p1', 'minDuration', 60) ])).toBe("Change 0: the parking product 'p1' does not exist!");
        expect(refusal([ add('ParkingGarage', 'garage-2', { '@id': 'garage-2' }, 'ChargingStationOperator', 'DE*GEF') ]))
            .toBe("Change 0: the parking garage 'garage-2' to add needs its ParkingOperator, an existing one!");
        expect(refusal([ add('ParkingSpace', 'space-2', { '@id': 'space-2' }) ]))
            .toBe("Change 0: the parking space 'space-2' to add needs its ParkingOperator or ChargingStationOperator, an existing one!");
        expect(refusal([ update('ParkingSpaceTemplate', 'space-template-1', 'apdsReference', 'x') ]))
            .toBe("Change 0: the property 'apdsReference' of a parking space template can not be changed!");

    });

});


describe('Who owns the entities a party embeds (4.1)', () => {

    it('the party embedding them, the usage of what they are', () => {

        expect(owners([ update('ChargingTariffOffer', 'offer-1', 'name', { en: 'x' }) ]))
            .toBe("Change 0: UpdateProperty of the ChargingTariffOffer 'offer-1' ('name') needs a signature by a signing key of the ChargingStationOperator 'DE*GEF'!");
        expect(owners([ update('ChargingTariffOffer', 'gdf-offer', 'name', { en: 'x' }) ]))
            .toBe("Change 0: UpdateProperty of the ChargingTariffOffer 'gdf-offer' ('name') needs signatures by signing keys of 2 holders of the roaming network operator 'OCC'!");
        expect(owners([ update('EVSEGroup', 'DE*GDF*EG_FAV', 'name', { en: 'x' }) ]))
            .toBe("Change 0: UpdateProperty of the EVSEGroup 'DE*GDF*EG_FAV' ('name') needs signatures by signing keys of 2 holders of the roaming network operator 'OCC'!");
        expect(owners([ update('ParkingGarage', 'garage-1', 'name', { en: 'x' }) ]))
            .toBe("Change 0: UpdateProperty of the ParkingGarage 'garage-1' ('name') needs a signature by a signing key of the ParkingOperator 'DE*PRK'!");
        expect(owners([ update('ParkingSpace', 'gef-space-1', 'name', { en: 'x' }) ]))
            .toBe("Change 0: UpdateProperty of the ParkingSpace 'gef-space-1' ('name') needs a signature by a signing key of the ChargingStationOperator 'DE*GEF'!");
        expect(owners([ add('ChargingTariffOffer', 'offer-2', offer('offer-2')) ]))
            .toBe("Change 0: adding the ChargingTariffOffer 'offer-2' needs its ChargingStationOperator or EMobilityProvider as its parent!");

    });

    it('a grid connection point by its maintainer; its maintainer by it, its grid operator or the roaming network operator', () => {

        expect(owners([ update('GridConnectionPoint', 'gcp-1', 'name', { en: 'x' }) ]))
            .toBe("Change 0: UpdateProperty of the GridConnectionPoint 'gcp-1' ('name') needs a signature by a signing key of the ChargingStationOperator 'DE*GEF'!");

        expect(owners([ removeProperty('GridConnectionPoint', 'gcp-1', 'maintainedBy') ]))
            .toBe(`Change 0: RemoveProperty of the GridConnectionPoint 'gcp-1' ('maintainedBy') needs signatures by signing keys of 2 holders of the roaming network operator '${before.operator?.id ?? ''}' or a signing key of the ChargingStationOperator 'DE*GEF' or identity keys of 2 holders of the roaming network operator '${before.operator?.id ?? ''}'!`);

        expect(owners([ add('GridConnectionPoint', 'gcp-2', { '@id': 'gcp-2', maintainedBy: { entityType: 'ChargingStationOperator', entityId: 'DE*GEF' } }, 'GridOperator', 'DE*NET') ]))
            .toBe("Change 0: Add of the GridConnectionPoint 'gcp-2' needs signatures by a signing key of the ChargingStationOperator 'DE*GEF' or signing keys of 2 holders of the roaming network operator 'OCC'!");

    });

});
