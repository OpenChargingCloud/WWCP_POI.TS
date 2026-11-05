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

import { POIError } from '../errors.ts';
import type { EVTalerMerchant } from '../network/evTaler.ts';


// A taler://pay URI of an offer (EVTalerPayURI of WWCP_POI c2d39e5): an app handing it to a separate wallet checks at least
// that it names the merchant of the operator (concepts/EVTaler.md, 7.3): the wallet then gets the contract terms from that
// merchant, signed by its instance.


/** Whether the given text starts with the given ASCII text, without case, as `StringComparison.OrdinalIgnoreCase` compares it. */
const startsWithIgnoringCase = (text: string, start: string): boolean =>
    text.length >= start.length && text.slice(0, start.length).toUpperCase() === start.toUpperCase();

/** Whether two HTTPS base URLs are the same: the host in any case, the path as written (`EVTalerPayURI.SameBaseURL`). */
export function sameBaseURL(a: string, b: string): boolean {

    const split = (url: string): [ string, string ] | undefined => {

        if (!startsWithIgnoringCase(url, 'https://'))
            return undefined;

        const rest  = url.slice(8);
        const slash = rest.indexOf('/');

        return slash < 0
                   ? [ rest.toLowerCase(), '/' ]
                   : [ rest.slice(0, slash).toLowerCase(), rest.slice(slash) ];

    };

    const left  = split(a);
    const right = split(b);

    if (left === undefined || right === undefined)
        return false;

    return left[0] === right[0] && left[1] === right[1];

}


/**
 * A taler://pay URI of an offer, as the merchant backend gives it (`EVTalerPayURI`):
 * taler://pay/{merchant_host}{/merchant_prefix_path*}/{order_id}/{session_id}{?c=claim_token}{#ssid}.
 */
export class EVTalerPayURI {

    private constructor(
        /** The URI as given. */
        public readonly text:             string,
        /** The base URL of the merchant instance it names: https://{merchant_host}/{merchant_prefix_path}/. */
        public readonly merchantBaseURL:  string,
        public readonly orderId:          string,
        /** GNU Taler's session of the order, if any; not the session of the offers server. */
        public readonly sessionId:        string | undefined,
        public readonly claimToken:       string | undefined
    ) {}

    /**
     * Reads the given taler://pay URI (`EVTalerPayURI.TryParse`). Its scheme is read in any case, as QR codes write it in
     * upper case; taler+http://, of a merchant without HTTPS, is refused. The order and GNU Taler's session are counted from
     * the end of its path, as the merchant's path may have any number of segments. Refused in the words of WWCP_POI.
     */
    public static parse(text: string): EVTalerPayURI {

        const scheme = 'taler://pay/';

        if (!startsWithIgnoringCase(text, scheme))
            throw new POIError(startsWithIgnoringCase(text, 'taler+http://')
                                   ? 'An EV Taler offer is paid at a merchant reached with HTTPS: taler+http:// is refused!'
                                   : `'${text}' is no taler://pay URI!`);

        let rest = text.slice(scheme.length);

        const fragment = rest.indexOf('#');

        if (fragment >= 0)
            rest = rest.slice(0, fragment);

        let claimToken: string | undefined;

        const query = rest.indexOf('?');

        if (query >= 0) {

            for (const parameter of rest.slice(query + 1).split('&').filter(part => part.length > 0))
                if (parameter.startsWith('c=')) {

                    if (claimToken !== undefined || parameter.length === 2)
                        throw new POIError('A taler://pay URI names at most one claim token, not empty!');

                    claimToken = parameter.slice(2);

                }

            rest = rest.slice(0, query);

        }

        const segments = rest.split('/');
        const order    = segments[segments.length - 2] ?? '';
        const session  = segments[segments.length - 1] ?? '';

        if (segments.length < 3 || (segments[0] ?? '').length === 0 || order.length === 0 || segments.slice(0, -2).some(segment => segment.length === 0))
            throw new POIError("A taler://pay URI names the merchant's host, maybe a path, the order, and GNU Taler's session, maybe empty!");

        const host = (segments[0] ?? '').toLowerCase();
        const path = segments.slice(1, -2).map(segment => `${segment}/`).join('');

        return new EVTalerPayURI(text, `https://${host}/${path}`, order, session.length > 0 ? session : undefined, claimToken);

    }

    /** Checks that it names the merchant instance of the given EV Taler merchant: its host in any case, its path as written. */
    public verify(merchant: EVTalerMerchant): void {
        if (!sameBaseURL(this.merchantBaseURL, merchant.merchantBaseURL))
            throw new POIError(`The offer is one of the merchant '${this.merchantBaseURL}', not of the operator's '${merchant.merchantBaseURL}'!`);
    }

    public toString(): string {
        return this.text;
    }

}
