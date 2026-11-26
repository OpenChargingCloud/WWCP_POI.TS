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

import { mandatoryText, nonemptyText, onlyProperties, requireObject, timestampAt, toTimestamp, CONTEXT_PREFIX } from '../common.ts';
import { canonicalJSONBytes }    from '../json/canonical.ts';
import { get, isArray, isObject, without, type JSONObject, type JSONValue } from '../json/value.ts';
import { verifySignature }       from '../crypto/signature.ts';
import { POIPublicKey }          from '../keys.ts';
import { POIError }              from '../errors.ts';
import { trimmed }               from '../network/versionTexts.ts';


export const KEY_STATEMENT_CONTEXT = CONTEXT_PREFIX + 'roamingNetwork/keyStatement/v3';


/** One signature of a key statement, by one identity key. */
export interface KeyStatementSignature {
    readonly algorithm:  string;
    readonly keyId:      string;
    readonly value:      string;
}


/**
 * The key statement of a roaming network operator (SPECIFICATION.md section 8.6): its identity keys and its quorum in a
 * roaming network, until `validUntil`, signed by identity keys of `minConsensus` of its holders. It names no signing keys:
 * each holder certifies its own (see `SigningKeyCertificate`).
 */
export class KeyStatement {

    private constructor(
        public readonly roamingNetworkId:          string,
        public readonly roamingNetworkOperatorId:  string,
        public readonly identityKeys:              readonly POIPublicKey[],
        public readonly minConsensus:              number,
        public readonly signedAt:                  number,
        public readonly validUntil:                number,
        public readonly signatures:                readonly KeyStatementSignature[],
        public readonly json:                      JSONObject
    ) {}


    /**
     * Reads a key statement as `RoamingNetworkKeyStatement.TryParse` of WWCP_POI3 reads it, in its words and order: its
     * context, the roaming network and its operator, its identity keys, `signedAt` and `validUntil` as POI writes them,
     * `minConsensus`, its signatures. Then what this library refuses besides, as whatever is not signed is not taken: a
     * property it does not know, identity keys out of the order of their `@id`s, a `validUntil` before its `signedAt`.
     */
    public static parse(value: JSONValue | undefined): KeyStatement {

        const json = requireObject(value, 'A key statement');

        if (get(json, '@context') !== undefined && get(json, '@context') !== KEY_STATEMENT_CONTEXT)
            throw new POIError(`The JSON-LD context of the key statement must be '${KEY_STATEMENT_CONTEXT}'!`);

        // As their types read them: trimmed.
        const roamingNetworkId          = trimmed(mandatoryText(json, 'roamingNetworkId',         'The roaming network of a key statement'));
        const roamingNetworkOperatorId  = trimmed(mandatoryText(json, 'roamingNetworkOperatorId', 'The roaming network operator of a key statement'));

        const identityKeysJSON = get(json, 'identityKeys');

        if (identityKeysJSON !== undefined && !isArray(identityKeysJSON))
            throw new POIError('The identityKeys of a key statement must be a JSON array!');

        const identityKeys = (identityKeysJSON ?? []).map(item => {
            try {
                return POIPublicKey.parse(item);
            }
            catch {
                throw new POIError('Invalid key in the identityKeys of a key statement!');
            }
        });

        if (identityKeys.length === 0)
            throw new POIError('A key statement requires its identityKeys!');

        const signedAt    = timestampAt(json, 'signedAt');
        const validUntil  = timestampAt(json, 'validUntil');

        if (signedAt === undefined || validUntil === undefined)
            throw new POIError('The signedAt and validUntil of a key statement must be written as yyyy-MM-ddTHH:mm:ss.fffZ!');

        const minConsensus = get(json, 'minConsensus');

        if (typeof minConsensus !== 'number' || !Number.isInteger(minConsensus) || minConsensus < 1 || minConsensus > 255)
            throw new POIError('A key statement requires its minConsensus, a whole number from 1 to 255!');

        const signaturesJSON = get(json, 'signatures');

        if (!isArray(signaturesJSON) || signaturesJSON.length === 0)
            throw new POIError('A key statement requires its signatures!');

        const signatures = signaturesJSON.map(item => {
            const algorithm  = isObject(item) ? nonemptyText(item, 'algorithm') : undefined;
            const keyId      = isObject(item) ? nonemptyText(item, 'keyId')     : undefined;
            const value      = isObject(item) ? nonemptyText(item, 'value')     : undefined;
            if (!isObject(item) || algorithm === undefined || keyId === undefined || value === undefined)
                throw new POIError('Every signature of a key statement requires an algorithm, a key identification and a value!');
            onlyProperties(item, [ 'algorithm', 'keyId', 'value' ], 'A signature of a key statement');
            return { algorithm, keyId, value };
        });

        onlyProperties(json, [ '@context', 'roamingNetworkId', 'roamingNetworkOperatorId', 'identityKeys', 'minConsensus', 'signedAt', 'validUntil', 'signatures' ], 'A key statement');

        // As POIPublicKey.Ordered of its constructor refuses them, before their order is looked at.
        if (new Set(identityKeys.map(key => key.id)).size !== identityKeys.length)
            throw new POIError('Invalid key statement: An identity key of a key statement must not be given twice!');

        if (identityKeys.some((key, index) => { const before = identityKeys[index - 1]; return before !== undefined && before.id >= key.id; }))
            throw new POIError('The identity keys of a key statement are written in the order of their @ids!');

        if (validUntil < signedAt)
            throw new POIError("Invalid key statement: A key statement is not valid until before it was signed. (Parameter 'ValidUntil')");

        // As its constructor refuses them, after its validity.
        if (new Set(signatures.map(signature => signature.keyId)).size !== signatures.length)
            throw new POIError("Invalid key statement: An identity key signs a key statement once. (Parameter 'Signatures')");

        return new KeyStatement(roamingNetworkId, roamingNetworkOperatorId, identityKeys, minConsensus, signedAt, validUntil, signatures, json);

    }


