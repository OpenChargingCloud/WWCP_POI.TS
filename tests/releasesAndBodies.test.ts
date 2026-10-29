import { createPrivateKey, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { AT, defined, readJSON } from './helpers.ts';
import { specification } from './conformance.ts';

import { applyChangeSet, checkOwnership } from '../src/history/apply.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification, type ChangeSetSignature } from '../src/history/changeSet.ts';
import { etagToJSON } from '../src/etags.ts';
import { clone, without, type JSONObject } from '../src/json/value.ts';
import { RoamingNetwork, ROAMING_NETWORK_CONTEXT } from '../src/network/roamingNetwork.ts';
import { SigningKeyCertificate } from '../src/proofs/signingKeyCertificate.ts';


// S31 and S32 of WWCP_POI d6b0127 (SPECIFICATION.md 4.1, "What a certificate rests on"; TransparencyTests
// A_release_keeps_its_version and The_roaming_network_operator_says_what_a_body_is_notified_for): a release keeps its
// version, a new version is a new release; the roaming network operator says what a conformity assessment body is
// notified for and its number as a notified body, also once the body has keys; a number names one body.


describe('A release keeps its version (S31)', () => {

    // QA without its eTags; GraphDefined, the transparency software manufacturer, has the release chargy-1.5.0.
    const qa      = (): JSONObject => without(readJSON('published/QA.json') as JSONObject, 'eTags');
    const before  = RoamingNetwork.parse(qa());

    const manufacturerOf = (network: JSONObject): JSONObject =>
        defined((network['transparencySoftwareManufacturers'] as JSONObject[]).find(manufacturer => manufacturer['@id'] === 'GraphDefined'));
    const releaseOf      = (network: JSONObject): JSONObject =>
        defined((manufacturerOf(network)['transparencySoftware'] as JSONObject[]).find(release => release['@id'] === 'chargy-1.5.0'));

    /** A change set of the given changes, unsigned, leading to the given content. */
    const changeSetOf = (changes: JSONObject[], after: JSONObject = qa()): ChangeSet => {
        const json: JSONObject = {
            '@context':        CHANGE_SET_CONTEXT,
            roamingNetworkId:  'QA',
            createdAt:         AT,
            changes,
            beforeETags:       before.changeSetETags().map(eTag => etagToJSON(eTag)),
            afterETags:        RoamingNetwork.parse(after).changeSetETags().map(eTag => etagToJSON(eTag)),
        };
        json['@id'] = changeSetIdentification(json);
        return ChangeSet.parse(json);
    };

    const apply = (changes: JSONObject[], after?: JSONObject): RoamingNetwork =>
        applyChangeSet(before, changeSetOf(changes, after), { checkOwnership: false });

    const remove  = { kind: 'Remove', entityType: 'TransparencySoftware', entityId: 'chargy-1.5.0', oldValue: releaseOf(qa()) };
    const addOf   = (release: JSONObject): JSONObject =>
        ({ kind: 'Add', entityType: 'TransparencySoftware', entityId: 'chargy-1.5.0', newValue: release,
           parentEntityType: 'TransparencySoftwareManufacturer', parentEntityId: 'GraphDefined' });

    /** QA after a change of the release at AT: the manufacturer and the network changed with it. */
    const changed = (change: (release: JSONObject) => void): JSONObject => {
        const after = qa();
        change(releaseOf(after));
        manufacturerOf(after)['lastChange'] = AT;
        after['lastChange'] = AT;
        return after;
    };

    it('refuses a change set updating or removing it', () => {

        expect(() => apply([ { kind: 'UpdateProperty', entityType: 'TransparencySoftware', entityId: 'chargy-1.5.0', propertyName: 'version', newValue: '1.6.0' } ]))
            .toThrow("Change 0: the version of the transparency software release 'chargy-1.5.0' can not be changed: a new version is a new release!");
        expect(() => apply([ { kind: 'RemoveProperty', entityType: 'TransparencySoftware', entityId: 'chargy-1.5.0', propertyName: 'version', oldValue: '1.5.0' } ]))
            .toThrow("Change 0: the version of the transparency software release 'chargy-1.5.0' can not be changed: a new version is a new release!");

    });

    it('refuses one removing it and adding it again with another version, but not with its version', () => {

        const otherVersion = { ...releaseOf(qa()), version: '1.6.0' };

        expect(() => apply([ remove, addOf(otherVersion) ], changed(release => { release['version'] = '1.6.0'; })))
            .toThrow("The version of the transparency software release 'chargy-1.5.0' can not be changed from '1.5.0' to '1.6.0': a new version is a new release!");

        // Removed and added again with its version, it may change otherwise; its other properties change as before.
        const renamed = changed(release => { release['name'] = { en: 'Chargy Desktop' }; });

        expect(apply([ remove, addOf(clone(releaseOf(renamed))) ], renamed).content).toEqual(RoamingNetwork.parse(renamed).content);

        const supported = changed(release => { release['supportUntil'] = '2027-12-31T23:59:59.000Z'; });

        expect(apply([ { kind: 'UpdateProperty', entityType: 'TransparencySoftware', entityId: 'chargy-1.5.0', propertyName: 'supportUntil',
                         newValue: '2027-12-31T23:59:59.000Z' } ], supported).content).toEqual(RoamingNetwork.parse(supported).content);

    });

});


describe('The roaming network operator says what a body is notified for (S32)', () => {

    // Signed with the Ed25519 keys of section 6, whose private seeds the specification gives: the identity key of DE*RNO
    // certifies its signing key for `party`; PTB, a body with keys of its own, notified for the MID as the body 0102.

    const CREATED  = '2026-10-17T00:00:00.000Z';
    const T0       = '2026-10-25T12:00:00.000Z';

    const key = (keyId: string): { id: string, cose: string, seed: string } => {
        const vector = defined(specification.signatures.find(signature => signature.keyId.startsWith(keyId)), `The key ${keyId} of section 6`);
        return { id: vector.keyId, cose: vector.coseKey, seed: defined(vector.privateSeed, `The private seed of ${keyId}`) };
    };

    const RNO_IDENTITY  = key('1ef48003');
    const RNO           = key('06c3b3e2');
    const PTB           = key('a287cebc');
    const PTB_IDENTITY  = key('8cb46c0f');

    const signedBy = (seed: string, bytes: Uint8Array): string =>
        sign(null, bytes, createPrivateKey({ key: Buffer.concat([ Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seed, 'hex') ]),
                                             format: 'der', type: 'pkcs8' })).toString('base64');

    const certificate: JSONObject = {
        roamingNetworkOperatorId:  'DE*RNO',
        signingKey:                { '@id': RNO.id, key: RNO.cose, usages: [ 'party' ] },
        signedAt:                  CREATED,
        algorithm:                 'Ed25519',
        keyId:                     RNO_IDENTITY.id,
        value:                     'AA==',
    };
    certificate['value'] = signedBy(RNO_IDENTITY.seed, SigningKeyCertificate.parse(certificate).signingBytes());

    const ptb = (): JSONObject => ({ '@id': 'PTB', notifiedBodyNumber: '0102', notifiedFor: [ 'MID' ],
                                     signingKeys: [ { '@id': PTB.id, key: PTB.cose } ], identityKeys: [ { '@id': PTB_IDENTITY.id, key: PTB_IDENTITY.cose } ],
                                     created: CREATED, lastChange: CREATED });

    const networkOf = (...bodies: JSONObject[]): JSONObject => ({
        '@context':                  ROAMING_NETWORK_CONTEXT,
        '@id':                       'rn1',
        operator:                    { '@id': 'DE*RNO', identityKeys: [ { '@id': RNO_IDENTITY.id, key: RNO_IDENTITY.cose } ], signingKeyCertificates: [ certificate ],
                                       created: CREATED, lastChange: CREATED },
        conformityAssessmentBodies:  bodies,
        created:                     CREATED,
        lastChange:                  CREATED,
    });

    const before = RoamingNetwork.parse(networkOf(ptb()));

    /** A change set of the given changes, created at T0, signed by the given keys of section 6. */
    const changeSetOf = (changes: JSONObject[], signers: ReadonlyArray<{ readonly id: string, readonly seed: string }>): ChangeSet => {
        const eTags = before.changeSetETags().map(eTag => etagToJSON(eTag));
        const json: JSONObject = { '@context': CHANGE_SET_CONTEXT, roamingNetworkId: 'rn1', createdAt: T0, changes, beforeETags: eTags, afterETags: eTags };
        json['@id'] = changeSetIdentification(json);
        const unsigned = ChangeSet.parse(json);
        json['signatures'] = signers.map(signer => {
            const signature: ChangeSetSignature = { algorithm: 'Ed25519', keyId: signer.id, value: '' };
            return { ...signature, value: signedBy(signer.seed, unsigned.signingBytes(signature)) };
        });
        return ChangeSet.parse(json);
    };

    const owners = (changes: JSONObject[], ...signers: Array<{ readonly id: string, readonly seed: string }>): string => {
        try {
            checkOwnership(before, changeSetOf(changes, signers));
        }
        catch (e) {
            return e instanceof Error ? e.message : String(e);
        }
        return 'signed';
    };

    const notifiedForCRA  = { kind: 'UpdateProperty', entityType: 'ConformityAssessmentBody', entityId: 'PTB', propertyName: 'notifiedFor', newValue: [ 'CRA', 'MID' ] };
    const otherNumber     = { kind: 'UpdateProperty', entityType: 'ConformityAssessmentBody', entityId: 'PTB', propertyName: 'notifiedBodyNumber', newValue: '0103' };
    const craCertificate  = { kind: 'Add', entityType: 'ConformityCertificate', entityId: 'cra-1', newValue: { '@id': 'cra-1', legislation: 'CRA' },
                              parentEntityType: 'ConformityAssessmentBody', parentEntityId: 'PTB' };
    const homepage        = { kind: 'UpdateProperty', entityType: 'ConformityAssessmentBody', entityId: 'PTB', propertyName: 'homepage', newValue: 'https://www.ptb.de' };

    it('owns its notifiedFor and its notifiedBodyNumber, also once the body has keys', () => {

        expect(owners([ notifiedForCRA ], PTB))
            .toBe("Change 0: UpdateProperty of the ConformityAssessmentBody 'PTB' ('notifiedFor') needs a signature by one of the signing keys of the roaming network operator 'DE*RNO'!");
        expect(owners([ otherNumber ], PTB)).toMatch(/^Change 0: UpdateProperty of the ConformityAssessmentBody 'PTB' \('notifiedBodyNumber'\) needs a signature by .* roaming network operator 'DE\*RNO'!$/u);

        expect(owners([ notifiedForCRA ], RNO)).toBe('signed');
        expect(owners([ otherNumber ], RNO)).toBe('signed');

    });

    it('signs together with the body a change set in which it issues a certificate under the legislation added', () => {

        expect(owners([ notifiedForCRA, craCertificate ], PTB)).toMatch(/^Change 0: .* roaming network operator 'DE\*RNO'!$/u);
        expect(owners([ notifiedForCRA, craCertificate ], RNO)).toMatch(/^Change 1: Add of the ConformityCertificate 'cra-1' needs a signature by a signing key of the ConformityAssessmentBody 'PTB'/u);
        expect(owners([ notifiedForCRA, craCertificate ], RNO, PTB)).toBe('signed');

    });

    it('leaves the other properties of a body with keys to the body', () => {

        expect(owners([ homepage ], PTB)).toBe('signed');
        expect(owners([ homepage ], RNO)).toMatch(/^Change 0: UpdateProperty of the ConformityAssessmentBody 'PTB' \('homepage'\) needs a signature by a signing key of the ConformityAssessmentBody 'PTB'/u);

    });

    it('gives a number to one body only', () => {

        const bsi = { '@id': 'BSI', notifiedBodyNumber: '0102', notifiedFor: [ 'CRA' ], created: CREATED, lastChange: CREATED };

        expect(() => RoamingNetwork.parse(networkOf(ptb(), bsi)))
            .toThrow("The notified body number '0102' of the conformity assessment body 'BSI' is the one of the conformity assessment body 'PTB' already!");
        expect(() => RoamingNetwork.parse(networkOf(ptb(), { ...bsi, notifiedBodyNumber: '0103' }))).not.toThrow();

    });

});


