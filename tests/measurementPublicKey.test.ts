import { describe, expect, it } from 'vitest';

import { firstOf, qa, refusal } from './richNetwork.ts';

import { fromBase64, toBase64, toHex } from '../src/encoding/text.ts';
import { hash } from '../src/crypto/hash.ts';
import type { JSONObject } from '../src/json/value.ts';
import { measurementKeyError } from '../src/network/measurementPublicKey.ts';


// A measurement public key is a DER encoded SubjectPublicKeyInfo of a key BouncyCastle makes, its certificates DER encoded
// certificates, the first of the key, each one issued by the next one (`measurementPublicKey.ts`, MeasurementPublicKey.cs).
// The keys and certificates are BouncyCastle 2.7.0's, public ones only; the words those of WWCP_POI3 at 89d2e02, which
// took and refused 237 of 242 such keys alike (the other five: points on curves over binary fields, explicit curve parameters).

const KEY = {
    p256:    'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE8DHTEigITt1E/JBLf0UUCxHAPOOMIXvgZeu6mul6kXiHLoxOmXiMt7OtvHh7gk2G893ZIjzuI3VsBGh9UswUWA==',
    p256c:   'MDkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDIgAC8DHTEigITt1E/JBLf0UUCxHAPOOMIXvgZeu6mul6kXg=',
    p192:    'MEkwEwYHKoZIzj0CAQYIKoZIzj0DAQEDMgAEsG1udpABv3rQfpH5DXyfRhUK92Te858CV5Z8eFxcSNcbkc4mktgxw9JVamL605IT',
    k224:    'ME4wEAYHKoZIzj0CAQYFK4EEACADOgAEL4AP93em3T6e+gGzkHKwyP30aailMDcnsw0xt+ElDoS2277ZR7piYQSCdaTsl7HJLy3NNLVz6BE=',
    bp256:   'MFowFAYHKoZIzj0CAQYJKyQDAwIIAQEHA0IABDV9AFOLcLqADE3SsPvVE2d3jAkO6jKlCi3A76DSP4aqBFNaRN+89/4Pz9ZkXJhX9Gpw4YwsI7Hb5qrD/ks+kvQ=',
    rsa:     'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAm6wivJCf0zESTY9v9RIe97vL+cyGGPzSPxxQ6OQsbS58/cxDAH/8rLKgjXuol7mETODYO9wXqd72amyRIofXglW7cYaThXvhsPwY3svY7kXHHh0hW9qmrFN39blcNrlgUl2dS9G2TjIo7OMU6t2OpMaOE0LR9F3wNAOkvfVFRNuMFezvxJSfXyvQ/f8wVLbXBINxhXgr8sC7Gen5ksbjEQ5aAJ9b8UaLCPFDZ3A0cM4tgUDD7A7Wib4qqUgx47Lq2PjtyaodifCgcILDfnSo8iKma1+wxx5JPkuWDW67py37/qaxPcyPXag+Qy8hAfVHKs8DsBJMJAwD+v0/aIOhswIDAQAB',
    ed25519: 'MCowBQYDK2VwAyEAMbxeXVmh0SMovsOa19UGl0wborvwChHtP5Bs77aGa1s=',
    meter:   'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEg6ro/u9xb4/gjYr7/C2UYyJGq41tJLNNZwBkRF4dNJYioh6GCHFgl7N8kRkTalPircRJ53dn2G94kUnDzaLN3w==',
};

/** A prime of 1024 bits, no modulus of RSA. */
const PRIME = 0xe4b5ff8f5be1fed144691b03bc79b73fe3601e8ecdb796baa6775d19975f0513c3a0401dafe81d9e2629bce98892e2269a65ce04659abe78f9a482be04b376941b112d984313e782f258436e38c58391d081148c28929c9eb9114107f255a852cfbe8e6a0da745b0c07858a1c541a382a53e5ea783a78863fe1eff1aac3f9401n;

