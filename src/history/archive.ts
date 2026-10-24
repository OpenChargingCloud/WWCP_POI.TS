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

import { checkContext, onlyProperties, requireArray, requireInteger, requireObject, requireString, requireTimestamp, CONTEXT_PREFIX } from '../common.ts';
import { get, type JSONObject, type JSONValue } from '../json/value.ts';
import { History, type HistoryOptions } from './history.ts';
import { Commit }                       from './commit.ts';
import type { Checkpoint }              from './checkpoint.ts';
import { POIError }                     from '../errors.ts';


export const ARCHIVE_SEGMENT_CONTEXT       = CONTEXT_PREFIX + 'roamingNetwork/archiveSegment/v1';
export const ARCHIVE_SEGMENT_INFO_CONTEXT  = CONTEXT_PREFIX + 'roamingNetwork/archiveSegmentInfo/v1';


/** What a segment of the archive of a history holds (SPECIFICATION.md section 10.6). */
export interface ArchiveSegmentInfo {
    readonly number:        number;
    readonly rootId:        string;
    readonly endId:         string;
    readonly fromRevision:  number;
    readonly toRevision:    number;
    readonly size:          number;
    readonly archivedAt:    number;
    readonly commitIds:     readonly string[];
}

export function parseArchiveSegmentInfo(value: JSONValue | undefined): ArchiveSegmentInfo {

    const json = requireObject(value, 'The information of an archive segment');

    checkContext(json, ARCHIVE_SEGMENT_INFO_CONTEXT, 'the information of an archive segment');

    const info = {
        number:        requireInteger  (json, 'number', 1),
        rootId:        requireString   (json, 'rootId'),
        endId:         requireString   (json, 'endId'),
        fromRevision:  requireInteger  (json, 'fromRevision'),
        toRevision:    requireInteger  (json, 'toRevision'),
        size:          requireInteger  (json, 'size'),
        archivedAt:    requireTimestamp(json, 'archivedAt'),
        commitIds:     requireArray(get(json, 'commitIds'), 'The commits of an archive segment').map(id => {
                           if (typeof id !== 'string')
                               throw new POIError('The commits of an archive segment are their identifications!');
                           return id;
                       }),
    };

    if (info.commitIds.length !== info.size || info.commitIds.at(-1) !== info.endId)
        throw new POIError(`The archive segment ${info.number} names ${info.commitIds.length} commits, ending with '${info.commitIds.at(-1) ?? ''}', not ${info.size} ending with its end '${info.endId}'!`);

    return info;

}

/** Checks that segments follow each other: the root of one is the end of the one before, numbered from 1 (10.6). */
export function verifySegmentLine(segments: readonly ArchiveSegmentInfo[]): void {

    segments.forEach((segment, index) => {

        if (segment.number !== index + 1)
            throw new POIError(`The archive segment ${segment.number} is not the ${index + 1}. one!`);

        const before = segments[index - 1];

        if (before !== undefined && (segment.rootId !== before.endId || segment.fromRevision !== before.toRevision))
            throw new POIError(`The archive segment ${segment.number} does not start where the segment ${before.number} ends!`);

    });

}


/**
 * A segment of the archive, `{info, base, commits}` (10.6): the snapshot of the root before the compaction and every commit
 * dropped after it, ending with the new root. Alone, it gives every version from its root to its end again.
 */
export class ArchiveSegment {

    private constructor(
        public readonly info:     ArchiveSegmentInfo,
        public readonly base:     JSONObject,
        public readonly commits:  readonly JSONValue[]
    ) {}

    public static parse(value: JSONValue): ArchiveSegment {

        const json = requireObject(value, 'An archive segment');

        checkContext(json, ARCHIVE_SEGMENT_CONTEXT, 'an archive segment');
        onlyProperties(json, [ '@context', 'info', 'base', 'commits' ], 'An archive segment');

        return new ArchiveSegment(parseArchiveSegmentInfo(get(json, 'info')),
                                  requireObject(get(json, 'base'), 'The base of an archive segment'),
                                  requireArray(get(json, 'commits'), 'The commits of an archive segment'));

    }


    /**
     * Gives the versions of the segment again (10.6): from its base, commit by commit, each checked as section 5.2 says, its
     * commits those its information names, from its root to its end.
     */
    public replay(options: HistoryOptions = {}): History {

        const history = History.fromSnapshot(this.base, options);

        if (history.root.commit.id !== this.info.rootId || history.root.commit.revision !== this.info.fromRevision)
            throw new POIError(`The base of the archive segment ${this.info.number} is not its root '${this.info.rootId}'!`);

        this.commits.forEach((commit, index) => {
            const appended = history.append(commit);
            if (appended.commit.id !== this.info.commitIds[index])
                throw new POIError(`The commit ${index} of the archive segment ${this.info.number} is not the one its information names!`);
        });

        if (history.head.commit.id !== this.info.endId || history.head.commit.revision !== this.info.toRevision)
            throw new POIError(`The archive segment ${this.info.number} does not end with its end '${this.info.endId}'!`);

        return history;

    }


    /**
     * Checks the segment against the checkpoint of its end (10.6): its end is the commit of the checkpoint with its ETags,
     * its commits, the root included where it is the genesis, are the commits of the checkpoint.
     */
    public verifyAgainst(checkpoint: Checkpoint, history: History): void {

        if (!checkpoint.isOf(history.head.commit))
            throw new POIError(`The end of the archive segment ${this.info.number} is not the commit of the checkpoint '${checkpoint.id}'!`);

        const commits: Commit[] = history.all.map(version => version.commit);

        checkpoint.verifyCommits(history.root.commit.revision === 0 ? commits : commits.slice(1));

    }

}
