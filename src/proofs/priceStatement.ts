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

import { checkContext, onlyProperties, optionalString, optionalTimestamp, requireArray, requireInteger, requireObject, requireString, requireTimestamp, CONTEXT_PREFIX } from '../common.ts';
import { canonicalJSONBytes, ordinal } from '../json/canonical.ts';
import { get, isArray, isObject, without, type JSONObject, type JSONValue } from '../json/value.ts';
import { bytesEqual, fromHex, isLowerHex, toHex } from '../encoding/text.ts';
import { hash }                      from '../crypto/hash.ts';
import { verifySignature }           from '../crypto/signature.ts';
import { leafHash, merkleRootOfLeafHashes, parseAuditPath, rootFromAuditPath } from '../merkle.ts';
import { KeyUsages, type POIPublicKey } from '../keys.ts';
import type { Checkpoint }           from '../history/checkpoint.ts';
import { POIError }                  from '../errors.ts';


export const PRICE_STATEMENT_CONTEXT        = CONTEXT_PREFIX + 'roamingNetwork/priceStatement/v1';
export const PRICE_STATEMENT_PROOF_CONTEXT  = CONTEXT_PREFIX + 'roamingNetwork/priceStatementProof/v1';

/** The entities a price statement is of (12.1). */
export const PRICE_STATEMENT_ENTITY_TYPES = [ 'ChargingPool', 'ChargingStation', 'EVSE' ] as const;


/**
 * A price statement (SPECIFICATION.md section 12): the price status of a charging pool, station or EVSE, ad hoc prices
 * replacing the elements of charging tariffs of its operator, signed by the operator when it sets the price, chained per
 * entity by `sequence` and `previous`.
 */
export class PriceStatement {

    private constructor(
        public readonly roamingNetworkId:  string,
        public readonly entityType:        string,
        public readonly entityId:          string,
        public readonly priceStatus:       JSONObject,
        public readonly validFrom:         number,
        public readonly validUntil:        number | undefined,
        public readonly sequence:          number,
        public readonly previous:          string | undefined,
        public readonly after:             string | undefined,
        public readonly role:              string,
        public readonly signer:            string,
        public readonly signedAt:          number,
        public readonly algorithm:         string,
        public readonly keyId:             string,
        public readonly value:             string,
        /** The statement as signed and hashed: with its `@context`, as it was given. */
        public readonly json:              JSONObject
    ) {}


    public static parse(value: JSONValue | undefined): PriceStatement {

        const given = requireObject(value, 'A price statement');

        checkContext(given, PRICE_STATEMENT_CONTEXT, 'a price statement');
        onlyProperties(given, [ '@context', 'roamingNetworkId', 'entityType', 'entityId', 'priceStatus', 'validFrom', 'validUntil', 'sequence',
                                'previous', 'after', 'role', 'signer', 'signedAt', 'algorithm', 'keyId', 'value' ], 'A price statement');

        const json        = { ...given, '@context': PRICE_STATEMENT_CONTEXT };
        const entityType  = requireString(json, 'entityType', 'The entity type of a price statement');

        if (!(PRICE_STATEMENT_ENTITY_TYPES as readonly string[]).includes(entityType))
            throw new POIError(`A price statement is one of a ChargingPool, a ChargingStation or an EVSE, not of a '${entityType}'!`);

        const priceStatus = requireObject(get(json, 'priceStatus'), 'The price status of a price statement');
        const prices      = get(priceStatus, 'prices');

        if (!isArray(prices) || !prices.every(price => isObject(price) && typeof price['chargingTariffId'] === 'string' && isArray(price['elements'])))
            throw new POIError('The price status of a price statement is {"prices": [{"chargingTariffId", "elements"}, …]}!');

        const signedAt    = requireTimestamp (json, 'signedAt',   'The signedAt of a price statement');
        const validFrom   = requireTimestamp (json, 'validFrom',  'The validFrom of a price statement');
        const validUntil  = optionalTimestamp(json, 'validUntil', 'The validUntil of a price statement');
        const sequence    = requireInteger   (json, 'sequence', 0, Number.MAX_SAFE_INTEGER, 'The sequence of a price statement');
        const previous    = optionalString   (json, 'previous',   'The previous of a price statement');

        if (validFrom < signedAt)
            throw new POIError('A price statement is not valid from before it was signed!');

        if (validUntil !== undefined && validUntil < validFrom)
            throw new POIError('A price statement is not valid until before it is valid from!');

        if ((sequence === 0) !== (previous === undefined))
            throw new POIError(sequence === 0
                                   ? 'The first price statement of an entity names no previous one!'
                                   : `The price statement ${sequence} must name the digest of the one before as its previous!`);

        if (previous !== undefined && !isLowerHex(previous, 32))
            throw new POIError('The previous of a price statement is a digest of 64 lowercase hexadecimal digits!');

        const role = requireString(json, 'role', 'The role of a price statement');

        if (role !== 'chargingStationOperator')
            throw new POIError(`A price statement is signed in the role 'chargingStationOperator', not '${role}'!`);

        return new PriceStatement(
                   requireString(json, 'roamingNetworkId', 'The roaming network of a price statement'),
                   entityType,
                   requireString(json, 'entityId', 'The entity of a price statement'),
                   priceStatus,
                   validFrom,
                   validUntil,
                   sequence,
                   previous,
                   optionalString(json, 'after', 'The after of a price statement'),
                   role,
                   requireString(json, 'signer', 'The signer of a price statement'),
                   signedAt,
                   requireString(json, 'algorithm'),
                   requireString(json, 'keyId'),
                   requireString(json, 'value'),
                   json
               );

    }


