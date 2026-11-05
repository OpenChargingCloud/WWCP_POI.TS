import { describe, expect, it } from 'vitest';

import { AT, defined, readJSON, readText } from './helpers.ts';

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
            '58e8ab6b4620f97860d6bcc4d99bba2cb8ce3de7e36e93d0b01051230733634b',
            'b4b2721f903a5a94f3f93d86142cb8b0496244a1724e91be38d2e79e145127d6',
            'c641855eb640d90e8e0299b71ab435d0423d83def3227cab898f74e56d43a995',
        ]);
        expect(anchor.urls).toEqual([ 'https://open.charging.cloud/RNs/QA' ]);
        expect(anchor.name).toEqual({ en: 'Quality Assurance' });
        expect(anchor.toQRCode()).toBe(anchorText.trim());
        expect(anchor.toQRCode()).toHaveLength(511);

        // The URL form names the same keys and quorum, as C# printed it.
        expect(anchor.toURL()).toBe('https://open.charging.cloud/RNs/QA?keys=58e8ab6b4620f97860d6bcc4d99bba2cb8ce3de7e36e93d0b01051230733634b,' +
                                    'b4b2721f903a5a94f3f93d86142cb8b0496244a1724e91be38d2e79e145127d6,c641855eb640d90e8e0299b71ab435d0423d83def3227cab898f74e56d43a995&minConsensus=2');
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
        expect(version.commit.id).toBe('42d013cf5a94124c8a952d0fa98033d449438dcb75cbf622b4dc2360e3c7280f');

        // The ETags as C# printed them for this version.
        expect(version.network.eTags().map(etagToText)).toEqual([
            'json:sha256:hex:a0f18e229d68b386180da6028629fed5e633c532e8151fd4b5a8eba2bda6a35e',
            'cbor:sha256:hex:143015ec82353da45389a8230079b79ea1a1781f0ca9b58132c212ca31070478',
            'effectiveTree:sha256:hex:8e272c39f7da52ba612224ecf663e77e87cc0cbd67040712276a70458dbafd98',
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
        const signature    = defined((badSignature['signatures'] as JSONObject[])[0]);
        signature['signedAt'] = '2026-10-25T16:25:00.000Z';
        expect(() => verifyVersion(anchor, network, badSignature, AT)).toThrow(/signature is invalid/);

        expect(isObject(network)).toBe(true);

    });

});
