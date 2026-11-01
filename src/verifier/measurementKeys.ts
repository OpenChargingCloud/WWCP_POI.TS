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
import { CoseKey, CoseCurves, DerReader, Tag, contentsOf, derObjectIdentifier, derBitString, isOnCurve } from '@vanaheimr/cose';
import { POIError } from '../errors.ts';
import { fromBase64, toBase64, toHex } from '../encoding/text.ts';
import { hash } from '../crypto/hash.ts';
import { requireObject, requireString } from '../common.ts';
import { isObject, type JSONValue } from '../json/value.ts';
import { etagToText } from '../etags.ts';
import { TrustContext } from '../proofs/trustContext.ts';
import { verifyChargingStation } from './chargingStation.ts';

export type MeasurementKeyFormat = 'spki-der' | 'cose-key';
export type MeasurementKeyProblem = 'missing-meter' | 'identity-mismatch' | 'ambiguous-key' | 'unsupported-key' | 'invalid-key';
export class MeasurementKeyError extends POIError {
    public constructor(public readonly code: MeasurementKeyProblem, message: string) { super(message); }
}

/** P-256 pilot. The declared format is required; a 64-character ID never determines its derivation scheme. */
export interface MeasurementPublicKey {
    readonly id: string;
    readonly idScheme: 'sha256-spki' | 'sha256-cose-key-thumbprint';
    readonly canonicalId: string;
    readonly sourceFormat: MeasurementKeyFormat;
    readonly value: string;
    readonly encodings: readonly string[];
    readonly algorithm: 'ECDSA-secp256r1';
}

export interface VerifiedMeterKeyBinding {
    readonly evseId: string;
    readonly chargingStationId: string;
    readonly meterId: string;
    readonly meterSerialNumber: string;
    readonly key: MeasurementPublicKey;
    readonly evidence: {
        readonly roamingNetworkId: string;
        readonly roamingNetworkOperatorId: string;
        readonly commitId: string;
        readonly revision: number;
        readonly treeRoot: string;
        readonly keyStatementDigest: string;
        readonly verifiedAt: number;
        readonly validUntil: number;
        /** A current authenticated snapshot is not historical installation/key-rotation evidence. */
        readonly association: 'current-snapshot';
    };
}

export function parseMeasurementPublicKey(value: JSONValue, format: MeasurementKeyFormat): MeasurementPublicKey {
    if (!(['spki-der', 'cose-key'] as readonly string[]).includes(format))
        throw new MeasurementKeyError('unsupported-key', 'Unknown measurement-key format');
    const json = requireObject(value, 'A measurement public key');
    const id = requireString(json, '@id');
    const bytes = fromBase64(requireString(json, 'key'));
    let cose: CoseKey;
    let idScheme: MeasurementPublicKey['idScheme'];
    try {
        if (format === 'spki-der') {
            const document = new DerReader(bytes, 'Measurement SubjectPublicKeyInfo');
            const sequence = contentsOf(document.read(Tag.sequence), 'SubjectPublicKeyInfo'); document.expectEnd();
            const algorithm = contentsOf(sequence.read(Tag.sequence), 'AlgorithmIdentifier');
            const oid = derObjectIdentifier(algorithm.read(Tag.objectIdentifier), 'Public key algorithm');
            const curve = derObjectIdentifier(algorithm.read(Tag.objectIdentifier), 'Public key curve'); algorithm.expectEnd();
            if (oid !== '1.2.840.10045.2.1' || curve !== '1.2.840.10045.3.1.7')
                throw new MeasurementKeyError('unsupported-key', 'The measurement-key pilot supports ECDSA P-256 only');
            const point = derBitString(sequence.read(Tag.bitString), 'Measurement public point'); sequence.expectEnd();
            if (point.length !== 65 || point[0] !== 4 || !isOnCurve(CoseCurves.P256, point))
                throw new MeasurementKeyError('invalid-key', 'A measurement key needs a valid uncompressed P-256 point');
            cose = CoseKey.fromCoordinates(CoseCurves.P256, point.slice(1, 33), point.slice(33));
            idScheme = 'sha256-spki';
            if (id !== toHex(hash('sha256', bytes))) throw new MeasurementKeyError('invalid-key', 'The measurement SPKI hash does not match its ID');
        }
        else {
            cose = CoseKey.parse(bytes);
            if (cose.isPrivate || cose.curve?.id !== CoseCurves.P256.id || cose.x?.length !== 32 || cose.y?.length !== 32)
                throw new MeasurementKeyError('unsupported-key', 'A public P-256 COSE measurement key is required');
            const point = Uint8Array.from([4, ...cose.x, ...cose.y]);
            if (!isOnCurve(CoseCurves.P256, point)) throw new MeasurementKeyError('invalid-key', 'The measurement point is not on P-256');
            if (toBase64(cose.toBytes()) !== toBase64(bytes) || id !== toHex(cose.thumbprint()))
                throw new MeasurementKeyError('invalid-key', 'The COSE key must be deterministic and match its thumbprint');
            idScheme = 'sha256-cose-key-thumbprint';
            cose = CoseKey.fromCoordinates(CoseCurves.P256, cose.x, cose.y);
        }
    }
    catch (error) {
        if (error instanceof MeasurementKeyError) throw error;
        throw new MeasurementKeyError('invalid-key', error instanceof Error ? error.message : 'Invalid measurement key');
    }
    return Object.freeze({ id, idScheme, canonicalId: toHex(cose.thumbprint()), sourceFormat: format,
        value: toBase64(cose.toBytes()), encodings: Object.freeze(['COSE_Key', 'CBOR', 'base64']), algorithm: 'ECDSA-secp256r1' });
}

