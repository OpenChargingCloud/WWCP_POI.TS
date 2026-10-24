# WWCP POI for TypeScript

Verifies what a roaming network of [WWCP POI 3](https://github.com/OpenChargingCloud/WWCP_POI) publishes about its
charging stations and their tariffs, from the **trust anchor** of the roaming network alone: the QR code its operator
publishes, naming the identity keys of the operator and its quorum.

An EV driver's app selects a charging station; this library downloads the proof of the station and the price statements
of its EVSEs, and checks that the station, its EVSEs as they are at runtime, the charging tariffs they take and the
prices of the moment are the ones the roaming network operator attested and the charging station operator signed - before
charging begins. Months later, e.g. disputing an invoice, the evidence the app kept proves which price applied, witnessed
by checkpoints. The same proof gives the public keys of the energy meters, with which
[ChargyCore.TS](https://github.com/OpenChargingCloud/ChargyCore.TS) checks the signed meter values of the session.

Everything is calculated as the C# implementation calculates it, byte for byte: the canonical JSON and the deterministic
CBOR of Styx, ETags, the effective tree with templates (section 8 of the specification), commit and checkpoint
identifications, COSE keys and their thumbprints, and the signatures ES256/384/512, Ed25519, Ed448 and ML-DSA-44/65/87.


## Status

**Milestone 1: the examples of WWCP_POI, checked in TypeScript.** The examples A1 to A9 of
[WWCP_POI/examples](https://github.com/OpenChargingCloud/WWCP_POI/tree/master/examples) are checked from what the C#
examples publish, as their `Validate()` methods check them, and the same for proofs of charging stations the C#
implementation makes; also from a fresh run of the C# examples, with new keys. See [Tests](#tests).

What a review of the C# implementation found while porting it is in [docs/csharp-review.md](docs/csharp-review.md).


## Installation

```bash
npm install @open-charging-cloud/wwcp-poi
```

ESM, Node 20.19 or newer, browsers and React Native alike: no `node:*` module, no `Buffer`, no WebCrypto. The
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
checked.station.energyMeters;                        // with their public keys, for transparency software
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

Without the client, the same with documents of any source:

```ts
import { TrustAnchor, verifyChargingStation, verifyPriceStatements } from '@open-charging-cloud/wwcp-poi';

const anchor   = TrustAnchor.parse(qrCodeText);
const station  = verifyChargingStation(anchor, proofJSON, { evseId: 'DE*GEF*E1*1' });
const prices   = verifyPriceStatements(station, priceStatementsJSON);
```

Months later, the evidence of the session (example A10 of WWCP_POI): the station proof attested and the price statement
valid as charging began, the commit of the station proof and the statement each proven to be part of checkpoints the
trusted witnesses signed:

```ts
import { verifyEvidence, parseTrustedWitnesses } from '@open-charging-cloud/wwcp-poi';

const evidence = verifyEvidence({ trustAnchor, evseId, chargingStarted, chargingStationProof, priceStatements,
                                  commitProof, priceStatementProofs, checkpoints },
                                { witnesses: parseTrustedWitnesses(witnessesJSON), requiredWitnesses: 2 });
```


## A charging station operator, a witness, a server: versions and histories

```ts
import { History, TrustAnchor, verifyVersion, verifyCheckpointSignatures } from '@open-charging-cloud/wwcp-poi';

// Example A1: a version of the roaming network and its commit, from the trust anchor alone.
const version = verifyVersion(TrustAnchor.parse(qrCodeText), networkJSON, commitJSON);
version.signedBy;     // [ 'AlphaOrg', 'BetaOrg', 'GammaOrg' ]

// Examples A4 to A6: join from the snapshot of a checkpoint, take the commits since one by one, each checked as section
// 5.2 says: its change set signed by its owners, fitting the head, leading to the ETags of the commit.
const trust   = version.trust;
const history = History.fromSnapshot(checkpointSnapshotJSON, {
    verifyCommit:     commit     => trust.verifyOperatorSignatures(commit.signatures, (s, key) => commit.verifySignature(s, key), 'the commit'),
    verifyCheckpoint: checkpoint => verifyCheckpointSignatures(checkpoint, trust, { witnesses, requiredWitnesses: 2 }),
});

for (const commit of commitsSince)
    history.append(commit);
```


## What is ported, and what is not yet

| | |
|---|---|
| Canonical JSON, deterministic CBOR (Styx) | complete, including Styx's string escaping and decimals as `System.Decimal` holds them |
| Keys, thumbprints, signatures | EC2, OKP and AKP COSE keys; all signature algorithms of section 4 |
| Trust anchors | QR code (`WWCP/TA-2:` and Base45 of CBOR), URL and JSON forms, read and written |
| Roaming networks | ETags `json`, `cbor`, `effectiveTree`; the roaming network operator, its key statement and certificates |
| Effective members (9.2) | EVSEs, charging stations, charging pools, charging tariffs, energy meters. Parking spaces and energy meters of grid connection points taking templates are refused, not calculated |
| Proofs (8.4), attestations (8.5) | complete; subject attestations do not count for a whole proof |
| Change sets (4) | `Add`, `Remove`, `UpdateProperty`, `RemoveProperty` of parties, registries, the roaming network and its operator, and of charging pools, stations, EVSEs, tariffs, templates and groups of charging station operators, with their owners' signatures, quorum and proof of possession. Element changes, preconditions, offers and the entities of providers, grid and parking operators are refused, not applied |
| Histories (5, 10) | linear histories from snapshots, commits, checkpoints, their lines and signatures, proofs of commits, archive segments. Merges and epochs after the first are not taken yet |
| Price statements (12) | statements, chains, checkpoint trees and proofs |

Whatever is not ported is refused with a `POIError` saying so: the library never takes as checked what it can not check.
And whatever it calculated otherwise than the C# implementation would end in other ETags or identifications, and be
refused as well.


## Tests

```bash
npm test
```

- `tests/canonical.test.ts`, `tests/specification.test.ts`: the test vectors of Styx and of section 6 of the
  specification.
- `tests/exampleA1.test.ts`, `tests/examples.test.ts`: the examples A1 to A9, from `tests/vectors/csharp-2d9511d`, what
  one run of the C# examples of WWCP_POI at commit `2d9511d` published (public data only; its output is
  `csharp-output.log` there).
- `tests/chargingStation.test.ts`, `tests/evidence.test.ts`, `tests/client.test.ts`: proofs of charging stations, the
  attestations of the head and a proof of a commit the C# implementation made of the same history
  (`proofs/MakeProofs.cs.txt`).
- `tests/replay.test.ts`: the history of `QA` from its genesis, commit by commit.

To check a run of your own of the C# examples, with its new keys:

```bash
npx tsx examples/validate-examples.ts D:\Coding\OpenChargingCloud\WWCP_POI\examples\csharp
```


## License

[GNU Affero General Public License v3.0](LICENSE), as WWCP_POI.

Copyright 2014-2026 GraphDefined GmbH
