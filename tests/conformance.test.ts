import { describe, expect, it } from 'vitest';

import {
    applies, canonical, deviates, encodings, history, patched, refusals, runDocument, runText, specification, trust,
    type RefusalVector,
} from './conformance.ts';

import { parseJSON, parseJSONObject }       from '../src/json/parse.ts';
import { canonicalJSON, canonicalJSONBytes } from '../src/json/canonical.ts';
import { isArray, type JSONValue }          from '../src/json/value.ts';
import { deterministicCbor }                from '../src/encoding/cbor.ts';
import { fromBase45, fromBase64, fromHex, toBase45, toHex } from '../src/encoding/text.ts';
import { hash, type HashAlgorithm }         from '../src/crypto/hash.ts';
import { verifySignature }                  from '../src/crypto/signature.ts';
import { POIPublicKey }                     from '../src/keys.ts';
import { etagToText }                       from '../src/etags.ts';
import { RoamingNetwork }                   from '../src/network/roamingNetwork.ts';
import { Commit }                           from '../src/history/commit.ts';
import { Checkpoint, CheckpointProof }      from '../src/history/checkpoint.ts';
import { History }                          from '../src/history/history.ts';
import { PriceStatement }                   from '../src/proofs/priceStatement.ts';
import { TrustAnchor }                      from '../src/proofs/trustAnchor.ts';
import { ChargingStationProof }             from '../src/proofs/stationProof.ts';
import { verifyChargingStation }            from '../src/verifier/chargingStation.ts';


// The golden vectors of WWCPPOIConformanceTests (tests/conformance.ts says where they come from): what this library and
// the C# implementation both must calculate, take and refuse.

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);


describe('Golden vectors: canonical JSON, deterministic CBOR and encodings', () => {

    for (const vector of canonical.vectors.filter(applies))
        it(`${vector.id}: ${vector.description}`, () => {
            const value = parseJSON(vector.input);
            expect(canonicalJSON(value)).toBe(vector.expected.canonical);
            if (vector.expected.cborHex !== undefined)
                expect(toHex(deterministicCbor(value))).toBe(vector.expected.cborHex);
        });

    for (const vector of canonical.invalidInputs.filter(applies))
        it(`${vector.id} (${vector.expectedError}): ${vector.description}`, () => {
            if (deviates(vector))
                expect(() => parseJSON(vector.input)).not.toThrow();
            else
                expect(() => parseJSON(vector.input)).toThrow();
        });

    for (const vector of encodings.base64)
        it(`${vector.id}: ${vector.description}`, () => { expect(toHex(fromBase64(vector.text))).toBe(vector.hex); });

    for (const vector of encodings.base64Invalid)
        it(`${vector.id}: ${vector.description}`, () => { expect(() => fromBase64(vector.text)).toThrow(); });

    for (const vector of encodings.base45)
        it(`${vector.id}: ${vector.description}`, () => {
            expect(toHex(fromBase45(vector.text))).toBe(vector.hex);
            expect(toBase45(fromHex(vector.hex))).toBe(vector.text);
        });

    for (const vector of encodings.base45Invalid)
        it(`${vector.id}: ${vector.description}`, () => { expect(() => fromBase45(vector.text)).toThrow(); });

});


