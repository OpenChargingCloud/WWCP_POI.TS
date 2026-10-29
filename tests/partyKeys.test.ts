import { describe, expect, it } from 'vitest';

import { defined, readJSON } from './helpers.ts';

import { clone, without, type JSONArray, type JSONObject } from '../src/json/value.ts';
import { POIPublicKey, PUBLIC_KEY_CONTEXT } from '../src/keys.ts';
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

    it('reads the parties in the order of WWCP_POI3, the charging station operators last, and refuses keys out of their order', () => {

        // The conformity assessment body first, though the charging station operator comes first in the content.
        expect(refusal(qa(n => {
            key(party(n, 'conformityAssessmentBodies', 'EM-LAB'), 'signingKeys')['usages'] = [ 'zzz' ];
            key(gef(n), 'signingKeys')['usages'] = [ 'yyy' ];
        }))).toMatch(/^Invalid signing key '\{"@id":"b6148aa7/u);

        // WWCP_POI3 takes them and writes them in the order of their identifications; refused as the content holds them so.
        expect(refusal(qa(n => { keys(gef(n), 'signingKeys').reverse(); (gef(n)['identityKeys'] as JSONArray).reverse(); })))
            .toBe("'chargingStationOperators[0].signingKeys' is not written as the content holds it: its elements are in the order the content holds them in!");
        expect(refusal(qa(n => { (gef(n)['identityKeys'] as JSONArray).reverse(); })))
            .toBe("'chargingStationOperators[0].identityKeys' is not written as the content holds it: its elements are in the order the content holds them in!");

        // Also a property of a key WWCP_POI3 does not read, which it leaves out.
        expect(refusal(qa(n => { key(gef(n), 'signingKeys')['x'] = 1; })))
            .toMatch(/^Invalid signing key '\{"@id":"1cf5b42e.*\}': The public key '1cf5b42ec174e163cd2ca721d0f5357e162d61caf5f869f776f64b2919b33811' must not name the property 'x'!$/u);
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


describe('A key, in the words and order of POIPublicKey.TryParse of WWCP_POI3', () => {

    const GEF_KEY  = '1cf5b42ec174e163cd2ca721d0f5357e162d61caf5f869f776f64b2919b33811';

    /** The first signing key of DE*GEF (ML-DSA), or of the manufacturer GraphDefined (EC2), changed by `change`. */
    const keyOf = (change: (key: JSONObject) => void, manufacturer = false): JSONObject => {
        const network = without(readJSON('published/QA.json') as JSONObject, 'eTags');
        const given   = clone(key(manufacturer ? party(network, 'chargingStationManufacturers', 'GraphDefined') : gef(network), 'signingKeys'));
        change(given);
        return given;
    };

    const refused = (json: JSONObject): string => {
        try {
            POIPublicKey.parse(json);
        }
        catch (e) {
            return e instanceof Error ? e.message : String(e);
        }
        return 'taken';
    };

    const bytesOf = (text: string): number[] => [ ...Buffer.from(text, 'base64') ];
    const base64  = (bytes: number[]): string => Buffer.from(bytes).toString('base64');

    it('reads its identification and its key, then its context', () => {

        expect(refused(keyOf(json => { json['@id'] = 5; }))).toBe('The public key identification must be a text!');
        expect(refused(keyOf(json => { json['@id'] = null; }))).toBe('The public key identification must be a text!');
        expect(refused(keyOf(json => { json['key'] = 5; json['@context'] = 'https://example.org/key'; }))).toBe('The public key must be a text!');
        expect(refused(keyOf(json => { delete json['@id']; }))).toBe('A public key needs its identification and its key!');
        expect(refused(keyOf(json => { delete json['key']; }))).toBe('A public key needs its identification and its key!');

        expect(refused(keyOf(json => { json['@context'] = 'https://example.org/key'; })))
            .toBe(`The JSON-LD context of the public key '${GEF_KEY}' must be '${PUBLIC_KEY_CONTEXT}'!`);
        expect(refused(keyOf(json => { json['@context'] = 'https://example.org/key'; delete json['@id']; })))
            .toBe(`The JSON-LD context of the public key '' must be '${PUBLIC_KEY_CONTEXT}'!`);
        expect(refused(keyOf(json => { json['@context'] = PUBLIC_KEY_CONTEXT; }))).toBe('taken');

    });

    it('reads its key as .NET reads Base64, and refuses it unless canonical', () => {

        const BAD = 'Invalid public key: The input is not a valid Base-64 string as it contains a non-base 64 character, more than two padding characters, or an illegal character among the padding characters.';

        for (const text of [ '!!!!', 'AAA', 'AAAAA', 'A===', 'AA==AAAA' ])
            expect(refused(keyOf(json => { json['key'] = text; }))).toBe(BAD);
        expect(refused(keyOf(json => { json['key'] = (json['key'] as string).replace(/\+/gu, '-').replace(/\//gu, '_'); }))).toBe(BAD);

        // .NET reads these, but writes them otherwise.
        expect(refused(keyOf(json => { json['key'] = 'AB=='; }))).toBe('A public key must be given as canonical Base64!');
        expect(refused(keyOf(json => { json['key'] = `${json['key'] as string}\n`; }))).toBe('A public key must be given as canonical Base64!');
        expect(refused(keyOf(json => { const text = json['key'] as string; json['key'] = `${text.slice(0, 8)} ${text.slice(8)}`; })))
            .toBe('A public key must be given as canonical Base64!');

    });

    it('refuses a COSE key it can not read, or one with private parts', () => {

        expect(refused(keyOf(json => { json['key'] = base64([ 0xA0 ]); }))).toBe('Invalid COSE key: A COSE key must have a key type!');

        // Another CBOR of the same key, its label 1 in two bytes: written again, another text than the one hashed.
        expect(refused(keyOf(json => { json['key'] = base64([ 0xA4, 0x18, 0x01, ...bytesOf(json['key'] as string).slice(2) ]); }, true)))
            .toBe("Invalid COSE key: Invalid deterministic CBOR: the key of the public key 'cf625038413602ec823b9fe229c115369bcad98370c23bccb04d5d3bb4612573' is not written as the deterministic CBOR of its COSE key!");

        // EC2 with d: a private key, whatever its identification.
        const withPrivatePart = (json: JSONObject): void => {
            json['key'] = base64([ 0xA5, ...bytesOf(json['key'] as string).slice(1), 0x23, 0x58, 0x20, ...Array<number>(32).fill(7) ]);
        };
        expect(refused(keyOf(withPrivatePart, true))).toBe('A public key must not contain private parts!');
        expect(refused(keyOf(json => { withPrivatePart(json); json['@id'] = '0'.repeat(64); }, true))).toBe('A public key must not contain private parts!');

    });

    it('refuses a key expiring before it becomes valid after its holder and usages, before its thumbprint', () => {

        const EXPIRING = 'Invalid public key: A public key must not expire before it becomes valid!';
        const early    = (json: JSONObject): void => { json['notBefore'] = '2028-01-01T00:00:00.000Z'; };

        expect(refused(keyOf(early))).toBe(EXPIRING);
        expect(refused(keyOf(json => { early(json); json['@id'] = '0'.repeat(64); }))).toBe(EXPIRING);
        expect(refused(keyOf(json => { early(json); json['usages'] = [ 'zzz' ]; }))).toMatch(/^The usage 'zzz' of the public key /u);
        expect(refused(keyOf(json => { early(json); json['holder'] = ' x'; })))
            .toBe(`The holder of the public key '${GEF_KEY}' must be a nonempty text without leading or trailing white space!`);
        expect(refused(keyOf(json => { json['notBefore'] = json['notAfter'] ?? null; }))).toBe('taken');

        expect(refused(keyOf(json => { json['holder'] = 5; }))).toBe('The holder of a public key must be a text!');
        expect(refused(keyOf(json => { json['holder'] = null; }))).toBe('The holder of a public key must be a text!');

    });

});
