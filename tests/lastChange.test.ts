import { describe, expect, it } from 'vitest';

import { asText, defined, readJSON } from './helpers.ts';
import { commits, commitsOfEpoch1, genesis } from './qa.ts';

import { RoamingNetwork } from '../src/network/roamingNetwork.ts';
import { ChangeSet, changeSetIdentification } from '../src/history/changeSet.ts';
import { applyChangeSet } from '../src/history/apply.ts';
import { etagToJSON }     from '../src/etags.ts';
import { canonicalJSON }  from '../src/json/canonical.ts';
import { clone, isObject, set, without, type JSONObject, type JSONValue } from '../src/json/value.ts';


// A change set sets the lastChange of every entity embedding one it adds, changes or removes, up to the roaming network
// (SPECIFICATION.md section 4, csharp-review 8): the lastChange of an entity tells the last change of its
// representation, as its ETag does. Afterwards ETags calculated without them are refused.

const changeSetsOf = (commitsOf: readonly JSONValue[]): JSONObject[] =>
    commitsOf.map(commit => defined((commit as JSONObject)['changeSet'], 'The change set of a commit') as JSONObject);

/** A line of QA from a genesis, revision by revision: each change set applied to the version before it. */
function line(start: RoamingNetwork, changeSets: readonly JSONObject[]): RoamingNetwork[] {
    const versions = [ start ];
    for (const changeSet of changeSets)
        versions.push(applyChangeSet(defined(versions.at(-1)), ChangeSet.parse(changeSet), { checkOwnership: false }));
    return versions;
}

/** Both epochs of QA: epoch 1 from its genesis up to its final checkpoint, epoch 2 from its genesis up to the head. */
const epochs = [
    { epoch: 1, changeSets: changeSetsOf(commitsOfEpoch1()) },
    { epoch: 2, changeSets: changeSetsOf(commits('proofs/QA-epoch-2-commits-to-head.json')) },
].map(({ epoch, changeSets }) => ({
    epoch,
    changeSets,
    versions: line(epoch === 1 ? genesis : RoamingNetwork.parse((readJSON('published/QA-epoch-2-genesis.json') as JSONObject)['roamingNetwork']), changeSets),
}));

const epoch1         = defined(epochs[0]);
const changeSetsJSON = epoch1.changeSets;
const versions       = epoch1.versions;

/** Every identified object of a content by its path of property names and identifications, e.g. `/QA/chargingStationOperators/DE*GEF`. */
function entities(value: JSONValue, path = '', into = new Map<string, JSONObject>()): Map<string, JSONObject> {

    if (Array.isArray(value))
        for (const item of value)
            entities(item, path, into);

    else if (isObject(value)) {

        const here = typeof value['@id'] === 'string' ? `${path}/${value['@id']}` : path;

        if (here !== path)
            into.set(here, value);

        for (const [ property, child ] of Object.entries(value))
            if (Array.isArray(child) || isObject(child))
                entities(child, `${here}/${property}`, into);

    }

    return into;

}

/**
 * The path of the entity a change addresses: the one ending in its identification, in the version after it or, removed,
 * before it; of several, the one in the property named after its type (`GraphDefined` makes charging stations and
 * transparency software).
 */
function pathOf(change: JSONObject, after: Map<string, JSONObject>, before: Map<string, JSONObject>): string {

    const entityId   = asText(change['entityId']);
    const entityType = asText(change['entityType']).toLowerCase();
    const ofType     = (path: string): boolean => (path.split('/').at(-2) ?? '').replace(/ies$/, 'y').replace(/s$/, '').toLowerCase() === entityType;

    let found = [ ...after.keys() ].filter(path => path.endsWith(`/${entityId}`));
    if (found.length === 0)
        found = [ ...before.keys() ].filter(path => path.endsWith(`/${entityId}`));
    if (found.length > 1)
        found = found.filter(ofType);

    expect(found, `The path of '${entityId}'`).toHaveLength(1);
    return defined(found[0]);

}

/** The entities embedding the one at a path, with timestamps, up to the roaming network. */
const embedding = (path: string, of: Map<string, JSONObject>): string[] =>
    [ ...of.keys() ].filter(other => path.startsWith(`${other}/`) && typeof defined(of.get(other))['lastChange'] === 'string');


