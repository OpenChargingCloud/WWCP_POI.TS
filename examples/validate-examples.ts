/*
 * Checks what the C# examples A1 to A14 of WWCP_POI published, as their Validate() methods do, and prints what it checked.
 *
 *   npx tsx examples/validate-examples.ts                                   the run kept in tests/vectors
 *   npx tsx examples/validate-examples.ts <WWCP_POI>/examples/csharp        a run of your own, after `dotnet run` there
 *   npx tsx examples/validate-examples.ts <dir> --at 2026-10-27T17:23:00.000Z
 *
 * Every run of the C# examples makes new keys, so every digest differs from one run to the next; what is checked is the
 * same. Attestations end 15 minutes after they are signed: the station proof of example A13 is checked at the time of its
 * attestations unless `--at` names another, the evidence of example A10 at the time charging began, as the app does.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join }                     from 'node:path';

import {
    ArchiveSegment, Checkpoint, CheckpointProof, DigitalCalibrationCertificate, DigitalCertificateOfConformity,
    DigitalDeclarationOfConformity, History, OperatorTrust, POIPublicKey, PriceStatement, PriceStatementProof, QIDigitalItem,
    RoamingNetwork, RuntimeStatus, TrustAnchor, describeVersion, etagToText, get, isArray, isObject, parseArchiveSegmentInfo,
    parseEvidence, parseFrame, parseJSON, parsePriceStatements, parseStatusUpdate, parseTrustedWitnesses, toTimestamp,
    verifyChargingStation, verifyCheckpointLine, verifyCheckpointPriceStatements, verifyCheckpointSignatures, verifyEvidence,
    verifyPriceStatements, verifySegmentLine, verifyVersion,
    type HistoryOptions, type JSONArray, type JSONObject, type JSONValue, type QIDigitalI18NText, type TrustedWitness,
} from '../src/index.ts';


/** What the examples published, or a clear error where they did not. */
function defined<T>(value: T | null | undefined, what: string): T {
    if (value === undefined || value === null)
        throw new Error(`there is no ${what}`);
    return value;
}

/** A value of a document as text: a string or a number as it is, an object or an array as JSON. */
function show(value: JSONValue | undefined): string {
    return isObject(value) || isArray(value) ? JSON.stringify(value) : String(value);
}


const args       = process.argv.slice(2);
const atIndex    = args.indexOf('--at');
const at         = atIndex >= 0 ? defined(args[atIndex + 1], 'time after --at') : undefined;
const directory  = args.find((arg, index) => !arg.startsWith('--') && (atIndex < 0 || index !== atIndex + 1)) ?? join(import.meta.dirname, '..', 'tests', 'vectors', 'csharp-33447ac');
const time       = at ?? (directory.includes('csharp-33447ac') ? '2026-10-27T17:23:00.000Z' : new Date().toISOString());

const file  = (name: string): string     => join(directory, name);
const text  = (name: string): string     => readFileSync(file(name), 'utf8');
const json  = (name: string): JSONValue  => parseJSON(text(name));
const has   = (name: string): boolean    => existsSync(file(name));

/** The revisions of epoch 1 whose proofs in a checkpoint the examples published, in order: examples A4 and A5 name them. */
const proofRevisions = readdirSync(file('published')).map(name => /^QA-proof-revision-(\d+)\.json$/.exec(name)?.[1]).filter(revision => revision !== undefined).map(Number).sort((left, right) => left - right);

let failures = 0;

function step(title: string, run: () => void): void {
    console.log(`\n== ${title}`);
    try {
        run();
    }
    catch (e) {
        failures++;
        console.log(`refused: ${e instanceof Error ? e.message : String(e)}`);
    }
}

/** What must be refused, with the reason. */
function refused(what: string, run: () => unknown): void {
    try {
        run();
        failures++;
        console.log(`${what}: taken, but should be refused!`);
    }
    catch (e) {
        console.log(`${what}: ${e instanceof Error ? e.message : String(e)}`);
    }
}

console.log(`Checking ${directory}, at ${time}`);

const anchor     = TrustAnchor.parse(text('published/QA-trustAnchor.txt'));
const witnesses  = parseTrustedWitnesses(json('trusted/witnesses.json'));
const genesis    = json('published/QA-genesis.json') as JSONObject;
const first      = verifyVersion(anchor, defined(genesis['roamingNetwork'], 'roaming network in the genesis'), defined(genesis['commit'], 'commit in the genesis'), time);
const trust      = first.trust;

/** As example A4: commits signed as the roaming network operator by its quorum, checkpoints as well. */
const byOperator: HistoryOptions = {
    verifyCommit:      commit     => { trust.verifyOperatorSignatures(commit.signatures, (signature, key) => { commit.verifySignature(signature, key); }, 'the commit'); },
    verifyCheckpoint:  checkpoint => { verifyCheckpointSignatures(checkpoint, trust); },
};

