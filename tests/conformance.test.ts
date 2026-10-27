import { describe, expect, it } from 'vitest';

import {
    applies, canonical, deviates, encodings, histories, history, historyDocument, patched, refusals, runDocument, runText,
    specification, trust, type AnchoredSnapshotCase, type DocumentStep, type RefusalVector, type ReplayStep,
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
import { History, type SnapshotOptions }    from '../src/history/history.ts';
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

            replay(vector.steps, step => runDocument(step.file ?? ''));

        });

});


/**
 * How a replay takes what it replays, as its `commitAndCheckpointSignatures: "unchecked"` says: its content checked, its
 * snapshot unanchored and its signatures taken as they are. Who may sign is the verifier's business, not the replay's.
 */
const UNCHECKED: SnapshotOptions = { unanchored: true, verifyCommit: () => undefined, verifyCheckpoint: () => undefined };

/**
 * Takes one step of a replay, its document given by `documentOf`, and returns the history after it: throws where the
 * history refuses it, or where the head is not the one expected.
 */
function replayStep(current: History | undefined, step: ReplayStep, documentOf: (step: DocumentStep) => JSONValue): History {

    const now = (): History => {
        if (current === undefined)
            throw new Error('A replay starts with a snapshot!');
        return current;
    };

    switch (step.op) {

        case 'fromSnapshot':
            return History.fromSnapshot(documentOf(step), UNCHECKED);

        case 'append': {
            const commits: JSONValue = documentOf(step);
            for (const commit of isArray(commits) ? commits : [ commits ])
                now().append(commit);
            return now();
        }

        case 'takeCheckpoint':
            now().takeCheckpoint(documentOf(step));
            return now();

        case 'startNextEpoch': {
            const next = now().startNextEpoch();
            expect(next.root.commit.id).toBe(step.genesisCommitId);
            return next;
        }

        case 'expectHead':
            expect([ now().epoch.number, now().head.commit.revision, now().head.commit.id ]).toEqual([ step.epoch, step.revision, step.commitId ]);
            if (step.eTags !== undefined)
                expect(now().head.network.eTags().map(etagToText)).toEqual(step.eTags);
            return now();

    }

}

/** Takes the steps of a replay one after the other: the history after the last one. */
const replay = (steps: readonly ReplayStep[], documentOf: (step: DocumentStep) => JSONValue): History | undefined =>
    steps.reduce<History | undefined>((current, step) => replayStep(current, step, documentOf), undefined);


describe('Golden vectors: histories WWCPPOIConformanceTests signed, what they take and refuse', () => {

    for (const vector of histories.replays.filter(applies))
        it(`${vector.id} (${vector.expected}): ${vector.description}`, () => {

            // The replay checks the content; who may sign commits and checkpoints is the verifier's business, not its.
            expect(vector.commitAndCheckpointSignatures).toBe('unchecked');

            const documentOf = (step: DocumentStep): JSONValue => historyDocument(vector.history, step.document);

            if (vector.expected === 'accepted') {
                replay(vector.steps, documentOf);
                return;
            }

            const before  = vector.steps.slice(0, -1);
            const last    = vector.steps.at(-1);

            if (last === undefined || vector.control === undefined)
                throw new Error(`The refusal ${vector.id} names no step to refuse, or no control`);

            // The control: in place of the refused document, the one refused but for what the replay is about is taken.
            replay([ ...before, { ...last, document: vector.control } as ReplayStep ], documentOf);

            const current = replay(before, documentOf);

            // Refused for what the vector is about, where it names it; a known deviation pinned: once it is refused, the
            // marker goes in WWCPPOIConformanceTests.
            if (deviates(vector))
                replayStep(current, last, documentOf);
            else if (vector.reason === undefined)
                expect(() => replayStep(current, last, documentOf)).toThrow();
            else
                expect(() => replayStep(current, last, documentOf)).toThrow(vector.reason);

        });

});


describe('Golden vectors: snapshots of another server, a history started from them only anchored in the trust anchor', () => {

    for (const vector of histories.anchoredSnapshots.filter(applies))
        it(`${vector.id} (${vector.expected}): ${vector.description}`, () => {

            // What anchors the history is checked against the trust anchor; the other signatures are the verifier's business.
            expect(vector.commitAndCheckpointSignatures).toBe('unchecked');
            expect([ 'head', 'checkpoint' ]).toContain(vector.snapshot);

            // As a server or client starts from another server (10.5): from a snapshot of the head with the attestations it
            // carries, or of a checkpoint with its signatures, at the time given.
            const start = (snapshot: AnchoredSnapshotCase): History =>
                History.fromSnapshot(historyDocument(vector.history, snapshot.document),
                                     { trustAnchor: TrustAnchor.fromJSON(parseJSON(snapshot.trustAnchor)), at: snapshot.at, verifyCommit: () => undefined, verifyCheckpoint: () => undefined });

            if (vector.expected === 'accepted') {
                start(vector);
                return;
            }

            if (vector.control === undefined)
                throw new Error(`The refusal ${vector.id} names no control`);

            // The control: the snapshot, the trust anchor and the time, what the vector is about given otherwise, taken.
            start(vector.control);

            if (deviates(vector))
                start(vector);
            else if (vector.reason === undefined)
                expect(() => start(vector)).toThrow();
            else
                expect(() => start(vector)).toThrow(vector.reason);

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

            // Refused for what the vector is about, where it names it.
            if (deviates(vector))
                check(vector, document);
            else if (vector.reason === undefined)
                expect(() => { check(vector, document); }).toThrow();
            else
                expect(() => { check(vector, document); }).toThrow(vector.reason);

        });

});
