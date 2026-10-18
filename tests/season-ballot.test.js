const { test } = require('node:test');
const assert = require('node:assert/strict');
const SB = require('../season-ballot.js');

const definition = {
    schema: 1, revision: 1, title: 'Form', questionCount: 3,
    questions: {
        0: { id: 'cars', index: 0, kind: 'choice', required: true, minSelections: 3, maxSelections: 3, options: { a: {}, b: {}, c: {}, d: {} } },
        1: { id: 'ideas', index: 1, kind: 'nomination', required: false, minSelections: 0, maxSelections: 4, options: { a: {}, b: {} }, allowWriteIns: true, maxWriteIns: 2 },
        2: { id: 'notes', index: 2, kind: 'text', required: false, maxLength: 10 }
    }
};
const inc = n => ({ inc: n });

test('normaliseAnswers removes repeated choices, trims text and marks blanks as skipped', () => {
    const answers = SB.normaliseAnswers(definition, [
        { selections: ['a', 'b', 'a', 'c'] },
        { selections: [], writeIns: ['  Group C ', '', '   '], skipped: false },
        { text: '   ' }
    ]);
    assert.deepEqual(answers[0], { selections: ['a', 'b', 'c'], writeIns: [] });
    assert.deepEqual(answers[1], { selections: [], writeIns: ['Group C'] });
    assert.deepEqual(answers[2], { skipped: true });
});

test('validateAnswers explains wrong counts, unknown options and long text', () => {
    const messages = answers => SB.validateAnswers(definition, answers).map(e => `${e.question}: ${e.message}`);
    assert.deepEqual(messages([{ selections: ['a', 'b'] }, { skipped: true }, { skipped: true }]), ['0: Choose exactly 3.']);
    assert.deepEqual(messages([{ selections: ['a', 'b', 'z'] }, { skipped: true }, { skipped: true }]), ['0: An option is no longer available.']);
    assert.deepEqual(messages([{ selections: ['a', 'b', 'c'] }, { selections: [], writeIns: ['x', 'y', 'z'] }, { text: 'far too long text' }]),
        ['1: Too many written suggestions.', '2: Use 10 characters or fewer.']);
    assert.deepEqual(messages([{ skipped: true }, { skipped: true }, { skipped: true }]), ['0: This question needs an answer.']);
    assert.deepEqual(messages([{ selections: ['a', 'b', 'c'] }, { skipped: true }, { skipped: true }]), []);
});

test('submissionUpdates stores numbered slots with a reverse map and one counter per choice', () => {
    const answers = SB.normaliseAnswers(definition, [{ selections: ['c', 'a', 'd'] }, { writeIns: ['New'] }, {}]);
    const updates = SB.submissionUpdates({ pollId: 'p', uid: 'u', definition, answers, submissionId: 's', increment: inc, timestamp: 'NOW' });
    const ballot = updates['seasonPlanning/v1/polls/p/ballots/u'];
    assert.deepEqual(ballot.answers[0], { count: 3, slots: { 0: 'c', 1: 'a', 2: 'd' }, byOption: { c: 0, a: 1, d: 2 } });
    assert.deepEqual(ballot.answers[1], { count: 0, writeInCount: 1, writeIns: { 0: { n: 0, text: 'New' } } });
    assert.deepEqual(ballot.answers[2], { skipped: true });
    assert.equal(ballot.submittedAt, 'NOW');
    assert.deepEqual(Object.keys(updates).filter(p => p.includes('/totals/')).sort(), [
        'seasonPlanning/v1/polls/p/totals/questions/0/options/a',
        'seasonPlanning/v1/polls/p/totals/questions/0/options/c',
        'seasonPlanning/v1/polls/p/totals/questions/0/options/d',
        'seasonPlanning/v1/polls/p/totals/respondents'
    ]);
});

test('correctionUpdates changes only the counters whose answers changed', () => {
    const answers = SB.normaliseAnswers(definition, [{ selections: ['a', 'b', 'c'] }, {}, {}]);
    const { ['seasonPlanning/v1/polls/p/ballots/u']: oldBallot } = SB.submissionUpdates({ pollId: 'p', uid: 'u', definition, answers, submissionId: 's', increment: inc, timestamp: 1 });
    const updates = SB.correctionUpdates({
        pollId: 'p', uid: 'u', definition, oldBallot, answers: SB.normaliseAnswers(definition, [{ selections: ['a', 'b', 'd'] }, {}, {}]),
        auditId: 'x', adminUid: 'admin', reason: 'Typo', increment: inc, timestamp: 2
    });
    const counters = Object.fromEntries(Object.entries(updates).filter(([p]) => p.includes('/totals/')).map(([p, v]) => [p.split('/').pop(), v.inc]));
    assert.deepEqual(counters, { c: -1, d: 1 });
    assert.equal(updates['seasonPlanning/v1/polls/p/ballots/u'].revision, 2);
    assert.equal(updates['seasonPlanning/v1/polls/p/audit/x'].fromRevision, 1);
});

