/*
 * Copyright (c) 2014-2026 GraphDefined GmbH <achim.friedland@graphdefined.com>
 * This file is part of WWCP POI TS <https://github.com/OpenChargingCloud/WWCP_POI.TS>
 *
 * Licensed under the Affero GPL license, Version 3.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.gnu.org/licenses/agpl.html
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { CoseCurves, eddsaVerify, mldsaVerify } from '@vanaheimr/cose';

import { BERError, CONTEXT, integerOf, isBitString, isNull, isSequence, oidOf, octetsOf, readBER, readFirstBER, sequenceOf, TAG, type BER } from './ber.ts';
import { verifyDSA, verifyECDSA } from './ecc.ts';
import { publicKeyOf, subjectPublicKeyInfoOf, type PublicKey, type SubjectPublicKeyInfo } from './publicKeys.ts';
import { DIGESTS, digestByOid, verifyPKCS1, verifyPSS, type Digest } from './rsa.ts';


// An X.509 certificate as X509CertificateParser of BouncyCastle 2.7.0 reads it, X509CertificateStructure and
// TbsCertificateStructure take it and the constructor of X509Certificate reads its basic constraints and key usage; and
// whether it is signed by the key of another one, as X509Certificate.Verify tells: the signature algorithm of the
// certificate the one of its content, the signature of it by the key, of ECDSA, DSA, RSA of PKCS #1 v1.5 or PSS, Ed25519,
// Ed448 or ML-DSA. A certificate is DER, `GetEncoded` gives it back as it is given.


export interface Certificate {
    /** Its content, the TBSCertificate the signature is of. */
    readonly tbs:                  BER;
    readonly signatureAlgorithm:   BER;
    readonly tbsAlgorithm:         BER;
    readonly signature:            BER;
    readonly subjectPublicKeyInfo: SubjectPublicKeyInfo;
}

const isTagged = (record: BER, number: number): boolean =>
    record.tagClass === CONTEXT && record.tagNumber === number;

/** An algorithm identifier, `AlgorithmIdentifier.GetInstance`: an object identifier and optional parameters. */
function algorithmOf(record: BER | undefined): BER {
    if (record === undefined)
        throw new BERError('illegal object in GetInstance: not a SEQUENCE');
    const [ oid ] = sequenceOf(record, [ 1, 2 ]);
    oidOf(oid ?? record);
    return record;
}

/** A name, `X509Name.GetInstance`: a sequence of sets of pairs of an object identifier and a value. */
function nameOf(record: BER | undefined): void {
    if (record === undefined || !isSequence(record))
        throw new BERError('illegal object in GetInstance: not a SEQUENCE');
    for (const set of record.children) {
        if (set.tagClass !== 0 || set.tagNumber !== TAG.set)
            throw new BERError('illegal object in GetInstance: not a SET');
        for (const pair of set.children) {
            const [ type ] = sequenceOf(pair, [ 2 ]);
            oidOf(type ?? pair);
        }
    }
}

/** A time, `Time.GetInstance`: UTCTime or GeneralizedTime. */
function timeOf(record: BER | undefined): void {
    if (record?.tagClass !== 0 || (record.tagNumber !== 23 && record.tagNumber !== 24))
        throw new BERError('unknown object in factory: not a time');
}

