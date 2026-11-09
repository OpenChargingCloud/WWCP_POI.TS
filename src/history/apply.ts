/*
 * Copyright (c) 2014-2026 GraphDefined GmbH <achim.friedland@graphdefined.com>
 * This file is part of WWCP POI TS <https://github.com/OpenChargingCloud/WWCP_POI.TS>
 *
 * Licensed under the Affero GPL license, Version 3.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.gnu.org/licenses/agpl.html
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { ordinal }                        from '../json/canonical.ts';
import { asText, clone, get, isArray, isObject, sameValue, set, unset, without, type JSONArray, type JSONObject, type JSONValue } from '../json/value.ts';
import { toTimestamp, withArticle }       from '../common.ts';
import { cborETag, etagToText, jsonETag, sameETag, type ETag } from '../etags.ts';
import { KeyUsages, POIPublicKey, type KeyUsage } from '../keys.ts';
import { RoamingNetwork }                 from '../network/roamingNetwork.ts';
import { invalidGroupOrOffer, invalidPaymentOption } from '../network/references.ts';
import { ignoringCase }                   from '../network/identifications.ts';
import { caseId, evseGroupId, freeId, poolGroupId, stationGroupId, timestampOf, type Id } from '../network/poiJSON.ts';
import { trimmed }                        from '../network/versionTexts.ts';
import { notWritten }                     from '../network/writtenForm.ts';
import { entityPropertyName, isElementChange, type Change, type ChangeSet } from './changeSet.ts';
import { applyElement, pathText }       from './elements.ts';
import { brokenPrecondition }           from './preconditions.ts';
import { POIError, required }             from '../errors.ts';


// Applying a change set to a version (SPECIFICATION.md sections 4 and 4.1), as RoamingNetwork.ChangeSets.cs,
// RoamingNetwork.InfrastructureChanges.cs and RoamingNetwork.Ownership.cs of the C# implementation do, on the JSON of the
// content: the owners of every change signed it, the change set fits the version, its changes apply, and the result has its
// after ETags. Whatever this library calculates otherwise than the C# implementation ends in other after ETags, and the
// change set is refused: it never takes a version the change set does not lead to.


/** The arrays of the roaming network holding the parties, by their entity type. */
const NETWORK_ARRAYS: Readonly<Record<string, string>> = {
    ChargingStationOperator:          'chargingStationOperators',
    EMobilityProvider:                'eMobilityProviders',
    GridOperator:                     'gridOperators',
    ParkingOperator:                  'parkingOperators',
    ChargingStationManufacturer:       'chargingStationManufacturers',
    EnergyMeterManufacturer:           'energyMeterManufacturers',
    TransparencySoftwareManufacturer:  'transparencySoftwareManufacturers',
    ConformityAssessmentBody:          'conformityAssessmentBodies',
};

/** The parties: the RNO adds and removes them, they own their other properties (4.1). */
const PARTIES = new Set([ 'ChargingStationOperator', 'EMobilityProvider', 'GridOperator', 'ParkingOperator',
                          'ChargingStationManufacturer', 'EnergyMeterManufacturer', 'TransparencySoftwareManufacturer',
                          'ConformityAssessmentBody' ]);

const REGISTRY_PROPERTIES      = [ 'name', 'description', 'dataSource', 'address', 'homepage', 'hotline', 'customData' ];
const PARTY_PROPERTIES         = [ ...REGISTRY_PROPERTIES, 'signingKeys', 'identityKeys' ];
const CONTACT_PROPERTIES       = [ 'dataLicenses', 'logos', 'geoLocation', 'telephone', 'eMailAddress', 'termsAndConditions' ];
const MANUFACTURER_PROPERTIES  = [ ...PARTY_PROPERTIES, ...CONTACT_PROPERTIES ];
const RNO_PROPERTIES           = [ ...REGISTRY_PROPERTIES, 'identityKeys', 'eMailAddress', 'hotlineEMailAddress', 'minConsensus', 'keyStatement', 'signingKeyCertificates' ];

/**
 * The parties and the roaming network operator in words, and the properties of theirs a change set can update or remove
 * (`ChangeableOperatorProperties` and the registries of RoamingNetwork.RegistryChanges.cs): not their identification and
 * timestamps, nor the children they change on their own.
 */
const PARTY_REGISTRIES: Readonly<Record<string, { readonly what: string, readonly article: string, readonly changeable: readonly string[] }>> = {
    RoamingNetworkOperator:            { what: 'roaming network operator',            article: 'a',  changeable: RNO_PROPERTIES },
    ChargingStationOperator:           { what: 'charging station operator',           article: 'a',  changeable: [ ...MANUFACTURER_PROPERTIES, 'evTaler', 'brands' ] },
    EMobilityProvider:                 { what: 'e-mobility provider',                 article: 'an', changeable: MANUFACTURER_PROPERTIES },
    GridOperator:                      { what: 'grid operator',                       article: 'a',  changeable: PARTY_PROPERTIES },
    ParkingOperator:                   { what: 'parking operator',                    article: 'a',  changeable: PARTY_PROPERTIES },
    ChargingStationManufacturer:       { what: 'charging station manufacturer',       article: 'a',  changeable: MANUFACTURER_PROPERTIES },
    EnergyMeterManufacturer:           { what: 'energy meter manufacturer',           article: 'an', changeable: MANUFACTURER_PROPERTIES },
    TransparencySoftwareManufacturer:  { what: 'transparency software manufacturer',  article: 'a',  changeable: [ ...MANUFACTURER_PROPERTIES, 'craRole', 'vulnerabilityContact',
                                                                                                                   'vulnerabilityReporting', 'vulnerabilityDisclosurePolicy', 'securityAdvisories' ] },
    ConformityAssessmentBody:          { what: 'conformity assessment body',          article: 'a',  changeable: [ ...MANUFACTURER_PROPERTIES, 'notifiedBodyNumber', 'notifiedFor' ] },
};

/** The embedded children a party is not added with, but adds on its own (`PartyChildren`). */
const PARTY_CHILDREN: Readonly<Record<string, readonly string[]>> = {
    ChargingStationOperator:           [ 'chargingPools', 'chargingTariffs', 'EVSETemplates', 'chargingStationTemplates', 'chargingPoolTemplates',
                                         'chargingTariffTemplates', 'energyMeterTemplates', 'EVSEGroups', 'chargingStationGroups', 'chargingPoolGroups',
                                         'chargingTariffGroups', 'energyMeterGroups', 'chargingTariffOffers', 'parkingSpaces' ],
    EMobilityProvider:                 [ 'EVSEGroups', 'chargingStationGroups', 'chargingPoolGroups', 'chargingTariffOffers' ],
    GridOperator:                      [ 'gridConnectionPoints', 'energyMeterTemplates', 'energyMeterGroups' ],
    ParkingOperator:                   [ 'parkingGarages', 'parkingSpaces', 'parkingSensors', 'parkingSpaceTemplates', 'parkingSpaceGroups', 'parkingProducts' ],
    ChargingStationManufacturer:       [ 'chargingStationModels' ],
    EnergyMeterManufacturer:           [ 'energyMeterModels' ],
    TransparencySoftwareManufacturer:  [ 'transparencySoftware' ],
    ConformityAssessmentBody:          [ 'certificates' ],
};

/**
 * Entities a party embeds and changes on its own, without runtime status and timestamps: the models of a charging station
 * or energy meter manufacturer, the releases of a transparency software manufacturer and the certificates of a conformity
 * assessment body (ChargingStationManufacturer.md, EnergyMeterManufacturer.md, TransparencySoftwareManufacturer.md,
 * ConformityAssessmentBody.md).
 */
interface PartyChildType {
    readonly parentType:  string;
    readonly parents:     string;
    readonly property:    string;
    readonly what:        string;
    readonly usage:       KeyUsage;
    readonly changeable:  readonly string[];
    /** Its party in words, when its identification is unique within its party only: then every change names its party. */
    readonly inParent?:   string;
    /** Whether it keeps the version it was added with: a new version is a new release (S31). */
    readonly keepsVersion?: boolean;
}

const PARTY_CHILD_TYPES: Readonly<Record<string, PartyChildType>> = {

    ChargingStationModel: {
        parentType:  'ChargingStationManufacturer',
        parents:     'chargingStationManufacturers',
        property:    'chargingStationModels',
        what:        'charging station model',
        usage:       KeyUsages.Models,
        changeable:  [ 'name', 'description', 'hardwareRevisions', 'firmwareVersions', 'productURL', 'datasheetURL', 'images', 'maxPower',
                       'currentTypes', 'connectorTypes', 'numberOfEVSEs', 'customData' ],
        inParent:    'manufacturer',
    },

    EnergyMeterModel: {
        parentType:  'EnergyMeterManufacturer',
        parents:     'energyMeterManufacturers',
        property:    'energyMeterModels',
        what:        'energy meter model',
        usage:       KeyUsages.Models,
        changeable:  [ 'name', 'description', 'hardwareRevisions', 'firmwareVersions', 'productURL', 'datasheetURL', 'images', 'currentTypes',
                       'maxCurrent', 'accuracyClass', 'measurands', 'signatureMethods', 'customData' ],
        inParent:    'manufacturer',
    },

    TransparencySoftware: {
        parentType:  'TransparencySoftwareManufacturer',
        parents:     'transparencySoftwareManufacturers',
        property:    'transparencySoftware',
        what:        'transparency software release',
        usage:       KeyUsages.Software,
        // Not its version: a new version is a new release, so that a certificate naming a release names the version that
        // was assessed.
        changeable:  [ 'name', 'openSourceLicenses', 'logo', 'howToUse', 'moreInformation', 'sourceCodeRepository',
                       'supportUntil', 'declarationOfConformity', 'softwareBillOfMaterials' ],
        keepsVersion: true,
    },

    ConformityCertificate: {
        parentType:  'ConformityAssessmentBody',
        parents:     'conformityAssessmentBodies',
        property:    'certificates',
        what:        'certificate',
        usage:       KeyUsages.Certificates,
        changeable:  [ 'legislation', 'chargingStationModel', 'hardwareRevisions', 'firmwareVersions', 'chargingStationManufacturerId',
                       'energyMeterModel', 'energyMeterManufacturerId', 'energyMeters', 'documentNumber', 'documentURL',
                       'verifiedTransparencySoftwareIds', 'compatibleTransparencySoftwareIds', 'notBefore', 'notAfter', 'statedBy' ],
    },

};

/**
 * Energy meter templates and groups: children of the charging station operator or the grid operator embedding them, which
 * an `Add` names as its parent (`TryApplyEnergyMeterChildChange` of the C# implementation).
 */
interface EnergyMeterChildType {
    readonly property:    string;
    readonly what:        string;
    readonly changeable:  readonly string[];
}

const ENERGY_METER_CHILD_TYPES: Readonly<Record<string, EnergyMeterChildType>> = {

    EnergyMeterTemplate: {
        property:    'energyMeterTemplates',
        what:        'energy meter template',
        changeable:  [ 'name', 'description', 'dataSource', 'customData', 'role', 'manufacturerId', 'modelId', 'modelURL', 'hardwareRevision',
                       'firmwareVersion', 'transparencySoftwareStatus', 'signatureMethods', 'certificateIds' ],
    },

    EnergyMeterGroup: {
        property:    'energyMeterGroups',
        what:        'energy meter group',
        changeable:  [ 'name', 'description', 'dataSource', 'energyMeterIds', 'customData' ],
    },

};

/**
 * Entities a party embeds and changes on its own, identified within the roaming network: the charging tariff offers of
 * charging station operators and e-mobility providers, the groups of e-mobility providers, the grid connection points of
 * grid operators, the parking data of parking operators and the parking spaces of charging station operators
 * (RoamingNetwork.OfferChanges.cs, ProviderChanges.cs, GridChanges.cs and ParkingChanges.cs of WWCP_POI3).
 */
