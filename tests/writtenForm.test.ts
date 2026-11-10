import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defined, readJSON, readText, VECTORS } from './helpers.ts';
import { firstOf, rich } from './richNetwork.ts';

import { isArray, isObject, without, type JSONObject, type JSONValue } from '../src/json/value.ts';
import { parseJSON } from '../src/json/parse.ts';
import { PUBLIC_KEY_CONTEXT } from '../src/keys.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';
import { notWrittenAsHeld } from '../src/network/writtenForm.ts';


// The content as WWCP_POI writes it (SPECIFICATION.md 2, Written forms): what WWCP_POI3 takes of a version and writes
// otherwise, which written again would be another text than the one hashed, is refused (Achim's decision of 2026-10-29, as
// D13 decided it for keys). Every version WWCP_POI3 wrote in the frozen run is written so; QA, its eTags left out, changed
// here as WWCP_POI3 at 8108522 takes it and writes it otherwise.

function qa(change: (network: JSONObject, gef: JSONObject, pool: (id: string) => JSONObject) => void): JSONObject {
    const json  = without(readJSON('published/QA.json') as JSONObject, 'eTags');
    const gef   = defined((json['chargingStationOperators'] as JSONObject[]).find(operator => operator['@id'] === 'DE*GEF'));
    change(json, gef, id => defined((gef['chargingPools'] as JSONObject[]).find(pool => pool['@id'] === id)));
    return json;
}

const body = (network: JSONObject, id: string): JSONObject =>
    defined((network['conformityAssessmentBodies'] as JSONObject[]).find(item => item['@id'] === id));

const refusal = (json: JSONObject): string => {
    try {
        RoamingNetwork.parse(json);
    }
    catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
    return 'taken';
};

const notWritten = (path: string, reason: string): string =>
    `'${path}' is not written as the content holds it: ${reason}!`;

/** Every content of the frozen run: of a version, a snapshot, an archive, as WWCP_POI3 wrote them. */
function contentsOfTheRun(): JSONObject[] {

    const contents: JSONObject[] = [];

    const collect = (value: JSONValue): void => {
        if (isArray(value))
            value.forEach(collect);
        else if (isObject(value)) {
            if (isArray(value['chargingStationOperators']) && typeof value['@context'] === 'string')
                contents.push(without(value, 'eTags'));
            else
                Object.values(value).forEach(collect);
        }
    };

    const walk = (directory: string): void => {
        for (const name of readdirSync(directory)) {
            const path = join(directory, name);
            if (statSync(path).isDirectory())
                walk(path);
            else if (name.endsWith('.json'))
                collect(parseJSON(readFileSync(path, 'utf8')));
        }
    };

    walk(VECTORS);

    return contents;

}


