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
import { onlyProperties, requireArray, requireInteger, requireObject, requireString, requireTimestamp } from '../common.ts';
import { canonicalJSONBytes } from '../json/canonical.ts';
import type { JSONObject, JSONValue } from '../json/value.ts';
import { POIPublicKey } from '../keys.ts';
import { verifySignature } from '../crypto/signature.ts';
import { hash } from '../crypto/hash.ts';
import { toHex, isLowerHex } from '../encoding/text.ts';
import type { Checkpoint } from '../history/checkpoint.ts';
import type { PriceStatement } from '../proofs/priceStatement.ts';
import { POIError } from '../errors.ts';

/** Experimental extensions, not the checkpoint witness wire format or an RFC 3161 token. */
export const PRICE_PUBLICATION_RECEIPT_CONTEXT = 'https://open.charging.cloud/contexts/wwcp/pricePublicationReceipt/v1';
export const WITNESS_PUBLICATION_POLICY_CONTEXT = 'https://open.charging.cloud/contexts/wwcp/witnessPublicationPolicy/v1';
/** Bind the actual original CPO signature and the complete selected tariff, including its currency. */
export function pricePublicationOfferHashes(statement: PriceStatement, tariff: JSONObject): {readonly priceStatementSHA256: string; readonly tariffSHA256: string} {
    return {priceStatementSHA256: toHex(hash('sha256', canonicalJSONBytes(statement.json))), tariffSHA256: toHex(hash('sha256', canonicalJSONBytes(tariff)))};
}
export interface PublicationWitness {
    readonly id: string;
    /** Independently approved organization identity; several keys/aliases never add votes. */
    readonly organization: string;
    readonly networks: readonly string[];
    readonly keys: readonly POIPublicKey[];
    readonly notBefore: number;
    readonly notAfter: number;
    /** Locally accepted upper bound, never taken from a receipt. */
    readonly clockErrorMs: number;
    /** Explicit receipt endpoints, not a guessed discovery URL. */
    readonly endpoints: readonly string[];
    readonly json: JSONObject;
}
export interface WitnessPublicationPolicy {
    readonly requiredOrganizations: number;
    readonly witnesses: readonly PublicationWitness[];
    readonly json: JSONObject;
}
function identifier(json: JSONObject, property: string): string {
    const text = requireString(json, property);
    if (text.trim() !== text || text.length === 0 || text.length > 512) throw new POIError('Invalid publication identity');
    for (let index = 0; index < text.length; index++) if (text.charCodeAt(index) < 32) throw new POIError('Invalid publication identity');
    return text;
}
/** Syntax only. Callers must additionally apply their own public-network transport policy before fetching. */
export function publicPublicationURL(text: string): string {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '' || text.length > 2048) throw new POIError('Publication sources require public HTTPS without credentials or fragments');
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1' || host.includes(':') || /^\d+(\.\d+){3}$/u.test(host) || !host.includes('.')) throw new POIError('Publication sources require a public DNS hostname');
    return url.href;
}
/** Parsing a suggested policy never authorizes it. Only the caller supplies the accepted policy. */
export function parseWitnessPublicationPolicy(value: JSONValue): WitnessPublicationPolicy {
    const json = requireObject(value, 'Witness publication policy');
    onlyProperties(json, ['@context', 'requiredOrganizations', 'witnesses'], 'Witness publication policy');
    if (json['@context'] !== WITNESS_PUBLICATION_POLICY_CONTEXT) throw new POIError('Unsupported witness publication policy');
    const requiredOrganizations = requireInteger(json, 'requiredOrganizations', 1, 16);
    const entries = requireArray(json['witnesses'], 'Publication witnesses');
    if (entries.length > 32 || canonicalJSONBytes(json).length > 1024 * 1024) throw new POIError('Witness policy exceeds its capacity');
    const witnesses: PublicationWitness[] = [], ids = new Set<string>(), material = new Map<string, string>();
    for (const entry of entries) {
        const item = requireObject(entry, 'A publication witness');
        onlyProperties(item, ['id', 'organization', 'role', 'networks', 'keys', 'notBefore', 'notAfter', 'clockErrorMs', 'endpoints'], 'A publication witness');
        if (item['role'] !== 'price-publication-and-time') throw new POIError('A witness needs the explicit publication and time role');
        const id = identifier(item, 'id'), organization = identifier(item, 'organization');
        if (ids.has(id)) throw new POIError('Duplicate witness identity');
        ids.add(id);
        const networks = requireArray(item['networks'], 'Witness network scopes');
        if (networks.length === 0 || networks.length > 32 || networks.some(value => typeof value !== 'string' || value.length === 0 || value === '*') || new Set(networks).size !== networks.length) throw new POIError('Explicit witness network scopes required');
        const keys = POIPublicKey.parseAll(item['keys'], 'Witness publication keys');
        if (keys.length === 0 || keys.length > 8 || new Set(keys.map(key => key.id)).size !== keys.length) throw new POIError('Invalid witness key list');
        for (const key of keys) {
            if (!key.maySign('witnessPublications')) throw new POIError('Witness key usage does not permit publication receipts');
            const fingerprint = toHex(key.key.thumbprint()), before = material.get(fingerprint);
            if (before !== undefined && before !== organization) throw new POIError('The same witness key cannot represent different organizations');
            material.set(fingerprint, organization);
        }
        const notBefore = requireTimestamp(item, 'notBefore'), notAfter = requireTimestamp(item, 'notAfter');
        if (notAfter <= notBefore) throw new POIError('Invalid witness validity interval');
        const clockErrorMs = requireInteger(item, 'clockErrorMs', 0, 300000);
        const endpoints = requireArray(item['endpoints'], 'Witness receipt endpoints');
        if (endpoints.length > 4 || endpoints.some(url => typeof url !== 'string')) throw new POIError('Invalid witness receipt endpoints');
        witnesses.push(Object.freeze({id, organization, networks: Object.freeze(networks as string[]), keys: Object.freeze(keys), notBefore, notAfter, clockErrorMs,
            endpoints: Object.freeze((endpoints as string[]).map(publicPublicationURL)), json: item}));
    }
    return Object.freeze({requiredOrganizations, witnesses: Object.freeze(witnesses), json});
}

