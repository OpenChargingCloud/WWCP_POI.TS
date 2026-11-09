import { describe, expect, it } from 'vitest';

import { defined } from './helpers.ts';
import { commitsOfEpoch1, genesis } from './qa.ts';

import type { RoamingNetwork } from '../src/network/roamingNetwork.ts';
import { ChangeSet, changeSetIdentification } from '../src/history/changeSet.ts';
import { applyChangeSet } from '../src/history/apply.ts';
import { canonicalJSON } from '../src/json/canonical.ts';
import { clone, isObject, set, without, type JSONArray, type JSONObject, type JSONValue } from '../src/json/value.ts';


// What a change set gives is what the content holds (SPECIFICATION.md section 4, "New values"; csharp-review 10):
// this library applies a new value as it is given, and refuses one the content would hold otherwise, as far
// as it can tell without the types of the values. The change sets of the run give every value so. Refused as WWCP_POI3
// refuses it (`TryHeldAsGiven`), after the party it changed is read again, naming what the content holds.

const changeSets = commitsOfEpoch1().map(commit => defined((commit as JSONObject)['changeSet'], 'The change set of a commit') as JSONObject);

/** QA from its genesis up to the version the change set of the given revision is applied to. */
function before(revision: number): RoamingNetwork {
    let version = genesis;
    for (const changeSet of changeSets.slice(0, revision - 1))
        version = applyChangeSet(version, ChangeSet.parse(changeSet), { checkOwnership: false });
    return version;
}

/** The change set of the given revision, unsigned, its first change as the given function changes it, identified anew. */
function changed(revision: number, change: (first: JSONObject) => void): ChangeSet {
    const json    = without(defined(changeSets[revision - 1]), 'signatures');
    const changes = clone(json['changes'] as JSONArray);
    change(defined(changes[0]) as JSONObject);
    set(json, 'changes', changes);
    set(json, '@id', changeSetIdentification(json));
    return ChangeSet.parse(json);
}

const newValue = (change: JSONObject): JSONObject =>
    defined(change['newValue'], 'The new value of a change') as JSONObject;

/** The new value of the first change of the change set of the given revision, as the run gives it. */
const given = (revision: number): JSONValue =>
    defined((defined(changeSets[revision - 1])['changes'] as JSONArray)[0] as JSONObject)['newValue'] ?? null;

/** The refusal of a new value the content holds otherwise, in the words of WWCP_POI3. */
const notHeld = (named: string, held: JSONValue): string =>
    `Change 0: ${named} is not given as the content holds it, '${canonicalJSON(held)}'!`;

const TARIFF = "the charging tariff 'DE*GEF*T_AC' to add";


describe('New values, given as the content holds them (4)', () => {

    it('applies the new values of the run as they are given', () => {

        const versionOf13 = before(13);

        expect(applyChangeSet(versionOf13, ChangeSet.parse(defined(changeSets[12])), { checkOwnership: false }).eTagsText())
            .toBe(before(14).eTagsText());

    });

    it('refuses an embedded object naming its JSON-LD context', () => {

        const withContext = changed(13, change => {
            const element = defined((change['newValue'] as JSONArray)[0]);
            if (isObject(element))
                element['@context'] = 'https://open.charging.cloud/contexts/wwcp/roamingNetwork/chargingTariffElement/v1';
        });

        expect(() => applyChangeSet(before(13), withContext, { checkOwnership: false }))
            .toThrow(notHeld("the property 'elements' of the charging tariff 'DE*GEF*T_AC'", given(13)));

        // Also an entity to add, which written on its own names its context.
        const tariff = changed(11, change => { newValue(change)['@context'] = 'https://open.charging.cloud/contexts/wwcp/roamingNetwork/chargingTariff/v1'; });

        expect(() => applyChangeSet(before(11), tariff, { checkOwnership: false }))
            .toThrow(notHeld(TARIFF, without(given(11) as JSONObject, 'lastChange')));

    });

    it('refuses keys not in the order of their identifications', () => {

        const reversed = changed(15, change => { change['newValue'] = [ ...(change['newValue'] as JSONArray) ].reverse(); });

        expect(() => applyChangeSet(before(15), reversed, { checkOwnership: false }))
            .toThrow(notHeld("the property 'identityKeys' of the roaming network operator 'OCC'", given(15)));

    });

    it('refuses a list given empty and a property given as null, which the content leaves out', () => {

        // As WWCP_POI refuses a new value the content does not hold at all, "e.g. an empty array written as none".
        const licenses = changed(11, change => { newValue(change)['dataLicenses'] = []; });

        expect(() => applyChangeSet(before(11), licenses, { checkOwnership: false }))
            .toThrow(notHeld(TARIFF, without(given(11) as JSONObject, 'lastChange')));

        const description = changed(11, change => { newValue(change)['description'] = null; });

        expect(() => applyChangeSet(before(11), description, { checkOwnership: false }))
            .toThrow(notHeld(TARIFF, without(given(11) as JSONObject, 'lastChange')));

        // Read again first: the roaming network operator without identity keys is none WWCP_POI3 reads.
        const empty = changed(15, change => { change['newValue'] = []; });

        expect(() => applyChangeSet(before(15), empty, { checkOwnership: false }))
            .toThrow("Change 0: The given JSON representation of a roaming network operator is invalid: The minConsensus 2 of the roaming network operator 'OCC' needs identity keys of as many holders!");

    });

    it('refuses a timestamp not UTC to the millisecond', () => {

        const created = changed(11, change => { newValue(change)['created'] = '2026-10-25T18:25:00+02:00'; });

        expect(() => applyChangeSet(before(11), created, { checkOwnership: false }))
            .toThrow(notHeld(TARIFF, { ...without(given(11) as JSONObject, 'lastChange'), created: '2026-10-25T16:25:00.000Z' }));

    });

    it('takes a JSON-LD context in custom data, which is held as given', () => {

        // Held as given, the value only leads to other after ETags than the change set names.
        const customData = changed(11, change => { newValue(change)['customData'] = { a: { '@context': 'c', b: 'd' } }; });

        expect(() => applyChangeSet(before(11), customData, { checkOwnership: false }))
            .toThrow(/The result does not match the change set/);

    });

});
