const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../season-polls-core.js');
const R = require('../season-results.js');

const HOUR = 3600000;
const now = Date.UTC(2026, 9, 17, 12, 0);

test('poll phase follows the timestamps and admin states', () => {
    const control = { state: 'published', opensAt: now - HOUR, closesAt: now + HOUR };
    assert.equal(P.pollPhase(control, now), 'open');
    assert.equal(P.pollPhase({ ...control, opensAt: now + 1 }, now), 'scheduled');
    assert.equal(P.pollPhase({ ...control, closesAt: now }, now), 'closed');
    assert.equal(P.pollPhase({ ...control, state: 'closed' }, now), 'closed');
    assert.equal(P.pollPhase({ ...control, state: 'finalised' }, now), 'finalised');
});

test('result access follows the visibility setting', () => {
    const open = { state: 'published', opensAt: now - HOUR, closesAt: now + HOUR };
    assert.equal(P.resultsAccess({ ...open, resultVisibility: 'live' }, now).totals, true);
    assert.equal(P.resultsAccess({ ...open, resultVisibility: 'afterClose' }, now).totals, false);
    assert.equal(P.resultsAccess({ ...open, resultVisibility: 'afterClose', closesAt: now - 1 }, now).totals, true);
    assert.equal(P.resultsAccess({ ...open, resultVisibility: 'snapshot' }, now).snapshot, true);
    assert.equal(P.resultsAccess({ ...open, resultVisibility: 'hidden' }, now).totals, false);
});

test('London times are labelled and convert both ways across clock changes', () => {
    assert.equal(P.formatDateTime(Date.UTC(2026, 9, 17, 18, 0)), 'Sat 17 Oct 2026, 7:00pm BST');
    assert.equal(P.formatDateTime(Date.UTC(2026, 11, 1, 19, 30)), 'Tue 1 Dec 2026, 7:30pm GMT');
    assert.equal(P.londonInputToUtc('2026-10-17T19:00'), Date.UTC(2026, 9, 17, 18, 0));
    assert.equal(P.londonInputToUtc('2026-12-01T19:00'), Date.UTC(2026, 11, 1, 19, 0));
    assert.equal(P.utcToLondonInput(Date.UTC(2026, 9, 17, 18, 0)), '2026-10-17T19:00');
    assert.ok(Number.isNaN(P.londonInputToUtc('soon')));
    assert.equal(P.relative(now + 3 * 24 * HOUR, now), 'in 3 days');
    assert.equal(P.relative(now + 5 * HOUR, now), 'in 5 hours');
    assert.equal(P.relative(now - 30 * 60000, now), '30 minutes ago');
});

test('default quota is half rounded up, and one when two remain', () => {
    assert.deepEqual([10, 9, 3, 2, 1].map(P.defaultQuota), [5, 5, 2, 1, 1]);
});

test('drafts are cleared for other users and on sign-out', () => {
    const store = new Map([[P.draftKey('a', 'p', 1), '{}'], [P.draftKey('b', 'p', 1), '{}'], ['other', 'x']]);
    const storage = { get length() { return store.size; }, key: i => [...store.keys()][i], removeItem: k => store.delete(k) };
    P.clearDrafts(storage, 'a');
    assert.deepEqual([...store.keys()], [P.draftKey('a', 'p', 1), 'other']);
    P.clearDrafts(storage);
    assert.deepEqual([...store.keys()], ['other']);
});

const catalogue = {
    classes: { gt3: { name: 'GT3', active: true }, gt4: { name: 'GT4', active: true }, p2: { name: 'P2', active: false } },
    locations: { brands: { name: 'Brands Hatch', active: true }, monza: { name: 'Monza', active: true } },
    layouts: {
        'brands-gp': { name: 'Brands Hatch GP', locationId: 'brands', active: true, imagePath: 'Logos_and_icons/racetracks/Brands_Hatch.png' },
        'brands-indy': { name: 'Brands Hatch Indy', locationId: 'brands', active: true },
        monza: { name: 'Monza', locationId: 'monza', active: true },
        tbd: { name: 'TBD', system: true, active: true }
    }
};

