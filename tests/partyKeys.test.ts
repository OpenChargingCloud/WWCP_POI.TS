import { describe, expect, it } from 'vitest';

import { defined, readJSON } from './helpers.ts';

import { clone, without, type JSONArray, type JSONObject } from '../src/json/value.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';


// The keys of the parties of a roaming network and of its operator (D12 of WWCPPOIConformanceTests): read where the roaming
// network is read, as WWCP_POI3 reads them wherever it reads a party (POIPartyKeys.TryParse and Check), in its words. QA of
// the frozen run, its eTags left out; every refusal here is the one WWCP_POI3 at ec3dace gives for the same content.

/** QA without its eTags, changed by `change`. */
function qa(change: (network: JSONObject) => void): JSONObject {
    const json = without(readJSON('published/QA.json') as JSONObject, 'eTags');
    change(json);
    return json;
}

const party = (network: JSONObject, property: string, id: string): JSONObject =>
    defined((network[property] as JSONObject[]).find(item => item['@id'] === id));

const gef   = (network: JSONObject): JSONObject => party(network, 'chargingStationOperators', 'DE*GEF');
const keys  = (owner: JSONObject, property: 'signingKeys' | 'identityKeys'): JSONObject[] => owner[property] as JSONObject[];
const key   = (owner: JSONObject, property: 'signingKeys' | 'identityKeys', index = 0): JSONObject => defined(keys(owner, property)[index]);

const refusal = (json: JSONObject): string => {
    try {
        RoamingNetwork.parse(json);
    }
    catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
    return 'taken';
};

const UNKNOWN = 'is unknown: it is one of certificates, infrastructure, models, party, payments, priceStatements, software, tariffs!';


