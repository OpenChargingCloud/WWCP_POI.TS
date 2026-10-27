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
import { get, isArray, isObject, type JSONObject, type JSONValue } from '../json/value.ts';
import { KeyUsages, type KeyUsage } from '../keys.ts';
import type { RoamingNetwork }  from '../network/roamingNetwork.ts';
import { trimmed }              from '../network/versionTexts.ts';
import { POIError }             from '../errors.ts';
import {
    capitalized, contextOf, distinct, i18nJSON, i18nOf, idOf, only, optionalEnum, optionalI18N, optionalInteger, optionalObject,
    optionalObjects, optionalString, optionalText, optionalTimestamp, qiDigitalContext, requiredText, tokenText, type I18NText,
} from './json.ts';
import { QIDigitalLegislation, QIDigitalManufacturer, QIDigitalModel, QIDigitalQuantity, QIDigitalStandard, type QIDigitalItem } from './parts.ts';
import { QIDigitalDocument, signatureOf, type QIDigitalSignature } from './document.ts';
import { bodyOf } from './network.ts';


/**
 * The conformity assessment module of a certificate of conformity (Decision 768/2008/EC, Annex II): B, F, F1 and G for a
 * model, D, D1, E, E1, H and H1 approving the quality system of its manufacturer.
 */
export const DCOC_MODULES = [ 'B', 'D', 'D1', 'E', 'E1', 'F', 'F1', 'G', 'H', 'H1' ] as const;
export type DCoCModule = typeof DCOC_MODULES[number];

/** Whether a certificate of the given module approves the quality system of a manufacturer and names it, not a model. */
export const approvesQualitySystem = (module: DCoCModule): boolean =>
    [ 'D', 'D1', 'E', 'E1', 'H', 'H1' ].includes(module);


/**
 * A URL as Hermod reads it, simplified: trimmed, with the scheme https unless it names one, of a known scheme and with a
 * host, written as given then (`URL.TryParse`).
 */
function urlOf(text: string): string | undefined {

    const given  = trimmed(text);
    const url    = given.includes('://') ? given : `https://${given}`;
    const match  = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)/u.exec(url);
    const host   = match?.[2]?.replace(/^.*@/u, '').replace(/:\d{1,5}$/u, '') ?? '';

    return given.length > 0 && match !== null && [ 'http', 'https' ].includes((match[1] ?? '').toLowerCase()) && host.length > 0
               ? url
               : undefined;

}


/**
 * A digital certificate of conformity (D-CoC) of a charging station model or an energy meter model, in the hardware
 * revisions and firmware versions it covers, or of the quality system of a manufacturer, in the scope it covers, issued
 * and signed by a conformity assessment body of the roaming network as a notified body, with one of its signing keys
 * that may sign certificates (`DigitalCertificateOfConformity`). Its date of issue is when it was signed.
 */
export class DigitalCertificateOfConformity extends QIDigitalDocument {

    public static readonly CONTEXT = qiDigitalContext('digitalCertificateOfConformity');

    private constructor(
        public readonly id:                          string,
        /** 0 for the first one, one more for every revision of it. */
        public readonly revision:                    number,
        public readonly module:                      DCoCModule,
        public readonly legislation:                 QIDigitalLegislation,
        public readonly conformityAssessmentBodyId:  string,
        /** The four digit number of its body as a notified body. */
        public readonly notifiedBodyNumber:          string,
        /** The approved model, of a module for a model (B, F, F1, G). */
        public readonly model:                       QIDigitalModel | undefined,
        /** The manufacturer whose quality system it approves, of a module of quality assurance (D, D1, E, E1, H, H1). */
        public readonly manufacturer:                QIDigitalManufacturer | undefined,
        public readonly validFrom:                   number,
        public readonly validUntil:                  number | undefined,
        public readonly standards:                   readonly QIDigitalStandard[],
        public readonly characteristics:             readonly QIDigitalQuantity[],
        public readonly conclusion:                  I18NText | undefined,
        public readonly conditions:                  readonly I18NText[],
        public readonly documentURL:                 string | undefined,
        public readonly comment:                     I18NText | undefined,
        signature:                                   QIDigitalSignature | undefined
    ) {
        super(signature);
    }

    public get context(): string {
        return DigitalCertificateOfConformity.CONTEXT;
    }

    public get usage(): KeyUsage {
        return KeyUsages.Certificates;
    }

    public get issuerText(): string {
        return `the conformity assessment body '${this.conformityAssessmentBodyId}'`;
    }

