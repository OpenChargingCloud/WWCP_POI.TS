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

import { timeOf, toTimestamp }   from '../common.ts';
import { canonicalJSONBytes }    from '../json/canonical.ts';
import { get, isObject, type JSONObject } from '../json/value.ts';
import { hash }                  from '../crypto/hash.ts';
import { signatureAlgorithm, verifySignature } from '../crypto/signature.ts';
import { fromBase64, toHex }     from '../encoding/text.ts';
import type { KeyUsage, POIPublicKey } from '../keys.ts';
import { POIError }              from '../errors.ts';
import { capitalized, isBlank, messageOf, only, optionalTimestamp, textOf } from './json.ts';


/**
 * The signature of a QI-Digital document by its issuer, with one of the signing keys of the issuer: a COSE algorithm over
 * the Styx canonical JSON of the document, as everything else in the roaming network is signed (`QIDigitalSignature`).
 */
export class QIDigitalSignature {

    private constructor(
        /** When it was signed, to the millisecond: the date of issue of the document. */
        public readonly signedAt:   number,
        /** The COSE name of the signature algorithm, e.g. ES256. */
        public readonly algorithm:  string,
        /** The `@id` of a signing key of the issuer of the document. */
        public readonly keyId:      string,
        /** The signature value, canonical Base64. */
        public readonly value:      string
    ) {}

    public static parse(json: JSONObject): QIDigitalSignature {

        only(json, 'a signature', 'signedAt', 'algorithm', 'keyId', 'value');

        const signedAt   = optionalTimestamp(json, 'signedAt', 'signing timestamp');
        const algorithm  = textOf(json, 'algorithm');
        const keyId      = textOf(json, 'keyId');
        const value      = textOf(json, 'value');

        if (signedAt === undefined || algorithm === undefined || algorithm.length === 0 || keyId === undefined || keyId.length === 0 || value === undefined || value.length === 0)
            throw new POIError('A signature requires a signing timestamp, an algorithm, a key identification and a value!');

        if (isBlank(algorithm) || isBlank(keyId))
            throw new POIError('A signature of a QI-Digital document requires an algorithm, a key identification and a value.');

        return new QIDigitalSignature(signedAt, algorithm, keyId, value);

    }

    /** Its JSON; without its value, it is part of the signature input. */
    public toJSON(withValue = true): JSONObject {

        const json: JSONObject = { signedAt: toTimestamp(this.signedAt), algorithm: this.algorithm, keyId: this.keyId };

        if (withValue)
            json['value'] = this.value;

        return json;

    }

}


/** The signature of a document, if it names one (`TryParseSignature`). */
export function signatureOf(json: JSONObject): QIDigitalSignature | undefined {

    const value = get(json, 'signature');

    if (value === undefined)
        return undefined;

    if (!isObject(value))
        throw new POIError('The signature must be a JSON object!');

    try {
        return QIDigitalSignature.parse(value);
    }
    catch (e) {
        throw new POIError(`Invalid signature: ${messageOf(e)}`);
    }

}


/**
 * A QI-Digital document: a digital calibration certificate, a digital declaration of conformity or a digital certificate
 * of conformity, signed by its issuer with one of its signing keys of the roaming network (`AQIDigitalDocument`). A proof
 * of concept of WWCP_POI: not part of a roaming network yet, a party hands it out, and anybody checks it against the
 * roaming network, its parties and keys, its models, charging stations and energy meters.
 */
export abstract class QIDigitalDocument {

    protected constructor(
        /** Its signature by its issuer, if it is signed. */
        public readonly signature: QIDigitalSignature | undefined
    ) {}

    /** Its JSON-LD context, which names the kind of document and its version: part of its signature input. */
    public abstract get context(): string;

    /** The usage a signing key of its issuer must have to sign it. */
    public abstract get usage(): KeyUsage;

    /** Its issuer in words, e.g. "the conformity assessment body 'PTB'". */
    public abstract get issuerText(): string;

