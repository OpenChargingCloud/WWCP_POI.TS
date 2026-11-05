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
// are those WWCP_POI3 at 12e993a calculated for the same changes of the same version (`CreateChangeSet`): a change set is
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
                       [ '5cf07ff775fab12a1e43471dc2493748bbc7714e59b8247d1d412b03dac3cf6f', 'cd30d4b5e428430dc4c0222e58e04dfba21d329007d72fa89ed069debae9b09b' ]).id).toBe(before.id);

        applied([ update('ChargingTariffOffer', 'offer-1', 'discount', { percent: 20 }) ],
                [ '7049ac0981427fd0a702fd173b8ea9236941039501c29c2cc281b655c759c7e2', 'dfa3701c6946965e26ceab2dbef257a3b0d7066a3fa7d8b79473941c4b618c0d' ]);

        applied([ remove('ChargingTariffOffer', 'offer-1') ],
                [ '57b3bab686817bb21b065fcf222fbf0cc1842831b4b5cb153e29e2e1fece42b9', 'c6476caf34e959d557c66c581867106fedb93e3cee8c178e4e82f257a5aefa0a' ]);

        // Added and changed by one change set: changed as added by the earlier change.
        applied([ add('ChargingTariffOffer', 'offer-2', offer('offer-2'), 'ChargingStationOperator', 'DE*GEF'), update('ChargingTariffOffer', 'offer-2', 'name', { en: 'Two' }) ],
                [ '70ae3987184f2726f5841027ac3b28abad26ba2670a9c15b705942557897d7fb', 'd379a321c6d3a758c63a8523dda4649891ba000d75a6b9d85dfb094afa851167' ]);

    });

    it('of a provider', () => {
        applied([ update('ChargingTariffOffer', 'gdf-offer', 'name', { en: 'Six off' }) ],
                [ '92f90a5c9714df7f7fdee9592009d8352f0500cad0fbb8ae891e7294eaab424f', '5481add6a903425cfb87798048b3ac4528ba040fe46937d38bed796706d9481e' ]);
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
                [ 'ff868b10934c5422ac691794a43905a68128db8163b9d895f93f3d4920dcfaf8', '4e0e21de80917d0b5ce92b18c35d011dbfae90f3ebe83840400fd2deac262a1a' ]);

        applied([ remove('ChargingTariffOffer', 'gdf-offer'), remove('EVSEGroup', 'DE*GDF*EG_FAV') ],
                [ 'cfc67d79bc88a6f7d1b226402b60ae06770c57e7b1ab2c38415905a350131302', '48db8948c3fc1c870e7190f95e7d7a3954603a848d56b96f712aef7dac6897df' ]);

        expect(refusal([ update('EVSEGroup', 'DE*GDF*EG_FAV', 'chargingStationIds', [ 'DE*GEF*S1' ]) ]))
            .toBe("Change 0: the property 'chargingStationIds' of a EVSE group can not be changed!");
        expect(refusal([ add('EVSEGroup', 'DE*GDF*EG_NEW', { '@id': 'DE*GDF*EG_NEW', name: { en: 'New' } }, 'EMobilityProvider', 'DE-XXX') ]))
            .toBe("Change 0: the EVSE group 'DE*GDF*EG_NEW' to add needs its EMobilityProvider, an existing one!");

    });

});


describe('Changes of grid connection points', () => {

    it('changed and added as WWCP_POI3 applies them, without timestamps, named by their identifications as read', () => {

        applied([ update('GridConnectionPoint', 'gcp-1', 'name', { en: 'Point one' }) ],
                [ '1d08c2023f4b5d5c79b58670c53b82409119e5ec822480fc02814b442a63711f', '926a64e81d8ffd9f6ecf35a0b7a76bb0a40e222a959b786c670ee85222861d40' ]);

        applied([ removeProperty('GridConnectionPoint', 'gcp-1', 'maintainedBy') ],
                [ 'a7fc95fab72cd6530bf7955740adb185e3fbf998fad1b082577763d8e44f3579', 'e4ccaada12d65c21747e71f2f2d9c676672f8c8bfd83256120c9c2f8e5d0a655' ]);

        applied([ add('GridConnectionPoint', ' gcp-2 ', { '@id': 'gcp-2', name: { en: 'Two' } }, 'GridOperator', 'DE*NET') ],
                [ 'dd2059a8e36cfb2dc7d0fc3a3dbd7a65c679abe5e1d5ed11364e603bfa7ce843', '3695471b1532e0ae04ba98add7f836efbec2f89316cee553d77f89b3501bccbc' ]);

        expect(refusal([ add('GridConnectionPoint', 'GCP-1', { '@id': 'GCP-1' }, 'GridOperator', 'DE*NET') ]))
            .toBe("Change 0: the grid connection point 'GCP-1' already exists, at the grid operator 'DE*NET'!");
        expect(refusal([ update('GridConnectionPoint', 'gcp-1', 'gridOperatorId', 'DE*NET') ]))
            .toBe("Change 0: the property 'gridOperatorId' of a grid connection point can not be changed!");
        expect(refusal([ add('GridConnectionPoint', 'gcp-2', { '@id': 'gcp-2', name: { en: 'Two' }, created: AT }, 'GridOperator', 'DE*NET') ]))
            .toBe("'gcp-2' has no timestamps: 'created' is not allowed!");

    });

});


