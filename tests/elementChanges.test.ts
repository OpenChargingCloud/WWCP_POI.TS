import { describe, expect, it } from 'vitest';

import { rich } from './richNetwork.ts';

import { applyChangeSet, checkOwnership } from '../src/history/apply.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification } from '../src/history/changeSet.ts';
import { etagToJSON } from '../src/etags.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';
import type { JSONObject, JSONValue } from '../src/json/value.ts';


// Element changes (SPECIFICATION.md section 4, elements.ts): AddElement, RemoveElement, ReplaceElement,
// UpdateElementProperty and RemoveElementProperty address one element of a property of an entity by their element path,
// and amount to the change of that property. The after ETags are those WWCP_POI3 at c1b641b calculated for the same changes
// of the same version (`CreateChangeSet`): a change set is taken only where this library ends in the very same content.

const AT  = '2026-11-05T10:00:00.000Z';
const QA  = RoamingNetwork.parse(rich());

const C1  = { '@id': '1', format: 'CABLE', type: 'IEC_62196_T2_COMBO' };
const C2  = { '@id': '2', format: 'CABLE', type: 'IEC_62196_T2_COMBO' };
const C3  = { '@id': '3', format: 'CABLE', type: 'IEC_62196_T2_COMBO' };

/** QA, the EVSE DE*GEF*E1*1 with the connectors 1 and 3. */
const withConnectors = RoamingNetwork.parse(rich(({ evse }) => { evse['chargingConnectors'] = [ { ...C1 }, { ...C3 } ]; }));

/** A change set of the given changes at AT, unsigned, leading to the version of the given json and cbor ETags, else to the one before. */
function changeSetOf(before: RoamingNetwork, changes: JSONObject[], after?: readonly [ string, string ]): ChangeSet {

    const beforeETags = before.changeSetETags().map(eTag => etagToJSON(eTag));
    const json: JSONObject = {
        '@context':        CHANGE_SET_CONTEXT,
        roamingNetworkId:  before.id,
        createdAt:         AT,
        changes,
        beforeETags,
        afterETags:        after === undefined ? beforeETags : [ [ 'json', 'sha256', 'hex', after[0] ], [ 'cbor', 'sha256', 'hex', after[1] ] ],
    };

    json['@id'] = changeSetIdentification(json);

    return ChangeSet.parse(json);

}

/** The version the given changes lead to, as WWCP_POI3 calculated its ETags. */
const applied = (changes: JSONObject[], after: readonly [ string, string ], before = QA): RoamingNetwork =>
    applyChangeSet(before, changeSetOf(before, changes, after), { checkOwnership: false });

/** Why the given changes are refused, word for word, before their after ETags are looked at. */
function refusal(changes: JSONObject[], before = QA): string {
    try {
        applyChangeSet(before, changeSetOf(before, changes), { checkOwnership: false });
    }
    catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
    return 'taken';
}

/** Who must sign the given changes: the refusal of them unsigned. */
function owners(changes: JSONObject[]): string {
    try {
        checkOwnership(QA, changeSetOf(QA, changes));
    }
    catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
    return 'signed';
}

const seg = (propertyName: string, elementId?: string): JSONObject =>
    elementId === undefined ? { propertyName } : { propertyName, elementId };

const element = (kind: string, entityType: string, entityId: string, elementPath: JSONValue, more: JSONObject = {}): JSONObject =>
    ({ kind, entityType, entityId, elementPath, ...more });

const evse = (kind: string, elementPath: JSONValue, more: JSONObject = {}): JSONObject =>
    element(kind, 'EVSE', 'DE*GEF*E1*1', elementPath, more);


