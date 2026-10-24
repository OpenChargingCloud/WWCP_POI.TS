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

import { canonicalJSONBytes }                       from '../json/canonical.ts';
import { get, isArray, isObject, set, without, type JSONObject, type JSONValue } from '../json/value.ts';
import { toHex }                                    from '../encoding/text.ts';
import { leafHash, merkleRootOfLeafHashes, merkleTreeHeadToJSON, parseAuditPath, parseMerkleTreeHead, rootFromAuditPath, type MerkleTreeHead } from '../merkle.ts';
import { DIGEST_LENGTH, type HashAlgorithm }        from '../crypto/hash.ts';
import { bytesEqual }                               from '../encoding/text.ts';
import type { ETag }                                from '../etags.ts';
import { POIError }                                 from '../errors.ts';


/** The kinds of entities that have child arrays (SPECIFICATION.md section 8.2); every other one is a leaf. */
export type TreeNodeKind =
    | 'roamingNetwork'
    | 'chargingStationOperator'
    | 'chargingPool'
    | 'chargingStation'
    | 'eMobilityProvider'
    | 'gridOperator'
    | 'parkingOperator'
    | 'chargingStationManufacturer'
    | 'energyMeterManufacturer'
    | 'transparencySoftwareManufacturer'
    | 'conformityAssessmentBody'
    | 'leaf';


/**
 * The child arrays of each kind of entity, the arrays of entities that change sets add and remove, and the kind of their
 * children (8.2). Everything else is part of the entity that embeds it: its roaming network operator with its keys,
 * brands, charging connectors, energy meters, images, keys of parties, opening times.
 */
export const CHILD_ARRAYS: Readonly<Record<TreeNodeKind, Readonly<Record<string, TreeNodeKind>>>> = {

    roamingNetwork: {
        chargingStationOperators:          'chargingStationOperator',
        chargingStationManufacturers:      'chargingStationManufacturer',
        eMobilityProviders:                'eMobilityProvider',
        gridOperators:                     'gridOperator',
        parkingOperators:                  'parkingOperator',
        energyMeterManufacturers:          'energyMeterManufacturer',
        transparencySoftwareManufacturers: 'transparencySoftwareManufacturer',
        conformityAssessmentBodies:        'conformityAssessmentBody',
    },

    chargingStationOperator: {
        chargingPools:                     'chargingPool',
        chargingTariffs:                   'leaf',
        EVSETemplates:                     'leaf',
        chargingStationTemplates:          'leaf',
        chargingPoolTemplates:             'leaf',
        chargingTariffTemplates:           'leaf',
        energyMeterTemplates:              'leaf',
        EVSEGroups:                        'leaf',
        chargingStationGroups:             'leaf',
        chargingPoolGroups:                'leaf',
        chargingTariffGroups:              'leaf',
        energyMeterGroups:                 'leaf',
        chargingTariffOffers:              'leaf',
        parkingSpaces:                     'leaf',
    },

    chargingPool: {
        chargingStations:                  'chargingStation',
    },

    chargingStation: {
        EVSEs:                             'leaf',
    },

    eMobilityProvider: {
        EVSEGroups:                        'leaf',
        chargingStationGroups:             'leaf',
        chargingPoolGroups:                'leaf',
        chargingTariffOffers:              'leaf',
    },

    gridOperator: {
        gridConnectionPoints:              'leaf',
        energyMeterTemplates:              'leaf',
        energyMeterGroups:                 'leaf',
    },

    parkingOperator: {
        parkingGarages:                    'leaf',
        parkingSpaces:                     'leaf',
        parkingSensors:                    'leaf',
        parkingSpaceTemplates:             'leaf',
        parkingSpaceGroups:                'leaf',
        parkingProducts:                   'leaf',
    },

    chargingStationManufacturer: {
        chargingStationModels:             'leaf',
    },

    energyMeterManufacturer: {
        energyMeterModels:                 'leaf',
    },

    transparencySoftwareManufacturer: {
        transparencySoftware:              'leaf',
    },

    conformityAssessmentBody: {
        transparencySoftwareCertificates:  'leaf',
    },

    leaf: {},

};


/**
 * The digest of an entity of the effective content (8.2): `H(0x00 || <canonical JSON of its skeleton>)`, its skeleton
 * being its JSON with every child array replaced by `{"@merkleRoot": "<MTH of its children's skeletons>", "@size": n}`.
 * The digest of the roaming network is the root of the tree, its `effectiveTree` ETag.
 */
export function entityDigest(entity: JSONObject, kind: TreeNodeKind, algorithm: HashAlgorithm): Uint8Array {
    return leafHash(algorithm, canonicalJSONBytes(skeleton(entity, kind, algorithm)));
}

/** The skeleton of an entity of the effective content (8.2). */
export function skeleton(entity: JSONObject, kind: TreeNodeKind, algorithm: HashAlgorithm): JSONObject {

    let result: JSONObject | undefined;

    for (const [property, childKind] of Object.entries(CHILD_ARRAYS[kind])) {

        const children = get(entity, property);

        if (children === undefined)
            continue;

        if (!isArray(children) || !children.every(isObject))
            throw new POIError(`The child array '${property}' must be an array of entities!`);

        result ??= { ...entity };

        set(result, property, merkleTreeHeadToJSON({
            root: merkleRootOfLeafHashes(algorithm, (children as JSONObject[]).map(child => entityDigest(child, childKind, algorithm))),
            size: children.length,
        }));

    }

    return result ?? entity;

}

