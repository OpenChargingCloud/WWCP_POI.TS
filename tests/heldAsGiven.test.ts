import { describe, expect, it } from 'vitest';

import { rich } from './richNetwork.ts';

import { applyChangeSet } from '../src/history/apply.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification } from '../src/history/changeSet.ts';
import { etagToJSON } from '../src/etags.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';
import type { JSONObject, JSONValue } from '../src/json/value.ts';


// A new value is what the content holds (section 4, "New values"): refused as WWCP_POI3 refuses it (`TryHeldAsGiven`),
// after the party it changed is read again, naming what the content holds, "absent" where it holds none, of the property
// an UpdateProperty changes, of the entity an Add adds, without its lastChange, of the element or the property of an
// element an element change gives. Probed against WWCP_POI 8b0580f on the QA network, word for word.

const AT     = '2026-11-05T10:00:00.000Z';
const C1     = { '@id': '1', format: 'CABLE', type: 'IEC_62196_T2_COMBO' };
const C3     = { '@id': '3', format: 'CABLE', type: 'IEC_62196_T2_COMBO' };

const network         = RoamingNetwork.parse(rich());
const withConnectors  = RoamingNetwork.parse(rich(({ evse }) => { evse['chargingConnectors'] = [ { ...C1 }, { ...C3 } ]; }));

/** Why the given changes are refused, word for word; 'taken' where only their after ETags differ. */
function refusal(before: RoamingNetwork, ...changes: JSONObject[]): string {

    const eTags = before.changeSetETags().map(eTag => etagToJSON(eTag));
    const json: JSONObject = { '@context': CHANGE_SET_CONTEXT, roamingNetworkId: before.id, createdAt: AT, changes, beforeETags: eTags, afterETags: eTags };

    json['@id'] = changeSetIdentification(json);

    try {
        applyChangeSet(before, ChangeSet.parse(json), { checkOwnership: false });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return message.startsWith('The result does not match the change set') ? 'taken' : message;
    }

    return 'taken';

}

const update = (entityType: string, entityId: string, propertyName: string, newValue: JSONValue): JSONObject =>
    ({ kind: 'UpdateProperty', entityType, entityId, propertyName, newValue });

const add = (entityType: string, entityId: string, newValue: JSONObject, more: JSONObject = {}): JSONObject =>
    ({ kind: 'Add', entityType, entityId, newValue, ...more });

const element = (kind: string, elementId: string, more: JSONObject): JSONObject =>
    ({ kind, entityType: 'EVSE', entityId: 'DE*GEF*E1*1', elementPath: [ { propertyName: 'chargingConnectors', elementId } ], ...more });

const TARIFF = { '@id': 'DE*GEF*T_X', currency: 'EUR', elements: [ { priceComponents: [ { price: 1, stepSize: 1, type: 'ENERGY' } ] } ], name: { en: 'X' } };


