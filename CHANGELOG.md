# Changelog

## 0.1.0 (unreleased)

The first milestone: the examples A1 to A13 of WWCP_POI (commit `bbd4cbd`) checked in TypeScript.

- Canonical JSON and deterministic CBOR of Styx; a lossless JSON parser keeping decimals as `System.Decimal` holds them.
- COSE keys, RFC 9679 thumbprints, signatures ES256/384/512, ES256K, ESP*, ESB*, Ed25519, Ed448, ML-DSA-44/65/87.
- Trust anchors (QR code, URL, JSON), key statements, certificates of signing keys; trust following the key statements
  of a history (`OperatorTrust.followedBy`).
- Roaming networks with their ETags, effective members and the effective tree; proofs of charging stations, attestations,
  the transparency software and certificates of their energy meters.
- Change sets with their owners' signatures, commits, linear histories, checkpoints, their proofs and signatures by the
  roaming network operator and by witnesses, archive segments; epochs, their final checkpoints and the genesis of the
  next one.
- Transparency software manufacturers and conformity assessment bodies, parties holding their releases and certificates,
  and the key usages `software` and `certificates`; energy meter templates and groups.
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
