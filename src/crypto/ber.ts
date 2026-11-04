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


// ASN.1 as BouncyCastle reads it (Asn1InputStream): BER, definite and indefinite lengths, strings in segments; and whether
// DER writes what it read the same, as `GetDerEncoded` does: definite lengths in their fewest octets, strings in one piece,
// the unused bits of a bit string zero. What it refuses it names in its words where this library knows them.


/** Universal tags. */
export const TAG = {
    boolean:          0x01,
    integer:          0x02,
    bitString:        0x03,
    octetString:      0x04,
    null:             0x05,
    objectIdentifier: 0x06,
    sequence:         0x10,
    set:              0x11,
} as const;

export const CONTEXT = 2;

/** A record of BER. */
export interface BER {
    /** Universal 0, application 1, context-specific 2, private 3. */
    readonly tagClass:     number;
    readonly tagNumber:    number;
    readonly constructed:  boolean;
    /** The value of a primitive record, of a string in segments its segments joined. */
    readonly content:      Uint8Array;
    readonly children:     readonly BER[];
    /** Whether DER writes it and what it holds as given. */
    readonly der:          boolean;
    /** The record as given. */
    readonly encoded:      Uint8Array;
}

export class BERError extends Error {}

const isUniversal = (record: BER, tagNumber: number): boolean =>
    record.tagClass === 0 && record.tagNumber === tagNumber;

export const isSequence = (record: BER): boolean => isUniversal(record, TAG.sequence);
export const isInteger  = (record: BER): boolean => isUniversal(record, TAG.integer);
export const isNull     = (record: BER): boolean => isUniversal(record, TAG.null);
export const isOID      = (record: BER): boolean => isUniversal(record, TAG.objectIdentifier);
export const isBitString = (record: BER): boolean => isUniversal(record, TAG.bitString);

const join = (parts: readonly Uint8Array[]): Uint8Array => {
    const joined = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
    let at = 0;
    for (const part of parts) {
        joined.set(part, at);
        at += part.length;
    }
    return joined;
};

/** Whether the value of a primitive universal record is one BouncyCastle makes an object of. */
function validContent(tagNumber: number, content: Uint8Array): boolean {

    switch (tagNumber) {

        case TAG.boolean:
            return content.length === 1;

        case TAG.integer:
            return content.length > 0 && !(content.length > 1 && ((content[0] === 0 && ((content[1] ?? 0) & 0x80) === 0) || (content[0] === 0xff && ((content[1] ?? 0) & 0x80) !== 0)));

        case TAG.bitString: {
            const pad = content[0];
            return pad !== undefined && pad <= 7 && !(pad > 0 && content.length === 1);
        }

        case TAG.null:
            return content.length === 0;

        case TAG.objectIdentifier: {
            if (content.length === 0 || ((content.at(-1) ?? 0) & 0x80) !== 0)
                return false;
            return content.every((octet, index) => octet !== 0x80 || (index > 0 && ((content[index - 1] ?? 0) & 0x80) !== 0));
        }

        default:
            return true;

    }

}

/**
 * One record from the given offset on, before the given end, and where the next one begins: a length beyond the one of
 * the record around it, `limit`, is out of bounds, one beyond the end truncated, as Asn1InputStream tells them.
 */
