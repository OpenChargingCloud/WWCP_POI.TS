# Changelog

## 0.1.0 (unreleased)

The first milestone: the examples A1 to A13 of WWCP_POI (commit `dbf39b0`) checked in TypeScript.

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
