import { describe, expect, it } from 'vitest';

import { defined } from './helpers.ts';

import { applyChangeSet } from '../src/history/apply.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification } from '../src/history/changeSet.ts';
import { cborETag, etagToJSON, jsonETag } from '../src/etags.ts';
import { clone, type JSONArray, type JSONObject } from '../src/json/value.ts';
import { RoamingNetwork, ROAMING_NETWORK_CONTEXT } from '../src/network/roamingNetwork.ts';


// Identifications WWCP_POI keeps unique within the roaming network, not only within their party: grid connection points,
// energy meters, parking entities, transparency software releases and certificates, energy meter templates and groups,
// the groups of charging station operators and e-mobility providers, and charging tariff offers (`DuplicateGridConnectionPoint`
// to `DuplicateEnergyMeterTemplate` of RoamingNetwork.cs), compared as its types compare them. A version naming one twice
// is refused, read or led to by a change set, as WWCP_POI refuses it.

const CREATED  = '2026-01-01T00:00:00.000Z';
const T0       = '2026-10-25T12:00:00.000Z';

const entity = (id: string, more: JSONObject = {}): JSONObject =>
    ({ '@id': id, created: CREATED, lastChange: CREATED, ...more });

/** A roaming network of the given parties, without a roaming network operator, without ETags. */
const network = (parties: JSONObject): JSONObject =>
    ({ '@context': ROAMING_NETWORK_CONTEXT, '@id': 'rn1', created: CREATED, lastChange: CREATED, ...parties });

const read = (parties: JSONObject): RoamingNetwork =>
    RoamingNetwork.parse(network(parties));


