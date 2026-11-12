import { describe, expect, it } from 'vitest';

import { rich } from './richNetwork.ts';

import { applyChangeSet, checkOwnership } from '../src/history/apply.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification } from '../src/history/changeSet.ts';
import { etagToJSON } from '../src/etags.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';
import type { JSONObject, JSONValue } from '../src/json/value.ts';


// Element changes (SPECIFICATION.md section 4, elements.ts): AddElement, RemoveElement, ReplaceElement,
// UpdateElementProperty and RemoveElementProperty address one element of a property of an entity by their element path,
// and amount to the change of that property. The after ETags are those WWCP_POI3 at 76d3653 calculated for the same changes
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
                [ 'ef4607abe7684556184ff301b46bfee61b76ffe0620308acbcbb49a69afa5435', 'e719603562472478b093d7b498e05796a5f11875d3480e9ce03373bdf00f09ad' ]);

        applied([ evse('AddElement', [ seg('chargingConnectors', '2') ], { newValue: C2 }) ],
                [ 'f09057af270d53923b18555f2069b9c7faf5183aefd4ff0eecc0cd7b06a1ae3a', 'b311a21e60b6b1170d0e1fe99ebe5db985d0f35b015a4b6b2fc170dc1620e005' ], withConnectors);

        // Removed, also by the old value it names.
        for (const oldValue of [ {}, { oldValue: C1 } ] as JSONObject[])
            applied([ evse('RemoveElement', [ seg('chargingConnectors', '1') ], oldValue) ],
                    [ '31617a6873ad2529ccbf97581c93c2135924b06aa1b987df06707e5a503717ab', '5eb4181e71edb298d092b12979004e1b1294d10fca9bc95dd2e615009aead51e' ], withConnectors);

        applied([ evse('ReplaceElement', [ seg('chargingConnectors', '1') ], { newValue: { ...C1, format: 'SOCKET' } }) ],
                [ '3bd2221ec9751d7bc717f410cd419b21fe8ebdb61819545946ea94a15c605224', 'b4e11bd738097fd62187779d7a5322e1954498f9f6f92514c504985bb402c719' ], withConnectors);

        for (const oldValue of [ {}, { oldValue: 'CABLE' } ] as JSONObject[])
            applied([ evse('UpdateElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: 'format', newValue: 'SOCKET', ...oldValue }) ],
                    [ 'be9cb519e9c8ecbf1225a0680507f4c89d23a1f5cc1800735ceaf3967323b80b', '0d53f3ef3b1e9760eb989e76b723c9498b781e6ba756e0c1044c8e1104770fcf' ], withConnectors);

        // An old value of JSON null expects the property absent.
        applied([ evse('UpdateElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: 'maxPower', oldValue: null, newValue: 22000 }) ],
                [ '0c5fb9774560e7a03ee4cd9c671cbb16bc023732921701f92acdbea6f6630a7f', 'd155d12c17e471662e64072f15f2d8a9152e1fc7012ccfcd138cdb377ecf7477' ], withConnectors);

        applied([ evse('RemoveElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: 'format' }) ],
                [ '47c18655cc338af4abbd096fa5de11948567309da4604685dc62ebd1b006953c', '754ccd6a254a15b123bdfc6dbdb17a1479dd130841d10db16cafadf64371d12e' ], withConnectors);

        // Changes of one property one after the other, and of an entity an earlier change added.
        applied([ evse('AddElement', [ seg('chargingConnectors', '2') ], { newValue: C2 }), evse('UpdateElementProperty', [ seg('chargingConnectors', '1') ], { propertyName: 'format', newValue: 'SOCKET' }) ],
                [ 'f9f3e673c7eeb4727516cb1b6e20eb4607df51aeaba5a48c0c68a8b45c946b94', '21f098759ec13562c50998009128e028d60c6d35a2bf21393c835dea774b2b73' ],
                RoamingNetwork.parse(rich(({ evse }) => { evse['chargingConnectors'] = [ { ...C1 } ]; })));

        applied([ { kind: 'Add', entityType: 'EVSE', entityId: 'DE*GEF*E1*3', newValue: { '@id': 'DE*GEF*E1*3', currentTypes: [ 'DC' ], templateIds: [ 'DE*GEF*ET_DC' ] },
                    parentEntityType: 'ChargingStation', parentEntityId: 'DE*GEF*S1' },
                  element('AddElement', 'EVSE', 'DE*GEF*E1*3', [ seg('chargingConnectors', '2') ], { newValue: C2 }) ],
                [ 'af3e96e148d853758f99f09a4f144155be5b6a3e9ed077d2771dd828ecfd2b4a', 'b46f3828c0b057e35cf34466238ef6855773932d8dc0bfb7e5dd37320c4bc3df' ]);

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
                    [ 'b6883306592ac0aa654e9cd3ff94587c40282b99d6eba8616a21d1e985249f6a', 'c1c9f7f9f48056c889a27b0137a6c22a16a2cdcc12506beb367f073a982c2436' ]);

        applied([ evse('RemoveElement', [ seg('energyMeter') ]) ],
                [ '27b0ba2d3ce3a137ff8f2e70ad9f15570242fd397c6d356d21ec93f726aa018c', '3d228320eff2a0c61b07f5d25c7cc3b3468251ae56f0862cc48cb497db685229' ]);
        applied([ evse('RemoveElement', [ seg('energyMeter'), seg('publicKeys', 'c191068ceb198f5c77a7192d22f9ecd9bbb12a177cbbc675659394efa747cf93') ]) ],
                [ '1509a7fc3f7479f1589f02cac41dd88e570db2ef12557bf21d68568354c3cf1a', '71f07311c793e67fb8a963b9c46315a637f0f3b333e6d06086d2ec4675ba277f' ]);
        applied([ evse('AddElement', [ seg('energyMeter'), seg('templateIds', 'DE*GEF*EMT_AC') ], { newValue: 'DE*GEF*EMT_AC' }) ],
                [ '2d63f60322563dd92301ae228ab4b2626ca2e0753be29cb2d6600e6179ee1cc6', '550d5779e9e1d840d68df576cea739fa115e94b3fe7fe418c3cb6a4a9762b051' ]);

        // The value of a property, its JSON-LD context named or not.
        for (const path of [ [ seg('maxPower') ], [ { '@context': 'https://open.charging.cloud/contexts/wwcp/roamingNetwork/elementPathSegment/v1', propertyName: 'maxPower' } ] ])
            applied([ evse('RemoveElement', path) ],
                    [ 'e02b63e1ee07722079443e7eaedeb0ff3ce311a0a219706025d8d1aa7796ec5c', 'fb8474756cd2ad1eafa6a86479f17167da502e79cb0d877dada0b410a67740bf' ]);
        applied([ evse('AddElement', [ seg('physicalReference') ], { newValue: 'Left' }) ],
                [ 'dd96128ee6a5481a029aeb8a03b6dfd47ffcfe984f061048b36770b13bc7f5ef', 'e3043bfb8a8e3bdb2251db2344487e83db7cff3deaa3c872c811b7d0138320de' ]);

        // Members of a group, compared as their type compares them, in the ordinal order of the identifications.
        applied([ element('AddElement', 'EVSEGroup', 'DE*GEF*EG_AC', [ seg('EVSEIds', 'DE*GEF*E1*1') ], { newValue: 'DE*GEF*E1*1' }) ],
                [ '5f02bd9b6beb6c699cb9bebb5730498bddac0bd7c94ea1cab0b0d4d146190dce', 'c0580bab77dd4c45c6d1ef58b7a59990cfcbc8fcb54847c3fe73cf57e2644d53' ]);
        applied([ element('AddElement', 'EVSEGroup', 'DE*GEF*EG_AC', [ seg('EVSEIds', 'DE*GEF*E5*1') ], { newValue: 'DE*GEF*E5*1' }) ],
                [ '2027498b709971c1d44c47b603b5201b3dbbada756e8c833027c297e118b6ea1', '171787de0c8cba7cd8838714a05933567f13ce7899951dc6ad888c562f5a9e48' ]);
        for (const id of [ 'DE*GEF*E2*1', 'DEGEFE21' ])
            applied([ element('RemoveElement', 'EVSEGroup', 'DE*GEF*EG_AC', [ seg('EVSEIds', id) ]) ],
                    [ '8ce80f23a1e80458a09e160ba545e025ec256ad516fb6c614c1a91a7405f8af2', '35b11d9fdaaada0eb53a64e3c2ee72b3d4b479b64c717ba28ebee0efd1417c27' ]);

        // The last element removed, the array is.
        applied([ element('RemoveElement', 'ChargingPoolGroup', 'DE*GEF*PG_ALL', [ seg('chargingPoolIds', 'DE*GEF*P1') ]) ],
                [ '8a015e4af92d1bf5429637c7be5c0ca837615fd38fe03c70e04d7c02136665e2', '37ab824bb60bd563be2040500f9838dd0de8c091a15b8d2e32842080cc91a042' ]);

        // Templates, whose order is content: at the end.
        applied([ element('AddElement', 'ChargingStation', 'DE*GEF*S1', [ seg('templateIds', 'DE*GEF*ST_AC') ], { newValue: 'DE*GEF*ST_AC' }) ],
                [ 'cc1c8e028ebb254e07380fdd08836c81fdb9b79b82987c2850e5e7b20886a8d1', 'e488c2b7475a8f5a740797bde66b8172b343e5f4753963efd3d5af1a720c683d' ]);

        applied([ element('UpdateElementProperty', 'ChargingPool', 'DE*GEF*P1', [ seg('name') ], { propertyName: 'de', newValue: 'Jena Paradies' }) ],
                [ '6240d73fdc0fe006db3a7426e21387a0bb4e77e3c1ee45e9b84c831c079ea4e0', 'b9d814cb77d173c2715381036886c2c89a42706e010c9aab3a85625334a00fdd' ]);
        applied([ element('AddElement', 'ChargingPool', 'DE*GEF*P1', [ seg('brands', 'P-Brand') ], { newValue: { '@id': 'P-Brand', name: { en: 'P' } } }) ],
                [ 'e9b392863d880005890678bbf3580277e65e97d8684f9c030e8c4cecb8be063c', 'f6b6184769ae28a09bf6b80e46c65d97b386405f4864c2bfc1484ee87f434eaa' ]);

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
                [ '6464b9005c4e96e37e47bb6ffaf7ccd3fc157e372a146684395e3ee56bf7c7a7', '7ed6f9532d26c945a4eba529ab1b9fec50067235d72b0c0e2c6024a7859dd428' ]);
        applied([ element('AddElement', 'ConformityAssessmentBody', 'PTB', [ seg('notifiedFor', 'CRA') ], { newValue: 'CRA' }) ],
                [ '3d10c68bb1d31d61c7dca4ee51f5829dc186050caa92cf9d92d17e2fca5074bd', '51cfbb3dbba6208ce30af7cdc85955e5b596fef66ca8bf53e7d69c86c9c7db47' ]);
        applied([ element('AddElement', 'ChargingStationModel', 'GD-DC300', [ seg('firmwareVersions', '2.6.0') ], { newValue: '2.6.0', parentEntityType: 'ChargingStationManufacturer', parentEntityId: 'GraphDefined' }) ],
                [ 'ff9980ac914b85c88d204e37fcc16d8a72a17a50c9f513d481be289a445adc96', '0ff6682b90c9f060bce56fcecd7917d42b1b27cac1eda06d6017e7d5916f68df' ]);
        applied([ element('UpdateElementProperty', 'RoamingNetwork', QA.id, [ seg('name') ], { propertyName: 'de', newValue: 'Qualitätssicherung' }) ],
                [ '2854e410859276adc40f7038c7e88c24944d8136cdf42e8368e8e204623803cc', '22e5ae5872aa88fb3557d7a25b202e9df8063785418384f6145a5fb1d553b49d' ]);
        applied([ element('UpdateElementProperty', 'RoamingNetworkOperator', QA.operator?.id ?? '', [ seg('name') ], { propertyName: 'de', newValue: 'OCC' }) ],
                [ 'b3b825f790d570e8d4516ff7eb3afadcb4b74978ff13ad24ac4b43f812fcdf63', '154b5bbdf6addac5e1de39ea4a50e731e78662fd937de04db9cce2b36811a59c' ]);

        applied([ element('UpdateElementProperty', 'ChargingTariffOffer', 'offer-1', [ seg('discount') ], { propertyName: 'percent', newValue: 20 }) ],
                [ '803d1971c681397c4ba520f2883d7225cbb2de93010edfef3c6e8ede207d53d5', '0fc0a4232b97915731500bae52e9a7c1e340a0e6b3cc2ac95bbfd77773e19241' ]);
        applied([ element('AddElement', 'EVSEGroup', 'DE*GDF*EG_FAV', [ seg('EVSEIds', 'DE*GEF*E2*1') ], { newValue: 'DE*GEF*E2*1' }) ],
                [ 'a31872c27f216c3b92678d19c05ec0f05ad31801b4466506aa52446d390ac6c7', '46d193890b87e10426cdc7c353ffd57439eafb56916648fe90d89350997f930d' ]);
        applied([ element('UpdateElementProperty', 'GridConnectionPoint', 'gcp-1', [ seg('energyMeter') ], { propertyName: 'serialNumber', newValue: 'GCP-1' }) ],
                [ '46e526521dd64cb0801b922e56c888191434d091d6e1752ee385c277f383efec', 'cc8e3290714609cb9ecba266095c37632f0ee79cf7ae5217d3cb9b074218e189' ]);
        applied([ element('RemoveElement', 'EnergyMeterGroup', 'net-meters', [ seg('energyMeterIds', 'GCP-METER-1') ]) ],
                [ 'cbd6a83a36aa1c1fd0519d97f644454ace5e155c51ead36252bb4d37b64c840c', '52f59cb201d00633f4c068489891f475631e3e640d16d222b7378434b70dd957' ]);
        applied([ element('RemoveElement', 'ParkingSpace', 'space-1', [ seg('parkingSensorIds', 'SENSOR-1') ]) ],
                [ '54fd846c6998d752f05f8338c971de8d74620c77e0e86b85977868a5e69ddbb2', 'f70eaa2c03d5d8ca9f56a4766a632755cb6d666a48b5eb4819e17abd3152853d' ]);

    });

    it('keys and tree hash algorithms changed as a whole, refused in the words of WWCP_POI3', () => {

        expect(refusal([ element('RemoveElement', 'ChargingStationOperator', 'DE*GEF', [ seg('signingKeys', '621af946a160ecd9a48230d6b771e1a73ff823898c83c44dadcc435a95228ed2') ]) ]))
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
