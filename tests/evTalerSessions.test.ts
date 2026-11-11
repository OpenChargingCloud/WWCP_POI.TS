import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { specification } from './conformance.ts';
import { AT, asText, defined, readJSON } from './helpers.ts';
import { anchorPQ } from './qa.ts';

import { NetDecimal, talerAmountOf, writeAmount, writeDecimal, EVTalerRates } from '../src/evTaler/amounts.ts';
import { EVTalerContractTerms, EVTalerAmountChecks, evTalerSessionPrices, type EVTalerVerifiedStep } from '../src/evTaler/contractTerms.ts';
import { EVTalerSignedMeterValue, type EVTalerMeasurementKey, type EVTalerMeterReading } from '../src/evTaler/meterValue.ts';
import { EVTalerPayURI } from '../src/evTaler/payURI.ts';
import { EVTalerSettlement, EV_TALER_SETTLEMENT_CONTEXT } from '../src/evTaler/settlement.ts';
import { EVTalerCovers, EVTalerStep } from '../src/evTaler/step.ts';
import { hash } from '../src/crypto/hash.ts';
import { toBase64, toHex } from '../src/encoding/text.ts';
import { canonicalJSONBytes } from '../src/json/canonical.ts';
import { Decimal } from '../src/json/decimal.ts';
import { clone, type JSONObject, type JSONValue } from '../src/json/value.ts';
import { POIPublicKey } from '../src/keys.ts';
import { PRICE_STATEMENT_CONTEXT } from '../src/proofs/priceStatement.ts';
import { evTalerMerchantOf, type EVTalerMerchant } from '../src/network/evTaler.ts';
import { verifyChargingStation, verifyPriceStatements, type VerifiedChargingStation } from '../src/verifier/chargingStation.ts';


// EV Taler, phase 2 (WWCP_POI c2d39e5, concepts/EVTaler.md 5 and 7, EVTalerEvidenceTests.cs): the steps of a session in
// their contract terms, checked against a station proof, and the settlement statement, refused without both signed meter
// values. The station is DE*GEF*S1 as example A15 proves it, with the EV Taler merchant of DE*GEF: its energy meter
// DE*GEF*M1*1 given a measurement key of these tests, and DE*GEF signing settlements with Ed25519 keys of section 6 for
// payments, whose private seeds the specification gives. Every refusal in the words of WWCP_POI3: ZProbeEVTalerSteps took
// 178 sessions, steps, pay URIs and settlement statements alike in WWCP_POI3 at c2d39e5 and here, word for word.

const E1           = 'DE*GEF*E1*1';
const SESSION      = 'kq3Vd0sY0f9hJ2bW8Qm1tA';
const SERIAL       = 'DCM-2026-001-1';
const T_DC         = 'DE*GEF*T_DC';
const START        = Date.parse(AT);

const proven       = verifyChargingStation(anchorPQ, readJSON('published/QA-DE-GEF-E1-1-evTaler-proof.json'), { at: AT, evseId: E1 });
const merchant     = evTalerMerchantOf(proven.operator['evTaler'] ?? null) as EVTalerMerchant;

const METER        = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const OTHER_METER  = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const spki         = (key: KeyObject): Uint8Array => new Uint8Array(key.export({ format: 'der', type: 'spki' }));

/** A key of section 6 with its private seed, as a signing key of DE*GEF that may sign the given usage. */
function partyKey(keyId: string, usage: string): { key: POIPublicKey, sign: (bytes: Uint8Array) => string, algorithm: string } {
    const vector  = defined(specification.signatures.find(signature => signature.keyId.startsWith(keyId) && signature.privateSeed !== undefined), keyId);
    const seed    = Buffer.from(defined(vector.privateSeed), 'hex');
    const secret  = createPrivateKey({ key: Buffer.concat([ Buffer.from('302e020100300506032b657004220420', 'hex'), seed ]), format: 'der', type: 'pkcs8' });
    return {
        key:        POIPublicKey.parse({ '@id': vector.keyId, key: vector.coseKey, usages: [ usage ] }),
        sign:       bytes => sign(null, bytes, secret).toString('base64'),
        algorithm:  vector.algorithm,
    };
}

const PAYMENTS     = partyKey('06c3b3e2', 'payments');
const TARIFFS      = partyKey('ea671729', 'priceStatements');

/** The station as the proof gives it, its meter of E1 with the key of these tests, DE*GEF with the given keys besides its own. */
const station = (keys: readonly POIPublicKey[] = [ PAYMENTS.key ]): VerifiedChargingStation => ({
    ...proven,
    evses:                proven.evses.map(evse => evse['@id'] !== E1 ? evse : {
                              ...evse,
                              energyMeter: { ...(evse['energyMeter'] as JSONObject), publicKeys: [ { '@id': toHex(hash('sha256', spki(METER.publicKey))), key: toBase64(spki(METER.publicKey)) } ] },
                          }),
    operatorSigningKeys:  [ ...proven.operatorSigningKeys, ...keys ],
});

const STATION = station();

