/*
 * Copyright (c) 2014-2026 GraphDefined GmbH <achim.friedland@graphdefined.com>
 * This file is part of WWCP POI TS <https://github.com/OpenChargingCloud/WWCP_POI.TS>
 *
 * Licensed under the Affero GPL license, Version 3.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.gnu.org/licenses/agpl.html
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * WWCP POI 3 in TypeScript: verifies what a roaming network publishes about its charging stations and their tariffs, from
 * the trust anchor of the roaming network alone.
 *
 * - **An app** checks the proof of a charging station and the price statements of its EVSEs (`POIClient`,
 *   `verifyChargingStation`, `verifyPriceStatements`), and later the evidence of a session (`verifyEvidence`).
 * - **A charging station operator, a witness or a server** checks versions of a roaming network and their commits
 *   (`verifyVersion`), takes a history commit by commit (`History`), checkpoints, their witnesses and archives.
 *
 * Everything is calculated as the C# implementation of WWCP POI 3 calculates it, byte for byte: canonical JSON and
 * deterministic CBOR of Styx, the effective tree of section 8, COSE keys and signatures.
 *
 * @packageDocumentation
 */

export { POIError, check, type Checked }                     from './errors.ts';

// JSON, CBOR and encodings
export { Decimal, MAX_DECIMAL_SCALE }                        from './json/decimal.ts';
export { parseJSON, parseJSONObject, parseJSONBytes }        from './json/parse.ts';
export { canonicalJSON, canonicalJSONBytes, canonicalString, prettyJSON } from './json/canonical.ts';
export { clone, fromJavaScript, get, isArray, isObject, sameValue, type JSONArray, type JSONObject, type JSONValue } from './json/value.ts';
export { cborToJson, decodeDeterministicCbor, deterministicCbor, jsonToCbor } from './encoding/cbor.ts';
export { fromBase45, fromBase64, fromHex, toBase45, toBase64, toHex } from './encoding/text.ts';
export { CONTEXT_PREFIX, parseTimestamp, toTimestamp }       from './common.ts';

// Hashes, keys, signatures, ETags and trees
export { hash, type HashAlgorithm }                          from './crypto/hash.ts';
export { SIGNATURE_ALGORITHMS, verifySignature, type SignatureAlgorithm } from './crypto/signature.ts';
export { KeyUsages, POIPublicKey, type KeyUsage }            from './keys.ts';
export { cborETag, etagToJSON, etagToText, jsonETag, parseETag, parseETags, sameETag, sameETags, type ETag, type ETagFormat } from './etags.ts';
export { auditPath, leafHash, merkleRoot, merkleRootOfLeafHashes, nodeHash, rootFromAuditPath } from './merkle.ts';

// Roaming networks
export { RoamingNetwork, RoamingNetworkOperator, ROAMING_NETWORK_CONTEXT } from './network/roamingNetwork.ts';
export { EV_TALER_EXCHANGE_CONTEXT, EV_TALER_MERCHANT_CONTEXT, EV_TALER_PAYMENT_MEANS, EV_TALER_PAYMENT_OPTION, evTalerMerchantOf, isTalerPublicKey, paymentOptionName, type EVTalerExchange, type EVTalerMerchant } from './network/evTaler.ts';
export { effectiveContent, effectiveChargingStationOperator } from './network/effective.ts';
export { CHILD_ARRAYS, effectiveTreeETag, entityDigest, prunedTree, skeleton } from './network/tree.ts';

// Proofs, statements and trust anchors
export { TrustAnchor, TRUST_ANCHOR_CONTEXT, TRUST_ANCHOR_QR_PREFIX, type I18NText } from './proofs/trustAnchor.ts';
export { KeyStatement, KEY_STATEMENT_CONTEXT, type KeyStatementSignature } from './proofs/keyStatement.ts';
export { SigningKeyCertificate, SIGNING_KEY_CERTIFICATE_CONTEXT } from './proofs/signingKeyCertificate.ts';
export { Attestation, ATTESTATION_CONTEXT }                  from './proofs/attestation.ts';
export { ChargingStationProof, PROOF_CONTEXT, type VerifiedProof } from './proofs/stationProof.ts';
export { MAX_PRICE_STATEMENT_SEQUENCE, PriceStatement, PriceStatementProof, parsePriceStatements, priceStatementChainOf, priceStatementsRoot, verifyCheckpointPriceStatements, verifyPriceStatementChain } from './proofs/priceStatement.ts';

