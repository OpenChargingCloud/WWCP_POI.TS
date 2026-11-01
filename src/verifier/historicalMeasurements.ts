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
import { onlyProperties, requireArray, requireObject, requireString } from '../common.ts';
import type { JSONValue } from '../json/value.ts';
import type { TrustAnchor } from '../proofs/trustAnchor.ts';
import { TrustContext } from '../proofs/trustContext.ts';
import { KeyStatement } from '../proofs/keyStatement.ts';
import { POIPublicKey } from '../keys.ts';
import { ChargingStationProof } from '../proofs/stationProof.ts';
import { Checkpoint, CheckpointProof } from '../history/checkpoint.ts';
import { OperatorTrust } from './trust.ts';
import type { TrustedWitness } from './checkpoints.ts';
import { verifyMeterKey, type MeasurementKeyFormat, type VerifiedMeterKeyBinding } from './measurementKeys.ts';
import { POIError } from '../errors.ts';

/** Versioned TS-library extension, not a change to the existing Evidence wire schema. */
export const HISTORICAL_METER_EVIDENCE_CONTEXT = 'https://open.charging.cloud/contexts/wwcp/historicalMeterEvidence/v1';
export interface HistoricalMeterEvidence {
    readonly evseId: string;
    readonly versions: readonly {
        readonly proof: JSONValue;
        readonly commitProof?: JSONValue;
        readonly checkpoints: readonly { readonly checkpoint: JSONValue; readonly operator: JSONValue }[];
    }[];
}
export interface HistoricalMeterKeyBinding extends Omit<VerifiedMeterKeyBinding, 'evidence'> {
    readonly evidence: Omit<VerifiedMeterKeyBinding['evidence'], 'association'> & {
        readonly association: 'historical-attestation';
        readonly measurementTimes: readonly number[];
        readonly historicalStatementDigest: string;
        readonly attestationValidUntil: number;
    };
}
export interface HistoricalMeterVerification {
    readonly bindings: readonly HistoricalMeterKeyBinding[];
    readonly versions: readonly {
        readonly commitId: string;
        readonly publication: 'missing' | 'rno-checkpoint' | 'witnessed-checkpoint';
        readonly checkpointId?: string;
        readonly witnessedBy: readonly string[];
    }[];
    readonly checkedAt: number;
    readonly timeBasis: 'signed-measurement-timestamps';
    readonly independentTime: 'not-proven';
    readonly latestVersion: 'not-proven';
}
export interface HistoricalMeterPolicy {
    readonly witnesses?: readonly TrustedWitness[];
    readonly requiredWitnesses?: number;
    readonly requirePublication?: boolean;
    /** Caller-authorized compromise information, never read from the evidence bundle. */
    readonly revocations?: readonly { readonly keyId: string; readonly invalidFrom: number }[];
}

export function parseHistoricalMeterEvidence(value: JSONValue): HistoricalMeterEvidence {
    const json = requireObject(value, 'Historical meter evidence');
    onlyProperties(json, ['@context', 'EVSEId', 'versions'], 'Historical meter evidence');
    if (json['@context'] !== HISTORICAL_METER_EVIDENCE_CONTEXT) throw new POIError('Unsupported historical meter evidence');
    const versions = requireArray(json['versions'], 'Historical station versions').map(item => {
        const version = requireObject(item, 'A historical station version');
        onlyProperties(version, ['chargingStationProof', 'commitProof', 'checkpoints'], 'A historical station version');
        return {
            proof: requireObject(version['chargingStationProof'], 'A historical station proof'),
            ...(version['commitProof'] === undefined ? {} : { commitProof: version['commitProof'] }),
            checkpoints: (version['checkpoints'] === undefined ? [] : requireArray(version['checkpoints'], 'Historical checkpoints')).map(item => {
                const entry = requireObject(item, 'A checkpoint with its signing authority');
                onlyProperties(entry, ['checkpoint', 'operator'], 'A historical checkpoint entry');
                return { checkpoint: requireObject(entry['checkpoint'], 'A checkpoint'), operator: requireObject(entry['operator'], 'Its operator') };
            })
        };
    });
    if (versions.length === 0) throw new POIError('Historical station evidence is empty');
    return { evseId: requireString(json, 'EVSEId'), versions };
}

