import { describe, expect, it, vi } from 'vitest';

import { AT, asText, defined, readJSON } from './helpers.ts';
import { anchorPQ } from './qa.ts';

import { applyChangeSet } from '../src/history/apply.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification } from '../src/history/changeSet.ts';
import { etagToJSON } from '../src/etags.ts';
import { effectiveChargingStationOperator } from '../src/network/effective.ts';
import { RoamingNetwork, ROAMING_NETWORK_CONTEXT } from '../src/network/roamingNetwork.ts';
import { ChargingStationProof } from '../src/proofs/stationProof.ts';
import { verifyChargingStation } from '../src/verifier/chargingStation.ts';
import { clone, get, isArray, isObject, type JSONArray, type JSONObject, type JSONValue } from '../src/json/value.ts';


// A charging station that signs measurements itself, as an energy meter does (WWCP_POI 52f1172, ChargingStationMeasurementTests):
// the homepage of its model, its serial number, its transparency software releases, its signature methods and its public
// keys; and the ISO 15118 certificate of an EVSE. Templates give the homepage, the releases and the signature methods,
// never the serial number, the public keys or the ISO 15118 certificate of the single device.

const CREATED    = '2026-01-01T00:00:00.000Z';
const T0         = '2026-10-26T12:00:00.000Z';
const MODEL_URL  = 'https://acme.example/wallbox-22';
const SECC       = '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----';

/** Public keys of measurements, each identified by the SHA-256 of its DER encoded SubjectPublicKeyInfo. */
const KEY1: JSONObject = { '@id': 'a505d7150ec99ac0bf00dc7a92d8b88f1a29fe2c4a6807499468ae717bb09428',
                           key:   'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEH9HzB5rqsStL46cPQ1Xt2/v8IVAPFvNmQTiQNKT81AAw376UzZk1XGrAo7OyXjVDTCowuk6NQJ4XDlnOtZvlyg==' };
const KEY2: JSONObject = { '@id': 'a43be87741d7964969d8ecdb688f0bd7d9ecbd0db83a06028c3b2644d7d7d6d2',
                           key:   'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEhmPNht2qGK7OnUDNtopjWuR1e7chxYMY+bn+WiuGWs+JMdHE/lzjL2vJ3SA0g0csHU0gJ2HvajiXDdHCgpAxmw==' };

const status = (transparencySoftwareId: string, legalStatus: string): JSONObject => ({ transparencySoftwareId, legalStatus });

const release = (id: string, version: string): JSONObject =>
    ({ '@id': id, name: { en: 'Chargy' }, version, created: CREATED, lastChange: CREATED });

/**
 * Chargy 1.0 and 1.1; DE*GEF with the station S1, its serial number, its public key and Chargy 1.0 under the German
 * calibration law, its EVSE with an ISO 15118 certificate, and the template ST1, giving the homepage of the model, OCMF,
 * Chargy 1.0 for information only and Chargy 1.1 for information only.
 */
const network = (): RoamingNetwork => RoamingNetwork.parse({
    '@context':                         ROAMING_NETWORK_CONTEXT,
    '@id':                              'rn1',
    transparencySoftwareManufacturers:  [ { '@id': 'OpenChargingCloud', transparencySoftware: [ release('chargy-1.0', '1.0'), release('chargy-1.1', '1.1') ],
                                            created: CREATED, lastChange: CREATED } ],
    chargingStationOperators:           [ {
        '@id':                     'DE*GEF',
        chargingPools:             [ { '@id': 'DE*GEF*P1', chargingStations: [ {
                                       '@id':                       'DE*GEF*S1',
                                       serialNumber:                'WB22-000815',
                                       transparencySoftwareStatus:  [ status('chargy-1.0', 'germanCalibrationLaw') ],
                                       publicKeys:                  [ KEY1 ],
                                       templateIds:                 [ 'DE*GEF*ST1' ],
                                       EVSEs:                       [ { '@id': 'DE*GEF*E1*1', iso15118Certificate: SECC, created: CREATED, lastChange: CREATED } ],
                                       created:                     CREATED,
                                       lastChange:                  CREATED,
                                   } ], created: CREATED, lastChange: CREATED } ],
        chargingStationTemplates:  [ { '@id':                       'DE*GEF*ST1',
                                       modelURL:                    MODEL_URL,
                                       transparencySoftwareStatus:  [ status('chargy-1.0', 'forInformationOnly'), status('chargy-1.1', 'forInformationOnly') ],
                                       signatureMethods:            [ 'OCMF' ],
                                       created:                     CREATED,
                                       lastChange:                  CREATED } ],
        created:                   CREATED,
        lastChange:                CREATED,
    } ],
    created:                            CREATED,
    lastChange:                         CREATED,
});

