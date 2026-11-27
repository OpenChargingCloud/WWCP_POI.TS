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
// are those WWCP_POI3 at 039303b calculated for the same changes of the same version (`CreateChangeSet`): a change set is
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
                       [ '9adbf48574959e735e410d90acdf6e18fdaf4c33ed733c464d83726e249ead6f', '3776f452f4c453f32b770d6a71247bbe79b355ba701d517c8ed12d9d2b657992' ]).id).toBe(before.id);

        applied([ update('ChargingTariffOffer', 'offer-1', 'discount', { percent: 20 }) ],
                [ '853b15d4128d740a7ad147acabe8253ccf3442e173890cf525da9b8563dbe135', '25d9327a3a2b94c392156b5a5e2b0c741c1a41b98e2abc5cd644e599a35d4e8a' ]);

        applied([ remove('ChargingTariffOffer', 'offer-1') ],
                [ 'd78c8b010e99c15e3488e86d76de3fc0d47f7431dbb9b8347a6b7feedca9817d', 'da94df849b91362be2674e3f33faad87a67a95db5a38dcc48d30c23ff49a2fdd' ]);

        // Added and changed by one change set: changed as added by the earlier change.
        applied([ add('ChargingTariffOffer', 'offer-2', offer('offer-2'), 'ChargingStationOperator', 'DE*GEF'), update('ChargingTariffOffer', 'offer-2', 'name', { en: 'Two' }) ],
                [ '4fdd8a0fa019c7fa34dc3e7b829e41ed162f68c4de9d80b27e9dd156a3037e5b', 'c0c8029d6feb5697e04addad3978e17c7fcb666b04573751219eee44215a807e' ]);

    });

    it('of a provider', () => {
        applied([ update('ChargingTariffOffer', 'gdf-offer', 'name', { en: 'Six off' }) ],
                [ '06fd18efe698eccd5c49f368a8facf81c8eb6f9689e5b90a451b509a408bcb84', 'cf6fbf91d23d464623f7e0f846a6c714cb81565ca56e723eaf075e2236107c33' ]);
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
                [ '4a230ffef3557ac94e801002c16431fc88db5747a28b935bd03cdc18b3d6e638', '137732337ebc2045532579af9752e1e3ae8506953bef52b856a4a71a384fd97d' ]);

        applied([ remove('ChargingTariffOffer', 'gdf-offer'), remove('EVSEGroup', 'DE*GDF*EG_FAV') ],
                [ '438fa502b143c90e4b9d43f2a5cb890fbd508fc8b6a06d4ec08ea4f01b8aee7a', '8931328547dea2ec52ad7d695a713a4a715f648e885b0671a80672064187e355' ]);

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
                [ '68ad2a538ca5be5f485cc4ed6018966d18808e40146ec3ae3d10a95cfa15284d', '07eb972039d70faa354b4136754bfdba02149dbd23270e197996d532d618b10b' ]);

        applied([ removeProperty('GridConnectionPoint', 'gcp-1', 'maintainedBy') ],
                [ 'ed9b00d63e653689873f0611e9e9c7ee392758af58dd8c6b3a55e289de46f368', '410b8d4856387cc06b743ea8e69cd3664f5e7eb49b323398d8fa80b63742bbe9' ]);

        applied([ add('GridConnectionPoint', ' gcp-2 ', { '@id': 'gcp-2', name: { en: 'Two' } }, 'GridOperator', 'DE*NET') ],
                [ '5efbc0c348c5db920414b31681c36ea420cd4a9e286f642e527f43b64a880917', 'a6d759176d65766254e04284c9f30ff17f3389c59000c9f5355e2d24ca6c7d45' ]);

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
                [ '1430b577d1c4e270f0a27dc312efc6b9186587c618d41bb42977cc687e1c0c35', 'ac9f8bd474c1ff28aec97e3f8a0d94a5811834d3757c107e7e17dbd27abd7701' ]);

        applied([ update('ParkingSensor', 'sensor-1', 'geoLocation', { lat: Decimal.parse('50.9'), lng: Decimal.parse('11.6') }) ],
                [ '7aeac6f90612c046ba7b443023dfe3210472857b2c3f03e150eb619e5644447f', 'db36bf169431d43f7923ded7cc1198a34790c960396c70a2cc974abcb29a6fe4' ]);

        applied([ remove('ParkingSpaceGroup', 'space-group-1') ],
                [ '224ae7dadf7acf9ae3deb12221466c6b39719e1a447ec8c3f64abfbb7af0d787', '0781235fdcaf4239a39d32437f1168e9014999571eb33c13501d7d8f013b512d' ]);

        applied([ add('ParkingSpace', 'gef-space-2', { '@id': 'gef-space-2' }, 'ChargingStationOperator', 'DE*GEF') ],
                [ '9086e63bff393217231df010ed89641a75f7312e3b1c5f51f3fd5762921f436d', '0f72cad28a4eb12b7e091c4571d338c5c7fb463a07184eb7e836c0b464567be3' ]);

        // A parking product has no timestamps; its identification is compared with case.
        applied([ add('ParkingProduct', 'P2', { '@id': 'P2', minDuration: 0 }, 'ParkingOperator', 'DE*PRK') ],
                [ '0218865a5253b83e7552200061805c13a4fd9b99269769469321166e7b67e97d', '74814bddba994ced744d7e500c8ff3e939c8de6a70553493c940e508b255d6a7' ]);

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