export function historicalOperatorContext(current: TrustContext | HistoricalTrustContext, operator: JSONValue, at: number): TrustContext {
    const json = requireObject(operator, 'A historical roaming network operator');
    const statement = KeyStatement.parse(json['keyStatement']);
    if (statement.roamingNetworkId !== current.roamingNetworkId || statement.roamingNetworkOperatorId !== current.roamingNetworkOperatorId ||
        json['@id'] !== current.roamingNetworkOperatorId)
        throw new POIError('The historical statement belongs to another authorized network/operator');
    const authority=current instanceof HistoricalTrustContext?current.authorityAt(at):undefined;
    const anchor=authority?.authorizedAnchor??current.authorizedAnchor;
    const created = TrustContext.create(anchor, statement, {
        trustedIdentityKeyIds: anchor.keys,
        otherIdentityKeys: POIPublicKey.parseAll(json['identityKeys'], 'Historical operator identities'), at
    });
    const context=TrustContext.withEpoch(created,authority?.epoch??current.epoch,current.epochs);
    if (authority===undefined&&context.requiredConsensus < current.requiredConsensus) throw new POIError('Historical verification must not weaken the current local quorum');
    return context;
}


/** Fresh local permission for historical verification, independent of today's statement expiry. Not persisted. */
export class HistoricalTrustContext {
    public readonly authorizedAnchor: TrustAnchor;
    public readonly roamingNetworkId: string;
    public readonly roamingNetworkOperatorId: string;
    public readonly requiredConsensus: number;
    public readonly keyStatementDigest: string;
    /** An operation deadline, not historical document validity or a lease on local trust. */
    public readonly validUntil: number;
    public readonly trustedHolders: readonly (readonly string[])[];
    public readonly epoch:TrustContext['epoch'];public readonly epochs:TrustContext['epochs'];
    private constructor(reference: TrustContext, public readonly evaluatedAt: number,
        private readonly authorities:readonly {readonly context:TrustContext;readonly from:number;readonly until:number}[]=[]) {
        this.epoch=reference.epoch;this.epochs=reference.epochs;
        this.authorizedAnchor = reference.authorizedAnchor;
        this.roamingNetworkId = reference.roamingNetworkId;
        this.roamingNetworkOperatorId = reference.roamingNetworkOperatorId;
        this.requiredConsensus = reference.requiredConsensus;
        this.keyStatementDigest = reference.keyStatementDigest;
        this.trustedHolders = reference.trustedHolders;
        this.validUntil = evaluatedAt + 60000;
        Object.freeze(this);
    }
    /** Contexts must be reconstructed from current local roots and verified transition certificates, never serialized success flags. */
    public static fromVerifiedAuthorities(reference:TrustContext,authorities:readonly {readonly context:TrustContext;readonly from:number;readonly until:number}[],now:number):HistoricalTrustContext {
        if(!Number.isFinite(now)||authorities.length===0||authorities.some(item=>item.context.roamingNetworkId!==reference.roamingNetworkId||item.context.roamingNetworkOperatorId!==reference.roamingNetworkOperatorId||!Number.isFinite(item.from)||item.until<=item.from))throw new POIError('Invalid historical authority lineage');
        return new HistoricalTrustContext(reference,now,authorities);
    }
    public authorityAt(at:number):TrustContext|undefined {
        if(this.authorities.length===0)return undefined;
        const matches=this.authorities.filter(item=>at>=item.from&&at<item.until);
        if(matches.length!==1)throw new POIError('No unambiguous authorized policy covers this historical time');
        return matches[0]?.context;
    }
    public static create(anchor: TrustAnchor, reference: KeyStatement, options: {
        readonly trustedIdentityKeyIds: Iterable<string>; readonly otherIdentityKeys?: readonly POIPublicKey[];
        readonly now?: number;
    }): HistoricalTrustContext {
        const now = options.now ?? Date.now();
        if (!Number.isFinite(now) || reference.signedAt > now) throw new POIError('Invalid historical authorization/reference time');
        const verified = TrustContext.create(anchor,reference,{ trustedIdentityKeyIds:options.trustedIdentityKeyIds,
            ...(options.otherIdentityKeys === undefined ? {} : { otherIdentityKeys:options.otherIdentityKeys }),at:reference.signedAt });
        return new HistoricalTrustContext(verified,now);
    }
}

