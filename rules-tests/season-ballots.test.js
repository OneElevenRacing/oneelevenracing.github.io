// Realtime Database rules tests for season-planning ballots.
// Run with `npm run test:rules` (starts the local emulator; never touches live data).
const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { ref, get, set, update, remove, increment, serverTimestamp } = require('firebase/database');
const SB = require('../season-ballot.js');

const HOUR = 60 * 60 * 1000;
const DRIVER_IDS = ['alice', 'bob', 'dan', 'eve', 'fay', 'gus', 'hal', 'ivy'];
let env;
let submissionCounter = 0;

const db = uid => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).database();
const admin = () => db('admin');
const read = async p => {
    let value;
    await env.withSecurityRulesDisabled(async ctx => { value = (await get(ref(ctx.database(), p))).val(); });
    return value;
};
const seed = async (p, value) => env.withSecurityRulesDisabled(ctx => set(ref(ctx.database(), p), value));

function options(count, prefix = 'c') {
    const list = {};
    for (let i = 0; i < count; i++) list[`${prefix}${i}`] = { label: `Option ${i}` };
    return list;
}

function choiceDefinition({ optionCount = 10, pick = 5 } = {}) {
    return {
        schema: 1, revision: 1, title: 'Car class round 1', questionCount: 1,
        questions: { 0: { id: 'cars', index: 0, kind: 'choice', type: 'multi', required: true, prompt: `Choose ${pick}`, minSelections: pick, maxSelections: pick, options: options(optionCount) } }
    };
}

function comboDefinition() {
    return {
        schema: 1, revision: 1, title: 'Suggestions and rules', questionCount: 4,
        questions: {
            0: { id: 'nominate', index: 0, kind: 'nomination', type: 'nomination', required: true, prompt: 'Suggest classes', minSelections: 0, maxSelections: 4, options: options(4), allowWriteIns: true, maxWriteIns: 200 },
            1: { id: 'rule1', index: 1, kind: 'choice', type: 'yesno', required: true, prompt: 'Allow ghosting?', minSelections: 1, maxSelections: 1, options: { yes: { label: 'Yes' }, no: { label: 'No' } } },
            2: { id: 'notes', index: 2, kind: 'text', type: 'long-text', required: false, prompt: 'Anything else?', maxLength: 2000 },
            3: { id: 'track', index: 3, kind: 'choice', type: 'track', required: true, prompt: 'Pick a layout', minSelections: 1, maxSelections: 1,
                options: { 'brands-gp': { label: 'Brands Hatch GP', locationId: 'brands', locationName: 'Brands Hatch' }, 'brands-indy': { label: 'Brands Hatch Indy', locationId: 'brands', locationName: 'Brands Hatch' }, monza: { label: 'Monza', locationId: 'monza', locationName: 'Monza' } } }
        }
    };
}

function control(overrides = {}) {
    return { opensAt: Date.now() - HOUR, closesAt: Date.now() + HOUR, resultVisibility: 'live', labelsHidden: true, allDrivers: true, ...overrides };
}

async function publish(pollId, definition, controlOverrides) {
    await assertSucceeds(update(ref(admin()), SB.publishUpdates({ pollId, definition, control: control(controlOverrides) })));
}

function submission(uid, pollId, definition, raw) {
    return SB.submissionUpdates({
        pollId, uid, definition, answers: SB.normaliseAnswers(definition, raw),
        submissionId: `sub-${++submissionCounter}`, increment, timestamp: serverTimestamp()
    });
}

const submit = (uid, pollId, definition, raw) => update(ref(db(uid)), submission(uid, pollId, definition, raw));
// An admin change to a published poll's control, with its audit entry. These polls
// have no hub index entry, so the index fields are left out.
const controlChange = (pollId, changes, adminUid = 'admin') => Object.fromEntries(Object.entries(SB.controlUpdates({
    pollId, before: {}, changes, auditId: `audit-${++submissionCounter}`, adminUid,
    reason: 'Test change', action: 'update-control', timestamp: serverTimestamp()
})).filter(([p]) => !p.includes('/index/')));
const pick = (...indexes) => indexes.map(i => `c${i}`);
const totals = pollId => read(`${SB.pollPath(pollId)}/totals`);

