import { describe, expect, it } from 'vitest';

import { AT, asText, defined, readJSON } from './helpers.ts';
import { anchorPQ, commits } from './qa.ts';

import { ChangeSet }          from '../src/history/changeSet.ts';
import { Commit }             from '../src/history/commit.ts';
import { History }            from '../src/history/history.ts';
import { applyChangeSet }     from '../src/history/apply.ts';
import { verifyChargingStation } from '../src/verifier/chargingStation.ts';
import { clone, get, isArray, isObject, type JSONObject, type JSONValue } from '../src/json/value.ts';


// Example A13: who checks the meter. The transparency software manufacturer GraphDefined states its release of Chargy; the
// PTB certifies the GD-DC300 under the MID with the KDM-500 and Chargy as its components, and the KDM-500 with Chargy, each
// signing what it states; DE*GEF names the certificates for its DC stations and their meters, and Chargy for the meters,
// and the station proof of DE*GEF*E1*1 gives them, checked as ExampleA13.Validate() does.

const proof = readJSON('published/QA-DE-GEF-E1-1-proof.json') as JSONObject;

/** The given texts of a JSON object, for comparing. */
const text = (object: JSONObject | undefined, property: string): string =>
    object === undefined ? '' : isObject(get(object, property)) ? asText(Object.values(get(object, property) as JSONObject)[0]) : asText(get(object, property));