/** The extensions, `X509Extensions.GetInstance`, and what the constructor of X509Certificate reads of them; whether DER writes them as given. */
function extensionsOf(record: BER): boolean {

    const [ list ] = record.children;

    if (record.children.length !== 1 || list === undefined || !isSequence(list))
        throw new BERError('illegal object in GetInstance: not a SEQUENCE');

    const seen = new Set<string>();
    let   der  = true;

    for (const extension of list.children) {

        const parts = sequenceOf(extension, [ 2, 3 ]);
        const oid   = oidOf(parts[0] ?? extension);
        const value = parts.at(-1);

        if (seen.has(oid))
            throw new BERError(`repeated extension found: ${oid}`);

        seen.add(oid);

        if (parts.length === 3) {
            const critical = parts[1];
            if (critical?.tagClass !== 0 || critical.tagNumber !== TAG.boolean || critical.content.length !== 1)
                throw new BERError('illegal object in GetInstance: not a BOOLEAN');
            // X509Extensions writes a critical extension's flag only.
            if (critical.content[0] === 0)
                der = false;
        }

        if (value?.tagClass !== 0 || value.tagNumber !== TAG.octetString)
            throw new BERError('illegal object in GetInstance: not an OCTET STRING');

        // Basic constraints and key usage, which the constructor of X509Certificate reads.
        if (oid === '2.5.29.19') {
            const constraints = readBER(value.content);
            sequenceOf(constraints, [ 0, 1, 2 ]);
        }
        else if (oid === '2.5.29.15') {
            const usage = readBER(value.content);
            if (!isBitString(usage))
                throw new BERError('illegal object in GetInstance: not a BIT STRING');
        }

    }

    return der;

}

/** The DER of a certificate, as `ReadCertificate` reads it: undefined where it gives none, as it does of what is no sequence. */
export function certificateOf(bytes: Uint8Array): { certificate: Certificate, der: boolean } | undefined {

    if (bytes[0] !== 0x30)
        return undefined;

    // One record of the stream, what follows it left to `GetEncoded`, which gives it back without.
    const record = readFirstBER(bytes);

    const [ tbs, signatureAlgorithm, signature ] = sequenceOf(record, [ 3 ]);

    if (tbs === undefined || signatureAlgorithm === undefined || signature === undefined || !isSequence(tbs) || !isBitString(signature))
        throw new BERError('illegal object in GetInstance');

    algorithmOf(signatureAlgorithm);

    const fields  = [ ...tbs.children ];
    let   version = 0n;

    if (fields[0] !== undefined && isTagged(fields[0], 0)) {
        const [ explicit ] = fields.shift()?.children ?? [];
        if (explicit === undefined)
            throw new BERError('illegal object in GetInstance');
        version = integerOf(explicit);
    }

    if (version !== 0n && version !== 1n && version !== 2n)
        throw new BERError('version number not recognised');

    const [ serial, tbsAlgorithm, issuer, validity, subject, spki, ...extras ] = fields;

    if (serial === undefined)
        throw new BERError('illegal object in GetInstance');

    integerOf(serial);
    algorithmOf(tbsAlgorithm);
    nameOf(issuer);

    const [ notBefore, notAfter ] = validity === undefined ? [] : sequenceOf(validity, [ 2 ]);
    timeOf(notBefore);
    timeOf(notAfter);

    nameOf(subject);

    const subjectPublicKeyInfo = subjectPublicKeyInfoOf(spki ?? tbs);

    if (extras.length > 0 && version === 0n)
        throw new BERError('version 1 certificate contains extra data');

    let der = record.der && record.encoded.length === bytes.length;

    for (const extra of extras) {
        if (extra.tagClass !== CONTEXT)
            throw new BERError('illegal object in GetInstance');
        if (extra.tagNumber === 3) {
            if (version === 1n)
                throw new BERError('version 2 certificate cannot contain extensions');
            der = extensionsOf(extra) && der;
        }
        else if (extra.tagNumber !== 1 && extra.tagNumber !== 2)
            throw new BERError(`Unknown tag encountered in structure: ${String(extra.tagNumber)}`);
    }

    return { certificate: { tbs, signatureAlgorithm, tbsAlgorithm: tbsAlgorithm ?? tbs, signature, subjectPublicKeyInfo }, der };

}


// ---------------------------------------------------------------------------------------------------------------------------
// Signatures (X509Certificate.Verify)

const ECDSA = new Map<string, Digest>([
    [ '1.2.840.10045.4.1',      DIGESTS.sha1 ],
    [ '1.2.840.10045.4.3.1',    DIGESTS.sha224 ],
    [ '1.2.840.10045.4.3.2',    DIGESTS.sha256 ],
    [ '1.2.840.10045.4.3.3',    DIGESTS.sha384 ],
    [ '1.2.840.10045.4.3.4',    DIGESTS.sha512 ],
    [ '2.16.840.1.101.3.4.3.9', DIGESTS.sha3_224 ],
    [ '2.16.840.1.101.3.4.3.10', DIGESTS.sha3_256 ],
    [ '2.16.840.1.101.3.4.3.11', DIGESTS.sha3_384 ],
    [ '2.16.840.1.101.3.4.3.12', DIGESTS.sha3_512 ],
]);

