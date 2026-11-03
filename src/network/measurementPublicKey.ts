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

import { BERError }               from '../crypto/ber.ts';
import { certificateOf, issuedBy, type Certificate } from '../crypto/certificates.ts';
import { KeyError, publicKeyOf, subjectPublicKeyInfo } from '../crypto/publicKeys.ts';


/**
 * The error, as `MeasurementPublicKey.TryCheck` of WWCP_POI3 words it, when a measurement public key is no DER encoded
 * SubjectPublicKeyInfo of a key BouncyCastle makes, or its certificates are no DER encoded certificates, the first of the key,
 * each one issued by the next one; undefined for none.
 */
export function measurementKeyError(key: Uint8Array, chain: readonly Uint8Array[]): string | undefined {

    try {

        const info = subjectPublicKeyInfo(key);

        // Only DER, so that a key has one representation, one identification, and one ETag of its meter or station.
        if (!info.record.der)
            return 'A measurement public key must be DER encoded!';

        publicKeyOf(info);

    }
    catch (e) {
        return `A measurement public key must be a SubjectPublicKeyInfo: ${e instanceof BERError || e instanceof KeyError ? e.message : String(e)}`;
    }

    const certificates: Certificate[] = [];

    for (const [ index, bytes ] of chain.entries()) {

        try {

            const read = certificateOf(bytes);

            if (read?.der !== true)
                return `The certificate ${String(index + 1)} of a measurement public key must be DER encoded!`;

            certificates.push(read.certificate);

        }
        catch {
            return `The certificate ${String(index + 1)} of a measurement public key is invalid: Failed to read certificate`;
        }

    }

    const first = certificates[0]?.subjectPublicKeyInfo.record.encoded;

    if (first !== undefined && (first.length !== key.length || first.some((octet, index) => octet !== key[index])))
        return 'The first certificate of a measurement public key must be the one of the key!';

    for (let i = 0; i < certificates.length - 1; i++) {
        const [ certificate, issuer ] = [ certificates[i], certificates[i + 1] ];
        if (certificate === undefined || issuer === undefined || !issuedBy(certificate, issuer))
            return `The certificate ${String(i + 1)} of a measurement public key is not issued by the certificate ${String(i + 2)}!`;
    }

    return undefined;

}
