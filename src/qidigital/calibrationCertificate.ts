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

import { timeOf, toTimestamp }  from '../common.ts';
import { parseJSON }            from '../json/parse.ts';
import { isObject, type JSONObject, type JSONValue } from '../json/value.ts';
import { KeyUsages, type KeyUsage } from '../keys.ts';
import type { RoamingNetwork }  from '../network/roamingNetwork.ts';
import { POIError }             from '../errors.ts';
import {
    contextOf, firstText, i18nJSON, idOf, only, optionalEnum, optionalI18N, optionalObject, optionalObjects, optionalString,
    optionalTimestamp, qiDigitalContext, requiredText, type I18NText,
} from './json.ts';
import { QIDigitalItem, QIDigitalPerson, QIDigitalQuantity, QIDigitalStandard, QI_DIGITAL_CONFORMITIES, type QIDigitalConformity } from './parts.ts';
import { QIDigitalDocument, signatureOf, type QIDigitalSignature } from './document.ts';
import { bodyOf } from './network.ts';


/** Where a calibration was performed (dcc:performanceLocation). */
export const DCC_PERFORMANCE_LOCATIONS = [ 'Laboratory', 'Customer', 'LaboratoryBranch', 'CustomerBranch', 'Other' ] as const;
export type DCCPerformanceLocation = typeof DCC_PERFORMANCE_LOCATIONS[number];


/** A result of a measurement (dcc:result): the quantities of one calibration point (`DCCResult`). */
export class DCCResult {

    private constructor(
        public readonly name:        I18NText,
        public readonly refType:     string | undefined,
        /** Its quantities, at least one, in their given order. */
        public readonly quantities:  readonly QIDigitalQuantity[]
    ) {}

    public static parse(json: JSONObject): DCCResult {

        only(json, 'a result', 'name', 'refType', 'quantities');

        const name        = optionalI18N   (json, 'name',       'name of a result');
        const refType     = optionalString (json, 'refType',    'refType');
        const quantities  = optionalObjects(json, 'quantities', 'quantity', item => QIDigitalQuantity.parse(item));

        if (name === undefined)
            throw new POIError('A result of a measurement requires a name!');

        if (quantities.length === 0)
            throw new POIError(`The result '${firstText(name)}' requires at least one quantity!`);

        return new DCCResult(name, refType, quantities);

    }

    public toJSON(): JSONObject {
        const json: JSONObject = { name: i18nJSON(this.name) };
        if (this.refType !== undefined)
            json['refType'] = this.refType;
        json['quantities'] = this.quantities.map(quantity => quantity.toJSON());
        return json;
    }

}


/** A measurement (dcc:measurementResult): the methods it used, its conditions and its results (`DCCMeasurementResult`). */
export class DCCMeasurementResult {

    private constructor(
        public readonly name:                 I18NText,
        public readonly usedMethods:          readonly QIDigitalStandard[],
        public readonly influenceConditions:  readonly QIDigitalQuantity[],
        /** Its results, at least one, in their given order. */
        public readonly results:              readonly DCCResult[]
    ) {}

    public static parse(json: JSONObject): DCCMeasurementResult {

        only(json, 'a measurement', 'name', 'usedMethods', 'influenceConditions', 'results');

        const name                 = optionalI18N   (json, 'name',                'name of a measurement');
        const usedMethods          = optionalObjects(json, 'usedMethods',         'used method',         item => QIDigitalStandard.parse(item));
        const influenceConditions  = optionalObjects(json, 'influenceConditions', 'influence condition', item => QIDigitalQuantity.parse(item));
        const results              = optionalObjects(json, 'results',             'result',              item => DCCResult.parse(item));

        if (name === undefined)
            throw new POIError('A measurement requires a name!');

        if (results.length === 0)
            throw new POIError(`The measurement '${firstText(name)}' requires at least one result!`);

        return new DCCMeasurementResult(name, usedMethods, influenceConditions, results);

    }

    /** All quantities of its results, in their order. */
    public get quantities(): QIDigitalQuantity[] {
        return this.results.flatMap(result => result.quantities);
    }

    public toJSON(): JSONObject {
        const json: JSONObject = { name: i18nJSON(this.name) };
        if (this.usedMethods.length > 0)
            json['usedMethods']          = this.usedMethods.map(method => method.toJSON());
        if (this.influenceConditions.length > 0)
            json['influenceConditions']  = this.influenceConditions.map(condition => condition.toJSON());
        json['results']                  = this.results.map(result => result.toJSON());
        return json;
    }

}


/** A statement (dcc:statement), e.g. that the item conforms to a standard (`DCCStatement`). */
export class DCCStatement {

    private constructor(
        public readonly declaration:  I18NText,
        public readonly refType:      string | undefined,
        public readonly norm:         string | undefined,
        public readonly conformity:   QIDigitalConformity | undefined
    ) {}

