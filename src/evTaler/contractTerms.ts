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
import { Decimal } from '../json/decimal.ts';
import { get, isArray, isObject, type JSONObject, type JSONValue } from '../json/value.ts';
import { evTalerMerchantOf, isTalerPublicKey, type EVTalerMerchant } from '../network/evTaler.ts';
import { ignoringCase } from '../network/identifications.ts';
import { tariffId as tariffIdOf } from '../network/poiJSON.ts';
import { verifyPriceStatements, type VerifiedChargingStation, type VerifiedPrice } from '../verifier/chargingStation.ts';
import { EVTalerRates, NetDecimal, talerAmountOf, writeAmount } from './amounts.ts';
import { verifyMeterValue, type EVTalerMeterValueVerifier, type EVTalerVerifiedMeterValue } from './meterValue.ts';
import { sameBaseURL, type EVTalerPayURI } from './payURI.ts';
import { EVTalerStep } from './step.ts';


// The contract terms of a step of an EV Taler session (EVTalerContractTerms of WWCP_POI c2d39e5), as GNU Taler's merchant
// backend makes them and its instance signs them, checked against a station proof (concepts/EVTaler.md, 6 and 7).


/** How exactly a reader checked the amount of a step (`EVTalerAmountChecks`). */
export const EVTalerAmountChecks = {
    /** What the step covers at the price of the session, rounded up to the minor unit; in step 1 with the flat fee, the reserve as the rest. */
    Exact:        'exact',
    /** The session is priced by energy and time: the amount is at least what the step covers, the rest an estimate (5.1). */
    Estimate:     'estimate',
    /** The prices of the session are not of the simple profile: the amount is not recalculated. */
    Unsupported:  'unsupported',
} as const;

export type EVTalerAmountCheck = typeof EVTalerAmountChecks[keyof typeof EVTalerAmountChecks];

/** A step of an EV Taler session as its contract terms and a station proof establish it (`EVTalerVerifiedStep`, 7). */
export interface EVTalerVerifiedStep {
    readonly terms:           EVTalerContractTerms;
    readonly step:            EVTalerStep;
    /** The operator's merchant, as the proof gives it. */
    readonly merchant:        EVTalerMerchant;
    /** The EV Taler tariff of the EVSE, as the proof gives it. */
    readonly tariff:          JSONObject;
    readonly currency:        string;
    /** The price statement that prices the session, if any. */
    readonly priceStatement:  VerifiedPrice | undefined;
    /** The elements that price the session: of the price statement, else of the tariff. */
    readonly elements:        readonly JSONObject[];
    /** The rates of the simple profile, if the elements are of it. */
    readonly rates:           EVTalerRates | undefined;
    /** When step 1 was made: the time its price statement is current at, in milliseconds since 1970. */
    readonly sessionStarted:  number;
    /** What the step covers at the price of its dimension, if recalculated. */
    readonly stepPrice:       NetDecimal | undefined;
    /** The flat fee, in step 1, if recalculated. */
    readonly flatFee:         NetDecimal | undefined;
    /** The reserve, in step 1, if recalculated: the amount less the step and the flat fee. */
    readonly reserve:         NetDecimal | undefined;
    readonly amountCheck:     EVTalerAmountCheck;
    /** From step 2 on: the signed meter value at the start, verified. */
    readonly start:           EVTalerVerifiedMeterValue | undefined;
    /** What a reader should know. */
    readonly diagnostics:     readonly string[];
}

/** An exchange of contract terms: its base URL and its master public key. */
export interface EVTalerContractExchange {
    readonly url:              string;
    readonly masterPublicKey:  string;
}

const isInteger = (value: JSONValue | undefined): value is number | Decimal =>
    (typeof value === 'number' && Number.isInteger(value)) || (value instanceof Decimal && value.isInteger);

const integerOf = (value: number | Decimal): number =>
    typeof value === 'number' ? value : Number(value.mantissa);

const textOf = (value: JSONValue | undefined): string =>
    typeof value === 'string' ? value : '';

const idOf = (json: JSONValue | undefined): string => {
    const id = isObject(json) ? get(json, '@id') : undefined;
    return typeof id === 'string' ? id : '';
};

