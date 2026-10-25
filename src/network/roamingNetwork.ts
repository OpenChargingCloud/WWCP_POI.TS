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

import { checkContext, requireInteger, requireObject, requireString, CONTEXT_PREFIX } from '../common.ts';
import { get, isArray, isObject, sameValue, set, without, type JSONObject, type JSONValue } from '../json/value.ts';
import { cborETag, etagToText, jsonETag, parseETags, sameETag, sameETags, type ETag } from '../etags.ts';
import { isHashAlgorithm, type HashAlgorithm } from '../crypto/hash.ts';
import { effectiveContent }          from './effective.ts';
import { duplicateIdentification }   from './identifications.ts';
import { effectiveTreeETag }         from './tree.ts';
import { POIPublicKey }              from '../keys.ts';
import { KeyStatement }              from '../proofs/keyStatement.ts';
import { SigningKeyCertificate }     from '../proofs/signingKeyCertificate.ts';
import { POIError }                  from '../errors.ts';


export const ROAMING_NETWORK_CONTEXT = CONTEXT_PREFIX + 'roamingNetwork/v1';


/** The holders of keys: keys naming no holder have one holder together (4.1). */
export const holdersOf = (keys: readonly POIPublicKey[]): Set<string> =>
    new Set(keys.map(key => key.holderOrUnnamed));


/**
 * The roaming network operator a roaming network embeds as `operator` (SPECIFICATION.md sections 4.1 and 8.6): its
 * identity keys, its quorum, the key statement and the certificates of its signing keys. It names no `signingKeys`.
 */
export class RoamingNetworkOperator {

    private constructor(
        public readonly id:                      string,
        public readonly identityKeys:            readonly POIPublicKey[],
        public readonly minConsensus:            number,
        public readonly keyStatement:            KeyStatement | undefined,
        public readonly signingKeyCertificates:  readonly SigningKeyCertificate[],
        public readonly json:                    JSONObject
    ) {}

    /** The signing keys its certificates certify. */
    public get signingKeys(): POIPublicKey[] {
        const keys = new Map<string, POIPublicKey>();
        for (const certificate of this.signingKeyCertificates)
            keys.set(certificate.signingKey.id, certificate.signingKey);
        return [ ...keys.values() ];
    }