describe('The content, as WWCP_POI writes it (SPECIFICATION.md 2, Written forms)', () => {

    it('is every content of the frozen run, as WWCP_POI3 wrote it', () => {

        const contents = contentsOfTheRun();

        expect(contents.length).toBeGreaterThanOrEqual(12);
        expect(contents.map(notWrittenAsHeld).filter(error => error !== undefined)).toEqual([]);

        // Also a list WWCP_POI3 writes empty: the releases a certificate is compatible with.
        expect(readText('published/QA.json')).toMatch(/"compatibleTransparencySoftwareIds":\s*\[\s*\]/u);

    });

    it('refuses what WWCP_POI3 writes in another order', () => {

        expect(refusal(qa(network => { (network['conformityAssessmentBodies'] as JSONObject[]).reverse(); })))
            .toBe(notWritten('conformityAssessmentBodies', 'its elements are in the order the content holds them in'));

        expect(refusal(qa((_, __, pool) => { pool('DE*GEF*P2')['paymentOptions'] = [ 'SMS', 'Bitcoin' ]; })))
            .toBe(notWritten('chargingStationOperators[0].chargingPools[1].paymentOptions', 'its elements are in the order the content holds them in'));
        expect(refusal(qa((_, __, pool) => { pool('DE*GEF*P2')['paymentOptions'] = [ 'Bitcoin', 'SMS' ]; }))).toBe('taken');

        // In their ordinal order: an upper case letter before a lower case one.
        expect(refusal(qa((_, __, pool) => { pool('DE*GEF*P2')['paymentOptions'] = [ 'cash', 'Bitcoin' ]; })))
            .toBe(notWritten('chargingStationOperators[0].chargingPools[1].paymentOptions', 'its elements are in the order the content holds them in'));

    });

    it('refuses the texts of an ordered list untrimmed, which WWCP_POI3 writes trimmed', () => {

        expect(refusal(qa((_, __, pool) => { pool('DE*GEF*P2')['paymentOptions'] = [ ' Cash' ]; })))
            .toBe(notWritten('chargingStationOperators[0].chargingPools[1].paymentOptions', 'the texts of its elements are trimmed'));

    });

    it('refuses a list WWCP_POI3 leaves out where it is empty, given empty', () => {

        expect(refusal(qa((_, gef) => { gef['signingKeys'] = []; })))
            .toBe(notWritten('chargingStationOperators[0].signingKeys', 'a list without elements is left out'));

        expect(refusal(qa((_, __, pool) => { pool('DE*GEF*P2')['paymentOptions'] = []; })))
            .toBe(notWritten('chargingStationOperators[0].chargingPools[1].paymentOptions', 'a list without elements is left out'));

        expect(refusal(qa(network => { body(network, 'BSI')['notifiedFor'] = []; })))
            .toBe(notWritten('conformityAssessmentBodies[0].notifiedFor', 'a list without elements is left out'));

    });

    it('refuses a property given as null, which WWCP_POI3 reads as none', () => {

        expect(refusal(qa((_, __, pool) => { pool('DE*GEF*P2')['description'] = null; })))
            .toBe(notWritten('chargingStationOperators[0].chargingPools[1].description', 'a property without a value is left out'));

    });

    it('refuses an embedded object naming its JSON-LD context, which WWCP_POI3 writes without', () => {

        expect(refusal(qa((_, gef) => { defined((gef['signingKeys'] as JSONObject[])[0])['@context'] = PUBLIC_KEY_CONTEXT; })))
            .toBe(notWritten('chargingStationOperators[0].signingKeys[0]', 'embedded, an object names no JSON-LD context'));

    });

    it('refuses a text in languages not written as Styx writes it: each language by its name in lower case, with a text', () => {

        const reason = 'a text in languages names each language as Styx writes it, in lower case, with a text';

        expect(refusal(qa((_, __, pool) => { pool('DE*GEF*P1')['name'] = { EN: 'Jena Paradies' }; })))
            .toBe(notWritten('chargingStationOperators[0].chargingPools[0].name', reason));
        expect(refusal(qa((_, __, pool) => { pool('DE*GEF*P1')['name'] = { en: 'Jena Paradies', xx: 'Foo' }; })))
            .toBe(notWritten('chargingStationOperators[0].chargingPools[0].name', reason));
        expect(refusal(qa((_, __, pool) => { pool('DE*GEF*P1')['name'] = { en: 'Jena Paradies', de: 5 }; })))
            .toBe(notWritten('chargingStationOperators[0].chargingPools[0].name', reason));
        expect(refusal(qa(network => { network['description'] = { 10: 'The roaming network of the examples' }; })))
            .toBe(notWritten('description', reason));

        expect(refusal(qa((_, __, pool) => { pool('DE*GEF*P1')['name'] = { en: 'Jena Paradies', de: 'Jena Paradies' }; }))).toBe('taken');

    });

    it('refuses a timestamp not UTC to the millisecond', () => {

        expect(refusal(qa((_, __, pool) => { pool('DE*GEF*P2')['created'] = '2026-10-25T18:25:00+02:00'; })))
            .toBe(notWritten('chargingStationOperators[0].chargingPools[1].created', 'a timestamp is UTC to the millisecond, yyyy-MM-ddTHH:mm:ss.fffZ'));

    });

    it('refuses an entity without its lastChange and a party without its name, which WWCP_POI3 writes of its own', () => {

        expect(refusal(qa((_, __, pool) => { delete pool('DE*GEF*P2')['lastChange']; })))
            .toBe(notWritten('chargingStationOperators[0].chargingPools[1].lastChange', 'the content holds it as \'"2026-11-10T05:52:54.298Z"\''));
        expect(refusal(qa(network => { delete network['lastChange']; })))
            .toBe(notWritten('lastChange', 'the content holds it as \'"2026-11-10T05:52:51.451Z"\''));

        // As "Charging Station Manufacturer 'GraphDefined'".
        expect(refusal(qa(network => { delete defined((network['chargingStationManufacturers'] as JSONObject[])[0])['name']; })))
            .toBe(notWritten('chargingStationManufacturers[0].name', 'the content holds it as \'{"en":"Charging Station Manufacturer \'GraphDefined\'"}\''));

    });

    it('refuses a text in languages without a language, but the name of a charging station operator, which WWCP_POI3 writes so', () => {

        expect(refusal(qa((_, __, pool) => { pool('DE*GEF*P1')['name'] = {}; })))
            .toBe(notWritten('chargingStationOperators[0].chargingPools[0].name', 'the content leaves it out'));
        expect(refusal(qa(network => { body(network, 'BSI')['name'] = {}; })))
            .toBe(notWritten('conformityAssessmentBodies[0].name', 'the content leaves it out'));

        expect(refusal(qa((_, gef) => { gef['name'] = {}; }))).toBe('taken');

    });

    it('refuses a list WWCP_POI3 writes also empty left out: of an open source license its URLs', () => {

        expect(refusal(qa(network => {
                   const manufacturer = defined((network['transparencySoftwareManufacturers'] as JSONObject[])[0]);
                   const release      = defined((manufacturer['transparencySoftware'] as JSONObject[])[0]);
                   delete defined((release['openSourceLicenses'] as JSONObject[])[0])['URLs'];
               })))
            .toBe(notWritten('transparencySoftwareManufacturers[0].transparencySoftware[0].openSourceLicenses[0].URLs', 'the content holds it as \'[]\''));

    });

    it('refuses an identification, and the type of a charging connector, given as a number, which WWCP_POI3 writes as a text', () => {

        expect(refusal(qa(network => { body(network, 'BSI')['@id'] = 5; })))
            .toBe(notWritten('conformityAssessmentBodies[0].@id', 'the content holds it as \'"5"\''));

        expect(refusal(qa((_, gef) => { defined(((defined((gef['EVSETemplates'] as JSONObject[])[0]))['chargingConnectors'] as JSONObject[])[0])['type'] = 5; })))
            .toBe(notWritten('chargingStationOperators[0].EVSETemplates[0].chargingConnectors[0].type', 'the content holds it as \'"5"\''));

    });

    it('takes a version as written, also without its JSON-LD context, as WWCP_POI3 takes it since 3de830a', () => {

        expect(refusal(qa(() => {}))).toBe('taken');
        expect(refusal(qa(network => { delete network['@context']; }))).toBe('taken');

        // A coordinate as the double it is; a quantity as the decimal it is, also with a trailing zero.
        expect(refusal(qa((_, __, pool) => { pool('DE*GEF*P1')['geoLocation'] = { lat: parseJSON('5.09271E1'), lng: parseJSON('11.5892') }; }))).toBe('taken');
        expect(refusal(qa(network => { defined(((network['chargingStationOperators'] as JSONObject[])[0]?.['chargingStationTemplates'] as JSONObject[])[0])['maxPower'] = parseJSON('44000.0'); })))
            .toBe('taken');

        // Grid and parking operators WWCP_POI writes without a name of its own making.
        for (const property of [ 'gridOperators', 'parkingOperators' ])
            expect(refusal(qa(network => { network[property] = [ { '@id': 'DE*NET', created: '2026-01-01T00:00:00.000Z', lastChange: '2026-01-01T00:00:00.000Z' } ]; })))
                .toBe('taken');

    });

    it('refuses a property WWCP_POI3 does not write, which the content leaves out', () => {

        expect(refusal(qa((_, __, pool) => { pool('DE*GEF*P2')['colour'] = 'green'; })))
            .toBe(notWritten('chargingStationOperators[0].chargingPools[1].colour', 'the content leaves it out'));
        expect(refusal(qa(network => { (network['operator'] as JSONObject)['keyStatement'] = { ...((network['operator'] as JSONObject)['keyStatement'] as JSONObject), x: 1 }; })))
            .toBe(notWritten('operator.keyStatement.x', 'the content leaves it out'));

        // Data licenses by their identifications alone, of a view, which a version names completely.
        expect(refusal(qa((_, __, pool) => { pool('DE*GEF*P2')['dataLicenseIds'] = [ 'ODbL' ]; })))
            .toBe(notWritten('chargingStationOperators[0].chargingPools[1].dataLicenseIds', 'the content leaves it out'));
        expect(refusal(qa(network => { network['dataLicenseIds'] = [ 'ODbL' ]; }))).toBe(notWritten('dataLicenseIds', 'the content leaves it out'));
        expect(refusal(qa((_, __, pool) => { pool('DE*GEF*P2')['dataLicenseIds'] = [ 'NoSuchLicense' ]; })))
            .toBe("The data license 'NoSuchLicense' is not well-known, so it must be given completely!");

        // Of a release, a certificate and the energy meter it was issued with, as WWCP_POI2 refuses it as it reads them.
        expect(refusal(qa(network => { defined(((network['transparencySoftwareManufacturers'] as JSONObject[])[0]?.['transparencySoftware'] as JSONObject[])[0])['x'] = 1; })))
            .toBe("TransparencySoftware: Unknown property 'x'.");
        expect(refusal(qa(network => { defined((body(network, 'PTB')['certificates'] as JSONObject[])[0])['x'] = 1; }))).toBe("Unknown property 'x'.");

    });

    it('refuses a value WWCP_POI3 writes otherwise, which the content holds as it writes it', () => {

        expect(refusal(qa((_, __, pool) => { pool('DE*GEF*P1')['geoLocation'] = { lat: parseJSON('50.92710'), lng: parseJSON('11.5892') }; })))
            .toBe(notWritten('chargingStationOperators[0].chargingPools[0].geoLocation.lat', "the content holds it as '50.9271'"));

        expect(refusal(qa((_, gef) => { gef['@id'] = 'de*gef'; })))
            .toBe(notWritten('chargingStationOperators[0].@id', 'the content holds it as \'"DE*GEF"\''));
        expect(refusal(qa(network => { defined((network['chargingStationManufacturers'] as JSONObject[])[0])['homepage'] = 'stations.graphdefined.example'; })))
            .toBe(notWritten('chargingStationManufacturers[0].homepage', 'the content holds it as \'"https://stations.graphdefined.example"\''));
        expect(refusal(qa((_, gef) => { defined((gef['energyMeterTemplates'] as JSONObject[])[0])['role'] = 'EVSE'; })))
            .toBe(notWritten('chargingStationOperators[0].energyMeterTemplates[0].role', 'the content holds it as \'"evse"\''));
        expect(refusal(qa(network => { defined(((network['energyMeterManufacturers'] as JSONObject[])[0]?.['energyMeterModels'] as JSONObject[])[0])['signatureMethods'] = [ 'ocmf' ]; })))
            .toBe(notWritten('energyMeterManufacturers[0].energyMeterModels[0].signatureMethods[0]', 'the content holds it as \'"OCMF"\''));
        expect(refusal(qa((_, gef) => { defined((gef['chargingTariffs'] as JSONObject[])[0])['currency'] = 'EUR '; })))
            .toBe(notWritten('chargingStationOperators[0].chargingTariffs[0].currency', 'the content holds it as \'"EUR"\''));

        // The name WWCP_POI makes up of an e-mobility provider naming none.
        expect(refusal(qa(network => { network['eMobilityProviders'] = [ { '@id': 'DE-GDF', created: '2026-01-01T00:00:00.000Z', lastChange: '2026-01-01T00:00:00.000Z' } ]; })))
            .toBe(notWritten('eMobilityProviders[0].name', 'the content holds it as \'{"en":"E-Mobility Provider \'DE-GDF\'"}\''));

    });

    it('refuses a number, a boolean or a text given as another JSON type WWCP_POI3 reads, which it writes as its own', () => {

        const pool       = 'chargingStationOperators[0].chargingPools[0]';
        const component  = (gef: JSONObject): JSONObject => firstOf(firstOf(firstOf(gef, 'chargingTariffs'), 'elements'), 'priceComponents');

        // A decimal of a text as WWCP_POI reads it (`NumberStyles.Any`), with its decimal places.
        expect(refusal(rich(({ gef }) => { component(gef)['price'] = '0.390'; })))
            .toBe(notWritten('chargingStationOperators[0].chargingTariffs[0].elements[0].priceComponents[0].price', "the content holds it as '0.390'"));
        expect(refusal(rich(({ gef }) => { component(gef)['price'] = '1,000.5'; })))
            .toBe(notWritten('chargingStationOperators[0].chargingTariffs[0].elements[0].priceComponents[0].price', "the content holds it as '1000.5'"));
        expect(refusal(rich(({ evse }) => { evse['maxPower'] = ' 150000 '; })))
            .toBe(notWritten(`${pool}.chargingStations[0].EVSEs[0].maxPower`, "the content holds it as '150000'"));
        expect(refusal(rich(({ network }) => { firstOf(firstOf(network, 'gridOperators'), 'gridConnectionPoints')['nominalVoltage'] = '400'; })))
            .toBe(notWritten('gridOperators[0].gridConnectionPoints[0].nominalVoltage', "the content holds it as '400'"));

        // A coordinate of a text or a boolean as `JToken.Value<Double>()` reads it, thousands separated by commas.
        expect(refusal(rich(({ pool: given }) => { (given['geoLocation'] as JSONObject)['lat'] = '5,1'; })))
            .toBe(notWritten(`${pool}.geoLocation.lat`, "the content holds it as '51'"));
        expect(refusal(rich(({ pool: given }) => { (given['geoLocation'] as JSONObject)['alt'] = true; })))
            .toBe(notWritten(`${pool}.geoLocation.alt`, "the content holds it as '1'"));

        // A boolean of a number or a text `Boolean.Parse` takes.
        expect(refusal(rich(({ pool: given }) => { given['chargingWhenClosed'] = 'TRUE'; })))
            .toBe(notWritten(`${pool}.chargingWhenClosed`, "the content holds it as 'true'"));
        expect(refusal(rich(({ gef }) => { firstOf(firstOf(gef, 'EVSETemplates'), 'chargingConnectors')['lockable'] = 0; })))
            .toBe(notWritten('chargingStationOperators[0].EVSETemplates[0].chargingConnectors[0].lockable', "the content holds it as 'false'"));

        // A text of a number or a boolean as `JToken.Value<String>()` gives it, where Styx reads one so.
        expect(refusal(rich(({ network }) => { network['dataSource'] = 5; }))).toBe(notWritten('dataSource', 'the content holds it as \'"5"\''));
        expect(refusal(rich(({ network }) => { network['dataSource'] = true; }))).toBe(notWritten('dataSource', 'the content holds it as \'"True"\''));
        expect(refusal(rich(({ pool: given }) => { given['dataSource'] = 5; }))).toBe('The data source must be a text!');

        // The width and height of an image as the integers WWCP_POI reads of texts.
        expect(refusal(rich(({ pool: given }) => { given['images'] = [ { url: 'https://example.com/a.png', category: 'photo', type: 'image/png', height: '+5' } ]; })))
            .toBe(notWritten(`${pool}.images[0].height`, "the content holds it as '5'"));

    });

    it('refuses a duration in seconds not in whole ticks of 100 ns without trailing zeros, as WWCP_POI3 writes it', () => {

        const evse = 'chargingStationOperators[0].chargingPools[0].chargingStations[0].EVSEs[0]';

        expect(refusal(rich(({ evse: given }) => { given['operationTimeout'] = parseJSON('1.50'); })))
            .toBe(notWritten(`${evse}.operationTimeout`, "the content holds it as '1.5'"));
        expect(refusal(rich(({ evse: given }) => { given['operationTimeout'] = parseJSON('0.123456789'); })))
            .toBe(notWritten(`${evse}.operationTimeout`, "the content holds it as '0.1234567'"));
        expect(refusal(rich(({ evse: given }) => { given['maxReservationDuration'] = '600.0'; })))
            .toBe(notWritten(`${evse}.maxReservationDuration`, "the content holds it as '600'"));
        expect(refusal(rich(({ network }) => { firstOf(firstOf(network, 'parkingOperators'), 'parkingProducts')['minDuration'] = parseJSON('1.50'); })))
            .toBe(notWritten('parkingOperators[0].parkingProducts[0].minDuration', "the content holds it as '1.5'"));

        // The minimum duration of a tariff restriction is a decimal.
        expect(refusal(rich(({ gef }) => { firstOf(firstOf(gef, 'chargingTariffs'), 'elements')['restrictions'] = { minDuration: '1.50' }; })))
            .toBe(notWritten('chargingStationOperators[0].chargingTariffs[0].elements[0].restrictions.minDuration', "the content holds it as '1.50'"));
        expect(refusal(rich(({ evse: given }) => { given['operationTimeout'] = parseJSON('1.5'); }))).toBe('taken');

    });

    it('refuses opening times not written as Styx writes them: 24/7 always, hours of two digits, periods UTC', () => {

        const at = 'chargingStationOperators[0].chargingPools[0].openingTimes';
        const opening = (openingTimes: JSONObject): string => refusal(rich(({ pool }) => { pool['openingTimes'] = openingTimes; }));
        const monday  = (begin: string): JSONObject[] => [ { monday: [ { begin, end: '20:00' } ] } ];

        expect(opening({ regularOpenings: monday('08:00') })).toBe(notWritten(`${at}.24/7`, "the content holds it as 'false'"));
        expect(opening({})).toBe(notWritten(`${at}.24/7`, "the content holds it as 'true'"));
        expect(opening({ '24/7': true, freeText: '' })).toBe(notWritten(`${at}.freeText`, 'the content leaves it out'));
        expect(opening({ '24/7': true, regularOpenings: [] })).toBe(notWritten(`${at}.regularOpenings`, 'a list without elements is left out'));
        expect(opening({ '24/7': false, regularOpenings: monday('8:00') })).toBe(notWritten(`${at}.regularOpenings[0].monday[0].begin`, 'the content holds it as \'"08:00"\''));
        expect(opening({ '24/7': true, exceptionalClosings: [ '2026-12-24T00:00:00+01:00 -> 2026-12-25T00:00:00.000Z' ] }))
            .toBe(notWritten(`${at}.exceptionalClosings[0]`, 'the content holds it as \'"2026-12-23T23:00:00.000Z -> 2026-12-25T00:00:00.000Z"\''));

        expect(opening({ regularOpenings: monday('08:00'), '24/7': false })).toBe('taken');
        expect(opening({ '24/7': true, freeText: 'x' })).toBe('taken');

    });

    it('refuses NUTS codes not in upper case, compared one by one with the list WWCP_POI3 writes', () => {

        const at = 'chargingStationOperators[0].chargingPools[0].nutsCodes';
        const nuts = (codes: string[]): string => refusal(rich(({ pool }) => { pool['nutsCodes'] = codes; }));

        expect(nuts([ 'de1' ])).toBe(notWritten(`${at}[0]`, 'the content holds it as \'"DE1"\''));
        expect(nuts([ 'de2', 'AT1' ])).toBe(notWritten(`${at}[0]`, 'the content holds it as \'"AT1"\''));
        expect(nuts([ 'DE1 ', 'at1' ])).toBe(notWritten(`${at}[0]`, 'the content holds it as \'"AT1"\''));
        expect(nuts([ ' DE1' ])).toBe(notWritten(at, 'the texts of its elements are trimmed'));
        expect(nuts([ 'DE1', 'AT1' ])).toBe(notWritten(at, 'its elements are in the order the content holds them in'));
        expect(nuts([ 'AT1', 'DE1' ])).toBe('taken');

    });

    it('refuses an address not written as Styx writes it: its country by its alpha-3 code', () => {

        const at = 'chargingStationOperators[0].chargingPools[0].address';
        const address = (more: JSONObject): string =>
            refusal(rich(({ pool }) => { pool['address'] = { street: 'Main', postalCode: '07745', city: { en: 'Jena' }, country: 'DEU', ...more }; }));

        // A country by its alpha-2 or alpha-3 code in any case, its numeric code, its calling code (1 Canada's, the first
        // declared of it) or one of its names as written.
        for (const [ country, alpha3 ] of [ [ 'DE', 'DEU' ], [ 'deu', 'DEU' ], [ 'Deutschland', 'DEU' ], [ 276, 'DEU' ], [ '+49', 'DEU' ],
                                            [ '44', 'BHS' ], [ '1', 'CAN' ], [ '0', 'CPT' ], [ 'UK', 'UKI' ], [ 'United Kingdom', 'GBR' ] ] as const)
            expect(address({ country })).toBe(notWritten(`${at}.country`, `the content holds it as '"${alpha3}"'`));

        for (const country of [ 'XYZ', 'XX', 'germany', 'Kosovo', '' ])
            expect(address({ country })).toBe("Invalid address: Invalid 'country'!");

        expect(address({ country: 'DEU' })).toBe('taken');
        expect(address({ country: 'ANT' })).toBe('taken');

        // Its street, postal code and time zone trimmed, its other texts as given and left out where empty, its languages in
        // lower case, nothing else.
        expect(address({ street: ' Main ' })).toBe(notWritten(`${at}.street`, 'the content holds it as \'"Main"\''));
        expect(address({ timeZone: ' Europe/Berlin ' })).toBe(notWritten(`${at}.timeZone`, 'the content holds it as \'"Europe/Berlin"\''));
        expect(address({ houseNumber: ' 12 ' })).toBe('taken');
        expect(address({ houseNumber: 12 })).toBe(notWritten(`${at}.houseNumber`, 'the content holds it as \'"12"\''));
        expect(address({ region: '' })).toBe(notWritten(`${at}.region`, 'the content leaves it out'));
        expect(address({ officialLanguages: [ 'DE' ] })).toBe(notWritten(`${at}.officialLanguages[0]`, 'the content holds it as \'"de"\''));
        expect(address({ officialLanguages: [ 'en', 'de' ] })).toBe('taken');
        expect(address({ city: { DE: 'Jena' } })).toBe(notWritten(`${at}.city.DE`, 'the content leaves it out'));
        expect(address({ x: 1 })).toBe(notWritten(`${at}.x`, 'the content leaves it out'));

        // The data source of a roaming network left out where it is empty, of a charging pool written also empty.
        expect(refusal(rich(({ network }) => { network['dataSource'] = ''; }))).toBe(notWritten('dataSource', 'the content leaves it out'));

    });

    it('holds custom data as given', () => {

        expect(refusal(qa((_, __, pool) => { pool('DE*GEF*P2')['customData'] = { b: [ 'z', 'a' ], a: { '@context': 'c', d: null, e: [] } }; })))
            .toBe('taken');

    });

});