/** A time GNU Taler writes as { "t_s": … }, not never, in milliseconds since 1970; its error otherwise. */
function timeOf(json: JSONObject, name: string): number {

    const time    = get(json, name);
    const seconds = isObject(time) && Object.keys(time).length === 1 ? get(time, 't_s') : undefined;

    if (!isInteger(seconds) || integerOf(seconds) < 0)
        throw new POIError(`The '${name}' of contract terms is a time GNU Taler writes as { "t_s": … }, not never!`);

    return integerOf(seconds) * 1000;

}


/**
 * The contract terms of a step of an EV Taler session, as GNU Taler's merchant backend makes them and its instance signs
 * them (contract terms of version 0): what WWCP_POI reads of them, the rest kept as given.
 */
export class EVTalerContractTerms {

    private constructor(
        /** The contract terms, as given. */
        public readonly json:               JSONObject,
        public readonly orderId:            string,
        public readonly currency:           string,
        public readonly amount:             NetDecimal,
        /** The base URL of the merchant instance. */
        public readonly merchantBaseURL:    string,
        /** The public key of the merchant instance, which signed the contract terms. */
        public readonly merchantPublicKey:  string,
        /** The exchanges the merchant accepts. */
        public readonly exchanges:          readonly EVTalerContractExchange[],
        /** When the contract terms were made, in milliseconds since 1970. */
        public readonly timestamp:          number,
        /** Until when the step can be paid. */
        public readonly payDeadline:        number,
        /** Until when the step can be refunded. */
        public readonly refundDeadline:     number,
        /** How long the wallet asks for a refund by itself, in microseconds, Infinity for "forever"; undefined if not at all. */
        public readonly autoRefund:         number | undefined,
        /** The step in WWCP terms: "extra": { "wwcp": … }. */
        public readonly step:               EVTalerStep
    ) {}

    /**
     * Reads the given contract terms of a step (`EVTalerContractTerms.TryParse`): of version 0, with an order, an amount and
     * a maximum fee in one currency, the merchant's base URL and public key, at least one exchange, the times GNU Taler
     * writes as { "t_s": … }, and the step in "extra": { "wwcp": … }. Refused in the words of WWCP_POI.
     */
    public static parse(json: JSONValue | undefined): EVTalerContractTerms {

        if (!isObject(json))
            throw new POIError('Contract terms must be a JSON object!');

        const version = get(json, 'version');

        if (version !== undefined && !(isInteger(version) && integerOf(version) === 0))
            throw new POIError('The contract terms of a step are of version 0: choices and token families are not taken (phase 4)!');

        const orderId = get(json, 'order_id');

        if (typeof orderId !== 'string' || orderId.length === 0)
            throw new POIError('Contract terms name their order!');

        const amountText  = get(json, 'amount');
        const feeText     = get(json, 'max_fee');
        const amount      = talerAmountOf(typeof amountText === 'string' ? amountText : undefined);
        const fee         = typeof amount === 'string' ? undefined : talerAmountOf(typeof feeText === 'string' ? feeText : undefined);

        if (typeof amount === 'string' || typeof fee === 'string' || fee === undefined)
            throw new POIError(`The amount and the maximum fee of contract terms: ${typeof amount === 'string' ? amount : typeof fee === 'string' ? fee : ''}`);

        if (fee.currency !== amount.currency)
            throw new POIError('The amount and the maximum fee of contract terms are of one currency!');

        const merchantBaseURL    = get(json, 'merchant_base_url');
        const merchantPublicKey  = get(json, 'merchant_pub');

        if (typeof merchantBaseURL !== 'string' || typeof merchantPublicKey !== 'string' || !isTalerPublicKey(merchantPublicKey))
            throw new POIError("Contract terms name the merchant's base URL and its public key, as GNU Taler writes it!");

        const exchanges: EVTalerContractExchange[] = [];
        const exchangesJSON = get(json, 'exchanges');

        for (const exchange of isArray(exchangesJSON) ? exchangesJSON : []) {

            const url        = isObject(exchange) ? get(exchange, 'url')        : undefined;
            const masterPub  = isObject(exchange) ? get(exchange, 'master_pub') : undefined;

            if (typeof url !== 'string' || typeof masterPub !== 'string')
                throw new POIError('An exchange of contract terms names its URL and its master public key!');

            exchanges.push({ url, masterPublicKey: masterPub });

        }

        if (exchanges.length === 0)
            throw new POIError('Contract terms name at least one exchange!');

        const timestamp       = timeOf(json, 'timestamp');
        const payDeadline     = timeOf(json, 'pay_deadline');
        const refundDeadline  = timeOf(json, 'refund_deadline');

        let autoRefund: number | undefined;
        const autoRefundJSON = get(json, 'auto_refund');

        if (autoRefundJSON !== undefined) {

            const microseconds = isObject(autoRefundJSON) && Object.keys(autoRefundJSON).length === 1 ? get(autoRefundJSON, 'd_us') : undefined;

            if (!(isInteger(microseconds) && integerOf(microseconds) >= 0 || microseconds === 'forever'))
                throw new POIError('The auto refund of contract terms is a relative time, { "d_us": … }!');

            autoRefund = microseconds === 'forever' ? Infinity : integerOf(microseconds);

        }

        const extra = get(json, 'extra');
        const wwcp  = isObject(extra) ? get(extra, 'wwcp') : undefined;

        if (!isObject(wwcp))
            throw new POIError('The contract terms of a step name it in "extra": { "wwcp": … }!');

        const step = EVTalerStep.parse(wwcp);

        return new EVTalerContractTerms(json, orderId, amount.currency, amount.value, merchantBaseURL, merchantPublicKey, exchanges,
                                        timestamp, payDeadline, refundDeadline, autoRefund, step);

    }


