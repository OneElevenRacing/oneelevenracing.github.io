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
