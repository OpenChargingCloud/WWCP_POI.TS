import { describe, expect, it } from 'vitest';
import { CoseCurves, CoseKey } from '@vanaheimr/cose';

import { parseJSONObject }               from '../src/json/parse.ts';
import { canonicalJSON, canonicalJSONBytes } from '../src/json/canonical.ts';
import { cborETag, etagToText, jsonETag } from '../src/etags.ts';
import { effectiveContent }              from '../src/network/effective.ts';
import { effectiveTreeETag, entityDigest } from '../src/network/tree.ts';
import { verifySignature }               from '../src/crypto/signature.ts';
import { fromBase64, toHex }             from '../src/encoding/text.ts';
import { hash }                          from '../src/crypto/hash.ts';


// The examples of SPECIFICATION.md, section 6.

const content = parseJSONObject('{"@context":"https://open.charging.cloud/contexts/wwcp/roamingNetwork/v1","@id":"rn1","chargingStationOperators":[{"@id":"DE*GEF","chargingPools":[{"@id":"DE*GEF*P1","chargingStations":[{"@id":"DE*GEF*S1","EVSEs":[{"@id":"DE*GEF*E1*1","created":"2026-01-01T00:00:00.000Z","lastChange":"2026-01-01T00:00:00.000Z","maxPower":22000,"maxVoltage":230.5}],"created":"2026-01-01T00:00:00.000Z","lastChange":"2026-01-01T00:00:00.000Z"}],"created":"2026-01-01T00:00:00.000Z","lastChange":"2026-01-01T00:00:00.000Z"}],"created":"2026-01-01T00:00:00.000Z","lastChange":"2026-01-01T00:00:00.000Z","name":{"en":"Charging Station Operator \'DE*GEF\'"}}],"created":"2026-01-01T00:00:00.000Z","lastChange":"2026-01-01T00:00:00.000Z","name":{"en":"Example"}}');

const ed25519 = (base64: string): CoseKey => CoseKey.fromOkpPublicKey(CoseCurves.Ed25519, fromBase64(base64));


