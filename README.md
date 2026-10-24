# WWCP POI for TypeScript

Verifies what a roaming network of [WWCP POI 3](https://github.com/OpenChargingCloud/WWCP_POI) publishes about its
charging stations and their tariffs, from the **trust anchor** of the roaming network alone: the QR code its operator
publishes, naming the identity keys of the operator and its quorum.

An EV driver's app selects a charging station; this library downloads the proof of the station and the price statements
of its EVSEs, and checks that the station, its EVSEs as they are at runtime, the charging tariffs they take and the
prices of the moment are the ones the roaming network operator attested and the charging station operator signed - before
charging begins. Months later, e.g. disputing an invoice, the evidence the app kept proves which price applied, witnessed
by checkpoints. The same proof gives the public keys of the energy meters, with which
[ChargyCore.TS](https://github.com/OpenChargingCloud/ChargyCore.TS) checks the signed meter values of the session, and the
transparency software and its certificate that say who checks them.

Everything is calculated as the C# implementation calculates it, byte for byte: the canonical JSON and the deterministic
CBOR of Styx, ETags, the effective tree with templates (section 8 of the specification), commit and checkpoint
identifications of every epoch, COSE keys and their thumbprints, and the signatures ES256/384/512, Ed25519, Ed448 and
ML-DSA-44/65/87.


## Status

**Milestone 1: the examples of WWCP_POI, checked in TypeScript.** The examples A1 to A13 of
[WWCP_POI/examples](https://github.com/OpenChargingCloud/WWCP_POI/tree/master/examples) at commit `801bbce` are checked
from what the C# examples publish, as their `Validate()` methods check them, and the same for proofs of charging stations
the C# implementation makes; also from a second run of the C# examples, with new keys. See [Tests](#tests).

What a review of the C# implementation found while porting it is in [docs/csharp-review.md](docs/csharp-review.md).


## Installation

```bash
npm install @open-charging-cloud/wwcp-poi
```

ESM, Node 22.18 or newer, browsers and React Native alike: no `node:*` module, no `Buffer`, no WebCrypto. The
cryptography is [`@vanaheimr/cose`](https://github.com/Vanaheimr/COSE.TS) on the `@noble` family, the CBOR codec
[`@vanaheimr/metrological-cbor`](https://github.com/Vanaheimr/MetrologicalCBOR.TS).


## An app: a charging station and its prices

```ts
import { POIClient } from '@open-charging-cloud/wwcp-poi';

// The text of the QR code of the roaming network, as scanned, e.g. from the website of its operator.
const client  = new POIClient('WWCP/TA-2:B7LJ683VCBCACVCC$C6REF6B…');

// GET ~/RNs/QA/EVSEs/DE*GEF*E1*1/proof and …/priceStatements, from the first server of the trust anchor whose answer verifies.
const checked = await client.chargingStation({ evseId: 'DE*GEF*E1*1' });

checked.station.roamingNetwork.name;                 // 'Quality Assurance', as the operator signed it, not as the QR code says
checked.station.chargingStation;                     // the station as it is at runtime, with what its templates give it
checked.station.tariffs.get('DE*GEF*E1*1');          // the charging tariffs the EVSE takes
checked.station.manufacturer?.model;                 // its model, as its manufacturer states it: versions, ratings, datasheet
checked.station.energyMeters;                        // with their public keys, for transparency software
checked.station.energyMeterModels;                   // per meter: its manufacturer and model
checked.station.transparencySoftware;                // per meter: the release, its manufacturer, the certificate, its body
checked.prices.get('EVSE:DE*GEF*E1*1')?.statement;   // the price statement valid now, signed by DE*GEF
checked.documents;                                   // as they came: keep them as evidence of the session
```

What is checked (sections 8.4 to 8.6, 12.4 of the specification):

- the proof leads to a root, the `effectiveTree` ETag of a version of the roaming network;
- the key statement of the roaming network operator the proof gives is signed by identity keys the trust anchor pins, of
  as many holders as its `minConsensus` requires, and is valid now;
- attestations of that root, valid now, by signing keys of the operator, each certified by a trusted identity key of its
  holder, come from as many holders;
- each price statement is signed by a signing key of the charging station operator that the proof gives and that may sign
  `priceStatements`, names only charging tariffs of its EVSE, and chains with the statements before it.

When a roaming network moves into a new epoch and replaces the keys of its operator (example A11), its operator publishes
a new QR code: a key statement signed only by the new keys is refused under the old trust anchor. A verifier that follows
the history commit by commit follows the keys as well (`OperatorTrust.followedBy`), and finds the new trust anchor naming
the keys it followed.

Without the client, the same with documents of any source:

```ts
import { TrustAnchor, verifyChargingStation, verifyPriceStatements } from '@open-charging-cloud/wwcp-poi';

const anchor   = TrustAnchor.parse(qrCodeText);
const station  = verifyChargingStation(anchor, proofJSON, { evseId: 'DE*GEF*E1*1' });
const prices   = verifyPriceStatements(station, priceStatementsJSON);
```

Who checks the meter (example A13): the transparency software each energy meter names, with the certificate of a
conformity assessment body, as the proof gives them. POI proves who states them, not that they are true. A certificate
is for a version of a model; `forThisModel` tells whether it is for the model of the station and a version of it, the
station naming no version ([docs/csharp-review.md](docs/csharp-review.md), 16).

```ts
for (const { energyMeterId, legalStatus, release, manufacturer, certificate, body, forThisModel } of station.transparencySoftware)
    console.log(energyMeterId, legalStatus, release['version'], manufacturer['craRole'], certificate?.['legislation'], body?.['@id'], forThisModel);
```

Months later, the evidence of the session (example A10): the station proof attested and the price statement valid as
charging began, the commit of the station proof and the statement each proven to be part of checkpoints the trusted
witnesses signed:

```ts
import { parseEvidence, parseTrustedWitnesses, verifyEvidence } from '@open-charging-cloud/wwcp-poi';

// driver/evidence-DE_GEF_E1_1.json, as the app of example A10 keeps it
const evidence = verifyEvidence(parseEvidence(keptJSON), { witnesses: parseTrustedWitnesses(witnessesJSON), requiredWitnesses: 2 });
```


## The traffic report: the status of an EVSE, live

The status of an EVSE, its energy status and the price shown at this moment are the runtime status of the head of the
history (example A12), pushed over the WebSocket `~/RNs/{RN_Id}/history/ws` the moment they change. They are unsigned,
as trustworthy as the server telling them, and no evidence: a price that has to be provable is a price statement. A
commit pushed with them is signed like every other, and checked like every other.

```ts
import { RuntimeStatus, parseFrame, parseStatusUpdate, subscribeRequest } from '@open-charging-cloud/wwcp-poi';

const status = RuntimeStatus.fromSnapshot(snapshotJSON);      // the runtime status beside the head, not part of its version
socket.send(subscribeRequest('1'));                         // [2,"1","subscribe",{"topics":["statusUpdates", …, "commits"]}]

socket.onmessage = event => {
    const frame = parseFrame(event.data);                    // [6, id, action, payload]: a push
    if (frame.type === 'push' && frame.action !== 'commit')
        status.apply(parseStatusUpdate(frame.payload));     // the latest timestamp wins: a late report is 'Outdated'
};

status.get('EVSE', 'DE*GEF*E1*1', 'status')?.value;         // 'charging'
```


## A charging station operator, a witness, a server: versions and histories

```ts
import { History, TrustAnchor, verifyVersion, verifyCheckpointSignatures } from '@open-charging-cloud/wwcp-poi';

// Example A1: a version of the roaming network and its commit, from the trust anchor alone.
const version = verifyVersion(TrustAnchor.parse(qrCodeText), networkJSON, commitJSON);
version.signedBy;     // [ 'AlphaOrg', 'BetaOrg', 'GammaOrg' ]

// Examples A4 to A6: join from the snapshot of a checkpoint, take the commits since one by one, each checked as section
// 5.2 says: its change set signed by its owners, fitting the head, leading to the ETags of the commit.
let trust = version.trust;
const history = History.fromSnapshot(checkpointSnapshotJSON, {
    verifyCommit: (commit, before, after) => {
        trust.verifyOperatorSignatures(commit.signatures, (s, key) => commit.verifySignature(s, key), 'the commit');
        trust = trust.followedBy(after);        // the keys its operator states anew, signed by those trusted
    },
    verifyCheckpoint: checkpoint => verifyCheckpointSignatures(checkpoint, trust, { witnesses, requiredWitnesses: 2 }),
});

for (const commit of commitsSince)
    history.append(commit);

// Example A11: the final checkpoint closes the epoch; the next one starts from its version, its genesis the one every
// server makes, SHA-512 identifications and ML-DSA signatures from then on.
history.takeCheckpoint(finalCheckpointJSON);
const epoch2 = history.startNextEpoch();
epoch2.root.commit.id;    // the published genesis of epoch 2, 128 hexadecimal digits
```


## What is ported, and what is not yet

| | |
|---|---|
| Canonical JSON, deterministic CBOR (Styx) | complete, including Styx's string escaping and decimals as `System.Decimal` holds them |
| Keys, thumbprints, signatures | EC2, OKP and AKP COSE keys; all signature algorithms of section 4; the key usages `infrastructure`, `tariffs`, `priceStatements`, `models`, `software`, `certificates`, `party` |
| Trust anchors | QR code (`WWCP/TA-2:` and Base45 of CBOR), URL and JSON forms, read and written; key statements followed by succession |
| Roaming networks | ETags `json`, `cbor`, `effectiveTree`; the roaming network operator, its key statement and certificates |
| Effective members (9.2) | EVSEs, charging stations, charging pools, charging tariffs, energy meters. Parking spaces and energy meters of grid connection points taking templates are refused, not calculated |
| Proofs (8.4), attestations (8.5) | complete, with the manufacturers and models of the station and its meters, the transparency software releases and certificates of the meters; subject attestations do not count for a whole proof |
| Change sets (4) | `Add`, `Remove`, `UpdateProperty`, `RemoveProperty` of parties (charging station operators, e-mobility providers, grid and parking operators, charging station and energy meter manufacturers, transparency software manufacturers, conformity assessment bodies), the roaming network and its operator, of charging pools, stations, EVSEs, tariffs, templates and groups of charging station operators, energy meter templates and groups, models of manufacturers, transparency software releases and certificates, with their owners' signatures, quorum and proof of possession, and the properties a change set may change. Element changes, preconditions, offers and the entities of providers, grid and parking operators are refused, not applied. The references the C# implementation checks after every change set (a manufacturer, model, release or certificate a station, meter or certificate names) are not checked again: the `afterETags` of the change set pin the version it leads to |
| Histories (5, 10, 11) | linear histories from snapshots, commits, checkpoints, their lines and signatures, proofs of commits, archive segments; epochs: their profiles, the final checkpoint, the genesis of the next epoch, its first checkpoint. Merges are not taken yet |
| Price statements (12) | statements, chains, checkpoint trees and proofs in every epoch |
| Runtime status (12.5) | status updates, frames of the WebSocket, the runtime status of a snapshot. No WebSocket client: the app brings its own |

Whatever is not ported is refused with a `POIError` saying so, but for the references named above: the library never
takes as checked what it can not check.
And whatever it calculated otherwise than the C# implementation would end in other ETags or identifications, and be
refused as well.


## Tests

```bash
npm run verify
```

`verify` runs what CI runs: the type checks (as Node and as a browser sees `src/`), ESLint with the rules of
ChargyCore.TS, and `npm test`, which is

- `npm run test:node`: the tests below, in Node;
- `npm run build` and `npm run test:bundle`: what `dist/` holds, as an app gets it: the bundle imports only the
  dependencies `package.json` names and neither `node:*` modules, `Buffer` nor `process`; an app imports it by the name
  of the package in plain Node and gets its declared types with TypeScript (`nodenext` and `bundler`); `npm pack`
  publishes nothing but `dist/` and the documents;
- `npm run test:browser`: a trust anchor, a commit, a station proof of ML-DSA attestations, a price and the evidence of
  a session, checked in Chromium (Vitest browser mode with Playwright; once: `npx playwright install chromium`).

GitHub Actions run it on every push and pull request (`.github/workflows/ci.yml`): Ubuntu on Node 22.18, the minimum
`package.json` names, and on Node 26, Windows on Node 24. Every night (`.github/workflows/nightly.yml`) the same suite
runs again, and, informational, with the dependencies the lockfile does not pin, with the newest releases of
`@vanaheimr/cose` and `@vanaheimr/metrological-cbor`, as `npm audit`, and against the C# implementation as it is: the
examples of WWCP_POI at the commits the RoamingHubCLI pins, run with .NET and checked with `examples/validate-examples.ts`,
which turns red the day WWCP_POI moves on and this port needs work.

The test vectors are in `tests/vectors/csharp-801bbce`: what one run of the C# examples of WWCP_POI at commit `801bbce`
published (public data only; its output is `csharp-output.log` there), and in `proofs/`, what
`proofs/MakeProofs.cs.txt` made of the same history with the C# implementation: proofs of charging stations of epoch 2,
the commits of epoch 2 up to the head, and the ECDSA twin of a price statement.

- `tests/canonical.test.ts`, `tests/specification.test.ts`: the test vectors of Styx and of section 6 of the
  specification.
- `tests/exampleA1.test.ts`, `tests/examples.test.ts`: the examples A1 to A9, epoch 1, the manufacturers and the models
  they state among them.
- `tests/evidence.test.ts`: example A10, the evidence a driver's app keeps, and ECDSA twins of price statements.
- `tests/exampleA11.test.ts`: example A11, epoch 2, followed with the old trust anchor and joined with the new one.
- `tests/exampleA12.test.ts`: example A12, the runtime status and the commit pushed over the WebSocket.
- `tests/exampleA13.test.ts`: example A13, transparency software manufacturers, conformity assessment bodies, and who
  checks the meter.
- `tests/chargingStation.test.ts`, `tests/client.test.ts`: proofs of charging stations of epoch 2, as an app checks them.
- `tests/replay.test.ts`: the whole history of `QA`, both epochs, commit by commit, with every checkpoint.
- `tests/build/bundle.test.js`, `tests/browser/browser.test.ts`: the bundle and the browser, as above.

To check a run of your own of the C# examples, with its new keys:

```bash
npx tsx examples/validate-examples.ts D:\Coding\OpenChargingCloud\WWCP_POI\examples\csharp
```


## License

[GNU Affero General Public License v3.0](LICENSE), as WWCP_POI.

Copyright 2014-2026 GraphDefined GmbH
