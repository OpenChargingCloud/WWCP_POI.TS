import { createHash, createPrivateKey, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { AT, asText, defined, readJSON } from './helpers.ts';
import { specification } from './conformance.ts';

import { RoamingNetwork }   from '../src/network/roamingNetwork.ts';
import { canonicalJSON, canonicalJSONBytes } from '../src/json/canonical.ts';
import { parseJSON }        from '../src/json/parse.ts';
import { clone, without, type JSONObject, type JSONValue } from '../src/json/value.ts';
import type { QIDigitalDocument } from '../src/qidigital/document.ts';
import { DigitalCalibrationCertificate } from '../src/qidigital/calibrationCertificate.ts';
import { DigitalCertificateOfConformity, approvesQualitySystem } from '../src/qidigital/certificateOfConformity.ts';
import { DigitalDeclarationOfConformity } from '../src/qidigital/declarationOfConformity.ts';
import { QIDigitalItem, QIDigitalManufacturer, QIDigitalModel, QIDigitalQuantity } from '../src/qidigital/parts.ts';


// The QI-Digital documents of WWCP_POI (QIDigitalTests.cs, example A14), a proof of concept: the papers of the meter of
// DE*GEF*E2*1, an SM-3 of SAALE, checked against QA. The frozen run predates example A14, so the documents are signed here
// with the Ed25519 keys of section 6, whose private seeds the specification gives, and QA is the one of the run with the
// PTB, SAALE and a calibration laboratory EM-LAB holding those keys.

const T0 = AT;

/** A key of section 6 with its private seed. */
const key = (keyId: string): { id: string, cose: string, seed: string } => {
    const vector = defined(specification.signatures.find(signature => signature.keyId.startsWith(keyId)), `The key ${keyId} of section 6`);
    return { id: vector.keyId, cose: vector.coseKey, seed: defined(vector.privateSeed, `The private seed of ${keyId}`) };
};

const PTB_CERTIFICATES  = key('06c3b3e2');
const PTB_PARTY         = key('ea671729');
const SAALE_MODELS      = key('1ef48003');
const LAB_CERTIFICATES  = key('8cb46c0f');
const FOREIGN           = key('a287cebc');

type Key = ReturnType<typeof key>;

/** An Ed25519 signature by the given private seed, in Base64. */
const signedBy = (seed: string, bytes: Uint8Array): string =>
    sign(null, bytes, createPrivateKey({ key: Buffer.concat([ Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seed, 'hex') ]),
                                         format: 'der', type: 'pkcs8' })).toString('base64');

/** A signing key of a party as the content holds it. */
const signingKey = (signer: Key, usage: string, notAfter?: string): JSONObject =>
    ({ '@id': signer.id, key: signer.cose, ...(notAfter === undefined ? {} : { notAfter }), usages: [ usage ] });

const byId = (left: JSONObject, right: JSONObject): number =>
    asText(left['@id']) < asText(right['@id']) ? -1 : 1;

/** QA of the run: the PTB with a key for certificates and one for itself, SAALE with one for its models, and EM-LAB. */
function network(ptbCertificatesNotAfter?: string): RoamingNetwork {

    const json  = clone(readJSON('published/QA.json') as JSONObject);
    delete json['eTags'];

    const bodies = json['conformityAssessmentBodies'] as JSONObject[];
    const ptb    = defined(bodies.find(body => body['@id'] === 'PTB'));
    ptb['signingKeys'] = [ signingKey(PTB_CERTIFICATES, 'certificates', ptbCertificatesNotAfter), signingKey(PTB_PARTY, 'party') ].sort(byId);

    bodies.push({ '@id': 'EM-LAB', name: { en: 'Jena Energy Meter Calibration Laboratory' }, signingKeys: [ signingKey(LAB_CERTIFICATES, 'certificates') ],
                  created: T0, lastChange: T0 });

    const saale = defined((json['energyMeterManufacturers'] as JSONObject[]).find(manufacturer => manufacturer['@id'] === 'SAALE'));
    saale['signingKeys'] = [ signingKey(SAALE_MODELS, 'models') ];

    return RoamingNetwork.parse(json);

}

const qa = network();


/** The given document signed by the given key at T0, as WWCP_POI signs it: its signature input without the value. */
function signed(json: JSONObject, signer: Key, parse: (json: JSONValue) => QIDigitalDocument, signedAt = T0): JSONObject {
    const draft: JSONObject = { ...json, signature: { signedAt, algorithm: 'Ed25519', keyId: signer.id, value: 'AA==' } };
    return { ...draft, signature: { signedAt, algorithm: 'Ed25519', keyId: signer.id, value: signedBy(signer.seed, parse(draft).signingBytes()) } };
}

const parseDCoC = (json: JSONValue): DigitalCertificateOfConformity => DigitalCertificateOfConformity.parse(json);
const parseDDoC = (json: JSONValue): DigitalDeclarationOfConformity => DigitalDeclarationOfConformity.parse(json);
const parseDCC  = (json: JSONValue): DigitalCalibrationCertificate  => DigitalCalibrationCertificate.parse(json);


// The papers of the meter, as example A14 makes them.

const MODEL = { type: 'EnergyMeterModel', manufacturerId: 'SAALE', modelId: 'SM-3', hardwareRevisions: [ '1.4' ], firmwareVersions: [ '1.0.7' ] };
const MID   = { name: 'MID', act: 'Directive 2014/32/EU' };

