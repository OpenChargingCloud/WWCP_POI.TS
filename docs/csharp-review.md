# Review of the C# implementation (WWCP_POI at bbd4cbd)

What porting WWCP POI 3 to TypeScript turned up in the C# implementation and the specification: logical errors,
verification weaknesses, and places where code and specification disagree. Paths are relative to
[WWCP_POI](https://github.com/OpenChargingCloud/WWCP_POI) at commit `bbd4cbd` (2026-10-24, conformity assessment bodies),
Styx at `91901a9`, which the RoamingHubCLI pins with it (`26c454d`). The first review was of `2d9511d`; every finding of
it was checked again against `bbd4cbd`, and the code added since, examples A10 to A13, epochs, transparency software
manufacturers and conformity assessment bodies, was reviewed as well.

Each finding says how it was established:

- **demonstrated**: shown with data, a C# program run against the C# implementation or the TypeScript port;
- **confirmed**: the exact code path was read;
- **plausible**: the code path was read in parts; the scenario needs conditions that were not set up.

| # | Finding | Severity | Status | Since `2d9511d` |
|---|---|---|---|---|
| 1 | The holders counted for a quorum are named by the keys being counted | high | confirmed | unchanged |
| 2 | ECDSA twins of price statements: false split views, broken chains | high | demonstrated | unchanged, again demonstrated |
| 3 | A removed or expired key still signs, through an older version | high | confirmed | unchanged |
| 4 | A change set counts as committed by its `@id` alone | medium-high | confirmed | unchanged |
| 5 | A witness signs the first checkpoint of a history started from a snapshot unchecked | medium-high | confirmed | unchanged |
| 6 | A subject attestation verifies a whole proof | medium | confirmed | unchanged |
| 7 | Attestations without `validUntil`, keys checked at a self-chosen `signedAt` | medium | confirmed | unchanged |
| 8 | `lastChange` of what embeds a changed entity: code and specification disagree | medium (interop) | demonstrated | unchanged; the new parties follow the code |
| 9 | A provider's change of an operator's group, by a stale owner record | medium | plausible | unchanged |
| 10 | What a signed change set says is not what the content holds | low (interop) | demonstrated | extended |
| 11 | Epoch 1 checkpoints name their epoch, the specification says they do not | low (interop) | demonstrated | unchanged |
| 12 | A change without `oldValue` is not checked at all | low | confirmed | unchanged |
| 13 | The roaming network operator can not sign in place of a body or grid operator without keys | medium | demonstrated | **new** |
| 14 | The first checkpoint of a later epoch takes signatures of any algorithm | low | confirmed | **new** |
| 15 | Who stated a certificate can not be told once its body has keys | low | confirmed | **new** |
| 16 | Smaller points | low | confirmed | extended |


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
`notAfter`", 4.1), and `CreateTrustAnchor` pins every key of the statement. Example A11 shows the case: AlphaOrg holds
its old and its new identity key at once, both named by the key statement of revision 14. AlphaOrg alone writes a key
statement naming its new key as held by "Beta", signs it with both keys: two holders. It certifies two of its own
signing keys, one labelled "Alpha", one "Beta", and attests a root of its choice with both: every verifier counts two
holders. The quorum, meant so that "no single company decides for the network", is met by one.

**Fix:** the trust anchor binds keys to holders (e.g. `keys` grouped per holder, `[[id, id], [id], [id]]`), and the
verifier takes holders from the anchor only; signatures by keys the verified statement does not name do not count.

The TypeScript port does as the C# implementation, so that both accept the same; `KeyStatement.verify` says so.


## 2. ECDSA twins of price statements: false split views, broken chains

**Where:** `WWCP_POI3/Proofs/RoamingNetworkPriceStatement.cs:250` (the digest covers `value`),
`WWCP_POI3/History/RoamingNetworkHistory.PriceStatements.cs:582-613` (statements compared by digest), `POST
~/history/priceStatements` needs no authorization (`WWCP_POI3/API/POI_API.PriceStatements.cs`),
`Styx/Illias/COSE/COSEAlgorithm.cs:1159,1374ff` (signing does not normalize `s`, verifying accepts any `s`).

An ECDSA signature `(r, s)` has a twin `(r, n − s)`, valid as well, which anybody computes without the key. The digest of
a price statement is the SHA-256 of its JSON *with its signature value*: the twin is a different statement of the same
sequence.

**Demonstrated** again at `bbd4cbd` (`tests/vectors/csharp-bbd4cbd/proofs/MakeProofs.cs.txt`, its output
`MakeProofs-output.log`): a server joining `QA` from checkpoint 4 with the statements it names holds the genuine
statement 1 of `DE*GEF*E1*1`; the twin of it, which anybody makes from it, is refused as a split view of the operator.

```
price statement original: signature valid, sequence 0, digest 622e5170b819350f8b3de06acfe9941162de7fc5dceb77a808b65691462850ce
price statement twin (r, n-s): signature valid, sequence 0, digest b4552c3a6b1f51ccca07cb359699f0e914c93fa78a61d6518e4a8e7792617237
server of checkpoint 4 takes the genuine statement again, sequence 1, digest 58cd6969…: Known,
server of checkpoint 4 takes the twin of the statement, sequence 1, digest 3318e117…: Refused, The EVSE 'DE*GEF*E1*1' has another price statement 1: two statements of one sequence are a split view!
```

So whoever relays statements (a peer, a proxy, anybody posting to a server first) can make a server take the twin;
then the genuine statement is refused as a split view of the operator, the next statement of the operator is refused
because its `previous` names the genuine digest, and the checkpoint names the twin, so the driver holding the genuine
statement, e.g. in the evidence of example A10, gets no proof of it (12.4). Epoch 2 of example A11 accepts ML-DSA only
and is not affected; every epoch accepting ECDSA is, epoch 1 of every roaming network among them. Commits and
checkpoints are not affected: their identifications leave signatures out.

**Fix:** digest and compare statements without `value` (the signed content), or require and produce low-S ECDSA
signatures where a signature value is hashed. The TypeScript port compares by signed content
(`PriceStatement.sameSignedContent`), so that an app given both takes them as one statement.


## 3. A removed or expired key still signs, through an older version

**Where:** `WWCP_POI3/History/RoamingNetworkHistory.cs:760-784` (`Commit`),
`WWCP_POI3/History/RoamingNetworkHistory.Persistence.cs` (`FindVersionFor`).

A change set is applied to whichever retained version its `beforeETags` name, not only to the head; its owners'
signatures are checked against *that* version and its `createdAt`, which the signer chooses; then the result is merged
into the head (`MergeTips`).

**Scenario:** the `infrastructure` key K of an operator leaks; the operator removes K at revision 10. The attacker takes
the public `beforeETags` of revision 9, chooses a `createdAt` within the validity of K, and signs a change of an EVSE with
K. It fits revision 9, is checked against revision 9, committed as a branch and merged into the head, as the head
changed only the operator's keys. The same holds for a signing key of the RNO whose certificate was removed: "a key is
revoked by removing its certificate" (8.6) does not hold for change sets. Example A11 replaces every key of `DE*GEF` at
revision 15 of epoch 1; within epoch 1, its old keys would still sign this way. The new epoch ends it: commits of epoch
1 are not taken in epoch 2.

**Fix:** a change set made for an older version must also be signed by keys valid in the head (or the tip it is merged
with) at the time it is taken, or `createdAt` must not lie before the `lastChange` of the head.


## 4. A change set counts as committed by its `@id` alone

**Where:** `WWCP_POI3/History/RoamingNetworkHistory.cs:756` (`FindCommitted`), `:1797-1830` (`ChangeSetIds`,
including `metadata.rebasedFrom`).

A change set's `@id` is a random text its maker chooses, not a digest of its content. `Commit` answers
`AlreadyCommitted` for any change set whose `@id`, or one of its `rebasedFrom` ids, is known already, without comparing
contents.

**Scenario:** a change set X waits for the signatures of the RNO's holders (4.2), e.g. adding a party. Another party
commits a change set of its own, possibly with no changes at all, with `"@id": X`, or naming X in `rebasedFrom`. From then
on X is "committed", every further co-signature of the genuine X answers `AlreadyCommitted`, and X is never applied. This
contradicts 4.2: "a change set of the same `@id` saying something else is refused". The WebSocket of example A12 takes
change sets of authenticated senders (`commitChangeSet`), another way in.

**Fix:** identify change sets by the digest of their content without signatures (as commits are), or compare the content
of a change set found by its `@id`; refuse change sets without changes.


## 5. A witness signs the first checkpoint of a history started from a snapshot unchecked

**Where:** `WWCP_POI3/History/RoamingNetworkHistory.Checkpoints.cs:865` ("Only the first checkpoint of a history that
started from a snapshot can not be checked completely"), `:409-446` (`TryWitness` signs any checkpoint the history holds).

`TryWitness` claims "This history holds only checkpoints it checked, one per sequence, so a witness never signs two
different ones of the same sequence". A history started from a snapshot takes its first checkpoint without checking its
`commits`; `TryWitness` signs it all the same. A peer replaces its history by one started from a snapshot when the other
server answers `NotFound` (`Sync/RoamingNetworkPeer.cs`), and a peer whose history lacks the final checkpoint of an
epoch starts the next epoch "from the other server, as from its start" (11.4): so a witness could be led to sign a
second checkpoint of a sequence it signed before (plausible, not set up). Section 10.2: a witness signs only "after it
refused nothing of 10.1 in its own history, which it took commit by commit".

**Fix:** `TryWitness` refuses a checkpoint whose commits the history did not check, and a witness keeps the checkpoints
it signed across restarts, new histories and epochs.


## 6. A subject attestation verifies a whole proof

**Where:** `WWCP_POI3/Proofs/RoamingNetworkProof.cs:252` (`AttestationsOf`), `:401` (`required == 1`).

An attestation with a `subject` (8.5) only has to match the digest of one entity; its root is not compared with the root
of the proof. With a quorum of one, the first such attestation verifies the whole proof, with whatever the proof gives
above that entity (the name of the network, its operator, manufacturers, and since `bbd4cbd` the transparency software
releases and certificates of the meters, example A13); with a quorum, subject and root attestations are counted
together. `role` and `signer` of attestations are not checked.

**Fix:** a subject attestation attests its subject only: count it for the subtree, never for the proof. The TypeScript
port counts root attestations only, in the role `roamingNetworkOperator`.


## 7. Attestations without `validUntil`, keys checked at a self-chosen `signedAt`

**Where:** `WWCP_POI3/History/RoamingNetworkAttestation.cs:417-419`, `WWCP_POI3/Proofs/RoamingNetworkProof.cs`
(`CertifiedSigningKeyOf`), `WWCP_POI3/Proofs/RoamingNetworkPriceStatement.cs` (validity).

`IsValidAt` is `!ValidUntil.HasValue || Timestamp <= ValidUntil`: an attestation without `validUntil` is valid forever,
and one signed in the future is valid now. The signing key is checked at the attestation's own `signedAt`. A proof brings
its own certificates. An offline verifier therefore accepts, forever, an attestation by a signing key that was revoked
(its certificate removed, 8.6) or expired, back-dated into its validity. The same holds for price statements without
`validUntil`. Example A10 relies on bounded attestations (15 minutes) and checkpoints for what holds later: that is the
right pattern, but nothing enforces it.

**Fix:** require `validUntil` with a bounded lifetime, `signedAt ≤ at`, and the key valid at `at`. The TypeScript port
requires `signedAt ≤ at`.


## 8. `lastChange` of what embeds a changed entity: code and specification disagree

**Where:** `WWCP_POI3/RoamingNetwork/RoamingNetwork.InfrastructureChanges.cs:561,693-717` (`TouchParents`), likewise
`ProviderChanges.cs`, `OfferChanges.cs`, `GridChanges.cs`, `ParkingChanges.cs`, `EnergyMeterGroupChanges.cs`, and new,
`TransparencySoftwareChanges.cs` and `TransparencySoftwareCertificateChanges.cs`; `SPECIFICATION.md:174-176`.

The specification: a change set sets `lastChange` "of an entity when it is added … or when one of its own properties
changes; **not when only an entity it embeds changes**". The code sets it on the charging station, the charging pool
and the operator of a changed EVSE, on the operator of a changed energy meter template, on the manufacturer of a changed
release, on the body of a changed certificate. `docs/README.md`, `docs/TransparencySoftwareManufacturer.md`,
`docs/ConformityAssessmentBody.md` ("set to the `createdAt` of the change set by every change of it and of its releases")
and `WWCP_POI3_Tests/InfrastructureTests.cs` follow the code.

**Demonstrated:** the TypeScript port reproduces the `afterETags` of the commits of the examples only by doing what the
code does (e.g. revision 9 of epoch 1, the correction of example A5, and revisions 5 to 7 of epoch 2, example A13). An
implementation following the specification calculates other ETags and refuses every such change set. One of the two
must change.


## 9. A provider's change of an operator's group, by a stale owner record

**Where:** `WWCP_POI3/RoamingNetwork/RoamingNetwork.Ownership.cs:1098,1145` (`AddedProviderGroups`),
`RoamingNetwork.ProviderChanges.cs`.

Within one change set, an `Add` of a provider's group records the provider as its owner; a later `Remove` of it leaves the
record. A third change of the same group id is then owned by the provider, while applying it finds no provider group
and changes the operator's group of that id. It needs a provider id the group id type takes as the operator's (e.g.
`DE-XYZ` and `DE*XYZ`); network-wide uniqueness of group ids is checked only after the last change. The owner path was
read, the full scenario was not set up. `AddedEnergyMeterChildren` (`:1342-1395`) follows the same pattern for energy
meter templates and groups.


## 10. What a signed change set says is not what the content holds

**Demonstrated:** a change set's values are parsed into the C# model and written anew; what ends in the content differs
from what was signed, and a reader applying change sets on JSON (as the TypeScript port does, and as section 4 describes
them) must know how:

- **`@context` dropped:** revision 12 of example A8 (`UpdateProperty` of `elements` of `DE*GEF*T_AC`) writes its
  `newValue` as `[{"@context": "…/chargingTariffElement/v1", "priceComponents": […]}]`, signed so; the content holds the
  elements without it. Section 1.1: an embedded object "does not" name its context.
- **Arrays reordered:** revision 14 of example A11 (`UpdateProperty` of `identityKeys` and `signingKeyCertificates` of
  `OCC`) gives the old keys first and the new ones after; the content holds them in the order of their `@id`s, the
  certificates in the order of the `@id`s of the signing keys they certify, then of the keys that signed them
  (`POIPublicKey.Ordered`, `RoamingNetworkSigningKeyCertificate.Ordered`; likewise energy meters and their public keys,
  data licenses). Section 2 orders "embedded entities" by their identifications; certificates have none, and keys and
  meters are not called entities there.

Harmless for the C# reader. **Fix:** state the order of every array of the content in section 2, and refuse a change set
whose values are not in it, so that what is signed is what is held.


## 11. Epoch 1 checkpoints name their epoch, the specification says they do not

`SPECIFICATION.md:1459`: "Every history begins in epoch 1, whose commits and checkpoints do not name it."
`WWCP_POI3/History/RoamingNetworkCheckpoint.cs:1119` always writes `"epoch"`, also 1 (checkpoints 0 to 6 of example A11),
and section 10.1 and the examples show `"epoch": 1`. A reader following section 11 calculates other checkpoint
identifications. Commits do follow section 11.


## 12. A change without `oldValue` is not checked at all

**Where:** `WWCP_POI3/RoamingNetwork/RoamingNetwork.ChangeSets.cs:636,787`, `RoamingNetwork.ElementChanges.cs:92`
(`applied.OldValue is JToken …`), and the new `TryApplyTransparencySoftwareChange` and its twin for certificates.

A change naming no `oldValue` is applied without comparing anything; `null` means "absent". The `beforeETags` pin the
version anyway, so applying is safe; rebasing and merging, which rely on old values, are not.


## 13. The roaming network operator can not sign in place of a body or grid operator without keys

**Where:** `WWCP_POI3/RoamingNetwork/RoamingNetwork.Ownership.cs:896-900` (`SignerOf`: the RNO's signing keys for a party
without signing keys), `:659-664` (only keys that `MaySign(POIKeyUsages.Of(change))` count), `POIKeyUsages.cs`
(`TransparencySoftwareCertificate` → `certificates`, grid connection points → `infrastructure`);
`docs/ConformityAssessmentBody.md`, `SPECIFICATION.md` section 4.1 ("the RNO for a body without signing keys").

A conformity assessment body or a grid operator may take no part, without keys; "then the RNO adds, changes and removes
its certificates in its place". `SignerOf` makes the RNO the owner, but its signing keys are counted only where they may
sign the usage of the change: `certificates` for a certificate, `infrastructure` for a grid connection point. The signing
keys of an RNO name `party` (examples A1 and A11 certify them so; section 4.1 gives the RNO `party` for everything it
owns), so they never may, and its identity keys are not asked.

**Demonstrated** on a second run of the examples at `bbd4cbd` (the last block of `MakeProofs.cs.txt`): a certificate of
the BSI of example A13, which has no keys, signed by the quorum of `OCC`:

```
A certificate of the BSI, signed by the signing keys of AlphaOrg and BetaOrg of OCC: Refused, Change 0: Add of the TransparencySoftwareCertificate 'BSI-2026-0001' needs signatures by signing keys of 2 holders of the roaming network operator 'OCC' that may sign 'certificates'!
A certificate of the BSI, signed by the identity keys of AlphaOrg and BetaOrg of OCC: Refused, Change 0: Add of the TransparencySoftwareCertificate 'BSI-2026-0001' needs signatures by signing keys of 2 holders of the roaming network operator 'OCC'!
```

So the BSI can get no certificate until it has keys, unless the RNO certifies a signing key that names `certificates`
(and `infrastructure` for grid operators), which the specification does not tell it to.

**Fix:** where the RNO signs in place of a party, count its signing keys that may sign `party`, the usage of everything
the RNO owns; or say in section 4.1 which usages the RNO's keys need for it. The TypeScript port does as the C#
implementation (`checkOwnership`).


## 14. The first checkpoint of a later epoch takes signatures of any algorithm

**Where:** `WWCP_POI3/History/RoamingNetworkHistory.Epochs.cs:389-394` (`CheckpointSignatureAlgorithmError`),
`SPECIFICATION.md` section 11.3.

Section 11.3: the first checkpoint of an epoch "is signed with the algorithms of both epochs …. Its signatures are
accepted with the algorithms of either epoch". The code accepts every algorithm for it, without asking the profiles of
either epoch. Harmless while the epoch before is epoch 1, which accepts every algorithm; from epoch 3 on, the first
checkpoint takes signatures of algorithms neither epoch 2 nor 3 accepts, e.g. after epoch 2 dropped ECDSA as weak.

**Fix:** keep the profiles of the epoch before (they are in its final checkpoint) and accept the algorithms of either.
The TypeScript port accepts every algorithm for it as well, as it knows the profiles of the epoch before only from that
checkpoint.


## 15. Who stated a certificate can not be told once its body has keys

**Where:** `docs/ConformityAssessmentBody.md` ("A reader tells them apart: a body without keys signed none of its
certificates"), example A13 (*Limits*), `RoamingNetworkEffectiveTree.cs` (the proof gives the skeleton of the body).

A certificate of a body without keys is a statement of the RNO; one the body adds with its keys is its own. Once the RNO
gives the body keys, both kinds look the same: a station proof gives the certificate and the body with its current keys,
and an app reading "the body has keys" concludes it stated the certificate. Which key signed it, only the commit that
added it tells, and the app does not have it.

**Fix:** let the certificate name who stated it (e.g. `statedBy`), or keep the signature of its change in it, so that the
proof carries it. The TypeScript port reports what the proof shows, `bodyHasKeys`, and says so.


## 16. Smaller points

- **Trust anchor quorum:** `minConsensus` is checked against the number of keys, not of holders
  (`RoamingNetworkTrustAnchor.cs`, `TryCheck`); see 1.
- **Certificates and statements of another operator in a proof:** `RoamingNetworkProof.Verify` does not compare the
  `roamingNetworkOperatorId` of the certificates and of the key statement with the operator of the proof (the content
  check of a full version does). The TypeScript port does.
- **Checkpoint roles:** required roles are checked as the role a signer declares; `examples/csharp/exampleA4.cs` accepts a
  signing key of the RNO in any role. The TypeScript port binds witness signatures to the key trusted for the witness
  named, and ignores, rather than refuses, signatures by keys it does not trust (so nobody blocks a checkpoint by adding
  one).
- **Key statements trusted unchecked in the examples:** `ExampleA4.SigningKeyOf` (`examples/csharp/exampleA4.cs:260-276`)
  trusts every identity key the key statement of the version it is given names, without verifying the statement against
  the trust anchor. Example A11 hands it the version of the snapshot of checkpoint 5, which nothing checked against the
  trust anchor (only the trusted witnesses protect the verifier there), example A12 the published `QA.json` (its
  *Limits* say so). The examples are what implementers copy: a verifier following the history should verify the key
  statement where it starts, and follow it by succession only through commits it checked. The TypeScript port does
  (`OperatorTrust.of`, `OperatorTrust.followedBy`).
- **Price statements taken along into an epoch they are not of:** `TryStartNextEpoch` takes the current statements of
  epoch 1, signed with ES256, into epoch 2, which a peer starting in epoch 2 refuses (example A12, *Limits*).
- **Building the examples:** `examples/csharp/examples.csproj` references `Hermod`, `Styx`, `WWCP_Node` as sibling
  checkouts, and `WWCP_Node` needs `Norn` and `Urdr` as well, at the commits the RoamingHubCLI pins; `examples/README.md`
  says only `dotnet run`. On Windows, a checkout below a long path needs `git config core.longpaths true`. Example A12
  opens two servers on `127.0.0.1`.
- **Dependencies of COSE.TS:** `@vanaheimr/cose@0.9.0` on npm still depends on `@vanaheimr/metrological-cbor@^0.10.0`, its
  repository on `^0.11.0`: a consumer of both gets two copies of the CBOR codec.


## What was checked and found sound

Canonical JSON and deterministic CBOR (all Styx vectors), ETags, commit and checkpoint identifications with SHA-256 and
SHA-512, the effective tree with templates, tariffs, energy meter templates, transparency software manufacturers and
conformity assessment bodies, RFC 9162 trees and audit paths (bounds, domain separation) with SHA-256 and SHA-512, key
thumbprints and their checks, the signature inputs of key statements, certificates, commits, checkpoints, attestations,
change sets and price statements (ES256/384/512, Ed25519, Ed448, ML-DSA-65/87), Base64 canonicality, the trust anchor
(QR code, URL), the ownership of every change of both epochs of the examples (the quorum of the RNO, the proof of
possession of new identity keys, the keys of the new parties for their releases and certificates), checkpoint lines,
the final checkpoint of epoch 1 and the genesis of epoch 2, archive segments, price statement trees and proofs, the
evidence of example A10, the pushed commit of example A12 and the station proof of example A13: the TypeScript port,
written from the specification and the code, calculates all of them byte for byte as the C# implementation does, for
the published data of two runs of the examples at `bbd4cbd`.
