# Changelog

## Unreleased

- `poi-refusals.json` and `poi-histories.json` of WWCPPOIConformanceTests `674b173` vendored, its other vectors those of
  `3bb2928`: 11 vectors this library took and refused as given already, of where drivers ask for offers (`offersURL`,
  refused and held as written otherwise, signed for `payments`) and of preconditions held, changed and of no entity.

- A commit is identified and signed over its change set as WWCP_POI3 writes it again (`RoamingNetworkCommit.TryParse`),
  as its change set is since `7f5fbe5`: a change set with `metadata: {}`, `preconditions: []` or a precondition with
  ` DE*GEF `, its commit identified over it as written again, this library refused, "The commit identification '…' is
  not the one of its content, '…'!", where WWCP_POI3 takes it (reported by WWCPPOIConformanceTests). A change set is
  read in the order WWCP_POI3 reads it, identified by its content last, so that one wrong in two ways is refused for
  the same: its roaming network and createdAt first, then its changes, ETags, description, metadata, preconditions and
  signatures. With the change proposed for WWCP_POI3 on top of `62390ca` (a change set names only what it is written
  with, its createdAt and roaming network as it writes them again), WWCP_POI3 refuses what this library refuses, a
  property it does not read, a `createdAt` written otherwise, a roaming network given as a number, in its words: the 88
  change sets of ZProbePreconditions alike in verdicts and words.

- `poi-verifier.json` and `chargy/POIPrices` of WWCPPOIConformanceTests `3bb2928` vendored, its other vectors those of
  `86dfc09`: 3 vectors of the profile of contracts (WWCP_POI `b414296`), `sessionPrice-contract-profile` bound,
  `sessionPrice-adhoc-contract-profile` and `sessionPrice-subscription-mode` unsupported, and their documents
  `contract-profile.chargy`, `adhoc-contract-profile.chargy` and `subscription-mode.chargy`.

- EV Taler, phase 3, as WWCP_POI `62390ca` takes it: the merchant of an operator (`evTaler`) names where drivers ask
  for offers, if the operator makes them, its optional `offersURL` (`EVTalerMerchant.offersURL`), a base URL as its
  merchant base URL is one: HTTPS, ending in '/', without user, query and fragment, "The offers URL '…' must be an HTTPS
  URL! (Parameter 'OffersURL')"; read after the exchanges and checked after the merchant base URL, as WWCP_POI3 reads
  and checks it; written as Hermod writes it, or refused, "The offers URL '…' is written as '…'!". Without it, a merchant
  is written as before, byte for byte. `evTalerSessionPrices` gives what prices a session at an EVSE, as the backend of
  an operator makes its steps (`EVTalerContractTerms.TryGetSessionPrices`): its EV Taler tariff, the price statement
  current when the session begins that prices it, one of an EVSE before the station's before the pool's, and the
  elements. Probed with 29 merchants on WWCP_POI3 at `62390ca` (Hermod `c2f4bdde`): the same ETags, refusals and
  words, but for the line ends of a JSON object named in a refusal, which .NET writes as the platform does.
- A change set is identified by its content as WWCP_POI3 writes it again (`ToJSON`), not only by its changes: its
  preconditions each with its entity type and identification trimmed, also to nothing, without its context and any
  other property, none where there are none (`preconditions: []`); its roaming network trimmed; its description as Styx
  reads a text in languages (each language in lower case, a text of no language it reads left out), none where it is
  JSON null or has no text left; no metadata where they hold nothing. This library identified them as given: a change
  set with ` DE*GEF*P1 ` in a precondition, identified so, it took, which WWCP_POI3 refuses as "not identified by its
  content". Its signatures are verified over it as written again, as WWCP_POI3 signs and verifies them
  (`ToJSON(Embedded: true, IncludeSignatures: false)`), not over it as given, also of the changes written again since
  `eb607f9`. Read as WWCP_POI3 reads it: the texts of a precondition trimmed, empty ones read and refused when applied,
  "Precondition 0: the ChargingPool '' does not exist!", where this library said "Invalid precondition 0!"; its
  roaming network trimmed and compared without case (`RoamingNetwork_Id`), refused in the words of WWCP_POI3 where it
  is missing, JSON null or blank ("Invalid 'roaming network identification'!"); a description or metadata that is no
  JSON object refused ("JSON property 'description' is not an object!", "The metadata must be a JSON object!"), which
  this library took. Probed with 88 change sets with ZProbePreconditions on WWCP_POI3 at `c4c3c5a`, each identified as
  given and as WWCP_POI3 writes it: the same verdicts and words but for those this library refuses where WWCP_POI3
  takes them: a property it does not know of a change set, a change or a precondition, which WWCP_POI3 leaves out; a
  `createdAt` written otherwise than `yyyy-MM-ddTHH:mm:ss.fffZ`, which it writes so; a roaming network given as a
  number, which it reads as its text.

