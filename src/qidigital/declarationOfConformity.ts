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

import { parseJSON }            from '../json/parse.ts';
import { isObject, type JSONObject, type JSONValue } from '../json/value.ts';
import { KeyUsages, type KeyUsage } from '../keys.ts';
import type { RoamingNetwork }  from '../network/roamingNetwork.ts';
import { POIError }             from '../errors.ts';
import {
    capitalized, contextOf, distinct, i18nJSON, idOf, isBlank, only, optionalEnum, optionalI18N, optionalObject, optionalObjects,
    optionalString, optionalText, qiDigitalContext, requiredText, sameId, textOf, type I18NText,
} from './json.ts';
import { QIDigitalLegislation, QIDigitalModel, QIDigitalPerson, QIDigitalStandard } from './parts.ts';
import { QIDigitalDocument, signatureOf, type QIDigitalSignature } from './document.ts';
import { DCOC_MODULES, type DCoCModule, type DigitalCertificateOfConformity } from './certificateOfConformity.ts';
import { bodyOf, manufacturerOf } from './network.ts';


/**
 * A notified body a declaration of conformity names (Decision 768/2008/EC, Annex III, point 7): the conformity assessment
 * body, its number, the module of its intervention and the certificate it issued (`DDoCNotifiedBody`).
 */
export class DDoCNotifiedBody {

    private constructor(
        public readonly conformityAssessmentBodyId:  string,
        /** Its four digit number as a notified body, e.g. 0102. */
        public readonly notifiedBodyNumber:          string,
        public readonly module:                      DCoCModule | undefined,
        public readonly certificateId:               string | undefined,
        public readonly intervention:                I18NText | undefined
    ) {}

    public static parse(json: JSONObject): DDoCNotifiedBody {

        only(json, 'a notified body', 'conformityAssessmentBodyId', 'notifiedBodyNumber', 'module', 'certificateId', 'intervention');

        const bodyId         = requiredText(json, 'conformityAssessmentBodyId', 'conformity assessment body identification', idOf);
        const module         = optionalEnum(json, 'module',                     'module',                                    DCOC_MODULES);
        const certificateId  = optionalText(json, 'certificateId',              'certificate of conformity identification',  idOf);
        const intervention   = optionalI18N(json, 'intervention',               'intervention');
        const number         = textOf(json, 'notifiedBodyNumber');

        if (number === undefined)
            throw new POIError('A notified body requires its number!');

        if (!/^[0-9]{4}$/u.test(number))
            throw new POIError('The number of a notified body must be four digits!');

        return new DDoCNotifiedBody(bodyId, number, module, certificateId, intervention);

    }

    public toJSON(): JSONObject {
        const json: JSONObject = { conformityAssessmentBodyId: this.conformityAssessmentBodyId, notifiedBodyNumber: this.notifiedBodyNumber };
        if (this.module !== undefined)
            json['module']         = this.module;
        if (this.certificateId !== undefined)
            json['certificateId']  = this.certificateId;
        if (this.intervention !== undefined)
            json['intervention']   = i18nJSON(this.intervention);
        return json;
    }

}


/**
 * A digital EU declaration of conformity (DDoC) of a charging station model or an energy meter model, in the hardware
 * revisions and firmware versions it covers, issued under the sole responsibility of its manufacturer and signed by it
 * with one of its signing keys that may sign its models (`DigitalDeclarationOfConformity`). Its structure follows the
 * model declaration of Decision 768/2008/EC, Annex III; its date of issue is when it was signed.
 */
export class DigitalDeclarationOfConformity extends QIDigitalDocument {

    public static readonly CONTEXT = qiDigitalContext('digitalDeclarationOfConformity');

    private constructor(
        /** Its number, assigned by its manufacturer (point 1). */
        public readonly id:                     string,
        /** The object of the declaration (point 4), of its manufacturer, its issuer (point 2). */
        public readonly model:                  QIDigitalModel,
        /** The Union harmonisation legislations its model conforms to, at least one, each once (point 5). */
        public readonly legislations:           readonly QIDigitalLegislation[],
        /** The standards and other technical specifications applied (point 6). */
        public readonly standards:              readonly QIDigitalStandard[],
        /** The notified bodies, what they did and the certificates they issued (point 7). */
        public readonly notifiedBodies:         readonly DDoCNotifiedBody[],
        /** Additional information (point 8). */
        public readonly additionalInformation:  I18NText | undefined,
        public readonly placeOfIssue:           string,
        /** Who signs it for and on behalf of its manufacturer, with the function as its role. */
        public readonly signatory:              QIDigitalPerson,
        signature:                              QIDigitalSignature | undefined
    ) {
        super(signature);
    }

