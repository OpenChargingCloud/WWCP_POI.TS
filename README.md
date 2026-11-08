# WWCP POI for TypeScript

[![CI](https://github.com/OpenChargingCloud/WWCP_POI.TS/actions/workflows/ci.yml/badge.svg)](https://github.com/OpenChargingCloud/WWCP_POI.TS/actions/workflows/ci.yml)
[![Nightly](https://github.com/OpenChargingCloud/WWCP_POI.TS/actions/workflows/nightly.yml/badge.svg)](https://github.com/OpenChargingCloud/WWCP_POI.TS/actions/workflows/nightly.yml)
[![npm](https://img.shields.io/npm/v/@open-charging-cloud/wwcp-poi)](https://www.npmjs.com/package/@open-charging-cloud/wwcp-poi)

Verifies what a roaming network of [WWCP/POI](https://github.com/OpenChargingCloud/WWCP_POI) publishes about its
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

**0.3.0 was published to npm on 8 November 2026.** It reads, refuses and applies versions, change sets and histories as
WWCP_POI3 does, in its words, and adds EV Taler phase 2. See [the changelog](CHANGELOG.md) for the changes and
migration requirements: versions, change sets and signatures 0.2.0 took are refused. The experimental profiles below
remain experimental; a package release does not establish production witness services or independently verified
actual measurement time.

**Milestone 1: the examples of WWCP_POI, checked in TypeScript.** The examples A1 to A15 of
[WWCP_POI/examples](https://github.com/OpenChargingCloud/WWCP_POI/tree/master/examples) are checked from what the C#
examples publish, as their `Validate()` methods check them, and the same for proofs of charging stations the C#
implementation makes: in the tests from the run of WWCP_POI `045e180` vendored here, and every night from a new run of
WWCP_POI master, with new keys. EV Taler phase 2, which example A16 shows, is checked on the proof of example A15 and
probed against WWCP_POI3; what example A16 publishes is not checked yet. See [Tests](#tests).

What a review of the C# implementation found while porting it is in
[docs/csharp-review.md of WWCPPOIConformanceTests](https://github.com/OpenChargingCloud/WWCPPOIConformanceTests/blob/master/docs/csharp-review.md),
cited here as *csharp-review N*.

Whether both implementations really calculate, take and refuse the same is the business of
[WWCPPOIConformanceTests](https://github.com/OpenChargingCloud/WWCPPOIConformanceTests): golden test vectors, run against
this library and the C# implementation alike, and where they differ, written down and pinned
([docs/implementation-deviations.md](https://github.com/OpenChargingCloud/WWCPPOIConformanceTests/blob/master/docs/implementation-deviations.md)).
This repository vendors the vectors and runs them in its own suite (`tests/conformance.test.ts`).


## Installation

From npm, as [`@open-charging-cloud/wwcp-poi`](https://www.npmjs.com/package/@open-charging-cloud/wwcp-poi):

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
checked.station.manufacturer?.model;                 // its model, as its manufacturer states it: revisions, firmware, ratings
checked.station.energyMeters;                        // with their public keys, for transparency software
checked.station.energyMeterModels;                   // per meter: its manufacturer and model
checked.station.certificates;                        // of the station and its meters: each for a model, with its components
checked.station.transparencySoftware;                // per meter: the release, its manufacturer, the certificates naming it
checked.prices.get('EVSE:DE*GEF*E1*1')?.statement;   // the price statement valid now, signed by DE*GEF
checked.documents;                                   // as they came: keep them as evidence of the session
```

What is checked (sections 8.4 to 8.6, 12.4 of the specification):

- the proof leads to a root, the `effectiveTree` ETag of a version of the roaming network;
- the key statement of the roaming network operator the proof gives is signed by identity keys the trust anchor pins, of
  as many holders as its `minConsensus` requires, counted as the trust anchor names them per holder, names their holders
  so as well, and is valid now;
- attestations of that root, valid now - signed then or before, until their `validUntil`, at most a day later - by
  signing keys of the operator, valid when they attested and now, each certified by a trusted identity key of its
  holder, come from as many holders, each counted for the holder of that identity key as the trust anchor knows it;
- each price statement is signed by a signing key of the charging station operator that the proof gives and that may sign
  `priceStatements`, names only charging tariffs of its EVSE, and chains with the statements before it; it is current no
  longer than its key.

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

Who checks the meter (example A13): the certificates the station and its energy meters name, each of a conformity
assessment body for a model of charging stations or of energy meters, in hardware revisions and firmware versions, with
its components, the transparency software and, of a station, the meters it mounts; and the transparency software each
meter, and a station signing measurements itself, names with its legal status, proven by the certificates naming it.
POI proves who states them, not that they are true. `statedBy` tells whether the body states a certificate or the
roaming network operator in its place, as the certificate says, and `forThisModel` whether it is for the model, the
hardware revision and the firmware version of what names it (csharp-review 15, 16, 17).

```ts
for (const { namedBy, certificate, body, statedBy, forThisModel } of station.certificates)
    console.log(namedBy.entityId, certificate['@id'], certificate['legislation'], body['@id'], statedBy, forThisModel);

for (const { namedBy, legalStatus, release, manufacturer, certificates } of station.transparencySoftware)
    console.log(namedBy.entityId, legalStatus, release['version'], manufacturer['craRole'], certificates.map(({ certificate }) => certificate['@id']));
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

// Examples A4 to A6: join from the snapshot of a checkpoint, anchored in the trust anchor (10.5): its checkpoint signed as
// the roaming network operator by the holders the trust anchor requires; a snapshot of the head instead by the
// attestations it carries. Then take the commits since one by one, each checked as section 5.2 says: its change set
// signed by its owners, fitting the head, leading to the ETags of the commit. Signed commits and checkpoints are taken
// only with a verifier of their signatures.
let trust = version.trust;
const history = History.fromSnapshot(checkpointSnapshotJSON, {
    trustAnchor: TrustAnchor.parse(qrCodeText),
    verifyCommit: (commit, before, after) => {
        trust.verifyOperatorSignatures(commit.signatures, (s, key) => commit.verifySignature(s, key), 'the commit');
        trust = trust.followedBy(after);        // the keys its operator states anew, signed by those trusted
    },
    // A checkpoint is taken with the signatures that verified here, the others left out (S39).
    verifyCheckpoint: checkpoint => verifyCheckpointSignatures(checkpoint, trust, { witnesses, requiredWitnesses: 2 }).verified,
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
| Keys, thumbprints, signatures | EC2, OKP, AKP and RSA COSE keys, read in the words of WWCP_POI; all signature algorithms of section 4; the key usages `infrastructure`, `tariffs`, `priceStatements`, `models`, `software`, `certificates`, `payments`, `party` |
| Trust anchors | QR code (`WWCP/TA-2:` and Base45 of CBOR), URL and JSON forms, read and written; key statements followed by succession |
| Roaming networks | ETags `json`, `cbor`, `effectiveTree`; the roaming network operator, its key statement and certificates; the keys of every party and of the roaming network operator as WWCP_POI reads them, none twice, none both a signing and an identity key, no identity key naming usages; the identifications unique within the network (grid connection points, energy meters, parking entities, transparency software releases and certificates, energy meter templates and groups, groups of operators and providers, offers), each once, compared as the C# types compare them; transparency software releases and certificates identified under the manufacturer or body that has them (SPECIFICATION.md 4.1): its `@id`, a colon and a name without one, the prefix compared without case, also after a change set; hardware revisions, firmware versions and serial numbers as WWCP_POI reads them, not empty, no whitespace at either end, those of a model each once; certificates as WWCP_POI reads them, for exactly one model, with its versions and releases; the conformity assessment bodies issuing them as WWCP_POI reads them, a notified body number of four digits for one body only, the legislations they are notified for neither empty nor twice, in their ordinal order, a certificate only under one of them; the content as WWCP_POI writes it (SPECIFICATION.md 2): what it takes and writes otherwise is refused, as written again it would be another text than the one hashed (ordered lists out of their order or with untrimmed texts, lists it leaves out given empty or writes also empty left out, properties given as null, embedded objects naming a JSON-LD context, texts in languages not as Styx writes them or empty, timestamps not UTC to the millisecond, entities without their lastChange, parties without their name, identifications given as numbers, properties of keys and of EV Taler merchants and exchanges it does not read, their base URLs and currencies not as it writes them); the roaming network operator, its key statement and certificates, the tree hash algorithms and the identifications of entities in the words of WWCP_POI.; of every entity what its type in WWCP_POI3 neither writes nor reads, and values it writes otherwise (trimmed, with a scheme, in its case, coordinates as doubles, numbers, booleans and texts as their types, durations in whole ticks, opening times as Styx writes them, NUTS codes in upper case, countries of addresses by their alpha-3 codes), in the words of its written form since 3de830a ("the content leaves it out", "the content holds it as …"). Every entity WWCP_POI3 reads, as it reads it, refused in its words and order (`reading.ts`): JSON types, mandatory properties, values, identifications, names of enumerations, currencies, URLs, timestamps, texts in languages, data licenses, and what the constructor of each entity refuses of what it read; the references the constructor of the roaming network checks, with the identifications unique within it, in its order (`references.ts`): manufacturers, models, hardware revisions, firmware versions, releases, certificates, grid connection points, charging stations, parking spaces and maintainers the network has, stations and meters within what their models allow, no key of two parties; time zones of charging pools and their templates of a region of the IANA time zone database, as it writes them, which the platform knows; charging tariff offers of an operator not overlapping, in the time zones of their EVSEs, and of an e-mobility provider not made to overlap by a change set of it (`offers.ts`); measurement public keys and their certificates as WWCP_POI3 checks them with BouncyCastle (`measurementPublicKey.ts`): DER, RSA, EC of the 84 named curves BouncyCastle knows, Ed25519, Ed448, X25519, X448, DSA, ML-DSA, ML-KEM, SLH-DSA, each certificate issued by the next one. Taken as given, where WWCP_POI3 checks them: points on curves over binary fields, explicit curve parameters, keys of Diffie-Hellman, ElGamal, GOST and DSTU |
| Effective members (9.2) | EVSEs, charging stations, charging pools, charging tariffs, energy meters. Parking spaces and energy meters of grid connection points taking templates are refused, not calculated |
| Proofs (8.4), attestations (8.5) | complete, with the manufacturers and models of the station and its meters, the transparency software releases and certificates of the meters; subject attestations do not count for a whole proof; whether a proof gives a child array of an entity completely, and its size also where it gives some or none (`givesCompletely`, `sizeOf`) |
| Change sets (4) | `Add`, `Remove`, `UpdateProperty`, `RemoveProperty` of parties (charging station operators, e-mobility providers, grid and parking operators, charging station and energy meter manufacturers, transparency software manufacturers, conformity assessment bodies), the roaming network and its operator, of charging pools, stations, EVSEs, tariffs, templates and groups of charging station operators, energy meter templates and groups, models of manufacturers, transparency software releases and certificates, with their owners' signatures, quorum and proof of possession, and the properties a change set may change: not the version of a release, also not by removing it and adding it again; the `notifiedBodyNumber` and `notifiedFor` of a conformity assessment body by the roaming network operator only. The charging tariff offers of operators and providers, the groups of providers, the grid connection points of grid operators, the parking data of parking operators and the parking spaces of operators, owned by the party embedding them, a grid connection point by its maintainer. `AddElement`, `RemoveElement`, `ReplaceElement`, `UpdateElementProperty`, `RemoveElementProperty` of all of these, by their element path, as WWCP_POI3 applies them (`elements.ts`): as the change of the property of the entity their path starts with, owned and checked as that change, their old value compared with the element they address; keys and tree hash algorithms changed as a whole only. The properties of infrastructure a change set may change, as WWCP_POI3 names them. Preconditions as WWCP_POI3 checks them (`preconditions.ts`): the ETag an entity still has in the version a change set is applied to, over its representation as the roaming network embeds it, in JSON or CBOR, the entity found by its type and identification as its type compares it. Stamped as WWCP_POI 12e993a stamps it (S5): the lastChange of the network, of what it changes, adds and embeds, and the created of what it adds without one, are its createdAt, or the lastChange of the version it is applied to where that is later, so that no lastChange goes back; its keys are checked at its createdAt. The references and the identifications unique within the network are checked after the last change, as the C# implementation checks them there, in its words and order; what an entity refuses as it is read keeps the words of a version, without the `Change N:` of the C# implementation |
| Histories (5, 10, 11) | linear histories from snapshots, anchored in the trust anchor as a peer of WWCP_POI starts (10.5): a snapshot of a checkpoint by the checkpoint, signed as the roaming network operator, a snapshot of the head by its attestations, none without a trust anchor unless taken unanchored explicitly; its `effectiveLastChanges` read as WWCP_POI reads them, not taken, as the effective tree takes none (8.1); commits, checkpoints, their lines and signatures, signatures read as WWCP_POI reads them (texts trimmed, none empty), signed ones only with a verifier, checkpoints taken with the signatures that verify here, the others left out (S39), the roles they must be signed in (`requiredSignatureRoles`, `requiredCheckpointSignatureRoles`), a role of a commit only by a key its version lets sign in it (`keyMaySignIn`), the signatures of one key in one role counted once; proofs of commits, archive segments; epochs: their profiles, the final checkpoint, the genesis of the next epoch, its first checkpoint. Merges are not taken yet; no peer, no server |
| Price statements (12) | statements, chains, checkpoint trees and proofs in every epoch |
| Runtime status (12.5) | status updates, frames of the WebSocket, the runtime status of a snapshot. No WebSocket client: the app brings its own |
| QI-Digital documents | a proof of concept of WWCP_POI, as example A14 uses it: digital calibration certificates, digital certificates of conformity of a model or of the quality system of a manufacturer, digital declarations of conformity, read in the words of WWCP_POI and checked against a roaming network (the keys of their issuers, the models, the charging stations and energy meters as they are at runtime) and against each other (a declaration and the certificates it names, a certificate and the meter it covers). Their signature input is what WWCP_POI writes again of what it read, numbers without trailing zeros. Read and checked, not signed |
| EV Taler | phase 1 of WWCP_POI's concept of paying for charging with GNU Taler: the merchant of a charging station operator (`evTaler`), read and refused as WWCP_POI reads it, changed by a key that may sign `payments`; payment options an open set of names, none twice whatever its case; the payment option EVTaler of a charging pool or template only with a merchant; the EV Taler tariff of an EVSE and the exchanges in its currency, from the proof of its station (`evTalerTariffOf`, `evTalerExchangesAt`, `paymentOptionName`). Phase 2, as WWCP_POI c2d39e5 checks it (`src/evTaler`): the contract terms of the steps of a session (`EVTalerContractTerms`, version 0), their step in `extra.wwcp` (`EVTalerStep`), a `taler://pay` URI (`EVTalerPayURI`), checked against the proof of the station: the operator's merchant and exchanges, the EV Taler tariff of the EVSE (`evTalerTariff`), the price statement current when the session began, each step following the one before, from step 2 on the signed meter value at the start verified with a measurement key the proof gives by a transparency software passed in (`EVTalerMeterValueVerifier`; WWCP_POI reads no format of a meter), the amount of a step recalculated where the prices are of the simple profile (`EVTalerRates`), as System.Decimal calculates it (`NetDecimal`); the settlement statement (`EVTalerSettlement`), signed by the operator with a key for `payments`, refused without both signed meter values, its price recalculated. Nothing here takes or makes a payment, nor signs a settlement |

Whatever is not ported is refused with a `POIError` saying so, but for what the row of roaming networks names as not
yet ported: the library takes no other version the C# implementation refuses.
And whatever it calculated otherwise than the C# implementation would end in other ETags or identifications, and be
refused as well.


## Local authorization and shared trust contexts

An app that lets its users import a trust anchor before they trust its keys does not hand that anchor to a verifier: a
verifier given a `TrustAnchor` trusts every identity key it pins. The app evaluates a `TrustContext` instead, from the
identity keys it trusts locally:

```ts
import { ChargingStationProof, RoamingNetworkOperator, TrustContext, verifyChargingStation } from '@open-charging-cloud/wwcp-poi';

// The key statement and the identity keys of the operator as the proof gives them: trusted only once evaluated.
const proof     = ChargingStationProof.parse(proofJSON);
const operator  = RoamingNetworkOperator.parse(proof.roamingNetwork['operator'], anchor.id);

if (operator.keyStatement !== undefined) {

    const result = TrustContext.evaluate(anchor, operator.keyStatement, {
        trustedIdentityKeyIds:  locallyAuthorizedKeyIds,
        otherIdentityKeys:      operator.identityKeys,
        at:                     Date.now()
    });

    // Show signatures, signers, quorum and validity apart. canTrustKeys allows importing
    // validly signed data even without a trusted quorum.
    if (result.context !== undefined) {
        const station = verifyChargingStation(result.context, proof, { evseId: 'DE*GEF*E1*1' });
    }

}
```

`TrustContext.evaluate` keeps of the holders of the trust anchor the identity keys the app trusts, and checks every
signature of the key statement and that its key was valid when the statement was signed, that the statement is valid at
`at`, that it names the holders of the trusted keys as the trust anchor does, and that trusted keys of as many holders
as the larger of both quorums signed it. Two trusted keys of one holder still count once. A context exists only when all
of that holds; `TrustContext.create` evaluates the same and throws otherwise.

The context binds what is verified with it to the roaming network, its operator and the signed content of the key
statement, which a statement embedded without its JSON-LD context gives as well. Another key statement, even one signed
genuinely, needs another evaluation: a context does not follow the keys of the operator to their successors by itself.
Other valid signatures, or the same in another order, do not change the content; every signature given and the trusted
quorum are checked again.

`OperatorTrust.of` and `fromOperatorJSON`, `verifyVersion`, `verifyChargingStation`, `ChargingStationProof.verify` and
`verifyCheckpoint` take a context in place of a trust anchor. A context is evaluated for one time: `at` is that time or
left out, another time needs another context. Given a trust anchor, they verify as before, trusting every key it pins.
The other APIs taking a trust anchor, among them `verifyEvidence` and `POIClient`, take only one the app has authorized:
they are no way around its local policy.

The app keeps storing and showing its decisions, choosing keys and excluding them locally. It reads its current
decisions consistently and creates a context from them for every verification: a context is no authority to store, nor
to use again after a key was withdrawn or deleted or the policy changed, and does not see what changes after it was
created. The library needs no IndexedDB, localStorage, network, DOM, Node or anything of an app.

Removing a pinned key from the local roots removes the trust it started with. A key statement signed by the quorum may
still name it among its identity keys and so delegate to it: excluding a key locally is no global revocation or deny
list. Revocation and verified succession need policies of their own. Unknown imports, invalid evidence and expired data
never give an authorized context.


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
`@vanaheimr/cose` and `@vanaheimr/metrological-cbor`, and as `npm audit`. The C# implementation as it is today is checked
every night by [WWCPPOIConformanceTests](https://github.com/OpenChargingCloud/WWCPPOIConformanceTests): its nightly run
holds WWCP_POI master and this library to the same golden vectors, and runs the C# examples of WWCP_POI master anew,
checked with `examples/validate-examples.ts` of this repository, which turns red the day WWCP_POI moves on and this port
needs work.

The test vectors are in `tests/vectors`, vendored from
[WWCPPOIConformanceTests](https://github.com/OpenChargingCloud/WWCPPOIConformanceTests), where they are generated -
never edit them here, and its `VendoredCopiesTests` fail when these copies drift:

- `tests/vectors/poi-*.json`, the golden vectors: canonical JSON and CBOR, Base64 and Base45, the examples of section 6
  of the specification, station proofs of its example network signed with its keys against a trust anchor, what to
  calculate of the documents of the run below, documents to refuse, the QI-Digital documents of example A14 of that run
  taken and refused as WWCP_POI checks them, small histories WWCPPOIConformanceTests signs itself, replayed step by
  step, and the verifier extensions (`poi-verifier.json`) checked against the fixtures of ChargyWebApp below as
  WWCP_POI3 checks them (the format: the
  [README of the vectors](https://github.com/OpenChargingCloud/WWCPPOIConformanceTests/blob/master/test-vectors/README.md));
- `tests/vectors/csharp-045e180`, what one run of the C# examples A1 to A15 of WWCP_POI at commit `045e180` published
  (public data only; its output is `csharp-output.log` there), and in `proofs/`, what `proofs/MakeProofs.cs.txt` made of
  the same history with the C# implementation: proofs of charging stations of epoch 2, the commits of epoch 2 up to the
  head, revision 11 after the EV Taler merchant of example A15, and the ECDSA twin of a price statement;
- `tests/vectors/chargy-fc513cd`, the POI fixtures of ChargyWebApp at commit `fc513cd`, which `poi-verifier.json` names
  its documents in: histories, prices, publications, sessions and trust transitions;
- `tests/vectors/chargy`, what WWCPPOIConformanceTests makes of them itself, which `poi-verifier.json` names with
  `"documents": "chargy"`: in `POIPrices/`, the price evidence of sessions as ChargyWebApp made it, every signature
  deterministic.

- `tests/conformance.test.ts`: the golden vectors, as the C# implementation runs them in WWCPPOIConformanceTests.
- `tests/canonical.test.ts`, `tests/specification.test.ts`: the test vectors of Styx and of section 6 of the
  specification.
- `tests/exampleA1.test.ts`, `tests/examples.test.ts`: the examples A1 to A9, epoch 1, the manufacturers and the models
  they state among them.
- `tests/evidence.test.ts`: example A10, the evidence a driver's app keeps, and ECDSA twins of price statements.
- `tests/exampleA11.test.ts`: example A11, epoch 2, followed with the old trust anchor and joined with the new one.
- `tests/exampleA12.test.ts`: example A12, the runtime status and the commit pushed over the WebSocket.
- `tests/exampleA13.test.ts`: example A13, transparency software manufacturers, conformity assessment bodies, and who
  checks the meter.
- `tests/qidigital.test.ts`: example A14, the QI-Digital documents of a meter as WWCP_POI signed them, and others signed
  with the keys of section 6 of the specification, to change them at will.
- `tests/chargingStation.test.ts`, `tests/client.test.ts`: proofs of charging stations of epoch 2, as an app checks them.
- `tests/replay.test.ts`: the whole history of `QA`, both epochs, commit by commit, with every checkpoint.
- `tests/reading.test.ts`, `tests/references.test.ts`: `QA`, and `QA` with an entity of every kind
  (`tests/richNetwork.ts`), changed as WWCP_POI3 at 89d2e02 refuses them, in its words.
- `tests/build/bundle.test.js`, `tests/browser/browser.test.ts`: the bundle and the browser, as above.

To check a run of your own of the C# examples, with its new keys:

```bash
npx tsx examples/validate-examples.ts D:\Coding\OpenChargingCloud\WWCP_POI\examples\csharp
```


## Shared trust and session verification in 0.2.0

These APIs were previously supplied in the unpublished 0.1.2-dev.0 candidate. WWCP_POI3 has them as well
(`WWCP_POI3/Verifier`), except for the local journal of observed versions, which is the app's. The versioned historical
and session-price evidence, compact trust delegation and publication-receipt profiles remain experimental; they do not
change the strict standard Evidence schema. See [Migration](CHANGELOG.md#migration) before upgrading a consumer.

### Meter-key association

`verifyMeterKey(context, proof, { evseId, meterSerialNumber, keyFormat: 'spki-der' })` re-verifies the original proof
with a locally authorized `TrustContext`, selects only that EVSE's directly associated meter and requires an exact
serial match. Multiple keys require an explicit `keyId`; it never searches unrelated meters or tries keys until one
verifies. No fallback to CPO/RNO signing keys is performed.

The first pilot supports public uncompressed ECDSA P-256 measurement keys. `parseMeasurementPublicKey(value, 'spki-der'
| 'cose-key')` requires an explicit format: it checks SHA-256(SPKI) or the deterministic COSE key thumbprint as
appropriate, validates the point and produces a canonical COSE key/material ID. It retains the original ID and its
derivation scheme. Unsupported algorithms and ambiguous associations fail explicitly rather than becoming trusted keys.

The result carries RN/RNO, EVSE, station, meter, original/canonical key identity, commit/revision/root, KeyStatement
digest, evaluation time and a conservative expiry bounded by the counted attestations and their certified keys. It is a
current-snapshot observation, not historical key-rotation/installation evidence or a permanent authorization token.
Reconstruct local authorization for each operation. Future station-owned measurement signers and additional key formats
need explicit association rules; they are not guessed by this pilot.

The portable public test vector `tests/vectors/meter-session.json` originates from ChargyWebApp commit 97da24d
(`tests/fixtures/POISession`); its source manifest is `meter-session-meta.json`. It contains public demonstration keys
only.


### Historical meter evidence

`parseHistoricalMeterEvidence` and `verifyHistoricalMeterEvidence(currentContext, value, request, policy?)` keep current
local authorization separate from historical validity. The request supplies the actual original reading times, EVSE,
meter serial and explicit key format. Expired historical statements and operational certificates are checked at those
times; each later checkpoint uses its own supplied operator and signature times. The output is an immutable per-time
binding for Core, not a serialized trust token.

The versioned `historicalMeterEvidence/v1` envelope is a TS-library extension, not a change to the existing strict
Evidence schema. It contains `EVSEId` and `versions`, each with `chargingStationProof`, optional `commitProof`, and
optional `checkpoints` entries shaped as `{checkpoint, operator}`. Missing inclusion stays visible; malformed supplied
inclusion fails. Prices are not required just to verify a meter assignment. Only caller-authorized witnesses/revocations
count. `invalidFrom` compromise times apply to signature times or measurement-key use; ordinary expiry does not
retroactively invalidate a valid historical signature. An unauthorized current quorum still blocks all checks. Identity
succession not connected to today's authorized pins fails closed.

The claim is RNO attestation at the signed measurement times and optionally checkpoint inclusion. Independently
established actual time, sole/latest membership, complete owner-signed change replay and checkpoint continuity are not
inferred. A checkpoint obtained later does not prove it was public before charging. No full network archive is
downloaded. See the app's illustrated historical-session guide for integration.


`HistoricalTrustContext.create(anchor, savedReferenceStatement, {trustedIdentityKeyIds, otherIdentityKeys?, now?})`
authorizes historical checks from fresh caller-supplied local decisions. It verifies the saved reference at its own
signed time; expiry today does not require a server or a newly issued statement. Its one-minute validity bound is an
operation deadline, not historical document validity. Recreate it for each check and reread local authorization after
async work. Current `TrustContext` remains the separate path for fresh/current station checks. Unknown identity
succession still fails.


### Session-bound prices

`verifySessionPriceEvidence` verifies the attested station at the original start, CPO PriceStatements with existing
generic algorithms (including Ed25519 and ML-DSA), usage/validity, entity/tariff references, supplied chains and
explicit selection. `SessionPriceAgreement` binds the exact original start document SHA-256, meter/EVSE, time, tariff,
statement digest, mode and binding/profile in a CPO signature. This is a CPO assertion, not customer consent. Unknown
agreements never authorize themselves. The experimental `chargy-gross-rates/v1` profile fixes unconditional gross rates
at start. EMP contracts, variable bindings and unsupported restrictions stay unproven.

Checkpoint authority is shared with historical meter verification. Price inclusion, `after` links/continuity, selected
statement identity and related checkpoint forks are checked separately. A later checkpoint never proves pre-start
publication, independent time or sole/latest offer. Original decimals are preserved. There is no P-256-only restriction
on CPO price/assignment signatures. See the app's price guide.


### Locally observed versions

`compareObservedVersions` is a pure, shared policy for monotonic current selection and persistent authenticated
contradictions. Metadata projection helpers for station proofs, checkpoint positions/root revisions and PriceStatements
do not authenticate anything: call the usual role, quorum, subject and validity verifiers before recording them. The
caller owns durable storage and must compare and replace the state atomically. The app uses a separate IndexedDB journal
scoped to the exact local anchor policy and authenticated RN/RNO identity.

Current selection rejects known rollbacks, unresolved forks, missing checkpoint, price or live predecessors, and
unverified epoch changes. Historical inspection allows older coordinates and never advances current heads. Authenticated
gaps and rejected conflicting originals remain negative knowledge. A rejected gap cannot advance its head by
resubmitting the same tip. Station snapshots permit revision jumps without claiming commit ancestry. Limits are 4096
points and 128 conflicts; storage must fail closed rather than silently evict history. These local rules establish
neither global freshness nor independently authorized witnesses.


### CPO envelope authority and compact trust succession

`verifyChargingDocumentKeys` re-verifies the original station/EVSE proof, exact CPO, document-time validity and the
explicit `chargeTransparencyRecords` usage (or an unrestricted party key). It returns normalized COSE material for the
shared Core envelope verifier; a price-only key does not authorize document signing. This is independent of the
P-256/OCMF meter pilot.

A transition names the policy it continues by `trustPolicyId(anchor)`: the SHA-256 of the canonical JSON of `{network,
holders, minConsensus, urls}`, the URLs as a WHATWG URL serializes them without trailing slashes, in their ordinal order,
as WWCP_POI3 calculates it. `TrustTransition` and `VerifiedTrustTransition` implement an experimental compact delegation
certificate, signed by both old authorized and target identity holder quorums, binding exact policies, statements,
sources and predecessor. It is not History owner/change-set replay and does not misuse `followedBy`.
`applyVerifiedTrustTransition` preserves negative journal knowledge while adopting explicit policy delegation and exact
final-checkpoint/genesis/first-checkpoint epoch evidence. Unverified epoch jumps and quorum reductions fail closed.
`TrustContext.withEpoch` carries verified profiles into subsequent proof checks; historical contexts can carry a
reverified authority timeline. These objects are recreated from local decisions and original evidence, never serialized
green flags. See the app's illustrated trust-succession guide and genuine public fixtures.

### Independent price publication receipts

`parseWitnessPublicationPolicy` parses separately authorized organization, network, key and clock decisions. Parsing a
recommendation grants no trust. Pass the accepted policy as `publicationPolicy` to `verifySessionPriceEvidence`; its
optional `publicationReceipts` and `witnessCandidates` do not authorize themselves. `PricePublicationReceipt` signs a
versioned public-retrieval assertion for the exact selected price/EVSE/network/checkpoint and public source. The
experimental key usage is `witnessPublications`; existing usage restrictions still apply.

The result `publicationBeforeStart: 'witnessed-before-signed-start'` requires the separate distinct-organization quorum,
valid original signatures and inclusion, and every counted latest signing bound (including locally accepted clock error)
strictly before the original signed start. Several keys/aliases of one approved organization count once; reused key
material cannot create another organization. Known RNO/CPO key material is excluded from independent witnessing. Actual
clock accuracy and organizational independence remain explicit caller trust assumptions. The physical charging start,
global latest/sole offer, customer consent and final billing are not independently proven. This is not an RFC 3161
implementation.

`tests/vectors/price-publication.json` contains public Ed25519/ML-DSA-65 vectors and negative timing, scope, signature
and duplicate-organization cases. The caller must reread current policy across asynchronous work and persist original
receipts, never serialized green verdicts. No production witness service is implied.

Publication receipts additionally bind `priceStatementSHA256` (the complete original CPO-signed object including its
signature value) and `tariffSHA256` (the exact selected tariff including its currency). The ordinary statement digest
excludes its signature value and cannot alone prove that a signed offer, rather than its draft, was retrieved.
`pricePublicationOfferHashes` computes these bindings consistently for generators and callers. Neither alternate
signature encodings nor changed tariff definitions reuse another original's receipt.


## Publishing

Version 0.3.0 is available on npm. The commands below record its release procedure. For a future release, choose a new
version and replace the version, tag and archive names below; published versions are immutable. Update package.json,
package-lock.json and the release notes, then validate the source and inspect the package before approving a release:

```bash
npm ci
npx playwright install chromium
npm run verify
npm run examples
npm pack --dry-run
npm pack
```

After release approval, finalize this README and the changelog with the actual release status and date, rebuild and
check the final archive. Commit the reviewed release files, then tag and push that exact commit to each configured
remote:

```bash
git tag -s v0.3.0 -m "v0.3.0"
git push origin master v0.3.0
git push git1 master v0.3.0
git push git2 master v0.3.0
```

Publish the inspected archive only after that separate approval:

```bash
npm login
npm whoami
npm publish ./open-charging-cloud-wwcp-poi-0.3.0.tgz --access public
```

Consumers read [Migration](CHANGELOG.md#migration) and move to `@open-charging-cloud/wwcp-poi@^0.3.0`, which a range of
`^0.2.0` does not take, then refresh their lockfile and verify a clean install.


## License

[GNU Affero General Public License v3.0](LICENSE), as WWCP_POI.

Copyright 2014-2026 GraphDefined GmbH
