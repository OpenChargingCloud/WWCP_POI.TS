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

import { CONTEXT_PREFIX, onlyProperties, requireInteger, requireObject, requireString } from '../common.ts';
import { get, isArray, type JSONObject, type JSONValue } from '../json/value.ts';
import { isHashAlgorithm, type HashAlgorithm } from '../crypto/hash.ts';
import { signatureAlgorithm, SIGNATURE_ALGORITHMS } from '../crypto/signature.ts';
import { parseETags, type ETag }      from '../etags.ts';
import { POIError }                   from '../errors.ts';


// Epochs (SPECIFICATION.md section 11): one history of a roaming network under one set of profiles, the algorithms and
// formats its identifications, trees and signatures are calculated with.


export const EPOCH_PROFILES_CONTEXT  = CONTEXT_PREFIX + 'roamingNetwork/epochProfiles/v1';
export const EPOCH_CONTEXT           = CONTEXT_PREFIX + 'roamingNetwork/epoch/v1';
export const EPOCH_LINK_CONTEXT      = CONTEXT_PREFIX + 'roamingNetwork/epochLink/v1';

/** The canonicalization this library calculates, the one of section 1. */
export const STYX_CANONICAL_JSON     = 'styx-canonical-json-v1';

// The contexts of commits, checkpoints and price statements this library calculates.
const COMMIT_CONTEXT           = CONTEXT_PREFIX + 'roamingNetwork/commit/v3';
const CHECKPOINT_CONTEXT       = CONTEXT_PREFIX + 'roamingNetwork/checkpoint/v1';
const PRICE_STATEMENT_CONTEXT  = CONTEXT_PREFIX + 'roamingNetwork/priceStatement/v1';


/**
 * The profiles of an epoch (11.1): its canonicalization, the hash of the identifications of its commits and checkpoints
 * and of the trees of its checkpoints, the contexts of commits, checkpoints and price statements, and the signature
 * algorithms it accepts, every one this library verifies when none are named, as in the first epoch.
 */
export class EpochProfiles {

    private constructor(
        public readonly identificationHash:   HashAlgorithm,
        public readonly signatureAlgorithms:  readonly string[]
    ) {}

    /** The profiles of the first epoch: SHA-256 identifications, every signature algorithm. */
    public static readonly FIRST = new EpochProfiles('sha256', []);


    /** Reads profiles as `RoamingNetworkEpochProfiles.TryParse` does, refusing those this library can not calculate. */
    public static parse(value: JSONValue | undefined): EpochProfiles {

        const json = requireObject(value, 'The profiles of an epoch');

        onlyProperties(json, [ '@context', 'canonicalization', 'identificationHash', 'commit', 'checkpoint', 'priceStatement', 'signatureAlgorithms' ], 'The profiles of an epoch');

        if (get(json, '@context') !== undefined && get(json, '@context') !== EPOCH_PROFILES_CONTEXT)
            throw new POIError(`The JSON-LD context of the profiles of an epoch must be '${EPOCH_PROFILES_CONTEXT}'!`);

        if (get(json, 'canonicalization') !== STYX_CANONICAL_JSON)
            throw new POIError(`The canonicalization of an epoch must be '${STYX_CANONICAL_JSON}', the one this library calculates!`);

        const identificationHash = get(json, 'identificationHash');

        if (!isHashAlgorithm(identificationHash))
            throw new POIError('The identification hash of an epoch must be sha256, sha384 or sha512!');

        if (get(json, 'commit') !== COMMIT_CONTEXT || get(json, 'checkpoint') !== CHECKPOINT_CONTEXT || get(json, 'priceStatement') !== PRICE_STATEMENT_CONTEXT)
            throw new POIError(`The JSON-LD contexts of commits, checkpoints and price statements of an epoch must be '${COMMIT_CONTEXT}', ` +
                               `'${CHECKPOINT_CONTEXT}' and '${PRICE_STATEMENT_CONTEXT}', the ones this library calculates!`);

        const algorithmsJSON = get(json, 'signatureAlgorithms');
        const algorithms: string[] = [];

        if (algorithmsJSON !== undefined) {

            if (!isArray(algorithmsJSON) || !algorithmsJSON.every(name => typeof name === 'string'))
                throw new POIError('The signature algorithms of an epoch must be a JSON array of COSE names!');

            for (const name of algorithmsJSON) {
                signatureAlgorithm(name);
                if (!algorithms.includes(name))
                    algorithms.push(name);
            }

        }

        return new EpochProfiles(identificationHash, algorithms.sort());

    }