const typeExaminationJSON = (more: JSONObject = {}): JSONObject => ({
    '@context':                  DigitalCertificateOfConformity.CONTEXT,
    '@id':                       'DE-26-M-PTB-0108',
    revision:                    0,
    module:                      'B',
    legislation:                 MID,
    conformityAssessmentBodyId:  'PTB',
    notifiedBodyNumber:          '0102',
    model:                       MODEL,
    validFrom:                   '2026-10-26T00:00:00.000Z',
    validUntil:                  '2036-10-26T00:00:00.000Z',
    standards:                   [ { reference: 'EN 50470-1:2006' }, { reference: 'EN 50470-3:2022' } ],
    characteristics:             [ { refType: 'mid_maximumCurrent', value: 63, unit: '\\ampere' },
                                   { refType: 'mid_transitionalCurrent', value: parseJSON('0.5'), unit: '\\ampere' },
                                   { refType: 'mid_minimumCurrent', value: parseJSON('0.25'), unit: '\\ampere' },
                                   { refType: 'mid_referenceVoltage', value: 230, unit: '\\volt' } ],
    conclusion:                  { en: 'The type SM-3 meets the essential requirements of the MID, Annex I and Annex V (MI-003), accuracy class B.' },
    conditions:                  [ { en: 'Sealed as the annex of this certificate shows.' } ],
    documentURL:                 'https://www.ptb.example/certificates/DE-26-M-PTB-0108.pdf',
    ...more,
});

const qualitySystemJSON = (more: JSONObject = {}): JSONObject => ({
    '@context':                  DigitalCertificateOfConformity.CONTEXT,
    '@id':                       'DE-26-QS-PTB-0042',
    revision:                    0,
    module:                      'D',
    legislation:                 MID,
    conformityAssessmentBodyId:  'PTB',
    notifiedBodyNumber:          '0102',
    manufacturer:                { type: 'EnergyMeterManufacturer', manufacturerId: 'SAALE', scope: [ 'MI-003' ] },
    validFrom:                   '2026-10-26T00:00:00.000Z',
    validUntil:                  '2029-10-26T00:00:00.000Z',
    conclusion:                  { en: 'The quality system of SAALE meets the MID, Annex II, module D, for MI-003.' },
    conditions:                  [ { en: 'Subject to the surveillance of the notified body.' } ],
    ...more,
});

const declarationJSON = (more: JSONObject = {}): JSONObject => ({
    '@context':              DigitalDeclarationOfConformity.CONTEXT,
    '@id':                   'DoC-SM-3-2026-01',
    model:                   MODEL,
    legislations:            [ MID, { name: 'EMC', act: 'Directive 2014/30/EU' }, { name: 'RoHS', act: 'Directive 2011/65/EU' } ],
    standards:               [ { reference: 'EN 50470-1:2006' }, { reference: 'EN 50470-3:2022' } ],
    notifiedBodies:          [ { conformityAssessmentBodyId: 'PTB', notifiedBodyNumber: '0102', module: 'B', certificateId: 'DE-26-M-PTB-0108',
                                 intervention: { en: 'Performed the EU-type examination and issued the EU-type examination certificate' } },
                               { conformityAssessmentBodyId: 'PTB', notifiedBodyNumber: '0102', module: 'D', certificateId: 'DE-26-QS-PTB-0042',
                                 intervention: { en: 'Approved the quality system of the manufacturer and surveils it' } } ],
    additionalInformation:   { en: 'Accuracy class B, three-phase, 3 x 230/400 V, 0.25 to 63 A.' },
    placeOfIssue:            'Halle (Saale)',
    signatory:               { name: 'Jane Doe', role: 'Managing director' },
    ...more,
});

/** The error of the active energy at a current, with its expanded uncertainty and the maximum permissible error of class B. */
const loadPoint = (name: string, current: string, error: string, maxPermissibleError: string, conformity = 'Pass'): JSONObject => ({
    name:        { en: name },
    refType:     'basic_calibrationPoint',
    quantities:  [ { refType: 'basic_nominalValue', value: parseJSON(current), unit: '\\ampere' },
                   { refType: 'basic_measurementError', value: parseJSON(error), unit: '\\percent', expandedUncertainty: parseJSON('0.08'), coverageFactor: 2,
                     coverageProbability: parseJSON('0.95'), toleranceLower: parseJSON('-' + maxPermissibleError), toleranceUpper: parseJSON(maxPermissibleError), conformity } ],
});

const meterItem = { type: 'EnergyMeter', id: 'DE*GEF*M2*1', manufacturerId: 'SAALE', modelId: 'SM-3', serialNumber: 'ACM-2026-002-1', hardwareRevision: '1.4', firmwareVersion: '1.0.7' };

const calibrationJSON = (more: JSONObject = {}): JSONObject => ({
    '@context':                  DigitalCalibrationCertificate.CONTEXT,
    '@id':                       'DCC-2026-0815',
    countryCode:                 'DE',
    calibrationLaboratoryId:     'EM-LAB',
    calibrationLaboratoryCode:   'D-K-12345-01-00',
    customer:                    'GraphDefined Charging Solutions',
    orderNumber:                 'PO-2026-0815',
    item:                        meterItem,
    beginPerformanceDate:        '2026-10-25T21:58:00.000Z',
    endPerformanceDate:          '2026-10-25T23:58:00.000Z',
    performanceLocation:         'Customer',
    respPersons:                 [ { name: 'Dr. Erika Mustermann', role: 'Head of laboratory', mainSigner: true }, { name: 'Max Mustermann', role: 'Calibration engineer' } ],
    statements:                  [ { declaration: { en: 'The meter conforms to its accuracy class B.' }, refType: 'basic_conformity', norm: 'EN 50470-3:2022', conformity: 'Pass' } ],
    measurementResults:          [ { name: { en: 'Measurement error of the active energy' },
                                     usedMethods: [ { reference: 'EN 50470-3:2022', title: { en: 'Accuracy test of static meters' } } ],
                                     influenceConditions: [ { refType: 'basic_temperature', value: parseJSON('23.1'), unit: '\\degreecelsius', expandedUncertainty: parseJSON('0.5'), coverageFactor: 2 } ],
                                     results: [ loadPoint('Imin', '0.25', '0.42', '1.5'), loadPoint('Itr', '0.5', '-0.18', '1.0'),
                                                loadPoint('Iref', '5', '0.06', '1.0'), loadPoint('Imax', '63', '-0.21', '1.0') ] } ],
    recalibrationDue:            '2034-10-26T00:58:00.000Z',
    ...more,
});

