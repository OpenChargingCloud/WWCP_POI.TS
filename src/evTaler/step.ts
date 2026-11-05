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
import { get, isObject, type JSONObject, type JSONValue } from '../json/value.ts';
import { evseId as evseIdOf, tariffId as tariffIdOf } from '../network/poiJSON.ts';
import { trimmed } from '../network/versionTexts.ts';
import { CONTEXT_PREFIX } from '../common.ts';
import { decimalTextOf, NetDecimal, writeDecimal } from './amounts.ts';
import { EVTalerSignedMeterValue } from './meterValue.ts';


// A step of an EV Taler session in WWCP terms (EVTalerStep, EVTalerCovers of WWCP_POI c2d39e5, concepts/EVTaler.md 5.2):
// the object of "extra": { "wwcp": … } of its order, signed by the merchant with the rest of the contract terms.


/** The JSON-LD context of a step. */
export const EV_TALER_STEP_CONTEXT = CONTEXT_PREFIX + 'roamingNetwork/evTalerStep/v1';

/** What a step covers: energy, in kWh, or time, in minutes. */
export type EVTalerCoversUnit = 'kWh' | 'min';


/** What a step of an EV Taler session pays for, counted from the start of the session: from, to, and the unit. */
export class EVTalerCovers {

    private constructor(
        public readonly from:  NetDecimal,
        public readonly to:    NetDecimal,
        public readonly unit:  EVTalerCoversUnit
    ) {}

    /** What a step covers: from less than to, neither negative, in kWh or minutes; refused in the words of WWCP_POI otherwise. */
    public static create(from: NetDecimal | number, to: NetDecimal | number, unit: string): EVTalerCovers {

        const start = typeof from === 'number' ? NetDecimal.of(Decimal.parse(String(from))) : from;
        const end   = typeof to   === 'number' ? NetDecimal.of(Decimal.parse(String(to)))   : to;

        if (start.isNegative() || end.compareTo(start) <= 0)
            throw new POIError(`A step covers from ${writeDecimal(start)} to ${writeDecimal(end)}: from not negative and less than to!`);

        if (unit !== 'kWh' && unit !== 'min')
            throw new POIError(`A step covers kWh or minutes, not '${unit}'! (Parameter 'Unit')`);

        return new EVTalerCovers(start, end, unit);

    }

    /** Reads what a step covers (`EVTalerCovers.TryParse`), its decimals as texts; refused in its words. */
    public static parse(json: JSONValue | undefined): EVTalerCovers {

        if (!isObject(json) || Object.keys(json).some(property => property !== 'from' && property !== 'to' && property !== 'unit'))
            throw new POIError('What a step covers is a JSON object of from, to and unit!');

        const from = decimalTextOf(json, 'from');

        if (typeof from === 'string')
            throw new POIError(from);

        const to   = decimalTextOf(json, 'to');

        if (typeof to === 'string')
            throw new POIError(to);

        const unit = get(json, 'unit');

        if ((unit !== 'kWh' && unit !== 'min') || to.compareTo(from) <= 0)
            throw new POIError("A step covers from less than to, in 'kWh' or 'min'!");

        return new EVTalerCovers(from, to, unit);

    }

    /** The decimals as texts. */
    public toJSON(): JSONObject {
        return { from: writeDecimal(this.from), to: writeDecimal(this.to), unit: this.unit };
    }

    public equals(other: EVTalerCovers): boolean {
        return this.from.equals(other.from) && this.to.equals(other.to) && this.unit === other.unit;
    }

    /** E.g. "0 to 5 kWh". */
    public toString(): string {
        return `${writeDecimal(this.from)} to ${writeDecimal(this.to)} ${this.unit}`;
    }

}


const KNOWN = [ '@context', 'roamingNetworkId', 'EVSEId', 'sessionId', 'step', 'previousOrderId', 'chargingTariffId', 'priceStatement', 'covers', 'startMeterValue' ];