/** The meter key certified by an authority of P-384 (ecdsa-with-SHA384), and the authority's own certificate. */
const ECDSA_CHAIN = [
    'MIIBNDCBu6ADAgECAgMBwv0wCgYIKoZIzj0EAwMwFDESMBAGA1UEAwwJQXV0aG9yaXR5MB4XDTI2MTEwMjAwMDAwMFoXDTMxMTEwMzAwMDAwMFowEjEQMA4GA1UEAwwHbWV0ZXItMTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABIOq6P7vcW+P4I2K+/wtlGMiRquNbSSzTWcAZEReHTSWIqIehghxYJezfJEZE2pT4q3ESed3Z9hveJFJw82izd8wCgYIKoZIzj0EAwMDaAAwZQIwRayE1ArFO1XjIkXbGlWt8XoZFm4yeE1djLDxMJ+qWyf6pnjCgj16uSLpmFkh8FV1AjEA4qhgtAWHB8bsZ+mSKEYKcvNqbrV6CBUzV9B/BXYEKwAQblblmmk/gO3CG44Eknp+',
    'MIIBaTCB76ADAgECAgMHif8wCgYIKoZIzj0EAwMwFDESMBAGA1UEAwwJQXV0aG9yaXR5MB4XDTI2MTEwMjAwMDAwMFoXDTMxMTEwMzAwMDAwMFowFDESMBAGA1UEAwwJQXV0aG9yaXR5MHYwEAYHKoZIzj0CAQYFK4EEACIDYgAErUe8U7o8VAfguQLI6SKb4yM9ZsFI6nfgpaUh3EiCUuPnYO0nxiSGWNey5yPycxHC78fPauLIh9MXwtlv3aJFg/a9DCO326dHEOLgX2RiMn/ckygkR/3sti3Jp8ZvRnBpoxMwETAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMDA2kAMGYCMQCN+WzAHTqV5iSkLydyxBlsn0hruh2VY7gfsdeFj57d5oLIrOkAolBvD9qJsKAtpqoCMQDYMQYa7Bb/DKFyNgrQFFOghaXJGBqoL0Ek5gQfYFWlx1B+6hsvL1rYkmeYGzYDHDk=',
];

/** The meter key certified by an authority of Ed25519, and the authority's own certificate. */
const ED25519_CHAIN = [
    'MIIBAzCBtqADAgECAgMBwpswBQYDK2VwMBQxEjAQBgNVBAMMCUF1dGhvcml0eTAeFw0yNjExMDIwMDAwMDBaFw0zMTExMDMwMDAwMDBaMBIxEDAOBgNVBAMMB21ldGVyLTEwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASDquj+73Fvj+CNivv8LZRjIkarjW0ks01nAGREXh00liKiHoYIcWCXs3yRGRNqU+KtxEnnd2fYb3iRScPNos3fMAUGAytlcANBAFyRY3cvFWOeVKjzRKuI/FOc8xLHyATClwi/X92w5o3KmmUk69JaITEGB1jNLyvl46oPnBueqDD7uw+sYIciUQ4=',
    'MIHrMIGeoAMCAQICAwS0dzAFBgMrZXAwFDESMBAGA1UEAwwJQXV0aG9yaXR5MB4XDTI2MTEwMjAwMDAwMFoXDTMxMTEwMzAwMDAwMFowFDESMBAGA1UEAwwJQXV0aG9yaXR5MCowBQYDK2VwAyEAMbxeXVmh0SMovsOa19UGl0wborvwChHtP5Bs77aGa1ujEzARMA8GA1UdEwEB/wQFMAMBAf8wBQYDK2VwA0EAIkjwmTsTLKXv7fwEcvmj3S2FhIj/3sNv3Ai0nhZ2k0NST9vfW3IA8Vj/IGNuv0A4Kxqv8nJd7ofMch6kHeYFAg==',
];

const bytes = (base64: string): Uint8Array =>
    fromBase64(base64);

const error = (key: string | Uint8Array, chain: (string | Uint8Array)[] = []): string | undefined =>
    measurementKeyError(typeof key === 'string' ? bytes(key) : key, chain.map(item => typeof item === 'string' ? bytes(item) : item));

const SPKI = 'A measurement public key must be a SubjectPublicKeyInfo: ';

