import { describe, expect, it } from 'vitest';

import { rich } from './richNetwork.ts';

import { applyChangeSet } from '../src/history/apply.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification } from '../src/history/changeSet.ts';
import { etagToJSON } from '../src/etags.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';
import type { JSONObject, JSONValue } from '../src/json/value.ts';


// What a change set changes is read again right after each change, as WWCP_POI3 reads it (RoamingNetwork.ChangeSets.cs,
// TryApplyRegistryChange, TryApplyInfrastructureChange, …): the party a change changed, the roaming network operator, and
// the property of the roaming network itself it changed. So a change making a party one WWCP_POI3 does not read is
// refused in the words of that change, "Change N: …", also where a later change would make it valid again. Probed against
// WWCP_POI 8b0580f on the QA network, word for word.

const AT     = '2026-11-05T10:00:00.000Z';
const before = RoamingNetwork.parse(rich());

/** A change set of the given changes at AT, unsigned, leading to the version before: only its refusals are looked at. */
function changeSetOf(changes: JSONObject[]): ChangeSet {

    const eTags = before.changeSetETags().map(eTag => etagToJSON(eTag));
    const json: JSONObject = { '@context': CHANGE_SET_CONTEXT, roamingNetworkId: before.id, createdAt: AT, changes, beforeETags: eTags, afterETags: eTags };

    json['@id'] = changeSetIdentification(json);

    return ChangeSet.parse(json);

}

/** Why the given changes are refused, word for word; 'taken' where only their after ETags differ. */
function refusal(...changes: JSONObject[]): string {
    try {
        applyChangeSet(before, changeSetOf(changes), { checkOwnership: false });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return message.startsWith('The result does not match the change set') ? 'taken' : message;
    }
    return 'taken';
}

const update = (entityType: string, entityId: string, propertyName: string, newValue: JSONValue, more: JSONObject = {}): JSONObject =>
    ({ kind: 'UpdateProperty', entityType, entityId, propertyName, newValue, ...more });

const removeProperty = (entityType: string, entityId: string, propertyName: string): JSONObject =>
    ({ kind: 'RemoveProperty', entityType, entityId, propertyName });


describe('A party a change changed is read again right after the change', () => {

    it('refused in the words of the change, of every kind of party and what it embeds', () => {

        expect(refusal(update('ChargingStationOperator', 'DE*GEF', 'homepage', 'no url'))).toBe("Change 0: Invalid homepage 'no url'!");
        expect(refusal(update('ChargingPool', 'DE*GEF*P1', 'hotline', 42))).toBe("Change 0: Invalid hotline phone number '42'!");
        expect(refusal(update('ChargingStation', 'DE*GEF*S1', 'modelURL', 'no url'))).toBe("Change 0: Invalid model URL 'no url'!");
        expect(refusal(update('EVSE', 'DE*GEF*E1*1', 'maxPower', 'x'))).toBe("Change 0: Invalid value for 'maximum power'!");
        expect(refusal(update('ChargingTariff', 'DE*GEF*T_AC', 'currency', 'xx')))
            .toBe("Change 0: The currency of the charging tariff 'DE*GEF*T_AC' must be an ISO 4217 code, not 'xx'!");
        expect(refusal(update('EVSEGroup', 'DE*GEF*EG_AC', 'name', 42))).toBe("Change 0: JSON property 'name' is not an object!");
        expect(refusal(update('EMobilityProvider', 'DE-GDF', 'name', 42))).toBe("Change 0: JSON property 'name' is not an object!");
        expect(refusal(update('ChargingTariffOffer', 'gdf-offer', 'name', 42))).toBe("Change 0: JSON property 'name' is not an object!");
        expect(refusal(update('ConformityAssessmentBody', 'PTB', 'homepage', 'no url'))).toBe("Change 0: Invalid homepage 'no url'!");
        expect(refusal(update('ChargingStationModel', 'GD-AC44', 'maxPower', 'x', { parentEntityType: 'ChargingStationManufacturer', parentEntityId: 'GraphDefined' })))
            .toBe("Change 0: Invalid value for 'maximum power'!");
        expect(refusal(update('TransparencySoftware', 'GraphDefined:chargy-1.5.0', 'name', 42))).toBe('Change 0: TransparencySoftware: name: expected a multi-language object.');
        expect(refusal(update('GridConnectionPoint', 'gcp-1', 'nominalVoltage', 'x'))).toBe("Change 0: Invalid value for 'nominal voltage'!");
        expect(refusal(update('ParkingSpace', 'space-1', 'width', 'x'))).toBe("Change 0: Invalid value for 'width'!");
        expect(refusal(update('EnergyMeterGroup', 'net-meters', 'name', 42))).toBe("Change 0: JSON property 'name' is not an object!");
        expect(refusal(update('RoamingNetworkOperator', 'OCC', 'hotline', 42))).toBe("Change 0: Invalid hotline phone number '42'!");

        expect(refusal({ kind: 'Add', entityType: 'ChargingPool', entityId: 'DE*GEF*P9', newValue: { '@id': 'DE*GEF*P9', hotline: 42, created: AT } }))
            .toBe("Change 0: Invalid hotline phone number '42'!");
        expect(refusal({ kind: 'Add', entityType: 'EMobilityProvider', entityId: 'DE-XYZ', newValue: { '@id': 'DE-XYZ', name: 42, created: AT } }))
            .toBe("Change 0: JSON property 'name' is not an object!");

    });

    it('refused also where a later change would make it valid again', () => {

        expect(refusal(update('ChargingPool', 'DE*GEF*P1', 'hotline', 42), update('ChargingPool', 'DE*GEF*P1', 'hotline', '+49 30 1234567')))
            .toBe("Change 0: Invalid hotline phone number '42'!");
        expect(refusal(update('ChargingStationOperator', 'DE*GEF', 'homepage', 'no url'), update('ChargingStationOperator', 'DE*GEF', 'homepage', 'https://gef.example/')))
            .toBe("Change 0: Invalid homepage 'no url'!");
        expect(refusal(update('EMobilityProvider', 'DE-GDF', 'name', 42), update('EMobilityProvider', 'DE-GDF', 'name', { en: 'GDF' })))
            .toBe("Change 0: JSON property 'name' is not an object!");
        expect(refusal(update('RoamingNetwork', 'QA', 'name', 42), update('RoamingNetwork', 'QA', 'name', { en: 'QA' })))
            .toBe('Change 0: invalid name: A multi-language text must be a JSON object!');

    });

    it('refused by the first change making a party invalid, not by what is read first', () => {

        expect(refusal(update('ChargingPool', 'DE*GEF*P2', 'hotline', 42), update('ChargingStationOperator', 'DE*GEF', 'homepage', 'no url')))
            .toBe("Change 0: Invalid hotline phone number '42'!");
        expect(refusal(update('ChargingPool', 'DE*GEF*P1', 'hotline', 42), update('EMobilityProvider', 'DE-GDF', 'name', 42)))
            .toBe("Change 0: Invalid hotline phone number '42'!");
        expect(refusal(update('ChargingPool', 'DE*GEF*P1', 'hotline', '+49 30 1234567'), update('EVSE', 'DE*GEF*E2*1', 'maxPower', 'x')))
            .toBe("Change 1: Invalid value for 'maximum power'!");

    });

});


