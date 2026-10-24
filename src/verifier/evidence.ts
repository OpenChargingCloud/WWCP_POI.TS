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

import { onlyProperties, parseTimestamp, requireArray, requireObject, requireString, toTimestamp } from '../common.ts';
import { asText, get, type JSONValue }              from '../json/value.ts';
import { Checkpoint, CheckpointProof }      from '../history/checkpoint.ts';
import { ChargingStationProof }             from '../proofs/stationProof.ts';
import { PriceStatement, PriceStatementProof } from '../proofs/priceStatement.ts';
import { TrustAnchor }                      from '../proofs/trustAnchor.ts';
import { OperatorTrust }                    from './trust.ts';
import { verifyChargingStation, verifyPriceStatements, type VerifiedChargingStation } from './chargingStation.ts';
import { verifyCheckpointLine, verifyCheckpointSignatures, type CheckpointSignatures, type TrustedWitness } from './checkpoints.ts';
import { POIError }                         from '../errors.ts';


/**
 * What a driver's app keeps of a charging session, so that it can show months later which station, tariff and price
 * applied (SPECIFICATION.md sections 8.4, 10.4, 12.3 and 12.4): the trust anchor it checked against, the EVSE and when
 * charging began, the proof of the station and the price statements as it got them then, and, once a later checkpoint is
 * witnessed, the proof of the commit of the station proof, the proofs of the statements, and the checkpoints.
 */
export interface Evidence {
    readonly trustAnchor:           string;
    readonly evseId:                string;
    readonly chargingStarted:       string;
    readonly chargingStationProof:  JSONValue;
    readonly priceStatements:       readonly JSONValue[];
    readonly commitProof?:          JSONValue;
    readonly priceStatementProofs?: readonly JSONValue[];
    readonly checkpoints?:          readonly JSONValue[];
}

/**
 * Reads the evidence as the app of example A10 keeps it, `driver/evidence-{EVSE}.json`: `{ trustAnchor, EVSEId,
 * chargingStarted, chargingStationProof, priceStatements, commitProof?, priceStatementProofs?, checkpoints? }`.
 */
export function parseEvidence(value: JSONValue): Evidence {

    const json      = requireObject(value, 'The evidence of a charging session');
    const optional  = (property: string): JSONValue[] | undefined =>
                          get(json, property) === undefined ? undefined : requireArray(get(json, property), `The ${property} of the evidence`);

    onlyProperties(json, [ 'trustAnchor', 'EVSEId', 'chargingStarted', 'chargingStationProof', 'priceStatements', 'commitProof', 'priceStatementProofs', 'checkpoints' ], 'The evidence of a charging session');

    const commitProof           = get(json, 'commitProof');
    const priceStatementProofs  = optional('priceStatementProofs');
    const checkpoints           = optional('checkpoints');

    return {
        trustAnchor:           requireString(json, 'trustAnchor',     'The trust anchor of the evidence'),
        evseId:                requireString(json, 'EVSEId',          'The EVSE of the evidence'),
        chargingStarted:       requireString(json, 'chargingStarted', 'The start of charging of the evidence'),
        chargingStationProof:  requireObject(get(json, 'chargingStationProof'), 'The charging station proof of the evidence'),
        priceStatements:       requireArray (get(json, 'priceStatements'),      'The price statements of the evidence'),
        ...(commitProof          !== undefined ? { commitProof }          : {}),
        ...(priceStatementProofs !== undefined ? { priceStatementProofs } : {}),
        ...(checkpoints          !== undefined ? { checkpoints }          : {}),
    };

}


/** What the evidence proves. */
export interface VerifiedEvidence {
    /** The station as charging began: attested then by the roaming network operator. */
    readonly station:            VerifiedChargingStation;
    /** The price statements of the station, its pool and its EVSEs valid as charging began. */
    readonly prices:             ReturnType<typeof verifyPriceStatements>;
    /** The checkpoints, with who signed them. */
    readonly checkpoints:        ReadonlyArray<{ readonly checkpoint: Checkpoint, readonly signatures: CheckpointSignatures }>;
    /** The checkpoint whose commits include the version of the station proof, where the evidence proves it. */
    readonly versionCheckpoint:  Checkpoint | undefined;
    /** By price statement digest: the checkpoint it was made after, and the one naming it. */
    readonly statementCheckpoints: ReadonlyMap<string, { readonly after: Checkpoint | undefined, readonly namedBy: Checkpoint }>;
}