function readAt(bytes: Uint8Array, start: number, end: number, limit: number): { record: BER, next: number } {

    let at = start;

    const octet = (inTag: boolean): number => {
        if (at >= end)
            throw new BERError(inTag ? 'EOF found inside tag value.' : 'EOF found when length expected');
        return bytes[at++] ?? 0;
    };

    const identifier  = octet(true);
    const tagClass    = identifier >> 6;
    const constructed = (identifier & 0x20) !== 0;
    let   tagNumber   = identifier & 0x1f;
    let   der         = true;

    if (tagNumber === 0x1f) {
        tagNumber = 0;
        let part = octet(true);
        if ((part & 0x7f) === 0)
            throw new BERError('corrupted stream - invalid high tag number found');
        while ((part & 0x80) !== 0) {
            tagNumber = tagNumber * 128 + (part & 0x7f);
            part = octet(true);
        }
        tagNumber = tagNumber * 128 + part;
    }

    const first = octet(false);
    let   length: number | undefined;

    if (first === 0x80) {
        if (!constructed)
            throw new BERError('indefinite-length primitive encoding encountered');
        der = false;
    }
    else if (first < 0x80)
        length = first;
    else {
        const size = first & 0x7f;
        length = 0;
        for (let i = 0; i < size; i++) {
            length = length * 256 + octet(false);
            if (length > 0x7fffffff)
                throw new BERError('long form definite-length more than 31 bits');
        }
        if (length < 0x80 || length < 256 ** (size - 1))
            der = false;
    }

    if (length !== undefined && length > limit)
        throw new BERError(`corrupted stream - out of bounds length found: ${String(length)} > ${String(limit)}`);

    if (!constructed && tagClass === 0 && tagNumber === TAG.boolean && length !== 1)
        throw new BERError('corrupted stream detected');

    if (length !== undefined && length > end - at)
        throw new BERError(`DEF length ${String(length)} object truncated by ${String(length - (end - at))}`);

    const children: BER[] = [];
    let   content: Uint8Array = new Uint8Array(0);

    if (constructed) {

        const stop = length === undefined ? end : at + length;

        for (;;) {

            if (length === undefined && at + 1 < end && bytes[at] === 0 && bytes[at + 1] === 0) {
                at += 2;
                break;
            }

            if (at >= stop) {
                if (length === undefined)
                    throw new BERError('Attempted to read past the end of the stream.');
                break;
            }

            if (bytes[at] === 0 && bytes[at + 1] === 0)
                throw new BERError('unexpected end-of-contents marker');

            const { record, next } = readAt(bytes, at, stop, length ?? limit);
            children.push(record);
            der = der && record.der;
            at  = next;

        }

        // A string in segments, as BER may give it and DER does not.
        if (tagClass === 0 && (tagNumber === TAG.bitString || tagNumber === TAG.octetString)) {
            der = false;
            content = tagNumber === TAG.octetString
                          ? join(children.map(child => child.content))
                          : join([ children.at(-1)?.content.subarray(0, 1) ?? new Uint8Array([ 0 ]), ...children.map(child => child.content.subarray(1)) ]);
        }
        else if (tagClass === 0 && tagNumber !== TAG.sequence && tagNumber !== TAG.set && tagNumber !== 0)
            der = false;

    }
    else {

        if (length === undefined)
            throw new BERError('indefinite-length primitive encoding encountered');

        content = bytes.subarray(at, at + length);
        at += length;

        if (tagClass === 0 && tagNumber === 0)
            throw new BERError('unexpected end-of-contents marker');

        if (tagClass === 0 && (tagNumber === TAG.sequence || tagNumber === TAG.set))
            throw new BERError(`unknown tag ${String(tagNumber)} encountered`);

        // What BouncyCastle makes no object of: a boolean not of one octet, an integer not in its fewest octets, an object
        // identifier of an arc not in its fewest octets, a bit string of more than 7 unused bits.
        if (tagClass === 0 && !validContent(tagNumber, content))
            throw new BERError('corrupted stream detected');

        // The unused bits of a bit string, which DER writes zero.
        if (tagClass === 0 && tagNumber === TAG.bitString && content.length > 1) {
            const pad = content[0] ?? 0;
            if (pad > 0 && ((content.at(-1) ?? 0) & ((1 << pad) - 1)) !== 0)
                der = false;
        }

        // DER writes a boolean as 0x00 or 0xFF.
        if (tagClass === 0 && tagNumber === TAG.boolean && content[0] !== 0 && content[0] !== 0xff)
            der = false;

    }

    return { record: { tagClass, tagNumber, constructed, content, children, der, encoded: bytes.subarray(start, at) }, next: at };

}

/** The one record of the given bytes, as `Asn1Object.FromByteArray` reads it: nothing after it. */
export function readBER(bytes: Uint8Array): BER {

    if (bytes.length === 0)
        throw new BERError('Object reference not set to an instance of an object.');

    const { record, next } = readAt(bytes, 0, bytes.length, bytes.length);

    if (next !== bytes.length)
        throw new BERError('extra data found after object');

    return record;

}

/** The first record of the given bytes, as `Asn1InputStream.ReadObject` reads it from a stream: what follows it left. */
export function readFirstBER(bytes: Uint8Array): BER {

    if (bytes.length === 0)
        throw new BERError('Index was outside the bounds of the array.');

    return readAt(bytes, 0, bytes.length, bytes.length).record;

}

