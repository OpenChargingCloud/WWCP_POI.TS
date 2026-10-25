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
import { asText, get, isArray, isObject, type JSONObject, type JSONValue } from '../json/value.ts';
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
    /** The manufacturer the station names, with the model it names, as the proof gives them. */
    readonly manufacturer:    Manufactured | undefined;
    /** The energy meters of the station and its EVSEs, with their public keys, for transparency software. */
    readonly energyMeters:    readonly JSONObject[];
    /** The manufacturer and the model each energy meter names, as the proof gives them, by the identification of the meter. */
    readonly energyMeterModels: ReadonlyMap<string, Manufactured>;
    /** Who checks the meters: the transparency software each energy meter names, with its certificate, as the proof gives them. */
    readonly transparencySoftware: readonly MeterTransparencySoftware[];

    readonly commitId:        string;
    readonly revision:        number;
    readonly eTag:            ETag;
    readonly attestedBy:      readonly string[];
    /** Where the trust anchor names the network otherwise than the proof, and other things worth telling. */
    readonly warnings:        readonly string[];

}


/**
 * The manufacturer a charging station or an energy meter names by its `manufacturerId`, and the model it names by its
 * `modelId`, unique within its manufacturer: as the manufacturer states it, attested with the station.
 */
export interface Manufactured {
    /** The manufacturer, as its skeleton: its own properties and keys. */
    readonly manufacturer:  JSONObject;
    /** The model, e.g. its versions and ratings; none where the station or meter names none, or the proof gives none. */
    readonly model:         JSONObject | undefined;
}


/**
 * A transparency software an energy meter names (`transparencySoftwareStatus`), as the proof of its station gives it
 * (example A13): the release in the skeleton of its transparency software manufacturer, and the certificate it is given
 * with in the skeleton of the conformity assessment body issuing it. POI proves who states them, not that they are true.
 */
export interface MeterTransparencySoftware {
    readonly energyMeterId:  string;
    /** The legal status the meter's values are checked under, e.g. `germanCalibrationLaw`. */
    readonly legalStatus:    string | undefined;
    /** The release, as its manufacturer states it: name, version, licenses, support period, declaration of conformity, bill of materials. */
    readonly release:        JSONObject;
    /** Its manufacturer, as its skeleton: its own properties, e.g. its role under the CRA and where vulnerabilities are reported. */
    readonly manufacturer:   JSONObject;
    readonly certificate:    JSONObject | undefined;
    /** The conformity assessment body that issued the certificate, as its skeleton. */
    readonly body:           JSONObject | undefined;
    /**
     * Whether the body has keys of its own. A body without keys signed none of its certificates: the roaming network operator
     * stated them in its place. One with keys may have got them after the certificate was stated: who signed it, the commits
     * tell, not the proof (example A13, docs/csharp-review.md).
     */
    readonly bodyHasKeys:    boolean | undefined;
    /**
     * Whether the certificate is for the model of the station: its `modelId` and its `manufacturerId`, the model as its
     * manufacturer states it with the version the certificate names. A station names no version of its model: whether it
     * is of the version certified, the proof does not tell (docs/csharp-review.md, 16).
     */
    readonly forThisModel:   boolean | undefined;
}


const objects = (value: JSONValue | undefined): JSONObject[] =>
    isArray(value) ? value.filter(isObject) : [];

const textOf = (object: JSONObject, property: string): string | undefined =>
    typeof get(object, property) === 'string' ? get(object, property) as string : undefined;


const skeletonOf = (party: JSONObject, children: string): JSONObject => {
    const { [children]: _, ...own } = party;
    return own;
};


/**
 * The manufacturer what is given names, with the model it names, from the manufacturers the proof gives in the given
 * array of the roaming network: a charging station manufacturer or an energy meter manufacturer.
 */
function manufacturedAs(attested: JSONObject, named: JSONObject, what: string, manufacturers: string, models: string, warnings: string[]): Manufactured | undefined {

    const manufacturerId  = textOf(named, 'manufacturerId');
    const modelId         = textOf(named, 'modelId');

    if (manufacturerId === undefined)
        return undefined;

    const manufacturer = objects(get(attested, manufacturers)).find(item => item['@id'] === manufacturerId);

    if (manufacturer === undefined) {
        warnings.push(`the manufacturer '${manufacturerId}' of ${what} is not given by the proof`);
        return undefined;
    }

    const model = modelId === undefined ? undefined : objects(get(manufacturer, models)).find(item => item['@id'] === modelId);

    if (modelId !== undefined && model === undefined)
        warnings.push(`the model '${modelId}' of ${what} is not given by the proof`);

    return { manufacturer: skeletonOf(manufacturer, models), model };

}