    public static parse(json: JSONObject): DCCStatement {

        only(json, 'a statement', 'declaration', 'refType', 'norm', 'conformity');

        const declaration  = optionalI18N  (json, 'declaration', 'declaration of a statement');
        const refType      = optionalString(json, 'refType',     'refType');
        const norm         = optionalString(json, 'norm',        'norm of a statement');
        const conformity   = optionalEnum  (json, 'conformity',  'conformity', QI_DIGITAL_CONFORMITIES);

        if (declaration === undefined)
            throw new POIError('A statement requires its declaration!');

        return new DCCStatement(declaration, refType, norm, conformity);

    }

    public toJSON(): JSONObject {
        const json: JSONObject = { declaration: i18nJSON(this.declaration) };
        if (this.refType !== undefined)
            json['refType']     = this.refType;
        if (this.norm !== undefined)
            json['norm']        = this.norm;
        if (this.conformity !== undefined)
            json['conformity']  = this.conformity;
        return json;
    }

}


/**
 * A digital calibration certificate (DCC) of a single charging station or energy meter, issued and signed by its
 * calibration laboratory, a conformity assessment body of the roaming network, with a signing key that may sign
 * certificates (`DigitalCalibrationCertificate`). Its structure follows the PTB DCC schema; its date of issue is when it
 * was signed.
 */
export class DigitalCalibrationCertificate extends QIDigitalDocument {

    public static readonly CONTEXT = qiDigitalContext('digitalCalibrationCertificate');

    private constructor(
        public readonly id:                         string,
        /** ISO 3166-1 alpha-2, e.g. DE. */
        public readonly countryCode:                string,
        public readonly calibrationLaboratoryId:    string,
        public readonly calibrationLaboratoryCode:  string | undefined,
        public readonly customer:                   string | undefined,
        public readonly orderNumber:                string | undefined,
        public readonly item:                       QIDigitalItem,
        public readonly beginPerformanceDate:       number,
        public readonly endPerformanceDate:         number,
        public readonly performanceLocation:        DCCPerformanceLocation,
        /** At least one, at most one of them its main signer. */
        public readonly respPersons:                readonly QIDigitalPerson[],
        public readonly statements:                 readonly DCCStatement[],
        /** At least one. */
        public readonly measurementResults:         readonly DCCMeasurementResult[],
        public readonly recalibrationDue:           number | undefined,
        public readonly comment:                    I18NText | undefined,
        signature:                                  QIDigitalSignature | undefined
    ) {
        super(signature);
    }

    public get context(): string {
        return DigitalCalibrationCertificate.CONTEXT;
    }

    public get usage(): KeyUsage {
        return KeyUsages.Certificates;
    }

    public get issuerText(): string {
        return `the calibration laboratory '${this.calibrationLaboratoryId}'`;
    }

    public get documentText(): string {
        return `the digital calibration certificate '${this.id}'`;
    }

    /** Reads a JSON text of a digital calibration certificate, numbers with a fraction as decimals. Its signature is not verified here. */
    public static parseText(text: string): DigitalCalibrationCertificate {
        return DigitalCalibrationCertificate.parse(parseJSON(text));
    }

