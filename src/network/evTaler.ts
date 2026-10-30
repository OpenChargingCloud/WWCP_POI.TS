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

import { CONTEXT_PREFIX } from '../common.ts';
import { ordinal }        from '../json/canonical.ts';
import { get, isArray, isObject, type JSONObject, type JSONValue } from '../json/value.ts';
import { LANGUAGES, tokenText, type I18NText } from '../qidigital/json.ts';
import { ignoringCase }   from './identifications.ts';
import { trimmed }        from './versionTexts.ts';


// EV Taler (WWCP_POI concepts/EVTaler.md, phase 1): paying for charging with GNU Taler, step by step. A charging station
// operator names its merchant at a GNU Taler merchant backend and the exchanges whose coins it accepts (`evTaler`, of
// `EVTalerMerchant`), changed with a signing key that may sign `payments`; a charging pool or a charging pool template
// naming the payment option EVTaler needs it. Read and checked as WWCP_POI reads and checks them, in its words; then what
// it takes and writes otherwise is refused, as the content holds them only as it writes them: a property it does not read,
// a base URL or a currency not written as it writes them, here; exchanges out of the order of their master public keys, a
// JSON-LD context, the languages of a name and payment options out of their order, untrimmed or empty, with the content
// (`notWrittenAsHeld`).

export const EV_TALER_MERCHANT_CONTEXT  = CONTEXT_PREFIX + 'roamingNetwork/evTalerMerchant/v1';
export const EV_TALER_EXCHANGE_CONTEXT  = CONTEXT_PREFIX + 'roamingNetwork/evTalerExchange/v1';

/** The payment option of a charging pool, and the payment means of a charging tariff, that name EV Taler. */
export const EV_TALER_PAYMENT_OPTION    = 'EVTaler';
export const EV_TALER_PAYMENT_MEANS     = 'EV_TALER';

/** The alphabet of Crockford's Base32, in which GNU Taler writes its keys: no I, L, O and U. */
const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** What WWCP_POI reads of a merchant and of an exchange (`EVTalerMerchant.PropertyKeys`, `EVTalerExchange.PropertyKeys`). */
const MERCHANT_PROPERTIES  = [ '@context', 'merchantBaseURL', 'merchantPublicKey', 'exchanges' ];
const EXCHANGE_PROPERTIES  = [ '@context', 'masterPublicKey', 'baseURL', 'currency', 'name' ];

/** The ISO 4217 codes of the currencies of Styx (`Currency`), as `Currency.TryParseISO` takes them: XXX is none. */
const CURRENCIES = new Set(`EUR CHF USD CZK GBP HRK PLN RON RSD RUB SEK AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF
                            BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CLP CNY COP CRC CUP CVE DJF DKK DOP DZD EGP ERN ETB FJD FKP
                            GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW
                            KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO
                            NOK NPR NZD OMR PAB PEN PGK PHP PKR PYG QAR RWF SAR SBD SCR SDG SGD SHP SLE SOS SRD SSP STN SVC SYP SZL
                            THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX UYU UZS VED VES VND VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW
                            ZWG`.split(/\s+/u));


/** An exchange of GNU Taler whose coins a charging station operator accepts (`EVTalerExchange`), as WWCP_POI holds it. */
export interface EVTalerExchange {
    readonly masterPublicKey:  string;
    readonly baseURL:          string;
    readonly currency:         string;
    /** Its name, as drivers see it: the provider of "EV Taler (provider)". */
    readonly name:             I18NText;
}

/** The merchant of a charging station operator at a GNU Taler merchant backend (`EVTalerMerchant`), as WWCP_POI holds it. */
export interface EVTalerMerchant {
    readonly merchantBaseURL:    string;
    readonly merchantPublicKey:  string;
    /** At least one, in the ordinal order of their master public keys, each once. */
    readonly exchanges:          readonly EVTalerExchange[];
}


/**
 * Whether the given value is an EdDSA public key as GNU Taler writes it (`EVTalerMerchant.IsTalerPublicKey`): its 32 bytes
 * in Crockford's Base32, in upper case, 52 characters of 5 bits each, the last 4 of them zero. Every other spelling of the
 * same key is refused, so that it is compared with the one of a contract as a text.
 */
