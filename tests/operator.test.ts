import { describe, expect, it } from 'vitest';

import { defined, readJSON } from './helpers.ts';

import { unset, without, type JSONArray, type JSONObject } from '../src/json/value.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';


// The roaming network and its operator, its key statement and the certificates of its signing keys, read as WWCP_POI3 at
// 8108522 reads them, in its words and order: QA of the frozen run, its eTags left out, changed as the probe of WWCP_POI3
// changed it, every refusal here the one WWCP_POI3 gives the same content.

function qa(change: (network: JSONObject, operator: JSONObject, statement: JSONObject, certificate: JSONObject) => void): JSONObject {
    const json      = without(readJSON('published/QA.json') as JSONObject, 'eTags');
    const operator  = json['operator'] as JSONObject;
    change(json, operator, operator['keyStatement'] as JSONObject, defined((operator['signingKeyCertificates'] as JSONArray)[0]) as JSONObject);
    return json;
}

const refusal = (json: JSONObject): string => {
    try {
        RoamingNetwork.parse(json);
    }
    catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
    return 'taken';
};


describe('The roaming network and its operator, in the words of WWCP_POI3', () => {

    it('names the tree hash algorithms of the roaming network as POITreeHashAlgorithms reads them', () => {

        expect(refusal(qa(network => { network['treeHashAlgorithms'] = 'sha256'; }))).toBe("The 'treeHashAlgorithms' must be a JSON array of hash algorithms!");
        expect(refusal(qa(network => { network['treeHashAlgorithms'] = [ 'sha256', 'md5' ]; }))).toBe("Unknown tree hash algorithm 'md5': sha256, sha384 or sha512!");
        expect(refusal(qa(network => { network['treeHashAlgorithms'] = [ 'SHA256' ]; }))).toBe("Unknown tree hash algorithm 'SHA256': sha256, sha384 or sha512!");
        expect(refusal(qa(network => { network['treeHashAlgorithms'] = [ 5 ]; }))).toBe("Unknown tree hash algorithm '5': sha256, sha384 or sha512!");
        expect(refusal(qa(network => { network['treeHashAlgorithms'] = []; }))).toBe("The 'treeHashAlgorithms' must name at least one hash algorithm!");
        expect(refusal(qa(network => { network['treeHashAlgorithms'] = [ 'sha256', 'sha256' ]; }))).toBe("The 'treeHashAlgorithms' must not name a hash algorithm twice!");

        // In any order.
        expect(refusal(qa(network => { network['treeHashAlgorithms'] = [ 'sha512', 'sha256' ]; }))).toBe('taken');

    });

    it('refuses a roaming network or an operator without its identification as Styx refuses it', () => {

        expect(refusal(qa(network => { delete network['@id']; }))).toBe("Missing JSON property '@id'!");
        expect(refusal(qa((_, operator) => { delete operator['@id']; }))).toBe("Missing JSON property '@id'!");

    });

    it('names its quorum as the operator reads it, and what its constructor refuses as an argument of it', () => {

        for (const minConsensus of [ 0, 256, '1' ])
            expect(refusal(qa((_, operator) => { operator['minConsensus'] = minConsensus; })))
                .toBe('The minConsensus of a roaming network operator must be a whole number from 1 to 255!');

        // Three holders of identity keys and of signing keys: no quorum of four, none of one.
        expect(refusal(qa((_, operator) => { operator['minConsensus'] = 4; })))
            .toBe("The given JSON representation of a roaming network operator is invalid: The minConsensus 4 of the roaming network operator 'OCC' needs signing keys of as many holders, not of 3!");
        expect(refusal(qa((_, operator) => { delete operator['minConsensus']; })))
            .toBe("The given JSON representation of a roaming network operator is invalid: The minConsensus 1 of the roaming network operator 'OCC' must be more than half of the 3 holders of its signing keys!");
        expect(refusal(qa((_, operator) => { delete operator['signingKeyCertificates']; })))
            .toBe("The given JSON representation of a roaming network operator is invalid: The minConsensus 2 of the roaming network operator 'OCC' needs signing keys of as many holders!");

        // A certificate by the same identity key twice.
        expect(refusal(qa((_, operator, __, certificate) => { (operator['signingKeyCertificates'] as JSONArray).push(certificate); })))
            .toBe("The given JSON representation of a roaming network operator is invalid: An certificate of a signing key of the roaming network operator 'OCC' must not be given twice!");

        expect(refusal(qa((_, operator) => { operator['keyStatement'] = 'statement'; }))).toBe('The key statement must be a JSON object!');

    });

    it('reads its key statement as RoamingNetworkKeyStatement.TryParse reads it', () => {

        expect(refusal(qa((_, __, statement) => { delete statement['roamingNetworkId']; }))).toBe("Missing JSON property 'roamingNetworkId'!");
        expect(refusal(qa((_, __, statement) => { delete statement['roamingNetworkOperatorId']; }))).toBe("Missing JSON property 'roamingNetworkOperatorId'!");
        expect(refusal(qa((_, __, statement) => { statement['identityKeys'] = 'keys'; }))).toBe('The identityKeys of a key statement must be a JSON array!');
        expect(refusal(qa((_, __, statement) => { delete defined((statement['identityKeys'] as JSONArray)[0] as JSONObject)['key']; })))
            .toBe('Invalid key in the identityKeys of a key statement!');

        for (const property of [ 'signedAt', 'validUntil' ]) {
            expect(refusal(qa((_, __, statement) => { unset(statement, property); })))
                .toBe('The signedAt and validUntil of a key statement must be written as yyyy-MM-ddTHH:mm:ss.fffZ!');
            expect(refusal(qa((_, __, statement) => { statement[property] = 5; })))
                .toBe('The signedAt and validUntil of a key statement must be written as yyyy-MM-ddTHH:mm:ss.fffZ!');
        }

        expect(refusal(qa((_, __, statement) => { delete statement['minConsensus']; }))).toBe('A key statement requires its minConsensus, a whole number from 1 to 255!');
        expect(refusal(qa((_, __, statement) => { statement['minConsensus'] = 'x'; }))).toBe('A key statement requires its minConsensus, a whole number from 1 to 255!');
        expect(refusal(qa((_, __, statement) => { delete statement['signatures']; }))).toBe('A key statement requires its signatures!');
        expect(refusal(qa((_, __, statement) => { statement['signatures'] = 'x'; }))).toBe('A key statement requires its signatures!');

        for (const property of [ 'algorithm', 'keyId', 'value' ])
            expect(refusal(qa((_, __, statement) => { unset(defined((statement['signatures'] as JSONArray)[0] as JSONObject), property); })))
                .toBe('Every signature of a key statement requires an algorithm, a key identification and a value!');

    });

    it('reads the certificates of its signing keys as RoamingNetworkSigningKeyCertificate.TryParse reads them', () => {

        expect(refusal(qa((_, __, ___, certificate) => { delete certificate['roamingNetworkOperatorId']; }))).toBe("Missing JSON property 'roamingNetworkOperatorId'!");

        for (const change of [ (certificate: JSONObject): void => { delete certificate['signingKey']; },
                               (certificate: JSONObject): void => { certificate['signingKey'] = 'key'; },
                               (certificate: JSONObject): void => { delete (certificate['signingKey'] as JSONObject)['key']; } ])
            expect(refusal(qa((_, __, ___, certificate) => { change(certificate); }))).toBe('A signing key certificate requires the signingKey it certifies!');

        expect(refusal(qa((_, __, ___, certificate) => { delete certificate['signedAt']; })))
            .toBe('The signedAt of a signing key certificate must be written as yyyy-MM-ddTHH:mm:ss.fffZ!');

        for (const property of [ 'algorithm', 'keyId', 'value' ])
            expect(refusal(qa((_, __, ___, certificate) => { unset(certificate, property); })))
                .toBe('A signing key certificate requires the algorithm, the key identification and the value of its signature!');

        // The holders of keys as WWCP_POI3 names them.
        expect(refusal(qa((_, operator) => { delete defined((operator['identityKeys'] as JSONArray)[0] as JSONObject)['holder']; })))
            .toMatch(/^The given JSON representation of a roaming network is invalid: The roaming network operator 'OCC': The signing key '[0-9a-f]{64}' of the holder 'BetaOrg' is certified by the identity key '[0-9a-f]{64}' of no named holder: each holder certifies its own signing keys only! \(Parameter 'Operator'\)$/u);

    });

});
