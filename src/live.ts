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

import { CONTEXT_PREFIX, onlyProperties, optionalString, optionalTimestamp, requireArray, requireObject, requireString, requireTimestamp } from './common.ts';
import { canonicalJSON }                     from './json/canonical.ts';
import { parseJSON }                         from './json/parse.ts';
import { get, isObject, type JSONObject, type JSONValue } from './json/value.ts';
import { POIError }                          from './errors.ts';


// The traffic report (example A12, SPECIFICATION.md section 12.5): the runtime status of the head of a history, whether an
// EVSE is charging right now, the power it delivers, the price shown at this moment, pushed over the WebSocket of the
// history the moment it changes. It is runtime data, outside the versions: unsigned, as trustworthy as the server telling
// it and the operator setting it, and no evidence. What has to be provable, the price that applied, is a price statement.


export const STATUS_UPDATE_CONTEXT = CONTEXT_PREFIX + 'roamingNetwork/statusUpdate/v1';

/** The kinds of runtime status: the status and the admin status, the energy status and the price status of an entity. */
export const RUNTIME_STATUS_KINDS = [ 'status', 'adminStatus', 'energyStatus', 'priceStatus' ] as const;

export type RuntimeStatusKind = typeof RUNTIME_STATUS_KINDS[number];

/** The topics of the WebSocket of a history a client subscribes to, and the pushes they bring. */
export const LIVE_TOPICS = [ 'statusUpdates', 'energyStatusUpdates', 'priceStatusUpdates', 'commits' ] as const;


/**
 * A status update (`POIStatusUpdate`): the runtime status of one kind of an entity since a point in time, with the one it
 * replaced; as a server pushes it and as the `runtimeStatus` of a snapshot lists it, there without `@context`.
 */
export interface StatusUpdate {
    readonly kind:          RuntimeStatusKind;
    readonly entityType:    string;
    readonly entityId:      string;
    readonly timestamp:     number;
    /** A text for the status and the admin status, e.g. `charging`; an object for the energy status and the price status. */
    readonly value:         JSONValue;
    readonly oldTimestamp:  number | undefined;
    readonly oldValue:      JSONValue | undefined;
    readonly dataSource:    string | undefined;
    readonly json:          JSONObject;
}

export function parseStatusUpdate(value: JSONValue | undefined): StatusUpdate {

    const json = requireObject(value, 'A status update');

    onlyProperties(json, [ '@context', 'kind', 'entityType', 'entityId', 'timestamp', 'value', 'oldTimestamp', 'oldValue', 'dataSource' ], 'A status update');

    if (get(json, '@context') !== undefined && get(json, '@context') !== STATUS_UPDATE_CONTEXT)
        throw new POIError(`The JSON-LD context of the status update must be '${STATUS_UPDATE_CONTEXT}'!`);

    const kind = get(json, 'kind');

    if (!(RUNTIME_STATUS_KINDS as readonly unknown[]).includes(kind))
        throw new POIError('Missing or invalid status kind!');

    const statusKind  = kind as RuntimeStatusKind;
    const checkValue  = (item: JSONValue | undefined, what: string): JSONValue => {
        if (statusKind === 'energyStatus' || statusKind === 'priceStatus' ? !isObject(item) : typeof item !== 'string' || item.trim() === '')
            throw new POIError(`Missing or invalid ${what}!`);
        return item!;
    };

    const entityType = requireString(json, 'entityType', 'The entity type of a status update');
    const entityId   = requireString(json, 'entityId',   'The entity of a status update');

    if (entityType.trim() === '' || entityId.trim() === '')
        throw new POIError('The entity of a status update must be named!');

    return {
        kind:          statusKind,
        entityType,
        entityId,
        timestamp:     requireTimestamp (json, 'timestamp',    'The timestamp of a status update'),
        value:         checkValue(get(json, 'value'), 'status'),
        oldTimestamp:  optionalTimestamp(json, 'oldTimestamp', 'The old timestamp of a status update'),
        oldValue:      get(json, 'oldValue') === undefined ? undefined : checkValue(get(json, 'oldValue'), 'old status'),
        dataSource:    optionalString   (json, 'dataSource',   'The data source of a status update'),
        json,
    };

}