/** As examples A6 and A11: a verifier following the history, its trust following the key statements the commits change. */
function following(trustAnchor: TrustAnchor, root: RoamingNetwork, trusted: readonly TrustedWitness[]): HistoryOptions & { readonly trust: OperatorTrust } {
    let current = OperatorTrust.of(trustAnchor, root, time);
    return {
        get trust(): OperatorTrust { return current; },
        verifyCommit: (commit, _before, after): void => {
            current.verifyOperatorSignatures(commit.signatures, (signature, key) => { commit.verifySignature(signature, key); }, 'the commit');
            current = current.followedBy(after, time);
        },
        verifyCheckpoint: (checkpoint): void => { verifyCheckpointSignatures(checkpoint, current, { witnesses: trusted, requiredWitnesses: trusted.length }); },
    };
}

const checkpoint = (sequence: number): Checkpoint => Checkpoint.parse(json(`published/QA-checkpoint-${sequence}.json`));
const commits    = (name: string): JSONArray  => json(name) as JSONArray;

// QA as examples A8 and A9 left it: revision 13 of epoch 1, the version of checkpoint 4.
const snapshot4  = json('published/QA-checkpoint-4-snapshot.json') as JSONObject;
const head       = verifyVersion(anchor, defined(snapshot4['roamingNetwork'], 'roaming network in the snapshot of checkpoint 4'), defined(snapshot4['commit'], 'commit in the snapshot of checkpoint 4'), time);


step('Example A1: checking QA from its trust anchor', () => {

    console.log(`The QR code: ${anchor.toQRCode().length} characters; ${anchor.keys.length} identity keys pinned, minConsensus ${anchor.minConsensus}`);
    console.log(describeVersion(first));
    for (const warning of first.warnings)
        console.log(`warning: ${warning}`);

    for (const eTag of first.network.eTags())
        console.log(`  ${etagToText(eTag)}`);

    console.log(`QA is checked: revision ${first.commit.revision}, commit ${first.commit.id}, signed by ${first.signedBy.join(' and ')}`);
    console.log(`beforeETags of the next change set: ${first.network.changeSetETags().map(etagToText).join(', ')}`);

});


step('Example A2: the charging station operator DE*GEF and the manufacturers', () => {

    const gef = head.network.chargingStationOperator('DE*GEF');

    if (gef === undefined)
        throw new Error("QA has no charging station operator 'DE*GEF'");

    if (has('DE-GEF/operator.json')) {
        const sent    = json('DE-GEF/operator.json') as JSONObject;
        const ids     = (keys: JSONValue | undefined): string => POIPublicKey.parseAll(keys, 'keys').map(key => key.id).sort().join(', ');
        if (ids(gef['signingKeys']) !== ids(sent['signingKeys']) || ids(gef['identityKeys']) !== ids(sent['identityKeys']))
            throw new Error("QA names 'DE*GEF' with other keys than it sent");
    }

    console.log('DE*GEF is a member of QA with its keys:');
    for (const key of POIPublicKey.parseAll(gef['signingKeys'], 'signing keys'))
        console.log(`  signing key  ${key.id} for ${key.usages.join(', ')}`);
    for (const key of POIPublicKey.parseAll(gef['identityKeys'], 'identity keys'))
        console.log(`  identity key ${key.id}`);

    // The manufacturers, parties of their own, with the models they stated.
    for (const [kind, property, models] of [ [ 'Charging station manufacturer', 'chargingStationManufacturers', 'chargingStationModels' ], [ 'Energy meter manufacturer    ', 'energyMeterManufacturers', 'energyMeterModels' ] ] as const)
        for (const manufacturer of (get(head.network.content, property) as JSONObject[] | undefined) ?? [])
            console.log(`${kind} ${show(manufacturer['@id'])}: ${show((manufacturer['name'] as JSONObject)['en'])}, models ` +
                        ((get(manufacturer, models) as JSONObject[] | undefined) ?? []).map(model => `${show(model['@id'])} (versions ${((model['versions'] as string[] | undefined) ?? []).join('/')})`).join(', '));

});


