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

import { checkContext, onlyProperties, requireArray, requireInteger, requireObject, requireString, requireTimestamp, toTimestamp, CONTEXT_PREFIX } from '../common.ts';
import { canonicalJSONBytes }    from '../json/canonical.ts';
import { without, type JSONObject, type JSONValue } from '../json/value.ts';
import { verifySignature }       from '../crypto/signature.ts';
import { POIPublicKey }          from '../keys.ts';
import { POIError }              from '../errors.ts';


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


    /** Reads a key statement, refusing properties it does not know: whatever is not signed is not taken. */
    public static parse(value: JSONValue | undefined): KeyStatement {

        const json = requireObject(value, 'A key statement');

        checkContext(json, KEY_STATEMENT_CONTEXT, 'a key statement');
        onlyProperties(json, [ '@context', 'roamingNetworkId', 'roamingNetworkOperatorId', 'identityKeys', 'minConsensus', 'signedAt', 'validUntil', 'signatures' ], 'A key statement');

        const roamingNetworkId          = requireString(json, 'roamingNetworkId',         'The roaming network of a key statement');
        const roamingNetworkOperatorId  = requireString(json, 'roamingNetworkOperatorId', 'The roaming network operator of a key statement');
        const identityKeys              = POIPublicKey.parseAll(json['identityKeys'], 'identity keys of the key statement');

        if (identityKeys.length === 0)
            throw new POIError('A key statement requires its identityKeys!');

        if (identityKeys.some((key, index) => { const before = identityKeys[index - 1]; return before !== undefined && before.id >= key.id; }))
            throw new POIError('The identity keys of a key statement are written in the order of their @ids!');

        const minConsensus  = requireInteger  (json, 'minConsensus', 1, 255, 'The minConsensus of a key statement');
        const signedAt      = requireTimestamp(json, 'signedAt',            'The signedAt of a key statement');
        const validUntil    = requireTimestamp(json, 'validUntil',          'The validUntil of a key statement');

        if (validUntil < signedAt)
            throw new POIError('A key statement is not valid until before it was signed!');

        const signatures = requireArray(json['signatures'], 'The signatures of a key statement').map(item => {
            const signature = requireObject(item, 'A signature of a key statement');
            onlyProperties(signature, [ 'algorithm', 'keyId', 'value' ], 'A signature of a key statement');
            return {
                algorithm:  requireString(signature, 'algorithm'),
                keyId:      requireString(signature, 'keyId'),
                value:      requireString(signature, 'value'),
            };
        });

        if (signatures.length === 0)
            throw new POIError('A key statement requires its signatures!');

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
     * anchor names them, as `TryVerify` of the C# implementation: every signature valid, by an identity key it or the
     * operator names, valid at `signedAt`; signed by trusted keys of as many holders as the larger of the given
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
        const required  = Math.max(options.minConsensus ?? 1, this.minConsensus);
        const holders   = new Set<number>();

        const [ only ] = this.signatures;

        if (only !== undefined && this.signatures.length === 1 && required === 1 && !trusted.has(only.keyId))
            throw new POIError(`The key statement is signed by the key '${only.keyId}', which is not trusted!`);

        for (const signature of this.signatures) {

            const identityKey = keys.find(key => key.id === signature.keyId);

            if (identityKey === undefined)
                throw new POIError(`The identity key '${signature.keyId}' that signed the key statement is not given!`);

            if (!identityKey.isValidAt(this.signedAt))
                throw new POIError(`The identity key '${signature.keyId}' was not valid when the key statement was signed!`);

            this.verifySignature(signature, identityKey);

            const holder = trusted.get(signature.keyId);

            if (holder !== undefined)
                holders.add(holder);

        }

        if (holders.size < required)
            throw new POIError(`The key statement is signed by trusted identity keys of ${holders.size} holder${holders.size === 1 ? '' : 's'}, not of ${required}!`);

        if (options.at !== undefined && !this.isValidAt(options.at))
            throw new POIError(`The key statement is not valid at ${toTimestamp(options.at)}: it was signed at ${toTimestamp(this.signedAt)} and is valid until ${toTimestamp(this.validUntil)}!`);

        const trustedThen = new Map(this.identityKeys.map(key => [ key.id, key.holderOrUnnamed ] as const));

        for (const [id, holder] of trusted)
            if (!trustedThen.has(id))
                trustedThen.set(id, nameOfHolder(holder));

        return { signedBy: new Set([ ...holders ].map(nameOfHolder)), holderOf: trustedThen };

    }

}
