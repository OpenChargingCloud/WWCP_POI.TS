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

import { firstText, timeOf }                from '../common.ts';
import { get, isArray, isObject, type JSONObject, type JSONValue } from '../json/value.ts';
import type { ETag }                        from '../etags.ts';
import { POIPublicKey }                     from '../keys.ts';
import { ChargingStationProof }             from '../proofs/stationProof.ts';
import { PriceStatement, verifyPriceStatementChain } from '../proofs/priceStatement.ts';
import type { TrustAnchor }                 from '../proofs/trustAnchor.ts';
import { POIError }                         from '../errors.ts';


/** A charging station as a verified proof gives it: everything here is attested by the roaming network operator. */
export interface VerifiedChargingStation {

    readonly roamingNetwork:  { readonly id: string, readonly name: string | undefined, readonly description: string | undefined };
    /** The charging station operator, as its skeleton: its own properties and keys, its child arrays as far as given. */
    readonly operator:        JSONObject;
    /** The charging pool of the station, as its skeleton. */
    readonly chargingPool:    JSONObject;
    /** The charging station as it is at runtime (9.2): with the properties of its templates, and its effective EVSEs. */
    readonly chargingStation: JSONObject;
    readonly evses:           readonly JSONObject[];
    /** The charging tariffs each EVSE takes, by the identification of the EVSE, as the proof gives them. */
    readonly tariffs:         ReadonlyMap<string, readonly JSONObject[]>;
    /** The signing keys of the operator, which sign its price statements. */
    readonly operatorSigningKeys: readonly POIPublicKey[];
    /** The energy meters of the station and its EVSEs, with their public keys, for transparency software. */
    readonly energyMeters:    readonly JSONObject[];

    readonly commitId:        string;
    readonly revision:        number;
    readonly eTag:            ETag;
    readonly attestedBy:      readonly string[];
    /** Where the trust anchor names the network otherwise than the proof, and other things worth telling. */
    readonly warnings:        readonly string[];

}


const objects = (value: JSONValue | undefined): JSONObject[] =>
    isArray(value) ? value.filter(isObject) : [];


/**
 * Verifies the proof of a charging station against a trust anchor (SPECIFICATION.md sections 8.4 to 8.6) and returns what
 * it attests: the roaming network, the operator, the pool, the station with its EVSEs as they are at runtime, the charging
 * tariffs they take, and the signing keys of the operator. With `chargingStationId` or `evseId`, the proof must give that
 * station, or the station of that EVSE.
 */
export function verifyChargingStation(anchor:   TrustAnchor,
                                      proof:    JSONValue | ChargingStationProof,
                                      options:  { at?: number | Date | string, chargingStationId?: string, evseId?: string } = {}): VerifiedChargingStation {

    const parsed    = proof instanceof ChargingStationProof ? proof : ChargingStationProof.parse(proof);
    const verified  = parsed.verify(anchor, options.at);
    const attested  = verified.attested;
    const warnings: string[] = [];

    // The station the proof gives completely: below a given operator and pool.
    const found: Array<{ operator: JSONObject, pool: JSONObject, station: JSONObject }> = [];

    for (const operator of objects(get(attested, 'chargingStationOperators')))
        for (const pool of objects(get(operator, 'chargingPools')))
            for (const station of objects(get(pool, 'chargingStations')))
                if (isArray(get(station, 'EVSEs')))
                    found.push({ operator, pool, station });

    const match = found.filter(({ station }) =>
                      (options.chargingStationId === undefined || station['@id'] === options.chargingStationId) &&
                      (options.evseId            === undefined || objects(get(station, 'EVSEs')).some(evse => evse['@id'] === options.evseId)));

    if (match.length !== 1)
        throw new POIError(match.length === 0
                               ? `The proof gives no charging station${options.chargingStationId !== undefined ? ` '${options.chargingStationId}'` : ''}${options.evseId !== undefined ? ` of the EVSE '${options.evseId}'` : ''} completely!`
                               : 'The proof gives more than one charging station: name the one to show!');

    const { operator, pool, station } = match[0]!;
    const evses   = objects(get(station, 'EVSEs'));
    const tariffs = new Map<string, JSONObject[]>();
    const given   = objects(get(operator, 'chargingTariffs'));

    for (const evse of evses) {

        const ids = isArray(get(evse, 'chargingTariffIds')) ? (get(evse, 'chargingTariffIds') as JSONValue[]).filter((id): id is string => typeof id === 'string') : [];
        const taken: JSONObject[] = [];

        for (const id of ids) {
            const tariff = given.find(item => item['@id'] === id);
            if (tariff === undefined)
                warnings.push(`the charging tariff '${id}' of the EVSE '${String(evse['@id'])}' is not given by the proof`);
            else
                taken.push(tariff);
        }

        tariffs.set(String(evse['@id']), taken);

    }

    const energyMeters = [
        ...objects(get(station, 'energyMeters')),
        ...evses.map(evse => get(evse, 'energyMeter')).filter(isObject),
    ];

    for (const [kind, shown, proven] of [ [ 'name', anchor.name, get(attested, 'name') ], [ 'description', anchor.description, get(attested, 'description') ] ] as const)
        for (const [language, text] of Object.entries(shown))
            if (!isObject(proven) || get(proven, language) !== text)
                warnings.push(`the trust anchor shows the ${kind} '${text}' (${language}), not the one of the network in the proof`);

    return {
        roamingNetwork: {
            id:          String(attested['@id']),
            name:        firstText(get(attested, 'name')),
            description: firstText(get(attested, 'description')),
        },
        operator,
        chargingPool:         pool,
        chargingStation:      station,
        evses,
        tariffs,
        operatorSigningKeys:  POIPublicKey.parseAll(get(operator, 'signingKeys'), `signing keys of the charging station operator '${String(operator['@id'])}'`),
        energyMeters,
        commitId:             parsed.commitId,
        revision:             parsed.revision,
        eTag:                 verified.eTag,
        attestedBy:           verified.attestedBy,
        warnings,
    };

}


