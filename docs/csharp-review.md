# Review of the C# implementation (WWCP_POI at 2d9511d)

What porting WWCP POI 3 to TypeScript turned up in the C# implementation and the specification: logical errors,
verification weaknesses, and places where code and specification disagree. Paths are relative to
[WWCP_POI](https://github.com/OpenChargingCloud/WWCP_POI) at commit `2d9511d` (2026-10-24), Styx at its `master` of the
same day.

Each finding says how it was established:

- **demonstrated**: shown with data, a C# program run against the C# implementation or the TypeScript port;
- **confirmed**: the exact code path was read;
- **plausible**: the code path was read in parts; the scenario needs conditions that were not set up.

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | The holders counted for a quorum are named by the keys being counted | high | confirmed |
| 2 | ECDSA twins of price statements: false split views, broken chains | high | demonstrated |
| 3 | A removed or expired key still signs, through an older version | high | confirmed |
| 4 | A change set counts as committed by its `@id` alone | medium-high | confirmed |
| 5 | A witness signs the first checkpoint of a history started from a snapshot unchecked | medium-high | confirmed |
| 6 | A subject attestation verifies a whole proof | medium | confirmed |
| 7 | Attestations without `validUntil`, keys checked at a self-chosen `signedAt` | medium | confirmed |
| 8 | `lastChange` of what embeds a changed entity: code and specification disagree | medium (interop) | demonstrated |
| 9 | A provider's change of an operator's group, by a stale owner record | medium | plausible |
| 10 | Embedded objects of signed change sets carry `@context` | low | demonstrated |
| 11 | Epoch 1 checkpoints name their epoch, the specification says they do not | low (interop) | demonstrated |
| 12 | A change without `oldValue` is not checked at all | low | confirmed |
| 13 | Smaller points | low | confirmed |


## 1. The holders counted for a quorum are named by the keys being counted

**Where:** `WWCP_POI3/Proofs/RoamingNetworkKeyStatement.cs:622,635,651`,
`WWCP_POI3/Proofs/RoamingNetworkSigningKeyCertificate.cs:269,281`, `WWCP_POI3/Proofs/RoamingNetworkTrustAnchor.cs:46`;
the examples copy the pattern (`examples/csharp/exampleA1.cs`, step f).

A trust anchor pins the `@id`s of identity keys and a `minConsensus`, but not which holder holds which key; `holder` is no
part of the thumbprint. `TryVerify` counts `holders.Add(identityKey.HolderOrUnnamed)`, taking the holder from the
`identityKeys` of the very statement it verifies, or, for a key the statement does not name, from the operator's
`identityKeys` of the proof, which nothing verified yet. Certificates take the holder of the certifying identity key from
the same pool (`:269,281`).

**Scenario:** the specification allows a holder several identity keys ("e.g. identity keys of different `notBefore` and
`notAfter`", 4.1), and `CreateTrustAnchor` pins every key of the statement. AlphaOrg holds `IA_old` and `IA_new` during a
renewal; the QR code pins both with `minConsensus` 2. AlphaOrg alone writes a key statement naming `IA_new` as held by
"Beta", signs it with both keys: two holders. It certifies two of its own signing keys, one labelled "Alpha", one "Beta",
and attests a root of its choice with both: every verifier counts two holders. The quorum, meant so that "no single
company decides for the network", is met by one.

**Fix:** the trust anchor binds keys to holders (e.g. `keys` grouped per holder, `[[id, id], [id], [id]]`), and the
verifier takes holders from the anchor only; signatures by keys the verified statement does not name do not count.

The TypeScript port does as the C# implementation, so that both accept the same; `KeyStatement.verify` says so.


## 2. ECDSA twins of price statements: false split views, broken chains

**Where:** `WWCP_POI3/Proofs/RoamingNetworkPriceStatement.cs:250-251` (the digest covers `value`),
`WWCP_POI3/History/RoamingNetworkHistory.PriceStatements.cs:582-613` (statements compared by digest), `POST
~/history/priceStatements` needs no authorization (`WWCP_POI3/API/POI_API.PriceStatements.cs`),
`Styx/Illias/COSE/COSEAlgorithm.cs:1159,1374ff` (signing does not normalize `s`, verifying accepts any `s`).

An ECDSA signature `(r, s)` has a twin `(r, n − s)`, valid as well, which anybody computes without the key. The digest of
a price statement is the SHA-256 of its JSON *with its signature value*: the twin is a different statement of the same
sequence.

**Demonstrated** with the C# implementation (`tests/vectors/csharp-2d9511d/proofs/MakeProofs.cs.txt`, on the history
the examples left):

```
price statement original: signature valid, sequence 0, digest 0f93e1635cdd8221364d21391a0c5465cc0efb991d5ace8b57d27b28e71c1a58
price statement twin (r, n-s): signature valid, sequence 0, digest 6820f93566a0c86c73fd701c6b9e7db9c7ef378ff7ab21e4a31719f53cf8b7c1
server takes the genuine statement 1 again: Known,
server takes the twin of statement 1: Refused, The EVSE 'DE*GEF*E1*1' has another price statement 1: two statements of one sequence are a split view!
```

So whoever relays statements (a peer, a proxy, anybody posting to a server first) can make a server take the twin;
then the genuine statement is refused as a split view of the operator, the next statement of the operator is refused
because its `previous` names the genuine digest, and the checkpoint names the twin, so the driver holding the genuine
statement gets no proof of it (12.4). Commits and checkpoints are not affected: their identifications leave signatures
out.

**Fix:** digest and compare statements without `value` (the signed content), or require and produce low-S ECDSA
signatures where a signature value is hashed. The TypeScript port compares by signed content
(`PriceStatement.sameSignedContent`), so that an app given both takes them as one statement.


## 3. A removed or expired key still signs, through an older version

**Where:** `WWCP_POI3/History/RoamingNetworkHistory.cs:756-783` (`Commit`),
`WWCP_POI3/History/RoamingNetworkHistory.Persistence.cs:688-722` (`FindVersionFor`).

A change set is applied to whichever retained version its `beforeETags` name, not only to the head; its owners'
signatures are checked against *that* version and its `createdAt`, which the signer chooses; then the result is merged
into the head (`MergeTips`).

**Scenario:** the `infrastructure` key K of an operator leaks; the operator removes K at revision 10. The attacker takes
the public `beforeETags` of revision 9, chooses a `createdAt` within the validity of K, and signs a change of an EVSE with
K. It fits revision 9, is checked against revision 9, committed as a branch and merged into the head, as the head
changed only the operator's keys. The same holds for a signing key of the RNO whose certificate was removed: "a key is
revoked by removing its certificate" (8.6) does not hold for change sets.

**Fix:** a change set made for an older version must also be signed by keys valid in the head (or the tip it is merged
with) at the time it is taken, or `createdAt` must not lie before the `lastChange` of the head.


## 4. A change set counts as committed by its `@id` alone

**Where:** `WWCP_POI3/History/RoamingNetworkHistory.cs:756-757` (`FindCommitted`), `:1797-1827` (`ChangeSetIds`,
including `metadata.rebasedFrom`).

A change set's `@id` is a random text its maker chooses, not a digest of its content. `Commit` answers
`AlreadyCommitted` for any change set whose `@id`, or one of its `rebasedFrom` ids, is known already, without comparing
contents.

**Scenario:** a change set X waits for the signatures of the RNO's holders (4.2), e.g. adding a party. Another party
commits a change set of its own, possibly with no changes at all, with `"@id": X`, or naming X in `rebasedFrom`. From then
on X is "committed", every further co-signature of the genuine X answers `AlreadyCommitted`, and X is never applied. This
contradicts 4.2: "a change set of the same `@id` saying something else is refused".

**Fix:** identify change sets by the digest of their content without signatures (as commits are), or compare the content
of a change set found by its `@id`; refuse change sets without changes.


## 5. A witness signs the first checkpoint of a history started from a snapshot unchecked

**Where:** `WWCP_POI3/History/RoamingNetworkHistory.Checkpoints.cs:865` ("Only the first checkpoint of a history that
started from a snapshot can not be checked completely"), `:409-446` (`TryWitness` signs any checkpoint the history holds).

`TryWitness` claims "This history holds only checkpoints it checked, one per sequence, so a witness never signs two
different ones of the same sequence". A history started from a snapshot takes its first checkpoint without checking its
`commits`; `TryWitness` signs it all the same. The review of `Sync/RoamingNetworkPeer.cs` found a path by which a peer
replaces its history by one started from a snapshot when the other server answers `NotFound` (`:878-881`, `:921-984`),
so a witness could be led to sign a second checkpoint of a sequence it signed before (plausible, not set up).
Section 10.2: a witness signs only "after it refused nothing of 10.1 in its own history, which it took commit by commit".

**Fix:** `TryWitness` refuses a checkpoint whose commits the history did not check, and a witness keeps the checkpoints
it signed across restarts and new histories.


## 6. A subject attestation verifies a whole proof

**Where:** `WWCP_POI3/Proofs/RoamingNetworkProof.cs:269` (`AttestationsOf`), `:401` (`required == 1`).

An attestation with a `subject` (8.5) only has to match the digest of one entity; its root is not compared with the root
of the proof. With a quorum of one, the first such attestation verifies the whole proof, with whatever the proof gives
above that entity (the name of the network, its operator, manufacturers, transparency software); with a quorum, subject
and root attestations are counted together. `role` and `signer` of attestations are not checked.

**Fix:** a subject attestation attests its subject only: count it for the subtree, never for the proof. The TypeScript
port counts root attestations only, in the role `roamingNetworkOperator`.


## 7. Attestations without `validUntil`, keys checked at a self-chosen `signedAt`

**Where:** `WWCP_POI3/History/RoamingNetworkAttestation.cs:417-419`, `WWCP_POI3/Proofs/RoamingNetworkProof.cs`
(`CertifiedSigningKeyOf`), `WWCP_POI3/Proofs/RoamingNetworkPriceStatement.cs` (validity).

`IsValidAt` is `!ValidUntil.HasValue || Timestamp <= ValidUntil`: an attestation without `validUntil` is valid forever,
and one signed in the future is valid now. The signing key is checked at the attestation's own `signedAt`. A proof brings
its own certificates. An offline verifier therefore accepts, forever, an attestation by a signing key that was revoked
(its certificate removed, 8.6) or expired, back-dated into its validity. The same holds for price statements without
`validUntil`.

**Fix:** require `validUntil` with a bounded lifetime, `signedAt ≤ at`, and the key valid at `at`. The TypeScript port
requires `signedAt ≤ at`.


## 8. `lastChange` of what embeds a changed entity: code and specification disagree

**Where:** `WWCP_POI3/RoamingNetwork/RoamingNetwork.InfrastructureChanges.cs:561,693-717` (`TouchParents`), likewise
`ProviderChanges.cs`, `OfferChanges.cs`, `GridChanges.cs`, `ParkingChanges.cs`, `EnergyMeterGroupChanges.cs`;
`SPECIFICATION.md:173-176`.

The specification: a change set sets `lastChange` "of an entity when it is added … or when one of its own properties
changes; **not when only an entity it embeds changes**". The code sets it on the charging station, the charging pool
and the operator of a changed EVSE. `docs/README.md` and `WWCP_POI3_Tests/InfrastructureTests.cs` follow the code.

**Demonstrated:** the TypeScript port reproduces the `afterETags` of the commits of the examples only by doing what the
code does (revision 9, the correction of the EVSEs of example A5). An implementation following the specification
calculates other ETags and refuses every such change set. One of the two must change.


## 9. A provider's change of an operator's group, by a stale owner record

**Where:** `WWCP_POI3/RoamingNetwork/RoamingNetwork.Ownership.cs:1031-1049` (`AddedProviderGroups`),
`RoamingNetwork.ProviderChanges.cs:107-153`.

Within one change set, an `Add` of a provider's group records the provider as its owner; a later `Remove` of it leaves the
record. A third change of the same group id is then owned by the provider, while applying it finds no provider group
and changes the operator's group of that id. It needs a provider id the group id type takes as the operator's (e.g.
`DE-XYZ` and `DE*XYZ`); network-wide uniqueness of group ids is checked only after the last change. Reported by the
review of the change set code; the owner path was read, the full scenario was not set up.


## 10. Embedded objects of signed change sets carry `@context`

**Demonstrated:** the change set of revision 12 (example A8, `UpdateProperty` of `elements` of `DE*GEF*T_AC`) writes
its `newValue` as `[{"@context": "…/chargingTariffElement/v1", "priceComponents": […]}]`, signed so. Applied, the
element is kept without it. Section 1.1: an embedded object "does not" name its context. Harmless for the C# reader,
which parses the value into its model; a reader applying change sets on JSON must know to drop it (the TypeScript port
does).


## 11. Epoch 1 checkpoints name their epoch, the specification says they do not

`SPECIFICATION.md:1451`: "Every history begins in epoch 1, whose commits and checkpoints do not name it."
`WWCP_POI3/History/RoamingNetworkCheckpoint.cs:1119` always writes `"epoch"`, also 1, and section 10.1 and the examples
show `"epoch": 1`. A reader following section 11 calculates other checkpoint identifications. Commits do follow section
11.


## 12. A change without `oldValue` is not checked at all

**Where:** `WWCP_POI3/RoamingNetwork/RoamingNetwork.ChangeSets.cs:636,787`, `RoamingNetwork.ElementChanges.cs:92`
(`applied.OldValue is JToken …`).

A change naming no `oldValue` is applied without comparing anything; `null` means "absent". The `beforeETags` pin the
version anyway, so applying is safe; rebasing and merging, which rely on old values, are not.


## 13. Smaller points

- **Trust anchor quorum:** `minConsensus` is checked against the number of keys, not of holders
  (`RoamingNetworkTrustAnchor.cs`, `TryCheck`); see 1.
- **Certificates and statements of another operator in a proof:** `RoamingNetworkProof.Verify` does not compare the
  `roamingNetworkOperatorId` of the certificates and of the key statement with the operator of the proof (the content
  check of a full version does). The TypeScript port does.
- **Checkpoint roles:** required roles are checked as the role a signer declares; `examples/csharp/exampleA4.cs` accepts a
  signing key of the RNO in any role. The TypeScript port binds witness signatures to the key trusted for the witness
  named, and ignores, rather than refuses, signatures by keys it does not trust (so nobody blocks a checkpoint by adding
  one).
- **Building the examples:** `examples/csharp/examples.csproj` references `Hermod`, `Styx`, `WWCP_Node` as sibling
  checkouts, and `WWCP_Node` needs `Norn` and `Urdr` as well; `examples/README.md` says only `dotnet run`. The examples
  seem to use nothing of `WWCP_Node`. On Windows, a checkout below a long path needs `git config core.longpaths true`.
- **Dependencies of COSE.TS:** `@vanaheimr/cose@0.9.0` on npm depends on `@vanaheimr/metrological-cbor@^0.10.0`, its
  repository on `^0.11.0`: a consumer of both gets two copies of the CBOR codec.


## What was checked and found sound

Canonical JSON and deterministic CBOR (all Styx vectors), ETags, commit and checkpoint identifications, the effective
tree with templates and tariffs, RFC 9162 trees and audit paths (bounds, domain separation), key thumbprints and their
checks, the signature inputs of key statements, certificates, commits, checkpoints, attestations, change sets and price
statements, Base64 canonicality, the trust anchor (QR code, URL), the ownership of the changes of the examples (including
the quorum and the proof of possession of new identity keys), checkpoint lines, archive segments, and price statement
trees and proofs: the TypeScript port, written from the specification and the code, calculates all of them byte for byte
as the C# implementation does, for the published data of two runs of the examples.
