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
import { POIError } from '../errors.ts';
import { DOTNET_BAD_BASE64, isCanonicalBase64, isDotNetBase64 } from '../encoding/text.ts';
import { signatureAlgorithm, verifySignature } from '../crypto/signature.ts';
import { canonicalJSONBytes } from '../json/canonical.ts';
import { get, isArray, isObject, without, type JSONObject, type JSONValue } from '../json/value.ts';
import { KeyUsages } from '../keys.ts';
import { timestampOf } from '../network/poiJSON.ts';
import type { VerifiedChargingStation } from '../verifier/chargingStation.ts';
import { decimalTextOf, NetDecimal, writeAmount, writeDecimal } from './amounts.ts';
import { EVTalerAmountChecks, type EVTalerAmountCheck, type EVTalerVerifiedStep } from './contractTerms.ts';
import { EVTalerSignedMeterValue, verifyMeterValue, type EVTalerMeterValueVerifier, type EVTalerVerifiedMeterValue } from './meterValue.ts';


// The settlement statement of an EV Taler session (EVTalerSettlement of WWCP_POI c2d39e5, concepts/EVTaler.md 5.4, decision
// D5 (a)): signed by its charging station operator with a signing key that may sign payments, naming both signed meter
// values, the energy, the orders of its steps, the price, what was paid and what was refunded. No content: no history and
// no checkpoint takes it; the app gets it as the last event of its session and keeps it. This library reads and verifies
// it, it does not sign one.


/** The JSON-LD context of a settlement statement. */
export const EV_TALER_SETTLEMENT_CONTEXT = CONTEXT_PREFIX + 'roamingNetwork/evTalerSettlement/v1';

const KNOWN = [ '@context', 'roamingNetworkId', 'EVSEId', 'sessionId', 'merchantPublicKey', 'chargingTariffId', 'priceStatement', 'start', 'end',
                'meterValues', 'energy', 'currency', 'orders', 'price', 'paid', 'refunded', 'role', 'signer', 'signedAt', 'algorithm', 'keyId', 'value' ];

const TEXTS = [ 'roamingNetworkId', 'EVSEId', 'sessionId', 'merchantPublicKey', 'chargingTariffId', 'currency', 'signer', 'algorithm', 'keyId', 'value' ];

const idOf = (json: JSONValue | undefined): string => {
    const id = isObject(json) ? get(json, '@id') : undefined;
    return typeof id === 'string' ? id : '';
};

/** An order of a step of a session and what it took. */
export interface EVTalerSettledOrder {
    readonly orderId:  string;
    readonly amount:   NetDecimal;
}

/** What a reader established of a settlement statement (`EVTalerSettlementVerification`, 5.4). */
export interface EVTalerSettlementVerification {
    readonly settlement:     EVTalerSettlement;
    /** The signed meter values at the start and at the end, verified. */
    readonly start:          EVTalerVerifiedMeterValue;
    readonly end:            EVTalerVerifiedMeterValue;
    /** The energy of the session, in kWh: the end value less the start value. */
    readonly energy:         NetDecimal;
    /** The price of the session by its rates, where they are of the simple profile. */
    readonly computedPrice:  NetDecimal | undefined;
    /** Exact when the price was recalculated, else unsupported. */
    readonly priceCheck:     EVTalerAmountCheck;
    readonly diagnostics:    readonly string[];
}


/** The settlement statement of an EV Taler session (`EVTalerSettlement`). */
export class EVTalerSettlement {

    private constructor(
        /** The JSON as signed. */
        public readonly json:         JSONObject,
        /** When it started: the time of the signed meter value at the start, in milliseconds since 1970. */
        public readonly start:        number,
        /** When it ended: the time of the signed meter value at the end. */
        public readonly end:          number,
        /** The signed meter values at the start and at the end, as the station sent them. */
        public readonly meterValues:  readonly [ EVTalerSignedMeterValue, EVTalerSignedMeterValue ],
        /** The energy, in kWh. */
        public readonly energy:       NetDecimal,
        /** The orders of the steps, in their order, and what each took. */
        public readonly orders:       readonly EVTalerSettledOrder[],
        public readonly price:        NetDecimal,
        /** What the steps took together. */
        public readonly paid:         NetDecimal,
        /** What was refunded: the paid amount less the price, not less than nothing. */
        public readonly refunded:     NetDecimal,
        public readonly signedAt:     number
    ) {}

    private text(name: string): string {
        const value = get(this.json, name);
        return typeof value === 'string' ? value : '';
    }

    public get roamingNetworkId():   string { return this.text('roamingNetworkId'); }
    public get EVSEId():             string { return this.text('EVSEId'); }
    public get sessionId():          string { return this.text('sessionId'); }
    /** The public key of the merchant instance that took the steps, as in evTaler. */
    public get merchantPublicKey():  string { return this.text('merchantPublicKey'); }
    public get chargingTariffId():   string { return this.text('chargingTariffId'); }
    /** The digest of the price statement that priced it, if any. */
    public get priceStatement():     string | undefined { const digest = get(this.json, 'priceStatement'); return typeof digest === 'string' ? digest : undefined; }
    public get currency():           string { return this.text('currency'); }
    /** The charging station operator signing it. */
    public get signer():             string { return this.text('signer'); }
    public get algorithm():          string { return this.text('algorithm'); }
    /** The @id of the signing key. */
    public get keyId():              string { return this.text('keyId'); }
    /** The signature, Base64. */
    public get value():              string { return this.text('value'); }

