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
// are those WWCP_POI3 at 76d3653 calculated for the same changes of the same version (`CreateChangeSet`): a change set is
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
                       [ '4fa98641edafb2cb08a10ecca80fb9867a896d8a44e712692c33327ff4233f0d', '32668a69be23386f88f1bd5d9a98b53ced64edf9c57ca62f9fc3ed7b414db4e8' ]).id).toBe(before.id);

        applied([ update('ChargingTariffOffer', 'offer-1', 'discount', { percent: 20 }) ],
                [ 'c40150f2a4e26c052f41408d3b43a929de2999ab44a2e667d54458bc5a4de639', 'cec4791f87f8bc35b83855a8faf56b8885ea8b7f7ae4f23861eceef9999e291a' ]);

        applied([ remove('ChargingTariffOffer', 'offer-1') ],
                [ 'cc42a6b23cdc2d66924109b27c615a12dd5588ce930b0161571b8947ae372a37', '1ce2c99426875414c0ac13fd8e00430300e3b48a27caa82bb71e436a5239de74' ]);

        // Added and changed by one change set: changed as added by the earlier change.
        applied([ add('ChargingTariffOffer', 'offer-2', offer('offer-2'), 'ChargingStationOperator', 'DE*GEF'), update('ChargingTariffOffer', 'offer-2', 'name', { en: 'Two' }) ],
                [ '77eb19eb35a0a3ebce086543481e71da4d9c42d8421568170277aa2ff06c1651', '72afcf39219870629189bf208dbce310e67be38811df6394b069c46c4b52238c' ]);

    });

    it('of a provider', () => {
        applied([ update('ChargingTariffOffer', 'gdf-offer', 'name', { en: 'Six off' }) ],
                [ '5513a8b163dbcb27d0fba59918316dd3fa66e52a5d3099dac65c041967019af3', 'bbb1f2b2683a7cd1bffeef75cee4a5fafa5b42e072285832c9483aed6c24b5b6' ]);
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
                [ 'd0ebcce395c3e7246a39a78e57ca03b18259a1460bcba851b260e5164d70a9f8', '2816a96cef41945bfc663c36a689e93c0730a48be6333037152f1d540d689637' ]);

        applied([ remove('ChargingTariffOffer', 'gdf-offer'), remove('EVSEGroup', 'DE*GDF*EG_FAV') ],
                [ '92122b4ce46ac5f4435cde8255fdbc32652489475c309fe9c03cbf58941c33f4', '0b81986dc76d5cbdc09b06522fad4600a8127ab67faece9eab64cca79755111b' ]);

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
                [ 'b6d04cd4d5921cd68f10685d6306563b67dd25c3b498a9d4bc551ee4f82bd003', '41e256442be09e5f6f26f84961182c14e1bb97b88b1b903936b41e68bae2d495' ]);

        applied([ removeProperty('GridConnectionPoint', 'gcp-1', 'maintainedBy') ],
                [ '767f6c65cd21a165ec140e9d6dedf5d3c4492e6ef33475da774a3315af404b08', '2384393a6007f2a246d7774f202d2f6a8c277c122f5b2ee49e8ab9172302bb75' ]);

        applied([ add('GridConnectionPoint', ' gcp-2 ', { '@id': 'gcp-2', name: { en: 'Two' } }, 'GridOperator', 'DE*NET') ],
                [ '7b71010c95dae84da69a5d9f5ca002af0684d7692ad2996188ae3fe634e5b338', 'f34067920273101909c183b1be45f508966198ee86f7ee2d223bef515131dafc' ]);

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
                [ '171b0596a676a7cb075b670f8a3fefb86de39fb2fb48a9f65f6cb43ec825e525', 'dbe084cff449fabd557e48245fc84d29a36c233f371d926ba8cdb63eeebabfab' ]);

        applied([ update('ParkingSensor', 'sensor-1', 'geoLocation', { lat: Decimal.parse('50.9'), lng: Decimal.parse('11.6') }) ],
                [ 'e542ebda916ce710a8758f49effcdde6f40480d4a90fcba8a581c6cc173a23a6', 'b11a9ffe293669fa05cc904bb5b6d1daff8f755fdfe344da07a82f5b5ae65180' ]);

        applied([ remove('ParkingSpaceGroup', 'space-group-1') ],
                [ '019b726f98486bf29a2f2ef6c58c14ed99ea5793918c3a489a167ae574952c6c', '11cccefe7a3e542d4d761cbac8910cb5092ae3065ffab9e461a83a1325a30923' ]);

        applied([ add('ParkingSpace', 'gef-space-2', { '@id': 'gef-space-2' }, 'ChargingStationOperator', 'DE*GEF') ],
                [ '36bf42d385bba652f1ee18d78bfbdafdd9adfa3ce0c2cddb6d9e3cf720911961', 'ecbf8e9c0011f623e35d8c2854a09d92b76dc536baa24cd5b857f27cecfb8e57' ]);

        // A parking product has no timestamps; its identification is compared with case.
        applied([ add('ParkingProduct', 'P2', { '@id': 'P2', minDuration: 0 }, 'ParkingOperator', 'DE*PRK') ],
                [ '98632bc1153bc3326e284dad42c8c66d48527bd6447ad9c379b44a041f7a773a', '95ab2d22d8e5411371adaeec57e5af89f1980831f62c6c19952f652c98a89889' ]);

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