const DSA = new Map<string, Digest>([
    [ '1.2.840.10040.4.3',      DIGESTS.sha1 ],
    [ '2.16.840.1.101.3.4.3.1', DIGESTS.sha224 ],
    [ '2.16.840.1.101.3.4.3.2', DIGESTS.sha256 ],
    [ '2.16.840.1.101.3.4.3.3', DIGESTS.sha384 ],
    [ '2.16.840.1.101.3.4.3.4', DIGESTS.sha512 ],
    [ '2.16.840.1.101.3.4.3.5', DIGESTS.sha3_224 ],
    [ '2.16.840.1.101.3.4.3.6', DIGESTS.sha3_256 ],
    [ '2.16.840.1.101.3.4.3.7', DIGESTS.sha3_384 ],
    [ '2.16.840.1.101.3.4.3.8', DIGESTS.sha3_512 ],
]);

const PKCS1 = new Map<string, Digest>([
    [ '1.2.840.113549.1.1.4',    DIGESTS.md5 ],
    [ '1.2.840.113549.1.1.5',    DIGESTS.sha1 ],
    [ '1.2.840.113549.1.1.14',   DIGESTS.sha224 ],
    [ '1.2.840.113549.1.1.11',   DIGESTS.sha256 ],
    [ '1.2.840.113549.1.1.12',   DIGESTS.sha384 ],
    [ '1.2.840.113549.1.1.13',   DIGESTS.sha512 ],
    [ '1.2.840.113549.1.1.15',   DIGESTS.sha512_224 ],
    [ '1.2.840.113549.1.1.16',   DIGESTS.sha512_256 ],
    [ '2.16.840.1.101.3.4.3.13', DIGESTS.sha3_224 ],
    [ '2.16.840.1.101.3.4.3.14', DIGESTS.sha3_256 ],
    [ '2.16.840.1.101.3.4.3.15', DIGESTS.sha3_384 ],
    [ '2.16.840.1.101.3.4.3.16', DIGESTS.sha3_512 ],
]);

const ML_DSA = new Map([ [ '2.16.840.1.101.3.4.3.17', 'ML-DSA-44' ], [ '2.16.840.1.101.3.4.3.18', 'ML-DSA-65' ], [ '2.16.840.1.101.3.4.3.19', 'ML-DSA-87' ] ]);

/** The algorithm identifiers are the same, `IsAlgIDEqual`: parameters left out as NULL ones. */
function sameAlgorithm(left: BER, right: BER): boolean {

    const [ leftOID, leftParameters ] = left.children;
    const [ rightOID, rightParameters ] = right.children;

    if (leftOID === undefined || rightOID === undefined || oidOf(leftOID) !== oidOf(rightOID))
        return false;

    const absent = (parameters: BER | undefined): boolean =>
        parameters === undefined || isNull(parameters);

    if (absent(leftParameters) || absent(rightParameters))
        return absent(leftParameters) && absent(rightParameters);

    const [ a, b ] = [ leftParameters?.encoded ?? new Uint8Array(0), rightParameters?.encoded ?? new Uint8Array(0) ];

    return a.length === b.length && a.every((octet, index) => octet === b[index]);

}

/** The (r, s) of a DER signature of ECDSA or DSA, as `StandardDsaEncoding.Decode` reads it: each below the order, DER. */
function rsOf(signature: Uint8Array, order: bigint): readonly [ bigint, bigint ] | undefined {
    const record = readBER(signature);
    const [ r = -1n, s = -1n ] = sequenceOf(record, [ 2 ]).map(integerOf);
    return record.der && r >= 0n && s >= 0n && r < order && s < order ? [ r, s ] : undefined;
}

