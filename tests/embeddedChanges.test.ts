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
// are those WWCP_POI3 at c1b641b calculated for the same changes of the same version (`CreateChangeSet`): a change set is
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
                       [ '28469eda883bcfa47fa4722246341b785bf3bb9c3946eb609ce1ac9d93303b53', '9b7832b2f5ce6d8604cb4d2cdff127e2afbe8b324b6b7eb5ed6dd01560e67f11' ]).id).toBe(before.id);

        applied([ update('ChargingTariffOffer', 'offer-1', 'discount', { percent: 20 }) ],
                [ '555acd00f842636c5bc10e430dacdc3777513b5e62d07e38d08c8184e49fcd5f', 'd4134823183466e57eb5f076d554d351e2d5917c76e40064245590026500f4c2' ]);

        applied([ remove('ChargingTariffOffer', 'offer-1') ],
                [ '0ade341c8156908d058570a9251fe4d8feef11e84cc5ce35e2b22f17c138ab9a', '038ce6725a64a35206840444cdf9672d5e1d55e95f29c88b004dab815854d669' ]);

        // Added and changed by one change set: changed as added by the earlier change.
        applied([ add('ChargingTariffOffer', 'offer-2', offer('offer-2'), 'ChargingStationOperator', 'DE*GEF'), update('ChargingTariffOffer', 'offer-2', 'name', { en: 'Two' }) ],
                [ 'c016af3d100290faea2d93ed23f42769f39df37446d8b9115ca3596d5502cb90', 'ed5a3d619b91cc58f855b3c13fa79f15c4f84ccdea9ffcbd747e84c41e83e8b0' ]);

    });

    it('of a provider', () => {
        applied([ update('ChargingTariffOffer', 'gdf-offer', 'name', { en: 'Six off' }) ],
                [ 'a7b2ee2aa6526bbdcb29aad9568231040169b22cbfcb9c917439de7645d70a69', '1af40f8a4b9a4c52d0d1f9af11bb6f44c009d6d3fae582a055d7a84614538a46' ]);
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
                [ '2865ba5c1d6aa51629781a864bf0ce6207f0d6f3826745d1a04a5791bbcf1a27', '3721fd3e01f75e81517f803ccbb16a6356355d7ad0bb4482b8efd197ebfcf50e' ]);

        applied([ remove('ChargingTariffOffer', 'gdf-offer'), remove('EVSEGroup', 'DE*GDF*EG_FAV') ],
                [ 'cc0c3d260ccdb085abc31279ae51fe027e773f83c34bd7acbeedc20c34eaa0da', 'bd93209185442710829697d085dbf289d1ec0fc30addbe748d5f9e38f493d943' ]);

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
                [ '4f451836ab915c8011ff2c2db6cea4ea533a7498adc70b5bb5a2bc83926b5e7a', '5f6b546b2dbbc62d7d23df6e4bf83b5870dab7d0ba523990e89798926de4651f' ]);

        applied([ removeProperty('GridConnectionPoint', 'gcp-1', 'maintainedBy') ],
                [ '361bba023d9af9b5d0ae9c2b04f57dfbb643fc4aa3ede4216f6195c912b35464', 'e5a0a7a4e211d86e8286b9d23f253500524eddf01e67a44b7f8cc2b14aad3a16' ]);

        applied([ add('GridConnectionPoint', ' gcp-2 ', { '@id': 'gcp-2', name: { en: 'Two' } }, 'GridOperator', 'DE*NET') ],
                [ 'dd0716c31689d97d749b2d94680dba9a86fc314cadc9857795e75cc8b9422e85', 'a0f190950ce4583487bc709ce17d6932e03efa684eaa1486f1f961579d447887' ]);

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
                [ '09c12d2ae3aeba1ba5a9976ec826f95b3d173375261b292952822429c60a6a1a', '2d371fd808bc33f40273c220e52a149df5f879aa3040253e7ae16e6db4750339' ]);

        applied([ update('ParkingSensor', 'sensor-1', 'geoLocation', { lat: Decimal.parse('50.9'), lng: Decimal.parse('11.6') }) ],
                [ 'aff0a8536d3bcf8de1eb46cc35fcb0088b6e662539d1a7adcc2ee21b8a70080a', '0a415f9e90ed8884b5be54429f3de23759e3e1b4edf3dde787257ba59439a23e' ]);

        applied([ remove('ParkingSpaceGroup', 'space-group-1') ],
                [ 'b5f1a0edb74d7a57b5c04eab6e3098b302faef79937aad3c852b03507da6351a', 'fee0945d02dc20d97c52d540982b15118571b76fd9059bc69fd08702971b0400' ]);

        applied([ add('ParkingSpace', 'gef-space-2', { '@id': 'gef-space-2' }, 'ChargingStationOperator', 'DE*GEF') ],
                [ '9f9bd29871f550fa837ad4761078b16a014c63b76914ee49150db4b461dd20cd', '5fd545a7fd28520d8c5fd18aad2538ffcce311b0fe69cb1cbdaf71bddf3d9a2f' ]);

        // A parking product has no timestamps; its identification is compared with case.
        applied([ add('ParkingProduct', 'P2', { '@id': 'P2', minDuration: 0 }, 'ParkingOperator', 'DE*PRK') ],
                [ 'e265c0e956a681e8cb3786a8fb768f637cfbd8e24a18f81e11c075ec3d7c164b', 'ad2b6926f17a8b1e57082174d3b256e68e5a7d24d1ae5cbb76b3e1365df12c0e' ]);

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