describe('SPECIFICATION.md section 6', () => {

    it('calculates the ETags of the content', () => {
        expect(etagToText(jsonETag(content))).toBe('json:sha256:hex:5592afaf5dfcceebc17c8a29f4493e061406f648b76a6fee8b6fe15d553c7108');
        expect(etagToText(cborETag(content))).toBe('cbor:sha256:hex:567697f19947efa4679a0e401e1e7c5f528ffb7ca0d3d7928d3b2ed02abef52d');
        expect(etagToText(effectiveTreeETag(effectiveContent(content), 'sha256'))).toBe('effectiveTree:sha256:hex:84acb445aa41df13e83b7af61f25a8387dc65c0c7e83b29b907e9ed06045b44a');
    });

    it('calculates the digests of the skeletons', () => {
        const evse = parseJSONObject('{"@id":"DE*GEF*E1*1","created":"2026-01-01T00:00:00.000Z","lastChange":"2026-01-01T00:00:00.000Z","maxPower":22000,"maxVoltage":230.5}');
        expect(toHex(entityDigest(evse, 'leaf', 'sha256'))).toBe('f37f52daaf5db8a3db648ac8ea7f3ef9955a1afff133803d1a9ff84b99fdc443');
    });

    it('identifies the genesis commit', () => {
        const commit = parseJSONObject('{"@context":"https://open.charging.cloud/contexts/wwcp/roamingNetwork/commit/v3","eTags":[["json","sha256","hex","5592afaf5dfcceebc17c8a29f4493e061406f648b76a6fee8b6fe15d553c7108"],["cbor","sha256","hex","567697f19947efa4679a0e401e1e7c5f528ffb7ca0d3d7928d3b2ed02abef52d"],["effectiveTree","sha256","hex","84acb445aa41df13e83b7af61f25a8387dc65c0c7e83b29b907e9ed06045b44a"]],"revision":0,"roamingNetworkId":"rn1"}');
        expect(toHex(hash('sha256', canonicalJSONBytes(commit)))).toBe('498e076a90b8d71254c017a80d164442abaa99b4d11d4deb9b8c86576917c29a');
    });

    it('verifies the leader signature, the attestation, the key statements, the certificate and the price statement', () => {

        const leaderInput = '{"@context":"https://open.charging.cloud/contexts/wwcp/roamingNetwork/commitSignature/v1","algorithm":"Ed25519","commit":{"@context":"https://open.charging.cloud/contexts/wwcp/roamingNetwork/commit/v3","@id":"498e076a90b8d71254c017a80d164442abaa99b4d11d4deb9b8c86576917c29a","eTags":[["json","sha256","hex","5592afaf5dfcceebc17c8a29f4493e061406f648b76a6fee8b6fe15d553c7108"],["cbor","sha256","hex","567697f19947efa4679a0e401e1e7c5f528ffb7ca0d3d7928d3b2ed02abef52d"],["effectiveTree","sha256","hex","84acb445aa41df13e83b7af61f25a8387dc65c0c7e83b29b907e9ed06045b44a"]],"revision":0,"roamingNetworkId":"rn1"},"keyId":"leader","role":"leader","signedAt":"2026-10-12T12:00:00.000Z","signer":"leader.example.org"}';
        expect(canonicalJSON(parseJSONObject(leaderInput))).toBe(leaderInput);
        verifySignature('Ed25519', ed25519('d3bocLkzVPKgskwj8qNsxOgOIjIYwbl5Jv3QGDlqK5s='), new TextEncoder().encode(leaderInput),
                        'x/h7//+MgkH18ljzmyXAIoirilwduHRjK9j/9/vKZIOPyO2Ir1eSbvfFkj1kSy9TwTIeMdqLAU22aOj7g1cGAA==');

        expect(() => { verifySignature('Ed25519', ed25519('d3bocLkzVPKgskwj8qNsxOgOIjIYwbl5Jv3QGDlqK5s='), new TextEncoder().encode(leaderInput + ' '),
                                       'x/h7//+MgkH18ljzmyXAIoirilwduHRjK9j/9/vKZIOPyO2Ir1eSbvfFkj1kSy9TwTIeMdqLAU22aOj7g1cGAA=='); }).toThrow();

        const attestationInput = '{"@context":"https://open.charging.cloud/contexts/wwcp/roamingNetwork/attestation/v1","algorithm":"Ed25519","commitId":"498e076a90b8d71254c017a80d164442abaa99b4d11d4deb9b8c86576917c29a","eTag":["effectiveTree","sha256","hex","84acb445aa41df13e83b7af61f25a8387dc65c0c7e83b29b907e9ed06045b44a"],"keyId":"rno","revision":0,"roamingNetworkId":"rn1","role":"roamingNetworkOperator","signedAt":"2026-10-17T18:00:00.000Z","signer":"DE*RNO","validUntil":"2026-10-17T18:15:00.000Z"}';
        verifySignature('Ed25519', ed25519('Kay64UG8yvCyLhqU000LxzYeUm0L/hLIl5S8kyKWbdc='), new TextEncoder().encode(attestationInput),
                        'enreFD6NAwKbGJBHryNsNNtgFn2wbVlI+w1PqplrkNzmnFSMPrvRp+AC1XVmUdeZ6jYh9BD1VoP/Iihq2YJ1CA==');

        const priceInput = '{"@context":"https://open.charging.cloud/contexts/wwcp/roamingNetwork/priceStatement/v1","algorithm":"Ed25519","entityId":"DE*GEF*E1*1","entityType":"EVSE","keyId":"8cb46c0f98440da34ad4af304431f76c7cb7462fa8fdfd5d6261dc685809220d","priceStatus":{"prices":[{"chargingTariffId":"DE*GEF*T1","elements":[{"priceComponents":[{"price":0.39,"stepSize":1,"type":"ENERGY"}]}]}]},"roamingNetworkId":"rn1","role":"chargingStationOperator","sequence":0,"signedAt":"2026-10-19T11:59:58.000Z","signer":"DE*GEF","validFrom":"2026-10-19T12:00:00.000Z","validUntil":"2026-10-19T12:15:00.000Z"}';
        const priceValue = 'On32sQ3JD5yUHL3CDnc0XA9+wpfEVw9wvXF3exh+rpcWOmBoD/tuvFBmNcolWWV5lOxF54JC5aJ0PmX9gPERAw==';
        verifySignature('Ed25519', ed25519('JUO5L/EJVRFHatyDadtt3JM2ZaEZeN2hQE7hBmypVZ0='), new TextEncoder().encode(priceInput), priceValue);

        const withValue = parseJSONObject(priceInput);
        withValue['value'] = priceValue;
        expect(toHex(hash('sha256', canonicalJSONBytes(withValue)))).toBe('4e0901a796be06c7332548becf01cc4066c4b4ced59975012304d4a50458e943');

    });

});
