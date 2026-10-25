import { describe, expect, it } from 'vitest';

import { AT, asText, defined, readJSON } from './helpers.ts';
import { anchorPQ, commits } from './qa.ts';

import { ChangeSet }          from '../src/history/changeSet.ts';
import { Commit }             from '../src/history/commit.ts';
import { History }            from '../src/history/history.ts';
import { applyChangeSet }     from '../src/history/apply.ts';
import { verifyChargingStation } from '../src/verifier/chargingStation.ts';
import { clone, get, isArray, isObject, type JSONObject, type JSONValue } from '../src/json/value.ts';


// Example A13: who checks the meter. The transparency software manufacturer GraphDefined states its release of Chargy, the
// PTB certifies it for the GD-DC300 under the MID, each signing what it states; DE*GEF names both for its DC energy meters,
// and the station proof of DE*GEF*E1*1 gives them, checked as ExampleA13.Validate() does.

const proof = readJSON('published/QA-DE-GEF-E1-1-proof.json') as JSONObject;

/** The given texts of a JSON object, for comparing. */
const text = (object: JSONObject | undefined, property: string): string =>
    object === undefined ? '' : isObject(get(object, property)) ? asText(Object.values(get(object, property) as JSONObject)[0]) : asText(get(object, property));


describe('Example A13: who checks the meter', () => {

    it('checks the station proof against the trust anchor of epoch 2, and shows the release and the certificate of the meter', () => {

        const station = verifyChargingStation(anchorPQ, proof, { at: AT, evseId: 'DE*GEF*E1*1' });

        expect(station.revision).toBe(7);
        expect(station.commitId).toHaveLength(128);
        expect(station.attestedBy).toEqual([ 'AlphaOrg', 'BetaOrg', 'GammaOrg' ]);

        const software = station.transparencySoftware.filter(item => item.energyMeterId === 'DE*GEF*M1*1');
        expect(software).toHaveLength(1);

        const { legalStatus, release, manufacturer, certificate, body, bodyHasKeys, forThisModel } = defined(software[0]);

        expect(`DE*GEF*M1*1, the energy meter of DE*GEF*E1*1: ${legalStatus}`).toBe('DE*GEF*M1*1, the energy meter of DE*GEF*E1*1: germanCalibrationLaw');
        expect(`${text(release, 'name')} ${text(release, 'version')}, by ${text(manufacturer, 'name')}, ${text(manufacturer, 'craRole')}, supported until ${text(release, 'supportUntil')}, ` +
               `vulnerabilities to ${text(manufacturer, 'vulnerabilityContact')}, bill of materials ${text(release, 'softwareBillOfMaterials')}`)
            .toBe('Chargy Transparency Software 1.5.0, by GraphDefined GmbH, manufacturer, supported until 2031-10-25T14:39:26.621Z, vulnerabilities to security@graphdefined.example, ' +
                  'bill of materials https://www.graphdefined.example/chargy/1.5.0/sbom.cdx.json');
        expect(`${text(certificate, '@id')} for the ${text(certificate, 'chargingStationModel')} ${text(certificate, 'chargingStationModelVersion')}, under the ${text(certificate, 'legislation')}, ` +
               `by the ${text(body, '@id')}, notified body ${text(body, 'notifiedBodyNumber')} for ${(get(defined(body), 'notifiedFor') as string[]).join(', ')}`)
            .toBe('PTB-2026-0042 for the GD-DC300 1.0, under the MID, by the PTB, notified body 0102 for MID');

        // The PTB has keys of its own (it signed its certificate itself, as the commit of revision 6 shows); the certificate is
        // for the model of the station, as its manufacturer states it with its versions, in one of them.
        expect(bodyHasKeys).toBe(true);
        expect(forThisModel).toBe(true);

        const madeBy = defined(station.manufacturer);
        expect(`the station ${text(station.chargingStation, '@id')} is a ${text(madeBy.model, '@id')} of ${text(madeBy.manufacturer, '@id')}, ${text(madeBy.model, 'name')}, ` +
               `versions ${(get(defined(madeBy.model), 'versions') as string[]).join('/')}`)
            .toBe('the station DE*GEF*S1 is a GD-DC300 of GraphDefined, GraphDefined DC 300, versions 1.0/1.1');

        // The manufacturer and the body are given as skeletons: their own properties, without their other children.
        expect(get(manufacturer, 'transparencySoftware')).toBeUndefined();
        expect(get(defined(body), 'transparencySoftwareCertificates')).toBeUndefined();
        expect(station.warnings).toEqual([]);

    });

    it('gives the PTB only: no meter of the station names a certificate of the BSI', () => {

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
            .toThrow('Valid attestations of trusted keys of 0 holders attest the root effectiveTree:sha256:hex:80b1a440eb252f8068d4c07360d570ffe70b06ff0208177697f2763bb8e7602c of the proof, not of 2!');

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

        // Revision 6, the certificate of the PTB, signed by its key for certificates; revision 7, the DC energy meters.
        history.append(defined(all[5]));
        history.append(defined(all[6]));

        const ptb = defined((get(history.head.network.content, 'conformityAssessmentBodies') as JSONObject[]).find(item => item['@id'] === 'PTB'));
        expect((get(ptb, 'transparencySoftwareCertificates') as JSONObject[]).map(item => `${asText(item['@id'])} ${asText(item['legislation'])}`)).toEqual([ 'PTB-2026-0042 MID' ]);

        const bsi = defined((get(history.head.network.content, 'conformityAssessmentBodies') as JSONObject[]).find(item => item['@id'] === 'BSI'));
        expect(get(bsi, 'signingKeys')).toBeUndefined();
        expect(get(bsi, 'notifiedFor')).toEqual([ 'CRA' ]);

    });

});
