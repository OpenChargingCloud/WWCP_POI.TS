import { describe, expect, it } from 'vitest';

import { rich } from './richNetwork.ts';

import { applyChangeSet, checkOwnership } from '../src/history/apply.ts';
import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification } from '../src/history/changeSet.ts';
import { etagToJSON } from '../src/etags.ts';
import { RoamingNetwork } from '../src/network/roamingNetwork.ts';
import type { JSONObject, JSONValue } from '../src/json/value.ts';


// Element changes (SPECIFICATION.md section 4, elements.ts): AddElement, RemoveElement, ReplaceElement,
// UpdateElementProperty and RemoveElementProperty address one element of a property of an entity by their element path,
// and amount to the change of that property. The after ETags are those WWCP_POI3 at 045e180 calculated for the same changes
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
                [ '89f302f436b8c585c76674f521e6ac4f2c07dc71570ea8c73dead9df941d9dbc', 'a2ba326e113e9efd4ff3aa31d72d057214508415b64a7c8235ffc4992044933e' ]);

        applied([ evse('AddElement', [ seg('chargingConnectors', '2') ], { newValue: C2 }) ],
                [ '31ab4a7e3e49337fb3467b88f1e49034a88293eedeadf37f9770844ced3d2213', '2d7da8e4a792a4a231d6d55c6ade3c71f1539b63529fbc5ff91f4cd76e0bb8f0' ], withConnectors);

        // Removed, also by the old value it names.
        for (const oldValue of [ {}, { oldValue: C1 } ] as JSONObject[])
            applied([ evse('RemoveElement', [ seg('chargingConnectors', '1') ], oldValue) ],
                    [ 'b9b2bf40e8d6cac323138706b00abc6b550cc0b6dcb93f8b7ad4ff1575896b26', '783559d5de44f86d0152075b4f83a7cb5e32826b28f3e169e0395089d91853bb' ], withConnectors);

        applied([ evse('ReplaceElement', [ seg('chargingConnectors', '1') ], { newValue: { ...C1, format: 'SOCKET' } }) ],
                [ '59c7a3ad76d61dfd5681078c93befcc249a927bdb6cb6004e68e8eb66997aff3', 'c7c19b892d81d5fcc5c8bbeb59bf54d535d4b77518ee3f9242b16b1b8a97fcd2' ], withConnectors);

        for (const oldValue of [ {}, { oldValue: 'CABLE' } ] as JSONObject[])
            applied([ evse('UpdateElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: 'format', newValue: 'SOCKET', ...oldValue }) ],
                    [ 'c302a7de006fbecb3c022e69c4d214b4621558ffa550f781c13feb1e2074eadf', '1c962ea8511b1978f5687c989f7fcc5603bdb33d82729f9743763997b0d9beb6' ], withConnectors);

        // An old value of JSON null expects the property absent.
        applied([ evse('UpdateElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: 'maxPower', oldValue: null, newValue: 22000 }) ],
                [ 'fc42779367f5b5bab2ae5fcb4d907b1b9eff47bdf5d998986442a944da1969a8', '4a64ca373bf722034b4632508f9ba9c11f812929ed46ac55474a99b14733f707' ], withConnectors);

        applied([ evse('RemoveElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: 'format' }) ],
                [ '5aea951c1ff4b0c53d002a6c2501b99d7ef9c0c6642cb11fb7ab15e07a41fe34', '5b0eef735690bf90d4ebc14fdf9e241c97f3167c1c9f93bf72a9e6a388403ab0' ], withConnectors);

        // Changes of one property one after the other, and of an entity an earlier change added.
        applied([ evse('AddElement', [ seg('chargingConnectors', '2') ], { newValue: C2 }), evse('UpdateElementProperty', [ seg('chargingConnectors', '1') ], { propertyName: 'format', newValue: 'SOCKET' }) ],
                [ '4219625e291f4e18a8eb7373e2c8e24f333ecdf0861dc782629de08bfc6a48c1', '083afa78ea3374deb7c970b9886857b81b7f3cf5d91773352fa1f7e6076af0b7' ],
                RoamingNetwork.parse(rich(({ evse }) => { evse['chargingConnectors'] = [ { ...C1 } ]; })));

        applied([ { kind: 'Add', entityType: 'EVSE', entityId: 'DE*GEF*E1*3', newValue: { '@id': 'DE*GEF*E1*3', currentTypes: [ 'DC' ], templateIds: [ 'DE*GEF*ET_DC' ] },
                    parentEntityType: 'ChargingStation', parentEntityId: 'DE*GEF*S1' },
                  element('AddElement', 'EVSE', 'DE*GEF*E1*3', [ seg('chargingConnectors', '2') ], { newValue: C2 }) ],
                [ 'f7d830f17bed5700d22c2ebc119ce968ff10804994d6c51d4ffc1c20f135c5b2', '6424d33ac6dc1f670a80dc53bb299389a8efd6391a4277d4d1390083ea0ccbfe' ]);

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

        // The old value compared with the element, or the property of the element, the change addresses.
        expect(refused(evse('RemoveElement', [ seg('chargingConnectors', '1') ], { oldValue: C3 })))
            .toBe("Change 0: 'chargingConnectors['1']' of the EVSE 'DE*GEF*E1*1' is no longer the expected old value!");
        expect(refused(evse('UpdateElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: 'format', oldValue: 'SOCKET', newValue: 'SOCKET' })))
            .toBe("Change 0: 'chargingConnectors['3'].format' of the EVSE 'DE*GEF*E1*1' is no longer the expected old value!");

        // Its new value as the content holds it, and the entity read again.
        expect(refused(evse('UpdateElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: 'colour', newValue: 'red' })))
            .toBe("Change 0, the EVSE 'DE*GEF*E1*1': 'chargingConnectors[1].colour' is not given as the content holds it: the content leaves it out!");
        expect(refused(evse('UpdateElementProperty', [ seg('chargingConnectors', '3') ], { propertyName: 'format', newValue: 'BAG' })))
            .toBe("Invalid charging connector format 'BAG'!");

    });

});


describe('Element changes of one identified object, of values and of arrays of identifications', () => {

    it('as WWCP_POI3 applies them', () => {

        // The energy meter of an EVSE: by its property, also naming its identification, and deeper.
        for (const path of [ [ seg('energyMeter') ], [ seg('energyMeter', 'DE*GEF*M1*1') ] ])
            applied([ evse('UpdateElementProperty', path, { propertyName: 'serialNumber', newValue: 'DCM-2026-001-9' }) ],
                    [ '84ebccf5cd91f77429453dc0a5e4f0dced32a9d869bf262d90deefd064f39f10', 'ab2c7036069ecafcc4576bba013c247b67e636b65a831b0fed931fc677cdbc15' ]);

        applied([ evse('RemoveElement', [ seg('energyMeter') ]) ],
                [ '06d8540c9d2ffb4b5eb3f0c52a6091561ed8b996708a70a21e8d6a0c7a4c647b', '9a24997592cd6b8dec5bcc8f9816dc45b14b3a4c694483f1453c2f56e1df1a58' ]);
        applied([ evse('RemoveElement', [ seg('energyMeter'), seg('publicKeys', 'dabde08ee1c4ccad0f3f40cc04b8a29cc7fd03e1d4c2e45d52d2249189deff51') ]) ],
                [ 'c625e7d5175aa899a75e283b60d61ccfb2dbf057dd70431ac033cfce2ae41d04', '480823d946cfdfd0a700bcd3986bde77146cccb256f5988904ed229465b38622' ]);
        applied([ evse('AddElement', [ seg('energyMeter'), seg('templateIds', 'DE*GEF*EMT_AC') ], { newValue: 'DE*GEF*EMT_AC' }) ],
                [ 'd05ea2454577b7d94c45d3a8d5e7417136b902d8cbc953a1ff474378fa1aebfe', 'a749c6d08cdfdc2d611bd2b4ce1a56b4242371976a7d6ac515bbe21c30804abb' ]);

        // The value of a property, its JSON-LD context named or not.
        for (const path of [ [ seg('maxPower') ], [ { '@context': 'https://open.charging.cloud/contexts/wwcp/roamingNetwork/elementPathSegment/v1', propertyName: 'maxPower' } ] ])
            applied([ evse('RemoveElement', path) ],
                    [ '954e1e2db0e35eb374f5a2da5ebd0d1966316481698092da52e47ff0f1630f1f', '573641d00fcb988d62c6180dd78d0b565f1f88e9f2ad2be14103085df0b7e845' ]);
        applied([ evse('AddElement', [ seg('physicalReference') ], { newValue: 'Left' }) ],
                [ 'a901031f2bd7c793517c7765b9eb9ead0b4bc7fe96f60f4426e22145b154095d', 'eeb1577aed1deb219c3ceff0fe0982c959eb8627fc3c3621fb5ce89d61e6a9fb' ]);

        // Members of a group, compared as their type compares them, in the ordinal order of the identifications.
        applied([ element('AddElement', 'EVSEGroup', 'DE*GEF*EG_AC', [ seg('EVSEIds', 'DE*GEF*E1*1') ], { newValue: 'DE*GEF*E1*1' }) ],
                [ '4708a61eb4cb4d10cd11ee5dbd776e7d8085c71909fff6485fa452e9bb91a70b', '5eb74402aea56b1501d29d1d4ee5450119344d93f5947fcf2a5b749c4bcf3553' ]);
        applied([ element('AddElement', 'EVSEGroup', 'DE*GEF*EG_AC', [ seg('EVSEIds', 'DE*GEF*E5*1') ], { newValue: 'DE*GEF*E5*1' }) ],
                [ '9b7cbab375543fcbed1b6b4656361fa3426fe7af4dc4518203cb6f8bc2aec056', '044d173558fc4a819dc74025308fa899230da3ed76565440bb6429471d4b8c15' ]);
        for (const id of [ 'DE*GEF*E2*1', 'DEGEFE21' ])
            applied([ element('RemoveElement', 'EVSEGroup', 'DE*GEF*EG_AC', [ seg('EVSEIds', id) ]) ],
                    [ '8e16f03d34f17391b1e8e173f8e53907698aa53c1980d0ddc7b88430b2a317f3', '6f92345f93a1940a60d3ea1c0c907c006d91fa2cc5a27a5eabc5d152700683bf' ]);

        // The last element removed, the array is.
        applied([ element('RemoveElement', 'ChargingPoolGroup', 'DE*GEF*PG_ALL', [ seg('chargingPoolIds', 'DE*GEF*P1') ]) ],
                [ 'a78939e35debc3b451cc281be37daa727468c2ff7f7311ad1bf5c95a6fd90aac', '7436cc43069cceb87cfe831367ac6b01289e7d6c35237cb3d5dd4f6b8326d648' ]);

        // Templates, whose order is content: at the end.
        applied([ element('AddElement', 'ChargingStation', 'DE*GEF*S1', [ seg('templateIds', 'DE*GEF*ST_AC') ], { newValue: 'DE*GEF*ST_AC' }) ],
                [ '29ab2b7233b979cab98746ec0f8063b96f9e42d3e8c4f01e027e0f0749b6a5ff', '2334a11db8f235b2e8f613c65273c5be8b9862c24e6a08a4e410247e86202b15' ]);

        applied([ element('UpdateElementProperty', 'ChargingPool', 'DE*GEF*P1', [ seg('name') ], { propertyName: 'de', newValue: 'Jena Paradies' }) ],
                [ 'd017990b6bb714b14c00e92316868848f151b3922ffcc73ed8014559bdc4efe4', '0fe5f2fffed040d529d66e09a95966ab21087ddde1ee3aa2332e326ecb168a8c' ]);
        applied([ element('AddElement', 'ChargingPool', 'DE*GEF*P1', [ seg('brands', 'P-Brand') ], { newValue: { '@id': 'P-Brand', name: { en: 'P' } } }) ],
                [ '6691096fb7811042a586b23279afb387a3bd7d3081a7172ab2cac4b7c506c3b0', '1ab44efcd07ea53afa893d86318464f0800994630f47044f1cf232b95488c080' ]);

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
                [ '155a2b48e85d405bdc787a819f464b15f39ef1cb6935e3c16c85b1278b61ff8d', '7635d1a4c785fb587bff14f85a741a18da915975d98b39d288276cc3120316af' ]);
        applied([ element('AddElement', 'ConformityAssessmentBody', 'PTB', [ seg('notifiedFor', 'CRA') ], { newValue: 'CRA' }) ],
                [ 'cd24780c8c245617641dca971970c1f42628aab2dc1741863b1ef485ec2f43cd', '3475df921e5b523c8f526b8683b8546e89d0f9398a22c01fdbf37db58953fad2' ]);
        applied([ element('AddElement', 'ChargingStationModel', 'GD-DC300', [ seg('firmwareVersions', '2.6.0') ], { newValue: '2.6.0', parentEntityType: 'ChargingStationManufacturer', parentEntityId: 'GraphDefined' }) ],
                [ '9bfcab35734809688ba702bac405a50775fdcd5e3a16a2f8b1ee7207e08a19ed', 'e7f4789ca4d2e4b2009380e99a3c2e1c05df13a0a03c990cad0537d54e1e5553' ]);
        applied([ element('UpdateElementProperty', 'RoamingNetwork', QA.id, [ seg('name') ], { propertyName: 'de', newValue: 'Qualitätssicherung' }) ],
                [ '69e8aff837393eacfc0bda49070cada3828071db2b14cb187f06649482d91baa', '1061daba860a66f74ffd697fad942fbd2dbdc8c8dc615d7f774e5482b95080a0' ]);
        applied([ element('UpdateElementProperty', 'RoamingNetworkOperator', QA.operator?.id ?? '', [ seg('name') ], { propertyName: 'de', newValue: 'OCC' }) ],
                [ '9097d35c77ec5639a410e8b053f337612ac4f71d50423e527459ba2996116ad8', '7282e274e96318d49a7f88ed622acae10c70248a12861181e49f07bfe1013ec9' ]);

        applied([ element('UpdateElementProperty', 'ChargingTariffOffer', 'offer-1', [ seg('discount') ], { propertyName: 'percent', newValue: 20 }) ],
                [ 'a1819adcb4061aee1e303684a5a212eac9cb5d866cfcd88cfb5f3e6d76d63297', 'a0fc143ea9cf6849b896a396e01aa1f51c5792a61c384a25993d4a479d4b771c' ]);
        applied([ element('AddElement', 'EVSEGroup', 'DE*GDF*EG_FAV', [ seg('EVSEIds', 'DE*GEF*E2*1') ], { newValue: 'DE*GEF*E2*1' }) ],
                [ 'ae5d093884ed630f17118baadd218f7b8ed3f16f48ccf8b31b23cb326db0f9c2', 'f3f68bc9fdd360544e503998d80b884c5f056254fd5a6aa3aff149bbe79a38e3' ]);
        applied([ element('UpdateElementProperty', 'GridConnectionPoint', 'gcp-1', [ seg('energyMeter') ], { propertyName: 'serialNumber', newValue: 'GCP-1' }) ],
                [ 'f00869b807d83ee6110f3e672d79876f6321b15204a203e5340e02b62f418c48', '6824ec8dabf2aac7de2c2fb46001eae5e638b6b773589128b654246ad3718b5b' ]);
        applied([ element('RemoveElement', 'EnergyMeterGroup', 'net-meters', [ seg('energyMeterIds', 'GCP-METER-1') ]) ],
                [ '36b534bdfbb8799bbbd9bf96385675f73a23609940691c84acf20d2c64c9c7d8', 'fad83246611186a9385c663f2125caa400def2bc0d75b996fae90ced1fd6ed72' ]);
        applied([ element('RemoveElement', 'ParkingSpace', 'space-1', [ seg('parkingSensorIds', 'SENSOR-1') ]) ],
                [ '49957fac866f842f9606422f3e07f79763cf56490c32b93dd2441797eaec14ac', '854c5c3b2976027b479a605dd0177dc80fa76511d271e5f1b63814f0f6bb43ff' ]);

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
            .toBe(`Change 0: UpdateElementProperty of the GridConnectionPoint 'gcp-1' ('maintainedBy') needs a signature by a signing key of the GridOperator 'DE*NET' or a signing key of the ChargingStationOperator 'DE*GEF' or an identity key of the roaming network operator '${QA.operator?.id ?? ''}'!`);

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
