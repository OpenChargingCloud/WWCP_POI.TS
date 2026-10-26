import { describe, expect, it } from 'vitest';

import { defined } from './helpers.ts';
import { commits } from './qa.ts';

import { ChangeSet, CHANGE_SET_CONTEXT, changeSetIdentification } from '../src/history/changeSet.ts';
import { canonicalJSON } from '../src/json/canonical.ts';
import { clone, isObject, set, without, type JSONArray, type JSONObject, type JSONValue } from '../src/json/value.ts';
import { hash }          from '../src/crypto/hash.ts';
import { toHex, utf8 }   from '../src/encoding/text.ts';


// A change set is identified by its content (SPECIFICATION.md section 4), so that nobody commits another one in the place
// of one, e.g. of one waiting for signatures (csharp-review 4). One rebased names those it was rebased
// from by their @id and ETags, which everyone calculates again.

const changeSets = [ ...commits('published/QA-commits-since-genesis.json'), ...commits('published/QA-epoch-2-commits-since-genesis.json') ]
                       .map(commit => defined((commit as JSONObject)['changeSet'], 'The change set of a commit') as JSONObject);

const first  = defined(changeSets[0]);
const second = defined(changeSets[1]);

/** What names a change set in rebasedFrom: its @id and its ETags. */
const entry = (changeSet: JSONObject): JSONObject => ({
    '@id':        defined(changeSet['@id']),
    beforeETags:  defined(changeSet['beforeETags']),
    afterETags:   defined(changeSet['afterETags']),
});

/** The given change set rebased to the ETags of another one, unsigned, naming the given entries, identified by its content. */
function rebased(from: JSONObject, entries: JSONValue, eTagsOf: JSONObject): JSONObject {

    const changeSet = without(from, 'signatures');
    const metadata  = isObject(from['metadata']) ? clone(from['metadata']) : {};

    set(metadata,  'rebasedFrom', clone(entries));
    set(changeSet, 'metadata',    metadata);
    set(changeSet, 'beforeETags', clone(defined(eTagsOf['beforeETags'])));
    set(changeSet, 'afterETags',  clone(defined(eTagsOf['afterETags'])));
    set(changeSet, '@id',         changeSetIdentification(changeSet));

    return changeSet;

}


describe('Change sets identified by their content (4)', () => {

    it('identifies every change set of the run by the SHA-256 of its content, without @id and signatures', () => {

        expect(changeSets.length).toBeGreaterThan(10);

        for (const changeSet of changeSets) {
            expect(changeSet['@id']).toBe(changeSetIdentification(changeSet));
            expect(ChangeSet.parse(changeSet).id).toBe(changeSet['@id']);
        }

        const content = without(first, '@id', 'signatures');
        set(content, '@context', CHANGE_SET_CONTEXT);
        expect(first['@id']).toBe(toHex(hash('sha256', utf8(canonicalJSON(content)))));

    });

    it('refuses a change set changed, or named by the @id of another one', () => {

        const changed = clone(first);
        set(changed, 'description', { en: 'Another one' });
        expect(() => ChangeSet.parse(changed)).toThrow(/is not identified by its content/);

        const otherId = clone(first);
        set(otherId, '@id', defined(second['@id']));
        expect(() => ChangeSet.parse(otherId)).toThrow(/is not identified by its content/);

    });

    it('takes a change set naming what it was rebased from, once and twice, and nothing else', () => {

        const once  = rebased(first, [ entry(first) ], second);
        const twice = rebased(first, [ entry(first), entry(once) ], first);

        expect(ChangeSet.parse(once).id).toBe(once['@id']);
        expect(ChangeSet.parse(twice).id).toBe(twice['@id']);

        // Another change set, other ETags, another order, without its afterETags, or naming none: each identified anew,
        // so that only what it names is refused.
        expect(() => ChangeSet.parse(rebased(first, [ { ...entry(first), '@id': defined(second['@id']) } ], second))).toThrow(/not the change set it was rebased from/);
        expect(() => ChangeSet.parse(rebased(first, [ { ...entry(first), afterETags: defined(first['beforeETags']) } ], second))).toThrow(/not the change set it was rebased from/);
        expect(() => ChangeSet.parse(rebased(first, [ entry(once), entry(first) ], first))).toThrow(/not the change set it was rebased from/);
        expect(() => ChangeSet.parse(rebased(first, [ without(entry(first), 'afterETags') ], second))).toThrow(/must name the @id, the beforeETags and the afterETags/);
        expect(() => ChangeSet.parse(rebased(first, [], second))).toThrow(/must be an array/);

    });

    it('refuses a change set rebased with a change that names no old value, and reads it not rebased (csharp-review 12)', () => {

        const updating        = defined(changeSets.find(changeSet => (changeSet['changes'] as JSONArray).some(change => isObject(change) && change['kind'] !== 'Add' && change['kind'] !== 'AddElement')),
                                        'A change set of the run changing what is there');
        const other           = defined(changeSets.find(changeSet => changeSet !== updating));
        const withoutOldValue = without(updating, 'signatures');

        set(withoutOldValue, 'changes', (updating['changes'] as JSONArray).map(change => isObject(change) ? without(change, 'oldValue') : change));
        set(withoutOldValue, '@id',     changeSetIdentification(withoutOldValue));

        // Only old values tell that a change set committed meanwhile changed what it changes, which the rebase overwrote.
        expect(() => ChangeSet.parse(rebased(withoutOldValue, [ entry(withoutOldValue) ], other)))
            .toThrow(/Change \d+ of the change set '[0-9a-f]{64}', which was rebased, has no old value/);

        // Not rebased, its beforeETags pin the version it applies to.
        expect(ChangeSet.parse(withoutOldValue).id).toBe(withoutOldValue['@id']);

    });

});