/** The pools of DE*GEF as they are at runtime. */
function showPools(network: RoamingNetwork, meters: boolean, ...numbers: number[]): void {

    const operator = defined((get(network.effectiveContent, 'chargingStationOperators') as JSONObject[]).find(item => item['@id'] === 'DE*GEF'), "charging station operator 'DE*GEF'");
    const pools    = ((get(operator, 'chargingPools') as JSONObject[] | undefined) ?? []).filter(pool => numbers.length === 0 || numbers.some(n => pool['@id'] === `DE*GEF*P${n}`));

    if (pools.length === 0)
        console.log(`no pool ${numbers.join(' or ')} yet`);

    for (const pool of pools) {
        console.log(`${show(pool['@id'])}  ${show((pool['name'] as JSONObject)['en'])}`);
        for (const station of get(pool, 'chargingStations') as JSONObject[]) {
            console.log(`  ${show(station['@id'])}  ${Number(station['maxPower']) / 1000} kW: ` +
                        (get(station, 'EVSEs') as JSONObject[]).map(evse => `${show(evse['@id'])} ${show((evse['currentTypes'] as string[])[0])} ${Number(evse['maxPower']) / 1000} kW`).join(', '));
            if (meters)
                for (const evse of get(station, 'EVSEs') as JSONObject[]) {
                    const meter = evse['energyMeter'] as JSONObject | undefined;
                    if (meter !== undefined)
                        console.log(`    ${show(meter['@id'])}  ${show(meter['manufacturerId'])} ${show(meter['modelId'])}, serial ${show(meter['serialNumber'])}, ` +
                                    `${((meter['signatureMethods'] as string[] | undefined) ?? []).join(', ')}, key ${show(((meter['publicKeys'] as JSONObject[] | undefined) ?? [])[0]?.['@id'] ?? '').slice(0, 8)}…`);
                }
        }
    }

}


step('Example A3: the pools of DE*GEF as they are at runtime, with their energy meters', () => {
    showPools(head.network, true, 1, 2);
});


step('Example A4: the first checkpoint, and joining from it', () => {

    const checkpoint0 = checkpoint(0);
    const signatures  = verifyCheckpointSignatures(checkpoint0, trust);
    console.log(`Checkpoint 0 of epoch ${checkpoint0.epoch}: revision ${checkpoint0.revision}, ${checkpoint0.commits.size} commit(s) since the genesis, signed by ${signatures.signedBy.join(', ')}`);

    // Joined from the snapshot of checkpoint 0, anchored in the trust anchor by the signatures of the checkpoint.
    const joined = History.fromSnapshot(json('published/QA-checkpoint-0-snapshot.json'), { ...byOperator, trustAnchor: anchor, at: time });
    console.log(`Joined at revision ${joined.head.commit.revision}, the checkpoint's: ${joined.head.commit.id === checkpoint0.commitId ? 'the same' : 'another'}`);

    for (const commit of commits('published/QA-commits-since-checkpoint-0.json')) {
        const version = joined.append(commit);
        console.log(`Appended revision ${version.commit.revision}: ${version.commit.description ?? ''}`);
    }

    const proof = CheckpointProof.parse(json(`published/QA-proof-revision-${defined(proofRevisions[0], 'proof of a revision')}.json`));
    proof.verify(checkpoint0);
    console.log(`The proof of the commit of revision ${proof.revision} in checkpoint 0: valid`);

    const changed = json('published/QA-checkpoint-0.json') as JSONObject;
    changed['revision'] = 5;
    refused('A checkpoint of another revision', () => Checkpoint.parse(changed));

    showPools(joined.head.network, false, 3, 4);

});


step('Example A5: a correction between two checkpoints', () => {

    const line: [ Checkpoint, Checkpoint, Checkpoint ] = [ checkpoint(0), checkpoint(1), checkpoint(2) ];
    verifyCheckpointLine(line);

    for (const item of line)
        console.log(`Checkpoint ${item.sequence}: revision ${item.revision}, ${item.commits.size} commit(s), signed by ${verifyCheckpointSignatures(item, trust).signedBy.join(', ')}`);

    console.log(`One line: ${line.map(item => `${item.sequence} (revision ${item.revision})`).join(' <- ')}`);

    const history = History.fromSnapshot(json('published/QA-checkpoint-0-snapshot.json'), { ...byOperator, trustAnchor: anchor, at: time });
    for (const commit of [ ...commits('published/QA-commits-since-checkpoint-0.json'), ...commits('published/QA-commits-since-checkpoint-1.json') ])
        history.append(commit);
    history.takeCheckpoint(line[1]);
    history.takeCheckpoint(line[2]);
    console.log(`Revisions ${line[0].revision + 1} to ${line[2].revision} taken commit by commit, checkpoints 1 and 2 taken: their ETags and those of the versions reached the same`);
    showPools(history.head.network, false, 3, 4);

    const revision = defined(proofRevisions.at(-1), 'proof of a revision');
    refused(`The proof of revision ${revision} in checkpoint 1`, () => { CheckpointProof.parse(json(`published/QA-proof-revision-${revision}.json`)).verify(line[1]); });

});


