import { createPrivateKey, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { AT, defined, readJSON } from './helpers.ts';
import { anchorPQ } from './qa.ts';
import { specification } from './conformance.ts';

import { applyChangeSet, checkOwnership } from '../src/history/apply.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification, type ChangeSetSignature } from '../src/history/changeSet.ts';
import { etagToJSON, etagToText } from '../src/etags.ts';
import { KeyUsages, POIPublicKey } from '../src/keys.ts';
import { clone, get, without, type JSONArray, type JSONObject } from '../src/json/value.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';
import { EV_TALER_MERCHANT_CONTEXT, evTalerMerchantOf, isTalerPublicKey, paymentOptionName, type EVTalerMerchant } from '../src/network/evTaler.ts';
import { verifyChargingStation, type VerifiedChargingStation } from '../src/verifier/chargingStation.ts';
import { evTalerExchangesAt, evTalerTariffOf } from '../src/verifier/evTaler.ts';


// EV Taler (WWCP_POI ec3dace, concepts/EVTaler.md phase 1, EVTalerTests.cs): a charging station operator names its merchant
// at a GNU Taler merchant backend and the exchanges it accepts, changed with a key that may sign `payments`; a charging pool
// or template naming the payment option EVTaler needs it; payment options are an open set of names. QA of the frozen run,
// its eTags left out, DE*GEF with the merchant of EVTalerTests: as WWCP_POI3 at ec3dace reads it, so it is read here, its
// ETags those WWCP_POI3 calculates of the same content.

const EUR_EXCHANGE  = 'F80MFRG8HVH6R9CQ47KRFQSJP3T6DBJ4K1D9B703RJY3Z39TBMJ0';   // the master key of exchange.demo.taler.net
const CHF_EXCHANGE  = 'YJ7H5JVNVM5SG5FAE3BGQ35AEPHXBH27MWNRPFQ0SVW9BH0BN9B0';
const MERCHANT_KEY  = 'ESMBKNR5CMZPAYH9AD0QNKCPYSJSE0EN5MH4FMPKN683R63HMD3G';

/** The merchant of DE*GEF, as the content holds it: its exchanges in the order of their master public keys. */
const merchant = (): JSONObject => ({
    merchantBaseURL:    'https://taler.gef.example/instances/de-gef/',
    merchantPublicKey:  MERCHANT_KEY,
    exchanges: [
        { masterPublicKey: EUR_EXCHANGE, baseURL: 'https://exchange.example.eu/', currency: 'EUR', name: { en: 'Example Exchange', de: 'Beispiel-Exchange' } },
        { masterPublicKey: CHF_EXCHANGE, baseURL: 'https://exchange.example.ch/', currency: 'CHF', name: { en: 'Example Franc Exchange' } },
    ],
});

const TEMPLATE_ID = 'DE*GEF*PTSUPERMARKET';

/** QA without its eTags, DE*GEF with the merchant unless `withMerchant` is false, changed by `change`. */
function qa(change: (gef: JSONObject, pool: JSONObject) => void = () => {}, withMerchant = true): JSONObject {
    const json = without(readJSON('published/QA.json') as JSONObject, 'eTags');
    const gef  = defined((json['chargingStationOperators'] as JSONObject[]).find(operator => operator['@id'] === 'DE*GEF'));
    if (withMerchant)
        gef['evTaler'] = merchant();
    change(gef, defined((gef['chargingPools'] as JSONObject[]).find(pool => pool['@id'] === 'DE*GEF*P2')));
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

const templateNaming = (paymentOptions: string[]): JSONObject =>
    ({ '@id': TEMPLATE_ID, name: { en: 'Supermarket sites' }, paymentOptions, created: '2026-01-01T00:00:00.000Z', lastChange: '2026-10-12T12:00:00.000Z' });


describe('Payment options, an open set of names (WWCP_POI ec3dace)', () => {

    it('takes any nonempty text, none twice whatever its case, and none empty', () => {

        expect(refusal(qa((_, pool) => { pool['paymentOptions'] = [ 'Bitcoin', 'Contract', 'SMS' ]; }, false))).toBe('taken');

        expect(refusal(qa((_, pool) => { pool['paymentOptions'] = [ 'Cash', 'cash' ]; }, false)))
            .toBe("The given JSON representation of a charging pool is invalid: A payment option of the charging pool 'DE*GEF*P2' must not be given twice!");
        expect(refusal(qa(gef => { gef['chargingPoolTemplates'] = [ templateNaming([ 'Cash', 'CASH' ]) ]; }, false)))
            .toBe("The given JSON representation of a charging pool template is invalid: A payment option of the charging pool template 'DE*GEF*PTSUPERMARKET' must not be given twice!");
        expect(refusal(qa((_, pool) => { pool['paymentOptions'] = [ ' ' ]; }, false))).toBe("Invalid payment option ' '!");
        expect(refusal(qa((_, pool) => { pool['paymentOptions'] = [ 5 ]; }, false))).toBe("Invalid payment option '5'!");
        expect(refusal(qa((_, pool) => { pool['paymentOptions'] = 'Cash'; }, false))).toBe('The payment option must be a JSON array!');

    });

    it('unites those of a charging pool and its templates without case, its own first, in the order of their texts', () => {

        // As WWCP_POI3 calculates the effective tree of it: EVTaler of the pool and evtaler of its template are one.
        const network = RoamingNetwork.parse(qa((gef, pool) => {
            gef['chargingPoolTemplates'] = [ templateNaming([ 'Cash', 'evtaler' ]) ];
            pool['templateIds']          = [ TEMPLATE_ID ];
            pool['paymentOptions']       = [ 'Cash', 'EVTaler' ];
        }));

        const gef  = defined((network.effectiveContent['chargingStationOperators'] as JSONObject[]).find(operator => operator['@id'] === 'DE*GEF'));
        const pool = defined((gef['chargingPools'] as JSONObject[]).find(item => item['@id'] === 'DE*GEF*P2'));

        expect(pool['paymentOptions']).toEqual([ 'Cash', 'EVTaler' ]);
        expect(network.eTags().map(etagToText)).toEqual([
            'json:sha256:hex:cc50af4905ab48b4a9b58023815fc7f6a3782f1c5f4a03d8245a8def343e9564',
            'cbor:sha256:hex:d2a4d58396e57a60ad9bb1b4d5b40f4f4123eb4fb95ae78fc7e3011d506a0e20',
            'effectiveTree:sha256:hex:7df2ffe0197ec0a870da010ebaee68de1fc67f8e70f6ac8174a8ee131db8b9bd',
        ]);

    });

});


describe('The EV Taler merchant of a charging station operator (WWCP_POI ec3dace)', () => {

    it('is read as WWCP_POI3 reads it, of the same JSON and CBOR, in its tree and so in every station proof', () => {

        const network = RoamingNetwork.parse(qa());

        // The ETags WWCP_POI3 calculates of the same content: its canonical JSON, its CBOR, its effective tree.
        expect(network.eTags().map(etagToText)).toEqual([
            'json:sha256:hex:0f5a32066177617bd2d6cb388e8a7e7d8809c26e2b0f7b619a2e29c7c678c2ae',
            'cbor:sha256:hex:ce7588bafa7e7060050f66ff234bbab3ecee111e1b3dbeb88f402e53627f08a9',
            'effectiveTree:sha256:hex:4893d5ad0a10e029141291e3ed59013db45fb1ac08c99a42a379ddf6b6b38924',
        ]);

        const read = evTalerMerchantOf(merchant()) as EVTalerMerchant;

        expect(read.exchanges.map(exchange => exchange.masterPublicKey)).toEqual([ EUR_EXCHANGE, CHF_EXCHANGE ]);
        expect(paymentOptionName(defined(read.exchanges[0]))).toEqual([ [ 'en', 'EV Taler (Example Exchange, EUR)' ], [ 'de', 'EV Taler (Beispiel-Exchange, EUR)' ] ]);

        // Given in any order, with its JSON-LD context: as WWCP_POI3 holds it, in the order of the master public keys.
        const unordered = { ...merchant(), '@context': EV_TALER_MERCHANT_CONTEXT, exchanges: [ ...(merchant()['exchanges'] as JSONArray) ].reverse() };
        expect((evTalerMerchantOf(unordered) as EVTalerMerchant).exchanges.map(exchange => exchange.currency)).toEqual([ 'EUR', 'CHF' ]);

        expect(isTalerPublicKey(EUR_EXCHANGE)).toBe(true);
        expect(isTalerPublicKey(EUR_EXCHANGE.toLowerCase())).toBe(false);
        expect(isTalerPublicKey(`${EUR_EXCHANGE.slice(0, -1)}1`)).toBe(false);

    });

    it('refuses a merchant WWCP_POI3 refuses, in its words', () => {

        const changed = (change: (merchant: JSONObject, exchange: JSONObject) => void): string =>
            refusal(qa(gef => {
                const given = gef['evTaler'] as JSONObject;
                change(given, defined((given['exchanges'] as JSONObject[])[0]));
            }));

        const invalid = (error: string): string => `Invalid EV Taler merchant: ${error}`;
        const ofExchange = (error: string): string => invalid(`Invalid exchange of an EV Taler merchant: ${error}`);

        expect(changed(given => { given['merchantBaseURL'] = 'http://taler.gef.example/instances/de-gef/'; }))
            .toBe(invalid("The merchant base URL 'http://taler.gef.example/instances/de-gef/' must be an HTTPS URL! (Parameter 'MerchantBaseURL')"));
        expect(changed(given => { given['merchantBaseURL'] = 'https://taler.gef.example/instances/de-gef'; }))
            .toBe(invalid("The merchant base URL 'https://taler.gef.example/instances/de-gef' must end with '/'! (Parameter 'MerchantBaseURL')"));
        expect(changed(given => { given['merchantBaseURL'] = 'https://taler.gef.example/instances/de-gef/?a=1'; }))
            .toBe(invalid("The merchant base URL 'https://taler.gef.example/instances/de-gef/?a=1' must have neither a query nor a fragment! (Parameter 'MerchantBaseURL')"));
        expect(changed(given => { given['merchantBaseURL'] = 'https://gef:secret@taler.gef.example/'; }))
            .toBe(invalid("The merchant base URL 'https://gef:secret@taler.gef.example/' must not name a user! (Parameter 'MerchantBaseURL')"));
        expect(changed(given => { delete given['merchantBaseURL']; })).toBe(invalid('An EV Taler merchant needs its merchant base URL!'));
        expect(changed(given => { given['merchantBaseURL'] = 5; })).toBe(invalid("Invalid merchant base URL '5'!"));

        for (const key of [ MERCHANT_KEY.toLowerCase(), MERCHANT_KEY.slice(1), `U${MERCHANT_KEY.slice(1)}`, `${MERCHANT_KEY.slice(0, -1)}H` ])
            expect(changed(given => { given['merchantPublicKey'] = key; }))
                .toBe(invalid(`An EV Taler merchant needs its merchant public key, as GNU Taler writes it, not '${key}'!`));

        expect(changed(given => { given['exchanges'] = []; })).toBe(invalid("A merchant accepts at least one exchange! (Parameter 'Exchanges')"));
        expect(changed(given => { given['exchanges'] = 'all'; })).toBe(invalid('The exchanges of an EV Taler merchant must be a JSON array!'));
        expect(changed((given, exchange) => { (given['exchanges'] as JSONArray).push(clone(exchange)); })).toBe(invalid("An exchange must not be given twice! (Parameter 'Exchanges')"));
        expect(changed(given => { given['@context'] = 'https://example.org/merchant'; }))
            .toBe(invalid(`The JSON-LD context of an EV Taler merchant must be '${EV_TALER_MERCHANT_CONTEXT}'!`));

        expect(changed((_, exchange) => { exchange['baseURL'] = 'http://exchange.example.eu/'; }))
            .toBe(ofExchange(`The base URL of the exchange '${EUR_EXCHANGE}' 'http://exchange.example.eu/' must be an HTTPS URL! (Parameter 'BaseURL')`));
        expect(changed((_, exchange) => { delete exchange['masterPublicKey']; }))
            .toBe(ofExchange("An exchange needs its master public key, as GNU Taler writes it, not ''!"));
        expect(changed((_, exchange) => { exchange['currency'] = 'XXX'; }))
            .toBe(ofExchange(`The currency of the exchange '${EUR_EXCHANGE}' must be an ISO 4217 code, not 'XXX'!`));
        expect(changed((_, exchange) => { delete exchange['name']; }))
            .toBe(ofExchange(`The exchange '${EUR_EXCHANGE}' needs its name, as drivers see it! (Parameter 'Name')`));

        // A name of no language at all is none; texts of no language beside one are left out, as Styx leaves them out.
        expect(changed((_, exchange) => { exchange['name'] = { xx: 'Foo' }; }))
            .toBe(ofExchange(`The exchange '${EUR_EXCHANGE}' needs its name, as drivers see it! (Parameter 'Name')`));
        expect(changed((_, exchange) => { exchange['name'] = 'Example Exchange'; })).toBe(ofExchange("JSON property 'name' is not an object!"));

        expect(refusal(qa(gef => { gef['evTaler'] = null; }))).toBe('The EV Taler merchant must be a JSON object!');

    });

});


describe('The payment option EVTaler needs the merchant (WWCP_POI ec3dace)', () => {

    it('of a charging pool or a charging pool template, where WWCP_POI3 reads them', () => {

        expect(refusal(qa((_, pool) => { pool['paymentOptions'] = [ 'evtaler' ]; }, false)))
            .toBe("The given JSON representation of a charging station operator is invalid: The charging pool 'DE*GEF*P2' names the payment option 'EVTaler', but its operator 'DE*GEF' has no EV Taler merchant! (Parameter 'EVTaler')");
        expect(refusal(qa(gef => { gef['chargingPoolTemplates'] = [ templateNaming([ 'EVTaler' ]) ]; }, false)))
            .toBe("The given JSON representation of a charging station operator is invalid: The charging pool template 'DE*GEF*PTSUPERMARKET' names the payment option 'EVTaler', but its operator 'DE*GEF' has no EV Taler merchant! (Parameter 'EVTaler')");
        expect(refusal(qa((_, pool) => { pool['paymentOptions'] = [ 'Cash', 'EVTaler' ]; }))).toBe('taken');

    });

    it('after the last change of a change set, which may add both in either order', () => {

        const before        = RoamingNetwork.parse(qa(() => {}, false));
        const addOption     = { kind: 'UpdateProperty', entityType: 'ChargingPool', entityId: 'DE*GEF*P2', propertyName: 'paymentOptions', newValue: [ 'Contract', 'EVTaler' ] };
        const addMerchant   = { kind: 'UpdateProperty', entityType: 'ChargingStationOperator', entityId: 'DE*GEF', propertyName: 'evTaler', newValue: merchant() };

        const after = qa((gef, pool) => {
            pool['paymentOptions']  = [ 'Contract', 'EVTaler' ];
            pool['lastChange']      = AT;
            gef['lastChange']       = AT;
        });
        after['lastChange'] = AT;

        const changeSetOf = (changes: JSONObject[], afterContent: JSONObject): ChangeSet => {
            const json: JSONObject = {
                '@context':        CHANGE_SET_CONTEXT,
                roamingNetworkId:  'QA',
                createdAt:         AT,
                changes,
                beforeETags:       before.changeSetETags().map(eTag => etagToJSON(eTag)),
                afterETags:        RoamingNetwork.parse(afterContent).changeSetETags().map(eTag => etagToJSON(eTag)),
            };
            json['@id'] = changeSetIdentification(json);
            return ChangeSet.parse(json);
        };

        for (const changes of [ [ addOption, addMerchant ], [ addMerchant, addOption ] ])
            expect(get(defined(applyChangeSet(before, changeSetOf(changes, after), { checkOwnership: false }).chargingStationOperator('DE*GEF')), 'evTaler')).toEqual(merchant());

        expect(() => applyChangeSet(before, changeSetOf([ addOption ], after), { checkOwnership: false }))
            .toThrow("The charging pool 'DE*GEF*P2' names the payment option 'EVTaler', but its operator 'DE*GEF' has no EV Taler merchant!");

        // Its exchanges as the content holds them, in the order of their master public keys.
        const unordered = { ...addMerchant, newValue: { ...merchant(), exchanges: [ ...(merchant()['exchanges'] as JSONArray) ].reverse() } };
        expect(() => applyChangeSet(before, changeSetOf([ unordered, addOption ], after), { checkOwnership: false }))
            .toThrow(/'evTaler.exchanges' is not given as the content holds it: its elements are in the order the content holds them in, each once!/u);

    });

});


describe('A signing key that may sign payments (WWCP_POI ec3dace)', () => {

    /** A key of section 6 with its private seed. */
    const key = (keyId: string): { id: string, cose: string, seed: string } => {
        const vector = defined(specification.signatures.find(signature => signature.keyId.startsWith(keyId)), `The key ${keyId} of section 6`);
        return { id: vector.keyId, cose: vector.coseKey, seed: defined(vector.privateSeed, `The private seed of ${keyId}`) };
    };

    const PAYMENTS  = key('8cb46c0f');
    const PARTY     = key('a287cebc');

    const signedBy = (seed: string, bytes: Uint8Array): string =>
        sign(null, bytes, createPrivateKey({ key: Buffer.concat([ Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seed, 'hex') ]),
                                             format: 'der', type: 'pkcs8' })).toString('base64');

    /** QA, DE*GEF with the merchant, signing with the key for payments and the one for the party alone. */
    const before = RoamingNetwork.parse(qa(gef => {
        gef['signingKeys'] = [ { '@id': PAYMENTS.id, key: PAYMENTS.cose, usages: [ KeyUsages.Payments ] },
                               { '@id': PARTY.id,    key: PARTY.cose,    usages: [ KeyUsages.Party ] } ];
    }));

    const signed = (change: JSONObject, signer: { readonly id: string, readonly seed: string }): ChangeSet => {
        const eTags = before.changeSetETags().map(eTag => etagToJSON(eTag));
        const json: JSONObject = { '@context': CHANGE_SET_CONTEXT, roamingNetworkId: 'QA', createdAt: AT, changes: [ change ], beforeETags: eTags, afterETags: eTags };
        json['@id'] = changeSetIdentification(json);
        const unsigned = ChangeSet.parse(json);
        const signature: ChangeSetSignature = { algorithm: 'Ed25519', keyId: signer.id, value: '' };
        json['signatures'] = [ { ...signature, value: signedBy(signer.seed, unsigned.signingBytes(signature)) } ];
        return ChangeSet.parse(json);
    };

    const newMerchant = { kind: 'UpdateProperty', entityType: 'ChargingStationOperator', entityId: 'DE*GEF', propertyName: 'evTaler', oldValue: merchant(),
                          newValue: { ...merchant(), merchantBaseURL: 'https://taler.gef.example/instances/gef2/' } };
    const newName     = { kind: 'UpdateProperty', entityType: 'ChargingStationOperator', entityId: 'DE*GEF', propertyName: 'name', newValue: { en: 'Renamed' } };

    it('signs the merchant, and nothing else of its party', () => {

        expect(POIPublicKey.parse({ '@id': PAYMENTS.id, key: PAYMENTS.cose, usages: [ 'payments' ] }).maySign(KeyUsages.Payments)).toBe(true);

        // Named as WWCP_POI3 names it, with the property it changes.
        expect(() => { checkOwnership(before, signed(newMerchant, PARTY)); })
            .toThrow("Change 0: UpdateProperty of the ChargingStationOperator 'DE*GEF' ('evTaler') needs a signature by a signing key of the ChargingStationOperator 'DE*GEF' that may sign 'payments'!");
        expect(() => { checkOwnership(before, signed(newMerchant, PAYMENTS)); }).not.toThrow();

        expect(() => { checkOwnership(before, signed(newName, PAYMENTS)); }).toThrow(/that may sign 'party'!/u);
        expect(() => { checkOwnership(before, signed(newName, PARTY)); }).not.toThrow();

    });

});


describe('The EV Taler tariff and exchanges of an EVSE, as an app reads them from the proof of its station (WWCP_POI ec3dace)', () => {

    const proven = verifyChargingStation(anchorPQ, readJSON('proofs/QA-proof-station-DE_GEF_S1.json'), { at: AT });
    const EVSE   = 'DE*GEF*E1*1';

    /** The station as a proof gives it once DE*GEF named its merchant and its pool EVTaler, its tariffs changed as given. */
    const station = (tariff: (given: JSONObject) => JSONObject = given => given, withMerchant = true, paymentOptions: string[] = [ 'EVTaler' ]): VerifiedChargingStation => ({
        ...proven,
        operator:      withMerchant ? { ...proven.operator, evTaler: merchant() } : proven.operator,
        chargingPool:  { ...proven.chargingPool, paymentOptions },
        tariffs:       new Map([ ...proven.tariffs ].map(([ evseId, tariffs ]) => [ evseId, tariffs.map(tariff) ])),
    });

    it('is its tariff without a type, in its currency, where its pool names EVTaler', () => {

        const tariff = defined(evTalerTariffOf(station(), EVSE));

        expect(tariff['@id']).toBe('DE*GEF*T_DC');
        expect(evTalerExchangesAt(station(), EVSE).map(exchange => paymentOptionName(exchange))).toEqual([ [ [ 'en', 'EV Taler (Example Exchange, EUR)' ], [ 'de', 'EV Taler (Beispiel-Exchange, EUR)' ] ] ]);
        expect(evTalerExchangesAt(station(given => ({ ...given, currency: 'CHF' })), EVSE).map(exchange => exchange.masterPublicKey)).toEqual([ CHF_EXCHANGE ]);

        // Naming EV_TALER, in any case, among its payment means, or none.
        expect(evTalerTariffOf(station(given => ({ ...given, paymentMeans: [ 'DEBIT_CARD', 'ev_taler' ] })), EVSE)).toBeDefined();

    });

    it('is none without the merchant, the payment option, a currency, or EV_TALER among the payment means of the tariff', () => {

        expect(evTalerTariffOf(station(given => given, false), EVSE)).toBeUndefined();
        expect(evTalerTariffOf(station(given => given, true, [ 'Contract' ]), EVSE)).toBeUndefined();
        expect(evTalerTariffOf(station(given => without(given, 'currency')), EVSE)).toBeUndefined();
        expect(evTalerTariffOf(station(given => ({ ...given, paymentMeans: [ 'DEBIT_CARD' ] })), EVSE)).toBeUndefined();
        expect(evTalerTariffOf(station(given => ({ ...given, tariffType: 'REGULAR' })), EVSE)).toBeUndefined();
        expect(evTalerTariffOf(station(), 'DE*GEF*E9*9')).toBeUndefined();
        expect(evTalerExchangesAt(station(given => given, false), EVSE)).toEqual([]);

    });

});