/** The class BouncyCastle reads a record as, as `GetInstance` names it when it is not one of the class it wants. */
const UNIVERSAL_TYPES: Readonly<Record<number, string>> = {
    1: 'DerBoolean', 2: 'DerInteger', 3: 'DerBitString', 4: 'DerOctetString', 5: 'DerNull', 6: 'DerObjectIdentifier', 10: 'DerEnumerated',
    12: 'DerUtf8String', 19: 'DerPrintableString', 22: 'DerIA5String', 23: 'DerUtcTime', 24: 'DerGeneralizedTime',
};

function typeOf(record: BER): string {
    const indefinite = record.constructed && record.encoded[record.tagNumber < 0x1f ? 1 : 2] === 0x80;
    if (record.tagClass !== 0)
        return indefinite ? 'BerTaggedObject' : 'DLTaggedObject';
    if (record.tagNumber === TAG.sequence)
        return indefinite ? 'BerSequence' : 'DLSequence';
    if (record.tagNumber === TAG.set)
        return indefinite ? 'BerSet' : 'DLSet';
    if (record.constructed && record.tagNumber === TAG.bitString)
        return 'BerBitString';
    if (record.constructed && record.tagNumber === TAG.octetString)
        return 'BerOctetString';
    return UNIVERSAL_TYPES[record.tagNumber] ?? 'Asn1Object';
}

/** What `GetInstance` of a class throws of a record of another one. */
export const illegal = (record: BER): BERError =>
    new BERError(`illegal object in GetInstance: Org.BouncyCastle.Asn1.${typeOf(record)} (Parameter 'obj')`);

/** An integer as `DerInteger` reads it: two's complement in its fewest octets. */
export function integerOf(record: BER): bigint {

    if (!isInteger(record))
        throw illegal(record);

    const content = record.content;

    if (content.length === 0 || (content.length > 1 && ((content[0] === 0 && ((content[1] ?? 0) & 0x80) === 0) || (content[0] === 0xff && ((content[1] ?? 0) & 0x80) !== 0))))
        throw new BERError('malformed integer');

    let value = 0n;
    for (const octet of content)
        value = (value << 8n) | BigInt(octet);

    return ((content[0] ?? 0) & 0x80) !== 0 ? value - (1n << BigInt(content.length * 8)) : value;

}

/** An object identifier in dotted decimal, as `DerObjectIdentifier` reads it: each arc in its fewest octets. */
export function oidOf(record: BER): string {

    if (!isOID(record))
        throw illegal(record);

    const content = record.content;

    if (content.length === 0 || ((content.at(-1) ?? 0) & 0x80) !== 0)
        throw new BERError('invalid OID contents');

    // An arc as a number while it is a safe integer, of any length as a bigint.
    const arcs: (number | bigint)[] = [];
    let   arc: number | bigint = 0;
    let   fresh = true;

    for (const octet of content) {
        if (fresh && octet === 0x80)
            throw new BERError('invalid OID contents');
        arc   = typeof arc === 'number' && arc < 2 ** 45 ? arc * 128 + (octet & 0x7f) : (BigInt(arc) << 7n) | BigInt(octet & 0x7f);
        fresh = (octet & 0x80) === 0;
        if (fresh) {
            arcs.push(arc);
            arc = 0;
        }
    }

    const [ head = 0, ...rest ] = arcs;
    const big   = BigInt(head);
    const first = big < 40n ? 0n : big < 80n ? 1n : 2n;

    return [ first, big - first * 40n, ...rest ].join('.');

}

/** The octets of a bit string, as `DerBitString.GetOctets` gives them: of whole octets. */
export function octetsOf(record: BER): Uint8Array {

    if (!isBitString(record))
        throw illegal(record);

    const pad = record.content[0];

    if (pad === undefined)
        throw new BERError('Truncated BIT STRING detected');

    if (pad > 7 || (pad > 0 && record.content.length === 1))
        throw new BERError('invalid pad bits detected');

    if (pad !== 0)
        throw new BERError('attempt to get non-octet aligned data from BIT STRING');

    return record.content.subarray(1);

}

/** The children of a sequence of the given sizes, as a `GetInstance` of a sequence takes them. */
export function sequenceOf(record: BER, sizes: readonly number[]): readonly BER[] {

    if (!isSequence(record))
        throw illegal(record);

    if (!sizes.includes(record.children.length))
        throw new BERError(`Bad sequence size: ${String(record.children.length)} (Parameter 'seq')`);

    return record.children;

}
