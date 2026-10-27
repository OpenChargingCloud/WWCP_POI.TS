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

import { onlyProperties, requireArray, requireObject } from '../common.ts';
import { get, type JSONValue }            from '../json/value.ts';
import { sameETags }                      from '../etags.ts';
import { RoamingNetwork }                 from '../network/roamingNetwork.ts';
import { Attestation }                    from '../proofs/attestation.ts';
import { ChargingStationProof }           from '../proofs/stationProof.ts';
import type { TrustAnchor }               from '../proofs/trustAnchor.ts';
import { Commit }                         from './commit.ts';
import { Checkpoint }                     from './checkpoint.ts';
import { ChangeSet }                      from './changeSet.ts';
import { applyChangeSet }                 from './apply.ts';
import { EpochProfiles, FIRST_EPOCH, parseEpoch, parseEpochLink, sameEpoch, type Epoch, type EpochLink } from './epoch.ts';
import { POIError, required }             from '../errors.ts';


/** A version with the commit leading to it. */
export interface Version {
    readonly network:  RoamingNetwork;
    readonly commit:   Commit;
}

/**
 * How a history checks what it takes: the signatures of commits and checkpoints are the caller's to require. Without a
 * verifier it refuses a signed commit or checkpoint, as WWCP_POI does: signatures it cannot check are not taken unchecked.
 */
export interface HistoryOptions {
    /**
     * Refuses a commit whose signatures are not those required, e.g. of the roaming network operator by its quorum; `before`
     * is the version before, unknown for the commit of a snapshot. Required for a signed commit.
     */
    readonly verifyCommit?:      (commit: Commit, before: RoamingNetwork | undefined, after: RoamingNetwork) => void;
    /** Refuses a checkpoint whose signatures are not those required. Required for a signed checkpoint. */
    readonly verifyCheckpoint?:  (checkpoint: Checkpoint) => void;
}

/**
 * How a history starts from a snapshot of another server (10.5, *Anchored*): only anchored in the trust anchor of its
 * roaming network, fail closed. A snapshot of a checkpoint is anchored by the checkpoint, signed as the roaming network
 * operator as the trust anchor requires; a snapshot of the head by the attestations it carries (8.5).
 */
export interface SnapshotOptions extends HistoryOptions {
    /** The trust anchor of the roaming network, e.g. as an app scanned it from a QR code. Without it, no snapshot is taken. */
    readonly trustAnchor?:  TrustAnchor;
    /** When the attestations, or the keys that signed the checkpoint, must be valid: now by default. */
    readonly at?:           number | Date | string;
    /**
     * Takes the snapshot without anchoring it, the trust in it being the caller's to establish: e.g. a genesis whose key
     * statement the caller verifies against the trust anchor itself, a history of its own, or content checked alone.
     */
    readonly unanchored?:   boolean;
}

/** The status of the epoch of a history (11.4): its final checkpoint not taken yet, taken, or the next epoch started. */
export type EpochStatus = 'active' | 'closing' | 'closed';


/**
 * A linear history of a roaming network in one epoch, as a server, a witness or an app following it keeps it
 * (SPECIFICATION.md sections 5, 10 and 11): it starts from a snapshot, of the genesis or of a checkpoint, and takes the
 * commits since one after the other, each checked as section 5.2 says: its change set fits the version of its parent, is
 * signed by its owners and leads to its ETags; each of its epoch, identified and signed as the profiles of the epoch say.
 * After its final checkpoint it takes nothing more, and starts the next epoch. Merges are not taken here.
 */
export class History {

    private readonly versions:        Version[] = [];
    private readonly checkpointList:  Checkpoint[] = [];
    private nextEpochStarted = false;

    private constructor(/** The version the history started from. */
                        public readonly root:      Version,
                        /** The epoch of this history, the first one unless its snapshot names another (11.3). */
                        public readonly epoch:     Epoch,
                        /** The final checkpoint of the epoch before, which the first checkpoint of this one names (11.3). */
                        public readonly previousEpoch: EpochLink | undefined,
                        private readonly previousProfiles: EpochProfiles | undefined,
                        private readonly options:  HistoryOptions) {
        this.versions.push(root);
    }

