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

import { get, type JSONObject } from '../json/value.ts';
import { Decimal }              from '../json/decimal.ts';
import type { RoamingNetwork }  from '../network/roamingNetwork.ts';
import { POIError }             from '../errors.ts';
import {
    hasWhitespace, i18nJSON, idOf, isBlank, isNegative, negated, numberJSON, only, optionalDecimal, optionalEnum,
    optionalI18N, optionalIds, optionalString, optionalStrings, optionalText, requiredText, sameId, sameText, sum, textOf,
    versionOf, type I18NText,
} from './json.ts';
import { chargingStationIdOf, chargingStationIdText, effectiveChargingStationOf, effectiveEnergyMeterOf, manufacturerOf } from './network.ts';
import { isText } from '../network/versionTexts.ts';


// The parts of QI-Digital documents as WWCP_POI reads and writes them (QIDigitalQuantity, QIDigitalParts, QIDigitalModel,
// QIDigitalManufacturer, QIDigitalItem): each refused in the words of WWCP_POI, its constructor's checks after its
// properties were read, and written again as WWCP_POI writes it.


/** Whether a measured value conforms to its tolerance limits, as a PTB DCC states it (dcc:conformity). */
export const QI_DIGITAL_CONFORMITIES = [ 'Pass', 'Fail', 'ConditionalPass', 'ConditionalFail', 'NoPass', 'NoFail' ] as const;
export type QIDigitalConformity = typeof QI_DIGITAL_CONFORMITIES[number];


/**
 * A quantity of a QI-Digital document: a value in a unit with its expanded uncertainty, as a PTB DCC gives it in the D-SI
 * format, named by the DCC refType of what it is, with its tolerance limits and its conformity.
 */
export class QIDigitalQuantity {

    private constructor(
        /** Its value, without trailing zeros. */
        public readonly value:                Decimal,
        /** Its unit, as D-SI writes it, e.g. \percent. */
        public readonly unit:                 string,
        public readonly refType:              string | undefined,
        public readonly name:                 I18NText | undefined,
        public readonly expandedUncertainty:  Decimal | undefined,
        public readonly coverageFactor:       Decimal | undefined,
        public readonly coverageProbability:  Decimal | undefined,
        public readonly toleranceLower:       Decimal | undefined,
        public readonly toleranceUpper:       Decimal | undefined,
        public readonly conformity:           QIDigitalConformity | undefined
    ) {}

    public static parse(json: JSONObject): QIDigitalQuantity {

        only(json, 'a quantity', 'refType', 'name', 'value', 'unit', 'expandedUncertainty', 'coverageFactor', 'coverageProbability', 'toleranceLower', 'toleranceUpper', 'conformity');

        const value                = optionalDecimal(json, 'value',                'value of a quantity');
        const expandedUncertainty  = optionalDecimal(json, 'expandedUncertainty',  'expanded uncertainty');
        const coverageFactor       = optionalDecimal(json, 'coverageFactor',       'coverage factor');
        const coverageProbability  = optionalDecimal(json, 'coverageProbability',  'coverage probability');
        const toleranceLower       = optionalDecimal(json, 'toleranceLower',       'lower tolerance limit');
        const toleranceUpper       = optionalDecimal(json, 'toleranceUpper',       'upper tolerance limit');
        const refType              = optionalString (json, 'refType',              'refType');
        const name                 = optionalI18N   (json, 'name',                 'name of a quantity');
        const conformity           = optionalEnum   (json, 'conformity',           'conformity', QI_DIGITAL_CONFORMITIES);
        const unit                 = textOf(json, 'unit');

        if (value === undefined || unit === undefined)
            throw new POIError('A quantity requires a value and a unit!');

        if (!isText(unit))
            throw new POIError('The unit of a quantity must neither be empty nor begin or end with whitespace!');

        if (refType !== undefined && (isBlank(refType) || hasWhitespace(refType)))
            throw new POIError('The refType of a quantity must not be empty nor contain whitespace!');

        if (expandedUncertainty !== undefined && isNegative(expandedUncertainty))
            throw new POIError('The expanded uncertainty of a quantity must not be negative!');

        if ((coverageFactor !== undefined || coverageProbability !== undefined) && expandedUncertainty === undefined)
            throw new POIError('A coverage factor or probability is one of an expanded uncertainty!');

        if (coverageFactor !== undefined && coverageFactor.compareTo(ZERO) <= 0)
            throw new POIError('The coverage factor of a quantity must be positive!');

        if (coverageProbability !== undefined && (coverageProbability.compareTo(ZERO) <= 0 || coverageProbability.compareTo(ONE) > 0))
            throw new POIError('The coverage probability of a quantity must be greater than 0 and at most 1!');

        if (toleranceLower !== undefined && toleranceUpper !== undefined && toleranceLower.compareTo(toleranceUpper) > 0)
            throw new POIError('The lower tolerance limit of a quantity must not exceed its upper one!');

        return new QIDigitalQuantity(value, unit, refType, name, expandedUncertainty, coverageFactor, coverageProbability, toleranceLower, toleranceUpper, conformity);

    }