    /** Reads a digital calibration certificate, in the words and the order of WWCP_POI. Its signature is not verified here. */
    public static parse(value: JSONValue): DigitalCalibrationCertificate {

        if (!isObject(value))
            throw new POIError('The given JSON text must be a JSON object!');

        const json = value;

        only(json, 'a digital calibration certificate', '@context', '@id', 'countryCode', 'calibrationLaboratoryId', 'calibrationLaboratoryCode',
             'customer', 'orderNumber', 'item', 'beginPerformanceDate', 'endPerformanceDate', 'performanceLocation', 'respPersons', 'statements',
             'measurementResults', 'recalibrationDue', 'comment', 'signature');

        contextOf(json, DigitalCalibrationCertificate.CONTEXT, 'a digital calibration certificate');

        const id                       = requiredText(json, '@id',                     'digital calibration certificate identification', idOf);
        const calibrationLaboratoryId  = requiredText(json, 'calibrationLaboratoryId', 'calibration laboratory identification',          idOf);

        const item                 = optionalObject   (json, 'item',                       'item',                         item => QIDigitalItem.parse(item));
        const respPersons          = optionalObjects  (json, 'respPersons',                'responsible person',           item => QIDigitalPerson.parse(item));
        const statements           = optionalObjects  (json, 'statements',                 'statement',                    item => DCCStatement.parse(item));
        const measurementResults   = optionalObjects  (json, 'measurementResults',         'measurement result',           item => DCCMeasurementResult.parse(item));
        const performanceLocation  = optionalEnum     (json, 'performanceLocation',        'performance location',         DCC_PERFORMANCE_LOCATIONS);
        const countryCode          = optionalString   (json, 'countryCode',                'country code');
        const laboratoryCode       = optionalString   (json, 'calibrationLaboratoryCode',  'calibration laboratory code');
        const customer             = optionalString   (json, 'customer',                   'customer');
        const orderNumber          = optionalString   (json, 'orderNumber',                'order number');
        const comment              = optionalI18N     (json, 'comment',                    'comment');
        const begin                = optionalTimestamp(json, 'beginPerformanceDate',       'beginning of the calibration');
        const end                  = optionalTimestamp(json, 'endPerformanceDate',         'end of the calibration');
        const recalibrationDue     = optionalTimestamp(json, 'recalibrationDue',           'recalibration due');
        const signature            = signatureOf(json);

        if (item === undefined || begin === undefined || end === undefined || countryCode === undefined || performanceLocation === undefined)
            throw new POIError(`The digital calibration certificate '${id}' requires its item, its country, the beginning, the end and the location of its calibration!`);

        if (countryCode.length !== 2 || !/^[A-Z]{2}$/u.test(countryCode))
            throw new POIError(`The country of the digital calibration certificate '${id}' must be two capital letters, ISO 3166-1 alpha-2!`);

        if (end < begin)
            throw new POIError(`The calibration of the digital calibration certificate '${id}' must not end before it began!`);

        if (recalibrationDue !== undefined && recalibrationDue <= end)
            throw new POIError(`The recalibration of the digital calibration certificate '${id}' must be due after its calibration!`);

        if (respPersons.length === 0)
            throw new POIError(`The digital calibration certificate '${id}' requires at least one responsible person!`);

        if (respPersons.filter(person => person.mainSigner).length > 1)
            throw new POIError(`The digital calibration certificate '${id}' has at most one main signer!`);

        if (measurementResults.length === 0)
            throw new POIError(`The digital calibration certificate '${id}' requires at least one measurement result!`);

        return new DigitalCalibrationCertificate(id, countryCode, calibrationLaboratoryId, laboratoryCode, customer, orderNumber, item, begin, end,
                                                 performanceLocation, respPersons, statements, measurementResults, recalibrationDue, comment, signature);

    }

    /** The responsible person signing it as its main signer, if it names one. */
    public get mainSigner(): QIDigitalPerson | undefined {
        return this.respPersons.find(person => person.mainSigner);
    }

    /** Whether every measured quantity stating its conformity passes, and at least one states it. */
    public get passes(): boolean {
        const conformities = this.measurementResults.flatMap(result => result.quantities).flatMap(quantity => quantity.conformity === undefined ? [] : [ quantity.conformity ]);
        return conformities.length > 0 && conformities.every(conformity => conformity === 'Pass');
    }

    /** Whether its item is due to be calibrated again at the given time. */
    public isDueAt(at: number | Date | string): boolean {
        return this.recalibrationDue !== undefined && timeOf(at) >= this.recalibrationDue;
    }

    /**
     * Verifies it against the given roaming network: signed by a signing key of its calibration laboratory, a conformity
     * assessment body of the network, that may sign certificates; and its item a charging station or an energy meter of
     * the network as it calibrated it (`TryVerify`).
     */
    public verify(network: RoamingNetwork, at?: number | Date | string): void {

        const laboratory = bodyOf(network, this.calibrationLaboratoryId);

        if (laboratory === undefined)
            throw new POIError(`The calibration laboratory '${this.calibrationLaboratoryId}' of ${this.documentText} is no conformity assessment body of the roaming network '${network.id}'!`);

        this.verifyWith(laboratory.signingKeys, at);
        this.item.verify(network);

    }

    protected content(): JSONObject {

        const json: JSONObject = { '@id': this.id, countryCode: this.countryCode, calibrationLaboratoryId: this.calibrationLaboratoryId };

        if (this.calibrationLaboratoryCode !== undefined)
            json['calibrationLaboratoryCode']  = this.calibrationLaboratoryCode;
        if (this.customer !== undefined)
            json['customer']                   = this.customer;
        if (this.orderNumber !== undefined)
            json['orderNumber']                = this.orderNumber;
        json['item']                           = this.item.toJSON();
        json['beginPerformanceDate']           = toTimestamp(this.beginPerformanceDate);
        json['endPerformanceDate']             = toTimestamp(this.endPerformanceDate);
        json['performanceLocation']            = this.performanceLocation;
        json['respPersons']                    = this.respPersons.map(person => person.toJSON());
        if (this.statements.length > 0)
            json['statements']                 = this.statements.map(statement => statement.toJSON());
        json['measurementResults']             = this.measurementResults.map(result => result.toJSON());
        if (this.recalibrationDue !== undefined)
            json['recalibrationDue']           = toTimestamp(this.recalibrationDue);
        if (this.comment !== undefined)
            json['comment']                    = i18nJSON(this.comment);

        return json;

    }

}
