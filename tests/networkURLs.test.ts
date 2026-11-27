import { describe, expect, it } from 'vitest';

import { readJSON } from './helpers.ts';

import { applyChangeSet } from '../src/history/apply.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification } from '../src/history/changeSet.ts';
import { etagToJSON } from '../src/etags.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';
import { clone, get, without, type JSONObject, type JSONValue } from '../src/json/value.ts';


// The URLs of the copies of a roaming network, `urls` (SPECIFICATION.md section 2), and the quorum of its operator, which
// fits its keys in every version, not between the changes of one change set (4.1, "Holders joining and leaving"): as
// WWCP_POI3 at c94c762 reads and changes them, in its words. Every verdict below is the one WWCP_POI3 gave for the same
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
                       [ '8b22e756133e9c08f8dd12f86cd42328b824d07c3920f0a2967fb1e9cb263f36', '2e93ebea4c3dc7cc8f6ff21301c36b5a9baef217a639d4d2305dfd9ee9830308' ])).toBe('taken');
        expect(outcome([ { ...network('urls', [ ALPHA ]), oldValue: [ ...QA.urls ] } ],
                       [ '8b22e756133e9c08f8dd12f86cd42328b824d07c3920f0a2967fb1e9cb263f36', '2e93ebea4c3dc7cc8f6ff21301c36b5a9baef217a639d4d2305dfd9ee9830308' ])).toBe('taken');
        expect(outcome([ network('urls', [ 'https://gamma.example/RNs/QA', ALPHA ]) ],
                       [ '46c63ddf746b1de8ba50f20cbd2427d0f90334b8437bf13f7eab3a2e59a6bf63', '10812258f1793999b7f760124e95397226efb1d124dd80a1ce5ab0eb40d69292' ])).toBe('taken');
        expect(outcome([ network('urls') ],
                       [ '601b0a310b83ed7ebcfc2728aec2fbc28e893fa0f8a6371c1c82b8f19fd4a0a0', '34dd1e41c558a72f5f64b3fdfe5cf01c4541d5e1fc3c23339da75da3dfeaf0f1' ])).toBe('taken');

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
        const joined = [ '71e70fd1065bdb59136038d744a2b0d2c92090fa2cbc76967d1267e1b1f1f4d9', 'cfe79ff450b384ff017c0247a47ebd6c5469cb2393e20d554be2e0f32677f7e4' ] as const;

        expect(outcome([ operator('minConsensus', 2), ...keysOf(1) ], joined, REVISION[0])).toBe('taken');
        expect(outcome([ ...keysOf(1), operator('minConsensus', 2) ], joined, REVISION[0])).toBe('taken');

        // GammaOrg joins the two: two of three decide, as before.
        expect(outcome(keysOf(2), [ 'dfa382cb0547010d5f815fdae6a7d7bb319e88d0a568ac4a49a1ad26d86ab22c', '1202c39b5dd82a651d8bab9fa611f772a9d9e351ea7f73ffee3caa49c0445437' ], REVISION[1])).toBe('taken');

        // GammaOrg leaves again, then BetaOrg: the quorum of one is removed, not given as 1.
        expect(outcome(keysOf(1), [ '4c807b07b5d04d1c12f679722f88ed265d74d4b7fc77e6a47e10f1ec3c14f91a', 'cb94f2abec0bba46248a00daf5b6b708bb1fd0deea93b31c4db662a5bd04dbcf' ])).toBe('taken');
        expect(outcome([ ...keysOf(0), operator('minConsensus') ],
                       [ '579525240c17c367508a16af5f1bc3d7f0cbba70a969ee0d467145da9c28453d', '449a67aab7f72ca9e9c28b7e5103259a9c580b2d9e39b30b20066fdca91dbdc4' ])).toBe('taken');

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