    /** Whether its value is within its tolerance limits, its expanded uncertainty included; undefined without limits. */
    public get isWithinTolerance(): boolean | undefined {

        if (this.toleranceLower === undefined && this.toleranceUpper === undefined)
            return undefined;

        const uncertainty = this.expandedUncertainty ?? ZERO;

        return (this.toleranceLower === undefined || sum(this.value, negated(uncertainty)).compareTo(this.toleranceLower) >= 0) &&
               (this.toleranceUpper === undefined || sum(this.value, uncertainty).compareTo(this.toleranceUpper) <= 0);

    }

    public toJSON(): JSONObject {

        const json: JSONObject = {};

        if (this.refType !== undefined)
            json['refType']              = this.refType;
        if (this.name !== undefined)
            json['name']                 = i18nJSON(this.name);
        json['value']                    = numberJSON(this.value);
        json['unit']                     = this.unit;
        if (this.expandedUncertainty !== undefined)
            json['expandedUncertainty']  = numberJSON(this.expandedUncertainty);
        if (this.coverageFactor !== undefined)
            json['coverageFactor']       = numberJSON(this.coverageFactor);
        if (this.coverageProbability !== undefined)
            json['coverageProbability']  = numberJSON(this.coverageProbability);
        if (this.toleranceLower !== undefined)
            json['toleranceLower']       = numberJSON(this.toleranceLower);
        if (this.toleranceUpper !== undefined)
            json['toleranceUpper']       = numberJSON(this.toleranceUpper);
        if (this.conformity !== undefined)
            json['conformity']           = this.conformity;

        return json;

    }

}

const ZERO  = new Decimal(0n, 0);
const ONE   = new Decimal(1n, 0);


/** A standard or another technical specification a QI-Digital document names, e.g. "EN 50470-3:2022" (`QIDigitalStandard`). */
export class QIDigitalStandard {

    private constructor(
        public readonly reference:  string,
        public readonly title:      I18NText | undefined
    ) {}

    public static parse(json: JSONObject): QIDigitalStandard {

        only(json, 'a standard', 'reference', 'title');

        const title     = optionalI18N(json, 'title', 'title of a standard');
        const reference = textOf(json, 'reference');

        if (reference === undefined)
            throw new POIError('A standard requires its reference!');

        if (!isText(reference))
            throw new POIError('The reference of a standard must neither be empty nor begin or end with whitespace!');

        return new QIDigitalStandard(reference, title);

    }

    public toJSON(): JSONObject {
        const json: JSONObject = { reference: this.reference };
        if (this.title !== undefined)
            json['title'] = i18nJSON(this.title);
        return json;
    }

}


/** A legislation of the European Union a document is issued under, by its name, e.g. MID, and its act (`QIDigitalLegislation`). */
export class QIDigitalLegislation {

    private constructor(
        public readonly name:  string,
        public readonly act:   string | undefined
    ) {}

    public static parse(json: JSONObject): QIDigitalLegislation {

        only(json, 'a legislation', 'name', 'act');

        const act   = optionalString(json, 'act', 'act of a legislation');
        const name  = textOf(json, 'name');

        if (name === undefined)
            throw new POIError('A legislation requires its name!');

        if (!isText(name))
            throw new POIError('The name of a legislation must neither be empty nor begin or end with whitespace!');

        return new QIDigitalLegislation(name, act);

    }

    public toJSON(): JSONObject {
        const json: JSONObject = { name: this.name };
        if (this.act !== undefined)
            json['act'] = this.act;
        return json;
    }

}


/** A person responsible for a document, or signing it for its manufacturer, with the function as its role (`QIDigitalPerson`). */
export class QIDigitalPerson {

    private constructor(
        public readonly name:        string,
        public readonly role:        string | undefined,
        public readonly mainSigner:  boolean
    ) {}

