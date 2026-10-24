/*
 * Checks what the C# examples A1 to A9 of WWCP_POI published, as their Validate() methods do, and prints what it checked.
 *
 *   npx tsx examples/validate-examples.ts                                   the run kept in tests/vectors
 *   npx tsx examples/validate-examples.ts <WWCP_POI>/examples/csharp        a run of your own, after `dotnet run` there
 *   npx tsx examples/validate-examples.ts <dir> --at 2026-10-24T04:00:00.000Z
 *
 * Every run of the C# examples makes new keys, so every digest differs from one run to the next; what is checked is the
 * same. The proofs of charging stations (proofs/) are not made by the examples: they are checked where they are given.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join }                     from 'node:path';

import {
    ArchiveSegment, Checkpoint, CheckpointProof, History, OperatorTrust, POIPublicKey, PriceStatement, PriceStatementProof,
    RoamingNetwork, TrustAnchor, describeVersion, etagToText, get, parseArchiveSegmentInfo, parseJSON, parsePriceStatements,
    parseTrustedWitnesses, verifyChargingStation, verifyCheckpointLine, verifyCheckpointPriceStatements,
    verifyCheckpointSignatures, verifyPriceStatements, verifySegmentLine, verifyVersion,
    type HistoryOptions, type JSONArray, type JSONObject, type JSONValue,
} from '../src/index.ts';


const args       = process.argv.slice(2);
const atIndex    = args.indexOf('--at');
const at         = atIndex >= 0 ? args[atIndex + 1]! : undefined;
const directory  = args.find((arg, index) => !arg.startsWith('--') && (atIndex < 0 || index !== atIndex + 1)) ?? join(import.meta.dirname, '..', 'tests', 'vectors', 'csharp-2d9511d');
const time       = at ?? (directory.includes('csharp-2d9511d') ? '2026-10-24T04:00:00.000Z' : new Date().toISOString());

const file  = (name: string): string     => join(directory, name);
const text  = (name: string): string     => readFileSync(file(name), 'utf8');
const json  = (name: string): JSONValue  => parseJSON(text(name));
const has   = (name: string): boolean    => existsSync(file(name));

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

const anchor = TrustAnchor.parse(text('published/QA-trustAnchor.txt'));
const head   = verifyVersion(anchor, json('published/QA.json'), json('published/QA-commit.json'), time);
const trust  = head.trust;

const byOperator: HistoryOptions = {
    verifyCommit:      commit     => { trust.verifyOperatorSignatures(commit.signatures, (signature, key) => commit.verifySignature(signature, key), 'the commit'); },
    verifyCheckpoint:  checkpoint => { verifyCheckpointSignatures(checkpoint, trust); },
};

const checkpoint = (sequence: number): Checkpoint => Checkpoint.parse(json(`published/QA-checkpoint-${sequence}.json`));
const commits    = (name: string): JSONArray  => json(name) as JSONArray;


step('Example A1: checking QA from its trust anchor', () => {

    console.log(`The QR code: ${anchor.toQRCode().length} characters; ${anchor.keys.length} identity keys pinned, minConsensus ${anchor.minConsensus}`);
    console.log(describeVersion(head));
    for (const warning of head.warnings)
        console.log(`warning: ${warning}`);

    for (const eTag of head.network.eTags())
        console.log(`  ${etagToText(eTag)}`);

    console.log(`QA is checked: revision ${head.commit.revision}, commit ${head.commit.id}, signed by ${head.signedBy.join(' and ')}`);
    console.log(`beforeETags of the next change set: ${head.network.changeSetETags().map(etagToText).join(', ')}`);

    const genesis = json('published/QA-genesis.json') as JSONObject;
    const version = verifyVersion(anchor, genesis['roamingNetwork']!, genesis['commit']!, time);
    console.log(`The genesis: revision ${version.commit.revision}, commit ${version.commit.id}, signed by ${version.signedBy.join(' and ')}`);

});


step('Example A2: the charging station operator DE*GEF', () => {

    const gef = head.network.chargingStationOperator('DE*GEF');

    if (gef === undefined)
        throw new Error("QA has no charging station operator 'DE*GEF'");

    if (has('DE-GEF/operator.json')) {
        const sent    = json('DE-GEF/operator.json') as JSONObject;
        const ids     = (keys: JSONValue | undefined) => POIPublicKey.parseAll(keys, 'keys').map(key => key.id).sort().join(', ');
        if (ids(gef['signingKeys']) !== ids(sent['signingKeys']) || ids(gef['identityKeys']) !== ids(sent['identityKeys']))
            throw new Error("QA names 'DE*GEF' with other keys than it sent");
    }

    console.log('DE*GEF is a member of QA with its keys:');
    for (const key of POIPublicKey.parseAll(gef['signingKeys'], 'signing keys'))
        console.log(`  signing key  ${key.id} for ${key.usages.join(', ')}`);
    for (const key of POIPublicKey.parseAll(gef['identityKeys'], 'identity keys'))
        console.log(`  identity key ${key.id}`);

});


/** The pools of DE*GEF as they are at runtime. */
function showPools(network: RoamingNetwork, ...numbers: number[]): void {

    const operator = (get(network.effectiveContent, 'chargingStationOperators') as JSONObject[]).find(item => item['@id'] === 'DE*GEF')!;
    const pools    = ((get(operator, 'chargingPools') as JSONObject[] | undefined) ?? []).filter(pool => numbers.length === 0 || numbers.some(n => pool['@id'] === `DE*GEF*P${n}`));

    if (pools.length === 0)
        console.log(`no pool ${numbers.join(' or ')} yet`);

    for (const pool of pools) {
        console.log(`${String(pool['@id'])}  ${String((pool['name'] as JSONObject)['en'])}`);
        for (const station of get(pool, 'chargingStations') as JSONObject[])
            console.log(`  ${String(station['@id'])}  ${Number(station['maxPower']) / 1000} kW: ` +
                        (get(station, 'EVSEs') as JSONObject[]).map(evse => `${String(evse['@id'])} ${String((evse['currentTypes'] as string[])[0])} ${Number(evse['maxPower']) / 1000} kW`).join(', '));
    }

}


