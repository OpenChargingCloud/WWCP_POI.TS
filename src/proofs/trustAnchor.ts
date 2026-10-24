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

import { cbor, decodeDeterministicCbor, encodeCbor, type CborValue } from '../encoding/cbor.ts';
import { fromBase45, fromHex, toBase45, toHex } from '../encoding/text.ts';
import { checkContext, requireArray, requireObject, requireString, CONTEXT_PREFIX } from '../common.ts';
import { get, isObject, type JSONObject, type JSONValue } from '../json/value.ts';
import { POIError } from '../errors.ts';


export const TRUST_ANCHOR_CONTEXT    = CONTEXT_PREFIX + 'roamingNetwork/trustAnchor/v2';
export const TRUST_ANCHOR_QR_PREFIX  = 'WWCP/TA-2:';


/** A multilingual text, e.g. `{"en": "Quality Assurance"}`. */
export type I18NText = Readonly<Record<string, string>>;


/**
 * What a verifier pins of a roaming network (SPECIFICATION.md section 8.6), e.g. from a QR code on the website or in the
 * contract documents of its operator: the URLs below which its proofs are served, the `@id`s of the identity keys of its
 * operator and its `minConsensus`, and its name and description to show.
 *
 * Only the `@id`s and `minConsensus` are trusted. The texts to show are those of a verified proof; a verifier warns where
 * the trust anchor names the network otherwise.
 */
export class TrustAnchor {

    private constructor(
        public readonly id:            string,
        public readonly urls:          readonly string[],
        public readonly keys:          readonly string[],
        public readonly minConsensus:  number,
        public readonly name:          I18NText,
        public readonly description:   I18NText
    ) {}


    /** Makes a trust anchor, checked as one read would be. */
    public static create(id: string, urls: readonly string[], keys: readonly string[], minConsensus = 1, name: I18NText = {}, description: I18NText = {}): TrustAnchor {

        const urlNetworkId = checkTrustAnchor(urls, keys, minConsensus);

        if (urlNetworkId !== id)
            throw new POIError(`The trust anchor of the roaming network '${id}' names the URL of '${urlNetworkId}'!`);

        return new TrustAnchor(id, [ ...urls ], [ ...keys ], minConsensus, { ...name }, { ...description });

    }


