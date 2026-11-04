/*
 * Copyright (c) 2014-2026 GraphDefined GmbH <achim.friedland@graphdefined.com>
 * This file is part of WWCP POI TS <https://github.com/OpenChargingCloud/WWCP_POI.TS>
 *
 * Licensed under the Affero GPL license, Version 3.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.gnu.org/licenses/agpl.html
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { get, isArray, isObject, type JSONObject } from '../json/value.ts';
import { freeId, idOf, idsOf, providerId, ticksOf, timestampOf } from './poiJSON.ts';
import { hourMin }                from './poiValues.ts';


// When two charging tariff offers of one owner overlap, as ChargingTariffOffer.cs of WWCP_POI3 tells it: for some of the
// same sessions (`SessionsOverlap`), at some of the same times at an EVSE both cover, in its time zone (`TimesOverlap`), a
// time zone as `TimeZoneInfo` converts with it, one a charging pool may have (`timeZones.ts`). Points in time are ticks of 100 ns since 1970, as `DateTimeOffset` holds
// them: an inclusive notAfter ends a tick after it.


const MINUTE          = 60_000;
const DAY             = 24 * 60 * MINUTE;
const MINUTES_PER_DAY = 1440;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
const TICKS_PER_MS    = 10_000n;
const EIGHT_DAYS      = 8n * BigInt(DAY) * TICKS_PER_MS;

/** `DateTimeOffset.MaxValue`, 9999-12-31T23:59:59.9999999Z, in ticks since 1970. */
const MAX_TICKS = 253402300799999n * TICKS_PER_MS + 9_999n;

