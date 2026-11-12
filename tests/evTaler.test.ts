import { createPrivateKey, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { AT, defined, readJSON } from './helpers.ts';
import { anchorPQ } from './qa.ts';
import { specification } from './conformance.ts';

import { applyChangeSet, checkOwnership } from '../src/history/apply.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification, type ChangeSetSignature } from '../src/history/changeSet.ts';
import { etagToJSON, etagToText } from '../src/etags.ts';
import { KeyUsages, POIPublicKey } from '../src/keys.ts';
import { canonicalJSON } from '../src/json/canonical.ts';
import { clone, get, without, type JSONArray, type JSONObject, type JSONValue } from '../src/json/value.ts';
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

/** Where drivers ask DE*GEF for offers (WWCP_POI 62390ca): the POI_API base of QA at its server. */
const OFFERS_URL = 'https://poi.gef.example/RNs/QA/';

const TEMPLATE_ID = 'DE*GEF*PTSUPERMARKET';

/** The secure dynamic QR code a charging pool naming EVTaler needs (WWCP_POI 76d3653, decision D8), on its display. */
const QR_CODE = (): JSONObject => ({ type: 'SecureDynamicQRCode', channels: [ 'Display' ] });

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

        // As WWCP_POI3 calculates the effective tree of it: EVTaler of the pool and evtaler of its template are one; the pool
        // with its secure dynamic QR code, the ETags those WWCP_POI3 at 76d3653 calculates.
        const network = RoamingNetwork.parse(qa((gef, pool) => {
            gef['chargingPoolTemplates'] = [ templateNaming([ 'Cash', 'evtaler' ]) ];
            pool['templateIds']          = [ TEMPLATE_ID ];
            pool['paymentOptions']       = [ 'Cash', 'EVTaler' ];
            pool['authenticationModes']  = [ QR_CODE() ];
        }));

        const gef  = defined((network.effectiveContent['chargingStationOperators'] as JSONObject[]).find(operator => operator['@id'] === 'DE*GEF'));
        const pool = defined((gef['chargingPools'] as JSONObject[]).find(item => item['@id'] === 'DE*GEF*P2'));

        expect(pool['paymentOptions']).toEqual([ 'Cash', 'EVTaler' ]);
        expect(network.eTags().map(etagToText)).toEqual([
            'json:sha256:hex:a1d58fb4cdb0c1f293b050201c1a5b2a88c08432a3d1557184ac33d393b6244b',
            'cbor:sha256:hex:2071dd820163ebf064c0c5781c6a25ab3a21c141194d54541fc8e8dff9a65600',
            'effectiveTree:sha256:hex:2eab22181dcb5762e43556269efca573cfdadf5a6eef424221766a547f016465',
        ]);

    });

});