// History
export { Commit, SignatureRoles, COMMIT_CONTEXT, type RoleSignature } from './history/commit.ts';
export { ChangeSet, CHANGE_SET_CONTEXT, MERGE_CHANGE_SET_ID_PREFIX, changeSetIdentification, type Change, type ChangeKind, type ChangeSetSignature } from './history/changeSet.ts';
export { applyChangeSet, checkOwnership }                    from './history/apply.ts';
export { Checkpoint, CheckpointProof, commitsRoot, CHECKPOINT_CONTEXT } from './history/checkpoint.ts';
export { History, type EpochStatus, type HistoryOptions, type SnapshotOptions, type Version } from './history/history.ts';
export { EpochProfiles, FIRST_EPOCH, parseEpoch, parseEpochLink, sameEpoch, EPOCH_CONTEXT, EPOCH_LINK_CONTEXT, EPOCH_PROFILES_CONTEXT, STYX_CANONICAL_JSON, type Epoch, type EpochLink } from './history/epoch.ts';
export { ArchiveSegment, parseArchiveSegmentInfo, verifySegmentLine, type ArchiveSegmentInfo } from './history/archive.ts';

// QI-Digital documents, a proof of concept: read and checked, not signed
export { QIDigitalDocument, QIDigitalSignature }            from './qidigital/document.ts';
export { DigitalCalibrationCertificate, DCCMeasurementResult, DCCResult, DCCStatement, DCC_PERFORMANCE_LOCATIONS, type DCCPerformanceLocation } from './qidigital/calibrationCertificate.ts';
export { DigitalCertificateOfConformity, DCOC_MODULES, approvesQualitySystem, type DCoCModule } from './qidigital/certificateOfConformity.ts';
export { DigitalDeclarationOfConformity, DDoCNotifiedBody } from './qidigital/declarationOfConformity.ts';
export { QIDigitalItem, QIDigitalLegislation, QIDigitalManufacturer, QIDigitalModel, QIDigitalPerson, QIDigitalQuantity, QIDigitalStandard, QI_DIGITAL_CONFORMITIES, type QIDigitalConformity, type QIDigitalItemType, type QIDigitalManufacturerType, type QIDigitalModelType } from './qidigital/parts.ts';
export { qiDigitalContext, type I18NText as QIDigitalI18NText } from './qidigital/json.ts';

// Verifiers
export { OperatorTrust }                                     from './verifier/trust.ts';
export { verifyVersion, describeVersion, type VerifiedVersion } from './verifier/version.ts';
export { verifyChargingStation, verifyPriceStatements, type Manufactured, type NamedCertificate, type NamedTransparencySoftware, type VerifiedChargingStation, type VerifiedPrice } from './verifier/chargingStation.ts';
export { evTalerExchangesAt, evTalerTariffOf } from './verifier/evTaler.ts';
export { parseTrustedWitnesses, verifyCheckpointLine, verifyCheckpointSignatures, type CheckpointSignatures, type TrustedWitness } from './verifier/checkpoints.ts';
export { parseEvidence, verifyEvidence, type Evidence, type VerifiedEvidence } from './verifier/evidence.ts';
export { POIClient, type CheckedChargingStation, type Fetch } from './client.ts';
export { LIVE_TOPICS, RUNTIME_STATUS_KINDS, STATUS_UPDATE_CONTEXT, RuntimeStatus, liveRequest, parseFrame, parseStatusUpdate, subscribeRequest, type LiveFrame, type RuntimeStatusEntry, type RuntimeStatusKind, type StatusUpdate } from './live.ts';