    /** The statement as it is signed: without `signatures`, with its `@context`, keys embedded without theirs. */
    public content(): JSONObject {
        return {
            '@context':                  KEY_STATEMENT_CONTEXT,
            roamingNetworkId:            this.roamingNetworkId,
            roamingNetworkOperatorId:    this.roamingNetworkOperatorId,
            identityKeys:                this.identityKeys.map(key => without(key.json, '@context')),
            minConsensus:                this.minConsensus,
            signedAt:                    toTimestamp(this.signedAt),
            validUntil:                  toTimestamp(this.validUntil),
        };
    }

    /** The signature input of one signature: the content with the signature's own `algorithm` and `keyId`. */
    public signingBytes(algorithm: string, keyId: string): Uint8Array {
        return canonicalJSONBytes({ ...this.content(), algorithm, keyId });
    }

    /** Verifies one signature with the given identity key. */
    public verifySignature(signature: KeyStatementSignature, identityKey: POIPublicKey): void {

        if (signature.keyId !== identityKey.id)
            throw new POIError('The key statement is signed by another key.');

        verifySignature(signature.algorithm, identityKey.key, this.signingBytes(signature.algorithm, signature.keyId), signature.value);

    }

    /** Whether it is valid at the given point in time: `signedAt` ≤ time ≤ `validUntil`. */
    public isValidAt(time: number): boolean {
        return this.signedAt <= time && time <= this.validUntil;
    }


    /** The `@id`s of its identity keys per holder, as it names their holders: what a trust anchor of it pins (8.6). */
    public get holders(): string[][] {

        const holders = new Map<string, string[]>();

        for (const key of this.identityKeys)
            holders.set(key.holderOrUnnamed, [ ...(holders.get(key.holderOrUnnamed) ?? []), key.id ]);

        return [ ...holders.values() ];

    }


    /**
     * Verifies the statement against identity keys trusted by their `@id`s, each of a holder of its own, as
     * `verifyHolders` does. Returns the holders whose trusted keys signed it.
     */
    public verify(trustedIdentityKeyIds: Iterable<string>,
                  otherIdentityKeys:     readonly POIPublicKey[] = [],
                  options:               { minConsensus?: number, at?: number } = {}): Set<string> {

        return this.verifyHolders([ ...trustedIdentityKeyIds ].map(id => [ id ]), otherIdentityKeys, options).signedBy;

    }