const typeExamination  = (more?: JSONObject, signer = PTB_CERTIFICATES): DigitalCertificateOfConformity => parseDCoC(signed(typeExaminationJSON(more), signer, parseDCoC));
const qualitySystem    = (more?: JSONObject, signer = PTB_CERTIFICATES): DigitalCertificateOfConformity => parseDCoC(signed(qualitySystemJSON(more),   signer, parseDCoC));
const declaration      = (more?: JSONObject, signer = SAALE_MODELS):     DigitalDeclarationOfConformity => parseDDoC(signed(declarationJSON(more),     signer, parseDDoC));
const calibration      = (more?: JSONObject, signer = LAB_CERTIFICATES): DigitalCalibrationCertificate  => parseDCC (signed(calibrationJSON(more),     signer, parseDCC));

/** The effective energy meter of the given EVSE of QA, as it is at runtime. */
const meterOf = (evseId: string): JSONObject => {
    const pools    = (defined((qa.effectiveContent['chargingStationOperators'] as JSONObject[])[0])['chargingPools'] as JSONObject[]);
    const evses    = pools.flatMap(pool => pool['chargingStations'] as JSONObject[]).flatMap(station => station['EVSEs'] as JSONObject[]);
    return defined(defined(evses.find(evse => evse['@id'] === evseId))['energyMeter'] as JSONObject | undefined);
};


describe('QI-Digital: the papers of a meter (example A14)', () => {

    it('checks each document against the roaming network: signed by a key of its issuer that may sign it', () => {

        const dcoc = typeExamination();
        const qs   = qualitySystem();
        const ddoc = declaration();
        const dcc  = calibration();

        dcoc.verify(qa, T0);
        qs.verify(qa, T0);
        ddoc.verify(qa, T0);
        dcc.verify(qa, T0);

        expect(dcoc.documentText).toBe("the digital certificate of conformity 'DE-26-M-PTB-0108'");
        expect(dcoc.model?.hardwareRevisions).toEqual([ '1.4' ]);
        expect(qs.model).toBeUndefined();
        expect(qs.manufacturer?.scope).toEqual([ 'MI-003' ]);
        expect(ddoc.legislations.map(legislation => legislation.name)).toEqual([ 'MID', 'EMC', 'RoHS' ]);
        expect(dcc.passes).toBe(true);
        expect(dcc.mainSigner?.name).toBe('Dr. Erika Mustermann');
        expect(dcc.isDueAt(T0)).toBe(false);
        expect(dcc.isDueAt('2034-10-26T00:58:00.000Z')).toBe(true);
        expect(dcc.digest).toMatch(/^[0-9a-f]{64}$/u);
        expect(dcc.signature?.signedAt).toBe(Date.parse(T0));

    });

    it('checks the declaration against the certificates it names, and each certificate covers the meter', () => {

        const dcc = calibration();

        declaration().verifyCertificate(typeExamination());
        declaration().verifyCertificate(qualitySystem());

        typeExamination().cover(dcc.item);
        qualitySystem().cover(dcc.item);

        // The meter as QA names it at runtime: its manufacturer, model and versions those of its template.
        typeExamination().cover(QIDigitalItem.ofEnergyMeter(meterOf('DE*GEF*E2*1')));

        // The DC meter of DE*GEF*E1*1, a KDM-500 of KERNBERG.
        const dcMeter = QIDigitalItem.ofEnergyMeter(meterOf('DE*GEF*E1*1'));
        expect(() => { typeExamination().cover(dcMeter); }).toThrow("The energy meter 'DE*GEF*M1*1' is no 'SM-3' of 'SAALE'!");
        expect(() => { qualitySystem().cover(dcMeter); }).toThrow("The energy meter 'DE*GEF*M1*1' is none of 'SAALE'!");

    });

    it('reads back what it writes, with its signature', () => {

        for (const document of [ typeExamination(), qualitySystem(), declaration(), calibration() ]) {
            const again = document instanceof DigitalCalibrationCertificate  ? DigitalCalibrationCertificate.parseText(canonicalJSON(document.toJSON()))
                        : document instanceof DigitalDeclarationOfConformity ? DigitalDeclarationOfConformity.parseText(canonicalJSON(document.toJSON()))
                        :                                                      DigitalCertificateOfConformity.parseText(canonicalJSON(document.toJSON()));
            expect(canonicalJSON(again.toJSON())).toBe(canonicalJSON(document.toJSON()));
            expect(again.digest).toBe(document.digest);
        }

        expect(canonicalJSON(qualitySystem().toJSON()['manufacturer'] ?? null)).toBe('{"manufacturerId":"SAALE","scope":["MI-003"],"type":"EnergyMeterManufacturer"}');
        expect(qualitySystem().toJSON()['model']).toBeUndefined();

    });

    it('signs what WWCP_POI writes again of it, not the text as it is given', () => {

        // Signed as given here, the numbers without trailing zeros.
        const json      = signed(calibrationJSON(), LAB_CERTIFICATES, parseDCC);
        const input     = canonicalJSON(parseDCC(json).signatureInput());

        // 0.50 for 0.5, 0.080 for 0.08, "mainSigner": false, an identification with whitespace around it, a language in
        // capitals, an empty list of statements, an empty comment: the same signature input, so the same signature.
        const written   = clone(json);
        const results   = ((written['measurementResults'] as JSONObject[])[0]?.['results'] as JSONObject[]);
        const itr       = defined((defined(results[1])['quantities'] as JSONObject[])[0]);
        itr['value']    = parseJSON('0.50');
        defined((defined(results[0])['quantities'] as JSONObject[])[1])['expandedUncertainty'] = parseJSON('0.080');
        defined((written['respPersons'] as JSONObject[])[1])['mainSigner'] = false;
        written['@id']  = ' DCC-2026-0815 ';
        written['measurementResults'] = [ { ...defined((written['measurementResults'] as JSONObject[])[0]), name: { EN: 'Measurement error of the active energy' } } ];
        written['comment'] = {};

        const otherwise = parseDCC(written);

        expect(canonicalJSON(otherwise.signatureInput())).toBe(input);
        expect(input).toContain('"unit":"\\\\ampere","value":0.5}');
        expect(input).not.toContain('0.50');
        otherwise.verify(qa, T0);

        // The text as given hashes otherwise: it is not what is signed.
        const raw = createHash('sha256').update(canonicalJSONBytes({ ...written, signature: without(written['signature'] as JSONObject, 'value') })).digest('hex');
        expect(otherwise.digest).toBe(parseDCC(json).digest);
        expect(otherwise.digest).not.toBe(raw);

        // A revision left out is the revision 0, as it is written and signed.
        const withoutRevision = typeExaminationJSON();
        delete withoutRevision['revision'];
        expect(parseDCoC(withoutRevision).digest).toBe(parseDCoC(typeExaminationJSON()).digest);
        expect(canonicalJSON(parseDCoC(withoutRevision).signatureInput())).toContain('"revision":0');

        // A whole number written as one with zeros after its point is written as an integer.
        const quantity = QIDigitalQuantity.parse({ value: parseJSON('63.000'), unit: '\\ampere', toleranceUpper: parseJSON('1.50') });
        expect(canonicalJSON(quantity.toJSON())).toBe('{"toleranceUpper":1.5,"unit":"\\\\ampere","value":63}');

    });

});


