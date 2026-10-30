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

import { checkContext, mandatoryText, requireInteger, requireObject, CONTEXT_PREFIX } from '../common.ts';
import { asText, get, isArray, isObject, sameValue, set, without, type JSONObject, type JSONValue } from '../json/value.ts';
import { cborETag, etagToText, jsonETag, parseETags, sameETag, sameETags, type ETag } from '../etags.ts';
import { isHashAlgorithm, type HashAlgorithm } from '../crypto/hash.ts';
import { effectiveContent }          from './effective.ts';
import { duplicateIdentification, ignoringCase, inRoamingNetwork, invalidIdentification } from './identifications.ts';
import { invalidVersionText, trimmed } from './versionTexts.ts';
import { invalidCertificates }       from './certificates.ts';
import { invalidEVTaler }            from './evTaler.ts';
import { invalidPartyKeys, partyKeysOf } from './partyKeys.ts';
import { asRead, notWrittenAsHeld }  from './writtenForm.ts';
import { effectiveTreeETag }         from './tree.ts';
import type { POIPublicKey }         from '../keys.ts';
import { KeyStatement }              from '../proofs/keyStatement.ts';
import { SigningKeyCertificate }     from '../proofs/signingKeyCertificate.ts';
import { POIError }                  from '../errors.ts';


export const ROAMING_NETWORK_CONTEXT = CONTEXT_PREFIX + 'roamingNetwork/v1';


/**
 * What the roaming network refuses of its operator as it is made of it, not as the operator is read (`KeyStatementError`
 * of WWCP_POI3): the key statement and the certificates of its signing keys. Of a version, WWCP_POI3 names it as an
 * argument of the `Operator` of its constructor; after the last change of a change set, bare.
 */
class KeyStatementError extends POIError {}