step('Example A6: witnesses sign the checkpoints', () => {

    // From the genesis, its key statement checked against the trust anchor above (verifyVersion): taken unanchored.
    const witness = History.fromSnapshot(json('published/QA-genesis.json'), { ...byOperator, unanchored: true });

    for (const commit of commits('published/QA-commits-since-genesis.json'))
        witness.append(commit);
    for (const sequence of [ 0, 1, 2 ])
        witness.takeCheckpoint(checkpoint(sequence));

    console.log(`A witness: the genesis and ${witness.head.commit.revision} commits checked, ${witness.checkpoints.length} checkpoints taken`);

    for (const sequence of [ 0, 1, 2 ]) {
        const signatures = verifyCheckpointSignatures(checkpoint(sequence), trust, { witnesses, requiredWitnesses: 2 });
        console.log(`Checkpoint ${sequence}: signed by ${signatures.signedBy.join(', ')}, witnessed by ${signatures.witnessedBy.join(', ')}`);
    }

});


step('Example A7: compaction with an archive', () => {

    const infos = (json('published/QA-archive.json') as JSONArray).map(parseArchiveSegmentInfo);
    verifySegmentLine(infos);
    console.log(`Segments: ${infos.map(info => `${info.number}: revisions ${info.fromRevision} to ${info.toRevision}`).join(', ')}, one after the other`);

    infos.forEach((info, index) => {
        const segment = ArchiveSegment.parse(json(`published/QA-archive-${info.number}.json`));
        const history = segment.replay(byOperator);
        segment.verifyAgainst(checkpoint(index), history);
        console.log(`Segment ${info.number}, from revision ${info.fromRevision}: its end and checkpoint ${index}: ETags the same, the root of its commits the same`);
    });

    const revision = defined(proofRevisions[0], 'proof of a revision');
    CheckpointProof.parse(json(`published/QA-proof-revision-${revision}-archived.json`)).verify(checkpoint(0));
    console.log(`The proof of revision ${revision}, from the archive, in checkpoint 0: valid`);

});


step('Example A8: price statements, named by checkpoints', () => {

    const checkpoint4  = checkpoint(4);
    const statements   = parsePriceStatements(json('published/QA-checkpoint-4-priceStatements.json'));
    const gef          = defined(head.network.chargingStationOperator('DE*GEF'), "charging station operator 'DE*GEF'");
    const signingKeys  = POIPublicKey.parseAll(gef['signingKeys'], 'signing keys');

    verifyCheckpointLine([ checkpoint(3), checkpoint4 ]);
    verifyCheckpointPriceStatements(checkpoint4, statements);
    for (const statement of statements)
        statement.verify('QA', 'DE*GEF', signingKeys);

    console.log(`Checkpoint 4 names ${statements.length} price statements; the root of those published: the same`);

    const current = PriceStatement.parse((json('published/QA-priceStatements-DE_GEF_E1_1.json') as JSONArray)[0]);
    current.verify('QA', 'DE*GEF', signingKeys);
    console.log(`EVSE ${current.entityId}, sequence ${current.sequence}: ${show(defined(current.prices[0], 'price in the price statement')['chargingTariffId'])}, signed by ${current.signer}`);

    const proof = PriceStatementProof.parse(json('published/QA-priceStatementProof-E1_1-0.json'));
    proof.verify(checkpoint4);
    console.log(`The proof of ${proof.priceStatement.entityId}, sequence ${proof.priceStatement.sequence}, in checkpoint 4: valid`);

    refused('Joined with a statement less', () => { verifyCheckpointPriceStatements(checkpoint4, statements.slice(1)); });

});


step('Example A9: witnesses check the price statements', () => {

    for (const sequence of [ 3, 4 ]) {
        const signatures = verifyCheckpointSignatures(checkpoint(sequence), trust, { witnesses, requiredWitnesses: 2 });
        console.log(`Checkpoint ${sequence}: signed by ${signatures.signedBy.join(', ')}, witnessed by ${signatures.witnessedBy.join(', ')}`);
    }

    const proof = PriceStatementProof.parse(json('published/QA-priceStatementProof-E1_1-0.json'));
    proof.verify(checkpoint(4));
    console.log(`The proof of ${proof.priceStatement.entityId}, sequence ${proof.priceStatement.sequence}, in checkpoint 4, witnessed: valid`);

});