describe('Element changes of an array of identified objects', () => {

    it('add, remove, replace and change an element as WWCP_POI3 does', () => {

        // The first element makes the array; another one goes where the ordinal order of the identifications puts it.
        applied([ evse('AddElement', [ seg('chargingConnectors', '1') ], { newValue: C1 }) ],
                [ 'c029692c72436fa0dafd9c4ae87f8f8ba2e634814f04982871eff0c1e329dd36', 'eef4e398a89fea10a9694455c5c7d99a68c7eb0e814f4c8db257a77f104ba0e3' ]);

        applied([ evse('AddElement', [ seg('chargingConnectors', '2') ], { newValue: C2 }) ],
                [ '99e85d4f3a838ac06890b4a4b49901947f1ce1c8fb4bab0623bf2599d0a29390', '8ad4323174e74649539438bd74051cb52cf899e275bc5e6886e46f7c7f0a594d' ], withConnectors);

        // Removed, also by the old value it names.
        for (const oldValue of [ {}, { oldValue: C1 } ] as JSONObject[])
            applied([ evse('RemoveElement', [ seg('chargingConnectors', '1') ], oldValue) ],
                    [ '74df0200689d1e17b4e95b6633e1bef6049b5b83bdcd02adbbfce7abbb399a06', '6d77177de4a7fa9207e93198ea9d9e4a8b233ec8621a3fbbeafbee8688ee7797' ], withConnectors);

        applied([ evse('ReplaceElement', [ seg('chargingConnectors', '1') ], { newValue: { ...C1, format: 'SOCKET' } }) ],
                [ '9703eef10ab13a65e684e47b03407f28da36e2ea7d9f59640f9054507cc2b2dc', '3ad82d46ca92769aa09272ee6f9f50242d9ec37cfbc8aa0505e5def807be3a7f' ], withConnectors);

        for (const oldValue of [ {}, { oldValue: 'CABLE' } ] as JSONObject[])
            applied([ evse('UpdateElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: 'format', newValue: 'SOCKET', ...oldValue }) ],
                    [ 'a87ab4387b280c7696d6459468f38c99b7a46351c9e3f51f0e01af86d93a643c', 'f195c4f9778eb8d2673beb55b410256992e750dfe2760a0fdbfbd97de525dcb3' ], withConnectors);

        // An old value of JSON null expects the property absent.
        applied([ evse('UpdateElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: 'maxPower', oldValue: null, newValue: 22000 }) ],
                [ 'b952c4cfed9ed3db6daccd3511e61d8bc62873ec7dd88960cacb74dc3647db26', 'fd33ca0e203d31a58fdd64ef85ad3b040d06a8490d7a258e7791603d293cee69' ], withConnectors);

        applied([ evse('RemoveElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: 'format' }) ],
                [ 'be3bc54fe559923ce84a9eaf9097edf9afdcd66fe9ea659c509dd02d9a9da2f4', '95a6ac90dc00964fc97feabbfc879580c8600339b913d6501753906f88aee3b9' ], withConnectors);

        // Changes of one property one after the other, and of an entity an earlier change added.
        applied([ evse('AddElement', [ seg('chargingConnectors', '2') ], { newValue: C2 }), evse('UpdateElementProperty', [ seg('chargingConnectors', '1') ], { propertyName: 'format', newValue: 'SOCKET' }) ],
                [ '1982eac3e2b3d5b604d0399f65f3eb8032bc607c09236992230ad10d3c34c262', '45e7afd6a68a3ea567e313f253ea9aaf5da29b001734839d1a5eec3d321bb0dc' ],
                RoamingNetwork.parse(rich(({ evse }) => { evse['chargingConnectors'] = [ { ...C1 } ]; })));

        applied([ { kind: 'Add', entityType: 'EVSE', entityId: 'DE*GEF*E1*3', newValue: { '@id': 'DE*GEF*E1*3', currentTypes: [ 'DC' ], templateIds: [ 'DE*GEF*ET_DC' ] },
                    parentEntityType: 'ChargingStation', parentEntityId: 'DE*GEF*S1' },
                  element('AddElement', 'EVSE', 'DE*GEF*E1*3', [ seg('chargingConnectors', '2') ], { newValue: C2 }) ],
                [ 'afda8d84240be324fdb1d9299b5006d569e8cedd6069dfb9e9520911d1479564', '6676e0a4315d84f01ce1c6ecde24b1313aa8c1719011ffb74d1745934f7b367b' ]);

    });

    it('refused in the words of WWCP_POI3', () => {

        const refused = (change: JSONObject): string => refusal([ change ], withConnectors);

        expect(refused(evse('AddElement', [ seg('chargingConnectors', '1') ], { newValue: C1 })))
            .toBe("Change 0: AddElement of the EVSE 'DE*GEF*E1*1': 'chargingConnectors['1']' already exists!");
        expect(refused(evse('AddElement', [ seg('chargingConnectors', '2') ], { newValue: C3 })))
            .toBe("Change 0: AddElement of the EVSE 'DE*GEF*E1*1': The element to add to 'chargingConnectors' must have the identification '2'!");
        expect(refused(evse('AddElement', [ seg('chargingConnectors') ], { newValue: C2 })))
            .toBe("Change 0: AddElement of the EVSE 'DE*GEF*E1*1': 'chargingConnectors' is an array: its elements are addressed by their identifications!");
        expect(refused(evse('RemoveElement', [ seg('chargingConnectors', '2') ])))
            .toBe("Change 0: RemoveElement of the EVSE 'DE*GEF*E1*1': 'chargingConnectors['2']' does not exist!");
        expect(refused(evse('ReplaceElement', [ seg('chargingConnectors', '1') ], { newValue: C2 })))
            .toBe("Change 0: ReplaceElement of the EVSE 'DE*GEF*E1*1': 'chargingConnectors['1']' must keep its identification: another element is removed and added!");
        expect(refused(evse('UpdateElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: '@id', newValue: '4' })))
            .toBe("Change 0: UpdateElementProperty of the EVSE 'DE*GEF*E1*1': The identification of 'chargingConnectors['3']' can not be changed: another element is removed and added!");
        expect(refused(evse('RemoveElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: 'maxPower' })))
            .toBe("Change 0: RemoveElementProperty of the EVSE 'DE*GEF*E1*1': 'chargingConnectors['3'].maxPower' does not exist!");
        expect(refused(element('AddElement', 'EVSE', 'DE*GEF*E9*1', [ seg('chargingConnectors', '1') ], { newValue: C1 })))
            .toBe("Change 0: the EVSE 'DE*GEF*E9*1' does not exist!");

        // The old value compared with the element, or the property of the element, the change addresses, which is named.
        expect(refused(evse('RemoveElement', [ seg('chargingConnectors', '1') ], { oldValue: C3 })))
            .toBe(`Change 0: 'chargingConnectors['1']' of the EVSE 'DE*GEF*E1*1' is no longer the expected old value, but '{"@id":"1","format":"CABLE","type":"IEC_62196_T2_COMBO"}'!`);
        expect(refused(evse('UpdateElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: 'format', oldValue: 'SOCKET', newValue: 'SOCKET' })))
            .toBe(`Change 0: 'chargingConnectors['3'].format' of the EVSE 'DE*GEF*E1*1' is no longer the expected old value, but '"CABLE"'!`);
        expect(refused(evse('UpdateElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: 'maxPower', oldValue: 5, newValue: 22000 })))
            .toBe("Change 0: 'chargingConnectors['3'].maxPower' of the EVSE 'DE*GEF*E1*1' is no longer the expected old value, but 'absent'!");

        // Its new value as the content holds it, and the entity read again.
        expect(refused(evse('UpdateElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: 'colour', newValue: 'red' })))
            .toBe(`Change 0: 'chargingConnectors['3'].colour' of the EVSE 'DE*GEF*E1*1' is given as '"red"', which the content does not hold at all!`);
        expect(refused(evse('UpdateElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: 'format', newValue: 'BAG' })))
            .toBe("Change 0: Invalid charging connector format 'BAG'!");

    });

});


describe('Element changes of one identified object, of values and of arrays of identifications', () => {

    it('as WWCP_POI3 applies them', () => {

        // The energy meter of an EVSE: by its property, also naming its identification, and deeper.
        for (const path of [ [ seg('energyMeter') ], [ seg('energyMeter', 'DE*GEF*M1*1') ] ])
            applied([ evse('UpdateElementProperty', path, { propertyName: 'serialNumber', newValue: 'DCM-2026-001-9' }) ],
                    [ '0348aa97d907d77344165cf9f3dfbe5ea02a17fda0732d38300292de706f7c2b', '69f46773a2d9b0b0b6efaf69142cdb3b67e29232fc51ed4829ca82cefcfa02c2' ]);

        applied([ evse('RemoveElement', [ seg('energyMeter') ]) ],
                [ '6803ded4b8b9d1e19cec689e6620c592c7a8c778c514e02c398f2d56994f0dba', '97baaf9a2635ddeaf6ef62534a72725909bfa3a7826930477e92760de9df60d4' ]);
        applied([ evse('RemoveElement', [ seg('energyMeter'), seg('publicKeys', 'b729f68ac2883c4ff7aa42f7acfea964036b95bde152e14bb521823ce7f61047') ]) ],
                [ '44adeabdb3714ca422c0b2c6406f30a46e954b98b26dfdf224a095002effca40', '327f46eecea419dc4932a0fade0e0e5373545a375411262efdbe04f240a73755' ]);
        applied([ evse('AddElement', [ seg('energyMeter'), seg('templateIds', 'DE*GEF*EMT_AC') ], { newValue: 'DE*GEF*EMT_AC' }) ],
                [ 'f7a9e41073580faeaf394c3f552a2498be54565d55dfe80a9be82fb0e3c63441', '5eb061c5e2593099263957deabb774a8694b83cbcd22728594bfeb91541b0daf' ]);

        // The value of a property, its JSON-LD context named or not.
        for (const path of [ [ seg('maxPower') ], [ { '@context': 'https://open.charging.cloud/contexts/wwcp/roamingNetwork/elementPathSegment/v1', propertyName: 'maxPower' } ] ])
            applied([ evse('RemoveElement', path) ],
                    [ '19498ef15d9ac58c6e746bb071a92d48e77a2a33fd7c40ab53bb9941bcf83904', 'fc309549abe4d2165e994793189375eeba8ab63054c81278171f026c63dfc329' ]);
        applied([ evse('AddElement', [ seg('physicalReference') ], { newValue: 'Left' }) ],
                [ '468ec9147ed5140a1a6f119178152f33a2bbcd4329b85fdbeaf942cc728ad362', 'ceaa32917a7a1110aaa439250f459ded6f037c154be5cc9f8b67f598f0439be0' ]);

        // Members of a group, compared as their type compares them, in the ordinal order of the identifications.
        applied([ element('AddElement', 'EVSEGroup', 'DE*GEF*EG_AC', [ seg('EVSEIds', 'DE*GEF*E1*1') ], { newValue: 'DE*GEF*E1*1' }) ],
                [ '72551e9f780b5cd3824f73880364c3f977c86d740d26c8820a67558c57072563', '84177138a358c32d7d8ea20ecd1eb0163ac2f0061bedf4ee8e90266c9f5ee753' ]);
        applied([ element('AddElement', 'EVSEGroup', 'DE*GEF*EG_AC', [ seg('EVSEIds', 'DE*GEF*E5*1') ], { newValue: 'DE*GEF*E5*1' }) ],
                [ 'f940afbec141b43f7c33f099ebfd724d32ab3ff52f46110c0b30141860bd97f2', '06adc441b92d75cf0486da8bbda1128c72c4e51c3c1452d918d8f0b85748daae' ]);
        for (const id of [ 'DE*GEF*E2*1', 'DEGEFE21' ])
            applied([ element('RemoveElement', 'EVSEGroup', 'DE*GEF*EG_AC', [ seg('EVSEIds', id) ]) ],
                    [ '8b9f0e519b47a7f81d7d3c954926135ed1c4ea193ba38058573808adce84efc6', 'c21fbb14bf27324865d0ef090f81e86be6028a52f04b42a1cc41b033340a8842' ]);

        // The last element removed, the array is.
        applied([ element('RemoveElement', 'ChargingPoolGroup', 'DE*GEF*PG_ALL', [ seg('chargingPoolIds', 'DE*GEF*P1') ]) ],
                [ 'a6cd372c978fff17ffbf3c49d3df580e4e16eeb2c4a09be9b62392ec00f808f8', 'b950906151957c05d443b9bd798cfce7e81e98f1fe389329280fa177cbd278fe' ]);

        // Templates, whose order is content: at the end.
        applied([ element('AddElement', 'ChargingStation', 'DE*GEF*S1', [ seg('templateIds', 'DE*GEF*ST_AC') ], { newValue: 'DE*GEF*ST_AC' }) ],
                [ '33589e1044229400d738b92316fab95ff1b7aab3deeac371b4a75caa7964cf36', '8c545ebbae619deb94ef80d2fb8d2b6ff7026f6d8f3e28ea51b3fd2017072335' ]);

        applied([ element('UpdateElementProperty', 'ChargingPool', 'DE*GEF*P1', [ seg('name') ], { propertyName: 'de', newValue: 'Jena Paradies' }) ],
                [ 'a9533457d5e792507bc4eef2403c8c6b7375c9089680f828df2aecf31f686ba4', '09c0ce33211ddbef8a73ef5277e064befb14909c24660b88c76b5efea3e27a2b' ]);
        applied([ element('AddElement', 'ChargingPool', 'DE*GEF*P1', [ seg('brands', 'P-Brand') ], { newValue: { '@id': 'P-Brand', name: { en: 'P' } } }) ],
                [ '60723dc83d39be00c1464959ca9060bb88bec636c911a5d5a6b5c4c3419605ed', '0252967aaab63d51801c0057623aee5ae1964fb51cc3c3a57aebf6335b941f35' ]);

    });

    it('refused in the words of WWCP_POI3', () => {

        expect(refusal([ evse('UpdateElementProperty', [ seg('energyMeter', 'de*gef*m1*1') ], { propertyName: 'serialNumber', newValue: 'X' }) ]))
            .toBe("Change 0: UpdateElementProperty of the EVSE 'DE*GEF*E1*1': 'energyMeter['de*gef*m1*1']' does not exist: the value of 'energyMeter' is not 'de*gef*m1*1'!");
        expect(refusal([ evse('ReplaceElement', [ seg('energyMeter') ], { newValue: { '@id': 'DE*GEF*M9*9', serialNumber: 'X' } }) ]))
            .toBe("Change 0: ReplaceElement of the EVSE 'DE*GEF*E1*1': 'energyMeter' must keep its identification 'DE*GEF*M1*1': another one is removed and added!");
        expect(refusal([ evse('RemoveElement', [ seg('energyMeter'), seg('publicKeys', 'ffff') ]) ]))
            .toBe("Change 0: RemoveElement of the EVSE 'DE*GEF*E1*1': 'energyMeter.publicKeys['ffff']' does not exist!");
        expect(refusal([ evse('AddElement', [ seg('maxPower') ], { newValue: 22000 }) ]))
            .toBe("Change 0: AddElement of the EVSE 'DE*GEF*E1*1': 'maxPower' already exists!");
        expect(refusal([ evse('RemoveElement', [ seg('maxPower', 'x') ]) ]))
            .toBe("Change 0: RemoveElement of the EVSE 'DE*GEF*E1*1': 'maxPower['x']' does not exist: the value of 'maxPower' is not 'x'!");
        expect(refusal([ evse('UpdateElementProperty', [ seg('maxPower'), seg('x') ], { propertyName: 'y', newValue: 1 }) ]))
            .toBe("Change 0: UpdateElementProperty of the EVSE 'DE*GEF*E1*1': 'maxPower' is no JSON object!");
        expect(refusal([ evse('UpdateElementProperty', [ seg('templateIds') ], { propertyName: 'y', newValue: 1 }) ]))
            .toBe("Change 0: UpdateElementProperty of the EVSE 'DE*GEF*E1*1': 'templateIds' is an array: its elements are addressed by their identifications!");
        expect(refusal([ element('AddElement', 'EVSEGroup', 'DE*GEF*EG_AC', [ seg('EVSEIds', 'DE*GEF*E1*1') ], { newValue: 'DE*GEF*E1*2' }) ]))
            .toBe("Change 0: AddElement of the EVSE group 'DE*GEF*EG_AC': The element to add to 'EVSEIds' must have the identification 'DE*GEF*E1*1'!");
        expect(refusal([ element('UpdateElementProperty', 'ChargingTariff', 'DE*GEF*T_AC', [ seg('elements', '0') ], { propertyName: 'x', newValue: 1 }) ]))
            .toBe("Change 0: UpdateElementProperty of the charging tariff 'DE*GEF*T_AC': The elements of 'elements' have no identifications of their own: it is changed as a whole!");
        expect(refusal([ element('AddElement', 'EnergyMeterTemplate', 'DE*GEF*EMT_AC', [ seg('signatureMethods', 'ocmf') ], { newValue: 'ocmf' }) ]))
            .toBe("Change 0: AddElement of the energy meter template 'DE*GEF*EMT_AC': 'signatureMethods['ocmf']' already exists!");

        // What a change set can not change, also element by element: the children, identification and timestamps of an entity.
        expect(refusal([ element('AddElement', 'ChargingPool', 'DE*GEF*P1', [ seg('chargingStations', 'DE*GEF*S9') ], { newValue: { '@id': 'DE*GEF*S9' } }) ]))
            .toBe("Change 0: the property 'chargingStations' of a charging pool can not be changed!");
        expect(refusal([ element('ReplaceElement', 'ChargingPool', 'DE*GEF*P1', [ seg('created') ], { newValue: AT }) ]))
            .toBe("Change 0: the property 'created' of a charging pool can not be changed!");
        expect(refusal([ element('RemoveElement', 'ChargingStationOperator', 'DE*GEF', [ seg('chargingPools', 'DE*GEF*P4') ]) ]))
            .toBe("Change 0: the property 'chargingPools' of a charging station operator can not be changed!");

    });

});


describe('Element changes of parties, the roaming network and the entities parties embed', () => {

    it('as WWCP_POI3 applies them', () => {

        applied([ element('UpdateElementProperty', 'ChargingStationOperator', 'DE*GEF', [ seg('brands', 'gef-brand') ], { propertyName: 'name', newValue: { en: 'GEF!' } }) ],
                [ '25c388d046d34c0d1ec094e44893dd2916014386532bd8d1b0c95505437a27e6', '458ca75381b3674607f501ffdb43dbffa96cc4eca28991be8bef297bb2366f6b' ]);
        applied([ element('AddElement', 'ConformityAssessmentBody', 'PTB', [ seg('notifiedFor', 'CRA') ], { newValue: 'CRA' }) ],
                [ '9f3c2d24a3b76ca663ecbd9693c9cf12ceac7424f5a64ee28273ab8ff68c7b25', '7619ca40dd4993ba4d4a0a776a66ca900a94ac8148482c3bf57a09d17300d354' ]);
        applied([ element('AddElement', 'ChargingStationModel', 'GD-DC300', [ seg('firmwareVersions', '2.6.0') ], { newValue: '2.6.0', parentEntityType: 'ChargingStationManufacturer', parentEntityId: 'GraphDefined' }) ],
                [ '2f8128a9dd1ea5ba0e6c8e9fa883593aa8b24bb9abfe0b03c663b80ea82e6391', 'b7528e382dc64c1bfd60bd07fc6d896309e787612f2ee8a427fb543205c07497' ]);
        applied([ element('UpdateElementProperty', 'RoamingNetwork', QA.id, [ seg('name') ], { propertyName: 'de', newValue: 'Qualitätssicherung' }) ],
                [ '62b012c3a9af0a0a934fef9601231fcd6ab064697320b04902131c36d5239cc9', '84e54cd5bd37aff433b0ccbde07ca3a9a06dac9f7373820c08cf04d70811e094' ]);
        applied([ element('UpdateElementProperty', 'RoamingNetworkOperator', QA.operator?.id ?? '', [ seg('name') ], { propertyName: 'de', newValue: 'OCC' }) ],
                [ 'c4284c23ce798fcab8dad017bac7c2341d22cef55d372e7a7216c619879d7556', '2c683be81c9466e2d8ade8a366e0da6363d59b625845e473b771c01107738b2f' ]);

        applied([ element('UpdateElementProperty', 'ChargingTariffOffer', 'offer-1', [ seg('discount') ], { propertyName: 'percent', newValue: 20 }) ],
                [ '4543f5f47288a637ec8d37b5a0796f92b75f0e207ae594c848e837d9469510ce', 'eaa6007b6516ff4e3f39a57a7197c780b310cdb6a61474b772fc438c6dc061c3' ]);
        applied([ element('AddElement', 'EVSEGroup', 'DE*GDF*EG_FAV', [ seg('EVSEIds', 'DE*GEF*E2*1') ], { newValue: 'DE*GEF*E2*1' }) ],
                [ 'ba103c90a7c2aee5b00b34e33f60b15c596ef0916388bdb263c4c71c500d2478', '2b838dac0b24dd78ade7c06443c63ad84b63bdce982c553e25e48f07f87e2573' ]);
        applied([ element('UpdateElementProperty', 'GridConnectionPoint', 'gcp-1', [ seg('energyMeter') ], { propertyName: 'serialNumber', newValue: 'GCP-1' }) ],
                [ '6ecc0123c95d9d586b4011abcdbf1704e24d950d2e7982a6cd39f656bb98165b', 'a358cad6b42dec9b5f8131742ae9afa609e92d24376adf9e80dc7ce059447a71' ]);
        applied([ element('RemoveElement', 'EnergyMeterGroup', 'net-meters', [ seg('energyMeterIds', 'GCP-METER-1') ]) ],
                [ 'b7d59e402725d99db9c6dda1cb302a92bbf17d61005516917470bf4d7223e6a6', 'd92c872d9a41ca891e4818aa26f0e5a7f45141b4ad03c4c2ebdfb0d56a433113' ]);
        applied([ element('RemoveElement', 'ParkingSpace', 'space-1', [ seg('parkingSensorIds', 'SENSOR-1') ]) ],
                [ '3fe6388468bad5fcc611ad52955026fee55860e15434389e85c17741341ce908', 'e8c4520742ad5d6a6c545a6c62797653afc598e81ed36fde615ac240b2120ef8' ]);

    });

    it('keys and tree hash algorithms changed as a whole, refused in the words of WWCP_POI3', () => {

        expect(refusal([ element('RemoveElement', 'ChargingStationOperator', 'DE*GEF', [ seg('signingKeys', '2cffb7299872665f61379379dfdc6368b609ddaf8c93ca836e57ccb8e077b3bc') ]) ]))
            .toBe("Change 0: the signingKeys of the charging station operator 'DE*GEF' are changed as a whole, not element by element!");
        expect(refusal([ element('AddElement', 'RoamingNetwork', QA.id, [ seg('treeHashAlgorithms', 'SHA-512') ], { newValue: 'SHA-512' }) ]))
            .toBe(`Change 0: the treeHashAlgorithms of the roaming network '${QA.id}' are changed as a whole, not element by element!`);
        expect(refusal([ element('RemoveElement', 'RoamingNetwork', QA.id, [ seg('chargingStationOperators', 'DE*GEF') ]) ]))
            .toBe(`Change 0: RemoveElement of the roaming network '${QA.id}': 'chargingStationOperators['DE*GEF']' does not exist!`);
        expect(refusal([ element('RemoveElement', 'RoamingNetworkOperator', QA.operator?.id ?? '', [ seg('signingKeyCertificates', 'x') ]) ]))
            .toBe(`Change 0: RemoveElement of the roaming network operator '${QA.operator?.id ?? ''}': The elements of 'signingKeyCertificates' have no identifications of their own: it is changed as a whole!`);
        expect(refusal([ element('UpdateElementProperty', 'ChargingStationOperator', 'DE*XXX', [ seg('name') ], { propertyName: 'de', newValue: 'X' }) ]))
            .toBe("Change 0: the charging station operator 'DE*XXX' does not exist!");

    });

    it('owned as the change of the property their path starts with', () => {

        expect(owners([ evse('AddElement', [ seg('chargingConnectors', '1') ], { newValue: C1 }) ]))
            .toBe("Change 0: AddElement of the EVSE 'DE*GEF*E1*1' ('chargingConnectors') needs a signature by a signing key of the ChargingStationOperator 'DE*GEF'!");
        expect(owners([ element('UpdateElementProperty', 'ChargingStationOperator', 'DE*GEF', [ seg('brands', 'GEF-Brand') ], { propertyName: 'name', newValue: { en: 'x' } }) ]))
            .toBe("Change 0: UpdateElementProperty of the ChargingStationOperator 'DE*GEF' ('brands') needs a signature by a signing key of the ChargingStationOperator 'DE*GEF'!");

        // The legislations a body is notified for are the roaming network operator's, its keys the party's identity keys'.
        expect(owners([ element('UpdateElementProperty', 'ConformityAssessmentBody', 'PTB', [ seg('notifiedFor', 'MID') ], { propertyName: 'x', newValue: 1 }) ]))
            .toBe(`Change 0: UpdateElementProperty of the ConformityAssessmentBody 'PTB' ('notifiedFor') needs signatures by signing keys of 2 holders of the roaming network operator '${QA.operator?.id ?? ''}'!`);
        expect(owners([ element('UpdateElementProperty', 'ChargingStationOperator', 'DE*GEF', [ seg('identityKeys', 'x') ], { propertyName: 'name', newValue: { en: 'x' } }) ]))
            .toBe("Change 0: UpdateElementProperty of the ChargingStationOperator 'DE*GEF' ('identityKeys') needs a signature by an identity key of the ChargingStationOperator 'DE*GEF'!");

        // The maintainer of a grid connection point, by it, its grid operator or the roaming network operator.
        expect(owners([ element('UpdateElementProperty', 'GridConnectionPoint', 'gcp-1', [ seg('maintainedBy') ], { propertyName: 'entityId', newValue: 'DE*NET' }) ]))
            .toBe(`Change 0: UpdateElementProperty of the GridConnectionPoint 'gcp-1' ('maintainedBy') needs signatures by signing keys of 2 holders of the roaming network operator '${QA.operator?.id ?? ''}' or a signing key of the ChargingStationOperator 'DE*GEF' or identity keys of 2 holders of the roaming network operator '${QA.operator?.id ?? ''}'!`);

    });

});


describe('Element changes WWCP_POI3 does not make', () => {

    it('refused when read', () => {

        const read = (change: JSONObject): string => {
            try {
                changeSetOf(QA, [ change ]);
            }
            catch (e) {
                return e instanceof Error ? e.message : String(e);
            }
            return 'read';
        };

        expect(read({ kind: 'AddElement', entityType: 'EVSE', entityId: 'DE*GEF*E1*1', newValue: C1 })).toBe('Change 0: AddElement requires a nonempty element path!');
        expect(read(evse('AddElement', [], { newValue: C1 }))).toBe('Change 0: AddElement requires a nonempty element path!');
        expect(read({ kind: 'UpdateProperty', entityType: 'EVSE', entityId: 'DE*GEF*E1*1', propertyName: 'maxPower', newValue: 1, elementPath: [ seg('maxPower') ] }))
            .toBe('Change 0: only element changes may contain an element path!');
        expect(read(evse('AddElement', [ seg('chargingConnectors', '1') ], { newValue: C1, oldValue: null }))).toBe('Change 0: AddElement requires a new value and no old value or property name!');
        expect(read(evse('RemoveElement', [ seg('maxPower') ], { newValue: 1 }))).toBe('Change 0: RemoveElement must not contain a new value or property name!');
        expect(read(evse('ReplaceElement', [ seg('maxPower') ]))).toBe('Change 0: ReplaceElement requires a new value and no property name!');
        expect(read(evse('ReplaceElement', [ seg('maxPower') ], { newValue: null }))).toBe('Change 0: a new JSON value must not be null; a property is cleared by RemoveProperty!');
        expect(read(evse('UpdateElementProperty', [ seg('energyMeter') ], { newValue: 1 }))).toBe('Change 0: UpdateElementProperty requires a property name and a new value!');
        expect(read(evse('RemoveElementProperty', [ seg('energyMeter') ]))).toBe('Change 0: property removal requires a property name and no new value!');
        expect(read(evse('RemoveElement', [ seg(' ') ]))).toBe('Change 0: invalid element path segment: a schema property name is required!');
        expect(read(evse('RemoveElement', [ seg('maxPower', ' ') ]))).toBe('Change 0: invalid element path segment: an element identifier must not be empty!');
        expect(read(evse('RemoveElement', [ { '@context': 'x', propertyName: 'maxPower' } ])))
            .toBe("Change 0: invalid element path segment: the JSON-LD context of the element path segment must be 'https://open.charging.cloud/contexts/wwcp/roamingNetwork/elementPathSegment/v1'!");
        expect(read(evse('RemoveElement', [ 'maxPower' ]))).toBe('Change 0: an element path segment must be a JSON object!');
        expect(read(evse('RemoveElement', { propertyName: 'maxPower' }))).toBe('Change 0: the element path must be a JSON array!');

    });

});