describe('Changes of parking data', () => {

    it('of parking operators and the parking spaces of charging station operators, as WWCP_POI3 applies them', () => {

        applied([ add('ParkingGarage', 'garage-2', { '@id': 'garage-2', name: { en: 'Two' } }, 'ParkingOperator', 'DE*PRK') ],
                [ '2b05b182504e5381c24ebaa08dacc546af769545491e3117c0bec9efae3a0053', '4290c9227a0223d9d8273002f0b1a5f7c55f6b85e177d23b446270b2f9b29262' ]);

        applied([ update('ParkingSensor', 'sensor-1', 'geoLocation', { lat: Decimal.parse('50.9'), lng: Decimal.parse('11.6') }) ],
                [ '4a4feab1ebe59d2aa35bfebea05e8bc7bcdfd49a6fce93d2caddef22c3ada019', 'be4c88b52841e182178464389b6fdde32e73fdb95e372bbcb381f48a99737d3c' ]);

        applied([ remove('ParkingSpaceGroup', 'space-group-1') ],
                [ 'ec34eee7db4e92162189eff8ee94c47f2a61398d537a25af07f93ea1d27aa68c', '89aaec607452c5145f8f8f7b70e64250d5bef117fd243bfbbc47d1a0f704a106' ]);

        applied([ add('ParkingSpace', 'gef-space-2', { '@id': 'gef-space-2' }, 'ChargingStationOperator', 'DE*GEF') ],
                [ '1196bdb94eb9d2b7ba54cf289e5c44495d12fc4dc0b702dcb30247400c8fc81c', '5e2a70859aa91595902e41beed0c44773525d0620c53befbcda80fe5b303c5a0' ]);

        // A parking product has no timestamps; its identification is compared with case.
        applied([ add('ParkingProduct', 'P2', { '@id': 'P2', minDuration: 0 }, 'ParkingOperator', 'DE*PRK') ],
                [ 'dd945862330d8f094dd6d2d6d9654e8199f5318df86bf36463a30c297b23a5de', '490eb186dfb012e092f646e3174f1c9f3676b8e7b8b36aa0fb69fc8edc8f90d4' ]);

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
            .toBe("Change 0: UpdateProperty of the ChargingTariffOffer 'gdf-offer' ('name') needs a signature by a signing key of the EMobilityProvider 'DE-GDF'!");
        expect(owners([ update('EVSEGroup', 'DE*GDF*EG_FAV', 'name', { en: 'x' }) ]))
            .toBe("Change 0: UpdateProperty of the EVSEGroup 'DE*GDF*EG_FAV' ('name') needs a signature by a signing key of the EMobilityProvider 'DE-GDF'!");
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
            .toBe(`Change 0: RemoveProperty of the GridConnectionPoint 'gcp-1' ('maintainedBy') needs a signature by a signing key of the GridOperator 'DE*NET' or a signing key of the ChargingStationOperator 'DE*GEF' or an identity key of the roaming network operator '${before.operator?.id ?? ''}'!`);

        expect(owners([ add('GridConnectionPoint', 'gcp-2', { '@id': 'gcp-2', maintainedBy: { entityType: 'ChargingStationOperator', entityId: 'DE*GEF' } }, 'GridOperator', 'DE*NET') ]))
            .toBe("Change 0: Add of the GridConnectionPoint 'gcp-2' needs a signature by a signing key of the ChargingStationOperator 'DE*GEF' or a signing key of the GridOperator 'DE*NET'!");

    });

});