    public get documentText(): string {
        return `the digital certificate of conformity '${this.id}'${this.revision > 0 ? ` revision ${this.revision.toString()}` : ''}`;
    }

    /** Reads a JSON text of a digital certificate of conformity, numbers with a fraction as decimals. Its signature is not verified here. */
    public static parseText(text: string): DigitalCertificateOfConformity {
        return DigitalCertificateOfConformity.parse(parseJSON(text));
    }

    /** Reads a digital certificate of conformity, in the words and the order of WWCP_POI. Its signature is not verified here. */
    public static parse(value: JSONValue): DigitalCertificateOfConformity {

        if (!isObject(value))
            throw new POIError('The given JSON text must be a JSON object!');

        const json = value;

        only(json, 'a digital certificate of conformity', '@context', '@id', 'revision', 'module', 'legislation', 'conformityAssessmentBodyId',
             'notifiedBodyNumber', 'model', 'manufacturer', 'validFrom', 'validUntil', 'standards', 'characteristics', 'conclusion', 'conditions',
             'documentURL', 'comment', 'signature');

        contextOf(json, DigitalCertificateOfConformity.CONTEXT, 'a digital certificate of conformity');

        const id      = requiredText(json, '@id',                        'certificate of conformity identification', idOf);
        const bodyId  = requiredText(json, 'conformityAssessmentBodyId', 'conformity assessment body identification', idOf);

        const module           = optionalEnum     (json, 'module',             'module',               DCOC_MODULES);
        const legislation      = optionalObject   (json, 'legislation',        'legislation',          item => QIDigitalLegislation.parse(item));
        const model            = optionalObject   (json, 'model',              'model',                item => QIDigitalModel.parse(item));
        const manufacturer     = optionalObject   (json, 'manufacturer',       'manufacturer',         item => QIDigitalManufacturer.parse(item));
        const standards        = optionalObjects  (json, 'standards',          'standard',             item => QIDigitalStandard.parse(item));
        const characteristics  = optionalObjects  (json, 'characteristics',    'characteristic',       item => QIDigitalQuantity.parse(item));
        const number           = optionalString   (json, 'notifiedBodyNumber', 'notified body number');
        const conclusion       = optionalI18N     (json, 'conclusion',         'conclusion');
        const comment          = optionalI18N     (json, 'comment',            'comment');
        const documentURL      = optionalText     (json, 'documentURL',        'document URL', urlOf);
        const validFrom        = optionalTimestamp(json, 'validFrom',          'beginning of its validity');
        const validUntil       = optionalTimestamp(json, 'validUntil',         'end of its validity');
        const signature        = signatureOf(json);

        if (module === undefined || legislation === undefined || number === undefined || validFrom === undefined)
            throw new POIError(`The digital certificate of conformity '${id}' requires its module, its legislation, the number of its notified body and the beginning of its validity!`);

        const mismatch = holderMismatch(id, module, model, manufacturer);

        if (mismatch !== undefined)
            throw new POIError(mismatch);

        const revision = optionalInteger(json, 'revision', 0xFFFFFFFF, 'The revision of a digital certificate of conformity must be an integer from 0!') ?? 0;

        const conditionsJSON = get(json, 'conditions');
        const conditions: (I18NText | undefined)[] = [];

        if (conditionsJSON !== undefined) {

            if (!isArray(conditionsJSON))
                throw new POIError('The conditions of a digital certificate of conformity must be a JSON array!');

            for (const condition of conditionsJSON) {
                if (!isObject(condition))
                    throw new POIError(`Invalid condition of a digital certificate of conformity '${tokenText(condition)}'!`);
                conditions.push(i18nOf(condition, `Invalid condition of a digital certificate of conformity '${tokenText(condition)}': `));
            }

        }

        if (!/^[0-9]{4}$/u.test(number))
            throw new POIError(`The number of the notified body of the digital certificate of conformity '${id}' must be four digits!`);

        if (validUntil !== undefined && validUntil <= validFrom)
            throw new POIError(`The digital certificate of conformity '${id}' must be valid until after it is valid from!`);

        if (conditions.some(condition => condition === undefined))
            throw new POIError(`A condition of the digital certificate of conformity '${id}' must not be empty!`);

        return new DigitalCertificateOfConformity(id, revision, module, legislation, bodyId, number, model, manufacturer, validFrom, validUntil,
                                                  distinct(standards, standard => standard.reference, 'standard of a certificate of conformity'),
                                                  characteristics, conclusion, conditions.filter(condition => condition !== undefined), documentURL, comment, signature);

    }