/** The `effectiveTree` ETag of the effective content of a roaming network, with its `@context`. */
export function effectiveTreeETag(effectiveContent: JSONObject, algorithm: HashAlgorithm): ETag {
    return { format: 'effectiveTree', algorithm, digest: entityDigest(effectiveContent, 'roamingNetwork', algorithm) };
}


// Proofs (SPECIFICATION.md section 8.4): the roaming network in its effective content, pruned.


/** What a verifier learns of a pruned roaming network: its root, and what the proof gives completely. */
export interface PrunedTree {
    /** The digest of the roaming network calculated from the proof, the root to compare with an attested ETag. */
    readonly root:      Uint8Array;
    /** The roaming network with every child array given completely or partially reduced to the entities it gives. */
    readonly attested:  JSONObject;
}


/**
 * Calculates the digest of an entity of a proof bottom-up (8.4): each child array, at any depth, is complete (an array of
 * its children, each again in any form), pruned (exactly `{"@merkleRoot", "@size"}`) or partial (exactly `{"@size",
 * "@leaves"}`, at least one leaf, ascending indices below the size, each leaf exactly `{"@index", "@auditPath",
 * "@entity"}`, all leading to the same root).
 */
export function prunedDigest(entity: JSONObject, kind: TreeNodeKind, algorithm: HashAlgorithm, path = '$'): { digest: Uint8Array, attested: JSONObject } {

    const skeletonJSON: JSONObject = { ...entity };
    const attested:     JSONObject = { ...entity };

    for (const [property, childKind] of Object.entries(CHILD_ARRAYS[kind])) {

        const form = get(entity, property);

        if (form === undefined)
            continue;

        const where = `${path}.${property}`;
        let   head: MerkleTreeHead;

        // Complete
        if (isArray(form)) {

            const children = form.map((child, index) => {
                if (!isObject(child))
                    throw new POIError(`The child ${where}[${index}] of the proof must be an entity!`);
                return prunedDigest(child, childKind, algorithm, `${where}[${index}]`);
            });

            head = { root: merkleRootOfLeafHashes(algorithm, children.map(child => child.digest)), size: children.length };
            set(attested, property, children.map(child => child.attested));

        }

        // Pruned
        else if (isObject(form) && get(form, '@merkleRoot') !== undefined) {

            head = parseMerkleTreeHead(form, algorithm, `The pruned child array ${where}`);
            set(attested, property, merkleTreeHeadToJSON(head));

        }

        // Partial
        else if (isObject(form) && get(form, '@leaves') !== undefined) {

            if (Object.keys(form).length !== 2 || get(form, '@size') === undefined)
                throw new POIError(`The partial child array ${where} must be exactly {"@size", "@leaves"}!`);

            const size   = get(form, '@size');
            const leaves = get(form, '@leaves');

            if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1)
                throw new POIError(`The @size of the partial child array ${where} must be a whole number above 0!`);

            if (!isArray(leaves) || leaves.length === 0)
                throw new POIError(`The partial child array ${where} must give at least one leaf!`);

            let root:       Uint8Array | undefined;
            let lastIndex   = -1;
            const given:    JSONValue[] = [];

            for (const leaf of leaves) {

                if (!isObject(leaf) || Object.keys(leaf).length !== 3)
                    throw new POIError(`A leaf of the partial child array ${where} must be exactly {"@index", "@auditPath", "@entity"}!`);

                const index   = get(leaf, '@index');
                const child   = get(leaf, '@entity');

                if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= size)
                    throw new POIError(`The @index of a leaf of the partial child array ${where} must be below its @size!`);

                if (index <= lastIndex)
                    throw new POIError(`The leaves of the partial child array ${where} must be in ascending order of their @index!`);

                if (!isObject(child))
                    throw new POIError(`The @entity of a leaf of the partial child array ${where} must be an entity!`);

                lastIndex = index;

                const auditPath = parseAuditPath(get(leaf, '@auditPath'), algorithm, `a leaf of ${where}`);
                const childTree = prunedDigest(child, childKind, algorithm, `${where}[@index=${index}]`);
                const leafRoot  = rootFromAuditPath(algorithm, childTree.digest, index, size, auditPath);

                if (root !== undefined && !bytesEqual(root, leafRoot))
                    throw new POIError(`The leaves of the partial child array ${where} lead to different roots!`);

                root = leafRoot;
                given.push(childTree.attested);

            }

            head = { root: root!, size };
            set(attested, property, given);

        }

        else
            throw new POIError(`The child array ${where} of the proof is neither complete, nor pruned, nor partial!`);

        if (head.root.length !== DIGEST_LENGTH[algorithm])
            throw new POIError(`The root of ${where} has the wrong length!`);

        set(skeletonJSON, property, merkleTreeHeadToJSON(head));

    }

    return { digest: leafHash(algorithm, canonicalJSONBytes(skeletonJSON)), attested };

}


/** The root of a pruned roaming network and what it gives completely (8.4). */
export function prunedTree(roamingNetwork: JSONObject, algorithm: HashAlgorithm): PrunedTree {
    const { digest, attested } = prunedDigest(roamingNetwork, 'roamingNetwork', algorithm);
    return { root: digest, attested };
}

/** The digest in hex, for messages. */
export const hexDigest = (digest: Uint8Array): string =>
    toHex(digest);

export { without };