/** Re-verifies the original proof against an authorized context. Never searches other EVSEs or tries unrelated keys. */
export function verifyMeterKey(context: TrustContext, proof: JSONValue, request: {
    readonly evseId: string; readonly meterSerialNumber: string; readonly meterId?: string;
    readonly keyId?: string; readonly keyFormat: MeasurementKeyFormat;
}): VerifiedMeterKeyBinding {
    if (!(context instanceof TrustContext)) throw new POIError('Meter-key authorization requires a TrustContext');
    const station = verifyChargingStation(context, proof, { evseId: request.evseId });
    if (station.verification.validUntil < context.evaluatedAt)
        throw new POIError('The certified-key observation is no longer current');
    const evse = station.evses.find(item => item['@id'] === request.evseId);
    const meter = evse?.['energyMeter'];
    if (!isObject(meter)) throw new MeasurementKeyError('missing-meter', 'The selected EVSE supplies no directly associated energy meter');
    const meterId = requireString(meter, '@id');
    const serial = requireString(meter, 'serialNumber');
    if (request.meterSerialNumber.trim() === '' || serial !== request.meterSerialNumber || request.meterId !== undefined && meterId !== request.meterId)
        throw new MeasurementKeyError('identity-mismatch', 'The signed meter identity does not match the selected EVSE meter');
    const all = meter['publicKeys'];
    const keys = Array.isArray(all) ? all.filter(item => request.keyId === undefined || isObject(item) && item['@id'] === request.keyId) : [];
    if (keys.length !== 1) throw new MeasurementKeyError('ambiguous-key', 'Select exactly one explicitly identified meter key; no trial verification across keys');
    const key = parseMeasurementPublicKey(keys[0] ?? null, request.keyFormat);
    return Object.freeze({ evseId: request.evseId, chargingStationId: requireString(station.chargingStation, '@id'),
        meterId, meterSerialNumber: serial, key,
        evidence: Object.freeze({ roamingNetworkId: context.roamingNetworkId,
            roamingNetworkOperatorId: context.roamingNetworkOperatorId, commitId: station.commitId,
            revision: station.revision, treeRoot: etagToText(station.eTag), keyStatementDigest: context.keyStatementDigest,
            verifiedAt: station.verification.at, validUntil: station.verification.validUntil, association: 'current-snapshot' }) });
}
