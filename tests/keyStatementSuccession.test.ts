import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { CoseCurves, CoseKey } from '@vanaheimr/cose';
import { KeyStatement, POIPublicKey, RoamingNetwork, TrustAnchor, TrustContext, toBase64, toHex } from '../src/index.ts';
import type { JSONArray, JSONObject } from '../src/index.ts';
import { readJSON } from './helpers.ts';

// A key statement may carry signatures of identity keys of the statement before it that it names no longer
// (SPECIFICATION.md, section 8.6; WWCP_POI 5219653): the key of a holder that left, or one replaced by a key of another
// holder. Verified alone, such a signature is passed over and counts for nothing, as its key is not given; followed after
// the statement before, it is what leads from the keys trusted to the new ones.
//
// The verdicts and the words are those of WWCP_POI3 at 464e712 for statements of the same shape, of its own keys:
// 68 results of TryVerify, TryVerifyChain and RoamingNetworkTrustContext.Evaluate, the same here for each.

const at = Date.parse('2026-11-01T12:01:00.000Z');

interface Holder {
    readonly publicKey:  POIPublicKey;
    readonly id:         string;
    readonly sign:       (bytes: Uint8Array) => string;
}

function holder(seed: number, name: string): Holder {

    const privateKey = createPrivateKey({ key: Buffer.concat([ Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, seed) ]), format: 'der', type: 'pkcs8' });
    const raw        = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32);
    const coseKey    = CoseKey.fromOkpPublicKey(CoseCurves.Ed25519, raw);
    const publicKey  = POIPublicKey.parse({ '@id': toHex(coseKey.thumbprint()), key: toBase64(coseKey.toBytes()), holder: name });

    return { publicKey, id: publicKey.id, sign: (bytes): string => sign(null, bytes, privateKey).toString('base64') };

}

const alpha   = holder(11, 'AlphaOrg');
const beta    = holder(12, 'BetaOrg');
const gamma   = holder(13, 'GammaOrg');
const newOrg  = holder(14, 'NewOrg');
const mallory = holder(15, 'Mallory');

/** The key statement of the given holders, signed by the given ones: by all of them unless said otherwise. */
function statement(minConsensus: number, named: readonly Holder[], signers: readonly Holder[] = named): KeyStatement {

    const [ first ] = named;

    const value: JSONObject = {
        roamingNetworkId:          'QA',
        roamingNetworkOperatorId:  'OCC',
        minConsensus,
        identityKeys:              named.map(key => key.publicKey).sort((a, b) => a.id.localeCompare(b.id)).map(key => key.json),
        signedAt:                  '2026-11-01T12:00:00.000Z',
        validUntil:                '2027-11-01T12:00:00.000Z',
        signatures:                [ { algorithm: 'Ed25519', keyId: first?.id ?? '', value: 'placeholder' } ]
    };

    const unsigned = KeyStatement.parse(value);

    return KeyStatement.parse({ ...value, signatures: signers.map(signer => ({
        algorithm:  'Ed25519',
        keyId:      signer.id,
        value:      signer.sign(unsigned.signingBytes('Ed25519', signer.id))
    })) });

}

const anchorOf = (holders: readonly Holder[], minConsensus = 1): TrustAnchor =>
    TrustAnchor.create('QA', [ 'https://alphaorg.example/RNs/QA' ], holders.map(key => [ key.id ]), minConsensus);

// AlphaOrg alone, then with BetaOrg, then with GammaOrg, two of three.
const s1 = statement(1, [ alpha ]);
const s2 = statement(2, [ alpha, beta ]);
const s3 = statement(2, [ alpha, beta, gamma ]);

// AlphaOrg leaves: stated by those that stay, and by AlphaOrg, which it names no longer.
const s4  = statement(2, [ beta, gamma ]);
const s4a = statement(2, [ beta, gamma ], [ beta, gamma, alpha ]);

// The keys of NewOrg in the place of the one of AlphaOrg: stated by its identity key, and by the one it replaces.
const byItself = statement(1, [ newOrg ]);
const after    = statement(1, [ newOrg ], [ newOrg, alpha ]);
const forged   = statement(1, [ newOrg ], [ newOrg, mallory ]);