- A profile of contracts, `chargy-contract-gross-rates/v1` (`CONTRACT_GROSS_PRICE_PROFILE`), binds the price of a
  session started through an e-mobility provider, of a contract with it, as WWCP_POI `b414296` takes it: a price
  agreement whose `chargingMode` is `contract` is `bound` of it, of the same rates as the simple profile, and its price
  is the one the CPO charges the provider; what the provider charges its customer stays unproven. Contract mode of the
  simple profile stays `unsupported`, as the vector `sessionPrice-contract-mode` has it ("Contract mode requires an
  additional profile"), and so does `adhoc` of the profile of contracts.
- `examples/validate-examples.ts` checks example A16 as its `Validate()` does: from the file the app kept alone, against
  the trust anchor of epoch 2, the station proof at the time the session began; both steps in their contract terms
  against it and the price statement of the EVSE; the start and the end value in OCMF with the key of the meter the
  proof gives, by an OCMF verifier of its own as `VerifyOCMF` of `exampleA16.cs`; and the settlement statement, signed
  by `DE*GEF` with its key for payments. Refused: another price, the end value left out, step 1 of another merchant,
  step 2 naming the end value as the start. What it prints is what the C# example printed in a run of WWCP_POI
  `c4c3c5a`, line for line. `npm run examples` checks it on the run vendored here, `csharp-c4c3c5a` (below), the nightly
  runs of WWCPPOIConformanceTests on a new run of WWCP_POI master. README lists every test file.
- The test vectors of a new run of the C# examples, `tests/vectors/csharp-c4c3c5a` in place of `csharp-045e180`:
  WWCP_POI `c4c3c5a` with Hermod `850cab3d` and Styx `21d00134`, examples A1 to A16, MakeProofs at
  `2026-11-10T05:54:00.000Z` (`tests/at.ts`). The head of epoch 2 is revision 11, as before; example A16 adds the file
  the app keeps of its EV Taler session, `driver/evidence-DE_GEF_E1_1-evTaler.json`. With them, of
  WWCPPOIConformanceTests `228041d`, byte for byte: `poi-history.json` (the price statement of that file new, 9),
  `poi-refusals.json` (307, 33 of them with a reason now), `poi-histories.json` (89 replays, 13 new of the web payment
  page signed for payments), `poi-qidigital.json`, `poi-verifier.json` (109, `sessionPrice-flat-fee` bound) and
  `chargy/POIPrices` with `flat-fee.chargy`. The tests on QA hold the values of the new run, mapped by content, a key
  a test picks by its position the key now there; those WWCP_POI3 calculated of changed versions (the after ETags of 75
  element, embedded, infrastructure and release change sets, the ETags of preconditions, the versions with an EV Taler
  merchant) are calculated again by WWCP_POI3 at `c4c3c5a`, and this library takes the very same versions.
  `tests/conformance.test.ts` 825.
- `poi-histories.json` of WWCPPOIConformanceTests `86dfc09` vendored, its other vectors those of `228041d`: 4 replays of
  the roles every commit must be signed in (POI3-ISSUES.md S24), `required-role-*`, naming `requiredSignatureRoles`,
  which `tests/conformance.ts` now gives the options of the history of a replay: a commit signed in the role
  `roamingNetworkOperator` only by a key of DE*GEF, which the version does not certify for it, or not in it at all, is
  refused; one key that may sign in it is enough. And `offer-of-a-provider-overlapping`, two offers of an e-mobility
  provider overlapping at its EVSE group, refused (9.4). 94 replays, `tests/conformance.test.ts` 830.
- For development, Vite 8.3.7 (Rolldown 1.2.18) and typescript-eslint 8.72.2. TypeScript stays at 6.0:
  typescript-eslint 8.72.2 still requires a version below 6.1.
- The simple profile of gross rates (`chargy-gross-rates/v1`) takes a flat fee without a step size, as a FLAT price
  component has none ("A FLAT price component has no step size!"), and as WWCP_POI `c4c3c5a` takes it: it asked every
  component for a step size of at least one, so that a price agreement of a flat fee was `unsupported`, never `bound`,
  with no gross rates. A flat fee with a step size, also `null`, is none of the profile; energy and time need one of at
  least one, as before. `grossRates` is a module of its own, not exported, tested apart.
- A change is read as WWCP_POI3 reads it and refused in the words of its refusal after "Change N: ", as WWCP_POI3
  refuses it with the change proposed for it on top of `8b0580f` (`RoamingNetworkChange.Refusal`, shared by its
  constructor and `TryParse`; without it WWCP_POI3 says "Invalid change 0: …", and where its constructor refuses, the
  words of an `ArgumentException`, e.g. "Value must not be empty. (Parameter 'EntityId')"). Its texts: anything but a
  text refused, also JSON null, "Change 0: the kind must be a text!", where this library said "The kind of change 0 must
  be a text!", in the order WWCP_POI3 reads them, all before the element path; the kind trimmed, also when nothing is
  left, "Change 0: unknown kind ''!"; a parent type or identification empty, "Change 0: its parent entity type and
  identification must not be empty!", which this library refused only when applied, as not the parent; the property
  name of a segment of an element path trimmed. The context of a change is checked, "Change 0: the JSON-LD context of
  the roaming network change must be '…'!", also JSON null, where this library took any. A change set is identified by
  its changes as WWCP_POI3 writes them again (`ToJSON(Embedded: true)`): without the context of a change or of a
  segment, without an empty element path, the property name of a segment trimmed; this library identified it by them as
  given, taking a change set WWCP_POI3 refuses as not identified by its content. Probed with 77 change sets with
  changes refused when read and the 630 of the earlier probes: the same verdicts as WWCP_POI `8b0580f`, the same words
  as with the proposed change, but of a change or a segment naming a property it does not have: WWCP_POI3 does not
  refuse it when read, and then refuses the change set as not identified by its content, this library "Change 0 must
  not name the property 'foo'!".
- A new value not given as the content holds it is refused as WWCP_POI3 refuses it (`TryHeldAsGiven`): after the party
  the change changed is read again, not before, and naming what the content holds. "Change 0: the property 'name' of the
  charging pool 'DE*GEF*P1' is not given as the content holds it, '{"en":"x"}'!" of an `UpdateProperty`; "Change 0: the
  EVSE group 'DEGEFEG9' to add is not given as the content holds it, '{"@id":"DE*GEF*EG9",…}'!" of an `Add`, the
  entity without its lastChange; "Change 0: 'chargingConnectors['1']' of the EVSE 'DE*GEF*E1*1' is not given as the
  content holds it, '…'!" of an element change, its element or the property of its element; "… is given as '[]', which
  the content does not hold at all!" of a value it holds none of. This library named where it was written otherwise and
  why, "Change 0, the charging pool 'DE*GEF*P1': 'name' is not given as the content holds it: a text in languages names
  each language as Styx writes it, in lower case, with a text!", the place of an element by its index, before reading
  the party again: of an `Add` with an identification written otherwise and an invalid content, it named the
  identification, WWCP_POI3 the content. `notWritten` tells what the content holds where it is written otherwise,
  `heldAs` makes a new value so. Also held as WWCP_POI3 holds them, where this library took them as given: flags,
  `currentTypes` and `chargingModes`, in the order of their values, each once (`POIJSON.FlagsToJSON`); data licenses
  given empty, which the content leaves out, of every entity; a hotline, trimmed; a language given by its number, also
  with a sign, by its name. A new value of a property is checked as a value too, a URL or a currency, as within an
  object, where a version written otherwise refused it. Probed against WWCP_POI `8b0580f` with 88 change sets on the QA
  network, one with connectors on an EVSE: the same verdict and words for each, but a change refused as WWCP_POI3's
  constructor refuses it ("Invalid change 0: …"; refused so since, see above), and, as before, who must sign identity keys of the roaming network
  operator given twice. The earlier probes: the same verdicts, now also the words of the
  spellings probe's `Add` with an identification written otherwise and an invalid content.
- A change whose old value is no longer there is refused naming the value it found, as WWCP_POI3 names it
  (`POIJSON.ContentText`): its canonical JSON, "absent" for none. "Change 0: the property 'name' of the charging pool
  'DE*GEF*P1' is no longer the expected old value, but '{"en":"Jena Paradies"}'!", of every kind of entity, its
  embedded objects and the roaming network operator; "…'chargingConnectors['3'].format' of the EVSE 'DE*GEF*E1*1' is no
  longer the expected old value, but '"CABLE"'!" of an element change; "Change 0: the property 'name' is no longer the
  expected old value, but '{"en":"Quality Assurance"}'!" of the roaming network itself, which is no entity named, as
  WWCP_POI3 names it, where this library named it "the property 'name' of the roaming network 'QA'". A change of a
  complete entity names, as before, only whether it exists. Probed against WWCP_POI `8b0580f` with 59 change sets on
  the QA network, one with connectors on an EVSE, of every kind of entity, of properties there and absent, of an old
  value expecting one absent, of the roaming network itself and of the second change of a change set: the same words
  for each. The earlier probes: the same verdicts and words as before, now also the old values.
- What a change set changes is read again right after each change, as WWCP_POI3 reads it (`TryApplyRegistryChange`,
  `TryApplyInfrastructureChange`, …): the party the change changed, a charging station operator for its
  infrastructure, templates, groups, tariffs, offers, parking spaces and energy meter templates and groups, the party
  embedding a model, a release, a certificate, a grid connection point or parking data, the roaming network operator.
  A change making one a party WWCP_POI3 does not read is refused in its words, "Change 0: Invalid hotline phone number
  '42'!", not after the last change without them; a change set making a party invalid and valid again is refused, as
  WWCP_POI3 refuses it, where it was taken before; of two changes making a party invalid, the first is named, not what
  is read first. The groups, offers and payment options of a charging station operator are still checked after the last
  change, as WWCP_POI3 checks them there. The properties of the roaming network itself are taken as WWCP_POI3 takes
  them: "Change 0: invalid name: A multi-language text must be a JSON object!", "the data source must be a nonempty
  text!" (a blank one taken before), "the custom data must be a JSON object!", "a roaming network has no keys of its
  own: they are the keys of its RoamingNetworkOperator!", "the property 'foo' does not exist!" for one it has not,
  "Add of the roaming network itself is not supported yet!". Its operator: "the operator of a roaming network is
  changed, but neither added nor removed!", "the roaming network operator 'XYZ' does not exist!", "a roaming network
  operator of this roaming network belongs to RoamingNetwork 'QA', not to …". Probed against WWCP_POI `8b0580f` on the
  QA network with 88 change sets, every kind of party and of what it embeds, invalid values, invalid values made valid
  again, two of them in either order: the same verdict for each, the same words for each but two, which this library
  words otherwise for every kind of entity, not as it reads them again: an old value no longer there, which WWCP_POI3
  names, "…, but '{"en":"Quality Assurance"}'!" (named so since, see above), and a new value the content does not
  hold (refused so since, see above). The 116 change sets of the
  spellings probe: four more in WWCP_POI3's words, the rest as before. The reading again costs about 1 s of the 80-odd
  seconds of the conformance tests.
- The web payment page of a charging station operator, a charging pool, a charging station and their templates, as
  WWCP_POI `848cc52` has it (`webPaymentURL`): the URL where an EV driver pays ad hoc, without an e-mobility provider,
  and starts a session, found in the static data before standing in front of a station; not the URL in the dynamic QR
  code of a station, which is of one EVSE and never part of them. Read and written as WWCP_POI reads and writes it,
  refused when no text or no URL ("Change 0: Invalid web payment URL '42'!"); taken by the members of a template
  without their own (effective pools and stations); changed and removed by change sets. Whoever changes it redirects
  payments: a change of it needs a signing key that may sign `payments`, and a pool, a station or a template added
  with one, a pool by one of its stations as well, a key that may sign `infrastructure` and `payments`, "… that may
  sign 'infrastructure' and 'payments'!". The usage of a change is now a set of usages a key names all of; the roaming
  network operator still signs everything it owns by a key for `party`. Commits with a web payment page were refused
  before. Probed against WWCP_POI `8b0580f` on the network of its `WebPaymentURLTests` and 23 change sets, unsigned and
  signed by keys for `payments`, `infrastructure`, `party` and both: the same verdict and the same signers for each, the
  same content after each of the 19 taken, the two invalid values in the same words since every change is read again.
- `examples/validate-examples.ts` checks example A15 as its `Validate()` does: the station proof of DE*GEF*E1*1 the app
  gets, against the trust anchor of epoch 2, with the EV Taler merchant of DE*GEF; the EV Taler tariff of the EVSE and
  the exchanges in its currency the app shows, those in another currency not offered there; the merchant base URL and
  the merchant key every offer must name; and the proof refused once its merchant key is changed to the key of an
  exchange, the root its attestations do not attest the one WWCP_POI names. What it prints is what the C# example
  printed in the run `csharp-045e180`, line for line.
- A charging station, EVSE or energy meter given twice within one charging station operator is refused, as WWCP_POI
  `e76e5d0` refuses it: "The charging station 'DE*GEF*S1' of the operator 'DE*GEF' must not be given twice!", the same
  for an EVSE and an energy meter. Before, a station in two of its pools, or an EVSE in two of its stations, was taken,
  by WWCP_POI3 too; proofs, price statements and evidence name them by their identifications alone. Three refusals of
  `poi-refusals.json` of WWCPPOIConformanceTests `bfc8fa0` hold them, one of each, in the words both give.
- Data licenses that differ in case only are given twice (Hermod `f7b00ef2`): "OWN-1.0" and "own-1.0", "CC BY 4.0" and
  "cc by 4.0".
- Refusals speak as WWCP_POI `74f1d8e` and Styx `21d00134` speak them: "An" before A, E, I and O, "A" before any other
  letter ("A public key of …", "An EU vehicle category of …", "An ENERGY price component needs a positive step size!");
  numbers without trailing zeros ("22000.5 W", not "22000.50 W"); "Invalid opening times: " once, not twice; "Besides
  its grid operator, the grid connection point '…' can only be maintained by a charging station operator or a parking
  operator, not by …!".
- The refusals of changes say their articles as WWCP_POI `8b0580f` says them: "the property 'maxPower' of an EVSE
  group can not be changed!", "of an energy meter model", "of an EVSE template", not "of a EVSE group". A group, a
  template, a tariff or a charging pool added below another parent than its charging station operator is refused in
  WWCP_POI's words: "Change 0: an EVSE group 'DE*GEF*EG9' belongs to ChargingStationOperator 'DE*GEF', not to
  ChargingPool 'DE*GEF*P1'!", not "the EVSE group … is added to its charging station operator 'DE*GEF', …". Probed
  against WWCP_POI `8b0580f` on 29 change sets of every kind of entity: 27 in the same verdict and words. WWCP_POI
  refuses one change when it reads the change set, in other words, and takes the parent 'de*gef' for 'DE*GEF' (see
  below).
- A change names the infrastructure of a charging station operator in every spelling its identification type considers
  equal, as WWCP_POI3 finds it (`StoredId`): `DEGEFP1`, `DEGEF*P1` or `degefP1` for the charging pool `DE*GEF*P1`,
  `DE*GEF*E11` for the EVSE `DE*GEF*E1*1`, `de*gef` for its operator, as the entity, as its parent and as the parent it
  is added to. The operator is the one its identification names, as its type reads it, and signs the change, whether it
  exists or not ("… needs a signature by a signing key of the ChargingStationOperator 'DE*XXX'!"). Before, only the very
  text it is kept with was found, and other spellings were refused. Refused in WWCP_POI3's words: "invalid charging pool
  identification 'de*gef*p1'!", "the charging station operator 'DE*XXX' of the charging pool 'DE*XXX*P1' does not
  exist!", "adding the charging station '…' needs its ChargingPool as its parent!", "the charging pool '…' of the
  charging station '…' does not exist!", and an entity added under an identification its type writes otherwise, "the EVSE
  group 'DEGEFEG9' to add is not given as the content holds it, '{"@id":"DE*GEF*EG9",…}'!".
- The kind, the entity type and the entity identification of a change are read trimmed, as WWCP_POI3 reads them
  (`ParseMandatoryText`), and the identification of a change set is of its content so read: a change set naming
  `' DE*GEF*P1'` is identified as one naming `'DE*GEF*P1'`, and refused, "is not identified by its content", when
  identified by the text untrimmed.
- Probed against WWCP_POI `8b0580f` on 190 change sets, as `TryApplyPendingChangeSet` reads and applies them and
  `TryCheckCoSigning` names their owners: the same verdict for each, the same content after each of the 94 taken (after
  ETags of `CreateChangeSet`), the same words but for seven. Four have two faults at once, refused in another order (an
  EVSE removed whose station then exceeds its maximum power and whose group names it; a tariff without elements added
  under another spelling); a tariff without elements is refused without "Change 0: ", as this library reads the
  operator once after all changes; and WWCP_POI refuses an empty identification and a parent type without its
  identification when it reads a change set, as "Invalid change 0: …" (refused so since, see above). Who must sign a change of a party without
  signing keys was named otherwise in four of them (see below).
- A change of a party without signing keys, which the roaming network operator signs in its place (`SignerOf`), is
  refused unsigned as WWCP_POI3 refuses it (`TryCheckCoSigning`): naming the roaming network operator, by as many
  holders as its quorum needs, not the party, which has no key to sign with, e.g. "… needs signatures by signing keys of
  2 holders of the roaming network operator 'OCC'!"; signed by a key of it that may sign neither the usage of the
  change nor `party`, with both, "… needs a signature by a signing key of the roaming network operator 'DE*RNO' that
  may sign 'certificates' or 'party'!". Of several owners, e.g. of a grid connection point, the roaming network
  operator is named with its quorum too, its identity keys as well, once each, and "signatures" where one owner needs
  more than one holder. Probed against WWCP_POI `8b0580f`: the 190 change sets above and 11 more name who must sign
  them alike, word for word.
- The key statement of the roaming network operator is refused as its constructor in WWCP_POI3 refuses it: an identity
  key given twice ("An identity key of a key statement must not be given twice!") before the order of its identity keys
  is looked at, and a signature by one identity key given twice ("An identity key signs a key statement once."), which
  was taken before; its validity in C#'s words. Probed against WWCP_POI `74f1d8e` on 36 versions of QA, the same
  verdict and words for each. Four vectors of `poi-refusals.json` follow the new words.


## 0.3.0 (2026-11-08)

WWCP_POI3 as the measure: a roaming network is read as WWCP_POI3 reads it and refused in its words, change sets apply
what WWCP_POI3 applies (the entities a party embeds, element changes, preconditions, no lastChange going back),
histories require the signature roles WWCP_POI requires and take a checkpoint with the signatures that verify, and EV
Taler phase 2 checks the steps and the settlement of a session. Each of them is probed against WWCP_POI3, what differs
named below, and the vectors of WWCPPOIConformanceTests `215023a` hold, none deviating. See [Migration](#migration)
before upgrading: versions, change sets and signatures 0.2.0 took are refused, and the types of three properties change.

- A roaming network is read as WWCP_POI3 reads it (`RoamingNetwork.TryParse` and the TryParse of every entity) and
  refused in its words and its order: JSON types, mandatory properties, values, identifications, names of enumerations,
  currencies, URLs, timestamps, texts in languages, data licenses, and what the constructor of each entity refuses of
  what it read (`src/network/reading.ts`, `poiJSON.ts`, `poiValues.ts`). Every kind of entity it reads: the roaming
  network and its operator; charging station operators with their pools, stations, EVSEs, connectors, energy meters,
  templates, groups, tariffs, tariff templates, groups and offers, brands and parking spaces; manufacturers of charging
  stations and energy meters with their models, transparency software manufacturers with their releases, conformity
  assessment bodies, e-mobility providers, grid operators with their grid connection points, parking operators.
- The references the constructor of the roaming network checks, and the identifications it keeps unique among them,
  interleaved in its order (`references.ts`): manufacturers, models, hardware revisions and firmware versions, releases,
  certificates, grid connection points, charging stations, parking spaces and maintainers the network does not have, a
  station or an energy meter contradicting its model, a key of two parties. After the last change of a change set, bare,
  in the order of `RoamingNetwork.ChangeSets.cs`, a reference the version before resolves named as one the change set
  withdrew. They replace the separate checks of identifications, versions, certificates, EV Taler and keys of parties.
- 1268 versions probed against WWCP_POI3 at 89d2e02 are taken and refused alike, in the same words, but for nine agreed:
  five identifications of the roaming network and its operator given as numbers, which keep the words of this library
  for WWCP_POI3 to take, and four messages of the CBOR and COSE libraries.
- Values WWCP_POI3 writes otherwise than given are refused in the words of its written form (`writtenForm.ts`): a
  number, a boolean or a text given as another JSON type it reads it of (`"0.390"` as 0.390, `"TRUE"` as true, 5 as
  `"5"`), coordinates of texts and booleans, durations in seconds in whole ticks of 100 ns without trailing zeros (1.50
  as 1.5), the width and height of an image; opening times as Styx writes them, `24/7` always, hours `HH:mm`, periods
  UTC, empty lists and free texts left out; NUTS codes in upper case, a list written otherwise compared element by
  element with the one WWCP_POI3 writes; addresses with their countries by their alpha-3 codes, their street, postal
  code and time zone trimmed, their other texts as given and left out where empty, their languages in lower case,
  nothing else. A country is read as `Country.TryParse` of Styx reads it, of its 251 countries (`countries.ts`): by its
  alpha-2 or alpha-3 code in any case, its numeric code, its calling code or one of its names, and refused where it
  names none. Of 164 more versions probed against WWCP_POI3 at 89d2e02, 163 are taken and refused alike, in the same
  words; the one left gives a number with an exponent, which the probe writes otherwise before WWCP_POI3 reads it.
- Two charging tariff offers of an operator must not overlap (`offers.ts`, `OverlappingOffers` of WWCP_POI3, SPECIFICATION.md
  9.4): covering one EVSE, for some of the same sessions (ad hoc, or contracts of a provider both name, or one names
  none), at some of the same times within their `notBefore` and `notAfter`, both inclusive, and their opening times in the
  time zone of the EVSE's charging pool, with what its templates give it, else UTC; local times as `TimeZoneInfo`
  converts them, one a change to daylight saving time skips the first after it, one it gives twice the one of standard
  time; exceptional closings
  close, exceptional openings open. Refused in its words, at the first EVSE in the ordinal order, as the constructor of
  the operator refuses it, also after a change set. After a change set also two offers of an e-mobility provider the
  change set changed that overlap and did not in the version before (`NewProviderOfferOverlap`); by the changes of
  others they may. Of 64 versions probed against WWCP_POI3 at d1c41ca, all are taken and refused alike, in the same
  words, also those of time zones a charging pool may not name.
- The time zone of a charging pool or a charging pool template is one of a region of the IANA time zone database, as
  the database writes it, which this platform knows (`timeZones.ts`, `POITimeZones` of WWCP_POI3 `d1c41ca`,
  SPECIFICATION.md 9.4, D17 of the conformance tests): `Europe/Berlin`, also an older name the database keeps for one,
  `Asia/Kolkata` as `Asia/Calcutta`, or of a part of a region, `America/Argentina/Buenos_Aires`. No name of another
  system (`W. Europe Standard Time`), none without a region (`CET`, `UTC`, `Etc/GMT-1`, `US/Eastern`), none in another
  case (`europe/berlin`), none the platform does not know: refused in the words of WWCP_POI3 as the constructor of the
  pool or template refuses it, trimmed, after its images, no longer taken as UTC, nor a Windows name as its IANA name.
  The case is the one Temporal gives (Node 26); without Temporal (Node 22 and 24) Intl gives it of a name, but of an
  older name only the name it stands for, so an older name is then taken in any case (`Asia/KOLKATA`). Of 92 versions
  probed against WWCP_POI3 at `d1c41ca`, 90 are taken and refused alike, in the same words; the two left name
  `America/Ciudad_Juarez` and `Antarctica/Troll`, which .NET on Windows does not find, and this library takes, as Node
  knows them: databases of different age know different names (SPECIFICATION.md 9.4). `poi-refusals.json` of
  WWCPPOIConformanceTests vendored again without the marker of D17: its 10 time zones are refused by their reasons.
- A measurement public key is a key as BouncyCastle 2.7.0 makes one, as WWCP_POI3 checks it (`measurementPublicKey.ts`,
  `MeasurementPublicKey.TryCheck`), refused in its words and those of BouncyCastle: a SubjectPublicKeyInfo of DER
  (`ber.ts`), of RSA, also of PSS and OAEP, its modulus odd, of no prime factor up to 743, of 16384 bits at most and no
  prime, its exponent odd (`rsa.ts`); of EC on the 84 named curves BouncyCastle knows (`curves.ts`, taken from it), a point
  it decodes, compressed, uncompressed or hybrid, on its curve and of its order (`ecc.ts`); of Ed25519 and Ed448 a point
  of no small order; of X25519, X448, ML-DSA, ML-KEM and SLH-DSA of their lengths; of DSA in its group. Its certificates
  DER, as X509CertificateParser reads them, the first of the key, each one issued by the next one, its signature of
  ECDSA, DSA, RSA of PKCS #1 v1.5 or PSS, Ed25519, Ed448 or ML-DSA verified with the key of the next one
  (`certificates.ts`). Of 242 keys and chains of BouncyCastle and variants of them probed against WWCP_POI3 at 89d2e02,
  237 are taken and refused alike, in the same words; taken as given, where WWCP_POI3 checks them: points on curves over
  binary fields, explicit curve parameters, keys of Diffie-Hellman, ElGamal, GOST and DSTU. Not verified, so refused: a
  certificate signed with GOST, SM2 or SLH-DSA.
- Other words: decimals in messages invariant and line breaks `\n`, where WWCP_POI3 writes them in the culture of its
  machine and `\r\n`; timestamps `DateTimeOffset` reads and the written form refuses, refused as invalid; an error of an
  entity changed by a change set without the `Change N:` of WWCP_POI3.
- A price statement reads its price status as WWCP_POI3 reads it (`ChargingPrices.TryParse`), in its words and order,
  under its "Invalid price status of the price statement:": the prices of each charging tariff once, the tariff named
  by its identification `{operatorId}*T{suffix}` (SPECIFICATION.md 2, 12.1, D16 of the conformance tests), their
  elements, at least one, as a tariff has them, no property or JSON-LD context besides. A statement naming another text
  is no price statement: the price evidence of a session holding one has invalid signatures, as WWCP_POI3 gives it
  (`sessionPrice-foreign-tariff`), not valid ones of a tariff outside the references of its EVSE.
- The nine vectors of WWCPPOIConformanceTests `fde40c9` vendored, `poi-refusals.json` of 129 vectors (a version naming a
  charging tariff not as `{operatorId}*T{suffix}`), and `poi-verifier.json`, new here: 106 checks of the verifier
  extensions, meter keys, historical meter evidence, session prices, trust transitions, keys of charging documents,
  trust policy identifications, digests of key statements, offer hashes and publication receipts, against the POI
  fixtures of ChargyWebApp at `fc513cd`, vendored as `tests/vectors/chargy-fc513cd`. Run in `tests/conformance.test.ts`
  as WWCPPOIConformanceTests runs them against this library: a refusal after its control, by its reason; none deviates.
- `poi-refusals.json` of WWCPPOIConformanceTests `7d43d4b` vendored (`586a339` before a rebase there), of 142 vectors:
  13 price statements whose price status is none WWCP_POI3 reads (without one; its prices not an array; the prices of a
  tariff not an object; a property or a JSON-LD context besides, of the status or of the prices of a tariff; a tariff
  not named `{operatorId}*T{suffix}` or named twice, also in another spelling; its elements empty, one not an object or
  without price components), refused as both read them, in the words both give. None deviates.
- `poi-refusals.json` of WWCPPOIConformanceTests `ed91741` vendored, of 273 vectors: 131 versions built from the tests
  of this library and read as WWCP_POI3 reads them, 59 of reading, 18 of references, 33 of written forms, 11 of offers,
  10 of measurement public keys, refused in the words both give. None deviates. Two of them, offers of `Europe/Berlin`,
  WWCP_POI3 takes where .NET runs without ICU, as it then finds no IANA time zone and compares them in UTC (O5 there).
- `@vanaheimr/cose` 0.14.0, the codec still `@vanaheimr/metrological-cbor` 0.12: a key of a party of key type RSA (3) is
  read as Styx reads it, identified by its RFC 9679 thumbprint over n and e, and taken as WWCP_POI3 takes it; 0.12.0
  refused it, "Invalid COSE key: The curve of a COSE key must be an integer!". POI names no signature algorithm of RSA
  (SPECIFICATION.md 4), so such a key signs nothing this library verifies, as before.
- `@vanaheimr/cose` 0.15.0, the codec still `@vanaheimr/metrological-cbor` 0.12. It reads and verifies the
  countersignature of RFC 8152 and holds a key an X.509 certificate writes as `id-RSASSA-PSS` to RSASSA-PSS, as Styx
  `7642de3d` does. This library uses neither, and reads and verifies its keys and signatures as with 0.14.0. For
  development, Playwright 1.65.0 and Vite 8.3.6. TypeScript stays at 6.0: typescript-eslint 8.72.1 requires a version
  below 6.1, and its typed linting needs the compiler API that TypeScript 7 does not ship.
- `poi-refusals.json` of WWCPPOIConformanceTests `d388929` vendored, of 283 vectors: 10 versions naming a time zone of a
  charging pool or a charging pool template that is none of a region of the IANA time zone database, refused by WWCP_POI3
  since `d1c41ca` and taken by this library, marked as its deviation (D17 there).
- A change set changes the entities a party embeds, as WWCP_POI3 applies them (`apply.ts`; RoamingNetwork.OfferChanges.cs,
  ProviderChanges.cs, GridChanges.cs and ParkingChanges.cs): the charging tariff offers of charging station operators
  and e-mobility providers, the EVSE, charging station and charging pool groups of e-mobility providers, the grid
  connection points of grid operators, the parking garages, spaces, sensors, space templates, space groups and products
  of parking operators and the parking spaces of charging station operators. Added to the party an `Add` names as its
  parent, found by its identification as its type compares it, e.g. a parking product with case, the properties a change
  set may change, in the words of WWCP_POI3; with their timestamps, but a grid connection point and a parking product,
  which have none. Owned by the party embedding them (4.1), the offers by keys that may sign `tariffs`, the others
  `infrastructure`; a grid connection point by its maintainer, its maintainer changed by it, its grid operator or the
  identity keys of the roaming network operator; also after the earlier changes of the change set, which may add or
  remove them or their party. 0.2.0 refused them as not supported. Of 107 change sets probed against WWCP_POI3 at
  `d1c41ca` (`CreateChangeSet`), the 50 it takes lead to the same content here, and the 57 it refuses are refused here
  too, 34 in the same words; the others in the words of the entity read again without `Change N:`, of the change as
  WWCP_POI3 parses it, or of the written form, where WWCP_POI3 names a property of infrastructure a change set may not
  change.
- The `effectiveLastChanges` of a snapshot are read as WWCP_POI3 reads them (`TryTakeEffectiveFloors`,
  POIEffectiveLastChange): absent or `null`, or an array of `{entityType, entityId, lastChange}`, a JSON-LD context only
  its own, the timestamp in a form `DateTimeOffset` reads; refused otherwise in its words, "The effective last changes of
  a snapshot must be a JSON array!", "Invalid effective last change '{…}' of a snapshot!". 0.2.0 took any. They are the
  floors of the `lastChange` of effective members POI_API keeps at runtime (SPECIFICATION.md 8.8, point 3), found again
  for what a change set changes; the effective tree takes the `lastChange` of an effective member without them (8.1),
  as WWCP_POI3 does (`EffectiveChargingPoolsOfTheContent`), so this library reads them and keeps none.
- The preconditions of a change set hold, as WWCP_POI3 checks them (`preconditions.ts`; RoamingNetwork.Preconditions.cs,
  SPECIFICATION.md 4): each names the ETag an entity still has in the version the change set is applied to, after its
  `beforeETags` and before its changes, over the entity as the roaming network embeds it, with everything it embeds, its
  canonical JSON or its deterministic CBOR, in the hash algorithm it names. The entity is found by its type and
  identification as its type compares it, e.g. `DEGEFP1` as `DE*GEF*P1`, among the entities a change set addresses on
  their own (`Flatten`), not a model, which is unique within its manufacturer only, as in WWCP_POI3. Refused otherwise in
  its words, "The change set does not fit this version of the roaming network: Precondition 0: the ChargingPool
  'DE*GEF*P1' changed, it no longer has the ETag json:sha256:hex:…!", and a precondition not read as it reads one in a
  change set, "Invalid precondition 1!". 0.2.0 refused change sets with preconditions as not supported. Of 79 change sets
  with preconditions probed against WWCP_POI3 at `d1c41ca`, ETags of 40 entities of every kind among them, all are taken
  and refused alike, 70 in the same words, the others refused when read, where the probe reads a precondition on its own.
- A change set changes elements, as WWCP_POI3 applies them (`elements.ts`, `apply.ts`; POIElements.cs and
  RoamingNetwork.ElementChanges.cs): `AddElement`, `RemoveElement`, `ReplaceElement`, `UpdateElementProperty` and
  `RemoveElementProperty` address an element of a property of an entity by their element path, e.g.
  `chargingConnectors['1'].format`, an element of an array by its identification, as the type of the identifications of
  the property compares them, e.g. `EVSEIds` without case, any other ordinally; an added element where the ordinal order
  puts it, in `templateIds` at the end; an array left without elements removed. Each amounts to the `UpdateProperty` or
  `RemoveProperty` of the property its path starts with, checked and owned as that change (4.1), its old value compared
  with the element, or the property of the element, it addresses; keys and tree hash algorithms are changed as a whole
  only. Element changes WWCP_POI3 does not make are refused when the change set is read: an element change without an
  element path, another change with one, a new value of JSON `null`, of each kind of change what it does not take, e.g.
  an `AddElement` with an old value, a segment of a path without a property name or with an empty identification.
  0.2.0 refused element changes as not supported. The properties of charging pools, stations, EVSEs, tariffs, groups and
  templates a change set may change are those of WWCP_POI3 (RoamingNetwork.InfrastructureChanges.cs), refused otherwise
  in its words, e.g. "the property 'chargingStations' of a charging pool can not be changed!", and an infrastructure
  entity is named as WWCP_POI3 names it, e.g. "the charging tariff 'DE*GEF*T_AC'". Of 108 element changes probed against
  WWCP_POI3 at `d1c41ca` (`CreateChangeSet`), the 47 it takes lead to the same content here, and the 61 it refuses are
  refused here too, 31 in the same words; the others in the words of the entity read again without `Change N:`, of an
  old value without the value found, or of a change as this library reads it. Of the 107 change sets of embedded
  entities probed before, 93 are now in the same words.
- The elements of the prices of a charging tariff in a price statement are written as a charging tariff holds them
  (SPECIFICATION.md 12.1, WWCP_POI3 `5a72313`, D18 of the conformance tests), as a version holds the elements of a tariff:
  an element, a price component or restrictions naming a property their type does not define, a number given as a text,
  the days of the week out of their order, the JSON-LD context of an embedded object are refused before the signature,
  "'elements[0].restrictions.maxStateOfCharge' of the prices of the charging tariff 'DE*GEF*T_DC' is not written as a
  charging tariff holds it: the content leaves it out!" under "Invalid price status of the price statement: ". A reader
  not knowing a restriction would else price a session where its signer did not. The written form knows the
  restrictions of an element now (`startTime` to `reservation`, as ChargingTariffRestrictions writes them): a version
  naming another one, e.g. `maxStateOfCharge`, is refused, which 0.2.0 took. The price evidence of a session whose
  statement names a restriction of OCPI, e.g. `max_kwh`, has invalid signatures now (`sessionPrice-conditional-price`).
  `poi-refusals.json` and `poi-verifier.json` of WWCPPOIConformanceTests `c540c7f` vendored, 290 vectors, 7 of them new;
  none deviates.
- `poi-histories.json` of WWCPPOIConformanceTests `bc4e5a0` vendored: the 13 replays this library left to WWCP_POI3
  (`notApplicable`) hold here as well and are replayed: the references a version holds, e.g. `station-*`, `meter-*`,
  `withdrawn-while-named-*`, checked since `813e1d7`, and the changes of the groups of a provider and of grid connection
  points, applied since `1946013`, each refused in the words of its reason. `tests/conformance.test.ts` 760.
- `poi-histories.json` of WWCPPOIConformanceTests `70deea0` vendored: 14 replays of the entities a party embeds, as
  `1946013` applies them, in `history-parties`: offers of an operator, signed for `tariffs`, not overlapping; an offer
  and groups of a provider, signed by the provider, not by the operator of the same prefix; a grid connection point
  handed on and named in one change set, by its new maintainer (csharp-review 9); parking data of a parking operator
  and the parking space of a charging station operator, each signed by its own party. `tests/conformance.test.ts` 774.
- `poi-verifier.json` of WWCPPOIConformanceTests `aef4b38` vendored, with the price evidence of sessions it makes itself
  (`tests/vectors/chargy/POIPrices`): the cases of `POIPrices` of ChargyWebApp `fc513cd`, every signature
  deterministic. 23 `sessionPrice-*` vectors check the same as before on them; `-foreign-tariff` and
  `-conditional-price` stay on the fixtures. Two new ones are taken: `-tariff-of-another-evse`, a genuine price of a
  tariff of the pattern `{operatorId}*T{suffix}` the EVSE does not name, of which none applies, and
  `-conditional-element`, an element restricted by `maxEnergy`, whose price is selected without a rate.
  `tests/conformance.test.ts` 776.
- Transparency software releases and certificates are identified under their owners, as WWCP_POI3 `045e180` checks it
  (SPECIFICATION.md 4.1, POI3-ISSUES.md S36, `ForeignTransparencySoftware`, `ForeignConformityCertificate`,
  `IsIdentifiedUnder`): the `@id` of a release is the `@id` of its manufacturer, a colon and a name without one
  (`GraphDefined:chargy-1.5.0`), of a certificate the `@id` of the body issuing it alike (`PTB:2026-0042`), the prefix
  compared without case, both trimmed as read. A version holding one identified otherwise is refused before releases or
  certificates given twice, in its words: "The transparency software release 'chargy-1.5.0' of the manufacturer
  'GraphDefined' is not identified as one of it: by 'GraphDefined:' and a name without a colon!"; so is a change set
  leading to one, after the unknown parking spaces and before the releases given twice. References name them as before.
  Of 38 versions and change sets probed against WWCP_POI3 at `045e180`, all are taken and refused alike, in the same
  words. `tests/releaseIdentifications.test.ts`.
- The test vectors of a new run of the C# examples, `tests/vectors/csharp-045e180` in place of `csharp-33447ac`: WWCP_POI
  `045e180`, examples A1 to A15, MakeProofs at `2026-11-05T19:46:00.000Z` (`tests/at.ts`). Releases and certificates
  under their owners (`GraphDefined:chargy-1.5.0`, `PTB:2026-0017`, `PTB:2026-0042`); example A15 names the EV Taler
  merchant of DE*GEF, so the head of epoch 2 is revision 11, while `QA.json` stays revision 8, as example A14 left it.
  With them `poi-history.json` (100 vectors), `poi-refusals.json` (296, 6 of them of S36), `poi-histories.json` (75
  replays, 8 of them of S36, the histories naming releases and certificates under their owners) and `poi-qidigital.json`
  of WWCPPOIConformanceTests `2d0780f`. The tests on QA hold the values of the new run; those WWCP_POI3 calculated of
  changed versions (element and embedded changes, preconditions, EV Taler) are calculated again by WWCP_POI3 at
  `045e180`, and this library takes the very same versions. `tests/conformance.test.ts` 794.
- Required signature roles, as WWCP_POI `12e993a` checks them (POI3-ISSUES.md S24): `requiredSignatureRoles` of a history,
  the roles a commit must be signed in, refused before it is applied where it has no signature in one ("The commit '…'
  is not signed in the role '…'!"), and once its signatures are verified where none of them is by a key the version it
  leads to lets sign in that role ("… by a key that may sign in it!", `keyMaySignIn`): in the role of the roaming
  network operator a signing key certified for it, in the role of a charging station operator a signing key of the
  operator its signer names; leaders and witnesses are the verifier's. So also the commit of a snapshot.
  `requiredCheckpointSignatureRoles`, the roles a checkpoint must be signed in ("The checkpoint '…' is not signed in the
  role '…'!"). A signed commit without a verifier is refused before it is applied, as WWCP_POI does. Signatures of one
  key in one role, e.g. the twin of an ECDSA signature (S11), are kept as given, each verified, and counted once by the
  holder or witness they are of, as WWCP_POI `f7b8643` reads them too (SPECIFICATION.md 5.4): it kept the first alone
  since `12e993a`, so a forged signature behind a genuine one of its key went unchecked. `tests/signatureRoles.test.ts`.
- A checkpoint is taken with the signatures that verify here, as WWCP_POI `399b7c8` takes it (POI3-ISSUES.md S39,
  SPECIFICATION.md 10.2): `verifyCheckpoint` of a history returns those of its signatures that verify, and the history
  keeps the first of each key and role of them; one that does not verify, invalid or by a key not trusted here, is left
  out, not refused, so that nobody blocks a checkpoint by adding a signature, and a witness trusted elsewhere and not here
  keeps none from it. The roles a checkpoint must be signed in are counted among them: before, a role of a signature
  `verifyCheckpointSignatures` passed over counted ("The checkpoint '…' is not signed in the role '…' by a signature that
  verifies here!", and why the first one was left out). `takeCheckpoint` and a snapshot of a checkpoint hold it with
  those only (`Checkpoint.withSignaturesOnly`). `verifyCheckpointSignatures` returns them as `verified`. The type of
  `verifyCheckpoint` is now `(checkpoint) => readonly RoleSignature[] | undefined`: `undefined`, every signature verifies,
  as before; a callback of a block without `return` is typed `void` and is no longer one.
- A signature of a commit or checkpoint is read as WWCP_POI3 reads it (`RoamingNetworkCommitSignature.TryParse`): its role,
  time, algorithm, key and value trimmed, its signer as given, and what it signs is what was read; refused when its role,
  signer, algorithm, key or value is empty or whitespace alone (`String.IsNullOrWhiteSpace`), and so is a signature of a
  change set whose algorithm, key or value is ("The … of a signature of … must not be empty!"). Before, this library took
  them, and a role padded with whitespace was not the role.
- Required signature roles probed against WWCP_POI3 at `12e993a`, `f7b8643` and `399b7c8` (`CheckSignatures` of a
  snapshot, `TryAppend`, `TryAddCheckpoint`), on QA of epoch 2: 1879 cases of roles required of a snapshot, a commit and
  a checkpoint, signed in every role, by keys of the roaming network operator, of DE*GEF and of nobody, by signers named
  in every form, with and without a verifier; a second signature of one key in one role, the same, forged or signed
  later; checkpoints verified by a rule leaving signatures out, forged ones before genuine ones among them; signatures
  read with texts empty, padded and of other types. At `399b7c8` all are taken and refused alike, the checkpoints held with
  the same signatures, the roles in the same words, signatures read refused in the words of this library. Stricter than
  WWCP_POI3 there, which took them: a signer given as a number, an `@context` or another property in a signature of a
  commit or checkpoint, and in the commit of a snapshot an algorithm its epoch does not name. WWCP_POI `b43ff1a` refuses
  them too (POI3-ISSUES.md S40), and `7c6f91c` refuses a signature read in the words of this library, a snapshot naming
  why its commit is refused: probed again at `7c6f91c`, all 1879 alike, word for word.
- `poi-refusals.json` and `poi-histories.json` of WWCPPOIConformanceTests `215023a` vendored, 806 vectors there, 13 of
  them new: 8 refusals of a signature of the genesis commit or of checkpoint 1 not in its one form (another property,
  `@context`, a signer as a number, a role of whitespace, a signedAt without milliseconds); a replay starting from the
  snapshot of the genesis of epoch 3, its commit signed with Ed448, which the epoch does not name; 4 snapshots of
  checkpoint 0 anchored with a signature that does not verify or a witness the trust anchor does not know (taken, S39), a
  key of one holder signing twice (refused) and with the other holder too (taken). None deviates.
- What a proof gives of a child array, as WWCP_POI `d35c780` tells it (S29): `givesCompletely`, whether an entity as a proof
  gives it has a child array completely, as an array or none, or pruned or partially; `sizeOf`, how many children it has,
  also where the proof gives only some or none of them. A size or index beyond what this platform holds, and an object as
  the identification of the roaming network, were refused already.
- No lastChange goes back, as WWCP_POI `12e993a` stamps a change set (SPECIFICATION.md 4, "Timestamps", POI3-ISSUES.md
  S5): with its createdAt, or the lastChange of the roaming network of the version it is applied to, where that is later,
  as the lastChange of the network, of what it changes, adds and embeds, and as the created of what it adds without one.
  Its keys are still checked at its createdAt; nobody is refused for it, only the ETags after it differ (`stampOf`). The
  after ETags of the element and embedded change sets and of the preconditions of the tests, created before QA, are
  those WWCP_POI3 at `12e993a` calculated for the very same changes (67 change sets, all alike). `poi-histories.json` of
  WWCPPOIConformanceTests `249d667` vendored: the three rebased change sets of `history-parties`, created at 08:06:30 on a
  head of 08:07:00, are stamped 08:07:00. `tests/lastChange.test.ts`: every change set of both epochs of QA, created
  before its version, stamped with its lastChange.
- EV Taler, phase 2, as WWCP_POI `c2d39e5` checks it (concepts/EVTaler.md 5 and 7, `src/evTaler`): the contract terms of
  a step of a session (`EVTalerContractTerms`: version 0, an order, an amount and a maximum fee as GNU Taler writes them,
  the merchant, its exchanges, the times, an auto refund) and their step in `extra.wwcp` (`EVTalerStep`: the roaming
  network, the EVSE, the session, the step after the order before, the EV Taler tariff, the price statement, what it
  covers, from step 2 on the signed meter value at the start, an object as OCPP 2.1 sends it), checked against the proof
  of the station: the operator's merchant and exchanges in the currency of the EV Taler tariff of the EVSE, the price
  statement current when the session began, each step following the one before, the signed start value verified with
  the measurement key of the meter or the station the proof gives, by a transparency software passed in; the amount of a
  step recalculated where the session is priced by one element of the simple profile (`EVTalerRates`), as System.Decimal
  calculates it (`NetDecimal`: 96 bits, 28 places, rounded half to even), rounded up to the minor unit. A `taler://pay`
  URI (`EVTalerPayURI`) names the merchant of the operator. The settlement statement (`EVTalerSettlement`), signed by the
  operator with a key that may sign `payments`, refused without both signed meter values, of the steps of the session,
  its energy and times those of the values, its price recalculated, half away from zero. Read and verified, not signed.
  Of 178 sessions, steps, pay URIs and settlement statements probed against WWCP_POI3 at `c2d39e5`, on station proofs it
  made, all are taken and refused alike, in the same words. `tests/evTalerSessions.test.ts`, on the proof of example A15.
- EV Taler: a step in minutes costs what it covers, rounded up to the cent, not a cent more, as WWCP_POI `a374855`
  calculates it: the quantity multiplied by the price of an hour before it is divided by 60. A decimal holds no rate of a
  minute such as 0.40 / 60 exactly, and rounding up took its last digit for a cent: 60 minutes at 0.40 EUR an hour were
  0.41 EUR, 30 minutes 0.21 EUR. Found by the probe of this port. The 178 cases probed again against WWCP_POI3 with
  `a374855`: all alike.
- `hermodURL` as Hermod reads a URL: no `_` in host names, an empty port, an IPv6 address checked.
- Reading a version takes about two to three times as long as with 0.2.0, e.g. 1.0 to 1.3 s for 3204 charging pools of
  12816 EVSEs, each energy meter with a P-256 key of its own, where 0.2.0 took 0.4 s. A check of a version finds the
  members of the operators in their order, their effective charging stations and energy meters and the charging stations
  parking spaces name once (`whileChecking`); the identifications read of texts and the measurement public keys checked,
  the last 65536 of each, are remembered for the next version too, as a history names most of them again. A key of P-256
  takes about 20 µs, a key of RSA about as long as one exponentiation with its modulus, a certificate of ECDSA a few
  milliseconds.


### Migration

- Versions WWCP_POI3 refuses and 0.2.0 took are refused now, in the words of WWCP_POI3; of the probed versions and the
  test vectors, none WWCP_POI3 takes. Messages of refusals checked by their text change where 0.2.0 worded them on its
  own, e.g. a roaming network with keys of its own.
- A price statement whose price status 0.2.0 took and WWCP_POI3 refuses, e.g. naming the charging tariff
  `DE*POI*FOREIGN`, is refused before its signature is looked at.
- A charging pool or a charging pool template naming its time zone by a Windows name, an abbreviation or in another case
  than the IANA time zone database, which 0.2.0 took, is refused: it names it as the database writes it, e.g.
  `Europe/Berlin`.
- `HistoryOptions.verifyCheckpoint` returns the signatures of the checkpoint that verified, `readonly RoleSignature[]`,
  or `undefined` for all of them, e.g. `checkpoint => verifyCheckpointSignatures(checkpoint, trust, options).verified`.
  A callback of a block without `return` no longer compiles; one that throws still refuses the checkpoint. A history,
  `takeCheckpoint` and a snapshot of a checkpoint hold it with those signatures only, its identification the same: what
  an app keeps of a checkpoint it took may hold fewer signatures than it was given (S39).
- `Change.elementPath` is an array of `ElementPathSegment`, `{propertyName, elementId}`, in place of the JSON objects
  given, and `ChangeSet.preconditions` an array of `Precondition`, `{entityType, entityId, eTag}`, both read as WWCP_POI3
  reads them; the JSON of a change and of a change set stays in its `json`. Both types are exported, and so are
  `MerkleTreeHead`, `PrunedTree` and `TreeNodeKind`, which the API used already.
- A signature of a commit or checkpoint is read in its one form: its role, signedAt, algorithm, key and value trimmed,
  and refused where one of them or its signer is empty or whitespace alone, where its signer is not a text, or where it
  names an `@context` or another property; so is a signature of a change set whose algorithm, key or value is empty.
  Producers write each signature in this form, as WWCP_POI `7c6f91c` reads it too.
- A change set created before the `lastChange` of the version it is applied to is stamped with that `lastChange`, not
  with its `createdAt` (S5): the version it leads to, and so its after ETags, differ from those 0.2.0 calculated, and a
  producer calculates them as WWCP_POI `12e993a` does. A change set created after its version, the usual case, is stamped
  with its `createdAt` as before.
- A transparency software release is identified under its manufacturer, `{manufacturer}:{name}`, and a certificate
  under the body issuing it, `{body}:{name}`, e.g. `GraphDefined:chargy-1.5.0` (S36): a version or change set
  identifying one otherwise, which 0.2.0 took, is refused.
- The prices of a charging tariff in a price statement are written as a tariff holds them (D18): a statement naming a
  property their type does not define, e.g. the OCPI restriction `max_kwh`, is refused before its signature, and the
  price evidence of a session holding one has invalid signatures. A version naming a restriction outside `startTime` to
  `reservation`, e.g. `maxStateOfCharge`, is refused.
- A snapshot whose `effectiveLastChanges` WWCP_POI3 does not read, which 0.2.0 took, is refused. Change sets 0.2.0
  refused as not supported, of the entities a party embeds, with element changes or preconditions, are applied now.
- Reading a version takes two to three times as long as with 0.2.0, about a second for 12816 EVSEs. The package is
  larger, 3.7 MB unpacked where 0.2.0 was 2.2 MB, of it `dist/index.js` 0.9 MB and its source map 2.3 MB.
- `@vanaheimr/cose` requires ^0.15.0 and `@vanaheimr/metrological-cbor` still ^0.12.0: keep both ranges aligned in
  consumers that use them directly. The minimum runtime remains Node 22.18, and the package remains ESM-only. Without
  Temporal, on Node 22 and 24, a time zone Intl names by another name is taken in any case, e.g. `Asia/KOLKATA`, which
  it names `Asia/Calcutta`; Node 26 takes it only as the database writes it.


## 0.2.0 (2026-11-02)

Shared trust and session verification APIs, previously delivered as the unpublished 0.1.2-dev.0 development candidate.
The experimental evidence and delegation profiles described below remain experimental in this release.

- Shared association of an EVSE, its energy meter and its key, with an explicit normalization of SubjectPublicKeyInfo
  and COSE P-256 keys and a conservative freshness of the observation; no claim of a historical association.
- Historical meter evidence per reading, and checkpoints verified under the current local authorization.
- Prices bound to a session, their publication and their rates checked apart.
- A shared comparison of authenticated versions: rollback and fork constraints the caller keeps durably, historical and
  current versions told apart, gaps filled, a change of the epoch refused unless verified.
- The charging document keys of a CPO, an authority of their own; experimental delegation of a policy signed by two
  quorums, historical timelines of authorities, and verified epoch continuation and profiles.
- Experimental receipts of a public retrieval of prices, a policy of witness organizations, networks and clocks of
  its own, restrictions of key usages and a conservative result before the signed start; no witness authorized
  automatically, no claim of the actual start or of the consent of the customer.
- COSE and Metrological CBOR on ^0.12.0, so that direct and transitive consumers share one codec; existing proof and
  signature fixtures remain valid.
- `trustPolicyId` is the SHA-256 of the canonical JSON of `{network, holders, minConsensus, urls}`, the URLs as a WHATWG
  URL serializes them without trailing slashes, in their ordinal order, as WWCP_POI3 calculates it
  (`TrustTransition.PolicyIdOf`); in place of their `JSON.stringify`, whose order of properties and escapes are those of
  JavaScript, so that every implementation calculates the same. Every policy identification changes: decisions an app
  keeps under one are made again, and transitions are signed again.
- A commit is refused without its `json`, `cbor` and `effectiveTree` ETags (SPECIFICATION.md 8.3), as WWCP_POI3 refuses
  it; the epoch change of `tests/vectors/trust-transitions.json` names the ETags of its versions.
- `trustTransitions.ts` and `documentKeys.ts` with the license header and in the layout of the other sources.


### Migration

- Commits must name all three version ETags: `json`, `cbor` and `effectiveTree`. A commit accepted by 0.1.1 with
  only an effective-tree ETag is now refused. Producers must generate the complete ETags and sign the resulting commits
  and checkpoints again; do not edit previously signed documents or silently repair an archived original.
- When moving from the unpublished 0.1.2-dev.0 candidate that used `JSON.stringify` for policy identity, recompute
  `trustPolicyId` from canonical JSON. Reconfirm local decisions under the new identity and regenerate and sign affected
  trust transitions. Retain old observations and original evidence; a changed policy identity must not erase known forks
  or rollbacks. Candidates already using canonical JSON keep their policy identities.
- COSE and Metrological CBOR both require ^0.12.0. Keep both dependency ranges aligned in consumers that use them directly.
- The minimum runtime remains Node 22.18, and the package remains ESM-only. Local trust decisions, durable observation
  storage and independently authorized witness policies remain the caller's responsibility. No production trust roots
  or witness service are bundled.


## 0.1.1 (2026-10-31)

`TrustContext`, for apps that import a trust anchor before they trust its keys. `TrustContext.evaluate` checks a key
statement against the identity keys of a trust anchor the app trusts locally and reports its signatures, signers, quorum
and validity apart (`TrustEvaluation`); a context only when all of them hold, `TrustContext.create` throws otherwise.
The context keeps the holders of the trust anchor and its quorum, and binds the roaming network, its operator, the
signed key statement and the time of the evaluation. `OperatorTrust.of` and `fromOperatorJSON`, `verifyVersion`,
`verifyChargingStation`, `ChargingStationProof.verify` and `verifyCheckpoint` take it in place of a trust anchor; given
a trust anchor, they verify as before. The app keeps storing and showing its decisions and creates a context from its
current decisions for every verification. Tested with genuine signatures, the proofs of the conformance tests and in
Chromium.

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
`notifiedBodyNumber` not of four digits (nothing after them, also no line feed, since WWCP_POI `f53d220`), a legislation
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
COSE key. WWCP_POI refuses them too since `a425530` (D13 there, SPECIFICATION.md 2, Written forms), as this library did;
the key not in deterministic CBOR now in its words: "Invalid COSE key: Invalid deterministic CBOR: the key of the public
key '…' is not written as the deterministic CBOR of its COSE key!"


The four vectors of WWCPPOIConformanceTests `ad7c73e` vendored, `poi-refusals.json` of 97 vectors: a conformity
assessment body as its constructor in WWCP_POI checks it, a certificate issued under a legislation it is not notified
for, a notified body number of three digits, a legislation notified for empty, one given twice (D14 there, found against
`1f914ac`, fixed by `4ff1fc2` here).

The legislations a conformity assessment body is notified for are refused unless written in their ordinal order, as
WWCP_POI writes them (Achim's decision of 2026-10-29, as D13 decided it for keys): WWCP_POI takes another order and
writes it sorted, which written again would be another text than the one hashed. Refused as the body is read, before
what its constructor checks, in the words of this library: "The legislations the conformity assessment body 'PTB' is
notified for are written in their ordinal order!"

The four vectors of WWCPPOIConformanceTests `012ce9d` vendored, `poi-refusals.json` of 101 vectors: a conformity
assessment body as the content holds it, notified for legislations out of their ordinal order, with a notified body
number that is no text, with a notifiedFor that is no array of texts, and with the number of another body. WWCP_POI
refuses the order since `8108522`, in the words of this library.

WWCP_POI `f53d220`: its regular expressions end with `\z`, no longer with `$`, which in .NET matched before a last line
feed as well. A notified body number "0102" with a line feed is refused, which this library had taken as WWCP_POI took
it; a certificate timestamp with a line feed after its offset was refused here already, as every check of this library
ends at the end of its text.

The content as WWCP_POI writes it (SPECIFICATION.md 2, Written forms): what WWCP_POI takes of a version and writes otherwise
is refused, as written again it would be another text than the one hashed (Achim's decision of 2026-10-29, as D13
decided it for keys and 9decdb5 for the legislations a body is notified for). Of every entity, `notWrittenAsHeld`, as a
version is read, after everything WWCP_POI refuses of it, so that its words come first: what the content orders
(its ordered lists, `POIJSON.OrderedIds`, entities, keys, exchanges) out of its ordinal order, the texts of an ordered list
untrimmed, a list WWCP_POI writes only with an element given empty (about ninety; not the versions, releases and energy
meters of a certificate, the elements of a price, the exchanges of a merchant, the identity keys of a key statement), a
property given as null, an embedded object naming a JSON-LD context, a text in languages not naming each language as
Styx writes it, in lower case, with a text, a timestamp not UTC to the millisecond; custom data held as given. Of a key of
a party, a property WWCP_POI does not read; of an EV Taler merchant and its exchanges, such a property, a base URL not as
Hermod writes it, trimmed and with its scheme, and a currency not by its code. In the words of this library, e.g.
"'chargingStationOperators[0].chargingPools[1].paymentOptions' is not written as the content holds it: its elements are in the
order the content holds them in!". The new values of a change set are checked by the same rules (`asGiven`), as
WWCP_POI refuses a new value the content holds otherwise, "e.g. an empty array written as none". Found by probing
WWCP_POI3 at 8108522 with 201 versions of QA: of the 20 it takes and writes otherwise this library took all, and
refuses all now; every one it takes as given is taken, every one it refuses refused, and every version of the frozen run
is written as the content holds it. `tests/writtenForm.test.ts`.

What the constructor of the roaming network refuses, of a version, in the words of WWCP_POI: as an argument of its
parameter, which its TryParse names, e.g. "The given JSON representation of a roaming network is invalid: The notified
body number '0102' of the conformity assessment body 'PTB' is the one of the conformity assessment body 'BSI' already!
(Parameter 'ConformityAssessmentBodies')", in its order (the groups of providers and the offers before the releases): the
identifications unique within the network, and the key statement and the certificates of the roaming network operator
(`KeyStatementError`, 'Operator'), its key statement of another network now before its certificates. After the last change
of a change set they are named bare, in the order WWCP_POI checks them there (`RoamingNetwork.afterChangeSet`). The
golden vectors held the inner words only. Checked against WWCP_POI3 at 8108522 on 10 versions of QA.

The roaming network operator, its key statement and the certificates of its signing keys in the words and order of
WWCP_POI3 (the TryParse of `RoamingNetworkOperator`, `RoamingNetworkKeyStatement` and
`RoamingNetworkSigningKeyCertificate`), e.g. "A key statement requires its minConsensus, a whole number from 1 to 255!",
"Invalid key in the identityKeys of a key statement!", "A signing key certificate requires the signingKey it certifies!";
what this library refuses besides (properties it does not know, identity keys out of their order) after them. What the
constructor of the operator refuses as an argument of it, "The given JSON representation of a roaming network operator is
invalid: …": a certificate by the same identity key given twice, which this library took, a signing key certified in two
forms, a key both a signing and an identity key, a quorum its keys do not have; the holder of a key as it names it ("the
holder 'BetaOrg'"). The tree hash algorithms of a roaming network as `POITreeHashAlgorithms` names them, four refusals for
the one of this library. An entity without its identification as Styx refuses it, "Missing JSON property '@id'!", which
this library took but of the roaming network and its operator (`invalidIdentification`, first of all), and one of another
JSON type in the words of the kinds WWCP_POI3 refuses it of ("Invalid 'charging pool identification'!"). Certificates and
the versions of stations, meters, their templates and models without the prefix this library gave them ("The certificate
'…': "), as WWCP_POI3 names them, with the parameter its constructor names ("(Parameter 'Versions')", 'HardwareRevisions',
'FirmwareVersions', 'Legislation', 'NotBefore', 'EnergyMeters'), a version twice in a model as an argument of the model; a
certificate without its identification, of a certified meter a model of another JSON type, in its words.

Of the written form also, as WWCP_POI3 takes and writes it otherwise: an entity without its lastChange, which it writes as
its created; a party without its name, which it makes up of its kind and identification ("Charging Station Manufacturer
'GraphDefined'"); a text in languages without a language, but the name of a charging station operator, which it writes
so; the releases of a certificate and the URLs of an open source license left out, which it writes also empty; the energy
meters of a certificate given empty; an identification and the type of a charging connector given as a number.

Probed against WWCP_POI3 at 8108522 with 617 versions of QA, of every kind of object a property it does not read, every
property of it removed and given in another JSON type, the tree hash algorithms and the quorum of the operator, and 10
of certificates and models: none it takes as given is refused here; of what it refuses, this library refuses all in its
words but 20, of what it takes and writes otherwise all but the properties it does not read (25 kinds, which it leaves
out). Not ported yet: properties of another JSON type or missing that WWCP_POI3 refuses (168, in the words of every kind)
and the references it checks (23, of templates, tariffs, members, manufacturers, models, releases and certificates).
`tests/operator.test.ts`, and in `writtenForm`, `identifications` and `certificates`.

The 27 vectors of WWCPPOIConformanceTests `1c36c6d` vendored, `poi-refusals.json` of 128 vectors: versions not written as
the content holds them (`version-held-*`), the 20 versions WWCP_POI3 at 8108522 took and wrote otherwise and more of their
kinds (bodies, keys, payment options and exchanges out of their order, an untrimmed payment option, lists given empty, a
property given as null, embedded JSON-LD contexts, texts in languages not as Styx writes them, a timestamp with an offset,
properties of keys, merchants and exchanges not read, URLs and currencies not as written), ten with their eTags as
published, their reasons in the words of this library, which refuses them since `5c534d4`. WWCP_POI refuses them as well
since D15 of WWCPPOIConformanceTests, fixed there in `1c36c6d` (SPECIFICATION.md 2: a reader MUST refuse a version not
written so).

The written form as WWCP_POI3 refuses it since WWCP_POI `3de830a`, which writes a version again and walks both
(RoamingNetwork.WrittenForm.cs, FirstNotWritten): `notWritten` walks a version in that order and in those words, the
reasons of this library, which WWCP_POI took over, and two of its own. "the content leaves it out", of a property given
that WWCP_POI does not write: of every entity a property its type in WWCP_POI3 neither writes (ToJSON) nor reads
(PropertyKeys), drawn from it at `3de830a` for 33 kinds and checked against the 605 versions it wrote in the frozen run
and the probes, of a key statement, its signatures, a certificate of a signing key, a coordinate, a price component and
a public key of a meter as well; `dataLicenseIds`, which a version names completely (`dataLicenses`), a license it does not know
in its words; a text in languages without a language WWCP_POI reads. "the content holds it as '…'", of a value it writes
otherwise, by the path of that value: the lastChange of an entity naming none (its created), the name of a party naming
none (not of grid and parking operators), the lists it writes also empty, an identification given as a number, texts
its types write trimmed (identifications, references, currencies, versions, e-mail addresses, URLs), URLs with the
scheme https, the identification of a charging station operator in upper case, the role of a meter, the legal status of
a release and signature methods as they are named, coordinates as doubles (50.92710 as 50.9271; quantities keep their
decimals). Of a release and its licenses, a certificate and the meters it was issued with, a property they do not read
as WWCP_POI2 refuses it ("Unknown property 'x'."). The roaming network and its operator compared without case and
trimmed, as their types read them, also of the key statement and the certificates, signed as read. Seven cases keep the
words of this library, refused where it reads them, before the written form, as WWCP_POI takes them over (Achim's
decision of 2026-10-30): a property of a key of a party, of an EV Taler merchant or of an exchange, the merchant base URL,
the base URL and the currency of an exchange not as written. Probed against WWCP_POI3 at `3de830a` with 1257 versions of
QA: none it takes is refused here; of what it refuses as written otherwise, all in its words but those seven.


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
