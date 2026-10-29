import { describe, expect, it } from 'vitest';

import { defined } from './helpers.ts';

import { applyChangeSet } from '../src/history/apply.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification } from '../src/history/changeSet.ts';
import { cborETag, etagToJSON, jsonETag } from '../src/etags.ts';
import { clone, type JSONArray, type JSONObject, type JSONValue } from '../src/json/value.ts';
import { RoamingNetwork, ROAMING_NETWORK_CONTEXT } from '../src/network/roamingNetwork.ts';


// Hardware revisions, firmware versions and serial numbers as WWCP_POI reads them since c31e5e3 and 3672b06: a text as it
// is given, not empty and neither beginning nor ending with whitespace, and the hardware revisions and firmware versions of
// a model each once. A version naming another is refused, read or led to by a change set, in the words of WWCP_POI.

const CREATED  = '2026-01-01T00:00:00.000Z';
const T0       = '2026-10-26T12:00:00.000Z';

/** An entity, named as WWCP_POI writes a party of its own making otherwise. */
const entity = (id: string, more: JSONObject = {}): JSONObject =>
    ({ '@id': id, name: { en: id }, created: CREATED, lastChange: CREATED, ...more });

/** A roaming network of the given parties, without a roaming network operator, without ETags. */
const network = (parties: JSONObject): JSONObject =>
    ({ '@context': ROAMING_NETWORK_CONTEXT, '@id': 'rn1', created: CREATED, lastChange: CREATED, ...parties });

const read = (parties: JSONObject): RoamingNetwork =>
    RoamingNetwork.parse(network(parties));

/** The charging station operator DE*GEF with one station, its EVSE metered, and the given station and EVSE meter. */
const gef = (station: JSONObject = {}, meter: JSONObject = {}, more: JSONObject = {}): JSONObject =>
    entity('DE*GEF', {
        chargingPools: [ entity('DE*GEF*P1', {
            chargingStations: [ entity('DE*GEF*S1', { serialNumber: 'S-1', hardwareRevision: '1.0', firmwareVersion: '2.4.1', ...station,
                                                      EVSEs: [ entity('DE*GEF*E1*1', { energyMeter: entity('meter-1', { serialNumber: 'M-1', ...meter }) }) ] }) ],
        }) ],
        ...more,
    });

const stationModel = (more: JSONObject): JSONObject =>
    ({ chargingStationManufacturers: [ entity('GD', { chargingStationModels: [ { '@id': 'GD-DC300', ...more } ] }) ] });

/** A certificate WWCP_POI reads (`certificates.test.ts`), with the given properties. */
const certificate = (more: JSONObject): JSONObject =>
    ({ conformityAssessmentBodies: [ entity('PTB', { certificates: [ { '@id': 'PTB-2026-0042', chargingStationManufacturerId: 'GD', chargingStationModel: 'GD-DC300',
                                                                       hardwareRevisions: [ '1.0' ], firmwareVersions: [ '2.4.1' ],
                                                                       verifiedTransparencySoftwareIds: [ 'chargy-1.5.0' ], compatibleTransparencySoftwareIds: [], ...more } ] }) ] });