    /**
     * The profiles of the epoch before, if they are known: the first checkpoint of this epoch is signed with the algorithms
     * of both (11.3). Those of the first epoch are the default ones; those of a later one this history knows from the epoch
     * it was started from, or from the snapshot it started from (`PreviousEpochProfiles`).
     */
    public get previousEpochProfiles(): EpochProfiles | undefined {
        return this.epoch.number === 1 ? undefined : this.epoch.number === 2 ? EpochProfiles.FIRST : this.previousProfiles;
    }


    /** The latest version. */
    public get head(): Version {
        return this.versions.at(-1) ?? this.root;
    }

    /** Every version since the root, in their order. */
    public get all(): readonly Version[] {
        return this.versions;
    }

    /** The checkpoints taken, in their order. */
    public get checkpoints(): readonly Checkpoint[] {
        return this.checkpointList;
    }

    /** The final checkpoint of the epoch, once taken (11.2). */
    public get finalCheckpoint(): Checkpoint | undefined {
        const latest = this.checkpointList.at(-1);
        return latest?.isFinal === true ? latest : undefined;
    }

    public get epochStatus(): EpochStatus {
        return this.finalCheckpoint === undefined ? 'active' : this.nextEpochStarted ? 'closed' : 'closing';
    }


    /**
     * Starts a history from a snapshot, `{ timestamp?, commit, roamingNetwork, effectiveLastChanges?, runtimeStatus?,
     * epoch?, checkpoint?, attestations? }` (8.5, 10.5, 11.3): the version leads to the ETags of its commit, the commit is
     * one of the epoch the snapshot names, `{epoch, profiles, previous?, previousProfiles?}`, the first one when it names
     * none, the profiles of the epoch before only from the third epoch on; the commit of a checkpoint is the commit of the
     * snapshot, with its revision and ETags, and the checkpoint carries the signatures required. The runtime status beside
     * the version is not part of it, and not taken.
     *
     * Anchored in the trust anchor of the roaming network (10.5), unless `unanchored`, as the peer of WWCP_POI starts
     * (`StartFromSnapshotAsync`): a snapshot of a checkpoint by the checkpoint, signed in the role of the roaming network
     * operator by signing keys of as many holders as the trust anchor and the key statement of its version require, each
     * certified by a trusted identity key of its holder, valid when it signed and at `at`; a snapshot of the head by its
     * `attestations`, which must attest the root of its head as for a proof of the root (8.4). Then the commit of the
     * snapshot carries the signatures required.
     */
    public static fromSnapshot(value: JSONValue, options: SnapshotOptions = {}): History {

        if (options.unanchored === true && options.trustAnchor !== undefined)
            throw new POIError('A snapshot is taken anchored in a trust anchor, or unanchored, not both!');

        // Fail closed: the keys of the operator a version names are public, whoever forged the version names them as well.
        if (options.unanchored !== true && options.trustAnchor === undefined)
            throw new POIError('Without the trust anchor of the roaming network (trustAnchor) no history starts from a snapshot, unless it is taken unanchored explicitly (unanchored)!');

        const json = requireObject(value, 'A snapshot');

        onlyProperties(json, [ '@context', 'timestamp', 'commit', 'roamingNetwork', 'effectiveLastChanges', 'runtimeStatus', 'epoch', 'checkpoint', 'attestations' ], 'A snapshot');

        if (get(json, 'checkpoint') !== undefined && get(json, 'attestations') !== undefined)
            throw new POIError('A snapshot of a checkpoint carries no attestations: the checkpoint anchors it!');

        // Every one read as POI reads it: one it cannot read is refused, not left out.
        const attestations = get(json, 'attestations') === undefined
                                 ? []
                                 : requireArray(get(json, 'attestations'), 'The attestations of a snapshot').map(attestation => {
                                       try {
                                           return Attestation.parse(attestation);
                                       }
                                       catch (e) {
                                           throw new POIError(`Invalid attestation of the snapshot: ${e instanceof Error ? e.message : String(e)}`);
                                       }
                                   });

        let network:  RoamingNetwork;
        let commit:   Commit;
        let epoch:    Epoch = FIRST_EPOCH;
        let previous: EpochLink | undefined;
        let previousProfiles: EpochProfiles | undefined;

        try {
            network = RoamingNetwork.parse(get(json, 'roamingNetwork'));
        }
        catch (e) {
            throw new POIError(`Invalid roaming network of the snapshot: ${e instanceof Error ? e.message : String(e)}`);
        }

        try {
            commit = Commit.parse(get(json, 'commit'));
        }
        catch (e) {
            throw new POIError(`Invalid commit of the snapshot: ${e instanceof Error ? e.message : String(e)}`);
        }

        if (get(json, 'epoch') !== undefined) {
            const epochJSON = requireObject(get(json, 'epoch'), 'The epoch of a snapshot');
            epoch     = parseEpoch(epochJSON, 'The epoch of a snapshot');
            previous  = get(epochJSON, 'previous') === undefined ? undefined : parseEpochLink(get(epochJSON, 'previous'));
            previousProfiles = get(epochJSON, 'previousProfiles') === undefined ? undefined : EpochProfiles.parse(get(epochJSON, 'previousProfiles'));
        }

        if (previousProfiles !== undefined && epoch.number <= 2)
            throw new POIError(epoch.number === 1
                                   ? 'The first epoch has no epoch before, nor its profiles!'
                                   : 'The epoch before the epoch 2 is the first one, of the default profiles: they are not given!');

        if (commit.roamingNetworkId !== network.id || !network.matchesCommitETags(commit.eTags))
            throw new POIError('The roaming network of the snapshot does not lead to the ETags of its commit!');

        // The genesis of an epoch names the profiles of the epoch, and the ETags of the final checkpoint before.
        if (commit.profiles !== undefined &&
           (!sameEpoch(epoch, { number: commit.epoch, profiles: commit.profiles }) || (previous !== undefined && !sameETags(commit.eTags, previous.eTags))))
            throw new POIError(`The genesis '${commit.id}' of the snapshot is not one of its epoch ${epoch.number}!`);

        const history = new History({ network, commit }, epoch, previous, previousProfiles, options);

        history.checkCommitEpoch(commit);

        let checkpoint: Checkpoint | undefined;

        if (get(json, 'checkpoint') !== undefined) {

            checkpoint = Checkpoint.parse(get(json, 'checkpoint'));

            if (!checkpoint.isOf(commit))
                throw new POIError('The checkpoint of the snapshot is not one of its commit!');

            history.checkCheckpointEpoch(checkpoint);

            try {
                history.verifyCheckpointSignatures(checkpoint);
            }
            catch (e) {
                throw new POIError(`The checkpoint of the snapshot can not be taken: ${e instanceof Error ? e.message : String(e)}`);
            }

            history.checkpointList.push(checkpoint);

        }

        if (options.trustAnchor !== undefined) {
            if (checkpoint !== undefined)
                history.anchorCheckpoint(checkpoint, options.trustAnchor, options.at);
            else
                history.anchorHead(attestations, options.trustAnchor, options.at);
        }

        try {
            history.verifyCommitSignatures(commit, undefined, network);
        }
        catch (e) {
            throw new POIError(`The snapshot is not signed as required: ${e instanceof Error ? e.message : String(e)}`);
        }

        return history;

    }