/** Whether two identifications of a roaming network or an operator are one, as their types read and compare them. */
const sameId = (left: string, right: string): boolean =>
    ignoringCase(trimmed(left)) === ignoringCase(trimmed(right));


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
        const id   = mandatoryText(json, '@id', 'The identification of the roaming network operator');

        checkContext(json, CONTEXT_PREFIX + 'roamingNetwork/operator/v1', `the roaming network operator '${id}'`);

        if (get(json, 'signingKeys') !== undefined)
            throw new POIError('The signing keys of a roaming network operator are those of its signingKeyCertificates!');

        const identityKeys  = partyKeysOf(json, `the roaming network operator '${id}'`, 'a roaming network operator').identityKeys;
        const minConsensus  = get(json, 'minConsensus') === undefined ? 1 : requireInteger(json, 'minConsensus', 1, 255, 'The minConsensus of a roaming network operator');
        // As WWCP_POI3 reads them, without what it does not read, which the written form of the content refuses.
        const keyStatement  = get(json, 'keyStatement') === undefined ? undefined : KeyStatement.parse(asRead(requireObject(get(json, 'keyStatement'), 'The key statement'), 'keyStatement'));

        const certificatesJSON = get(json, 'signingKeyCertificates');
        const certificates     = certificatesJSON === undefined
                                     ? []
                                     : ((): SigningKeyCertificate[] => {
                                           if (!isArray(certificatesJSON) || certificatesJSON.length === 0)
                                               throw new POIError('The signingKeyCertificates of a roaming network operator must be a nonempty array!');
                                           return certificatesJSON.map(certificate => SigningKeyCertificate.parse(asRead(certificate, 'signingKeyCertificates')));
                                       })();

        // What the constructor of the operator refuses, as its TryParse names it (RoamingNetworkOperator of WWCP_POI3): a
        // certificate by the same identity key given twice; a signing key certified twice is one key, in different forms,
        // e.g. other usages, it is two; a key both a signing and an identity key; a quorum its keys do not have.
        const invalid = (error: string): POIError =>
            new POIError(`The given JSON representation of a roaming network operator is invalid: ${error}`);

        const certifications = certificates.map(certificate => `${certificate.signingKey.id}/${certificate.keyId}`);

        if (new Set(certifications).size !== certifications.length)
            throw invalid(`An certificate of a signing key of the roaming network operator '${id}' must not be given twice!`);

        const certified = new Map<string, POIPublicKey>();

        for (const certificate of certificates) {
            const before = certified.get(certificate.signingKey.id);
            if (before !== undefined && !sameValue(without(before.json, '@context'), without(asRead(certificate.signingKey.json, 'signingKey') as JSONObject, '@context')))
                throw invalid(`An signing key of the roaming network operator '${id}' must not be given twice!`);
            certified.set(certificate.signingKey.id, certificate.signingKey);
        }

        const signingKeys = [ ...certified.values() ];

        const both = [ ...signingKeys ].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).find(key => identityKeys.some(identityKey => identityKey.id === key.id));
        if (both !== undefined)
            throw invalid(`The key '${both.id}' of the roaming network operator '${id}' must not be both a signing and an identity key!`);

        for (const [kind, keys] of [ [ 'signing', signingKeys ], [ 'identity', identityKeys ] ] as const) {

            const holders = holdersOf(keys).size;

            if (holders === 0) {
                if (minConsensus > 1)
                    throw invalid(`The minConsensus ${minConsensus} of the roaming network operator '${id}' needs ${kind} keys of as many holders!`);
                continue;
            }

            if (minConsensus > holders)
                throw invalid(`The minConsensus ${minConsensus} of the roaming network operator '${id}' needs ${kind} keys of as many holders, not of ${holders}!`);

            if (2 * minConsensus <= holders)
                throw invalid(`The minConsensus ${minConsensus} of the roaming network operator '${id}' must be more than half of the ${holders} holders of its ${kind} keys!`);

        }

        // What the roaming network refuses of its operator as it is made of it (KeyStatementError of WWCP_POI3), in its order:
        // a key statement of another roaming network, then the certificates, then the rest of the key statement.
        // The identifications of a roaming network and of its operator compared as their types read and compare them: trimmed,
        // without case.
        if (keyStatement !== undefined && !sameId(keyStatement.roamingNetworkId, roamingNetworkId))
            throw new KeyStatementError(`The key statement of the roaming network operator '${id}' is one of the roaming network '${keyStatement.roamingNetworkId}', not of '${roamingNetworkId}'!`);

        for (const certificate of certificates) {

            if (!sameId(certificate.roamingNetworkOperatorId, id))
                throw new KeyStatementError(`The certificate of the signing key '${certificate.signingKey.id}' of the roaming network operator '${id}' is one of '${certificate.roamingNetworkOperatorId}'!`);

            try {
                certificate.verify(identityKeys);
            }
            catch (e) {
                throw new KeyStatementError(`The roaming network operator '${id}': ${e instanceof Error ? e.message : String(e)}`);
            }

        }

        if (keyStatement !== undefined) {

            if (!sameId(keyStatement.roamingNetworkOperatorId, id))
                throw new KeyStatementError(`The key statement of the roaming network operator '${id}' is one of '${keyStatement.roamingNetworkOperatorId}'!`);

            const unknown = keyStatement.identityKeys.find(key => !identityKeys.some(identityKey => sameValue(without(asRead(identityKey.json, 'identityKeys') as JSONObject, '@context'), without(key.json, '@context'))));
            if (unknown !== undefined)
                throw new KeyStatementError(`The key statement of the roaming network operator '${id}' names the identity key '${unknown.id}', which is not one of its identity keys!`);

            if (keyStatement.minConsensus !== minConsensus)
                throw new KeyStatementError(`The key statement of the roaming network operator '${id}' states the minConsensus ${keyStatement.minConsensus}, not its ${minConsensus}!`);

            // Signed by as many holders of its identity keys as its quorum needs, as the operator names their holders.
            try {
                const holders = new Map<string, string[]>();
                for (const key of identityKeys)
                    holders.set(key.holderOrUnnamed, [ ...(holders.get(key.holderOrUnnamed) ?? []), key.id ]);
                keyStatement.verifyHolders([ ...holders.values() ], identityKeys, { minConsensus });
            }
            catch (e) {
                throw new KeyStatementError(minConsensus > 1
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
     * identification twice that WWCP_POI keeps unique within the roaming network (`duplicateIdentification`), nor a hardware
     * revision, firmware version or serial number WWCP_POI refuses (`invalidVersionText`), nor a certificate WWCP_POI
     * refuses to read (`invalidCertificates`), nor an EV Taler merchant or payment options it refuses (`invalidEVTaler`),
     * nor keys of a party it refuses (`invalidPartyKeys`),
     * nor what WWCP_POI takes and writes otherwise than the content holds it (`notWrittenAsHeld`),
     * also the version a change set leads to. Its `eTags` may be left out: what binds a version is the commit whose ETags it
     * has (`matchesCommitETags`).
     */
    public static parse(value: JSONValue | undefined): RoamingNetwork {
        return RoamingNetwork.read(value, 'version');
    }

    /**
     * Reads the version the given change set leads to, its content after the last change, and refuses it as `parse`
     * does, but in the words WWCP_POI3 names what it refuses of the network there (RoamingNetwork.ChangeSets.cs): its
     * operator and the identifications it keeps unique within the roaming network bare, not as arguments of its
     * constructor.
     */
    public static afterChangeSet(content: JSONObject): RoamingNetwork {
        return RoamingNetwork.read(content, 'change set');
    }

    private static read(value: JSONValue | undefined, of: 'version' | 'change set'): RoamingNetwork {

        const json = requireObject(value, 'A roaming network');
        const id   = mandatoryText(json, '@id', 'The identification of a roaming network');

        checkContext(json, ROAMING_NETWORK_CONTEXT, `the roaming network '${id}'`);

        if (get(json, 'signingKeys') !== undefined || get(json, 'identityKeys') !== undefined)
            throw new POIError(`The roaming network '${id}' names no keys of its own: those of its operator are its operator's!`);

        const content = without(json, 'eTags');
        set(content, '@context', ROAMING_NETWORK_CONTEXT);

        let treeHashAlgorithms: HashAlgorithm[] = [ 'sha256' ];
        const treeHashAlgorithmsJSON = get(json, 'treeHashAlgorithms');

        // As POITreeHashAlgorithms of WWCP_POI3 reads them, in its words: an array of known algorithms, at least one, none twice.
        if (treeHashAlgorithmsJSON !== undefined) {
            if (!isArray(treeHashAlgorithmsJSON))
                throw new POIError("The 'treeHashAlgorithms' must be a JSON array of hash algorithms!");
            const unknown = treeHashAlgorithmsJSON.find(algorithm => !isHashAlgorithm(algorithm));
            if (unknown !== undefined)
                throw new POIError(`Unknown tree hash algorithm '${asText(unknown)}': sha256, sha384 or sha512!`);
            if (treeHashAlgorithmsJSON.length === 0)
                throw new POIError("The 'treeHashAlgorithms' must name at least one hash algorithm!");
            if (new Set(treeHashAlgorithmsJSON).size !== treeHashAlgorithmsJSON.length)
                throw new POIError("The 'treeHashAlgorithms' must not name a hash algorithm twice!");
            treeHashAlgorithms = treeHashAlgorithmsJSON as HashAlgorithm[];
        }

        const operatorJSON = get(json, 'operator');
        const operator     = operatorJSON === undefined ? undefined : ((): RoamingNetworkOperator => {
                                 try {
                                     return RoamingNetworkOperator.parse(operatorJSON, id);
                                 }
                                 catch (e) {
                                     throw e instanceof KeyStatementError && of === 'version' ? new POIError(inRoamingNetwork(e.message, 'Operator')) : e;
                                 }
                             })();

        // What WWCP_POI refuses of an entity as it reads it, then what it refuses of the network it makes of them; then what
        // it takes and writes otherwise.
        const refusal      = invalidIdentification(content) ?? invalidVersionText(content) ?? invalidCertificates(content) ??
                             invalidEVTaler(content) ?? invalidPartyKeys(content) ?? duplicateIdentification(content, of) ??
                             notWrittenAsHeld(content);

        if (refusal !== undefined)
            throw new POIError(refusal);

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
