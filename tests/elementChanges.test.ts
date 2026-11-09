import { describe, expect, it } from 'vitest';

import { rich } from './richNetwork.ts';

import { applyChangeSet, checkOwnership } from '../src/history/apply.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification } from '../src/history/changeSet.ts';
import { etagToJSON } from '../src/etags.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';
import type { JSONObject, JSONValue } from '../src/json/value.ts';


// Element changes (SPECIFICATION.md section 4, elements.ts): AddElement, RemoveElement, ReplaceElement,
// UpdateElementProperty and RemoveElementProperty address one element of a property of an entity by their element path,
// and amount to the change of that property. The after ETags are those WWCP_POI3 at 12e993a calculated for the same changes
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
                [ '5eda24dbe2a20aad61c023351f9b2673aa88295c5328dec6f77dbca46edac733', '1c574c7444eca91e747e3ddf8ae6a87d60ff903f596467dca27bd01d7fa4e8ef' ]);

        applied([ evse('AddElement', [ seg('chargingConnectors', '2') ], { newValue: C2 }) ],
                [ '534d6981956f8f64ec48ce61bdb1efcb9511ec5ff8d70efac3e095286f050100', 'b5bad91f2d629867d2575dbef2ea2cc40998be9c34fb338bbe1f40664c1523ba' ], withConnectors);

        // Removed, also by the old value it names.
        for (const oldValue of [ {}, { oldValue: C1 } ] as JSONObject[])
            applied([ evse('RemoveElement', [ seg('chargingConnectors', '1') ], oldValue) ],
                    [ '0df913375e37cc6e3e0e018d1be9b04dc263c651ec9962f02909adfeab7118f0', 'fd53aa8fd4642466cf8050e6f5e8881479083564068932017fdf7d492952d94f' ], withConnectors);

        applied([ evse('ReplaceElement', [ seg('chargingConnectors', '1') ], { newValue: { ...C1, format: 'SOCKET' } }) ],
                [ '5e6b2c5699efc24ca4f41841cf2284b450c68e98e3e28ec66c583b1c4165ba33', 'bcf43950dc15ecba4efc00a5dac628316669601dad3e33622e6d8fd812a169f3' ], withConnectors);

        for (const oldValue of [ {}, { oldValue: 'CABLE' } ] as JSONObject[])
            applied([ evse('UpdateElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: 'format', newValue: 'SOCKET', ...oldValue }) ],
                    [ 'df630627c2aea431b9af4bb352c441fcb90c1a323d3ec5a70fe04a1d8fdd920b', '838821a8062252077bf2838e93f4a52f8246a19cbc071b0baf80ece154d4ce4f' ], withConnectors);

        // An old value of JSON null expects the property absent.
        applied([ evse('UpdateElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: 'maxPower', oldValue: null, newValue: 22000 }) ],
                [ '61894a472dc5095f0472f6df291f172c430c51e5a16f9970da040ba1252b8489', '474b9ee41d5c8f03f5ff776fad1c47a18a659c81980378d78dbda0d888b01c27' ], withConnectors);

        applied([ evse('RemoveElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: 'format' }) ],
                [ '88f4501c2323d813560c39b105b29af4a8a25a649c110b2651dff84501627b98', '49d47f4f4c68910904b9f35ac4dc444249529df40825dae28306564a0ff3f4ce' ], withConnectors);

        // Changes of one property one after the other, and of an entity an earlier change added.
        applied([ evse('AddElement', [ seg('chargingConnectors', '2') ], { newValue: C2 }), evse('UpdateElementProperty', [ seg('chargingConnectors', '1') ], { propertyName: 'format', newValue: 'SOCKET' }) ],
                [ '8073c823172211032331a65af66cd64d5d13da2f82689a7955d1db22a9452e5e', '0fa35d041ea8b7ee960e6c40d738c0b6fd5c2da16fe5ed997a1fbaa1edf4162d' ],
                RoamingNetwork.parse(rich(({ evse }) => { evse['chargingConnectors'] = [ { ...C1 } ]; })));

        applied([ { kind: 'Add', entityType: 'EVSE', entityId: 'DE*GEF*E1*3', newValue: { '@id': 'DE*GEF*E1*3', currentTypes: [ 'DC' ], templateIds: [ 'DE*GEF*ET_DC' ] },
                    parentEntityType: 'ChargingStation', parentEntityId: 'DE*GEF*S1' },
                  element('AddElement', 'EVSE', 'DE*GEF*E1*3', [ seg('chargingConnectors', '2') ], { newValue: C2 }) ],
                [ '5f0ba6c74cf873046f9ba4b8da28cb06ad62116a00359cdcae5fd0b2b710f176', 'eb49b49f95396f98ec7d2097b22a1663971e16b8be3d618d2c7d44df8e7f019d' ]);

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
                    [ 'd230bb556ef72709e1b698d009e67f9ba1ddd13b7290518be5987311aeca6ca6', '7c2df278571486032f753039db3245a5dd46a32a71ca1f1341649c395ca18a0c' ]);

        applied([ evse('RemoveElement', [ seg('energyMeter') ]) ],
                [ '4a98ee9374b601490bb3aa03537289bb439bba9a0ba321ea89869c6fe120bdc2', '4831939c058c52908d71d0986b3965acdd12b35cdff37ca354865345ac43c724' ]);
        applied([ evse('RemoveElement', [ seg('energyMeter'), seg('publicKeys', 'dabde08ee1c4ccad0f3f40cc04b8a29cc7fd03e1d4c2e45d52d2249189deff51') ]) ],
                [ '59c786c34c41284e3bebed1d389630c18d48c2d1652ab77ca538a2b2d86aef7b', 'e682d5daff15db7ef189cca5e1e559f297905d20009201dc45f554fde3f1ecd1' ]);
        applied([ evse('AddElement', [ seg('energyMeter'), seg('templateIds', 'DE*GEF*EMT_AC') ], { newValue: 'DE*GEF*EMT_AC' }) ],
                [ 'acabdc2fafa3f15af10b8dc4a267940e5fc0aef96c353631e633aa3292c8e7ec', 'fbc312edebf01f140ef0bd14055e4fd4e52b1a76c4ccae09582661c6f1c248a6' ]);

        // The value of a property, its JSON-LD context named or not.
        for (const path of [ [ seg('maxPower') ], [ { '@context': 'https://open.charging.cloud/contexts/wwcp/roamingNetwork/elementPathSegment/v1', propertyName: 'maxPower' } ] ])
            applied([ evse('RemoveElement', path) ],
                    [ 'b068706abfd5ac15a16785a5a0abebfd6b8153a783f1df584ec192c86eec2caf', 'f1ddf909ddbd1b9c4c3ad411e3197686fac7fd66f353c39f5b763e5a400af6a0' ]);
        applied([ evse('AddElement', [ seg('physicalReference') ], { newValue: 'Left' }) ],
                [ '3af4366795b4327e5b6ae65187278e1617e484a5f5f76d4877a951ca66f257b3', 'a9fb13e6ec1086fe04db645cc234383eac0a5bcf470bcb96051827fdd177b391' ]);

        // Members of a group, compared as their type compares them, in the ordinal order of the identifications.
        applied([ element('AddElement', 'EVSEGroup', 'DE*GEF*EG_AC', [ seg('EVSEIds', 'DE*GEF*E1*1') ], { newValue: 'DE*GEF*E1*1' }) ],
                [ '60d8756f6062dc1190345c5d03b0cb3986fb196482b1a0a7baf28bf7ca532245', 'c48e1381e675b0b0de0177210e4786f8ed26801194c54dfd96caca3678808401' ]);
        applied([ element('AddElement', 'EVSEGroup', 'DE*GEF*EG_AC', [ seg('EVSEIds', 'DE*GEF*E5*1') ], { newValue: 'DE*GEF*E5*1' }) ],
                [ '633304f85bc76f48922c3e5d5bb424b26f7a1597e2407e8061d4058132760c3d', '3e426eae02ebcb611e5402b0239905d1812e32ff99522ad816281f8c6c086cae' ]);
        for (const id of [ 'DE*GEF*E2*1', 'DEGEFE21' ])
            applied([ element('RemoveElement', 'EVSEGroup', 'DE*GEF*EG_AC', [ seg('EVSEIds', id) ]) ],
                    [ 'c68167c840a475ceede2f1f4b5f739d9347712a67a5a1a9cb4b3f4c879d28b6b', '7d80a9301a67e1c9a4f84f18ba6f8b048184df0211149e684c5e38ce4f6353ea' ]);

        // The last element removed, the array is.
        applied([ element('RemoveElement', 'ChargingPoolGroup', 'DE*GEF*PG_ALL', [ seg('chargingPoolIds', 'DE*GEF*P1') ]) ],
                [ 'eae33d93e06c6076e6ecff955371255d7b4508db1128db7e3ee53659c3c430d3', '87628e1856dfb8be82cd30e1f874ef050849578978d470bc214dd2630179edc4' ]);

        // Templates, whose order is content: at the end.
        applied([ element('AddElement', 'ChargingStation', 'DE*GEF*S1', [ seg('templateIds', 'DE*GEF*ST_AC') ], { newValue: 'DE*GEF*ST_AC' }) ],
                [ '92a9ce9a6ca5aa9fba818a05db3ab63e3f258fbc7c9457a5b4258f4227131a53', '7a58564b44e43ecefda13ecc32f82265b7fb35ba0e76a2c2897704c0a639007d' ]);

        applied([ element('UpdateElementProperty', 'ChargingPool', 'DE*GEF*P1', [ seg('name') ], { propertyName: 'de', newValue: 'Jena Paradies' }) ],
                [ '47940129a99ebc29df39035412366550057325e27c2be8bdf4a93d08c6457e9e', 'c9daa0c819c43c50beb8f818103eb96fe3003ba7b429cc1a1cac6ed24cbcca51' ]);
        applied([ element('AddElement', 'ChargingPool', 'DE*GEF*P1', [ seg('brands', 'P-Brand') ], { newValue: { '@id': 'P-Brand', name: { en: 'P' } } }) ],
                [ '91a8e143c35b02f85f905ca956772c821fc5106bd372a62a25868f1a5d24c276', '112e8b49106441f0211fca4cb232ab6166311e4bc65dfe4f345400ac5d3f1240' ]);

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
                [ '75b2b171fff26ad8c32a1c8726b2483e2dc4e9a0a50b12acd7c912ae9b41184a', '99cf50914ad97a31cee7af39123ffdcbae9b50e8ced2188d2ee485481b0312ee' ]);
        applied([ element('AddElement', 'ConformityAssessmentBody', 'PTB', [ seg('notifiedFor', 'CRA') ], { newValue: 'CRA' }) ],
                [ '5badadcc6037bade4407ebd4674f4bc1721c967bfbbd6f57943c8d19f6a632e1', '263070b51e7bc34ba2c4be82db752cbd4808b17855d8e33bc41bc997c4597322' ]);
        applied([ element('AddElement', 'ChargingStationModel', 'GD-DC300', [ seg('firmwareVersions', '2.6.0') ], { newValue: '2.6.0', parentEntityType: 'ChargingStationManufacturer', parentEntityId: 'GraphDefined' }) ],
                [ '8fa72b81da2e4e7c627d2b03b6bd8079d9e4b5b31032ec3d25960a0d827d4427', 'f7b3790e8b2fd6a88efe7c23fb97f1bacbc639882c9b1ca119cbff9d8f855413' ]);
        applied([ element('UpdateElementProperty', 'RoamingNetwork', QA.id, [ seg('name') ], { propertyName: 'de', newValue: 'Qualitätssicherung' }) ],
                [ 'ebb566a8830e709eb2c10d93fd4bd231c514bd7a66637691ed3ee00b367c08ef', 'ce126780ac229500e1e61379e42a64caffacd144413775ae5369a25183869d2d' ]);
        applied([ element('UpdateElementProperty', 'RoamingNetworkOperator', QA.operator?.id ?? '', [ seg('name') ], { propertyName: 'de', newValue: 'OCC' }) ],
                [ '4d34f02951a964c9af75c03d66f33a0e3193ce65208935150fd4018ccf883f53', '8a7d51ed98e17ae478155c4611123d34bf8ea44e3e789417c0cba6e91d14854a' ]);

        applied([ element('UpdateElementProperty', 'ChargingTariffOffer', 'offer-1', [ seg('discount') ], { propertyName: 'percent', newValue: 20 }) ],
                [ '72146717d9ec71e6ba8d4d462e9b43befa82b65f63376fe4c4660f9d563eb9ff', 'e135fa77fd20a1c6a8c1f0a19a1db4bc6ba2794b74e5e8c81c92b9a427999f0d' ]);
        applied([ element('AddElement', 'EVSEGroup', 'DE*GDF*EG_FAV', [ seg('EVSEIds', 'DE*GEF*E2*1') ], { newValue: 'DE*GEF*E2*1' }) ],
                [ '07c2186ed8e187944e75cd71cdb55ae22a72a80a823c7fb1774f0c55fe79ea67', '319aa3862f2037829c73716f5fbd76b3171d85370f1c2703dcd86266ff16ec65' ]);
        applied([ element('UpdateElementProperty', 'GridConnectionPoint', 'gcp-1', [ seg('energyMeter') ], { propertyName: 'serialNumber', newValue: 'GCP-1' }) ],
                [ '02fbf1ae2a59dfab9acc42dbac04a24e3be18a47d1bdd61070ee9d064534eb28', '298e43658ba4e6b08eb1a4e87e13d7d82187600dd94a194661c878bd1d121138' ]);
        applied([ element('RemoveElement', 'EnergyMeterGroup', 'net-meters', [ seg('energyMeterIds', 'GCP-METER-1') ]) ],
                [ '2883f638a850e3193a5d572da9bf1bd46133ec5f8d4e1f5be150a93593121296', '843dcff5698a89be2ca24356e2fa6b05b4d0d8b059866e59da4423a78a18e635' ]);
        applied([ element('RemoveElement', 'ParkingSpace', 'space-1', [ seg('parkingSensorIds', 'SENSOR-1') ]) ],
                [ '88999f0c76bc3936843f27da982476053aedb833e0631fe719b4f6098496d986', '502b8c51e402384cb0fd0a82216f1bc3a40bb7253bb764fd5e878cb493540dbc' ]);

    });

    it('keys and tree hash algorithms changed as a whole, refused in the words of WWCP_POI3', () => {

        expect(refusal([ element('RemoveElement', 'ChargingStationOperator', 'DE*GEF', [ seg('signingKeys', '501d6148dee005d33ff407bff6710c663a7cc703afb6f0c618f1afca247d0808') ]) ]))
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
