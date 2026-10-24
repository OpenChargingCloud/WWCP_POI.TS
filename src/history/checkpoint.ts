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
import { canonicalJSONBytes }        from '../json/canonical.ts';
import { get, without, type JSONObject, type JSONValue } from '../json/value.ts';
import { bytesEqual, fromHex, isLowerHex, toHex } from '../encoding/text.ts';
import { hash, hashAlgorithmOfIdentification, type HashAlgorithm } from '../crypto/hash.ts';
import { verifySignature }           from '../crypto/signature.ts';
import { parseETags, sameETags, type ETag } from '../etags.ts';
import { leafHash, merkleRootOfLeafHashes, parseAuditPath, parseMerkleTreeHead, rootFromAuditPath, type MerkleTreeHead } from '../merkle.ts';
import { parseRoleSignature, roleSignatureBytes, type Commit, type RoleSignature } from './commit.ts';
import { parseEpoch, parseEpochLink, type Epoch, type EpochLink } from './epoch.ts';
import type { POIPublicKey }         from '../keys.ts';
import { POIError }                  from '../errors.ts';


export const CHECKPOINT_CONTEXT            = CONTEXT_PREFIX + 'roamingNetwork/checkpoint/v1';
export const CHECKPOINT_SIGNATURE_CONTEXT  = CONTEXT_PREFIX + 'roamingNetwork/checkpointSignature/v1';
export const CHECKPOINT_PROOF_CONTEXT      = CONTEXT_PREFIX + 'roamingNetwork/checkpointProof/v1';


/**
 * A checkpoint (SPECIFICATION.md section 10): a signed statement that a commit, and every commit it follows, is part of the
 * history of a roaming network. Read only when its `@id` is the digest of its content: the checkpoint without `@id` and
 * `signatures`, with its `@context`.
 */
export class Checkpoint {

    private constructor(
        public readonly id:                  string,
        public readonly roamingNetworkId:    string,
        public readonly epoch:               number,
        public readonly sequence:            number,
        public readonly previousId:          string | undefined,
        public readonly commitId:            string,
        public readonly revision:            number,
        public readonly eTags:               readonly ETag[],
        public readonly commits:             MerkleTreeHead,
        public readonly priceStatements:     MerkleTreeHead | undefined,
        public readonly createdAt:           number,
        public readonly signatures:          readonly RoleSignature[],
        public readonly identificationHash:  HashAlgorithm,
        /** The next epoch, which the final checkpoint of an epoch names (11.2). */
        public readonly next:                Epoch | undefined,
        /** The final checkpoint of the epoch before, which the first checkpoint of a later epoch names (11.3). */
        public readonly previous:            EpochLink | undefined,
        public readonly json:                JSONObject
    ) {}

    /** Whether this is the final checkpoint of its epoch, `"final": true` with the next epoch (11.2). */
    public get isFinal(): boolean {
        return this.next !== undefined;
    }