describe('A key statement with a signature of a key it names no longer', () => {

    test('alone, the signature is passed over and counts for nothing', () => {

        // By its own key, for whoever trusts that.
        expect(after.verifyHolders([ [ newOrg.id ] ], [], { at }).holderOf.get(newOrg.id)).toBe('NewOrg');

        // Not by the key it does not name: that is not given.
        expect(() => after.verifyHolders([ [ alpha.id ] ], [], { at }))
            .toThrow('The key statement is signed by trusted identity keys of 0 holders, not of 1!');

        // A signature of somebody else does no harm, and gives nothing.
        expect(forged.verifyHolders([ [ newOrg.id ] ], [], { at }).holderOf.get(newOrg.id)).toBe('NewOrg');
        expect(() => forged.verifyHolders([ [ mallory.id ] ], [], { at }))
            .toThrow('The key statement is signed by trusted identity keys of 0 holders, not of 1!');

    });

    test('given the key, the signature is verified and counted', () => {

        expect(after.verifyHolders([ [ alpha.id ] ], [ alpha.publicKey ], { at }).signedBy.size).toBe(1);

        // Three of three only with the key of the holder that left.
        expect(() => s4a.verifyHolders([ [ alpha.id ], [ beta.id ], [ gamma.id ] ], [], { minConsensus: 3, at }))
            .toThrow('The key statement is signed by trusted identity keys of 2 holders, not of 3!');
        expect(s4a.verifyHolders([ [ alpha.id ], [ beta.id ], [ gamma.id ] ], [ alpha.publicKey ], { minConsensus: 3, at }).signedBy.size).toBe(3);

    });

    test('a single signature of a key that is not trusted is still named', () => {

        expect(() => byItself.verifyHolders([ [ alpha.id ] ], [], { at }))
            .toThrow(`The key statement is signed by the key '${newOrg.id}', which is not trusted!`);

    });

    test('a holder that leaves: the statement of those that stay is taken with and without its signature', () => {

        expect(s4 .verifyHolders([ [ beta.id ], [ gamma.id ] ], [], { at }).signedBy.size).toBe(2);
        expect(s4a.verifyHolders([ [ beta.id ], [ gamma.id ] ], [], { at }).signedBy.size).toBe(2);

        // Whoever trusts the one that left alone is not led on by a statement alone.
        expect(() => s4a.verifyHolders([ [ alpha.id ] ], [], { at }))
            .toThrow('The key statement is signed by trusted identity keys of 0 holders, not of 2!');

    });

});

describe('Key statements followed one after the other', () => {

    test('the key the one before names leads to the new ones', () => {

        const { verified, holderOf } = KeyStatement.verifyChain([ s1, after ], [ [ alpha.id ] ], { at });

        expect(verified).toBe(after);
        expect(holderOf.get(newOrg.id)).toBe('NewOrg');
        expect(holderOf.has(alpha.id)).toBe(false);

    });

    test('not without that signature, and not by somebody else\'s', () => {

        expect(() => KeyStatement.verifyChain([ s1, byItself ], [ [ alpha.id ] ], { at }))
            .toThrow(`The key statement 2 of 2 does not follow the one before: The key statement is signed by the key '${newOrg.id}', which is not trusted!`);

        expect(() => KeyStatement.verifyChain([ s1, forged ], [ [ alpha.id ] ], { at }))
            .toThrow('The key statement 2 of 2 does not follow the one before: The key statement is signed by trusted identity keys of 0 holders, not of 1!');

        // Nor where the verifier trusts or is given the key of somebody else.
        expect(() => KeyStatement.verifyChain([ s1, forged ], [ [ alpha.id, mallory.id ] ], { at }))
            .toThrow('The key statement 2 of 2 does not follow the one before: The key statement is signed by trusted identity keys of 0 holders, not of 1!');
        expect(() => KeyStatement.verifyChain([ s1, forged ], [ [ alpha.id ] ], { at, otherIdentityKeys: [ mallory.publicKey ] }))
            .toThrow('The key statement 2 of 2 does not follow the one before');

    });

    test('from AlphaOrg alone to BetaOrg and GammaOrg without it', () => {

        for (const last of [ s4, s4a ]) {

            const { verified, holderOf } = KeyStatement.verifyChain([ s1, s2, s3, last ], [ [ alpha.id ] ], { at });

            expect(verified).toBe(last);
            expect([ ...holderOf.values() ].sort()).toEqual([ 'BetaOrg', 'GammaOrg' ]);

        }

    });

    test('a holder that leaves does not decide alone where two are required', () => {

        const gammaAlone         = statement(1, [ gamma ]);
        const gammaWithAlpha     = statement(1, [ gamma ], [ gamma, alpha ]);
        const gammaWithAlphaBeta = statement(1, [ gamma ], [ gamma, alpha, beta ]);

        expect(() => KeyStatement.verifyChain([ s1, s2, gammaAlone ], [ [ alpha.id ] ], { at }))
            .toThrow('The key statement 3 of 3 does not follow the one before: The key statement is signed by trusted identity keys of 0 holders, not of 2!');
        expect(() => KeyStatement.verifyChain([ s1, s2, gammaWithAlpha ], [ [ alpha.id ] ], { at }))
            .toThrow('The key statement 3 of 3 does not follow the one before: The key statement is signed by trusted identity keys of 1 holder, not of 2!');

        expect(KeyStatement.verifyChain([ s1, s2, gammaWithAlphaBeta ], [ [ alpha.id ] ], { at }).verified).toBe(gammaWithAlphaBeta);

    });

    test('whoever trusts the new key already takes the statement alone', () => {

        expect(KeyStatement.verifyChain([ after ], [ [ newOrg.id ] ], { at }).verified).toBe(after);
        expect(() => KeyStatement.verifyChain([ after ], [ [ alpha.id ] ], { at }))
            .toThrow('None of the 1 key statements is signed by the trusted identity keys: The key statement is signed by trusted identity keys of 0 holders, not of 1!');

    });

});