describe('QI-Digital: refused documents', () => {

    it('refuses a document changed after it was signed, signed by a key not of its issuer, or not signed', () => {

        const changed = clone(signed(calibrationJSON(), LAB_CERTIFICATES, parseDCC));
        defined((defined(((changed['measurementResults'] as JSONObject[])[0]?.['results'] as JSONObject[])[3])['quantities'] as JSONObject[])[1])['value'] = parseJSON('-0.12');

        expect(() => { parseDCC(changed).verify(qa, T0); })
            .toThrow("The signature of the digital calibration certificate 'DCC-2026-0815' is invalid: ");

        expect(() => { calibration({}, PTB_CERTIFICATES).verify(qa, T0); })
            .toThrow(`The key '${PTB_CERTIFICATES.id}' of the digital calibration certificate 'DCC-2026-0815' is no signing key of the calibration laboratory 'EM-LAB'!`);

        expect(() => { parseDCC(calibrationJSON()).verify(qa, T0); })
            .toThrow("The digital calibration certificate 'DCC-2026-0815' is not signed!");

        // Signed by the key of the PTB for itself: that key signs its own properties only.
        expect(() => { typeExamination({}, PTB_PARTY).verify(qa, T0); })
            .toThrow(`The signing key '${PTB_PARTY.id}' of the conformity assessment body 'PTB' may not sign 'certificates', only 'party'!`);

        // A declaration is its manufacturer's.
        expect(() => { declaration({}, FOREIGN).verify(qa, T0); })
            .toThrow(`The key '${FOREIGN.id}' of the digital declaration of conformity 'DoC-SM-3-2026-01' is no signing key of the energy meter manufacturer 'SAALE'!`);

        expect(() => { parseDCC(calibrationJSON({ signature: { signedAt: T0, algorithm: 'ed25519', keyId: LAB_CERTIFICATES.id, value: 'AA==' } })).verify(qa, T0); })
            .toThrow('The signature of the digital calibration certificate \'DCC-2026-0815\' is invalid: Unknown or noncanonical signature algorithm.');

        expect(() => { parseDCC(calibrationJSON({ signature: { signedAt: T0, algorithm: 'Ed25519', keyId: LAB_CERTIFICATES.id, value: 'AA=' } })).verify(qa, T0); })
            .toThrow('is invalid: The value must contain nonempty canonical standard Base64.');

    });

    it('refuses a signature by a key not valid when it signed, or not at the time given', () => {

        const expired = network('2026-10-26T00:00:00.000Z');

        expect(() => { typeExamination().verify(expired); })
            .toThrow(`The signing key '${PTB_CERTIFICATES.id}' of the conformity assessment body 'PTB' is not valid at 2026-10-26T00:58:00.000Z, when the digital certificate of conformity 'DE-26-M-PTB-0108' was signed!`);

        const later = network('2026-10-27T00:00:00.000Z');
        typeExamination().verify(later, T0);

        expect(() => { typeExamination().verify(later, '2026-10-28T00:00:00.000Z'); })
            .toThrow(`The signing key '${PTB_CERTIFICATES.id}' of the conformity assessment body 'PTB' is not valid at 2026-10-28T00:00:00.000Z!`);

    });

    it('refuses a certificate of conformity whose body, legislation, model or validity does not fit', () => {

        expect(() => { typeExamination({ notifiedBodyNumber: '0103' }).verify(qa, T0); })
            .toThrow("The conformity assessment body 'PTB' is the notified body '0102', not '0103' as the digital certificate of conformity 'DE-26-M-PTB-0108' says!");

        expect(() => { typeExamination({ legislation: { name: 'CRA' } }).verify(qa, T0); })
            .toThrow("The conformity assessment body 'PTB' is not notified for the CRA, the digital certificate of conformity 'DE-26-M-PTB-0108' is issued under!");

        expect(() => { typeExamination({ conformityAssessmentBodyId: 'NOBODY' }).verify(qa, T0); })
            .toThrow("The conformity assessment body 'NOBODY' of the digital certificate of conformity 'DE-26-M-PTB-0108' is none of the roaming network 'QA'!");

        expect(() => { typeExamination({ model: { ...MODEL, firmwareVersions: [ '1.0.7', '2.0' ] } }).verify(qa, T0); })
            .toThrow("The firmware version '2.0' is none of the model 'SM-3' of 'SAALE'!");

        expect(() => { typeExamination({ model: { ...MODEL, modelId: 'SM-4' } }).verify(qa, T0); })
            .toThrow("The energy meter model 'SM-4' is none of 'SAALE'!");

        expect(() => { typeExamination({ model: { ...MODEL, type: 'ChargingStationModel' } }).verify(qa, T0); })
            .toThrow("The charging station manufacturer 'SAALE' is none of the roaming network 'QA'!");

        expect(() => { typeExamination({ revision: 1 }).verify(qa, '2036-10-26T00:00:00.001Z'); })
            .toThrow("The digital certificate of conformity 'DE-26-M-PTB-0108' revision 1 is not valid at 2036-10-26T00:00:00.001Z!");

        expect(() => { qualitySystem({ manufacturer: { type: 'EnergyMeterManufacturer', manufacturerId: 'NOBODY', scope: [ 'MI-003' ] } }).verify(qa, T0); })
            .toThrow("The energy meter manufacturer 'NOBODY' is none of the roaming network 'QA'!");

        // The certificate holder's identification compares without case.
        typeExamination({ conformityAssessmentBodyId: 'ptb', model: { ...MODEL, manufacturerId: 'saale', modelId: 'sm-3' } }).verify(qa, T0);

    });

    it('refuses a declaration whose certificates do not fit', () => {

        const both = declaration({ model: { ...MODEL, firmwareVersions: [ '1.0.7', '1.0.8' ] } });

        expect(() => { both.verify(qa, T0); }).toThrow("The firmware version '1.0.8' is none of the model 'SM-3' of 'SAALE'!");

        expect(() => { both.verifyCertificate(typeExamination()); })
            .toThrow("The certificate 'DE-26-M-PTB-0108' does not cover the firmware version '1.0.8' of the digital declaration of conformity 'DoC-SM-3-2026-01'!");

        expect(() => { declaration().verifyCertificate(typeExamination({ '@id': 'DE-26-M-PTB-0109' })); })
            .toThrow("The digital declaration of conformity 'DoC-SM-3-2026-01' names no certificate 'DE-26-M-PTB-0109'!");

        expect(() => { declaration().verifyCertificate(typeExamination({ module: 'F' })); })
            .toThrow("The certificate 'DE-26-M-PTB-0108' is one of the module F, not B!");

        expect(() => { declaration().verifyCertificate(typeExamination({ notifiedBodyNumber: '0103' })); })
            .toThrow("The certificate 'DE-26-M-PTB-0108' is one of 'PTB', not of the notified body 0102 'PTB' the digital declaration of conformity 'DoC-SM-3-2026-01' names!");

        expect(() => { declaration({ legislations: [ { name: 'EMC' } ] }).verifyCertificate(typeExamination()); })
            .toThrow("The certificate 'DE-26-M-PTB-0108' is issued under the MID, none of the legislations of the digital declaration of conformity 'DoC-SM-3-2026-01'!");

        expect(() => { declaration().verifyCertificate(typeExamination({ model: { ...MODEL, modelId: 'SM-4' } })); })
            .toThrow("The certificate 'DE-26-M-PTB-0108' is one of the model 'SM-4' of 'SAALE', not of 'SM-3' of 'SAALE'!");

        expect(() => { declaration().verifyCertificate(qualitySystem({ manufacturer: { type: 'EnergyMeterManufacturer', manufacturerId: 'KERNBERG', scope: [ 'MI-003' ] } })); })
            .toThrow("The certificate 'DE-26-QS-PTB-0042' approves the quality system of the energy meter manufacturer 'KERNBERG', not of the energy meter manufacturer 'SAALE' of the digital declaration of conformity 'DoC-SM-3-2026-01'!");

        // A quality system for products of a well-known kind takes that kind only; one of a kind not known here, any.
        expect(() => { declaration({ model: { ...MODEL, type: 'ChargingStationModel', manufacturerId: 'GraphDefined', modelId: 'GD-AC44' } }).verifyCertificate(
                           qualitySystem({ manufacturer: { type: 'ChargingStationManufacturer', manufacturerId: 'GraphDefined', scope: [ 'MI-003' ] } })); })
            .toThrow("The certificate 'DE-26-QS-PTB-0042' approves a quality system for MI-003, not for the model 'GD-AC44' of the digital declaration of conformity 'DoC-SM-3-2026-01'!");

        declaration({ model: { ...MODEL, type: 'ChargingStationModel', manufacturerId: 'GraphDefined', modelId: 'GD-AC44' } }).verifyCertificate(
            qualitySystem({ manufacturer: { type: 'ChargingStationManufacturer', manufacturerId: 'GraphDefined', scope: [ 'charging stations' ] } }));

        expect(() => { declaration({ notifiedBodies: [ { conformityAssessmentBodyId: 'BSI', notifiedBodyNumber: '0102' } ] }).verify(qa, T0); })
            .toThrow("The conformity assessment body 'BSI' is the notified body 'none', not '0102' as the digital declaration of conformity 'DoC-SM-3-2026-01' says!");

        expect(() => { declaration({ notifiedBodies: [ { conformityAssessmentBodyId: 'NOBODY', notifiedBodyNumber: '0102' } ] }).verify(qa, T0); })
            .toThrow("The notified body 'NOBODY' of the digital declaration of conformity 'DoC-SM-3-2026-01' is no conformity assessment body of the roaming network 'QA'!");

    });

    it('refuses a calibration certificate of a charging station or an energy meter changed since', () => {

        expect(() => { calibration({ item: { ...meterItem, firmwareVersion: '1.0.8' } }).verify(qa, T0); })
            .toThrow("The energy meter 'DE*GEF*M2*1' runs the firmware version '1.0.7', not '1.0.8'!");

        expect(() => { calibration({ item: { ...meterItem, hardwareRevision: '1.5' } }).verify(qa, T0); })
            .toThrow("The energy meter 'DE*GEF*M2*1' is of the hardware revision '1.4', not '1.5'!");

        expect(() => { calibration({ item: { ...meterItem, serialNumber: 'ACM-2026-002-2' } }).verify(qa, T0); })
            .toThrow("The energy meter 'DE*GEF*M2*1' has the serial number 'ACM-2026-002-1', not 'ACM-2026-002-2'!");

        expect(() => { calibration({ item: { ...meterItem, modelId: 'SM-4' } }).verify(qa, T0); })
            .toThrow("The energy meter 'DE*GEF*M2*1' is one of the model 'SM-3', not of 'SM-4'!");

        expect(() => { calibration({ item: { type: 'EnergyMeter', id: 'meter-9' } }).verify(qa, T0); })
            .toThrow("The energy meter 'meter-9' is none of the roaming network 'QA'!");

        expect(() => { calibration({ calibrationLaboratoryId: 'NOBODY' }).verify(qa, T0); })
            .toThrow("The calibration laboratory 'NOBODY' of the digital calibration certificate 'DCC-2026-0815' is no conformity assessment body of the roaming network 'QA'!");

        // A charging station as it is at runtime, with what its template gives it; its identification as WWCP_POI writes it.
        const station = calibration({ item: { type: 'ChargingStation', id: 'DEGEFS2', manufacturerId: 'GraphDefined', modelId: 'GD-AC44', serialNumber: 'GD-AC44-0002',
                                              hardwareRevision: '1.0', firmwareVersion: '1.8.2' } });
        station.verify(qa, T0);
        expect(station.item.id).toBe('DE*GEF*S2');
        expect(station.item.text).toBe("charging station 'DE*GEF*S2'");

        expect(() => { typeExamination().cover(station.item); }).toThrow("The charging station 'DE*GEF*S2' is no energy meter!");
        expect(() => { calibration({ item: { type: 'ChargingStation', id: 'DE*GEF*S2', manufacturerId: 'GraphDefined', modelId: 'GD-AC44' } }).verify(qa, T0); })
            .toThrow("The charging station 'DE*GEF*S2' is of the hardware revision '1.0', not ''!");

    });

    it('refuses what it cannot read, in the words of WWCP_POI', () => {

        const refused = (json: JSONObject, parse: (json: JSONValue) => unknown): string => {
            try {
                parse(json);
            }
            catch (e) {
                return e instanceof Error ? e.message : String(e);
            }
            throw new Error('Taken!');
        };

        expect(refused(calibrationJSON({ unsigned: 'x' }), parseDCC)).toBe("Unknown property 'unsigned' of a digital calibration certificate!");
        expect(refused(calibrationJSON({ '@context': DigitalCertificateOfConformity.CONTEXT }), parseDCC))
            .toBe("The JSON-LD context of a digital calibration certificate must be 'https://open.charging.cloud/contexts/wwcp/qiDigital/digitalCalibrationCertificate/v1'!");
        expect(refused(calibrationJSON({ measurementResults: [] }), parseDCC)).toBe("The digital calibration certificate 'DCC-2026-0815' requires at least one measurement result!");
        expect(refused(calibrationJSON({ beginPerformanceDate: '2026-10-20' }), parseDCC)).toBe('The beginning of the calibration must be written as yyyy-MM-ddTHH:mm:ss.fffZ!');
        expect(refused(calibrationJSON({ beginPerformanceDate: '2026-10-26T00:00:00Z' }), parseDCC)).toBe('The beginning of the calibration must be written as yyyy-MM-ddTHH:mm:ss.fffZ!');
        expect(refused(calibrationJSON({ countryCode: 'de' }), parseDCC)).toBe("The country of the digital calibration certificate 'DCC-2026-0815' must be two capital letters, ISO 3166-1 alpha-2!");
        expect(refused(calibrationJSON({ endPerformanceDate: '2026-10-25T21:57:59.999Z' }), parseDCC)).toBe("The calibration of the digital calibration certificate 'DCC-2026-0815' must not end before it began!");
        expect(refused(calibrationJSON({ recalibrationDue: '2026-10-25T23:58:00.000Z' }), parseDCC)).toBe("The recalibration of the digital calibration certificate 'DCC-2026-0815' must be due after its calibration!");
        expect(refused(calibrationJSON({ respPersons: [ { name: 'A', mainSigner: true }, { name: 'B', mainSigner: true } ] }), parseDCC)).toBe("The digital calibration certificate 'DCC-2026-0815' has at most one main signer!");
        expect(refused(calibrationJSON({ respPersons: [ { name: 'A', mainSigner: 'yes' } ] }), parseDCC)).toBe('Invalid responsible person \'{"name":"A","mainSigner":"yes"}\': Whether a person is the main signer must be true or false!');
        expect(refused(calibrationJSON({ performanceLocation: 'laboratory' }), parseDCC)).toBe("Invalid performance location 'laboratory'!");
        expect(refused(calibrationJSON({ '@id': ' ' }), parseDCC)).toBe("Invalid digital calibration certificate identification ' '!");
        expect(refused(calibrationJSON({ item: undefined as unknown as JSONValue }), parseDCC)).toContain('requires its item');
        expect(refused(calibrationJSON({ signature: 'x' }), parseDCC)).toBe('The signature must be a JSON object!');
        expect(refused(calibrationJSON({ signature: { signedAt: T0, algorithm: 'Ed25519', keyId: 'k' } }), parseDCC))
            .toBe('Invalid signature: A signature requires a signing timestamp, an algorithm, a key identification and a value!');
        expect(refused(calibrationJSON({ item: { ...meterItem, firmwareVersion: ' 1.0.7' } }), parseDCC)).toBe("Invalid item: Invalid firmware version ' 1.0.7'!");
        expect(refused(calibrationJSON({ item: { type: 'EnergyMeter', id: 'M', modelId: 'SM-3' } }), parseDCC)).toBe("Invalid item: The energy meter 'M' names its model with its manufacturer!");
        expect(refused(calibrationJSON({ item: { type: 'ChargingStation', id: 'S1' } }), parseDCC)).toBe("Invalid item: Invalid charging station identification 'S1'!");

        // Numbers are numbers, texts of languages are texts in languages.
        const quantity = (more: JSONObject): string => refused({ value: 1, unit: '\\percent', ...more }, json => QIDigitalQuantity.parse(json as JSONObject));
        expect(quantity({ value: '0.5' })).toBe('The value of a quantity must be a number!');
        expect(quantity({ coverageFactor: 2 })).toBe('A coverage factor or probability is one of an expanded uncertainty!');
        expect(quantity({ expandedUncertainty: parseJSON('0.1'), coverageProbability: parseJSON('1.5') })).toBe('The coverage probability of a quantity must be greater than 0 and at most 1!');
        expect(quantity({ expandedUncertainty: parseJSON('-0.1') })).toBe('The expanded uncertainty of a quantity must not be negative!');
        expect(quantity({ toleranceLower: 1, toleranceUpper: 0 })).toBe('The lower tolerance limit of a quantity must not exceed its upper one!');
        expect(quantity({ refType: 'basic value' })).toBe('The refType of a quantity must not be empty nor contain whitespace!');
        expect(quantity({ unit: ' \\percent' })).toBe('The unit of a quantity must neither be empty nor begin or end with whitespace!');
        expect(quantity({ conformity: 'pass' })).toBe("Invalid conformity 'pass'!");
        expect(quantity({ name: { en: 'Error', xx: 'Fehler' } })).toBe("JSON property 'name' (name of a quantity) could not be parsed: 'xx' is no language!");
        expect(quantity({ name: { en: 5 } })).toBe("JSON property 'name' (name of a quantity) could not be parsed: the text in 'en' must be a text!");
        expect(quantity({ name: { en: 'Error', EN: 'Error' } })).toBe("JSON property 'name' (name of a quantity) could not be parsed: the language 'en' is given twice!");
        expect(quantity({ name: 'Error' })).toBe("JSON property 'name' is not an object!");
        expect(refused(calibrationJSON({ measurementResults: [ { name: { en: 'M' }, results: [ { name: { en: 'R' }, quantities: [ { value: 1 } ] } ] } ] }), parseDCC))
            .toBe('Invalid measurement result \'{"name":{"en":"M"},"results":[{"name":{"en":"R"},"quantities":[{"value":1}]}]}\': Invalid result \'{"name":{"en":"R"},"quantities":[{"value":1}]}\': Invalid quantity \'{"value":1}\': A quantity requires a value and a unit!');

        // The holder of a certificate as its module asks for.
        const noManufacturer = qualitySystemJSON();
        delete noManufacturer['manufacturer'];
        expect(refused(qualitySystemJSON({ model: MODEL }), parseDCoC)).toBe("The digital certificate of conformity 'DE-26-QS-PTB-0042' of the module D approves the quality system of a manufacturer and names it, not a model!");
        expect(refused(noManufacturer, parseDCoC)).toBe("The digital certificate of conformity 'DE-26-QS-PTB-0042' of the module D requires the manufacturer whose quality system it approves!");
        expect(refused(typeExaminationJSON({ manufacturer: { type: 'EnergyMeterManufacturer', manufacturerId: 'SAALE', scope: [ 'MI-003' ] } }), parseDCoC))
            .toBe("The digital certificate of conformity 'DE-26-M-PTB-0108' of the module B is for a model and names it, not a manufacturer!");
        expect(refused(typeExaminationJSON({ notifiedBodyNumber: '102' }), parseDCoC)).toBe("The number of the notified body of the digital certificate of conformity 'DE-26-M-PTB-0108' must be four digits!");
        expect(refused(typeExaminationJSON({ validUntil: '2026-10-26T00:00:00.000Z' }), parseDCoC)).toBe("The digital certificate of conformity 'DE-26-M-PTB-0108' must be valid until after it is valid from!");
        expect(refused(typeExaminationJSON({ revision: parseJSON('1.0') }), parseDCoC)).toBe('The revision of a digital certificate of conformity must be an integer from 0!');
        expect(refused(typeExaminationJSON({ conditions: [ {} ] }), parseDCoC)).toBe("A condition of the digital certificate of conformity 'DE-26-M-PTB-0108' must not be empty!");
        expect(refused(typeExaminationJSON({ standards: [ { reference: 'EN 50470-3:2022' }, { reference: 'EN 50470-3:2022' } ] }), parseDCoC)).toBe('An standard of a certificate of conformity must not be given twice!');
        expect(refused(typeExaminationJSON({ documentURL: 'ftp://www.ptb.example/x.pdf' }), parseDCoC)).toBe("Invalid document URL 'ftp://www.ptb.example/x.pdf'!");
        expect(refused(typeExaminationJSON({ model: { ...MODEL, firmwareVersions: [] } }), parseDCoC)).toBe("Invalid model: A document of conformity of the energy meter model 'SM-3' names at least one firmware version of it!");
        expect(refused(typeExaminationJSON({ model: { ...MODEL, hardwareRevisions: [ '1.4', '1.4' ] } }), parseDCoC)).toBe("Invalid model: A hardware revision of the energy meter model 'SM-3' must not be given twice!");
        expect(refused(typeExaminationJSON({ model: { ...MODEL, firmwareVersions: [ ' 1.0.7' ] } }), parseDCoC)).toBe("Invalid model: Invalid firmware version ' 1.0.7'!");
        expect(refused(typeExaminationJSON({ model: { ...MODEL, type: 'Meter' } }), parseDCoC)).toBe("Invalid model: The type of a model must be 'ChargingStationModel' or 'EnergyMeterModel'!");
        expect(refused(qualitySystemJSON({ manufacturer: { type: 'EnergyMeterManufacturer', manufacturerId: 'SAALE', scope: [ 'MI-003' ], modelId: 'SM-3' } }), parseDCoC))
            .toBe("Invalid manufacturer: Unknown property 'modelId' of a manufacturer!");
        expect(refused(qualitySystemJSON({ manufacturer: { type: 'EnergyMeterManufacturer', manufacturerId: 'SAALE', scope: [] } }), parseDCoC))
            .toBe("Invalid manufacturer: A certificate of the quality system of the energy meter manufacturer 'SAALE' names at least one category of its scope!");
        expect(refused(qualitySystemJSON({ manufacturer: { type: 'EnergyMeterManufacturer', manufacturerId: 'SAALE', scope: [ 'MI-003', 'MI-003' ] } }), parseDCoC))
            .toBe("Invalid manufacturer: A category of the scope of the energy meter manufacturer 'SAALE' must not be given twice!");

        expect(refused(declarationJSON({ legislations: [] }), parseDDoC)).toBe("The digital declaration of conformity 'DoC-SM-3-2026-01' names at least one Union harmonisation legislation!");
        expect(refused(declarationJSON({ legislations: [ MID, MID ] }), parseDDoC)).toBe('An legislation of a declaration of conformity must not be given twice!');
        expect(refused(declarationJSON({ placeOfIssue: ' ' }), parseDDoC)).toBe("The digital declaration of conformity 'DoC-SM-3-2026-01' requires its place of issue!");
        expect(refused(declarationJSON({ notifiedBodies: [ { conformityAssessmentBodyId: 'PTB', notifiedBodyNumber: '102' } ] }), parseDDoC))
            .toBe('Invalid notified body \'{"conformityAssessmentBodyId":"PTB","notifiedBodyNumber":"102"}\': The number of a notified body must be four digits!');
        expect(refused(declarationJSON({ signatory: { name: 'Jane Doe ' } }), parseDDoC)).toBe('Invalid signatory: The name of a person must neither be empty nor begin or end with whitespace!');

    });

});