describe('The EV Taler merchant of a charging station operator (WWCP_POI ec3dace)', () => {

    it('is read as WWCP_POI3 reads it, of the same JSON and CBOR, in its tree and so in every station proof', () => {

        const network = RoamingNetwork.parse(qa());

        // The ETags WWCP_POI3 calculates of the same content: its canonical JSON, its CBOR, its effective tree.
        expect(network.eTags().map(etagToText)).toEqual([
            'json:sha256:hex:e7cc50ccfb37322ec433b110631cdfc195907fe303c1ee53a783d78ec51a38f9',
            'cbor:sha256:hex:32d055713781560fa5a8e6a61a054ee5f6930e6e157b40297b166f5548f57017',
            'effectiveTree:sha256:hex:8c04435f98b009b133c4b417efbfcdeb6f0031925dfa9cac9a87d78f7dbd353a',
        ]);

        const read = evTalerMerchantOf(merchant()) as EVTalerMerchant;

        expect(read.exchanges.map(exchange => exchange.masterPublicKey)).toEqual([ EUR_EXCHANGE, CHF_EXCHANGE ]);
        expect(paymentOptionName(defined(read.exchanges[0]))).toEqual([ [ 'en', 'EV Taler (Example Exchange, EUR)' ], [ 'de', 'EV Taler (Beispiel-Exchange, EUR)' ] ]);

        // Given in any order, with its JSON-LD context: as WWCP_POI3 holds it, in the order of the master public keys.
        const unordered = { ...merchant(), '@context': EV_TALER_MERCHANT_CONTEXT, exchanges: [ ...(merchant()['exchanges'] as JSONArray) ].reverse() };
        expect((evTalerMerchantOf(unordered) as EVTalerMerchant).exchanges.map(exchange => exchange.currency)).toEqual([ 'EUR', 'CHF' ]);

        // Where drivers ask for offers, if given (WWCP_POI 62390ca): written after the exchanges and only when given, so that
        // a merchant without it is written as before, byte for byte; the ETags WWCP_POI3 at 76d3653 calculates of it.
        expect(read.offersURL).toBeUndefined();
        expect((evTalerMerchantOf({ ...merchant(), offersURL: OFFERS_URL }) as EVTalerMerchant).offersURL).toBe(OFFERS_URL);
        expect(RoamingNetwork.parse(qa(gef => { (gef['evTaler'] as JSONObject)['offersURL'] = OFFERS_URL; })).eTags().map(etagToText)).toEqual([
            'json:sha256:hex:0732836a40c90c888624bdfb11ff4dfb97291ffb44aa2230adcdc495259da5cd',
            'cbor:sha256:hex:8d92d3ebdbaab009251acf52147454e0c228e6214e388143911c0f05927e8d6d',
            'effectiveTree:sha256:hex:55b20f54050c510dc5dc5b10cef01f49a5dc35e1e15e2e995c1a18d798700b4e',
        ]);

        // Its scheme in another case is a URL Hermod writes as given, so it is held so.
        expect(RoamingNetwork.parse(qa(gef => { (gef['evTaler'] as JSONObject)['offersURL'] = 'HTTPS://poi.gef.example/RNs/QA/'; })).eTags().map(etagToText)[0])
            .toBe('json:sha256:hex:f827f20b2447ea43f8f0cfd65eed764ae5db8ee3116676e4652460a055e47451');

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

        // Where drivers ask for offers: a base URL as the merchant base URL is one, read after the exchanges, checked after it.
        expect(changed(given => { given['offersURL'] = 'http://poi.gef.example/RNs/QA/'; }))
            .toBe(invalid("The offers URL 'http://poi.gef.example/RNs/QA/' must be an HTTPS URL! (Parameter 'OffersURL')"));
        expect(changed(given => { given['offersURL'] = 'https://poi.gef.example/RNs/QA'; }))
            .toBe(invalid("The offers URL 'https://poi.gef.example/RNs/QA' must end with '/'! (Parameter 'OffersURL')"));
        expect(changed(given => { given['offersURL'] = 'https://poi.gef.example/RNs/QA/#x'; }))
            .toBe(invalid("The offers URL 'https://poi.gef.example/RNs/QA/#x' must have neither a query nor a fragment! (Parameter 'OffersURL')"));
        expect(changed(given => { given['offersURL'] = 'https://gef:secret@poi.gef.example/RNs/QA/'; }))
            .toBe(invalid("The offers URL 'https://gef:secret@poi.gef.example/RNs/QA/' must not name a user! (Parameter 'OffersURL')"));

        for (const [ offersURL, written ] of [ [ 5, '5' ], [ null, '' ], [ '', '' ], [ '  ', '  ' ] ] as const)
            expect(changed(given => { given['offersURL'] = offersURL; })).toBe(invalid(`Invalid offers URL of an EV Taler merchant '${written}'!`));

        expect(changed((given, exchange) => { exchange['currency'] = 'XXX'; given['offersURL'] = 5; }))
            .toBe(ofExchange(`The currency of the exchange '${EUR_EXCHANGE}' must be an ISO 4217 code, not 'XXX'!`));
        expect(changed(given => { given['merchantBaseURL'] = 'http://taler.gef.example/instances/de-gef/'; given['offersURL'] = 5; }))
            .toBe(invalid("Invalid offers URL of an EV Taler merchant '5'!"));
        expect(changed(given => { given['merchantBaseURL'] = 'http://taler.gef.example/instances/de-gef/'; given['offersURL'] = 'http://poi.gef.example/RNs/QA/'; }))
            .toBe(invalid("The merchant base URL 'http://taler.gef.example/instances/de-gef/' must be an HTTPS URL! (Parameter 'MerchantBaseURL')"));
        expect(changed(given => { given['exchanges'] = []; given['offersURL'] = 'http://poi.gef.example/RNs/QA/'; }))
            .toBe(invalid("The offers URL 'http://poi.gef.example/RNs/QA/' must be an HTTPS URL! (Parameter 'OffersURL')"));

    });

    it('refuses a merchant WWCP_POI3 takes and writes otherwise, as the content holds it only as it writes it', () => {

        const changed = (change: (merchant: JSONObject, exchange: JSONObject) => void): string =>
            refusal(qa(gef => {
                const given = gef['evTaler'] as JSONObject;
                change(given, defined((given['exchanges'] as JSONObject[])[0]));
            }));

        const invalid     = (error: string): string => `Invalid EV Taler merchant: ${error}`;
        const ofExchange  = (error: string): string => invalid(`Invalid exchange of an EV Taler merchant: ${error}`);
        const notWritten  = (path: string, reason: string): string => `'chargingStationOperators[0].${path}' is not written as the content holds it: ${reason}!`;

        // What WWCP_POI3 leaves out: a property it does not read, the JSON-LD context of the embedded merchant and exchange.
        expect(changed(given => { given['x'] = 1; })).toBe(invalid("The EV Taler merchant must not name the property 'x'!"));
        expect(changed((_, exchange) => { exchange['x'] = 1; })).toBe(ofExchange(`The exchange '${EUR_EXCHANGE}' must not name the property 'x'!`));
        expect(changed(given => { given['@context'] = EV_TALER_MERCHANT_CONTEXT; }))
            .toBe(notWritten('evTaler', 'embedded, an object names no JSON-LD context'));
        expect(changed((_, exchange) => { exchange['@context'] = 'https://open.charging.cloud/contexts/wwcp/roamingNetwork/evTalerExchange/v1'; }))
            .toBe(notWritten('evTaler.exchanges[0]', 'embedded, an object names no JSON-LD context'));

        // What it writes in its own form: a base URL as Hermod writes it, a currency by its code, the exchanges in the order
        // of their master public keys, a name in languages as Styx writes them.
        expect(changed(given => { given['merchantBaseURL'] = 'taler.gef.example/instances/de-gef/'; }))
            .toBe(invalid("The merchant base URL 'taler.gef.example/instances/de-gef/' is written as 'https://taler.gef.example/instances/de-gef/'!"));
        expect(changed(given => { given['merchantBaseURL'] = ' https://taler.gef.example/instances/de-gef/ '; }))
            .toBe(invalid("The merchant base URL ' https://taler.gef.example/instances/de-gef/ ' is written as 'https://taler.gef.example/instances/de-gef/'!"));
        expect(changed(given => { given['offersURL'] = 'poi.gef.example/RNs/QA/'; }))
            .toBe(invalid(`The offers URL 'poi.gef.example/RNs/QA/' is written as '${OFFERS_URL}'!`));
        expect(changed(given => { given['offersURL'] = ` ${OFFERS_URL} `; }))
            .toBe(invalid(`The offers URL ' ${OFFERS_URL} ' is written as '${OFFERS_URL}'!`));
        expect(changed(given => { given['OffersURL'] = OFFERS_URL; })).toBe(invalid("The EV Taler merchant must not name the property 'OffersURL'!"));
        expect(changed((_, exchange) => { exchange['baseURL'] = 'exchange.example.eu/'; }))
            .toBe(ofExchange(`The base URL 'exchange.example.eu/' of the exchange '${EUR_EXCHANGE}' is written as 'https://exchange.example.eu/'!`));
        expect(changed((_, exchange) => { exchange['currency'] = ' EUR'; }))
            .toBe(ofExchange(`The currency ' EUR' of the exchange '${EUR_EXCHANGE}' is written as 'EUR'!`));
        expect(changed(given => { (given['exchanges'] as JSONArray).reverse(); }))
            .toBe(notWritten('evTaler.exchanges', 'its elements are in the order the content holds them in'));
        for (const name of [ { EN: 'Example Exchange' }, { en: 'Example Exchange', xx: 'Foo' }, { en: 'Example Exchange', de: 5 } ] as JSONObject[])
            expect(changed((_, exchange) => { exchange['name'] = name; }))
                .toBe(notWritten('evTaler.exchanges[0].name', 'a text in languages names each language as Styx writes it, in lower case, with a text'));

        // Its payment options as well, which WWCP_POI3 writes trimmed and in their ordinal order.
        expect(refusal(qa((_, pool) => { pool['paymentOptions'] = [ 'EVTaler', 'Cash' ]; pool['authenticationModes'] = [ QR_CODE() ]; })))
            .toBe(notWritten('chargingPools[1].paymentOptions', 'its elements are in the order the content holds them in'));
        expect(refusal(qa((_, pool) => { pool['paymentOptions'] = [ 'Cash', 'EVTaler ' ]; pool['authenticationModes'] = [ QR_CODE() ]; })))
            .toBe(notWritten('chargingPools[1].paymentOptions', 'the texts of its elements are trimmed'));
        expect(refusal(qa((_, pool) => { pool['paymentOptions'] = [ 'Cash', 'EVTaler' ]; pool['authenticationModes'] = [ QR_CODE() ]; }))).toBe('taken');

    });

});


