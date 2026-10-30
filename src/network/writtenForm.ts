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

import { canonicalJSON, ordinal } from '../json/canonical.ts';
import { asText, isArray, isObject, type JSONArray, type JSONObject, type JSONValue } from '../json/value.ts';
import { LANGUAGES }  from '../qidigital/json.ts';
import { hermodURL }  from './evTaler.ts';
import { trimmed }    from './versionTexts.ts';


// The written form of the content (SPECIFICATION.md 2, Written forms): a value as WWCP_POI writes it again once it has read
// it, which is how the content holds it. A change set gives its new values so (section 4, "New values"), as WWCP_POI checks
// by reading and writing them again (TryHeldAsGiven); a version so (Achim's decision of 2026-10-29, as D13 decided it for
// keys), as WWCP_POI3 checks it since 3de830a by writing the version again and walking both (RoamingNetwork.WrittenForm.cs,
// FirstNotWritten): written again, it would be another text than the one hashed. This library has no writer of every
// entity; it tells the written form of what it knows of, in the order and the words of that walk: of an object, the
// languages of a text in languages, then its properties as given, in their order - an embedded JSON-LD context, a property
// without a value, a list without elements WWCP_POI leaves out, a property the content leaves out, a value it holds
// otherwise -, then what the content holds that it leaves out; of a list, its texts trimmed, its order, then its elements;
// timestamps UTC to the millisecond. Custom data is held as given.


const idOf = (value: JSONValue | undefined): string =>
    isObject(value) && typeof value['@id'] === 'string' ? value['@id'] : '';

/**
 * The lists of identifications and of predefined values the content holds in the ordinal order of their texts, each once,
 * each trimmed as its type writes it (`POIJSON.OrderedIds` of the C# implementation).
 */
const ORDERED_TEXTS = new Set([
    'facilities', 'paymentOptions', 'uiFeatures', 'features', 'parkingRestrictions', 'services', 'standards', 'nutsCodes',
    'vehicleTypes', 'euVehicleCategories', 'parkingSpaceIds', 'certificateIds', 'chargingTariffIds', 'acceptedEMobilityProviderIds',
    'paymentMeans', 'paymentBrands', 'signatureMethods', 'connectorTypes', 'EVSEIds', 'chargingStationIds', 'chargingPoolIds',
    'energyMeterIds', 'EVSEGroupIds', 'chargingStationGroupIds', 'chargingPoolGroupIds', 'chargingStationOperatorIds',
    'eMobilityProviderIds', 'parkingSensorIds', 'parkingProductIds', 'measurands', 'notifiedFor',
    'verifiedTransparencySoftwareIds', 'compatibleTransparencySoftwareIds', 'cardTypes', 'dimensions', 'usages',
]);

/**
 * The lists WWCP_POI writes only where they have an element (the ToJSON of its entities): given empty, they are none. Not
 * among them, as WWCP_POI writes them also empty: the hardware revisions, firmware versions and releases of a certificate,
 * the elements of a price, the exchanges of an EV Taler merchant and the identity keys of a key statement.
 */
const LEFT_OUT_WHEN_EMPTY = new Set([
    'acceptedEMobilityProviderIds', 'authenticationModes', 'brands', 'cardTypes', 'certificateIds', 'certificates',
    'chargingConnectors', 'chargingPoolGroupIds', 'chargingPoolGroups', 'chargingPoolIds', 'chargingPoolTemplates',
    'chargingPools', 'chargingStationGroupIds', 'chargingStationGroups', 'chargingStationIds', 'chargingStationManufacturers',
    'chargingStationModels', 'chargingStationOperatorIds', 'chargingStationOperators', 'chargingStationTemplates',
    'chargingStations', 'chargingTariffGroups', 'chargingTariffIds', 'chargingTariffOffers', 'chargingTariffTemplates',
    'chargingTariffs', 'conditions', 'conformityAssessmentBodies', 'connectorTypes', 'daysOfWeek', 'dimensions',
    'eMobilityProviderIds', 'eMobilityProviders', 'euVehicleCategories', 'EVSEGroupIds', 'EVSEGroups', 'EVSEIds',
    'EVSETemplates', 'EVSEs', 'energyMeterGroups', 'energyMeterIds', 'energyMeterManufacturers', 'energyMeterModels',
    'energyMeterTemplates', 'energyMeters', 'facilities', 'features', 'gridConnectionPoints', 'gridOperators', 'identityKeys', 'images',
    'locationLanguages', 'marketLocationIds', 'measurands', 'meteringLocationIds', 'models', 'notifiedFor', 'nutsCodes',
    'parkingGarages', 'parkingOperators', 'parkingProductIds', 'parkingProducts', 'parkingRestrictions', 'parkingSensorIds',
    'parkingSensors', 'parkingSpaceGroups', 'parkingSpaceIds', 'parkingSpaceTemplates', 'parkingSpaces', 'paymentBrands',
    'paymentMeans', 'paymentOptions', 'publicKeys', 'relatedLocations', 'services', 'signatureMethods', 'signingKeys',
    'standards', 'templateIds', 'transparencySoftware', 'transparencySoftwareManufacturers', 'transparencySoftwareStatus',
    'uiFeatures', 'usages', 'vehicleTypes',
]);