    /**
     * Checks these contract terms of a step against a verified charging station (`EVTalerContractTerms.TryVerify`,
     * concepts/EVTaler.md 6 and 7): the merchant and its exchanges are those of the operator's evTaler in the currency of
     * the EVSE's EV Taler tariff; the step names the roaming network, an EVSE of the station, that tariff and the price
     * statement current when the session began; it follows the step before, or is step 1; from step 2 on, the signed start
     * value is verified with a measurement key the proof gives; the amount is the step at the price of the session, where
     * the prices are of the simple profile; the refund deadline is after the payment deadline, and the wallet picks a refund
     * up by itself. Refused in the words of WWCP_POI.
     *
     * @param priceStatements  The price statements the app holds of the station, its pool and its EVSEs, as JSON.
     * @param previous         The step before, verified; none for step 1.
     * @param verifier         A transparency software verifying signed meter values, from step 2 on.
     * @param payURI           The taler://pay URI of the offer, if the app has it as well.
     */
    public verify(station:          VerifiedChargingStation,
                  priceStatements:  JSONValue,
                  previous:         EVTalerVerifiedStep | undefined,
                  verifier:         EVTalerMeterValueVerifier | undefined,
                  payURI?:          EVTalerPayURI): EVTalerVerifiedStep {

        const diagnostics: string[] = [];
        const step = this.step;

        // The merchant of the operator.
        const merchant = isObject(get(station.operator, 'evTaler')) ? evTalerMerchantOf(get(station.operator, 'evTaler') ?? null) : undefined;

        if (merchant === undefined || typeof merchant === 'string')
            throw new POIError(`The proof gives no EV Taler merchant of the operator '${idOf(station.operator)}'!`);

        if (!sameBaseURL(this.merchantBaseURL, merchant.merchantBaseURL) || this.merchantPublicKey !== merchant.merchantPublicKey)
            throw new POIError(`The step is offered by the merchant '${this.merchantBaseURL}' (${this.merchantPublicKey}), not by the operator's '${merchant.merchantBaseURL}' (${merchant.merchantPublicKey})!`);

        if (payURI !== undefined && (!sameBaseURL(payURI.merchantBaseURL, this.merchantBaseURL) || payURI.orderId !== this.orderId))
            throw new POIError('The taler://pay URI names another merchant or another order than the contract terms!');

        // Where: the roaming network and the EVSE.
        if (ignoringCase(step.roamingNetworkId) !== ignoringCase(station.roamingNetwork.id))
            throw new POIError(`The step is one of the roaming network '${step.roamingNetworkId}', not of '${station.roamingNetwork.id}'!`);

        if (!station.evses.some(evse => idOf(evse) === step.EVSEId))
            throw new POIError(`The EVSE '${step.EVSEId}' of the step is none of the charging station '${idOf(station.chargingStation)}'!`);

        // The step before.
        if (previous === undefined) {
            if (step.step !== 1)
                throw new POIError(`Step ${step.step} is checked after the step before it!`);
        }
        else {

            const before = previous.step;

            if (step.step               !== before.step + 1           ||
                step.previousOrderId    !== previous.terms.orderId    ||
                step.sessionId          !== before.sessionId          ||
                step.EVSEId             !== before.EVSEId             ||
                step.chargingTariffId   !== before.chargingTariffId   ||
                step.priceStatement     !== before.priceStatement     ||
                step.covers.unit        !== before.covers.unit        ||
                !step.covers.from.equals(before.covers.to))
                throw new POIError(`Step ${step.step} does not follow step ${before.step}: one session, EVSE, tariff and price statement, the order before, what it covers following on!`);

            if (before.startMeterValue !== undefined && !before.startMeterValue.equals(step.startMeterValue))
                throw new POIError(`Step ${step.step} names another signed meter value at the start than step ${before.step}!`);

        }

        // The EV Taler tariff and the prices of the session.
        let tariff:          JSONObject;
        let price:           VerifiedPrice | undefined;
        let elements:        readonly JSONObject[];
        let sessionStarted:  number;

        if (previous !== undefined) {
            tariff          = previous.tariff;
            price           = previous.priceStatement;
            elements        = previous.elements;
            sessionStarted  = previous.sessionStarted;
        }
        else {

            sessionStarted  = this.timestamp;
            tariff          = evTalerTariff(station, step.EVSEId);

            if (idOf(tariff) !== step.chargingTariffId)
                throw new POIError(`The step names the charging tariff '${step.chargingTariffId}', not the EV Taler tariff '${idOf(tariff)}' of the EVSE '${step.EVSEId}'!`);

            const current = verifyPriceStatements(station, priceStatements, { at: sessionStarted });
            const pricing = [ ...current.values() ].filter(candidate =>
                                candidate.statement.prices.some(prices => tariffIdOf(textOf(get(prices, 'chargingTariffId')))?.text === step.chargingTariffId));

            price = step.priceStatement !== undefined ? pricing.find(candidate => candidate.digest === step.priceStatement) : undefined;

            if (step.priceStatement !== undefined && price === undefined)
                throw new POIError(`The step names the price statement '${step.priceStatement}', which is not one current at the start of the session pricing its tariff!`);

            const [ first ] = pricing;

            if (step.priceStatement === undefined && first !== undefined)
                throw new POIError(`The session is priced by the price statement '${first.digest}', which the step does not name!`);

            const objects = (value: JSONValue | undefined): JSONObject[] =>
                isArray(value) ? value.filter(isObject) : [];

            elements = price !== undefined
                           ? objects(get(objects(get(price.statement.priceStatus, 'prices')).find(prices => get(prices, 'chargingTariffId') === step.chargingTariffId) ?? {}, 'elements'))
                           : objects(get(tariff, 'elements'));

        }

        const currency = textOf(get(tariff, 'currency'));

        // The exchanges, in the currency of the tariff.
        if (this.currency !== currency)
            throw new POIError(`The step is paid in '${this.currency}', not in '${currency}', the currency of the EV Taler tariff!`);

        const accepted = merchant.exchanges.filter(exchange => exchange.currency === currency);
        const foreign  = this.exchanges.find(exchange => !accepted.some(known => sameBaseURL(exchange.url, known.baseURL) && exchange.masterPublicKey === known.masterPublicKey));

        if (foreign !== undefined)
            throw new POIError(`The exchange '${foreign.url}' (${foreign.masterPublicKey}) of the step is not one of the operator's evTaler in '${currency}'!`);

        // The times.
        if (this.payDeadline < this.timestamp || this.refundDeadline <= this.payDeadline)
            throw new POIError('A step is paid after it is made and refunded until after its payment deadline!');

        if (this.autoRefund === undefined || this.autoRefund <= 0)
            throw new POIError('The wallet must pick the refund of a step up by itself: contract terms of a step have an auto refund!');

        // The signed meter value at the start.
        let start = previous?.start;

        if (step.startMeterValue !== undefined && start === undefined) {

            if (verifier === undefined)
                throw new POIError('From step 2 on, the signed meter value at the start is verified: a transparency software is needed!');

            start = verifyMeterValue(station, step.EVSEId, step.startMeterValue, verifier);

        }

        // The amount.
        let stepPrice:    NetDecimal | undefined;
        let flatFee:      NetDecimal | undefined;
        let reserve:      NetDecimal | undefined;
        let amountCheck:  EVTalerAmountCheck = EVTalerAmountChecks.Unsupported;

        const rates = EVTalerRates.of(currency, tariff, elements);

        if (!(rates instanceof EVTalerRates))
            diagnostics.push(`The amount is not recalculated: ${rates.reason}.`);

        else {

            const covered = rates.stepPrice(step.covers);

            if (typeof covered === 'string')
                throw new POIError(covered);

            const estimate = step.covers.unit === 'kWh' ? rates.timePerHour !== undefined : rates.energyPerKWh !== undefined;
            const base     = covered.plus(step.step === 1 ? rates.flatFee ?? NetDecimal.ZERO : NetDecimal.ZERO);

            if (this.amount.compareTo(base) < 0 || (step.step > 1 && !estimate && !this.amount.equals(base)))
                throw new POIError(`The amount ${writeAmount(this.amount, currency)} ${currency} of step ${step.step} is not what it covers, ${step.covers.toString()}, at the price of the session: ${writeAmount(base, currency)} ${currency}${step.step === 1 ? ', the flat fee and the reserve' : ''}!`);

            stepPrice    = covered;
            flatFee      = step.step === 1 ? rates.flatFee ?? NetDecimal.ZERO : undefined;
            reserve      = step.step === 1 ? this.amount.minus(base) : undefined;
            amountCheck  = estimate ? EVTalerAmountChecks.Estimate : EVTalerAmountChecks.Exact;

            if (estimate)
                diagnostics.push('The session is priced by energy and time: the amount of a step is an estimate, settled at the end.');

        }

        return { terms: this, step, merchant, tariff, currency, priceStatement: price, elements, rates: rates instanceof EVTalerRates ? rates : undefined,
                 sessionStarted, stepPrice, flatFee, reserve, amountCheck, start, diagnostics };

    }

}