describe('A conformity assessment body, as its constructor checks it in WWCP_POI3', () => {

    // QA without its eTags: PTB, the notified body 0102 for the MID, issued PTB-2026-0017 (no legislation) and
    // PTB-2026-0042 (under the MID); BSI is notified for the CRA. Every refusal is the one WWCP_POI3 gives the same content.
    const qa = (change: (body: (id: string) => JSONObject, certificate: (id: string) => JSONObject) => void = () => {}): JSONObject => {
        const json   = without(readJSON('published/QA.json') as JSONObject, 'eTags');
        const body   = (id: string): JSONObject => defined((json['conformityAssessmentBodies'] as JSONObject[]).find(item => item['@id'] === id));
        change(body, id => defined((body('PTB')['certificates'] as JSONObject[]).find(item => item['@id'] === id)));
        return json;
    };

    const refusal = (json: JSONObject): string => {
        try {
            RoamingNetwork.parse(json);
        }
        catch (e) {
            return e instanceof Error ? e.message : String(e);
        }
        return 'taken';
    };

    const invalid = (message: string, parameter: string): string =>
        `The given JSON representation of a conformity assessment body is invalid: ${message} (Parameter '${parameter}')`;

    const notNotified = (certificate: string, legislation: string): string =>
        invalid(`The certificate '${certificate}' is issued under the legislation '${legislation}', which the conformity assessment body 'PTB' is not notified for!`, 'Certificates');

    it('refuses a notified body number of other than four digits', () => {

        for (const number of [ '102', '01020', 'NB01', ' 0102', '', '٠١٠٢' ])
            expect(refusal(qa(body => { body('PTB')['notifiedBodyNumber'] = number; })))
                .toBe(invalid(`The notified body number '${number}' of the conformity assessment body 'PTB' must be four digits!`, 'NotifiedBodyNumber'));

        // As ^[0-9]{4}$ of .NET matches it, also before a last line feed.
        expect(refusal(qa(body => { body('PTB')['notifiedBodyNumber'] = '0102\n'; }))).toBe('taken');

        expect(refusal(qa(body => { body('PTB')['notifiedBodyNumber'] = 102; }))).toBe('The notified body number must be a text!');
        expect(refusal(qa(body => { body('PTB')['notifiedBodyNumber'] = null; }))).toBe('The notified body number must be a text!');

    });

    it('refuses a legislation it is notified for empty or given twice, with case', () => {

        for (const notifiedFor of [ [ 'MID', '' ], [ 'MID', ' ' ], [ '\t', 'MID' ] ])
            expect(refusal(qa(body => { body('PTB')['notifiedFor'] = notifiedFor; })))
                .toBe(invalid("A legislation the conformity assessment body 'PTB' is notified for must not be empty!", 'NotifiedFor'));

        expect(refusal(qa(body => { body('PTB')['notifiedFor'] = [ 'MID', 'MID' ]; })))
            .toBe(invalid("A legislation the conformity assessment body 'PTB' is notified for must not be given twice!", 'NotifiedFor'));

        // WWCP_POI3 writes them in their ordinal order; taken as given here.
        expect(refusal(qa(body => { body('PTB')['notifiedFor'] = [ 'MID', 'mid' ]; }))).toBe('taken');
        expect(refusal(qa(body => { body('PTB')['notifiedFor'] = [ 'MID', 'CRA' ]; }))).toBe('taken');

        expect(refusal(qa(body => { body('PTB')['notifiedFor'] = 'MID'; }))).toBe('The legislations notified for must be a JSON array of texts!');
        expect(refusal(qa(body => { body('PTB')['notifiedFor'] = [ 'MID', 5 ]; }))).toBe('The legislations notified for must be a JSON array of texts!');

    });

    it('refuses a certificate issued under a legislation it is not notified for, exactly as written', () => {

        expect(refusal(qa((_, certificate) => { certificate('PTB-2026-0042')['legislation'] = 'CRA'; }))).toBe(notNotified('PTB-2026-0042', 'CRA'));
        expect(refusal(qa((_, certificate) => { certificate('PTB-2026-0042')['legislation'] = 'mid'; }))).toBe(notNotified('PTB-2026-0042', 'mid'));
        expect(refusal(qa((_, certificate) => { certificate('PTB-2026-0042')['legislation'] = ' MID'; }))).toBe(notNotified('PTB-2026-0042', ' MID'));
        expect(refusal(qa(body => { delete body('PTB')['notifiedFor']; }))).toBe(notNotified('PTB-2026-0042', 'MID'));

        // Its certificates in the ordinal order of their identifications.
        expect(refusal(qa((_, certificate) => { certificate('PTB-2026-0042')['legislation'] = 'CRA'; certificate('PTB-2026-0017')['legislation'] = 'RED'; })))
            .toBe(notNotified('PTB-2026-0017', 'RED'));

    });

    it('checks in the order of WWCP_POI3, an entity before the network made of them', () => {

        expect(refusal(qa(body => { body('PTB')['notifiedBodyNumber'] = '102'; body('PTB')['notifiedFor'] = [ 'MID', 'MID' ]; })))
            .toMatch(/must be four digits! \(Parameter 'NotifiedBodyNumber'\)$/u);
        expect(refusal(qa((body, certificate) => { body('PTB')['notifiedFor'] = [ 'MID', '' ]; certificate('PTB-2026-0042')['legislation'] = 'CRA'; })))
            .toMatch(/must not be empty! \(Parameter 'NotifiedFor'\)$/u);

        // BSI, read before PTB.
        expect(refusal(qa((body, certificate) => { certificate('PTB-2026-0042')['legislation'] = 'CRA'; body('BSI')['notifiedBodyNumber'] = '12'; })))
            .toBe(invalid("The notified body number '12' of the conformity assessment body 'BSI' must be four digits!", 'NotifiedBodyNumber'));

        // A body as WWCP_POI3 reads it, before two bodies of the same number.
        expect(refusal(qa((body, certificate) => { body('BSI')['notifiedBodyNumber'] = '0102'; certificate('PTB-2026-0042')['legislation'] = 'CRA'; })))
            .toBe(notNotified('PTB-2026-0042', 'CRA'));

    });

    it('refuses a change set issuing a certificate under a legislation the body is not notified for', () => {

        const content      = qa();
        const before       = RoamingNetwork.parse(content);
        const ptb          = defined((content['conformityAssessmentBodies'] as JSONObject[]).find(item => item['@id'] === 'PTB'));
        const issued       = defined((ptb['certificates'] as JSONObject[]).find(item => item['@id'] === 'PTB-2026-0042'));
        const eTags        = before.changeSetETags().map(eTag => etagToJSON(eTag));
        const json: JSONObject = {
            '@context':        CHANGE_SET_CONTEXT,
            roamingNetworkId:  'QA',
            createdAt:         AT,
            changes:           [ { kind: 'Add', entityType: 'ConformityCertificate', entityId: 'PTB-2026-0099', newValue: { ...clone(issued), '@id': 'PTB-2026-0099', legislation: 'CRA' },
                                   parentEntityType: 'ConformityAssessmentBody', parentEntityId: 'PTB' } ],
            beforeETags:       eTags,
            afterETags:        eTags,
        };
        json['@id'] = changeSetIdentification(json);

        expect(() => applyChangeSet(before, ChangeSet.parse(json), { checkOwnership: false })).toThrow(notNotified('PTB-2026-0099', 'CRA'));

    });

});
