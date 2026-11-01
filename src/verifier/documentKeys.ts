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

import { requireString }                     from '../common.ts';
import type { JSONValue }                    from '../json/value.ts';
import { ChargingStationProof }              from '../proofs/stationProof.ts';
import type { TrustContext }                 from '../proofs/trustContext.ts';
import type { HistoricalTrustContext }       from './historicalMeasurements.ts';
import { historicalOperatorContext }         from './historicalMeasurements.ts';
import { verifyChargingStation }             from './chargingStation.ts';
import { POIError }                          from '../errors.ts';


/** Library extension: this usage authorizes charging transparency envelopes, independently of price statements. */
export const CHARGING_DOCUMENT_USAGE = 'chargeTransparencyRecords' as const;

export interface AuthorizedChargingDocumentKeys {
    readonly evseId:             string;
    readonly chargingStationId:  string;
    readonly operatorId:         string;
    readonly at:                 number;
    readonly commitId:           string;
    readonly revision:           number;
    readonly keys:               readonly {
        readonly id:         string;
        readonly algorithm:  string;
        readonly encodings:  readonly string[];
        readonly value:      string;
        readonly keyUsage:   readonly string[];
    }[];
}

/** The names of the algorithms of the COSE curves of the keys, as the envelope verifier names them. */
const ALGORITHMS: Readonly<Record<number, string>> = {
    1: 'ECDSA-secp256r1',
    2: 'ECDSA-secp384r1',
    3: 'ECDSA-secp521r1',
    6: 'EdDSA-Ed25519',
    7: 'EdDSA-Ed448',
    8: 'ECDSA-secp256k1',
};

/** Authentication and key normalization are shared by web, desktop and mobile callers. No envelope-supplied key is an authority input. */
export function verifyChargingDocumentKeys(context:  TrustContext | HistoricalTrustContext,
                                           proof:    JSONValue,
                                           request:  { readonly evseId: string, readonly operatorId: string, readonly at: number }): AuthorizedChargingDocumentKeys {

    if (!Number.isFinite(request.at) || request.at > context.evaluatedAt)
        throw new POIError('Invalid charging-document evaluation time');

    const parsed      = ChargingStationProof.parse(proof);
    const historical  = historicalOperatorContext(context, parsed.roamingNetwork['operator'] ?? null, request.at);
    const station     = verifyChargingStation(historical, parsed, { evseId: request.evseId });

    if (station.operator['@id'] !== request.operatorId)
        throw new POIError('The live document CPO is not the operator of the proven EVSE');

    const keys = station.operatorSigningKeys.filter(key => key.isValidAt(request.at) && key.maySign(CHARGING_DOCUMENT_USAGE)).map(key => {

        const algorithm = key.key.curve === null ? key.key.algorithm?.name : ALGORITHMS[key.key.curve.id];

        if (algorithm === undefined)
            throw new POIError('Unsupported CPO charging-document key algorithm');

        return { id: key.id, algorithm, encodings: [ 'COSE_Key', 'CBOR', 'base64' ], value: requireString(key.json, 'key'), keyUsage: [ 'signCTRs' ] };

    });

    if (keys.length === 0)
        throw new POIError('The proven CPO supplies no valid keys authorized for charging transparency records');

    return { evseId:             request.evseId,
             chargingStationId:  requireString(station.chargingStation, '@id'),
             operatorId:         request.operatorId,
             at:                 request.at,
             commitId:           station.commitId,
             revision:           station.revision,
             keys };

}