before(async () => {
    const [host, port] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000').split(':');
    env = await initializeTestEnvironment({
        projectId: 'demo-one-eleven',
        database: { host, port: Number(port), rules: readFileSync(path.join(__dirname, '../database.rules.json'), 'utf8') }
    });
});

beforeEach(async () => {
    await env.clearDatabase();
    const driver = (name, extra = {}) => ({ active: true, isAdmin: false, name, carName: 'Car', carImage: 'car.png', ...extra });
    const drivers = Object.fromEntries(DRIVER_IDS.map(id => [id, driver(id)]));
    drivers.carol = driver('carol', { active: false });
    drivers.admin = driver('admin', { isAdmin: true });
    drivers.admin2 = driver('admin2', { isAdmin: true });
    await seed('/', {
        drivers, race_date: 'Sat 1 Nov 2026', race_time: '7.00pm', race_location: 'Monza',
        weather1: 'TBD', weather2: 'TBD', xoyondo_link: '', seasonData: { seasonNumber: '9', racingClass: 'GT3' }
    });
});

after(async () => { await env.cleanup(); });

describe('who can vote', () => {
    it('accepts a valid ballot and counts it exactly once', async () => {
        const def = choiceDefinition();
        await publish('r1', def);
        await assertSucceeds(submit('alice', 'r1', def, [{ selections: pick(0, 1, 2, 3, 4) }]));
        const t = await totals('r1');
        assert.equal(t.respondents, 1);
        assert.deepEqual(t.questions[0].options, { c0: 1, c1: 1, c2: 1, c3: 1, c4: 1, c5: 0, c6: 0, c7: 0, c8: 0, c9: 0 });
        const ballot = await read(`${SB.pollPath('r1')}/ballots/alice`);
        assert.equal(typeof ballot.submittedAt, 'number');
    });

    it('rejects signed-out, inactive and ineligible drivers', async () => {
        const def = choiceDefinition();
        await publish('r1', def, { allDrivers: false, eligible: { alice: true } });
        const updates = submission('nobody', 'r1', def, [{ selections: pick(0, 1, 2, 3, 4) }]);
        await assertFails(update(ref(db(null)), updates));
        await assertFails(submit('carol', 'r1', def, [{ selections: pick(0, 1, 2, 3, 4) }]));
        await assertFails(submit('bob', 'r1', def, [{ selections: pick(0, 1, 2, 3, 4) }]));
        await assertSucceeds(submit('alice', 'r1', def, [{ selections: pick(0, 1, 2, 3, 4) }]));
    });

    it('rejects votes before opening and after closing, using server time', async () => {
        const def = choiceDefinition();
        await publish('early', def, { opensAt: Date.now() + HOUR, closesAt: Date.now() + 2 * HOUR });
        await publish('late', def, { opensAt: Date.now() - 2 * HOUR, closesAt: Date.now() - HOUR });
        await assertFails(submit('alice', 'early', def, [{ selections: pick(0, 1, 2, 3, 4) }]));
        await assertFails(submit('alice', 'late', def, [{ selections: pick(0, 1, 2, 3, 4) }]));
    });

    it('rejects votes on a poll an admin has closed early', async () => {
        const def = choiceDefinition();
        await publish('r1', def);
        await assertFails(update(ref(admin()), { [`${SB.pollPath('r1')}/control/state`]: 'closed' }), 'needs an audit entry');
        await assertSucceeds(update(ref(admin()), controlChange('r1', { state: 'closed' })));
        await assertFails(submit('alice', 'r1', def, [{ selections: pick(0, 1, 2, 3, 4) }]));
    });
});