const operatorOf = (content: JSONObject): JSONObject =>
    defined((get(content, 'chargingStationOperators') as JSONObject[])[0], 'DE*GEF');

const poolOf = (operator: JSONObject): JSONObject =>
    defined((get(operator, 'chargingPools') as JSONObject[])[0], 'DE*GEF*P1');

const stationOf = (operator: JSONObject): JSONObject =>
    defined((get(poolOf(operator), 'chargingStations') as JSONObject[])[0], 'DE*GEF*S1');

const evseOf = (station: JSONObject): JSONObject =>
    defined((get(station, 'EVSEs') as JSONObject[])[0], 'DE*GEF*E1*1');

/** The effective station S1 of a version: with what its template gives it. */
const effectiveStationOf = (version: RoamingNetwork): JSONObject =>
    stationOf(effectiveChargingStationOperator(operatorOf(version.content)));

/** The releases of a station or a meter, each with its legal status. */
const releasesOf = (entity: JSONObject): string[] =>
    (get(entity, 'transparencySoftwareStatus') as JSONObject[]).map(item => `${asText(item['transparencySoftwareId'])} ${asText(item['legalStatus'])}`);

const update = (entityType: string, entityId: string, propertyName: string, oldValue: JSONValue, newValue: JSONValue): JSONObject =>
    ({ kind: 'UpdateProperty', entityType, entityId, propertyName, oldValue, newValue });

/** An unsigned change set of the given changes, created at T0, ending in the ETags of the given content. */
function changeSet(before: RoamingNetwork, changes: JSONArray, after: JSONObject = before.content): ChangeSet {

    const json: JSONObject = {
        '@context':        CHANGE_SET_CONTEXT,
        roamingNetworkId:  'rn1',
        createdAt:         T0,
        changes,
        beforeETags:       before.changeSetETags().map(eTag => etagToJSON(eTag)),
        afterETags:        RoamingNetwork.parse(after).changeSetETags().map(eTag => etagToJSON(eTag)),
    };

    json['@id'] = changeSetIdentification(json);

    return ChangeSet.parse(json);

}