/** Current caller authorization and historical document validity are deliberately different clocks. */
export function verifyHistoricalMeterEvidence(current: TrustContext | HistoricalTrustContext, value: JSONValue, request: {
    readonly evseId: string; readonly meterSerialNumber: string; readonly measurementTimes: readonly number[];
    readonly keyFormat: MeasurementKeyFormat;
}, policy: HistoricalMeterPolicy = {}): HistoricalMeterVerification {
    if (!(current instanceof TrustContext) && !(current instanceof HistoricalTrustContext)) throw new POIError('Historical verification requires current local authorization');
    const requiredWitnesses = policy.requiredWitnesses ?? 0;
    if (!Number.isSafeInteger(requiredWitnesses) || requiredWitnesses < 0) throw new POIError('Invalid historical witness policy');
    for (const revocation of policy.revocations ?? []) if (!Number.isFinite(revocation.invalidFrom)) throw new POIError('Invalid compromise time');
    const revoked = (id: string, at: number): boolean => (policy.revocations ?? []).some(item => item.keyId === id && at >= item.invalidFrom);
    const evidence = parseHistoricalMeterEvidence(value);
    if (evidence.evseId !== request.evseId) throw new POIError('Historical evidence belongs to another EVSE');
    const times = [...new Set(request.measurementTimes)];
    if (times.length === 0 || times.some(time => !Number.isFinite(time) || time > current.evaluatedAt))
        throw new POIError('Historical verification needs finite, non-future original measurement times');
    const versions = evidence.versions.map(version => ({ ...version, parsed: ChargingStationProof.parse(version.proof) }));
    const used = new Map<string, typeof versions[number]>();
    const bindings: HistoricalMeterKeyBinding[] = [];
    for (const time of times) {
        const matches: { binding: VerifiedMeterKeyBinding; version: typeof versions[number] }[] = [];
        const errors: string[] = [];
        for (const version of versions) {
            try {
                const operator = version.parsed.roamingNetwork['operator'];
                const context = historicalOperatorContext(current, operator ?? null, time);
                const binding = verifyMeterKey(context, version.proof, request);
                // Apply compromise information before counting attestations, not to unrelated/ignored signatures.
                const verified = version.parsed.verify(context);
                const operatorJSON = requireObject(operator, 'The historical operator');
                const trust = OperatorTrust.fromOperatorJSON(context, operatorJSON);
                const holders = new Set<string>();
                for (const attestation of verified.attestations) {
                    const certificate = trust.operator.signingKeyCertificates.find(item => item.signingKey.id === attestation.keyId);
                    if (certificate !== undefined && !revoked(attestation.keyId, attestation.signedAt) &&
                        !revoked(certificate.keyId, attestation.signedAt)) {
                        const holder = trust.holderOf(attestation);
                        if (holder !== undefined) holders.add(holder);
                    }
                }
                if (holders.size < context.requiredConsensus || revoked(binding.key.id, time) || revoked(binding.key.canonicalId, time))
                    throw new POIError('Historical keys are affected by a caller-authorized compromise');
                matches.push({ binding, version });
            }
            catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
        }
        if (matches.length === 0) throw new POIError(`No historical EVSE/meter/key coverage at ${new Date(time).toISOString()}: ${errors.join('; ')}`);
        const identities = new Set(matches.map(({ binding }) => `${binding.meterId}:${binding.key.canonicalId}`));
        if (identities.size !== 1) throw new POIError('Conflicting historical key assignments cover the same measurement time');
        // Equal material in several attested versions is not a search for a key that happens to verify.
        const selected = matches.sort((a,b) => a.binding.evidence.commitId.localeCompare(b.binding.evidence.commitId))[0];
        if (selected === undefined) throw new POIError('Missing historical selection');
        const { binding, version } = selected;
        used.set(binding.evidence.commitId, version);
        bindings.push(Object.freeze({ ...binding, evidence: Object.freeze({ ...binding.evidence,
            verifiedAt: current.evaluatedAt, validUntil: current.validUntil, keyStatementDigest: current.keyStatementDigest,
            historicalStatementDigest: binding.evidence.keyStatementDigest, attestationValidUntil: binding.evidence.validUntil,
            measurementTimes: Object.freeze([time]), association: 'historical-attestation' as const }) }));
    }
    const heads = new Map<string, string>();
    const publication: HistoricalMeterVerification['versions'][number][] = [];
    for (const [commitId, version] of used) {
        if (version.commitProof === undefined) {
            if (version.checkpoints.length > 0 || policy.requirePublication === true || requiredWitnesses > 0)
                throw new POIError('Required historical commit inclusion evidence is missing');
            publication.push({ commitId, publication: 'missing', witnessedBy: [] }); continue;
        }
        const proof = CheckpointProof.parse(version.commitProof);
        const entries = version.checkpoints.map(entry => ({ ...entry, parsed: Checkpoint.parse(entry.checkpoint) }));
        const entry = entries.find(item => item.parsed.id === proof.checkpointId);
        if (entry === undefined) throw new POIError('The checkpoint of the historical commit proof is missing');
        const checkpoint = entry.parsed;
        if (checkpoint.roamingNetworkId !== current.roamingNetworkId || checkpoint.createdAt > current.evaluatedAt)
            throw new POIError('Foreign or future historical checkpoint');
        const coordinate = `${checkpoint.epoch}:${checkpoint.sequence}`;
        if (heads.has(coordinate) && heads.get(coordinate) !== checkpoint.id) throw new POIError('Conflicting historical checkpoint heads');
        heads.set(coordinate, checkpoint.id);
        const checked = verifyAuthorizedCheckpoint(current, checkpoint, entry.operator, policy);
        const witnesses = checked.witnessedBy;
        proof.verify(checkpoint); version.parsed.verifyAgainstCommitProof(proof);
        publication.push({ commitId, publication: witnesses.length > 0 ? 'witnessed-checkpoint' : 'rno-checkpoint',
            checkpointId: checkpoint.id, witnessedBy: [...witnesses] });
    }
    return Object.freeze({ bindings: Object.freeze(bindings), versions: Object.freeze(publication.map(item => Object.freeze(item))),
        checkedAt: current.evaluatedAt, timeBasis: 'signed-measurement-timestamps', independentTime: 'not-proven', latestVersion: 'not-proven' });
}


