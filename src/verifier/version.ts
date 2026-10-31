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

import { firstText }                    from '../common.ts';
import type { JSONValue }               from '../json/value.ts';
import { Commit }                       from '../history/commit.ts';
import { RoamingNetwork }               from '../network/roamingNetwork.ts';
import { anchorOf, type TrustContext }  from '../proofs/trustContext.ts';
import type { TrustAnchor }             from '../proofs/trustAnchor.ts';
import { OperatorTrust }                from './trust.ts';
import { POIError }                     from '../errors.ts';


/** A version of a roaming network checked from a trust anchor, as example A1 checks `QA`. */
export interface VerifiedVersion {
    readonly network:   RoamingNetwork;
    readonly commit:    Commit;
    readonly trust:     OperatorTrust;
    /** The holders of the roaming network operator whose signing keys signed the commit. */
    readonly signedBy:  readonly string[];
    /** Where the trust anchor names the network otherwise: its texts are not trusted. */
    readonly warnings:  readonly string[];
}


/**
 * Checks a version of a roaming network and its commit from a trust anchor alone, as a charging station operator or the
 * app of an EV driver does (example A1, section 8):
 *
 * a) the trust anchor, as scanned (the caller parses it);
 * b) the roaming network: its `@context`, its ETags those of its content, its quorum, its key statement and certificates;
 * c) the commit: its `@id` the digest of its content;
 * d) the commit leads to this roaming network: its ETags are those of the network;
 * e) the key statement is signed by trusted identity keys of as many holders as the trust anchor requires, and valid at `at`;
 * f) the commit is signed, as the roaming network operator, by signing keys of as many holders, each certified by a
 *    trusted identity key of its holder, valid when it signed, and one that may sign for the party;
 * g) the texts to show are those of the checked version; a trust anchor naming the network otherwise is warned of.
 */
export function verifyVersion(basis:       TrustAnchor | TrustContext,
                              networkJSON: JSONValue,
                              commitJSON:  JSONValue,
                              at?:         number | Date | string): VerifiedVersion {

    // b)
    const anchor  = anchorOf(basis);
    const network = RoamingNetwork.parse(networkJSON);

    if (network.id !== anchor.id)
        throw new POIError('this is not the roaming network of the trust anchor');

    // c)
    const commit = Commit.parse(commitJSON);

    // d)
    if (commit.roamingNetworkId !== network.id || !network.matchesCommitETags(commit.eTags))
        throw new POIError('the commit does not lead to the roaming network');

    // e)
    const trust = OperatorTrust.of(basis, network, at);

    // f)
    const signedBy = trust.verifyOperatorSignatures(commit.signatures, (signature, key) => { commit.verifySignature(signature, key); }, 'the commit');

    // g)
    return {
        network,
        commit,
        trust,
        signedBy: [ ...signedBy ].sort(),
        warnings: trust.textWarnings(network),
    };

}


/** A line telling what was checked, as example A1 prints it. */
export function describeVersion(version: VerifiedVersion): string {
    return `Roaming network '${version.network.id}'/'${firstText(version.network.name) ?? ''}' ('${firstText(version.network.description) ?? ''}'), ` +
           `operated by '${version.trust.operator.id}'/'${version.trust.operatorName ?? ''}'`;
}