describe('QI-Digital: the parts', () => {

    it('tells modules, coverage and tolerance as WWCP_POI does', () => {

        expect([ 'D', 'D1', 'E', 'E1', 'H', 'H1' ].every(module => approvesQualitySystem(module as never))).toBe(true);
        expect([ 'B', 'F', 'F1', 'G' ].some(module => approvesQualitySystem(module as never))).toBe(false);

        const model = QIDigitalModel.parse(MODEL);
        expect(model.covers('1.4', '1.0.7')).toBe(true);
        expect(model.covers('1.4', '1.0.8')).toBe(false);

        const manufacturer = QIDigitalManufacturer.parse({ type: 'EnergyMeterManufacturer', manufacturerId: 'SAALE', scope: [ 'MI-003' ] });
        expect(manufacturer.inScope('EnergyMeter')).toBe(true);
        expect(manufacturer.inScope('ChargingStation')).toBe(false);
        expect(manufacturer.makes(model)).toBe(true);

        const within = QIDigitalQuantity.parse({ value: parseJSON('-0.21'), unit: '\\percent', expandedUncertainty: parseJSON('0.08'), toleranceLower: parseJSON('-1.0'), toleranceUpper: parseJSON('1.0') });
        expect(within.isWithinTolerance).toBe(true);
        expect(QIDigitalQuantity.parse({ value: parseJSON('0.95'), unit: '\\percent', expandedUncertainty: parseJSON('0.08'), toleranceUpper: 1 }).isWithinTolerance).toBe(false);
        expect(QIDigitalQuantity.parse({ value: 1, unit: '\\percent' }).isWithinTolerance).toBeUndefined();

        expect(calibration({ measurementResults: [ { name: { en: 'M' }, results: [ loadPoint('Imax', '63', '-0.95', '1.0', 'Fail') ] } ] }).passes).toBe(false);

    });

});
