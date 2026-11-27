import { describe, expect, it } from 'vitest';

import { readJSON } from './helpers.ts';

import { applyChangeSet } from '../src/history/apply.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification } from '../src/history/changeSet.ts';
import { etagToJSON } from '../src/etags.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';
import { clone, get, without, type JSONObject, type JSONValue } from '../src/json/value.ts';


// The URLs of the copies of a roaming network, `urls` (SPECIFICATION.md section 2), and the quorum of its operator, which
// fits its keys in every version, not between the changes of one change set (4.1, "Holders joining and leaving"): as
// WWCP_POI3 at 039303b reads and changes them, in its words. Every verdict below is the one WWCP_POI3 gave for the same
// version (`RoamingNetwork.TryParse`) or the same change set (`TryApplyPendingChangeSet`) of the revisions 0 to 2 of QA,
// the after ETags those it calculated (`CreateChangeSet`).

const AT        = '2026-11-16T20:40:00.000Z';
const REVISION  = [ 0, 1, 2 ].map(revision => RoamingNetwork.parse(readJSON(`published/QA-revision${revision}.json`)));
const QA        = REVISION[2] as RoamingNetwork;
const ALPHA     = 'https://alpha.example/RNs/QA';
const NETWORK   = "the roaming network 'QA'";

/** Why QA at revision 2, without its eTags and changed as given, is refused as a version, word for word; 'taken' otherwise. */
function version(change: (network: JSONObject, operator: JSONObject) => void, revision = 2): string {
    const json = without(clone(readJSON(`published/QA-revision${revision}.json`) as JSONObject), 'eTags');
    change(json, json['operator'] as JSONObject);
    try {
        RoamingNetwork.parse(json);
    }
    catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
    return 'taken';
}

const withURLs = (urls: JSONValue): string => version(network => { network['urls'] = urls; });

/** A change set of the given changes at AT, unsigned, leading to the version of the given json and cbor ETags, else to the one before. */
function changeSetOf(before: RoamingNetwork, changes: JSONObject[], after?: readonly [ string, string ]): ChangeSet {

    const beforeETags = before.changeSetETags().map(eTag => etagToJSON(eTag));
    const json: JSONObject = {
        '@context':        CHANGE_SET_CONTEXT,
        roamingNetworkId:  before.id,
        createdAt:         AT,
        changes,
        beforeETags,
        afterETags:        after === undefined ? beforeETags : [ [ 'json', 'sha256', 'hex', after[0] ], [ 'cbor', 'sha256', 'hex', after[1] ] ],
    };

    json['@id'] = changeSetIdentification(json);

    return ChangeSet.parse(json);

}

/** Why the given changes are refused, word for word; 'taken' when they lead to the version of the given ETags WWCP_POI3 calculated. */
function outcome(changes: JSONObject[], after?: readonly [ string, string ], before = QA): string {
    try {
        applyChangeSet(before, changeSetOf(before, changes, after), { checkOwnership: false });
    }
    catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
    return 'taken';
}

const property = (entityType: string, entityId: string) => (propertyName: string, newValue?: JSONValue): JSONObject =>
    newValue === undefined ? { kind: 'RemoveProperty', entityType, entityId, propertyName }
                           : { kind: 'UpdateProperty', entityType, entityId, propertyName, newValue };

const network   = property('RoamingNetwork', 'QA');
const operator  = property('RoamingNetworkOperator', 'OCC');
const element   = (kind: string, elementId: string, more: JSONObject = {}): JSONObject =>
    ({ kind, entityType: 'RoamingNetwork', entityId: 'QA', elementPath: [ { propertyName: 'urls', elementId } ], ...more });

/** The keys of the operator of the given revision, given to another one: its identity keys, the certificates of its signing keys, its key statement. */
const keysOf = (revision: number): JSONObject[] => {
    const from = get((REVISION[revision] as RoamingNetwork).content, 'operator') as JSONObject;
    return [ 'identityKeys', 'signingKeyCertificates', 'keyStatement' ].map(name => operator(name, from[name] as JSONValue));
};

const NOT_A_NETWORK = 'is not the one of a roaming network, ~/RNs/{RN_Id}, without a query, a fragment or a trailing slash!';