/**
 * The texts in languages of the content, as Styx reads them (`ImmutableI18NString.TryParse`): every text of a language,
 * written in any case, also by its number, the rest left out without a word; and as it writes them, each language by its
 * name in lower case, and none at all without a language.
 */
const TEXTS_IN_LANGUAGES = new Set([ 'name', 'description', 'comment', 'assistanceServiceDetails', 'arrivalInstructions', 'additionalInformation' ]);

/**
 * The lists WWCP_POI writes also empty, of an object in the list holding it: given without them, it writes them empty. The
 * releases of a certificate, the URLs of an open source license.
 */
const WRITTEN_ALSO_EMPTY: Readonly<Record<string, readonly string[]>> = {
    certificates:        [ 'verifiedTransparencySoftwareIds', 'compatibleTransparencySoftwareIds' ],
    openSourceLicenses:  [ 'URLs' ],
};

/**
 * The parties WWCP_POI names of its own making where they name none, by the list of the content holding them, e.g.
 * "Charging Station Manufacturer 'GraphDefined'": not grid and parking operators, which it writes without a name.
 */
const PARTY_NAMES: Readonly<Record<string, string>> = {
    chargingStationOperators:           'Charging Station Operator',
    eMobilityProviders:                 'E-Mobility Provider',
    chargingStationManufacturers:       'Charging Station Manufacturer',
    energyMeterManufacturers:           'Energy Meter Manufacturer',
    transparencySoftwareManufacturers:  'Transparency Software Manufacturer',
    conformityAssessmentBodies:         'Conformity Assessment Body',
};

/**
 * The properties of the objects of the content this library knows all of, by the property or list holding them: its
 * entities, a key, a key statement and its signatures, a certificate of a signing key, an EV Taler merchant and its
 * exchanges. A property besides WWCP_POI does not read: the content leaves it out.
 */
const KEY_PROPERTIES = [ '@id', '@context', 'key', 'notBefore', 'notAfter', 'holder', 'usages' ];

/**
 * The properties of the entities of the content, by the property or list holding them, the roaming network by none: what
 * their types in WWCP_POI3 write (ToJSON) and read (PropertyKeys), drawn from it at 3de830a and checked against every
 * version it wrote. A property besides it leaves out as it writes the entity again.
 */