describe('selection counts and options', () => {
    it('a choose-five ballot rejects four, six and duplicate selections', async () => {
        const def = choiceDefinition();
        await publish('r1', def);
        await assertFails(submit('alice', 'r1', def, [{ selections: pick(0, 1, 2, 3) }]));
        await assertFails(submit('alice', 'r1', def, [{ selections: pick(0, 1, 2, 3, 4, 5) }]));
        // Bypass the browser's de-duplication to send a forged duplicate.
        const forged = SB.submissionUpdates({
            pollId: 'r1', uid: 'alice', definition: def, answers: [{ selections: pick(0, 1, 2, 3, 0), writeIns: [] }],
            submissionId: 'dup', increment, timestamp: serverTimestamp()
        });
        await assertFails(update(ref(db('alice')), forged));
        assert.equal((await totals('r1')).respondents, 0);
    });

    it('rejects unknown options, even with a matching counter', async () => {
        const def = choiceDefinition();
        await publish('r1', def);
        const updates = submission('alice', 'r1', def, [{ selections: ['c0', 'c1', 'c2', 'c3', 'zz'] }]);
        await assertFails(update(ref(db('alice')), updates));
        await seed(`${SB.pollPath('r1')}/totals/questions/0/options/zz`, 0);
        await assertFails(update(ref(db('alice')), updates));
    });

    it('rejects a forged count that does not match the slots', async () => {
        const def = choiceDefinition();
        await publish('r1', def);
        const updates = submission('alice', 'r1', def, [{ selections: pick(0, 1, 2, 3, 4) }]);
        const base = `${SB.pollPath('r1')}/ballots/alice`;
        // Claim five, but remove the fifth slot and its counter.
        delete updates[base].answers[0].slots[4];
        delete updates[base].answers[0].byOption.c4;
        delete updates[`${SB.pollPath('r1')}/totals/questions/0/options/c4`];
        await assertFails(update(ref(db('alice')), updates));
        // Slots with a gap (0,1,2,3,5) for a claimed count of five.
        const gap = submission('alice', 'r1', def, [{ selections: pick(0, 1, 2, 3, 4) }]);
        const answer = gap[base].answers[0];
        answer.slots = { 0: 'c0', 1: 'c1', 2: 'c2', 3: 'c3', 5: 'c4' };
        answer.byOption.c4 = 5;
        await assertFails(update(ref(db('alice')), gap));
    });

    it('rejects a ballot without its counters, and counters without a ballot', async () => {
        const def = choiceDefinition();
        await publish('r1', def);
        const updates = submission('alice', 'r1', def, [{ selections: pick(0, 1, 2, 3, 4) }]);
        const ballotPath = `${SB.pollPath('r1')}/ballots/alice`;
        const ballotOnly = { [ballotPath]: updates[ballotPath] };
        await assertFails(update(ref(db('alice')), ballotOnly));
        const countersOnly = { ...updates };
        delete countersOnly[ballotPath];
        await assertFails(update(ref(db('alice')), countersOnly));
        const missingOne = { ...updates };
        delete missingOne[`${SB.pollPath('r1')}/totals/questions/0/options/c2`];
        await assertFails(update(ref(db('alice')), missingOne));
        const doubled = { ...updates, [`${SB.pollPath('r1')}/totals/questions/0/options/c2`]: increment(2) };
        await assertFails(update(ref(db('alice')), doubled));
        const extra = { ...updates, [`${SB.pollPath('r1')}/totals/questions/0/options/c9`]: increment(1) };
        await assertFails(update(ref(db('alice')), extra));
        const noRespondent = { ...updates };
        delete noRespondent[`${SB.pollPath('r1')}/totals/respondents`];
        await assertFails(update(ref(db('alice')), noRespondent));
        assert.deepEqual(SB.compareTotals(SB.emptyTotals(def), await totals('r1')), []);
    });

    it('rejects a client-chosen submission time', async () => {
        const def = choiceDefinition();
        await publish('r1', def);
        const updates = submission('alice', 'r1', def, [{ selections: pick(0, 1, 2, 3, 4) }]);
        updates[`${SB.pollPath('r1')}/ballots/alice`].submittedAt = Date.now() - HOUR;
        await assertFails(update(ref(db('alice')), updates));
    });
});