describe('The URLs of the copies of a roaming network (2)', () => {

    it('are read with the roaming network, in their order, none when it names none', () => {

        expect((REVISION[0] as RoamingNetwork).urls).toEqual([ ALPHA ]);
        expect((REVISION[1] as RoamingNetwork).urls).toEqual([ ALPHA, 'https://beta.example/RNs/QA' ]);
        expect(QA.urls).toEqual([ ALPHA, 'https://beta.example/RNs/QA', 'https://gamma.example/RNs/QA' ]);

        expect(version(() => undefined)).toBe('taken');
        expect(version(json => { delete json['urls']; })).toBe('taken');
        expect(RoamingNetwork.parse(without(without(clone(readJSON('published/QA-revision2.json') as JSONObject), 'eTags'), 'urls')).urls).toEqual([]);

        // Their order is content: another order is another version.
        expect(withURLs([ ...QA.urls ].reverse())).toBe('taken');
        expect(version(json => { json['urls'] = [ ...QA.urls ].reverse(); json['eTags'] = (readJSON('published/QA-revision2.json') as JSONObject)['eTags'] as JSONValue; }))
            .toBe("The ETags of the roaming network 'QA' do not match its content: the json ETag (sha256) differs!");

        // In another case of its scheme, of the roaming network, under a path, at a port, at an IPv6 address.
        for (const url of [ 'HTTPS://alpha.example/RNs/QA', 'https://alpha.example/RNs/qa', 'https://alpha.example/api/v1/RNs/QA', 'https://alpha.example:8443/RNs/QA',
                            'https://[::1]/RNs/QA', 'https://alpha.example/RNs/%51A' ])
            expect(withURLs([ url ]), url).toBe('taken');

        expect(withURLs(Array.from({ length: 16 }, (_, index) => `https://h${index}.example/RNs/QA`))).toBe('taken');

    });

    it('are refused as WWCP_POI3 refuses them, in its words and its order', () => {

        for (const [ urls, refusal ] of [
            [ null,                                       `The 'urls' of ${NETWORK} must be a JSON array of URLs!` ],
            [ { a: 1 },                                   `The 'urls' of ${NETWORK} must be a JSON array of URLs!` ],
            [ ALPHA,                                      `The 'urls' of ${NETWORK} must be a JSON array of URLs!` ],
            [ [],                                         `The 'urls' of ${NETWORK} must name at least one URL, or be left out!` ],
            [ Array.from({ length: 17 }, (_, index) => `https://h${index}.example/RNs/QA`),
                                                          `The 'urls' of ${NETWORK} must name at most 16 URLs, not 17!` ],
            [ [ 1 ],                                      `The 'urls' of ${NETWORK} must name absolute URLs, not '1'!` ],
            [ [ null ],                                   `The 'urls' of ${NETWORK} must name absolute URLs, not ''!` ],
            [ [ '   ' ],                                  `The 'urls' of ${NETWORK} must name absolute URLs, not '   '!` ],
            [ [ 'https://alpha_example/RNs/QA' ],         `The 'urls' of ${NETWORK} must name absolute URLs, not 'https://alpha_example/RNs/QA'!` ],
            [ [ 'https://alpha.example:99999/RNs/QA' ],   `The 'urls' of ${NETWORK} must name absolute URLs, not 'https://alpha.example:99999/RNs/QA'!` ],
            [ [ ALPHA, ALPHA ],                           `The 'urls' of ${NETWORK} must not name a URL twice!` ],
            [ [ ALPHA, `${ALPHA} ` ],                     `The 'urls' of ${NETWORK} must not name a URL twice!` ],
            [ [ `https://${'a'.repeat(40)}.example/${'p'.repeat(449)}/RNs/QA` ],
                                                          `A URL of ${NETWORK} has 513 characters, more than 512!` ],
            [ [ 'http://alpha.example/RNs/QA' ],          `The URL 'http://alpha.example/RNs/QA' of ${NETWORK} is no https URL!` ],
            [ [ 'https://user@alpha.example/RNs/QA' ],    `The URL 'https://user@alpha.example/RNs/QA' of ${NETWORK} must not name user information!` ],
            [ [ 'https://alpha.example?x@y/RNs/QA' ],     `The URL 'https://alpha.example?x@y/RNs/QA' of ${NETWORK} must not name user information!` ],
            [ [ 'https://alpha.example/RNs/QA?x=1' ],     `The URL 'https://alpha.example/RNs/QA?x=1' of ${NETWORK} ${NOT_A_NETWORK}` ],
            [ [ 'https://alpha.example/RNs/QA#' ],        `The URL 'https://alpha.example/RNs/QA#' of ${NETWORK} ${NOT_A_NETWORK}` ],
            [ [ 'https://alpha.example/RNs/QA/' ],        `The URL 'https://alpha.example/RNs/QA/' of ${NETWORK} ${NOT_A_NETWORK}` ],
            [ [ 'https://alpha.example' ],                `The URL 'https://alpha.example' of ${NETWORK} ${NOT_A_NETWORK}` ],
            [ [ 'https://alpha.example/rns/QA' ],         `The URL 'https://alpha.example/rns/QA' of ${NETWORK} ${NOT_A_NETWORK}` ],
            [ [ 'https://alpha.example/RNs/%20' ],        `The URL 'https://alpha.example/RNs/%20' of ${NETWORK} ${NOT_A_NETWORK}` ],
            [ [ 'https://alpha.example/RNs/Other' ],      `The URL 'https://alpha.example/RNs/Other' of ${NETWORK} is one of the roaming network 'Other'!` ],
            [ [ 'https://alpha.example/RNs/Q%ZZ' ],       `The URL 'https://alpha.example/RNs/Q%ZZ' of ${NETWORK} is one of the roaming network 'Q%ZZ'!` ],
        ] as const)
            expect(withURLs(urls as JSONValue), JSON.stringify(urls).slice(0, 60)).toBe(refusal);

        // As Hermod reads a URL, which the content holds as Hermod writes it: trimmed, with its scheme.
        expect(withURLs([ 'alpha.example/RNs/QA' ])).toBe(`'urls[0]' is not written as the content holds it: the content holds it as '"${ALPHA}"'!`);
        expect(withURLs([ ` ${ALPHA} ` ])).toBe("'urls' is not written as the content holds it: the texts of its elements are trimmed!");

        // After what it reads of itself and its tree hash algorithms, before its operator.
        expect(version(json => { json['urls'] = [ 'http://alpha.example/RNs/QA' ]; json['name'] = 'x'; })).toBe("JSON property 'name' is not an object!");
        expect(version(json => { json['urls'] = [ 'http://alpha.example/RNs/QA' ]; json['treeHashAlgorithms'] = [ 'md5' ]; }))
            .toBe("Unknown tree hash algorithm 'md5': sha256, sha384 or sha512!");
        expect(version((json, occ) => { json['urls'] = [ 'http://alpha.example/RNs/QA' ]; occ['minConsensus'] = 9; }))
            .toBe(`The URL 'http://alpha.example/RNs/QA' of ${NETWORK} is no https URL!`);

    });

    it('are changed as a whole, by the roaming network operator, as WWCP_POI3 applies it', () => {

        expect(outcome([ network('urls', [ ALPHA ]) ],
                       [ 'f6f89ebe4f5e97b484df65992f70c6ddc62707c18c4a2ecd5a8d624d71cc0bfd', '18cfb4acd7753291c7eabf4ecdce2c156a2ca5cccc26859362259c0bff2fbf4b' ])).toBe('taken');
        expect(outcome([ { ...network('urls', [ ALPHA ]), oldValue: [ ...QA.urls ] } ],
                       [ 'f6f89ebe4f5e97b484df65992f70c6ddc62707c18c4a2ecd5a8d624d71cc0bfd', '18cfb4acd7753291c7eabf4ecdce2c156a2ca5cccc26859362259c0bff2fbf4b' ])).toBe('taken');
        expect(outcome([ network('urls', [ 'https://gamma.example/RNs/QA', ALPHA ]) ],
                       [ '3375fb8797ae31b44063407eb4835e95ee32dfd648626a0339b58c6f2fa76190', 'd43c8d84ad591aa89dc0396ecdbe19de0e18969d626cc8117c494fc2c848d43c' ])).toBe('taken');
        expect(outcome([ network('urls') ],
                       [ '6e131b4e369293324611eec14e03c01e40a7f0044df9f2d76dc0af3628a43caa', '7bc0b0f0a41522fceee82940a635c4281c260ae4e2f54bf0fff13ac6941394a1' ])).toBe('taken');

        // Owned by the roaming network operator: its signing keys, two of its three holders.
        expect(() => applyChangeSet(QA, changeSetOf(QA, [ network('urls', [ ALPHA ]) ])))
            .toThrow("Change 0: UpdateProperty of the RoamingNetwork 'QA' ('urls') needs signatures by signing keys of 2 holders of the roaming network operator 'OCC'!");

        expect(outcome([ network('urls'), network('urls') ])).toBe("Change 1: the property 'urls' does not exist!");
        expect(outcome([ { ...network('urls', [ ALPHA ]), oldValue: [ ALPHA ] } ]))
            .toBe(`Change 0: the property 'urls' is no longer the expected old value, but '${JSON.stringify(QA.urls)}'!`);

        for (const change of [ element('AddElement', 'https://delta.example/RNs/QA', { newValue: 'https://delta.example/RNs/QA' }), element('RemoveElement', ALPHA) ])
            expect(outcome([ change ])).toBe(`Change 0: the urls of ${NETWORK} are changed as a whole, not element by element!`);

        // Refused as they are read, in the words of the change.
        expect(outcome([ network('urls', []) ])).toBe(`Change 0: The 'urls' of ${NETWORK} must name at least one URL, or be left out!`);
        expect(outcome([ network('urls', ALPHA) ])).toBe(`Change 0: The 'urls' of ${NETWORK} must be a JSON array of URLs!`);
        expect(outcome([ network('urls', [ 'http://alpha.example/RNs/QA' ]) ])).toBe(`Change 0: The URL 'http://alpha.example/RNs/QA' of ${NETWORK} is no https URL!`);
        expect(outcome([ network('urls', [ 'https://alpha.example/RNs/Other' ]) ]))
            .toBe(`Change 0: The URL 'https://alpha.example/RNs/Other' of ${NETWORK} is one of the roaming network 'Other'!`);
        expect(outcome([ network('urls', [ ALPHA, ALPHA ]) ])).toBe(`Change 0: The 'urls' of ${NETWORK} must not name a URL twice!`);

        // What is signed is what is held: given as Hermod writes them.
        for (const url of [ 'alpha.example/RNs/QA', ` ${ALPHA} ` ])
            expect(outcome([ network('urls', [ url ]) ])).toBe(`Change 0: the property 'urls' of ${NETWORK} is not given as the content holds it, '["${ALPHA}"]'!`);

    });

});