    /**
     * Refuses a head not anchored in the trust anchor by the given attestations (10.5), as `VerifyHead` of WWCP_POI: with the
     * tree of a tree hash algorithm of its roaming network some of them name, the proof of its root for them, verified
     * against the trust anchor at `at` (`ChargingStationProof.verify`).
     */
    private anchorHead(attestations: readonly Attestation[], anchor: TrustAnchor, at: number | Date | string | undefined): void {

        const head = this.head;
        let reason = `No attestation of the head '${head.commit.id}' of the roaming network '${head.network.id}' is given!`;

        for (const algorithm of head.network.treeHashAlgorithms.filter(algorithm => attestations.some(attestation => attestation.eTag.algorithm === algorithm))) {

            try {
                ChargingStationProof.ofRoot(head.network, head.commit, algorithm, attestations).verify(anchor, at);
                return;
            }
            catch (e) {
                reason = e instanceof Error ? e.message : String(e);
            }

        }

        throw new POIError(`The snapshot is not anchored in the trust anchor of the roaming network '${anchor.id}': ${reason}`);

    }

    /**
     * Refuses a checkpoint not anchored in the trust anchor (10.5), as the peer of WWCP_POI joins from one: the proof of the
     * root of its version, with the tree of the first tree hash algorithm of the roaming network, verifies the checkpoint
     * against the trust anchor at `at` (`ChargingStationProof.verifyCheckpoint`).
     */
    private anchorCheckpoint(checkpoint: Checkpoint, anchor: TrustAnchor, at: number | Date | string | undefined): void {

        const root = this.root;

        try {
            ChargingStationProof.ofRoot(root.network, root.commit, root.network.treeHashAlgorithms[0] ?? 'sha256').verifyCheckpoint(checkpoint, anchor, at);
        }
        catch (e) {
            throw new POIError(`The checkpoint '${checkpoint.id}' of the snapshot is not anchored in the trust anchor of the roaming network '${anchor.id}': ${e instanceof Error ? e.message : String(e)}`);
        }

    }