describe('Identifications unique within the roaming network', () => {

    it("refuses a change set giving an operator the identification of a group of the provider of its prefix", () => {

        const before   = read({
                             chargingStationOperators:  [ entity('DE*GDF') ],
                             eMobilityProviders:        [ entity('DE-GDF', { EVSEGroups: [ entity('DE*GDF*EGMOTORWAY') ] }) ],
                         });

        // What the change set leads to as this library applies it: the operator's group next to the provider's.
        const after    = clone(before.content);
        const operator = defined((after['chargingStationOperators'] as JSONArray)[0]) as JSONObject;

        operator['EVSEGroups']  = [ { '@id': 'DE*GDF*EGMOTORWAY', created: T0, lastChange: T0 } ];
        operator['lastChange']  = T0;
        after['lastChange']     = T0;

        const json: JSONObject = {
            '@context':        CHANGE_SET_CONTEXT,
            roamingNetworkId:  'rn1',
            createdAt:         T0,
            changes:           [ { kind: 'Add', entityType: 'EVSEGroup', entityId: 'DE*GDF*EGMOTORWAY', newValue: { '@id': 'DE*GDF*EGMOTORWAY' },
                                   parentEntityType: 'ChargingStationOperator', parentEntityId: 'DE*GDF' } ],
            beforeETags:       before.changeSetETags().map(eTag => etagToJSON(eTag)),
            afterETags:        [ etagToJSON(jsonETag(after)), etagToJSON(cborETag(after)) ],
        };

        json['@id'] = changeSetIdentification(json);

        expect(() => applyChangeSet(before, ChangeSet.parse(json), { checkOwnership: false }))
            .toThrow("The EVSE group 'DE*GDF*EGMOTORWAY' must not be given twice in the roaming network!");

    });

    it('compares groups as their identifications compare: the prefix of a provider as the one of an operator, the suffix without case', () => {

        expect(() => read({
                   chargingStationOperators:  [ entity('DE*GDF', { chargingPoolGroups: [ entity('DE*GDF*PGPARTNER') ] }) ],
                   eMobilityProviders:        [ entity('DE-GDF', { chargingPoolGroups: [ entity('DE-GDF*PGpartner') ] }) ],
               }))
            .toThrow("The charging pool group 'DE-GDF*PGpartner' must not be given twice in the roaming network!");

        // A group of another kind, or of another suffix, is another group.
        expect(() => read({
                   chargingStationOperators:  [ entity('DE*GDF', { EVSEGroups: [ entity('DE*GDF*EGPARTNER') ], chargingStationGroups: [ entity('DE*GDF*SGPARTNER') ] }) ],
                   eMobilityProviders:        [ entity('DE-GDF', { chargingPoolGroups: [ entity('DE-GDF*PGPARTNER') ], EVSEGroups: [ entity('DE-GDF*EGPARTNERS') ] }) ],
               }))
            .not.toThrow();

    });

    it('refuses an energy meter, energy meter template or group given twice, without case, of charging station operators and grid operators', () => {

        const gef = (more: JSONObject = {}): JSONObject =>
            entity('DE*GEF', {
                chargingPools: [ entity('DE*GEF*P1', {
                    energyMeters:      [ entity('pool-meter') ],
                    chargingStations:  [ entity('DE*GEF*S1', { energyMeters: [ entity('station-meter') ], EVSEs: [ entity('DE*GEF*E1*1', { energyMeter: entity('meter-1') }),
                                                                                                                       entity('DE*GEF*E1*2', { energyMeter: entity('meter-2') }) ] }) ],
                }) ],
                ...more,
            });

        const net = (gridConnectionPoint: JSONObject, more: JSONObject = {}): JSONObject =>
            entity('DE*NET', { gridConnectionPoints: [ gridConnectionPoint ], ...more });

        expect(() => read({ chargingStationOperators: [ gef() ], gridOperators: [ net({ '@id': 'connection-1', energyMeter: entity('grid-meter') }) ] }))
            .not.toThrow();

        expect(() => read({ chargingStationOperators: [ gef() ], gridOperators: [ net({ '@id': 'connection-1', energyMeter: entity('METER-1') }) ] }))
            .toThrow("The energy meter 'METER-1' must not be given twice in the roaming network!");

        expect(() => read({ chargingStationOperators: [ gef({ energyMeterTemplates: [ entity('evse-meters') ] }) ],
                            gridOperators:            [ net({ '@id': 'connection-1' }, { energyMeterTemplates: [ entity('EVSE-METERS') ] }) ] }))
            .toThrow("The energy meter template 'EVSE-METERS' must not be given twice in the roaming network!");

        expect(() => read({ chargingStationOperators: [ gef({ energyMeterGroups: [ entity('all-meters') ] }) ],
                            gridOperators:            [ net({ '@id': 'connection-1' }, { energyMeterGroups: [ entity('All-Meters') ] }) ] }))
            .toThrow("The energy meter group 'All-Meters' must not be given twice in the roaming network!");

    });

    it('refuses a grid connection point, a release, a certificate, a charging tariff offer or a parking space given twice, without case', () => {

        expect(() => read({ gridOperators: [ entity('DE*NET', { gridConnectionPoints: [ { '@id': 'connection-1' } ] }),
                                             entity('DE*NE2', { gridConnectionPoints: [ { '@id': 'CONNECTION-1' } ] }) ] }))
            .toThrow("The grid connection point 'CONNECTION-1' of the grid operator 'DE*NE2' must be unique within the roaming network, but the grid operator 'DE*NET' has it too!");

        expect(() => read({ transparencySoftwareManufacturers: [ entity('ACME', { transparencySoftware: [ { '@id': 'chargy-1.0' } ] }),
                                                                 entity('ZAP',  { transparencySoftware: [ { '@id': 'Chargy-1.0' } ] }) ] }))
            .toThrow("The transparency software release 'Chargy-1.0' of the manufacturer 'ZAP' is one of the manufacturer 'ACME' already!");

        expect(() => read({ conformityAssessmentBodies: [ entity('PTB', { transparencySoftwareCertificates: [ { '@id': 'cert-1' } ] }),
                                                          entity('VDE', { transparencySoftwareCertificates: [ { '@id': 'CERT-1' } ] }) ] }))
            .toThrow("The transparency software certificate 'CERT-1' of the conformity assessment body 'VDE' is one of the conformity assessment body 'PTB' already!");

        expect(() => read({ chargingStationOperators: [ entity('DE*GEF', { chargingTariffOffers: [ entity('offer-1') ] }) ],
                            eMobilityProviders:       [ entity('DE-GDF', { chargingTariffOffers: [ entity('OFFER-1') ] }) ] }))
            .toThrow("The charging tariff offer 'OFFER-1' must not be given twice in the roaming network!");

        // A parking space of a charging station operator, where no parking operator defines it, has the identification of
        // no parking space of a parking operator.
        expect(() => read({ parkingOperators:         [ entity('DE*PRK', { parkingSpaces: [ entity('space-1') ] }) ],
                            chargingStationOperators: [ entity('DE*GEF', { parkingSpaces: [ entity('SPACE-1') ] }) ] }))
            .toThrow("The parking space 'SPACE-1' must not be given twice in the roaming network!");

    });

    it('takes parking products differing in case: their identifications compare with case', () => {

        expect(() => read({ parkingOperators: [ entity('DE*PRK', { parkingProducts: [ { '@id': 'P1' }, { '@id': 'p1' } ] }) ] }))
            .not.toThrow();

        expect(() => read({ parkingOperators: [ entity('DE*PRK', { parkingProducts: [ { '@id': 'P1' } ] }),
                                                entity('DE*PRL', { parkingProducts: [ { '@id': 'P1' } ] }) ] }))
            .toThrow("The parking product 'P1' must not be given twice in the roaming network!");

    });

});