interface EmbeddedType {
    readonly what:        string;
    /** The parties embedding one, in the order they are looked at, with the property of each holding them. */
    readonly owners:      Readonly<Record<string, string>>;
    /** Its identification as its type reads and compares it. */
    readonly id:          (given: string) => Id | undefined;
    readonly changeable:  readonly string[];
    /** Whether it has a `created` and a `lastChange`: not a grid connection point or a parking product. */
    readonly timestamps:  boolean;
    readonly usage:       KeyUsage;
    /** Whom an `Add` naming no fitting parent needs, by the parent it names. */
    readonly addNeeds:    (parentType: string | undefined) => string;
    /** Whether the roaming network operator signs in the place of an owner without signing keys (`SignerOf`). */
    readonly inPlace:     boolean;
}

const BASE_PROPERTIES = [ 'name', 'description', 'dataSource' ];

const PARKING_SPACE_PROPERTIES = [ 'geoLocation', 'parkingGarageId', 'parkingSensorIds', 'chargingStationIds', 'parkingProductIds', 'parkingRestrictions',
                                   'euVehicleCategories', 'physicalReference', 'vehicleTypes', 'restrictedToVehicleTypes', 'maxVehicleWeight', 'maxVehicleHeight',
                                   'maxVehicleLength', 'maxVehicleWidth', 'length', 'width', 'evsePosition', 'direction', 'surface', 'slope', 'driveThrough',
                                   'reservationRequired', 'timeLimit', 'roofed', 'illuminated', 'refrigerationOutlet', 'dangerousGoodsAllowed', 'protectedArea',
                                   'standards', 'images' ];

const providerGroup = (what: string, property: string, id: (given: string) => Id | undefined, members: string): EmbeddedType => ({
    what,
    owners:      { EMobilityProvider: property },
    id,
    changeable:  [ ...BASE_PROPERTIES, members, 'customData' ],
    timestamps:  true,
    usage:       KeyUsages.Infrastructure,
    addNeeds:    () => 'EMobilityProvider',
    inPlace:     true,
});

const parking = (what: string, property: string, changeable: readonly string[], more: Partial<EmbeddedType> = {}): EmbeddedType => ({
    what,
    owners:      { ParkingOperator: property },
    id:          freeId,
    changeable,
    timestamps:  true,
    usage:       KeyUsages.Infrastructure,
    addNeeds:    () => 'ParkingOperator',
    inPlace:     false,
    ...more,
});

const EMBEDDED_TYPES: Readonly<Record<string, EmbeddedType>> = {

    ChargingTariffOffer: {
        what:        'charging tariff offer',
        owners:      { ChargingStationOperator: 'chargingTariffOffers', EMobilityProvider: 'chargingTariffOffers' },
        id:          freeId,
        changeable:  [ ...BASE_PROPERTIES, 'chargingTariff', 'discount', 'EVSEGroupIds', 'chargingStationGroupIds', 'chargingPoolGroupIds',
                       'chargingStationOperatorIds', 'notBefore', 'notAfter', 'openingTimes', 'sessions', 'eMobilityProviderIds', 'maxSessionsPerContract',
                       'customData' ],
        timestamps:  true,
        usage:       KeyUsages.Tariffs,
        addNeeds:    parentType => parentType === 'ChargingStationOperator' ? 'ChargingStationOperator' : 'ChargingStationOperator or EMobilityProvider',
        inPlace:     true,
    },

    GridConnectionPoint: {
        what:        'grid connection point',
        owners:      { GridOperator: 'gridConnectionPoints' },
        id:          freeId,
        changeable:  [ 'name', 'description', 'address', 'geoLocation', 'voltageLevel', 'connectionType', 'nominalVoltage', 'nominalFrequency',
                       'contractedImportPower', 'contractedExportPower', 'contractedImportApparentPower', 'contractedExportApparentPower',
                       'connectionAgreementId', 'networkLocationId', 'marketLocationIds', 'meteringLocationIds', 'energyMeter', 'maintainedBy', 'customData' ],
        timestamps:  false,
        usage:       KeyUsages.Infrastructure,
        addNeeds:    () => 'GridOperator',
        inPlace:     true,
    },

    ParkingGarage:         parking('parking garage', 'parkingGarages', [ ...BASE_PROPERTIES, 'address', 'geoLocation', 'chargingStationIds', 'openingTimes', 'images',
                                                                         'parkingProductIds', 'customData' ]),
    ParkingSpace:          parking('parking space', 'parkingSpaces', [ ...BASE_PROPERTIES, ...PARKING_SPACE_PROPERTIES, 'apdsReference', 'templateIds', 'customData' ], {
                               owners:    { ParkingOperator: 'parkingSpaces', ChargingStationOperator: 'parkingSpaces' },
                               addNeeds:  parentType => parentType === 'ChargingStationOperator' ? 'ChargingStationOperator' : 'ParkingOperator or ChargingStationOperator',
                           }),
    ParkingSensor:         parking('parking sensor', 'parkingSensors', [ ...BASE_PROPERTIES, 'geoLocation', 'chargingStationIds', 'customData' ]),
    ParkingSpaceTemplate:  parking('parking space template', 'parkingSpaceTemplates', [ ...BASE_PROPERTIES, 'parkingProductIds', 'customData', ...PARKING_SPACE_PROPERTIES ]),
    ParkingSpaceGroup:     parking('parking space group', 'parkingSpaceGroups', [ ...BASE_PROPERTIES, 'parkingSpaceIds', 'customData' ]),
    ParkingProduct:        parking('parking product', 'parkingProducts', [ 'name', 'description', 'minDuration', 'stopParkingAfterTime', 'customData' ], {
                               id:          caseId,
                               timestamps:  false,
                           }),

};

/** The groups of e-mobility providers, of the entity types of the groups of charging station operators (`ProviderGroupKind`). */
const PROVIDER_GROUP_TYPES: Readonly<Record<string, EmbeddedType>> = {
    EVSEGroup:             providerGroup('EVSE group',             'EVSEGroups',             evseGroupId,     'EVSEIds'),
    ChargingStationGroup:  providerGroup('charging station group', 'chargingStationGroups',  stationGroupId,  'chargingStationIds'),
    ChargingPoolGroup:     providerGroup('charging pool group',    'chargingPoolGroups',     poolGroupId,     'chargingPoolIds'),
};

/** Where an embedded entity is: its party, of which type, the array holding it, and the entity itself. */
interface EmbeddedFound {
    readonly party:      JSONObject;
    readonly partyType:  string;
    readonly children:   JSONArray;
    readonly child:      JSONObject;
}

/** The party embedding an entity of the given type, by its identification as its type compares it. */
function embeddedOf(content: JSONObject, type: EmbeddedType, entityId: string): EmbeddedFound | undefined {

    const key = type.id(entityId)?.key;

    if (key === undefined)
        return undefined;

    for (const [partyType, property] of Object.entries(type.owners))
        for (const party of objectsOf(get(content, required(NETWORK_ARRAYS[partyType], partyType)))) {
            const children = get(party, property);
            const child    = objectsOf(children).find(item => typeof item['@id'] === 'string' && type.id(item['@id'])?.key === key);
            if (child !== undefined)
                return { party, partyType, children: children as JSONArray, child };
        }

    return undefined;

}

/**
 * The type of the embedded entity a change changes, if it is one: a group of an e-mobility provider only when an `Add`
 * names one as its parent or one has it, else it is one of a charging station operator (`IsProviderGroupChange`).
 */
function embeddedTypeOf(content: JSONObject, change: Change): EmbeddedType | undefined {

    const providerGroupType = PROVIDER_GROUP_TYPES[change.entityType];

    if (providerGroupType !== undefined)
        return (change.kind === 'Add' ? change.parentEntityType === 'EMobilityProvider' : embeddedOf(content, providerGroupType, change.entityId) !== undefined)
                   ? providerGroupType
                   : undefined;

    return EMBEDDED_TYPES[change.entityType];

}

/** Identifications of parties and their releases and certificates are compared case-insensitively, as their C# types do. */
const sameId = (left: string, right: string): boolean =>
    left.toUpperCase() === right.toUpperCase();

/** Charging tariffs, templates and groups: children of their charging station operator itself. */
const OPERATOR_CHILD_ARRAYS: Readonly<Record<string, string>> = {
    ChargingTariff:           'chargingTariffs',
    EVSETemplate:             'EVSETemplates',
    ChargingStationTemplate:  'chargingStationTemplates',
    ChargingPoolTemplate:     'chargingPoolTemplates',
    ChargingTariffTemplate:   'chargingTariffTemplates',
    EVSEGroup:                'EVSEGroups',
    ChargingStationGroup:     'chargingStationGroups',
    ChargingPoolGroup:        'chargingPoolGroups',
    ChargingTariffGroup:      'chargingTariffGroups',
};

/** What a signing key of a charging station operator must be allowed to sign, to change an entity of this type (4.1). */
const TARIFF_TYPES = new Set([ 'ChargingTariff', 'ChargingTariffTemplate', 'ChargingTariffGroup', 'ChargingTariffOffer' ]);

const INFRASTRUCTURE_TYPES = new Set([ ...Object.keys(OPERATOR_CHILD_ARRAYS), 'ChargingPool', 'ChargingStation', 'EVSE' ]);

/** The properties of a charging pool a charging pool template can give its members (`ChargingPoolTemplatePoolProperties`). */
const POOL_TEMPLATE_PROPERTIES = [ 'dataLicenses', 'address', 'geoLocation', 'parkingType', 'accessibility', 'hotline', 'gridConnectionPointId', 'brands',
                                   'openingTimes', 'energyMix', 'images', 'timeZone', 'facilities', 'paymentOptions', 'authenticationModes', 'uiFeatures',
                                   'features', 'locationLanguages', 'entranceAddress', 'entranceLocation', 'exitAddress', 'exitLocation', 'arrivalInstructions',
                                   'chargingWhenClosed', 'parkingRestrictions', 'relatedLocations', 'services', 'assistanceServiceDetails', 'standards', 'nutsCodes' ];

/** The properties of a charging station a charging station template can give its members (`ChargingStationTemplateStationProperties`). */
const STATION_TEMPLATE_PROPERTIES = [ 'physicalReference', 'address', 'geoLocation', 'hotline', 'manufacturerId', 'modelId', 'modelURL', 'hardwareRevision',
                                      'firmwareVersion', 'transparencySoftwareStatus', 'signatureMethods', 'brands', 'openingTimes', 'images', 'vehicleTypes',
                                      'euVehicleCategories', 'accessibility', 'features', 'calibrationInfo', 'certificationInfo', 'maxPower', 'parkingSpaceIds',
                                      'certificateIds' ];

/** The properties of an EVSE an EVSE template can give its members (`EVSETemplateEVSEProperties`). */
const EVSE_TEMPLATE_PROPERTIES = [ 'physicalReference', 'currentTypes', 'chargingModes', 'maxVoltage', 'maxCurrent', 'maxPower', 'chargingConnectors', 'brands',
                                   'images', 'geoLocation', 'maxReservationDuration', 'reachDistance', 'operationTimeout', 'extendedOperationTimeout', 'standards',
                                   'floorLevel', 'acceptedEMobilityProviderIds' ];

/** The properties of a charging tariff a charging tariff template can give its members (`ChargingTariffTemplateTariffProperties`). */
const TARIFF_TEMPLATE_PROPERTIES = [ 'currency', 'tariffType', 'tariffURL', 'elements', 'minPrice', 'maxPrice', 'paymentMeans', 'paymentBrands', 'validFrom',
                                     'validUntil', 'energyMix' ];

/**
 * The infrastructure of a charging station operator a change set can update or remove the properties of, as WWCP_POI3
 * names it, and those properties (RoamingNetwork.InfrastructureChanges.cs): never its identification, timestamps or
 * children, e.g. the charging stations of a charging pool, which are changed on their own.
 */
