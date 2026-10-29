# Changelog

## Unreleased

S31 and S32 of WWCP_POI `d6b0127`. A release keeps its version: a new version is a new release, so that a
certificate naming a release names the version that was assessed. A change set updating or removing the `version` of a
transparency software release is refused, and so is one removing a release and adding it again with another version,
after its last change (`ChangedTransparencySoftwareVersion`; versions compared trimmed and without case, as
`TransparencySoftwareVersion` compares them). The `notifiedBodyNumber` and `notifiedFor` of a conformity assessment
body are the roaming network operator's, which vets the body, also once the body has keys: a body issuing a
certificate under a legislation the same change set adds to its `notifiedFor` signs it together with the operator. A
number names one body, in every version and after every change set (`DuplicateNotifiedBodyNumber`).
`tests/releasesAndBodies.test.ts`, after `A_release_keeps_its_version` and
`The_roaming_network_operator_says_what_a_body_is_notified_for`.

A conformity assessment body is refused as its constructor in WWCP_POI refuses it, in its words and order: a
`notifiedBodyNumber` not of four digits (as `^[0-9]{4}$` of .NET matches it, also before a last line feed), a legislation
of `notifiedFor` empty or given twice (with case), a certificate issued under a legislation it is not notified for
(exactly as written, its certificates in the ordinal order of their identifications), each wrapped as WWCP_POI wraps it,
e.g. "The given JSON representation of a conformity assessment body is invalid: The certificate 'PTB-2026-0042' is issued
under the legislation 'CRA', which the conformity assessment body 'PTB' is not notified for! (Parameter 'Certificates')";
before them a `notifiedBodyNumber` that is no text and a `notifiedFor` that is no array of texts. A version is refused
for what WWCP_POI refuses of an entity as it reads it before what it refuses of the network made of them, the
identifications unique within the network last. Checked against WWCP_POI3 itself, on 33 versions of QA: the same, but
for two refusals of one body at once, a key and its number. In a change set WWCP_POI names the change ("Change 0: …"),
this library refuses the version it leads to.

The four vectors of WWCPPOIConformanceTests `d4a4928` vendored, `poi-refusals.json` of 93 vectors: a key of a party
whose `notAfter` is written with an offset, as a date only or as null, and one whose key is another CBOR of the same
COSE key. WWCP_POI refuses them too since `72df830` (D13 there, SPECIFICATION.md 2, Written forms), as this library did;
the key not in deterministic CBOR now in its words: "Invalid COSE key: Invalid deterministic CBOR: the key of the public
key '…' is not written as the deterministic CBOR of its COSE key!"


## 0.1.0 (2026-10-29)

The first milestone: the examples A1 to A14 of WWCP_POI (commit `33447ac`) checked in TypeScript.

