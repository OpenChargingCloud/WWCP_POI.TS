import { describe, expect, it } from 'vitest';

import { rich } from './richNetwork.ts';

import { applyChangeSet, checkOwnership } from '../src/history/apply.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification } from '../src/history/changeSet.ts';
import { etagToJSON } from '../src/etags.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';
import type { JSONObject, JSONValue } from '../src/json/value.ts';


// Element changes (SPECIFICATION.md section 4, elements.ts): AddElement, RemoveElement, ReplaceElement,
// UpdateElementProperty and RemoveElementProperty address one element of a property of an entity by their element path,
// and amount to the change of that property. The after ETags are those WWCP_POI3 at c94c762 calculated for the same changes
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
                [ 'a21971dfe375aaf5c84025e504c6aa2bd74c41c0268efcaa49b002c99b9b9735', '764d7ca0fc3664b0acb7d84470aae8e677f87e0835f7a4c6295cb37964937cc8' ]);

        applied([ evse('AddElement', [ seg('chargingConnectors', '2') ], { newValue: C2 }) ],
                [ 'c255b5c6370dbeec8f2b2ed0cd1f65f65737099a2b2ce69b82c31711ed0f4e78', 'c36d216ff8ffd56f238bb6456f69ac229581e0819e092df92faba992447a310f' ], withConnectors);

        // Removed, also by the old value it names.
        for (const oldValue of [ {}, { oldValue: C1 } ] as JSONObject[])
            applied([ evse('RemoveElement', [ seg('chargingConnectors', '1') ], oldValue) ],
                    [ 'e20f4e79b9b5ff10d2a7afbd8b62f535f604ce7732014beafb3931752de95a6a', '617de8e4cc2724ffd4a4f1c02ca8e1fab5e668f82361d249042e4cb70efdb01a' ], withConnectors);

        applied([ evse('ReplaceElement', [ seg('chargingConnectors', '1') ], { newValue: { ...C1, format: 'SOCKET' } }) ],
                [ '9a6b4e3169bba1063f3b47e493226e3e0c7a251feb0f9bd487cb82c7bcc844ed', 'b11d95e70fee85ca0d847aa2e3002110fa28c67e9afbad9f8707e9bc8b7a3aaf' ], withConnectors);

        for (const oldValue of [ {}, { oldValue: 'CABLE' } ] as JSONObject[])
            applied([ evse('UpdateElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: 'format', newValue: 'SOCKET', ...oldValue }) ],
                    [ '6f62e332383c24615847a332ef97925d36e530a32549af44f01df378df5e0b42', '4ebbeebeac4dac07560172f685664ac8df8c77766578bc8b5933bbf6b34550b0' ], withConnectors);

        // An old value of JSON null expects the property absent.
        applied([ evse('UpdateElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: 'maxPower', oldValue: null, newValue: 22000 }) ],
                [ '639a23c5e9c257d391f41ddeb8db48c52061e113f6dfb04ae4c204ef3ebd0924', '9861eebac6ebf1fa4f6527babfd9cab75ed7584b7e64d9bd369eab76a52f5414' ], withConnectors);

        applied([ evse('RemoveElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: 'format' }) ],
                [ '7735db84043ab4efacb63d9808430d8b00f5073990af8415ec0e5e5932d2ee08', '6fbb0b89bebbef922a7b0a2dcda4011c30bb0320c970b0b531bf344e037067b6' ], withConnectors);

        // Changes of one property one after the other, and of an entity an earlier change added.
        applied([ evse('AddElement', [ seg('chargingConnectors', '2') ], { newValue: C2 }), evse('UpdateElementProperty', [ seg('chargingConnectors', '1') ], { propertyName: 'format', newValue: 'SOCKET' }) ],
                [ '665ba0bfbe1f8b9d15fd6b7542b2b37c4d8484b51205eb9542d4cf53f3cee9b9', 'dfb3c98095f9583e55d33215d1384703f88e4515dd4f92ae3faeeae0ad51bc7c' ],
                RoamingNetwork.parse(rich(({ evse }) => { evse['chargingConnectors'] = [ { ...C1 } ]; })));

        applied([ { kind: 'Add', entityType: 'EVSE', entityId: 'DE*GEF*E1*3', newValue: { '@id': 'DE*GEF*E1*3', currentTypes: [ 'DC' ], templateIds: [ 'DE*GEF*ET_DC' ] },
                    parentEntityType: 'ChargingStation', parentEntityId: 'DE*GEF*S1' },
                  element('AddElement', 'EVSE', 'DE*GEF*E1*3', [ seg('chargingConnectors', '2') ], { newValue: C2 }) ],
                [ '7cd62a002f1836fd4f8f1b3da4d9f5d5a5a4c60dcae9bb792d6d42227149ea4f', 'f8ffeb7e8a73f1940a7f91854df23f42acce15916d7a2852cd5252b4bb3f6daa' ]);

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
                    [ '21f01d604a0362287056b92bd378d13c793f97a965eb84d48cacaa875ab52c51', 'a15c7734473cf863da78f2fa3f0956352cf12f72bd104081ffea66964d2026df' ]);

        applied([ evse('RemoveElement', [ seg('energyMeter') ]) ],
                [ 'fcdf7f4df66fa2a532826092fc17f5589e3068fd3a7c393339039b0cf5356391', 'ddc8c159fff747a7912b9c71db7d6420b06073500c863b946813201040720847' ]);
        applied([ evse('RemoveElement', [ seg('energyMeter'), seg('publicKeys', 'facb8d6f52d7d1fd8c063f4ad73d121611ea93152af706c46ccf09203a4e73f8') ]) ],
                [ '7ebe4afe1f6060b07f3b401fcf0fb2bc240a8f1ca4114a346a84e52725d1059b', '2346cbb571978a4f81854ccf87e7c9be112f84cdcff3c23d930829483c2302ce' ]);
        applied([ evse('AddElement', [ seg('energyMeter'), seg('templateIds', 'DE*GEF*EMT_AC') ], { newValue: 'DE*GEF*EMT_AC' }) ],
                [ 'ccc07ee945f27b9c784496819bc569f8690e08de1850b61ca9b4d0447b2a2f2f', '3aa70baa7b53e86cddadc48108f527f6acdfd06a994b52eca9807ba445919069' ]);

        // The value of a property, its JSON-LD context named or not.
        for (const path of [ [ seg('maxPower') ], [ { '@context': 'https://open.charging.cloud/contexts/wwcp/roamingNetwork/elementPathSegment/v1', propertyName: 'maxPower' } ] ])
            applied([ evse('RemoveElement', path) ],
                    [ '046bf1172b25b052df7ec8311be3fcfff7028ab846c27dd2a42e3c31dbe36e60', 'a8d37ae4aeb4b17eae6f2407daa790ba186b772ab3564b300dd3e10e0cc3f661' ]);
        applied([ evse('AddElement', [ seg('physicalReference') ], { newValue: 'Left' }) ],
                [ 'd0cb82df75af0455657eb519d10f713d516bfddea9cb47916f292a3992649d4b', '20aaec310309d2386df5b69ab8b62ac1ad86baa0f2868be8c3d4463fe0f48051' ]);

        // Members of a group, compared as their type compares them, in the ordinal order of the identifications.
        applied([ element('AddElement', 'EVSEGroup', 'DE*GEF*EG_AC', [ seg('EVSEIds', 'DE*GEF*E1*1') ], { newValue: 'DE*GEF*E1*1' }) ],
                [ 'ef656fc00a6617510676b9a3e8ba7266474342f964e59c65b22266c4dfaa16e1', '9d1e9e15590de2697fdd0e18646062192c34de2a297d7180d9e0ebc285980f3e' ]);
        applied([ element('AddElement', 'EVSEGroup', 'DE*GEF*EG_AC', [ seg('EVSEIds', 'DE*GEF*E5*1') ], { newValue: 'DE*GEF*E5*1' }) ],
                [ '8d7480272fabdbfc92adc5e54fea18db5fa35f898c9642b53e818ae1b668f9f3', '117a0fe09a6649a9768de408548c2457f37ce98ae97ec547de8e02aa88450237' ]);
        for (const id of [ 'DE*GEF*E2*1', 'DEGEFE21' ])
            applied([ element('RemoveElement', 'EVSEGroup', 'DE*GEF*EG_AC', [ seg('EVSEIds', id) ]) ],
                    [ '3057c443117ea4cee17e276674f76f7199a1aebffe2f4e2f60ec65b9238aa488', '485bf412d888d30715532bd77055d6a41763ec6257ecf3f5f174730955a3d195' ]);

        // The last element removed, the array is.
        applied([ element('RemoveElement', 'ChargingPoolGroup', 'DE*GEF*PG_ALL', [ seg('chargingPoolIds', 'DE*GEF*P1') ]) ],
                [ '1452111b868ef0236ad5f33aafd0432e719b5abf0eb75507bd166b90b77979f6', 'c0ecb19796deb6913072cd7b21dcbc72c68f802253246ff15dc8e2021002243e' ]);

        // Templates, whose order is content: at the end.
        applied([ element('AddElement', 'ChargingStation', 'DE*GEF*S1', [ seg('templateIds', 'DE*GEF*ST_AC') ], { newValue: 'DE*GEF*ST_AC' }) ],
                [ '57c3cd298fb1ff056546dd5bda6cc33c3ae4bc69063eadea148a2ece400ead3d', '4020916b0368ea447dfb14a720f6778655182f2055769bb9e506ef0536f01739' ]);

        applied([ element('UpdateElementProperty', 'ChargingPool', 'DE*GEF*P1', [ seg('name') ], { propertyName: 'de', newValue: 'Jena Paradies' }) ],
                [ '92dc17b70403517f617d6d811ec0c21fff7b1d04747a66592ebb7eb760c3793b', '7d6d05e2f838d29f0849ea6a909b421a427b53a67f8e8f9e5ac9c02ac369d6fa' ]);
        applied([ element('AddElement', 'ChargingPool', 'DE*GEF*P1', [ seg('brands', 'P-Brand') ], { newValue: { '@id': 'P-Brand', name: { en: 'P' } } }) ],
                [ 'bd234ba7d1d15eb0a19258cb10611ad5417a5e04db96ec2250523e552761131f', '28dec2ea334aabbc39deb449f100a0d273c7538d2c4b5fbc0f286c4c9245892b' ]);

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
                [ '12acf1a78e2f6fc873314ee3452568ba6b6eb18f128b1b57ec19d24d9973f83d', '44aaec2b075e09f64695fc3b03f5fe9e2b1db1808f3f7f898ad2daa20016d888' ]);
        applied([ element('AddElement', 'ConformityAssessmentBody', 'PTB', [ seg('notifiedFor', 'CRA') ], { newValue: 'CRA' }) ],
                [ 'd2119fac0e3c9b523345e32202a3128e41168ea25b663045f3e2fb41d92636a6', '6fdd6ec09f1b4f4e98fc19cd87c20aab21234e9072ebb32f2aeeabd713b33c0f' ]);
        applied([ element('AddElement', 'ChargingStationModel', 'GD-DC300', [ seg('firmwareVersions', '2.6.0') ], { newValue: '2.6.0', parentEntityType: 'ChargingStationManufacturer', parentEntityId: 'GraphDefined' }) ],
                [ '6914b878326ab84381e757abfcef030c96fbc8c1fc87781c7ac6679a80811ce7', 'fa48de1c978f5f18e46bbf40feb8890099b323014ae9d46ac297ddd842a6091d' ]);
        applied([ element('UpdateElementProperty', 'RoamingNetwork', QA.id, [ seg('name') ], { propertyName: 'de', newValue: 'Qualitätssicherung' }) ],
                [ '0896efafe92eb331085b3cfe0717cbebb01ca657fe9983f84bc39fb2a86ee55b', 'a0afb736cce020a5c398d184d9dfbd7fa30395de2cb6c2d4bdb5700a1c57d691' ]);
        applied([ element('UpdateElementProperty', 'RoamingNetworkOperator', QA.operator?.id ?? '', [ seg('name') ], { propertyName: 'de', newValue: 'OCC' }) ],
                [ 'f8542772f1a9bbd06489380c72e21b167c83f9021880b0e9fc53b199595351ba', '093e27357bb0169d0f096e99677ec95bc9fd232957b9f7f113eb7bf1bc5e791c' ]);

        applied([ element('UpdateElementProperty', 'ChargingTariffOffer', 'offer-1', [ seg('discount') ], { propertyName: 'percent', newValue: 20 }) ],
                [ '1a619df145195ec3a620c7ec7cea77e933a8c6909339d6b20a0178a07cdcf4df', '0187bb49cf1ea2d8a0a246e65b14bda2bce977bb824847c4d8ea731345b588d2' ]);
        applied([ element('AddElement', 'EVSEGroup', 'DE*GDF*EG_FAV', [ seg('EVSEIds', 'DE*GEF*E2*1') ], { newValue: 'DE*GEF*E2*1' }) ],
                [ 'ee406a5b91e880e9fcdb42b86b4cad938f517fe7c18b972d5c25f88dc5a1471a', '144dab679c91db20fb26468e7a8fe3203da050fed5d1c3ff5b0d60f63907816d' ]);
        applied([ element('UpdateElementProperty', 'GridConnectionPoint', 'gcp-1', [ seg('energyMeter') ], { propertyName: 'serialNumber', newValue: 'GCP-1' }) ],
                [ 'c56f37783e19ec20d277766ff9da4a708e76e0ab106e7f6191c5e6a458571487', 'ed4e3ee68b0a1f61fe998de00916e25a21f6e5dfd29a7bc101436458758d25e0' ]);
        applied([ element('RemoveElement', 'EnergyMeterGroup', 'net-meters', [ seg('energyMeterIds', 'GCP-METER-1') ]) ],
                [ '5f5facc4039d19b0f9fed2fb79c15803c2ba3dd3a1eae7c51d8b968b668ca813', '6ba12df3411938c743eb774ad2b13e243abaf3193a785dbaef4eac9f98232f68' ]);
        applied([ element('RemoveElement', 'ParkingSpace', 'space-1', [ seg('parkingSensorIds', 'SENSOR-1') ]) ],
                [ '371e17201b0e16dd9de86fb3bbab13a56c69c48ebabded4cca489e9e6ac61fd8', 'bcf94a2ad6ed30fdfb8bab3b5513d2e304ba41d80d4ddfd0abbadd07022a68db' ]);

    });

    it('keys and tree hash algorithms changed as a whole, refused in the words of WWCP_POI3', () => {

        expect(refusal([ element('RemoveElement', 'ChargingStationOperator', 'DE*GEF', [ seg('signingKeys', '69dd44c86d96a3add6dd75721f46c3126053c3582f5bfbcc3ab47c179deec438') ]) ]))
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