    /** The signature input (12.1): the statement without `value`, with its `@context`. */
    public signingBytes(): Uint8Array {
        return canonicalJSONBytes(without(this.json, 'value'));
    }

    /** The digest (12.1): the SHA-256 of its canonical JSON with its `@context`, its signature value included. */
    public digest(): Uint8Array {
        return hash('sha256', canonicalJSONBytes(this.json));
    }

    public digestHex(): string {
        return toHex(this.digest());
    }

    /** The charging tariffs it names, with their elements. */
    public get prices(): JSONObject[] {
        return (this.priceStatus['prices'] as JSONObject[]);
    }


    /**
     * Verifies the statement against the signing keys of the operator of its entity (12.1, 12.4): of this roaming network,
     * signed in its role by the operator its identification names, with one of its signing keys valid at `signedAt` that
     * may sign `priceStatements`, the signature valid.
     */
    public verify(roamingNetworkId: string, operatorId: string, signingKeys: readonly POIPublicKey[]): POIPublicKey {

        if (this.roamingNetworkId !== roamingNetworkId)
            throw new POIError(`The price statement is one of the roaming network '${this.roamingNetworkId}', not of '${roamingNetworkId}'!`);

        if (this.signer !== operatorId || !this.entityId.startsWith(operatorId + '*'))
            throw new POIError(`The price statement of the ${this.entityType} '${this.entityId}' is not signed by its operator '${operatorId}'!`);

        const key = signingKeys.find(signingKey => signingKey.id === this.keyId);

        if (key === undefined)
            throw new POIError(`The key '${this.keyId}' is no signing key of the charging station operator '${operatorId}'!`);

        if (!key.isValidAt(this.signedAt))
            throw new POIError(`The signing key '${key.id}' of the charging station operator '${operatorId}' was not valid when the price statement was signed!`);

        if (!key.maySign(KeyUsages.PriceStatements))
            throw new POIError(`The signing key '${key.id}' of the charging station operator '${operatorId}' may not sign 'priceStatements', only '${key.usages.join(', ')}'!`);

        try {
            verifySignature(this.algorithm, key.key, this.signingBytes(), this.value);
        }
        catch (e) {
            throw new POIError(`The signature of the price statement is invalid: ${e instanceof Error ? e.message : String(e)}`);
        }

        return key;

    }

    /**
     * Whether both are the same statement as signed, whatever their signature values. An ECDSA signature `(r, s)` has a
     * twin `(r, n − s)` anybody can make from it, valid as well; as the digest covers the value, the twin has another
     * digest. It is the same statement, not a split view of its operator. See docs/csharp-review.md.
     */
    public sameSignedContent(other: PriceStatement): boolean {
        return bytesEqual(this.signingBytes(), other.signingBytes());
    }

    /** Whether it is valid at the given point in time: from `validFrom`, until `validUntil` where it names one. */
    public isValidAt(time: number): boolean {
        return this.validFrom <= time && (this.validUntil === undefined || time <= this.validUntil);
    }

    /** Whether it is the next statement of the given one: of the same entity, one sequence more, naming its digest. */
    public follows(previous: PriceStatement): boolean {
        return this.entityType === previous.entityType &&
               this.entityId   === previous.entityId   &&
               this.sequence   === previous.sequence + 1 &&
               this.previous   === previous.digestHex();
    }

}


/** Checks a chain of statements of one entity, as given in their order: each the next of the one before (12.1). */
export function verifyPriceStatementChain(statements: readonly PriceStatement[]): void {

    statements.forEach((statement, index) => {
        if (index > 0 && !statement.follows(statements[index - 1]!))
            throw new POIError(`The price statement ${statement.sequence} of the ${statement.entityType} '${statement.entityId}' does not follow the one before!`);
    });

}