    /** Whether the epoch accepts signatures of the algorithm. */
    public allowsSignatureAlgorithm(algorithm: string): boolean {
        return this.signatureAlgorithms.length === 0
                   ? (SIGNATURE_ALGORITHMS as readonly string[]).includes(algorithm)
                   : this.signatureAlgorithms.includes(algorithm);
    }

    public toJSON(): JSONObject {
        return {
            canonicalization:     STYX_CANONICAL_JSON,
            identificationHash:   this.identificationHash,
            commit:               COMMIT_CONTEXT,
            checkpoint:           CHECKPOINT_CONTEXT,
            priceStatement:       PRICE_STATEMENT_CONTEXT,
            signatureAlgorithms:  [ ...this.signatureAlgorithms ],
        };
    }

    public toString(): string {
        return `${this.identificationHash}, ${this.signatureAlgorithms.length === 0 ? 'every signature algorithm' : this.signatureAlgorithms.join(', ')}`;
    }

}


/** An epoch: its number, from 1 on, and its profiles (11.1). */
export interface Epoch {
    readonly number:    number;
    readonly profiles:  EpochProfiles;
}

export const FIRST_EPOCH: Epoch = { number: 1, profiles: EpochProfiles.FIRST };

/** Reads `{epoch, profiles}`, e.g. the `next` of a final checkpoint (11.2), or the epoch of a snapshot (11.3). */
export function parseEpoch(value: JSONValue | undefined, what = 'An epoch'): Epoch {

    const json = requireObject(value, what);

    onlyProperties(json, [ '@context', 'epoch', 'profiles', 'previous', 'previousProfiles' ], what);

    if (get(json, '@context') !== undefined && get(json, '@context') !== EPOCH_CONTEXT)
        throw new POIError(`The JSON-LD context of the epoch must be '${EPOCH_CONTEXT}'!`);

    return {
        number:    requireInteger(json, 'epoch', 1, 0xFFFFFFFF, `The number of ${what.toLowerCase()}`),
        profiles:  EpochProfiles.parse(get(json, 'profiles')),
    };

}

/** Whether two epochs are the same, with the same profiles. */
export const sameEpoch = (left: Epoch, right: Epoch): boolean =>
    left.number === right.number &&
    left.profiles.identificationHash === right.profiles.identificationHash &&
    left.profiles.signatureAlgorithms.join() === right.profiles.signatureAlgorithms.join();


/** The final checkpoint of the epoch before, as the first checkpoint of an epoch names it (11.3). */
export interface EpochLink {
    readonly epoch:         number;
    readonly checkpointId:  string;
    readonly eTags:         readonly ETag[];
}

export function parseEpochLink(value: JSONValue | undefined): EpochLink {

    const json = requireObject(value, 'The epoch before');

    onlyProperties(json, [ '@context', 'epoch', 'checkpointId', 'eTags' ], 'The epoch before');

    if (get(json, '@context') !== undefined && get(json, '@context') !== EPOCH_LINK_CONTEXT)
        throw new POIError(`The JSON-LD context of the epoch before must be '${EPOCH_LINK_CONTEXT}'!`);

    return {
        epoch:         requireInteger(json, 'epoch', 1, 0xFFFFFFFF, 'The number of the epoch before'),
        checkpointId:  requireString (json, 'checkpointId', 'The final checkpoint of the epoch before'),
        eTags:         parseETags(get(json, 'eTags'), true, 'The ETags of the epoch before'),
    };

}