describe('The keys of the parties of a roaming network, read with it (D12)', () => {

    it('refuses a key WWCP_POI3 does not read, naming the key as it was given', () => {

        const network = qa(n => { key(gef(n), 'signingKeys')['usages'] = [ 'priceStatements', 'tariffs', 'zzz' ]; });
        const given   = JSON.stringify(key(gef(network), 'signingKeys'));

        expect(refusal(network)).toBe(`Invalid signing key '${given}': The usage 'zzz' of the public key '1cf5b42ec174e163cd2ca721d0f5357e162d61caf5f869f776f64b2919b33811' ${UNKNOWN}`);

        expect(refusal(qa(n => { key(gef(n), 'identityKeys')['usages'] = [ 'zzz' ]; })))
            .toMatch(/^Invalid identity key '\{"@id":"345d0745.*\}': The usage 'zzz' of the public key '345d0745d467d50f97d20376068f1bafb1f36166eb5ca9c0409b484a43b89550' is unknown/u);
        expect(refusal(qa(n => { key(gef(n), 'signingKeys')['usages'] = [ 'tariffs', 'priceStatements' ]; })))
            .toMatch(/': The usages of the public key '1cf5b42ec174e163cd2ca721d0f5357e162d61caf5f869f776f64b2919b33811' are written in their ordinal order!$/u);
        expect(refusal(qa(n => { gef(n)['signingKeys'] = {}; }))).toBe('The signing key must be a JSON array!');
        expect(refusal(qa(n => { gef(n)['identityKeys'] = 'x'; }))).toBe('The identity key must be a JSON array!');
        expect(refusal(qa(n => { gef(n)['signingKeys'] = [ 'x' ]; }))).toBe(`Invalid signing key '"x"'!`);
        expect(refusal(qa(n => { gef(n)['signingKeys'] = [ null ]; }))).toBe(`Invalid signing key 'null'!`);

        // Every party, the keys of a manufacturer as well.
        expect(refusal(qa(n => { key(party(n, 'chargingStationManufacturers', 'GraphDefined'), 'signingKeys')['usages'] = [ 'zzz' ]; })))
            .toMatch(/^Invalid signing key '\{"@id":"cf625038.*\}': The usage 'zzz' of the public key 'cf625038413602ec823b9fe229c115369bcad98370c23bccb04d5d3bb4612573' is unknown/u);

    });

    it('refuses a key given twice, a key both a signing and an identity key, an identity key naming usages', () => {

        const invalid = (kind: string, message: string): string => `The given JSON representation of ${kind} is invalid: ${message}`;

        expect(refusal(qa(n => { keys(gef(n), 'signingKeys').push(clone(key(gef(n), 'signingKeys'))); })))
            .toBe(invalid('a charging station operator', "An signing key of the charging station operator 'DE*GEF' must not be given twice!"));
        expect(refusal(qa(n => { keys(gef(n), 'identityKeys').push(clone(key(gef(n), 'identityKeys'))); })))
            .toBe(invalid('a charging station operator', "An identity key of the charging station operator 'DE*GEF' must not be given twice!"));

        // Twice by its identification, also in another form.
        expect(refusal(qa(n => { const other = clone(key(gef(n), 'signingKeys')); other['usages'] = [ 'tariffs' ]; keys(gef(n), 'signingKeys').push(other); })))
            .toBe(invalid('a charging station operator', "An signing key of the charging station operator 'DE*GEF' must not be given twice!"));

        expect(refusal(qa(n => { keys(gef(n), 'signingKeys').push(clone(key(gef(n), 'identityKeys'))); })))
            .toBe(invalid('a charging station operator', "The key '345d0745d467d50f97d20376068f1bafb1f36166eb5ca9c0409b484a43b89550' of the charging station operator 'DE*GEF' must not be both a signing and an identity key!"));
        expect(refusal(qa(n => { key(gef(n), 'identityKeys')['usages'] = [ 'party' ]; })))
            .toBe(invalid('a charging station operator', "The identity key '345d0745d467d50f97d20376068f1bafb1f36166eb5ca9c0409b484a43b89550' of the charging station operator 'DE*GEF' names no usages: they are of signing keys!"));

        expect(refusal(qa(n => { const body = party(n, 'conformityAssessmentBodies', 'EM-LAB'); keys(body, 'signingKeys').push(clone(key(body, 'signingKeys'))); })))
            .toBe(invalid('a conformity assessment body', "An signing key of the conformity assessment body 'EM-LAB' must not be given twice!"));
        expect(refusal(qa(n => { const meters = party(n, 'energyMeterManufacturers', 'KERNBERG'); keys(meters, 'identityKeys').push(clone(key(meters, 'identityKeys'))); })))
            .toBe(invalid('an energy meter manufacturer', "An identity key of the energy meter manufacturer 'KERNBERG' must not be given twice!"));
        expect(refusal(qa(n => { key(party(n, 'transparencySoftwareManufacturers', 'GraphDefined'), 'identityKeys')['usages'] = [ 'software' ]; })))
            .toBe(invalid('a transparency software manufacturer', "The identity key '211975b1bce8a7ae40d7ebaf51849e14667b5e75e79b64f5aadbdb8a779912cf' of the transparency software manufacturer 'GraphDefined' names no usages: they are of signing keys!"));

    });

    it('reads the parties in the order of WWCP_POI3, the charging station operators last, and takes keys in any order', () => {

        // The conformity assessment body first, though the charging station operator comes first in the content.
        expect(refusal(qa(n => {
            key(party(n, 'conformityAssessmentBodies', 'EM-LAB'), 'signingKeys')['usages'] = [ 'zzz' ];
            key(gef(n), 'signingKeys')['usages'] = [ 'yyy' ];
        }))).toMatch(/^Invalid signing key '\{"@id":"b6148aa7/u);

        // WWCP_POI3 writes them in the order of their identifications; taken as given here.
        expect(refusal(qa(n => { keys(gef(n), 'signingKeys').reverse(); (gef(n)['identityKeys'] as JSONArray).reverse(); }))).toBe('taken');
        expect(refusal(qa(n => { key(gef(n), 'signingKeys')['usages'] = [ 'payments', 'priceStatements', 'tariffs' ]; }))).toBe('taken');

    });

    it('reads the identity keys of the roaming network operator in the same words', () => {

        const operator = (network: JSONObject): JSONObject => network['operator'] as JSONObject;

        expect(refusal(qa(n => { keys(operator(n), 'identityKeys').push(clone(key(operator(n), 'identityKeys'))); })))
            .toBe("The given JSON representation of a roaming network operator is invalid: An identity key of the roaming network operator 'OCC' must not be given twice!");
        expect(refusal(qa(n => { key(operator(n), 'identityKeys')['usages'] = [ 'party' ]; })))
            .toBe("The given JSON representation of a roaming network operator is invalid: The identity key '2444d1550fb2aeebcbdb538a81264f4a721a5d8ab35a8a6af58d33564d96dcf6' of the roaming network operator 'OCC' names no usages: they are of signing keys!");
        expect(refusal(qa(n => { key(operator(n), 'identityKeys')['usages'] = [ 'zzz' ]; })))
            .toMatch(/^Invalid identity key '\{"@id":"2444d155.*\}': The usage 'zzz' of the public key '2444d1550fb2aeebcbdb538a81264f4a721a5d8ab35a8a6af58d33564d96dcf6' is unknown/u);

    });

});
