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

import { cbor, decode, encode, type CborValue } from '@vanaheimr/metrological-cbor';

import { Decimal }                                         from '../json/decimal.ts';
import { isObject, normalizeNumber, set, type JSONObject, type JSONValue } from '../json/value.ts';
import { POIError }                                        from '../errors.ts';


/** CBOR tag 4, a decimal fraction `[exponent, mantissa]` (RFC 8949 section 3.4.4). */
export const DECIMAL_FRACTION_TAG = 4n;


/**
 * The CBOR data item of a JSON document as Styx's `CBORJSON.ToCBOR` makes it with its default options (Styx section 3):
 * objects as maps with text keys, strings as text strings (never guessed to be readings or points in time), a number
 * with decimal places as a decimal fraction `4([-scale, mantissa])`, one without as the integer it equals, a bignum where
 * it is beyond 64 bits.
 */
export function jsonToCbor(value: JSONValue): CborValue {

    if (value === null)
        return cbor.nullValue;

    if (typeof value === 'boolean')
        return cbor.bool(value);

    if (typeof value === 'string')
        return cbor.text(value);

    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value))
            throw new POIError(`The number ${value} is no safe integer: give it as a Decimal!`);
        return cbor.int(BigInt(value));
    }

    if (value instanceof Decimal)
        return value.scale === 0
                   ? cbor.int(value.mantissa)
                   : cbor.tag(DECIMAL_FRACTION_TAG, cbor.array([ cbor.int(BigInt(-value.scale)), cbor.int(value.mantissa) ]));

    if (Array.isArray(value))
        return cbor.array(value.map(jsonToCbor));

    if (isObject(value))
        return cbor.map(Object.entries(value).map(([property, item]) => [ cbor.text(property), jsonToCbor(item) ] as const));

    throw new POIError(`A ${typeof value} has no CBOR representation here!`);

}


/**
 * The deterministic CBOR of a JSON document (Styx section 3): RFC 8949 core deterministic encoding, the keys of a map in
 * the bytewise lexicographic order of their encodings.
 */
export function deterministicCbor(value: JSONValue): Uint8Array {
    return encode(jsonToCbor(value));
}


/**
 * The JSON document of a CBOR data item, as Styx's `CBORJSON.ToJSON` converts it back: a decimal fraction becomes a
 * decimal with its decimal places. Byte strings, other tags and floating-point numbers have no JSON representation here.
 */
export function cborToJson(value: CborValue): JSONValue {

    switch (value.type) {

        case 'null':  return null;
        case 'bool':  return value.value;
        case 'text':  return value.value;
        case 'int':   return normalizeNumber(new Decimal(value.value, 0));

        case 'array': return value.items.map(cborToJson);

        case 'map': {
            const object: JSONObject = {};
            for (const [key, item] of value.entries) {
                if (key.type !== 'text')
                    throw new POIError('A CBOR map with keys other than texts has no JSON representation!');
                if (Object.prototype.hasOwnProperty.call(object, key.value))
                    throw new POIError(`A CBOR map names '${key.value}' twice!`);
                set(object, key.value, cborToJson(item));
            }
            return object;
        }

        case 'tag':
            if (value.tag === DECIMAL_FRACTION_TAG && value.value.type === 'array' && value.value.items.length === 2) {
                const [exponent, mantissa] = value.value.items;
                if (exponent?.type === 'int' && mantissa?.type === 'int' && exponent.value <= 0n)
                    return normalizeNumber(new Decimal(mantissa.value, Number(-exponent.value)));
            }
            throw new POIError(`The CBOR tag ${value.tag} has no JSON representation here!`);

        default:
            throw new POIError(`A CBOR ${value.type} has no JSON representation here!`);

    }

}


/** Decodes deterministic CBOR strictly: what a deterministic encoder would not have written is refused. */
export function decodeDeterministicCbor(bytes: Uint8Array): CborValue {

    try {
        return decode(bytes, { strict: true });
    }
    catch (e) {
        throw new POIError(`Invalid deterministic CBOR: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }

}

export { encode as encodeCbor, cbor, type CborValue };