export const isTalerPublicKey = (value: JSONValue | undefined): value is string =>
    typeof value === 'string' && /^[0-9A-HJKMNP-TV-Z]{52}$/u.test(value) && (CROCKFORD_BASE32.indexOf(value.charAt(51)) & 0x0F) === 0;

/**
 * A URL as Hermod reads it (`URL.TryParse`), as far as a base URL needs it: trimmed, with the scheme https unless it names
 * one, which is a name of RFC 3986, then its user information, host, port, path, query and fragment. Its text is what it
 * writes again: as given, trimmed, the scheme put in front where it named none.
 */
export interface HermodURL {
    readonly text:      string;
    readonly scheme:    string;
    readonly user:      boolean;
    readonly query:     boolean;
    readonly fragment:  boolean;
}

const DOMAIN_LABEL = /^[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?$/u;

export function hermodURL(given: string): HermodURL | undefined {

    let text = trimmed(given);

    if (text.length === 0)
        return undefined;

    if (!text.includes('://'))
        text = `https://${text}`;

    const scheme = text.slice(0, text.indexOf('://'));

    if (!/^[A-Za-z][A-Za-z0-9+.-]*$/u.test(scheme))
        return undefined;

    let rest = text.slice(scheme.length + 3);

    const fragmentAt = rest.indexOf('#');
    const fragment   = fragmentAt >= 0;
    if (fragment)
        rest = rest.slice(0, fragmentAt);

    const queryAt = rest.indexOf('?');
    const query   = queryAt >= 0;
    if (query)
        rest = rest.slice(0, queryAt);

    const pathAt  = rest.indexOf('/');
    let authority = pathAt >= 0 ? rest.slice(0, pathAt) : rest;

    const userAt  = authority.lastIndexOf('@');
    const user    = userAt >= 0;
    if (user)
        authority = authority.slice(userAt + 1);

    const bracketEnd = authority.startsWith('[') ? authority.indexOf(']') : -1;

    if (authority.startsWith('[') && bracketEnd < 0)
        return undefined;

    const portAt  = authority.indexOf(':', bracketEnd + 1);
    const host    = trimmed(portAt >= 0 ? authority.slice(0, portAt) : authority);
    const port    = portAt >= 0 ? authority.slice(portAt + 1) : undefined;

    const hostOK  = host.startsWith('[')
                        ? host.endsWith(']')
                        : host.length > 0 && host.length <= 253 && host.replace(/\.$/u, '').split('.').every(label => DOMAIN_LABEL.test(label));

    if (!hostOK || (port !== undefined && (!/^\d{1,5}$/u.test(port) || Number(port) > 65535)))
        return undefined;

    return { text, scheme: scheme.toLowerCase(), user, query, fragment };

}

/** The error, when the given URL is no base URL of GNU Taler: HTTPS, without user information, query and fragment, ending in '/'. */
function invalidBaseURL(url: HermodURL, description: string): string | undefined {

    if (url.scheme !== 'https')
        return `The ${description} '${url.text}' must be an HTTPS URL!`;

    if (url.user)
        return `The ${description} '${url.text}' must not name a user!`;

    if (url.query || url.fragment)
        return `The ${description} '${url.text}' must have neither a query nor a fragment!`;

    if (!url.text.endsWith('/'))
        return `The ${description} '${url.text}' must end with '/'!`;

    return undefined;

}

/** A text of the given property as `POIJSON.TryParseText` reads it with `URL.TryParse`: none, a URL, or its error. */
function urlOf(json: JSONObject, property: string, description: string): HermodURL | string | undefined {

    const value = get(json, property);

    if (value === undefined)
        return undefined;

    const url = typeof value === 'string' ? hermodURL(value) : undefined;

    return url ?? `Invalid ${description} '${tokenText(value)}'!`;

}

/**
 * A text in languages as `POIJSON.TryParseI18N` reads it, leniently as `ImmutableI18NString.TryParse` of Styx does: every
 * text of a language, written in any case, also by its number; the rest left out without a word.
 */
function lenientI18N(value: JSONObject): I18NText {

    const texts = new Map<string, string>();

    for (const [ key, text ] of Object.entries(value)) {
        const language = trimmed(key).toLowerCase();
        if (typeof text === 'string' && (LANGUAGES.has(language) || /^[+-]?\d+$/u.test(language)))
            texts.set(language, text);
    }

    return [ ...texts ];

}

/** The first property of the given object WWCP_POI does not read, of those it does. */
const unread = (json: JSONObject, properties: readonly string[]): string | undefined =>
    Object.keys(json).find(property => !properties.includes(property));

/**
 * The error, when the given merchant or exchange, read as WWCP_POI reads it, is not written as it writes it again: a
 * property it does not read, a base URL as Hermod writes it, trimmed and with its scheme, a currency by its code.
 */
function notWrittenAsRead(json: JSONObject, read: EVTalerMerchant | EVTalerExchange): string | undefined {

    if ('merchantPublicKey' in read) {
        const property = unread(json, MERCHANT_PROPERTIES);
        if (property !== undefined)
            return `The EV Taler merchant must not name the property '${property}'!`;
        if (get(json, 'merchantBaseURL') !== read.merchantBaseURL)
            return `The merchant base URL '${tokenText(get(json, 'merchantBaseURL') ?? '')}' is written as '${read.merchantBaseURL}'!`;
        return undefined;
    }

    const exchange = (error: string): string =>
        `Invalid exchange of an EV Taler merchant: ${error}`;

    const property = unread(json, EXCHANGE_PROPERTIES);
    if (property !== undefined)
        return exchange(`The exchange '${read.masterPublicKey}' must not name the property '${property}'!`);
    if (get(json, 'baseURL') !== read.baseURL)
        return exchange(`The base URL '${tokenText(get(json, 'baseURL') ?? '')}' of the exchange '${read.masterPublicKey}' is written as '${read.baseURL}'!`);
    if (get(json, 'currency') !== read.currency)
        return exchange(`The currency '${tokenText(get(json, 'currency') ?? '')}' of the exchange '${read.masterPublicKey}' is written as '${read.currency}'!`);
    return undefined;

}

/** The exchange of a merchant as `EVTalerExchange.TryParse` reads it, its error otherwise. */
function exchangeOf(json: JSONObject): EVTalerExchange | string {

    const context = get(json, '@context');

    if (context !== undefined && context !== EV_TALER_EXCHANGE_CONTEXT)
        return `The JSON-LD context of an exchange must be '${EV_TALER_EXCHANGE_CONTEXT}'!`;

    const masterPublicKey = get(json, 'masterPublicKey');

    if (!isTalerPublicKey(masterPublicKey))
        return `An exchange needs its master public key, as GNU Taler writes it, not '${masterPublicKey === undefined ? '' : tokenText(masterPublicKey)}'!`;

    const baseURL = urlOf(json, 'baseURL', 'base URL of an exchange');

    if (typeof baseURL === 'string')
        return baseURL;

    if (baseURL === undefined)
        return `The exchange '${masterPublicKey}' needs its base URL!`;

    const currency = get(json, 'currency');

    if (typeof currency !== 'string' || !CURRENCIES.has(trimmed(currency)))
        return `The currency of the exchange '${masterPublicKey}' must be an ISO 4217 code, not '${currency === undefined ? '' : tokenText(currency)}'!`;

    const nameJSON = get(json, 'name');

    if (nameJSON !== undefined && nameJSON !== null && !isObject(nameJSON))
        return "JSON property 'name' is not an object!";

    const urlError = invalidBaseURL(baseURL, `base URL of the exchange '${masterPublicKey}'`);

    if (urlError !== undefined)
        return `${urlError} (Parameter 'BaseURL')`;

    const name = isObject(nameJSON) ? lenientI18N(nameJSON) : [];

    if (name.length === 0)
        return `The exchange '${masterPublicKey}' needs its name, as drivers see it! (Parameter 'Name')`;

    return { masterPublicKey, baseURL: baseURL.text, currency: trimmed(currency), name };

}

/**
 * The merchant of a charging station operator as `EVTalerMerchant.TryParse` reads it, with its exchanges in the ordinal
 * order of their master public keys; its error otherwise, as WWCP_POI words it.
 */
export function evTalerMerchantOf(value: JSONValue): EVTalerMerchant | string {

    if (!isObject(value))
        return 'The EV Taler merchant must be a JSON object!';

    const invalid = (error: string): string =>
        `Invalid EV Taler merchant: ${error}`;

    const context = get(value, '@context');

    if (context !== undefined && context !== EV_TALER_MERCHANT_CONTEXT)
        return invalid(`The JSON-LD context of an EV Taler merchant must be '${EV_TALER_MERCHANT_CONTEXT}'!`);

    const merchantBaseURL = urlOf(value, 'merchantBaseURL', 'merchant base URL');

    if (typeof merchantBaseURL === 'string')
        return invalid(merchantBaseURL);

    if (merchantBaseURL === undefined)
        return invalid('An EV Taler merchant needs its merchant base URL!');

    const merchantPublicKey = get(value, 'merchantPublicKey');

    if (!isTalerPublicKey(merchantPublicKey))
        return invalid(`An EV Taler merchant needs its merchant public key, as GNU Taler writes it, not '${merchantPublicKey === undefined ? '' : tokenText(merchantPublicKey)}'!`);

    const exchangesJSON = get(value, 'exchanges');

    if (!isArray(exchangesJSON))
        return invalid('The exchanges of an EV Taler merchant must be a JSON array!');

    const exchanges: EVTalerExchange[] = [];
    const read:      (readonly [ JSONObject, EVTalerExchange ])[] = [];

    for (const exchangeJSON of exchangesJSON) {

        if (!isObject(exchangeJSON))
            return invalid('An exchange of an EV Taler merchant must be a JSON object!');

        const exchange = exchangeOf(exchangeJSON);

        if (typeof exchange === 'string')
            return invalid(`Invalid exchange of an EV Taler merchant: ${exchange}`);

        exchanges.push(exchange);
        read.push([ exchangeJSON, exchange ]);

    }

    const urlError = invalidBaseURL(merchantBaseURL, 'merchant base URL');

    if (urlError !== undefined)
        return invalid(`${urlError} (Parameter 'MerchantBaseURL')`);

    if (exchanges.length === 0)
        return invalid("A merchant accepts at least one exchange! (Parameter 'Exchanges')");

    if (new Set(exchanges.map(exchange => exchange.masterPublicKey)).size !== exchanges.length)
        return invalid("An exchange must not be given twice! (Parameter 'Exchanges')");

    const merchant: EVTalerMerchant = {
        merchantBaseURL:    merchantBaseURL.text,
        merchantPublicKey,
        exchanges:          exchanges.sort((left, right) => ordinal(left.masterPublicKey, right.masterPublicKey)),
    };

    // What WWCP_POI takes and writes otherwise, after all it refuses: the merchant, then its exchanges as given.
    const notWritten = notWrittenAsRead(value, merchant) ?? read.map(([ json, exchange ]) => notWrittenAsRead(json, exchange)).find(error => error !== undefined);

    return notWritten === undefined ? merchant : invalid(notWritten);

}


/** Whether the given payment options, as `PaymentOptions` compares them without case, name EVTaler. */
export const namesEVTaler = (paymentOptions: JSONValue | undefined): boolean =>
    isArray(paymentOptions) && paymentOptions.some(option => typeof option === 'string' && ignoringCase(trimmed(option)) === ignoringCase(EV_TALER_PAYMENT_OPTION));

/**
 * The error, when the payment options of the given charging pool or charging pool template are none WWCP_POI reads: an
 * open set of names (`PaymentOptions.TryParse`), each a nonempty text, trimmed, none twice whatever its case.
 */
function invalidPaymentOptions(entity: JSONObject, what: string): string | undefined {

    const options = get(entity, 'paymentOptions');

    if (options === undefined)
        return undefined;

    if (!isArray(options))
        return 'The payment option must be a JSON array!';

    const invalid = options.find(option => typeof option !== 'string' || trimmed(option).length === 0);

    if (invalid !== undefined)
        return `Invalid payment option '${tokenText(invalid)}'!`;

    const names = options.map(option => ignoringCase(trimmed(option as string)));

    if (new Set(names).size !== names.length)
        return `The given JSON representation of a ${what} is invalid: A payment option of the ${what} '${tokenText(entity['@id'] ?? '')}' must not be given twice!`;

    return undefined;

}

const objectsOf = (value: JSONValue | undefined): JSONObject[] =>
    isArray(value) ? value.filter(isObject) : [];

/**
 * The error, when a charging pool or charging pool template of the given charging station operator names the payment
 * option EVTaler while the operator has no EV Taler merchant (`ChargingStationOperator.InvalidPaymentOption`): its charging
 * pools first, then its templates, which give every effective charging pool their payment options.
 */
function withoutMerchant(operator: JSONObject): string | undefined {

    if (get(operator, 'evTaler') !== undefined)
        return undefined;

    const operatorId = tokenText(operator['@id'] ?? '');

    for (const pool of objectsOf(get(operator, 'chargingPools')))
        if (namesEVTaler(get(pool, 'paymentOptions')))
            return `The charging pool '${tokenText(pool['@id'] ?? '')}' names the payment option '${EV_TALER_PAYMENT_OPTION}', but its operator '${operatorId}' has no EV Taler merchant!`;

    for (const template of objectsOf(get(operator, 'chargingPoolTemplates')))
        if (namesEVTaler(get(template, 'paymentOptions')))
            return `The charging pool template '${tokenText(template['@id'] ?? '')}' names the payment option '${EV_TALER_PAYMENT_OPTION}', but its operator '${operatorId}' has no EV Taler merchant!`;

    return undefined;

}

/**
 * The error, as WWCP_POI words it when it reads a version, when a charging station operator of the given content names an
 * EV Taler merchant it does not read, a charging pool or charging pool template of it payment options it does not read, or
 * the payment option EVTaler without a merchant; undefined for none. Each operator in its order, as WWCP_POI reads it: its
 * merchant, its charging pools, its charging pool templates, then the operator made of them.
 */
export function invalidEVTaler(content: JSONObject): string | undefined {

    for (const operator of objectsOf(get(content, 'chargingStationOperators'))) {

        const merchant = get(operator, 'evTaler');

        if (merchant !== undefined) {
            const read = evTalerMerchantOf(merchant);
            if (typeof read === 'string')
                return read;
        }

        for (const pool of objectsOf(get(operator, 'chargingPools'))) {
            const error = invalidPaymentOptions(pool, 'charging pool');
            if (error !== undefined)
                return error;
        }

        for (const template of objectsOf(get(operator, 'chargingPoolTemplates'))) {
            const error = invalidPaymentOptions(template, 'charging pool template');
            if (error !== undefined)
                return error;
        }

        const error = withoutMerchant(operator);

        if (error !== undefined)
            return `The given JSON representation of a charging station operator is invalid: ${error} (Parameter 'EVTaler')`;

    }

    return undefined;

}

/**
 * The error, as WWCP_POI words it after the last change of a change set, when a charging station operator names the
 * payment option EVTaler without an EV Taler merchant: the operators in the ordinal order of their identifications, so
 * that a change set may add the merchant and the payment option in either order.
 */
export const evTalerWithoutMerchant = (content: JSONObject): string | undefined =>
    objectsOf(get(content, 'chargingStationOperators')).
        sort((left, right) => ordinal(tokenText(left['@id'] ?? ''), tokenText(right['@id'] ?? ''))).
        map(withoutMerchant).find(error => error !== undefined);


/** The payment option as drivers see it at an EVSE whose EV Taler tariff is in its currency, in the languages of its name. */
export const paymentOptionName = (exchange: EVTalerExchange): I18NText =>
    exchange.name.map(([ language, text ]) => [ language, `EV Taler (${text}, ${exchange.currency})` ] as const);
