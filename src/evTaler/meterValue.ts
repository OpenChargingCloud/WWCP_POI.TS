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
import { bytesEqual, fromBase64, isCanonicalBase64 } from '../encoding/text.ts';
import { get, isArray, isObject, type JSONObject, type JSONValue } from '../json/value.ts';
import { measurementPublicKey } from '../network/poiValues.ts';
import { trimmed } from '../network/versionTexts.ts';
import type { VerifiedChargingStation } from '../verifier/chargingStation.ts';
import type { NetDecimal } from './amounts.ts';


// The signed meter values of an EV Taler session (EVTalerSignedMeterValue of WWCP_POI c2d39e5, concepts/EVTaler.md 5.4):
// as a charging station sends them with OCPP 2.1, kept and compared as sent. WWCP_POI reads no format of a meter: a
// transparency software verifies a value with a key and tells its meter, time and energy register.


/** What a transparency software reads from a signed meter value it verified: the meter that signed it, when, the energy register in kWh. */
export interface EVTalerMeterReading {
    readonly meterSerialNumber:  string;
    /** When it was measured, in milliseconds since 1970. */
    readonly timestamp:          number;
    readonly energy:             NetDecimal;
}

/** A measurement public key a station proof gives: its identification and its key, the DER of a SubjectPublicKeyInfo. */
export interface EVTalerMeasurementKey {
    readonly id:    string;
    readonly key:   Uint8Array;
    readonly json:  JSONObject;
}

/**
 * A transparency software verifying a signed meter value with the given public key, as it knows the format of the value,
 * e.g. OCMF (`EVTalerMeterValueVerifier`): what the value says, or an Error saying why it is not valid.
 */
export type EVTalerMeterValueVerifier = (value: EVTalerSignedMeterValue, key: EVTalerMeasurementKey) => EVTalerMeterReading;

/** A signed meter value verified with a key a station proof gives for the meter of the EVSE or for the station. */
export interface EVTalerVerifiedMeterValue {
    readonly value:     EVTalerSignedMeterValue;
    readonly reading:   EVTalerMeterReading;
    /** The @id of the measurement public key it was verified with. */
    readonly keyId:     string;
    /** The @id of the energy meter or the charging station whose key it is. */
    readonly signedBy:  string;
}

const KNOWN = [ 'signedMeterData', 'signingMethod', 'encodingMethod', 'publicKey' ];

const idOf = (json: JSONValue | undefined): string => {
    const id = isObject(json) ? get(json, '@id') : undefined;
    return typeof id === 'string' ? id : '';
};

/** Whether the given text is one without whitespace around it, as `String.Trim` tells it, and not empty. */
const isTrimmedText = (text: string): boolean =>
    trimmed(text).length > 0 && trimmed(text) === text;


/**
 * A signed meter value as a charging station sends it with OCPP 2.1 (SignedMeterValueType): the signed data as the meter
 * gives it, Base64 encoded, how it is encoded and signed, and maybe the public key. It is kept and compared as sent.
 */
export class EVTalerSignedMeterValue {

    private constructor(
        /** The signed data, canonical Base64, as the station sent it. */
        public readonly signedMeterData:  string,
        /** How the meter encodes it, e.g. "OCMF". */
        public readonly encodingMethod:   string,
        /** How it is signed, if the station says so apart from the data. */
        public readonly signingMethod:    string | undefined,
        /** The public key, canonical Base64 of the DER of a SubjectPublicKeyInfo, if the station sent it: which key of the proof verifies it. */
        public readonly publicKey:        string | undefined
    ) {}

    /** A signed meter value as a charging station sent it, refused in the words of WWCP_POI where it is no valid one. */
    public static create(signedMeterData: string, encodingMethod: string, signingMethod?: string, publicKey?: string): EVTalerSignedMeterValue {
        const value = new EVTalerSignedMeterValue(signedMeterData, encodingMethod, signingMethod, publicKey);
        const error = value.invalid();
        if (error !== undefined)
            throw new POIError(error);
        return value;
    }

    /**
     * Reads a signed meter value as OCPP 2.1 writes it (`EVTalerSignedMeterValue.TryParse`): the signed data and the public
     * key canonical Base64, the methods nonempty texts, nothing else; refused in its words.
     */
    public static parse(json: JSONValue | undefined): EVTalerSignedMeterValue {

        if (!isObject(json))
            throw new POIError('A signed meter value must be a JSON object!');

        const unknown = Object.keys(json).find(property => !KNOWN.includes(property));

        if (unknown !== undefined)
            throw new POIError(`A signed meter value has no '${unknown}'!`);

        const data       = get(json, 'signedMeterData');
        const encoding   = get(json, 'encodingMethod');
        const signing    = get(json, 'signingMethod');
        const publicKey  = get(json, 'publicKey');

        if (typeof data !== 'string' || typeof encoding !== 'string' ||
            (signing !== undefined && typeof signing !== 'string') || (publicKey !== undefined && typeof publicKey !== 'string'))
            throw new POIError('A signed meter value names its signed meter data and its encoding method, and maybe its signing method and its public key, as texts!');

        return EVTalerSignedMeterValue.create(data, encoding, signing, publicKey);

    }