const INFRASTRUCTURE: Readonly<Record<string, { readonly what: string, readonly changeable: readonly string[] }>> = {
    ChargingPool:             { what: 'charging pool',            changeable: [ ...BASE_PROPERTIES, ...POOL_TEMPLATE_PROPERTIES, 'energyMeters', 'templateIds', 'customData' ] },
    ChargingStation:          { what: 'charging station',         changeable: [ ...BASE_PROPERTIES, ...STATION_TEMPLATE_PROPERTIES, 'serialNumber', 'publicKeys', 'energyMeters',
                                                                                'templateIds', 'customData' ] },
    EVSE:                     { what: 'EVSE',                     changeable: [ ...BASE_PROPERTIES, ...EVSE_TEMPLATE_PROPERTIES, 'energyMeter', 'chargingTariffIds', 'iso15118Certificate',
                                                                                'templateIds', 'customData' ] },
    ChargingTariff:           { what: 'charging tariff',          changeable: [ ...BASE_PROPERTIES, ...TARIFF_TEMPLATE_PROPERTIES, 'templateIds', 'customData' ] },
    EVSEGroup:                { what: 'EVSE group',               changeable: [ ...BASE_PROPERTIES, 'EVSEIds', 'customData' ] },
    ChargingStationGroup:     { what: 'charging station group',   changeable: [ ...BASE_PROPERTIES, 'chargingStationIds', 'customData' ] },
    ChargingPoolGroup:        { what: 'charging pool group',      changeable: [ ...BASE_PROPERTIES, 'chargingPoolIds', 'customData' ] },
    ChargingTariffGroup:      { what: 'charging tariff group',    changeable: [ ...BASE_PROPERTIES, 'chargingTariffIds', 'customData' ] },
    EVSETemplate:             { what: 'EVSE template',            changeable: [ ...BASE_PROPERTIES, 'chargingTariffId', 'customData', ...EVSE_TEMPLATE_PROPERTIES ] },
    ChargingStationTemplate:  { what: 'charging station template', changeable: [ ...BASE_PROPERTIES, 'chargingTariffId', 'customData', ...STATION_TEMPLATE_PROPERTIES ] },
    ChargingPoolTemplate:     { what: 'charging pool template',   changeable: [ ...BASE_PROPERTIES, 'chargingTariffId', 'customData', ...POOL_TEMPLATE_PROPERTIES ] },
    ChargingTariffTemplate:   { what: 'charging tariff template', changeable: [ ...BASE_PROPERTIES, 'customData', ...TARIFF_TEMPLATE_PROPERTIES ] },
};


/**
 * A new value as a change gives it, which is what the content holds (section 4, "New values"): applied as it is, and refused
 * when it is written otherwise, as WWCP_POI refuses it, as far as this library tells the written form (`notWritten`). A
 * value WWCP_POI writes otherwise in another way, e.g. an identification in another case, ends in other after ETags here.
 */
function asGiven(value: JSONValue, property: string | undefined, where: string): JSONValue {

    const found = notWritten(value, property, property ?? '', 'new value');

    if (found !== undefined)
        throw new POIError(`${where}: ${found.path === '' ? 'it' : `'${found.path}'`} is not given as the content holds it: ${found.reason}!`);

    return clone(value);

}

/** Inserts an entity into an array of entities in the ordinal order of their identifications. */
function insertOrdered(array: JSONArray, entity: JSONObject): void {
    const id    = asText(entity['@id']);
    const index = array.findIndex(item => isObject(item) && ordinal(asText(item['@id']), id) > 0);
    array.splice(index < 0 ? array.length : index, 0, entity);
}

const objectsOf = (value: JSONValue | undefined): JSONObject[] =>
    isArray(value) ? value.filter(isObject) : [];


/** Where an infrastructure entity is: the object, the array holding it, and its parent. */
interface Found {
    readonly entity:      JSONObject;
    readonly container:   JSONArray;
    readonly holder:      JSONObject;
    readonly property:    string;
    readonly parentType:  string;
    readonly parentId:    string;
}


/** Finds an infrastructure entity within its charging station operator (`Find` of the C# implementation). */
function find(operator: JSONObject, entityType: string, entityId: string): Found | undefined {

    const operatorId  = asText(operator['@id']);
    const childArray  = OPERATOR_CHILD_ARRAYS[entityType];

    if (childArray !== undefined) {
        const children = get(operator, childArray);
        for (const child of objectsOf(children))
            if (child['@id'] === entityId)
                return { entity: child, container: children as JSONArray, holder: operator, property: childArray, parentType: 'ChargingStationOperator', parentId: operatorId };
        return undefined;
    }

    const pools = get(operator, 'chargingPools');

    for (const pool of objectsOf(pools)) {

        if (entityType === 'ChargingPool') {
            if (pool['@id'] === entityId)
                return { entity: pool, container: pools as JSONArray, holder: operator, property: 'chargingPools', parentType: 'ChargingStationOperator', parentId: operatorId };
            continue;
        }

        const stations = get(pool, 'chargingStations');

        for (const station of objectsOf(stations)) {

            if (entityType === 'ChargingStation') {
                if (station['@id'] === entityId)
                    return { entity: station, container: stations as JSONArray, holder: pool, property: 'chargingStations', parentType: 'ChargingPool', parentId: asText(pool['@id']) };
                continue;
            }

            const evses = get(station, 'EVSEs');

            for (const evse of objectsOf(evses))
                if (evse['@id'] === entityId)
                    return { entity: evse, container: evses as JSONArray, holder: station, property: 'EVSEs', parentType: 'ChargingStation', parentId: asText(station['@id']) };

        }

    }

    return undefined;

}


/** The charging station operator an identification names: the one whose identification and a '*' it starts with. */
function operatorOf(content: JSONObject, entityId: string): JSONObject | undefined {

    let found: JSONObject | undefined;

    for (const operator of objectsOf(get(content, 'chargingStationOperators'))) {
        const id = asText(operator['@id']);
        if (entityId.startsWith(id + '*') && (found === undefined || id.length > asText(found['@id']).length))
            found = operator;
    }

    return found;

}


/** Sets `lastChange` of what embeds a changed entity: its charging station and charging pool, and its operator (`TouchParents`). */
function touchParents(operator: JSONObject, parentType: string | undefined, parentId: string | undefined, lastChange: string): void {

    while ((parentType === 'ChargingStation' || parentType === 'ChargingPool') && parentId !== undefined) {

        const parent = find(operator, parentType, parentId);

        if (parent === undefined)
            break;

        parent.entity['lastChange'] = lastChange;
        parentType = parent.parentType;
        parentId   = parent.parentId;

    }

    operator['lastChange'] = lastChange;

}


/** Whether an old value names the value found, as the C# implementation compares them: JSON `null` expects it absent. */
const oldValueMatches = (oldValue: JSONValue, current: JSONValue | undefined): boolean =>
    oldValue === null ? current === undefined : current !== undefined && sameValue(oldValue, current);


/** Compares an old value as the C# implementation does: JSON `null` expects the value absent. */
function checkOldValue(change: Change, current: JSONValue | undefined, index: number, what: string): void {

    if (change.oldValue === undefined)
        return;

    if (!oldValueMatches(change.oldValue, current))
        throw new POIError(change.propertyName !== undefined && (change.kind === 'UpdateProperty' || change.kind === 'RemoveProperty')
                               ? `Change ${index}: the property '${change.propertyName}' of the ${what} is no longer the expected old value!`
                               : `Change ${index}: the ${what} is no longer the expected old value${current === undefined ? ': it does not exist' : ''}!`);

}


/**
 * The change of the property of an entity an element change amounts to (`TryResolveElementChange`): the `UpdateProperty`
 * of the property its path starts with, or its `RemoveProperty` when nothing is left, after its old value is compared with
 * the element, or the property of the element, it addresses, so that concurrent changes of other elements of the same
 * property do not conflict with it. It is checked as that change then: as a property a change set can change, and by the
 * written form of its new value. Keys, and the tree hash algorithms, whose order is content, are changed as a whole. Any
 * other change stays as it is.
 */
function resolveElementChange(change: Change, entity: JSONObject | undefined, what: string, index: number): Change {

    if (!isElementChange(change))
        return change;

    const property = required(entityPropertyName(change), `Change ${index}: ${change.kind} needs an element path!`);

    if (entity === undefined)
        throw new POIError(`Change ${index}: the ${what} does not exist!`);

    if (property === 'signingKeys' || property === 'identityKeys' || property === 'treeHashAlgorithms')
        throw new POIError(`Change ${index}: the ${property} of the ${what} are changed as a whole, not element by element!`);

    const applied = applyElement(change, get(entity, property));

    if (applied.error !== undefined)
        throw new POIError(`Change ${index}: ${change.kind} of the ${what}: ${applied.error}`);

    if (change.oldValue !== undefined && !oldValueMatches(change.oldValue, applied.current))
        throw new POIError(`Change ${index}: '${pathText(change.elementPath ?? [], change.propertyName)}' of the ${what} is no longer the expected old value!`);

    return {
        ...change,
        kind:          applied.newValue === undefined ? 'RemoveProperty' : 'UpdateProperty',
        propertyName:  property,
        oldValue:      undefined,
        newValue:      applied.newValue,
        elementPath:   undefined,
    };

}


/** Applies an `UpdateProperty` or a `RemoveProperty` to an entity, and its `lastChange`, where it has one. */
function applyProperty(entity: JSONObject, change: Change, index: number, what: string, lastChange: string | undefined): void {

    const property = change.propertyName;

    if (property === undefined || property === '@id' || property === 'created' || property === 'lastChange')
        throw new POIError(`Change ${index}: the property '${property ?? ''}' of ${withArticle(what, false)} can not be changed!`);

    if (change.kind === 'RemoveProperty') {
        if (get(entity, property) === undefined)
            throw new POIError(`Change ${index}: the property '${property}' of the ${what} does not exist!`);
        unset(entity, property);
    }
    else {
        if (change.newValue === undefined)
            throw new POIError(`Change ${index}: an UpdateProperty needs its newValue!`);
        set(entity, property, asGiven(change.newValue, property, `Change ${String(index)}, the ${what}`));
    }

    if (lastChange !== undefined)
        entity['lastChange'] = lastChange;

}


/** The entity to add of a change: an object of the identification the change names, with its timestamps. */
function entityToAdd(change: Change, index: number, what: string, createdAt: string): JSONObject {

    if (!isObject(change.newValue) || change.newValue['@id'] !== change.entityId)
        throw new POIError(`Change ${index}: the ${what} to add must be a JSON object with the identification '${change.entityId}'!`);

    // The change set sets its lastChange, whatever an added entity gives.
    const added = asGiven(without(change.newValue, 'lastChange'), undefined, `Change ${String(index)}, the ${what} to add`) as JSONObject;

    if (get(added, 'created') === undefined)
        added['created'] = createdAt;

    added['lastChange'] = createdAt;

    return added;

}


