import { describe, expect, it } from 'vitest';

import { rich } from './richNetwork.ts';

import { applyChangeSet } from '../src/history/apply.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification } from '../src/history/changeSet.ts';
import { etagToJSON } from '../src/etags.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';
import type { JSONObject, JSONValue } from '../src/json/value.ts';


// A change whose old value is no longer there is refused naming the value it found, as WWCP_POI3 names it
// (POIJSON.ContentText): its canonical JSON, "absent" for none. A property of the roaming network itself is named as the
// property of no entity; a change of a complete entity names only whether it exists. Probed against WWCP_POI 8b0580f on
// the QA network, word for word.

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

const update = (entityType: string, entityId: string, propertyName: string, newValue: JSONValue, oldValue: JSONValue, more: JSONObject = {}): JSONObject =>
    ({ kind: 'UpdateProperty', entityType, entityId, propertyName, newValue, oldValue, ...more });

const removeProperty = (entityType: string, entityId: string, propertyName: string, oldValue: JSONValue): JSONObject =>
    ({ kind: 'RemoveProperty', entityType, entityId, propertyName, oldValue });

const NOT_IT = { en: 'not it' };


describe('An old value no longer there', () => {

    it('names the value found as its canonical JSON, of every kind of entity', () => {

        expect(refusal(update('ChargingStationOperator', 'DE*GEF', 'name', { en: 'x' }, NOT_IT)))
            .toBe(`Change 0: the property 'name' of the charging station operator 'DE*GEF' is no longer the expected old value, but '{"en":"GraphDefined Charging Solutions"}'!`);
        expect(refusal(update('ChargingPool', 'DE*GEF*P1', 'geoLocation', { lat: 50, lng: 11 }, { lat: 1, lng: 2 })))
            .toBe(`Change 0: the property 'geoLocation' of the charging pool 'DE*GEF*P1' is no longer the expected old value, but '{"lat":50.9271,"lng":11.5892}'!`);
        expect(refusal(update('ChargingStation', 'DE*GEF*S1', 'templateIds', [ 'DE*GEF*ST_AC' ], [ 'x' ])))
            .toBe(`Change 0: the property 'templateIds' of the charging station 'DE*GEF*S1' is no longer the expected old value, but '["DE*GEF*ST_DC"]'!`);
        expect(refusal(update('EVSE', 'DE*GEF*E1*1', 'maxPower', 50000, 1)))
            .toBe("Change 0: the property 'maxPower' of the EVSE 'DE*GEF*E1*1' is no longer the expected old value, but '150000'!");
        expect(refusal(update('ChargingTariff', 'DE*GEF*T_AC', 'elements', [], [])))
            .toBe(`Change 0: the property 'elements' of the charging tariff 'DE*GEF*T_AC' is no longer the expected old value, but '[{"priceComponents":[{"price":0.52,"stepSize":1,"type":"ENERGY"}]}]'!`);
        expect(refusal(update('ChargingTariff', 'DE*GEF*T_AC', 'currency', 'USD', 'CHF')))
            .toBe(`Change 0: the property 'currency' of the charging tariff 'DE*GEF*T_AC' is no longer the expected old value, but '"EUR"'!`);
        expect(refusal(update('ChargingStationModel', 'GD-AC44', 'maxPower', 22000, 1, { parentEntityType: 'ChargingStationManufacturer', parentEntityId: 'GraphDefined' })))
            .toBe("Change 0: the property 'maxPower' of the charging station model 'GD-AC44' is no longer the expected old value, but '44000'!");
        expect(refusal(update('GridConnectionPoint', 'gcp-1', 'energyMeter', { '@id': 'gcp-meter-1' }, { '@id': 'x' })))
            .toBe(`Change 0: the property 'energyMeter' of the grid connection point 'gcp-1' is no longer the expected old value, but '{"@id":"gcp-meter-1","created":"2026-11-05T19:43:46.188Z","lastChange":"2026-11-05T19:43:46.188Z"}'!`);
        expect(refusal(update('ConformityAssessmentBody', 'BSI', 'name', { en: 'x' }, NOT_IT)))
            .toBe(`Change 0: the property 'name' of the conformity assessment body 'BSI' is no longer the expected old value, but '{"de":"Bundesamt für Sicherheit in der Informationstechnik"}'!`);
        expect(refusal(update('RoamingNetworkOperator', 'OCC', 'name', { en: 'x' }, NOT_IT)))
            .toBe(`Change 0: the property 'name' of the roaming network operator 'OCC' is no longer the expected old value, but '{"en":"Open Charging Cloud"}'!`);

    });

    it('names a property not there "absent", and one expected absent as it is', () => {

        expect(refusal(update('ChargingStationOperator', 'DE*GEF', 'hotline', '+49 1', '+49 2')))
            .toBe("Change 0: the property 'hotline' of the charging station operator 'DE*GEF' is no longer the expected old value, but 'absent'!");
        expect(refusal(removeProperty('ChargingStationOperator', 'DE*GEF', 'hotline', '+49 2')))
            .toBe("Change 0: the property 'hotline' of the charging station operator 'DE*GEF' is no longer the expected old value, but 'absent'!");
        expect(refusal(update('ParkingSpace', 'gef-space-1', 'name', { en: 'x' }, NOT_IT)))
            .toBe("Change 0: the property 'name' of the parking space 'gef-space-1' is no longer the expected old value, but 'absent'!");
        expect(refusal(update('ChargingStationOperator', 'DE*GEF', 'name', { en: 'x' }, null)))
            .toBe(`Change 0: the property 'name' of the charging station operator 'DE*GEF' is no longer the expected old value, but '{"en":"GraphDefined Charging Solutions"}'!`);

    });

    it('names a property of the roaming network itself as the property of no entity', () => {

        expect(refusal(update('RoamingNetwork', 'QA', 'name', { en: 'x' }, NOT_IT)))
            .toBe(`Change 0: the property 'name' is no longer the expected old value, but '{"en":"Quality Assurance"}'!`);
        expect(refusal(removeProperty('RoamingNetwork', 'QA', 'description', NOT_IT)))
            .toBe(`Change 0: the property 'description' is no longer the expected old value, but '{"en":"The roaming network of the examples"}'!`);
        expect(refusal(update('RoamingNetwork', 'QA', 'dataLicenses', [ 'CC-BY-4.0' ], [ 'ODbL-1.0' ])))
            .toBe("Change 0: the property 'dataLicenses' is no longer the expected old value, but 'absent'!");
        expect(refusal(update('RoamingNetwork', 'QA', 'foo', 1, 2)))
            .toBe("Change 0: the property 'foo' is no longer the expected old value, but 'absent'!");

    });

    it('names of a complete entity only whether it exists, and the change it is in', () => {

        expect(refusal({ kind: 'Remove', entityType: 'ChargingPool', entityId: 'DE*GEF*P1', oldValue: { '@id': 'DE*GEF*P1' } }))
            .toBe("Change 0: the charging pool 'DE*GEF*P1' is no longer the expected old value!");

        expect(refusal(update('ChargingPool', 'DE*GEF*P1', 'hotline', '+49 3641 573 1000', null),
                       update('ChargingPool', 'DE*GEF*P1', 'hotline', '+49 3641 573 2000', '+49 3641 573 3000')))
            .toBe(`Change 1: the property 'hotline' of the charging pool 'DE*GEF*P1' is no longer the expected old value, but '"+49 3641 573 1000"'!`);
        expect(refusal(update('ChargingPool', 'DE*GEF*P1', 'hotline', '+49 3641 573 1000', null),
                       update('ChargingPool', 'DE*GEF*P1', 'hotline', '+49 3641 573 2000', '+49 3641 573 1000')))
            .toBe('taken');

    });

});