    public get context(): string {
        return DigitalDeclarationOfConformity.CONTEXT;
    }

    public get usage(): KeyUsage {
        return KeyUsages.Models;
    }

    public get issuerText(): string {
        return `the ${this.model.type === 'ChargingStationModel' ? 'charging station' : 'energy meter'} manufacturer '${this.model.manufacturerId}'`;
    }

    public get documentText(): string {
        return `the digital declaration of conformity '${this.id}'`;
    }

    /** Reads a JSON text of a digital declaration of conformity. Its signature is not verified here. */
    public static parseText(text: string): DigitalDeclarationOfConformity {
        return DigitalDeclarationOfConformity.parse(parseJSON(text));
    }

    /** Reads a digital declaration of conformity, in the words and the order of WWCP_POI. Its signature is not verified here. */
    public static parse(value: JSONValue): DigitalDeclarationOfConformity {

        if (!isObject(value))
            throw new POIError('The given JSON text must be a JSON object!');

        const json = value;

        only(json, 'a digital declaration of conformity', '@context', '@id', 'model', 'legislations', 'standards', 'notifiedBodies',
             'additionalInformation', 'placeOfIssue', 'signatory', 'signature');

        contextOf(json, DigitalDeclarationOfConformity.CONTEXT, 'a digital declaration of conformity');

        const id                     = requiredText   (json, '@id',                   'declaration of conformity identification', idOf);
        const model                  = optionalObject (json, 'model',                 'model',                  item => QIDigitalModel.parse(item));
        const legislations           = optionalObjects(json, 'legislations',          'legislation',            item => QIDigitalLegislation.parse(item));
        const standards              = optionalObjects(json, 'standards',             'standard',               item => QIDigitalStandard.parse(item));
        const notifiedBodies         = optionalObjects(json, 'notifiedBodies',        'notified body',          item => DDoCNotifiedBody.parse(item));
        const signatory              = optionalObject (json, 'signatory',             'signatory',              item => QIDigitalPerson.parse(item));
        const additionalInformation  = optionalI18N   (json, 'additionalInformation', 'additional information');
        const placeOfIssue           = optionalString (json, 'placeOfIssue',          'place of issue');
        const signature              = signatureOf(json);

        if (model === undefined || signatory === undefined || placeOfIssue === undefined)
            throw new POIError(`The digital declaration of conformity '${id}' requires its model, its place of issue and its signatory!`);

        if (isBlank(placeOfIssue))
            throw new POIError(`The digital declaration of conformity '${id}' requires its place of issue!`);

        const distinctLegislations = distinct(legislations, legislation => legislation.name, 'legislation of a declaration of conformity');

        if (distinctLegislations.length === 0)
            throw new POIError(`The digital declaration of conformity '${id}' names at least one Union harmonisation legislation!`);

        return new DigitalDeclarationOfConformity(id,
                                                  model,
                                                  distinctLegislations,
                                                  distinct(standards, standard => standard.reference, 'standard of a declaration of conformity'),
                                                  distinct(notifiedBodies, body => `${body.notifiedBodyNumber}/${body.module ?? ''}/${body.certificateId ?? ''}`, 'notified body of a declaration of conformity'),
                                                  additionalInformation,
                                                  placeOfIssue,
                                                  signatory,
                                                  signature);

    }

    /**
     * Verifies it against the given roaming network: its model one of its manufacturer, in hardware revisions and firmware
     * versions of it; signed by a signing key of that manufacturer that may sign its models; and each notified body it
     * names a conformity assessment body of the network with that number (`TryVerify`).
     */
    public verify(network: RoamingNetwork, at?: number | Date | string): void {

        this.model.verify(network);

        const manufacturer = manufacturerOf(network, this.model.type === 'ChargingStationModel' ? 'chargingStation' : 'energyMeter', this.model.manufacturerId);

        this.verifyWith(manufacturer?.signingKeys ?? [], at);

        for (const notifiedBody of this.notifiedBodies) {

            const body = bodyOf(network, notifiedBody.conformityAssessmentBodyId);

            if (body === undefined)
                throw new POIError(`The notified body '${notifiedBody.conformityAssessmentBodyId}' of ${this.documentText} is no conformity assessment body of the roaming network '${network.id}'!`);

            if (body.notifiedBodyNumber !== notifiedBody.notifiedBodyNumber)
                throw new POIError(`The conformity assessment body '${body.id}' is the notified body '${body.notifiedBodyNumber ?? 'none'}', not '${notifiedBody.notifiedBodyNumber}' as ${this.documentText} says!`);

        }

    }

