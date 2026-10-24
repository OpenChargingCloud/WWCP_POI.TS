# Changelog

## 0.1.0 (unreleased)

The first milestone: the examples A1 to A9 of WWCP_POI (commit `2d9511d`) checked in TypeScript.

- Canonical JSON and deterministic CBOR of Styx; a lossless JSON parser keeping decimals as `System.Decimal` holds them.
- COSE keys, RFC 9679 thumbprints, signatures ES256/384/512, ES256K, ESP*, ESB*, Ed25519, Ed448, ML-DSA-44/65/87.
- Trust anchors (QR code, URL, JSON), key statements, certificates of signing keys.
- Roaming networks with their ETags, effective members and the effective tree; proofs of charging stations, attestations.
- Change sets with their owners' signatures, commits, linear histories, checkpoints, their proofs and signatures by the
  roaming network operator and by witnesses, archive segments.
- Price statements, their chains, checkpoint trees and proofs; evidence of a charging session.
- `POIClient`: the proof of a charging station and its price statements, from the servers of a trust anchor.
