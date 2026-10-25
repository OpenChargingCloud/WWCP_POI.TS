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
// everything it owns, as the examples certify its keys, or the usage of what it changes (docs/csharp-review.md, 13).
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

/** A roaming network whose operator DE*RNO certified its signing key for the given usage alone, with the BSI without keys. */
function network(usage: string): RoamingNetwork {

    const certificate: JSONObject = {
        roamingNetworkOperatorId:  'DE*RNO',
        signingKey:                { '@id': SIGNING.id, key: SIGNING.cose, usages: [ usage ] },
        signedAt:                  CREATED,
        algorithm:                 'Ed25519',
        keyId:                     IDENTITY.id,
        value:                     'AA==',
    };

    certificate['value'] = signedBy(IDENTITY.seed, SigningKeyCertificate.parse(certificate).signingBytes());

    return RoamingNetwork.parse({
        '@context':                  ROAMING_NETWORK_CONTEXT,
        '@id':                       'rn1',
        operator:                    { '@id': 'DE*RNO', identityKeys: [ { '@id': IDENTITY.id, key: IDENTITY.cose } ], signingKeyCertificates: [ certificate ],
                                       created: CREATED, lastChange: CREATED },
        conformityAssessmentBodies:  [ { '@id': 'BSI', created: CREATED, lastChange: CREATED } ],
        created:                     CREATED,
        lastChange:                  CREATED,
    });

}

/** A change set adding a certificate to the BSI, signed by the signing key of DE*RNO. */
function addCertificate(before: RoamingNetwork): ChangeSet {

    const eTags = before.changeSetETags().map(eTag => etagToJSON(eTag));
    const json: JSONObject = {
        '@context':        CHANGE_SET_CONTEXT,
        roamingNetworkId:  'rn1',
        createdAt:         T0,
        changes:           [ { kind: 'Add', entityType: 'TransparencySoftwareCertificate', entityId: 'BSI-2026-0001', newValue: { '@id': 'BSI-2026-0001' },
                               parentEntityType: 'ConformityAssessmentBody', parentEntityId: 'BSI' } ],
        beforeETags:       eTags,
        afterETags:        eTags,
    };

    json['@id'] = changeSetIdentification(json);

    const signature: ChangeSetSignature = { algorithm: 'Ed25519', keyId: SIGNING.id, value: '' };

    json['signatures'] = [ { ...signature, value: signedBy(SIGNING.seed, ChangeSet.parse(json).signingBytes(signature)) } ];

    return ChangeSet.parse(json);

}


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
            .toThrow("Change 0: Add of the TransparencySoftwareCertificate 'BSI-2026-0001' needs a signature by a signing key of the ConformityAssessmentBody 'BSI'!");

    });

});