if (has('driver/evidence-DE_GEF_E1_1.json'))
    step('Example A10: what a driver\'s app keeps as evidence, checked months later', () => {

        const evidence  = parseEvidence(json('driver/evidence-DE_GEF_E1_1.json'));
        const verified  = verifyEvidence(evidence, { witnesses, requiredWitnesses: witnesses.length });

        for (const { checkpoint: item, signatures } of verified.checkpoints)
            console.log(`Checkpoint ${item.sequence}: revision ${item.revision}, signed by ${signatures.signedBy.join(', ')}, witnessed by ${signatures.witnessedBy.join(', ')}`);

        const price = defined(verified.prices.get(`EVSE:${evidence.evseId}`), `price statement of the EVSE ${evidence.evseId}`);
        const named = verified.statementCheckpoints.get(price.digest);

        console.log(`At ${evidence.chargingStarted}, when charging began: the station proof attested, the price statement valid`);
        console.log(`Revision ${verified.station.revision}, the version of the station proof: in checkpoint ${verified.versionCheckpoint?.sequence ?? '-'}, witnessed`);
        console.log(`The price statement, sequence ${price.statement.sequence}: after checkpoint ${named?.after?.sequence ?? '-'}, before checkpoint ${named?.namedBy.sequence ?? '-'}, witnessed`);

        // The station and the meter of the EVSE, with their manufacturers and models as the proof gives them.
        const station  = verified.station;
        const meter    = station.evses.find(evse => evse['@id'] === evidence.evseId)?.['energyMeter'] as JSONObject | undefined;
        const madeBy   = station.manufacturer;
        const meterBy  = meter === undefined ? undefined : station.energyMeterModels.get(show(meter['@id']));
        console.log(`${show(station.chargingStation['@id'])}: ${show((madeBy?.manufacturer['name'] as JSONObject | undefined)?.['en'])} ${show(madeBy?.model?.['@id'])}`);
        if (meter !== undefined)
            console.log(`${show(meter['@id'])}, the energy meter of ${evidence.evseId}: ${show((meterBy?.manufacturer['name'] as JSONObject | undefined)?.['en'])} ${show(meterBy?.model?.['@id'])}, serial ${show(meter['serialNumber'])}`);

    });


if (has('published/QA-checkpoint-6.json'))
    step('Example A11: epoch 2, followed by a verifier trusting only the old locks, and joined by one trusting only the new ones', () => {

        const snapshot5  = json('published/QA-checkpoint-5-snapshot.json') as JSONObject;
        const old        = following(anchor, RoamingNetwork.parse(snapshot5['roamingNetwork']), witnesses);
        const epoch1     = History.fromSnapshot(snapshot5, { ...old, trustAnchor: anchor, at: time });

        for (const commit of commits('published/QA-commits-since-checkpoint-5.json'))
            epoch1.append(commit);

        const final  = epoch1.takeCheckpoint(checkpoint(6));
        const next   = defined(final.next, 'next epoch in the final checkpoint');
        console.log(`Old trust: revision ${epoch1.head.commit.revision}, checkpoint ${final.sequence}, final; next: epoch ${next.number}, ${next.profiles.toString()}`);

        const epoch2     = epoch1.startNextEpoch();
        const published  = (json('published/QA-epoch-2-genesis.json') as JSONObject)['commit'] as JSONObject;
        console.log(`Old trust: epoch 2 started, genesis ${epoch2.root.commit.id.slice(0, 8)}…, ${epoch2.root.commit.id === published['@id'] ? 'the published one' : 'ANOTHER one'}`);

        if (epoch2.root.commit.id !== published['@id'])
            throw new Error('the published genesis of epoch 2 is not the one of the final checkpoint');

        for (const commit of commits('published/QA-epoch-2-commits-since-genesis.json'))
            epoch2.append(commit);

        const first0 = epoch2.takeCheckpoint(json('published/QA-epoch-2-checkpoint-0.json'));
        console.log(`Old trust: checkpoint ${first0.sequence} of epoch ${first0.epoch}, after checkpoint ${final.sequence} of epoch 1: ${first0.previous?.checkpointId === final.id ? 'the final one it took' : 'another one'}`);

        refused('The head with the old trust anchor alone', () => OperatorTrust.of(anchor, RoamingNetwork.parse(json('published/QA.json')), time));

        const anchorPQ   = TrustAnchor.parse(text('published/QA-trustAnchor-mldsa.txt'));
        const followed   = old.trust.keyStatement;
        console.log(`The new trust anchor: ${[ ...anchorPQ.keys ].sort().join() === followed.identityKeys.map(key => key.id).sort().join() && anchorPQ.minConsensus === followed.minConsensus ? 'the identity keys and the quorum of the key statement it followed' : 'OTHER keys'}`);

        // A verifier trusting only the new locks.
        const witnessesPQ  = parseTrustedWitnesses(json('trusted/witnesses-mldsa.json'));
        const snapshot0    = json('published/QA-epoch-2-checkpoint-0-snapshot.json') as JSONObject;
        const pq           = following(anchorPQ, RoamingNetwork.parse(snapshot0['roamingNetwork']), witnessesPQ);
        const joined       = History.fromSnapshot(snapshot0, { ...pq, trustAnchor: anchorPQ, at: time });
        const joinedAt     = defined(joined.checkpoints[0], 'checkpoint joined from');
        console.log(`New trust: joined epoch ${joined.epoch.number} from checkpoint ${joinedAt.sequence}, revision ${joined.head.commit.revision}, ${joined.head.commit.id.length} hexadecimal digits`);

        verifyCheckpointPriceStatements(joinedAt, parsePriceStatements(json('published/QA-epoch-2-checkpoint-0-priceStatements.json')));
        refused('A commit of epoch 1', () => joined.append(defined(commits('published/QA-commits-since-checkpoint-5.json').at(-1), 'commit of epoch 1')));

    });