    /** Itself in words, e.g. "the digital calibration certificate 'DCC-1'". */
    public abstract get documentText(): string;

    /** Its content, as WWCP_POI writes it: everything but its JSON-LD context and its signature (`Content()`). */
    protected abstract content(): JSONObject;

    /** What it signs and what its digest covers: its JSON-LD context, its content and its signature without its value. */
    public signatureInput(): JSONObject {

        const json: JSONObject = { '@context': this.context, ...this.content() };

        if (this.signature !== undefined)
            json['signature'] = this.signature.toJSON(false);

        return json;

    }

    /**
     * The digest of this document: the SHA-256 of its signature input, its signature value left out, 64 lowercase
     * hexadecimal digits; of its content alone when it is not signed. Another document names it by it.
     */
    public get digest(): string {
        return toHex(hash('sha256', canonicalJSONBytes(this.signatureInput())));
    }

    /** The signature input as Styx canonical JSON (`GetSigningBytes`). */
    public signingBytes(): Uint8Array {

        if (this.signature === undefined)
            throw new POIError(`${this.documentText} is not signed.`);

        return canonicalJSONBytes(this.signatureInput());

    }

    /** Verifies its signature with the given public key: by that key, with a canonical algorithm and value (`VerifySignature`). */
    public verifySignature(key: POIPublicKey): void {

        const signature = this.signature;

        if (signature === undefined)
            throw new POIError(`${this.documentText} is not signed.`);

        if (signature.keyId !== key.id)
            throw new POIError(`The key ID of ${this.documentText} does not match the expected key ID.`);

        try {
            signatureAlgorithm(signature.algorithm);
        }
        catch {
            throw new POIError('Unknown or noncanonical signature algorithm.');
        }

        let value: Uint8Array;

        try {
            value = fromBase64(signature.value);
        }
        catch {
            value = new Uint8Array();
        }

        if (value.length === 0)
            throw new POIError('The value must contain nonempty canonical standard Base64.');

        verifySignature(signature.algorithm, key.key, this.signingBytes(), signature.value);

    }

    /**
     * Verifies its signature with the one of the given signing keys of its issuer it names, valid when it was signed, and
     * at `at` when a time is given, allowed to sign its usage (`TryVerify`).
     */
    public verifyWith(signingKeys: readonly POIPublicKey[], at?: number | Date | string): void {

        const signature = this.signature;

        if (signature === undefined)
            throw new POIError(`${capitalized(this.documentText)} is not signed!`);

        const signingKey = signingKeys.find(key => key.id === signature.keyId);

        if (signingKey === undefined)
            throw new POIError(`The key '${signature.keyId}' of ${this.documentText} is no signing key of ${this.issuerText}!`);

        if (!signingKey.isValidAt(signature.signedAt))
            throw new POIError(`The signing key '${signature.keyId}' of ${this.issuerText} is not valid at ${toTimestamp(signature.signedAt)}, when ${this.documentText} was signed!`);

        if (at !== undefined && !signingKey.isValidAt(timeOf(at)))
            throw new POIError(`The signing key '${signature.keyId}' of ${this.issuerText} is not valid at ${toTimestamp(timeOf(at))}!`);

        if (!signingKey.maySign(this.usage))
            throw new POIError(`The signing key '${signature.keyId}' of ${this.issuerText} may not sign '${this.usage}', only ${signingKey.usages.map(usage => `'${usage}'`).join(', ')}!`);

        try {
            this.verifySignature(signingKey);
        }
        catch (e) {
            throw new POIError(`The signature of ${this.documentText} is invalid: ${messageOf(e)}`);
        }

    }

    /** Its JSON as WWCP_POI writes it: its JSON-LD context unless it is embedded, its content and its signature, if signed. */
    public toJSON(embedded = false): JSONObject {

        const json: JSONObject = embedded ? this.content() : { '@context': this.context, ...this.content() };

        if (this.signature !== undefined)
            json['signature'] = this.signature.toJSON();

        return json;

    }

}