    public static parse(value: JSONValue | undefined): Checkpoint {

        const json = requireObject(value, 'A checkpoint');

        checkContext(json, CHECKPOINT_CONTEXT, 'a checkpoint');
        onlyProperties(json, [ '@id', '@context', 'roamingNetworkId', 'epoch', 'sequence', 'previousId', 'commitId', 'revision', 'eTags',
                               'commits', 'priceStatements', 'createdAt', 'final', 'next', 'previous', 'signatures' ], 'A checkpoint');

        const id = requireString(json, '@id', 'The identification of a checkpoint');

        if (!isLowerHex(id) || ![ 64, 96, 128 ].includes(id.length))
            throw new POIError('Missing or invalid checkpoint identification!');

        const identificationHash = hashAlgorithmOfIdentification(id);
        const sequence           = requireInteger(json, 'sequence', 0, Number.MAX_SAFE_INTEGER, `The sequence of the checkpoint '${id}'`);
        const previousId         = get(json, 'previousId') === undefined ? undefined : requireString(json, 'previousId', `The previousId of the checkpoint '${id}'`);

        if ((sequence === 0) !== (previousId === undefined))
            throw new POIError(`The checkpoint '${id}' of the sequence ${sequence} ${sequence === 0 ? 'names no previous checkpoint' : 'names the checkpoint before it'}!`);

        const signaturesJSON  = get(json, 'signatures');
        const epoch           = requireInteger(json, 'epoch', 1, 0xFFFFFFFF, `The epoch of the checkpoint '${id}'`);
        const commitId        = requireString (json, 'commitId', `The commit of the checkpoint '${id}'`);

        // A checkpoint, its commit and the checkpoint before are identified with the hash of their epoch, SHA-256 in the first.
        if (epoch === 1 && identificationHash !== 'sha256')
            throw new POIError(`The checkpoint '${id}' of the first epoch is identified with SHA-256!`);

        if (!isLowerHex(commitId) || commitId.length !== id.length || (previousId !== undefined && (!isLowerHex(previousId) || previousId.length !== id.length)))
            throw new POIError(`The checkpoint '${id}', its commit and the checkpoint before are not identified with the same hash, the one of their epoch!`);

        // The final checkpoint of an epoch names the next one, the first checkpoint of a later epoch the final one before.
        let next: Epoch | undefined;

        if (get(json, 'final') !== undefined) {
            if (get(json, 'final') !== true || get(json, 'next') === undefined)
                throw new POIError('A final checkpoint is "final": true, with the next epoch as "next"!');
            next = parseEpoch(get(json, 'next'), 'The next epoch');
            if (next.number !== epoch + 1)
                throw new POIError(`The final checkpoint '${id}' of the epoch ${epoch} names the epoch ${next.number}, not the next one!`);
        }
        else if (get(json, 'next') !== undefined)
            throw new POIError(`The checkpoint '${id}' names a next epoch without being final!`);

        const previous = get(json, 'previous') === undefined ? undefined : parseEpochLink(get(json, 'previous'));

        if ((previous !== undefined) !== (sequence === 0 && epoch > 1))
            throw new POIError(`The first checkpoint of an epoch after the first one names the final checkpoint of the one before, no other checkpoint does: '${id}'!`);

        if (previous !== undefined && previous.epoch !== epoch - 1)
            throw new POIError(`The first checkpoint '${id}' of the epoch ${epoch} names a checkpoint of the epoch ${previous.epoch}, not of the one just before!`);

        const checkpoint = new Checkpoint(
            id,
            requireString   (json, 'roamingNetworkId', `The roaming network of the checkpoint '${id}'`),
            epoch,
            sequence,
            previousId,
            commitId,
            requireInteger  (json, 'revision', 0, Number.MAX_SAFE_INTEGER, `The revision of the checkpoint '${id}'`),
            parseETags(get(json, 'eTags'), true, `The ETags of the checkpoint '${id}'`),
            parseMerkleTreeHead(get(json, 'commits'), identificationHash, `The commits of the checkpoint '${id}'`),
            get(json, 'priceStatements') === undefined ? undefined : parseMerkleTreeHead(get(json, 'priceStatements'), identificationHash, `The price statements of the checkpoint '${id}'`),
            requireTimestamp(json, 'createdAt', `The createdAt of the checkpoint '${id}'`),
            signaturesJSON === undefined ? [] : requireArray(signaturesJSON, 'The signatures of a checkpoint').map(signature => parseRoleSignature(signature, 'A signature of a checkpoint')),
            identificationHash,
            next,
            previous,
            json
        );

        const computed = toHex(hash(identificationHash, canonicalJSONBytes(checkpoint.identificationContent())));

        if (computed !== id)
            throw new POIError(`The checkpoint identification '${id}' is not the one of its content, '${computed}'!`);

        return checkpoint;

    }


    /** What the identification is the digest of: the checkpoint without `@id` and `signatures`, with its `@context`. */
    public identificationContent(): JSONObject {
        const content = without(this.json, '@id', 'signatures');
        content['@context'] = CHECKPOINT_CONTEXT;
        return content;
    }

    /** The checkpoint as a signature of it signs it: with its `@context` and `@id`, without its signatures (10.2). */
    public signedContent(): JSONObject {
        const content = without(this.json, 'signatures');
        content['@context'] = CHECKPOINT_CONTEXT;
        return content;
    }

    public signingBytes(signature: RoleSignature): Uint8Array {
        return roleSignatureBytes(CHECKPOINT_SIGNATURE_CONTEXT, signature, 'checkpoint', this.signedContent());
    }

    /** Verifies one signature with a trusted key, refusing one by another key. */
    public verifySignature(signature: RoleSignature, key: POIPublicKey): void {

        if (signature.keyId !== key.id)
            throw new POIError('The signature key ID does not match the trusted key ID.');

        verifySignature(signature.algorithm, key.key, this.signingBytes(signature), signature.value);

    }

    /** Whether the checkpoint names the given commit with its revision and ETags. */
    public isOf(commit: Commit): boolean {
        return commit.id === this.commitId && commit.revision === this.revision && sameETags(commit.eTags, this.eTags);
    }