function applyInfrastructureChange(content: JSONObject, change: Change, index: number, createdAt: string): void {

    // Named as WWCP_POI3 names it, e.g. "the charging pool 'DE*GEF*P1'" (`Describe`).
    const what      = `${INFRASTRUCTURE[change.entityType]?.what ?? change.entityType} '${change.entityId}'`;
    const operator  = operatorOf(content, change.entityId);

    if (operator === undefined)
        throw new POIError(`Change ${index}: the charging station operator of the ${what} does not exist!`);

    const found = find(operator, change.entityType, change.entityId);

    if (found !== undefined && change.parentEntityType !== undefined &&
       (change.parentEntityType !== found.parentType || change.parentEntityId !== found.parentId))
        throw new POIError(`Change ${index}: the ${what} belongs to ${found.parentType} '${found.parentId}', not to ${change.parentEntityType} '${change.parentEntityId}'!`);

    // An element change is applied as the change of the property it amounts to.
    change = resolveElementChange(change, found?.entity, what, index);

    if (change.kind !== 'Add' && found === undefined)
        throw new POIError(`Change ${index}: the ${what} does not exist!`);

    // Every change but an Add changes an entity that exists.
    const existing = (): Found => required(found, `Change ${index}: the ${what} does not exist!`);

    const isProperty = change.kind === 'UpdateProperty' || change.kind === 'RemoveProperty';

    checkOldValue(change, isProperty ? get(existing().entity, change.propertyName ?? '') : found?.entity, index, what);

    let parentType  = found?.parentType;
    let parentId    = found?.parentId;

    switch (change.kind) {

        case 'UpdateProperty':
        case 'RemoveProperty': {
            const infrastructure = required(INFRASTRUCTURE[change.entityType], change.entityType);
            if (!infrastructure.changeable.includes(change.propertyName ?? ''))
                throw new POIError(`Change ${index}: the property '${change.propertyName ?? ''}' of ${withArticle(infrastructure.what, false)} can not be changed!`);
            applyProperty(existing().entity, change, index, what, createdAt);
            break;
        }

        case 'Add': {

            if (found !== undefined)
                throw new POIError(`Change ${index}: the ${what} already exists!`);

            const added = entityToAdd(change, index, what, createdAt);

            // The parent it is added to: its operator, charging pool or charging station.
            parentType  = change.parentEntityType ?? 'ChargingStationOperator';
            parentId    = change.parentEntityId   ?? asText(operator['@id']);

            let holder: JSONObject | undefined;
            let property: string;

            if (OPERATOR_CHILD_ARRAYS[change.entityType] !== undefined || change.entityType === 'ChargingPool') {
                if (parentType !== 'ChargingStationOperator' || parentId !== operator['@id'])
                    throw new POIError(`Change ${index}: ${withArticle(what, false)} belongs to ChargingStationOperator '${asText(operator['@id'])}', not to ${parentType} '${parentId}'!`);
                holder   = operator;
                property = OPERATOR_CHILD_ARRAYS[change.entityType] ?? 'chargingPools';
            }
            else if (change.entityType === 'ChargingStation') {
                if (parentType !== 'ChargingPool')
                    throw new POIError(`Change ${index}: a charging station is added to a charging pool!`);
                holder   = find(operator, 'ChargingPool', parentId)?.entity;
                property = 'chargingStations';
            }
            else {
                if (parentType !== 'ChargingStation')
                    throw new POIError(`Change ${index}: an EVSE is added to a charging station!`);
                holder   = find(operator, 'ChargingStation', parentId)?.entity;
                property = 'EVSEs';
            }

            if (holder === undefined)
                throw new POIError(`Change ${index}: the ${parentType} '${parentId}' to add the ${what} to does not exist!`);

            const children = get(holder, property);

            if (children === undefined)
                set(holder, property, [ added ]);
            else if (isArray(children))
                insertOrdered(children, added);
            else
                throw new POIError(`Change ${index}: '${property}' of ${parentType} '${parentId}' is no array!`);

            break;

        }

        case 'Remove': {
            const { entity, container, holder, property } = existing();
            container.splice(container.indexOf(entity), 1);
            if (container.length === 0)
                unset(holder, property);
            break;
        }

        default:
            throw new POIError(`Change ${index}: ${change.kind} of ${withArticle(INFRASTRUCTURE[change.entityType]?.what ?? change.entityType, false)} is not supported by this library yet!`);

    }

    // What embeds it changed with it, at the time of the change set.
    touchParents(operator, parentType, parentId, createdAt);

}


function applyNetworkArrayChange(content: JSONObject, change: Change, index: number, createdAt: string): void {

    const property  = required(NETWORK_ARRAYS[change.entityType],   `Change ${index}: ${change.entityType} is no party!`);
    const registry  = required(PARTY_REGISTRIES[change.entityType], `Change ${index}: ${change.entityType} is no party!`);
    const what      = `${registry.what} '${change.entityId}'`;

    if (change.parentEntityType !== undefined && (change.parentEntityType !== 'RoamingNetwork' || change.parentEntityId !== content['@id']))
        throw new POIError(`Change ${index}: ${registry.article} ${registry.what} of this roaming network belongs to RoamingNetwork '${asText(content['@id'])}', not to ${change.parentEntityType} '${change.parentEntityId}'!`);

    const array   = get(content, property);
    const entity  = objectsOf(array).find(item => item['@id'] === change.entityId);

    // An element change is applied as the change of the property it amounts to.
    change = resolveElementChange(change, entity, what, index);

    const isProperty = change.kind === 'UpdateProperty' || change.kind === 'RemoveProperty';

    if (isProperty && entity === undefined)
        throw new POIError(`Change ${index}: the ${what} does not exist!`);

    // Its children, e.g. its models, are changed on their own: by a key that may sign them.
    if (isProperty && !registry.changeable.includes(change.propertyName ?? ''))
        throw new POIError(`Change ${index}: the property '${change.propertyName ?? ''}' of ${registry.article} ${registry.what} can not be changed!`);

    const existing = (): JSONObject => required(entity, `Change ${index}: the ${what} does not exist!`);

    checkOldValue(change, isProperty ? get(existing(), change.propertyName ?? '') : entity, index, what);

    switch (change.kind) {

        case 'UpdateProperty':
        case 'RemoveProperty':
            applyProperty(existing(), change, index, what, createdAt);
            break;

        case 'Add': {
            if (entity !== undefined)
                throw new POIError(`Change ${index}: the ${what} already exists!`);
            const added = entityToAdd(change, index, what, createdAt);
            if (array === undefined)
                set(content, property, [ added ]);
            else if (isArray(array))
                insertOrdered(array, added);
            break;
        }

        case 'Remove': {
            if (entity === undefined)
                throw new POIError(`Change ${index}: the ${what} does not exist!`);
            const items = array as JSONArray;
            items.splice(items.indexOf(entity), 1);
            if (items.length === 0)
                unset(content, property);
            break;
        }

        default:
            throw new POIError(`Change ${index}: ${change.kind} of ${registry.article} ${registry.what} is not supported by this library yet!`);

    }

}


/** The party of a type embedding a release or a certificate of an identification, and where. */
function partyChildOf(content: JSONObject, type: PartyChildType, childId: string): { party: JSONObject, children: JSONArray, child: JSONObject } | undefined {

    for (const party of objectsOf(get(content, type.parents))) {
        const children = get(party, type.property);
        const child    = objectsOf(children).find(item => typeof item['@id'] === 'string' && sameId(item['@id'], childId));
        if (child !== undefined)
            return { party, children: children as JSONArray, child };
    }

    return undefined;

}

/** The party of a type an identification names, in any spelling its identification considers equal. */
function partyNamed(content: JSONObject, type: string, id: string | undefined): JSONObject | undefined {
    const property = NETWORK_ARRAYS[type];
    return property === undefined || id === undefined
               ? undefined
               : objectsOf(get(content, property)).find(party => typeof party['@id'] === 'string' && sameId(party['@id'], id));
}


/** A model of the manufacturer a change names as its parent, and where: its identification is unique within it only. */
function partyChildIn(content: JSONObject, type: PartyChildType, change: Change, index: number): { party: JSONObject, found: { party: JSONObject, children: JSONArray, child: JSONObject } | undefined } {

    const party = change.parentEntityType === type.parentType ? partyNamed(content, type.parentType, change.parentEntityId) : undefined;

    if (party === undefined)
        throw new POIError(`Change ${index}: the ${type.what} '${change.entityId}' needs its ${type.parentType}, an existing one!`);

    const children  = get(party, type.property);
    const child     = objectsOf(children).find(item => typeof item['@id'] === 'string' && sameId(item['@id'], change.entityId));

    return { party, found: child === undefined ? undefined : { party, children: children as JSONArray, child } };

}


/**
 * Applies a change of a model of a charging station or energy meter manufacturer, of a release of a transparency software
 * manufacturer or of a certificate of a conformity assessment body (`TryApplyModelChange`,
 * `TryApplyTransparencySoftwareChange`, `TryApplyConformityCertificateChange`): added to the party an `Add` names
 * as its parent, changed and removed in the one embedding it, a model in the manufacturer every change of it names; the
 * party changes with it.
 */
function applyPartyChildChange(content: JSONObject, change: Change, index: number, createdAt: string): void {

    const type   = required(PARTY_CHILD_TYPES[change.entityType], `Change ${index}: ${change.entityType} is no child of a party!`);
    const what   = `${type.what} '${change.entityId}'`;

    if (type.inParent !== undefined) {

        const { party, found } = partyChildIn(content, type, change, index);

        if (change.kind === 'Add' && found !== undefined)
            throw new POIError(`Change ${index}: the ${what} already exists, at the ${type.inParent} '${asText(party['@id'])}'!`);

        if (change.kind !== 'Add' && found === undefined)
            throw new POIError(`Change ${index}: the ${what} of the ${type.inParent} '${asText(party['@id'])}' does not exist!`);

        applyPartyChild(type, party, found, change, index, what, createdAt);
        return;

    }

    const found  = partyChildOf(content, type, change.entityId);
    let   party: JSONObject;

    if (change.kind === 'Add') {

        if (found !== undefined)
            throw new POIError(`Change ${index}: the ${what} already exists, at the ${type.parentType} '${asText(found.party['@id'])}'!`);

        const parent = change.parentEntityType === type.parentType ? partyNamed(content, type.parentType, change.parentEntityId) : undefined;

        if (parent === undefined)
            throw new POIError(`Change ${index}: the ${what} to add needs its ${type.parentType}, an existing one!`);

        party = parent;

    }

    else {

        if (found === undefined)
            throw new POIError(`Change ${index}: the ${what} does not exist!`);

        if (change.parentEntityType !== undefined &&
           (change.parentEntityType !== type.parentType || change.parentEntityId === undefined || !sameId(change.parentEntityId, asText(found.party['@id']))))
            throw new POIError(`Change ${index}: the ${what} belongs to ${type.parentType} '${asText(found.party['@id'])}', not to ${change.parentEntityType} '${change.parentEntityId ?? ''}'!`);

        party = found.party;

    }

    applyPartyChild(type, party, found, change, index, what, createdAt);

}

/** Applies a change of a model, a release or a certificate to the party embedding it, or adding it. */
function applyPartyChild(type: PartyChildType, party: JSONObject, found: { children: JSONArray, child: JSONObject } | undefined, change: Change, index: number,
                         what: string, createdAt: string): void {

    // An element change is applied as the change of the property it amounts to.
    change = resolveElementChange(change, found?.child, what, index);

    const isProperty  = change.kind === 'UpdateProperty' || change.kind === 'RemoveProperty';
    const existing    = (): { children: JSONArray, child: JSONObject } => required(found, `Change ${index}: the ${what} does not exist!`);

    checkOldValue(change, isProperty ? get(existing().child, change.propertyName ?? '') : found?.child, index, what);

    switch (change.kind) {

        // Models, releases and certificates have no timestamps of their own.
        case 'UpdateProperty':
        case 'RemoveProperty': {

            const property  = change.propertyName ?? '';
            const child     = existing().child;

            if (!type.changeable.includes(property))
                throw new POIError(type.keepsVersion === true && property === 'version'
                                       ? `Change ${index}: the version of the ${what} can not be changed: a new version is a new release!`
                                       : `Change ${index}: the property '${property}' of ${withArticle(type.what, false)} can not be changed!`);

            if (change.kind === 'RemoveProperty') {
                if (get(child, property) === undefined)
                    throw new POIError(`Change ${index}: the property '${property}' of the ${what} does not exist!`);
                unset(child, property);
            }
            else {
                if (change.newValue === undefined)
                    throw new POIError(`Change ${index}: an UpdateProperty needs its newValue!`);
                set(child, property, asGiven(change.newValue, property, `Change ${String(index)}, the ${what}`));
            }

            break;

        }

        case 'Add': {

            if (!isObject(change.newValue) || typeof change.newValue['@id'] !== 'string' || !sameId(change.newValue['@id'], change.entityId))
                throw new POIError(`Change ${index}: the ${type.what} to add must be a JSON object with the identification '${change.entityId}'!`);

            const added    = asGiven(without(change.newValue, 'lastChange'), undefined, `Change ${String(index)}, the ${what} to add`) as JSONObject;
            const children = get(party, type.property);

            if (children === undefined)
                set(party, type.property, [ added ]);
            else if (isArray(children))
                insertOrdered(children, added);
            else
                throw new POIError(`Change ${index}: '${type.property}' of ${type.parentType} '${asText(party['@id'])}' is no array!`);

            break;

        }

        case 'Remove': {
            const { children, child } = existing();
            children.splice(children.indexOf(child), 1);
            if (children.length === 0)
                unset(party, type.property);
            break;
        }

        default:
            throw new POIError(`Change ${index}: ${change.kind} of ${withArticle(type.what, false)} is not supported by this library yet!`);

    }

    // The party embedding it changed with it, at the time of the change set.
    party['lastChange'] = createdAt;

}