    public static parse(json: JSONObject): QIDigitalPerson {

        only(json, 'a person', 'name', 'role', 'mainSigner');

        const role        = optionalString(json, 'role', 'role of a person');
        const name        = textOf(json, 'name');
        const mainSigner  = get(json, 'mainSigner');

        if (name === undefined)
            throw new POIError('A person requires a name!');

        if (mainSigner !== undefined && typeof mainSigner !== 'boolean')
            throw new POIError('Whether a person is the main signer must be true or false!');

        if (!isText(name))
            throw new POIError('The name of a person must neither be empty nor begin or end with whitespace!');

        return new QIDigitalPerson(name, role, mainSigner === true);

    }

    public toJSON(): JSONObject {
        const json: JSONObject = { name: this.name };
        if (this.role !== undefined)
            json['role'] = this.role;
        if (this.mainSigner)
            json['mainSigner'] = true;
        return json;
    }

}


// The models, manufacturers and items documents are for.


export type QIDigitalModelType = 'ChargingStationModel' | 'EnergyMeterModel';
export type QIDigitalManufacturerType = 'ChargingStationManufacturer' | 'EnergyMeterManufacturer';
export type QIDigitalItemType = 'ChargingStation' | 'EnergyMeter';

const kindOfModel = (type: QIDigitalModelType | QIDigitalManufacturerType | QIDigitalItemType): 'charging station' | 'energy meter' =>
    type.startsWith('ChargingStation') ? 'charging station' : 'energy meter';

/** A hardware revision of a model, of an item, or none: as WWCP_POI writes a missing one in a message, as nothing. */
const shown = (version: string | undefined): string =>
    version ?? '';

/** The given versions of the given model, none twice (`ModelVersions.Of`). */
function versionsOf(versions: readonly string[], kind: string, model: string): string[] {
    if (new Set(versions).size !== versions.length)
        throw new POIError(`A ${kind} of ${model} must not be given twice!`);
    return [ ...versions ];
}


/**
 * The model a declaration or a certificate of conformity is for: a charging station model or an energy meter model, by
 * its manufacturer and its identification, in the hardware revisions and firmware versions it covers (`QIDigitalModel`).
 */
export class QIDigitalModel {

    private constructor(
        public readonly type:               QIDigitalModelType,
        public readonly manufacturerId:     string,
        public readonly modelId:            string,
        public readonly hardwareRevisions:  readonly string[],
        public readonly firmwareVersions:   readonly string[]
    ) {}

    public static parse(json: JSONObject): QIDigitalModel {

        only(json, 'a model', 'type', 'manufacturerId', 'modelId', 'hardwareRevisions', 'firmwareVersions');

        const hardwareRevisions  = optionalIds(json, 'hardwareRevisions', 'hardware revision', versionOf);
        const firmwareVersions   = optionalIds(json, 'firmwareVersions',  'firmware version',  versionOf);
        const type               = textOf(json, 'type');

        if (type !== 'ChargingStationModel' && type !== 'EnergyMeterModel')
            throw new POIError("The type of a model must be 'ChargingStationModel' or 'EnergyMeterModel'!");

        const kind               = kindOfModel(type);
        const manufacturerId     = requiredText(json, 'manufacturerId', `${kind} manufacturer identification`, idOf);
        const modelId            = requiredText(json, 'modelId',        `${kind} model identification`,        idOf);
        const model              = `the ${kind} model '${modelId}'`;
        const hardware           = versionsOf(hardwareRevisions, 'hardware revision', model);
        const firmware           = versionsOf(firmwareVersions,  'firmware version',  model);

        if (hardware.length === 0)
            throw new POIError(`A document of conformity of ${model} names at least one hardware revision of it!`);

        if (firmware.length === 0)
            throw new POIError(`A document of conformity of ${model} names at least one firmware version of it!`);

        return new QIDigitalModel(type, manufacturerId, modelId, hardware, firmware);

    }

    /** Whether it covers the given hardware revision and firmware version of its model. */
    public covers(hardwareRevision: string, firmwareVersion: string): boolean {
        return this.hardwareRevisions.includes(hardwareRevision) && this.firmwareVersions.includes(firmwareVersion);
    }