    /**
     * Reads the roaming network operator of the given roaming network and refuses it as a version is refused (4.1, 8.6):
     * `signingKeys` of its own; a `minConsensus` of no more than half of the holders of its identity keys or of its
     * signing keys; a key statement naming another roaming network or operator, identity keys it does not name, another
     * `minConsensus`, or not signed by identity keys of `minConsensus` holders valid at `signedAt`; a certificate of
     * another operator or not signed by an identity key of the holder of its signing key, valid at `signedAt`; a signing key
     * certified twice in different forms. The validity of the statement in time is not checked here.
     */
    public static parse(value: JSONValue | undefined, roamingNetworkId: string): RoamingNetworkOperator {

        const json = requireObject(value, 'The roaming network operator');
        const id   = requireString(json, '@id', 'The identification of the roaming network operator');

        checkContext(json, CONTEXT_PREFIX + 'roamingNetwork/operator/v1', `the roaming network operator '${id}'`);

        if (get(json, 'signingKeys') !== undefined)
            throw new POIError('The signing keys of a roaming network operator are those of its signingKeyCertificates!');

        const identityKeys  = POIPublicKey.parseAll(get(json, 'identityKeys'), `identity keys of the roaming network operator '${id}'`);
        const minConsensus  = get(json, 'minConsensus') === undefined ? 1 : requireInteger(json, 'minConsensus', 1, 255, `The minConsensus of the roaming network operator '${id}'`);
        const keyStatement  = get(json, 'keyStatement') === undefined ? undefined : KeyStatement.parse(get(json, 'keyStatement'));

        const certificatesJSON = get(json, 'signingKeyCertificates');
        const certificates     = certificatesJSON === undefined
                                     ? []
                                     : ((): SigningKeyCertificate[] => {
                                           if (!isArray(certificatesJSON) || certificatesJSON.length === 0)
                                               throw new POIError('The signingKeyCertificates of a roaming network operator must be a nonempty array!');
                                           return certificatesJSON.map(certificate => SigningKeyCertificate.parse(certificate));
                                       })();

        // A signing key certified twice is one key; in different forms, e.g. other usages, it is refused.
        const certified = new Map<string, POIPublicKey>();

        for (const certificate of certificates) {
            const before = certified.get(certificate.signingKey.id);
            if (before !== undefined && !sameValue(without(before.json, '@context'), without(certificate.signingKey.json, '@context')))
                throw new POIError(`The signing key '${certificate.signingKey.id}' of the roaming network operator '${id}' is certified twice in different forms!`);
            certified.set(certificate.signingKey.id, certificate.signingKey);
        }

        const signingKeys = [ ...certified.values() ];

        const both = signingKeys.find(key => identityKeys.some(identityKey => identityKey.id === key.id));
        if (both !== undefined)
            throw new POIError(`The key '${both.id}' of the roaming network operator '${id}' is both a signing key and an identity key!`);

        for (const [kind, keys] of [ [ 'signing', signingKeys ], [ 'identity', identityKeys ] ] as const) {

            const holders = holdersOf(keys).size;

            if (holders === 0) {
                if (minConsensus > 1)
                    throw new POIError(`The minConsensus ${minConsensus} of the roaming network operator '${id}' needs ${kind} keys of as many holders!`);
                continue;
            }

            if (minConsensus > holders)
                throw new POIError(`The minConsensus ${minConsensus} of the roaming network operator '${id}' needs ${kind} keys of as many holders, not of ${holders}!`);

            if (2 * minConsensus <= holders)
                throw new POIError(`The minConsensus ${minConsensus} of the roaming network operator '${id}' must be more than half of the ${holders} holders of its ${kind} keys!`);

        }

        for (const certificate of certificates) {

            if (certificate.roamingNetworkOperatorId !== id)
                throw new POIError(`The certificate of the signing key '${certificate.signingKey.id}' of the roaming network operator '${id}' is one of '${certificate.roamingNetworkOperatorId}'!`);

            try {
                certificate.verify(identityKeys);
            }
            catch (e) {
                throw new POIError(`The roaming network operator '${id}': ${e instanceof Error ? e.message : String(e)}`);
            }

        }

        if (keyStatement !== undefined) {

            if (keyStatement.roamingNetworkId !== roamingNetworkId)
                throw new POIError(`The key statement of the roaming network operator '${id}' is one of the roaming network '${keyStatement.roamingNetworkId}', not of '${roamingNetworkId}'!`);

            if (keyStatement.roamingNetworkOperatorId !== id)
                throw new POIError(`The key statement of the roaming network operator '${id}' is one of '${keyStatement.roamingNetworkOperatorId}'!`);

            const unknown = keyStatement.identityKeys.find(key => !identityKeys.some(identityKey => sameValue(without(identityKey.json, '@context'), without(key.json, '@context'))));
            if (unknown !== undefined)
                throw new POIError(`The key statement of the roaming network operator '${id}' names the identity key '${unknown.id}', which is not one of its identity keys!`);

            if (keyStatement.minConsensus !== minConsensus)
                throw new POIError(`The key statement of the roaming network operator '${id}' states the minConsensus ${keyStatement.minConsensus}, not its ${minConsensus}!`);

            // Signed by as many holders of its identity keys as its quorum needs, as the operator names their holders.
            try {
                const holders = new Map<string, string[]>();
                for (const key of identityKeys)
                    holders.set(key.holderOrUnnamed, [ ...(holders.get(key.holderOrUnnamed) ?? []), key.id ]);
                keyStatement.verifyHolders([ ...holders.values() ], identityKeys, { minConsensus });
            }
            catch (e) {
                throw new POIError(minConsensus > 1
                                       ? `The key statement of the roaming network operator '${id}' is not signed by identity keys of ${minConsensus} of its holders: ${e instanceof Error ? e.message : String(e)}`
                                       : `The key statement of the roaming network operator '${id}' is not signed by one of its identity keys: ${e instanceof Error ? e.message : String(e)}`);
            }

        }

        return new RoamingNetworkOperator(id, identityKeys, minConsensus, keyStatement, certificates, json);

    }

}


/**
 * A version of a roaming network (SPECIFICATION.md sections 2 and 3): its content and its ETags.
 */
export class RoamingNetwork {

    private effectiveCache: JSONObject | undefined;
    private readonly treeETags = new Map<HashAlgorithm, ETag>();

    private constructor(
        public readonly id:                  string,
        /** The content: the representation without its `eTags`, with its `@context` (section 2). */
        public readonly content:             JSONObject,
        public readonly operator:            RoamingNetworkOperator | undefined,
        public readonly treeHashAlgorithms:  readonly HashAlgorithm[]
    ) {}