/**
 * Applies a change of an entity a party embeds (`EMBEDDED_TYPES`): added to the party an `Add` names as its parent, changed
 * and removed in the one embedding it, found by its identification as its type compares it, with its timestamps where it
 * has them; the party changes with it.
 */
function applyEmbeddedChange(content: JSONObject, change: Change, index: number, createdAt: string, type: EmbeddedType): void {

    const id = type.id(change.entityId);

    if (id === undefined)
        throw new POIError(`Change ${index}: invalid ${type.what} identification '${change.entityId}'!`);

    // A grid connection point named by its identification as read, every other entity as the change names it.
    const gridPoint  = type === EMBEDDED_TYPES['GridConnectionPoint'];
    const what       = `${type.what} '${gridPoint ? id.text : change.entityId}'`;
    const found      = embeddedOf(content, type, change.entityId);
    let   party:     JSONObject;
    let   property:  string;

    if (change.kind === 'Add') {

        if (found !== undefined)
            throw new POIError(gridPoint
                                   ? `Change ${index}: the ${what} already exists, at the grid operator '${asText(found.party['@id'])}'!`
                                   : `Change ${index}: the ${what} already exists!`);

        const parentProperty = change.parentEntityType === undefined ? undefined : type.owners[change.parentEntityType];
        const parent         = change.parentEntityType === undefined || parentProperty === undefined
                                   ? undefined
                                   : partyNamed(content, change.parentEntityType, change.parentEntityId);

        if (parent === undefined || parentProperty === undefined)
            throw new POIError(`Change ${index}: the ${what} to add needs its ${type.addNeeds(change.parentEntityType)}, an existing one!`);

        party     = parent;
        property  = parentProperty;

    }

    else {

        if (found === undefined)
            throw new POIError(`Change ${index}: the ${what} does not exist!`);

        if (change.parentEntityType !== undefined &&
           (change.parentEntityType !== found.partyType || change.parentEntityId === undefined || !sameId(change.parentEntityId, asText(found.party['@id']))))
            throw new POIError(`Change ${index}: the ${what} belongs to ${found.partyType} '${asText(found.party['@id'])}', not to ${change.parentEntityType} '${change.parentEntityId ?? ''}'!`);

        party     = found.party;
        property  = required(type.owners[found.partyType], found.partyType);

    }

    // An element change is applied as the change of the property it amounts to.
    change = resolveElementChange(change, found?.child, what, index);

    const isProperty  = change.kind === 'UpdateProperty' || change.kind === 'RemoveProperty';
    const existing    = (): EmbeddedFound => required(found, `Change ${index}: the ${what} does not exist!`);

    checkOldValue(change, isProperty ? get(existing().child, change.propertyName ?? '') : found?.child, index, what);

    switch (change.kind) {

        case 'UpdateProperty':
        case 'RemoveProperty':
            if (!type.changeable.includes(change.propertyName ?? ''))
                throw new POIError(`Change ${index}: the property '${change.propertyName ?? ''}' of ${withArticle(type.what, false)} can not be changed!`);
            applyProperty(existing().child, change, index, what, type.timestamps ? createdAt : undefined);
            break;

        case 'Add': {

            // Of the identification the change names: a grid connection point of one its type reads alike.
            const given = change.newValue;

            if (!isObject(given) || typeof given['@id'] !== 'string' ||
                (gridPoint ? type.id(given['@id'])?.key !== id.key : given['@id'] !== change.entityId))
                throw new POIError(`Change ${index}: the ${type.what} to add must be a JSON object with the identification '${gridPoint ? id.text : change.entityId}'!`);

            const added    = type.timestamps ? entityToAdd(change, index, what, createdAt) : asGiven(given, undefined, `Change ${String(index)}, the ${what} to add`) as JSONObject;
            const children = get(party, property);

            if (children === undefined)
                set(party, property, [ added ]);
            else if (isArray(children))
                insertOrdered(children, added);
            else
                throw new POIError(`Change ${index}: '${property}' of '${asText(party['@id'])}' is no array!`);

            break;

        }

        case 'Remove': {
            const { children, child } = existing();
            children.splice(children.indexOf(child), 1);
            if (children.length === 0)
                unset(party, property);
            break;
        }

        default:
            throw new POIError(`Change ${index}: ${change.kind} of ${withArticle(type.what, false)} is not supported by this library yet!`);

    }

    // The party embedding it changed with it, at the time of the change set.
    party['lastChange'] = createdAt;

}


/** The party embedding an energy meter template or group: a charging station operator, or else a grid operator. */
function energyMeterChildOf(content: JSONObject, type: EnergyMeterChildType, childId: string): { party: JSONObject, partyType: string, children: JSONArray, child: JSONObject } | undefined {

    for (const [partyType, parties] of [ [ 'ChargingStationOperator', 'chargingStationOperators' ], [ 'GridOperator', 'gridOperators' ] ] as const)
        for (const party of objectsOf(get(content, parties))) {
            const children = get(party, type.property);
            const child    = objectsOf(children).find(item => typeof item['@id'] === 'string' && sameId(item['@id'], childId));
            if (child !== undefined)
                return { party, partyType, children: children as JSONArray, child };
        }

    return undefined;

}

/**
 * Applies a change of an energy meter template or group: added to the charging station operator or grid operator an `Add`
 * names as its parent, changed and removed in the one embedding it, with its timestamps; the party changes with it.
 */
function applyEnergyMeterChildChange(content: JSONObject, change: Change, index: number, createdAt: string): void {

    const type   = required(ENERGY_METER_CHILD_TYPES[change.entityType], `Change ${index}: ${change.entityType} is no energy meter template or group!`);
    const what   = `${type.what} '${change.entityId}'`;
    const found  = energyMeterChildOf(content, type, change.entityId);
    let   party: JSONObject;

    if (change.kind === 'Add') {

        if (found !== undefined)
            throw new POIError(`Change ${index}: the ${what} already exists!`);

        const parent = change.parentEntityType === 'ChargingStationOperator' || change.parentEntityType === 'GridOperator'
                           ? partyNamed(content, change.parentEntityType, change.parentEntityId)
                           : undefined;

        if (parent === undefined)
            throw new POIError(`Change ${index}: the ${what} to add needs its ChargingStationOperator or GridOperator, an existing one!`);

        party = parent;

    }

    else {

        if (found === undefined)
            throw new POIError(`Change ${index}: the ${what} does not exist!`);

        if (change.parentEntityType !== undefined &&
           (change.parentEntityType !== found.partyType || change.parentEntityId === undefined || !sameId(change.parentEntityId, asText(found.party['@id']))))
            throw new POIError(`Change ${index}: the ${what} belongs to ${found.partyType} '${asText(found.party['@id'])}', not to ${change.parentEntityType} '${change.parentEntityId ?? ''}'!`);

        party = found.party;

    }

    // An element change is applied as the change of the property it amounts to.
    change = resolveElementChange(change, found?.child, what, index);

    const isProperty  = change.kind === 'UpdateProperty' || change.kind === 'RemoveProperty';
    const existing    = (): { children: JSONArray, child: JSONObject } => required(found, `Change ${index}: the ${what} does not exist!`);

    checkOldValue(change, isProperty ? get(existing().child, change.propertyName ?? '') : found?.child, index, what);

    switch (change.kind) {

        case 'UpdateProperty':
        case 'RemoveProperty':
            if (!type.changeable.includes(change.propertyName ?? ''))
                throw new POIError(`Change ${index}: the property '${change.propertyName ?? ''}' of ${withArticle(type.what, false)} can not be changed!`);
            applyProperty(existing().child, change, index, what, createdAt);
            break;

        case 'Add': {

            const added    = entityToAdd(change, index, what, createdAt);
            const children = get(party, type.property);

            if (children === undefined)
                set(party, type.property, [ added ]);
            else if (isArray(children))
                insertOrdered(children, added);
            else
                throw new POIError(`Change ${index}: '${type.property}' of '${asText(party['@id'])}' is no array!`);

            break;

        }

        case 'Remove': {
            const { children, child } = existing();
            children.splice(children.indexOf(child), 1);
            if (children.length === 0)
                unset(party, type.property);
            break;
        }

        default:
            throw new POIError(`Change ${index}: ${change.kind} of ${withArticle(type.what, false)} is not supported by this library yet!`);

    }

    // The party embedding it changed with it, at the time of the change set.
    party['lastChange'] = createdAt;

}


/** The properties of the roaming network itself a change set can update or remove. */
const NETWORK_PROPERTIES = [ 'name', 'description', 'dataSource', 'dataLicenses', 'treeHashAlgorithms', 'customData' ];

function applyNetworkChange(content: JSONObject, change: Change, index: number, createdAt: string): void {

    const what = `roaming network '${asText(content['@id'])}'`;

    // An element change is applied as the change of the property it amounts to, of the properties of its own only.
    const property  = entityPropertyName(change) ?? '';
    const held      = NETWORK_PROPERTIES.includes(property) ? get(content, property) : undefined;
    const own: JSONObject = {};

    if (held !== undefined)
        set(own, property, held);

    change = resolveElementChange(change, own, what, index);

    if (change.kind !== 'UpdateProperty' && change.kind !== 'RemoveProperty')
        throw new POIError(`Change ${index}: ${change.kind} of the roaming network itself is not possible!`);

    if (!NETWORK_PROPERTIES.includes(change.propertyName ?? ''))
        throw new POIError(`Change ${index}: the property '${change.propertyName ?? ''}' of a roaming network can not be changed!`);

    checkOldValue(change, get(content, change.propertyName ?? ''), index, what);
    applyProperty(content, change, index, what, createdAt);

}


function applyOperatorChange(content: JSONObject, change: Change, index: number, createdAt: string): void {

    const operator = get(content, 'operator');

    if (!isObject(operator) || operator['@id'] !== change.entityId)
        throw new POIError(`Change ${index}: the roaming network operator '${change.entityId}' is not the one of this roaming network!`);

    // An element change is applied as the change of the property it amounts to.
    change = resolveElementChange(change, operator, `roaming network operator '${change.entityId}'`, index);

    if (change.kind !== 'UpdateProperty' && change.kind !== 'RemoveProperty')
        throw new POIError(`Change ${index}: the roaming network operator is neither added nor removed!`);

    if (!RNO_PROPERTIES.includes(change.propertyName ?? ''))
        throw new POIError(`Change ${index}: the property '${change.propertyName ?? ''}' of a roaming network operator can not be changed!`);

    checkOldValue(change, get(operator, change.propertyName ?? ''), index, `roaming network operator '${change.entityId}'`);
    applyProperty(operator, change, index, `roaming network operator '${change.entityId}'`, createdAt);

}


// Owners and their signatures (4.1)


interface PartyKeys {
    readonly type:          string;
    readonly id:            string;
    readonly signingKeys:   readonly POIPublicKey[];
    readonly identityKeys:  readonly POIPublicKey[];
}

function partiesOf(network: RoamingNetwork): Map<string, PartyKeys> {

    const parties = new Map<string, PartyKeys>();

    for (const [type, property] of Object.entries(NETWORK_ARRAYS))
        if (PARTIES.has(type))
            for (const party of objectsOf(get(network.content, property)))
                parties.set(`${type}:${asText(party['@id'])}`, {
                    type,
                    id:            asText(party['@id']),
                    signingKeys:   POIPublicKey.parseAll(get(party, 'signingKeys'),  `signing keys of the ${type} '${asText(party['@id'])}'`),
                    identityKeys:  POIPublicKey.parseAll(get(party, 'identityKeys'), `identity keys of the ${type} '${asText(party['@id'])}'`),
                });

    return parties;

}