describe('The roaming network itself and its operator changed as WWCP_POI3 takes them', () => {

    it('the properties of the roaming network itself, in its words', () => {

        expect(refusal(update('RoamingNetwork', 'QA', 'name', 42))).toBe('Change 0: invalid name: A multi-language text must be a JSON object!');
        expect(refusal(update('RoamingNetwork', 'QA', 'description', 42))).toBe('Change 0: invalid description: A multi-language text must be a JSON object!');
        expect(refusal(update('RoamingNetwork', 'QA', 'dataSource', ' '))).toBe('Change 0: the data source must be a nonempty text!');
        expect(refusal(update('RoamingNetwork', 'QA', 'dataSource', 'QA data'))).toBe('taken');
        expect(refusal(update('RoamingNetwork', 'QA', 'dataLicenses', [ 42 ]))).toBe('Change 0: A data license must be a JSON object!');
        expect(refusal(update('RoamingNetwork', 'QA', 'treeHashAlgorithms', [ 'md5' ]))).toBe("Change 0: Unknown tree hash algorithm 'md5': sha256, sha384 or sha512!");
        expect(refusal(update('RoamingNetwork', 'QA', 'customData', 42))).toBe('Change 0: the custom data must be a JSON object!');
        expect(refusal(update('RoamingNetwork', 'QA', 'signingKeys', [])))
            .toBe('Change 0: a roaming network has no keys of its own: they are the keys of its RoamingNetworkOperator!');
        expect(refusal(update('RoamingNetwork', 'QA', 'foo', 1))).toBe("Change 0: the property 'foo' of a roaming network can not be changed!");

        expect(refusal(removeProperty('RoamingNetwork', 'QA', 'dataSource'))).toBe("Change 0: the property 'dataSource' does not exist!");
        expect(refusal(removeProperty('RoamingNetwork', 'QA', 'foo'))).toBe("Change 0: the property 'foo' does not exist!");
        expect(refusal(removeProperty('RoamingNetwork', 'QA', 'name'))).toBe('taken');

        expect(refusal({ kind: 'Add', entityType: 'RoamingNetwork', entityId: 'QA', newValue: { '@id': 'QA' } }))
            .toBe('Change 0: Add of the roaming network itself is not supported yet!');

    });

    it('its operator changed, but neither added nor removed, of this roaming network', () => {

        expect(refusal({ kind: 'Add', entityType: 'RoamingNetworkOperator', entityId: 'OCC', newValue: { '@id': 'OCC' } }))
            .toBe('Change 0: the operator of a roaming network is changed, but neither added nor removed!');
        expect(refusal({ kind: 'Remove', entityType: 'RoamingNetworkOperator', entityId: 'OCC' }))
            .toBe('Change 0: the operator of a roaming network is changed, but neither added nor removed!');
        expect(refusal(update('RoamingNetworkOperator', 'XYZ', 'name', { en: 'x' }))).toBe("Change 0: the roaming network operator 'XYZ' does not exist!");
        expect(refusal(update('RoamingNetworkOperator', 'OCC', 'name', { en: 'x' }, { parentEntityType: 'ChargingStationOperator', parentEntityId: 'DE*GEF' })))
            .toBe("Change 0: a roaming network operator of this roaming network belongs to RoamingNetwork 'QA', not to ChargingStationOperator 'DE*GEF'!");
        expect(refusal(update('RoamingNetworkOperator', 'OCC', 'name', { en: 'x' }, { parentEntityType: 'RoamingNetwork', parentEntityId: 'QA' }))).toBe('taken');
        expect(refusal(update('RoamingNetworkOperator', 'OCC', 'minConsensus', 9)))
            .toBe("Change 0: The given JSON representation of a roaming network operator is invalid: The minConsensus 9 of the roaming network operator 'OCC' needs signing keys of as many holders, not of 3!");

    });

});
