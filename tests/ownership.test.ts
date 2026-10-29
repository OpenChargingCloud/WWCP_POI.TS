import { createPrivateKey, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { defined } from './helpers.ts';
import { specification } from './conformance.ts';

import { checkOwnership } from '../src/history/apply.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification, type ChangeSetSignature } from '../src/history/changeSet.ts';
import { etagToJSON } from '../src/etags.ts';
import type { JSONObject } from '../src/json/value.ts';
import { RoamingNetwork, ROAMING_NETWORK_CONTEXT } from '../src/network/roamingNetwork.ts';
import { SigningKeyCertificate } from '../src/proofs/signingKeyCertificate.ts';


// The roaming network operator signs in place of a party without signing keys (SPECIFICATION.md section 4.1), e.g. the
// certificates of a conformity assessment body not taking part, by a signing key that may sign `party`, the usage of
// everything it owns, as the examples certify its keys, or the usage of what it changes (csharp-review 13).
// Signed here with the Ed25519 keys of section 6, whose private seeds the specification gives: the identity key of DE*RNO
// certifies a signing key for one usage alone, and that key signs a certificate of the BSI, which has no keys.

const CREATED  = '2026-10-17T00:00:00.000Z';
const T0       = '2026-10-25T12:00:00.000Z';

/** A key of section 6 with its private seed. */
const key = (keyId: string): { id: string, cose: string, seed: string } => {
    const vector = defined(specification.signatures.find(signature => signature.keyId.startsWith(keyId)), `The key ${keyId} of section 6`);
    return { id: vector.keyId, cose: vector.coseKey, seed: defined(vector.privateSeed, `The private seed of ${keyId}`) };
};

const IDENTITY  = key('1ef48003');
const SIGNING   = key('06c3b3e2');

/** An Ed25519 signature by the given private seed, in Base64. */
const signedBy = (seed: string, bytes: Uint8Array): string =>
    sign(null, bytes, createPrivateKey({ key: Buffer.concat([ Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seed, 'hex') ]),
                                         format: 'der', type: 'pkcs8' })).toString('base64');

/** A signing key of DE*RNO its identity key certifies: for the usages given, valid as given. */
interface Certified {
    readonly key:         { readonly id: string, readonly cose: string };
    readonly usages:      readonly string[];
    readonly notBefore?:  string;
    readonly notAfter?:   string;
}

/**
 * A roaming network whose operator DE*RNO certified its signing key for the given usage alone, and the other signing keys
 * given, with the BSI without keys.
 */
function network(usage: string, ...others: Certified[]): RoamingNetwork {

    const certificateOf = ({ key: signing, usages, notBefore, notAfter }: Certified): JSONObject => {

        const certificate: JSONObject = {
            roamingNetworkOperatorId:  'DE*RNO',
            signingKey:                { '@id': signing.id, key: signing.cose, ...(notBefore === undefined ? {} : { notBefore }),
                                         ...(notAfter === undefined ? {} : { notAfter }), usages: [ ...usages ] },
            signedAt:                  CREATED,
            algorithm:                 'Ed25519',
            keyId:                     IDENTITY.id,
            value:                     'AA==',
        };

        certificate['value'] = signedBy(IDENTITY.seed, SigningKeyCertificate.parse(certificate).signingBytes());

        return certificate;

    };

    // In the order of the @ids of their signing keys, as the content holds them.
    const certificates = [ { key: SIGNING, usages: [ usage ] }, ...others ].sort((left, right) => left.key.id < right.key.id ? -1 : 1).map(certificateOf);

    return RoamingNetwork.parse({
        '@context':                  ROAMING_NETWORK_CONTEXT,
        '@id':                       'rn1',
        operator:                    { '@id': 'DE*RNO', identityKeys: [ { '@id': IDENTITY.id, key: IDENTITY.cose } ], signingKeyCertificates: certificates,
                                       created: CREATED, lastChange: CREATED },
        conformityAssessmentBodies:  [ { '@id': 'BSI', name: { en: 'BSI' }, created: CREATED, lastChange: CREATED } ],
        created:                     CREATED,
        lastChange:                  CREATED,
    });

}