/**
 * Who must sign a change, as the table of section 4.1 says. A party signs with a signing key that may sign the usage, with
 * an identity key, or with either; an identity key of the roaming network operator recovers the keys of every party.
 */
type OwnerKeys = 'signing' | 'identity' | 'signingOrIdentity';

/**
 * An owner of a change: the roaming network operator, or a party, which the roaming network operator signs in the place of
 * when it has no signing keys (`SignerOf`), unless `inPlace` is false.
 */
type Owner =
    | { readonly kind: 'rno', readonly keys: OwnerKeys }
    | { readonly kind: 'party', readonly type: string, readonly id: string, readonly usage: KeyUsage, readonly keys: OwnerKeys, readonly inPlace?: boolean };

/** A party, by its entity type and its identification as the version names it. */
interface PartyRef {
    readonly type:  string;
    readonly id:    string;
}

/**
 * Who owns what the earlier changes of a change set added or removed, as applying them decides (`EarlierChanges`): what
 * they added, the parent of its `Add`; what they removed, alone or with the party embedding it, nobody.
 */
interface Earlier {
    readonly energyMeterChildren:  Map<string, PartyRef>;
    /** Embedded entities (`EMBEDDED_TYPES`, `PROVIDER_GROUP_TYPES`) by their types and keys: their owners, or none. */
    readonly embedded:             Map<string, PartyRef | null>;
    /** Grid connection points by their keys: their grid operators and maintainers, or none. */
    readonly gridPoints:           Map<string, { readonly gridOperator: PartyRef, readonly maintainer: PartyRef } | null>;
    readonly removedParties:       Set<string>;
}

const partyKeyOf = (party: PartyRef): string =>
    `${party.type}:${party.id.toUpperCase()}`;

/** The given party as the version names it: a change may name it in every spelling its identification considers equal (`PartyIdOf`). */
const partyRefOf = (content: JSONObject, type: string, id: string): PartyRef =>
    ({ type, id: asText(partyNamed(content, type, id)?.['@id'] ?? id) });

/** The given owner of the version, unless an earlier change removed it (`NotRemoved`). */
const notRemoved = (earlier: Earlier, party: PartyRef): PartyRef | null =>
    earlier.removedParties.has(partyKeyOf(party)) ? null : party;

/** The given party removed: nobody owns what it embeds any more (`RemoveParty`). */
function removeParty(earlier: Earlier, party: PartyRef): void {

    earlier.removedParties.add(partyKeyOf(party));

    for (const [key, owner] of earlier.embedded)
        if (owner !== null && partyKeyOf(owner) === partyKeyOf(party))
            earlier.embedded.set(key, null);

    for (const [key, point] of earlier.gridPoints)
        if (point !== null && partyKeyOf(point.gridOperator) === partyKeyOf(party))
            earlier.gridPoints.set(key, null);

}

/** The party a grid connection point names as its maintainer, if it names one (`POIPartyId.TryParse`). */
function maintainerOf(content: JSONObject, maintainedBy: JSONValue | undefined): PartyRef | undefined {
    return isObject(maintainedBy) && typeof maintainedBy['entityType'] === 'string' && typeof maintainedBy['entityId'] === 'string'
               ? partyRefOf(content, maintainedBy['entityType'], maintainedBy['entityId'])
               : undefined;
}

/**
 * The owners of a change of an entity a party embeds, of which one signs it: the party embedding it, the parent of its
 * `Add`; of a grid connection point its maintainer, and of its maintainer also its grid operator and the identity keys of
 * the roaming network operator. Undefined for a group of a charging station operator.
 */
function embeddedOwnersOf(content: JSONObject, change: Change, index: number, earlier: Earlier): readonly Owner[] | undefined {

    const signer = (party: PartyRef, usage: KeyUsage, inPlace = true): Owner =>
        ({ kind: 'party', type: party.type, id: party.id, usage, keys: 'signing', inPlace });

    const providerGroupType = PROVIDER_GROUP_TYPES[change.entityType];
    const type              = providerGroupType ?? EMBEDDED_TYPES[change.entityType];

    if (type === undefined)
        return undefined;

    const id = type.id(change.entityId);

    if (id === undefined) {
        if (providerGroupType !== undefined)
            return undefined;
        throw new POIError(`Change ${index}: invalid ${change.entityType} identification '${change.entityId}'!`);
    }

    const key = `${change.entityType}:${id.key}`;

    // A grid connection point, by its maintainer: added by the maintainer it names or by its grid operator; taken over or
    // handed on by its grid operator, handed on by its maintainer, or reassigned by the roaming network operator.
    if (change.entityType === 'GridConnectionPoint') {

        if (change.kind === 'Add') {

            if (change.parentEntityType !== 'GridOperator' || change.parentEntityId === undefined)
                throw new POIError(`Change ${index}: adding the ${change.entityType} '${change.entityId}' needs its GridOperator as its parent!`);

            const gridOperator  = partyRefOf(content, 'GridOperator', change.parentEntityId);
            const maintainer    = maintainerOf(content, isObject(change.newValue) ? get(change.newValue, 'maintainedBy') : undefined) ?? gridOperator;

            earlier.gridPoints.set(key, { gridOperator, maintainer });

            return partyKeyOf(maintainer) === partyKeyOf(gridOperator)
                       ? [ signer(gridOperator, type.usage) ]
                       : [ signer(maintainer, type.usage), signer(gridOperator, type.usage) ];

        }

        let point = earlier.gridPoints.get(key);

        if (!earlier.gridPoints.has(key)) {
            const found         = embeddedOf(content, type, change.entityId);
            const gridOperator  = found === undefined ? null : notRemoved(earlier, partyRefOf(content, 'GridOperator', asText(found.party['@id'])));
            point = found === undefined || gridOperator === null
                        ? null
                        : { gridOperator, maintainer: maintainerOf(content, get(found.child, 'maintainedBy')) ?? gridOperator };
        }

        if (point === undefined || point === null)
            throw new POIError(`Change ${index}: the ${change.entityType} '${change.entityId}' belongs to no grid operator!`);

        const { gridOperator, maintainer } = point;
        const ofMaintainer = change.kind !== 'Remove' && entityPropertyName(change) === 'maintainedBy';

        if (change.kind === 'Remove')
            earlier.gridPoints.set(key, null);
        else if (change.kind === 'RemoveProperty' && change.propertyName === 'maintainedBy')
            earlier.gridPoints.set(key, { gridOperator, maintainer: gridOperator });
        else if (change.kind === 'UpdateProperty' && change.propertyName === 'maintainedBy') {
            const newMaintainer = maintainerOf(content, change.newValue);
            if (newMaintainer !== undefined)
                earlier.gridPoints.set(key, { gridOperator, maintainer: newMaintainer });
        }

        return ofMaintainer
                   ? [ signer(gridOperator, type.usage), ...(partyKeyOf(maintainer) === partyKeyOf(gridOperator) ? [] : [ signer(maintainer, type.usage, false) ]),
                       { kind: 'rno', keys: 'identity' } ]
                   : [ signer(maintainer, type.usage) ];

    }

    let owner: PartyRef | null | undefined;

    if (change.kind === 'Add') {

        const parentType = change.parentEntityType;

        if (providerGroupType !== undefined) {
            if (parentType === 'EMobilityProvider' && change.parentEntityId !== undefined)
                owner = partyRefOf(content, parentType, change.parentEntityId);
        }
        else if (parentType === undefined || type.owners[parentType] === undefined || change.parentEntityId === undefined) {
            const parents = Object.keys(type.owners).length > 1 ? Object.keys(type.owners).join(' or ') : Object.keys(type.owners).join('');
            throw new POIError(`Change ${index}: adding the ${change.entityType} '${change.entityId}' needs its ${change.entityType === 'ParkingSpace' ? 'ParkingOperator or ChargingStationOperator' : parents} as its parent!`);
        }
        else
            owner = partyRefOf(content, parentType, change.parentEntityId);

        if (owner !== undefined)
            earlier.embedded.set(key, owner);

    }

    else if (earlier.embedded.has(key))
        owner = earlier.embedded.get(key);

    else {
        const found = embeddedOf(content, type, change.entityId);
        if (found !== undefined)
            owner = notRemoved(earlier, partyRefOf(content, found.partyType, asText(found.party['@id'])));
    }

    if (owner === undefined || owner === null) {

        // No provider has it: a group of the charging station operator of its prefix.
        if (providerGroupType !== undefined)
            return undefined;

        throw new POIError(change.entityType === 'ChargingTariffOffer' ? `Change ${index}: the ${change.entityType} '${change.entityId}' belongs to no charging station operator and no e-mobility provider!`
                         : change.entityType === 'ParkingSpace'        ? `Change ${index}: the ${change.entityType} '${change.entityId}' belongs to no parking operator and no charging station operator!`
                         :                                               `Change ${index}: the ${change.entityType} '${change.entityId}' belongs to no parking operator!`);

    }

    if (change.kind === 'Remove')
        earlier.embedded.set(key, null);

    return [ signer(owner, type.usage, type.inPlace) ];

}