describe('A new value not given as the content holds it', () => {

    it('names what the content holds of a property', () => {

        const pool = (newValue: JSONValue): string => refusal(network, update('ChargingPool', 'DE*GEF*P1', 'name', newValue));

        expect(pool({ EN: 'x' })).toBe(`Change 0: the property 'name' of the charging pool 'DE*GEF*P1' is not given as the content holds it, '{"en":"x"}'!`);

        // A language by its number, also with a sign, is the language of that number.
        for (const number of [ '7', '+7' ])
            expect(pool({ en: 'x', [number]: 'y' })).toBe(`Change 0: the property 'name' of the charging pool 'DE*GEF*P1' is not given as the content holds it, '{"an":"y","en":"x"}'!`);
        expect(pool({ en: 'x', 0: 'y' })).toBe(`Change 0: the property 'name' of the charging pool 'DE*GEF*P1' is not given as the content holds it, '{"en":"x","unknown":"y"}'!`);

        expect(refusal(network, update('EVSEGroup', 'DE*GEF*EG_AC', 'EVSEIds', [ 'DE*GEF*E4*1', 'DE*GEF*E2*1' ])))
            .toBe(`Change 0: the property 'EVSEIds' of the EVSE group 'DE*GEF*EG_AC' is not given as the content holds it, '["DE*GEF*E2*1","DE*GEF*E4*1"]'!`);
        expect(refusal(network, update('ChargingPool', 'DE*GEF*P1', 'geoLocation', { lat: '50.9', lng: 11 })))
            .toBe(`Change 0: the property 'geoLocation' of the charging pool 'DE*GEF*P1' is not given as the content holds it, '{"lat":50.9,"lng":11}'!`);
        expect(refusal(network, update('ChargingPool', 'DE*GEF*P1', 'geoLocation', { '@context': 'x', lat: 50, lng: 11 })))
            .toBe(`Change 0: the property 'geoLocation' of the charging pool 'DE*GEF*P1' is not given as the content holds it, '{"lat":50,"lng":11}'!`);

        // A value as such: a URL as Hermod writes it, a currency and a hotline trimmed.
        expect(refusal(network, update('ChargingStationOperator', 'DE*GEF', 'homepage', 'www.example.com')))
            .toBe(`Change 0: the property 'homepage' of the charging station operator 'DE*GEF' is not given as the content holds it, '"https://www.example.com"'!`);
        expect(refusal(network, update('ChargingTariff', 'DE*GEF*T_AC', 'currency', ' EUR ')))
            .toBe(`Change 0: the property 'currency' of the charging tariff 'DE*GEF*T_AC' is not given as the content holds it, '"EUR"'!`);
        expect(refusal(network, update('ChargingStation', 'DE*GEF*S1', 'hotline', ' +49 3641 573 1000')))
            .toBe(`Change 0: the property 'hotline' of the charging station 'DE*GEF*S1' is not given as the content holds it, '"+49 3641 573 1000"'!`);

        // Flags in the order of their values, each once (`POIJSON.FlagsToJSON`).
        for (const currentTypes of [ [ 'DC', 'AC_ThreePhases' ], [ 'DC', 'AC_ThreePhases', 'DC' ] ])
            expect(refusal(network, update('EVSE', 'DE*GEF*E1*1', 'currentTypes', currentTypes)))
                .toBe(`Change 0: the property 'currentTypes' of the EVSE 'DE*GEF*E1*1' is not given as the content holds it, '["AC_ThreePhases","DC"]'!`);

        // The roaming network itself and its operator.
        expect(refusal(network, update('RoamingNetwork', 'QA', 'name', { EN: 'QA' })))
            .toBe(`Change 0: the property 'name' of the roaming network 'QA' is not given as the content holds it, '{"en":"QA"}'!`);
        expect(refusal(network, update('RoamingNetworkOperator', 'OCC', 'name', { EN: 'x' })))
            .toBe(`Change 0: the property 'name' of the roaming network operator 'OCC' is not given as the content holds it, '{"en":"x"}'!`);

    });

    it('names a value the content does not hold at all as it is given', () => {

        expect(refusal(network, update('ChargingPool', 'DE*GEF*P1', 'name', {})))
            .toBe("Change 0: the property 'name' of the charging pool 'DE*GEF*P1' is given as '{}', which the content does not hold at all!");
        expect(refusal(network, update('ChargingPool', 'DE*GEF*P1', 'dataLicenses', [])))
            .toBe("Change 0: the property 'dataLicenses' of the charging pool 'DE*GEF*P1' is given as '[]', which the content does not hold at all!");
        expect(refusal(network, update('RoamingNetwork', 'QA', 'dataLicenses', [])))
            .toBe("Change 0: the property 'dataLicenses' of the roaming network 'QA' is given as '[]', which the content does not hold at all!");
        expect(refusal(withConnectors, element('UpdateElementProperty', '3', { propertyName: 'colour', newValue: 'red' })))
            .toBe(`Change 0: 'chargingConnectors['3'].colour' of the EVSE 'DE*GEF*E1*1' is given as '"red"', which the content does not hold at all!`);

    });

    it('names what the content holds of an entity to add, and of an element', () => {

        expect(refusal(network, add('ChargingTariff', 'DE*GEF*T_X', { ...TARIFF, created: '2026-10-25T18:25:00+02:00' })))
            .toBe(`Change 0: the charging tariff 'DE*GEF*T_X' to add is not given as the content holds it, '{"@id":"DE*GEF*T_X","created":"2026-10-25T16:25:00.000Z","currency":"EUR","elements":[{"priceComponents":[{"price":1,"stepSize":1,"type":"ENERGY"}]}],"name":{"en":"X"}}'!`);
        expect(refusal(network, add('ChargingTariff', 'DE*GEF*T_X', { ...TARIFF, '@context': 'https://open.charging.cloud/contexts/wwcp/roamingNetwork/chargingTariff/v1' })))
            .toBe(`Change 0: the charging tariff 'DE*GEF*T_X' to add is not given as the content holds it, '{"@id":"DE*GEF*T_X","currency":"EUR","elements":[{"priceComponents":[{"price":1,"stepSize":1,"type":"ENERGY"}]}],"name":{"en":"X"}}'!`);
        expect(refusal(network, add('GridConnectionPoint', 'gcp-2', { '@id': 'gcp-2', name: { EN: 'Two' } }, { parentEntityType: 'GridOperator', parentEntityId: 'DE*NET' })))
            .toBe(`Change 0: the grid connection point 'gcp-2' to add is not given as the content holds it, '{"@id":"gcp-2","name":{"en":"Two"}}'!`);

        // Its identification as its type writes it, with the rest as the content holds it.
        expect(refusal(network, add('EVSEGroup', 'DEGEFEG9', { '@id': 'DEGEFEG9', name: { en: 'G' }, EVSEIds: [ 'DE*GEF*E4*1', 'DE*GEF*E2*1' ] })))
            .toBe(`Change 0: the EVSE group 'DEGEFEG9' to add is not given as the content holds it, '{"@id":"DE*GEF*EG9","EVSEIds":["DE*GEF*E2*1","DE*GEF*E4*1"],"name":{"en":"G"}}'!`);

        expect(refusal(withConnectors, element('ReplaceElement', '1', { newValue: { '@id': '1', format: 'SOCKET', type: 'IEC_62196_T2_COMBO', foo: 1 } })))
            .toBe(`Change 0: 'chargingConnectors['1']' of the EVSE 'DE*GEF*E1*1' is not given as the content holds it, '{"@id":"1","format":"SOCKET","type":"IEC_62196_T2_COMBO"}'!`);

    });

    it('after the party it changed is read again, and before the next change', () => {

        expect(refusal(network, add('EVSEGroup', 'DEGEFEG9', { '@id': 'DEGEFEG9', name: 42, EVSEIds: [ 'DE*GEF*E2*1' ] })))
            .toBe("Change 0: JSON property 'name' is not an object!");
        expect(refusal(network, add('ChargingTariff', 'de*gef*T_X', { ...TARIFF, '@id': 'de*gef*T_X', currency: 'xx' })))
            .toBe("Change 0: The currency of the charging tariff 'DE*GEF*T_X' must be an ISO 4217 code, not 'xx'!");
        expect(refusal(withConnectors, element('AddElement', '2', { newValue: { '@id': '2', format: 'BAG', type: 'IEC_62196_T2_COMBO', '@context': 'x' } })))
            .toBe("Change 0: The JSON-LD context of the charging connector '2' must be 'https://open.charging.cloud/contexts/wwcp/roamingNetwork/chargingConnector/v1'!");

        expect(refusal(network, update('ChargingPool', 'DE*GEF*P1', 'name', { EN: 'x' }), update('ChargingPool', 'DE*GEF*P1', 'hotline', 42)))
            .toBe(`Change 0: the property 'name' of the charging pool 'DE*GEF*P1' is not given as the content holds it, '{"en":"x"}'!`);

    });

});
