import { describe, expect, it } from 'vitest';

import { defined } from './helpers.ts';

import { applyChangeSet } from '../src/history/apply.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification } from '../src/history/changeSet.ts';
import { cborETag, etagToJSON, jsonETag } from '../src/etags.ts';
import { clone, type JSONArray, type JSONObject, type JSONValue } from '../src/json/value.ts';
import { RoamingNetwork, ROAMING_NETWORK_CONTEXT } from '../src/network/roamingNetwork.ts';


// Certificates of conformity as WWCP_POI reads them (ConformityCertificate and CertifiedEnergyMeter of WWCP_POI2): for
// exactly one model, with its manufacturer; at least one hardware revision and firmware version, also of each energy meter
// it was issued with; an absolute documentURL, a legislation not empty, notBefore not after notAfter; at least one
// release, none twice, none both verified and compatible; energy meters of a charging station model only, each model
// once. A version naming another is refused, read or led to by a change set, in the words and in the order of WWCP_POI
// (D9 of WWCPPOIConformanceTests).

const CREATED  = '2026-01-01T00:00:00.000Z';
const T0       = '2026-10-27T12:00:00.000Z';

/** An entity, named as WWCP_POI writes a party of its own making otherwise. */
const entity = (id: string, more: JSONObject = {}): JSONObject =>
    ({ '@id': id, name: { en: id }, created: CREATED, lastChange: CREATED, ...more });

/** The PTB with the given certificates, notified for the CRA and the MID, so that it may issue a certificate under both. */
const read = (certificates: readonly JSONObject[]): RoamingNetwork =>
    RoamingNetwork.parse({ '@context': ROAMING_NETWORK_CONTEXT, '@id': 'rn1', created: CREATED, lastChange: CREATED,
                           conformityAssessmentBodies: [ entity('PTB', { notifiedFor: [ 'CRA', 'MID' ], certificates: [ ...certificates ] }) ] });

/** An energy meter a certificate was issued with, of the energy meter model eHZ of EMH. */
const meter = (more: JSONObject = {}): JSONObject =>
    ({ manufacturerId: 'EMH', modelId: 'eHZ', hardwareRevisions: [ '1' ], firmwareVersions: [ '1.2' ], ...more });

/** A certificate for the charging station model GD-DC300 of GD, issued with the energy meter model eHZ of EMH. */
const ofStation = (more: JSONObject = {}): JSONObject =>
    ({ '@id': 'PTB-2026-0042', chargingStationManufacturerId: 'GD', chargingStationModel: 'GD-DC300', hardwareRevisions: [ '1.0' ],
       firmwareVersions: [ '2.5.0' ], verifiedTransparencySoftwareIds: [ 'chargy-1.5.0' ], compatibleTransparencySoftwareIds: [],
       energyMeters: [ meter() ], documentURL: 'https://www.ptb.example/certificates/PTB-2026-0042.pdf',
       notBefore: '2026-01-01T00:00:00.000Z', notAfter: '2036-01-01T00:00:00.000Z', legislation: 'MID', ...more });

/** A certificate for the energy meter model eHZ of EMH. */
const ofMeter = (more: JSONObject = {}): JSONObject =>
    ({ '@id': 'PTB-2026-0017', energyMeterManufacturerId: 'EMH', energyMeterModel: 'eHZ', hardwareRevisions: [ '1' ],
       firmwareVersions: [ '1.2' ], verifiedTransparencySoftwareIds: [ 'chargy-1.5.0' ], compatibleTransparencySoftwareIds: [], ...more });

/** The certificate of the given kind without the given properties. */
const without = (certificate: JSONObject, ...properties: string[]): JSONObject =>
    Object.fromEntries(Object.entries(certificate).filter(([ property ]) => !properties.includes(property)));

const refusing = (certificate: JSONObject): (() => RoamingNetwork) =>
    () => read([ certificate ]);


