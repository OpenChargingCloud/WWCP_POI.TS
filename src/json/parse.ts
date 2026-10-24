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

import { Decimal }                                         from './decimal.ts';
import { normalizeNumber, set, type JSONObject, type JSONValue } from './value.ts';
import { POIError }                                        from '../errors.ts';


/** How deep a document may nest, so that a hostile one can not exhaust the stack. */
const MAX_DEPTH = 256;


/**
 * Parses JSON text (RFC 8259) as POI reads it to hash it again (Styx section 1, SPECIFICATION.md section 1):
 * numbers with a fraction or an exponent are decimals, never binary floating-point numbers; strings stay strings;
 * an object naming a property twice is refused. `JSON.parse` would turn `1.50` into `1.5` and so change every
 * ETag and signature over it.
 */
export function parseJSON(text: string): JSONValue {

    const parser  = new Parser(text);
    parser.skipWhitespace();

    const value   = parser.parseValue(0);
    parser.skipWhitespace();

    if (!parser.atEnd)
        parser.fail('more than one JSON value');

    return value;

}

/** Parses JSON text that must be an object. */
export function parseJSONObject(text: string): JSONObject {

    const value = parseJSON(text);

    if (typeof value !== 'object' || value === null || Array.isArray(value) || value instanceof Decimal)
        throw new POIError('The JSON text is no JSON object!');

    return value;

}

/** Parses UTF-8 encoded JSON, e.g. the body of an HTTP response. A byte order mark is refused. */
export function parseJSONBytes(bytes: Uint8Array): JSONValue {
    return parseJSON(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
}


class Parser {

    private position = 0;

    constructor(private readonly text: string) {}

    public get atEnd(): boolean {
        return this.position >= this.text.length;
    }

    public fail(what: string): never {
        throw new POIError(`Invalid JSON at position ${this.position}: ${what}!`);
    }

    public skipWhitespace(): void {
        while (this.position < this.text.length) {
            const c = this.text.charCodeAt(this.position);
            if (c === 0x20 || c === 0x09 || c === 0x0A || c === 0x0D)
                this.position++;
            else
                break;
        }
    }

    public parseValue(depth: number): JSONValue {

        if (depth > MAX_DEPTH)
            this.fail(`nested deeper than ${MAX_DEPTH}`);

        const c = this.text[this.position];

        switch (c) {
            case '{':  return this.parseObject(depth);
            case '[':  return this.parseArray(depth);
            case '"':  return this.parseString();
            case 't':  return this.literal('true',  true);
            case 'f':  return this.literal('false', false);
            case 'n':  return this.literal('null',  null);
            default:
                if (c === '-' || (c !== undefined && c >= '0' && c <= '9'))
                    return this.parseNumber();
                return this.fail(c === undefined ? 'unexpected end' : `unexpected '${c}'`);
        }

    }

    private literal<T extends JSONValue>(word: string, value: T): T {
        if (!this.text.startsWith(word, this.position))
            this.fail(`expected '${word}'`);
        this.position += word.length;
        return value;
    }

    private parseObject(depth: number): JSONObject {

        const object: JSONObject = {};
        const names = new Set<string>();

        this.position++;
        this.skipWhitespace();

        if (this.text[this.position] === '}') {
            this.position++;
            return object;
        }

        for (;;) {

            this.skipWhitespace();

            if (this.text[this.position] !== '"')
                this.fail('expected a property name');

            const name = this.parseString();

            if (names.has(name))
                this.fail(`the property '${name}' is named twice`);

            names.add(name);
            this.skipWhitespace();

            if (this.text[this.position] !== ':')
                this.fail(`expected ':'`);

            this.position++;
            this.skipWhitespace();

            set(object, name, this.parseValue(depth + 1));
            this.skipWhitespace();

            const next = this.text[this.position];

            if (next === ',') {
                this.position++;
                continue;
            }

            if (next === '}') {
                this.position++;
                return object;
            }

            this.fail(`expected ',' or '}'`);

        }

    }

    private parseArray(depth: number): JSONValue[] {

        const array: JSONValue[] = [];

        this.position++;
        this.skipWhitespace();

        if (this.text[this.position] === ']') {
            this.position++;
            return array;
        }

        for (;;) {

            this.skipWhitespace();
            array.push(this.parseValue(depth + 1));
            this.skipWhitespace();

            const next = this.text[this.position];

            if (next === ',') {
                this.position++;
                continue;
            }

            if (next === ']') {
                this.position++;
                return array;
            }

            this.fail(`expected ',' or ']'`);

        }

    }

    private parseString(): string {

        this.position++;

        let result  = '';
        let start   = this.position;

        for (;;) {

            if (this.position >= this.text.length)
                this.fail('unterminated string');

            const c = this.text.charCodeAt(this.position);

            if (c === 0x22) {
                result += this.text.slice(start, this.position);
                this.position++;
                return result;
            }

            if (c < 0x20)
                this.fail('a control character within a string');

            if (c !== 0x5C) {
                this.position++;
                continue;
            }

            result += this.text.slice(start, this.position);
            this.position++;

            const escape = this.text[this.position];

            switch (escape) {
                case '"':  result += '"';   break;
                case '\\': result += '\\';  break;
                case '/':  result += '/';   break;
                case 'b':  result += '\b';  break;
                case 'f':  result += '\f';  break;
                case 'n':  result += '\n';  break;
                case 'r':  result += '\r';  break;
                case 't':  result += '\t';  break;
                case 'u': {
                    const hex = this.text.slice(this.position + 1, this.position + 5);
                    if (!/^[0-9a-fA-F]{4}$/.test(hex))
                        this.fail('an invalid \\u escape');
                    result += String.fromCharCode(Number.parseInt(hex, 16));
                    this.position += 4;
                    break;
                }
                default:
                    this.fail('an invalid escape');
            }

            this.position++;
            start = this.position;

        }

    }

    private parseNumber(): number | Decimal {

        const match = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
        match.lastIndex = this.position;

        const found = match.exec(this.text);

        if (found === null)
            this.fail('an invalid number');

        this.position += found[0].length;

        return normalizeNumber(Decimal.parse(found[0]));

    }

}