/** Whether the given text is a session of the offers server: 128 bits, canonical base64url without padding, 22 characters. */
export function isEVTalerSessionId(text: string | undefined): text is string {

    if (text === undefined || !/^[A-Za-z0-9_-]{22}$/u.test(text))
        return false;

    // The last of the 22 characters holds 2 bits of the 16 bytes: its 4 unused bits are zero.
    const last = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(text.charAt(21));

    return (last & 0x0F) === 0;

}

/** The data of a step: as `EVTalerStep.create` takes it. */
export interface EVTalerStepData {
    readonly roamingNetworkId:  string;
    readonly EVSEId:            string;
    readonly sessionId:         string;
    readonly step:              number;
    readonly previousOrderId?:  string | undefined;
    readonly chargingTariffId:  string;
    readonly priceStatement?:   string | undefined;
    readonly covers:            EVTalerCovers;
    readonly startMeterValue?:  EVTalerSignedMeterValue | undefined;
}


/**
 * A step of an EV Taler session in WWCP terms (`EVTalerStep`): where, which session, which step after which order, the EV
 * Taler tariff and the price statement, what it covers, and from step 2 on the signed meter value at the start.
 */
export class EVTalerStep {

    private constructor(
        /** The roaming network, trimmed as its identification reads it. */
        public readonly roamingNetworkId:  string,
        /** The EVSE, as the roaming network writes it. */
        public readonly EVSEId:            string,
        /** The session at the offers server: 128 random bits, base64url. Not GNU Taler's session_id of an order. */
        public readonly sessionId:         string,
        /** The number of the step: 1, 2, … */
        public readonly step:              number,
        /** The order_id of the step before; none in step 1. */
        public readonly previousOrderId:   string | undefined,
        /** The EV Taler tariff of the EVSE (4.3). */
        public readonly chargingTariffId:  string,
        /** The digest of the price statement whose elements price the session; none when the tariff's own do. */
        public readonly priceStatement:    string | undefined,
        public readonly covers:            EVTalerCovers,
        /** From step 2 on: the signed meter value at the start of the session, as the station sent it. */
        public readonly startMeterValue:   EVTalerSignedMeterValue | undefined
    ) {}

    /** A step of an EV Taler session, refused in the words of WWCP_POI where it is no valid one. */
    public static create(data: EVTalerStepData): EVTalerStep {

        const roamingNetworkId = trimmed(data.roamingNetworkId);

        if (roamingNetworkId.length === 0)
            throw new POIError(`Invalid roaming network '${data.roamingNetworkId}' of a step!`);

        const step  = new EVTalerStep(roamingNetworkId, data.EVSEId, data.sessionId, data.step, data.previousOrderId, data.chargingTariffId,
                                      data.priceStatement, data.covers, data.startMeterValue);
        const error = step.invalid();

        if (error !== undefined)
            throw new POIError(error);

        return step;

    }

