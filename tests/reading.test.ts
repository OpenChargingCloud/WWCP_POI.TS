import { describe, expect, it } from 'vitest';

import { defined } from './helpers.ts';
import { firstOf, qa, refusal, rich } from './richNetwork.ts';

import { Decimal } from '../src/json/decimal.ts';
import type { JSONObject } from '../src/json/value.ts';


// What WWCP_POI3 refuses of a roaming network as it reads it (`reading.ts`), in its words, as WWCP_POI3 at 89d2e02 refused
// these versions: wrong JSON types, missing mandatory properties, the values of properties, identifications, names of
// enumerations, currencies, URLs and timestamps, and what the constructor of each entity refuses of what it read.

const byId = (list: unknown, id: string): JSONObject =>
    defined((list as JSONObject[]).find(item => item['@id'] === id), id);


describe('Reading', () => {

    it('takes QA and QA with an entity of every kind, as WWCP_POI3 does', () => {
        expect(refusal(qa())).toBe('taken');
        expect(refusal(rich())).toBe('taken');
    });

    it('of the roaming network and its operator: texts in languages, timestamps, data licenses, keys', () => {

        expect(refusal(qa(({ network }) => { network['name'] = 5; }))).toBe("JSON property 'name' is not an object!");
        expect(refusal(qa(({ network }) => { delete network['created']; }))).toBe("The creation timestamp 'created' of 'QA' is missing!");
        expect(refusal(qa(({ network }) => { network['created'] = 5; }))).toBe("Invalid creation timestamp '5'!");
        expect(refusal(qa(({ network }) => { network['dataLicenseIds'] = [ 'XYZ' ]; }))).toBe("The data license 'XYZ' is not well-known, so it must be given completely!");
        expect(refusal(qa(({ network }) => { network['signingKeys'] = null; }))).toBe("A roaming network has no keys of its own: they are the keys of its operator, 'operator'!");

        expect(refusal(qa(({ network }) => { (network['operator'] as JSONObject)['name'] = 5; }))).toBe("JSON property 'name' is not an object!");
        expect(refusal(qa(({ network }) => { delete (network['operator'] as JSONObject)['created']; }))).toBe("The creation timestamp 'created' of 'OCC' is missing!");
        expect(refusal(qa(({ network }) => { (network['operator'] as JSONObject)['homepage'] = 'https://x_y.org'; }))).toBe("Invalid homepage 'https://x_y.org'!");

        // Data licenses are the same without case (Hermod f7b00ef2), given completely or by their identifications.
        const own = (id: string): JSONObject => ({ '@id': id, description: { en: 'Our own license' } });
        expect(refusal(qa(({ gef }) => { gef['dataLicenses'] = [ own('OWN-1.0'), own('own-1.0') ]; }))).toBe("The data license 'own-1.0' must not be given twice!");
        expect(refusal(qa(({ gef }) => { gef['dataLicenseIds'] = [ 'CC BY 4.0', 'cc by 4.0' ]; }))).toBe("The data license 'cc by 4.0' must not be given twice!");

        // The key statement of the operator, as its constructor refuses it: an identity key given twice before their
        // order, a signature by one identity key twice after its validity.
        const statement = (network: JSONObject): JSONObject => (network['operator'] as JSONObject)['keyStatement'] as JSONObject;
        const twice = (json: JSONObject, property: string): void => { json[property] = [ ...json[property] as JSONObject[], firstOf(json, property) ]; };
        expect(refusal(qa(({ network }) => { twice(statement(network), 'identityKeys'); twice(statement(network), 'signatures'); })))
            .toBe('Invalid key statement: An identity key of a key statement must not be given twice!');
        expect(refusal(qa(({ network }) => { twice(statement(network), 'signatures'); })))
            .toBe("Invalid key statement: An identity key signs a key statement once. (Parameter 'Signatures')");
        expect(refusal(qa(({ network }) => { const json = statement(network); [ json['signedAt'], json['validUntil'] ] = [ json['validUntil'] as string, json['signedAt'] as string ]; twice(json, 'signatures'); })))
            .toBe("Invalid key statement: A key statement is not valid until before it was signed. (Parameter 'ValidUntil')");

    });

    it('of the charging station operator, its charging pools, stations, EVSEs, connectors and energy meters', () => {

        expect(refusal(qa(({ gef }) => { gef['chargingPools'] = 'x'; }))).toBe('The charging pools must be a JSON array!');
        expect(refusal(qa(({ gef }) => { gef['logos'] = [ {} ]; }))).toBe('A logo requires an URI!');
        expect(refusal(qa(({ pool }) => { pool['geoLocation'] = 'x'; }))).toBe('The geo location must be a JSON object!');
        expect(refusal(qa(({ pool }) => { (pool['geoLocation'] as JSONObject)['lat'] = 'x'; }))).toBe("Invalid geo location: The input string 'x' was not in a correct format.");
        expect(refusal(qa(({ pool }) => { (pool['geoLocation'] as JSONObject)['lat'] = 91; }))).toBe("Invalid geo location: Invalid 'latitude' value!");
        expect(refusal(qa(({ pool }) => { pool['address'] = { postalCode: '07745', city: { en: 'Jena' }, country: 'DE' }; }))).toBe("Invalid address: Missing property 'street'!");
        expect(refusal(qa(({ pool }) => { pool['openingTimes'] = { regularOpenings: [ { monday: [ { begin: '20:00', end: '08:00' } ] } ] }; })))
            .toBe("Invalid opening times: The end period '08:00h' must be after the start period '20:00h'! (Parameter 'PeriodEnd')");
        expect(refusal(qa(({ pool }) => { pool['images'] = [ { url: 'https://example.org/p.png', category: 'photo' } ]; })))
            .toBe(`Invalid images '{"url":"https://example.org/p.png","category":"photo"}': Missing JSON property 'type'!`);
        expect(refusal(qa(({ pool }) => { pool['authenticationModes'] = [ { type: ' RFID' } ]; })))
            .toBe(`Invalid authentication mode '{"type":" RFID"}': Invalid authentication mode: The type of an authentication mode must be a text without surrounding whitespace! (Parameter 'Type')`);
        expect(refusal(qa(({ pool }) => { pool['energyMix'] = { energySources: [ [ 'Wind', '160 %' ] ], environmentalImpacts: [], supplierName: { en: 'S' }, productName: { en: 'P' } }; })))
            .toBe('Invalid energy mix: energySources[0][1]: expected a percentage between 0 and 100!');

        expect(refusal(qa(({ station }) => { station['EVSEs'] = 'x'; }))).toBe('The EVSEs must be a JSON array!');
        expect(refusal(qa(({ station, evse }) => { station['maxPower'] = 999999; for (const item of station['EVSEs'] as JSONObject[]) item['maxPower'] = 1; evse['maxPower'] = 1; })))
            .toBe("The given JSON representation of a charging station is invalid: The maximum power of the charging station 'DE*GEF*S1', 999999 W, must not exceed the 2 W of all its EVSEs together! (Parameter 'MaxPower')");
        expect(refusal(qa(({ station }) => { station['maxPower'] = Decimal.parse('22000.50'); for (const item of station['EVSEs'] as JSONObject[]) item['maxPower'] = Decimal.parse('1000.250'); })))
            .toBe("The given JSON representation of a charging station is invalid: The maximum power of the charging station 'DE*GEF*S1', 22000.5 W, must not exceed the 2000.5 W of all its EVSEs together! (Parameter 'MaxPower')");

        // Spoken with their articles: "An" before A, E, I and O, "A" before any other letter.
        expect(refusal(qa(({ station }) => { station['euVehicleCategories'] = [ 'M1', 'M1' ]; })))
            .toBe("The given JSON representation of a charging station is invalid: An EU vehicle category of the charging station 'DE*GEF*S1' must not be given twice!");
        expect(refusal(qa(({ station, evse }) => { const key = firstOf(evse['energyMeter'] as JSONObject, 'publicKeys'); station['publicKeys'] = [ key, key ]; })))
            .toBe("The given JSON representation of a charging station is invalid: A public key of the charging station 'DE*GEF*S1' must not be given twice!");
        expect(refusal(qa(({ evse }) => { evse['acceptedEMobilityProviderIds'] = [ 'DE-ABC', 'DE-ABC' ]; })))
            .toBe("The given JSON representation of an EVSE is invalid: An accepted e-mobility provider of the EVSE 'DE*GEF*E1*1' must not be given twice!");
        expect(refusal(qa(({ evse }) => { evse['maxPower'] = 'x'; }))).toBe("Invalid value for 'maximum power'!");
        expect(refusal(qa(({ evse }) => { evse['currentTypes'] = [ 'dc' ]; }))).toBe("Invalid current type 'dc'!");
        expect(refusal(qa(({ evse }) => { evse['energyMeter'] = 'x'; }))).toBe('The energy meter must be a JSON object!');

        const key = (parts: { evse: JSONObject }): JSONObject => firstOf(parts.evse['energyMeter'] as JSONObject, 'publicKeys');
        expect(refusal(qa(parts => { delete key(parts)['key']; }))).toMatch(/^Invalid public key '\{"@id":"[0-9a-f]{64}"\}': A measurement public key needs its identification and its key!$/u);
        expect(refusal(qa(parts => { key(parts)['@id'] = (key(parts)['@id'] as string).toUpperCase(); }))).toMatch(/: The identification '[0-9A-F]{64}' of a measurement public key is not the SHA-256 '[0-9a-f]{64}' of its key!$/u);

        expect(refusal(qa(({ gef }) => { firstOf(firstOf(gef, 'EVSETemplates'), 'chargingConnectors')['format'] = 'socket'; }))).toBe("Invalid charging connector format 'socket'!");
        expect(refusal(rich(({ gef }) => { Object.assign(firstOf(firstOf(gef, 'EVSETemplates'), 'chargingConnectors'), { format: 'SOCKET', cableLength: 2 }); })))
            .toBe("The charging connector '1' is a socket: it has no cable of its own!");
        expect(refusal(qa(({ gef }) => { firstOf(gef, 'energyMeterTemplates')['role'] = 5; }))).toBe("Invalid energy meter role '5'!");
        expect(refusal(qa(({ gef }) => { firstOf(defined((gef['energyMeterTemplates'] as JSONObject[]).find(template => template['transparencySoftwareStatus'] !== undefined)), 'transparencySoftwareStatus')['legalStatus'] = 5; })))
            .toBe(`Invalid transparency software status '{"transparencySoftwareId":"GraphDefined:chargy-1.5.0","legalStatus":5}': Invalid legal status '5'!`);

    });

    it('of identifications, as their types read them', () => {

        expect(refusal(qa(({ gef }) => { firstOf(gef, 'chargingTariffs')['@id'] = 'de*gef*t_ac'; }))).toBe("Invalid 'charging tariff identification'!");
        expect(refusal(qa(({ pool }) => { delete pool['@id']; }))).toBe("Missing JSON property '@id'!");
        expect(refusal(qa(({ gef }) => { firstOf(gef, 'EVSEGroups')['EVSEIds'] = [ 'de*gef*e2*1' ]; }))).toBe("Invalid member identification 'de*gef*e2*1'!");
        expect(refusal(qa(({ station }) => { station['templateIds'] = [ 'de*gef*st_dc' ]; }))).toBe("Invalid template identification 'de*gef*st_dc'!");
        expect(refusal(rich(({ network }) => { firstOf(network, 'eMobilityProviders')['@id'] = 'DE-GDFX'; }))).toBe("Invalid 'e-mobility provider identification'!");

    });

    it('of charging tariffs, their elements, templates, groups and offers', () => {

        const tariff = (gef: JSONObject): JSONObject => firstOf(gef, 'chargingTariffs');
        const component = (gef: JSONObject): JSONObject => firstOf(firstOf(tariff(gef), 'elements'), 'priceComponents');

        expect(refusal(qa(({ gef }) => { tariff(gef)['currency'] = 'eur'; }))).toBe("The currency of the charging tariff 'DE*GEF*T_AC' must be an ISO 4217 code, not 'eur'!");
        expect(refusal(qa(({ gef }) => { delete component(gef)['type']; }))).toBe('A price component needs its type!');
        expect(refusal(qa(({ gef }) => { delete component(gef)['price']; }))).toBe("Missing JSON property 'price'!");
        expect(refusal(qa(({ gef }) => { component(gef)['stepSize'] = 'x'; }))).toBe("Invalid value for 'step size'!");
        expect(refusal(qa(({ gef }) => { component(gef)['vat'] = 120; }))).toBe('The VAT of an ENERGY price component must be between 0 and 100 percent!');
        expect(refusal(qa(({ gef }) => { delete component(gef)['stepSize']; }))).toBe('An ENERGY price component needs a positive step size!');
        expect(refusal(qa(({ gef }) => { firstOf(tariff(gef), 'elements')['restrictions'] = { startTime: '9:00' }; }))).toBe("Invalid startTime '9:00', expected HH:mm!");
        expect(refusal(qa(({ gef }) => { firstOf(tariff(gef), 'elements')['restrictions'] = { minPower: 50, maxPower: 10 }; })))
            .toBe('Invalid charging tariff restrictions: The minimum power of a charging tariff restriction must not exceed its maximum!');

        const offer = (gef: JSONObject): JSONObject => firstOf(gef, 'chargingTariffOffers');
        expect(refusal(rich(({ gef }) => { delete offer(gef)['discount']; })))
            .toBe("The given JSON representation of a charging tariff offer is invalid: The charging tariff offer 'offer-1' must have exactly one of a price of its own and a discount! (Parameter 'ChargingTariff')");
        expect(refusal(rich(({ gef }) => { delete offer(gef)['discount']; offer(gef)['chargingTariff'] = { elements: [ { priceComponents: [ { type: 'FLAT', price: 1 } ] } ] }; })))
            .toBe("The currency of the price of the charging tariff offer 'offer-1' must be an ISO 4217 code!");
        expect(refusal(rich(({ gef }) => { offer(gef)['discount'] = { percent: 10, dimensions: [] }; })))
            .toBe('The dimensions of a discount must not be empty: without them, it reduces all of them!');

    });

    it('of the parties: manufacturers and their models, releases, e-mobility providers, grid and parking operators', () => {

        const model = (network: JSONObject): JSONObject => firstOf(firstOf(network, 'chargingStationManufacturers'), 'chargingStationModels');

        expect(refusal(qa(({ network }) => { firstOf(network, 'chargingStationManufacturers')['homepage'] = 5; }))).toBe("Invalid homepage '5'!");
        expect(refusal(qa(({ network }) => { model(network)['numberOfEVSEs'] = Decimal.parse('4.0'); }))).toBe('The number of EVSEs must be an integer!');
        expect(refusal(qa(({ network }) => { model(network)['numberOfEVSEs'] = 0; })))
            .toBe("The given JSON representation of a charging station model is invalid: The number of EVSEs of the charging station model 'GD-AC44' must be at least one! (Parameter 'NumberOfEVSEs')");
        expect(refusal(qa(({ network }) => { firstOf(firstOf(network, 'energyMeterManufacturers'), 'energyMeterModels')['accuracyClass'] = ' 0.5S'; })))
            .toBe("The given JSON representation of an energy meter model is invalid: The accuracy class of the energy meter model 'KDM-500' must not be empty nor begin or end with whitespace! (Parameter 'AccuracyClass')");

        const manufacturer = (network: JSONObject): JSONObject => firstOf(network, 'transparencySoftwareManufacturers');
        expect(refusal(qa(({ network }) => { manufacturer(network)['craRole'] = 'MANUFACTURER'; })))
            .toBe("The role 'MANUFACTURER' under the Cyber Resilience Act must be one of manufacturer, openSourceSoftwareSteward!");
        expect(refusal(qa(({ network }) => { delete firstOf(manufacturer(network), 'transparencySoftware')['name']; }))).toBe('TransparencySoftware: name: expected a multi-language object.');
        expect(refusal(qa(({ network }) => { firstOf(manufacturer(network), 'transparencySoftware')['sourceCodeRepository'] = 'github.com/x'; })))
            .toBe('TransparencySoftware: sourceCodeRepository: expected an absolute URL.');

        expect(refusal(rich(({ network }) => { firstOf(firstOf(network, 'eMobilityProviders'), 'EVSEGroups')['@id'] = 'DE*XYZ*EG_FAV'; })))
            .toBe("The given JSON representation of an e-mobility provider is invalid: The group 'DE*XYZ*EG_FAV' does not belong to the e-mobility provider 'DE-GDF'! (Parameter 'EVSEGroups')");
        expect(refusal(rich(({ network }) => { firstOf(firstOf(network, 'gridOperators'), 'gridConnectionPoints')['maintainedBy'] = { entityType: 'GridOperator', entityId: 'DE*NET' }; })))
            .toBe("The given JSON representation of a grid connection point is invalid: Besides its grid operator, the grid connection point 'gcp-1' can only be maintained by a charging station operator or a parking operator, not by the GridOperator 'DE*NET'!");
        expect(refusal(rich(({ network }) => { firstOf(firstOf(network, 'gridOperators'), 'energyMeterGroups')['energyMeterIds'] = [ 'nope' ]; })))
            .toBe("The given JSON representation of a grid operator is invalid: The member 'nope' of the group 'net-meters' is unknown at the grid operator 'DE*NET'! (Parameter 'EnergyMeterGroups')");
        expect(refusal(rich(({ network }) => { firstOf(firstOf(network, 'parkingOperators'), 'parkingGarages')['parkingProductIds'] = [ 'p1' ]; })))
            .toBe("The given JSON representation of a parking operator is invalid: The parking product 'p1' of the parking garage 'garage-1' is unknown at the parking operator 'DE*PRK'! (Parameter 'ParkingProducts')");
        expect(refusal(rich(({ network }) => { firstOf(firstOf(network, 'parkingOperators'), 'parkingSpaces')['length'] = 0; })))
            .toBe("The given JSON representation of a parking space is invalid: The length of the parking space 'space-1' must be positive! (Parameter 'Length')");
        expect(refusal(rich(({ gef }) => { delete firstOf(gef, 'brands')['name']; }))).toBe("The brand 'GEF-Brand' needs its name!");

        // A parking product compares with case, so that two of them differ in case alone.
        expect(refusal(rich(({ network }) => { (firstOf(network, 'parkingOperators')['parkingProducts'] as JSONObject[]).push({ '@id': 'p1' }); }))).toBe('taken');

    });

    it('of the constructor of a charging station operator: members, templates, tariffs, groups, offers', () => {

        expect(refusal(qa(({ gef }) => { delete gef['chargingTariffs']; })))
            .toBe("The given JSON representation of a charging station operator is invalid: The charging tariff 'DE*GEF*T_AC' of the template 'DE*GEF*ET_AC' is unknown at the operator 'DE*GEF'! (Parameter 'EVSETemplates')");
        expect(refusal(qa(({ gef }) => { delete gef['EVSETemplates']; })))
            .toBe("The given JSON representation of a charging station operator is invalid: The template 'DE*GEF*ET_DC' of the EVSE 'DE*GEF*E1*1' is unknown at the operator 'DE*GEF'! (Parameter 'EVSETemplates')");
        expect(refusal(qa(({ gef }) => { delete gef['chargingPools']; })))
            .toBe("The given JSON representation of a charging station operator is invalid: The member 'DE*GEF*E2*1' of the group 'DE*GEF*EG_AC' is unknown at the operator 'DE*GEF'! (Parameter 'ChargingTariffOffers')");
        expect(refusal(qa(({ gef }) => { delete firstOf(gef, 'chargingTariffs')['currency']; })))
            .toBe("The given JSON representation of a charging station operator is invalid: The charging tariff 'DE*GEF*T_AC' has no currency, neither of its own nor of its templates!");
        expect(refusal(rich(({ gef }) => { Object.assign(firstOf(gef, 'chargingTariffs'), { templateIds: [ 'DE*GEF*TT_BASE' ], minPrice: { excludingVAT: 5 } }); firstOf(gef, 'chargingTariffTemplates')['maxPrice'] = { excludingVAT: 2 }; })))
            .toBe("The given JSON representation of a charging station operator is invalid: The charging tariff 'DE*GEF*T_AC' with the properties of its templates 'DE*GEF*TT_BASE' is invalid: The minimum price of the charging tariff 'DE*GEF*T_AC' must not exceed its maximum price! (Parameter 'MinPrice')");
        expect(refusal(rich(({ gef }) => { firstOf(gef, 'chargingTariffOffers')['EVSEGroupIds'] = [ 'DE*GEF*EG_NONE' ]; })))
            .toBe("The given JSON representation of a charging station operator is invalid: The EVSE group 'DE*GEF*EG_NONE' of the charging tariff offer 'offer-1' is unknown at the operator 'DE*GEF'! (Parameter 'ChargingTariffOffers')");
        expect(refusal(rich(({ gef }) => { firstOf(gef, 'chargingPoolGroups')['@id'] = 'DE*XYZ*PG_ALL'; })))
            .toBe("The given JSON representation of a charging station operator is invalid: The group 'DE*XYZ*PG_ALL' does not belong to the operator 'DE*GEF'! (Parameter 'ChargingPoolGroups')");
        expect(refusal(rich(({ gef }) => { firstOf(gef, 'parkingSpaces')['parkingGarageId'] = 'garage-1'; })))
            .toBe("The given JSON representation of a charging station operator is invalid: The parking space 'gef-space-1' of the operator 'DE*GEF' can be in no parking garage, and have no parking sensors or parking products: only those of a parking operator can! (Parameter 'ParkingSpaces')");
        expect(refusal(qa(({ gef }) => { (gef['chargingTariffs'] as JSONObject[]).push({ ...byId(gef['chargingTariffs'], 'DE*GEF*T_AC'), '@id': 'DE*GEF*T_A*C' }); })))
            .toBe("The given JSON representation of a charging station operator is invalid: The charging tariff 'DE*GEF*T_A*C' of the operator 'DE*GEF' must not be given twice! (Parameter 'Children')");

        // A charging station, EVSE or energy meter once in all its charging pools: proofs name them by their identifications.
        const p2 = (gef: JSONObject): JSONObject => byId(gef['chargingPools'], 'DE*GEF*P2');
        const s3 = (gef: JSONObject): JSONObject => byId(p2(gef)['chargingStations'], 'DE*GEF*S3');
        expect(refusal(qa(({ gef, station }) => { p2(gef)['chargingStations'] = [ station, ...p2(gef)['chargingStations'] as JSONObject[] ]; })))
            .toBe("The given JSON representation of a charging station operator is invalid: The charging station 'DE*GEF*S1' of the operator 'DE*GEF' must not be given twice! (Parameter 'ChargingPools')");
        expect(refusal(qa(({ gef, evse }) => { s3(gef)['EVSEs'] = [ evse, ...s3(gef)['EVSEs'] as JSONObject[] ]; })))
            .toBe("The given JSON representation of a charging station operator is invalid: The EVSE 'DE*GEF*E1*1' of the operator 'DE*GEF' must not be given twice! (Parameter 'ChargingPools')");
        expect(refusal(qa(({ gef, evse }) => { s3(gef)['energyMeters'] = [ { ...evse['energyMeter'] as JSONObject, '@id': 'de*gef*m1*1' } ]; })))
            .toBe("The given JSON representation of a charging station operator is invalid: The energy meter 'de*gef*m1*1' of the operator 'DE*GEF' must not be given twice! (Parameter 'ChargingPools')");

    });

});