/**
 * A frame of the WebSocket of a history (`POIWebSocketMessage`), OCPP-J style: `[2, id, action, payload]` a request,
 * `[3, id, payload]` its response, `[6, id, action, payload]` a push of the server.
 */
export type LiveFrame =
    | { readonly type: 'request',   readonly id: string, readonly action: string, readonly payload: JSONValue }
    | { readonly type: 'response',  readonly id: string, readonly payload: JSONValue }
    | { readonly type: 'push',      readonly id: string, readonly action: string, readonly payload: JSONValue };

/** Reads a frame, as text from the WebSocket or as JSON; numbers stay decimals as POI reads them. */
export function parseFrame(value: string | JSONValue): LiveFrame {

    const frame  = requireArray(typeof value === 'string' ? parseJSON(value) : value, 'A frame of the WebSocket');
    const type   = frame[0];
    const id     = frame[1];

    if (typeof id !== 'string')
        throw new POIError('The identification of a frame must be a text!');

    if (type === 3 && frame.length === 3)
        return { type: 'response', id, payload: frame[2]! };

    if ((type === 2 || type === 6) && frame.length === 4 && typeof frame[2] === 'string')
        return { type: type === 2 ? 'request' : 'push', id, action: frame[2], payload: frame[3]! };

    throw new POIError('A frame of the WebSocket is [2, id, action, payload], [3, id, payload] or [6, id, action, payload]!');

}

/** A request to the server, as the text to send: e.g. `subscribe`, `runtimeStatus` or `snapshot`. */
export const liveRequest = (id: string, action: string, payload: JSONValue = {}): string =>
    canonicalJSON([ 2, id, action, payload ]);

/** The request subscribing to the given topics; a push tells of a change, not of what was before: ask for the status now. */
export const subscribeRequest = (id: string, topics: readonly string[] = LIVE_TOPICS): string =>
    liveRequest(id, 'subscribe', { topics: [ ...topics ] });


/** The status of one kind of an entity, since when. */
export interface RuntimeStatusEntry {
    readonly value:      JSONValue;
    readonly timestamp:  number;
}

/**
 * The runtime status of the head as a client keeps it: from the `runtimeStatus` of a snapshot, changed by the status
 * updates pushed since. Of each entity and kind the latest timestamp wins, so that updates arriving out of order end with
 * the latest one; a late one is outdated, as the server answers it.
 */
export class RuntimeStatus {

    private readonly entries = new Map<string, RuntimeStatusEntry>();

    private static key(entityType: string, entityId: string, kind: RuntimeStatusKind): string {
        return `${entityType}\u0000${entityId}\u0000${kind}`;
    }

    /** The runtime status a server serves next to its head: `runtimeStatus` of a snapshot, not part of its version. */
    public static fromSnapshot(snapshot: JSONValue): RuntimeStatus {

        const status   = new RuntimeStatus();
        const entries  = get(requireObject(snapshot, 'A snapshot'), 'runtimeStatus');

        if (entries !== undefined)
            for (const entry of requireArray(entries, 'The runtime status of a snapshot'))
                status.apply(parseStatusUpdate(entry));

        return status;

    }

    /** Takes a status update: `Updated` unless the status it changes is a later one already, `Outdated` then. */
    public apply(update: StatusUpdate): 'Updated' | 'Outdated' {

        const key      = RuntimeStatus.key(update.entityType, update.entityId, update.kind);
        const current  = this.entries.get(key);

        if (current !== undefined && current.timestamp > update.timestamp)
            return 'Outdated';

        this.entries.set(key, { value: update.value, timestamp: update.timestamp });
        return 'Updated';

    }

    public get(entityType: string, entityId: string, kind: RuntimeStatusKind = 'status'): RuntimeStatusEntry | undefined {
        return this.entries.get(RuntimeStatus.key(entityType, entityId, kind));
    }

    public get size(): number {
        return this.entries.size;
    }

}