    /** Whether it is valid at the given time: not before its validFrom, and not after its validUntil, when it has one. */
    public isValidAt(at: number | Date | string): boolean {
        const time = timeOf(at);
        return time >= this.validFrom && (this.validUntil === undefined || time <= this.validUntil);
    }

    /**
     * Verifies it against the given roaming network: its conformity assessment body one of the network with its number as
     * a notified body and notified for its legislation; valid at `at`, if it is given; its model one of its manufacturer,
     * in hardware revisions and firmware versions of it, or its manufacturer one of the network of the kind it names; and
     * signed by a signing key of its body that may sign certificates (`TryVerify`).
     */
    public verify(network: RoamingNetwork, at?: number | Date | string): void {

        const body = bodyOf(network, this.conformityAssessmentBodyId);

        if (body === undefined)
            throw new POIError(`The conformity assessment body '${this.conformityAssessmentBodyId}' of ${this.documentText} is none of the roaming network '${network.id}'!`);

        if (body.notifiedBodyNumber !== this.notifiedBodyNumber)
            throw new POIError(`The conformity assessment body '${body.id}' is the notified body '${body.notifiedBodyNumber ?? 'none'}', not '${this.notifiedBodyNumber}' as ${this.documentText} says!`);

        if (!body.notifiedFor.includes(this.legislation.name))
            throw new POIError(`The conformity assessment body '${body.id}' is not notified for the ${this.legislation.name}, ${this.documentText} is issued under!`);

        if (at !== undefined && !this.isValidAt(at))
            throw new POIError(`${capitalized(this.documentText)} is not valid at ${toTimestamp(timeOf(at))}!`);

        if (this.model !== undefined)
            this.model.verify(network);
        else
            this.manufacturer?.verify(network);

        this.verifyWith(body.signingKeys, at);

    }

    /**
     * Refuses a charging station or energy meter it does not cover: one of its model, in one of its hardware revisions and
     * firmware versions; or, of a module of quality assurance, one of its manufacturer, of a kind in its scope (`TryCover`).
     */
    public cover(item: QIDigitalItem): void {
        if (this.model !== undefined)
            this.model.cover(item);
        else
            this.manufacturer?.cover(item);
    }

    protected content(): JSONObject {

        const json: JSONObject = {
            '@id':                       this.id,
            revision:                    this.revision,
            module:                      this.module,
            legislation:                 this.legislation.toJSON(),
            conformityAssessmentBodyId:  this.conformityAssessmentBodyId,
            notifiedBodyNumber:          this.notifiedBodyNumber,
        };

        if (this.model !== undefined)
            json['model']            = this.model.toJSON();
        else if (this.manufacturer !== undefined)
            json['manufacturer']     = this.manufacturer.toJSON();
        json['validFrom']            = toTimestamp(this.validFrom);
        if (this.validUntil !== undefined)
            json['validUntil']       = toTimestamp(this.validUntil);
        if (this.standards.length > 0)
            json['standards']        = this.standards.map(standard => standard.toJSON());
        if (this.characteristics.length > 0)
            json['characteristics']  = this.characteristics.map(characteristic => characteristic.toJSON());
        if (this.conclusion !== undefined)
            json['conclusion']       = i18nJSON(this.conclusion);
        if (this.conditions.length > 0)
            json['conditions']       = this.conditions.map(condition => i18nJSON(condition));
        if (this.documentURL !== undefined)
            json['documentURL']      = this.documentURL;
        if (this.comment !== undefined)
            json['comment']          = i18nJSON(this.comment);

        return json;

    }

}


/** Why the given model and manufacturer do not fit the given module: exactly one of them, as the module asks for (`HolderMismatch`). */
function holderMismatch(id: string, module: DCoCModule, model: QIDigitalModel | undefined, manufacturer: QIDigitalManufacturer | undefined): string | undefined {

    if (approvesQualitySystem(module))
        return model !== undefined
                   ? `The digital certificate of conformity '${id}' of the module ${module} approves the quality system of a manufacturer and names it, not a model!`
                   : manufacturer === undefined
                         ? `The digital certificate of conformity '${id}' of the module ${module} requires the manufacturer whose quality system it approves!`
                         : undefined;

    return manufacturer !== undefined
               ? `The digital certificate of conformity '${id}' of the module ${module} is for a model and names it, not a manufacturer!`
               : model === undefined
                     ? `The digital certificate of conformity '${id}' of the module ${module} requires its model!`
                     : undefined;

}