describe('one ballot per driver', () => {
    it('rejects resubmitting, editing, deleting and voting as someone else', async () => {
        const def = choiceDefinition();
        await publish('r1', def);
        await assertSucceeds(submit('alice', 'r1', def, [{ selections: pick(0, 1, 2, 3, 4) }]));
        const ballotPath = `${SB.pollPath('r1')}/ballots/alice`;
        await assertFails(submit('alice', 'r1', def, [{ selections: pick(5, 6, 7, 8, 9) }]));
        await assertFails(set(ref(db('alice'), `${ballotPath}/answers/0/slots/0`), 'c9'));
        await assertFails(remove(ref(db('alice'), ballotPath)));
        const asBob = submission('bob', 'r1', def, [{ selections: pick(5, 6, 7, 8, 9) }]);
        await assertFails(update(ref(db('alice')), asBob));
        assert.equal((await totals('r1')).respondents, 1);
    });

    it('a replayed submission (double tap, retry, second tab) counts once', async () => {
        const def = choiceDefinition();
        await publish('r1', def);
        const updates = submission('alice', 'r1', def, [{ selections: pick(0, 1, 2, 3, 4) }]);
        const results = await Promise.allSettled([1, 2, 3].map(() => update(ref(db('alice')), updates)));
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        await assertFails(update(ref(db('alice')), updates));
        const t = await totals('r1');
        assert.equal(t.respondents, 1);
        assert.equal(t.questions[0].options.c0, 1);
        // The client can confirm a lost acknowledgement by reading its own submission ID.
        const saved = (await get(ref(db('alice'), `${SB.pollPath('r1')}/ballots/alice/submissionId`))).val();
        assert.equal(saved, updates[`${SB.pollPath('r1')}/ballots/alice`].submissionId);
    });

    it('concurrent votes from many drivers produce exact totals', async () => {
        const def = choiceDefinition();
        await publish('r1', def);
        await Promise.all(DRIVER_IDS.map((uid, i) => submit(uid, 'r1', def, [{ selections: pick(0, 1, 2, 3, 4 + (i % 2)) }])));
        const t = await totals('r1');
        assert.equal(t.respondents, DRIVER_IDS.length);
        assert.equal(t.questions[0].options.c0, 8);
        assert.equal(t.questions[0].options.c4, 4);
        assert.equal(t.questions[0].options.c5, 4);
        assert.deepEqual(SB.compareTotals(SB.computeTotals(def, await read(`${SB.pollPath('r1')}/ballots`)), t), []);
    });
});

describe('privacy and result visibility', () => {
    it('drivers read only their own ballot, including through parent paths', async () => {
        const def = choiceDefinition();
        await publish('r1', def);
        await assertSucceeds(submit('alice', 'r1', def, [{ selections: pick(0, 1, 2, 3, 4) }]));
        const base = SB.pollPath('r1');
        await assertSucceeds(get(ref(db('alice'), `${base}/ballots/alice`)));
        for (const p of [`${base}/ballots/alice`, `${base}/ballots`, base, 'seasonPlanning/v1/polls', 'seasonPlanning', '/']) {
            await assertFails(get(ref(db('bob'), p)));
        }
        await assertSucceeds(get(ref(admin(), `${base}/ballots`)));
    });

    it('totals follow the result-visibility setting', async () => {
        const def = choiceDefinition();
        await publish('live', def, { resultVisibility: 'live' });
        await publish('hidden', def, { resultVisibility: 'hidden' });
        await publish('snap', def, { resultVisibility: 'snapshot' });
        await publish('after', def, { resultVisibility: 'afterClose' });
        await publish('afterDone', def, { resultVisibility: 'afterClose', opensAt: Date.now() - 2 * HOUR, closesAt: Date.now() - HOUR });
        const t = id => get(ref(db('bob'), `${SB.pollPath(id)}/totals`));
        await assertSucceeds(t('live'));
        await assertFails(t('hidden'));
        await assertFails(t('snap'));
        await assertFails(t('after'));
        await assertSucceeds(t('afterDone'));
        await assertFails(get(ref(db('carol'), `${SB.pollPath('live')}/totals`)));
        await assertSucceeds(get(ref(admin(), `${SB.pollPath('hidden')}/totals`)));
    });

    it('drafts are hidden from drivers and published questions are frozen', async () => {
        const def = choiceDefinition();
        const base = SB.pollPath('d1');
        await assertSucceeds(update(ref(admin()), { [`${base}/definition`]: def, [`${base}/control`]: { ...control(), state: 'draft' } }));
        await assertFails(get(ref(db('alice'), `${base}/definition`)));
        await assertSucceeds(set(ref(admin(), `${base}/definition/title`), 'Edited draft'));
        await assertFails(update(ref(admin()), SB.publishUpdates({ pollId: 'd1', definition: def, control: control() })));
        const republish = SB.publishUpdates({ pollId: 'd1', definition: def, control: { ...control(), lastAuditId: 'publish-d1' } });
        republish[`${base}/audit/publish-d1`] = { at: serverTimestamp(), by: 'admin', action: 'publish', reason: 'Publishing the draft' };
        await assertSucceeds(update(ref(admin()), republish));
        await assertSucceeds(get(ref(db('alice'), `${base}/definition`)));
        await assertFails(set(ref(admin(), `${base}/definition/title`), 'Edited after publishing'));
        await assertFails(update(ref(admin()), controlChange('d1', { state: 'draft' })));
        await assertFails(set(ref(db('alice'), `${base}/definition/title`), 'Driver edit'));
        await assertFails(set(ref(db('alice'), `${base}/control/closesAt`), Date.now() + 9 * HOUR));
        await assertFails(set(ref(admin(), `${base}/control/closesAt`), Date.now() + 9 * HOUR), 'needs an audit entry');
        await assertSucceeds(update(ref(admin()), controlChange('d1', { closesAt: Date.now() + 9 * HOUR })));
    });
});