/**
 * Checks the evidence of a charging session offline (as example A10 of WWCP_POI describes it), against the witnesses the
 * verifier trusts:
 *
 * a) the checkpoints, a line, each signed as the roaming network operator by its quorum, with the certificates the station
 *    proof gives, and by `requiredWitnesses` of the trusted witnesses;
 * b) as charging began: the station proof attested then, the price statements valid then;
 * c) the version of the station proof is one of a witnessed checkpoint: its commit is proven to be part of it, and the
 *    station proof leads to the `effectiveTree` ETag of that commit, so that it holds after the attestations ended;
 * d) each price statement was made after the checkpoint it names and before the checkpoint naming it, which follows it.
 */
export function verifyEvidence(evidence: Evidence,
                               options:  { witnesses?: readonly TrustedWitness[], requiredWitnesses?: number } = {}): VerifiedEvidence {

    const anchor   = TrustAnchor.parse(evidence.trustAnchor);
    const started  = parseTimestamp(evidence.chargingStarted, 'The start of charging');
    const proof    = ChargingStationProof.parse(evidence.chargingStationProof);

    // b) As charging began.
    const station  = verifyChargingStation(anchor, proof, { at: started, evseId: evidence.evseId });
    const prices   = verifyPriceStatements(station, [ ...evidence.priceStatements ], { at: started });

    if (!prices.has(`EVSE:${evidence.evseId}`))
        throw new POIError(`No price statement of the EVSE '${evidence.evseId}' is valid at ${toTimestamp(started)}, when charging began!`);

    // a) The checkpoints, with the keys of the roaming network operator as the station proof gives them.
    const trust        = OperatorTrust.fromOperatorJSON(anchor, get(proof.roamingNetwork, 'operator'), started);
    const checkpoints  = (evidence.checkpoints ?? []).map(json => Checkpoint.parse(json)).sort((left, right) => left.sequence - right.sequence);

    verifyCheckpointLine(checkpoints);

    const signed = checkpoints.map(checkpoint => ({
        checkpoint,
        signatures: verifyCheckpointSignatures(checkpoint, trust, options),
    }));

    const byId = new Map(checkpoints.map(checkpoint => [ checkpoint.id, checkpoint ]));

    // c) The version of the station proof in a witnessed checkpoint.
    let versionCheckpoint: Checkpoint | undefined;

    if (evidence.commitProof !== undefined) {

        const commitProof = CheckpointProof.parse(evidence.commitProof);
        versionCheckpoint = byId.get(commitProof.checkpointId);

        if (versionCheckpoint === undefined)
            throw new POIError(`The checkpoint '${commitProof.checkpointId}' of the proof of the commit is not part of the evidence!`);

        commitProof.verify(versionCheckpoint);
        proof.verifyAgainstCommitProof(commitProof);

    }

    // d) The price statements between two checkpoints.
    const statementCheckpoints = new Map<string, { after: Checkpoint | undefined, namedBy: Checkpoint }>();

    for (const json of evidence.priceStatementProofs ?? []) {

        const statementProof  = PriceStatementProof.parse(json);
        const namedBy         = byId.get(statementProof.checkpointId);

        if (namedBy === undefined)
            throw new POIError(`The checkpoint '${statementProof.checkpointId}' of the proof of a price statement is not part of the evidence!`);

        statementProof.verify(namedBy);
        statementProof.priceStatement.verify(station.roamingNetwork.id, asText(station.operator['@id']), station.operatorSigningKeys);

        const kept = evidence.priceStatements.map(item => PriceStatement.parse(item)).find(item => item.sameSignedContent(statementProof.priceStatement));

        if (kept === undefined)
            throw new POIError('The proof of a price statement is one of a statement the evidence does not keep!');

        const after = statementProof.priceStatement.after === undefined ? undefined : byId.get(statementProof.priceStatement.after);

        if (statementProof.priceStatement.after !== undefined && after === undefined)
            throw new POIError(`The checkpoint '${statementProof.priceStatement.after}' the price statement was made after is not part of the evidence!`);

        if (after !== undefined && after.sequence >= namedBy.sequence)
            throw new POIError('The checkpoint naming the price statement does not follow the one it was made after!');

        statementCheckpoints.set(statementProof.priceStatement.digestHex(), { after, namedBy });

    }

    return { station, prices, checkpoints: signed, versionCheckpoint, statementCheckpoints };

}