const WEEKDAYS = [ 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday' ];


// ---------------------------------------------------------------------------------------------------------------------------
// Time zones (TimeZoneInfo)

/** A time zone: the offset of its local time from UTC at a point in time, in minutes. */
export interface TimeZone {
    readonly name:      string;
    readonly offsetAt:  (ms: number) => number;
}

export const UTC: TimeZone = { name: 'UTC', offsetAt: () => 0 };

const ZONES = new Map<string, TimeZone>();

/** The milliseconds since 1970 of a date and a time of day, also of a year before 100, which `Date.UTC` takes as 19xx. */
function utcOf(year: number, month: number, day: number, hour: number, minute: number, second: number): number {
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(hour, minute, second, 0);
    return date.getTime();
}

/**
 * The time zone of the given name as `POITimeZones.TryFind` finds it: one of a charging pool or a charging pool template,
 * which reading it found this platform to know (`knownTimeZone`); UTC for none.
 */
export function timeZoneNamed(name: string | undefined): TimeZone {

    if (name === undefined)
        return UTC;

    const known = ZONES.get(name);

    if (known !== undefined)
        return known;

    const format = new Intl.DateTimeFormat('en-US', { timeZone: name, hourCycle: 'h23', era: 'short', year: 'numeric', month: 'numeric',
                                                      day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });

    const zone: TimeZone = {
        name,
        offsetAt: (ms: number): number => {
            const parts = Object.fromEntries(format.formatToParts(new Date(Math.floor(ms / 1000) * 1000)).map(part => [ part.type, part.value ]));
            const year  = parts['era'] === 'BC' ? 1 - Number(parts['year']) : Number(parts['year']);
            const local = utcOf(year, Number(parts['month']), Number(parts['day']), Number(parts['hour']), Number(parts['minute']), Number(parts['second']));
            return (local - Math.floor(ms / 1000) * 1000) / MINUTE;
        },
    };

    ZONES.set(name, zone);

    return zone;

}

/** The local midnight of the day of the given point in time in the given time zone, as local milliseconds since 1970. */
const localDayOf = (zone: TimeZone, ms: number): number =>
    Math.floor((ms + zone.offsetAt(ms) * MINUTE) / DAY) * DAY;

/**
 * The point in time of a local time of the given time zone (`AtLocal`): a local time a change to daylight saving time
 * skips is the first one after it; of a local time it gives twice, the one of its standard time, as `GetUtcOffset` tells.
 */
function atLocal(zone: TimeZone, local: number): number {

    if (zone === UTC)
        return local;

    for (;;) {

        const valid = [ ...new Set([ zone.offsetAt(local - DAY), zone.offsetAt(local + DAY) ]) ].
                          filter(offset => zone.offsetAt(local - offset * MINUTE) === offset);

        if (valid.length > 0)
            return local - Math.min(...valid) * MINUTE;

        local += MINUTE;

    }

}


// ---------------------------------------------------------------------------------------------------------------------------
// Charging tariff offers

type Period = readonly [ bigint, bigint ];

/** Opening times as `ImmutableOpeningTimes` of Styx holds them. */
interface OpeningTimes {
    /** Whether it has no regular openings: it is open at any time (`IsOpen24Hours`). */
    readonly always:     boolean;
    readonly json:       JSONObject;
    readonly openings:   readonly Period[];
    readonly closings:   readonly Period[];
}

/** What a charging tariff offer tells of when and to which sessions it applies. */
export interface Offer {
    readonly id:          string;
    readonly key:         string;
    readonly adHoc:       boolean;
    readonly contract:    boolean;
    readonly providers:   ReadonlySet<string>;
    readonly notBefore:   bigint | undefined;
    readonly notAfter:    bigint | undefined;
    readonly times:       OpeningTimes | undefined;
}

/** The exceptional periods of the given property, as `OpeningTimes.TryParse` reads them: `begin -> end`. */
const periodsAt = (json: JSONObject, property: string): Period[] => {
    const value = get(json, property);
    return (isArray(value) ? value : []).flatMap(period => {
        const [ begin, end ] = (typeof period === 'string' ? period.split(' -> ') : []).map(ticksOf);
        return begin === undefined || end === undefined ? [] : [ [ begin, end ] as const ];
    });
};

/** A timestamp of an entity, as `POIEntityMetadata.TryParseTimestamp` reads it: to the millisecond. */
const ticksAt = (json: JSONObject, property: string): bigint | undefined => {
    const value = get(json, property);
    const time  = typeof value === 'string' ? timestampOf(value) : undefined;
    return time === undefined ? undefined : BigInt(time) * TICKS_PER_MS;
};

/** A charging tariff offer as WWCP_POI3 read it. */
export function offerOf(json: JSONObject): Offer {

    const id       = idOf(json, freeId);
    const sessions = get(json, 'sessions');
    const times    = get(json, 'openingTimes');
    const regular  = isObject(times) ? get(times, 'regularOpenings') : undefined;

    return {
        id:         id?.text ?? '',
        key:        id?.key  ?? '',
        adHoc:      sessions === undefined || sessions === 'adHoc',
        contract:   sessions === undefined || sessions === 'contract',
        providers:  new Set(idsOf(get(json, 'eMobilityProviderIds'), providerId).map(provider => provider.key)),
        notBefore:  ticksAt(json, 'notBefore'),
        notAfter:   ticksAt(json, 'notAfter'),
        times:      isObject(times)
                        ? { always: !isArray(regular) || regular.length === 0, json: times, openings: periodsAt(times, 'exceptionalOpenings'), closings: periodsAt(times, 'exceptionalClosings') }
                        : undefined,
    };

}

/**
 * Whether the given offers apply to some of the same sessions (`SessionsOverlap`): both to ad hoc sessions, or both to
 * sessions with a contract of a provider both name, or one of them names none.
 */
export function sessionsOverlap(offer1: Offer, offer2: Offer): boolean {

    if (offer1.adHoc && offer2.adHoc)
        return true;

    return offer1.contract && offer2.contract &&
           (offer1.providers.size === 0 || offer2.providers.size === 0 || [ ...offer1.providers ].some(provider => offer2.providers.has(provider)));

}

type Openness = 'closed' | 'open' | 'regularly';

/**
 * Whether the given opening times are closed at the given time by an exceptional closing, open by an exceptional opening
 * or at any time, else open by their regular openings (`OpenIn`). Without a time, by their regular openings.
 */
function openIn(times: OpeningTimes | undefined, at: bigint | undefined): Openness {

    if (times === undefined)
        return 'open';

    if (at !== undefined && times.closings.some(([ begin, end ]) => begin <= at && at < end))
        return 'closed';

    if (times.always)
        return 'open';

    if (at !== undefined && times.openings.some(([ begin, end ]) => begin <= at && at < end))
        return 'open';

    return 'regularly';

}

const WEEKS = new WeakMap<JSONObject, Uint8Array>();

/**
 * The minutes of a week, from Monday 00:00 in local time, the given opening times are regularly open at (`RegularWeekOf`).
 * A period ending at midnight, or at its beginning, ends a day later.
 */
function regularWeekOf(times: OpeningTimes): Uint8Array {

    const known = WEEKS.get(times.json);

    if (known !== undefined)
        return known;

    const week    = new Uint8Array(MINUTES_PER_WEEK);
    const regular = get(times.json, 'regularOpenings');

    for (const opening of isArray(regular) ? regular : []) {

        if (!isObject(opening))
            continue;

        for (const [ weekday, periods ] of Object.entries(opening)) {

            const day = WEEKDAYS.indexOf(weekday);

            for (const period of isArray(periods) ? periods : []) {

                const from = isObject(period) && typeof period['begin'] === 'string' ? hourMin(period['begin']) : undefined;
                const to   = isObject(period) && typeof period['end']   === 'string' ? hourMin(period['end'])   : undefined;

                if (day < 0 || from === undefined || to === undefined)
                    continue;

                const begin = day * MINUTES_PER_DAY + from[0] * 60 + from[1];
                let   end   = day * MINUTES_PER_DAY + to[0]   * 60 + to[1];

                if (end <= begin)
                    end += MINUTES_PER_DAY;

                for (let minute = begin; minute < end; minute++)
                    week[minute % MINUTES_PER_WEEK] = 1;

            }

        }

    }

    WEEKS.set(times.json, week);

    return week;

}

const anyOf = (week: Uint8Array): boolean =>
    week.includes(1);

/** The milliseconds since 1970 of the given ticks, floored. */
const msOf = (ticks: bigint): number =>
    Number(ticks >= 0n ? ticks / TICKS_PER_MS : -((-ticks + TICKS_PER_MS - 1n) / TICKS_PER_MS));

/**
 * The periods from the given time to the other one the given week of local minutes is open in, in the given time zone
 * (`RegularPeriodsOf`), from the day before the local day of the first time to the day after the one of the other.
 */
function regularPeriodsOf(week: Uint8Array, from: bigint, to: bigint, zone: TimeZone): Period[] {

    const periods: Period[] = [];
    const lastDay = localDayOf(zone, msOf(to)) + DAY;

    for (let day = localDayOf(zone, msOf(from)) - DAY; day <= lastDay; day += DAY) {

        const offset = (new Date(day).getUTCDay() + 6) % 7 * MINUTES_PER_DAY;

        for (let minute = 0; minute < MINUTES_PER_DAY; minute++) {

            if (week[offset + minute] !== 1)
                continue;

            const first = minute;

            while (minute < MINUTES_PER_DAY && week[offset + minute] === 1)
                minute++;

            const begin = BigInt(atLocal(zone, day + first  * MINUTE)) * TICKS_PER_MS;
            const end   = BigInt(atLocal(zone, day + minute * MINUTE)) * TICKS_PER_MS;

            if (begin < to && from < end)
                periods.push([ begin < from ? from : begin, end > to ? to : end ]);

        }

    }

    return periods;

}

/**
 * Whether the given offers are both open at some time from the given one, or ever before, to the other one, or for good
 * (`StretchOverlaps`): no boundary of an exceptional period of theirs lies in between.
 */
function stretchOverlaps(offer1: Offer, offer2: Offer, from: bigint | undefined, to: bigint | undefined, zone: TimeZone): boolean {

    const probe = from ?? (to === undefined ? undefined : to - 1n);
    const open1 = openIn(offer1.times, probe);
    const open2 = openIn(offer2.times, probe);

    if (open1 === 'closed' || open2 === 'closed')
        return false;

    if (open1 === 'open' && open2 === 'open')
        return true;

    const week1 = open1 === 'regularly' && offer1.times !== undefined ? regularWeekOf(offer1.times) : undefined;
    const week2 = open2 === 'regularly' && offer2.times !== undefined ? regularWeekOf(offer2.times) : undefined;

    if (from === undefined || to === undefined || to - from > EIGHT_DAYS)
        return week1 === undefined ? week2 !== undefined && anyOf(week2)
             : week2 === undefined ? anyOf(week1)
             : week1.some((minute, index) => minute === 1 && week2[index] === 1);

    const periods1 = week1 === undefined ? [ [ from, to ] as const ] : regularPeriodsOf(week1, from, to, zone);
    const periods2 = week2 === undefined ? [ [ from, to ] as const ] : regularPeriodsOf(week2, from, to, zone);

    return periods1.some(([ begin1, end1 ]) => periods2.some(([ begin2, end2 ]) => begin1 < end2 && begin2 < end1));

}

/**
 * Whether the given offers apply at some of the same times at an EVSE in the given time zone (`TimesOverlap`): some time
 * within both their notBefore and notAfter, both inclusive, at which both their opening times are open. The boundaries of
 * the exceptional periods split the common times into stretches; a stretch of more than eight days, also one without an
 * end, is compared by the minutes of a week, a shorter one by its days.
 */
export function timesOverlap(offer1: Offer, offer2: Offer, zone: TimeZone): boolean {

    const latest   = (left: bigint | undefined, right: bigint | undefined): bigint | undefined =>
        left === undefined ? right : right === undefined ? left : left > right ? left : right;

    const earliest = (left: bigint | undefined, right: bigint | undefined): bigint | undefined =>
        left === undefined ? right : right === undefined ? left : left < right ? left : right;

    const begin   = latest(offer1.notBefore, offer2.notBefore);
    const until   = earliest(offer1.notAfter, offer2.notAfter);
    const end     = until !== undefined && until < MAX_TICKS ? until + 1n : undefined;

    if (begin !== undefined && end !== undefined && end <= begin)
        return false;

    const boundaries = [ ...new Set([ offer1, offer2 ].flatMap(offer => [ ...offer.times?.openings ?? [], ...offer.times?.closings ?? [] ]).
                                                        flatMap(period => [ ...period ]).
                                                        filter(at => (begin === undefined || at > begin) && (end === undefined || at < end))) ].
                           sort((left, right) => left < right ? -1 : left > right ? 1 : 0);

    const points = [ begin, ...boundaries, end ];

    for (let i = 0; i < points.length - 1; i++)
        if (stretchOverlaps(offer1, offer2, points[i], points[i + 1], zone))
            return true;

    return false;

}

/**
 * The first of the given EVSEs both offers cover, by the ordinal order of their texts, in whose time zone the offers apply
 * at some of the same times (`FirstOverlap`); undefined for none. The times are compared once per time zone.
 */
export function firstOverlap(offer1: Offer, offer2: Offer, evses: ReadonlyMap<string, string>, timeZoneOf: (key: string) => TimeZone): string | undefined {

    const overlapIn = new Map<TimeZone, boolean>();

    for (const [ key, text ] of [ ...evses ].sort(([ , left ], [ , right ]) => left < right ? -1 : left > right ? 1 : 0)) {

        const zone    = timeZoneOf(key);
        let   overlap = overlapIn.get(zone);

        if (overlap === undefined) {
            overlap = timesOverlap(offer1, offer2, zone);
            overlapIn.set(zone, overlap);
        }

        if (overlap)
            return text;

    }

    return undefined;

}
