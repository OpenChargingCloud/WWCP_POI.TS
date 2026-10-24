import { describe, expect, it } from 'vitest';

import { AT, readJSON, readText } from './helpers.ts';

import { TrustAnchor }        from '../src/proofs/trustAnchor.ts';
import { RoamingNetwork }     from '../src/network/roamingNetwork.ts';
import { Commit }             from '../src/history/commit.ts';
import { verifyVersion, describeVersion } from '../src/verifier/version.ts';
import { etagToText }         from '../src/etags.ts';
import { clone, isObject, type JSONObject } from '../src/json/value.ts';


// Example A1: the creation of the roaming network QA, and how to check it, from the QR code and what is published alone.
// The version A1 published is the genesis: later examples publish later versions under the same name.

describe('Example A1: checking QA from its trust anchor', () => {

    const anchorText  = readText('published/QA-trustAnchor.txt');
    const genesis     = readJSON('published/QA-genesis.json') as JSONObject;
    const network     = genesis['roamingNetwork'] as JSONObject;
    const commit      = genesis['commit'] as JSONObject;

    it('reads the trust anchor of the QR code, and writes the same QR code', () => {

        const anchor = TrustAnchor.parse(anchorText);

        expect(anchor.id).toBe('QA');
        expect(anchor.minConsensus).toBe(2);
        expect(anchor.keys).toEqual([
            '6802793c736ed4c54a5dbcc6dbe46e28196bb8afb0616fe6ec3c5e8f07907471',
            '97c70ab40140e03e0fcba2259a810d1f37c7f4b506f544704a8fcb248d7cd676',
            'c3d7ce494480e67ef560ed183176cb17328de7c9bf85fc3ab001d3eb09482149',
        ]);
        expect(anchor.urls).toEqual([ 'https://open.charging.cloud/RNs/QA' ]);
        expect(anchor.name).toEqual({ en: 'Quality Assurance' });
        expect(anchor.toQRCode()).toBe(anchorText.trim());
        expect(anchor.toQRCode()).toHaveLength(511);

        // The URL form names the same keys and quorum, as C# printed it.
        expect(anchor.toURL()).toBe('https://open.charging.cloud/RNs/QA?keys=6802793c736ed4c54a5dbcc6dbe46e28196bb8afb0616fe6ec3c5e8f07907471,' +
                                    '97c70ab40140e03e0fcba2259a810d1f37c7f4b506f544704a8fcb248d7cd676,c3d7ce494480e67ef560ed183176cb17328de7c9bf85fc3ab001d3eb09482149&minConsensus=2');
        const fromURL = TrustAnchor.parse(anchor.toURL());
        expect(fromURL.keys).toEqual(anchor.keys);
        expect(fromURL.minConsensus).toBe(2);

    });

    it('checks QA as an app does (steps a to g): revision 0, signed by the three holders of OCC', () => {

        const anchor   = TrustAnchor.parse(anchorText);
        const version  = verifyVersion(anchor, network, commit, AT);

        expect(describeVersion(version)).toBe("Roaming network 'QA'/'Quality Assurance' ('The roaming network of the examples'), operated by 'OCC'/'Open Charging Cloud'");
        expect(version.signedBy).toEqual([ 'AlphaOrg', 'BetaOrg', 'GammaOrg' ]);
        expect(version.warnings).toEqual([]);
        expect(version.commit.revision).toBe(0);
        expect(version.commit.id).toBe('2fce230bc74c445ede50ad41d93bddc144dd38c8066e4b862b423fce5c28576c');

        // The ETags as C# printed them for this version.
        expect(version.network.eTags().map(etagToText)).toEqual([
            'json:sha256:hex:55148e1802c8c0b0dba00d877cefe251d7235fdc885ade183d425c7759d0fbf9',
            'cbor:sha256:hex:93719280d373c6b4115259ca7af5e115e3d9bc73c442099a539d32a9cccd7766',
            'effectiveTree:sha256:hex:32d8ef910776b4bd6be05f4410653932bd1acf84dba2009f8ae70ba3950ac15d',
        ]);

        expect(RoamingNetwork.parse(network).matchesCommitETags(Commit.parse(commit).eTags)).toBe(true);

    });

    it('refuses what step b) to f) refuse', () => {

        const anchor = TrustAnchor.parse(anchorText);

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
        signature['signedAt'] = '2026-10-24T16:56:00.000Z';
        expect(() => verifyVersion(anchor, network, badSignature, AT)).toThrow(/signature is invalid/);

        expect(isObject(network)).toBe(true);

    });

});