    /**
     * Reads a roaming network and refuses it unless it is a valid version: of its `@context`, with `eTags` that are those
     * of its content, where it lists any, without keys of its own, with a valid roaming network operator, and naming no
     * identification twice that WWCP_POI keeps unique within the roaming network (`duplicateIdentification`), also the
     * version a change set leads to. Its `eTags` may be left out: what binds a version is the commit whose ETags it has
     * (`matchesCommitETags`).
     */
    public static parse(value: JSONValue | undefined): RoamingNetwork {

        const json = requireObject(value, 'A roaming network');
        const id   = requireString(json, '@id', 'The identification of a roaming network');

        checkContext(json, ROAMING_NETWORK_CONTEXT, `the roaming network '${id}'`);

        if (get(json, 'signingKeys') !== undefined || get(json, 'identityKeys') !== undefined)
            throw new POIError(`The roaming network '${id}' names no keys of its own: those of its operator are its operator's!`);

        const content = without(json, 'eTags');
        set(content, '@context', ROAMING_NETWORK_CONTEXT);

        let treeHashAlgorithms: HashAlgorithm[] = [ 'sha256' ];
        const treeHashAlgorithmsJSON = get(json, 'treeHashAlgorithms');

        if (treeHashAlgorithmsJSON !== undefined) {
            if (!isArray(treeHashAlgorithmsJSON) || treeHashAlgorithmsJSON.length === 0 ||
                !treeHashAlgorithmsJSON.every(isHashAlgorithm) || new Set(treeHashAlgorithmsJSON).size !== treeHashAlgorithmsJSON.length)
                throw new POIError(`The treeHashAlgorithms of the roaming network '${id}' are at least one of sha256, sha384 and sha512, none twice!`);
            treeHashAlgorithms = treeHashAlgorithmsJSON;
        }

        const operatorJSON = get(json, 'operator');
        const operator     = operatorJSON === undefined ? undefined : RoamingNetworkOperator.parse(operatorJSON, id);

        const duplicate    = duplicateIdentification(content);

        if (duplicate !== undefined)
            throw new POIError(duplicate);

        const network      = new RoamingNetwork(id, content, operator, treeHashAlgorithms);

        const eTagsJSON = get(json, 'eTags');

        if (eTagsJSON !== undefined) {

            const given     = parseETags(eTagsJSON, false, `The eTags of the roaming network '${id}'`);
            const expected  = network.eTags();

            if (given.length !== expected.length)
                throw new POIError(`The ETags of the roaming network '${id}' do not match its content: it lists ${given.length}, not ${expected.length}!`);

            given.forEach((eTag, index) => {
                const other = expected[index];
                if (other === undefined || !sameETag(eTag, other))
                    throw new POIError(`The ETags of the roaming network '${id}' do not match its content: the ${eTag.format} ETag (${eTag.algorithm}) differs!`);
            });

        }

        return network;

    }


    /** The effective content (8.1), calculated once. */
    public get effectiveContent(): JSONObject {
        return this.effectiveCache ??= effectiveContent(this.content);
    }

    /** The `effectiveTree` ETag of the given hash algorithm (8.2). */
    public effectiveTreeETag(algorithm: HashAlgorithm): ETag {

        let eTag = this.treeETags.get(algorithm);

        if (eTag === undefined) {
            eTag = effectiveTreeETag(this.effectiveContent, algorithm);
            this.treeETags.set(algorithm, eTag);
        }

        return eTag;

    }

    /** Its ETags in their order: `json`, `cbor`, then the `effectiveTree` ETags of its tree hash algorithms (3.1). */
    public eTags(): ETag[] {
        return [ jsonETag(this.content), cborETag(this.content), ...this.treeHashAlgorithms.map(algorithm => this.effectiveTreeETag(algorithm)) ];
    }

    /** The `json` and `cbor` ETags a change set names as its `beforeETags` (4). */
    public changeSetETags(): ETag[] {
        return [ jsonETag(this.content), cborETag(this.content) ];
    }

    /** Whether the ETags of a commit are those of this version, every one of them, in their order (5.1, 8.3). */
    public matchesCommitETags(eTags: readonly ETag[]): boolean {
        return sameETags(eTags, this.eTags());
    }

    /** The ETags as text, for messages. */
    public eTagsText(): string {
        return this.eTags().map(etagToText).join(', ');
    }

    public get name(): JSONValue | undefined {
        return get(this.content, 'name');
    }

    public get description(): JSONValue | undefined {
        return get(this.content, 'description');
    }

    /** The charging station operators of the content. */
    public chargingStationOperators(): JSONObject[] {
        const operators = get(this.content, 'chargingStationOperators');
        return isArray(operators) ? operators.filter(isObject) : [];
    }

    /** A charging station operator by its identification, compared as written. */
    public chargingStationOperator(id: string): JSONObject | undefined {
        return this.chargingStationOperators().find(operator => operator['@id'] === id);
    }

}
