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

import { CoseKey } from '@vanaheimr/cose';

import { optionalString, optionalTimestamp, requireObject, CONTEXT_PREFIX } from './common.ts';
import { decodeDeterministicCbor, encodeCbor } from './encoding/cbor.ts';
import { bytesEqual, fromBase64, toHex }      from './encoding/text.ts';
import { get, isArray, type JSONObject, type JSONValue } from './json/value.ts';
import { POIError }                           from './errors.ts';


/** What a signing key may sign (SPECIFICATION.md section 4.1); a signing key naming none signs everything of its party. */
export const KeyUsages = {
    Infrastructure:   'infrastructure',
    Tariffs:          'tariffs',
    PriceStatements:  'priceStatements',
    Models:           'models',
    Software:         'software',
    Certificates:     'certificates',
    Payments:         'payments',
    Party:            'party',
} as const;

export type KeyUsage = typeof KeyUsages[keyof typeof KeyUsages];

const ALL_USAGES: readonly string[] = Object.values(KeyUsages);


export const PUBLIC_KEY_CONTEXT = CONTEXT_PREFIX + 'roamingNetwork/publicKey/v1';

/** What `Convert.FromBase64String` of .NET says of a text it can not read. */
const DOTNET_BAD_BASE64 = 'The input is not a valid Base-64 string as it contains a non-base 64 character, more than two padding characters, or an illegal character among the padding characters.';

/**
 * Whether `Convert.FromBase64String` of .NET reads the given text, though perhaps not canonically: white space left out
 * anywhere, groups of four characters of the alphabet, at most two padding characters at the end, unused bits of any value.
 */
const isDotNetBase64 = (text: string): boolean => {
    const significant = text.replace(/[ \t\r\n]/gu, '');
    return significant.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/u.test(significant);
};

/** Whether the given bytes are deterministic CBOR, written again as they are. */
const isDeterministicCbor = (bytes: Uint8Array): boolean => {
    try {
        return bytesEqual(encodeCbor(decodeDeterministicCbor(bytes)), bytes);
    }
    catch {
        return false;
    }
};


/**
 * A key of a party (SPECIFICATION.md section 4.1): a public COSE key, identified by its SHA-256 COSE Key Thumbprint
 * [RFC 9679], with its validity, its holder and what it may sign.
 */
export class POIPublicKey {

    private constructor(
        /** The SHA-256 COSE Key Thumbprint, 64 lowercase hexadecimal digits. */
        public readonly id:         string,
        public readonly key:        CoseKey,
        /** The deterministic CBOR of the COSE key, as its `key` writes it in Base64. */
        public readonly keyBytes:   Uint8Array,
        public readonly notBefore:  number | undefined,
        public readonly notAfter:   number | undefined,
        /** Who holds the private key, e.g. one of the organizations holding the keys of the roaming network operator. */
        public readonly holder:     string | undefined,
        public readonly usages:     readonly string[],
        /** The JSON it was read from. */
        public readonly json:       JSONObject
    ) {}


    /** The holder, or the empty text: keys naming no holder have one holder together (4.1). */
    public get holderOrUnnamed(): string {
        return this.holder ?? '';
    }

    /** Whether it may sign the given usage: a key naming no usages signs everything of its party. */
    public maySign(usage: KeyUsage): boolean {
        return this.usages.length === 0 || this.usages.includes(usage);
    }

    /** Whether it is valid at the given point in time, `notBefore` and `notAfter` included. */
    public isValidAt(time: number): boolean {
        return (this.notBefore === undefined || time >= this.notBefore) &&
               (this.notAfter  === undefined || time <= this.notAfter);
    }


