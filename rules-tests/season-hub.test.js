// Rules tests for the driver hub data: poll index, season plans, result snapshots,
// and the admin-only drafts, templates and settings.
const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { ref, get, set, update, remove, increment, serverTimestamp } = require('firebase/database');
const SB = require('../season-ballot.js');
const P = require('../season-polls-core.js');

const V1 = 'seasonPlanning/v1';
const HOUR = 3600000;
let env;
const db = uid => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).database();

const draft = (overrides = {}) => ({
    title: 'Car class round 1', kind: 'elimination', summary: 'Vote now', opensAt: Date.now() - HOUR, closesAt: Date.now() + HOUR,
    resultVisibility: 'live', labelsHidden: true, allDrivers: true, planId: 'season10', stageId: 'cars',
    questions: [{ ...P.blankQuestion('multi'), prompt: 'Pick two', options: ['A', 'B', 'C'], minSelections: 2, maxSelections: 2 }],
    ...overrides
});

// Everything the admin page writes when publishing a draft.
function publishAll(pollId, d) {
    const definition = P.buildDefinition(d, {});
    const control = P.buildControl(d);
    return { ...SB.publishUpdates({ pollId, definition, control }), [`${V1}/index/${pollId}`]: { ...P.indexEntry(d, control), updatedAt: serverTimestamp() } };
}

before(async () => {
    const [host, port] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000').split(':');
    env = await initializeTestEnvironment({
        projectId: 'demo-one-eleven-hub',
        database: { host, port: Number(port), rules: readFileSync(path.join(__dirname, '../database.rules.json'), 'utf8') }
    });
});

beforeEach(async () => {
    await env.clearDatabase();
    const driver = (name, extra = {}) => ({ active: true, isAdmin: false, name, carName: 'Car', carImage: 'car.png', ...extra });
    await env.withSecurityRulesDisabled(ctx => set(ref(ctx.database(), 'drivers'), {
        alice: driver('alice'), bob: driver('bob'), carol: driver('carol', { active: false }), admin: driver('admin', { isAdmin: true })
    }));
});

after(async () => { await env.cleanup(); });

describe('publishing and the hub index', () => {
    it('an admin publishes a draft with its index entry in one update; drivers read the index', async () => {
        await assertSucceeds(update(ref(db('admin')), publishAll('p1', draft())));
        await assertSucceeds(get(ref(db('alice'), `${V1}/index`)));
        await assertFails(get(ref(db('carol'), `${V1}/index`)));
        await assertFails(set(ref(db('alice'), `${V1}/index/p1/title`), 'Hacked'));
        await assertFails(set(ref(db('admin'), `${V1}/index/p2`), { title: 'Missing fields' }));
    });

    it('control changes keep the index in step and are audited', async () => {
        await assertSucceeds(update(ref(db('admin')), publishAll('p1', draft())));
        const change = SB.controlUpdates({ pollId: 'p1', before: { closesAt: 1 }, changes: { closesAt: Date.now() + 5 * HOUR, resultVisibility: 'afterClose' },
            auditId: 'a1', adminUid: 'admin', reason: 'Extended by two days', action: 'update-control', timestamp: serverTimestamp() });
        await assertSucceeds(update(ref(db('admin')), change));
        const withoutAudit = SB.controlUpdates({ pollId: 'p1', before: {}, changes: { state: 'closed' }, auditId: 'a1', adminUid: 'admin', reason: 'Reused id', action: 'close', timestamp: serverTimestamp() });
        await assertFails(update(ref(db('admin')), withoutAudit), 'an audit ID cannot be reused');
    });
});

describe('season plans', () => {
    const plan = { title: 'Season 10 planning', intro: 'Help shape the season', status: 'active', stageCount: 2,
        stages: [{ id: 'ideas', label: 'Suggestions' }, { id: 'cars', label: 'Car votes' }] };

    it('drivers read plans; only admins write them, with valid stages', async () => {
        await assertSucceeds(set(ref(db('admin'), `${V1}/plans/season10`), plan));
        await assertSucceeds(get(ref(db('alice'), `${V1}/plans`)));
        await assertFails(set(ref(db('alice'), `${V1}/plans/season10/title`), 'Mine'));
        await assertFails(set(ref(db('admin'), `${V1}/plans/bad`), { ...plan, stages: [{ id: 'Bad Id', label: 'x' }] }));
        await assertFails(set(ref(db('admin'), `${V1}/plans/bad`), { ...plan, stageCount: 13 }));
    });

    it('admins publish a season summary that drivers can read', async () => {
        await assertSucceeds(set(ref(db('admin'), `${V1}/plans/season10`), plan));
        const summary = { publishedAt: serverTimestamp(), title: 'Season 10', winner: { label: 'GT4' }, calendar: [{ label: 'Monza', source: 'random' }] };
        await assertFails(set(ref(db('alice'), `${V1}/plans/season10/summary`), summary));
        await assertFails(set(ref(db('admin'), `${V1}/plans/season10/summary`), { title: 'No date' }));
        await assertSucceeds(set(ref(db('admin'), `${V1}/plans/season10/summary`), summary));
        await assertSucceeds(get(ref(db('alice'), `${V1}/plans/season10/summary`)));
    });
});