/** A change set of the given changes, created at T0, signed by the given keys of section 6. */
function changeSetOf(before: RoamingNetwork, changes: JSONObject[], signers: ReadonlyArray<{ readonly id: string, readonly seed: string }>): ChangeSet {

    const eTags = before.changeSetETags().map(eTag => etagToJSON(eTag));
    const json: JSONObject = {
        '@context':        CHANGE_SET_CONTEXT,
        roamingNetworkId:  'rn1',
        createdAt:         T0,
        changes,
        beforeETags:       eTags,
        afterETags:        eTags,
    };

    json['@id'] = changeSetIdentification(json);

    const unsigned = ChangeSet.parse(json);

    json['signatures'] = signers.map(signer => {
        const signature: ChangeSetSignature = { algorithm: 'Ed25519', keyId: signer.id, value: '' };
        return { ...signature, value: signedBy(signer.seed, unsigned.signingBytes(signature)) };
    });

    return ChangeSet.parse(json);

}

/** A change set adding a certificate to the BSI, signed by the signing key of DE*RNO, or by the keys given. */
const addCertificate = (before: RoamingNetwork, signers = [ SIGNING ]): ChangeSet =>
    changeSetOf(before, [ { kind: 'Add', entityType: 'ConformityCertificate', entityId: 'BSI-2026-0001', newValue: { '@id': 'BSI-2026-0001' },
                            parentEntityType: 'ConformityAssessmentBody', parentEntityId: 'BSI' } ], signers);


describe('The roaming network operator in place of a party without signing keys (4.1)', () => {

    it("signs by a key that may sign 'party', as its keys usually do, or the usage of what it changes", () => {

        const byParty         = network('party');
        const byCertificates  = network('certificates');

        expect(() => { checkOwnership(byParty,        addCertificate(byParty)); }).not.toThrow();
        expect(() => { checkOwnership(byCertificates, addCertificate(byCertificates)); }).not.toThrow();

    });

    it('not by a key naming neither', () => {

        const byInfrastructure = network('infrastructure');

        expect(() => { checkOwnership(byInfrastructure, addCertificate(byInfrastructure)); })
            .toThrow("Change 0: Add of the ConformityCertificate 'BSI-2026-0001' needs a signature by a signing key of the ConformityAssessmentBody 'BSI'!");

    });

});


// Every signature of a change set by a key of a party of the version is by one valid at its createdAt, also one besides
// the signatures of its owners, as WWCP_POI takes it (`TryGetSigners`; SPECIFICATION.md 4.1, 4.2; D8 of
// WWCPPOIConformanceTests): only a new identity key, proving its possession, may be one valid later.

describe('Every signature by a key of a party valid at the createdAt of its change set', () => {

    const OTHER  = key('ea671729');

    it('also one besides the signature of its owner', () => {

        const valid    = network('party', { key: OTHER, usages: [ 'party' ] });
        const expired  = network('party', { key: OTHER, usages: [ 'party' ], notAfter:  '2026-10-25T11:59:59.999Z' });
        const later    = network('party', { key: OTHER, usages: [ 'party' ], notBefore: '2026-10-25T12:00:00.001Z' });

        expect(() => { checkOwnership(valid, addCertificate(valid, [ SIGNING, OTHER ])); }).not.toThrow();

        for (const version of [ expired, later ])
            expect(() => { checkOwnership(version, addCertificate(version, [ SIGNING, OTHER ])); })
                .toThrow(`Signature 1: the key '${OTHER.id}' of the RoamingNetworkOperator 'DE*RNO' is not valid at ${T0}!`);

    });

    it('but a new identity key, which proves its possession only, also before its notBefore', () => {

        const before   = network('party');
        const NEW      = key('a287cebc');
        const SIGNS    = key('8cb46c0f');

        const added    = changeSetOf(before, [ { kind: 'Add', entityType: 'ChargingStationOperator', entityId: 'DE*GEF',
                                                 newValue: { '@id': 'DE*GEF', name: { en: 'DE*GEF' }, signingKeys: [ { '@id': SIGNS.id, key: SIGNS.cose } ],
                                                             identityKeys: [ { '@id': NEW.id, key: NEW.cose, notBefore: '2026-11-01T00:00:00.000Z' } ] } } ],
                                     [ SIGNING, NEW ]);

        expect(() => { checkOwnership(before, added); }).not.toThrow();

    });

});