    /**
     * Reads a key as POI writes it, `{ "@id", "key", "notBefore"?, "notAfter"?, "holder"?, "usages"? }`, and refuses it
     * unless its `@id` is its thumbprint, its key is public, deterministic CBOR in canonical Base64, its usages are known,
     * each once, in their ordinal order (4.1); in the words and order of `POIPublicKey.TryParse` of WWCP_POI3, but for a
     * timestamp not written as POI writes it and a key not in deterministic CBOR, which WWCP_POI3 takes and writes otherwise.
     * `what` names it where it is no JSON object.
     */
    public static parse(value: JSONValue | undefined, what = 'A public key'): POIPublicKey {

        const json      = requireObject(value, what);

        const id        = optionalString(json, '@id', 'The public key identification');
        const keyText   = optionalString(json, 'key', 'The public key');

        if (get(json, '@context') !== undefined && get(json, '@context') !== PUBLIC_KEY_CONTEXT)
            throw new POIError(`The JSON-LD context of the public key '${id ?? ''}' must be '${PUBLIC_KEY_CONTEXT}'!`);

        if (id === undefined || keyText === undefined)
            throw new POIError('A public key needs its identification and its key!');

        let keyBytes: Uint8Array;
        let key:      CoseKey;

        try {
            keyBytes = fromBase64(keyText);
        }
        catch {
            throw new POIError(isDotNetBase64(keyText)
                                   ? 'A public key must be given as canonical Base64!'
                                   : `Invalid public key: ${DOTNET_BAD_BASE64}`);
        }

        try {
            key = CoseKey.parse(keyBytes);
        }
        catch (e) {
            throw new POIError(`Invalid COSE key: ${e instanceof Error ? e.message : String(e)}`);
        }

        // The key as the content holds it (SPECIFICATION.md 2 and 4.1): the deterministic CBOR of its COSE key, not another
        // CBOR of the same key, which would be written again as another text than the one hashed.
        if (!isDeterministicCbor(keyBytes))
            throw new POIError(`Invalid COSE key: Invalid deterministic CBOR: the key of the public key '${id}' is not written as the deterministic CBOR of its COSE key!`);

        if (key.isPrivate)
            throw new POIError('A public key must not contain private parts!');

        const notBefore = optionalTimestamp(json, 'notBefore', `The notBefore of the key '${id}'`);
        const notAfter  = optionalTimestamp(json, 'notAfter',  `The notAfter of the key '${id}'`);

        const holder = optionalString(json, 'holder', 'The holder of a public key');

        if (holder !== undefined && (holder.length === 0 || holder.trim() !== holder))
            throw new POIError(`The holder of the public key '${id}' must be a nonempty text without leading or trailing white space!`);

        const usages: string[] = [];
        const usagesJSON = get(json, 'usages');

        if (usagesJSON !== undefined) {

            if (!isArray(usagesJSON) || usagesJSON.length === 0 || usagesJSON.some(usage => typeof usage !== 'string'))
                throw new POIError(`The usages of the public key '${id}' must be a nonempty JSON array of texts!`);

            usages.push(...usagesJSON as string[]);

            const unknown = usages.find(usage => !ALL_USAGES.includes(usage));
            if (unknown !== undefined)
                throw new POIError(`The usage '${unknown}' of the public key '${id}' is unknown: it is one of ${[...ALL_USAGES].sort().join(', ')}!`);

            if (new Set(usages).size !== usages.length)
                throw new POIError(`The public key '${id}' names each of its usages once!`);

            if (usages.some((usage, index) => { const before = usages[index - 1]; return before !== undefined && before >= usage; }))
                throw new POIError(`The usages of the public key '${id}' are written in their ordinal order!`);

        }

        // As the constructor of POIPublicKey checks it, after the usages, before the thumbprint.
        if (notBefore !== undefined && notAfter !== undefined && notBefore > notAfter)
            throw new POIError('Invalid public key: A public key must not expire before it becomes valid!');

        let thumbprint: string;

        try {
            thumbprint = toHex(key.thumbprint('sha256'));
        }
        catch (e) {
            throw new POIError(`Invalid public key: ${e instanceof Error ? e.message : String(e)}`);
        }

        if (thumbprint !== id)
            throw new POIError(`The identification '${id}' of a public key is not its thumbprint '${thumbprint}'!`);

        return new POIPublicKey(id, key, keyBytes, notBefore, notAfter, holder, usages, json);

    }


    /** Reads an array of keys, refusing a key given twice. */
    public static parseAll(value: JSONValue | undefined, what: string): POIPublicKey[] {

        if (value === undefined)
            return [];

        if (!isArray(value))
            throw new POIError(`The ${what} must be a JSON array!`);

        const keys = value.map(item => POIPublicKey.parse(item, `A key of the ${what}`));

        if (new Set(keys.map(key => key.id)).size !== keys.length)
            throw new POIError(`A key of the ${what} must not be given twice!`);

        return keys;

    }

}
