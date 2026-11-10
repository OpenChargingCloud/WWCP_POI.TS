import { describe, expect, it } from 'vitest';

import { defined } from './helpers.ts';
import { firstOf, refusal, rich } from './richNetwork.ts';

import type { JSONObject } from '../src/json/value.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';


// Charging tariff offers of one owner must not overlap (SPECIFICATION.md 9.4, `offers.ts`): covering one EVSE, for some of
// the same sessions, at some of the same times in the time zone of the EVSE's charging pool. Two offers of an operator
// overlapping make a version invalid, as WWCP_POI3 refuses it (ChargingStationOperator.Offers.cs); two offers of an
// e-mobility provider a change set makes overlap, the change set (RoamingNetwork.Offers.cs). The outcomes of the operator's
// cases are those of WWCP_POI3 at 89d2e02 for the same versions.

const T    = '2026-11-10T05:53:07.929Z';
const meta = { created: T, lastChange: T };

/** Where an offer applies, the AC EVSEs of DE*GEF unless told otherwise. */
const WHERE = [ 'EVSEGroupIds', 'chargingStationGroupIds', 'chargingPoolGroupIds', 'chargingStationOperatorIds' ];

const where = (more: JSONObject): JSONObject =>
    WHERE.some(property => property in more) ? {} : { EVSEGroupIds: [ 'DE*GEF*EG_AC' ] };

const offer = (id: string, more: JSONObject = {}): JSONObject =>
    ({ '@id': id, name: { en: id }, discount: { percent: 10 }, ...where(more), ...more, ...meta });

const weekly = (day: string, begin: string, end: string): JSONObject =>
    ({ '24/7': false, regularOpenings: [ { [day]: [ { begin, end } ] } ] });

/** The roaming network with the given offers of DE*GEF, and its charging pools in the given time zone. */
const offering = (offers: JSONObject[], timeZone?: string): JSONObject =>
    rich(({ gef }) => {
        gef['chargingTariffOffers'] = offers;
        if (timeZone !== undefined)
            for (const pool of gef['chargingPools'] as JSONObject[])
                pool['timeZone'] = timeZone;
    });

const overlap = (first: string, second: string, evse = 'DE*GEF*E2*1'): string =>
    `The given JSON representation of a charging station operator is invalid: The charging tariff offers '${first}' and '${second}' of the operator 'DE*GEF' overlap at the EVSE '${evse}': they must not cover the same EVSE for the same sessions at the same times! (Parameter 'ChargingTariffOffers')`;

/** The e-mobility provider DE-GDF of a network. */
const gdf = (network: JSONObject): JSONObject =>
    firstOf(network, 'eMobilityProviders');

const providerOverlap = (first: string, second: string, evse: string): string =>
    `The charging tariff offers '${first}' and '${second}' of the e-mobility provider 'DE-GDF' must not overlap: they cover the EVSE '${evse}' for the same sessions at the same times!`;

/** The error of the version a change set leads to from the given one before, or 'taken'. */
function afterChangeSet(after: JSONObject, before: JSONObject): string {
    try {
        RoamingNetwork.afterChangeSet(after, before);
    }
    catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
    return 'taken';
}