/**
 * The EV Taler tariff of the given EVSE, as the proof gives its tariffs (`EVTalerContractTerms.TryGetEVTalerTariff`, 4.3):
 * the first of the type AD_HOC_PAYMENT, else the first without a type, with a currency, naming no payment means or
 * EV_TALER among them; refused in the words of WWCP_POI otherwise.
 */
export function evTalerTariff(station: VerifiedChargingStation, evseId: string): JSONObject {

    const tariffs  = station.tariffs.get(evseId) ?? [];
    const typeOf   = (tariff: JSONObject): string | undefined => {
        const type = get(tariff, 'tariffType');
        return typeof type === 'string' ? type : undefined;
    };

    const tariff   = tariffs.find(item => typeOf(item) === 'AD_HOC_PAYMENT') ?? tariffs.find(item => typeOf(item) === undefined);
    const meansJSON = tariff === undefined ? undefined : get(tariff, 'paymentMeans');
    const means    = isArray(meansJSON) ? meansJSON.filter((mean): mean is string => typeof mean === 'string') : [];

    if (tariff === undefined || typeof get(tariff, 'currency') !== 'string' ||
        (means.length > 0 && !means.some(mean => ignoringCase(mean) === 'EV_TALER')))
        throw new POIError(`The EVSE '${evseId}' has no EV Taler tariff in the proof!`);

    return tariff;

}