const ENTITY_PROPERTIES: Readonly<Record<string, readonly string[]>> = {
    '':                                 [ '@context', '@id', 'chargingStationManufacturerIds',
                                          'chargingStationManufacturers', 'chargingStationOperatorIds',
                                          'chargingStationOperators', 'conformityAssessmentBodies',
                                          'conformityAssessmentBodyIds', 'created', 'customData', 'dataLicenseIds',
                                          'dataLicenses', 'dataSource', 'description', 'eMobilityProviderIds',
                                          'eMobilityProviders', 'eTags', 'energyMeterManufacturerIds',
                                          'energyMeterManufacturers', 'gridOperatorIds', 'gridOperators', 'lastChange',
                                          'name', 'operator', 'parkingOperatorIds', 'parkingOperators',
                                          'transparencySoftwareManufacturerIds', 'transparencySoftwareManufacturers',
                                          'treeHashAlgorithms' ],
    'operator':                         [ '@context', '@id', 'address', 'created', 'customData', 'dataSource',
                                          'description', 'eMailAddress', 'homepage', 'hotline', 'hotlineEMailAddress',
                                          'identityKeys', 'keyStatement', 'lastChange', 'minConsensus', 'name',
                                          'signingKeyCertificates' ],
    'chargingStationOperators':         [ '@context', '@id', 'EVSEGroupIds', 'EVSEGroups', 'EVSETemplateIds',
                                          'EVSETemplates', 'address', 'brandIds', 'brands', 'chargingPoolGroupIds',
                                          'chargingPoolGroups', 'chargingPoolIds', 'chargingPoolTemplateIds',
                                          'chargingPoolTemplates', 'chargingPools', 'chargingStationGroupIds',
                                          'chargingStationGroups', 'chargingStationTemplateIds',
                                          'chargingStationTemplates', 'chargingTariffGroupIds', 'chargingTariffGroups',
                                          'chargingTariffIds', 'chargingTariffOfferIds', 'chargingTariffOffers',
                                          'chargingTariffTemplateIds', 'chargingTariffTemplates', 'chargingTariffs',
                                          'created', 'customData', 'dataLicenseIds', 'dataLicenses', 'dataSource',
                                          'description', 'eMailAddress', 'energyMeterGroupIds', 'energyMeterGroups',
                                          'energyMeterTemplateIds', 'energyMeterTemplates', 'evTaler', 'exception',
                                          'geoLocation', 'homepage', 'hotline', 'identityKeys', 'lastChange', 'logos',
                                          'name', 'parkingSpaceIds', 'parkingSpaces', 'signingKeys', 'stackTrace',
                                          'telephone', 'termsAndConditions', 'uri' ],
    'eMobilityProviders':               [ '@context', '@id', 'EVSEGroupIds', 'EVSEGroups', 'address',
                                          'chargingPoolGroupIds', 'chargingPoolGroups', 'chargingStationGroupIds',
                                          'chargingStationGroups', 'chargingTariffOfferIds', 'chargingTariffOffers',
                                          'created', 'customData', 'dataLicenses', 'dataSource', 'description',
                                          'eMailAddress', 'geoLocation', 'homepage', 'hotline', 'identityKeys',
                                          'lastChange', 'logos', 'name', 'signingKeys', 'telephone', 'termsAndConditions',
                                          'uri' ],
    'gridOperators':                    [ '@context', '@id', 'address', 'created', 'customData', 'dataSource',
                                          'description', 'energyMeterGroupIds', 'energyMeterGroups',
                                          'energyMeterTemplateIds', 'energyMeterTemplates', 'gridConnectionPointIds',
                                          'gridConnectionPoints', 'homepage', 'hotline', 'identityKeys', 'lastChange',
                                          'name', 'signingKeys' ],
    'parkingOperators':                 [ '@context', '@id', 'address', 'created', 'customData', 'dataSource',
                                          'description', 'homepage', 'hotline', 'identityKeys', 'lastChange', 'name',
                                          'parkingGarageIds', 'parkingGarages', 'parkingProductIds', 'parkingProducts',
                                          'parkingSensorIds', 'parkingSensors', 'parkingSpaceGroupIds',
                                          'parkingSpaceGroups', 'parkingSpaceIds', 'parkingSpaceTemplateIds',
                                          'parkingSpaceTemplates', 'parkingSpaces', 'signingKeys' ],
    'chargingStationManufacturers':     [ '@context', '@id', 'address', 'chargingStationModelIds', 'chargingStationModels',
                                          'created', 'customData', 'dataLicenses', 'dataSource', 'description',
                                          'eMailAddress', 'geoLocation', 'homepage', 'hotline', 'identityKeys',
                                          'lastChange', 'logos', 'name', 'signingKeys', 'telephone', 'termsAndConditions',
                                          'uri' ],
    'energyMeterManufacturers':         [ '@context', '@id', 'address', 'created', 'customData', 'dataLicenses',
                                          'dataSource', 'description', 'eMailAddress', 'energyMeterModelIds',
                                          'energyMeterModels', 'geoLocation', 'homepage', 'hotline', 'identityKeys',
                                          'lastChange', 'logos', 'name', 'signingKeys', 'telephone', 'termsAndConditions',
                                          'uri' ],
    'transparencySoftwareManufacturers':[ '@context', '@id', 'address', 'craRole', 'created', 'customData', 'dataLicenses',
                                          'dataSource', 'description', 'eMailAddress', 'geoLocation', 'homepage',
                                          'hotline', 'identityKeys', 'lastChange', 'logos', 'name', 'securityAdvisories',
                                          'signingKeys', 'telephone', 'termsAndConditions', 'transparencySoftware',
                                          'transparencySoftwareIds', 'uri', 'vulnerabilityContact',
                                          'vulnerabilityDisclosurePolicy', 'vulnerabilityReporting' ],
    'conformityAssessmentBodies':       [ '@context', '@id', 'address', 'certificateIds', 'certificates', 'created',
                                          'customData', 'dataLicenses', 'dataSource', 'description', 'eMailAddress',
                                          'geoLocation', 'homepage', 'hotline', 'identityKeys', 'lastChange', 'logos',
                                          'name', 'notifiedBodyNumber', 'notifiedFor', 'signingKeys', 'telephone',
                                          'termsAndConditions', 'uri' ],
    'chargingTariffs':                  [ '@context', '@id', 'created', 'currency', 'customData', 'dataSource',
                                          'description', 'elements', 'energyMix', 'lastChange', 'maxPrice', 'minPrice',
                                          'name', 'paymentBrands', 'paymentMeans', 'tariffType', 'tariffURL',
                                          'templateIds', 'validFrom', 'validUntil' ],
    'chargingTariffTemplates':          [ '@context', '@id', 'created', 'currency', 'customData', 'dataSource',
                                          'description', 'elements', 'energyMix', 'lastChange', 'maxPrice', 'minPrice',
                                          'name', 'paymentBrands', 'paymentMeans', 'tariffType', 'tariffURL', 'validFrom',
                                          'validUntil' ],
    'chargingTariffGroups':             [ '@context', '@id', 'chargingTariffIds', 'created', 'customData', 'dataSource',
                                          'description', 'lastChange', 'name' ],
    'chargingTariffOffers':             [ '@context', '@id', 'EVSEGroupIds', 'chargingPoolGroupIds',
                                          'chargingStationGroupIds', 'chargingStationOperatorIds', 'chargingTariff',
                                          'created', 'customData', 'dataSource', 'description', 'discount',
                                          'eMobilityProviderIds', 'lastChange', 'maxSessionsPerContract', 'name',
                                          'notAfter', 'notBefore', 'openingTimes', 'sessions' ],
    'elements':                         [ '@context', 'priceComponents', 'restrictions' ],
    'chargingPools':                    [ '@context', '@id', 'accessibility', 'address', 'arrivalInstructions',
                                          'assistanceServiceDetails', 'authenticationModes', 'brandIds', 'brands',
                                          'chargingStationIds', 'chargingStations', 'chargingWhenClosed', 'created',
                                          'customData', 'dataLicenses', 'dataSource', 'description', 'energyMeterIds',
                                          'energyMeters', 'energyMix', 'entranceAddress', 'entranceLocation',
                                          'exitAddress', 'exitLocation', 'facilities', 'features', 'geoLocation',
                                          'gridConnectionPoint', 'gridConnectionPointId', 'hotline', 'images',
                                          'lastChange', 'locationLanguages', 'name', 'nutsCodes', 'openingTimes',
                                          'parkingRestrictions', 'parkingType', 'paymentOptions', 'relatedLocations',
                                          'services', 'standards', 'templateIds', 'timeZone', 'uiFeatures' ],
    'chargingPoolTemplates':            [ '@context', '@id', 'accessibility', 'address', 'arrivalInstructions',
                                          'assistanceServiceDetails', 'authenticationModes', 'brandIds', 'brands',
                                          'chargingTariffId', 'chargingWhenClosed', 'created', 'customData',
                                          'dataLicenseIds', 'dataLicenses', 'dataSource', 'description', 'energyMix',
                                          'entranceAddress', 'entranceLocation', 'exitAddress', 'exitLocation',
                                          'facilities', 'features', 'geoLocation', 'gridConnectionPointId', 'hotline',
                                          'images', 'lastChange', 'locationLanguages', 'name', 'nutsCodes', 'openingTimes',
                                          'parkingRestrictions', 'parkingType', 'paymentOptions', 'relatedLocations',
                                          'services', 'standards', 'timeZone', 'uiFeatures' ],
    'chargingPoolGroups':               [ '@context', '@id', 'chargingPoolIds', 'created', 'customData', 'dataSource',
                                          'description', 'lastChange', 'name' ],
    'chargingStations':                 [ '@context', '@id', 'EVSEIds', 'EVSEs', 'accessibility', 'address', 'brandIds',
                                          'brands', 'calibrationInfo', 'certificateIds', 'certificationInfo', 'created',
                                          'customData', 'dataSource', 'description', 'energyMeterIds', 'energyMeters',
                                          'euVehicleCategories', 'features', 'firmwareVersion', 'geoLocation',
                                          'hardwareRevision', 'hotline', 'images', 'lastChange', 'manufacturerId',
                                          'maxPower', 'modelId', 'modelURL', 'name', 'openingTimes', 'parkingSpaceIds',
                                          'physicalReference', 'publicKeys', 'serialNumber', 'signatureMethods',
                                          'templateIds', 'transparencySoftwareStatus', 'vehicleTypes' ],
    'chargingStationTemplates':         [ '@context', '@id', 'accessibility', 'address', 'brandIds', 'brands',
                                          'calibrationInfo', 'certificateIds', 'certificationInfo', 'chargingTariffId',
                                          'created', 'customData', 'dataSource', 'description', 'euVehicleCategories',
                                          'features', 'firmwareVersion', 'geoLocation', 'hardwareRevision', 'hotline',
                                          'images', 'lastChange', 'manufacturerId', 'maxPower', 'modelId', 'modelURL',
                                          'name', 'openingTimes', 'parkingSpaceIds', 'physicalReference',
                                          'signatureMethods', 'transparencySoftwareStatus', 'vehicleTypes' ],
    'chargingStationGroups':            [ '@context', '@id', 'chargingStationIds', 'created', 'customData', 'dataSource',
                                          'description', 'lastChange', 'name' ],
    'EVSEs':                            [ '@context', '@id', 'acceptedEMobilityProviderIds', 'brandIds', 'brands',
                                          'chargingConnectorIds', 'chargingConnectors', 'chargingModes',
                                          'chargingTariffIds', 'created', 'currentTypes', 'customData', 'dataSource',
                                          'description', 'energyMeter', 'extendedOperationTimeout', 'floorLevel',
                                          'geoLocation', 'images', 'iso15118Certificate', 'lastChange', 'maxCurrent',
                                          'maxPower', 'maxReservationDuration', 'maxVoltage', 'name', 'operationTimeout',
                                          'physicalReference', 'reachDistance', 'standards', 'templateIds' ],
    'EVSETemplates':                    [ '@context', '@id', 'acceptedEMobilityProviderIds', 'brandIds', 'brands',
                                          'chargingConnectorIds', 'chargingConnectors', 'chargingModes',
                                          'chargingTariffId', 'created', 'currentTypes', 'customData', 'dataSource',
                                          'description', 'extendedOperationTimeout', 'floorLevel', 'geoLocation', 'images',
                                          'lastChange', 'maxCurrent', 'maxPower', 'maxReservationDuration', 'maxVoltage',
                                          'name', 'operationTimeout', 'physicalReference', 'reachDistance', 'standards' ],
    'EVSEGroups':                       [ '@context', '@id', 'EVSEIds', 'created', 'customData', 'dataSource',
                                          'description', 'lastChange', 'name' ],
    'chargingConnectors':               [ '@context', '@id', 'cableLength', 'cableManagementSystem', 'cableWeight',
                                          'chargingTariffIds', 'currentTypes', 'format', 'images', 'lockable',
                                          'maxCurrent', 'maxPower', 'maxVoltage', 'standards', 'type' ],
    'energyMeter':                      [ '@context', '@id', 'certificateIds', 'created', 'customData', 'dataSource',
                                          'description', 'firmwareVersion', 'hardwareRevision', 'lastChange',
                                          'manufacturerId', 'modelId', 'modelURL', 'name', 'publicKeys', 'role',
                                          'serialNumber', 'signatureMethods', 'templateIds', 'transparencySoftwareStatus' ],
    'energyMeterTemplates':             [ '@context', '@id', 'certificateIds', 'created', 'customData', 'dataSource',
                                          'description', 'firmwareVersion', 'hardwareRevision', 'lastChange',
                                          'manufacturerId', 'modelId', 'modelURL', 'name', 'role', 'signatureMethods',
                                          'transparencySoftwareStatus' ],
    'energyMeterGroups':                [ '@context', '@id', 'created', 'customData', 'dataSource', 'description',
                                          'energyMeterIds', 'lastChange', 'name' ],
    'transparencySoftwareStatus':       [ '@context', 'certificateId', 'legalStatus', 'transparencySoftwareId' ],
    'gridConnectionPoints':             [ '@context', '@id', 'address', 'connectionAgreementId', 'connectionType',
                                          'contractedExportApparentPower', 'contractedExportPower',
                                          'contractedImportApparentPower', 'contractedImportPower', 'customData',
                                          'description', 'energyMeter', 'geoLocation', 'gridOperator', 'gridOperatorId',
                                          'maintainedBy', 'marketLocationIds', 'meteringLocationIds', 'name',
                                          'networkLocationId', 'nominalFrequency', 'nominalVoltage', 'voltageLevel' ],
    'chargingStationModels':            [ '@context', '@id', 'connectorTypes', 'currentTypes', 'customData',
                                          'datasheetURL', 'description', 'firmwareVersions', 'hardwareRevisions', 'images',
                                          'manufacturerId', 'maxPower', 'name', 'numberOfEVSEs', 'productURL' ],
    'energyMeterModels':                [ '@context', '@id', 'accuracyClass', 'currentTypes', 'customData', 'datasheetURL',
                                          'description', 'firmwareVersions', 'hardwareRevisions', 'images',
                                          'manufacturerId', 'maxCurrent', 'measurands', 'name', 'productURL',
                                          'signatureMethods' ],
};

