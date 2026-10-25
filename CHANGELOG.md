# Changelog

## 0.1.0 (unreleased)

The first milestone: the examples A1 to A13 of WWCP_POI (commit `80e4ccc`) checked in TypeScript.

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
when they may sign the usage of the change (docs/csharp-review.md, 13); its identity and signing keys counted alike for
everything it owns; and the signing keys of a party could not rotate its signing keys. The values of change sets are
kept in the order the C# implementation keeps them in (docs/csharp-review.md, 10).

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
statement, of the same digest (docs/csharp-review.md, 2); `PriceStatement.sameSignedContent` is gone. The test vectors
are those WWCPPOIConformanceTests generates for it, with a new run of the C# examples at `dbf39b0`
(`tests/vectors/csharp-dbf39b0`).

The holders of a quorum are counted as the trust anchor names them, as WWCP_POI does since `3e32f48` (SPECIFICATION.md
4.1, 8.6; docs/csharp-review.md, 1): a trust anchor names the keys per holder, the `@id` of its key or the array of the
`@id`s of its keys (`TrustAnchor.holders`; in the URL the holders separated by `,`, the keys of one holder by `;`).
`KeyStatement.verifyHolders` counts the holders as the verifier knows them and refuses a statement naming the trusted
keys otherwise; a station proof, `OperatorTrust` and the signatures of checkpoints count an attestation or a signature
for the holder of the trusted identity key that certified its key. A change set naming a key of a party with another
holder than before is refused.

A change set is identified by its content, as WWCP_POI does since `bc3b1bd` (SPECIFICATION.md 4, 5.2;
docs/csharp-review.md, 4): its `@id` is the SHA-256 of its canonical JSON with its `@context`, without `@id` and
signatures (`changeSetIdentification`), so that nobody commits another change set in the place of one. `ChangeSet.parse`
refuses a change set identified otherwise, and one naming change sets in `metadata.rebasedFrom` it was not rebased from;
`Commit.parse` reads the change set of a commit as well and refuses a commit with one parent whose change set has no
changes or the identification of a merge. The test vectors are those of a new run of the C# examples at `bc3b1bd`
(`tests/vectors/csharp-bc3b1bd`).

A change set gives its new values as the content holds them, as WWCP_POI requires since `80e4ccc` (SPECIFICATION.md 2,
4; docs/csharp-review.md, 10): a new value is applied as it is given, no longer written anew as the C# model would, and
one that names a JSON-LD context in what it embeds (custom data aside, which keeps it), gives identified elements, keys,
certificates or the lists of section 2 out of their order or twice, or a timestamp not UTC to the millisecond is
refused. An old value is compared as it is given. The test vectors are those of a new run of the C# examples at
`80e4ccc` (`tests/vectors/csharp-80e4ccc`).

An attestation gives its `validUntil`, at most 24 hours after its `signedAt`, as WWCP_POI requires since `be07037`
(SPECIFICATION.md 8.5, 8.6, 12.1; docs/csharp-review.md, 7): `Attestation.parse` refuses one without or valid longer
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