/** Shared checkpoint authority for meter and price evidence. A witness is never authorized by its own bundle. */
export function verifyAuthorizedCheckpoint(current: TrustContext | HistoricalTrustContext, checkpoint: Checkpoint,
    operator: JSONValue, policy: HistoricalMeterPolicy = {}): { readonly checkpoint: Checkpoint; readonly signedBy: readonly string[]; readonly witnessedBy: readonly string[] } {
    if (!(current instanceof TrustContext) && !(current instanceof HistoricalTrustContext)) throw new POIError('Checkpoint verification requires current local authority');
    for (const item of policy.revocations ?? []) if (!Number.isFinite(item.invalidFrom)) throw new POIError('Invalid checkpoint compromise time');
    const requiredWitnesses = policy.requiredWitnesses ?? 0;
    if (!Number.isSafeInteger(requiredWitnesses) || requiredWitnesses < 0) throw new POIError('Invalid checkpoint witness policy');
    if (checkpoint.roamingNetworkId !== current.roamingNetworkId || checkpoint.createdAt > current.evaluatedAt) throw new POIError('Foreign or future checkpoint');
    const revoked = (id: string, at: number): boolean => (policy.revocations ?? []).some(item => item.keyId === id && at >= item.invalidFrom);
        const profile=current.epochs.find(epoch=>epoch.number===checkpoint.epoch)?.profiles;
    if(profile===undefined)throw new POIError('The checkpoint epoch has no verified transition from the local policy');
    const holders = new Set<string>(); const witnesses = new Set<string>(); const witnessKeys = new Set<string>();
        let required = current instanceof HistoricalTrustContext ? current.authorityAt(checkpoint.createdAt)?.requiredConsensus ?? current.requiredConsensus : current.requiredConsensus;
        for (const signature of checkpoint.signatures) {
            if(!profile.allowsSignatureAlgorithm(signature.algorithm))continue;
            if (signature.signedAt < checkpoint.createdAt || signature.signedAt > current.evaluatedAt || revoked(signature.keyId, signature.signedAt)) continue;
            try {
                if (signature.role === 'roamingNetworkOperator') {
                    const context = historicalOperatorContext(current, operator, signature.signedAt);
                    required = Math.max(required, context.requiredConsensus);
                    const trust = OperatorTrust.fromOperatorJSON(context, operator);
                    const certificate = trust.operator.signingKeyCertificates.find(item => item.signingKey.id === signature.keyId);
                    const key = trust.signingKeyOf(signature); const holder = trust.holderOf(signature);
                    if (certificate === undefined || revoked(certificate.keyId, signature.signedAt) || key === undefined || holder === undefined) continue;
                    checkpoint.verifySignature(signature, key); holders.add(holder);
                }
                else if (signature.role === 'witness') {
                    const witness = policy.witnesses?.find(item => item.witness === signature.signer && item.key.id === signature.keyId);
                    if (witness === undefined || !witness.key.isValidAt(signature.signedAt) || !witness.key.maySign('party') || witnessKeys.has(witness.key.id)) continue;
                    checkpoint.verifySignature(signature, witness.key); witnesses.add(witness.witness); witnessKeys.add(witness.key.id);
                }
            }
            catch { /* An invalid/unauthorized extra signature never grants trust or poisons a valid quorum. */ }
        }
        if (holders.size < required || witnesses.size < requiredWitnesses) throw new POIError('Historical checkpoint lacks the locally required RNO/witness quorum');
    return { checkpoint, signedBy: [...holders], witnessedBy: [...witnesses] };
}
