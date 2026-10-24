import { describe, expect, it } from 'vitest';

import { parseJSON }                       from '../src/json/parse.ts';
import { canonicalJSON }                   from '../src/json/canonical.ts';
import { Decimal }                         from '../src/json/decimal.ts';
import { deterministicCbor }               from '../src/encoding/cbor.ts';
import { toHex, fromBase64, toBase64, fromBase45, toBase45 } from '../src/encoding/text.ts';


// The test vectors of Styx's canonical JSON and deterministic CBOR (Styx/Illias/JSON/README.md, section 4).
const vectors: Array<[ input: string, canonical: string, cbor?: string ]> = [
    [ '{ "b" : 1, "a" : [ 1.0, 1, 1.50, 100, -2, 0.10 ], "aa" : "x", "c" : null, "d" : true }',
      '{"a":[1.0,1,1.50,100,-2,0.10],"aa":"x","b":1,"c":null,"d":true}',
      'a5 6161 86 c482200a 01 c482211896 1864 21 c482210a 6162 01 6163 f6 6164 f5 626161 6178' ],
    [ '{"aa":1,"b":2,"a":3,"é":4}',
      '{"a":3,"aa":1,"b":2,"é":4}',
      'a4 6161 03 6162 02 626161 01 62c3a9 04' ],
    [ '{"o":{},"a":[],"s":""}',
      '{"a":[],"o":{},"s":""}',
      'a3 6161 80 616f a0 6173 60' ],
    [ '[22000.0, -1.5, 0.000, 79228162514264337593543950335]',
      '[22000.0,-1.5,0.000,79228162514264337593543950335]',
      '84 c482201a00035b60 c482202e c4822200 c24cffffffffffffffffffffffff' ],
    [ '[18446744073709551615, -9223372036854775809]',
      '[18446744073709551615,-9223372036854775809]',
      '82 1bffffffffffffffff 3b8000000000000000' ],
    [ '[1.0, 1, 1.50, 0.000, -0.0, 100, 1e-7, 1.5e2, 1E-2]',
      '[1.0,1,1.50,0.000,0.0,100,0.0000001,150,0.01]' ],
    [ '["1.10 kWh", "2026-10-12T12:00:00Z"]',
      '["1.10 kWh","2026-10-12T12:00:00Z"]',
      '82 68312e3130206b5768 74323032362d31302d31325431323a30303a30305a' ],
    [ '{"b":1,"a":2,"B":3,"é":4,"aa":5,"😀":6,"｡":7}',
      '{"B":3,"a":2,"aa":5,"b":1,"é":4,"\\uD83D\\uDE00":6,"｡":7}' ],
];


describe('canonical JSON and deterministic CBOR of Styx', () => {

    for (const [input, canonical, cbor] of vectors) {

        it(`writes ${input}`, () => {

            const value = parseJSON(input);

            expect(canonicalJSON(value)).toBe(canonical);

            if (cbor !== undefined)
                expect(toHex(deterministicCbor(value))).toBe(cbor.replaceAll(' ', ''));

        });

    }

    it('writes [22000, -0, 79228162514264337593543950335, 1.5e2] held as decimals as integers', () => {
        const value = [ new Decimal(22000n, 0), new Decimal(0n, 0), new Decimal(79228162514264337593543950335n, 0), Decimal.parse('1.5e2') ];
        expect(canonicalJSON(value)).toBe('[22000,0,79228162514264337593543950335,150]');
        expect(toHex(deterministicCbor(value))).toBe('841955f000c24cffffffffffffffffffffffff1896');
    });

    it('escapes as .NET UnsafeRelaxedJsonEscaping does', () => {
        expect(canonicalJSON('a"b\\c/<>&\'+`')).toBe('"a\\"b\\\\c/<>&\'+`"');
        expect(canonicalJSON('\b\f\n\r\t\u0000\u001F\u007F\u0085')).toBe('"\\b\\f\\n\\r\\t\\u0000\\u001F\\u007F\\u0085"');
        expect(canonicalJSON('   　  ﻿﷐￾')).toBe('"\\u00A0\\u2000\\u202F\\u3000\\u2028\\u2029\\uE000\\uFEFF\\uFDD0\\uFFFE"');
        expect(canonicalJSON('­​‍⁦ä€')).toBe('"­​‍⁦ä€"');
        expect(canonicalJSON('\uD800x')).toBe('"�x"');
    });

    it('refuses what a decimal can not hold, and properties named twice', () => {
        expect(() => parseJSON('1e-30')).toThrow();
        expect(() => parseJSON('1.0000000000000000000000000000000001')).toThrow();
        expect(() => parseJSON('{"a":1,"a":2}')).toThrow();
        expect(() => parseJSON('[1,]')).toThrow();
        expect(parseJSON('{"__proto__":1}')).toEqual(JSON.parse('{"__proto__":1}'));
    });

});


describe('Base64 and Base45', () => {

    it('reads canonical Base64 only', () => {
        expect(toHex(fromBase64('AAEC'))).toBe('000102');
        expect(toHex(fromBase64('AA=='))).toBe('00');
        expect(toBase64(Uint8Array.of(1, 2))).toBe('AQI=');
        expect(() => fromBase64('AB==')).toThrow();
        expect(() => fromBase64('AA')).toThrow();
        expect(() => fromBase64('A-B_')).toThrow();
    });

    it('reads and writes Base45 as RFC 9285', () => {
        expect(toBase45(new TextEncoder().encode('AB'))).toBe('BB8');
        expect(toBase45(new TextEncoder().encode('Hello!!'))).toBe('%69 VD92EX0');
        expect(new TextDecoder().decode(fromBase45('QED8WEX0'))).toBe('ietf!');
        expect(() => fromBase45('GGW')).toThrow();
    });

});
