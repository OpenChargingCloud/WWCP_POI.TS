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

import { onlyProperties, requireObject }  from '../common.ts';
import { get, type JSONValue }            from '../json/value.ts';
import { sameETags }                      from '../etags.ts';
import { RoamingNetwork }                 from '../network/roamingNetwork.ts';
import { Commit }                         from './commit.ts';
import { Checkpoint }                     from './checkpoint.ts';
import { ChangeSet }                      from './changeSet.ts';
import { applyChangeSet }                 from './apply.ts';
import { FIRST_EPOCH, parseEpoch, parseEpochLink, sameEpoch, type Epoch, type EpochLink } from './epoch.ts';
import { POIError, required }             from '../errors.ts';


/** A version with the commit leading to it. */
export interface Version {
    readonly network:  RoamingNetwork;
    readonly commit:   Commit;
}

/** How a history checks what it takes: the signatures of commits and checkpoints are the caller's to require. */
export interface HistoryOptions {
    /** Refuses a commit whose signatures are not those required, e.g. of the roaming network operator by its quorum. */
    readonly verifyCommit?:      (commit: Commit, before: RoamingNetwork, after: RoamingNetwork) => void;
    /** Refuses a checkpoint whose signatures are not those required. */
    readonly verifyCheckpoint?:  (checkpoint: Checkpoint) => void;
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
                        private readonly options:  HistoryOptions) {
        this.versions.push(root);
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
     * epoch?, checkpoint? }` (10.5, 11.3): the version leads to the ETags of its commit, the commit is one of the epoch the
     * snapshot names, the first one when it names none; the commit of a checkpoint is the commit of the snapshot, with its
     * revision and ETags, and the checkpoint carries the signatures required. The runtime status beside the version is not
     * part of it, and not taken.
     */
    public static fromSnapshot(value: JSONValue, options: HistoryOptions = {}): History {

        const json = requireObject(value, 'A snapshot');

        onlyProperties(json, [ '@context', 'timestamp', 'commit', 'roamingNetwork', 'effectiveLastChanges', 'runtimeStatus', 'epoch', 'checkpoint' ], 'A snapshot');

        let network:  RoamingNetwork;
        let commit:   Commit;
        let epoch:    Epoch = FIRST_EPOCH;
        let previous: EpochLink | undefined;

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
        }

        if (commit.roamingNetworkId !== network.id || !network.matchesCommitETags(commit.eTags))
            throw new POIError('The roaming network of the snapshot does not lead to the ETags of its commit!');

        // The genesis of an epoch names the profiles of the epoch, and the ETags of the final checkpoint before.
        if (commit.profiles !== undefined &&
           (!sameEpoch(epoch, { number: commit.epoch, profiles: commit.profiles }) || (previous !== undefined && !sameETags(commit.eTags, previous.eTags))))
            throw new POIError(`The genesis '${commit.id}' of the snapshot is not one of its epoch ${epoch.number}!`);

        const history = new History({ network, commit }, epoch, previous, options);

        history.checkCommitEpoch(commit);

        if (get(json, 'checkpoint') !== undefined) {

            const checkpoint = Checkpoint.parse(get(json, 'checkpoint'));

            if (!checkpoint.isOf(commit))
                throw new POIError('The checkpoint of the snapshot is not one of its commit!');

            history.checkCheckpointEpoch(checkpoint);

            try {
                options.verifyCheckpoint?.(checkpoint);
            }
            catch (e) {
                throw new POIError(`The checkpoint of the snapshot can not be taken: ${e instanceof Error ? e.message : String(e)}`);
            }

            history.checkpointList.push(checkpoint);

        }

        return history;

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

        if (checkpoint.previous === undefined)
            for (const signature of checkpoint.signatures)
                this.checkAlgorithm(signature.algorithm, `a signature of the checkpoint '${checkpoint.id}'`);

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

        this.options.verifyCommit?.(commit, head.network, network);

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

        this.options.verifyCheckpoint?.(checkpoint);
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
     */
    public startNextEpoch(options: HistoryOptions = this.options): History {

        const genesis  = this.nextEpochGenesis();
        const final    = required(this.finalCheckpoint,  `The epoch ${this.epoch.number} has no final checkpoint yet!`);
        const epoch    = required(final.next,            `The epoch ${this.epoch.number} has no final checkpoint yet!`);
        const next     = new History(genesis, epoch, { epoch: final.epoch, checkpointId: final.id, eTags: final.eTags }, options);


        this.nextEpochStarted = true;

        return next;

    }

}