    /**
     * Reads the given settlement statement (`EVTalerSettlement.TryParse`): its context and role, nothing it does not know,
     * both signed meter values, at least one order, its decimals as texts, what was paid the sum of the orders and what was
     * refunded the paid amount less the price, not less than nothing. Refused in the words of WWCP_POI.
     */
    public static parse(json: JSONValue | undefined): EVTalerSettlement {

        if (!isObject(json))
            throw new POIError('A settlement statement must be a JSON object!');

        const unknown = Object.keys(json).find(property => !KNOWN.includes(property));

        if (unknown !== undefined)
            throw new POIError(`A settlement statement has no '${unknown}'!`);

        if (get(json, '@context') !== EV_TALER_SETTLEMENT_CONTEXT || get(json, 'role') !== 'chargingStationOperator')
            throw new POIError('Unsupported context or role of a settlement statement!');

        const priceStatement = get(json, 'priceStatement');
        const notText        = TEXTS.find(name => typeof get(json, name) !== 'string') ??
                               (priceStatement !== undefined && typeof priceStatement !== 'string' ? 'priceStatement' : undefined);

        if (notText !== undefined)
            throw new POIError(`A settlement statement names its '${notText}' as a text!`);

        // No settlement without both signed meter values (5.4).
        const meterValuesJSON = get(json, 'meterValues');

        if (!isArray(meterValuesJSON) || meterValuesJSON.length !== 2)
            throw new POIError('A settlement statement names both signed meter values, at the start and at the end!');

        const meterValues = meterValuesJSON.map(meterValueJSON => {
            try {
                return EVTalerSignedMeterValue.parse(meterValueJSON);
            }
            catch (e) {
                throw new POIError(`A signed meter value of a settlement statement is invalid: ${e instanceof Error ? e.message : String(e)}`);
            }
        });

        const timestamp = (name: string): number => {
            const text = get(json, name);
            const time = typeof text === 'string' ? timestampOf(text) : undefined;
            if (time === undefined)
                throw new POIError(`The '${name}' must be an ISO 8601 timestamp!`);
            return time;
        };

        const start     = timestamp('start');
        const end       = timestamp('end');
        const signedAt  = timestamp('signedAt');

        const decimal = (name: string): NetDecimal => {
            const value = decimalTextOf(json, name);
            if (typeof value === 'string')
                throw new POIError(value);
            return value;
        };

        const energy    = decimal('energy');
        const price     = decimal('price');
        const paid      = decimal('paid');
        const refunded  = decimal('refunded');

        const ordersJSON = get(json, 'orders');

        if (!isArray(ordersJSON) || ordersJSON.length === 0)
            throw new POIError('A settlement statement names the orders of the steps of its session!');

        const orders = ordersJSON.map((order): EVTalerSettledOrder => {

            const orderId  = isObject(order) ? get(order, 'orderId') : undefined;
            const amount   = isObject(order) && Object.keys(order).length === 2 ? decimalTextOf(order, 'amount') : undefined;

            if (!isObject(order) || typeof orderId !== 'string' || orderId.length === 0 || amount === undefined || typeof amount === 'string')
                throw new POIError('An order of a settlement statement is { "orderId": …, "amount": … }, the amount a decimal as a text!');

            return { orderId, amount };

        });

        const sum      = orders.reduce((total, order) => total.plus(order.amount), NetDecimal.ZERO);
        const owed     = paid.minus(price);

        if (!paid.equals(sum) || !refunded.equals(owed.isNegative() ? NetDecimal.ZERO : owed))
            throw new POIError('What a settlement statement says was paid is the sum of its orders, and what was refunded the paid amount less the price!');

        const [ startValue, endValue ] = meterValues;

        return new EVTalerSettlement(json, start, end, [ startValue as EVTalerSignedMeterValue, endValue as EVTalerSignedMeterValue ],
                                     energy, orders, price, paid, refunded, signedAt);

    }

    /** The signature input: the canonical JSON of what it names, but its value. */
    public signingBytes(): Uint8Array {
        return canonicalJSONBytes(without(this.json, 'value'));
    }

