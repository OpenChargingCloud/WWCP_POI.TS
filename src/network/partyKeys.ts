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

import { asText, get, isArray, isObject, type JSONObject, type JSONValue } from '../json/value.ts';
import { ordinal }       from '../json/canonical.ts';
import { compactJSON }   from '../qidigital/json.ts';
import { onlyProperties } from '../common.ts';
import { POIPublicKey }  from '../keys.ts';
import { POIError }      from '../errors.ts';


// The keys of the parties of a roaming network and of its operator, read as WWCP_POI3 reads them wherever it reads a party
// (POIPartyKeys.TryParse, then POIPartyKeys.Check in the constructor of the party), in its words: every key as
// POIPublicKey.TryParse reads it, none twice, none both a signing and an identity key, no identity key naming usages. What
// WWCP_POI3 takes and writes otherwise is refused, as the content holds a key only as it writes it: a property of a key
// it does not read, here; keys in another order than that of their identifications, none of a kind given as an empty
// list, and a key naming a JSON-LD context, embedded in its party, with the content (`notWrittenAsHeld`).


/** The parties of a roaming network in the order WWCP_POI3 reads them (RoamingNetwork.TryParse), as it names one. */
const PARTIES: readonly (readonly [ property: string, kind: string, article: string ])[] = [
    [ 'chargingStationManufacturers',       'charging station manufacturer',       'a'  ],
    [ 'eMobilityProviders',                 'e-mobility provider',                 'an' ],
    [ 'gridOperators',                      'grid operator',                       'a'  ],
    [ 'parkingOperators',                   'parking operator',                    'a'  ],
    [ 'transparencySoftwareManufacturers',  'transparency software manufacturer',  'a'  ],
    [ 'conformityAssessmentBodies',         'conformity assessment body',          'a'  ],
    [ 'energyMeterManufacturers',           'energy meter manufacturer',           'an' ],
    [ 'chargingStationOperators',           'charging station operator',           'a'  ],
];

/** What a key names, as POIPublicKey.TryParse reads it; WWCP_POI3 takes another property and leaves it out. */
const KEY_PROPERTIES = [ '@id', '@context', 'key', 'notBefore', 'notAfter', 'holder', 'usages' ];

/** The keys of a party. */
export interface PartyKeys {
    readonly signingKeys:   readonly POIPublicKey[];
    readonly identityKeys:  readonly POIPublicKey[];
}

/** The keys of one kind as POIJSON.TryParseObjects reads them, each as POIPublicKey.TryParse reads it, naming nothing else. */
function keysOf(party: JSONObject, property: string, description: string): POIPublicKey[] {

    const value = get(party, property);

    if (value === undefined)
        return [];

    if (!isArray(value))
        throw new POIError(`The ${description} must be a JSON array!`);

    return value.map((item: JSONValue) => {

        if (!isObject(item))
            throw new POIError(`Invalid ${description} '${compactJSON(item)}'!`);

        try {
            const key = POIPublicKey.parse(item);
            onlyProperties(item, KEY_PROPERTIES, `The public key '${key.id}'`);
            return key;
        }
        catch (e) {
            throw new POIError(`Invalid ${description} '${compactJSON(item)}': ${e instanceof Error ? e.message : String(e)}`);
        }

    });

}

/**
 * Reads the keys of the given party, e.g. "the charging station operator 'DE*GEF'", of the given kind, e.g. "a charging
 * station operator", and refuses them as WWCP_POI3 does, in its words: a key it does not read; then, as the constructor of
 * the party does, a key given twice, a key both a signing and an identity key, an identity key naming usages.
 */
export function partyKeysOf(party: JSONObject, name: string, kind: string): PartyKeys {

    const signingKeys   = keysOf(party, 'signingKeys',  'signing key');
    const identityKeys  = keysOf(party, 'identityKeys', 'identity key');

    const invalid       = (message: string): POIError =>
        new POIError(`The given JSON representation of ${kind} is invalid: ${message}`);

    // POIPublicKey.Ordered: without one given twice, in the order of their identifications.
    for (const [ keys, description ] of [ [ signingKeys, 'signing key' ], [ identityKeys, 'identity key' ] ] as const) {
        const ids = keys.map(key => key.id);
        if (new Set(ids).size !== ids.length)
            throw invalid(`An ${description} of ${name} must not be given twice!`);
    }

    const signingIds  = signingKeys.map(key => key.id).sort(ordinal);
    const identities  = [ ...identityKeys ].sort((a, b) => ordinal(a.id, b.id));

    const both = signingIds.find(id => identityKeys.some(key => key.id === id));
    if (both !== undefined)
        throw invalid(`The key '${both}' of ${name} must not be both a signing and an identity key!`);

    // Usages restrict what a signing key signs; an identity key signs changes of keys only.
    const withUsages = identities.find(key => key.usages.length > 0);
    if (withUsages !== undefined)
        throw invalid(`The identity key '${withUsages.id}' of ${name} names no usages: they are of signing keys!`);

    return { signingKeys, identityKeys };

}

/**
 * The error, when a party of the given content has keys WWCP_POI3 refuses, as it says it, of the first party it reads;
 * undefined for none. The keys of the roaming network operator are read with it (`RoamingNetworkOperator.parse`).
 */
export function invalidPartyKeys(content: JSONObject): string | undefined {

    for (const [ property, kind, article ] of PARTIES) {

        const parties = get(content, property);

        if (!isArray(parties))
            continue;

        for (const party of parties.filter(isObject)) {
            try {
                partyKeysOf(party, `the ${kind} '${asText(party['@id'])}'`, `${article} ${kind}`);
            }
            catch (e) {
                if (e instanceof POIError)
                    return e.message;
                throw e;
            }
        }

    }

    return undefined;

}
