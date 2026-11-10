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
// are those WWCP_POI3 at c4c3c5a calculated for the same changes of the same version (`CreateChangeSet`): a change set is
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
                       [ 'fe8766b72d95fff4cbe57b17ed1fce534776f173eb7493de5921f3ec87f92344', '83b2669be17607b48a5d7339c1a8a128d63b8168a5cc02da1047f2a7e3661440' ]).id).toBe(before.id);

        applied([ update('ChargingTariffOffer', 'offer-1', 'discount', { percent: 20 }) ],
                [ '409e664997e3207ea6f1259f2980beb57694ce015215c4a1ad6df5b25c990916', '6a24a28adb4e97f51657154c528ddbb04ee28504d793db22f2da06a8ad1ec95d' ]);

        applied([ remove('ChargingTariffOffer', 'offer-1') ],
                [ '6fe4f3ad0d6061a57eb6baa165f13003e827ade5d471f19f66c70a279868921b', 'c37459f03adb0c6c50faacdf48a744e2f1ec7e61dfd0c52a976c93dd29802351' ]);

        // Added and changed by one change set: changed as added by the earlier change.
        applied([ add('ChargingTariffOffer', 'offer-2', offer('offer-2'), 'ChargingStationOperator', 'DE*GEF'), update('ChargingTariffOffer', 'offer-2', 'name', { en: 'Two' }) ],
                [ '653b659076ce0147bd908758f9f01380131e26787635b2af99ca74d98aa7a95f', '89f1991485b1b3a7cfa76f4580e481f70bf6be00e6a4a07a9689d5d7f09d618a' ]);

    });

    it('of a provider', () => {
        applied([ update('ChargingTariffOffer', 'gdf-offer', 'name', { en: 'Six off' }) ],
                [ '7a30cb79682fdee4a0736387503836501099e14561bfce61d47c0a1518489ada', '1f2f359d3e77b3e532fbefc28cdaecf3a3fd2cfdc9fb1ff0fb7dfe3bafcf561b' ]);
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
                [ '49de4ccf92be7f5cfcab9b96705f566bdcc7c0c2a8c8e7b2c6d25d905513e434', 'fde21842e4d585af860e892762b4a7d01bade280cb91d0c217876985804a3ad9' ]);

        applied([ remove('ChargingTariffOffer', 'gdf-offer'), remove('EVSEGroup', 'DE*GDF*EG_FAV') ],
                [ '925162157c2f7bc1133d27df3af95b7d64ab8941719497fa42ebb5dbfab5b8da', 'a2c0bf9a7106f927b6db34ef175d9ce81b671150864c65d3fe5d251ffd78128f' ]);

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
                [ '7bc7cb4f16df702da5840a8001fa92869f680d1f1fa02caee8e9ed588aa2c5a6', '3c841019cd72f6e01baaa48b7e8feabb29b54f8c04bfd821350669e6afc4d69c' ]);

        applied([ removeProperty('GridConnectionPoint', 'gcp-1', 'maintainedBy') ],
                [ 'aabef05ba268f040287e2a0f7d6502f640a2c3f4efc291584b96c56cd716305d', 'ff6521c0a0b33c21226562d551872bfb5ba5885bb64e2afbff3d3743d70d5fc9' ]);

        applied([ add('GridConnectionPoint', ' gcp-2 ', { '@id': 'gcp-2', name: { en: 'Two' } }, 'GridOperator', 'DE*NET') ],
                [ '80a36b4ef2e3291a17b918cc50a5baa69d877741e57368599436fabf1206f69f', '257d8369aabfa6b0bf2e99e54898f5cfa633ddbbe6f5859a8d22b3cdc39c2359' ]);

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
                [ '198e8b6c7e0399d66aebb3482c257a16d1c176f123be90bf030801781a5be754', 'bfdf4879027b94a0a446abdf5c1663c1b50a00cf075bb35b55addefcf042e87d' ]);

        applied([ update('ParkingSensor', 'sensor-1', 'geoLocation', { lat: Decimal.parse('50.9'), lng: Decimal.parse('11.6') }) ],
                [ '4705f67f183664fe099b547c7f70d25beabe6276df6faf39fec0f417bcbbd6c8', 'b2cdddbdf85d463a4dc920f66bf218f431b98f8d4ee97ccaf897ca3ab9e84cc7' ]);

        applied([ remove('ParkingSpaceGroup', 'space-group-1') ],
                [ '3b55aa4393ff5387542c963f12303d5a78971185a03b3abfb7660f5a9a531a13', 'ad8854087d0594f56f195d5a46f006400e344a28b5d816668ce9c4dc9495642b' ]);

        applied([ add('ParkingSpace', 'gef-space-2', { '@id': 'gef-space-2' }, 'ChargingStationOperator', 'DE*GEF') ],
                [ 'c6a25e6698e6b44ed09d1a131f9d67bdad2d2bc63b5297099bdea751eb576f2f', '3976a7bd3e623ae63ab64e49ffcc3ef0899588cd5c65cd2fac9c9fea4c12060c' ]);

        // A parking product has no timestamps; its identification is compared with case.
        applied([ add('ParkingProduct', 'P2', { '@id': 'P2', minDuration: 0 }, 'ParkingOperator', 'DE*PRK') ],
                [ 'add146cd4f2acc4c3cb8652f4b62eb5b1dae165c7af976deda3fa461947c7d77', 'd3f80f1051921a3632def8c967ded882ac1392f84c318c26af1c8b772325579f' ]);

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