function ownerOf(content: JSONObject, change: Change, index: number, earlier: Earlier): Owner | readonly Owner[] {

    // The roaming network operator: its keys and its quorum by its identity keys, the certificates of its signing keys by
    // either kind, everything else by its signing keys.
    if (change.entityType === 'RoamingNetworkOperator')
        return {
            kind:  'rno',
            keys:  entityPropertyName(change) === 'signingKeyCertificates'                                        ? 'signingOrIdentity'
                 : [ 'signingKeys', 'identityKeys', 'minConsensus' ].includes(entityPropertyName(change) ?? '')  ? 'identity'
                 :                                                                                          'signing',
        };

    if (change.entityType === 'RoamingNetwork')
        return { kind: 'rno', keys: 'signing' };

    if (PARTIES.has(change.entityType)) {

        // Removed, nobody owns what it embeds any more.
        if (change.kind === 'Remove')
            removeParty(earlier, partyRefOf(content, change.entityType, change.entityId));

        if (change.kind === 'Add' || change.kind === 'Remove')
            return { kind: 'rno', keys: 'signing' };

        // The number of a conformity assessment body as a notified body and the legislations it is notified for are the
        // roaming network operator's, which vets it, also once the body has keys: no body declares itself notified (S32).
        if (change.entityType === 'ConformityAssessmentBody' && (entityPropertyName(change) === 'notifiedBodyNumber' || entityPropertyName(change) === 'notifiedFor'))
            return { kind: 'rno', keys: 'signing' };

        // As its keys name it: a change may name it in every spelling its identification considers equal.
        const id = asText(partyNamed(content, change.entityType, change.entityId)?.['@id'] ?? change.entityId);

        // Signing keys are rotated by the signing keys they replace or by an identity key, identity keys only by an
        // identity key; everything else of its own by a signing key for the party, but the EV Taler merchant of a charging
        // station operator, also an element of it, by one that may sign 'payments': whoever changes it redirects the
        // payments of every station (`POIKeyUsages.Of`).
        return {
            kind:   'party',
            type:   change.entityType,
            id,
            usage:  change.entityType === 'ChargingStationOperator' && entityPropertyName(change) === 'evTaler' ? KeyUsages.Payments : KeyUsages.Party,
            keys:   entityPropertyName(change) === 'signingKeys'  ? 'signingOrIdentity'
                  : entityPropertyName(change) === 'identityKeys' ? 'identity'
                  :                                          'signing',
        };

    }

    // A model of its manufacturer, which every change of it names, a release of its transparency software manufacturer, a
    // certificate of the conformity assessment body issuing it.
    const childType = PARTY_CHILD_TYPES[change.entityType];

    if (childType !== undefined) {

        let party: JSONObject | undefined;

        if (childType.inParent !== undefined) {
            if (change.parentEntityType !== childType.parentType || change.parentEntityId === undefined)
                throw new POIError(`Change ${index}: the ${change.entityType} '${change.entityId}' needs its ${childType.parentType} as its parent!`);
            party = partyNamed(content, childType.parentType, change.parentEntityId);
        }

        else if (change.kind === 'Add') {
            if (change.parentEntityType !== childType.parentType || change.parentEntityId === undefined)
                throw new POIError(`Change ${index}: adding the ${change.entityType} '${change.entityId}' needs its ${childType.parentType} as its parent!`);
            party = partyNamed(content, childType.parentType, change.parentEntityId);
        }
        else
            party = partyChildOf(content, childType, change.entityId)?.party;

        if (party === undefined)
            throw new POIError(`Change ${index}: the ${change.entityType} '${change.entityId}' is unknown!`);

        return { kind: 'party', type: childType.parentType, id: asText(party['@id']), usage: childType.usage, keys: 'signing' };

    }

    // An energy meter template or group of the charging station operator or grid operator embedding it, or adding it, also
    // by an earlier change of the same change set.
    const energyMeterChild = ENERGY_METER_CHILD_TYPES[change.entityType];

    if (energyMeterChild !== undefined) {

        const key = `${change.entityType}:${change.entityId.toUpperCase()}`;
        let owner: { type: string, id: string } | undefined;

        if (change.kind === 'Add') {
            if ((change.parentEntityType !== 'ChargingStationOperator' && change.parentEntityType !== 'GridOperator') || change.parentEntityId === undefined)
                throw new POIError(`Change ${index}: adding the ${change.entityType} '${change.entityId}' needs its ChargingStationOperator or GridOperator as its parent!`);
            const party = partyNamed(content, change.parentEntityType, change.parentEntityId);
            owner = { type: change.parentEntityType, id: asText(party?.['@id'] ?? change.parentEntityId) };
            earlier.energyMeterChildren.set(key, owner);
        }
        else {
            const found = energyMeterChildOf(content, energyMeterChild, change.entityId);
            owner = earlier.energyMeterChildren.get(key) ?? (found === undefined ? undefined : { type: found.partyType, id: asText(found.party['@id']) });
        }

        if (owner === undefined)
            throw new POIError(`Change ${index}: the ${change.entityType} '${change.entityId}' belongs to no charging station operator and no grid operator!`);

        return { kind: 'party', type: owner.type, id: owner.id, usage: KeyUsages.Infrastructure, keys: 'signing' };

    }

    // An offer, a group of a provider, a grid connection point or parking data.
    const embeddedOwners = embeddedOwnersOf(content, change, index, earlier);

    if (embeddedOwners !== undefined)
        return embeddedOwners;

    if (INFRASTRUCTURE_TYPES.has(change.entityType)) {

        const operator = operatorOf(content, change.entityId);

        if (operator === undefined)
            throw new POIError(`Change ${index}: the charging station operator of the ${change.entityType} '${change.entityId}' does not exist!`);

        return {
            kind:   'party',
            type:   'ChargingStationOperator',
            id:     asText(operator['@id']),
            usage:  TARIFF_TYPES.has(change.entityType) ? KeyUsages.Tariffs : KeyUsages.Infrastructure,
            keys:   'signing',
        };

    }

    throw new POIError(`Change ${index}: changes of ${change.entityType} '${change.entityId}' are not supported by this library yet!`);

}


const isOwnerList = (owned: Owner | readonly Owner[]): owned is readonly Owner[] =>
    Array.isArray(owned);


/** A change as WWCP_POI names it where it needs signatures: its kind, its entity and the property it changes, if any. */
function describeChange(change: Change, index: number): string {
    const property = entityPropertyName(change);
    return `Change ${index}: ${change.kind} of the ${change.entityType} '${change.entityId}'${property === undefined ? '' : ` ('${property}')`}`;
}


/**
 * A party is added with at least one signing and one identity key, a grid operator or a conformity assessment body not
 * taking part with none at all, and without the children it adds on its own; it always keeps at least one of each kind
 * (`TryCheckPartyChange`).
 */
function checkPartyChange(change: Change, index: number): void {

    if (change.entityType !== 'RoamingNetworkOperator' && !PARTIES.has(change.entityType))
        return;

    if (change.kind === 'Add') {

        const party = change.newValue;

        if (!isObject(party))
            return;

        const withoutKeys = (change.entityType === 'GridOperator' || change.entityType === 'ConformityAssessmentBody') &&
                            get(party, 'signingKeys') === undefined && get(party, 'identityKeys') === undefined;

        if (!withoutKeys)
            for (const property of [ 'signingKeys', 'identityKeys' ]) {
                const keys = get(party, property);
                if (!isArray(keys) || keys.length === 0)
                    throw new POIError(`Change ${index}: the ${change.entityType} '${change.entityId}' must be added with its ${property}!`);
            }

        const child = (PARTY_CHILDREN[change.entityType] ?? []).find(property => {
            const children = get(party, property);
            return isArray(children) && children.length > 0;
        });

        if (child !== undefined)
            throw new POIError(`Change ${index}: the ${change.entityType} '${change.entityId}' must be added without its ${child}: they are its own to add!`);

        return;

    }

    const keyProperty = change.propertyName === 'signingKeys' || change.propertyName === 'identityKeys' ||
                       (change.entityType === 'RoamingNetworkOperator' && change.propertyName === 'signingKeyCertificates');

    if (keyProperty && (change.kind === 'RemoveProperty' || (change.kind === 'UpdateProperty' && !(isArray(change.newValue) && change.newValue.length > 0))))
        throw new POIError(`Change ${index}: the ${change.entityType} '${change.entityId}' must keep at least one of its ${change.propertyName}!`);

}


/**
 * Checks the signatures of a change set against the version it is applied to (4.1): every signature valid, by a key of a
 * party of the version valid at `createdAt` or by a new identity key of one of its changes (proof of possession); for every
 * owner of one of its changes a signature by a key that owner names that may sign the usage of what it changes; where the
 * roaming network operator owns a change, signatures of `minConsensus` of its holders.
 */
export function checkOwnership(before: RoamingNetwork, changeSet: ChangeSet): void {

    const createdAt     = changeSet.createdAt;
    const parties       = partiesOf(before);
    const rno           = before.operator;
    const rnoSigning    = rno?.signingKeys ?? [];
    const rnoIdentity   = rno?.identityKeys ?? [];
    const minConsensus  = rno?.minConsensus ?? 1;

    // Who owns what an earlier change of this change set adds or removes.
    const earlier: Earlier = { energyMeterChildren: new Map(), embedded: new Map(), gridPoints: new Map(), removedParties: new Set() };

    // The identity keys its changes enter anew: each must sign it.
    const newIdentityKeys: POIPublicKey[] = [];

    changeSet.changes.forEach((change, index) => {

        let keys: JSONValue | undefined;

        if (PARTIES.has(change.entityType) && change.kind === 'Add' && isObject(change.newValue))
            keys = get(change.newValue, 'identityKeys');

        else if ((PARTIES.has(change.entityType) || change.entityType === 'RoamingNetworkOperator') &&
                 change.kind === 'UpdateProperty' && change.propertyName === 'identityKeys')
            keys = change.newValue;

        if (keys === undefined)
            return;

        const known = change.entityType === 'RoamingNetworkOperator'
                          ? rnoIdentity
                          : parties.get(`${change.entityType}:${change.entityId}`)?.identityKeys ?? [];

        for (const key of POIPublicKey.parseAll(keys, `identity keys of change ${index}`))
            if (!known.some(knownKey => knownKey.id === key.id))
                newIdentityKeys.push(key);

    });

    const allKeys = new Map<string, POIPublicKey>();

    for (const key of [ ...rnoSigning, ...rnoIdentity, ...[ ...parties.values() ].flatMap(party => [ ...party.signingKeys, ...party.identityKeys ]), ...newIdentityKeys ])
        allKeys.set(key.id, key);

    // The keys of the parties of the version, with the party naming them.
    const partyKeys = [
        ...(rno === undefined ? [] : [ ...rnoSigning, ...rnoIdentity ].map(key => ({ party: `RoamingNetworkOperator '${rno.id}'`, key }))),
        ...[ ...parties.values() ].flatMap(party => [ ...party.signingKeys, ...party.identityKeys ].map(key => ({ party: `${party.type} '${party.id}'`, key }))),
    ];

    // Every signature valid, by a known key, a key of a party valid at createdAt (`TryGetSigners`): also one besides the
    // signatures of the owners. A new identity key proves its possession only, also one valid only later.
    const valid = new Set<string>();

    changeSet.signatures.forEach((signature, index) => {

        const key = allKeys.get(signature.keyId);

        if (key === undefined)
            throw new POIError(`Signature ${index} is by the key '${signature.keyId}', which is no key of a party of this roaming network!`);

        for (const partyKey of partyKeys.filter(item => item.key.id === signature.keyId))
            if (!partyKey.key.isValidAt(createdAt))
                throw new POIError(`Signature ${index}: the key '${partyKey.key.id}' of the ${partyKey.party} is not valid at ${toTimestamp(createdAt)}!`);

        try {
            changeSet.verifySignature(signature, key);
        }
        catch (e) {
            throw new POIError(`Signature ${index} ('${signature.keyId}') is invalid: ${e instanceof Error ? e.message : String(e)}`);
        }

        valid.add(signature.keyId);

    });

    // Proof of possession.
    for (const key of newIdentityKeys)
        if (!valid.has(key.id))
            throw new POIError(`The new identity key '${key.id}' did not sign the change set: no proof of possession!`);

    const signedValid = (key: POIPublicKey): boolean =>
        valid.has(key.id) && key.isValidAt(createdAt);

    // The holders of the roaming network operator signing with keys of the kinds named, its signing keys only those that may
    // sign what it owns, `party`, or one of the usages given.
    const rnoHolders = (keys: OwnerKeys, ...usages: KeyUsage[]): Set<string> =>
        new Set([ ...(keys !== 'identity' ? rnoSigning.filter(key => [ KeyUsages.Party, ...usages ].some(usage => key.maySign(usage))) : []),
                  ...(keys !== 'signing'  ? rnoIdentity                                                                             : []) ]
                    .filter(signedValid)
                    .map(key => key.holderOrUnnamed));

    // Whether an owner signed: by as many holders of its keys of the kinds named as its quorum needs.
    const signs = (owner: Owner): boolean => {

        if (owner.kind === 'rno')
            return rno !== undefined && rnoHolders(owner.keys).size >= minConsensus;

        const party = parties.get(`${owner.type}:${owner.id}`);

        return party !== undefined &&
              ((owner.keys !== 'identity' && party.signingKeys.some(key => key.maySign(owner.usage) && signedValid(key))) ||
               (owner.keys !== 'signing'  && party.identityKeys.some(signedValid)) ||
               (owner.keys !== 'signing'  && rnoHolders('identity').size >= minConsensus && rnoIdentity.some(signedValid)) ||
               (owner.keys === 'signing'  && owner.inPlace !== false && party.signingKeys.length === 0 && rnoHolders('signing', owner.usage).size >= minConsensus));

    };

    // The signature an owner gives, in words.
    const signatureOf = (owner: Owner): string =>
        owner.kind === 'rno'        ? `${owner.keys === 'identity' ? 'an identity key' : 'a signing key'} of the roaming network operator '${rno?.id ?? ''}'`
      : owner.keys === 'identity'   ? `an identity key of the ${owner.type} '${owner.id}'`
      :                               `a signing key of the ${owner.type} '${owner.id}'`;

    changeSet.changes.forEach((change, index) => {

        checkPartyChange(change, index);

        const owned  = ownerOf(before.content, change, index, earlier);
        const owners = isOwnerList(owned) ? owned : [ owned ];

        // One of several owners signs it, e.g. of a grid connection point its grid operator or its maintainer.
        if (owners.length > 1) {
            if (!owners.some(signs))
                throw new POIError(`${describeChange(change, index)} needs a signature by ${owners.map(signatureOf).join(' or ')}!`);
            return;
        }

        const owner = required(owners[0], `Change ${index} has no owner!`);

        if (owner.kind === 'rno') {

            if (rno === undefined)
                throw new POIError(`${describeChange(change, index)}: the roaming network has no roaming network operator!`);

            const kind = owner.keys === 'identity' ? 'identity keys' : owner.keys === 'signing' ? 'signing keys' : 'signing or identity keys';

            if (rnoHolders(owner.keys).size < minConsensus)
                throw new POIError(minConsensus > 1
                                       ? `${describeChange(change, index)} needs signatures by ${kind} of ${minConsensus} holders of the roaming network operator '${rno.id}'!`
                                       : `${describeChange(change, index)} needs a signature by one of the ${kind} of the roaming network operator '${rno.id}'!`);

            return;

        }

        const party = parties.get(`${owner.type}:${owner.id}`);

        if (party === undefined)
            throw new POIError(`${describeChange(change, index)}: the ${owner.type} '${owner.id}' does not exist!`);

        // A party without signing keys is changed by the roaming network operator in its place (`SignerOf`), by signing
        // keys that may sign `party`, as all it owns, or the usage of the change; identity keys of the roaming network
        // operator recover both kinds of keys of every party, and nothing else of it.
        const bySigningKey   = owner.keys !== 'identity'  && party.signingKeys.some(key => key.maySign(owner.usage) && signedValid(key));
        const byIdentityKey  = owner.keys !== 'signing'   && party.identityKeys.some(signedValid);
        const byRecovery     = owner.keys !== 'signing'   && rnoHolders('identity').size >= minConsensus && rnoIdentity.some(signedValid);
        const byRNO          = owner.keys === 'signing'   && owner.inPlace !== false && party.signingKeys.length === 0 && rnoHolders('signing', owner.usage).size >= minConsensus;

        if (!bySigningKey && !byIdentityKey && !byRecovery && !byRNO) {

            const mayAnyway = party.signingKeys.some(signedValid);

            throw new POIError(owner.keys === 'identity'
                                   ? `${describeChange(change, index)} needs a signature by an identity key of the ${owner.type} '${owner.id}'!`
                                   : mayAnyway
                                         ? `${describeChange(change, index)} needs a signature by a signing key of the ${owner.type} '${owner.id}' that may sign '${owner.usage}'!`
                                         : `${describeChange(change, index)} needs a signature by a signing key of the ${owner.type} '${owner.id}'!`);

        }

    });

}