export const PROPERTIES_OF: Readonly<Record<string, readonly string[]>> = {
    ...ENTITY_PROPERTIES,
    geoLocation:             [ '@context', 'lat', 'lng', 'alt', 'projection' ],
    priceComponents:         [ '@context', 'type', 'price', 'stepSize', 'vat' ],
    publicKeys:              [ '@context', '@id', 'key', 'certificateChain' ],
    signingKeys:             KEY_PROPERTIES,
    identityKeys:            KEY_PROPERTIES,
    signingKey:              KEY_PROPERTIES,
    keyStatement:            [ '@context', 'roamingNetworkId', 'roamingNetworkOperatorId', 'identityKeys', 'minConsensus', 'signedAt', 'validUntil', 'signatures' ],
    signatures:              [ 'algorithm', 'keyId', 'value' ],
    signingKeyCertificates:  [ '@context', 'roamingNetworkOperatorId', 'signingKey', 'signedAt', 'algorithm', 'keyId', 'value' ],
    evTaler:                 [ '@context', 'merchantBaseURL', 'merchantPublicKey', 'exchanges' ],
    exchanges:               [ '@context', 'masterPublicKey', 'baseURL', 'currency', 'name' ],
};

/**
 * The texts WWCP_POI reads by their types, which write them trimmed: identifications and references, currencies,
 * versions, an e-mail address, the URLs of a release and a certificate (refused without a scheme).
 */