    /**
     * Refuses a certificate of conformity it does not name (point 7): issued by the notified body it names with it, of the
     * module it names, under one of its legislations; for its model and in all its hardware revisions and firmware
     * versions, or, of a module of quality assurance, approving the quality system of the manufacturer of its model, with
     * its kind in the scope. Whether the certificate itself is valid, its own `verify` tells (`TryVerify(Certificate)`).
     */
    public verifyCertificate(certificate: DigitalCertificateOfConformity): void {

        const notifiedBody = this.notifiedBodies.find(body => sameId(body.certificateId, certificate.id));
        const kind         = this.model.type === 'ChargingStationModel' ? 'charging station' : 'energy meter';

        if (notifiedBody === undefined)
            throw new POIError(`${capitalized(this.documentText)} names no certificate '${certificate.id}'!`);

        if (!sameId(notifiedBody.conformityAssessmentBodyId, certificate.conformityAssessmentBodyId) || notifiedBody.notifiedBodyNumber !== certificate.notifiedBodyNumber)
            throw new POIError(`The certificate '${certificate.id}' is one of '${certificate.conformityAssessmentBodyId}', not of the notified body ${notifiedBody.notifiedBodyNumber} '${notifiedBody.conformityAssessmentBodyId}' ${this.documentText} names!`);

        if (notifiedBody.module !== undefined && notifiedBody.module !== certificate.module)
            throw new POIError(`The certificate '${certificate.id}' is one of the module ${certificate.module}, not ${notifiedBody.module}!`);

        if (!this.legislations.some(legislation => legislation.name === certificate.legislation.name))
            throw new POIError(`The certificate '${certificate.id}' is issued under the ${certificate.legislation.name}, none of the legislations of ${this.documentText}!`);

        // The approval of a quality system belongs to the manufacturer: it names no model, revisions or versions.
        const manufacturer = certificate.manufacturer;

        if (manufacturer !== undefined) {

            if (!manufacturer.makes(this.model))
                throw new POIError(`The certificate '${certificate.id}' approves the quality system of ${manufacturer.text}, not of the ${kind} manufacturer '${this.model.manufacturerId}' of ${this.documentText}!`);

            if (!manufacturer.inScope(this.model.type === 'ChargingStationModel' ? 'ChargingStation' : 'EnergyMeter'))
                throw new POIError(`The certificate '${certificate.id}' approves a quality system for ${manufacturer.scope.join(', ')}, not for the model '${this.model.modelId}' of ${this.documentText}!`);

            return;

        }

        const model = certificate.model;

        if (model === undefined)
            return;

        if (model.type !== this.model.type || !sameId(model.manufacturerId, this.model.manufacturerId) || !sameId(model.modelId, this.model.modelId))
            throw new POIError(`The certificate '${certificate.id}' is one of the model '${model.modelId}' of '${model.manufacturerId}', not of '${this.model.modelId}' of '${this.model.manufacturerId}'!`);

        const hardwareRevision = this.model.hardwareRevisions.find(revision => !model.hardwareRevisions.includes(revision));

        if (hardwareRevision !== undefined)
            throw new POIError(`The certificate '${certificate.id}' does not cover the hardware revision '${hardwareRevision}' of ${this.documentText}!`);

        const firmwareVersion = this.model.firmwareVersions.find(version => !model.firmwareVersions.includes(version));

        if (firmwareVersion !== undefined)
            throw new POIError(`The certificate '${certificate.id}' does not cover the firmware version '${firmwareVersion}' of ${this.documentText}!`);

    }

    protected content(): JSONObject {

        const json: JSONObject = {
            '@id':         this.id,
            model:         this.model.toJSON(),
            legislations:  this.legislations.map(legislation => legislation.toJSON()),
        };

        if (this.standards.length > 0)
            json['standards']              = this.standards.map(standard => standard.toJSON());
        if (this.notifiedBodies.length > 0)
            json['notifiedBodies']         = this.notifiedBodies.map(body => body.toJSON());
        if (this.additionalInformation !== undefined)
            json['additionalInformation']  = i18nJSON(this.additionalInformation);
        json['placeOfIssue']               = this.placeOfIssue;
        json['signatory']                  = this.signatory.toJSON();

        return json;

    }

}