    /**
     * Reads a step of an EV Taler session, the object of "extra": { "wwcp": … } (`EVTalerStep.TryParse`): its context,
     * nothing it does not know, and the rules of `create`; refused in the words of WWCP_POI.
     */
    public static parse(json: JSONValue | undefined): EVTalerStep {

        if (!isObject(json))
            throw new POIError('A step of an EV Taler session must be a JSON object!');

        const unknown = Object.keys(json).find(property => !KNOWN.includes(property));

        if (unknown !== undefined)
            throw new POIError(`A step of an EV Taler session has no '${unknown}'!`);

        if (get(json, '@context') !== EV_TALER_STEP_CONTEXT)
            throw new POIError(`The JSON-LD context of a step of an EV Taler session must be '${EV_TALER_STEP_CONTEXT}'!`);

        const text = (name: string): string | undefined => {
            const value = get(json, name);
            return typeof value === 'string' ? value : undefined;
        };

        if ([ 'roamingNetworkId', 'EVSEId', 'sessionId', 'chargingTariffId' ].some(name => text(name) === undefined) ||
            [ 'previousOrderId', 'priceStatement' ].some(name => get(json, name) !== undefined && text(name) === undefined))
            throw new POIError('A step of an EV Taler session names its roaming network, EVSE, session and charging tariff, and maybe its previous order and its price statement, as texts!');

        const roamingNetworkId = trimmed(text('roamingNetworkId') ?? '');

        if (roamingNetworkId.length === 0)
            throw new POIError(`Invalid roaming network '${text('roamingNetworkId') ?? ''}' of a step!`);

        const number = get(json, 'step');

        if (!(typeof number === 'number' && Number.isInteger(number) || number instanceof Decimal && number.isInteger) ||
            (typeof number === 'number' ? number : Number(number.mantissa)) < 1 || (typeof number === 'number' ? number : Number(number.mantissa)) > 0xFFFF_FFFF)
            throw new POIError('The number of a step is an integer from 1 on!');

        const covers = EVTalerCovers.parse(get(json, 'covers'));

        let startMeterValue: EVTalerSignedMeterValue | undefined;

        if (get(json, 'startMeterValue') !== undefined) {
            try {
                startMeterValue = EVTalerSignedMeterValue.parse(get(json, 'startMeterValue'));
            }
            catch (e) {
                throw new POIError(`The start meter value of a step is invalid: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        const step  = new EVTalerStep(roamingNetworkId, text('EVSEId') ?? '', text('sessionId') ?? '',
                                      typeof number === 'number' ? number : Number(number.mantissa),
                                      text('previousOrderId'), text('chargingTariffId') ?? '', text('priceStatement'), covers, startMeterValue);
        const error = step.invalid();

        if (error !== undefined)
            throw new POIError(error);

        return step;

    }

    /** The JSON of "extra": { "wwcp": … }. */
    public toJSON(): JSONObject {
        return {
            '@context':        EV_TALER_STEP_CONTEXT,
            roamingNetworkId:  this.roamingNetworkId,
            EVSEId:            this.EVSEId,
            sessionId:         this.sessionId,
            step:              this.step,
            ...(this.previousOrderId === undefined ? {} : { previousOrderId: this.previousOrderId }),
            chargingTariffId:  this.chargingTariffId,
            ...(this.priceStatement  === undefined ? {} : { priceStatement:  this.priceStatement }),
            covers:            this.covers.toJSON(),
            ...(this.startMeterValue === undefined ? {} : { startMeterValue: this.startMeterValue.toJSON() }),
        };
    }

    private invalid(): string | undefined {

        if (evseIdOf(this.EVSEId) === undefined)
            return `Invalid EVSE '${this.EVSEId}' of a step!`;

        if (!isEVTalerSessionId(this.sessionId))
            return 'The session of a step is 128 bits, base64url without padding: 22 characters!';

        if (this.step < 1)
            return 'The number of a step is from 1 on!';

        if ((this.step === 1) !== (this.previousOrderId === undefined))
            return 'Every step after the first one, and only those, names the order of the step before!';

        if (this.previousOrderId !== undefined && trimmed(this.previousOrderId).length === 0)
            return 'The previous order of a step must be a nonempty text!';

        if (tariffIdOf(this.chargingTariffId) === undefined)
            return `Invalid charging tariff '${this.chargingTariffId}' of a step!`;

        if (this.priceStatement !== undefined && !/^[0-9a-f]{64}$/u.test(this.priceStatement))
            return 'The price statement of a step is its digest: 64 lowercase hexadecimal digits!';

        if (this.step === 1 && !this.covers.from.equals(NetDecimal.ZERO))
            return 'Step 1 covers from the start of the session, from 0!';

        if ((this.step === 1) !== (this.startMeterValue === undefined))
            return 'Every step after the first one, and only those, names the signed meter value at the start of the session!';

        return undefined;

    }

}