    /**
     * Verifies the statement as a verifier trusting identity keys by their `@id`s per holder does (8.6), e.g. as a trust
     * anchor names them, as `TryVerify` of the C# implementation: every signature by an identity key it names or the
     * verifier was given valid, that key valid at `signedAt`; a signature by another key, e.g. one of the statement before
     * that it names no longer, passed over and counted for nothing; signed by trusted keys of as many holders as the larger of the given
     * `minConsensus` and its own require, counted as the verifier knows them, never as the statement names them; the
     * trusted keys it names named as the verifier knows their holders, one holder for the keys of one, another for those of
     * every other; valid at `at`, when given. So no holder counts twice by naming a key of its own as another's.
     *
     * Returns the holders that signed it, and the holder of every identity key trusted then: its own, as it names their
     * holders, and the trusted ones it does not name, as it names another key of their holder, or else as a holder of its
     * own the verifier knows.
     */
    public verifyHolders(trustedHolders:     readonly (readonly string[])[],
                         otherIdentityKeys:  readonly POIPublicKey[] = [],
                         options:            { minConsensus?: number, at?: number } = {}): { signedBy: Set<string>, holderOf: Map<string, string> } {

        return this.verifyRequiring(trustedHolders, otherIdentityKeys, Math.max(options.minConsensus ?? 1, this.minConsensus), options.at);

    }

    /**
     * Verifies the given key statements of one roaming network operator, the oldest first, as a server gives them
     * (`GET ~/RNs/{RN_Id}/keyStatements`, `{ "keyStatements": [ … ] }`), against identity keys the verifier trusts by their
     * `@id`s per holder, e.g. those of a trust anchor it scanned some time ago: the succession from what it trusts to the
     * last of them (8.6), as `TryVerifyChain` of the C# implementation, in its words. The statements before the first one
     * verified as a single one is (`verifyHolders`), e.g. those older than the trust anchor, are passed over. Every
     * statement after it follows the one before: of the same roaming network and operator; signed not before it and while
     * it was valid; signed by identity keys the one before names, of as many of its holders as its `minConsensus`
     * requires, so a second holder joins the only one and one of three leaves; and signed by its own identity keys of as
     * many holders as its own `minConsensus` requires. The last one is valid at `at`, when given.
     *
     * Returns the last key statement, the one of the head of the server that gave them, and the holder of each of its
     * identity keys by its `@id`. Nothing of a chain refused is trusted.
     */
    public static verifyChain(keyStatements:   readonly KeyStatement[],
                              trustedHolders:  readonly (readonly string[])[],
                              options:         { minConsensus?: number, at?: number, otherIdentityKeys?: readonly POIPublicKey[] } = {}): { verified: KeyStatement, holderOf: Map<string, string> } {

        const others  = options.otherIdentityKeys ?? [];
        const count   = keyStatements.length;

        let before:      KeyStatement | undefined;
        let firstError:  string | undefined;

        keyStatements.forEach((statement, index) => {

            // A statement but the last was replaced by the one after it: valid then, whatever became of it since.
            const at = keyStatements[index + 1]?.signedAt ?? options.at;
            const of = `The key statement ${String(index + 1)} of ${String(count)}`;

            if (before === undefined) {

                // Not yet on trusted ground: as a single statement is verified, or passed over.
                try {
                    statement.verifyHolders(trustedHolders, others, { ...(options.minConsensus === undefined ? {} : { minConsensus: options.minConsensus }), ...(at === undefined ? {} : { at }) });
                    before = statement;
                }
                catch (e) {
                    if (!(e instanceof POIError))
                        throw e;
                    firstError ??= e.message;
                }

                return;

            }

            if (statement.roamingNetworkId !== before.roamingNetworkId || statement.roamingNetworkOperatorId !== before.roamingNetworkOperatorId)
                throw new POIError(`${of} is one of the roaming network operator '${statement.roamingNetworkOperatorId}' of '${statement.roamingNetworkId}', not of '${before.roamingNetworkOperatorId}' of '${before.roamingNetworkId}'!`);

            if (statement.signedAt < before.signedAt)
                throw new POIError(`${of} was signed before the one it follows!`);

            const keys = [ ...before.identityKeys, ...others ];

            // By the quorum before, among the keys the statement before names, as it names their holders ...
            try {
                statement.verifyRequiring(before.holders, keys, before.minConsensus, at);
            }
            catch (e) {
                if (!(e instanceof POIError))
                    throw e;
                throw new POIError(`${of} does not follow the one before: ${e.message}`);
            }

            // ... and by its own quorum, among its own keys.
            try {
                statement.verifyRequiring(statement.holders, keys, statement.minConsensus, at);
            }
            catch (e) {
                if (!(e instanceof POIError))
                    throw e;
                throw new POIError(`${of} is not signed by its own quorum: ${e.message}`);
            }

            before = statement;

        });

        if (before === undefined)
            throw new POIError(count === 0
                                   ? 'No key statement is given!'
                                   : `None of the ${String(count)} key statements is signed by the trusted identity keys: ${firstError ?? ''}`);

        const verified: KeyStatement = before;

        return { verified, holderOf: new Map(verified.identityKeys.map(key => [ key.id, key.holderOrUnnamed ] as const)) };

    }