/** A signed meter value of the test format: a JSON payload naming the meter, the time and the energy, and its ECDSA signature. */
function meterValue(signer: KeyObject, kWh: string, at: number, serial = SERIAL): EVTalerSignedMeterValue {
    const payload   = JSON.stringify({ serial, time: new Date(at).toISOString(), kWh });
    const signature = sign('sha256', Buffer.from(payload), { key: signer, dsaEncoding: 'ieee-p1363' }).toString('base64');
    return EVTalerSignedMeterValue.create(Buffer.from(JSON.stringify({ payload, signature })).toString('base64'), 'WWCP-TEST', 'ECDSA-secp256r1-SHA256');
}

/** The transparency software of the test format. */
function verifier(value: EVTalerSignedMeterValue, key: EVTalerMeasurementKey): EVTalerMeterReading {
    if (value.encodingMethod !== 'WWCP-TEST')
        throw new Error(`Unknown format '${value.encodingMethod}'!`);
    const data = JSON.parse(Buffer.from(value.signedMeterData, 'base64').toString('utf8')) as { payload: string, signature: string };
    if (!verify('sha256', Buffer.from(data.payload), { key: createPublicKey({ key: Buffer.from(key.key), format: 'der', type: 'spki' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(data.signature, 'base64')))
        throw new Error('Invalid signature!');
    const reading = JSON.parse(data.payload) as { serial: string, time: string, kWh: string };
    return { meterSerialNumber: reading.serial, timestamp: Date.parse(reading.time), energy: defined(NetDecimal.parse(reading.kWh)) };
}

const step = (number: number, from: number, to: number, previous?: string, start?: EVTalerSignedMeterValue, priceStatement?: string, unit = 'kWh'): EVTalerStep =>
    EVTalerStep.create({ roamingNetworkId: 'QA', EVSEId: E1, sessionId: SESSION, step: number, previousOrderId: previous, chargingTariffId: T_DC,
                         priceStatement, covers: EVTalerCovers.create(from, to, unit), startMeterValue: start });

/** The contract terms of a step, as a merchant backend makes them (version 0). */
function termsJSON(of: EVTalerStep, orderId: string, amount: string, at: number, more: JSONObject = {}): JSONObject {
    const seconds  = Math.floor(at / 1000);
    const currency = amount.split(':')[0] ?? '';
    return {
        order_id: orderId, summary: `Charging at ${of.EVSEId}, step ${String(of.step)}: ${of.covers.toString()}`, amount, max_fee: `${currency}:0.10`,
        products: [ { description: 'Charging', quantity: 5, unit: 'kWh' } ],
        timestamp: { t_s: seconds }, pay_deadline: { t_s: seconds + 120 }, refund_deadline: { t_s: seconds + 86400 }, wire_transfer_deadline: { t_s: seconds + 2 * 86400 },
        auto_refund: { d_us: 86400 * 1000000 }, merchant_pub: merchant.merchantPublicKey, merchant_base_url: merchant.merchantBaseURL,
        merchant: { name: 'GraphDefined' }, h_wire: 'ABCD', wire_method: 'iban',
        exchanges: [ { url: 'https://exchange.example.eu/', priority: 1024, master_pub: 'F80MFRG8HVH6R9CQ47KRFQSJP3T6DBJ4K1D9B703RJY3Z39TBMJ0' } ],
        nonce: 'NONCE', extra: { wwcp: of.toJSON() }, ...more,
    };
}

const terms = (of: EVTalerStep, orderId: string, amount: string, at: number, more: JSONObject = {}): EVTalerContractTerms =>
    EVTalerContractTerms.parse(termsJSON(of, orderId, amount, at, more));

/** Why the given check is refused, word for word; 'taken' otherwise. */
function refusal(check: () => unknown): string {
    try {
        check();
    }
    catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
    return 'taken';
}

/** The settlement statement of a session, signed by DE*GEF with the given key as WWCP_POI3 signs it. */
function settle(steps: readonly EVTalerVerifiedStep[], start: EVTalerSignedMeterValue, end: EVTalerSignedMeterValue, startAt: number, endAt: number,
                energy: string, price: string, signer = PAYMENTS, signedAt = endAt + 60_000): JSONObject {
    const paid  = steps.reduce((total, item) => total.plus(item.terms.amount), NetDecimal.ZERO);
    const owed  = paid.minus(defined(NetDecimal.parse(price)));
    const json: JSONObject = {
        '@context': EV_TALER_SETTLEMENT_CONTEXT, roamingNetworkId: 'QA', EVSEId: E1, sessionId: SESSION, merchantPublicKey: merchant.merchantPublicKey,
        chargingTariffId: T_DC, ...(steps[0]?.step.priceStatement === undefined ? {} : { priceStatement: steps[0].step.priceStatement }),
        start: new Date(startAt).toISOString(), end: new Date(endAt).toISOString(), meterValues: [ start.toJSON(), end.toJSON() ], energy, currency: 'EUR',
        orders: steps.map(item => ({ orderId: item.terms.orderId, amount: writeAmount(item.terms.amount, 'EUR') })),
        price: writeAmount(defined(NetDecimal.parse(price)), 'EUR'), paid: writeAmount(paid, 'EUR'), refunded: writeAmount(owed.isNegative() ? NetDecimal.ZERO : owed, 'EUR'),
        role: 'chargingStationOperator', signer: 'DE*GEF', signedAt: new Date(signedAt).toISOString(), algorithm: signer.algorithm, keyId: signer.key.id,
    };
    json['value'] = signer.sign(canonicalJSONBytes(json));
    return json;
}

const changed = (json: JSONObject, change: (copy: JSONObject) => void): JSONObject => {
    const copy = clone(json);
    change(copy);
    return copy;
};


describe('EV Taler, phase 2: the steps of a session and its settlement (WWCP_POI c2d39e5)', () => {

    const startAt  = START + 60_000;
    const endAt    = START + 35 * 60_000;
    const start    = meterValue(METER.privateKey, '1234.5',   startAt);
    const end      = meterValue(METER.privateKey, '1241.912', endAt);

    it('reads a step and writes it as read, and refuses one otherwise, in the words of WWCP_POI3', () => {

        const json = step(2, 5, 10, '2026.301-01', start).toJSON();

        expect(EVTalerStep.parse(json).toJSON()).toEqual(json);
        expect(EVTalerStep.parse(json).startMeterValue?.equals(start)).toBe(true);
        expect(json['covers']).toEqual({ from: '5', to: '10', unit: 'kWh' });

        const refused = (change: (copy: JSONObject) => void): string => refusal(() => EVTalerStep.parse(changed(json, change)));

        expect(refused(copy => { delete copy['startMeterValue']; })).toBe('Every step after the first one, and only those, names the signed meter value at the start of the session!');
        expect(refused(copy => { delete copy['previousOrderId']; })).toBe('Every step after the first one, and only those, names the order of the step before!');
        expect(refused(copy => { copy['unknown'] = 1; })).toBe("A step of an EV Taler session has no 'unknown'!");
        expect(refused(copy => { copy['@context'] = 'https://example.org/step'; })).toBe("The JSON-LD context of a step of an EV Taler session must be 'https://open.charging.cloud/contexts/wwcp/roamingNetwork/evTalerStep/v1'!");
        expect(refused(copy => { copy['sessionId'] = 'kq3Vd0sY0f9hJ2bW8Qm1tB'; })).toBe('The session of a step is 128 bits, base64url without padding: 22 characters!');
        expect(refused(copy => { copy['step'] = 0; })).toBe('The number of a step is an integer from 1 on!');
        expect(refused(copy => { copy['step'] = Decimal.parse('2.0'); })).toBe('The number of a step is an integer from 1 on!');
        expect(refused(copy => { copy['covers'] = { from: '5', to: 10, unit: 'kWh' }; })).toBe('The \'to\' must be a decimal written as a text, not negative, e.g. "3.25"!');
        expect(refused(copy => { copy['covers'] = { from: '05', to: '10', unit: 'kWh' }; })).toBe('The \'from\' must be a decimal written as a text, not negative, e.g. "3.25"!');
        expect(refused(copy => { (copy['covers'] as JSONObject)['unit'] = 'Wh'; })).toBe("A step covers from less than to, in 'kWh' or 'min'!");
        expect(refused(copy => { copy['EVSEId'] = 'DE*GEF'; })).toBe("Invalid EVSE 'DE*GEF' of a step!");
        expect(refused(copy => { copy['priceStatement'] = 'A'.repeat(64); })).toBe('The price statement of a step is its digest: 64 lowercase hexadecimal digits!');
        expect(refused(copy => { copy['startMeterValue'] = 'x'; })).toBe('The start meter value of a step is invalid: A signed meter value must be a JSON object!');

        expect(refusal(() => step(1, 2, 5))).toBe('Step 1 covers from the start of the session, from 0!');
        expect(refusal(() => step(1, 0, 5, undefined, start))).toBe('Every step after the first one, and only those, names the signed meter value at the start of the session!');
        expect(refusal(() => EVTalerCovers.create(5, 5, 'kWh'))).toBe('A step covers from 5 to 5: from not negative and less than to!');

    });

    it('reads a signed meter value as OCPP 2.1 sends it: canonical Base64, nonempty methods, nothing else', () => {

        const json = start.toJSON();

        expect(EVTalerSignedMeterValue.parse(json).equals(start)).toBe(true);
        expect(refusal(() => EVTalerSignedMeterValue.parse({ ...json, x: 1 }))).toBe("A signed meter value has no 'x'!");
        expect(refusal(() => EVTalerSignedMeterValue.parse({ ...json, signedMeterData: 'QUJD\nRA==' }))).toBe('The signed meter data must be nonempty canonical Base64!');
        expect(refusal(() => EVTalerSignedMeterValue.parse({ ...json, encodingMethod: ' OCMF' }))).toBe('The encoding method of a signed meter value must be a nonempty text without surrounding whitespace!');
        expect(refusal(() => EVTalerSignedMeterValue.parse({ ...json, publicKey: 'QUJDRA=' }))).toBe('The public key of a signed meter value must be nonempty canonical Base64!');
        expect(refusal(() => EVTalerSignedMeterValue.parse({ ...json, encodingMethod: 1 })))
            .toBe('A signed meter value names its signed meter data and its encoding method, and maybe its signing method and its public key, as texts!');

    });

    it('reads a taler://pay URI and checks that it names the merchant of the operator', () => {

        const uri = EVTalerPayURI.parse('taler://pay/taler.gef.example/instances/de-gef/2026.301-01ABCDEF1/?c=CLAIMTOKEN');

        expect([ uri.merchantBaseURL, uri.orderId, uri.sessionId, uri.claimToken ]).toEqual([ 'https://taler.gef.example/instances/de-gef/', '2026.301-01ABCDEF1', undefined, 'CLAIMTOKEN' ]);
        expect(() => { uri.verify(merchant); }).not.toThrow();

        // The scheme and the host in any case, the path as written.
        const upper = EVTalerPayURI.parse('TALER://PAY/TALER.GEF.EXAMPLE/instances/de-gef/O1/S1');
        expect(upper.sessionId).toBe('S1');
        expect(() => { upper.verify(merchant); }).not.toThrow();

        expect(refusal(() => { EVTalerPayURI.parse('taler://pay/taler.evil.example/instances/de-gef/O1/').verify(merchant); }))
            .toBe("The offer is one of the merchant 'https://taler.evil.example/instances/de-gef/', not of the operator's 'https://taler.gef.example/instances/de-gef/'!");
        expect(refusal(() => { EVTalerPayURI.parse('taler://pay/taler.gef.example/instances/de-gef-2/O1/').verify(merchant); }))
            .toBe("The offer is one of the merchant 'https://taler.gef.example/instances/de-gef-2/', not of the operator's 'https://taler.gef.example/instances/de-gef/'!");

        expect(refusal(() => EVTalerPayURI.parse('taler+http://pay/taler.gef.example/instances/de-gef/O1/'))).toBe('An EV Taler offer is paid at a merchant reached with HTTPS: taler+http:// is refused!');
        expect(refusal(() => EVTalerPayURI.parse('taler://withdraw/exchange.example.eu/W1'))).toBe("'taler://withdraw/exchange.example.eu/W1' is no taler://pay URI!");
        expect(refusal(() => EVTalerPayURI.parse('taler://pay/taler.gef.example'))).toBe("A taler://pay URI names the merchant's host, maybe a path, the order, and GNU Taler's session, maybe empty!");
        expect(refusal(() => EVTalerPayURI.parse('taler://pay/taler.gef.example/instances/de-gef/O1/S1?c=A&c=B'))).toBe('A taler://pay URI names at most one claim token, not empty!');

    });

    it('checks a session in steps and settles it: 5 kWh and a reserve of 1 €, the next 5 kWh, 7.412 kWh at 0.65 €', () => {

        const step1 = terms(step(1, 0, 5), '2026.309-01', 'EUR:4.25', START).verify(STATION, [], undefined, undefined);
        const step2 = terms(step(2, 5, 10, '2026.309-01', start), '2026.309-02', 'EUR:3.25', START + 20 * 60_000).verify(STATION, [], step1, verifier);

        expect([ step1.amountCheck, writeDecimal(defined(step1.stepPrice)), writeDecimal(defined(step1.flatFee)), writeDecimal(defined(step1.reserve)) ]).toEqual([ 'exact', '3.25', '0', '1' ]);
        expect(step1.start).toBeUndefined();
        expect([ step2.amountCheck, writeDecimal(defined(step2.start).reading.energy), step2.start?.signedBy ]).toEqual([ 'exact', '1234.5', 'DE*GEF*M1*1' ]);

        const json        = settle([ step1, step2 ], start, end, startAt, endAt, '7.412', '4.82');
        const settlement  = EVTalerSettlement.parse(json);
        const verified    = settlement.verify(STATION, [ step1, step2 ], verifier);

        expect([ json['price'], json['paid'], json['refunded'], json['energy'] ]).toEqual([ '4.82', '7.50', '2.68', '7.412' ]);
        expect([ writeDecimal(verified.energy), writeDecimal(defined(verified.computedPrice)), verified.priceCheck, verified.diagnostics ]).toEqual([ '7.412', '4.82', 'exact', [] ]);

    });

    it('refuses offers of another merchant, exchange, currency, tariff or price, and steps not following on', () => {

        const at     = START;
        const step1  = terms(step(1, 0, 5), 'O1', 'EUR:4.25', at).verify(STATION, [], undefined, undefined);
        const tried  = (of: EVTalerContractTerms, previous?: EVTalerVerifiedStep, withVerifier = false): string =>
            refusal(() => of.verify(STATION, [], previous, withVerifier ? verifier : undefined));

        expect(tried(terms(step(1, 0, 5), 'O1', 'EUR:4.25', at, { merchant_pub: 'YJ7H5JVNVM5SG5FAE3BGQ35AEPHXBH27MWNRPFQ0SVW9BH0BN9B0' })))
            .toBe("The step is offered by the merchant 'https://taler.gef.example/instances/de-gef/' (YJ7H5JVNVM5SG5FAE3BGQ35AEPHXBH27MWNRPFQ0SVW9BH0BN9B0), not by the operator's 'https://taler.gef.example/instances/de-gef/' (ESMBKNR5CMZPAYH9AD0QNKCPYSJSE0EN5MH4FMPKN683R63HMD3G)!");
        expect(tried(terms(step(1, 0, 5), 'O1', 'EUR:4.25', at, { exchanges: [ { url: 'https://exchange.evil.example/', master_pub: 'F80MFRG8HVH6R9CQ47KRFQSJP3T6DBJ4K1D9B703RJY3Z39TBMJ0' } ] })))
            .toBe("The exchange 'https://exchange.evil.example/' (F80MFRG8HVH6R9CQ47KRFQSJP3T6DBJ4K1D9B703RJY3Z39TBMJ0) of the step is not one of the operator's evTaler in 'EUR'!");
        expect(tried(terms(step(1, 0, 5), 'O1', 'CHF:4.25', at, { exchanges: [ { url: 'https://exchange.example.ch/', master_pub: 'YJ7H5JVNVM5SG5FAE3BGQ35AEPHXBH27MWNRPFQ0SVW9BH0BN9B0' } ] })))
            .toBe("The step is paid in 'CHF', not in 'EUR', the currency of the EV Taler tariff!");
        expect(tried(terms(EVTalerStep.create({ roamingNetworkId: 'QA', EVSEId: E1, sessionId: SESSION, step: 1, chargingTariffId: 'DE*GEF*T_OTHER', covers: EVTalerCovers.create(0, 5, 'kWh') }), 'O1', 'EUR:4.25', at)))
            .toBe("The step names the charging tariff 'DE*GEF*T_OTHER', not the EV Taler tariff 'DE*GEF*T_DC' of the EVSE 'DE*GEF*E1*1'!");
        expect(tried(terms(step(1, 0, 5), 'O1', 'EUR:3.20', at)))
            .toBe('The amount 3.20 EUR of step 1 is not what it covers, 0 to 5 kWh, at the price of the session: 3.25 EUR, the flat fee and the reserve!');
        expect(tried(terms(step(1, 0, 30, undefined, undefined, undefined, 'min'), 'O1', 'EUR:4.25', at)))
            .toBe("The charging tariff does not price what a step covers, 'min'!");
        expect(tried(terms(step(1, 0, 5, undefined, undefined, 'a'.repeat(64)), 'O1', 'EUR:4.25', at)))
            .toBe(`The step names the price statement '${'a'.repeat(64)}', which is not one current at the start of the session pricing its tariff!`);
        expect(tried(terms(step(1, 0, 5), 'O1', 'EUR:4.25', at, { auto_refund: { d_us: 0 } })))
            .toBe('The wallet must pick the refund of a step up by itself: contract terms of a step have an auto refund!');

        expect(tried(terms(step(2, 5, 10, 'O1', start), 'O2', 'EUR:3.30', at), step1, true))
            .toBe('The amount 3.30 EUR of step 2 is not what it covers, 5 to 10 kWh, at the price of the session: 3.25 EUR!');
        expect(tried(terms(step(2, 6, 11, 'O1', start), 'O2', 'EUR:3.25', at), step1, true))
            .toBe('Step 2 does not follow step 1: one session, EVSE, tariff and price statement, the order before, what it covers following on!');
        expect(tried(terms(step(2, 5, 10, 'O1', start), 'O2', 'EUR:3.25', at)))
            .toBe('Step 2 is checked after the step before it!');
        expect(tried(terms(step(2, 5, 10, 'O1', start), 'O2', 'EUR:3.25', at), step1))
            .toBe('From step 2 on, the signed meter value at the start is verified: a transparency software is needed!');

        // A pay URI of the offer names its merchant and its order.
        expect(refusal(() => terms(step(1, 0, 5), 'O1', 'EUR:4.25', at).verify(STATION, [], undefined, undefined, EVTalerPayURI.parse('taler://pay/taler.gef.example/instances/de-gef/O2/'))))
            .toBe('The taler://pay URI names another merchant or another order than the contract terms!');

    });

    it('verifies the start value with the key the proof gives, and keeps it from step to step', () => {

        const at     = START;
        const step1  = terms(step(1, 0, 5), 'O1', 'EUR:4.25', at).verify(STATION, [], undefined, undefined);
        const step2  = terms(step(2, 5, 10, 'O1', start), 'O2', 'EUR:3.25', at).verify(STATION, [], step1, verifier);
        const tried  = (value: EVTalerSignedMeterValue, previous = step1, number = 2, before = 'O1'): string =>
            refusal(() => terms(step(number, 5 * (number - 1), 5 * number, before, value), `O${String(number)}`, 'EUR:3.25', at).verify(STATION, [], previous, verifier));

        const keyId  = toHex(hash('sha256', spki(METER.publicKey)));

        expect(tried(meterValue(OTHER_METER.privateKey, '1234.5', startAt)))
            .toBe(`The signed meter value is not verified with the key '${keyId}' of 'DE*GEF*M1*1': Invalid signature!`);
        expect(tried(meterValue(METER.privateKey, '1234.5', startAt, 'M-2')))
            .toBe(`The signed meter value names the serial number 'M-2', not the one '${SERIAL}' of 'DE*GEF*M1*1' the proof gives!`);
        expect(tried(EVTalerSignedMeterValue.create(start.signedMeterData, start.encodingMethod, start.signingMethod, toBase64(spki(OTHER_METER.publicKey)))))
            .toBe("The proof gives no measurement public key of the meter of the EVSE 'DE*GEF*E1*1' or of its station that is the one of the signed meter value!");
        expect(tried(EVTalerSignedMeterValue.create(start.signedMeterData, 'OCMF', start.signingMethod)))
            .toBe(`The signed meter value is not verified with the key '${keyId}' of 'DE*GEF*M1*1': Unknown format 'OCMF'!`);
        expect(tried(meterValue(METER.privateKey, '1234.6', startAt), step2, 3, 'O2'))
            .toBe('Step 3 names another signed meter value at the start than step 2!');
        expect(tried(start, step2, 3, 'O2')).toBe('taken');

    });

    it('settles no session without both signed meter values, signed by the operator with a key for payments', () => {

        const step1   = terms(step(1, 0, 5), 'O1', 'EUR:4.25', START).verify(STATION, [], undefined, undefined);
        const step2   = terms(step(2, 5, 10, 'O1', start), 'O2', 'EUR:3.25', START + 20 * 60_000).verify(STATION, [], step1, verifier);
        const steps   = [ step1, step2 ];
        const good    = settle(steps, start, end, startAt, endAt, '7.412', '4.82');
        const tried   = (json: JSONObject, of: readonly EVTalerVerifiedStep[] = steps, at: VerifiedChargingStation = STATION): string =>
            refusal(() => EVTalerSettlement.parse(json).verify(at, of, verifier));

        expect(tried(good)).toBe('taken');
        expect(refusal(() => EVTalerSettlement.parse(changed(good, copy => { (copy['meterValues'] as JSONValue[]).pop(); }))))
            .toBe('A settlement statement names both signed meter values, at the start and at the end!');
        expect(refusal(() => EVTalerSettlement.parse(changed(good, copy => { copy['refunded'] = '2.67'; }))))
            .toBe('What a settlement statement says was paid is the sum of its orders, and what was refunded the paid amount less the price!');
        expect(refusal(() => EVTalerSettlement.parse(changed(good, copy => { copy['start'] = 'yesterday'; })))).toBe("The 'start' must be an ISO 8601 timestamp!");

        expect(tried(settle(steps, end, start, endAt, startAt, '7.412', '4.82')))
            .toBe('The signed meter value at the start is not the one the contract terms of the steps name!');
        expect(tried(settle(steps, start, meterValue(OTHER_METER.privateKey, '1241.912', endAt), startAt, endAt, '7.412', '4.82')))
            .toBe(`No settlement without both signed meter values: The signed meter value is not verified with the key '${toHex(hash('sha256', spki(METER.publicKey)))}' of 'DE*GEF*M1*1': Invalid signature!`);
        expect(tried(settle(steps, start, meterValue(METER.privateKey, '1230', endAt), startAt, endAt, '0', '0.50')))
            .toBe('The signed meter value at the end is before or below the one at the start!');
        expect(tried(settle(steps, start, end, startAt, endAt, '7.5', '4.82')))
            .toBe('The start, the end and the energy of the settlement statement are not those of its signed meter values!');
        expect(tried(settle(steps, start, end, startAt, endAt + 1000, '7.412', '4.82')))
            .toBe('The start, the end and the energy of the settlement statement are not those of its signed meter values!');
        expect(tried(settle(steps, start, end, startAt, endAt, '7.412', '4.83')))
            .toBe('The price of the session is 4.82 EUR by its prices, not 4.83 EUR!');
        expect(tried(good, [ step1 ]))
            .toBe('The settlement statement names the orders of the steps of its session, in their order, each with what it took!');
        expect(tried(settle(steps, start, end, startAt, endAt, '7.412', '4.82', PAYMENTS, endAt - 1000)))
            .toBe('A settlement statement is signed after the end of its session!');
        expect(tried(changed(good, copy => { copy['value'] = toBase64(new Uint8Array(64)); })))
            .toBe('The signature of the settlement statement is invalid: The signature is invalid!');
        expect(tried(changed(good, copy => { copy['value'] = 'QUJDRA='; })))
            .toBe('The signature of the settlement statement is invalid: The input is not a valid Base-64 string as it contains a non-base 64 character, more than two padding characters, or an illegal character among the padding characters.');
        expect(tried(changed(good, copy => { copy['algorithm'] = 'XS256'; }))).toBe('Unknown or noncanonical signature algorithm of the settlement statement!');
        expect(tried(changed(good, copy => { copy['signer'] = 'DE*XYZ'; }))).toBe('The settlement statement is not one of the operator of the station!');

        // A key for payments, not one for price statements alone, nor one the proof does not give.
        const keys = station([ PAYMENTS.key, TARIFFS.key ]);
        expect(tried(settle(steps, start, end, startAt, endAt, '7.412', '4.82', TARIFFS), steps, keys))
            .toBe('The settlement statement is not signed with a key of the operator for payments, valid when it was signed!');
        expect(tried(good, steps, proven)).not.toBe('taken');

        // More than was paid: what the credit did not cover is not collected (5.5).
        const far = EVTalerSettlement.parse(settle(steps, start, meterValue(METER.privateKey, '1253.5', endAt), startAt, endAt, '19', '12.35')).verify(STATION, steps, verifier);
        expect(far.diagnostics).toEqual([ 'The price is more than was paid: what the credit did not cover is not collected (5.5).' ]);

    });

    it('prices a session by the price statement current when it began, which every step names', () => {

        const statements = readJSON('published/QA-epoch-2-checkpoint-0-priceStatements.json');
        const digest     = defined([ ...verifyPriceStatements(STATION, statements, { at: START }).values() ][0]).digest;

        // 5 kWh at 0.59 € of the statement, no flat fee: 2.95 €.
        const step1 = terms(step(1, 0, 5, undefined, undefined, digest), 'O1', 'EUR:2.95', START).verify(STATION, statements, undefined, undefined);

        expect([ step1.priceStatement?.digest, writeDecimal(defined(step1.stepPrice)), writeDecimal(defined(step1.reserve)), step1.amountCheck ]).toEqual([ digest, '2.95', '0', EVTalerAmountChecks.Exact ]);
        expect(refusal(() => terms(step(1, 0, 5), 'O1', 'EUR:4.25', START).verify(STATION, statements, undefined, undefined)))
            .toBe(`The session is priced by the price statement '${digest}', which the step does not name!`);

    });

    it('prices a session by the most specific price statement current when it begins, as the backend makes its steps (WWCP_POI 62390ca)', () => {

        const keys = station([ PAYMENTS.key, TARIFFS.key ]);

        /** A first price statement of the given entity pricing T_DC by the kWh at the given price, signed by DE*GEF for price statements. */
        const statement = (entityType: string, entityId: string, price: number): JSONObject => {
            const json: JSONObject = {
                '@context': PRICE_STATEMENT_CONTEXT, roamingNetworkId: 'QA', entityType, entityId,
                priceStatus: { prices: [ { chargingTariffId: T_DC, elements: [ { priceComponents: [ { type: 'ENERGY', price, stepSize: 1 } ] } ] } ] },
                validFrom: new Date(START - 60_000).toISOString(), validUntil: new Date(START + 3_600_000).toISOString(), sequence: 0,
                role: 'chargingStationOperator', signer: 'DE*GEF', signedAt: new Date(START - 60_000).toISOString(), algorithm: TARIFFS.algorithm, keyId: TARIFFS.key.id,
            };
            json['value'] = TARIFFS.sign(canonicalJSONBytes(json));
            return json;
        };

        const pool      = statement('ChargingPool',    asText(proven.chargingPool['@id']),    3);
        const ofStation = statement('ChargingStation', asText(proven.chargingStation['@id']), 2);
        const ofEVSE    = statement('EVSE',            E1,                                    1);

        const priced = (statements: JSONObject[]): [ string | undefined, string | undefined, JSONValue ] => {
            const prices = evTalerSessionPrices(keys, E1, statements, START);
            return [ asText(prices.tariff['@id']), prices.priceStatement?.statement.entityType, prices.elements[0]?.['priceComponents'] ?? null ];
        };

        const components = (price: number): JSONValue => [ { type: 'ENERGY', price, stepSize: 1 } ];

        // The one of the EVSE before the one of the station before the one of the pool, in whichever order they are given.
        expect(priced([ pool, ofStation, ofEVSE ])).toEqual([ T_DC, 'EVSE', components(1) ]);
        expect(priced([ ofEVSE, pool, ofStation ])).toEqual([ T_DC, 'EVSE', components(1) ]);
        expect(priced([ pool, ofStation ])).toEqual([ T_DC, 'ChargingStation', components(2) ]);
        expect(priced([ pool ])).toEqual([ T_DC, 'ChargingPool', components(3) ]);

        // Without one current then, the elements of the tariff itself.
        const tariff = evTalerSessionPrices(keys, E1, [], START);
        expect([ tariff.priceStatement, tariff.elements ]).toEqual([ undefined, (tariff.tariff['elements'] as JSONValue[] | undefined) ?? [] ]);
        expect(evTalerSessionPrices(keys, E1, [ pool, ofStation, ofEVSE ], START + 7_200_000).priceStatement).toBeUndefined();

        expect(refusal(() => evTalerSessionPrices(keys, 'DE*GEF*E9*9', [], START))).toBe("The EVSE 'DE*GEF*E9*9' has no EV Taler tariff in the proof!");

    });

});


describe('Amounts of EV Taler, as System.Decimal calculates them (EVTalerAmounts, EVTalerRates)', () => {

    it('rounds a step up to the cent, multiplied before divided: an hour at 0.40 € is 0.40 €, not a cent more (WWCP_POI a374855)', () => {

        const of = (text: string): NetDecimal => defined(NetDecimal.parse(text));

        // System.Decimal holds 0.40 / 60 as 0.0066666666666666666666666667, rounded half to even at 28 places: 60 minutes of
        // that rate are just above 0.40, which rounding up took for a cent before WWCP_POI a374855 multiplied first.
        expect(of('0.40').dividedBy(of('60')).toString()).toBe('0.0066666666666666666666666667');
        expect(writeDecimal(of('0.40').dividedBy(of('60')).times(of('60')))).toBe('0.400000000000000000000000002');
        expect(of('2').dividedBy(of('3')).toString()).toBe('0.6666666666666666666666666667');
        expect(of('10').dividedBy(of('3')).toString()).toBe('3.3333333333333333333333333333');
        expect(of('100').dividedBy(of('3')).toString()).toBe('33.333333333333333333333333333');

        // As A_step_costs_what_it_covers_rounded_up_to_the_cent: 0.59 € a kWh, 0.40 € an hour in minutes.
        const simple = EVTalerRates.of('EUR', {}, [ { priceComponents: [ { type: 'ENERGY', price: Decimal.parse('0.59'), stepSize: 1 },
                                                                        { type: 'TIME', price: Decimal.parse('0.40'), stepSize: 60 } ] } ]) as EVTalerRates;
        const price  = (from: number, to: number, unit: string): string => writeAmount(simple.stepPrice(EVTalerCovers.create(from, to, unit)) as NetDecimal, 'EUR');

        expect([ price(0, 60, 'min'), price(0, 30, 'min'), price(30, 120, 'min'), price(0, 7, 'min'), price(0, 5, 'kWh'), price(5, 5.5, 'kWh') ])
            .toEqual([ '0.40', '0.20', '0.60', '0.05', '2.95', '0.30' ]);

        const rates = EVTalerRates.of('EUR', {}, [ { priceComponents: [ { type: 'FLAT', price: Decimal.parse('0.50') }, { type: 'ENERGY', price: Decimal.parse('0.65'), stepSize: 1 },
                                                                       { type: 'TIME', price: Decimal.parse('0.40'), stepSize: 60 } ] } ]) as EVTalerRates;

        expect(writeAmount(rates.stepPrice(EVTalerCovers.create(0, 2.5, 'kWh')) as NetDecimal, 'EUR')).toBe('1.63');

        // The price of a session to the nearest minor unit, half away from zero: 0.50 € + 7.412 kWh at 0.65 € + 34 minutes at 0.40 €.
        expect(writeAmount(rates.sessionPrice(of('7.412'), 34 * 60_000), 'EUR')).toBe('5.54');

        expect(EVTalerRates.of('EUR', { minPrice: { excl_vat: 1 } }, [])).toEqual({ reason: 'the charging tariff has a minimum or maximum price' });
        expect(EVTalerRates.of('EUR', {}, [ { priceComponents: [ { type: 'ENERGY', price: 1 } ] } ])).toEqual({ reason: 'a price component is not ENERGY, TIME or FLAT once each, with its step size' });
        expect(EVTalerRates.of('EUR', {}, [ { priceComponents: [ { type: 'ENERGY', price: 1, stepSize: 1 } ], restrictions: { maxKWh: 5 } } ])).toEqual({ reason: 'the element of the session has restrictions' });

    });

    it('reads amounts as GNU Taler writes them, and writes them with the digits of the minor unit', () => {

        expect(talerAmountOf('EUR:3.25')).toEqual({ currency: 'EUR', value: NetDecimal.parse('3.25') });
        expect(talerAmountOf('EUR:4503599627370496.99')).not.toBeTypeOf('string');
        for (const text of [ '3.25 EUR', 'EUR:-1', 'EUR:1.123456789', 'EUR:4503599627370497' ])
            expect(talerAmountOf(text)).toBe(`'${text}' is no amount as GNU Taler writes it, e.g. 'EUR:3.25'!`);

        expect(writeAmount(defined(NetDecimal.parse('0.5')), 'EUR')).toBe('0.50');
        expect(writeAmount(defined(NetDecimal.parse('3.255')), 'EUR')).toBe('3.255');
        expect(writeAmount(defined(NetDecimal.parse('3')), 'JPY')).toBe('3');
        expect(writeAmount(defined(NetDecimal.parse('3')), 'KWD')).toBe('3.000');

    });

});