step('Example A3: the pools of DE*GEF as they are at runtime', () => {
    showPools(head.network, 1, 2);
});


step('Example A4: the first checkpoint, and joining from it', () => {

    const checkpoint0 = checkpoint(0);
    const signatures  = verifyCheckpointSignatures(checkpoint0, trust);
    console.log(`Checkpoint 0 of epoch ${checkpoint0.epoch}: revision ${checkpoint0.revision}, ${checkpoint0.commits.size} commit(s) since the genesis, signed by ${signatures.signedBy.join(', ')}`);

    const joined = History.fromSnapshot(json('published/QA-checkpoint-0-snapshot.json'), byOperator);
    console.log(`Joined at revision ${joined.head.commit.revision}, the checkpoint's: ${joined.head.commit.id === checkpoint0.commitId ? 'the same' : 'another'}`);

    for (const commit of commits('published/QA-commits-since-checkpoint-0.json')) {
        const version = joined.append(commit);
        console.log(`Appended revision ${version.commit.revision}: ${version.commit.description ?? ''}`);
    }

    const proof = CheckpointProof.parse(json('published/QA-proof-revision-3.json'));
    proof.verify(checkpoint0);
    console.log(`The proof of the commit of revision ${proof.revision} in checkpoint 0: valid`);

    const changed = json('published/QA-checkpoint-0.json') as JSONObject;
    changed['revision'] = 5;
    refused('A checkpoint of another revision', () => Checkpoint.parse(changed));

    showPools(joined.head.network, 3, 4);

});


step('Example A5: a correction between two checkpoints', () => {

    const line = [ checkpoint(0), checkpoint(1), checkpoint(2) ];
    verifyCheckpointLine(line);

    for (const item of line)
        console.log(`Checkpoint ${item.sequence}: revision ${item.revision}, ${item.commits.size} commit(s), signed by ${verifyCheckpointSignatures(item, trust).signedBy.join(', ')}`);

    console.log(`One line: ${line.map(item => `${item.sequence} (revision ${item.revision})`).join(' <- ')}`);

    const history = History.fromSnapshot(json('published/QA-checkpoint-0-snapshot.json'), byOperator);
    for (const commit of [ ...commits('published/QA-commits-since-checkpoint-0.json'), ...commits('published/QA-commits-since-checkpoint-1.json') ])
        history.append(commit);
    history.takeCheckpoint(line[1]!);
    history.takeCheckpoint(line[2]!);
    console.log(`Revisions 7 to 9 taken commit by commit, checkpoints 1 and 2 taken: their ETags and those of the versions reached the same`);
    showPools(history.head.network, 3, 4);

    refused('The proof of revision 9 in checkpoint 1', () => CheckpointProof.parse(json('published/QA-proof-revision-9.json')).verify(line[1]!));

});