    /** Refuses a charging station or energy meter it does not cover: one of its model, in one of its revisions and versions (`TryCover`). */
    public cover(item: QIDigitalItem): void {

        const itemType: QIDigitalItemType = this.type === 'ChargingStationModel' ? 'ChargingStation' : 'EnergyMeter';

        if (item.type !== itemType)
            throw new POIError(`The ${item.text} is no ${kindOfModel(itemType)}!`);

        if (!sameId(item.manufacturerId, this.manufacturerId) || !sameId(item.modelId, this.modelId))
            throw new POIError(`The ${item.text} is no '${this.modelId}' of '${this.manufacturerId}'!`);

        if (item.hardwareRevision === undefined || !this.hardwareRevisions.includes(item.hardwareRevision))
            throw new POIError(`The hardware revision '${shown(item.hardwareRevision)}' of the ${item.text} is none the model '${this.modelId}' is covered in!`);

        if (item.firmwareVersion === undefined || !this.firmwareVersions.includes(item.firmwareVersion))
            throw new POIError(`The firmware version '${shown(item.firmwareVersion)}' of the ${item.text} is none the model '${this.modelId}' is covered in!`);

    }

    /**
     * Refuses it unless its manufacturer is one of the roaming network, its model one of its manufacturer, and each of its
     * hardware revisions and firmware versions one of its model (`TryVerify`).
     */
    public verify(network: RoamingNetwork): void {

        const kind          = kindOfModel(this.type);
        const manufacturer  = manufacturerOf(network, this.type === 'ChargingStationModel' ? 'chargingStation' : 'energyMeter', this.manufacturerId);

        if (manufacturer === undefined)
            throw new POIError(`The ${kind} manufacturer '${this.manufacturerId}' is none of the roaming network '${network.id}'!`);

        const model = manufacturer.models.find(item => sameId(item.id, this.modelId));

        if (model === undefined)
            throw new POIError(`The ${kind} model '${this.modelId}' is none of '${this.manufacturerId}'!`);

        for (const hardwareRevision of this.hardwareRevisions)
            if (!model.hardwareRevisions.includes(hardwareRevision))
                throw new POIError(`The hardware revision '${hardwareRevision}' is none of the model '${this.modelId}' of '${this.manufacturerId}'!`);

        for (const firmwareVersion of this.firmwareVersions)
            if (!model.firmwareVersions.includes(firmwareVersion))
                throw new POIError(`The firmware version '${firmwareVersion}' is none of the model '${this.modelId}' of '${this.manufacturerId}'!`);

    }

    public toJSON(): JSONObject {
        return {
            type:               this.type,
            manufacturerId:     this.manufacturerId,
            modelId:            this.modelId,
            hardwareRevisions:  [ ...this.hardwareRevisions ],
            firmwareVersions:   [ ...this.firmwareVersions ],
        };
    }

}


/**
 * The manufacturer a certificate of conformity approves the quality system of, by its identification, with the scope of
 * its quality system, the categories of products it makes under it, e.g. MI-003 (`QIDigitalManufacturer`).
 */
export class QIDigitalManufacturer {

    /** Well-known categories of a scope, each of the kind of products it is for; any other names a kind not known here. */
    public static readonly CATEGORIES: Readonly<Record<string, QIDigitalItemType>> = { 'MI-003': 'EnergyMeter' };

    private constructor(
        public readonly type:            QIDigitalManufacturerType,
        public readonly manufacturerId:  string,
        public readonly scope:           readonly string[]
    ) {}

    /** Itself in words, e.g. "the energy meter manufacturer 'SAALE'". */
    public get text(): string {
        return `the ${kindOfModel(this.type)} manufacturer '${this.manufacturerId}'`;
    }

    public static parse(json: JSONObject): QIDigitalManufacturer {

        only(json, 'a manufacturer', 'type', 'manufacturerId', 'scope');

        const scope = optionalStrings(json, 'scope', 'scope of a manufacturer');
        const type  = textOf(json, 'type');

        if (type !== 'ChargingStationManufacturer' && type !== 'EnergyMeterManufacturer')
            throw new POIError("The type of a manufacturer must be 'ChargingStationManufacturer' or 'EnergyMeterManufacturer'!");

        const kind            = kindOfModel(type);
        const manufacturerId  = requiredText(json, 'manufacturerId', `${kind} manufacturer identification`, idOf);
        const text            = `the ${kind} manufacturer '${manufacturerId}'`;

        if (scope.length === 0)
            throw new POIError(`A certificate of the quality system of ${text} names at least one category of its scope!`);

        if (scope.some(category => !isText(category)))
            throw new POIError(`A category of the scope of ${text} must neither be empty nor begin or end with whitespace!`);

        if (new Set(scope).size !== scope.length)
            throw new POIError(`A category of the scope of ${text} must not be given twice!`);

        return new QIDigitalManufacturer(type, manufacturerId, scope);

    }

