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

import { get, isArray, type JSONObject } from '../json/value.ts';
import { EV_TALER_PAYMENT_MEANS, evTalerMerchantOf, namesEVTaler, type EVTalerExchange } from '../network/evTaler.ts';
import { ignoringCase }    from '../network/identifications.ts';
import { trimmed }         from '../network/versionTexts.ts';
import type { VerifiedChargingStation } from './chargingStation.ts';


// Where the EVSEs of a verified charging station can be paid for with EV Taler, by which tariff and with which exchanges
// (ChargingStationOperator.EVTaler.cs, concepts/EVTaler.md 4.1 to 4.3): what an app shows as "EV Taler (provider)", from
// the proof of the station, which gives the merchant of its operator. Nothing here takes or makes a payment.

/**
 * The EV Taler tariff of the given EVSE of a verified charging station (`TryGetEVTalerTariff`), as it is at runtime: of
 * the charging tariffs that apply to it, the one of the type AD_HOC_PAYMENT, or else the one without a type; that one, when
 * it names its currency and no payment means or EV_TALER among them. None where the operator has no EV Taler merchant, or
 * the charging pool of the EVSE, as it is at runtime, does not name the payment option EVTaler. Its prices may be stated
 * anew at runtime (SPECIFICATION.md section 12); its currency is the one of the steps.
 */
export function evTalerTariffOf(station: VerifiedChargingStation, evseId: string): JSONObject | undefined {

    if (get(station.operator, 'evTaler') === undefined ||
        !station.evses.some(evse => evse['@id'] === evseId) ||
        !namesEVTaler(get(station.chargingPool, 'paymentOptions')))
        return undefined;

    const tariffs  = station.tariffs.get(evseId) ?? [];
    const typeOf   = (tariff: JSONObject): unknown => get(tariff, 'tariffType') ?? undefined;
    const tariff   = tariffs.find(item => typeOf(item) === 'AD_HOC_PAYMENT') ?? tariffs.find(item => typeOf(item) === undefined);

    if (tariff === undefined || typeof get(tariff, 'currency') !== 'string')
        return undefined;

    const paymentMeans = get(tariff, 'paymentMeans');

    if (isArray(paymentMeans) && paymentMeans.length > 0 &&
        !paymentMeans.some(means => typeof means === 'string' && ignoringCase(trimmed(means)) === ignoringCase(EV_TALER_PAYMENT_MEANS)))
        return undefined;

    return tariff;

}

/**
 * The exchanges whose coins pay for charging at the given EVSE of a verified charging station (`EVTalerExchangesAt`):
 * those of the EV Taler merchant of its operator in the currency of the EV Taler tariff of the EVSE, in the ordinal order
 * of their master public keys; none where the EVSE has no EV Taler tariff. Their `paymentOptionName` is what drivers see,
 * e.g. "EV Taler (Example Exchange, EUR)".
 */
export function evTalerExchangesAt(station: VerifiedChargingStation, evseId: string): EVTalerExchange[] {

    const tariff   = evTalerTariffOf(station, evseId);
    const currency = tariff === undefined ? undefined : get(tariff, 'currency');
    const merchant = evTalerMerchantOf(get(station.operator, 'evTaler') ?? null);

    if (typeof currency !== 'string' || typeof merchant === 'string')
        return [];

    return merchant.exchanges.filter(exchange => exchange.currency === trimmed(currency));

}