step('Example A6: witnesses sign the checkpoints', () => {

    const witnesses = parseTrustedWitnesses(json('trusted/witnesses.json'));
    const witness   = History.fromSnapshot(json('published/QA-genesis.json'), byOperator);

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

    CheckpointProof.parse(json('published/QA-proof-revision-3-archived.json')).verify(checkpoint(0));
    console.log('The proof of revision 3, from the archive, in checkpoint 0: valid');

});


step('Example A8: price statements, named by checkpoints', () => {

    const checkpoint4  = checkpoint(4);
    const statements   = parsePriceStatements(json('published/QA-checkpoint-4-priceStatements.json'));
    const gef          = head.network.chargingStationOperator('DE*GEF')!;
    const signingKeys  = POIPublicKey.parseAll(gef['signingKeys'], 'signing keys');

    verifyCheckpointLine([ checkpoint(3), checkpoint4 ]);
    verifyCheckpointPriceStatements(checkpoint4, statements);
    for (const statement of statements)
        statement.verify('QA', 'DE*GEF', signingKeys);

    console.log(`Checkpoint 4 names ${statements.length} price statements; the root of those published: the same`);

    const current = PriceStatement.parse((json('published/QA-priceStatements-DE_GEF_E1_1.json') as JSONArray)[0]);
    current.verify('QA', 'DE*GEF', signingKeys);
    console.log(`EVSE ${current.entityId}, sequence ${current.sequence}: ${String(current.prices[0]!['chargingTariffId'])}, signed by ${current.signer}, valid at ${time}: ${current.isValidAt(Date.parse(time))}`);

    const proof = PriceStatementProof.parse(json('published/QA-priceStatementProof-E1_1-0.json'));
    proof.verify(checkpoint4);
    console.log(`The proof of ${proof.priceStatement.entityId}, sequence ${proof.priceStatement.sequence}, in checkpoint 4: valid`);

    refused('Joined with a statement less', () => verifyCheckpointPriceStatements(checkpoint4, statements.slice(1)));

});


step('Example A9: witnesses check the price statements', () => {

    const witnesses = parseTrustedWitnesses(json('trusted/witnesses.json'));

    for (const sequence of [ 3, 4 ]) {
        const signatures = verifyCheckpointSignatures(checkpoint(sequence), trust, { witnesses, requiredWitnesses: 2 });
        console.log(`Checkpoint ${sequence}: signed by ${signatures.signedBy.join(', ')}, witnessed by ${signatures.witnessedBy.join(', ')}`);
    }

    const proof = PriceStatementProof.parse(json('published/QA-priceStatementProof-E1_1-0.json'));
    proof.verify(checkpoint(4));
    console.log(`The proof of ${proof.priceStatement.entityId}, sequence ${proof.priceStatement.sequence}, in checkpoint 4, witnessed: valid`);

});


if (has('proofs/QA-proof-station-DE_GEF_S1.json'))
    step('The app: the proof of a charging station and its prices', () => {

        const station = verifyChargingStation(anchor, json('proofs/QA-proof-station-DE_GEF_S1.json'), { at: time });
        console.log(`At ${time}: ${station.roamingNetwork.name ?? ''} (revision ${station.revision}), attested by ${station.attestedBy.join(', ')}`);

        for (const evse of station.evses)
            console.log(`  ${String(evse['@id'])}, ${Number(evse['maxPower']) / 1000} kW: ${(station.tariffs.get(String(evse['@id'])) ?? []).map(tariff => String(tariff['@id'])).join(', ')}`);

        const prices = verifyPriceStatements(station, json('published/QA-priceStatements-DE_GEF_E1_1.json'), { at: time });
        for (const [entity, price] of prices)
            console.log(`  ${entity}: the price statement ${price.statement.sequence}, valid`);

    });


console.log(failures === 0 ? '\nEverything checked.' : `\n${failures} check(s) failed!`);
process.exitCode = failures === 0 ? 0 : 1;

export { OperatorTrust };