    /**
     * Reads what a server gives as the key statements of a roaming network operator one after the other, the oldest first
     * (`GET ~/RNs/{RN_Id}/keyStatements`): `{ "keyStatements": [ … ] }`, each read as `parse` reads it.
     */
    public static parseChain(value: JSONValue | undefined): KeyStatement[] {

        const statements = get(requireObject(value, 'The key statements'), 'keyStatements');

        if (!isArray(statements))
            throw new POIError('The keyStatements must be a JSON array of key statements!');

        return statements.map(statement => KeyStatement.parse(statement));

    }

    /**
     * As `verifyHolders`, signed by trusted keys of as many holders as given, whatever its own `minConsensus`: as the
     * successor of a statement trusted, the quorum of that one alone decides who holds the keys after it (8.6), so a second
     * holder joins the only one. That it is signed by its own quorum, the version embedding it is refused without.
     */
    public verifyRequiring(trustedHolders:     readonly (readonly string[])[],
                            otherIdentityKeys:  readonly POIPublicKey[],
                            required:           number,
                            at:                 number | undefined): { signedBy: Set<string>, holderOf: Map<string, string> } {

        const trusted = new Map<string, number>();

        trustedHolders.forEach((keys, holder) => {
            for (const id of keys) {
                if (trusted.has(id))
                    throw new POIError(`The identity key '${id}' is trusted as one of two holders!`);
                trusted.set(id, holder);
            }
        });

        // The statement names the trusted keys as the verifier knows their holders.
        const nameOf    = new Map<number, string>();
        const holderOf  = new Map<string, number>();

        for (const identityKey of this.identityKeys) {

            const holder = trusted.get(identityKey.id);

            if (holder === undefined)
                continue;

            const name   = identityKey.holderOrUnnamed;
            const named  = nameOf.get(holder);
            const other  = holderOf.get(name);

            if ((named !== undefined && named !== name) || (other !== undefined && other !== holder))
                throw new POIError(`The key statement names the holder of the trusted identity key '${identityKey.id}' otherwise than it is trusted!`);

            nameOf.set(holder, name);
            holderOf.set(name, holder);

        }

        const nameOfHolder = (holder: number): string =>
            nameOf.get(holder) ?? `\u0000${trustedHolders[holder]?.[0] ?? ''}`;

        const keys      = [ ...this.identityKeys, ...otherIdentityKeys ];
        const holders   = new Set<number>();

        const [ only ] = this.signatures;

        if (only !== undefined && this.signatures.length === 1 && required === 1 && !trusted.has(only.keyId))
            throw new POIError(`The key statement is signed by the key '${only.keyId}', which is not trusted!`);

        for (const signature of this.signatures) {

            // By a key neither the statement names nor the verifier was given, e.g. one of the statement before that
            // left with this one: passed over, as it can not be verified here and counts for nothing. Where the
            // statements are followed one after the other, the one before gives it (verifyChain).
            const identityKey = keys.find(key => key.id === signature.keyId);

            if (identityKey === undefined)
                continue;

            if (!identityKey.isValidAt(this.signedAt))
                throw new POIError(`The identity key '${signature.keyId}' was not valid when the key statement was signed!`);

            this.verifySignature(signature, identityKey);

            const holder = trusted.get(signature.keyId);

            if (holder !== undefined)
                holders.add(holder);

        }

        if (holders.size < required)
            throw new POIError(`The key statement is signed by trusted identity keys of ${holders.size} holder${holders.size === 1 ? '' : 's'}, not of ${required}!`);

        if (at !== undefined && !this.isValidAt(at))
            throw new POIError(`The key statement is not valid at ${toTimestamp(at)}: it was signed at ${toTimestamp(this.signedAt)} and is valid until ${toTimestamp(this.validUntil)}!`);

        const trustedThen = new Map(this.identityKeys.map(key => [ key.id, key.holderOrUnnamed ] as const));

        for (const [id, holder] of trusted)
            if (!trustedThen.has(id))
                trustedThen.set(id, nameOfHolder(holder));

        return { signedBy: new Set([ ...holders ].map(nameOfHolder)), holderOf: trustedThen };

    }

}