    /** As OCPP 2.1 writes it. */
    public toJSON(): JSONObject {
        return {
            signedMeterData: this.signedMeterData,
            ...(this.signingMethod === undefined ? {} : { signingMethod: this.signingMethod }),
            encodingMethod:  this.encodingMethod,
            ...(this.publicKey     === undefined ? {} : { publicKey:     this.publicKey }),
        };
    }

    /** Whether the station sent the same, field by field. */
    public equals(other: EVTalerSignedMeterValue | undefined): boolean {
        if (other === undefined)
            return false;
        return this.signedMeterData === other.signedMeterData &&
               this.signingMethod   === other.signingMethod   &&
               this.encodingMethod  === other.encodingMethod  &&
               this.publicKey       === other.publicKey;
    }

    private invalid(): string | undefined {

        if (!isCanonicalBase64(this.signedMeterData))
            return 'The signed meter data must be nonempty canonical Base64!';

        if (!isTrimmedText(this.encodingMethod))
            return 'The encoding method of a signed meter value must be a nonempty text without surrounding whitespace!';

        if (this.signingMethod !== undefined && !isTrimmedText(this.signingMethod))
            return 'The signing method of a signed meter value must be a nonempty text without surrounding whitespace!';

        if (this.publicKey !== undefined && !isCanonicalBase64(this.publicKey))
            return 'The public key of a signed meter value must be nonempty canonical Base64!';

        return undefined;

    }

}


/**
 * Verifies the given signed meter value of the given EVSE with a measurement public key the station proof gives for the
 * energy meter of the EVSE or for the charging station (`EVTalerSignedMeterValue.TryVerify`): the one the value names by
 * its public key, else the only one there is; no key is tried after another. The reading must name the serial number of
 * the meter or the station whose key it is. Refused in the words of WWCP_POI.
 */
export function verifyMeterValue(station:   VerifiedChargingStation,
                                 evseId:    string,
                                 value:     EVTalerSignedMeterValue,
                                 verifier:  EVTalerMeterValueVerifier): EVTalerVerifiedMeterValue {

    const owners: JSONObject[] = [];
    const meter  = get(station.evses.find(evse => idOf(evse) === evseId) ?? {}, 'energyMeter');

    if (isObject(meter))
        owners.push(meter);

    owners.push(station.chargingStation);

    let candidates: { owner: JSONObject, key: EVTalerMeasurementKey }[] = [];

    for (const owner of owners) {

        const keys = get(owner, 'publicKeys');

        for (const keyJSON of isArray(keys) ? keys.filter(isObject) : []) {

            const error = measurementPublicKey(keyJSON);

            if (error !== undefined)
                throw new POIError(`A measurement public key of '${idOf(owner)}' in the proof is invalid: ${error}`);

            const keyText = get(keyJSON, 'key');

            candidates.push({ owner, key: { id: idOf(keyJSON), key: fromBase64(typeof keyText === 'string' ? keyText : ''), json: keyJSON } });

        }

    }

    if (value.publicKey !== undefined) {
        const named = fromBase64(value.publicKey);
        candidates  = candidates.filter(candidate => bytesEqual(candidate.key.key, named));
    }

    const [ candidate ] = candidates;

    if (candidate === undefined || candidates.length !== 1)
        throw new POIError(candidates.length === 0
                               ? `The proof gives no measurement public key of the meter of the EVSE '${evseId}' or of its station${value.publicKey !== undefined ? ' that is the one of the signed meter value' : ''}!`
                               : `The proof gives more than one measurement public key of the meter of the EVSE '${evseId}' and its station: the signed meter value has to name its own!`);

    let reading: EVTalerMeterReading;

    try {
        reading = verifier(value, candidate.key);
    }
    catch (e) {
        throw new POIError(`The signed meter value is not verified with the key '${candidate.key.id}' of '${idOf(candidate.owner)}': ${e instanceof Error ? e.message : String(e)}`);
    }

    const serialNumber = get(candidate.owner, 'serialNumber');

    if (typeof serialNumber !== 'string' || reading.meterSerialNumber !== serialNumber)
        throw new POIError(`The signed meter value names the serial number '${reading.meterSerialNumber}', not the one '${typeof serialNumber === 'string' ? serialNumber : ''}' of '${idOf(candidate.owner)}' the proof gives!`);

    return { value, reading, keyId: candidate.key.id, signedBy: idOf(candidate.owner) };

}