describe('combined forms', () => {
    const valid = () => [
        { selections: ['c0', 'c2'], writeIns: ['Group C', '  Formula Vee  '] },
        { selections: ['yes'] },
        { text: 'More night races please' },
        { selections: ['brands-indy'] }
    ];

    it('accepts a full combined form and counts every question', async () => {
        const def = comboDefinition();
        await publish('f1', def);
        await assertSucceeds(submit('alice', 'f1', def, valid()));
        const ballot = await read(`${SB.pollPath('f1')}/ballots/alice`);
        assert.equal(ballot.answers[0].writeIns[1].text, 'Formula Vee');
        const t = await totals('f1');
        assert.equal(t.questions[0].options.c2, 1);
        assert.equal(t.questions[1].options.yes, 1);
        assert.equal(t.questions[3].options['brands-indy'], 1);
    });

    it('allows skipping optional questions but not required ones', async () => {
        const def = comboDefinition();
        await publish('f1', def);
        const skipRequired = valid();
        skipRequired[1] = { skipped: true };
        const updates = submission('alice', 'f1', def, skipRequired);
        updates[`${SB.pollPath('f1')}/ballots/alice`].answers[1] = { skipped: true };
        await assertFails(update(ref(db('alice')), updates));
        const skipOptional = valid();
        skipOptional[2] = { skipped: true };
        await assertSucceeds(submit('alice', 'f1', def, skipOptional));
    });

    it('rejects a form with a missing answer entry', async () => {
        const def = comboDefinition();
        await publish('f1', def);
        const updates = submission('alice', 'f1', def, valid());
        delete updates[`${SB.pollPath('f1')}/ballots/alice`].answers[2];
        await assertFails(update(ref(db('alice')), updates));
    });

    it('requires at least one suggestion on a required nomination question', async () => {
        const def = comboDefinition();
        await publish('f1', def);
        const empty = valid();
        empty[0] = { selections: [], writeIns: [] };
        await assertFails(submit('alice', 'f1', def, empty));
        const writeInOnly = valid();
        writeInOnly[0] = { selections: [], writeIns: ['Something new'] };
        await assertSucceeds(submit('alice', 'f1', def, writeInOnly));
    });

    it('enforces text and write-in limits', async () => {
        const def = comboDefinition();
        await publish('f1', def);
        const longText = valid();
        longText[2] = { text: 'x'.repeat(2001) };
        await assertFails(submit('alice', 'f1', def, longText));
        const tooMany = valid();
        tooMany[0] = { selections: [], writeIns: Array.from({ length: 201 }, (_, i) => `Idea ${i}`) };
        await assertFails(submit('alice', 'f1', def, tooMany));
        const atLimit = valid();
        atLimit[0] = { selections: ['c0', 'c1', 'c2', 'c3'], writeIns: Array.from({ length: 200 }, (_, i) => `${i} `.padEnd(2000, 'y')) };
        await assertSucceeds(submit('bob', 'f1', def, atLimit));
    });

    it('rejects a second track layout or a text answer on a choice question', async () => {
        const def = comboDefinition();
        await publish('f1', def);
        const twoTracks = valid();
        twoTracks[3] = { selections: ['brands-gp', 'monza'] };
        await assertFails(submit('alice', 'f1', def, twoTracks));
        const updates = submission('alice', 'f1', def, valid());
        updates[`${SB.pollPath('f1')}/ballots/alice`].answers[1].text = 'yes';
        await assertFails(update(ref(db('alice')), updates));
    });
});