describe('Example A13: who checks the meter', () => {

    it('checks the station proof against the trust anchor of epoch 2, and shows the certificates of station and meter and the release', () => {

        const station = verifyChargingStation(anchorPQ, proof, { at: AT, evseId: 'DE*GEF*E1*1' });

        expect(station.revision).toBe(7);
        expect(station.commitId).toHaveLength(128);
        expect(station.attestedBy).toEqual([ 'AlphaOrg', 'BetaOrg', 'GammaOrg' ]);

        const versions = (object: JSONObject | undefined, property: string): string =>
            object === undefined ? '' : (get(object, property) as string[]).join('/');

        // The station and its meter, each a model of its manufacturer in a hardware revision and a firmware version.
        const madeBy   = defined(station.manufacturer);
        const meterBy  = defined(station.energyMeterModels.get('DE*GEF*M1*1'));
        const meter    = defined(station.energyMeters.find(item => item['@id'] === 'DE*GEF*M1*1'));

        expect(`The charging station ${text(station.chargingStation, '@id')}: a ${text(madeBy.model, '@id')} of ${text(madeBy.manufacturer, '@id')}, ${text(madeBy.model, 'name')}, ` +
               `hardware ${text(station.chargingStation, 'hardwareRevision')}, firmware ${text(station.chargingStation, 'firmwareVersion')}`)
            .toBe('The charging station DE*GEF*S1: a GD-DC300 of GraphDefined, GraphDefined DC 300, hardware 1.0, firmware 2.5.0');
        expect(`The energy meter ${text(meter, '@id')}: a ${text(meterBy.model, '@id')} of ${text(meterBy.manufacturer, '@id')}, ${text(meterBy.model, 'name')}, ` +
               `hardware ${text(meter, 'hardwareRevision')}, firmware ${text(meter, 'firmwareVersion')}`)
            .toBe('The energy meter DE*GEF*M1*1: a KDM-500 of KERNBERG, Kernberg DC meter 500 A, hardware 2.1, firmware 3.2');
        expect(`${versions(madeBy.model, 'hardwareRevisions')}, ${versions(madeBy.model, 'firmwareVersions')}`).toBe('1.0/1.1, 2.4.0/2.5.0');

        // The certificates they name, each of the PTB, for the model, the hardware revision and the firmware version of what
        // names it, with its components: Chargy, and for the station the KDM-500 it mounts.
        expect(station.certificates.map(({ namedBy, certificate, body, bodyHasKeys, forThisModel }) =>
                   `${namedBy.entityType} ${namedBy.entityId}: ${text(certificate, '@id')}${certificate['legislation'] === undefined ? '' : `, under the ${text(certificate, 'legislation')}`}, ` +
                   `by the ${text(body, '@id')}, notified body ${text(body, 'notifiedBodyNumber')}, keys of its own: ${bodyHasKeys}; ` +
                   `for the ${asText(certificate['chargingStationModel'] ?? certificate['energyMeterModel'])} ${versions(certificate, 'hardwareRevisions')}, firmware ${versions(certificate, 'firmwareVersions')}: ${forThisModel}; ` +
                   `with ${versions(certificate, 'verifiedTransparencySoftwareIds')}${(get(certificate, 'energyMeters') as JSONObject[] | undefined ?? []).map(item => `, the ${text(item, 'modelId')} of ${text(item, 'manufacturerId')} ${versions(item, 'hardwareRevisions')}, firmware ${versions(item, 'firmwareVersions')}`).join('')}`))
            .toEqual([ 'ChargingStation DE*GEF*S1: PTB-2026-0042, under the MID, by the PTB, notified body 0102, keys of its own: true; for the GD-DC300 1.0, firmware 2.5.0: true; ' +
                       'with chargy-1.5.0, the KDM-500 of KERNBERG 2.1, firmware 3.2',
                       'EnergyMeter DE*GEF*M1*1: PTB-2026-0017, by the PTB, notified body 0102, keys of its own: true; for the KDM-500 2.1, firmware 3.2: true; with chargy-1.5.0',
                       'EnergyMeter DE*GEF*M1*2: PTB-2026-0017, by the PTB, notified body 0102, keys of its own: true; for the KDM-500 2.1, firmware 3.2: true; with chargy-1.5.0' ]);

        // The release of the meter, with its legal status, proven by both certificates, which name it among their components.
        const software = station.transparencySoftware.filter(item => item.energyMeterId === 'DE*GEF*M1*1');
        expect(software).toHaveLength(1);

        const { legalStatus, release, manufacturer, certificates } = defined(software[0]);

        expect(`DE*GEF*M1*1, the energy meter of DE*GEF*E1*1: ${text(release, 'name')} ${text(release, 'version')}, ${legalStatus}, as ${certificates.map(item => text(item.certificate, '@id')).join(' and ')} name it`)
            .toBe('DE*GEF*M1*1, the energy meter of DE*GEF*E1*1: Chargy Transparency Software 1.5.0, germanCalibrationLaw, as PTB-2026-0042 and PTB-2026-0017 name it');
        expect(`by ${text(manufacturer, 'name')}, ${text(manufacturer, 'craRole')}, supported until ${text(release, 'supportUntil')}, ` +
               `vulnerabilities to ${text(manufacturer, 'vulnerabilityContact')}, bill of materials ${text(release, 'softwareBillOfMaterials')}`)
            .toBe('by GraphDefined GmbH, manufacturer, supported until 2031-10-26T00:56:51.634Z, vulnerabilities to security@graphdefined.example, ' +
                  'bill of materials https://www.graphdefined.example/chargy/1.5.0/sbom.cdx.json');

        // The manufacturer and the body are given as skeletons: their own properties, without their other children.
        expect(get(manufacturer, 'transparencySoftware')).toBeUndefined();
        expect(get(defined(station.certificates[0]).body, 'certificates')).toBeUndefined();
        expect(station.warnings).toEqual([]);

    });

    it('gives the PTB only: neither the station nor its meter names a certificate of the BSI', () => {

        const bodies = get(proof['roamingNetwork'] as JSONObject, 'conformityAssessmentBodies') as JSONObject;
        const given  = (get(bodies, '@leaves') as JSONObject[]).map(leaf => (leaf['@entity'] as JSONObject)['@id']);

        expect(given).toEqual([ 'PTB' ]);
        expect(get(bodies, '@size')).toBe(2);

    });

    it('refuses a certificate for another model: the proof leads to another root than the attestations attest', () => {

        const changed = clone(proof);
        const find    = (value: JSONValue | undefined): JSONObject | undefined =>
            isArray(value) ? value.map(find).find(found => found !== undefined)
          : isObject(value) ? (value['@id'] === 'PTB-2026-0042' ? value : Object.values(value).map(find).find(found => found !== undefined))
          : undefined;

        defined(find(changed))['chargingStationModel'] = 'GD-AC44';

        expect(() => verifyChargingStation(anchorPQ, changed, { at: AT }))
            .toThrow('lead to different roots');

    });

    it('refuses a release the roaming network operator would sign in place of its manufacturer', () => {

        // Epoch 2 up to revision 4: GraphDefined, the PTB and the BSI added.
        const history = History.fromSnapshot(readJSON('published/QA-epoch-2-genesis.json'));
        const all     = commits('proofs/QA-epoch-2-commits-to-head.json');

        for (const commit of all.slice(0, 4))
            history.append(commit);

        expect(history.head.commit.revision).toBe(4);
        expect(history.head.commit.description).toBe('GraphDefined, transparency software manufacturer, the PTB and the BSI, conformity assessment bodies');

        // Revision 5, the release of Chargy, without the signature of the software key of GraphDefined.
        const release   = Commit.parse(all[4]);
        const unsigned  = clone(defined(release.changeSet));
        unsigned['signatures'] = [];

        expect(release.description).toBe('Chargy 1.5.0');
        expect(() => applyChangeSet(history.head.network, ChangeSet.parse(unsigned)))
            .toThrow("Change 0: Add of the TransparencySoftware 'chargy-1.5.0' needs a signature by a signing key of the TransparencySoftwareManufacturer 'GraphDefined'!");

        // As committed, signed by the key of GraphDefined that may sign its releases.
        history.append(release);

        const graphDefined = defined((get(history.head.network.content, 'transparencySoftwareManufacturers') as JSONObject[])[0]);
        expect((get(graphDefined, 'transparencySoftware') as JSONObject[]).map(item => item['@id'])).toEqual([ 'chargy-1.5.0' ]);

        // Revision 6, the certificates of the PTB, signed by its key for certificates; revision 7, the DC stations and meters.
        history.append(defined(all[5]));
        history.append(defined(all[6]));

        const ptb = defined((get(history.head.network.content, 'conformityAssessmentBodies') as JSONObject[]).find(item => item['@id'] === 'PTB'));
        expect((get(ptb, 'certificates') as JSONObject[]).map(item => `${asText(item['@id'])} ${asText(item['legislation'] ?? '-')}`)).toEqual([ 'PTB-2026-0017 -', 'PTB-2026-0042 MID' ]);

        const bsi = defined((get(history.head.network.content, 'conformityAssessmentBodies') as JSONObject[]).find(item => item['@id'] === 'BSI'));
        expect(get(bsi, 'signingKeys')).toBeUndefined();
        expect(get(bsi, 'notifiedFor')).toEqual([ 'CRA' ]);

    });

});