    /** Whether its scope takes the given kind of products: a scope of well-known categories only the kinds they are for. */
    public inScope(itemType: QIDigitalItemType): boolean {
        return this.scope.some(category => {
            const kind = QIDigitalManufacturer.CATEGORIES[category];
            return kind === undefined || kind === itemType;
        });
    }

    /** Whether the given model is one of it, of the kind it is a manufacturer of. */
    public makes(model: QIDigitalModel): boolean {
        return model.type === (this.type === 'ChargingStationManufacturer' ? 'ChargingStationModel' : 'EnergyMeterModel') &&
               sameId(model.manufacturerId, this.manufacturerId);
    }

    /** Refuses a charging station or energy meter its quality system does not cover: one of it, of a kind in its scope (`TryCover`). */
    public cover(item: QIDigitalItem): void {

        const itemType: QIDigitalItemType = this.type === 'ChargingStationManufacturer' ? 'ChargingStation' : 'EnergyMeter';

        if (item.type !== itemType)
            throw new POIError(`The ${item.text} is no ${kindOfModel(itemType)}!`);

        if (!sameId(item.manufacturerId, this.manufacturerId))
            throw new POIError(`The ${item.text} is none of '${this.manufacturerId}'!`);

        if (!this.inScope(itemType))
            throw new POIError(`The ${item.text} is of no category of the scope ${this.scope.join(', ')} of the quality system of ${this.text}!`);

    }

    /** Refuses it unless it is a manufacturer of the roaming network, of the kind it names (`TryVerify`). */
    public verify(network: RoamingNetwork): void {
        if (manufacturerOf(network, this.type === 'ChargingStationManufacturer' ? 'chargingStation' : 'energyMeter', this.manufacturerId) === undefined)
            throw new POIError(`The ${kindOfModel(this.type)} manufacturer '${this.manufacturerId}' is none of the roaming network '${network.id}'!`);
    }

    public toJSON(): JSONObject {
        return { type: this.type, manufacturerId: this.manufacturerId, scope: [ ...this.scope ] };
    }

}


/**
 * The single charging station or energy meter a digital calibration certificate is for: by its identification in the
 * roaming network, and as it was calibrated, its manufacturer, model, serial number, hardware revision and firmware
 * version (`QIDigitalItem`).
 */
export class QIDigitalItem {

    private constructor(
        public readonly type:              QIDigitalItemType,
        /** Its identification, as WWCP_POI writes it: a charging station as `DE*GEF*S1`. */
        public readonly id:                string,
        public readonly manufacturerId:    string | undefined,
        public readonly modelId:           string | undefined,
        public readonly serialNumber:      string | undefined,
        public readonly hardwareRevision:  string | undefined,
        public readonly firmwareVersion:   string | undefined
    ) {

        if (modelId !== undefined && manufacturerId === undefined)
            throw new POIError(`The ${kindOfModel(type)} '${id}' names its model with its manufacturer!`);

        if ((hardwareRevision !== undefined || firmwareVersion !== undefined) && modelId === undefined)
            throw new POIError(`The ${kindOfModel(type)} '${id}' names a hardware revision or a firmware version with its model!`);

    }

    /** Itself in words, e.g. "charging station 'DE*GEF*S1'". */
    public get text(): string {
        return `${kindOfModel(this.type)} '${this.id}'`;
    }

    public static parse(json: JSONObject): QIDigitalItem {

        only(json, 'an item', 'type', 'id', 'manufacturerId', 'modelId', 'serialNumber', 'hardwareRevision', 'firmwareVersion');

        const serialNumber      = optionalText(json, 'serialNumber',     'serial number',     versionOf);
        const hardwareRevision  = optionalText(json, 'hardwareRevision', 'hardware revision', versionOf);
        const firmwareVersion   = optionalText(json, 'firmwareVersion',  'firmware version',  versionOf);
        const type              = textOf(json, 'type');

        if (type !== 'ChargingStation' && type !== 'EnergyMeter')
            throw new POIError("The type of an item must be 'ChargingStation' or 'EnergyMeter'!");

        const kind = kindOfModel(type);
        const id   = type === 'ChargingStation'
                         ? requiredText(json, 'id', 'charging station identification', text => {
                               const parsed = chargingStationIdOf(text);
                               return parsed === undefined ? undefined : chargingStationIdText(parsed);
                           })
                         : requiredText(json, 'id', 'energy meter identification', idOf);

        return new QIDigitalItem(type,
                                 id,
                                 optionalText(json, 'manufacturerId', `${kind} manufacturer identification`, idOf),
                                 optionalText(json, 'modelId',        `${kind} model identification`,        idOf),
                                 serialNumber,
                                 hardwareRevision,
                                 firmwareVersion);

    }