describe('Golden vectors: the examples of SPECIFICATION.md, section 6', () => {

    const keyOf = (vector: { coseKey: string, keyId: string }): POIPublicKey => POIPublicKey.parse({ '@id': vector.keyId, key: vector.coseKey });

    for (const vector of specification.contents)
        it(`${vector.id}: ${vector.description}`, () => {
            const content = parseJSONObject(vector.content);
            expect(canonicalJSON(content)).toBe(vector.content);
            expect(RoamingNetwork.parse(content).eTags().map(etagToText)).toEqual(vector.eTags);
        });

    for (const vector of specification.skeletons)
        it(`${vector.id}: ${vector.description}`, () => {
            const skeleton = parseJSONObject(vector.skeleton);
            expect(canonicalJSON(skeleton)).toBe(vector.skeleton);
            expect(toHex(hash(vector.hashAlgorithm as HashAlgorithm, Uint8Array.of(0x00, ...canonicalJSONBytes(skeleton))))).toBe(vector.digest);
        });

    for (const vector of specification.commits)
        it(`${vector.id}: ${vector.description}`, () => {
            const commit = Commit.parse(parseJSON(JSON.stringify(vector.commit)));
            expect(commit.id).toBe(vector.commitId);
            expect(commit.identificationHash).toBe(vector.hashAlgorithm);
            expect(canonicalJSON(commit.identificationContent())).toBe(vector.content);
        });

    for (const vector of specification.keys)
        it(`${vector.id}: ${vector.description}`, () => {
            expect(keyOf(vector).id).toBe(vector.keyId);
            expect(() => POIPublicKey.parse({ '@id': '0'.repeat(64), key: vector.coseKey })).toThrow();
        });

    for (const vector of specification.signatures)
        it(`${vector.id}: ${vector.description}`, () => {
            expect(canonicalJSON(parseJSONObject(vector.input))).toBe(vector.input);
            verifySignature(vector.algorithm, keyOf(vector).key, utf8(vector.input), vector.value);
        });

    for (const vector of specification.invalidSignatures)
        it(`${vector.id}: ${vector.description}`, () => {
            expect(() => { verifySignature(vector.algorithm, keyOf(vector).key, utf8(vector.input), vector.value); }).toThrow();
        });

    for (const vector of specification.priceStatements)
        it(`${vector.id}: ${vector.description}`, () => {
            expect(PriceStatement.parse(parseJSON(vector.statement)).digestHex()).toBe(vector.digest);
        });

    for (const vector of specification.trustAnchors)
        it(`${vector.id}: ${vector.description}`, () => {
            const anchor = TrustAnchor.parse(vector.qrCode);
            expect([ anchor.id, anchor.urls, anchor.keys, anchor.minConsensus ]).toEqual([ vector.roamingNetworkId, vector.urls, vector.keys, vector.minConsensus ]);
            expect(canonicalJSON(anchor.toJSON())).toBe(canonicalJSON(parseJSON(vector.json)));
            expect(anchor.toQRCode()).toBe(vector.qrCode);
            expect(TrustAnchor.fromJSON(parseJSON(vector.json)).toQRCode()).toBe(vector.qrCode);
        });

});


describe('Golden vectors: station proofs of the example network against a trust anchor (8.4 to 8.6)', () => {

    for (const vector of trust.stationProofs.filter(applies))
        it(`${vector.id} (${vector.expected}): ${vector.description}`, () => {

            const proof   = parseJSONObject(vector.proof);
            const anchor  = TrustAnchor.fromJSON(parseJSON(vector.trustAnchor));
            const verify  = (): unknown => verifyChargingStation(anchor, proof, { at: vector.at, evseId: vector.evseId });

            // The root the proof leads to, whatever its attestations: also a proof refused for one of them, as one without
            // a validUntil, leads to it.
            expect(etagToText(ChargingStationProof.parse({ ...proof, attestations: [] }).calculate().eTag)).toBe(vector.root);

            if ((vector.expected === 'accepted') !== deviates(vector))
                verify();
            else
                expect(verify).toThrow();

        });

});