describe('A charging station signing measurements itself, and the ISO 15118 certificate of an EVSE', () => {

    it('takes the homepage of the model, the releases and the signature methods from its templates, not the device', () => {

        const version    = network();
        const effective  = effectiveStationOf(version);

        // The template gives the homepage of the model, its signature methods and its releases besides the station's own:
        // of a release the station names too, the station's, all ordered by release.
        expect(effective['modelURL']).toBe(MODEL_URL);
        expect(effective['signatureMethods']).toEqual([ 'OCMF' ]);
        expect(releasesOf(effective)).toEqual([ 'chargy-1.0 germanCalibrationLaw', 'chargy-1.1 forInformationOnly' ]);

        // Its serial number, public keys and ISO 15118 certificates are its own; the stored station names nothing of its template.
        expect(effective['serialNumber']).toBe('WB22-000815');
        expect(effective['publicKeys']).toEqual([ KEY1 ]);
        expect(evseOf(effective)['iso15118Certificate']).toBe(SECC);

        const stored = stationOf(operatorOf(version.content));
        expect(stored['modelURL']).toBeUndefined();
        expect(stored['signatureMethods']).toBeUndefined();

    });

    it('changes them by change sets, its own values before those of its template', () => {

        const before  = network();
        const changes = [
            update('ChargingStation', 'DE*GEF*S1',   'serialNumber',                'WB22-000815',                                 'WB22-000816'),
            update('ChargingStation', 'DE*GEF*S1',   'modelURL',                    null,                                          'https://acme.example/wallbox-22-rev-b'),
            update('ChargingStation', 'DE*GEF*S1',   'signatureMethods',            null,                                          [ 'SAFE' ]),
            update('ChargingStation', 'DE*GEF*S1',   'publicKeys',                  [ KEY1 ],                                      [ KEY2 ]),
            update('ChargingStation', 'DE*GEF*S1',   'transparencySoftwareStatus',  [ status('chargy-1.0', 'germanCalibrationLaw') ], [ status('chargy-1.1', 'germanCalibrationLaw') ]),
            update('EVSE',            'DE*GEF*E1*1', 'iso15118Certificate',         SECC,                                          '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----'),
        ];

        // The content as the changes leave it: the station, its EVSE and what embeds them changed at T0.
        const content   = clone(before.content);
        const operator  = operatorOf(content);
        const station   = stationOf(operator);

        for (const change of changes) {
            const entity = change['entityType'] === 'EVSE' ? evseOf(station) : station;
            entity[asText(change['propertyName'])] = clone(defined(change['newValue']));
        }

        for (const entity of [ evseOf(station), station, poolOf(operator), operator, content ])
            entity['lastChange'] = T0;

        const after      = applyChangeSet(before, changeSet(before, changes, content), { checkOwnership: false });
        const effective  = effectiveStationOf(after);

        expect(effective['serialNumber']).toBe('WB22-000816');
        expect(effective['modelURL']).toBe('https://acme.example/wallbox-22-rev-b');
        expect(effective['signatureMethods']).toEqual([ 'OCMF', 'SAFE' ]);
        expect(effective['publicKeys']).toEqual([ KEY2 ]);
        expect(releasesOf(effective)).toEqual([ 'chargy-1.0 forInformationOnly', 'chargy-1.1 germanCalibrationLaw' ]);
        expect(evseOf(effective)['iso15118Certificate']).toContain('MIIC');

    });

    it('refuses releases not in the order of their identifications, and a release given twice', () => {

        const before = network();

        for (const given of [ [ status('chargy-1.1', 'forInformationOnly'), status('chargy-1.0', 'germanCalibrationLaw') ],
                              [ status('chargy-1.0', 'forInformationOnly'), status('chargy-1.0', 'germanCalibrationLaw') ] ])
            expect(() => applyChangeSet(before, changeSet(before, [ update('ChargingStation', 'DE*GEF*S1', 'transparencySoftwareStatus', [ status('chargy-1.0', 'germanCalibrationLaw') ], given) ]),
                                        { checkOwnership: false }))
                .toThrow("'transparencySoftwareStatus' is not given as the content holds it: its elements are in the order the content holds them in, each once!");

    });

    it('shows the releases the station names, proven by its own certificates, as C# proves them', () => {

        // The station proof of example A13, as verified, its station naming Chargy itself, and a release the proof does not
        // give: C# proves the releases of the station besides those of its meters (RoamingNetworkEffectiveTree, 52f1172).
        // No run of the examples has a station signing measurements itself, so the attested content is changed here.
        const proof     = ChargingStationProof.parse(readJSON('published/QA-DE-GEF-E1-1-proof.json'));
        const verified  = proof.verify(anchorPQ, AT);
        const attested  = clone(verified.attested);

        const find = (value: JSONValue | undefined): JSONObject | undefined =>
            isArray(value)  ? value.map(find).find(found => found !== undefined)
          : isObject(value) ? (value['@id'] === 'DE*GEF*S1' && isArray(value['EVSEs']) ? value : Object.values(value).map(find).find(found => found !== undefined))
          : undefined;

        defined(find(attested), 'The station DE*GEF*S1')['transparencySoftwareStatus'] = [ status('chargy-1.5.0', 'germanCalibrationLaw'), status('chargy-9', 'forInformationOnly') ];

        vi.spyOn(proof, 'verify').mockReturnValue({ ...verified, attested });

        const station = verifyChargingStation(anchorPQ, proof, { at: AT, evseId: 'DE*GEF*E1*1' });

        // The release of the station is proven by the certificate of the station alone, those of the meters by both.
        expect(station.transparencySoftware.map(({ namedBy, legalStatus, release, certificates }) =>
                   `${namedBy.entityType} ${namedBy.entityId}: ${asText(release['@id'])}, ${legalStatus ?? ''}, as ${certificates.map(item => asText(item.certificate['@id'])).join(' and ')} name it`))
            .toEqual([ 'ChargingStation DE*GEF*S1: chargy-1.5.0, germanCalibrationLaw, as PTB-2026-0042 name it',
                       'EnergyMeter DE*GEF*M1*1: chargy-1.5.0, germanCalibrationLaw, as PTB-2026-0042 and PTB-2026-0017 name it',
                       'EnergyMeter DE*GEF*M1*2: chargy-1.5.0, germanCalibrationLaw, as PTB-2026-0042 and PTB-2026-0017 name it' ]);
        expect(station.warnings).toEqual([ "the transparency software 'chargy-9' of the charging station 'DE*GEF*S1' is not given by the proof" ]);

    });

});
