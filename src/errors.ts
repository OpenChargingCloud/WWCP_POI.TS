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

/**
 * What every refusal of this library throws: the data are not what POI says they must be, or do not verify.
 * Its message says why, as the C# implementation would.
 */
export class POIError extends Error {

    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = 'POIError';
    }

}


/** The value, or a refusal with the given reason where it is missing. */
export function required<T>(value: T | null | undefined, reason: string): T {

    if (value === null || value === undefined)
        throw new POIError(reason);

    return value;

}


/** The result of a check that does not throw: verified, or refused with the reason. */
export type Checked<T = true> =
    | { readonly ok: true;  readonly value: T }
    | { readonly ok: false; readonly error: string };


/** Runs a check that throws a POIError, and returns its result or the reason it refused. */
export function check<T>(fn: () => T): Checked<T> {

    try {
        return { ok: true, value: fn() };
    }
    catch (e) {
        if (e instanceof POIError)
            return { ok: false, error: e.message };
        throw e;
    }

}
