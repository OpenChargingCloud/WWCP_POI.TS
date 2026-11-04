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


// The time zone of a charging pool or a charging pool template, as POITimeZones of WWCP_POI3 takes it (SPECIFICATION.md
// 9.4): a time zone of the IANA time zone database of one of its regions, as the database writes it, e.g. Europe/Berlin,
// also an older name it keeps for one, e.g. Asia/Calcutta, which the time zone database of this platform knows. No Windows
// name, none without a region (CET, UTC, Etc/GMT-1, US/Eastern), none in another case: a reader refuses them, as it refuses
// a time zone its database does not know, in place of taking it as UTC - two readers would else find different offers
// overlapping, or price one session differently.


/** A name of one of the regions of the IANA time zone database, of a place and maybe a part of the region. */
const NAME_OF_A_REGION = /^(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)(?:\/[A-Za-z0-9_+-]+){1,2}$/u;

/** Temporal, where this platform has it, e.g. Node 26; Node 22 and 24 have none. */
const TEMPORAL = (globalThis as { Temporal?: { ZonedDateTime: new (epochNanoseconds: bigint, timeZone: string) => { readonly timeZoneId: string } } }).Temporal;

/** How many names are remembered: a version names few time zones, each of many charging pools. */
const REMEMBERED = 1 << 16;

const KNOWN = new Map<string, boolean>();

/**
 * Whether the given name is the name of a time zone as the time zone database of this platform writes it: one Intl knows,
 * whose offsets are those of local times here, in the case of the database, which Temporal tells, of an older name the
 * database keeps for one the name as it keeps it. Without Temporal, Intl tells the name of a time zone, of an older name
 * the one it links to (Asia/Kolkata to Asia/Calcutta): a name only in another case than the one Intl tells is refused
 * then (Europe/BERLIN), an older one taken in any case (Asia/KOLKATA).
 */
function writtenAsKnown(name: string): boolean {

    try {

        const resolved = new Intl.DateTimeFormat('en-US', { timeZone: name }).resolvedOptions().timeZone;

        return TEMPORAL === undefined
                   ? resolved === name || resolved.toLowerCase() !== name.toLowerCase()
                   : new TEMPORAL.ZonedDateTime(0n, name).timeZoneId === name;

    }
    catch {
        return false;
    }

}

/** Whether the given time zone is one a charging pool may have and this platform knows it (`POITimeZones.TryFind`). */
export function knownTimeZone(name: string): boolean {

    let known = KNOWN.get(name);

    if (known === undefined) {
        if (KNOWN.size >= REMEMBERED)
            KNOWN.clear();
        known = NAME_OF_A_REGION.test(name) && writtenAsKnown(name);
        KNOWN.set(name, known);
    }

    return known;

}

/**
 * The error of the given time zone of a charging pool or a charging pool template (`POITimeZones.Known`), if it is none it
 * may have or this platform does not know it.
 */
export const unknownTimeZone = (name: string, of: string): string | undefined =>
    knownTimeZone(name) ? undefined : `The time zone '${name}' of ${of} is no time zone of a region of the IANA time zone database this reader knows!`;