    /** The given charging station as it is, e.g. at runtime with what its templates give it, with the given serial number. */
    public static ofChargingStation(station: JSONObject, serialNumber?: string): QIDigitalItem {
        const parsed = chargingStationIdOf(textOf(station, '@id') ?? '');
        return new QIDigitalItem('ChargingStation',
                                 parsed === undefined ? idOf(textOf(station, '@id') ?? '') ?? '' : chargingStationIdText(parsed),
                                 idText(station, 'manufacturerId'),
                                 idText(station, 'modelId'),
                                 serialNumber,
                                 textOf(station, 'hardwareRevision'),
                                 textOf(station, 'firmwareVersion'));
    }

    /** The given energy meter as it is, e.g. at runtime with what its templates give it, with its serial number. */
    public static ofEnergyMeter(meter: JSONObject): QIDigitalItem {
        return new QIDigitalItem('EnergyMeter',
                                 idOf(textOf(meter, '@id') ?? '') ?? '',
                                 idText(meter, 'manufacturerId'),
                                 idText(meter, 'modelId'),
                                 textOf(meter, 'serialNumber'),
                                 textOf(meter, 'hardwareRevision'),
                                 textOf(meter, 'firmwareVersion'));
    }

    /**
     * Refuses it unless it is a charging station or an energy meter of the roaming network, each as it is at runtime, of
     * the manufacturer, the model, the serial number, the hardware revision and the firmware version it names: one
     * changed since does not match its certificate any more (`TryVerify`).
     */
    public verify(network: RoamingNetwork): void {

        let actual: QIDigitalItem;

        if (this.type === 'ChargingStation') {
            const id       = chargingStationIdOf(this.id);
            const station  = id === undefined ? undefined : effectiveChargingStationOf(network, id);
            if (station === undefined)
                throw new POIError(`The ${this.text} is none of the roaming network '${network.id}'!`);
            actual = QIDigitalItem.ofChargingStation(station, this.serialNumber);
        }

        else {
            const meter = effectiveEnergyMeterOf(network, this.id);
            if (meter === undefined)
                throw new POIError(`The ${this.text} is none of the roaming network '${network.id}'!`);
            actual = QIDigitalItem.ofEnergyMeter(meter);
        }

        if (!sameText(this.manufacturerId, actual.manufacturerId))
            throw new POIError(`The ${this.text} is one of the manufacturer '${shown(actual.manufacturerId)}', not of '${shown(this.manufacturerId)}'!`);

        if (!sameText(this.modelId, actual.modelId))
            throw new POIError(`The ${this.text} is one of the model '${shown(actual.modelId)}', not of '${shown(this.modelId)}'!`);

        if (this.serialNumber !== actual.serialNumber)
            throw new POIError(`The ${this.text} has the serial number '${shown(actual.serialNumber)}', not '${shown(this.serialNumber)}'!`);

        if (this.hardwareRevision !== actual.hardwareRevision)
            throw new POIError(`The ${this.text} is of the hardware revision '${shown(actual.hardwareRevision)}', not '${shown(this.hardwareRevision)}'!`);

        if (this.firmwareVersion !== actual.firmwareVersion)
            throw new POIError(`The ${this.text} runs the firmware version '${shown(actual.firmwareVersion)}', not '${shown(this.firmwareVersion)}'!`);

    }

    public toJSON(): JSONObject {

        const json: JSONObject = { type: this.type, id: this.id };

        if (this.manufacturerId !== undefined)
            json['manufacturerId']    = this.manufacturerId;
        if (this.modelId !== undefined)
            json['modelId']           = this.modelId;
        if (this.serialNumber !== undefined)
            json['serialNumber']      = this.serialNumber;
        if (this.hardwareRevision !== undefined)
            json['hardwareRevision']  = this.hardwareRevision;
        if (this.firmwareVersion !== undefined)
            json['firmwareVersion']   = this.firmwareVersion;

        return json;

    }

}

/** An identification an entity names, as WWCP_POI read it: trimmed. */
const idText = (entity: JSONObject, property: string): string | undefined => {
    const text = textOf(entity, property);
    return text === undefined ? undefined : idOf(text);
};

