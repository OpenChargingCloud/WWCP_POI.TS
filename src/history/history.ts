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
import { RoamingNetwork }                 from '../network/roamingNetwork.ts';
import { Commit }                         from './commit.ts';
import { Checkpoint }                     from './checkpoint.ts';
import { ChangeSet }                      from './changeSet.ts';
import { applyChangeSet }                 from './apply.ts';
import { POIError }                       from '../errors.ts';


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


/**
 * A linear history of a roaming network, as a server, a witness or an app following it keeps it (SPECIFICATION.md
 * sections 5 and 10): it starts from a snapshot, of the genesis or of a checkpoint, and takes the commits since one after
 * the other, each checked as section 5.2 says: its change set fits the version of its parent, is signed by its owners and
 * leads to its ETags. Merges are not taken here.
 */
export class History {

    private readonly versions:     Version[] = [];
    private readonly checkpointList: Checkpoint[] = [];

    private constructor(root: Version, private readonly options: HistoryOptions) {
        this.versions.push(root);
    }


    /** The version the history started from. */
    public get root(): Version {
        return this.versions[0]!;
    }

    /** The latest version. */
    public get head(): Version {
        return this.versions.at(-1)!;
    }

    /** Every version since the root, in their order. */
    public get all(): readonly Version[] {
        return this.versions;
    }

    /** The checkpoints taken, in their order. */
    public get checkpoints(): readonly Checkpoint[] {
        return this.checkpointList;
    }


    /**
     * Starts a history from a snapshot, `{ timestamp?, commit, roamingNetwork, effectiveLastChanges?, checkpoint? }`
     * (10.5): the version leads to the ETags of its commit; the commit of a checkpoint is the commit of the snapshot, with
     * its revision and ETags, and the checkpoint carries the signatures required.
     */
    public static fromSnapshot(value: JSONValue, options: HistoryOptions = {}): History {

        const json = requireObject(value, 'A snapshot');

        onlyProperties(json, [ '@context', 'timestamp', 'commit', 'roamingNetwork', 'effectiveLastChanges', 'checkpoint' ], 'A snapshot');

        let network: RoamingNetwork;
        let commit:  Commit;

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

        if (commit.roamingNetworkId !== network.id || !network.matchesCommitETags(commit.eTags))
            throw new POIError('The roaming network of the snapshot does not lead to the ETags of its commit!');

        const history = new History({ network, commit }, options);

        if (get(json, 'checkpoint') !== undefined) {

            const checkpoint = Checkpoint.parse(get(json, 'checkpoint'));

            if (!checkpoint.isOf(commit))
                throw new POIError('The checkpoint of the snapshot is not one of its commit!');

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


    /**
     * Takes the next commit (5.2): of this roaming network and epoch, with the head as its only parent, one revision
     * more, its change set fitting the head, signed by its owners and leading to the ETags of the commit, the commit's
     * signatures those required. Returns the new version.
     */
    public append(value: JSONValue | Commit): Version {

        const commit = value instanceof Commit ? value : Commit.parse(value);
        const head   = this.head;

        if (commit.roamingNetworkId !== head.network.id)
            throw new POIError(`The commit '${commit.id}' is one of the roaming network '${commit.roamingNetworkId}'!`);

        if (commit.epoch !== head.commit.epoch)
            throw new POIError(`The commit '${commit.id}' is one of the epoch ${commit.epoch}, not of ${head.commit.epoch}!`);

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
     * Takes the next checkpoint of the line (10.1): of this roaming network, its commit one this history holds with its
     * revision and ETags, following the latest checkpoint taken (sequence one more, naming it), its commits those since the
     * commit of the previous checkpoint (all since the root for the first one this history takes), carrying the signatures
     * required.
     */
    public takeCheckpoint(value: JSONValue | Checkpoint): Checkpoint {

        const checkpoint = value instanceof Checkpoint ? value : Checkpoint.parse(value);

        if (checkpoint.roamingNetworkId !== this.head.network.id)
            throw new POIError(`The checkpoint '${checkpoint.id}' is one of the roaming network '${checkpoint.roamingNetworkId}'!`);

        const version = this.versionOf(checkpoint.commitId);

        if (version === undefined || !checkpoint.isOf(version.commit))
            throw new POIError(`The commit '${checkpoint.commitId}' of the checkpoint is unknown here, or not of its revision and ETags!`);

        const latest = this.checkpointList.at(-1);

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

        if (from < 0 || until <= from && latest !== undefined)
            throw new POIError(`The commit of the checkpoint '${checkpoint.id}' does not follow the commit of the previous checkpoint!`);

        // The commits of the checkpoint: since the previous checkpoint, or every one since the root, the genesis included.
        const commits = this.versions.slice(latest === undefined && this.root.commit.revision === 0 ? 0 : from + 1, until + 1).map(item => item.commit);

        if (latest !== undefined || this.root.commit.revision === 0)
            checkpoint.verifyCommits(commits);

        this.options.verifyCheckpoint?.(checkpoint);
        this.checkpointList.push(checkpoint);

        return checkpoint;

    }

}