describe('supported limits', () => {
    it('accepts choosing all 1,000 options of a question', async () => {
        const def = choiceDefinition({ optionCount: 1000, pick: 1000 });
        await publish('big', def);
        const all = Array.from({ length: 1000 }, (_, i) => `c${i}`);
        await assertSucceeds(submit('alice', 'big', def, [{ selections: all }]));
        const t = await totals('big');
        assert.equal(t.questions[0].options.c999, 1);
        await assertFails(submit('bob', 'big', def, [{ selections: all.slice(1) }]));
    });

    it('accepts a 50-question form', async () => {
        const questions = {};
        for (let i = 0; i < 50; i++) {
            questions[i] = { id: `q${i}`, index: i, kind: 'choice', type: 'single', required: true, prompt: `Question ${i}`, minSelections: 1, maxSelections: 1, options: { yes: { label: 'Yes' }, no: { label: 'No' } } };
        }
        const def = { schema: 1, revision: 1, title: 'Long form', questionCount: 50, questions };
        await publish('long', def);
        await assertSucceeds(submit('alice', 'long', def, Array.from({ length: 50 }, (_, i) => ({ selections: [i % 2 ? 'yes' : 'no'] }))));
        assert.equal((await totals('long')).questions[49].options.yes, 1);
        const tooMany = { ...def, questionCount: 51, questions: { ...questions, 50: { ...questions[49], id: 'q50', index: 50 } } };
        await assertFails(update(ref(admin()), SB.publishUpdates({ pollId: 'toolong', definition: tooMany, control: control() })));
    });
});