// DER, as far as the tests build keys.
const tlv = (tag: number, ...content: (readonly number[] | Uint8Array)[]): number[] => {
    const joined = content.flatMap(part => [ ...part ]);
    const length = joined.length < 0x80 ? [ joined.length ] : joined.length < 0x100 ? [ 0x81, joined.length ] : [ 0x82, joined.length >> 8, joined.length & 0xff ];
    return [ tag, ...length, ...joined ];
};

const integer = (value: bigint): number[] => {
    let hex = value.toString(16);
    if (hex.length % 2 === 1) hex = `0${hex}`;
    const octets = hex.match(/../gu)?.map(pair => parseInt(pair, 16)) ?? [];
    return tlv(0x02, (octets[0] ?? 0) >= 0x80 ? [ 0, ...octets ] : octets);
};

const RSA_ENCRYPTION = [ 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00 ];

const rsaKey = (modulus: bigint, exponent: bigint): Uint8Array =>
    new Uint8Array(tlv(0x30, tlv(0x30, RSA_ENCRYPTION), tlv(0x03, [ 0 ], tlv(0x30, integer(modulus), integer(exponent)))));

/** The point of the P-256 key, its last octet changed, or its type. */
const p256With = (change: (point: Uint8Array) => void): Uint8Array => {
    const key = Uint8Array.from(bytes(KEY.p256));
    change(key.subarray(26));
    return key;
};


