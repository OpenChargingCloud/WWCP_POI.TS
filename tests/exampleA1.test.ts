import { describe, expect, it } from 'vitest';

import { AT, defined, readJSON, readText } from './helpers.ts';

import { TrustAnchor }        from '../src/proofs/trustAnchor.ts';
import { KeyStatement }       from '../src/proofs/keyStatement.ts';
import { OperatorTrust }      from '../src/verifier/trust.ts';
import { RoamingNetwork }     from '../src/network/roamingNetwork.ts';
import { Commit }             from '../src/history/commit.ts';
import { verifyVersion, describeVersion } from '../src/verifier/version.ts';
import { etagToText }         from '../src/etags.ts';
import { clone, isObject, sameValue, type JSONObject, type JSONValue } from '../src/json/value.ts';

const sameJSON = (left: JSONValue | undefined, right: JSONValue | undefined): boolean => sameValue(left, right);


// Example A1: the creation of the roaming network QA, and how to check it, from the QR code and what is published alone.
// QA begins with AlphaOrg alone, revision 0, the genesis; then BetaOrg joins, two of two, revision 1, and GammaOrg, two of
// three, revision 2: the version A1 leaves, which the trust anchor published names. Later examples publish later versions.

describe('Example A1: checking QA from its trust anchor', () => {

    const anchorText  = readText('published/QA-trustAnchor.txt');
    const genesis     = readJSON('published/QA-genesis.json') as JSONObject;
    const network     = readJSON('published/QA-revision2.json') as JSONObject;
    const commit      = readJSON('published/QA-revision2-commit.json') as JSONObject;

    it('reads the trust anchor of the QR code, and writes the same QR code', () => {

        const anchor = TrustAnchor.parse(anchorText);

        expect(anchor.id).toBe('QA');
        expect(anchor.minConsensus).toBe(2);
        expect(anchor.keys).toEqual([
            '29ff65d687d7ec90c1a2a05a6598c255bc2b5e9a2d4e7379593112143e8d12cb',
            '6cc0a19dee108f51c098f473bef8c117812b21d015e2ee22237f02d00ae177c9',
            'f7d7504fbbc575397e9aaadf1fe65b028951324219c7eb888e75737b77cbc3ca',
        ]);
        // The URLs of its copies, as the roaming network names them itself: one of each holder of OCC.
        expect(anchor.urls).toEqual([ 'https://alpha.example/RNs/QA', 'https://beta.example/RNs/QA', 'https://gamma.example/RNs/QA' ]);
        expect(RoamingNetwork.parse(network).urls).toEqual(anchor.urls);
        expect(anchor.name).toEqual({ en: 'Quality Assurance' });
        expect(anchor.toQRCode()).toBe(anchorText.trim());
        expect(anchor.toQRCode()).toHaveLength(591);

        // The URL form names the same keys and quorum, as C# printed it.
        expect(anchor.toURL()).toBe('https://alpha.example/RNs/QA?keys=29ff65d687d7ec90c1a2a05a6598c255bc2b5e9a2d4e7379593112143e8d12cb,' +
                                    '6cc0a19dee108f51c098f473bef8c117812b21d015e2ee22237f02d00ae177c9,f7d7504fbbc575397e9aaadf1fe65b028951324219c7eb888e75737b77cbc3ca&minConsensus=2' +
                                    '&alsoAt=https%3A%2F%2Fbeta.example%2FRNs%2FQA&alsoAt=https%3A%2F%2Fgamma.example%2FRNs%2FQA');
        const fromURL = TrustAnchor.parse(anchor.toURL());
        expect(fromURL.keys).toEqual(anchor.keys);
        expect(fromURL.minConsensus).toBe(2);

    });

    it('checks QA as an app does (steps a to g): revision 2, signed by the three holders of OCC', () => {

        const anchor   = TrustAnchor.parse(anchorText);
        const version  = verifyVersion(anchor, network, commit, AT);

        expect(describeVersion(version)).toBe("Roaming network 'QA'/'Quality Assurance' ('The roaming network of the examples'), operated by 'OCC'/'Open Charging Cloud'");
        expect(version.signedBy).toEqual([ 'AlphaOrg', 'BetaOrg', 'GammaOrg' ]);
        expect(version.warnings).toEqual([]);
        expect(version.commit.revision).toBe(2);
        expect(version.commit.id).toBe('9e3b83bc60587f2cfe9b67e4919b35728f4c9da80dab2d541539329acd7b5893');

        // The ETags as C# printed them for this version.
        expect(version.network.eTags().map(etagToText)).toEqual([
            'json:sha256:hex:26c588e262ff63a55dd7fff4c1e3b58b2eb10de97429ae0c3fd98452873ec279',
            'cbor:sha256:hex:1357b7bc25a268f0ee46516e83dbcf900e3d2b531b93eb130bc45c71a3dec0d9',
            'effectiveTree:sha256:hex:f287359da284a0a9c0630f5226aa9600bd250ef165294d47ac0d6453526aed44',
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

    it('checks the genesis and revision 1 from the trust anchors of their time, and refuses them from the one of today', () => {

        const anchor   = TrustAnchor.parse(anchorText);
        const anchor0  = TrustAnchor.parse(readText('published/QA-trustAnchor-revision0.txt'));
        const anchor1  = TrustAnchor.parse(readText('published/QA-trustAnchor-revision1.txt'));

        expect([ anchor0, anchor1, anchor ].map(pinned => `${pinned.holders.length} of ${pinned.keys.length}, minConsensus ${pinned.minConsensus}, ${pinned.urls.length} URL(s), ${pinned.toQRCode().length}`))
            .toEqual([ '1 of 1, minConsensus 1, 1 URL(s), 379', '2 of 2, minConsensus 2, 2 URL(s), 495', '3 of 3, minConsensus 2, 3 URL(s), 591' ]);
        expect(readText('published/QA-trustAnchor-revision2.txt')).toBe(anchorText);

        // Revision 0: AlphaOrg alone.
        const first = verifyVersion(anchor0, defined(genesis['roamingNetwork']), defined(genesis['commit']), AT);
        expect(first.commit.revision).toBe(0);
        expect(first.commit.id).toBe('b444c6e0e157ea9f56fec121b0e90cf6ab27a46b9e8d78798afc16b01d029098');
        expect(first.signedBy).toEqual([ 'AlphaOrg' ]);
        expect(first.network.urls).toEqual([ 'https://alpha.example/RNs/QA' ]);
        expect(first.network.eTags().map(etagToText)).toEqual([
            'json:sha256:hex:81a9f56099d6570b5859c481c44fa860bb959aaa6831daff5efbf89e758171f4',
            'cbor:sha256:hex:1436a333c01eb8f993b007fc5ff38e95bed2ea0fc92c27aecf534aade4d1f236',
            'effectiveTree:sha256:hex:d334cf10b4016bfc6cb6f5ce1c3f562b24f5c9ca4406264723a9be15e8f4739c',
        ]);
        expect(sameJSON(genesis['roamingNetwork'], readJSON('published/QA-revision0.json'))).toBe(true);
        expect((readJSON('published/QA-revision0-commit.json') as JSONObject)['@id']).toBe(first.commit.id);

        // Revision 1: BetaOrg joined, both decide.
        const second = verifyVersion(anchor1, readJSON('published/QA-revision1.json'), readJSON('published/QA-revision1-commit.json'), AT);
        expect(second.commit.revision).toBe(1);
        expect(second.commit.id).toBe('e8f7b46f639dd8a2addff6822f71336b6bdbe567c14bd4892423463ec2f1a755');
        expect(second.signedBy).toEqual([ 'AlphaOrg', 'BetaOrg' ]);

        // The trust anchor of today knows two holders more than the genesis names, and asks for two of them.
        expect(() => verifyVersion(anchor, defined(genesis['roamingNetwork']), defined(genesis['commit']), AT))
            .toThrow('The key statement is signed by trusted identity keys of 1 holder, not of 2!');

        // The trust anchor of revision 0 alone does not take the version of today: two decide today, and it knows one.
        expect(() => verifyVersion(anchor0, network, commit, AT)).toThrow('The key statement is signed by trusted identity keys of 1 holder, not of 2!');

    });

    it('follows the key statements of OCC one after the other from the trust anchor of revision 0 to the keys of today, as C# does', () => {

        const anchor      = TrustAnchor.parse(anchorText);
        const anchor0     = TrustAnchor.parse(readText('published/QA-trustAnchor-revision0.txt'));
        const published   = readJSON('published/QA-keyStatements.json') as JSONObject;
        const statements  = KeyStatement.parseChain(published);
        const at          = Date.parse(AT);

        expect(statements.map(statement => `${statement.holders.length} holder(s), minConsensus ${statement.minConsensus}, ${statement.signatures.length} signature(s)`))
            .toEqual([ '1 holder(s), minConsensus 1, 1 signature(s)', '2 holder(s), minConsensus 2, 2 signature(s)', '3 holder(s), minConsensus 2, 2 signature(s)' ]);

        // The key statement of today alone, as C# printed it.
        expect(() => defined(statements[2]).verifyHolders(anchor0.holders, [], { minConsensus: anchor0.minConsensus, at }))
            .toThrow('The key statement is signed by trusted identity keys of 1 holder, not of 2!');

        // One after the other: the keys and the quorum of the trust anchor of today.
        const { verified, holderOf } = KeyStatement.verifyChain(statements, anchor0.holders, { minConsensus: anchor0.minConsensus, at });

        expect([ ...new Set(holderOf.values()) ].sort()).toEqual([ 'AlphaOrg', 'BetaOrg', 'GammaOrg' ]);
        expect(verified.minConsensus).toBe(anchor.minConsensus);
        expect(verified.holders.map(keys => [ ...keys ].sort().join(';')).sort()).toEqual(anchor.holders.map(keys => [ ...keys ].sort().join(';')).sort());
        expect(sameJSON(verified.json, (network['operator'] as JSONObject)['keyStatement'])).toBe(true);

        // From the trust anchors of revision 1 and of today: the statements before the first one they take are passed over.
        expect(KeyStatement.verifyChain(statements, TrustAnchor.parse(readText('published/QA-trustAnchor-revision1.txt')).holders, { minConsensus: 2, at }).verified).toBe(statements[2]);
        expect(KeyStatement.verifyChain(statements, anchor.holders, { minConsensus: anchor.minConsensus, at }).verified).toBe(statements[2]);

        // As a history follows them, version by version.
        const trust = OperatorTrust.of(anchor0, RoamingNetwork.parse(genesis['roamingNetwork']), AT).
                          followedBy(RoamingNetwork.parse(readJSON('published/QA-revision1.json')), AT).
                          followedBy(RoamingNetwork.parse(network), AT);
        expect([ ...trust.trustedIdentityKeyIds ].sort()).toEqual([ ...anchor.keys ].sort());
        expect(trust.requiredConsensus).toBe(2);

    });

    it('refuses key statements not leading from the trusted keys to the last of them, in the words of C#', () => {

        const anchor0     = TrustAnchor.parse(readText('published/QA-trustAnchor-revision0.txt'));
        const published   = (readJSON('published/QA-keyStatements.json') as JSONObject)['keyStatements'] as JSONObject[];
        const statements  = published.map(statement => KeyStatement.parse(statement));
        const [ first, second, third ] = [ defined(statements[0]), defined(statements[1]), defined(statements[2]) ];
        const at          = Date.parse(AT);
        const chain       = (given: readonly KeyStatement[], time: number = at): unknown =>
            KeyStatement.verifyChain(given, anchor0.holders, { minConsensus: anchor0.minConsensus, at: time });

        expect(() => chain([])).toThrow('No key statement is given!');
        expect(() => KeyStatement.parseChain({ keyStatements: {} })).toThrow('The keyStatements must be a JSON array of key statements!');

        // Without the one in between, the statement of today follows the first one: AlphaOrg, the quorum before, signed it,
        // and AlphaOrg and BetaOrg, two of its own three holders.
        expect((chain([ first, third ]) as { verified: KeyStatement }).verified).toBe(third);

        // Out of order: a statement but the last is valid when the one after it was signed.
        expect(() => chain([ first, third, second ]))
            .toThrow('The key statement 2 of 3 does not follow the one before: The key statement is not valid at 2026-11-16T20:30:07.690Z: it was signed at 2026-11-16T20:30:07.993Z and is valid until 2027-11-16T20:30:07.059Z!');

        // None of them signed by what is trusted.
        expect(() => KeyStatement.verifyChain(statements, [ [ 'a'.repeat(64) ] ], { at }))
            .toThrow(`None of the 3 key statements is signed by the trusted identity keys: The key statement is signed by the key '${defined(first.signatures[0]).keyId}', which is not trusted!`);

        // Of another roaming network operator.
        const other = KeyStatement.parse({ ...defined(published[1]), roamingNetworkOperatorId: 'OCC2' });
        expect(() => chain([ first, other ])).toThrow("The key statement 2 of 2 is one of the roaming network operator 'OCC2' of 'QA', not of 'OCC' of 'QA'!");

        // A signature of the one joining alone: not by the quorum before.
        const byBetaOrg = KeyStatement.parse({ ...defined(published[1]), signatures: (defined(published[1])['signatures'] as JSONObject[]).slice(1) });
        expect(() => chain([ first, byBetaOrg ])).toThrow(`The key statement 2 of 2 does not follow the one before: The key statement is signed by the key '${defined(second.signatures[1]).keyId}', which is not trusted!`);

        // The last one after its validUntil; one before it only when it was replaced.
        expect(() => chain(statements, Date.parse('2028-01-01T00:00:00.000Z'))).toThrow(/^The key statement 3 of 3 does not follow the one before: The key statement is not valid at 2028-01-01T00:00:00.000Z: /u);
        expect(() => chain([ first ], Date.parse('2028-01-01T00:00:00.000Z'))).toThrow(/^None of the 1 key statements is signed by the trusted identity keys: The key statement is not valid at 2028-01-01T00:00:00.000Z: /u);

    });

});