describe('The quorum of a roaming network operator, of every version (4.1, Holders joining and leaving)', () => {

    it('is refused of a version whose keys it does not fit, as the operator is read', () => {

        const invalid = 'The given JSON representation of a roaming network operator is invalid: ';

        expect(version((_, occ) => { occ['minConsensus'] = 9; })).toBe(`${invalid}The minConsensus 9 of the roaming network operator 'OCC' needs signing keys of as many holders, not of 3!`);
        expect(version((_, occ) => { delete occ['minConsensus']; }))
            .toBe(`${invalid}The minConsensus 1 of the roaming network operator 'OCC' must be more than half of the 3 holders of its signing keys!`);
        expect(version((_, occ) => { occ['minConsensus'] = 2; }, 0)).toBe(`${invalid}The minConsensus 2 of the roaming network operator 'OCC' needs signing keys of as many holders, not of 1!`);
        expect(version((_, occ) => { occ['minConsensus'] = 0; }, 0)).toBe('The minConsensus of a roaming network operator must be a whole number from 1 to 255!');

        // A quorum of one is written as none.
        expect(version((_, occ) => { occ['minConsensus'] = 1; }, 0)).toBe("'operator.minConsensus' is not written as the content holds it: the content leaves it out!");

    });

    it('fits its keys after the last change of a change set, not in between: a holder joins, and leaves', () => {

        // BetaOrg joins AlphaOrg, as example A1 did it: the keys and the quorum in either order.
        const joined = [ '7aaeab1db008db580bfa09c8bbab3fecbd88d759ebb652a97e9c9488c3184196', 'a624297647f2ad5cfde0bd4d857c2c2802b094c1cc17765104bbb5ea30473368' ] as const;

        expect(outcome([ operator('minConsensus', 2), ...keysOf(1) ], joined, REVISION[0])).toBe('taken');
        expect(outcome([ ...keysOf(1), operator('minConsensus', 2) ], joined, REVISION[0])).toBe('taken');

        // GammaOrg joins the two: two of three decide, as before.
        expect(outcome(keysOf(2), [ '9f969cf364bea49315a26f8c5b8f5cb7df3b19f2458815fe64fa59648da3741c', 'a70f9497da3f0dbf0535597fe7083fafb5954c6a2673a44a0cf7c16535fdec89' ], REVISION[1])).toBe('taken');

        // GammaOrg leaves again, then BetaOrg: the quorum of one is removed, not given as 1.
        expect(outcome(keysOf(1), [ '92735aab1b67125e5b3c2b247dbe8fab8b16b0f62444ccb2e9131fd581416782', '462cdf5901d0d274b23a8f87e925b797d80fdb7f263c61446607807a252b5c08' ])).toBe('taken');
        expect(outcome([ ...keysOf(0), operator('minConsensus') ],
                       [ 'a52874a1e8bfdbf727f5d6ac2207bc6f37663b0ecbe60733c904ecdb57e1ab71', '7fa531332d846519a5d5f298f4b2b193d1924ef336fce60b4966a86e91e14103' ])).toBe('taken');

    });

    it('is refused of the version after the change set in the words of the quorum alone, of no change', () => {

        const occ = "the roaming network operator 'OCC'";

        // The keys without the quorum, the quorum without the keys.
        expect(outcome(keysOf(1), undefined, REVISION[0])).toBe(`The minConsensus 1 of ${occ} must be more than half of the 2 holders of its signing keys!`);
        expect(outcome([ operator('identityKeys', (get((REVISION[1] as RoamingNetwork).content, 'operator') as JSONObject)['identityKeys'] as JSONValue) ], undefined, REVISION[0]))
            .toBe(`The minConsensus 1 of ${occ} must be more than half of the 2 holders of its identity keys!`);
        expect(outcome([ operator('minConsensus', 2) ], undefined, REVISION[0])).toBe(`The minConsensus 2 of ${occ} needs signing keys of as many holders, not of 1!`);
        expect(outcome(keysOf(0))).toBe(`The minConsensus 2 of ${occ} needs signing keys of as many holders, not of 1!`);

        expect(outcome([ operator('minConsensus', 9) ])).toBe(`The minConsensus 9 of ${occ} needs signing keys of as many holders, not of 3!`);
        expect(outcome([ operator('minConsensus') ])).toBe(`The minConsensus 1 of ${occ} must be more than half of the 3 holders of its signing keys!`);
        expect(outcome([ operator('minConsensus') ], undefined, REVISION[1])).toBe(`The minConsensus 1 of ${occ} must be more than half of the 2 holders of its signing keys!`);

        // Before what the roaming network refuses of its key statement.
        expect(outcome([ operator('minConsensus', 3) ])).toBe(`The key statement of ${occ} states the minConsensus 2, not its 3!`);
        expect(outcome([ ...keysOf(2), operator('minConsensus', 3) ], undefined, REVISION[1])).toBe(`The key statement of ${occ} states the minConsensus 2, not its 3!`);

        // What a change gives is read at once, and a quorum of one is no value the content holds.
        expect(outcome([ operator('minConsensus', 0) ])).toBe('Change 0: The minConsensus of a roaming network operator must be a whole number from 1 to 255!');
        for (const before of [ QA, REVISION[0] ])
            expect(outcome([ operator('minConsensus', 1) ], undefined, before)).toBe(`Change 0: the property 'minConsensus' of ${occ} is given as '1', which the content does not hold at all!`);

    });

});