const TRIMMED = new Set([
    '@id', 'currency', 'chargingTariffId', 'manufacturerId', 'modelId', 'transparencySoftwareId', 'version', 'vulnerabilityContact',
    'energyMeterManufacturerId', 'energyMeterModel', 'roamingNetworkId', 'roamingNetworkOperatorId', 'sourceCodeRepository',
    'declarationOfConformity', 'softwareBillOfMaterials', 'documentURL',
]);

/** The URLs WWCP_POI reads as Hermod does (`URL.TryParse`): trimmed, with the scheme https unless they name one. */
const URLS = new Set([ 'homepage', 'datasheetURL', 'vulnerabilityReporting', 'vulnerabilityDisclosurePolicy', 'securityAdvisories', 'merchantBaseURL', 'baseURL' ]);

/** Values WWCP_POI reads by their names in any case and writes as it names them. */
const NAMED_VALUES: Readonly<Record<string, readonly string[]>> = {
    role:              [ 'battery', 'evse', 'grid', 'gridConnectionPoint', 'pool', 'pv', 'station', 'wind' ],
    legalStatus:       [ 'forInformationOnly', 'germanCalibrationLaw', 'verified' ],
    signatureMethods:  [ 'AlfenCrypt01', 'AlfenCrypt03', 'ChargePointCrypt01', 'EDL40', 'EMHCrypt01', 'MennekesCrypt01', 'OCMF', 'PCDF' ],
};