/** The transparency software the given energy meters name, from the releases and certificates the proof gives. */
function transparencySoftwareOf(attested: JSONObject, station: JSONObject, model: JSONObject | undefined, energyMeters: readonly JSONObject[], warnings: string[]): MeterTransparencySoftware[] {

    const releases      = objects(get(attested, 'transparencySoftwareManufacturers')).flatMap(manufacturer =>
                              objects(get(manufacturer, 'transparencySoftware')).map(release => ({ release, manufacturer })));

    const certificates  = objects(get(attested, 'conformityAssessmentBodies')).flatMap(body =>
                              objects(get(body, 'transparencySoftwareCertificates')).map(certificate => ({ certificate, body })));

    const versions      = model !== undefined && isArray(get(model, 'versions'))
                              ? (get(model, 'versions') as JSONValue[]).filter((version): version is string => typeof version === 'string')
                              : [];

    const result: MeterTransparencySoftware[] = [];

    for (const meter of energyMeters)
        for (const assignment of objects(get(meter, 'transparencySoftwareStatus'))) {

            const meterId        = asText(meter['@id']);
            const releaseId      = textOf(assignment, 'transparencySoftwareId');
            const certificateId  = textOf(assignment, 'certificateId');
            const release        = releases.find(item => item.release['@id'] === releaseId);
            const certificate    = certificateId === undefined ? undefined : certificates.find(item => item.certificate['@id'] === certificateId);

            if (release === undefined) {
                warnings.push(`the transparency software '${releaseId ?? ''}' of the energy meter '${meterId}' is not given by the proof`);
                continue;
            }

            if (certificateId !== undefined && certificate === undefined)
                warnings.push(`the certificate '${certificateId}' of the energy meter '${meterId}' is not given by the proof`);

            result.push({
                energyMeterId:  meterId,
                legalStatus:    textOf(assignment, 'legalStatus'),
                release:        release.release,
                manufacturer:   skeletonOf(release.manufacturer, 'transparencySoftware'),
                certificate:    certificate?.certificate,
                body:           certificate === undefined ? undefined : skeletonOf(certificate.body, 'transparencySoftwareCertificates'),
                bodyHasKeys:    certificate === undefined ? undefined : isArray(get(certificate.body, 'signingKeys')) && (get(certificate.body, 'signingKeys') as JSONValue[]).length > 0,
                forThisModel:   certificate === undefined
                                    ? undefined
                                    : textOf(certificate.certificate, 'chargingStationModel')          === textOf(station, 'modelId') &&
                                      textOf(certificate.certificate, 'chargingStationManufacturerId') === textOf(station, 'manufacturerId') &&
                                      versions.includes(textOf(certificate.certificate, 'chargingStationModelVersion') ?? ''),
            });

        }

    return result;

}


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

    const [ only ] = match;

    if (only === undefined || match.length !== 1)
        throw new POIError(match.length === 0
                               ? `The proof gives no charging station${options.chargingStationId !== undefined ? ` '${options.chargingStationId}'` : ''}${options.evseId !== undefined ? ` of the EVSE '${options.evseId}'` : ''} completely!`
                               : 'The proof gives more than one charging station: name the one to show!');

    const { operator, pool, station } = only;
    const evses   = objects(get(station, 'EVSEs'));
    const tariffs = new Map<string, JSONObject[]>();
    const given   = objects(get(operator, 'chargingTariffs'));

    for (const evse of evses) {

        const ids = isArray(get(evse, 'chargingTariffIds')) ? (get(evse, 'chargingTariffIds') as JSONValue[]).filter((id): id is string => typeof id === 'string') : [];
        const taken: JSONObject[] = [];

        for (const id of ids) {
            const tariff = given.find(item => item['@id'] === id);
            if (tariff === undefined)
                warnings.push(`the charging tariff '${id}' of the EVSE '${asText(evse['@id'])}' is not given by the proof`);
            else
                taken.push(tariff);
        }

        tariffs.set(asText(evse['@id']), taken);

    }

    const energyMeters = [
        ...objects(get(station, 'energyMeters')),
        ...evses.map(evse => get(evse, 'energyMeter')).filter(isObject),
    ];

    const manufacturer       = manufacturedAs(attested, station, `the charging station '${asText(station['@id'])}'`, 'chargingStationManufacturers', 'chargingStationModels', warnings);
    const energyMeterModels  = new Map<string, Manufactured>();

    for (const meter of energyMeters) {
        const manufactured = manufacturedAs(attested, meter, `the energy meter '${asText(meter['@id'])}'`, 'energyMeterManufacturers', 'energyMeterModels', warnings);
        if (manufactured !== undefined)
            energyMeterModels.set(asText(meter['@id']), manufactured);
    }

    for (const [kind, shown, proven] of [ [ 'name', anchor.name, get(attested, 'name') ], [ 'description', anchor.description, get(attested, 'description') ] ] as const)
        for (const [language, text] of Object.entries(shown))
            if (!isObject(proven) || get(proven, language) !== text)
                warnings.push(`the trust anchor shows the ${kind} '${text}' (${language}), not the one of the network in the proof`);

    return {
        roamingNetwork: {
            id:          asText(attested['@id']),
            name:        firstText(get(attested, 'name')),
            description: firstText(get(attested, 'description')),
        },
        operator,
        chargingPool:         pool,
        chargingStation:      station,
        evses,
        tariffs,
        operatorSigningKeys:  POIPublicKey.parseAll(get(operator, 'signingKeys'), `signing keys of the charging station operator '${asText(operator['@id'])}'`),
        manufacturer,
        energyMeters,
        energyMeterModels,
        transparencySoftware: transparencySoftwareOf(attested, station, manufacturer?.model, energyMeters, warnings),
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
 * each entity valid at `at`, now by default, where there is one, and its key valid then as well: a statement is valid
 * no longer than its key, whatever its `signedAt` says (12.1).
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
    const operatorId = asText(station.operator['@id']);
    const entities   = new Map<string, { type: string, tariffs: Set<string> | undefined }>([
        [ `ChargingPool:${asText(station.chargingPool['@id'])}`,     { type: 'ChargingPool',    tariffs: undefined } ],
        [ `ChargingStation:${asText(station.chargingStation['@id'])}`, { type: 'ChargingStation', tariffs: undefined } ],
        ...station.evses.map(evse => [ `EVSE:${asText(evse['@id'])}`, { type: 'EVSE', tariffs: new Set((station.tariffs.get(asText(evse['@id'])) ?? []).map(tariff => asText(tariff['@id']))) } ] as const),
    ]);

    const byEntity   = new Map<string, PriceStatement[]>();
    const signedWith = new Map<string, POIPublicKey>();

    for (const item of list) {

        const statement = PriceStatement.parse(item);
        const key       = `${statement.entityType}:${statement.entityId}`;
        const entity    = entities.get(key);

        if (entity === undefined)
            throw new POIError(`The price statement of the ${statement.entityType} '${statement.entityId}' is none of the station, its pool or its EVSEs!`);

        signedWith.set(statement.digestHex(), statement.verify(station.roamingNetwork.id, operatorId, station.operatorSigningKeys));

        // The prices of an EVSE apply to the charging tariffs the proof gives, those of the EVSE (12.4).
        if (entity.tariffs !== undefined)
            for (const price of statement.prices)
                if (!entity.tariffs.has(asText(price['chargingTariffId'])))
                    throw new POIError(`The price statement of the EVSE '${statement.entityId}' names the charging tariff '${asText(price['chargingTariffId'])}', which is not one of its own!`);

        // A statement given again, also as its ECDSA twin, is that statement, not a second one of its sequence.
        const known = byEntity.get(key) ?? [];
        if (!known.some(other => other.digestHex() === statement.digestHex()))
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

        // The latest statement valid now: a later one replaces it from its validFrom on. Valid no longer than its key.
        const valid = [ ...chain ].reverse().find(statement => statement.validFrom <= time);

        if (valid?.isValidAt(time) === true && signedWith.get(valid.digestHex())?.isValidAt(time) === true)
            current.set(key, { statement: valid, digest: valid.digestHex() });

    }

    return current;

}