test('computeTotals and compareTotals report every difference, including unexpected options', () => {
    const ballots = {
        u1: { answers: { 0: { count: 3, slots: ['a', 'b', 'c'] } } },
        u2: { answers: { 0: { count: 3, slots: { 0: 'a', 1: 'b', 2: 'd' } } } }
    };
    const expected = SB.computeTotals(definition, ballots);
    assert.equal(expected.respondents, 2);
    assert.deepEqual(expected.questions[0].options, { a: 2, b: 2, c: 1, d: 1 });
    const stored = { respondents: 3, questions: [{ options: { a: 2, b: 2, c: 1, d: 0, z: 4 } }, { options: { a: 0, b: 0 } }] };
    assert.deepEqual(SB.compareTotals(expected, stored), [
        { path: 'respondents', expected: 2, actual: 3 },
        { path: 'questions/0/options/d', expected: 1, actual: 0 },
        { path: 'questions/0/options/z', expected: null, actual: 4 }
    ]);
});

test('a recount repair applies once, keeps votes that arrived meanwhile and drops unknown options', () => {
    const differences = [
        { path: 'respondents', expected: 2, actual: 3 },
        { path: 'questions/0/options/d', expected: 1, actual: 0 },
        { path: 'questions/0/options/z', expected: null, actual: 4 }
    ];
    const fingerprint = SB.repairFingerprint(differences);
    assert.equal(fingerprint, SB.repairFingerprint([...differences].reverse()), 'order does not matter');
    // Since the snapshot, one more vote for "a" arrived (respondents 3 → 4).
    const current = { respondents: 4, questions: [{ options: { a: 3, d: 0, z: 4 } }] };
    const repaired = SB.applyRepair(current, differences, fingerprint, { at: 1, by: 'admin' });
    assert.deepEqual(repaired, { respondents: 3, questions: [{ options: { a: 3, d: 1 } }], lastRepair: { fingerprint, at: 1, by: 'admin' } });
    assert.equal(SB.applyRepair(repaired, differences, fingerprint, { at: 2, by: 'admin2' }), undefined, 'a second identical repair changes nothing');
    assert.deepEqual(current.questions[0].options, { a: 3, d: 0, z: 4 }, 'the input is not modified');
});

test('live edits: anything goes before votes; afterwards only changes that keep ballots valid', () => {
    const before = {
        schema: 1, revision: 1, title: 'Cars', questionCount: 2,
        questions: {
            0: { id: 'q1', index: 0, kind: 'choice', type: 'multi', required: true, prompt: 'Pick 2', minSelections: 2, maxSelections: 2, options: { a: { label: 'A' }, b: { label: 'B' }, c: { label: 'C' } } },
            1: { id: 'q2', index: 1, kind: 'text', type: 'text', required: false, prompt: 'Notes', maxLength: 100 }
        }
    };
    const clone = () => JSON.parse(JSON.stringify(before));
    const voted = { respondents: 2, questions: { 0: { options: { a: 2, b: 1, c: 0 } } } };
    const nobody = { respondents: 0, questions: { 0: { options: { a: 0, b: 0, c: 0 } } } };

    const reworded = clone();
    reworded.title = 'Car classes';
    reworded.questions[0].prompt = 'Pick two classes';
    reworded.questions[0].options.a.label = 'GT3';
    reworded.questions[0].options.d = { label: 'D' };
    delete reworded.questions[0].options.c;
    reworded.questions[1].maxLength = 200;
    assert.deepEqual(SB.liveEditProblems(before, reworded, voted), []);

    const structural = clone();
    structural.questions[0].maxSelections = 3;
    structural.questions[0].required = false;
    delete structural.questions[0].options.b;
    assert.deepEqual(SB.liveEditProblems(before, structural, nobody), [], 'nobody has voted yet');
    assert.deepEqual(SB.liveEditProblems(before, structural, voted), [
        "Question 1: whether it's required can't change after votes.",
        "Question 1: the number of choices can't change after votes.",
        'Question 1: “B” has votes, so it can\'t be removed.'
    ]);
    const fewer = clone();
    fewer.questionCount = 1;
    delete fewer.questions[1];
    assert.deepEqual(SB.liveEditProblems(before, fewer, voted), ["2 drivers have voted, so questions can't be added or removed."]);

    const updates = SB.liveEditUpdates({ pollId: 'p', before, after: reworded, totals: voted, index: { title: 'Car classes' }, auditId: 'e1', adminUid: 'admin', reason: 'Typo', timestamp: 'NOW' });
    const base = 'seasonPlanning/v1/polls/p';
    assert.equal(updates[`${base}/definition`].revision, 2);
    assert.equal(updates[`${base}/definition`].basedOnRespondents, 2);
    assert.equal(updates[`${base}/definition`].lastAuditId, 'e1');
    assert.equal(updates[`${base}/totals/questions/0/options/d`], 0);
    assert.equal(updates[`${base}/totals/questions/0/options/c`], null);
    assert.ok(!(`${base}/totals/questions/0/options/a` in updates), 'counters with votes are left alone');
    assert.equal(updates['seasonPlanning/v1/index/p/title'], 'Car classes');
    assert.equal(updates[`${base}/audit/e1`].action, 'edit-poll');

    const fresh = SB.liveEditUpdates({ pollId: 'p', before, after: structural, totals: nobody, auditId: 'e2', adminUid: 'admin', reason: 'Fix', timestamp: 'NOW' });
    assert.deepEqual(fresh[`${base}/totals/questions`], { 0: { options: { a: 0, c: 0 } } });
});