    /**
     * Reads a trust anchor as scanned: the text of its QR code, `WWCP/TA-2:` and the Base45 of its deterministic CBOR, or
     * its URL, `https://…/RNs/{RN_Id}?keys=<@id>,<@id>&minConsensus=2&alsoAt=<escaped URL>`.
     */
    public static parse(text: string): TrustAnchor {

        const trimmed = text.trim();

        if (trimmed.startsWith(TRUST_ANCHOR_QR_PREFIX)) {

            let bytes: Uint8Array;

            try {
                bytes = fromBase45(trimmed.slice(TRUST_ANCHOR_QR_PREFIX.length));
            }
            catch (e) {
                throw new POIError(`The QR code of a trust anchor is not Base45: ${e instanceof Error ? e.message : String(e)}`);
            }

            return TrustAnchor.fromCbor(decodeDeterministicCbor(bytes));

        }

        if (/^https?:\/\//i.test(trimmed))
            return TrustAnchor.fromURL(trimmed);

        throw new POIError(`A trust anchor is the text of its QR code, '${TRUST_ANCHOR_QR_PREFIX}' and the Base45 of its CBOR, or its URL!`);

    }


    /** Reads the URL form of a trust anchor. */
    public static fromURL(url: string): TrustAnchor {

        const queryAt     = url.search(/[?#]/);
        const networkURL  = queryAt < 0 ? url : url.slice(0, queryAt);
        const fragmentAt  = url.indexOf('#');
        const query       = queryAt < 0 || url[queryAt] !== '?' ? '' : url.slice(queryAt + 1, fragmentAt < 0 ? url.length : fragmentAt);
        const parameters  = query.split('&').filter(parameter => parameter.length > 0).map(parameter => {
                                const at = parameter.indexOf('=');
                                return at < 0 ? [ parameter ] : [ parameter.slice(0, at), parameter.slice(at + 1) ];
                            });

        const keys         = parameters.filter(parameter => parameter.length === 2 && parameter[0] === 'keys');
        const minConsensus = parameters.filter(parameter => parameter.length === 2 && parameter[0] === 'minConsensus');
        const alsoAt       = parameters.filter(parameter => parameter.length === 2 && parameter[0] === 'alsoAt');

        if (keys.length !== 1)
            throw new POIError('A trust anchor names the identity keys once: ?keys=…!');

        let quorum = 1;

        if (minConsensus.length > 1 ||
           (minConsensus.length === 1 && (!/^[1-9][0-9]{0,2}$/.test(minConsensus[0]![1]!) || (quorum = Number(minConsensus[0]![1])) > 255)))
            throw new POIError('A trust anchor names its minConsensus at most once, as a whole number from 1 to 255!');

        const urls = [ networkURL, ...alsoAt.map(parameter => decodeURIComponent(parameter[1]!)) ];
        const ids  = decodeURIComponent(keys[0]![1]!).split(',');
        const id   = checkTrustAnchor(urls, ids, quorum);

        return new TrustAnchor(id, urls, ids, quorum, {}, {});

    }


    /** Reads the JSON form of a trust anchor. */
    public static fromJSON(value: JSONValue): TrustAnchor {

        const json = requireObject(value, 'A trust anchor');

        checkContext(json, TRUST_ANCHOR_CONTEXT, 'a trust anchor');

        const id    = requireString(json, '@id', 'The roaming network of a trust anchor');
        const urls  = requireArray(get(json, 'urls'), 'The urls of a trust anchor').map(url => {
                          if (typeof url !== 'string')
                              throw new POIError('A trust anchor names the absolute URLs of its roaming network!');
                          return url;
                      });
        const keys  = requireArray(get(json, 'keys'), 'The keys of a trust anchor').map(key => {
                          if (typeof key !== 'string')
                              throw new POIError('A trust anchor names the identity keys of the roaming network operator by their @ids!');
                          return key;
                      });

        const minConsensus = get(json, 'minConsensus') ?? 1;

        if (typeof minConsensus !== 'number' || !Number.isInteger(minConsensus) || minConsensus < 1 || minConsensus > 255)
            throw new POIError('The minConsensus of a trust anchor must be a whole number from 1 to 255!');

        return TrustAnchor.create(id, urls, keys, minConsensus, i18n(get(json, 'name')), i18n(get(json, 'description')));

    }


    /** Reads the CBOR form of a trust anchor, its keys and values those of the JSON one, the `@id`s as their 32 bytes. */
    public static fromCbor(value: CborValue): TrustAnchor {

        if (value.type !== 'map')
            throw new POIError('The CBOR representation of a trust anchor must be a map!');

        const values = new Map<string, CborValue>();

        for (const [key, item] of value.entries) {
            if (key.type !== 'text')
                throw new POIError('The CBOR representation of a trust anchor must be a map with text keys!');
            if (values.has(key.value))
                throw new POIError(`The CBOR representation of a trust anchor names '${key.value}' twice!`);
            values.set(key.value, item);
        }

        const context = values.get('@context');
        if (context !== undefined && !(context.type === 'text' && context.value === TRUST_ANCHOR_CONTEXT))
            throw new POIError(`The JSON-LD context of a trust anchor must be '${TRUST_ANCHOR_CONTEXT}'!`);

        const id = values.get('@id');
        if (id?.type !== 'text')
            throw new POIError('A trust anchor names its roaming network by its identification!');

        const urls = values.get('urls');
        if (urls?.type !== 'array' || urls.items.some(url => url.type !== 'text'))
            throw new POIError('A trust anchor names the absolute URLs of its roaming network!');

        const keys = values.get('keys');
        if (keys?.type !== 'array' || keys.items.some(key => key.type !== 'bytes' || key.value.length !== 32))
            throw new POIError('The identity keys of a trust anchor must be their SHA-256 thumbprints, 32 bytes each!');

        let quorum = 1;
        const minConsensus = values.get('minConsensus');
        if (minConsensus !== undefined) {
            if (minConsensus.type !== 'int' || minConsensus.value < 1n || minConsensus.value > 255n)
                throw new POIError('The minConsensus of a trust anchor must be a whole number from 1 to 255!');
            quorum = Number(minConsensus.value);
        }

        return TrustAnchor.create(id.value,
                                  urls.items.map(url => (url as { value: string }).value),
                                  keys.items.map(key => toHex((key as { value: Uint8Array }).value)),
                                  quorum,
                                  i18nOfCbor(values.get('name')),
                                  i18nOfCbor(values.get('description')));

    }


    /** The JSON form. */
    public toJSON(): JSONObject {

        const json: JSONObject = {
            '@id':       this.id,
            '@context':  TRUST_ANCHOR_CONTEXT,
            urls:        [ ...this.urls ],
            keys:        [ ...this.keys ],
        };

        if (Object.keys(this.name).length > 0)
            json['name'] = { ...this.name };

        if (Object.keys(this.description).length > 0)
            json['description'] = { ...this.description };

        if (this.minConsensus > 1)
            json['minConsensus'] = this.minConsensus;

        return json;

    }

    /** The deterministic CBOR of its keys and values, the `@id`s as their 32 bytes. */
    public toCbor(): Uint8Array {

        const entries: Array<readonly [CborValue, CborValue]> = [
            [ cbor.text('@id'),      cbor.text(this.id) ],
            [ cbor.text('@context'), cbor.text(TRUST_ANCHOR_CONTEXT) ],
            [ cbor.text('urls'),     cbor.array(this.urls.map(url => cbor.text(url))) ],
            [ cbor.text('keys'),     cbor.array(this.keys.map(key => cbor.bytes(fromHex(key, true)))) ],
        ];

        if (Object.keys(this.name).length > 0)
            entries.push([ cbor.text('name'), cbor.map(Object.entries(this.name).map(([language, text]) => [ cbor.text(language), cbor.text(text) ] as const)) ]);

        if (Object.keys(this.description).length > 0)
            entries.push([ cbor.text('description'), cbor.map(Object.entries(this.description).map(([language, text]) => [ cbor.text(language), cbor.text(text) ] as const)) ]);

        if (this.minConsensus > 1)
            entries.push([ cbor.text('minConsensus'), cbor.int(BigInt(this.minConsensus)) ]);

        return encodeCbor(cbor.map(entries));

    }

    /** The text of its QR code. */
    public toQRCode(): string {
        return TRUST_ANCHOR_QR_PREFIX + toBase45(this.toCbor());
    }

    /** Its URL form, without name and description. */
    public toURL(): string {
        return `${this.urls[0]}?keys=${this.keys.join(',')}` +
               (this.minConsensus > 1 ? `&minConsensus=${this.minConsensus}` : '') +
               this.urls.slice(1).map(url => `&alsoAt=${encodeURIComponent(url)}`).join('');
    }

}


function i18n(value: JSONValue | undefined): I18NText {

    if (value === undefined)
        return {};

    if (!isObject(value) || Object.values(value).some(text => typeof text !== 'string'))
        throw new POIError('The name and the description of a trust anchor are multilingual texts!');

    return value as Record<string, string>;

}

function i18nOfCbor(value: CborValue | undefined): I18NText {

    if (value === undefined)
        return {};

    if (value.type !== 'map' || value.entries.some(([language, text]) => language.type !== 'text' || text.type !== 'text'))
        throw new POIError('The name and the description of a trust anchor are multilingual texts!');

    return Object.fromEntries(value.entries.map(([language, text]) => [ (language as { value: string }).value, (text as { value: string }).value ]));

}


const URL_PATTERN = /^(https?):\/\/([^/?#\s]+)(\/[^?#\s]*)?$/i;

/**
 * Checks URLs, keys and quorum of a trust anchor as `TryCheck` of the C# implementation, and returns the roaming network
 * the URLs name: at least one URL, each once, http or https, each the one of the same roaming network, `~/RNs/{RN_Id}`,
 * without a query; at least one key `@id` of 64 lowercase hexadecimal digits, each once; `minConsensus` from 1 to the
 * number of keys.
 */
function checkTrustAnchor(urls: readonly string[], keys: readonly string[], minConsensus: number): string {

    if (urls.length === 0)
        throw new POIError('A trust anchor names at least one URL of its roaming network!');

    if (new Set(urls).size !== urls.length)
        throw new POIError('A trust anchor names each URL of its roaming network once!');

    let networkId: string | undefined;

    for (const url of urls) {

        const match = URL_PATTERN.exec(url);

        if (match === null)
            throw new POIError(`The URL '${url}' of a trust anchor is no http or https URL of a roaming network, ~/RNs/{RN_Id}, without a query!`);

        const segments = (match[3] ?? '').replace(/\/+$/, '').split('/');

        if (segments.length < 2 || segments[segments.length - 2] !== 'RNs' || segments[segments.length - 1]!.length === 0)
            throw new POIError(`The URL '${url}' of a trust anchor is not the one of a roaming network, ~/RNs/{RN_Id}, without a query!`);

        const urlNetworkId = decodeURIComponent(segments[segments.length - 1]!);

        if (networkId === undefined)
            networkId = urlNetworkId;

        else if (urlNetworkId !== networkId)
            throw new POIError(`The URLs of a trust anchor name one roaming network, not '${networkId}' and '${urlNetworkId}'!`);

    }

    if (keys.length === 0 || keys.some(key => !/^[0-9a-f]{64}$/.test(key)) || new Set(keys).size !== keys.length)
        throw new POIError('A trust anchor names at least one identity key by its @id, 64 lowercase hexadecimal digits, each once!');

    if (minConsensus < 1 || minConsensus > keys.length)
        throw new POIError(`The minConsensus ${minConsensus} of a trust anchor needs as many identity keys, not ${keys.length}!`);

    return networkId!;

}