test('building a definition freezes options with stable IDs and location snapshots', () => {
    const draft = {
        title: ' Season form ', opensAt: now, closesAt: now + HOUR,
        questions: [
            { ...P.blankQuestion('multi'), prompt: 'Pick two', options: ['Night races', 'Rain', 'Night races!'], minSelections: 2, maxSelections: 2 },
            { ...P.blankQuestion('nomination'), prompt: 'Suggest' },
            { ...P.blankQuestion('track'), prompt: 'Track' },
            { ...P.blankQuestion('yesno'), prompt: 'Allow ghosting?' },
            { ...P.blankQuestion('text'), prompt: 'Notes', maxLength: 500 }
        ]
    };
    assert.deepEqual(P.validateDraft(draft, catalogue), []);
    const def = P.buildDefinition(draft, catalogue);
    assert.equal(def.title, 'Season form');
    assert.deepEqual(Object.keys(def.questions[0].options), ['night-races', 'rain', 'night-races-2']);
    assert.deepEqual(Object.keys(def.questions[1].options), ['gt3', 'gt4'], 'archived classes are left out');
    assert.equal(def.questions[1].maxSelections, 2);
    assert.equal(def.questions[1].allowWriteIns, true);
    assert.deepEqual(def.questions[2].options['brands-indy'], { label: 'Brands Hatch Indy', locationId: 'brands', locationName: 'Brands Hatch', imagePath: 'Logos_and_icons/racetracks/TBD.png' });
    assert.ok(!def.questions[2].options.tbd, 'system entries are never offered');
    assert.equal(def.questions[3].minSelections, 1);
    assert.deepEqual(def.questions[4], { id: 'q5', index: 4, type: 'text', required: false, prompt: 'Notes', kind: 'text', maxLength: 500 });
    assert.equal(P.describeQuota(def.questions[0]), 'Choose exactly 2 of 3 options.');
    assert.equal(P.describeQuota(def.questions[1]), 'Choose up to 2 classes, or write your own.');
    assert.equal(P.describeQuota(def.questions[2]), 'Choose exactly 1 of 3 layouts.');
});

test('draft validation explains what blocks publishing', () => {
    const errors = P.validateDraft({ title: '', opensAt: now, closesAt: now, questions: [
        { ...P.blankQuestion('multi'), prompt: '', options: ['A', 'B'], minSelections: 3, maxSelections: 3 },
        { ...P.blankQuestion('nomination'), prompt: 'x', source: 'classes', sourceIds: ['missing'], allowWriteIns: false }
    ] }, catalogue);
    assert.deepEqual(errors, [
        'Add a poll title.',
        'The closing time must be after the opening time.',
        'Question 1: add the question text.',
        "Question 1: can't ask for 3 choices from 2 options.",
        'Question 2: offer catalogue classes, written suggestions, or both.'
    ]);
});

test('templates start from shared defaults without changing them', () => {
    const template = P.BUILT_IN_TEMPLATES.find(t => t.id === 'builtin-elimination');
    const draft = P.draftFromTemplate(template, { durationDays: 3, resultVisibility: 'hidden' }, now);
    assert.equal(draft.opensAt, now);
    assert.equal(draft.closesAt - draft.opensAt, 3 * 24 * HOUR);
    assert.equal(draft.resultVisibility, 'live', 'the template setting wins over the default');
    assert.equal(draft.labelsHidden, true);
    draft.questions[0].prompt = 'changed';
    assert.notEqual(template.draft.questions[0].prompt, 'changed');
});

test('hub groups polls and plan progress follows configured stages', () => {
    const index = {
        a: { title: 'A', state: 'published', opensAt: now - HOUR, closesAt: now + 2 * HOUR, planId: 'p', stageId: 'cars' },
        b: { title: 'B', state: 'published', opensAt: now - HOUR, closesAt: now + HOUR, standalone: true },
        c: { title: 'C', state: 'published', opensAt: now + HOUR, closesAt: now + 9 * HOUR, planId: 'p', stageId: 'tracks' },
        d: { title: 'D', state: 'finalised', opensAt: now - 9 * HOUR, closesAt: now - HOUR, planId: 'p', stageId: 'ideas' },
        e: { title: 'E', state: 'published', opensAt: now - 9 * HOUR, closesAt: now - HOUR, replacedBy: 'a' }
    };
    const groups = P.groupPolls(index, now);
    assert.deepEqual(groups.open.map(p => p.id), ['b', 'a']);
    assert.deepEqual(groups.scheduled.map(p => p.id), ['c']);
    assert.deepEqual(groups.results.map(p => p.id), ['d']);
    assert.deepEqual(groups.archived.map(p => p.id), ['e']);
    const plan = { id: 'p', stageCount: 4, stages: [{ id: 'ideas', label: 'Ideas' }, { id: 'cars', label: 'Car votes' }, { id: 'tracks', label: 'Tracks' }, { id: 'rules', label: 'Rules' }] };
    assert.deepEqual(P.planProgress(plan, index, now).map(s => `${s.label}:${s.status}`), ['Ideas:done', 'Car votes:open', 'Tracks:scheduled', 'Rules:upcoming']);
});