describe('Measurement public keys', () => {

    it('of named curves, also those COSE does not know, of RSA and Ed25519, are taken', () => {

        for (const key of [ KEY.p256, KEY.p256c, KEY.p192, KEY.k224, KEY.bp256, KEY.rsa, KEY.ed25519 ])
            expect(error(key)).toBeUndefined();

    });

    it('are DER encoded SubjectPublicKeyInfos', () => {

        const p256 = bytes(KEY.p256);

        expect(error(new Uint8Array([ 0x30, 0x81, ...p256.subarray(1) ]))).toBe('A measurement public key must be DER encoded!');
        expect(error(new Uint8Array([ 0x30, 0x80, ...p256.subarray(2), 0, 0 ]))).toBe('A measurement public key must be DER encoded!');
        expect(error(new Uint8Array([ ...p256, 0 ]))).toBe(`${SPKI}extra data found after object`);
        expect(error(p256.subarray(0, -1))).toBe(`${SPKI}DEF length 89 object truncated by 1`);
        expect(error(new Uint8Array([ 1, 2, 3 ]))).toBe(`${SPKI}corrupted stream detected`);
        expect(error(new Uint8Array(0))).toBe(`${SPKI}Object reference not set to an instance of an object.`);
        expect(error(new Uint8Array(tlv(0x30, tlv(0x30, p256.subarray(4, 23)), tlv(0x04, p256.subarray(26))))))
            .toBe(`${SPKI}illegal object in GetInstance: Org.BouncyCastle.Asn1.DerOctetString (Parameter 'obj')`);

    });

    it('of a point BouncyCastle decodes and finds on its curve', () => {

        expect(error(p256With(point => { point[64] = (point[64] ?? 0) ^ 1; }))).toBe(`${SPKI}Invalid point coordinates`);
        expect(error(p256With(point => { point[0] = 5; }))).toBe(`${SPKI}Invalid point encoding 5`);
        expect(error(p256With(point => { point[0] = 6 | ((point[64] ?? 0) & 1); }))).toBeUndefined();
        expect(error(p256With(point => { point[0] = 7 - ((point[64] ?? 0) & 1); }))).toBe(`${SPKI}Inconsistent Y coordinate in hybrid encoding (Parameter 'encoded')`);
        expect(error(p256With(point => { point.fill(0xff, 1, 33); }))).toBe(`${SPKI}value invalid for SecP256R1FieldElement (Parameter 'x')`);
        expect(error(new Uint8Array(tlv(0x30, tlv(0x30, bytes(KEY.p256).subarray(4, 23)), tlv(0x03, [ 0, 0 ])))))
            .toBe(`${SPKI}Point at infinity (Parameter 'q')`);

    });

    it('of RSA, as RsaKeyParameters checks its modulus and exponent', () => {

        const modulus = BigInt(`0x${toHex(bytes(KEY.rsa).subarray(33, 289))}`);

        expect(error(rsaKey(modulus, 65537n))).toBeUndefined();
        expect(error(rsaKey(modulus, 65536n))).toBe(`${SPKI}RSA publicExponent is even (Parameter 'exponent')`);
        expect(error(rsaKey(modulus + 1n, 65537n))).toBe(`${SPKI}RSA modulus is even (Parameter 'modulus')`);
        expect(error(rsaKey(modulus * 743n, 65537n))).toBe(`${SPKI}RSA modulus has a small prime factor (Parameter 'modulus')`);
        expect(error(rsaKey(modulus * 751n, 65537n))).toBeUndefined();
        expect(error(rsaKey(PRIME, 65537n))).toBe(`${SPKI}RSA modulus is not composite (Parameter 'modulus')`);

    });

    it('of Ed25519, a point of no small order', () => {

        const ed25519 = (y: readonly number[]): Uint8Array =>
            new Uint8Array([ ...bytes(KEY.ed25519).subarray(0, 12), ...y ]);

        expect(error(ed25519([ 3, ...new Array<number>(31).fill(0) ]))).toBeUndefined();
        expect(error(ed25519([ 2, ...new Array<number>(31).fill(0) ]))).toBe(`${SPKI}invalid public key`);
        expect(error(ed25519([ 1, ...new Array<number>(31).fill(0) ]))).toBe(`${SPKI}invalid public key`);

    });

    it('with certificates, the first of the key, each one issued by the next one', () => {

        expect(error(KEY.meter, ECDSA_CHAIN)).toBeUndefined();
        expect(error(KEY.meter, ED25519_CHAIN)).toBeUndefined();
        expect(error(KEY.meter, ECDSA_CHAIN.slice(0, 1))).toBeUndefined();

        expect(error(KEY.p256, ECDSA_CHAIN)).toBe('The first certificate of a measurement public key must be the one of the key!');
        expect(error(KEY.meter, [ ECDSA_CHAIN[0] ?? '', ECDSA_CHAIN[0] ?? '' ])).toBe('The certificate 1 of a measurement public key is not issued by the certificate 2!');
        expect(error(KEY.meter, [ ECDSA_CHAIN[0] ?? '', ED25519_CHAIN[1] ?? '' ])).toBe('The certificate 1 of a measurement public key is not issued by the certificate 2!');

        const tampered = Uint8Array.from(bytes(ECDSA_CHAIN[0] ?? ''));
        tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 1;
        expect(error(KEY.meter, [ tampered, ECDSA_CHAIN[1] ?? '' ])).toBe('The certificate 1 of a measurement public key is not issued by the certificate 2!');

        expect(error(KEY.meter, [ new Uint8Array([ ...bytes(ECDSA_CHAIN[0] ?? ''), 0 ]), ECDSA_CHAIN[1] ?? '' ])).toBe('The certificate 1 of a measurement public key must be DER encoded!');
        expect(error(KEY.meter, [ new Uint8Array([ 4, 1, 2 ]) ])).toBe('The certificate 1 of a measurement public key must be DER encoded!');
        expect(error(KEY.meter, [ ECDSA_CHAIN[0] ?? '', new Uint8Array([ 0x30, 1, 2 ]) ])).toBe('The certificate 2 of a measurement public key is invalid: Failed to read certificate');

    });

    it('of a version, as WWCP_POI3 names its key', () => {

        const key = (meter: JSONObject): JSONObject => firstOf(meter, 'publicKeys');
        const changed = Uint8Array.from(bytes(KEY.p256));
        changed[changed.length - 1] = (changed.at(-1) ?? 0) ^ 1;

        expect(refusal(qa(({ evse }) => {
            const publicKey = key(evse['energyMeter'] as JSONObject);
            publicKey['key'] = toBase64(changed);
            publicKey['@id'] = toHex(hash('sha256', changed));
        }))).toMatch(/^Invalid public key '\{"@id":"[0-9a-f]{64}","key":"[^"]+"\}': A measurement public key must be a SubjectPublicKeyInfo: Invalid point coordinates$/u);

    });

});