    /**
     * Verifies this settlement statement against the verified charging station and the verified steps of its session
     * (`EVTalerSettlement.TryVerify`, 5.4): signed by the operator with a key that may sign payments, valid when it was
     * signed; of the merchant, EVSE, session, tariff and price statement of the steps, naming their orders and amounts; both
     * signed meter values verified with one measurement key the proof gives, the start value the one the steps name, the end
     * value after and not below it, the times and the energy theirs; and, where the prices are of the simple profile, the
     * price recalculated. Refused in the words of WWCP_POI.
     */
    public verify(station:   VerifiedChargingStation,
                  steps:     readonly EVTalerVerifiedStep[],
                  verifier:  EVTalerMeterValueVerifier): EVTalerSettlementVerification {

        const diagnostics: string[] = [];

        // Signed by the operator, with a key for payments.
        if (this.roamingNetworkId !== station.roamingNetwork.id || this.signer !== idOf(station.operator))
            throw new POIError('The settlement statement is not one of the operator of the station!');

        const key = station.operatorSigningKeys.find(candidate => candidate.id === this.keyId);

        if (key === undefined || !key.isValidAt(this.signedAt) || !key.maySign(KeyUsages.Payments))
            throw new POIError('The settlement statement is not signed with a key of the operator for payments, valid when it was signed!');

        try {
            signatureAlgorithm(this.algorithm);
        }
        catch {
            throw new POIError('Unknown or noncanonical signature algorithm of the settlement statement!');
        }

        if (!isDotNetBase64(this.value))
            throw new POIError(`The signature of the settlement statement is invalid: ${DOTNET_BAD_BASE64}`);

        if (!isCanonicalBase64(this.value))
            throw new POIError('The signature of the settlement statement must be nonempty canonical Base64!');

        try {
            verifySignature(this.algorithm, key.key, this.signingBytes(), this.value);
        }
        catch (e) {
            throw new POIError(`The signature of the settlement statement is invalid: ${e instanceof Error ? e.message : String(e)}`);
        }

        // The steps of the session.
        const [ first ] = steps;

        if (first === undefined)
            throw new POIError('A settlement statement is checked against the steps of its session!');

        steps.forEach((step, index) => {
            if (step.step.step !== index + 1 || (index > 0 && step.step.previousOrderId !== steps[index - 1]?.terms.orderId))
                throw new POIError('The steps of a session are 1, 2, …, each naming the order of the one before!');
        });

        if (this.merchantPublicKey !== first.merchant.merchantPublicKey ||
            this.EVSEId            !== first.step.EVSEId                ||
            this.sessionId         !== first.step.sessionId             ||
            this.chargingTariffId  !== first.step.chargingTariffId      ||
            this.priceStatement    !== first.step.priceStatement        ||
            this.currency          !== first.currency)
            throw new POIError('The settlement statement names another merchant, EVSE, session, tariff, price statement or currency than the steps of its session!');

        const ordersOfSteps = this.orders.length === steps.length && steps.every((item, index) => {
            const order = this.orders[index];
            return order?.orderId === item.terms.orderId && order.amount.equals(item.terms.amount);
        });

        if (!ordersOfSteps)
            throw new POIError('The settlement statement names the orders of the steps of its session, in their order, each with what it took!');

        // Both signed meter values.
        let start: EVTalerVerifiedMeterValue;
        let end:   EVTalerVerifiedMeterValue;

        try {
            start  = verifyMeterValue(station, this.EVSEId, this.meterValues[0], verifier);
            end    = verifyMeterValue(station, this.EVSEId, this.meterValues[1], verifier);
        }
        catch (e) {
            throw new POIError(`No settlement without both signed meter values: ${e instanceof Error ? e.message : String(e)}`);
        }

        if (start.keyId !== end.keyId)
            throw new POIError('The signed meter values at the start and at the end are of two meters!');

        const named = steps.map(step => step.step.startMeterValue).find(value => value !== undefined);

        if (named !== undefined && !named.equals(this.meterValues[0]))
            throw new POIError('The signed meter value at the start is not the one the contract terms of the steps name!');

        if (end.reading.timestamp <= start.reading.timestamp || end.reading.energy.compareTo(start.reading.energy) < 0)
            throw new POIError('The signed meter value at the end is before or below the one at the start!');

        const energy = end.reading.energy.minus(start.reading.energy);

        if (this.start !== start.reading.timestamp || this.end !== end.reading.timestamp || !this.energy.equals(energy))
            throw new POIError('The start, the end and the energy of the settlement statement are not those of its signed meter values!');

        if (this.signedAt < this.end)
            throw new POIError('A settlement statement is signed after the end of its session!');

        // The price.
        let computed:    NetDecimal | undefined;
        let priceCheck:  EVTalerAmountCheck = EVTalerAmountChecks.Unsupported;

        if (first.rates === undefined)
            diagnostics.push('The price is not recalculated: the prices of the session are not of the simple profile.');

        else {

            computed = first.rates.sessionPrice(energy, this.end - this.start);

            if (!this.price.equals(computed))
                throw new POIError(`The price of the session is ${writeAmount(computed, this.currency)} ${this.currency} by its prices, not ${writeAmount(this.price, this.currency)} ${this.currency}!`);

            priceCheck = EVTalerAmountChecks.Exact;

        }

        if (this.price.compareTo(this.paid) > 0)
            diagnostics.push('The price is more than was paid: what the credit did not cover is not collected (5.5).');

        return { settlement: this, start, end, energy, computedPrice: computed, priceCheck, diagnostics };

    }

    /** E.g. "7.412 kWh, 5.32 EUR". */
    public toString(): string {
        return `${writeDecimal(this.energy)} kWh, ${writeAmount(this.price, this.currency)} ${this.currency}`;
    }

}