/** Checks given ETags against those of a version: each the one of its format and algorithm (`MatchETags`). */
function matchETags(given: readonly ETag[], version: RoamingNetwork, what: string): void {

    for (const eTag of given) {

        const expected = eTag.format === 'json'          ? jsonETag(version.content, eTag.algorithm)
                       : eTag.format === 'cbor'          ? cborETag(version.content, eTag.algorithm)
                       :                                   version.effectiveTreeETag(eTag.algorithm);

        if (!sameETag(eTag, expected))
            throw new POIError(`${what}: the ${eTag.format} ETag (${eTag.algorithm}) is ${etagToText(expected)}, not ${etagToText(eTag)}!`);

    }

    if (!given.some(eTag => eTag.format === 'json') || !given.some(eTag => eTag.format === 'cbor'))
        throw new POIError(`${what}: a change set names the json and the cbor ETags!`);

}


/**
 * Applies a change set to the version it fits (4, 5.2): its owners signed it (unless `checkOwnership` is false), its
 * `beforeETags` are those of the version, its changes apply, and the result has its `afterETags`. Returns the new version.
 */
/**
 * The stamp of a change set applied to the given version (SPECIFICATION.md 4, S5): its createdAt, or the lastChange of the
 * roaming network of the version, where that is later; in milliseconds since 1970.
 */
export function stampOf(before: RoamingNetwork, changeSet: ChangeSet): number {
    const lastChange = get(before.content, 'lastChange');
    const last       = typeof lastChange === 'string' ? timestampOf(lastChange) : undefined;
    return last !== undefined && last > changeSet.createdAt ? last : changeSet.createdAt;
}

export function applyChangeSet(before: RoamingNetwork, changeSet: ChangeSet, options: { checkOwnership?: boolean } = {}): RoamingNetwork {

    if (changeSet.roamingNetworkId !== before.id)
        throw new POIError(`The change set is for the roaming network '${changeSet.roamingNetworkId}', not for '${before.id}'!`);

    if (options.checkOwnership ?? true)
        checkOwnership(before, changeSet);

    matchETags(changeSet.beforeETags, before, 'The change set does not fit this version of the roaming network');

    // Its preconditions hold in the version it is applied to (4): the entities they name have the ETags they name.
    const broken = brokenPrecondition(before.content, changeSet.preconditions);

    if (broken !== undefined)
        throw new POIError(`The change set does not fit this version of the roaming network: ${broken}`);

    const content    = clone(before.content);

    // What the change set is stamped with, as lastChange and as the created of what it adds: its createdAt, or the
    // lastChange of the version it is applied to, where it was created before it. So no lastChange goes back, whatever time
    // its signer chose (SPECIFICATION.md 4, POI3-ISSUES.md S5, WWCP_POI 12e993a); its keys are checked at its createdAt still.
    const createdAt  = toTimestamp(stampOf(before, changeSet));

    changeSet.changes.forEach((change, index) => {

        if (change.entityType === 'RoamingNetwork' && change.entityId === before.id)
            applyNetworkChange(content, change, index, createdAt);

        else if (change.entityType === 'RoamingNetworkOperator')
            applyOperatorChange(content, change, index, createdAt);

        else if (NETWORK_ARRAYS[change.entityType] !== undefined)
            applyNetworkArrayChange(content, change, index, createdAt);

        else if (PARTY_CHILD_TYPES[change.entityType] !== undefined)
            applyPartyChildChange(content, change, index, createdAt);

        else if (ENERGY_METER_CHILD_TYPES[change.entityType] !== undefined)
            applyEnergyMeterChildChange(content, change, index, createdAt);

        else if (embeddedTypeOf(content, change) !== undefined)
            applyEmbeddedChange(content, change, index, createdAt, required(embeddedTypeOf(content, change), change.entityType));

        else if (INFRASTRUCTURE_TYPES.has(change.entityType))
            applyInfrastructureChange(content, change, index, createdAt);

        else
            throw new POIError(`Change ${index}: changes of ${change.entityType} '${change.entityId}' are not supported by this library yet!`);

    });

    // After its last change, bare, as WWCP_POI3 checks the groups, offers and payment options of every charging station
    // operator there (RoamingNetwork.ChangeSets.cs), in the ordinal order of their identifications: a charging station moved
    // to another charging pool was no member of its operator in between, and a change set may add the EV Taler merchant and
    // the payment option EVTaler in either order.
    const groupOrOffer = objectsOf(get(content, 'chargingStationOperators')).
                             sort((left, right) => ordinal(asText(left['@id']), asText(right['@id']))).
                             map(operator => invalidGroupOrOffer(operator) ?? invalidPaymentOption(operator)).
                             find(error => error !== undefined);

    if (groupOrOffer !== undefined)
        throw new POIError(groupOrOffer);

    checkStatedBy(before, content, changeSet);

    const changedVersion = changedReleaseVersion(before.content, content);

    if (changedVersion !== undefined)
        throw new POIError(changedVersion);

    // A change set sets the lastChange of the roaming network always, to its stamp (4).
    content['lastChange'] = createdAt;

    const after = RoamingNetwork.afterChangeSet(content, before.content);

    matchETags(changeSet.afterETags, after, 'The result does not match the change set');

    checkKeyHolders(before, after);

    return after;

}


/**
 * The error, when a release of the version before has another version after the change set, also removed and added again
 * (4.1, `ChangedTransparencySoftwareVersion`): a new version is a new release, so that a certificate naming a release names
 * the version that was assessed. Releases and versions compare as WWCP_POI compares them, without case, versions trimmed.
 */
function changedReleaseVersion(before: JSONObject, after: JSONObject): string | undefined {

    const releasesOf = (content: JSONObject): JSONObject[] =>
        objectsOf(get(content, 'transparencySoftwareManufacturers')).flatMap(manufacturer => objectsOf(get(manufacturer, 'transparencySoftware')));

    const versionOf  = (release: JSONObject): string => trimmed(asText(get(release, 'version') ?? ''));
    const versions   = new Map(releasesOf(before).map(release => [ ignoringCase(asText(release['@id'])), versionOf(release) ]));

    for (const release of releasesOf(after)) {

        const was = versions.get(ignoringCase(asText(release['@id'])));
        const is  = versionOf(release);

        if (was !== undefined && ignoringCase(was) !== ignoringCase(is))
            return `The version of the transparency software release '${asText(release['@id'])}' can not be changed from '${was}' to '${is}': a new version is a new release!`;

    }

    return undefined;

}


/**
 * Who states a certificate the change set adds or changes (4.1, `CertificateStatedByError`): the roaming network operator,
 * signing it in place of a conformity assessment body without signing keys in the version before, names itself as its
 * `statedBy`, `roamingNetworkOperator`; a body signing it itself, with its keys, names none. So a reader of a proof tells
 * them apart also once the body has keys (csharp-review 15).
 */
function checkStatedBy(before: RoamingNetwork, content: JSONObject, changeSet: ChangeSet): void {

    const type     = required(PARTY_CHILD_TYPES['ConformityCertificate'], 'Certificates are children of their bodies!');
    const keyless  = objectsOf(get(before.content, type.parents))
                         .filter(body => objectsOf(get(body, 'signingKeys')).length === 0)
                         .map(body => asText(body['@id']));

    for (const change of changeSet.changes) {

        const found = change.entityType === 'ConformityCertificate' && change.kind !== 'Remove' ? partyChildOf(content, type, change.entityId) : undefined;

        if (found === undefined)
            continue;

        const certificateId  = asText(found.child['@id']);
        const bodyId         = asText(found.party['@id']);
        const statedBy       = get(found.child, 'statedBy');

        if (statedBy !== undefined && statedBy !== 'roamingNetworkOperator')
            throw new POIError(`The certificate '${certificateId}' is stated by its conformity assessment body, or by the roaming network operator in its place, 'roamingNetworkOperator', not by '${asText(statedBy)}'!`);

        const byOperator     = keyless.some(id => sameId(id, bodyId));

        if (byOperator !== (statedBy !== undefined))
            throw new POIError(byOperator
                                   ? `The certificate '${certificateId}' of the conformity assessment body '${bodyId}' without signing keys is stated by the roaming network operator in its place: its statedBy is 'roamingNetworkOperator'!`
                                   : `The certificate '${certificateId}' of the conformity assessment body '${bodyId}' is stated by the body itself, with its keys: it names no statedBy!`);

    }

}


/**
 * A key keeps its holder (4.1): a version naming a key of a party with another holder than the version before, or with one
 * where that named none or none where that named one, is refused, as the C# implementation refuses it. So no holder counts
 * twice in a quorum by naming a key of its own as another's.
 */
function checkKeyHolders(before: RoamingNetwork, after: RoamingNetwork): void {

    const keysOf = (network: RoamingNetwork): Map<string, { party: string, key: POIPublicKey }> => {

        const keys = new Map<string, { party: string, key: POIPublicKey }>();

        const add = (type: string, id: string, partyKeys: readonly POIPublicKey[]): void => {
            for (const key of partyKeys)
                keys.set(`${type}:${id}:${key.id}`, { party: `${type} '${id}'`, key });
        };

        if (network.operator !== undefined)
            add('RoamingNetworkOperator', network.operator.id, [ ...network.operator.identityKeys, ...network.operator.signingKeyCertificates.map(certificate => certificate.signingKey) ]);

        for (const party of partiesOf(network).values())
            add(party.type, party.id, [ ...party.identityKeys, ...party.signingKeys ]);

        return keys;

    };

    const holders = keysOf(before);

    for (const [where, { party, key }] of keysOf(after)) {

        const previous = holders.get(where);

        if (previous !== undefined && previous.key.holder !== key.holder)
            throw new POIError(`The key '${key.id}' of the ${party} keeps its holder ${previous.key.holder === undefined ? 'none' : `'${previous.key.holder}'`}, not ${key.holder === undefined ? 'none' : `'${key.holder}'`}!`);

    }

}