    /** Refuses a signed commit without a verifier of commit signatures, as `CheckSignatures` of WWCP_POI; verifies it otherwise. */
    private verifyCommitSignatures(commit: Commit, before: RoamingNetwork | undefined, after: RoamingNetwork): void {

        if (this.options.verifyCommit !== undefined)
            this.options.verifyCommit(commit, before, after);

        else if (commit.signatures.length > 0)
            throw new POIError(`The commit '${commit.id}' is signed, but there is no verifier of commit signatures!`);

    }

    /** Refuses a signed checkpoint without a verifier of checkpoint signatures, as WWCP_POI; verifies it otherwise. */
    private verifyCheckpointSignatures(checkpoint: Checkpoint): void {

        if (this.options.verifyCheckpoint !== undefined)
            this.options.verifyCheckpoint(checkpoint);

        else if (checkpoint.signatures.length > 0)
            throw new POIError(`The checkpoint '${checkpoint.id}' is signed, but there is no verifier of checkpoint signatures!`);

    }


    /** Refuses a commit of another epoch, identified or signed otherwise than its profiles say (`CommitEpochError`). */
    private checkCommitEpoch(commit: Commit): void {

        if (commit.epoch !== this.epoch.number)
            throw new POIError(`The commit '${commit.id}' is one of the epoch ${commit.epoch}, but this history is of the epoch ${this.epoch.number}!`);

        if (commit.identificationHash !== this.epoch.profiles.identificationHash)
            throw new POIError(`The commit '${commit.id}' is identified with ${commit.identificationHash}, but the epoch ${this.epoch.number} with ${this.epoch.profiles.identificationHash}!`);

        for (const signature of commit.signatures)
            this.checkAlgorithm(signature.algorithm, `a signature of the commit '${commit.id}'`);

        if (commit.changeSet !== undefined)
            for (const signature of ChangeSet.parse(commit.changeSet).signatures)
                this.checkAlgorithm(signature.algorithm, `a signature of the change set of the commit '${commit.id}'`);

    }

    /** Refuses a version whose operator states its keys with algorithms the epoch does not accept (`VersionEpochError`). */
    private checkVersionEpoch(network: RoamingNetwork): void {

        for (const signature of network.operator?.keyStatement?.signatures ?? [])
            this.checkAlgorithm(signature.algorithm, 'the key statement of the roaming network operator');

        for (const certificate of network.operator?.signingKeyCertificates ?? [])
            this.checkAlgorithm(certificate.algorithm, `the certificate of the signing key '${certificate.signingKey.id}' of the roaming network operator`);

    }

    /**
     * Refuses a checkpoint of another epoch; the first one of a later epoch must name the final checkpoint of the one before
     * this history started from, and is signed with the algorithms of both epochs, every later one only with those of its own.
     * Without the profiles of the epoch before, only those of its own are taken (`CheckpointSignatureAlgorithmError`).
     */
    private checkCheckpointEpoch(checkpoint: Checkpoint): void {

        if (checkpoint.epoch !== this.epoch.number)
            throw new POIError(`The checkpoint '${checkpoint.id}' is one of the epoch ${checkpoint.epoch}, but this history is of the epoch ${this.epoch.number}!`);

        if (checkpoint.identificationHash !== this.epoch.profiles.identificationHash)
            throw new POIError(`The checkpoint '${checkpoint.id}' is not identified with the identification hash of the epoch ${this.epoch.number}!`);

        if (checkpoint.previous !== undefined && this.previousEpoch !== undefined &&
           (checkpoint.previous.epoch        !== this.previousEpoch.epoch        ||
            checkpoint.previous.checkpointId !== this.previousEpoch.checkpointId ||
            !sameETags(checkpoint.previous.eTags, this.previousEpoch.eTags)))
            throw new POIError(`The checkpoint '${checkpoint.id}' names another final checkpoint of the epoch before than this history started from!`);

        for (const signature of checkpoint.signatures)
            this.checkCheckpointAlgorithm(checkpoint.previous !== undefined, signature.algorithm, `a signature of the checkpoint '${checkpoint.id}'`);

    }