describe('Hardware revisions, firmware versions and serial numbers', () => {

    it('of a charging station, an energy meter and their templates: not empty, neither beginning nor ending with whitespace', () => {

        expect(() => read({ chargingStationOperators: [ gef() ] }))
            .not.toThrow();

        expect(() => read({ chargingStationOperators: [ gef({ serialNumber: ' S-1' }) ] }))
            .toThrow("Invalid serial number ' S-1'!");

        expect(() => read({ chargingStationOperators: [ gef({ hardwareRevision: '' }) ] }))
            .toThrow("Invalid hardware revision ''!");

        expect(() => read({ chargingStationOperators: [ gef({}, { firmwareVersion: '1.2\n' }) ] }))
            .toThrow("Invalid firmware version '1.2\n'!");

        expect(() => read({ chargingStationOperators: [ gef({}, {}, { chargingStationTemplates: [ entity('dc', { firmwareVersion: '   ' }) ] }) ] }))
            .toThrow("Invalid firmware version '   '!");

        expect(() => read({ gridOperators: [ entity('DE*NET', { energyMeterTemplates: [ entity('grid', { hardwareRevision: 3 }) ] }) ] }))
            .toThrow("Invalid hardware revision '3'!");

        expect(() => read({ gridOperators: [ entity('DE*NET', { gridConnectionPoints: [ { '@id': 'connection-1', energyMeter: entity('grid-meter', { serialNumber: 'G-1 ' }) } ] }) ] }))
            .toThrow("Invalid serial number 'G-1 '!");

    });

    it('take their text exactly as it is given, whitespace inside, case and all, and know whitespace as WWCP_POI knows it', () => {

        expect(() => read({ chargingStationOperators: [ gef({ serialNumber: 'S 1', hardwareRevision: 'Rev. B', firmwareVersion: 'v' }) ] }))
            .not.toThrow();

        // U+0085 is whitespace to Char.IsWhiteSpace, U+FEFF is not, where String.prototype.trim takes it the other way round.
        expect(() => read({ chargingStationOperators: [ gef({ firmwareVersion: '2.4.1\u0085' }) ] }))
            .toThrow("Invalid firmware version '2.4.1\u0085'!");

        expect(() => read({ chargingStationOperators: [ gef({ firmwareVersion: '﻿2.4.1' }) ] }))
            .not.toThrow();

    });

    it('of a model: each once, as given, in an array', () => {

        expect(() => read(stationModel({ hardwareRevisions: [ '1.0', 'A', 'a' ], firmwareVersions: [ '2.4.1' ] })))
            .not.toThrow();

        expect(() => read(stationModel({ hardwareRevisions: [ '1.0', '1.0' ] })))
            .toThrow("A hardware revision of the charging station model 'GD-DC300' must not be given twice!");

        expect(() => read(stationModel({ firmwareVersions: [ '2.4.1', '2.4.2 ' ] })))
            .toThrow("Invalid firmware version '2.4.2 '!");

        expect(() => read(stationModel({ firmwareVersions: '2.4.1' })))
            .toThrow("The firmware version must be a JSON array!");

        expect(() => read({ energyMeterManufacturers: [ entity('EMH', { energyMeterModels: [ { '@id': 'eHZ', firmwareVersions: [ '1', '2', '1' ] } ] }) ] }))
            .toThrow("A firmware version of the energy meter model 'eHZ' must not be given twice!");

        // ModelVersions.Of takes the versions once both were read: an invalid firmware version before a hardware revision twice.
        expect(() => read(stationModel({ hardwareRevisions: [ '1.0', '1.0' ], firmwareVersions: [ ' 2.4.1' ] })))
            .toThrow("Invalid firmware version ' 2.4.1'!");

    });

    it('of a certificate and of the energy meters it was issued with, by their path, each once', () => {

        expect(() => read(certificate({ hardwareRevisions: [ '1.0', 'A', 'a' ], firmwareVersions: [ '2.4.1' ],
                                        energyMeters: [ { manufacturerId: 'EMH', modelId: 'eHZ', hardwareRevisions: [ '1' ], firmwareVersions: [ '1' ] } ] })))
            .not.toThrow();

        // As ModelVersions.Of refuses them, by ConformityCertificate and CertifiedEnergyMeter (WWCP_POI2).
        expect(() => read(certificate({ hardwareRevisions: [ '1.0', '1.0' ], firmwareVersions: [ '2.4.1' ] })))
            .toThrow("A hardware revision of the certificate 'PTB-2026-0042' must not be given twice!");

        expect(() => read(certificate({ firmwareVersions: [ '2.4.1', '2.4.1' ] })))
            .toThrow("A firmware version of the certificate 'PTB-2026-0042' must not be given twice!");

        expect(() => read(certificate({ energyMeters: [ { manufacturerId: 'EMH', modelId: 'eHZ', hardwareRevisions: [ '1', '1' ] } ] })))
            .toThrow("energyMeters[0]: A hardware revision of the certified energy meter model 'eHZ' of 'EMH' must not be given twice!");

        // In the order WWCP_POI reads them: the texts of the certificate, each energy meter, then the certificate's twice.
        expect(() => read(certificate({ hardwareRevisions: [ '1.0', '1.0' ], firmwareVersions: [ ' 2.4.1' ] })))
            .toThrow("firmwareVersions[0]: Invalid text representation of a firmware version: ' 2.4.1'!");

        expect(() => read(certificate({ hardwareRevisions: [ '1.0', '1.0' ],
                                        energyMeters: [ { manufacturerId: 'EMH', modelId: 'eHZ', firmwareVersions: [ '1', '1' ] } ] })))
            .toThrow("energyMeters[0]: A firmware version of the certified energy meter model 'eHZ' of 'EMH' must not be given twice!");

        expect(() => read(certificate({ energyMeters: [ { manufacturerId: 'EMH', modelId: 'eHZ', hardwareRevisions: [ '1', '1' ], firmwareVersions: [ '1 ' ] } ] })))
            .toThrow("energyMeters[0]: firmwareVersions[0]: Invalid text representation of a firmware version: '1 '!");

        expect(() => read(certificate({ hardwareRevisions: [ '1.0', ' 1.1' ] })))
            .toThrow("hardwareRevisions[1]: Invalid text representation of a hardware revision: ' 1.1'!");

        expect(() => read(certificate({ energyMeters: [ { manufacturerId: 'EMH', modelId: 'eHZ', firmwareVersions: [ '1', 2 ] } ] })))
            .toThrow("energyMeters[0]: firmwareVersions[1]: Expected an identifier string.");

        expect(() => read(certificate({ firmwareVersions: '2.4.1' })))
            .toThrow("firmwareVersions: expected an array.");

    });

    it('refuses a change set leading to a version naming one WWCP_POI refuses, and takes the same change set of a valid text', () => {

        const before = read({ chargingStationOperators: [ gef() ] });

        /** The change set updating the serial number of DE*GEF*S1 to the given one, with the ETags of what it leads to. */
        const updating = (serialNumber: JSONValue): ChangeSet => {

            const after    = clone(before.content);
            const operator = defined((after['chargingStationOperators'] as JSONArray)[0]) as JSONObject;
            const pool     = defined((operator['chargingPools'] as JSONArray)[0]) as JSONObject;
            const station  = defined((pool['chargingStations'] as JSONArray)[0]) as JSONObject;

            station['serialNumber']  = serialNumber;
            station['lastChange']    = T0;
            pool['lastChange']       = T0;
            operator['lastChange']   = T0;
            after['lastChange']      = T0;

            const json: JSONObject = {
                '@context':        CHANGE_SET_CONTEXT,
                roamingNetworkId:  'rn1',
                createdAt:         T0,
                changes:           [ { kind: 'UpdateProperty', entityType: 'ChargingStation', entityId: 'DE*GEF*S1', propertyName: 'serialNumber',
                                       oldValue: 'S-1', newValue: serialNumber } ],
                beforeETags:       before.changeSetETags().map(eTag => etagToJSON(eTag)),
                afterETags:        [ etagToJSON(jsonETag(after)), etagToJSON(cborETag(after)) ],
            };

            json['@id'] = changeSetIdentification(json);

            return ChangeSet.parse(json);

        };

        expect(applyChangeSet(before, updating('S-2'), { checkOwnership: false }).content['lastChange'])
            .toBe(T0);

        expect(() => applyChangeSet(before, updating('S-2 '), { checkOwnership: false }))
            .toThrow("Invalid serial number 'S-2 '!");

    });

});