describe('Charging tariff offers', () => {

    it('of an operator must not cover one EVSE for the same sessions at the same times', () => {

        expect(refusal(offering([ offer('a') ]))).toBe('taken');
        expect(refusal(offering([ offer('a'), offer('b') ]))).toBe(overlap('a', 'b'));
        expect(refusal(offering([ offer('a'), offer('b', { EVSEGroupIds: [ 'DE*GEF*EG_DC' ] }) ]))).toBe('taken');

        // Covered by the operator, a group of charging stations or of charging pools, at the first EVSE in the ordinal order.
        expect(refusal(offering([ offer('a', { EVSEGroupIds: [ 'DE*GEF*EG_DC' ] }), offer('b', { chargingStationOperatorIds: [ 'DE*GEF' ] }) ])))
            .toBe(overlap('a', 'b', 'DE*GEF*E1*1'));
        expect(refusal(offering([ offer('a', { EVSEGroupIds: [ 'DE*GEF*EG_DC' ] }), offer('b', { chargingStationGroupIds: [ 'DE*GEF*SG_DC' ] }) ])))
            .toBe(overlap('a', 'b', 'DE*GEF*E1*1'));
        expect(refusal(offering([ offer('a', { EVSEGroupIds: [ 'DE*GEF*EG_DC' ] }), offer('b', { chargingStationGroupIds: [ 'DE*GEF*SG_AC' ] }) ])))
            .toBe('taken');
        expect(refusal(offering([ offer('a'), offer('b', { chargingPoolGroupIds: [ 'DE*GEF*PG_ALL' ] }) ])))
            .toBe(overlap('a', 'b'));

        // The first pair in the ordinal order of the offers.
        expect(refusal(offering([ offer('z'), offer('B'), offer('a') ]))).toBe(overlap('B', 'a'));
        expect(refusal(offering([ offer('a', { EVSEGroupIds: [ 'DE*GEF*EG_DC' ] }), offer('b'), offer('c') ]))).toBe(overlap('b', 'c'));

    });

    it('of an operator overlap for ad hoc sessions, or contracts of a provider both name, or one names none', () => {

        expect(refusal(offering([ offer('a', { sessions: 'adHoc' }), offer('b', { sessions: 'contract' }) ]))).toBe('taken');
        expect(refusal(offering([ offer('a', { sessions: 'adHoc' }), offer('b') ]))).toBe(overlap('a', 'b'));
        expect(refusal(offering([ offer('a', { sessions: 'contract' }), offer('b') ]))).toBe(overlap('a', 'b'));
        expect(refusal(offering([ offer('a', { sessions: 'contract', eMobilityProviderIds: [ 'DE-GDF' ] }), offer('b', { sessions: 'contract', eMobilityProviderIds: [ 'DE-8PS' ] }) ]))).toBe('taken');
        expect(refusal(offering([ offer('a', { sessions: 'contract', eMobilityProviderIds: [ 'DE-ABC', 'DE-GDF' ] }), offer('b', { sessions: 'contract', eMobilityProviderIds: [ 'DE*GDF' ] }) ]))).toBe(overlap('a', 'b'));
        expect(refusal(offering([ offer('a', { sessions: 'contract', eMobilityProviderIds: [ 'DE-GDF' ] }), offer('b', { sessions: 'contract' }) ]))).toBe(overlap('a', 'b'));
        expect(refusal(offering([ offer('a', { sessions: 'adHoc', eMobilityProviderIds: [ 'DE-GDF' ] }), offer('b', { sessions: 'adHoc', eMobilityProviderIds: [ 'DE-8PS' ] }) ]))).toBe(overlap('a', 'b'));

    });

    it('of an operator overlap within both their notBefore and notAfter, both inclusive', () => {

        expect(refusal(offering([ offer('a', { notAfter: '2026-11-01T00:00:00.000Z' }), offer('b', { notBefore: '2026-11-01T00:00:00.001Z' }) ]))).toBe('taken');
        expect(refusal(offering([ offer('a', { notAfter: '2026-11-01T00:00:00.000Z' }), offer('b', { notBefore: '2026-11-01T00:00:00.000Z' }) ]))).toBe(overlap('a', 'b'));
        expect(refusal(offering([ offer('a', { notBefore: '2027-01-01T00:00:00.000Z' }), offer('b', { notBefore: '2028-01-01T00:00:00.000Z' }) ]))).toBe(overlap('a', 'b'));

    });

    it('of an operator overlap when their opening times are open at the same times', () => {

        expect(refusal(offering([ offer('a', { openingTimes: weekly('monday', '08:00', '12:00') }), offer('b', { openingTimes: weekly('monday', '12:00', '16:00') }) ]))).toBe('taken');
        expect(refusal(offering([ offer('a', { openingTimes: weekly('monday', '08:00', '12:00') }), offer('b', { openingTimes: weekly('monday', '11:59', '13:00') }) ]))).toBe(overlap('a', 'b'));

        // A period ending at midnight ends at the end of its day; one ending later goes on into the next day.
        expect(refusal(offering([ offer('a', { openingTimes: weekly('monday', '22:00', '00:00') }), offer('b', { openingTimes: weekly('tuesday', '00:00', '01:00') }) ]))).toBe('taken');
        expect(refusal(offering([ offer('a', { openingTimes: weekly('sunday', '23:00', '00:30') }), offer('b', { openingTimes: weekly('monday', '00:15', '01:00') }) ]))).toBe(overlap('a', 'b'));
        expect(refusal(offering([ offer('a', { openingTimes: weekly('monday', '08:00', '08:00') }), offer('b', { openingTimes: weekly('tuesday', '07:00', '07:30') }) ]))).toBe(overlap('a', 'b'));

        // Of a stretch of more than eight days every minute of the week, of a shorter one its days.
        expect(refusal(offering([ offer('a', { notBefore: '2026-11-04T00:00:00.000Z', notAfter: '2026-11-12T00:01:00.000Z', openingTimes: weekly('monday', '10:00', '11:00') }),
                                  offer('b', { openingTimes: weekly('monday', '10:30', '12:00') }) ]))).toBe(overlap('a', 'b'));
        expect(refusal(offering([ offer('a', { notBefore: '2026-11-03T00:00:00.000Z', notAfter: '2026-11-08T23:59:00.000Z', openingTimes: weekly('monday', '10:00', '11:00') }),
                                  offer('b', { openingTimes: weekly('monday', '10:30', '12:00') }) ]))).toBe('taken');

    });

    it('of an operator overlap at the local times of the time zone of the charging pool of the EVSE', () => {

        // 06:00 to 07:00 UTC on a Monday is 07:00 to 08:00 in Berlin, 01:00 to 02:00 in New York.
        const monday = { notBefore: '2026-11-02T06:00:00.000Z', notAfter: '2026-11-02T06:59:59.999Z' };
        const later  = [ offer('a', monday), offer('b', { openingTimes: weekly('monday', '07:30', '09:00') }) ];

        expect(refusal(offering(later))).toBe('taken');
        expect(refusal(offering(later, 'Europe/Berlin'))).toBe(overlap('a', 'b'));
        expect(refusal(offering(later, ' Europe/Berlin '))).toBe(overlap('a', 'b'));
        expect(refusal(offering([ offer('a', monday), offer('b', { openingTimes: weekly('monday', '01:30', '02:00') }) ], 'America/New_York'))).toBe(overlap('a', 'b'));

        // Of a charging pool template; of the charging pools, the second only.
        expect(refusal(rich(({ gef }) => {
            gef['chargingTariffOffers'] = later;
            gef['chargingPoolTemplates'] = [ { '@id': 'DE*GEF*PT_BER', timeZone: 'Europe/Berlin', ...meta } ];
            for (const pool of gef['chargingPools'] as JSONObject[])
                pool['templateIds'] = [ 'DE*GEF*PT_BER' ];
        }))).toBe(overlap('a', 'b'));

        expect(refusal(rich(({ gef }) => {
            gef['chargingTariffOffers'] = later;
            defined((gef['chargingPools'] as JSONObject[])[1])['timeZone'] = 'Europe/Berlin';
        }))).toBe(overlap('a', 'b', 'DE*GEF*E4*1'));

    });

    it('of an operator in a time zone of a region of the IANA time zone database, as it writes it, which this platform knows', () => {

        // 06:00 to 07:00 UTC on a Monday is 11:30 to 12:30 in Kolkata, 03:00 to 04:00 in Buenos Aires.
        const monday = { notBefore: '2026-11-02T06:00:00.000Z', notAfter: '2026-11-02T06:59:59.999Z' };
        const at     = (begin: string, end: string): JSONObject[] => [ offer('a', monday), offer('b', { openingTimes: weekly('monday', begin, end) }) ];

        // Also an older name the database keeps for one, or a name of a part of a region.
        for (const timeZone of [ 'Asia/Calcutta', 'Asia/Kolkata' ]) {
            expect(refusal(offering(at('07:30', '09:00'), timeZone))).toBe('taken');
            expect(refusal(offering(at('12:00', '13:00'), timeZone))).toBe(overlap('a', 'b'));
        }

        expect(refusal(offering(at('03:30', '04:00'), 'America/Argentina/Buenos_Aires'))).toBe(overlap('a', 'b'));

        // No name of another system, none without a region, none in another case, none the database does not know: refused,
        // not taken as UTC.
        const unknown = (timeZone: string, of = 'charging pool', id = 'DE*GEF*P1'): string =>
            `The given JSON representation of a ${of} is invalid: The time zone '${timeZone}' of the ${of} '${id}' is no time zone of a region of the IANA time zone database this reader knows! (Parameter 'TimeZone')`;

        for (const timeZone of [ 'CET', 'UTC', 'Etc/UTC', 'Etc/GMT-1', 'US/Eastern', 'W. Europe Standard Time', 'Tokyo Standard Time',
                                 'europe/berlin', 'Europe/BERLIN', 'Europe/Atlantis', 'Mars/Olympus', 'Nowhere/Land', 'Europe/Berlin/Mitte/Wedding' ])
            expect(refusal(offering(at('07:30', '09:00'), timeZone))).toBe(unknown(timeZone));

        // Trimmed, as it is read; also of a charging pool template.
        expect(refusal(offering(at('07:30', '09:00'), ' CET '))).toBe(unknown('CET'));

        expect(refusal(rich(({ gef }) => {
            gef['chargingPoolTemplates'] = [ { '@id': 'DE*GEF*PT_CET', timeZone: 'CET', ...meta } ];
        }))).toBe(unknown('CET', 'charging pool template', 'DE*GEF*PT_CET'));

    });

    it('of an operator at the changes to and from daylight saving time, as TimeZoneInfo converts local times', () => {

        // On 29 March 2026 Berlin skips 02:00 to 03:00: a local time it skips is the first one after it.
        expect(refusal(offering([ offer('a', { notBefore: '2026-03-29T00:30:00.000Z', notAfter: '2026-03-29T00:59:00.000Z' }), offer('b', { openingTimes: weekly('sunday', '02:00', '02:30') }) ], 'Europe/Berlin'))).toBe('taken');
        expect(refusal(offering([ offer('a', { notBefore: '2026-03-29T01:00:00.000Z', notAfter: '2026-03-29T01:10:00.000Z' }), offer('b', { openingTimes: weekly('sunday', '02:15', '03:05') }) ], 'Europe/Berlin'))).toBe(overlap('a', 'b'));

        // On 25 October 2026 it gives 02:00 to 03:00 twice: a local time it gives twice is the one of its standard time.
        expect(refusal(offering([ offer('a', { notBefore: '2026-10-25T00:30:00.000Z', notAfter: '2026-10-25T00:45:00.000Z' }), offer('b', { openingTimes: weekly('sunday', '02:00', '02:59') }) ], 'Europe/Berlin'))).toBe('taken');
        expect(refusal(offering([ offer('a', { notBefore: '2026-10-25T01:30:00.000Z', notAfter: '2026-10-25T01:45:00.000Z' }), offer('b', { openingTimes: weekly('sunday', '02:00', '02:59') }) ], 'Europe/Berlin'))).toBe(overlap('a', 'b'));

    });

    it('of an operator with exceptional closings, which close, and exceptional openings, which open', () => {

        const closed = (period: string): JSONObject => offer('a', { openingTimes: { '24/7': true, exceptionalClosings: [ period ] } });
        const day    = offer('b', { notBefore: '2026-11-01T00:00:00.000Z', notAfter: '2026-11-02T00:00:00.000Z' });

        expect(refusal(offering([ closed('2026-11-01T00:00:00.000Z -> 2026-11-03T00:00:00.000Z'), day ]))).toBe('taken');
        expect(refusal(offering([ closed('2026-11-01T00:00:00.000Z -> 2026-11-02T00:00:00.000Z'), day ]))).toBe(overlap('a', 'b'));
        expect(refusal(offering([ closed('2026-11-01T00:00:00.000Z -> 2026-11-02T00:00:00.001Z'), day ]))).toBe('taken');

        const opened = (period: string): JSONObject =>
            offer('a', { openingTimes: { '24/7': false, regularOpenings: [ { monday: [ { begin: '08:00', end: '09:00' } ] } ], exceptionalOpenings: [ period ] } });

        expect(refusal(offering([ opened('2026-11-03T10:00:00.000Z -> 2026-11-03T11:00:00.000Z'), offer('b', { openingTimes: weekly('tuesday', '10:30', '12:00') }) ]))).toBe(overlap('a', 'b'));
        expect(refusal(offering([ opened('2026-11-03T10:00:00.000Z -> 2026-11-03T10:30:00.000Z'), offer('b', { openingTimes: weekly('tuesday', '10:30', '12:00') }) ]))).toBe('taken');

    });

    it('of an e-mobility provider must not come to overlap by a change set of it, but may by the changes of others', () => {

        // DE-GDF's offer covers DE*GEF*E1*1 by a group of its own; a second one covers the AC EVSEs by a group of DE*GEF.
        const second = (more: JSONObject = {}): JSONObject =>
            ({ '@id': 'gdf-offer-2', name: { en: 'AC' }, discount: { percent: 3 }, ...where(more), ...more, ...meta });

        const before   = rich();
        const twoOffers = rich(({ network }) => { (gdf(network)['chargingTariffOffers'] as JSONObject[]).push(second()); });

        expect(afterChangeSet(twoOffers, before)).toBe('taken');

        // Both covering DE*GEF*E1*1: refused after a change set of the provider, taken in a version.
        const overlapping = rich(({ network }) => { (gdf(network)['chargingTariffOffers'] as JSONObject[]).push(second({ EVSEGroupIds: [ 'DE*GDF*EG_FAV' ] })); });

        expect(afterChangeSet(overlapping, before)).toBe(providerOverlap('gdf-offer', 'gdf-offer-2', 'DE*GEF*E1*1'));
        expect(refusal(overlapping)).toBe('taken');

        // By the operator, all of its EVSEs, the first in the ordinal order.
        expect(afterChangeSet(rich(({ network }) => { (gdf(network)['chargingTariffOffers'] as JSONObject[]).push(second({ chargingStationOperatorIds: [ 'DE*GEF' ] })); }), before))
            .toBe(providerOverlap('gdf-offer', 'gdf-offer-2', 'DE*GEF*E1*1'));

        // At other times, no overlap.
        const until2029 = (network: JSONObject): void => { firstOf(gdf(network), 'chargingTariffOffers')['notAfter'] = '2029-12-31T23:59:59.999Z'; };

        expect(afterChangeSet(rich(({ network }) => { until2029(network); (gdf(network)['chargingTariffOffers'] as JSONObject[]).push(second({ EVSEGroupIds: [ 'DE*GDF*EG_FAV' ], notBefore: '2030-01-01T00:00:00.000Z' })); }),
                              rich(({ network }) => { until2029(network); })))
            .toBe('taken');

        // DE*GEF adds DE*GEF*E1*1 to its AC group: the two offers overlap by its change, which is taken.
        const byOthers = (network: JSONObject): void => {
            (gdf(network)['chargingTariffOffers'] as JSONObject[]).push(second());
            const group = defined((firstOf(network, 'chargingStationOperators')['EVSEGroups'] as JSONObject[]).find(item => item['@id'] === 'DE*GEF*EG_AC'));
            group['EVSEIds'] = [ 'DE*GEF*E1*1', ...group['EVSEIds'] as string[] ];
        };

        const overlappingByOthers = rich(({ network }) => { byOthers(network); });

        expect(afterChangeSet(overlappingByOthers, twoOffers)).toBe('taken');

        // The provider changes something else: the two overlapped before already, which is taken.
        expect(afterChangeSet(rich(({ network }) => { byOthers(network); gdf(network)['name'] = { en: 'GDF Mobility' }; }), overlappingByOthers)).toBe('taken');

        // The provider adds a third offer overlapping them: that one is not.
        expect(afterChangeSet(rich(({ network }) => { byOthers(network); (gdf(network)['chargingTariffOffers'] as JSONObject[]).push(second({ '@id': 'gdf-offer-3' })); }), overlappingByOthers))
            .toBe(providerOverlap('gdf-offer', 'gdf-offer-3', 'DE*GEF*E1*1'));

    });

});
