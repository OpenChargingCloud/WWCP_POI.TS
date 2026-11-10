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
import { asText, isObject, isNumber, type JSONObject } from '../json/value.ts';
import { Decimal } from '../json/decimal.ts';
import type { SessionPriceVerification } from './sessionPrices.ts';

/** The unconditional gross rates of the simple profile, as their decimals are written. */
export type GrossRates = NonNullable<NonNullable<SessionPriceVerification['selected']>['rates']>;

/**
 * The gross rates of the simple profile (chargy-gross-rates/v1): one element, without restrictions, of energy, flat or
 * time components each once, with a price not negative, energy and time with a step size of at least one, a flat fee
 * without any, as a FLAT price component has none; none otherwise. Internal: not exported by the package.
 */
export function grossRates(currency:string,elements:readonly JSONObject[]):GrossRates|undefined {
    if(elements.length!==1)return undefined;
    const element=elements[0];if(element===undefined||Object.keys(element).some(key=>key!=='priceComponents'&&key!=='restrictions'))return undefined;
    if(element['restrictions']!==undefined&&(!isObject(element['restrictions'])||Object.keys(element['restrictions']).length>0))return undefined;
    const components=element['priceComponents'];if(!Array.isArray(components)||components.length===0)return undefined;
    const rates:{currency:string;energyPerKWh?:string;flatFee?:string;timePerHour?:string}={currency};
    for(const raw of components){
        if(!isObject(raw)||Object.keys(raw).some(key=>!['type','price','stepSize'].includes(key)))return undefined;
        const type=raw['type'],value=raw['price'],step=raw['stepSize'];
        if(!isNumber(value)||Decimal.parse(asText(value)).mantissa<0n)return undefined;
        // A flat fee has no step size, as a FLAT price component has none; energy and time one of at least one.
        if(type==='FLAT'?'stepSize' in raw:typeof step!=='number'||!Number.isSafeInteger(step)||step<1)return undefined;
        const field=type==='ENERGY'?'energyPerKWh':type==='FLAT'?'flatFee':type==='TIME'?'timePerHour':undefined;
        if(field===undefined||rates[field]!==undefined)return undefined;rates[field]=asText(value);
    }
    return rates;
}