describe('result snapshots', () => {
    it('drivers read a published snapshot only when the poll uses snapshot results', async () => {
        await assertSucceeds(update(ref(db('admin')), publishAll('snap', draft({ resultVisibility: 'snapshot' }))));
        await assertSucceeds(update(ref(db('admin')), publishAll('live', draft({ resultVisibility: 'live' }))));
        const snapshot = { at: serverTimestamp(), by: 'admin', totals: { respondents: 3 } };
        await assertSucceeds(set(ref(db('admin'), `${SB.pollPath('snap')}/snapshot`), snapshot));
        await assertSucceeds(set(ref(db('admin'), `${SB.pollPath('live')}/snapshot`), snapshot));
        await assertFails(set(ref(db('alice'), `${SB.pollPath('snap')}/snapshot`), snapshot));
        await assertSucceeds(get(ref(db('alice'), `${SB.pollPath('snap')}/snapshot`)));
        await assertFails(get(ref(db('alice'), `${SB.pollPath('snap')}/totals`)));
        await assertFails(get(ref(db('alice'), `${SB.pollPath('live')}/snapshot`)));
        await assertFails(get(ref(db('carol'), `${SB.pollPath('snap')}/snapshot`)));
    });

    it('ineligible drivers cannot read a snapshot', async () => {
        await assertSucceeds(update(ref(db('admin')), publishAll('snap', draft({ resultVisibility: 'snapshot', allDrivers: false, eligible: ['alice'] }))));
        await assertSucceeds(set(ref(db('admin'), `${SB.pollPath('snap')}/snapshot`), { at: serverTimestamp(), totals: { respondents: 0 } }));
        await assertSucceeds(get(ref(db('alice'), `${SB.pollPath('snap')}/snapshot`)));
        await assertFails(get(ref(db('bob'), `${SB.pollPath('snap')}/snapshot`)));
    });
});

describe('showing Polls & Forms to drivers', () => {
    it('drivers read the switch; only admins change it', async () => {
        await assertSucceeds(get(ref(db('alice'), `${V1}/visibility`)));
        await assertFails(get(ref(db('carol'), `${V1}/visibility`)));
        await assertFails(set(ref(db('alice'), `${V1}/visibility/drivers`), true));
        await assertSucceeds(set(ref(db('admin'), `${V1}/visibility`), { drivers: true, updatedAt: serverTimestamp(), updatedBy: 'admin' }));
        await assertFails(set(ref(db('admin'), `${V1}/visibility/drivers`), 'yes'));
    });
});

describe('admin-only drafts, templates and settings', () => {
    it('drivers can neither read nor write them (including season admin data)', async () => {
        await assertSucceeds(set(ref(db('admin'), `${V1}/drafts/d1`), draft()));
        await assertSucceeds(set(ref(db('admin'), `${V1}/templates/t1`), { name: 'My template', draft: draft() }));
        for (const p of [`${V1}/drafts`, `${V1}/drafts/d1`, `${V1}/templates`, `${V1}/settings`]) {
            await assertFails(get(ref(db('alice'), p)));
        }
        await assertFails(set(ref(db('alice'), `${V1}/drafts/d2`), draft()));
        await assertSucceeds(set(ref(db('admin'), `${V1}/planAdmin/season10/rounds/p1`), { number: 1 }));
        await assertFails(get(ref(db('alice'), `${V1}/planAdmin`)));
        await assertFails(get(ref(db('alice'), `${V1}/planAdmin/season10`)));
        await assertFails(set(ref(db('alice'), `${V1}/planAdmin/season10/winner`), { classId: 'mine' }));
        // A review decision for a 2,000-character write-in with control characters saves fine.
        const C = require('../catalogue.js');
        const text = `Group\u0000\u0007 ${'C'.repeat(1990)}`;
        await assertSucceeds(set(ref(db('admin'), `${V1}/planAdmin/season10/nominations/p1/${C.storageKey(C.nameKey(text), 'w')}`), { key: C.nameKey(text), action: 'exclude', note: 'Too long' }));
        await assertSucceeds(get(ref(db('admin'), `${V1}/drafts`)));
    });

    it('settings accept sensible defaults only', async () => {
        const a = db('admin');
        await assertSucceeds(set(ref(a, `${V1}/settings`), { ...P.DEFAULT_SETTINGS, instructions: 'Vote before Friday.' }));
        await assertFails(set(ref(a, `${V1}/settings/durationDays`), 0));
        await assertFails(set(ref(a, `${V1}/settings/targetEvents`), 25));
        await assertFails(set(ref(a, `${V1}/settings/resultVisibility`), 'public'));
        await assertFails(set(ref(a, `${V1}/settings/colour`), 'red'));
    });
});

