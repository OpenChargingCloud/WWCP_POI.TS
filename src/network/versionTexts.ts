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

import { get, isArray, isObject, type JSONObject, type JSONValue } from '../json/value.ts';


// Hardware revisions, firmware versions and serial numbers as WWCP_POI reads them, as HardwareRevision, FirmwareVersion and
// SerialNumber (WWCP_POI2, since c31e5e3 and 3672b06): a text exactly as it is given, not empty and neither beginning nor
// ending with whitespace, compared ordinally, case included. The models of charging stations and energy meters name each
// of their hardware revisions and firmware versions once (`ModelVersions.Of`), and so do certificates and the energy
// meters a certificate was issued with, which `certificates.ts` reads as WWCP_POI reads them. WWCP_POI refuses a version
// naming another where it reads it (`reading.ts`); whether a station, a meter or a certificate names a revision or version
// of its model it checks with the references (`references.ts`).


export const objectsOf = (value: JSONValue | undefined): JSONObject[] =>
    isArray(value) ? value.filter(isObject) : [];

/**
 * Whether a UTF-16 code unit is whitespace as `Char.IsWhiteSpace` tells it, which `String.Trim` and
 * `String.IsNullOrWhiteSpace` take: not quite what `String.prototype.trim` takes, as U+0085 is whitespace there and U+FEFF
 * is not. All of them are within the Basic Multilingual Plane.
 */
const isWhitespace = (codeUnit: number): boolean =>
    (codeUnit >= 0x09 && codeUnit <= 0x0D) || codeUnit === 0x20 || codeUnit === 0x85 || codeUnit === 0xA0 || codeUnit === 0x1680 ||
    (codeUnit >= 0x2000 && codeUnit <= 0x200A) || codeUnit === 0x2028 || codeUnit === 0x2029 || codeUnit === 0x202F ||
    codeUnit === 0x205F || codeUnit === 0x3000;

/** Whether the given value is a text `TryParse` takes: not empty, neither beginning nor ending with whitespace. */
export const isText = (value: JSONValue): boolean =>
    typeof value === 'string' && value.length > 0 && !isWhitespace(value.charCodeAt(0)) && !isWhitespace(value.charCodeAt(value.length - 1));

/** The given text as `String.Trim` gives it, as the identifications of WWCP_POI take it. */
export function trimmed(text: string): string {

    let start = 0;
    let end   = text.length;

    while (start < end && isWhitespace(text.charCodeAt(start)))
        start++;

    while (end > start && isWhitespace(text.charCodeAt(end - 1)))
        end--;

    return start === 0 && end === text.length ? text : text.slice(start, end);

}

export const MODEL_VERSIONS = { hardwareRevisions: 'hardware revision', firmwareVersions: 'firmware version' };

/**
 * The error, when the given holder names a hardware revision or firmware version twice, which `ModelVersions.Of` refuses
 * once both were read, as an argument of its `Versions` (`A hardware revision of the charging station model 'GD-DC300'
 * must not be given twice! (Parameter 'Versions')`): a model, a certificate or an energy meter a certificate was issued
 * with, `whose` in words.
 */
export function versionTwice(holder: JSONObject, whose: string): string | undefined {

    for (const [property, description] of Object.entries(MODEL_VERSIONS)) {
        const versions = get(holder, property);
        if (isArray(versions) && new Set(versions).size !== versions.length)
            return `A ${description} of ${whose} must not be given twice! (Parameter 'Versions')`;
    }

    return undefined;

}

