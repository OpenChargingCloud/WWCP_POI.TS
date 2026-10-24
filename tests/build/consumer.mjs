// The built package as an app uses it: imported by its name, through the exports of package.json, in plain Node without
// any bundler or transpiler. Checks the genesis of QA against its trust anchor and the proof of a charging station of
// epoch 2, and prints what it checked as JSON.
//
//   node tests/build/consumer.mjs <directory of the test vectors> <time>

import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { TrustAnchor, parseJSON, verifyChargingStation, verifyVersion } from '@open-charging-cloud/wwcp-poi';

const [ vectors, at ] = process.argv.slice(2);
const read            = name => readFileSync(join(vectors, name), 'utf8');

const genesis  = parseJSON(read('published/QA-genesis.json'));
const version  = verifyVersion(TrustAnchor.parse(read('published/QA-trustAnchor.txt')), genesis.roamingNetwork, genesis.commit, at);
const station  = verifyChargingStation(TrustAnchor.parse(read('published/QA-trustAnchor-mldsa.txt')), parseJSON(read('proofs/QA-proof-station-DE_GEF_S1.json')), { at });

console.log(JSON.stringify({
    revision:    version.commit.revision,
    signedBy:    version.signedBy,
    station:     station.chargingStation['@id'],
    model:       station.manufacturer?.model?.['@id'],
    attestedBy:  station.attestedBy,
}));