if (has('driver/live.json'))
    step('Example A12: the atlas and the traffic report, live', () => {

        const live      = json('driver/live.json') as JSONObject;
        const pushes    = (live['pushes'] as JSONArray).map(frame => parseFrame(frame));
        const updates   = pushes.filter(push => push.type === 'push' && push.action !== 'commit');

        for (const update of updates.map(push => parseStatusUpdate(push.payload)))
            console.log(`${update.entityId} ${update.kind}: ${typeof update.value === 'string' ? update.value : 'changed'} since ${toTimestamp(update.timestamp)}, unsigned`);

        // The snapshot of the WebSocket carries no attestations: as example A12, it is taken unanchored, and the commit of its
        // head checked against the trust anchor of epoch 2, in the version it leads to.
        const anchorPQ  = TrustAnchor.parse(text('published/QA-trustAnchor-mldsa.txt'));
        const snapshot  = json('published/QA-live-snapshot.json') as JSONObject;
        let signedBy: readonly string[] = [];
        const mirror    = History.fromSnapshot(snapshot, {
                              unanchored:    true,
                              verifyCommit:  (signed, _before, after) => { signedBy = [ ...OperatorTrust.of(anchorPQ, after, time).verifyOperatorSignatures(signed.signatures, (signature, key) => { signed.verifySignature(signature, key); }, 'the commit') ]; },
                          });
        const commit    = pushes.find(push => push.type === 'push' && push.action === 'commit');

        if (commit !== undefined) {
            const pushed   = mirror.head.commit.id === (commit.payload as JSONObject)['@id'] ? mirror.head.commit : undefined;
            console.log(`The commit pushed: revision ${mirror.head.commit.revision}, signed by ${signedBy.join(', ')}, checked against the trust anchor of epoch 2; the head of the mirror: ${pushed !== undefined}`);
        }

        const status = RuntimeStatus.fromSnapshot(snapshot).get('EVSE', 'DE*GEF*E1*1');
        console.log(`The live snapshot: DE*GEF*E1*1 ${show(status?.value)} since ${status === undefined ? '-' : toTimestamp(status.timestamp)}; outside the version, unsigned`);

    });


if (has('published/QA-DE-GEF-E1-1-proof.json'))
    step('Example A13: who checks the meter', () => {

        const anchorPQ  = TrustAnchor.parse(text('published/QA-trustAnchor-mldsa.txt'));
        const proof     = json('published/QA-DE-GEF-E1-1-proof.json') as JSONObject;
        const attested  = at ?? show(defined((proof['attestations'] as JSONObject[])[0], 'attestation in the station proof')['signedAt']);
        const station   = verifyChargingStation(anchorPQ, proof, { at: attested, evseId: 'DE*GEF*E1*1' });

        console.log(`The station proof, revision ${station.revision}, at ${attested}: attested by ${station.attestedBy.join(', ')}`);

        const name  = (value: JSONValue | undefined): string => show(isObject(value) ? Object.values(value)[0] : value);
        const list  = (value: JSONValue | undefined): string => ((value as string[] | undefined) ?? []).join('/');

        // The certificates the station and its meters name, each compared with the model, the hardware revision and the
        // firmware version of what names it.
        for (const { namedBy, certificate, body, statedBy, forThisModel } of station.certificates)
            console.log(`${namedBy.entityType} ${namedBy.entityId}: ${show(certificate['@id'])} for the ${show(certificate['chargingStationModel'] ?? certificate['energyMeterModel'])} ${list(certificate['hardwareRevisions'])}, firmware ${list(certificate['firmwareVersions'])}${certificate['legislation'] === undefined ? '' : ` under the ${show(certificate['legislation'])}`}, by the ${show(body['@id'])}; stated by ${statedBy === 'ConformityAssessmentBody' ? 'itself' : 'the roaming network operator in its place'}; for its model, revision and firmware: ${forThisModel ? 'yes' : 'no'}`);

        for (const software of station.transparencySoftware) {
            console.log(`${software.namedBy.entityId}: ${name(software.release['name'])} ${show(software.release['version'])}, ${software.legalStatus ?? ''}, as ${software.certificates.map(item => show(item.certificate['@id'])).join(' and ')} name it`);
            console.log(`  by ${name(software.manufacturer['name'])}, ${show(software.manufacturer['craRole'] ?? '')}`);
        }

        // The model of the station, as its manufacturer states it, and the revision and the firmware the station names.
        const madeBy = station.manufacturer;
        if (madeBy?.model !== undefined)
            console.log(`The station ${show(station.chargingStation['@id'])} is a ${show(madeBy.model['@id'])} of ${show(madeBy.manufacturer['@id'])}, hardware ${show(station.chargingStation['hardwareRevision'] ?? '-')} of ${list(madeBy.model['hardwareRevisions'])}, firmware ${show(station.chargingStation['firmwareVersion'] ?? '-')} of ${list(madeBy.model['firmwareVersions'])}`);
        for (const warning of station.warnings)
            console.log(`warning: ${warning}`);

    });


