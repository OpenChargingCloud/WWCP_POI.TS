import { describe, expect, it } from 'vitest';

import { defined } from './helpers.ts';
import { firstOf, qa, refusal, rich } from './richNetwork.ts';

import type { JSONObject } from '../src/json/value.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';


// What WWCP_POI3 refuses of the parties of a roaming network as it makes the network of them (`references.ts`, RoamingNetwork.cs):
// a manufacturer, a model, a hardware revision or firmware version, a release, a certificate, a grid connection point, a
// charging station, a parking space or a maintainer the network does not have; a station or a meter contradicting its model;
// a key of two parties; a party given twice. Of a version as arguments of the parameters of its constructor, in its order;
// after the last change of a change set bare, a reference the version before resolves as one the change set withdrew.

const byId = (list: unknown, id: string): JSONObject =>
    defined((list as JSONObject[]).find(item => item['@id'] === id), id);

const ofNetwork = (error: string, parameter: string): string =>
    `The given JSON representation of a roaming network is invalid: ${error} (Parameter '${parameter}')`;


describe('References', () => {

    it('of charging stations and their templates: manufacturers, models, hardware revisions, firmware versions', () => {

        expect(refusal(qa(({ network }) => { delete network['chargingStationManufacturers']; })))
            .toBe(ofNetwork("The manufacturer 'GraphDefined' of the charging station template 'DE*GEF*ST_AC' is unknown in the roaming network!", 'ChargingStationManufacturers'));

        expect(refusal(qa(({ gef }) => { delete firstOf(gef, 'chargingStationTemplates')['modelId']; })))
            .toBe(ofNetwork("The hardware revision '1.0' of the charging station 'DE*GEF*S2' is named without its model!", 'ChargingStationManufacturers'));

        expect(refusal(qa(({ network }) => { delete firstOf(firstOf(network, 'chargingStationManufacturers'), 'chargingStationModels')['hardwareRevisions']; })))
            .toBe(ofNetwork("The hardware revision '1.0' of the charging station template 'DE*GEF*ST_AC' is no hardware revision of its model 'GD-AC44' of 'GraphDefined'!", 'ChargingStationManufacturers'));

        expect(refusal(rich(({ evse }) => { evse['maxPower'] = 999999000; })))
            .toBe(ofNetwork("The maximum power of the EVSE 'DE*GEF*E1*1', 999999 kW, is above the one of the model 'GD-DC300' of 'GraphDefined' of its charging station 'DE*GEF*S1', 300 kW!", 'ChargingStationOperators'));

    });

    it('of energy meters and their templates, of releases and certificates', () => {

        expect(refusal(qa(({ gef }) => { delete byId(gef['energyMeterTemplates'], 'DE*GEF*EMT_AC')['manufacturerId']; })))
            .toBe(ofNetwork("The energy meter template 'DE*GEF*EMT_AC' names the model 'SM-3' without its manufacturer!", 'ChargingStationOperators'));

        expect(refusal(qa(({ gef }) => { delete byId(gef['energyMeterTemplates'], 'DE*GEF*EMT_AC')['modelId']; })))
            .toBe(ofNetwork("The energy meter 'DE*GEF*M2*1' names the hardware revision '1.4' without its model!", 'EnergyMeterManufacturers'));

        expect(refusal(qa(({ network }) => { delete network['energyMeterManufacturers']; })))
            .toBe(ofNetwork("The manufacturer 'KERNBERG' of the certificate 'PTB:2026-0017' is unknown in the roaming network!", 'TransparencySoftwareManufacturers'));

        expect(refusal(qa(({ network }) => { delete network['transparencySoftwareManufacturers']; })))
            .toBe(ofNetwork("The transparency software release 'GraphDefined:chargy-1.5.0' of the certificate 'PTB:2026-0017' is unknown in the roaming network!", 'TransparencySoftwareManufacturers'));

        expect(refusal(qa(({ network }) => { delete network['conformityAssessmentBodies']; })))
            .toBe(ofNetwork("The certificate 'PTB:2026-0042' of the charging station template 'DE*GEF*ST_DC' is unknown in the roaming network!", 'TransparencySoftwareManufacturers'));

        expect(refusal(qa(({ evse }) => { delete (evse['energyMeter'] as JSONObject)['templateIds']; })))
            .toBe(ofNetwork("The energy meter 'DE*GEF*M1*1' of the charging station 'DE*GEF*S1' is none of the energy meters the certificate 'PTB:2026-0042' was issued with!", 'TransparencySoftwareManufacturers'));

        expect(refusal(rich(({ gef }) => { byId(gef['energyMeterTemplates'], 'DE*GEF*EMT_AC')['certificateIds'] = [ 'PTB:2026-0042' ]; })))
            .toBe(ofNetwork("The certificate 'PTB:2026-0042' of the energy meter 'DE*GEF*M2*1' is for the charging station model 'GD-DC300' of 'GraphDefined', not for a model of energy meters!", 'TransparencySoftwareManufacturers'));

        expect(refusal(rich(({ gef }) => { byId(gef['energyMeterTemplates'], 'DE*GEF*EMT_AC')['signatureMethods'] = [ 'EDL40' ]; })))
            .toBe(ofNetwork("The energy meter 'DE*GEF*M2*1' signs with 'EDL40', no signature method of its model 'SM-3' of 'SAALE'!", 'EnergyMeterManufacturers'));

    });

    it('of grid connection points, charging stations, parking spaces and maintainers', () => {

        expect(refusal(rich(({ pool }) => { pool['gridConnectionPointId'] = 'gcp-9'; })))
            .toBe(ofNetwork("The grid connection point 'gcp-9' of the charging pool 'DE*GEF*P1' is unknown in the roaming network!", 'GridOperators'));

        // Compared without case.
        expect(refusal(rich(({ pool }) => { pool['gridConnectionPointId'] = 'GCP-1'; }))).toBe('taken');

        expect(refusal(rich(({ station }) => { station['parkingSpaceIds'] = [ 'space-9' ]; })))
            .toBe(ofNetwork("The parking space 'space-9' of the charging station 'DE*GEF*S1' is unknown in the roaming network!", 'ParkingOperators'));

        expect(refusal(rich(({ network }) => { firstOf(firstOf(network, 'parkingOperators'), 'parkingGarages')['chargingStationIds'] = [ 'DE*GEF*S9' ]; })))
            .toBe(ofNetwork("The charging station 'DE*GEF*S9' of the parking garage 'garage-1' is unknown in the roaming network!", 'ParkingOperators'));

        expect(refusal(rich(({ network }) => { firstOf(firstOf(network, 'gridOperators'), 'gridConnectionPoints')['maintainedBy'] = { entityType: 'ChargingStationOperator', entityId: 'DE*XYZ' }; })))
            .toBe(ofNetwork("The maintainer of the grid connection point 'gcp-1', the ChargingStationOperator 'DE*XYZ', is unknown in the roaming network!", 'GridOperators'));

    });

    it('of parties given twice and keys of two parties', () => {

        expect(refusal(rich(({ network }) => { (network['eMobilityProviders'] as JSONObject[]).push({ '@id': 'DE*GDF', name: { en: 'GDF2' }, created: network['created'] ?? null, lastChange: network['created'] ?? null }); })))
            .toBe(ofNetwork("The e-mobility provider 'DE*GDF' must not be given twice!", 'Children'));

        expect(refusal(rich(({ network }) => { firstOf(network, 'eMobilityProviders')['identityKeys'] = [ structuredClone(firstOf(firstOf(network, 'chargingStationManufacturers'), 'identityKeys')) ]; })))
            .toMatch(/^The given JSON representation of a roaming network is invalid: The key '[0-9a-f]{64}' of the ChargingStationManufacturer 'GraphDefined' is a key of the EMobilityProvider 'DE-GDF' as well: a key belongs to one party only! \(Parameter 'ChargingStationOperators'\)$/u);

    });

    it('after the last change of a change set: bare, a reference the version before resolves as withdrawn', () => {

        const after = qa(({ network }) => { delete network['chargingStationManufacturers']; });
        const error = "The manufacturer 'GraphDefined' of the charging station template 'DE*GEF*ST_AC' is unknown in the roaming network!";

        expect(() => RoamingNetwork.afterChangeSet(after)).toThrow(new RegExp(`^${error.replace(/[*]/gu, '\\*')}$`, 'u'));
        expect(() => RoamingNetwork.afterChangeSet(after, qa()))
            .toThrow(`${error.slice(0, -1)}: the change set withdraws it while it is still named; the party naming it changes first, or both sign one change set!`);

        // What the version before does not resolve either is unknown, not withdrawn.
        const unknownBefore = qa(({ gef }) => { firstOf(gef, 'chargingStationTemplates')['manufacturerId'] = 'NOPE'; });
        expect(() => RoamingNetwork.afterChangeSet(unknownBefore, qa(({ gef }) => { firstOf(gef, 'chargingStationTemplates')['manufacturerId'] = 'NOPE'; })))
            .toThrow("The manufacturer 'NOPE' of the charging station template 'DE*GEF*ST_AC' is unknown in the roaming network!");

    });

});
