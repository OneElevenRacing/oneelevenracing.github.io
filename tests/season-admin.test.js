const { test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('../season-admin-core.js');
const P = require('../season-polls-core.js');

const catalogue = {
    classes: { gt3: { name: 'GT3', aliases: ['GT3 Gen 1'], active: true }, gt4: { name: 'GT4', active: true }, p2: { name: 'P2', active: true } },
    locations: { brands: { name: 'Brands Hatch', active: true }, monza: { name: 'Monza', active: true }, spa: { name: 'Spa', active: true }, imola: { name: 'Imola', active: true } },
    layouts: {
        'brands-gp': { name: 'Brands Hatch GP', aliases: ['Brands Hatch'], locationId: 'brands', active: true },
        'brands-indy': { name: 'Brands Hatch Indy', locationId: 'brands', active: true },
        monza: { name: 'Monza', locationId: 'monza', active: true },
        'spa-2022': { name: 'Spa 2022', locationId: 'spa', active: true },
        imola: { name: 'Imola', locationId: 'imola', active: true },
        tbd: { name: 'TBD', system: true, active: true }
    }
};

const nominationDef = { questionCount: 1, questions: { 0: { kind: 'nomination', type: 'nomination', options: { gt3: { label: 'GT3' }, gt4: { label: 'GT4' } }, allowWriteIns: true, maxWriteIns: 5 } } };
const ballot = (selections, writeIns, submittedAt = 1) => ({ submittedAt, answers: { 0: {
    count: selections.length, slots: Object.fromEntries(selections.map((id, i) => [i, id])), byOption: Object.fromEntries(selections.map((id, i) => [id, i])),
    writeInCount: writeIns.length, writeIns: Object.fromEntries(writeIns.map((text, n) => [n, { n, text }]))
} } });
const nominationBallots = {
    alex: ballot(['gt3'], ['Group C', 'gt3 gen 1']),
    sam: ballot(['gt3', 'gt4'], ['group c ']),
    kim: ballot([], ['Grp C', 'Formula Vee'])
};

test('suggestions group obvious duplicates, keep original wording and suggest catalogue matches', () => {
    const result = A.aggregateNominations(nominationDef, nominationBallots, catalogue, {});
    const groupC = result.writeIns.find(g => g.key === 'group c');
    assert.equal(groupC.count, 2);
    assert.deepEqual(groupC.variants, ['Group C', 'group c']);
    assert.equal(result.writeIns.find(g => g.key === 'gt3 gen 1').suggestedClassId, 'gt3');
    assert.equal(result.pending, 4);
    const gt3 = result.candidates.find(c => c.id === 'class:gt3');
    assert.equal(gt3.count, 2);
});

test('admin decisions merge, map, add and exclude without counting a driver twice', () => {
    const review = {
        'grp c': { action: 'merge', target: 'group c' },
        'group c': { action: 'new', classId: 'group-c' },
        'gt3 gen 1': { action: 'map', classId: 'gt3' },
        'formula vee': { action: 'exclude', note: 'Not in the game' }
    };
    const withClass = { ...catalogue, classes: { ...catalogue.classes, 'group-c': { name: 'Group C', active: true } } };
    const result = A.aggregateNominations(nominationDef, nominationBallots, withClass, review);
    const byId = Object.fromEntries(result.candidates.map(c => [c.id, c]));
    assert.equal(byId['class:group-c'].count, 3, 'Alex, Sam and Kim (Grp C merged)');
    assert.equal(byId['class:gt3'].count, 2, 'Alex picked GT3 and wrote GT3 Gen 1 but counts once');
    assert.ok(!result.candidates.some(c => c.label === 'Formula Vee'));
    assert.equal(result.writeIns.find(g => g.key === 'grp c').status, 'mapped');
    assert.equal(result.writeIns.find(g => g.key === 'formula vee').decision.note, 'Not in the game');
    assert.equal(result.candidates.filter(c => c.needsDecision).length, 0);
});

test('round defaults: half rounded up, one of two, and a winner at one', () => {
    assert.deepEqual(A.roundDefaults(10), { quota: 5, advance: 5, winner: false });
    assert.deepEqual(A.roundDefaults(9), { quota: 5, advance: 5, winner: false });
    assert.deepEqual(A.roundDefaults(2), { quota: 1, advance: 1, winner: false });
    assert.equal(A.roundDefaults(1).winner, true);
});

test('advancement never settles a tie at the cutoff', () => {
    const rows = [{ id: 'a', count: 9 }, { id: 'b', count: 7 }, { id: 'c', count: 5 }, { id: 'd', count: 5 }, { id: 'e', count: 2 }];
    assert.deepEqual(A.advancement(rows, 2).advancing, ['a', 'b']);
    const tie = A.advancement(rows, 3);
    assert.equal(tie.tie, true);
    assert.equal(tie.advancing, null);
    assert.deepEqual(tie.safe, ['a', 'b']);
    assert.deepEqual(tie.tied, ['c', 'd']);
    assert.equal(tie.needed, 1);
    assert.deepEqual(A.advancement(rows, 4).advancing, ['a', 'b', 'c', 'd']);
    assert.deepEqual(A.advancement(rows, 9).advancing.length, 5);
});

test('round drafts use the shortlist as a fixed list and are publishable', () => {
    const plan = { id: 'p', stages: [{ id: 'cars', label: 'Car votes' }] };
    const draft = A.roundDraft({ plan, number: 2, options: [{ id: 'gt3', label: 'GT3' }, { id: 'gt4', label: 'GT4' }, { id: 'p2', label: 'P2' }], settings: {}, now: 0 });
    assert.equal(draft.stageId, 'cars');
    assert.equal(draft.questions[0].minSelections, 2);
    assert.deepEqual(P.validateDraft(draft, {}), []);
    assert.deepEqual(Object.keys(P.buildDefinition(draft, {}).questions[0].options), ['gt3', 'gt4', 'p2']);
    const runoff = A.roundDraft({ plan, number: 2, options: [{ id: 'gt3', label: 'GT3' }, { id: 'gt4', label: 'GT4' }], quota: 1, settings: {}, now: 0, runoff: true });
    assert.match(runoff.title, /runoff/);
    assert.equal(runoff.questions[0].maxSelections, 1);
});

const seasons = [
    { id: '2026Q2', name: '2026 Q2', races: { race1: { trackName: 'Brands Hatch' }, race2: { trackName: 'TBD' }, race3: { trackName: 'Old Ring' }, race4: { trackName: 'Special Event' } } },
    { id: '2026Q1', name: '2026 Q1', races: { race1: { trackName: 'Monza' } } }
];

test('previous-season exclusions remove every layout at a used location', () => {
    const plan = A.exclusionPlan(catalogue, [seasons[0]], {});
    assert.deepEqual(plan.excluded.map(e => e.locationId), ['brands']);
    assert.match(plan.excluded[0].reasons[0], /Used in 2026 Q2 \(Brands Hatch\)/);
    assert.deepEqual(plan.unknown, [{ name: 'Old Ring', uses: ['2026 Q2'] }]);
    assert.equal(plan.blocking, true);
    assert.ok(!plan.eligible.some(t => t.locationId === 'brands'), 'both Brands Hatch layouts are out');
    assert.ok(!plan.eligible.some(t => t.system));
});

test('admins resolve unknown names and adjust seasons and locations', () => {
    const plan = A.exclusionPlan(catalogue, seasons, { unknown: { 'Old Ring': 'spa' }, added: { imola: 'Resurfacing' }, removed: { monza: 'Fan favourite' } });
    assert.equal(plan.blocking, false);
    assert.deepEqual(plan.excluded.map(e => e.locationId), ['brands', 'imola', 'spa']);
    assert.deepEqual(plan.kept, [{ locationId: 'monza', name: 'Monza', note: 'Fan favourite' }]);
    assert.deepEqual(plan.eligible.map(t => t.id), ['monza']);
    assert.equal(A.exclusionPlan(catalogue, [seasons[0]], { unknown: { 'Old Ring': 'ignore' } }).blocking, false);
});

const trackDef = { questionCount: 1, questions: { 0: { type: 'track', kind: 'choice', minSelections: 1, maxSelections: 1, options: {
    'brands-gp': { label: 'Brands Hatch GP', locationId: 'brands', locationName: 'Brands Hatch' },
    'brands-indy': { label: 'Brands Hatch Indy', locationId: 'brands', locationName: 'Brands Hatch' },
    monza: { label: 'Monza', locationId: 'monza', locationName: 'Monza' },
    imola: { label: 'Imola', locationId: 'imola', locationName: 'Imola' },
    'spa-2022': { label: 'Spa 2022', locationId: 'spa', locationName: 'Spa' }
} } } };
const pick = (layoutId, submittedAt) => ({ submittedAt, answers: { 0: { count: 1, slots: { 0: layoutId }, byOption: { [layoutId]: 0 } } } });

test('the later respondent keeps a shared location; earlier ones need a replacement', () => {
    const result = A.trackResolution(trackDef, { alex: pick('brands-gp', 100), sam: pick('brands-indy', 200), kim: pick('monza', 150) }, {});
    const status = Object.fromEntries(result.rows.map(r => [r.uid, r.status]));
    assert.deepEqual(status, { alex: 'replace', sam: 'keeps', kim: 'unique' });
    assert.equal(result.unresolved, 1);
    assert.deepEqual(result.freeLocations.map(l => l.locationId), ['imola', 'spa']);
});

test('with three on one location, the two earlier ones need replacements', () => {
    const result = A.trackResolution(trackDef, { a: pick('brands-gp', 1), b: pick('brands-gp', 2), c: pick('brands-indy', 3) }, {});
    assert.deepEqual(result.rows.map(r => `${r.uid}:${r.status}`), ['a:replace', 'b:replace', 'c:keeps']);
    assert.equal(result.unresolved, 2);
});

test('replacements must use a free location and resolve the conflict', () => {
    const ballots = { alex: pick('brands-gp', 100), sam: pick('brands-indy', 200), kim: pick('monza', 150) };
    const clash = A.trackResolution(trackDef, ballots, { replacements: { alex: { layoutId: 'monza' } } });
    assert.deepEqual(clash.invalid, [{ uid: 'alex', layoutId: 'monza' }]);
    assert.equal(clash.unresolved, 1);
    const fixed = A.trackResolution(trackDef, ballots, { replacements: { alex: { layoutId: 'imola' } } });
    assert.equal(fixed.unresolved, 0);
    assert.deepEqual(fixed.assignments.find(a => a.uid === 'alex'), { uid: 'alex', layoutId: 'imola', locationId: 'imola', source: 'replacement' });
    assert.ok(!fixed.freeLocations.some(l => l.locationId === 'imola'));
});

test('identical times need an admin decision; exceptions accept a shared location', () => {
    const ballots = { alex: pick('brands-gp', 100), sam: pick('brands-indy', 100) };
    const tie = A.trackResolution(trackDef, ballots, {});
    assert.equal(tie.conflicts[0].tie, true);
    assert.equal(tie.unresolved, 2);
    const decided = A.trackResolution(trackDef, ballots, { keeps: { brands: 'alex' } });
    assert.deepEqual(decided.rows.map(r => `${r.uid}:${r.status}`).sort(), ['alex:keeps', 'sam:replace']);
    const excepted = A.trackResolution(trackDef, ballots, { exceptions: { brands: 'Two layouts, agreed by drivers' } });
    assert.equal(excepted.unresolved, 0);
    assert.equal(excepted.assignments.length, 2);
});

test('rule outcomes: Yes must beat No; ties fail; no votes is no decision', () => {
    const def = { questionCount: 3, questions: {
        0: { type: 'yesno', prompt: 'A', options: { yes: {}, no: {} } }, 1: { type: 'yesno', prompt: 'B', options: { yes: {}, no: {} } }, 2: { type: 'yesno', prompt: 'C', options: { yes: {}, no: {} } } } };
    const totals = { questions: { 0: { options: { yes: 6, no: 4 } }, 1: { options: { yes: 5, no: 5 } }, 2: { options: { yes: 0, no: 0 } } } };
    assert.deepEqual(A.ruleOutcomes(def, totals).map(o => o.outcome), ['pass', 'fail', 'none']);
    assert.equal(A.ruleOutcomes(def, totals, { minTurnout: 11 })[0].outcome, 'none');
    const draft = A.rulesDraft({ plan: null, proposals: [{ text: 'Allow ghosting' }, { text: 'Reverse grid' }], settings: {}, now: 0 });
    assert.deepEqual(P.validateDraft(draft, {}), []);
    assert.equal(draft.questions.length, 2);
});

test('track drafts freeze the eligible layouts with their locations', () => {
    const plan = A.exclusionPlan(catalogue, [seasons[0]], { unknown: { 'Old Ring': 'ignore' } });
    const draft = A.trackDraft({ plan: null, eligible: plan.eligible, catalogue, settings: {}, now: 0 });
    const def = P.buildDefinition(draft, catalogue);
    assert.deepEqual(Object.keys(def.questions[0].options).sort(), ['imola', 'monza', 'random-track', 'spa-2022']);
    assert.equal(def.questions[0].options['random-track'].locationId, undefined, 'the random choice has no location');
    const noRandom = P.buildDefinition(A.trackDraft({ plan: null, eligible: plan.eligible, catalogue, settings: {}, now: 0, allowRandom: false }), catalogue);
    assert.ok(!noRandom.questions[0].options['random-track']);
    assert.equal(def.questions[0].options.monza.locationName, 'Monza');
});

test('season steps: statuses follow polls and decisions, and skipped steps say so', () => {
    const now = Date.UTC(2026, 9, 17);
    const plan = { stages: A.stagesForSteps(['suggestions', 'rounds', 'tracks', 'calendar']) };
    assert.deepEqual(A.includedSteps(plan), ['suggestions', 'rounds', 'tracks', 'calendar', 'summary']);
    const poll = (id, phase, extra = {}) => ({ id, title: id, phase, opensAt: now - 1, closesAt: now + 1, ...extra });
    let steps = A.seasonSteps({ plan, polls: {}, now });
    const byId = list => Object.fromEntries(list.map(s => [s.id, s.status]));
    assert.deepEqual(byId(steps), { suggestions: 'todo', rounds: 'waiting', tracks: 'todo', rules: 'skipped', calendar: 'waiting', summary: 'todo' });
    assert.equal(A.nextStep(steps).id, 'suggestions');

    steps = A.seasonSteps({ plan, polls: { suggestions: [poll('s', 'closed')] }, now });
    assert.equal(byId(steps).suggestions, 'decide');
    assert.equal(byId(steps).rounds, 'todo');

    const planAdmin = { shortlist: { items: [{}, {}, {}] }, rounds: { r1: { number: 1 } } };
    steps = A.seasonSteps({ plan, polls: { suggestions: [poll('s', 'closed')], rounds: [poll('r1', 'closed')], tracks: [poll('t', 'closed')] }, planAdmin, trackUnresolved: 2, now });
    assert.deepEqual([byId(steps).suggestions, byId(steps).rounds, byId(steps).tracks], ['done', 'decide', 'decide']);
    assert.equal(steps.find(s => s.id === 'tracks').line, '2 drivers need a replacement track');
    assert.equal(A.nextStep(steps).id, 'rounds');

    steps = A.seasonSteps({ plan: { ...plan, summary: { publishedAt: now } }, polls: { tracks: [poll('t', 'closed')] },
        planAdmin: { winner: { label: 'GT4' }, calendar: { currentVersion: 'v1', finalised: { versionId: 'v1' }, versions: { v1: { events: [{}, {}] } } } }, trackUnresolved: 0, now });
    assert.deepEqual([byId(steps).rounds, byId(steps).tracks, byId(steps).calendar, byId(steps).summary], ['done', 'done', 'done', 'done']);
    assert.equal(steps.find(s => s.id === 'calendar').line, 'Final: 2 events');
});

test('stages for steps use fixed labels the drivers see', () => {
    assert.deepEqual(A.stagesForSteps(['suggestions', 'rounds', 'rules', 'summary']).map(s => s.label), ['Suggestions', 'Car votes', 'Rules']);
});

test('a runoff that ties again keeps every class already through', () => {
    const label = id => id.toUpperCase();
    const first = A.runoffCarry({}, { safe: ['a'], tied: ['b', 'c', 'd'], needed: 2 }, label);
    assert.deepEqual(first, { safe: ['a'], safeLabels: ['A'], needed: 2 });
    const second = A.runoffCarry({ runoffFor: 'r1', safe: first.safe, safeLabels: first.safeLabels }, { safe: ['b'], tied: ['c', 'd'], needed: 1 }, label);
    assert.deepEqual(second, { safe: ['a', 'b'], safeLabels: ['A', 'B'], needed: 1 });
});

test('rule votes carry the minimum turnout into the poll control', () => {
    const draft = A.rulesDraft({ plan: null, proposals: [{ text: 'Allow ghosting?' }], settings: {}, now: 0, minTurnout: 6 });
    assert.equal(P.buildControl(draft).minTurnout, 6);
    assert.equal(P.buildControl(A.rulesDraft({ plan: null, proposals: [{ text: 'x' }], settings: {}, now: 0 })).minTurnout, undefined);
});

test('written suggestions with awkward text never break the review', () => {
    const def = { questionCount: 1, questions: { 0: { kind: 'nomination', type: 'nomination', options: {}, allowWriteIns: true, maxWriteIns: 9 } } };
    const long = `Long ${'x'.repeat(1990)}`;
    const ballots = {
        a: ballot([], ['constructor', '__proto__', 'toString']),
        b: ballot([], ['Group\u0000 C', long]),
        c: ballot([], ['group c'])
    };
    const none = A.aggregateNominations(def, ballots, catalogue, {});
    assert.ok(none.writeIns.every(g => g.decision === null && g.status === 'pending'), 'built-in names are not mistaken for decisions');
    assert.equal(none.writeIns.find(g => g.key === 'group c').count, 2, 'control characters are ignored when grouping');
    // Decisions as stored: under safe codes, with the text in `key`.
    const C = require('../catalogue.js');
    const stored = {
        [C.storageKey('constructor', 'w')]: { key: 'constructor', action: 'exclude', note: 'Not a class' },
        [C.storageKey(C.nameKey(long), 'w')]: { key: C.nameKey(long), action: 'map', classId: 'gt3' }
    };
    const decided = A.aggregateNominations(def, ballots, catalogue, stored);
    assert.equal(decided.writeIns.find(g => g.key === 'constructor').status, 'excluded');
    assert.equal(decided.writeIns.find(g => g.key === C.nameKey(long)).status, 'mapped');
    assert.equal(decided.writeIns.find(g => g.key === '__proto__').status, 'pending');
});

test('saved track-name resolutions work in both stored formats and with awkward names', () => {
    const season = [{ id: 's', name: 'S', races: { race1: { trackName: 'constructor' }, race2: { trackName: 'Old Ring' } } }];
    assert.deepEqual(A.exclusionPlan(catalogue, season, {}).unknown.map(u => u.name), ['constructor', 'Old Ring']);
    const plan = A.exclusionPlan(catalogue, season, { unknown: { u1: { name: 'constructor', locationId: 'spa' }, 'Old Ring': 'ignore' } });
    assert.equal(plan.blocking, false);
    assert.deepEqual(plan.excluded.map(e => e.locationId), ['spa']);
});

test('a random-track pick never clashes and reserves no calendar place', () => {
    const def = JSON.parse(JSON.stringify(trackDef));
    def.questions[0].options['random-track'] = { label: 'Random track' };
    const result = A.trackResolution(def, { alex: pick('random-track', 1), sam: pick('random-track', 2), kim: pick('monza', 3) }, {});
    assert.deepEqual(result.random, ['alex', 'sam']);
    assert.equal(result.unresolved, 0);
    assert.deepEqual(result.assignments.map(a => a.uid), ['kim']);
    assert.ok(result.freeLocations.every(l => l.locationId), 'the random choice is never offered as a replacement');
    assert.deepEqual(result.rows.map(r => `${r.uid}:${r.status}`), ['alex:random', 'sam:random', 'kim:unique']);
});
