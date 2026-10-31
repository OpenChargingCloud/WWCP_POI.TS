import { timeOf } from '../common.ts';
import { POIError } from '../errors.ts';
import { canonicalJSONBytes } from '../json/canonical.ts';
import { hash } from '../crypto/hash.ts';
import { toHex } from '../encoding/text.ts';
import type { POIPublicKey } from '../keys.ts';
import type { KeyStatement } from './keyStatement.ts';
import { TrustAnchor } from './trustAnchor.ts';

export interface TrustEvaluationOptions {
    readonly trustedIdentityKeyIds: Iterable<string>;
    readonly otherIdentityKeys?: readonly POIPublicKey[];
    readonly at?: number | Date | string;
}

/** Diagnostics keep mathematical validity, local authorization and distinct-holder consensus separate. */
export interface TrustEvaluation {
    readonly signatures: 'valid' | 'invalid';
    readonly signers: 'valid' | 'invalid';
    readonly quorum: 'valid' | 'invalid';
    readonly validity: 'valid' | 'invalid';
    readonly trustedHolderCount: number;
    readonly requiredConsensus: number;
    readonly signatureCount: number;
    /** Import and optional manual authorization are allowed even without a trusted quorum. */
    readonly canTrustKeys: boolean;
    readonly verificationError?: string;
    readonly context?: TrustContext;
}

/**
 * A locally authorized bootstrap policy and a verified statement, evaluated at one time. The application supplies
 * trusted key IDs, from its bundled roots and explicit user decisions after applying local exclusions. The library
 * intersects them with the original holder groups and verifies every signature, holder consistency, time and quorum.
 * Importing an anchor is not authorization. This object is not a revocation service: recreate it from current local
 * decisions for each operation. It is not persisted, and cannot be constructed from a serialized green flag.
 */
export class TrustContext {
    public readonly anchor: TrustAnchor;
    public readonly authorizedAnchor: TrustAnchor;
    public readonly trustedHolders: readonly (readonly string[])[];
    public readonly roamingNetworkId: string;
    public readonly roamingNetworkOperatorId: string;
    public readonly keyStatementDigest: string;
    public readonly requiredConsensus: number;
    public readonly validUntil: number;

    private constructor(anchor: TrustAnchor, holders: readonly (readonly string[])[],
                        statement: KeyStatement, public readonly evaluatedAt: number) {
        this.anchor = frozenAnchor(anchor);
        this.trustedHolders = Object.freeze(holders.map(holder => Object.freeze([...holder])));
        // The wire format permits no empty groups. Removing empty groups never splits a holder or reduces the quorum.
        this.authorizedAnchor = frozenAnchor(TrustAnchor.create(anchor.id, anchor.urls,
            holders.filter(holder => holder.length > 0), anchor.minConsensus, anchor.name, anchor.description));
        this.roamingNetworkId = statement.roamingNetworkId;
        this.roamingNetworkOperatorId = statement.roamingNetworkOperatorId;
        this.keyStatementDigest = statementDigest(statement);
        this.requiredConsensus = Math.max(anchor.minConsensus, statement.minConsensus);
        this.validUntil = statement.validUntil;
        Object.freeze(this);
    }

    public static create(anchor: TrustAnchor, statement: KeyStatement, options: TrustEvaluationOptions): TrustContext {
        const result = TrustContext.evaluate(anchor, statement, options);
        if (result.context === undefined)
            throw new POIError(result.verificationError ?? 'No locally authorized trust quorum');
        return result.context;
    }

    public static evaluate(anchor: TrustAnchor, statement: KeyStatement, options: TrustEvaluationOptions): TrustEvaluation {
        const at = timeOf(options.at);
        if (!Number.isFinite(at))
            throw new POIError('Invalid trust evaluation time');
        if (statement.roamingNetworkId !== anchor.id)
            throw new POIError('The key statement belongs to another roaming network');
        const trusted = new Set(options.trustedIdentityKeyIds);
        const holders = anchor.holders.map(holder => holder.filter(id => trusted.has(id)));
        const pool = [...statement.identityKeys, ...(options.otherIdentityKeys ?? [])];
        const signedBy = new Set(statement.signatures.map(signature => signature.keyId));
        const trustedHolderCount = holders.filter(holder => holder.some(id => signedBy.has(id))).length;
        let signaturesValid = true;
        let keysValid = true;
        let verificationError: string | undefined;
        try {
            for (const signature of statement.signatures) {
                const key = pool.find(key => key.id === signature.keyId);
                if (key === undefined)
                    throw new POIError('The public key of a signer was not provided');
                statement.verifySignature(signature, key);
                if (!key.isValidAt(statement.signedAt))
                    keysValid = false;
            }
        }
        catch (error) {
            signaturesValid = false;
            verificationError = error instanceof Error ? error.message : String(error);
        }
        let quorumValid = false;
        try {
            statement.verifyHolders(holders, options.otherIdentityKeys, { minConsensus: anchor.minConsensus, at });
            quorumValid = true;
        }
        catch (error) {
            verificationError ??= error instanceof Error ? error.message : String(error);
        }
        const validityValid = keysValid && statement.isValidAt(at);
        return Object.freeze({
            signatures: signaturesValid ? 'valid' : 'invalid',
            signers: trustedHolderCount > 0 ? 'valid' : 'invalid',
            quorum: quorumValid ? 'valid' : 'invalid',
            validity: validityValid ? 'valid' : 'invalid',
            trustedHolderCount, requiredConsensus: Math.max(anchor.minConsensus, statement.minConsensus),
            signatureCount: statement.signatures.length, canTrustKeys: signaturesValid && validityValid,
            ...(verificationError === undefined ? {} : { verificationError }),
            ...(signaturesValid && quorumValid && validityValid
                ? { context: new TrustContext(anchor, holders, statement, at) } : {})
        });
    }

    /** The context represents exactly one evaluation time; a different time requires fresh local decisions. */
    public evaluationTime(at?: number | Date | string): number {
        if (at !== undefined && timeOf(at) !== this.evaluatedAt)
            throw new POIError('Recreate the trust context for a different evaluation time');
        return this.evaluatedAt;
    }

    /** Rechecks supplied signatures and binds their signed content to the verified statement. */
    public verifyStatement(statement: KeyStatement, otherIdentityKeys: readonly POIPublicKey[] = [],
                           at?: number | Date | string): ReturnType<KeyStatement['verifyHolders']> {
        const time = this.evaluationTime(at);
        if (statement.roamingNetworkId !== this.roamingNetworkId ||
            statement.roamingNetworkOperatorId !== this.roamingNetworkOperatorId ||
            statementDigest(statement) !== this.keyStatementDigest)
            throw new POIError('The operator or key statement differs from the authorized trust context');
        return statement.verifyHolders(this.trustedHolders, otherIdentityKeys,
            { minConsensus: this.anchor.minConsensus, at: time });
    }
}

/** Embedded contexts and signature ordering do not change the identity of the signed statement content. */
function statementDigest(statement: KeyStatement): string {
    return toHex(hash('sha256', canonicalJSONBytes(statement.content())));
}

function frozenAnchor(anchor: TrustAnchor): TrustAnchor {
    const copy = TrustAnchor.parse(anchor.toQRCode());
    for (const holder of copy.holders)
        Object.freeze(holder);
    Object.freeze(copy.holders);
    Object.freeze(copy.urls);
    Object.freeze(copy.name);
    Object.freeze(copy.description);
    return Object.freeze(copy);
}