describe('Certificates', () => {

    it('in the words of WWCP_POI3 at 8108522, what its constructor refuses as an argument of its parameter where it names one', () => {

        const refusalOf = (certificate: JSONObject): string => {
            try {
                read([ certificate ]);
            }
            catch (e) {
                return e instanceof Error ? e.message : String(e);
            }
            return 'taken';
        };

        expect(refusalOf(without(ofMeter(), 'hardwareRevisions'))).toBe("The certificate 'PTB-2026-0017' must name at least one hardware revision of its model! (Parameter 'HardwareRevisions')");
        expect(refusalOf(ofMeter({ hardwareRevisions: [ '1', '1' ] }))).toBe("A hardware revision of the certificate 'PTB-2026-0017' must not be given twice! (Parameter 'Versions')");
        expect(refusalOf(ofStation({ legislation: ' ' }))).toBe("A legislation must not be empty. (Parameter 'Legislation')");
        expect(refusalOf(ofStation({ notAfter: '2025-12-31T23:59:59.999Z' }))).toBe("notBefore must not exceed notAfter. (Parameter 'NotBefore')");
        expect(refusalOf(ofMeter({ energyMeters: [ meter() ] }))).toBe("The certificate 'PTB-2026-0017' of an energy meter model names no energy meters! (Parameter 'EnergyMeters')");
        expect(refusalOf(ofStation({ energyMeters: [ meter(), meter() ] })))
            .toBe("The energy meter model 'eHZ' of 'EMH' must not be given twice in the certificate 'PTB-2026-0042'! (Parameter 'EnergyMeters')");
        expect(refusalOf(ofStation({ energyMeters: [ meter({ firmwareVersions: [] }) ] })))
            .toBe("energyMeters[0]: The certified energy meter model 'eHZ' of 'EMH' must name at least one firmware version! (Parameter 'FirmwareVersions')");

        // What it reads, by its path alone; what it reads not as given, in its words.
        expect(refusalOf(ofStation({ documentURL: 'certificates/PTB-2026-0042.pdf' }))).toBe('documentURL: expected an absolute URL.');
        expect(refusalOf(ofStation({ energyMeters: [ meter({ modelId: 5 }) ] }))).toBe('energyMeters[0]: modelId: expected a string.');
        expect(refusalOf(ofStation({ '@id': 5 }))).toBe('@id: expected a string.');

    });

    it('of a charging station model and of an energy meter model, as WWCP_POI reads them', () => {

        expect(() => read([ ofMeter(), ofStation() ])).not.toThrow();

        // Optional: the energy meters, the documentURL, the validity, the legislation. Not the releases of a list, even of
        // none, which WWCP_POI writes also empty.
        expect(() => read([ without(ofStation(), 'compatibleTransparencySoftwareIds') ]))
            .toThrow("'conformityAssessmentBodies[0].certificates[0]' is not written as the content holds it: WWCP_POI writes its 'compatibleTransparencySoftwareIds' also without an element!");
        expect(() => read([ without(ofStation(), 'energyMeters', 'documentURL', 'notBefore', 'notAfter', 'legislation') ]))
            .not.toThrow();

        expect(() => read([ ofMeter({ verifiedTransparencySoftwareIds: [], compatibleTransparencySoftwareIds: [ 'chargy-1.5.0' ] }) ]))
            .not.toThrow();

        // A model named as null names none, as StrictJSON.Text reads it, which WWCP_POI writes without it: refused, as the
        // content holds it without.
        expect(() => read([ ofMeter({ chargingStationManufacturerId: null, chargingStationModel: null }) ]))
            .toThrow("'conformityAssessmentBodies[0].certificates[0].chargingStationManufacturerId' is not written as the content holds it: a property without a value is left out!");

    });

    it('for exactly one model, with its manufacturer', () => {

        expect(refusing(without(ofMeter(), 'energyMeterManufacturerId', 'energyMeterModel')))
            .toThrow("The certificate 'PTB-2026-0017' must be for either a charging station model or an energy meter model!");

        expect(refusing(ofMeter({ chargingStationManufacturerId: 'GD', chargingStationModel: 'GD-DC300' })))
            .toThrow("The certificate 'PTB-2026-0017' must be for either a charging station model or an energy meter model!");

        expect(refusing(without(ofStation(), 'chargingStationManufacturerId')))
            .toThrow("The certificate 'PTB-2026-0042' must name the charging station model it is for with its manufacturer!");

        expect(refusing(without(ofMeter(), 'energyMeterModel')))
            .toThrow("The certificate 'PTB-2026-0017' must name the energy meter model it is for with its manufacturer!");

        expect(refusing(ofStation({ chargingStationModel: 300 })))
            .toThrow("chargingStationModel: expected a string.");

    });

    it('naming at least one hardware revision and one firmware version, also of each energy meter it was issued with', () => {

        expect(refusing(ofMeter({ hardwareRevisions: [] })))
            .toThrow("The certificate 'PTB-2026-0017' must name at least one hardware revision of its model!");

        expect(refusing(without(ofStation(), 'firmwareVersions')))
            .toThrow("The certificate 'PTB-2026-0042' must name at least one firmware version of its model!");

        expect(refusing(ofStation({ energyMeters: [ meter({ hardwareRevisions: [] }) ] })))
            .toThrow("energyMeters[0]: The certified energy meter model 'eHZ' of 'EMH' must name at least one hardware revision!");

        expect(refusing(ofStation({ energyMeters: [ meter(), without(meter({ modelId: 'eHZ2' }), 'firmwareVersions') ] })))
            .toThrow("energyMeters[1]: The certified energy meter model 'eHZ2' of 'EMH' must name at least one firmware version!");

    });

    it('naming its energy meters as objects of a manufacturer and a model, each model once, compared without case', () => {

        expect(refusing(ofStation({ energyMeters: meter() })))
            .toThrow("energyMeters: expected an array.");

        expect(refusing(ofStation({ energyMeters: [ 'eHZ' ] })))
            .toThrow("energyMeters[0]: Expected an object.");

        expect(refusing(ofStation({ energyMeters: [ meter({ manufacturerId: ' ' }) ] })))
            .toThrow("energyMeters[0]: manufacturerId: expected a nonempty string.");

        expect(refusing(ofStation({ energyMeters: [ meter(), meter({ modelId: 'EHZ', firmwareVersions: [ '1.3' ] }) ] })))
            .toThrow("The energy meter model 'eHZ' of 'EMH' must not be given twice in the certificate 'PTB-2026-0042'!");

        // Of those named twice, the one named first, as it is named first.
        expect(refusing(ofStation({ energyMeters: [ meter({ modelId: 'A' }), meter({ modelId: 'B' }), meter({ modelId: 'B' }), meter({ modelId: ' a ' }) ] })))
            .toThrow("The energy meter model 'A' of 'EMH' must not be given twice in the certificate 'PTB-2026-0042'!");

        expect(refusing(ofMeter({ energyMeters: [ meter() ] })))
            .toThrow("The certificate 'PTB-2026-0017' of an energy meter model names no energy meters!");

        // None given as an empty list WWCP_POI takes, and writes without it: refused, as the content holds it without.
        expect(() => read([ ofMeter({ energyMeters: [] }) ]))
            .toThrow("'conformityAssessmentBodies[0].certificates[0].energyMeters' is not written as the content holds it: a list without elements is left out!");

    });

    it('with an absolute documentURL, a legislation not empty, and a validity not ending before it begins, to the tick', () => {

        expect(refusing(ofStation({ documentURL: 'certificates/PTB-2026-0042.pdf' })))
            .toThrow("documentURL: expected an absolute URL.");

        expect(refusing(ofStation({ documentURL: 42 })))
            .toThrow("documentURL: expected a string.");

        expect(refusing(ofStation({ legislation: ' ' })))
            .toThrow("A legislation must not be empty.");

        expect(refusing(ofStation({ notAfter: '2025-12-31T23:59:59.999Z' })))
            .toThrow("notBefore must not exceed notAfter.");

        expect(refusing(ofStation({ notBefore: '2026-01-01T00:00:00.0000001Z', notAfter: '2026-01-01T00:00:00.000Z' })))
            .toThrow("notBefore must not exceed notAfter.");

        expect(refusing(ofStation({ notBefore: '2026-01-01T00:00:00.000Z', notAfter: '2026-01-01T01:59:59.999+02:00' })))
            .toThrow("notBefore must not exceed notAfter.");

        // A day long, or not at all; and in another offset, as DateTimeOffset reads it, which WWCP_POI writes in UTC to the
        // millisecond: refused, as the content holds it so.
        expect(() => read([ ofStation({ notAfter: '2026-01-01T00:00:00.000Z' }) ])).not.toThrow();
        expect(() => read([ ofStation({ notBefore: '2026-01-01T01:00:00+01:00', notAfter: '2026-01-01T00:00Z' }) ]))
            .toThrow("'conformityAssessmentBodies[0].certificates[0].notBefore' is not written as the content holds it: a timestamp is UTC to the millisecond, yyyy-MM-ddTHH:mm:ss.fffZ!");

        expect(refusing(ofStation({ notBefore: '2026-01-01T00:00:00.000' })))
            .toThrow("notBefore: invalid timestamp.");

        expect(refusing(ofStation({ notAfter: '2026-02-30T00:00:00.000Z' })))
            .toThrow("notAfter: invalid timestamp.");

        // Nothing after its offset, also no line feed, as StrictJSON.Date reads it since WWCP_POI f53d220.
        expect(refusing(ofStation({ notBefore: '2026-01-01T00:00:00.000Z\n' })))
            .toThrow("notBefore: invalid timestamp.");
        expect(refusing(ofStation({ notAfter: '2036-01-01T00:00:00+01:00\n' })))
            .toThrow("notAfter: invalid timestamp.");

    });

    it('naming at least one release, each once, compared ordinally once trimmed, none both verified and compatible, compared without case', () => {

        expect(refusing(ofMeter({ verifiedTransparencySoftwareIds: [] })))
            .toThrow("A document must identify at least one software release.");

        expect(refusing(ofMeter({ verifiedTransparencySoftwareIds: [ 'chargy-1.5.0', ' chargy-1.5.0' ] })))
            .toThrow("Empty or duplicate TransparencySoftware reference.");

        expect(refusing(ofMeter({ compatibleTransparencySoftwareIds: [ 'chargy-1.4.0', 'chargy-1.4.0' ] })))
            .toThrow("Empty or duplicate TransparencySoftware reference.");

        expect(refusing(ofMeter({ compatibleTransparencySoftwareIds: [ 'CHARGY-1.5.0' ] })))
            .toThrow("A release cannot be both verified and merely compatible in the same document.");

        // As WWCP_POI takes it (References): named twice in another case is not twice; in their ordinal order, as it writes them.
        expect(() => read([ ofMeter({ verifiedTransparencySoftwareIds: [ 'CHARGY-1.5.0', 'chargy-1.5.0' ] }) ])).not.toThrow();
        expect(() => read([ ofMeter({ verifiedTransparencySoftwareIds: [ 'chargy-1.5.0', 'CHARGY-1.5.0' ] }) ]))
            .toThrow("'conformityAssessmentBodies[0].certificates[0].verifiedTransparencySoftwareIds' is not written as the content holds it: its elements are in the order the content holds them in!");

        expect(refusing(ofMeter({ verifiedTransparencySoftwareIds: [ 'chargy-1.5.0', ' ' ] })))
            .toThrow("verifiedTransparencySoftwareIds[1]: Invalid text representation of a transparency software identification: ' '!");

        expect(refusing(ofMeter({ compatibleTransparencySoftwareIds: [ 15 ] })))
            .toThrow("compatibleTransparencySoftwareIds[0]: Expected an identifier string.");

    });

    it('in the order WWCP_POI reads them: its arguments, each energy meter among them, then what its constructor checks', () => {

        // The arguments: the texts of its versions before its energy meters, its energy meters before its documentURL, …
        expect(refusing(ofStation({ firmwareVersions: [ '2.5.0 ' ], energyMeters: [ meter({ hardwareRevisions: [] }) ] })))
            .toThrow("firmwareVersions[0]: Invalid text representation of a firmware version: '2.5.0 '!");

        expect(refusing(ofStation({ energyMeters: [ meter({ hardwareRevisions: [] }) ], documentURL: 'PTB-2026-0042.pdf' })))
            .toThrow("energyMeters[0]: The certified energy meter model 'eHZ' of 'EMH' must name at least one hardware revision!");

        // … a meter's versions twice before at least one of each.
        expect(refusing(ofStation({ energyMeters: [ meter({ hardwareRevisions: [], firmwareVersions: [ '1.2', '1.2' ] }) ] })))
            .toThrow("energyMeters[0]: A firmware version of the certified energy meter model 'eHZ' of 'EMH' must not be given twice!");

        // Its arguments before its constructor: a relative documentURL before naming no model.
        expect(refusing(without(ofMeter({ documentURL: 'PTB-2026-0017.pdf' }), 'energyMeterModel')))
            .toThrow("documentURL: expected an absolute URL.");

        // The constructor: the model, its versions twice, at least one of each, the legislation, the validity, the releases,
        // the energy meters.
        expect(refusing(without(ofStation({ hardwareRevisions: [ '1.0', '1.0' ] }), 'chargingStationManufacturerId')))
            .toThrow("The certificate 'PTB-2026-0042' must name the charging station model it is for with its manufacturer!");

        expect(refusing(ofStation({ hardwareRevisions: [ '1.0', '1.0' ], firmwareVersions: [] })))
            .toThrow("A hardware revision of the certificate 'PTB-2026-0042' must not be given twice!");

        expect(refusing(ofStation({ firmwareVersions: [], legislation: '' })))
            .toThrow("The certificate 'PTB-2026-0042' must name at least one firmware version of its model!");

        expect(refusing(ofStation({ legislation: '', notAfter: CREATED.replace('2026', '2025') })))
            .toThrow("A legislation must not be empty.");

        expect(refusing(ofStation({ notAfter: CREATED.replace('2026', '2025'), verifiedTransparencySoftwareIds: [] })))
            .toThrow("notBefore must not exceed notAfter.");

        expect(refusing(ofMeter({ verifiedTransparencySoftwareIds: [], energyMeters: [ meter() ] })))
            .toThrow("A document must identify at least one software release.");

        expect(refusing(ofMeter({ compatibleTransparencySoftwareIds: [ 'chargy-1.5.0' ], energyMeters: [ meter() ] })))
            .toThrow("A release cannot be both verified and merely compatible in the same document.");

    });

    it('refuses a change set leading to a version naming one WWCP_POI refuses, and takes the same change set of a valid one', () => {

        // Of the PTB without keys: the roaming network operator states it in its place.
        const before = read([ ofStation({ statedBy: 'roamingNetworkOperator' }) ]);

        /** The change set updating the legislation of PTB-2026-0042 to the given one, with the ETags of what it leads to. */
        const updating = (legislation: JSONValue): ChangeSet => {

            const after        = clone(before.content);
            const body         = defined((after['conformityAssessmentBodies'] as JSONArray)[0]) as JSONObject;
            const certificate  = defined((body['certificates'] as JSONArray)[0]) as JSONObject;

            certificate['legislation']  = legislation;
            body['lastChange']          = T0;
            after['lastChange']         = T0;

            const json: JSONObject = {
                '@context':        CHANGE_SET_CONTEXT,
                roamingNetworkId:  'rn1',
                createdAt:         T0,
                changes:           [ { kind: 'UpdateProperty', entityType: 'ConformityCertificate', entityId: 'PTB-2026-0042', propertyName: 'legislation',
                                       oldValue: 'MID', newValue: legislation } ],
                beforeETags:       before.changeSetETags().map(eTag => etagToJSON(eTag)),
                afterETags:        [ etagToJSON(jsonETag(after)), etagToJSON(cborETag(after)) ],
            };

            json['@id'] = changeSetIdentification(json);

            return ChangeSet.parse(json);

        };

        expect(applyChangeSet(before, updating('CRA'), { checkOwnership: false }).content['lastChange'])
            .toBe(T0);

        expect(() => applyChangeSet(before, updating(' '), { checkOwnership: false }))
            .toThrow("A legislation must not be empty.");

    });

});
