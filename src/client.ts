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

import { parseJSON }                      from './json/parse.ts';
import type { JSONValue }                 from './json/value.ts';
import { TrustAnchor }                    from './proofs/trustAnchor.ts';
import { verifyChargingStation, verifyPriceStatements, type VerifiedChargingStation, type VerifiedPrice } from './verifier/chargingStation.ts';
import { POIError }                       from './errors.ts';


/** The `fetch` this client uses: the global one by default, any compatible one otherwise. */
export type Fetch = (url: string, init?: { headers?: Record<string, string>, signal?: AbortSignal }) => Promise<{ ok: boolean, status: number, text(): Promise<string> }>;


/** What an app gets for a charging station it selected: checked, and kept as it came, as evidence. */
export interface CheckedChargingStation {
    readonly station:     VerifiedChargingStation;
    /** The current price statements of the pool, the station and its EVSEs, by `EntityType:EntityId`. */
    readonly prices:      ReadonlyMap<string, VerifiedPrice>;
    /** When it was checked. */
    readonly checkedAt:   string;
    /** The server it came from. */
    readonly source:      string;
    /** The documents as they came, to keep as evidence of the session (see `verifyEvidence`). */
    readonly documents:   { readonly chargingStationProof: JSONValue, readonly priceStatements: JSONValue };
}


/**
 * Downloads what an app needs to show a charging station and its prices, from the servers of a roaming network its trust
 * anchor names (SPECIFICATION.md sections 8.4, 8.6 and 12.5), and checks it against the trust anchor: the proof of the
 * charging station and the current price statements of its pool, its station and its EVSEs. No server needs to be trusted:
 * where one does not answer, or answers with something that does not verify, the next one is asked.
 */
export class POIClient {

    private readonly anchor: TrustAnchor;
    private readonly fetch:  Fetch;

    constructor(trustAnchor: TrustAnchor | string, options: { fetch?: Fetch } = {}) {

        this.anchor  = typeof trustAnchor === 'string' ? TrustAnchor.parse(trustAnchor) : trustAnchor;

        const global = (globalThis as { fetch?: Fetch }).fetch;
        const fetch  = options.fetch ?? global;

        if (fetch === undefined)
            throw new POIError('No fetch is given, and this platform has none!');

        this.fetch = fetch;

    }

    public get trustAnchor(): TrustAnchor {
        return this.anchor;
    }


    /** Gets a JSON document below the given URL of the roaming network. */
    private async get(url: string, path: string, signal?: AbortSignal): Promise<JSONValue> {

        const response = await this.fetch(url.replace(/\/+$/, '') + path, { headers: { Accept: 'application/json' }, ...(signal !== undefined ? { signal } : {}) });

        if (!response.ok)
            throw new POIError(`HTTP ${response.status}`);

        return parseJSON(await response.text());

    }


    /**
     * The charging station of the given EVSE (or the given charging station), with its prices, checked at `at`, now by
     * default: `GET ~/RNs/{RN_Id}/EVSEs/{EVSE_Id}/proof` and `…/priceStatements`, or `~/RNs/{RN_Id}/CSs/{CS_Id}/…`.
     */
    public async chargingStation(id: { evseId: string } | { chargingStationId: string },
                                 options: { at?: number | Date | string, signal?: AbortSignal } = {}): Promise<CheckedChargingStation> {

        const at        = options.at ?? Date.now();
        const base      = 'evseId' in id ? `/EVSEs/${encodeURIComponent(id.evseId)}` : `/CSs/${encodeURIComponent(id.chargingStationId)}`;
        const errors:   string[] = [];

        // The servers in their order, the preferred one first: one answering with something that does not verify is just
        // another one not answering.
        for (const source of this.anchor.urls) {

            try {

                const proof       = await this.get(source, `${base}/proof`, options.signal);
                const station     = verifyChargingStation(this.anchor, proof, { at, ...('evseId' in id ? { evseId: id.evseId } : { chargingStationId: id.chargingStationId }) });
                const statements  = await this.get(source, `${base}/priceStatements`, options.signal);

                return {
                    station,
                    prices:     verifyPriceStatements(station, statements, { at }),
                    checkedAt:  new Date(typeof at === 'string' ? Date.parse(at) : at).toISOString(),
                    source,
                    documents:  { chargingStationProof: proof, priceStatements: statements },
                };

            }
            catch (e) {
                errors.push(`${source}: ${e instanceof Error ? e.message : String(e)}`);
            }

        }

        throw new POIError(`No server of the roaming network '${this.anchor.id}' gave a proof and price statements that verify: ${errors.join('; ')}`);

    }

}