describe('The lastChange of what embeds a changed entity (4)', () => {

    it('is the createdAt of every change set of both epochs, up to the roaming network, and nothing else changes', () => {

        const types = new Set<string>();

        for (const { epoch, changeSets, versions } of epochs)
            changeSets.forEach((changeSet, index) => {

                const what      = `Epoch ${epoch}, revision ${index + 1}`;
                const before    = entities(defined(versions[index]).content);
                const after     = entities(defined(versions[index + 1]).content);
                const createdAt = changeSet['createdAt'];
                const changes   = (changeSet['changes'] as JSONObject[]).map(change => ({ kind: asText(change['kind']), type: asText(change['entityType']), path: pathOf(change, after, before) }));
                const touched   = new Set(changes.flatMap(change => embedding(change.path, after)));

                expect(touched.size, what).toBeGreaterThan(0);

                for (const path of touched)
                    expect(defined(after.get(path))['lastChange'], `${what}: ${path}`).toBe(createdAt);

                // Every other timestamp is as before: what the change set addresses, and what that one embeds, aside.
                for (const [ path, entity ] of after)
                    if (typeof entity['lastChange'] === 'string' && !touched.has(path) && !changes.some(change => path === change.path || path.startsWith(`${change.path}/`)))
                        expect(entity['lastChange'], `${what}: ${path}`).toBe(defined(before.get(path), `${what}: ${path} before`)['lastChange']);

                for (const change of changes)
                    types.add(change.type);

            });

        // What embeds them: operators, pools, stations, manufacturers, conformity assessment bodies.
        expect([ ...types ].sort()).toEqual([
            'ChargingPool', 'ChargingStation', 'ChargingStationGroup', 'ChargingStationManufacturer', 'ChargingStationModel', 'ChargingStationOperator',
            'ChargingStationTemplate', 'ChargingTariff', 'ConformityAssessmentBody', 'ConformityCertificate', 'EVSE', 'EVSEGroup', 'EVSETemplate',
            'EnergyMeterManufacturer', 'EnergyMeterModel', 'EnergyMeterTemplate', 'RoamingNetworkOperator', 'TransparencySoftware',
            'TransparencySoftwareManufacturer',
        ]);

    });

    it('refuses afterETags leaving what embeds a changed entity as it was', () => {

        // Revision 10: the maxPower of two charging stations and of their EVSEs.
        const changeSet = defined(changeSetsJSON[9]);
        const before    = defined(versions[9]);
        const after     = entities(defined(versions[10]).content);
        const changed   = (changeSet['changes'] as JSONObject[]).map(change => pathOf(change, after, entities(before.content)));
        const embedders = new Set(changed.flatMap(path => embedding(path, after)).filter(path => !changed.includes(path) && path !== `/${before.id}`));

        expect([ ...embedders ].map(path => defined(path.split('/').at(-1))).sort()).toEqual([ 'DE*GEF', 'DE*GEF*P3', 'DE*GEF*P4' ]);

        // The content as the specification said before: the charging pools and the operator not touched.
        const content  = clone(defined(versions[10]).content);
        const inClone  = entities(content);
        const previous = entities(before.content);

        for (const path of embedders)
            set(defined(inClone.get(path)), 'lastChange', defined(defined(previous.get(path))['lastChange']));

        const unsigned = (afterETags?: JSONValue): ChangeSet => {
            const json = without(changeSet, 'signatures');
            if (afterETags !== undefined)
                set(json, 'afterETags', afterETags);
            set(json, '@id', changeSetIdentification(json));
            return ChangeSet.parse(json);
        };

        expect(applyChangeSet(before, unsigned(), { checkOwnership: false }).matchesCommitETags(defined(versions[10]).eTags())).toBe(true);
        expect(() => applyChangeSet(before, unsigned(RoamingNetwork.parse(content).changeSetETags().map(eTag => etagToJSON(eTag))), { checkOwnership: false }))
            .toThrow(/The result does not match the change set/);

    });

});

describe('No lastChange goes back (4, S5)', () => {

    /** The given JSON with every text that is the given timestamp replaced by the other one. */
    const restamped = (json: JSONValue, from: string, to: string): JSONValue =>
        json === from                    ? to
      : Array.isArray(json)              ? json.map(item => restamped(item, from, to))
      : isObject(json)                   ? Object.fromEntries(Object.entries(json).map(([ key, value ]) => [ key, restamped(value, from, to) ]))
      :                                    json;

    it('stamps a change set created before its version with the lastChange of the version, as WWCP_POI 12e993a does', () => {

        // Every change set of both epochs that gives no timestamp of its createdAt itself, created an hour before the
        // lastChange of the version it is applied to: the very version it led to, stamped with that lastChange where it
        // stamped its createdAt, as the lastChange of what it changes, adds and embeds. What a change set gives is kept as
        // given; the change sets of elementChanges, embeddedChanges and preconditions, created before QA, are stamped
        // with its lastChange as WWCP_POI3 at 12e993a stamped them.
        let checked = 0;

        for (const { epoch, changeSets, versions } of epochs)
            changeSets.forEach((changeSet, index) => {

                const before     = defined(versions[index]);
                const last       = asText(before.content['lastChange']);
                const createdAt  = asText(changeSet['createdAt']);
                const expected   = restamped(defined(versions[index + 1]).content, createdAt, last) as JSONObject;

                if (canonicalJSON(restamped(changeSet['changes'] ?? null, createdAt, '')) !== canonicalJSON(changeSet['changes'] ?? null))
                    return;

                checked++;

                const json = without(changeSet, 'signatures');
                set(json, 'createdAt', new Date(Date.parse(last) - 60 * 60 * 1000).toISOString());
                set(json, 'afterETags', RoamingNetwork.parse(expected).changeSetETags().map(eTag => etagToJSON(eTag)));
                set(json, '@id', changeSetIdentification(json));

                expect(applyChangeSet(before, ChangeSet.parse(json), { checkOwnership: false }).content, `Epoch ${epoch}, revision ${index + 1}`).toEqual(expected);

            });

        expect(checked).toBeGreaterThan(15);

    });

    it('stamps a change set created after its version with its createdAt', () => {

        const before = defined(versions[9]);
        const later  = defined(changeSetsJSON[9]);

        expect(Date.parse(asText(later['createdAt']))).toBeGreaterThan(Date.parse(asText(before.content['lastChange'])));
        expect(applyChangeSet(before, ChangeSet.parse(later), { checkOwnership: false }).content['lastChange']).toBe(later['createdAt']);

    });

});