    /**
     * Checks that the given commits are the commits of this checkpoint (10.1): the commit itself and every commit it
     * follows that the commit of the previous checkpoint neither is nor follows, ascending by revision, then ordinally by
     * identification, their tree the one this checkpoint names.
     */
    public verifyCommits(commits: readonly Commit[]): void {

        const ordered = [ ...commits ].sort((left, right) => left.revision - right.revision || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
        const root    = commitsRoot(ordered, this.identificationHash);

        if (ordered.length !== this.commits.size || !bytesEqual(root, this.commits.root))
            throw new POIError(`The ${ordered.length} commit(s) are not those of the checkpoint '${this.id}'!`);

        if (ordered.at(-1)?.id !== this.commitId)
            throw new POIError(`The last commit of the checkpoint '${this.id}' is not its commit!`);

    }

}


/** The leaf hash of a commit in the tree of the commits of a checkpoint: the canonical JSON of `{commitId, eTags, revision}`. */
export const commitLeafHash = (leaf: JSONObject, algorithm: HashAlgorithm): Uint8Array =>
    leafHash(algorithm, canonicalJSONBytes(leaf));

/** The root of the tree of the given commits, in the given order. */
export const commitsRoot = (commits: readonly Commit[], algorithm: HashAlgorithm): Uint8Array =>
    merkleRootOfLeafHashes(algorithm, commits.map(commit => commitLeafHash(commit.checkpointLeaf(), algorithm)));


/**
 * The proof that a commit is part of a checkpoint (10.4): its leaf `{commitId, eTags, revision}` with its index and audit
 * path in the tree of the commits of the checkpoint.
 */
export class CheckpointProof {

    private constructor(
        public readonly checkpointId:  string,
        public readonly leaf:          JSONObject,
        public readonly commitId:      string,
        public readonly revision:      number,
        public readonly eTags:         readonly ETag[],
        public readonly index:         number,
        public readonly size:          number,
        public readonly auditPath:     readonly Uint8Array[],
        public readonly json:          JSONObject
    ) {}


    public static parse(value: JSONValue | undefined): CheckpointProof {

        const json = requireObject(value, 'A proof of a commit');

        checkContext(json, CHECKPOINT_PROOF_CONTEXT, 'a proof of a commit');
        onlyProperties(json, [ '@context', 'checkpointId', 'leaf', '@index', '@size', '@auditPath' ], 'A proof of a commit');

        const checkpointId  = requireString(json, 'checkpointId', 'The checkpoint of a proof of a commit');
        const leaf          = requireObject(get(json, 'leaf'), 'The leaf of a proof of a commit');

        onlyProperties(leaf, [ 'commitId', 'eTags', 'revision' ], 'The leaf of a proof of a commit');

        return new CheckpointProof(
                   checkpointId,
                   leaf,
                   requireString (leaf, 'commitId', 'The commit of a proof'),
                   requireInteger(leaf, 'revision', 0, Number.MAX_SAFE_INTEGER, 'The revision of a proof'),
                   parseETags(get(leaf, 'eTags'), true, 'The ETags of the leaf of a proof'),
                   requireInteger(json, '@index', 0, Number.MAX_SAFE_INTEGER, 'The @index of a proof'),
                   requireInteger(json, '@size',  1, Number.MAX_SAFE_INTEGER, 'The @size of a proof'),
                   parseAuditPath(get(json, '@auditPath'), hashAlgorithmOfIdentification(checkpointId), 'a proof of a commit'),
                   json
               );

    }


    /**
     * Verifies the proof against a checkpoint (10.4): of this checkpoint, of its size, leading to its `commits` root. The
     * signatures the checkpoint must carry are the caller's to check.
     */
    public verify(checkpoint: Checkpoint): void {

        if (checkpoint.id !== this.checkpointId)
            throw new POIError(`The proof is for the checkpoint '${this.checkpointId}', not for '${checkpoint.id}'!`);

        if (checkpoint.commits.size !== this.size)
            throw new POIError(`The proof is for a tree of ${this.size} commits, the checkpoint names ${checkpoint.commits.size}!`);

        const root = rootFromAuditPath(checkpoint.identificationHash, commitLeafHash(this.leaf, checkpoint.identificationHash), this.index, this.size, this.auditPath);

        if (!bytesEqual(root, checkpoint.commits.root))
            throw new POIError('The proof does not lead to the commits of the checkpoint!');

    }

}

export { fromHex };