describe('admin corrections and recounts', () => {
    async function correction(adminUid, oldBallot, answers, reason = 'Driver asked to change their vote') {
        return SB.correctionUpdates({
            pollId: 'r1', uid: 'alice', definition: choiceDefinition(), oldBallot, answers,
            auditId: `audit-${++submissionCounter}`, adminUid, reason, increment, timestamp: serverTimestamp()
        });
    }

    it('adjusts totals once and keeps the previous answers in history', async () => {
        const def = choiceDefinition();
        await publish('r1', def);
        await assertSucceeds(submit('alice', 'r1', def, [{ selections: pick(0, 1, 2, 3, 4) }]));
        const oldBallot = await read(`${SB.pollPath('r1')}/ballots/alice`);
        const updates = await correction('admin', oldBallot, [{ selections: pick(0, 1, 2, 3, 9) }]);
        await assertSucceeds(update(ref(admin()), updates));
        const t = await totals('r1');
        assert.equal(t.respondents, 1);
        assert.equal(t.questions[0].options.c4, 0);
        assert.equal(t.questions[0].options.c9, 1);
        const ballot = await read(`${SB.pollPath('r1')}/ballots/alice`);
        assert.equal(ballot.revision, 2);
        assert.equal(ballot.submittedAt, oldBallot.submittedAt);
        const audit = Object.values(await read(`${SB.pollPath('r1')}/audit`));
        assert.equal(audit.length, 1);
        assert.deepEqual(audit[0].before.answers, oldBallot.answers);
        assert.equal(audit[0].by, 'admin');
        await assertFails(get(ref(db('alice'), `${SB.pollPath('r1')}/audit`)));
    });

    it('stops a second admin silently overwriting the first', async () => {
        const def = choiceDefinition();
        await publish('r1', def);
        await assertSucceeds(submit('alice', 'r1', def, [{ selections: pick(0, 1, 2, 3, 4) }]));
        const oldBallot = await read(`${SB.pollPath('r1')}/ballots/alice`);
        const first = await correction('admin', oldBallot, [{ selections: pick(0, 1, 2, 3, 9) }]);
        // Touches different options, so only the revision check can stop it.
        const second = await correction('admin2', oldBallot, [{ selections: pick(0, 1, 2, 8, 4) }]);
        await assertSucceeds(update(ref(db('admin')), first));
        await assertFails(update(ref(db('admin2')), second));
        assert.equal((await totals('r1')).questions[0].options.c8, 0);
    });

    it('rejects corrections without an audit entry, and corrections by drivers', async () => {
        const def = choiceDefinition();
        await publish('r1', def);
        await assertSucceeds(submit('alice', 'r1', def, [{ selections: pick(0, 1, 2, 3, 4) }]));
        const oldBallot = await read(`${SB.pollPath('r1')}/ballots/alice`);
        const updates = await correction('admin', oldBallot, [{ selections: pick(0, 1, 2, 3, 9) }]);
        const withoutAudit = Object.fromEntries(Object.entries(updates).filter(([p]) => !p.includes('/audit/')));
        await assertFails(update(ref(admin()), withoutAudit));
        const byDriver = await correction('alice', oldBallot, [{ selections: pick(0, 1, 2, 3, 9) }]);
        await assertFails(update(ref(db('alice')), byDriver));
        const blankReason = await correction('admin', oldBallot, [{ selections: pick(0, 1, 2, 3, 9) }], '');
        await assertFails(update(ref(admin()), blankReason));
    });

    it('a recount finds and repairs wrong totals', async () => {
        const def = choiceDefinition();
        await publish('r1', def);
        await assertSucceeds(submit('alice', 'r1', def, [{ selections: pick(0, 1, 2, 3, 4) }]));
        await assertSucceeds(submit('bob', 'r1', def, [{ selections: pick(0, 1, 2, 3, 5) }]));
        await assertSucceeds(set(ref(admin(), `${SB.pollPath('r1')}/totals/questions/0/options/c4`), 7));
        const expected = SB.computeTotals(def, (await get(ref(admin(), `${SB.pollPath('r1')}/ballots`))).val());
        const differences = SB.compareTotals(expected, (await get(ref(admin(), `${SB.pollPath('r1')}/totals`))).val());
        assert.deepEqual(differences, [{ path: 'questions/0/options/c4', expected: 1, actual: 7 }]);
        await assertSucceeds(set(ref(admin(), `${SB.pollPath('r1')}/totals`), expected));
        assert.deepEqual(SB.compareTotals(expected, await totals('r1')), []);
        await assertFails(set(ref(db('alice'), `${SB.pollPath('r1')}/totals/questions/0/options/c4`), 1));
    });
});

describe('existing site data under the tightened read rules', () => {
    it('active drivers still read race info, drivers and season data', async () => {
        for (const p of ['race_date', 'race_time', 'race_location', 'weather1', 'weather2', 'xoyondo_link', 'seasonData', 'drivers', 'drivers/bob/name']) {
            await assertSucceeds(get(ref(db('alice'), p)));
            await assertFails(get(ref(db('carol'), p)));
            await assertFails(get(ref(db(null), p)));
        }
    });

    it('drivers lose root reads; admins keep them', async () => {
        await assertFails(get(ref(db('alice'), '/')));
        await assertSucceeds(get(ref(admin(), '/')));
    });

    it('existing writes behave as before', async () => {
        await assertSucceeds(set(ref(db('alice'), 'weather1'), 'Clear, 20°C'));
        await assertFails(set(ref(db('alice'), 'weather1'), 'Rain'));
        await assertFails(set(ref(db('alice'), 'race_date'), 'Sun 2 Nov 2026'));
        await assertSucceeds(update(ref(admin()), { race_date: 'Sun 2 Nov 2026', race_time: '7.00pm' }));
        await assertSucceeds(set(ref(db('alice'), 'drivers/alice/carName'), 'New car'));
        await assertFails(set(ref(db('alice'), 'drivers/alice/isAdmin'), true));
    });
});
