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


// Hexadecimal, Base64 and Base45 without Buffer, so that the library runs in browsers and React Native as in Node.


const HEX = '0123456789abcdef';

/** Lowercase hexadecimal digits, as POI writes digests and identifications. */
export function toHex(bytes: Uint8Array): string {
    let result = '';
    for (const byte of bytes)
        result += HEX.charAt(byte >> 4) + HEX.charAt(byte & 0x0F);
    return result;
}

/** Reads hexadecimal digits; with `lowercase`, only lowercase ones, as POI requires of identifications. */
export function fromHex(text: string, lowercase = false): Uint8Array {

    if (text.length % 2 !== 0 || !(lowercase ? /^[0-9a-f]*$/ : /^[0-9a-fA-F]*$/).test(text))
        throw new POIError(`'${text.length > 80 ? text.slice(0, 80) + '…' : text}' is no ${lowercase ? 'lowercase ' : ''}hexadecimal text!`);

    const bytes = new Uint8Array(text.length / 2);

    for (let index = 0; index < bytes.length; index++)
        bytes[index] = Number.parseInt(text.slice(2 * index, 2 * index + 2), 16);

    return bytes;

}

/** Whether a text is a digest of the given length in lowercase hexadecimal digits. */
export const isLowerHex = (text: unknown, bytes?: number): text is string =>
    typeof text === 'string' &&
    /^[0-9a-f]*$/.test(text) &&
    text.length % 2 === 0 &&
    (bytes === undefined || text.length === 2 * bytes);


/** The positions of the characters of an alphabet. */
function positionsOf(alphabet: string): Map<string, number> {
    const positions = new Map<string, number>();
    for (let index = 0; index < alphabet.length; index++)
        positions.set(alphabet.charAt(index), index);
    return positions;
}


const BASE64     = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_MAP = positionsOf(BASE64);

/** Standard Base64 with padding. */
export function toBase64(bytes: Uint8Array): string {

    let result = '';

    for (let index = 0; index < bytes.length; index += 3) {

        const b0 = bytes[index] ?? 0;
        const b1 = bytes[index + 1];
        const b2 = bytes[index + 2];

        result += BASE64.charAt(b0 >> 2);
        result += BASE64.charAt(((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4));
        result += b1 === undefined ? '=' : BASE64.charAt(((b1 & 0x0F) << 2) | ((b2 ?? 0) >> 6));
        result += b2 === undefined ? '=' : BASE64.charAt(b2 & 0x3F);

    }

    return result;

}

/**
 * Reads canonical standard Base64 with padding, and refuses everything else: whitespace, the URL-safe alphabet, missing
 * padding and nonzero padding bits, as POI requires of keys and signature values (SPECIFICATION.md section 4).
 */
export function fromBase64(text: string): Uint8Array {

    if (text.length % 4 !== 0)
        throw new POIError('Not canonical Base64: its length is no multiple of 4!');

    const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
    const full    = new Uint8Array(text.length / 4 * 3);

    for (let index = 0; index < text.length; index += 4) {

        const [ v0 = 0, v1 = 0, v2 = 0, v3 = 0 ] = [0, 1, 2, 3].map(position => {
            const character = text.charAt(index + position);
            if (character === '=' && index + 4 === text.length && position >= 4 - padding)
                return 0;
            const value = BASE64_MAP.get(character);
            if (value === undefined)
                throw new POIError(`Not canonical Base64: the character '${character}'!`);
            return value;
        });

        const triple = (v0 << 18) | (v1 << 12) | (v2 << 6) | v3;

        full[index / 4 * 3]     = (triple >> 16) & 0xFF;
        full[index / 4 * 3 + 1] = (triple >>  8) & 0xFF;
        full[index / 4 * 3 + 2] =  triple        & 0xFF;

    }

    const bytes = full.subarray(0, full.length - padding);

    // Canonical: the unused bits of the last character are zero, so that one byte sequence has one text.
    if (toBase64(bytes) !== text)
        throw new POIError('Not canonical Base64!');

    return bytes;

}


const BASE45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const BASE45_MAP = positionsOf(BASE45);

/** Base45 [RFC 9285], the encoding of the QR code of a trust anchor. */
export function toBase45(bytes: Uint8Array): string {

    let result = '';

    for (let index = 0; index + 1 < bytes.length; index += 2) {
        const value = (bytes[index] ?? 0) * 256 + (bytes[index + 1] ?? 0);
        result += BASE45.charAt(value % 45) + BASE45.charAt(Math.floor(value / 45) % 45) + BASE45.charAt(Math.floor(value / 2025));
    }

    if (bytes.length % 2 === 1) {
        const value = bytes[bytes.length - 1] ?? 0;
        result += BASE45.charAt(value % 45) + BASE45.charAt(Math.floor(value / 45));
    }

    return result;

}

/** Reads Base45 [RFC 9285], refusing characters outside its alphabet and triples above 65535. */
export function fromBase45(text: string): Uint8Array {

    if (text.length % 3 === 1)
        throw new POIError('Not Base45: its length leaves a single character!');

    const values: number[] = [];

    for (const character of text) {
        const value = BASE45_MAP.get(character);
        if (value === undefined)
            throw new POIError(`Not Base45: the character '${character}'!`);
        values.push(value);
    }

    const bytes: number[] = [];

    for (let index = 0; index < values.length; index += 3) {

        if (index + 2 < values.length) {
            const value = (values[index] ?? 0) + (values[index + 1] ?? 0) * 45 + (values[index + 2] ?? 0) * 2025;
            if (value > 0xFFFF)
                throw new POIError('Not Base45: a triple above 65535!');
            bytes.push(value >> 8, value & 0xFF);
        }
        else {
            const value = (values[index] ?? 0) + (values[index + 1] ?? 0) * 45;
            if (value > 0xFF)
                throw new POIError('Not Base45: a pair above 255!');
            bytes.push(value);
        }

    }

    return new Uint8Array(bytes);

}


/** Whether two byte sequences are equal. */
export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {

    if (left.length !== right.length)
        return false;

    for (let index = 0; index < left.length; index++)
        if (left[index] !== right[index])
            return false;

    return true;

}

/** Concatenates byte sequences. */
export function concat(...parts: Uint8Array[]): Uint8Array {

    const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
    let   offset = 0;

    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }

    return result;

}

/** UTF-8. */
export const utf8 = (text: string): Uint8Array =>
    new TextEncoder().encode(text);
