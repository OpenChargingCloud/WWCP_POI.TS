import { describe, expect, it } from 'vitest';

import { AT, readJSON, readText } from './helpers.ts';

import { TrustAnchor }        from '../src/proofs/trustAnchor.ts';
import { RoamingNetwork }     from '../src/network/roamingNetwork.ts';
import { Commit }             from '../src/history/commit.ts';
import { verifyVersion, describeVersion } from '../src/verifier/version.ts';
import { etagToText }         from '../src/etags.ts';
import { clone, isObject, type JSONObject } from '../src/json/value.ts';


// Example A1: the creation of the roaming network QA, and how to check it, from the QR code and what is published alone.

describe('Example A1: checking QA from its trust anchor', () => {

    const anchorText = readText('published/QA-trustAnchor.txt');

    it('reads the trust anchor of the QR code, and writes the same QR code', () => {

        const anchor = TrustAnchor.parse(anchorText);

        expect(anchor.id).toBe('QA');
        expect(anchor.minConsensus).toBe(2);
        expect(anchor.keys).toHaveLength(3);
        expect(anchor.urls).toEqual([ 'https://open.charging.cloud/RNs/QA' ]);
        expect(anchor.name).toEqual({ en: 'Quality Assurance' });
        expect(anchor.toQRCode()).toBe(anchorText.trim());

        // The URL form names the same keys and quorum.
        const fromURL = TrustAnchor.parse(anchor.toURL());
        expect(fromURL.keys).toEqual(anchor.keys);
        expect(fromURL.minConsensus).toBe(2);

    });

    it('checks QA at its head as an app does (steps a to g)', () => {

        const anchor   = TrustAnchor.parse(anchorText);
        const version  = verifyVersion(anchor, readJSON('published/QA.json'), readJSON('published/QA-commit.json'), AT);

        expect(describeVersion(version)).toBe("Roaming network 'QA'/'Quality Assurance' ('The roaming network of the examples'), operated by 'OCC'/'Open Charging Cloud'");
        expect(version.signedBy).toEqual([ 'AlphaOrg', 'BetaOrg', 'GammaOrg' ]);
        expect(version.warnings).toEqual([]);
        expect(version.commit.revision).toBe(12);

        // The ETags as C# printed them for this head.
        expect(version.network.eTags().map(etagToText)).toEqual([
            'json:sha256:hex:a5240e8663bd75f907728ec96c5e583222f189c7212f67cc97d17917e698eaaf',
            'cbor:sha256:hex:0cc61074c9799ae44737921d490930aaee7628bdd905022b880707ceec081d09',
            'effectiveTree:sha256:hex:40dd962082b413105d4a9f884850b323e7e586d800d74f0a4b679c6488ddf58a',
        ]);

    });

    it('checks the genesis version, revision 0', () => {

        const genesis = readJSON('published/QA-genesis.json') as JSONObject;
        const network = RoamingNetwork.parse(genesis['roamingNetwork']);
        const commit  = Commit.parse(genesis['commit']);

        expect(commit.revision).toBe(0);
        expect(network.matchesCommitETags(commit.eTags)).toBe(true);

        const anchor  = TrustAnchor.parse(anchorText);
        const version = verifyVersion(anchor, genesis['roamingNetwork']!, genesis['commit']!, AT);
        expect(version.signedBy).toEqual([ 'AlphaOrg', 'BetaOrg', 'GammaOrg' ]);

    });

    it('refuses what step b) to f) refuse', () => {

        const anchor   = TrustAnchor.parse(anchorText);
        const network  = readJSON('published/QA.json') as JSONObject;
        const commit   = readJSON('published/QA-commit.json') as JSONObject;

        // b) a name changed: the eTags are not those of the content.
        const renamed = clone(network);
        (renamed['name'] as JSONObject)['en'] = 'Quality Assurance!';
        expect(() => verifyVersion(anchor, renamed, commit, AT)).toThrow(/ETags of the roaming network 'QA' do not match/);

        // b) without eTags, the change is caught by d): the commit does not lead to it.
        delete renamed['eTags'];
        expect(() => verifyVersion(anchor, renamed, commit, AT)).toThrow(/does not lead to the roaming network/);

        // b) signingKeys of the operator.
        const withSigningKeys = clone(network);
        (withSigningKeys['operator'] as JSONObject)['signingKeys'] = [];
        expect(() => verifyVersion(anchor, withSigningKeys, commit, AT)).toThrow(/signingKeyCertificates/);

        // c) a commit changed: its @id is not the digest of its content.
        const changedCommit = clone(commit);
        changedCommit['revision'] = 11;
        expect(() => verifyVersion(anchor, network, changedCommit, AT)).toThrow(/is not the one of its content/);

        // e) the key statement after its validUntil.
        expect(() => verifyVersion(anchor, network, commit, '2028-01-01T00:00:00.000Z')).toThrow(/not valid at/);

        // e) a trust anchor of other keys: also a correct statement of somebody else is refused.
        const otherAnchor = TrustAnchor.create('QA', anchor.urls, [ 'a'.repeat(64), 'b'.repeat(64) ], 2);
        expect(() => verifyVersion(otherAnchor, network, commit, AT)).toThrow(/signed by trusted identity keys of 0 holders/);

        // f) signed by one holder only.
        const oneSignature = clone(commit);
        oneSignature['signatures'] = (oneSignature['signatures'] as JSONObject[]).slice(0, 1);
        expect(() => verifyVersion(anchor, network, oneSignature, AT)).toThrow(/signed by 1 holder/);

        // f) a signature changed.
        const badSignature = clone(commit);
        const signature    = (badSignature['signatures'] as JSONObject[])[0]!;
        signature['signedAt'] = '2026-10-24T03:36:00.000Z';
        expect(() => verifyVersion(anchor, network, badSignature, AT)).toThrow(/signature is invalid/);

        expect(isObject(network)).toBe(true);

    });

});