if (has('published/EM-LAB-DCC-2026-0815.json'))
    step('Example A14: the papers of a meter, digital', () => {

        // QA as published: its key statement signed by the quorum the trust anchor of epoch 2 names, and the commit leading
        // to it.
        const anchorPQ  = TrustAnchor.parse(text('published/QA-trustAnchor-mldsa.txt'));
        const qa        = verifyVersion(anchorPQ, json('published/QA.json'), json('published/QA-commit.json'), time);
        console.log(`QA, revision ${qa.commit.revision} of epoch ${qa.commit.epoch}: checked against the trust anchor of epoch 2`);

        const inWords = (value: QIDigitalI18NText | undefined): string => value?.[0]?.[1] ?? '';
        const list    = (values: readonly string[]): string => values.join('/');

        // The effective energy meter of the given EVSE, as QA names it at runtime.
        const meterOf = (evseId: string): JSONObject => {
            const operators = qa.network.effectiveContent['chargingStationOperators'] as JSONObject[];
            const evses     = operators.flatMap(operator => (operator['chargingPools'] as JSONObject[] | undefined) ?? [])
                                       .flatMap(pool => (pool['chargingStations'] as JSONObject[] | undefined) ?? [])
                                       .flatMap(station => (station['EVSEs'] as JSONObject[] | undefined) ?? []);
            return defined(evses.find(evse => evse['@id'] === evseId)?.['energyMeter'] as JSONObject | undefined, `energy meter of ${evseId}`);
        };

        // The certificates of conformity: of a conformity assessment body of QA with its number, notified for its
        // legislation, valid now; the type examination for a model of its manufacturer, the approval of the quality system
        // for a manufacturer of QA.
        const typeExamination = DigitalCertificateOfConformity.parseText(text('published/PTB-DE-26-M-PTB-0108.json'));
        typeExamination.verify(qa.network, time);
        const model = defined(typeExamination.model, 'model of the type examination');
        console.log(`${typeExamination.id}, by the ${typeExamination.conformityAssessmentBodyId}, notified body ${typeExamination.notifiedBodyNumber}: valid`);
        console.log(`  module ${typeExamination.module}, under the ${typeExamination.legislation.name}, for the ${model.modelId} of ${model.manufacturerId}, hardware ${list(model.hardwareRevisions)}, firmware ${list(model.firmwareVersions)}`);

        const qualitySystem = DigitalCertificateOfConformity.parseText(text('published/PTB-DE-26-QS-PTB-0042.json'));
        qualitySystem.verify(qa.network, time);
        const manufacturer = defined(qualitySystem.manufacturer, 'manufacturer of the quality system');
        console.log(`${qualitySystem.id}, by the ${qualitySystem.conformityAssessmentBodyId}, notified body ${qualitySystem.notifiedBodyNumber}: valid`);
        console.log(`  module ${qualitySystem.module}, under the ${qualitySystem.legislation.name}, for the quality system of ${manufacturer.manufacturerId}, scope ${manufacturer.scope.join(', ')}`);

        // The declaration of conformity: of the manufacturer of its model, signed by its key for its models; each certificate
        // it names, picked by its identification.
        const declaration = DigitalDeclarationOfConformity.parseText(text('published/SAALE-DoC-SM-3-2026-01.json'));
        declaration.verify(qa.network, time);
        console.log(`${declaration.id}, by ${declaration.model.manufacturerId}, the manufacturer of the ${declaration.model.modelId}: valid`);
        console.log(`  under the ${declaration.legislations.map(legislation => legislation.name).join(', ')}; signed in ${declaration.placeOfIssue} by ${declaration.signatory.name}`);

        const certificates = new Map([ typeExamination, qualitySystem ].map(certificate => [ certificate.id, certificate ]));
        for (const notifiedBody of declaration.notifiedBodies) {
            const certificate = notifiedBody.certificateId === undefined ? undefined : certificates.get(notifiedBody.certificateId);
            if (certificate !== undefined)
                declaration.verifyCertificate(certificate);
            console.log(`  ${notifiedBody.certificateId ?? '-'} of the notified body ${notifiedBody.notifiedBodyNumber}, the ${notifiedBody.conformityAssessmentBodyId}, module ${notifiedBody.module ?? '-'}: ${certificate === undefined ? 'no certificate at hand' : 'the certificate it names'}`);
        }

        // The calibration certificate: of a laboratory of QA, signed by its key for certificates; its item the meter as QA
        // names it at runtime, and a meter both certificates of conformity cover.
        const calibration = DigitalCalibrationCertificate.parseText(text('published/EM-LAB-DCC-2026-0815.json'));
        calibration.verify(qa.network, time);
        const item = calibration.item;
        console.log(`${calibration.id}, by ${calibration.calibrationLaboratoryId}, ${calibration.calibrationLaboratoryCode ?? '-'}: valid`);
        console.log(`  the ${item.text}, the ${item.modelId ?? '-'} of ${item.manufacturerId ?? '-'} of serial number ${item.serialNumber ?? '-'}, hardware ${item.hardwareRevision ?? '-'}, firmware ${item.firmwareVersion ?? '-'}`);

        const atRuntime = QIDigitalItem.ofEnergyMeter(meterOf('DE*GEF*E2*1'));
        if (JSON.stringify(atRuntime) !== JSON.stringify(item))
            throw new Error(`the item of ${calibration.id} is not the meter of DE*GEF*E2*1 as QA names it`);

        for (const measurement of calibration.measurementResults)
            for (const result of measurement.results) {
                const current  = defined(result.quantities.find(quantity => quantity.refType === 'basic_nominalValue'),     'nominal value');
                const measured = defined(result.quantities.find(quantity => quantity.refType === 'basic_measurementError'), 'measurement error');
                console.log(`  ${inWords(result.name).padEnd(4)}  ${`${current.value.toString()} A`.padEnd(6)}  ${measured.value.toString()} % ± ${measured.expandedUncertainty?.toString() ?? '-'} % (k = ${measured.coverageFactor?.toString() ?? '-'}), limits ± ${measured.toleranceUpper?.toString() ?? '-'} %: ${measured.conformity ?? '-'}`);
            }

        typeExamination.cover(item);
        qualitySystem.cover(item);
        console.log(`  passes: ${calibration.passes}; signed by ${calibration.mainSigner?.name ?? '-'}; ${typeExamination.id} and ${qualitySystem.id} cover it`);

        // What is refused: the calibration certificate with another error at Imax, changed after it was signed; the
        // certificates of conformity for the DC meter of DE*GEF*E1*1, a KDM-500 of KERNBERG.
        const changed      = json('published/EM-LAB-DCC-2026-0815.json') as JSONObject;
        const imax         = ((((changed['measurementResults'] as JSONObject[])[0]?.['results'] as JSONObject[] | undefined)?.[3]?.['quantities'] as JSONObject[] | undefined)?.[1]);
        defined(imax, 'error at Imax')['value'] = parseJSON('-0.12');
        refused('Another error at Imax', () => { DigitalCalibrationCertificate.parse(changed).verify(qa.network, time); });

        const dcMeter = QIDigitalItem.ofEnergyMeter(meterOf('DE*GEF*E1*1'));
        refused(`${typeExamination.id} for the meter of DE*GEF*E1*1`, () => { typeExamination.cover(dcMeter); });
        refused(`${qualitySystem.id} for the meter of DE*GEF*E1*1`,   () => { qualitySystem.cover(dcMeter); });

    });


if (has('proofs/QA-proof-station-DE_GEF_S1.json'))
    step('The app: the proof of a charging station and its prices', () => {

        const anchorPQ = TrustAnchor.parse(text('published/QA-trustAnchor-mldsa.txt'));
        const station  = verifyChargingStation(anchorPQ, json('proofs/QA-proof-station-DE_GEF_S1.json'), { at: time });
        console.log(`At ${time}: ${station.roamingNetwork.name ?? ''} (revision ${station.revision}), attested by ${station.attestedBy.join(', ')}`);

        for (const evse of station.evses)
            console.log(`  ${show(evse['@id'])}, ${Number(evse['maxPower']) / 1000} kW: ${(station.tariffs.get(show(evse['@id'])) ?? []).map(tariff => show(tariff['@id'])).join(', ')}`);

        const prices = verifyPriceStatements(station, json('published/QA-epoch-2-checkpoint-0-priceStatements.json'), { at: time });
        for (const [entity, price] of prices)
            console.log(`  ${entity}: the price statement ${price.statement.sequence}, valid`);

    });


console.log(failures === 0 ? '\nEverything checked.' : `\n${failures} check(s) failed!`);
process.exitCode = failures === 0 ? 0 : 1;