describe('editing a live poll and deleting archived polls', () => {
    const vote = (uid, pollId, definition, selections) => SB.submissionUpdates({ pollId, uid, definition,
        answers: SB.normaliseAnswers(definition, [{ selections }]), submissionId: `s-${uid}`, increment, timestamp: serverTimestamp() });
    const current = async pollId => {
        let result;
        await env.withSecurityRulesDisabled(async ctx => {
            const [d, t] = await Promise.all([get(ref(ctx.database(), `${V1}/polls/${pollId}/definition`)), get(ref(ctx.database(), `${V1}/polls/${pollId}/totals`))]);
            result = { definition: d.val(), totals: t.val() };
        });
        return result;
    };
    const edit = (pollId, before, after, totals, auditId) => SB.liveEditUpdates({ pollId, before, after, totals, index: { title: after.title },
        auditId, adminUid: 'admin', reason: 'Fix wording', timestamp: serverTimestamp() });

    it('an admin edits a published poll with an audit entry; drivers and unaudited edits are refused', async () => {
        await assertSucceeds(update(ref(db('admin')), publishAll('p1', draft())));
        const { definition, totals } = await current('p1');
        const after = { ...definition, title: 'Renamed', questions: { 0: { ...definition.questions[0], prompt: 'Pick two classes' } } };
        await assertFails(update(ref(db('alice')), edit('p1', definition, after, totals, 'e1')), 'drivers cannot edit');
        const noAudit = edit('p1', definition, after, totals, 'e1');
        delete noAudit[`${V1}/polls/p1/audit/e1`];
        await assertFails(update(ref(db('admin')), noAudit), 'an edit needs its audit entry');
        await assertSucceeds(update(ref(db('admin')), edit('p1', definition, after, totals, 'e1')));
        const saved = await current('p1');
        assert.equal(saved.definition.revision, 2);
        assert.equal(saved.definition.title, 'Renamed');
    });

    it('an edit is refused if a vote arrived after the admin loaded the poll', async () => {
        await assertSucceeds(update(ref(db('admin')), publishAll('p1', draft())));
        const { definition, totals } = await current('p1');
        const ids = Object.keys(definition.questions[0].options);
        await assertSucceeds(update(ref(db('alice')), vote('alice', 'p1', definition, ids.slice(0, 2))));
        const after = { ...definition, title: 'Renamed' };
        await assertFails(update(ref(db('admin')), edit('p1', definition, after, totals, 'e1')), 'based on an out-of-date count');
        const fresh = await current('p1');
        await assertSucceeds(update(ref(db('admin')), edit('p1', fresh.definition, after, fresh.totals, 'e2')));
        // A vote still works against the edited poll.
        await assertSucceeds(update(ref(db('bob')), vote('bob', 'p1', (await current('p1')).definition, ids.slice(1, 3))));
    });

    it('only archived polls can be deleted, and only by an admin', async () => {
        await assertSucceeds(update(ref(db('admin')), publishAll('p1', draft())));
        await assertFails(remove(ref(db('admin'), `${V1}/polls/p1`)), 'a published poll cannot be deleted');
        const archive = SB.controlUpdates({ pollId: 'p1', before: { state: 'published' }, changes: { state: 'archived' }, auditId: 'a1', adminUid: 'admin', reason: 'Made by mistake', action: 'archive', timestamp: serverTimestamp() });
        await assertSucceeds(update(ref(db('admin')), archive));
        await assertFails(remove(ref(db('alice'), `${V1}/polls/p1`)), 'drivers cannot delete');
        await assertFails(remove(ref(db('admin'), `${V1}/polls/p1/ballots`)), 'parts of a poll cannot be deleted on their own');
        await assertSucceeds(update(ref(db('admin')), { [`${V1}/polls/p1`]: null, [`${V1}/index/p1`]: null }));
        assert.equal((await current('p1')).definition, null);
    });
});