const resultDef = {
    questionCount: 2,
    questions: {
        0: { prompt: 'Classes', type: 'class', kind: 'choice', options: { gt3: { label: 'GT3' }, gt4: { label: 'GT4' }, p2: { label: 'P2' }, fj: { label: '=Formula Junior' } } },
        1: { prompt: 'Ghosting?', type: 'yesno', kind: 'choice', options: { yes: { label: 'Yes' }, no: { label: 'No' } } }
    }
};
const totals = { respondents: 4, questions: [{ options: { gt3: 1, gt4: 4, p2: 2, fj: 0 } }, { options: { yes: 2, no: 2 } }] };

test('results rank by total; hidden labels are stable and reveal nothing of order', () => {
    const named = R.rows(resultDef, 0, totals);
    assert.deepEqual(named.map(r => `${r.label}:${r.count}`), ['GT4:4', 'P2:2', 'GT3:1', '=Formula Junior:0']);
    const hidden = R.rows(resultDef, 0, totals, { labelsHidden: true, pollId: 'poll1' });
    assert.ok(hidden.every(r => /^Class [A-D]$/.test(r.label)));
    assert.deepEqual(hidden.map(r => r.count), [4, 2, 1, 0]);
    const again = R.rows(resultDef, 0, { questions: [{ options: { gt3: 9 } }] }, { labelsHidden: true, pollId: 'poll1' });
    assert.equal(again.find(r => r.id === 'gt3').label, hidden.find(r => r.id === 'gt3').label);
    assert.equal(R.totalSelections(named), 7);
});

test('rule outcomes: Yes must beat No, ties fail, no votes is no decision', () => {
    assert.equal(R.yesNoOutcome(6, 4).outcome, 'pass');
    assert.equal(R.yesNoOutcome(5, 5).outcome, 'fail');
    assert.equal(R.yesNoOutcome(0, 0).outcome, 'none');
    assert.equal(R.yesNoOutcome(2, 1, { minTurnout: 4 }).outcome, 'none');
});

test('summaries, charts and CSV respect hidden names and stay safe', () => {
    const hidden = R.rows(resultDef, 0, totals, { labelsHidden: true, pollId: 'poll1' });
    const text = R.summaryText(hidden, { respondents: 4, labelsHidden: true });
    assert.match(text, /^4 drivers responded, making 7 selections in total\. Class names are hidden\./);
    assert.doesNotMatch(text, /GT4|P2/);
    const svg = R.barChartSvg(hidden, { title: 'Round 1' });
    assert.doesNotMatch(svg, /GT4|P2|Formula/);
    assert.match(svg, /<title>Class [A-D]: 4<\/title>/);
    assert.match(R.summaryText(R.rows(resultDef, 1, totals), { respondents: 4, yesNo: true }), /Yes 2 \(50%\), No 2 \(50%\)\. Fails on a tie/);
    assert.match(R.yesNoSvg(2, 2), /Yes 2 \(50%\)/);
    const csv = R.resultsCsv(resultDef, totals);
    assert.match(csv, /Classes,'=Formula Junior,0,4/);
    assert.doesNotMatch(R.resultsCsv(resultDef, totals, { labelsHidden: true, pollId: 'poll1' }), /GT4/);
    assert.match(R.barChartSvg([{ label: '<script>', count: 1 }]), /&lt;script&gt;/);
});

test('a duplicated poll keeps its options, IDs and quotas', () => {
    const draft = { title: 'Round 2', opensAt: now, closesAt: now + HOUR, questions: [
        { ...P.blankQuestion('class'), prompt: 'Pick', minSelections: 1, maxSelections: 1 },
        { ...P.blankQuestion('yesno'), prompt: 'Ghosting?' },
        { ...P.blankQuestion('text'), prompt: 'Notes', maxLength: 300 }] };
    const original = P.buildDefinition(draft, catalogue);
    const copy = P.buildDefinition({ ...draft, questions: P.draftQuestions(original) }, {});
    assert.deepEqual(copy.questions, original.questions);
    assert.deepEqual(P.validateDraft({ ...draft, questions: P.draftQuestions(original) }, {}), []);
});
