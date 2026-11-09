import { createPrivateKey, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { defined } from './helpers.ts';
import { specification } from './conformance.ts';

import { applyChangeSet, checkOwnership } from '../src/history/apply.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification, type ChangeSetSignature } from '../src/history/changeSet.ts';
import { etagToJSON } from '../src/etags.ts';
import { KeyUsages } from '../src/keys.ts';
import { asText, get, isObject, type JSONObject, type JSONValue } from '../src/json/value.ts';
import { effectiveChargingStationOperator } from '../src/network/effective.ts';
import { RoamingNetwork, ROAMING_NETWORK_CONTEXT } from '../src/network/roamingNetwork.ts';
import { notWrittenAsHeld } from '../src/network/writtenForm.ts';


// The URL of the web payment page of a charging station operator, a charging pool, a charging station and their templates
// (WWCP_POI 848cc52) - not the URL in the dynamic QR code of a station -, as WebPaymentURLTests of WWCP_POI3 has it: read
// and written, given by templates, changed by change sets, and signed by a key that may sign "payments". The after ETags
// and the words are those of WWCP_POI 8b0580f for the same network and change sets (`TryApplyPendingChangeSet`,
// `TryCheckCoSigning`).

const CREATED    = '2026-01-01T00:00:00.000Z';
const T0         = '2026-11-08T12:00:00.000Z';
const at         = { created: CREATED, lastChange: CREATED };

const OF_GEF     = 'https://pay.gef.example/';
const OF_P1      = 'https://pay.gef.example/pools/P1';
const OF_SITES   = 'https://pay.gef.example/sites';
const OF_S1      = 'https://pay.gef.example/stations/S1';
const OF_WALLBOX = 'https://pay.gef.example/wallbox';

/** A key of section 6 with its private seed. */
const key = (keyId: string): { id: string, cose: string, seed: string } => {
    const vector = defined(specification.signatures.find(signature => signature.keyId.startsWith(keyId)), `The key ${keyId} of section 6`);
    return { id: vector.keyId, cose: vector.coseKey, seed: defined(vector.privateSeed, `The private seed of ${keyId}`) };
};

/** The signing keys of DE*GEF, each for the usages it is named after. */
const PAYMENTS        = key('8cb46c0f');
const PARTY           = key('a287cebc');
const INFRASTRUCTURE  = key('06c3b3e2');
const BOTH            = key('ea671729');

const signingKeys = [ { '@id': PAYMENTS.id,       key: PAYMENTS.cose,       usages: [ KeyUsages.Payments ] },
                      { '@id': PARTY.id,          key: PARTY.cose,          usages: [ KeyUsages.Party ] },
                      { '@id': INFRASTRUCTURE.id, key: INFRASTRUCTURE.cose, usages: [ KeyUsages.Infrastructure ] },
                      { '@id': BOTH.id,           key: BOTH.cose,           usages: [ KeyUsages.Infrastructure, KeyUsages.Payments ] } ]
                        .sort((left, right) => left['@id'] < right['@id'] ? -1 : 1);

/**
 * An operator with a web payment page; the first pool with one of its own and a station with one of its own, the second
 * pool taking one from its template and its station one from its own template (`NewNetwork`).
 */
const networkJSON = (): JSONObject => ({
    '@context': ROAMING_NETWORK_CONTEXT,
    '@id':      'rn1',
    chargingStationOperators: [ {
        '@id':                     'DE*GEF',
        name:                      { en: "Charging Station Operator 'DE*GEF'" },
        webPaymentURL:             OF_GEF,
        signingKeys,
        chargingPools:             [ { '@id': 'DE*GEF*P1', webPaymentURL: OF_P1,
                                       chargingStations: [ { '@id': 'DE*GEF*S1', webPaymentURL: OF_S1, ...at } ], ...at },
                                     { '@id': 'DE*GEF*P2', templateIds: [ 'DE*GEF*PT1' ],
                                       chargingStations: [ { '@id': 'DE*GEF*S2', templateIds: [ 'DE*GEF*STWALLBOX' ], ...at } ], ...at } ],
        chargingPoolTemplates:     [ { '@id': 'DE*GEF*PT1',       webPaymentURL: OF_SITES,   ...at } ],
        chargingStationTemplates:  [ { '@id': 'DE*GEF*STWALLBOX', webPaymentURL: OF_WALLBOX, ...at } ],
        ...at,
    } ],
    ...at,
});

const before = RoamingNetwork.parse(networkJSON());

/** The objects of an array property. */
const objectsAt = (value: JSONValue | undefined): JSONObject[] =>
    Array.isArray(value) ? value.filter(isObject) : [];

/** DE*GEF of a version. */
const gefOf = (network: RoamingNetwork): JSONObject =>
    defined(network.chargingStationOperator('DE*GEF'), 'DE*GEF');

/** The pools of DE*GEF, effective or as given, by their identifications. */
function poolsOf(operator: JSONObject): Map<string, JSONObject> {
    return new Map(objectsAt(get(operator, 'chargingPools')).map(pool => [ asText(get(pool, '@id')), pool ]));
}

const stationOf = (pool: JSONObject | undefined): JSONObject =>
    defined(objectsAt(get(defined(pool, 'the pool'), 'chargingStations'))[0], 'its station');

/** A change set of the given changes at T0, leading to the version of the given ETags, signed by the given key. */
function changeSetOf(changes: JSONObject[], after?: readonly [ string, string ], signer?: { readonly id: string, readonly seed: string }): ChangeSet {

    const beforeETags = before.changeSetETags().map(eTag => etagToJSON(eTag));
    const json: JSONObject = {
        '@context':        CHANGE_SET_CONTEXT,
        roamingNetworkId:  'rn1',
        createdAt:         T0,
        changes,
        beforeETags,
        afterETags:        after === undefined ? beforeETags : [ [ 'json', 'sha256', 'hex', after[0] ], [ 'cbor', 'sha256', 'hex', after[1] ] ],
    };

    json['@id'] = changeSetIdentification(json);

    if (signer !== undefined) {
        const unsigned  = ChangeSet.parse(json);
        const signature: ChangeSetSignature = { algorithm: 'Ed25519', keyId: signer.id, value: '' };
        const value     = sign(null, unsigned.signingBytes(signature),
                               createPrivateKey({ key: Buffer.concat([ Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(signer.seed, 'hex') ]),
                                                  format: 'der', type: 'pkcs8' })).toString('base64');
        json['signatures'] = [ { ...signature, value } ];
    }

    return ChangeSet.parse(json);

}

/** Why something is refused, word for word. */
function refused(action: () => unknown): string {
    try {
        action();
    }
    catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
    return 'taken';
}

const update = (entityType: string, entityId: string, propertyName: string, oldValue: JSONValue | undefined, newValue: JSONValue): JSONObject =>
    ({ kind: 'UpdateProperty', entityType, entityId, propertyName, ...(oldValue === undefined ? {} : { oldValue }), newValue });

const ofOperator  = update('ChargingStationOperator', 'DE*GEF',           'webPaymentURL', OF_GEF,     'https://payments.gef.example/');
const ofPool      = update('ChargingPool',            'DE*GEF*P2',        'webPaymentURL', undefined,  'https://payments.gef.example/pools/P2');
const ofStation   = { kind: 'RemoveProperty', entityType: 'ChargingStation', entityId: 'DE*GEF*S1', propertyName: 'webPaymentURL', oldValue: OF_S1 };
const ofTemplate  = update('ChargingStationTemplate', 'DE*GEF*STWALLBOX', 'webPaymentURL', OF_WALLBOX, 'https://payments.gef.example/wallbox');
const name        = update('ChargingStationOperator', 'DE*GEF',           'name',          undefined,  { en: 'Renamed' });

/** A new pool naming no web payment page, but one of its stations does; and one without any. */
const withPage    = { kind: 'Add', entityType: 'ChargingPool', entityId: 'DE*GEF*P3',
                      newValue: { '@id': 'DE*GEF*P3', chargingStations: [ { '@id': 'DE*GEF*S3', webPaymentURL: 'https://pay.gef.example/stations/S3', created: T0, lastChange: T0 } ],
                                  created: T0, lastChange: T0 } };
const withoutPage = { kind: 'Add', entityType: 'ChargingPool', entityId: 'DE*GEF*P4',
                      newValue: { '@id': 'DE*GEF*P4', chargingStations: [ { '@id': 'DE*GEF*S4', created: T0, lastChange: T0 } ], created: T0, lastChange: T0 } };


describe('The web payment page of a charging station operator, a pool, a station and their templates (WWCP_POI 848cc52)', () => {

    it('is read and written as WWCP_POI3 writes it, kept where it is given', () => {

        expect(notWrittenAsHeld(networkJSON())).toBeUndefined();

        const gef   = gefOf(before);
        const pools = poolsOf(gef);

        expect(get(gef, 'webPaymentURL')).toBe(OF_GEF);
        expect(get(defined(pools.get('DE*GEF*P1'), 'P1'), 'webPaymentURL')).toBe(OF_P1);
        expect(get(stationOf(pools.get('DE*GEF*P1')), 'webPaymentURL')).toBe(OF_S1);
        expect(get(defined(objectsAt(get(gef, 'chargingPoolTemplates'))[0], 'PT1'), 'webPaymentURL')).toBe(OF_SITES);
        expect(get(defined(objectsAt(get(gef, 'chargingStationTemplates'))[0], 'STWALLBOX'), 'webPaymentURL')).toBe(OF_WALLBOX);

        // Not written into the members of a template.
        expect(get(defined(pools.get('DE*GEF*P2'), 'P2'), 'webPaymentURL')).toBeUndefined();
        expect(get(stationOf(pools.get('DE*GEF*P2')), 'webPaymentURL')).toBeUndefined();

    });

    it('is taken by the members of a template unless they have their own', () => {

        const effective = poolsOf(effectiveChargingStationOperator(gefOf(before)));

        expect(get(defined(effective.get('DE*GEF*P1'), 'P1'), 'webPaymentURL')).toBe(OF_P1);
        expect(get(stationOf(effective.get('DE*GEF*P1')), 'webPaymentURL')).toBe(OF_S1);
        expect(get(defined(effective.get('DE*GEF*P2'), 'P2'), 'webPaymentURL')).toBe(OF_SITES);
        expect(get(stationOf(effective.get('DE*GEF*P2')), 'webPaymentURL')).toBe(OF_WALLBOX);

    });

    it('is updated and removed by change sets', () => {

        const after     = applyChangeSet(before, changeSetOf([ ofOperator, ofPool, ofStation ],
                                                             [ '8dd7819b0355aa540b66a5e6301a43981669dab0c0d45568b05f27b8e50b292b',
                                                               '9796b107fa3f6038a42e30d96020e6018c06ca9bc7659b8cfa768dccc8a6016b' ]),
                                         { checkOwnership: false });
        const effective = poolsOf(effectiveChargingStationOperator(gefOf(after)));

        expect(get(gefOf(after), 'webPaymentURL')).toBe('https://payments.gef.example/');
        expect(get(defined(effective.get('DE*GEF*P2'), 'P2'), 'webPaymentURL')).toBe('https://payments.gef.example/pools/P2');
        expect(get(stationOf(effective.get('DE*GEF*P1')), 'webPaymentURL')).toBeUndefined();
        expect(get(defined(effective.get('DE*GEF*P1'), 'P1'), 'webPaymentURL')).toBe(OF_P1);

    });

    it('is refused when no text or no URL', () => {

        // Refused as the pool is read again right after the change, in the words of the change.
        expect(refused(() => applyChangeSet(before, changeSetOf([ update('ChargingPool', 'DE*GEF*P1', 'webPaymentURL', OF_P1, 42) ]), { checkOwnership: false })))
            .toBe("Change 0: Invalid web payment URL '42'!");
        expect(refused(() => applyChangeSet(before, changeSetOf([ update('ChargingPool', 'DE*GEF*P1', 'webPaymentURL', OF_P1, 'no url') ]), { checkOwnership: false })))
            .toBe("Change 0: Invalid web payment URL 'no url'!");

        const json = networkJSON();
        const pool = defined(poolsOf(defined(objectsAt(json['chargingStationOperators'])[0], 'DE*GEF')).get('DE*GEF*P1'), 'P1');
        pool['webPaymentURL'] = 42;

        expect(refused(() => RoamingNetwork.parse(json))).toContain('web payment URL');

    });

});


describe('A web payment page signed by a key that may sign payments (WWCP_POI 848cc52)', () => {

    const signedBy = (signer: { readonly id: string, readonly seed: string }, change: JSONObject): string =>
        refused(() => { checkOwnership(before, changeSetOf([ change ], undefined, signer)); });

    it('changed, of the operator, a pool, a station or a template, by a key for payments', () => {

        for (const [ change, without ] of [ [ ofOperator, PARTY ], [ ofPool, INFRASTRUCTURE ], [ ofStation, INFRASTRUCTURE ], [ ofTemplate, INFRASTRUCTURE ] ] as const) {
            expect(signedBy(without, change)).toMatch(/needs a signature by a signing key of the ChargingStationOperator 'DE\*GEF' that may sign 'payments'!$/u);
            expect(signedBy(PAYMENTS, change)).toBe('taken');
        }

        expect(signedBy(INFRASTRUCTURE, ofPool))
            .toBe("Change 0: UpdateProperty of the ChargingPool 'DE*GEF*P2' ('webPaymentURL') needs a signature by a signing key of the ChargingStationOperator 'DE*GEF' that may sign 'payments'!");

    });

    it('added with a pool, its stations included, by a key that may sign infrastructure and payments', () => {

        expect(signedBy(INFRASTRUCTURE, withPage))
            .toBe("Change 0: Add of the ChargingPool 'DE*GEF*P3' needs a signature by a signing key of the ChargingStationOperator 'DE*GEF' that may sign 'infrastructure' and 'payments'!");
        expect(signedBy(PAYMENTS, withPage))
            .toBe("Change 0: Add of the ChargingPool 'DE*GEF*P3' needs a signature by a signing key of the ChargingStationOperator 'DE*GEF' that may sign 'infrastructure' and 'payments'!");
        expect(signedBy(BOTH, withPage)).toBe('taken');

        // A pool without one, as before.
        expect(signedBy(INFRASTRUCTURE, withoutPage)).toBe('taken');
        expect(signedBy(PAYMENTS, withoutPage))
            .toBe("Change 0: Add of the ChargingPool 'DE*GEF*P4' needs a signature by a signing key of the ChargingStationOperator 'DE*GEF' that may sign 'infrastructure'!");

    });

    it('and nothing else of the operator', () => {

        expect(signedBy(PAYMENTS, name))
            .toBe("Change 0: UpdateProperty of the ChargingStationOperator 'DE*GEF' ('name') needs a signature by a signing key of the ChargingStationOperator 'DE*GEF' that may sign 'party'!");
        expect(signedBy(PARTY, name)).toBe('taken');

    });

});