/**
 * The root of the tree of the price statements a checkpoint names (12.3): in the ordinal order of their entity types and
 * identifications, then of their sequences; a leaf the 32 bytes of the digest of a statement.
 */
export function priceStatementsRoot(statements: readonly PriceStatement[]): { root: Uint8Array, size: number } {

    const ordered = [ ...statements ].sort((left, right) =>
        ordinal(left.entityType, right.entityType) ||
        ordinal(left.entityId,   right.entityId)   ||
        left.sequence - right.sequence             ||
        ordinal(left.digestHex(), right.digestHex()));

    return {
        root: merkleRootOfLeafHashes('sha256', ordered.map(statement => leafHash('sha256', statement.digest()))),
        size: ordered.length,
    };

}

/** Checks that the given statements are those a checkpoint names, and each signed before it (12.3). */
export function verifyCheckpointPriceStatements(checkpoint: Checkpoint, statements: readonly PriceStatement[]): void {

    if (checkpoint.priceStatements === undefined)
        throw new POIError(`The checkpoint '${checkpoint.id}' names no price statements!`);

    const { root, size } = priceStatementsRoot(statements);

    if (size !== checkpoint.priceStatements.size || !bytesEqual(root, checkpoint.priceStatements.root))
        throw new POIError(`The price statements are not those the checkpoint '${checkpoint.id}' names!`);

    for (const statement of statements)
        if (statement.signedAt > checkpoint.createdAt)
            throw new POIError(`The price statement ${statement.sequence} of '${statement.entityId}' was signed after the checkpoint '${checkpoint.id}'!`);

}

/** Reads the statements of a checkpoint, as `GET ~/history/checkpoints/{checkpointId}/priceStatements` gives them. */
export const parsePriceStatements = (value: JSONValue | undefined): PriceStatement[] =>
    requireArray(value, 'The price statements').map(PriceStatement.parse);


/**
 * The proof that a price statement is named by a checkpoint (12.3): the statement with its index and audit path in the
 * tree of the price statements of the checkpoint. Then it was made before the checkpoint.
 */
export class PriceStatementProof {

    private constructor(
        public readonly checkpointId:    string,
        public readonly priceStatement:  PriceStatement,
        public readonly index:           number,
        public readonly size:            number,
        public readonly auditPath:       readonly Uint8Array[],
        public readonly json:            JSONObject
    ) {}


    public static parse(value: JSONValue | undefined): PriceStatementProof {

        const json = requireObject(value, 'A proof of a price statement');

        checkContext(json, PRICE_STATEMENT_PROOF_CONTEXT, 'a proof of a price statement');
        onlyProperties(json, [ '@context', 'checkpointId', 'priceStatement', '@index', '@size', '@auditPath' ], 'A proof of a price statement');

        return new PriceStatementProof(
                   requireString (json, 'checkpointId', 'The checkpoint of a proof of a price statement'),
                   PriceStatement.parse(get(json, 'priceStatement')),
                   requireInteger(json, '@index', 0, Number.MAX_SAFE_INTEGER, 'The @index of a proof of a price statement'),
                   requireInteger(json, '@size',  1, Number.MAX_SAFE_INTEGER, 'The @size of a proof of a price statement'),
                   parseAuditPath(get(json, '@auditPath'), 'sha256', 'a proof of a price statement'),
                   json
               );

    }


    /**
     * Verifies the proof against a checkpoint (12.3): of this checkpoint, of the size of its tree of price statements,
     * leading to its root; the statement of its roaming network and signed before the checkpoint. The signatures the
     * checkpoint must carry and the signature of the statement are the caller's to check.
     */
    public verify(checkpoint: Checkpoint): void {

        if (checkpoint.id !== this.checkpointId)
            throw new POIError(`The proof is for the checkpoint '${this.checkpointId}', not for '${checkpoint.id}'!`);

        if (checkpoint.priceStatements === undefined)
            throw new POIError(`The checkpoint '${checkpoint.id}' names no price statements!`);

        if (checkpoint.priceStatements.size !== this.size)
            throw new POIError(`The proof is for a tree of ${this.size} price statements, the checkpoint names ${checkpoint.priceStatements.size}!`);

        if (this.priceStatement.roamingNetworkId !== checkpoint.roamingNetworkId)
            throw new POIError('The price statement is one of another roaming network!');

        const root = rootFromAuditPath('sha256', leafHash('sha256', this.priceStatement.digest()), this.index, this.size, this.auditPath);

        if (!bytesEqual(root, checkpoint.priceStatements.root))
            throw new POIError('The proof does not lead to the price statements of the checkpoint!');

        if (this.priceStatement.signedAt > checkpoint.createdAt)
            throw new POIError('The price statement was signed after the checkpoint naming it!');

    }

}

export { fromHex };