/**
 * What a transparency software release and its open source licenses name, as TransparencySoftware of WWCP_POI2 reads them:
 * another property it refuses (StrictJSON.OnlyProperties).
 */
const RELEASE_PROPERTIES  = [ '@context', '@id', 'name', 'version', 'openSourceLicenses', 'sourceCodeRepository', 'supportUntil', 'declarationOfConformity',
                              'softwareBillOfMaterials', 'howToUse', 'moreInformation', 'logo' ];
const LICENSE_PROPERTIES  = [ '@context', '@id', 'description', 'URLs' ];

/** The data licenses WWCP_POI knows by their identifications alone, which a version names completely (`dataLicenses`). */
const KNOWN_DATA_LICENSES = new Set([ 'None', 'PDDL', 'ODC-By', 'ODbL', 'dl-de/by-2-0', 'dl-de/zero-2-0', 'GeoLizenz_V1.3', 'CC BY 4.0', 'CC BY-SA 4.0',
                                      'CC BY-ND 4.0', 'CC BY-NC 4.0', 'CC BY-NC-SA 4.0', 'CC BY-NC-ND 4.0' ]);

/** The days of a week as the content holds them: Monday first. */
const DAYS_OF_WEEK = [ 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY' ];

/** The timestamps of the content: UTC to the millisecond (section 2). */
const TIMESTAMP_PROPERTIES = new Set([ 'created', 'lastChange', 'validFrom', 'validUntil', 'notBefore', 'notAfter', 'signedAt', 'supportUntil' ]);
const TIMESTAMP            = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The keys the content orders the given array by, if it orders it: identified elements by their identification, the
 * certificates of signing keys by their keys, authentication modes by their type, the transparency software status of an
 * energy meter or a charging station by its release, the exchanges of an EV Taler merchant by their master public keys,
 * the lists of ORDERED_TEXTS by their texts, the days of a week Monday first.
 */
function orderKeys(items: JSONArray, property: string | undefined): string[] | undefined {

    if (property === 'signingKeyCertificates' && items.every(isObject))
        return items.map(item => `${idOf(isObject(item) ? item['signingKey'] : undefined)}\u0000${isObject(item) ? asText(item['keyId']) : ''}`);

    if (property === 'authenticationModes' && items.every(isObject))
        return items.map(item => isObject(item) ? asText(item['type']) : '');

    if (property === 'transparencySoftwareStatus' && items.every(isObject))
        return items.map(item => isObject(item) ? asText(item['transparencySoftwareId']) : '');

    if (property === 'exchanges' && items.every(isObject))
        return items.map(item => isObject(item) ? asText(item['masterPublicKey']) : '');

    if (property === 'daysOfWeek')
        return items.map(item => String(DAYS_OF_WEEK.indexOf(typeof item === 'string' ? item : '')).padStart(2, '0'));

    if (items.length > 0 && items.every(item => isObject(item) && typeof item['@id'] === 'string'))
        return items.map(idOf);

    if (property !== undefined && ORDERED_TEXTS.has(property) && items.every(item => typeof item === 'string'))
        return items.map(item => typeof item === 'string' ? item : '');

    return undefined;

}

/**
 * The languages of a text in languages as Styx writes them, of those it reads: in lower case; by its number one of its
 * languages, by its name then (here unequal to the number); another number as given.
 */
const languagesOf = (text: JSONObject): string[] =>
    [ ...new Set(Object.entries(text).
                     filter(([ , value ]) => typeof value === 'string').
                     map(([ language ]) => LANGUAGES.has(language.toLowerCase())                      ? language.toLowerCase()
                                         : /^\d+$/u.test(language) && Number(language) < LANGUAGES.size  ? `(language ${language})`
                                         : /^[+-]?\d+$/u.test(language)                                 ? language
                                         :                                                                 undefined).
                     filter(language => language !== undefined)) ];

/**
 * The value WWCP_POI writes of the given one of the given property, of an object held by the given property or list,
 * where this library tells it; undefined where it writes it as given or this library does not tell how.
 */
function writtenValueOf(property: string, value: JSONValue, holder: string | undefined): JSONValue | undefined {

    // An identification given as a number, the type of a charging connector, are read as their texts.
    if ((property === '@id' || (property === 'type' && holder === 'chargingConnectors')) && (typeof value === 'number' || typeof value === 'boolean'))
        return String(value);

    if (typeof value === 'string') {

        if (property === '@id' && holder === 'chargingStationOperators')
            return trimmed(value).toUpperCase();

        if (TRIMMED.has(property) || (property === 'type' && holder === 'chargingConnectors'))
            return trimmed(value);

        if (URLS.has(property))
            return hermodURL(value)?.text;

        const names = NAMED_VALUES[property];
        if (names !== undefined)
            return names.find(name => name.toLowerCase() === trimmed(value).toLowerCase()) ?? trimmed(value);

    }

    // A coordinate as the double WWCP_POI holds it: without trailing zeros, nor a decimal point of an integer.
    if (holder === 'geoLocation' && (property === 'lat' || property === 'lng') && (typeof value === 'number' || typeof value === 'object') && value !== null && !isArray(value)) {
        const number = Number(canonicalJSON(value));
        return Number.isFinite(number) ? number : undefined;
    }

    return undefined;

}

/** A value as its canonical JSON, as WWCP_POI names it in a message (`POIJSON.ContentText`); a coordinate as its double. */
const contentText = (value: JSONValue): string =>
    typeof value === 'number' && !Number.isSafeInteger(value) ? String(value) : canonicalJSON(value);


/**
 * The given value as WWCP_POI reads it, of an object of the given kind (`PROPERTIES_OF`): without the properties it does
 * not read, of the objects within it as well.
 */
export function asRead(value: JSONValue, kind: string): JSONValue {

    if (isArray(value))
        return value.map(element => asRead(element, kind));

    if (!isObject(value))
        return value;

    const known = PROPERTIES_OF[kind];

    return Object.fromEntries(Object.entries(value).
                                  filter(([ key ]) => known === undefined || known.includes(key)).
                                  map(([ key, element ]) => [ key, PROPERTIES_OF[key] === undefined ? element : asRead(element, key) ]));

}


/** Where a value is not written as the content holds it, e.g. "chargingPools[1].paymentOptions", and how it is held. */
export interface NotWritten {
    readonly path:    string;
    readonly reason:  string;
}

/**
 * Where the given value of the given property, at the given path, is not written as the content holds it; undefined where
 * it is. A new value names each element of an ordered list once, and leaves out the lastChange the change set gives it; a
 * version leaves an element given twice to what refuses it in the words of WWCP_POI.
 */
export function notWritten(value: JSONValue, property: string | undefined, path: string, of: 'version' | 'new value'): NotWritten | undefined {

    const eachOnce  = of === 'new value';
    const join      = (at: string, key: string): string => at === '' ? key : `${at}.${key}`;
    const holdsAs   = (at: string, written: JSONValue): NotWritten => ({ path: at, reason: `the content holds it as '${contentText(written)}'` });

    /** Whether WWCP_POI leaves the given property of an object out, of a kind holding it, as it writes the object again. */
    const leftOut = (key: string, element: JSONValue, kind: string | undefined, keepsEmptyName: boolean): string | undefined => {

        if (element === null)
            return 'a property without a value is left out';

        if (isArray(element) && element.length === 0 && LEFT_OUT_WHEN_EMPTY.has(key) && !(key === 'identityKeys' && kind === 'keyStatement'))
            return 'a list without elements is left out';

        if (TEXTS_IN_LANGUAGES.has(key) && isObject(element) && languagesOf(element).length === 0 && !(key === 'name' && keepsEmptyName))
            return 'the content leaves it out';

        if (key === 'dataLicenseIds')
            return 'the content leaves it out';

        const known = kind === undefined ? undefined : PROPERTIES_OF[kind];

        if (known !== undefined && !known.includes(key))
            return 'the content leaves it out';

        return undefined;

    };

    const check = (item: JSONValue, name: string | undefined, holder: string | undefined, at: string, root = false): NotWritten | undefined => {

        if (name === 'customData')
            return undefined;

        if (isArray(item)) {

            if (name !== undefined && ORDERED_TEXTS.has(name) && item.some(element => typeof element === 'string' && trimmed(element) !== element))
                return { path: at, reason: 'the texts of its elements are trimmed' };

            const keys = orderKeys(item, name);

            if (keys?.some((key, index) => index > 0 && ordinal(keys[index - 1] ?? '', key) >= (eachOnce ? 0 : 1)) === true)
                return { path: at, reason: eachOnce ? 'its elements are in the order the content holds them in, each once'
                                                    : 'its elements are in the order the content holds them in' };

            for (const [ index, element ] of item.entries()) {

                const elementAt = `${at}[${String(index)}]`;

                if (typeof element === 'string' && name !== undefined && NAMED_VALUES[name] !== undefined) {
                    const written = writtenValueOf(name, element, holder);
                    if (written !== undefined && written !== element)
                        return holdsAs(elementAt, written);
                }

                const found = check(element, undefined, name, elementAt);
                if (found !== undefined)
                    return found;

            }

            return undefined;

        }

        if (isObject(item)) {

            const kind            = root ? '' : name ?? holder;
            const party           = name === undefined && holder !== undefined ? PARTY_NAMES[holder] : undefined;
            const keepsEmptyName  = name === undefined && holder === 'chargingStationOperators';

            // The languages of a text in languages, as Styx writes them.
            if (name !== undefined && TEXTS_IN_LANGUAGES.has(name) &&
                [ ...Object.keys(item) ].sort(ordinal).join('\u0000') !== languagesOf(item).sort(ordinal).join('\u0000'))
                return { path: at, reason: 'a text in languages names each language as Styx writes it, in lower case, with a text' };

            // What it gives, in the order it gives it.
            for (const [ key, element ] of Object.entries(item)) {

                if (key === '@context') {
                    if (root)
                        continue;
                    return { path: at, reason: 'embedded, an object names no JSON-LD context' };
                }

                const elementAt = join(at, key);
                const omitted   = leftOut(key, element, kind, keepsEmptyName);

                if (omitted !== undefined)
                    return { path: elementAt, reason: omitted };

                if (typeof element === 'string' && TIMESTAMP_PROPERTIES.has(key) && !TIMESTAMP.test(element))
                    return { path: elementAt, reason: 'a timestamp is UTC to the millisecond, yyyy-MM-ddTHH:mm:ss.fffZ' };

                const written = key === 'customData' ? undefined : writtenValueOf(key, element, kind);

                if (written !== undefined && contentText(written) !== contentText(element))
                    return holdsAs(elementAt, written);

                const found = check(element, key, kind, elementAt);
                if (found !== undefined)
                    return found;

            }

            // What the content holds of it that it leaves out: the name WWCP_POI makes up of a party, a list it writes also
            // empty, the lastChange of a version, which it writes as its created.
            if (party !== undefined && !('name' in item))
                return holdsAs(join(at, 'name'), { en: `${party} '${asText(writtenValueOf('@id', item['@id'] ?? '', holder) ?? item['@id'])}'` });

            for (const list of name === undefined && holder !== undefined ? WRITTEN_ALSO_EMPTY[holder] ?? [] : [])
                if (!(list in item))
                    return holdsAs(join(at, list), []);

            if (!eachOnce && typeof item['created'] === 'string' && !('lastChange' in item))
                return holdsAs(join(at, 'lastChange'), item['created']);

        }

        return undefined;

    };

    // A new value of a property, which the content holds as none: left out, not given so.
    const omitted = property === undefined ? undefined : leftOut(property, value, undefined, false);

    if (omitted !== undefined)
        return { path, reason: omitted };

    return check(value, property, undefined, path, of === 'version' && property === undefined);

}

/**
 * The error, as WWCP_POI3 words it since 3de830a, when the given content of a version is not written as the content holds
 * it, its own JSON-LD context aside; undefined where it is.
 */
export function notWrittenAsHeld(content: JSONObject): string | undefined {

    // Of a data license named by its identification alone, which WWCP_POI does not know, as it refuses it as it reads it.
    const unknownLicense = (value: JSONValue): string | undefined => {
        if (isArray(value))
            return value.map(unknownLicense).find(found => found !== undefined);
        if (!isObject(value))
            return undefined;
        for (const [ key, element ] of Object.entries(value)) {
            if (key === 'customData')
                continue;
            const unknown = key === 'dataLicenseIds' && isArray(element) ? element.find(id => typeof id === 'string' && !KNOWN_DATA_LICENSES.has(id)) : undefined;
            if (unknown !== undefined)
                return `The data license '${asText(unknown)}' is not well-known, so it must be given completely!`;
            const found = unknownLicense(element);
            if (found !== undefined)
                return found;
        }
        return undefined;
    };

    const license = unknownLicense(content);

    if (license !== undefined)
        return license;

    // Of a release or its license, a property it does not read, as it refuses it as it reads it.
    for (const manufacturer of isArray(content['transparencySoftwareManufacturers']) ? content['transparencySoftwareManufacturers'].filter(isObject) : [])
        for (const release of isArray(manufacturer['transparencySoftware']) ? manufacturer['transparencySoftware'].filter(isObject) : []) {
            const unknown = Object.keys(release).find(property => !RELEASE_PROPERTIES.includes(property));
            if (unknown !== undefined)
                return `TransparencySoftware: Unknown property '${unknown}'.`;
            for (const [ index, license ] of (isArray(release['openSourceLicenses']) ? release['openSourceLicenses'] : []).entries()) {
                const unknownOfLicense = isObject(license) ? Object.keys(license).find(property => !LICENSE_PROPERTIES.includes(property)) : undefined;
                if (unknownOfLicense !== undefined)
                    return `TransparencySoftware: openSourceLicenses[${String(index)}]: Unknown property '${unknownOfLicense}'.`;
            }
        }

    const found = notWritten(content, undefined, '', 'version');

    return found === undefined ? undefined : `'${found.path}' is not written as the content holds it: ${found.reason}!`;

}