/** The current price of an entity, by a verified price statement. */
export interface VerifiedPrice {
    readonly statement:  PriceStatement;
    /** The digest of the statement, which a checkpoint names and its proof proves (12.3). */
    readonly digest:     string;
}


/**
 * Verifies price statements (12.4) against what a verified proof of a charging station gives: each one of its pool, the
 * station or one of its EVSEs, signed by a signing key of the operator that may sign `priceStatements` and was valid when
 * it signed, naming only charging tariffs of that entity, the statements of one entity a chain. Returns the statement of
 * each entity valid at `at`, now by default, where there is one.
 */
export function verifyPriceStatements(station:     VerifiedChargingStation,
                                      statements:  JSONValue,
                                      options:     { at?: number | Date | string } = {}): Map<string, VerifiedPrice> {

    const list = isArray(statements)
                     ? statements
                     : isObject(statements) && isArray(get(statements, 'priceStatements'))
                           ? get(statements, 'priceStatements') as JSONValue[]
                           : undefined;

    if (list === undefined)
        throw new POIError('Price statements are an array, or {"priceStatements": [ … ]}!');

    const time       = timeOf(options.at);
    const operatorId = String(station.operator['@id']);
    const entities   = new Map<string, { type: string, tariffs: Set<string> | undefined }>([
        [ `ChargingPool:${String(station.chargingPool['@id'])}`,     { type: 'ChargingPool',    tariffs: undefined } ],
        [ `ChargingStation:${String(station.chargingStation['@id'])}`, { type: 'ChargingStation', tariffs: undefined } ],
        ...station.evses.map(evse => [ `EVSE:${String(evse['@id'])}`, { type: 'EVSE', tariffs: new Set((station.tariffs.get(String(evse['@id'])) ?? []).map(tariff => String(tariff['@id']))) } ] as const),
    ]);

    const byEntity = new Map<string, PriceStatement[]>();

    for (const item of list) {

        const statement = PriceStatement.parse(item);
        const key       = `${statement.entityType}:${statement.entityId}`;
        const entity    = entities.get(key);

        if (entity === undefined)
            throw new POIError(`The price statement of the ${statement.entityType} '${statement.entityId}' is none of the station, its pool or its EVSEs!`);

        statement.verify(station.roamingNetwork.id, operatorId, station.operatorSigningKeys);

        // The prices of an EVSE apply to the charging tariffs the proof gives, those of the EVSE (12.4).
        if (entity.tariffs !== undefined)
            for (const price of statement.prices)
                if (!entity.tariffs.has(String(price['chargingTariffId'])))
                    throw new POIError(`The price statement of the EVSE '${statement.entityId}' names the charging tariff '${String(price['chargingTariffId'])}', which is not one of its own!`);

        // An ECDSA twin of a statement given already is that statement, not a second one of its sequence.
        const known = byEntity.get(key) ?? [];
        if (!known.some(other => other.sameSignedContent(statement)))
            byEntity.set(key, [ ...known, statement ]);

    }

    const current = new Map<string, VerifiedPrice>();

    for (const [key, chain] of byEntity) {

        chain.sort((left, right) => left.sequence - right.sequence);

        if (new Set(chain.map(statement => statement.sequence)).size !== chain.length)
            throw new POIError(`Two price statements of one sequence of '${key}': a split view!`);

        // Of what is given, each statement directly after another one names its digest; gaps did not reach the caller.
        chain.forEach((statement, index) => {
            const before = chain[index - 1];
            if (before !== undefined && statement.sequence === before.sequence + 1)
                verifyPriceStatementChain([ before, statement ]);
        });

        // The latest statement valid now: a later one replaces it from its validFrom on.
        const valid = [ ...chain ].reverse().find(statement => statement.validFrom <= time);

        if (valid !== undefined && valid.isValidAt(time))
            current.set(key, { statement: valid, digest: valid.digestHex() });

    }

    return current;

}