export class PricePublicationReceipt {
    private constructor(public readonly json: JSONObject, public readonly observedAt: number, public readonly signedAt: number) {}
    public static parse(value: JSONValue): PricePublicationReceipt {
        const json = requireObject(value, 'Price publication receipt');
        onlyProperties(json, ['@context', 'assertion', 'roamingNetworkId', 'EVSEId', 'priceStatementDigest', 'priceStatementSHA256', 'tariffSHA256', 'checkpointId', 'witnessId', 'publicSourceURL', 'observedAt', 'signedAt', 'algorithm', 'keyId', 'value'], 'Price publication receipt');
        if (json['@context'] !== PRICE_PUBLICATION_RECEIPT_CONTEXT || json['assertion'] !== 'public-price-retrieval') throw new POIError('Unsupported publication receipt assertion');
        for (const field of ['roamingNetworkId', 'EVSEId', 'witnessId', 'algorithm', 'keyId']) identifier(json, field);
        const signature = requireString(json, 'value');
        if (signature.length === 0 || signature.length > 131072) throw new POIError('Invalid publication signature size');
        if (!isLowerHex(requireString(json, 'priceStatementDigest'), 32) || !/^(?:[0-9a-f]{64}|[0-9a-f]{96}|[0-9a-f]{128})$/u.test(requireString(json, 'checkpointId'))) throw new POIError('Invalid publication receipt digest');
        for (const field of ['priceStatementSHA256', 'tariffSHA256']) if (!isLowerHex(requireString(json, field), 32)) throw new POIError('Invalid signed-price or tariff digest');
        publicPublicationURL(requireString(json, 'publicSourceURL'));
        const observedAt = requireTimestamp(json, 'observedAt'), signedAt = requireTimestamp(json, 'signedAt');
        if (signedAt < observedAt || signedAt - observedAt > 60000) throw new POIError('A publication receipt must be signed within one minute after observation');
        return new PricePublicationReceipt(json, observedAt, signedAt);
    }
    public signingBytes(): Uint8Array {
        const {value: _, ...signed} = this.json;
        return canonicalJSONBytes(signed);
    }
    public digest(): string { return toHex(hash('sha256', canonicalJSONBytes(this.json))); }
}
export interface PricePublicationVerification {
    readonly status: 'witnessed-before-signed-start' | 'not-proven' | 'invalid';
    readonly requiredOrganizations: number;
    readonly organizations: readonly string[];
    readonly timeBasis: 'trusted-witness-clocks-versus-signed-start';
    readonly actualStartTime: 'not-independently-proven';
    readonly receipts: readonly {
        readonly witnessId: string;
        readonly organization?: string;
        readonly keyId?: string;
        readonly receiptDigest?: string;
        readonly latestPublicationAt?: number;
        readonly sourceURL?: string;
        readonly status: 'counted' | 'duplicate-organization' | 'after-start' | 'untrusted' | 'invalid';
        readonly detail: string;
    }[];
}
/** Inclusion and CPO signatures are checked by the calling shared session-price verifier first. */
export function verifyPricePublication(receipts: readonly JSONValue[], policy: WitnessPublicationPolicy | undefined, subject: {
    readonly roamingNetworkId: string; readonly evseId: string; readonly statement: PriceStatement; readonly tariff: JSONObject;
    readonly checkpoints: readonly Checkpoint[]; readonly chargingStarted: number; readonly now: number;
    readonly excludedKeyMaterial?: readonly string[]; readonly excludedIdentities?: readonly string[];
}): PricePublicationVerification {
    if (!Number.isFinite(subject.chargingStarted) || !Number.isFinite(subject.now) || subject.chargingStarted > subject.now || receipts.length > 64) throw new POIError('Invalid publication evaluation context');
    // Reparse even a typed policy. Plain serialized objects cannot substitute for caller authorization.
    const accepted = policy === undefined ? undefined : parseWitnessPublicationPolicy(policy.json);
    const organizations = new Set<string>(), rows: PricePublicationVerification['receipts'][number][] = [];
    for (const raw of receipts) {
        let receipt: PricePublicationReceipt | undefined;
        try {
            receipt = PricePublicationReceipt.parse(raw);
            const json = receipt.json, witness = accepted?.witnesses.find(item => item.id === json['witnessId']);
            if (witness?.networks.includes(subject.roamingNetworkId) !== true) {
                rows.push({witnessId: requireString(json, 'witnessId'), status: 'untrusted', detail: 'No locally authorized witness for this network'});
                continue;
            }
            const key = witness.keys.find(item => item.id === json['keyId']);
            if (key === undefined) throw new POIError('The receipt key is not authorized for this witness');
            if ((subject.excludedIdentities ?? []).includes(witness.id) || (subject.excludedIdentities ?? []).includes(witness.organization) || (subject.excludedKeyMaterial ?? []).includes(toHex(key.key.thumbprint()))) throw new POIError('An RNO/CPO authority cannot count as an independent publication witness');
            const lower = receipt.observedAt - witness.clockErrorMs, upper = receipt.signedAt + witness.clockErrorMs;
            if (lower < witness.notBefore || upper >= witness.notAfter || !key.isValidAt(lower) || !key.isValidAt(upper)) throw new POIError('Witness/key does not cover the observation and signing interval');
            if (receipt.signedAt > subject.now || json['roamingNetworkId'] !== subject.roamingNetworkId || json['EVSEId'] !== subject.evseId || json['priceStatementDigest'] !== subject.statement.digestHex()) throw new POIError('Foreign, substituted or future publication receipt');
            const hashes = pricePublicationOfferHashes(subject.statement, subject.tariff);
            if (json['priceStatementSHA256'] !== hashes.priceStatementSHA256 || json['tariffSHA256'] !== hashes.tariffSHA256) throw new POIError('Receipt does not bind the exact original CPO signature and selected tariff definition/currency');
            const checkpoint = subject.checkpoints.find(item => item.id === json['checkpointId']);
            if (checkpoint === undefined || checkpoint.createdAt > receipt.observedAt + witness.clockErrorMs || subject.statement.signedAt > receipt.observedAt + witness.clockErrorMs) throw new POIError('Receipt needs the exact authorized price checkpoint and a consistent observation time');
            verifySignature(requireString(json, 'algorithm'), key.key, receipt.signingBytes(), requireString(json, 'value'));
            const common = {witnessId: witness.id, organization: witness.organization, keyId: key.id, receiptDigest: receipt.digest(), latestPublicationAt: upper, sourceURL: requireString(json, 'publicSourceURL')};
            if (upper >= subject.chargingStarted) rows.push({...common, status: 'after-start', detail: 'The latest observation/signing time including the accepted clock error is not before the signed start'});
            else if (organizations.has(witness.organization)) rows.push({...common, status: 'duplicate-organization', detail: 'Only one vote per independently approved organization'});
            else { organizations.add(witness.organization); rows.push({...common, status: 'counted', detail: 'Public retrieval of this exact included offer witnessed before its signed charging start'}); }
        }
        catch (error) { rows.push({witnessId: typeof receipt?.json['witnessId'] === 'string' ? receipt.json['witnessId'] : '', status: 'invalid', detail: error instanceof Error ? error.message : String(error)}); }
    }
    const requiredOrganizations = accepted?.requiredOrganizations ?? 2;
    return Object.freeze({status: organizations.size >= requiredOrganizations ? 'witnessed-before-signed-start' : rows.some(row => row.status === 'invalid') ? 'invalid' : 'not-proven',
        requiredOrganizations, organizations: Object.freeze([...organizations].sort()), timeBasis: 'trusted-witness-clocks-versus-signed-start', actualStartTime: 'not-independently-proven', receipts: Object.freeze(rows)});
}