/** The parameters of RSASSA-PSS, `RsassaPssParameters`: its digest, the digest of MGF1, the salt length, the trailer 1. */
function pssParameters(parameters: BER | undefined): { digest: Digest, mask: Digest, salt: number } | undefined {

    let digest: Digest = DIGESTS.sha1;
    let mask:   Digest = DIGESTS.sha1;
    let salt           = 20;

    for (const field of parameters === undefined || isNull(parameters) ? [] : sequenceOf(parameters, [ 0, 1, 2, 3, 4 ])) {

        const [ value ] = field.children;

        if (field.tagClass !== CONTEXT || value === undefined)
            return undefined;

        if (field.tagNumber === 0) {
            const known = digestByOid(oidOf(sequenceOf(value, [ 1, 2 ])[0] ?? value));
            if (known === undefined)
                return undefined;
            digest = known;
        }
        else if (field.tagNumber === 1) {
            const [ mgf, hash ] = sequenceOf(value, [ 2 ]);
            const known = hash === undefined ? undefined : digestByOid(oidOf(sequenceOf(hash, [ 1, 2 ])[0] ?? hash));
            if (mgf === undefined || oidOf(mgf) !== '1.2.840.113549.1.1.8' || known === undefined)
                return undefined;
            mask = known;
        }
        else if (field.tagNumber === 2)
            salt = Number(integerOf(value));
        else if (field.tagNumber !== 3 || integerOf(value) !== 1n)
            return undefined;

    }

    return { digest, mask, salt };

}

/** Whether the signature of the certificate is of its content by the given key. */
function signedWith(certificate: Certificate, key: PublicKey): boolean {

    const [ oidRecord, parameters ] = certificate.signatureAlgorithm.children;
    const oid       = oidOf(oidRecord ?? certificate.signatureAlgorithm);
    const message   = certificate.tbs.encoded;
    const signature = octetsOf(certificate.signature);

    const ecdsa = ECDSA.get(oid);
    if (ecdsa !== undefined) {
        const rs = key.kind === 'ec' ? rsOf(signature, key.curve.n) : undefined;
        return key.kind === 'ec' && rs !== undefined && verifyECDSA(key.curve, key.q, ecdsa.digest(message), ...rs);
    }

    const dsa = DSA.get(oid);
    if (dsa !== undefined) {
        if (key.kind !== 'dsa' || key.group === undefined)
            return false;
        const { p, q, g } = key.group;
        const rs = rsOf(signature, q);
        return rs !== undefined && verifyDSA(p, q, g, key.y, dsa.digest(message), ...rs);
    }

    const pkcs1 = PKCS1.get(oid);
    if (pkcs1 !== undefined)
        return key.kind === 'rsa' && verifyPKCS1(key.n, key.e, pkcs1, message, signature);

    if (oid === '1.2.840.113549.1.1.10') {
        const pss = pssParameters(parameters);
        return key.kind === 'rsa' && pss !== undefined && verifyPSS(key.n, key.e, pss.digest, pss.mask, pss.salt, message, signature);
    }

    if (oid === '1.3.101.112' || oid === '1.3.101.113')
        return key.kind === 'eddsa' && key.curve === (oid === '1.3.101.112' ? 'Ed25519' : 'Ed448') &&
               eddsaVerify(key.curve === 'Ed25519' ? CoseCurves.Ed25519 : CoseCurves.Ed448, signature, message, key.bytes);

    const mldsa = ML_DSA.get(oid);
    if (mldsa !== undefined)
        return key.kind === 'ml-dsa' && key.set === mldsa && mldsaVerify(mldsa, signature, message, key.bytes);

    return false;

}

/**
 * Whether the certificate is issued by the other one, as `X509Certificate.Verify` with the public key of the other one
 * tells: of a key BouncyCastle makes, the signature algorithm the one of the content, the signature verified.
 */
export function issuedBy(certificate: Certificate, issuer: Certificate): boolean {
    try {
        return sameAlgorithm(certificate.signatureAlgorithm, certificate.tbsAlgorithm) &&
               signedWith(certificate, publicKeyOf(issuer.subjectPublicKeyInfo));
    }
    catch {
        return false;
    }
}