The findings of the review this port made of the C# implementation are cited as csharp-review N, N the number of the
finding in
[docs/csharp-review.md of WWCPPOIConformanceTests](https://github.com/OpenChargingCloud/WWCPPOIConformanceTests/blob/master/docs/csharp-review.md);
`docs/` of this repository held it up to `b9c786e`.

- Canonical JSON and deterministic CBOR of Styx; a lossless JSON parser keeping decimals as `System.Decimal` holds them.
- COSE keys, RFC 9679 thumbprints, signatures ES256/384/512, ES256K, ESP*, ESB*, Ed25519, Ed448, ML-DSA-44/65/87.
- Trust anchors (QR code, URL, JSON), key statements, certificates of signing keys; trust following the key statements
  of a history (`OperatorTrust.followedBy`).
- Roaming networks with their ETags, effective members and the effective tree; proofs of charging stations, attestations,
  the manufacturers and models of the station and its meters (`manufacturer`, `energyMeterModels`), the transparency
  software and certificates of their energy meters.
- Change sets with their owners' signatures, commits, linear histories, checkpoints, their proofs and signatures by the
  roaming network operator and by witnesses, archive segments; epochs, their final checkpoints and the genesis of the
  next one.
- Charging station and energy meter manufacturers, parties stating their models; transparency software manufacturers and
  conformity assessment bodies, parties holding their releases and certificates; the key usages `models`, `software` and
  `certificates`; energy meter templates and groups.
- Price statements, their chains, checkpoint trees and proofs; evidence of a charging session as the app of example A10
  keeps it (`parseEvidence`).
- The runtime status: status updates, frames of the WebSocket of a history, the runtime status of a snapshot.
- `POIClient`: the proof of a charging station and its prices, from the servers of a trust anchor.

Moving from the examples at `2d9511d` to `bbd4cbd` also made the ownership of changes the one of the C# implementation
where the port differed: identity keys of the roaming network operator counted for every change of a party, not only for
its keys; where it signs in place of a party without keys, its signing keys counted when they may sign `party`, not
when they may sign the usage of the change (csharp-review 13); its identity and signing keys counted alike for
everything it owns; and the signing keys of a party could not rotate its signing keys. The values of change sets are
kept in the order the C# implementation keeps them in (csharp-review 10).

Moving on to `801bbce`, the manufacturers became parties: the roaming network operator adds and removes them, they change
their own properties and state their models with a key that may sign `models`, every change of a model naming its
manufacturer. A change set changes only the properties of a party the C# implementation lets it change, so that the
models, releases and certificates of a party are not replaced as one of its properties by a key that may not sign them.
`forThisModel` of the transparency software of a meter asks for the version of the certificate among the versions of the
model as well.

Node.js 22.18 is the minimum, as of ChargyCore.TS: Node 20 has reached its end of life, and tsup 9, Vitest 5 and
ESLint 10 do not run on it. The code follows the ESLint rules of ChargyCore.TS; where a missing value used to be asserted
away, it is refused with a `POIError` saying what is missing. Tests of the bundle as published (its imports, its
declarations for TypeScript apps, the files `npm pack` takes) and of the library in Chromium join the tests in Node; GitHub
Actions run all of them on every push, and every night against floating dependencies, the newest codecs of Vanaheimr, and
the C# examples of WWCP_POI as they are.

The test vectors moved to WWCPPOIConformanceTests, which generates golden vectors - canonical JSON and CBOR, encodings,
the examples of section 6 of the specification, signed station proofs against a trust anchor, the documents of the run of
the C# examples, and documents to refuse - and runs them against this library and the C# implementation alike. This
repository vendors them in `tests/vectors` and runs them in `tests/conformance.test.ts`. The nightly check against the C#
examples of WWCP_POI master moved there as well.

The codecs of Vanaheimr are `@vanaheimr/cose` 0.10.0 and `@vanaheimr/metrological-cbor` 0.11.1: `@vanaheimr/cose` 0.9.0
brought a CBOR codec 0.10 of its own next to the 0.11 this library uses, so that an app installed two copies of it; now
there is one.

The digest of a price statement leaves its signature value out, as WWCP_POI does since `dbf39b0` (SPECIFICATION.md 12.1):
the SHA-256 of its signature input. The ECDSA twin `(r, n − s)` of a statement, which anybody can make of it, is the same
statement, of the same digest (csharp-review 2); `PriceStatement.sameSignedContent` is gone. The test vectors
are those WWCPPOIConformanceTests generates for it, with a new run of the C# examples at `dbf39b0`
(`tests/vectors/csharp-dbf39b0`).

The price statements of an entity are one chain in whichever spelling they name it, as WWCP_POI keys them since
`4680d99` (SPECIFICATION.md 12.1 to 12.3, `RoamingNetworkHistory.ChainOf`): by its type and its identification without
`*`, whitespace around it, or case (`priceStatementChainOf`, `PriceStatement.chain`), so that `DE*GEF*E1*1` and
`DE*GEF*E11` are one EVSE and a split view between them is seen. `follows` compares chains; `verifyPriceStatements`
refuses a statement naming an entity of the station otherwise than the roaming network does, before its signature is
looked at; `verifyCheckpointPriceStatements` refuses a checkpoint naming two statements of one entity and sequence with
different digests, in the order of its tree, both in the words of WWCP_POI. A sequence is at most 2^53 − 1
(`MAX_PRICE_STATEMENT_SEQUENCE`), as it was read here already. Not ported, as they bound what a server takes: a statement
more than 1,000,000 beyond the current one of its entity, and the statements a server keeps per operator for its next
checkpoint. The golden vectors hold both refusals (`tests/vectors/poi-refusals.json`, 75 vectors): the
statement of example A10 naming its EVSE as `DE*GEF*E11`, checked with the proof of its station
(`entityPriceStatement`), and checkpoint 4 naming a fourth statement of one sequence, in the other spelling and of
another price (`checkpointPriceStatements`, its control the checkpoint and its statements as published).

The holders of a quorum are counted as the trust anchor names them, as WWCP_POI does since `3e32f48` (SPECIFICATION.md
4.1, 8.6; csharp-review 1): a trust anchor names the keys per holder, the `@id` of its key or the array of the
`@id`s of its keys (`TrustAnchor.holders`; in the URL the holders separated by `,`, the keys of one holder by `;`).
`KeyStatement.verifyHolders` counts the holders as the verifier knows them and refuses a statement naming the trusted
keys otherwise; a station proof, `OperatorTrust` and the signatures of checkpoints count an attestation or a signature
for the holder of the trusted identity key that certified its key. A change set naming a key of a party with another
holder than before is refused.

A change set is identified by its content, as WWCP_POI does since `bc3b1bd` (SPECIFICATION.md 4, 5.2;
csharp-review 4): its `@id` is the SHA-256 of its canonical JSON with its `@context`, without `@id` and
signatures (`changeSetIdentification`), so that nobody commits another change set in the place of one. `ChangeSet.parse`
refuses a change set identified otherwise, and one naming change sets in `metadata.rebasedFrom` it was not rebased from;
`Commit.parse` reads the change set of a commit as well and refuses a commit with one parent whose change set has no
changes or the identification of a merge. The test vectors are those of a new run of the C# examples at `bc3b1bd`
(`tests/vectors/csharp-bc3b1bd`).

A change set gives its new values as the content holds them, as WWCP_POI requires since `80e4ccc` (SPECIFICATION.md 2,
4; csharp-review 10): a new value is applied as it is given, no longer written anew as the C# model would, and
one that names a JSON-LD context in what it embeds (custom data aside, which keeps it), gives identified elements, keys,
certificates or the lists of section 2 out of their order or twice, or a timestamp not UTC to the millisecond is
refused. An old value is compared as it is given. The test vectors are those of a new run of the C# examples at
`80e4ccc` (`tests/vectors/csharp-80e4ccc`).

An attestation gives its `validUntil`, at most 24 hours after its `signedAt`, as WWCP_POI requires since `be07037`
(SPECIFICATION.md 8.5, 8.6, 12.1; csharp-review 7): `Attestation.parse` refuses one without or valid longer
(`MAX_ATTESTATION_VALIDITY`), so that none is valid forever. The `signedAt` of an attestation or a price statement is the
choice of its signer: the signing key of an attestation counts when it is valid when it attested and at the time the proof
is checked, and a price statement is current no longer than its key.

A version naming twice an identification WWCP_POI keeps unique within the roaming network is refused, as WWCP_POI refuses
it (`DuplicateGridConnectionPoint` to `DuplicateEnergyMeterTemplate` of RoamingNetwork.cs): grid connection points, energy
meters, parking garages, spaces, sensors, space groups, space templates and products, transparency software releases and
certificates, energy meter templates and groups, the EVSE, charging station and charging pool groups of operators and
providers, and charging tariff offers, compared as their C# types compare them, without case but parking products, the
groups by the prefix of their party, `DE-GDF` as `DE*GDF` (`duplicateIdentification`). `RoamingNetwork.parse` checks every
version it reads, also the one a change set leads to: before, an operator could add a group of the identification a group
of the provider of its prefix has, and its change set was taken with the after ETags this library calculates. The golden
vectors `version-twice-*` of WWCPPOIConformanceTests hold both implementations to it, refused in the same words (`reason`).

The roaming network operator signs in place of a party without signing keys, e.g. the certificates of a conformity
assessment body or the grid connection points of a grid operator not taking part, by a signing key that may sign
`party`, as the examples certify its keys, as WWCP_POI does since `36bb176` (SPECIFICATION.md 4.1; csharp-review 13):
`checkOwnership` counts its signing keys that may sign `party` besides those that may sign the usage of the change.
A change set taken before is taken still.

A change set naming `rebasedFrom` with a change, but an `Add` or `AddElement`, without `oldValue` is refused, as WWCP_POI
refuses it since `1717ee2` (SPECIFICATION.md 4; csharp-review 12): only old values tell that a change set
committed meanwhile changed what it changes, which such a rebase may have overwritten. One not rebased is read as before.
The golden vector `changeSet-rebased-without-old-value` holds both implementations to it.

A model of charging stations or energy meters names its `hardwareRevisions` and `firmwareVersions`, and a charging
station and an energy meter one `hardwareRevision` and one `firmwareVersion` of it, as WWCP_POI does since `7e0b0ac`
(csharp-review 16); a certificate (`ConformityCertificate`, the `certificates` of a conformity assessment body)
is for a model of charging stations or of energy meters, in the hardware revisions and firmware versions it covers, and
names its components, the transparency software and, of a station model, the energy meters it was issued with; a
station and a meter name the certificates of their models in `certificateIds`, and the `transparencySoftwareStatus` of
a meter names a release and its legal status, no certificate, as WWCP_POI does since `987fa26` (csharp-review 17).
Change sets change them, effective members take them of their templates, and a certificate is unique within the
network. `verifyChargingStation` gives the `certificates` the station and its meters name, each with `forThisModel`:
whether it is for the model, the hardware revision and the firmware version of what names it; the `transparencySoftware`
of a meter gives the certificates naming its release, no longer a certificate of its own. The test vectors are those of
a new run of the C# examples at `987fa26` (`tests/vectors/csharp-987fa26`).

A charging station signing measurements itself names its `serialNumber`, `transparencySoftwareStatus`,
`signatureMethods` and `publicKeys` as an energy meter does, and the `modelURL` of its model; an EVSE names its
`iso15118Certificate`, as WWCP_POI does since `52f1172`. Change sets change them; an effective station takes the model
URL, the releases and the signature methods of its templates besides its own, never the serial number, the public keys
or the ISO 15118 certificate of the single device; and a change set giving the releases of a station or a meter out of
the order of their identifications, or one twice, is refused. `verifyChargingStation` gives the releases the station
names among its `transparencySoftware`, proven by the certificates of the station; each entry names what names it,
`namedBy` as of a certificate, in place of `energyMeterId` (`NamedTransparencySoftware` in place of
`MeterTransparencySoftware`). The test vectors stay those of the run at `987fa26`: no station of its examples signs
measurements itself.

The first checkpoint of an epoch takes signatures of the algorithms of its epoch and of the epoch before, no other, as
WWCP_POI does since `65e658d` (SPECIFICATION.md 11.3; csharp-review 14): a history started by
`startNextEpoch` knows the profiles of the epoch it closed, one started from a snapshot those its `epoch` names as
`previousProfiles` (`History.previousEpochProfiles`), and those of the first epoch are the default ones; without them
it takes the algorithms of its own epoch alone. A snapshot of the epoch 2 naming profiles of the epoch before is refused.

A certificate the roaming network operator adds or changes in place of a conformity assessment body without signing keys
says so, `"statedBy": "roamingNetworkOperator"`, as WWCP_POI requires since `65e658d` (SPECIFICATION.md 4.1;
csharp-review 15): a change set adding or changing a certificate whose `statedBy` does not say who signs it, as
the version before has the keys of the body, is refused. `verifyChargingStation` gives each certificate with `statedBy`,
`ConformityAssessmentBody` or `RoamingNetworkOperator`, in place of `bodyHasKeys`, which could not tell them apart once
the body had keys. The test vectors stay those of the run at `987fa26`: none of its examples has a third epoch or a
certificate stated in place of a body.

A version naming a hardware revision, firmware version or serial number WWCP_POI refuses is refused, read or led to by a
change set, as WWCP_POI reads them since `c31e5e3` and `3672b06` (`HardwareRevision`, `FirmwareVersion`,
`SerialNumber`): a text as it is given, not empty and neither beginning nor ending with whitespace as `Char.IsWhiteSpace`
tells it, of charging stations, energy meters and their templates, of the models of their manufacturers, and of
certificates and the energy meters they were issued with, each once in a model, a certificate and such an energy meter
(`ModelVersions.Of`), in the words of WWCP_POI (`invalidVersionText`, which `RoamingNetwork.parse` checks with
`duplicateIdentification`, and for certificates `invalidCertificates`, below). Whether one is of the model of what names
it stays with the references, which this library
leaves to WWCP_POI. The test vectors stay those of the run at `987fa26`, whose versions name none it refuses; the vectors
`version-text-*` of WWCPPOIConformanceTests, its head so changed, hold both implementations to it, refused in the same
words (`reason`).

The golden vectors of WWCPPOIConformanceTests hold, besides the run of the C# examples, small histories it signs itself
(`tests/vectors/poi-histories.json`), replayed step by step in `tests/conformance.test.ts`: who signs in place of a
party without keys, who states a certificate, old values and rebases, keys expired and removed, new values as the
content holds them, `lastChange` of what embeds a change, and three epochs (csharp-review 3, 8, 10, 12 to 15). Ten of
them - the references a version holds, the groups of e-mobility providers, grid connection points - this library
leaves to WWCP_POI, and does not run. They found a deviation of this library (D8 of WWCPPOIConformanceTests): a change
set signed, besides by its owner, by a key of a party not valid at its `createdAt` was taken here, and refused by
WWCP_POI. Every signature by a key of a party of the version is now by one valid at the `createdAt` of the change set,
also one besides the signatures of the owners, refused otherwise in the words of WWCP_POI (`TryGetSigners`); only a new
identity key, which proves its possession, may be one valid later (SPECIFICATION.md 4.1).

A version naming a certificate WWCP_POI refuses to read is refused, read or led to by a change set, as
`ConformityCertificate` and `CertifiedEnergyMeter` of WWCP_POI read them (`src/network/certificates.ts`,
`invalidCertificates`, which `RoamingNetwork.parse` checks after `invalidVersionText`): for exactly one model, with its
manufacturer; at least one hardware revision and one firmware version, also of each energy meter it was issued with, as
an object of its manufacturer and its model; an absolute `documentURL`, a legislation not empty, timestamps with an
explicit offset, `notBefore` not after `notAfter` to the tick; at least one release, each once (compared ordinally once
trimmed, as WWCP_POI does), none both verified and compatible (compared without case); energy meters of a charging
station model only, each model once, compared without case. Refused in the words and in the order of WWCP_POI: first
what it reads as the arguments of a certificate, by their path, then what its constructor checks. Its versions as
texts moved there from `invalidVersionText`, in the same words. The vectors `version-certificate-*` of
WWCPPOIConformanceTests found that this library took all of them (D9) and hold both implementations to it. Whether a
certificate's model, versions, releases and legislation are those of the network stays with the references, which this
library leaves to WWCP_POI; an unknown property, also of a certificate, this library does not refuse.

A history starts from a snapshot of another server only anchored in the trust anchor of the roaming network, fail
closed, as a peer of WWCP_POI starts since `ff2c56f` (SPECIFICATION.md 10.5, *Anchored*; `History.fromSnapshot` with
`SnapshotOptions`): a snapshot of a checkpoint by the checkpoint, signed in the role of the roaming network operator by
signing keys of as many holders as the trust anchor and the key statement of its version require, each certified by a
trusted identity key of its holder, valid when it signed and at `at` (`ChargingStationProof.verifyCheckpoint`, as
`Verify(Checkpoint, TrustAnchor)` of WWCP_POI); a snapshot of the head by the `attestations` it carries since then (8.5),
which must attest the root of its head as for a proof of the root (`ChargingStationProof.ofRoot`, as `VerifyHead` of
WWCP_POI). Without a trust anchor no snapshot is taken, unless the caller takes it `unanchored` explicitly, e.g. a genesis
whose key statement it verifies against the trust anchor itself; an archive segment replays its base so, anchored by the
checkpoint of its end. Before, a snapshot of the head carrying attestations was refused, and every snapshot taken
unanchored. An attestation of a snapshot that cannot be read is refused, not left out.

A signed commit or checkpoint, also the commit of a snapshot, is refused without a verifier of its signatures, as
WWCP_POI does (`CheckSignatures`): before, its signatures were taken unchecked when `HistoryOptions.verifyCommit` or
`verifyCheckpoint` was left out (O3 of WWCPPOIConformanceTests). `verifyCommit` checks the commit of a snapshot as well,
its version before unknown there (`before` undefined).

QI-Digital documents, the proof of concept of WWCP_POI (`WWCP_POI3/RoamingNetwork/QIDigital`, as of `6a0f96e`, which
example A14 uses), are read and checked, not signed (`src/qidigital/`): the digital calibration certificate of a charging
station or an energy meter (`DigitalCalibrationCertificate`), the digital certificate of conformity of a model or, of a
module of quality assurance, of the quality system of a manufacturer (`DigitalCertificateOfConformity`), and the digital
declaration of conformity of a model (`DigitalDeclarationOfConformity`). Each is refused in the words and the order of
WWCP_POI: only its own properties, its context, timestamps exactly as signed, numbers as numbers, what its constructor
checks after its properties were read. Its signature input and its digest are what WWCP_POI writes again of what it read
(`Content()`), not the text as given: numbers without trailing zeros, a whole one as an integer, identifications trimmed,
a charging station as `DE*GEF*S1`, `mainSigner` false, an empty list or text and a revision 0 as WWCP_POI writes them.
Checked against a roaming network as WWCP_POI checks them: the issuer a party of it, its key one that may sign the
document and valid when it signed and at `at`; the notified body with its number, notified for the legislation; the
model, its manufacturer, revisions and versions; the charging station or energy meter of a calibration certificate as it
is at runtime, with what its templates give it, and with the serial number the roaming network gives it, not the one the
certificate names (csharp-review 23). And against each other: a declaration and each certificate it names, a certificate
and the item of a calibration certificate it covers. A text in languages of no language, one that is no text and a
language given twice are refused, not left out, as WWCP_POI refuses them since `bbe8fb8`: left out, they would travel
unsigned with a signed document.
A URL is read as Hermod reads it as far as a document URL needs it: trimmed, https unless it names a scheme, of http or
https with a host.

The test vectors are those of a new run of the C# examples at `33447ac` (`tests/vectors/csharp-33447ac`), the first with
example A14: the QI-Digital documents of the meter of DE*GEF*E2*1 as WWCP_POI signed them, with ML-DSA-65 by the PTB and
EM-LAB and with ES256 by SAALE, are checked against QA as example A14 published it, refused changed in the words of
WWCP_POI, and written again as WWCP_POI wrote them. EM-LAB is a member of QA since, so the head is revision 8 of epoch 2.
`examples/validate-examples.ts` checks example A14 as its `Validate()` does, and starts from the snapshots of examples A4,
A5 and A11 anchored in the trust anchor, from the genesis and the live snapshot of example A12 unanchored, as the
examples do: since the anchored start it refused them.

The golden vectors hold the QI-Digital documents of example A14 too (`tests/vectors/poi-qidigital.json`), run in
`tests/conformance.test.ts` as WWCPPOIConformanceTests runs them against WWCP_POI: the four documents verified against
QA, the declaration of conformity against the certificates it names, both certificates covering the meter of
DE*GEF*E2*1, a calibration certificate of the charging station DE*GEF*S2, signed by the generator with a key QA patched
gives EM-LAB, and 38 refusals, each with its control, of documents or of QA patched. Both implementations refuse a text
of no language, or one that is no text (D10 there, fixed in WWCP_POI `bbe8fb8`), and the calibration certificate of a
station against one of another serial number, or of none (csharp-review 23).

EV Taler, phase 1 of the concept of WWCP_POI for paying for charging with GNU Taler (`concepts/EVTaler.md`), as of
`ec3dace`: a charging station operator names its merchant at a GNU Taler merchant backend and the exchanges whose coins it
accepts (`evTaler`, `evTalerMerchantOf`), refused where WWCP_POI refuses it and in its words: base URLs of HTTPS without
user, query and fragment, ending in '/', read as Hermod reads them; keys as GNU Taler writes them (`isTalerPublicKey`);
at least one exchange, each once, of an ISO 4217 currency of Styx and with a name. A change of it needs a signing key
that may sign the new usage `payments`. Payment options are an open set of names: any nonempty text, none twice whatever
its case, united with those of the templates of a charging pool without case; a charging pool or template naming EVTaler
needs the merchant of its operator, after the last change of a change set. An app reads the EV Taler tariff of an EVSE
and the exchanges in its currency from the proof of its station (`evTalerTariffOf`, `evTalerExchangesAt`), and what
drivers see, "EV Taler (Example Exchange, EUR)" (`paymentOptionName`). The JSON, the CBOR and the tree of a version with
a merchant are those WWCP_POI writes: `tests/evTaler.test.ts` holds the ETags WWCP_POI3 calculates of QA with the merchant
of its EVTalerTests. Not yet: golden vectors of WWCPPOIConformanceTests, and a station proof with a merchant as WWCP_POI
signs it (example A15 came after the frozen run). Nothing here takes or makes a payment.

The keys of the parties of a roaming network are read where it is read, as WWCP_POI reads them wherever it reads a
party (`POIPartyKeys.TryParse` and `Check`), in its words (D12 of WWCPPOIConformanceTests): before, a party's keys were
only read where they were used, so a version naming an unknown usage of a party's key was taken. Every key as
`POIPublicKey.parse` reads it, none twice, none both a signing and an identity key, no identity key naming usages; the
parties in the order WWCP_POI reads them, the charging station operators last; the identity keys of the roaming network
operator in the same words (`src/network/partyKeys.ts`). Checked against WWCP_POI3 at `ec3dace` itself, on 47 versions
of QA with keys valid and not, of every kind of party: 40 are read as WWCP_POI3 reads them, in the same words; 5 both
refuse, in other words of `POIPublicKey.parse` within the same wrapper (a key without identification or key, not
Base64, expiring before it becomes valid, of another JSON-LD context); 2 name a `notAfter` WWCP_POI takes and writes
otherwise (a date only, an offset), refused here as every timestamp not written as POI writes it. `poi-refusals.json` of
WWCPPOIConformanceTests vendored, 89 vectors: the 13 of EV Taler and `version-key-usage-unknown`, D12 closed.

A key is read in the words and order of `POIPublicKey.TryParse` of WWCP_POI (`POIPublicKey.parse`): its identification
and key as texts, then its JSON-LD context, then both given ("A public key needs its identification and its key!"); a
key .NET can not read as Base64 in the words of .NET, one it reads but writes otherwise as not canonical; "Invalid COSE
key: …", "A public key must not contain private parts!", "The holder of a public key must be a text!"; a key expiring
before it becomes valid where the constructor of WWCP_POI refuses it, after its holder and usages, before its
thumbprint. Checked against WWCP_POI3 at `ec3dace` itself, on 45 more versions of QA with keys valid and not: 34 in its
words. Still other words: a key of CBOR WWCP_POI3 can not read (the words of `@vanaheimr/cose` and
`@vanaheimr/metrological-cbor`, not of their C# originals), a timestamp both refuse ("Invalid value for 'not before'!"
there). Refused here, taken and written otherwise by WWCP_POI3: a key not in deterministic CBOR, a timestamp not written
as POI writes it, a `notBefore` or `notAfter` of null.

`poi-histories.json` of WWCPPOIConformanceTests `0734641` vendored: 8 replays of EV Taler in a history the generator
signs, who may sign the merchant of DE*GEF (a signing key for `payments`; the roaming network operator only in place
of a party without signing keys) and a charging pool naming EVTaler with and without it. A change needing signatures is
named as WWCP_POI names it, with the property it changes, e.g. "Change 0: UpdateProperty of the
ChargingStationOperator 'DE*GEF' ('evTaler') needs a signature by …".