describe('Golden vectors: what the C# examples published, frozen', () => {

    for (const vector of history.versions.filter(applies))
        it(vector.id, () => {
            const network = RoamingNetwork.parse(runDocument(vector));
            expect(network.id).toBe(vector.roamingNetworkId);
            expect(network.eTags().map(etagToText)).toEqual(vector.eTags);
        });

    for (const vector of history.commits.filter(applies))
        it(vector.id, () => {
            const commit = Commit.parse(runDocument(vector));
            expect([ commit.id, commit.roamingNetworkId, commit.epoch, commit.revision, commit.identificationHash ])
                .toEqual([ vector.commitId, vector.roamingNetworkId, vector.epoch, vector.revision, vector.hashAlgorithm ]);
            expect(commit.eTags.map(etagToText)).toEqual(vector.eTags);
        });

    for (const vector of history.checkpoints.filter(applies))
        it(vector.id, () => {
            const checkpoint = Checkpoint.parse(runDocument(vector));
            expect([ checkpoint.id, checkpoint.roamingNetworkId, checkpoint.epoch, checkpoint.sequence, checkpoint.revision, checkpoint.commitId, checkpoint.isFinal ])
                .toEqual([ vector.checkpointId, vector.roamingNetworkId, vector.epoch, vector.sequence, vector.revision, vector.commitId, vector.final ]);
        });

    for (const vector of history.checkpointProofs.filter(applies))
        it(vector.id, () => {
            const proof = CheckpointProof.parse(runDocument(vector));
            expect([ proof.checkpointId, proof.commitId ]).toEqual([ vector.checkpointId, vector.commitId ]);
            proof.verify(Checkpoint.parse(runDocument(vector.checkpoint)));
        });

    for (const vector of history.priceStatements.filter(applies))
        it(vector.id, () => {
            const statement = PriceStatement.parse(runDocument(vector));
            expect([ statement.sequence, statement.digestHex(), statement.previous ]).toEqual([ vector.sequence, vector.digest, vector.previous ]);
        });

    for (const vector of history.trustAnchors.filter(applies))
        it(vector.id, () => {
            const text   = runText(vector.file).trim();
            const anchor = TrustAnchor.parse(text);
            expect([ anchor.id, anchor.urls, anchor.keys, anchor.minConsensus ]).toEqual([ vector.roamingNetworkId, vector.urls, vector.keys, vector.minConsensus ]);
            expect(canonicalJSON(anchor.toJSON())).toBe(vector.json);
            expect(anchor.toQRCode()).toBe(text);
        });

    for (const vector of history.stationProofs.filter(applies))
        it(vector.id, () => {

            const proof   = ChargingStationProof.parse(runDocument(vector));
            const anchor  = TrustAnchor.parse(runText(vector.trustAnchor));

            expect([ etagToText(proof.calculate().eTag), proof.commitId, proof.revision ]).toEqual([ vector.root, vector.commitId, vector.revision ]);

            proof.verify(anchor, vector.at);

            for (const station of vector.chargingStations)
                for (const evseId of station.evseIds) {
                    const verified = verifyChargingStation(anchor, proof, { at: vector.at, evseId });
                    if (station.chargingStationId !== null)
                        expect(verified.chargingStation['@id']).toBe(station.chargingStationId);
                }

        });

    for (const vector of history.replays.filter(applies))
        it(`${vector.id}: ${vector.description}`, () => {

            // The replay checks the content; who may sign commits and checkpoints is the verifier's business, not its.
            expect(vector.commitAndCheckpointSignatures).toBe('unchecked');

            let current: History | undefined;

            const now = (): History => {
                if (current === undefined)
                    throw new Error('A replay starts with a snapshot!');
                return current;
            };

            for (const replayStep of vector.steps) {
                switch (replayStep.op) {

                    case 'fromSnapshot':
                        current = History.fromSnapshot(runDocument(replayStep.file));
                        break;

                    case 'append': {
                        const commits: JSONValue = runDocument(replayStep.file);
                        for (const commit of isArray(commits) ? commits : [ commits ])
                            now().append(commit);
                        break;
                    }

                    case 'takeCheckpoint':
                        now().takeCheckpoint(runDocument(replayStep.file));
                        break;

                    case 'startNextEpoch':
                        current = now().startNextEpoch();
                        expect(current.root.commit.id).toBe(replayStep.genesisCommitId);
                        break;

                    case 'expectHead':
                        expect([ now().epoch.number, now().head.commit.revision, now().head.commit.id ]).toEqual([ replayStep.epoch, replayStep.revision, replayStep.commitId ]);
                        if (replayStep.eTags !== undefined)
                            expect(now().head.network.eTags().map(etagToText)).toEqual(replayStep.eTags);
                        break;

                }
            }

        });

});


describe('Golden vectors: what must be refused', () => {

    /** What a vector of its kind checks of the given document: throws when it is refused. */
    function check(vector: RefusalVector, document: JSONValue | undefined): void {

        const need = <T>(value: T | undefined, what: string): T => {
            if (value === undefined)
                throw new Error(`The vector ${vector.id} names no ${what}!`);
            return value;
        };

        switch (vector.kind) {

            case 'commit':           Commit.parse(document);          return;
            case 'checkpoint':       Checkpoint.parse(document);      return;
            case 'version':          RoamingNetwork.parse(document);  return;
            case 'trustAnchor':      TrustAnchor.parse(need(vector.text, 'text')); return;

            case 'checkpointProof':
                CheckpointProof.parse(document).verify(Checkpoint.parse(runDocument(need(vector.checkpoint, 'checkpoint'))));
                return;

            case 'stationProof':
                ChargingStationProof.parse(document).verify(TrustAnchor.parse(runText(need(vector.trustAnchor, 'trust anchor'))), need(vector.at, 'time'));
                return;

            case 'priceStatement': {
                const statement = PriceStatement.parse(document);
                const network   = RoamingNetwork.parse(runDocument(need(vector.keysFrom, 'version with the keys')));
                const operator  = need(network.chargingStationOperator(statement.signer), `charging station operator '${statement.signer}'`);
                statement.verify(network.id, statement.signer, POIPublicKey.parseAll(operator['signingKeys'], 'signing keys'));
                return;
            }

        }

    }

    for (const vector of refusals.vectors.filter(applies))
        it(`${vector.id} (${vector.kind}): ${vector.description}`, () => {

            const document = vector.document === undefined ? undefined : patched(vector.document);

            // The control: the document as published passes the same check, so the refusal is the patch's doing.
            if (vector.document !== undefined && vector.document.patch.length > 0)
                check(vector, runDocument(vector.document));

            if (deviates(vector))
                check(vector, document);
            else
                expect(() => { check(vector, document); }).toThrow();

        });

});