describe('The payment option EVTaler needs the merchant (WWCP_POI ec3dace)', () => {

    it('of a charging pool or a charging pool template, where WWCP_POI3 reads them', () => {

        expect(refusal(qa((_, pool) => { pool['paymentOptions'] = [ 'evtaler' ]; }, false)))
            .toBe("The given JSON representation of a charging station operator is invalid: The charging pool 'DE*GEF*P2' names the payment option 'EVTaler', but its operator 'DE*GEF' has no EV Taler merchant! (Parameter 'EVTaler')");
        expect(refusal(qa(gef => { gef['chargingPoolTemplates'] = [ templateNaming([ 'EVTaler' ]) ]; }, false)))
            .toBe("The given JSON representation of a charging station operator is invalid: The charging pool template 'DE*GEF*PTSUPERMARKET' names the payment option 'EVTaler', but its operator 'DE*GEF' has no EV Taler merchant! (Parameter 'EVTaler')");
        expect(refusal(qa((_, pool) => { pool['paymentOptions'] = [ 'Cash', 'EVTaler' ]; pool['authenticationModes'] = [ QR_CODE() ]; }))).toBe('taken');

    });

    it('after the last change of a change set, which may add both in either order', () => {

        const before        = RoamingNetwork.parse(qa(() => {}, false));
        const addOption     = { kind: 'UpdateProperty', entityType: 'ChargingPool', entityId: 'DE*GEF*P2', propertyName: 'paymentOptions', newValue: [ 'Contract', 'EVTaler' ] };
        const addMerchant   = { kind: 'UpdateProperty', entityType: 'ChargingStationOperator', entityId: 'DE*GEF', propertyName: 'evTaler', newValue: merchant() };
        const addQRCode     = { kind: 'UpdateProperty', entityType: 'ChargingPool', entityId: 'DE*GEF*P2', propertyName: 'authenticationModes', newValue: [ QR_CODE() ] };

        const after = qa((gef, pool) => {
            pool['paymentOptions']       = [ 'Contract', 'EVTaler' ];
            pool['authenticationModes']  = [ QR_CODE() ];
            pool['lastChange']           = AT;
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

        // The merchant, the payment option and the secure dynamic QR code in any order (WWCP_POI 76d3653).
        for (const changes of [ [ addOption, addMerchant, addQRCode ], [ addMerchant, addOption, addQRCode ], [ addQRCode, addOption, addMerchant ], [ addOption, addQRCode, addMerchant ] ])
            expect(get(defined(applyChangeSet(before, changeSetOf(changes, after), { checkOwnership: false }).chargingStationOperator('DE*GEF')), 'evTaler')).toEqual(merchant());

        expect(() => applyChangeSet(before, changeSetOf([ addOption ], after), { checkOwnership: false }))
            .toThrow("The charging pool 'DE*GEF*P2' names the payment option 'EVTaler', but its operator 'DE*GEF' has no EV Taler merchant!");
        expect(() => applyChangeSet(before, changeSetOf([ addOption, addMerchant ], after), { checkOwnership: false }))
            .toThrow("The charging pool 'DE*GEF*P2' names the payment option 'EVTaler' without the authentication mode 'SecureDynamicQRCode': an EV Taler session names the one-time password its EVSE gives right then!");

        // Its exchanges as the content holds them, in the order of their master public keys.
        const unordered = { ...addMerchant, newValue: { ...merchant(), exchanges: [ ...(merchant()['exchanges'] as JSONArray) ].reverse() } };
        expect(() => applyChangeSet(before, changeSetOf([ unordered, addOption, addQRCode ], after), { checkOwnership: false }))
            .toThrow(`Change 0: the property 'evTaler' of the charging station operator 'DE*GEF' is not given as the content holds it, '${canonicalJSON(merchant())}'!`);

    });

});


describe('The secure dynamic QR code a charging pool naming EVTaler needs (WWCP_POI 76d3653, decision D8)', () => {

    const modes = (...authenticationModes: JSONValue[]): string =>
        refusal(qa((_, pool) => { pool['authenticationModes'] = authenticationModes; }));

    const invalidMode = (mode: string, error: string): string =>
        `Invalid authentication mode '${mode}': ${error}`;

    const notWrittenAt = (path: string, why: string): string =>
        `'chargingStationOperators[0].${path}' is not written as the content holds it: ${why}!`;

    it('names the channels its stations give the URL of the code over, BLE, Display and NFC, as WWCP_POI3 reads them', () => {

        expect(modes(QR_CODE())).toBe('taken');
        expect(modes({ type: 'SecureDynamicQRCode', channels: [ 'BLE', 'Display', 'NFC' ] })).toBe('taken');
        expect(modes({ type: 'RFID' }, QR_CODE())).toBe('taken');

        // At least one, each once, by its exact name; in the words of WWCP_POI3 at 76d3653 (ZProbeNetworks, 43 cases alike).
        const needs = "Invalid authentication mode: The authentication mode 'SecureDynamicQRCode' needs the channels its URL is given over: BLE, Display, NFC! (Parameter 'Channels')";
        expect(modes({ type: 'SecureDynamicQRCode' })).toBe(invalidMode('{"type":"SecureDynamicQRCode"}', needs));
        expect(modes({ type: 'SecureDynamicQRCode', channels: [] })).toBe(invalidMode('{"type":"SecureDynamicQRCode","channels":[]}', needs));
        expect(modes({ type: 'SecureDynamicQRCode', channels: 'Display' }))
            .toBe(invalidMode('{"type":"SecureDynamicQRCode","channels":"Display"}', 'The channel of the secure dynamic QR code must be a JSON array!'));
        expect(modes({ type: 'SecureDynamicQRCode', channels: [ 'display' ] }))
            .toBe(invalidMode('{"type":"SecureDynamicQRCode","channels":["display"]}', "Invalid channel of the secure dynamic QR code 'display'!"));
        expect(modes({ type: 'SecureDynamicQRCode', channels: [ 'QR' ] }))
            .toBe(invalidMode('{"type":"SecureDynamicQRCode","channels":["QR"]}', "Invalid channel of the secure dynamic QR code 'QR'!"));
        expect(modes({ type: 'SecureDynamicQRCode', channels: [ 'Display', 'Display' ] }))
            .toBe(invalidMode('{"type":"SecureDynamicQRCode","channels":["Display","Display"]}', "Invalid authentication mode: A channel of the secure dynamic QR code must not be given twice! (Parameter 'Channels')"));

        // Only it names channels, and it names nothing of another type.
        expect(modes({ type: 'RFID', channels: [ 'BLE' ] }))
            .toBe(invalidMode('{"type":"RFID","channels":["BLE"]}', "Invalid authentication mode: Only SecureDynamicQRCode names channels, not 'RFID'! (Parameter 'Channels')"));
        expect(modes({ type: 'securedynamicqrcode', channels: [ 'BLE' ] }))
            .toBe(invalidMode('{"type":"securedynamicqrcode","channels":["BLE"]}', "Invalid authentication mode: Only SecureDynamicQRCode names channels, not 'securedynamicqrcode'! (Parameter 'Channels')"));
        expect(modes({ type: 'SecureDynamicQRCode', channels: [ 'NFC' ], number: '+491234' }))
            .toBe(invalidMode('{"type":"SecureDynamicQRCode","channels":["NFC"],"number":"+491234"}', "Invalid authentication mode: Only SMS and PhoneCall name a number, not 'SecureDynamicQRCode'! (Parameter 'Number')"));

        // A channel given twice before a card type of another type, as its constructor checks them.
        expect(modes({ type: 'SecureDynamicQRCode', cardTypes: [ 'Calypso' ], channels: [ 'BLE', 'BLE' ] }))
            .toBe(invalidMode('{"type":"SecureDynamicQRCode","cardTypes":["Calypso"],"channels":["BLE","BLE"]}', "Invalid authentication mode: A channel of the secure dynamic QR code must not be given twice! (Parameter 'Channels')"));

        // Written as the content holds it: the channels in the ordinal order of their names, none given empty.
        expect(modes({ type: 'SecureDynamicQRCode', channels: [ 'NFC', 'BLE' ] }))
            .toBe(notWrittenAt('chargingPools[1].authenticationModes[0].channels', 'its elements are in the order the content holds them in'));
        expect(modes({ type: 'RFID', channels: [] }))
            .toBe(notWrittenAt('chargingPools[1].authenticationModes[0].channels', 'a list without elements is left out'));
        expect(modes(QR_CODE(), { type: 'RFID' }))
            .toBe(notWrittenAt('chargingPools[1].authenticationModes', 'its elements are in the order the content holds them in'));

    });

    it('is effective at every charging pool naming EVTaler, its own or of a template; templates alone are not checked', () => {

        const withoutIt = "The given JSON representation of a charging station operator is invalid: The charging pool 'DE*GEF*P2' names the payment option 'EVTaler' without the authentication mode 'SecureDynamicQRCode': an EV Taler session names the one-time password its EVSE gives right then! (Parameter 'EVTaler')";

        expect(refusal(qa((_, pool) => { pool['paymentOptions'] = [ 'EVTaler' ]; }))).toBe(withoutIt);
        expect(refusal(qa((_, pool) => { pool['paymentOptions'] = [ 'evtaler' ]; }))).toBe(withoutIt);
        expect(refusal(qa((_, pool) => { pool['paymentOptions'] = [ 'EVTaler' ]; pool['authenticationModes'] = [ { type: 'RFID' } ]; }))).toBe(withoutIt);
        expect(refusal(qa((_, pool) => { pool['paymentOptions'] = [ 'EVTaler' ]; pool['authenticationModes'] = [ QR_CODE() ]; }))).toBe('taken');

        // The payment option of a template, the code of the pool, and the other way round; both of the template.
        const template = (more: JSONObject): JSONObject => ({ ...without(templateNaming([]), 'paymentOptions'), ...more });
        const ofTemplate = (more: JSONObject, pool: JSONObject = {}): string =>
            refusal(qa((gef, given) => { gef['chargingPoolTemplates'] = [ template(more) ]; given['templateIds'] = [ TEMPLATE_ID ]; Object.assign(given, pool); }));
        expect(ofTemplate({ paymentOptions: [ 'EVTaler' ] })).toBe(withoutIt);
        expect(ofTemplate({ paymentOptions: [ 'EVTaler' ] }, { authenticationModes: [ QR_CODE() ] })).toBe('taken');
        expect(ofTemplate({ authenticationModes: [ QR_CODE() ] }, { paymentOptions: [ 'EVTaler' ] })).toBe('taken');
        expect(ofTemplate({ paymentOptions: [ 'EVTaler' ], authenticationModes: [ QR_CODE() ] })).toBe('taken');
        expect(refusal(qa(gef => { gef['chargingPoolTemplates'] = [ template({ paymentOptions: [ 'EVTaler' ] }) ]; }))).toBe('taken');

        // The first pool in the order of their identifications.
        expect(refusal(qa((gef, p2) => {
            p2['paymentOptions'] = [ 'EVTaler' ];
            defined((gef['chargingPools'] as JSONObject[]).find(pool => pool['@id'] === 'DE*GEF*P1'))['paymentOptions'] = [ 'EVTaler' ];
        }))).toBe(withoutIt.replace('DE*GEF*P2', 'DE*GEF*P1'));

        // Without a merchant, the merchant is missing first, as before.
        expect(refusal(qa((_, pool) => { pool['paymentOptions'] = [ 'EVTaler' ]; pool['authenticationModes'] = [ QR_CODE() ]; }, false)))
            .toBe("The given JSON representation of a charging station operator is invalid: The charging pool 'DE*GEF*P2' names the payment option 'EVTaler', but its operator 'DE*GEF' has no EV Taler merchant! (Parameter 'EVTaler')");

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

    /**
     * The station as a proof gives it, DE*GEF with this merchant or none (the proof of the head names the one of example
     * A15), its pool with the given payment options, its tariffs changed as given.
     */
    const station = (tariff: (given: JSONObject) => JSONObject = given => given, withMerchant = true, paymentOptions: string[] = [ 'EVTaler' ]): VerifiedChargingStation => ({
        ...proven,
        operator:      withMerchant ? { ...proven.operator, evTaler: merchant() } : without(proven.operator, 'evTaler'),
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