    private checkCheckpointAlgorithm(firstOfAnEpoch: boolean, algorithm: string, what: string): void {

        if (!firstOfAnEpoch || this.epoch.profiles.allowsSignatureAlgorithm(algorithm)) {
            this.checkAlgorithm(algorithm, what);
            return;
        }

        const before = this.previousEpochProfiles;

        if (before === undefined)
            throw new POIError(`The signature algorithm '${algorithm}' of ${what} is not one of the epoch ${this.epoch.number}, ${this.epoch.profiles.signatureAlgorithms.join(', ')}, and the profiles of the epoch ${this.epoch.number - 1} are not known here!`);

        if (!before.allowsSignatureAlgorithm(algorithm))
            throw new POIError(`The signature algorithm '${algorithm}' of ${what} is neither one of the epoch ${this.epoch.number}, ${this.epoch.profiles.signatureAlgorithms.join(', ')}, nor of the epoch ${this.epoch.number - 1}, ${before.signatureAlgorithms.join(', ')}!`);

    }

    private checkAlgorithm(algorithm: string, what: string): void {
        if (!this.epoch.profiles.allowsSignatureAlgorithm(algorithm))
            throw new POIError(`The signature algorithm '${algorithm}' of ${what} is not one of the epoch ${this.epoch.number}` +
                               (this.epoch.profiles.signatureAlgorithms.length > 0 ? `, ${this.epoch.profiles.signatureAlgorithms.join(', ')}!` : '!'));
    }

    private checkOpen(): void {
        const final = this.finalCheckpoint;
        if (final !== undefined)
            throw new POIError(`The epoch ${this.epoch.number} of the roaming network '${this.head.network.id}' is closed by its final checkpoint '${final.id}': what follows belongs to the epoch ${this.epoch.number + 1}!`);
    }


    /**
     * Takes the next commit (5.2): of this roaming network and epoch, with the head as its only parent, one revision
     * more, its change set fitting the head, signed by its owners and leading to the ETags of the commit, the commit's
     * signatures those required. Returns the new version.
     */
    public append(value: JSONValue | Commit): Version {

        const commit = value instanceof Commit ? value : Commit.parse(value);
        const head   = this.head;

        this.checkOpen();

        if (commit.roamingNetworkId !== head.network.id)
            throw new POIError(`The commit '${commit.id}' is one of the roaming network '${commit.roamingNetworkId}'!`);

        this.checkCommitEpoch(commit);

        if (commit.parentIds.length !== 1)
            throw new POIError(commit.parentIds.length === 0
                                   ? `The commit '${commit.id}' is a genesis commit!`
                                   : `The commit '${commit.id}' is a merge, which this library does not take yet!`);

        if (commit.parentIds[0] !== head.commit.id)
            throw new POIError(`The commit '${commit.id}' does not follow the head '${head.commit.id}' of this history!`);

        if (commit.revision !== head.commit.revision + 1)
            throw new POIError(`The commit '${commit.id}' has the revision ${commit.revision}, not ${head.commit.revision + 1}!`);

        let network: RoamingNetwork;

        try {
            network = applyChangeSet(head.network, ChangeSet.parse(commit.changeSet));
        }
        catch (e) {
            throw new POIError(`The change set of the commit '${commit.id}' can not be applied: ${e instanceof Error ? e.message : String(e)}`);
        }

        if (!network.matchesCommitETags(commit.eTags))
            throw new POIError(`The commit '${commit.id}' does not lead to its ETags!`);

        this.checkVersionEpoch(network);

        this.verifyCommitSignatures(commit, head.network, network);

        const version = { network, commit };
        this.versions.push(version);

        return version;

    }


    /** The version of the given commit, if this history holds it. */
    public versionOf(commitId: string): Version | undefined {
        return this.versions.find(version => version.commit.id === commitId);
    }