describe('A trust anchor and a key statement with a signature of a key it names no longer', () => {

    test('the signature is not counted where it could not be verified', () => {

        const evaluated = TrustContext.evaluate(anchorOf([ alpha ]), after, { trustedIdentityKeyIds: [ alpha.id ], at });

        expect(evaluated.signatures)        .toBe('valid');
        expect(evaluated.signers)           .toBe('invalid');
        expect(evaluated.quorum)            .toBe('invalid');
        expect(evaluated.trustedHolderCount).toBe(0);
        expect(evaluated.signatureCount)    .toBe(2);
        expect(evaluated.verificationError) .toBe('The key statement is signed by trusted identity keys of 0 holders, not of 1!');
        expect(evaluated.context)           .toBeUndefined();

    });

    test('given the key, it is counted', () => {

        const evaluated = TrustContext.evaluate(anchorOf([ alpha ]), after, { trustedIdentityKeyIds: [ alpha.id ], otherIdentityKeys: [ alpha.publicKey ], at });

        expect(evaluated.signatures)        .toBe('valid');
        expect(evaluated.signers)           .toBe('valid');
        expect(evaluated.quorum)            .toBe('valid');
        expect(evaluated.trustedHolderCount).toBe(1);
        expect(evaluated.context)           .toBeDefined();

    });

    test('the anchor of the new key takes the statement, whoever else signed it', () => {

        for (const given of [ after, forged ]) {

            const evaluated = TrustContext.evaluate(anchorOf([ newOrg ]), given, { trustedIdentityKeyIds: [ newOrg.id ], at });

            expect(evaluated.signatures)        .toBe('valid');
            expect(evaluated.trustedHolderCount).toBe(1);
            expect(evaluated.context)           .toBeDefined();

        }

    });

    test('the holders that stay are counted, the one that left is not', () => {

        const evaluated = TrustContext.evaluate(anchorOf([ alpha, beta, gamma ], 2), s4a, { trustedIdentityKeyIds: [ alpha.id, beta.id, gamma.id ], at });

        expect(evaluated.signatures)        .toBe('valid');
        expect(evaluated.quorum)            .toBe('valid');
        expect(evaluated.trustedHolderCount).toBe(2);
        expect(evaluated.signatureCount)    .toBe(3);

    });

});

describe('A version whose key statement carries a signature of a key its operator names no longer', () => {

    // Revision 2 of example A1 without its ETags, the signatures of its key statement changed: read by WWCP_POI3 at
    // 464e712 (RoamingNetwork.TryParse) with the same verdict and words, for each of nine such versions.
    const UNKNOWN = 'ab'.repeat(32);

    function version(change: (signatures: JSONObject[]) => void): JSONObject {

        const network    = readJSON('published/QA-revision2.json') as JSONObject;
        const operator   = network['operator'] as JSONObject;
        const statement  = operator['keyStatement'] as JSONObject;
        const signatures = statement['signatures'] as JSONArray as JSONObject[];

        delete network['eTags'];
        change(signatures);

        return network;

    }

    test('is taken: the signature is passed over, also where it is no signature at all', () => {

        expect(() => RoamingNetwork.parse(version(signatures => { signatures.push({ ...signatures[0], keyId: UNKNOWN }); }))).not.toThrow();
        expect(() => RoamingNetwork.parse(version(signatures => { signatures.unshift({ ...signatures[0], keyId: UNKNOWN }); }))).not.toThrow();
        expect(() => RoamingNetwork.parse(version(signatures => { signatures.push({ algorithm: 'XX999', keyId: UNKNOWN, value: 'AAAA' }); }))).not.toThrow();

    });

    test('is refused where the signatures of the keys it names are too few', () => {

        expect(() => RoamingNetwork.parse(version(signatures => { signatures[0] = { ...signatures[0], keyId: UNKNOWN }; })))
            .toThrow("The given JSON representation of a roaming network is invalid: The key statement of the roaming network operator 'OCC' is not signed by identity keys of 2 of its holders: The key statement is signed by trusted identity keys of 1 holder, not of 2! (Parameter 'Operator')");

    });

    test('is refused where that key signs twice', () => {

        expect(() => RoamingNetwork.parse(version(signatures => { signatures.push({ ...signatures[0], keyId: UNKNOWN }, { ...signatures[1], keyId: UNKNOWN }); })))
            .toThrow("Invalid key statement: An identity key signs a key statement once. (Parameter 'Signatures')");

    });

});
