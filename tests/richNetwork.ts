import { defined, readJSON } from './helpers.ts';

import { Decimal } from '../src/json/decimal.ts';
import { without, type JSONObject } from '../src/json/value.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';


// QA of the frozen run, its eTags left out, with an entity of every kind WWCP_POI3 reads that QA has none of: an e-mobility
// provider with a group and an offer, a grid operator with a grid connection point, a meter group and a meter template, a
// parking operator with a garage, a space, a sensor, a template, a group and a product, and at DE*GEF a charging pool
// template, a charging tariff template, a tariff group, a pool group, an offer, a brand and a parking space. WWCP_POI3 at
// 76d3653 takes it as it is; the tests change it as WWCP_POI3 refuses it.

const T = '2026-11-12T21:54:38.880Z';
const meta = { created: T, lastChange: T };

/** The parts of QA a test changes. */
export interface Parts {
    readonly network:   JSONObject;
    readonly gef:       JSONObject;
    readonly pool:      JSONObject;
    readonly station:   JSONObject;
    readonly evse:      JSONObject;
}

const partsOf = (network: JSONObject): Parts => {
    const gef      = defined((network['chargingStationOperators'] as JSONObject[])[0]);
    const pool     = defined((gef['chargingPools'] as JSONObject[])[0]);
    const station  = defined((pool['chargingStations'] as JSONObject[])[0]);
    const evse     = defined((station['EVSEs'] as JSONObject[])[0]);
    return { network, gef, pool, station, evse };
};

/** QA, its eTags left out, as the given change leaves it. */
export function qa(change: (parts: Parts) => void = () => undefined): JSONObject {
    const network = without(readJSON('published/QA.json') as JSONObject, 'eTags');
    change(partsOf(network));
    return network;
}

/** QA with an entity of every kind, as the given change leaves it. */
export function rich(change: (parts: Parts) => void = () => undefined): JSONObject {

    return qa(parts => {

        const { network, gef, pool } = parts;

        gef['chargingPoolTemplates']   = [ { '@id': 'DE*GEF*PT_STD', name: { en: 'Standard' }, facilities: [ 'CAFE' ], ...meta } ];
        gef['chargingTariffTemplates'] = [ { '@id': 'DE*GEF*TT_BASE', currency: 'EUR', ...meta } ];
        gef['chargingTariffGroups']    = [ { '@id': 'DE*GEF*TG_ALL', name: { en: 'All' }, chargingTariffIds: [ 'DE*GEF*T_AC' ], ...meta } ];
        gef['chargingPoolGroups']      = [ { '@id': 'DE*GEF*PG_ALL', name: { en: 'All' }, chargingPoolIds: [ 'DE*GEF*P1' ], ...meta } ];
        gef['chargingTariffOffers']    = [ { '@id': 'offer-1', name: { en: 'Ten off' }, discount: { percent: 10, dimensions: [ 'ENERGY' ] }, EVSEGroupIds: [ 'DE*GEF*EG_AC' ], ...meta } ];
        gef['brands']                  = [ { '@id': 'GEF-Brand', name: { en: 'GEF' } } ];
        gef['parkingSpaces']           = [ { '@id': 'gef-space-1', ...meta } ];

        pool['gridConnectionPointId']  = 'gcp-1';

        network['eMobilityProviders']  = [ { '@id': 'DE-GDF', name: { en: 'GDF' },
                                             EVSEGroups: [ { '@id': 'DE*GDF*EG_FAV', name: { en: 'Favourites' }, EVSEIds: [ 'DE*GEF*E1*1' ], ...meta } ],
                                             chargingTariffOffers: [ { '@id': 'gdf-offer', name: { en: 'Five off' }, discount: { percent: 5 }, EVSEGroupIds: [ 'DE*GDF*EG_FAV' ], ...meta } ],
                                             ...meta } ];

        network['gridOperators']       = [ { '@id': 'DE*NET', name: { en: 'Net' },
                                             gridConnectionPoints: [ { '@id': 'gcp-1', name: { en: 'Connection 1' }, voltageLevel: 'LowVoltage',
                                                                       maintainedBy: { entityType: 'ChargingStationOperator', entityId: 'DE*GEF' },
                                                                       energyMeter: { '@id': 'gcp-meter-1', ...meta }, nominalVoltage: 400 } ],
                                             energyMeterGroups: [ { '@id': 'net-meters', name: { en: 'Net meters' }, energyMeterIds: [ 'gcp-meter-1' ], ...meta } ],
                                             energyMeterTemplates: [ { '@id': 'net-meter-template', name: { en: 'Grid meter' }, role: 'grid', ...meta } ],
                                             ...meta } ];

        network['parkingOperators']    = [ { '@id': 'DE*PRK', name: { en: 'Parking' },
                                             parkingGarages: [ { '@id': 'garage-1', name: { en: 'Garage' }, chargingStationIds: [ 'DE*GEF*S1' ], parkingProductIds: [ 'P1' ], ...meta } ],
                                             parkingSpaces: [ { '@id': 'space-1', parkingGarageId: 'garage-1', parkingSensorIds: [ 'sensor-1' ], length: 5, width: Decimal.parse('2.5'), ...meta } ],
                                             parkingSensors: [ { '@id': 'sensor-1', ...meta } ],
                                             parkingSpaceTemplates: [ { '@id': 'space-template-1', ...meta } ],
                                             parkingSpaceGroups: [ { '@id': 'space-group-1', parkingSpaceIds: [ 'space-1' ], ...meta } ],
                                             parkingProducts: [ { '@id': 'P1', minDuration: 0, stopParkingAfterTime: 3600 } ],
                                             ...meta } ];

        change(parts);

    });

}

/** The refusal of the given version, word for word, or 'taken'. */
export function refusal(json: JSONObject): string {
    try {
        RoamingNetwork.parse(json);
    }
    catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
    return 'taken';
}

/** The first object of the given list of the given object. */
export const firstOf = (json: JSONObject, property: string): JSONObject =>
    defined((json[property] as JSONObject[])[0]);