    /**
     * Takes the next checkpoint of the line (10.1): of this roaming network and epoch, its commit one this history holds
     * with its revision and ETags, following the latest checkpoint taken (sequence one more, naming it), its commits those
     * since the commit of the previous checkpoint (all since the root for the first one this history takes), carrying the
     * signatures required. A final checkpoint names the head, or the commit of the checkpoint before it alone (11.2).
     */
    public takeCheckpoint(value: JSONValue | Checkpoint): Checkpoint {

        const checkpoint = value instanceof Checkpoint ? value : Checkpoint.parse(value);

        if (checkpoint.roamingNetworkId !== this.head.network.id)
            throw new POIError(`The checkpoint '${checkpoint.id}' is one of the roaming network '${checkpoint.roamingNetworkId}'!`);

        const latest = this.checkpointList.at(-1);

        if (latest?.id !== checkpoint.id)
            this.checkOpen();

        this.checkCheckpointEpoch(checkpoint);

        const version = this.versionOf(checkpoint.commitId);

        if (version === undefined || !checkpoint.isOf(version.commit))
            throw new POIError(`The commit '${checkpoint.commitId}' of the checkpoint is unknown here, or not of its revision and ETags!`);

        if (checkpoint.isFinal && version !== this.head)
            throw new POIError(`The final checkpoint '${checkpoint.id}' does not name the head of the epoch ${this.epoch.number}!`);

        if (latest !== undefined) {

            if (latest.id === checkpoint.id)
                throw new POIError(`The checkpoint '${checkpoint.id}' is taken already!`);

            if (checkpoint.epoch === latest.epoch && checkpoint.sequence === latest.sequence)
                throw new POIError(`This history has another checkpoint of the sequence ${checkpoint.sequence}: two checkpoints of one sequence are a split view!`);

            if (checkpoint.sequence !== latest.sequence + 1 || checkpoint.previousId !== latest.id)
                throw new POIError(`The checkpoint does not follow the latest checkpoint '${latest.id}' of the sequence ${latest.sequence} here!`);

        }

        const from    = latest === undefined ? 0 : this.versions.findIndex(item => item.commit.id === latest.commitId);
        const until   = this.versions.indexOf(version);

        // A final checkpoint may name the commit of the checkpoint before it, its commits then being that commit alone.
        const again   = latest !== undefined && checkpoint.isFinal && until === from;

        if (from < 0 || until <= from && latest !== undefined && !again)
            throw new POIError(`The commit of the checkpoint '${checkpoint.id}' does not follow the commit of the previous checkpoint!`);

        // The commits of the checkpoint: since the previous checkpoint, or every one since the root, the genesis included.
        const commits = again
                            ? [ version.commit ]
                            : this.versions.slice(latest === undefined && this.root.commit.revision === 0 ? 0 : from + 1, until + 1).map(item => item.commit);

        if (latest !== undefined || this.root.commit.revision === 0)
            checkpoint.verifyCommits(commits);

        this.verifyCheckpointSignatures(checkpoint);
        this.checkpointList.push(checkpoint);

        return checkpoint;

    }


    /**
     * The genesis of the next epoch (11.3), as every server starting it from the final checkpoint of this one makes it:
     * the version of the final checkpoint, revision 0, naming the next epoch and its profiles; unsigned.
     */
    public nextEpochGenesis(): Version {

        const final = this.finalCheckpoint;

        if (final?.next === undefined)
            throw new POIError(`The epoch ${this.epoch.number} has no final checkpoint yet!`);

        const version = this.versionOf(final.commitId);

        if (version === undefined)
            throw new POIError(`The version of the final checkpoint '${final.id}' is not held here!`);

        const genesis = Commit.genesisOf(final.roamingNetworkId, required(final.json['eTags'], `The final checkpoint '${final.id}' names no ETags!`), final.next);

        if (!version.network.matchesCommitETags(genesis.eTags))
            throw new POIError(`The version of the final checkpoint '${final.id}' does not lead to its ETags under the profiles of the epoch ${final.next.number}!`);

        return { network: version.network, commit: genesis };

    }

    /**
     * Starts the next epoch from the version of the final checkpoint of this one (11.4): applies nothing, so its genesis is
     * the one of `nextEpochGenesis`, whoever starts it. A genesis published with signatures is the same when its `@id` is.
     * It knows the profiles of this epoch, for the signatures of its first checkpoint.
     */
    public startNextEpoch(options: HistoryOptions = this.options): History {

        const genesis  = this.nextEpochGenesis();
        const final    = required(this.finalCheckpoint,  `The epoch ${this.epoch.number} has no final checkpoint yet!`);
        const epoch    = required(final.next,            `The epoch ${this.epoch.number} has no final checkpoint yet!`);
        const next     = new History(genesis, epoch, { epoch: final.epoch, checkpointId: final.id, eTags: final.eTags }, this.epoch.profiles, options);


        this.nextEpochStarted = true;

        return next;

    }

}
