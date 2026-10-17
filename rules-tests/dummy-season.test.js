// A complete dummy season with test accounts, through the real database rules:
// catalogue setup → suggestions → two voting rounds → track poll with a duplicate
// → rule vote → calendar → published summary. Uses the same building blocks as the
// admin pages, so it checks that every write they make is allowed.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { ref, get, set, update, increment, serverTimestamp } = require('firebase/database');
const C = require('../catalogue.js');
const SB = require('../season-ballot.js');
const P = require('../season-polls-core.js');
const AC = require('../season-admin-core.js');
const K = require('../season-calendar.js');

const V1 = 'seasonPlanning/v1';
const PLAN = 'season11';
const DRIVERS = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
const trackSource = readFileSync(path.join(__dirname, '../tracks.js'), 'utf8');
const bundled = Function(`${trackSource.match(/const trackData = \[[\s\S]*?\n\];/)[0]} return trackData;`)();
let env;
let counter = 0;
const db = uid => env.authenticatedContext(uid).database();
const admin = () => db('admin');
const read = async p => (await get(ref(admin(), p))).val();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const scripted = values => { let i = 0; return () => values[i++ % values.length]; };

before(async () => {
    const [host, port] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000').split(':');
    env = await initializeTestEnvironment({
        projectId: 'demo-one-eleven-season',
        database: { host, port: Number(port), rules: readFileSync(path.join(__dirname, '../database.rules.json'), 'utf8') }
    });
    const driver = (name, extra = {}) => ({ active: true, isAdmin: false, name, carName: 'Car', carImage: 'car.png', ...extra });
    await env.withSecurityRulesDisabled(ctx => set(ref(ctx.database(), 'drivers'), {
        ...Object.fromEntries(DRIVERS.map(id => [id, driver(id)])), admin: driver('admin', { isAdmin: true }), gone: driver('gone', { active: false })
    }));
});

after(async () => { await env.cleanup(); });

// What the admin page writes when publishing a draft.
async function publish(pollId, draft, catalogue) {
    assert.deepEqual(P.validateDraft(draft, catalogue), [], 'draft is publishable');
    const definition = P.buildDefinition(draft, catalogue);
    const audit = `a${++counter}`;
    const control = { ...P.buildControl({ ...draft, opensAt: Date.now() - 60000 }), lastAuditId: audit };
    await assertSucceeds(update(ref(admin()), {
        ...SB.publishUpdates({ pollId, definition, control }),
        [`${V1}/polls/${pollId}/audit/${audit}`]: { at: serverTimestamp(), by: 'admin', action: 'publish', reason: 'Published' },
        [`${V1}/index/${pollId}`]: { ...P.indexEntry(draft, control), updatedAt: serverTimestamp() }
    }));
    return definition;
}

const vote = (uid, pollId, definition, raw) => update(ref(db(uid)), SB.submissionUpdates({
    pollId, uid, definition, answers: SB.normaliseAnswers(definition, raw), submissionId: `s${++counter}`, increment, timestamp: serverTimestamp()
}));

const close = (pollId, before) => assertSucceeds(update(ref(admin()), SB.controlUpdates({
    pollId, before, changes: { state: 'closed' }, auditId: `a${++counter}`, adminUid: 'admin', reason: 'Voting finished', action: 'close', timestamp: serverTimestamp()
})));

const decide = (updates, summary) => assertSucceeds(update(ref(admin()), {
    ...updates, [`${V1}/planAdmin/${PLAN}/log/l${++counter}`]: { at: serverTimestamp(), by: 'admin', action: 'test', summary }
}));

test('a full dummy season runs end to end under the database rules', async () => {
    // 1. Racing Setup: car classes and the reviewed built-in track list.
    const classes = { gt3: { name: 'GT3', active: true }, gt4: { name: 'GT4', active: true }, p2: { name: 'P2', active: true }, 'formula-junior': { name: 'Formula Junior', active: true } };
    const trackWrites = C.seedWrites(C.proposeSeed(bundled, {}), {}, {}, { updatedBy: 'admin' });
    await assertSucceeds(update(ref(admin()), {
        ...Object.fromEntries(Object.entries(classes).map(([id, c]) => [`${V1}/catalogue/classes/${id}`, { ...c, updatedAt: serverTimestamp(), updatedBy: 'admin' }])),
        ...Object.fromEntries(Object.entries(trackWrites).map(([p, v]) => [`${V1}/catalogue/${p}`, v])),
        [`${V1}/catalogue/revision`]: 1
    }));
    let catalogue = await read(`${V1}/catalogue`);
    assert.equal(Object.keys(catalogue.layouts).length, bundled.length);

    // 2. Season plan and drivers' access.
    const plan = { id: PLAN, title: 'Season 11', intro: 'Help shape season 11', status: 'active', stageCount: 5,
        stages: ['Suggestions', 'Car votes', 'Tracks', 'Rules', 'Calendar'].map(label => ({ id: C.slugify(label), label })) };
    const { id: _planId, ...planRecord } = plan;
    await assertSucceeds(set(ref(admin(), `${V1}/plans/${PLAN}`), { ...planRecord, createdAt: serverTimestamp() }));
    await assertSucceeds(set(ref(admin(), `${V1}/visibility`), { drivers: true, updatedAt: serverTimestamp(), updatedBy: 'admin' }));
    await assertSucceeds(get(ref(db('d1'), `${V1}/plans`)));

    // 3. Car-class suggestions with written suggestions.
    const nomTemplate = P.BUILT_IN_TEMPLATES.find(t => t.id === 'builtin-nomination');
    const nomDraft = { ...P.draftFromTemplate(nomTemplate, {}, Date.now()), planId: PLAN, stageId: 'suggestions' };
    const nomDef = await publish('nominations', nomDraft, catalogue);
    const writeIns = { d1: ['Group C'], d2: ['group c', 'Touring cars'], d3: [], d4: ['Grp C'], d5: [], d6: [] };
    const picks = { d1: ['gt3'], d2: ['gt4'], d3: ['gt3', 'p2'], d4: ['formula-junior'], d5: ['gt4', 'gt3'], d6: ['p2'] };
    for (const uid of DRIVERS) await assertSucceeds(vote(uid, 'nominations', nomDef, [{ selections: picks[uid], writeIns: writeIns[uid] }, {}]));
    await assertFails(vote('d1', 'nominations', nomDef, [{ selections: ['gt4'] }, {}]), 'one submission per driver');
    await assertFails(vote('gone', 'nominations', nomDef, [{ selections: ['gt4'] }, {}]), 'inactive drivers cannot vote');
    await close('nominations', { state: 'published' });

    // Review: merge Grp C into Group C, add Group C to the catalogue, exclude Touring cars.
    const review = { 'grp c': { action: 'merge', target: 'group c' }, 'group c': { action: 'new', classId: 'group-c' }, 'touring cars': { action: 'exclude', note: 'Not in the game' } };
    await decide({
        [`${V1}/catalogue/classes/group-c`]: { name: 'Group C', aliases: ['Grp C'], active: true, updatedAt: serverTimestamp(), updatedBy: 'admin' },
        ...Object.fromEntries(Object.entries(review).map(([k, v]) => [`${V1}/planAdmin/${PLAN}/nominations/nominations/${k.replace(/ /g, '_')}`, { ...v, at: serverTimestamp(), by: 'admin' }]))
    }, 'Reviewed suggestions');
    catalogue = await read(`${V1}/catalogue`);
    const nominations = AC.aggregateNominations(nomDef, await read(`${V1}/polls/nominations/ballots`), catalogue, review);
    assert.equal(nominations.candidates.find(c => c.classId === 'group-c').count, 3);
    const shortlist = nominations.candidates.filter(c => c.classId).slice(0, 4).map(c => ({ id: c.classId, label: c.label }));
    assert.equal(shortlist.length, 4);

    // 4. Round 1: choose exactly 2 of 4.
    const r1Def = await publish('round1', AC.roundDraft({ plan, number: 1, options: shortlist, settings: {}, now: Date.now() }), catalogue);
    assert.equal(r1Def.questions[0].minSelections, 2);
    const r1Votes = { d1: [0, 1], d2: [0, 1], d3: [0, 2], d4: [1, 3], d5: [0, 1], d6: [0, 3] };
    for (const uid of DRIVERS) await assertSucceeds(vote(uid, 'round1', r1Def, [{ selections: r1Votes[uid].map(i => shortlist[i].id) }]));
    await close('round1', { state: 'published' });
    const r1Rows = require('../season-results.js').rows(r1Def, 0, await read(`${V1}/polls/round1/totals`));
    const r1 = AC.advancement(r1Rows, AC.roundDefaults(r1Rows.length).advance);
    assert.equal(r1.tie, false);
    assert.deepEqual(r1.advancing, [shortlist[0].id, shortlist[1].id]);

    // 5. Round 2: two left, choose one; the winner is recorded.
    const finalists = r1.advancing.map(id => shortlist.find(s => s.id === id));
    const r2Def = await publish('round2', AC.roundDraft({ plan, number: 2, options: finalists, settings: {}, now: Date.now() }), catalogue);
    for (const [i, uid] of DRIVERS.entries()) await assertSucceeds(vote(uid, 'round2', r2Def, [{ selections: [finalists[i < 4 ? 0 : 1].id] }]));
    await close('round2', { state: 'published' });
    const r2 = AC.advancement(require('../season-results.js').rows(r2Def, 0, await read(`${V1}/polls/round2/totals`)), 1);
    await decide({ [`${V1}/planAdmin/${PLAN}/winner`]: { classId: r2.advancing[0], label: finalists[0].label, explanation: 'Won round 2', at: serverTimestamp(), by: 'admin' } }, 'Winner');

    // 6. Track poll excluding last season's locations; two drivers pick Brands Hatch.
    const lastSeason = [{ id: '2026Q3', name: '2026 Q3', races: { race1: { trackName: 'Monza' }, race2: { trackName: 'Spa-Francorchamps 2022' } } }];
    const exclusions = AC.exclusionPlan(catalogue, lastSeason, {});
    assert.equal(exclusions.blocking, false);
    const trackDef = await publish('tracks', AC.trackDraft({ plan, eligible: exclusions.eligible, catalogue, settings: {}, now: Date.now() }), catalogue);
    const options = trackDef.questions[0].options;
    assert.ok(!Object.values(options).some(o => o.locationName === 'Monza'), 'last season’s locations are excluded');
    const layoutAt = (name, n = 0) => Object.entries(options).filter(([, o]) => o.locationName === name)[n][0];
    assert.ok(options[P.RANDOM_TRACK], 'drivers can ask for a random track');
    const trackPicks = { d1: layoutAt('Brands Hatch', 0), d2: layoutAt('Donington'), d3: layoutAt('Brands Hatch', 1), d4: layoutAt('Imola'), d5: layoutAt('Silverstone'), d6: P.RANDOM_TRACK };
    for (const uid of DRIVERS) { await assertSucceeds(vote(uid, 'tracks', trackDef, [{ selections: [trackPicks[uid]] }])); await sleep(5); }
    await close('tracks', { state: 'published' });
    let resolution = AC.trackResolution(trackDef, await read(`${V1}/polls/tracks/ballots`), {});
    assert.equal(resolution.unresolved, 1);
    assert.equal(resolution.rows.find(r => r.uid === 'd1').status, 'replace', 'the earlier respondent needs a replacement');
    const replacement = resolution.freeLocations.find(l => l.name === 'Cadwell Park').layouts[0].id;
    await decide({
        [`${V1}/planAdmin/${PLAN}/trackResolution/tracks/replacements/d1`]: { layoutId: replacement, note: 'Agreed by message', at: serverTimestamp(), by: 'admin' },
        [`${V1}/polls/tracks/audit/a${++counter}`]: { at: serverTimestamp(), by: 'admin', action: 'track-replacement', reason: 'Agreed by message', targetUid: 'd1' }
    }, 'Replacement');
    const config = (await read(`${V1}/planAdmin/${PLAN}/trackResolution/tracks`));
    resolution = AC.trackResolution(trackDef, await read(`${V1}/polls/tracks/ballots`), config);
    assert.equal(resolution.unresolved, 0);
    assert.deepEqual(resolution.random, ['d6']);
    assert.equal(resolution.assignments.length, 5, 'the random pick reserves no track');

    // 7. Rule vote: one passes, one ties and fails.
    const ruleDef = await publish('rules', AC.rulesDraft({ plan, proposals: [{ text: 'Allow ghosting?' }, { text: 'Reverse grid?' }], settings: {}, now: Date.now() }), catalogue);
    const ruleVotes = { d1: ['yes', 'yes'], d2: ['yes', 'no'], d3: ['yes', 'yes'], d4: ['no', 'no'], d5: ['yes', 'yes'], d6: ['no', 'no'] };
    for (const uid of DRIVERS) await assertSucceeds(vote(uid, 'rules', ruleDef, ruleVotes[uid].map(v => ({ selections: [v] }))));
    await close('rules', { state: 'published' });
    const outcomes = AC.ruleOutcomes(ruleDef, await read(`${V1}/polls/rules/totals`));
    assert.deepEqual(outcomes.map(o => o.outcome), ['pass', 'fail']);
    await decide(Object.fromEntries(outcomes.map(o => [`${V1}/planAdmin/${PLAN}/outcomes/rules_${o.index}`,
        { pollId: 'rules', questionIndex: o.index, prompt: o.prompt, outcome: o.outcome, label: o.label, yes: o.yes, no: o.no, at: serverTimestamp(), by: 'admin' }])), 'Outcomes');

    // 8. Calendar: 10 events, driver choices kept, saved as a version and finalised.
    const drivers = K.driverEvents(resolution.assignments, options);
    const generated = K.generate({ drivers, catalogue, excluded: exclusions.excluded.map(e => e.locationId), target: 10, source: scripted([7, 3, 11, 2, 5, 13, 1, 17, 4, 9]) });
    assert.equal(generated.events.length, 10);
    assert.equal(new Set(generated.events.map(e => e.locationId)).size, 10);
    assert.deepEqual(K.finaliseProblems({ events: generated.events, target: 10, unresolvedDuplicates: resolution.unresolved }), []);
    await decide({
        [`${V1}/planAdmin/${PLAN}/calendar/target`]: 10,
        [`${V1}/planAdmin/${PLAN}/calendar/versions/v1`]: JSON.parse(JSON.stringify({ events: generated.events, action: 'generate', note: 'test', generation: K.GENERATION_VERSION, poolSnapshot: generated.poolSnapshot, by: 'admin' })),
        [`${V1}/planAdmin/${PLAN}/calendar/currentVersion`]: 'v1',
        [`${V1}/planAdmin/${PLAN}/calendar/finalised`]: { versionId: 'v1', at: serverTimestamp(), by: 'admin' }
    }, 'Calendar finalised');

    // 9. Publish the summary; drivers can read it but none of the admin data.
    const summary = {
        title: 'Season 11', publishedAt: serverTimestamp(), winner: { label: finalists[0].label, explanation: 'Won round 2' },
        calendar: generated.events.map(e => ({ label: e.label, locationName: e.locationName, imagePath: e.imagePath, source: e.source })),
        rules: outcomes.map(o => ({ prompt: o.prompt, outcome: o.outcome, label: o.label })),
        rounds: [{ pollId: 'round1', title: 'Round 1' }, { pollId: 'round2', title: 'Round 2' }]
    };
    await decide({ [`${V1}/plans/${PLAN}/summary`]: summary }, 'Summary published');
    const seen = (await get(ref(db('d4'), `${V1}/plans/${PLAN}/summary`))).val();
    assert.equal(seen.calendar.length, 10);
    assert.ok(!JSON.stringify(seen.calendar).includes('"uid"'), 'the summary does not reveal who chose each track');
    await assertFails(get(ref(db('d4'), `${V1}/planAdmin/${PLAN}`)));
    await assertFails(get(ref(db('d4'), `${V1}/polls/tracks/ballots`)));
    await assertSucceeds(get(ref(db('d4'), `${V1}/polls/tracks/ballots/d4`)));

    // Totals still match the ballots after the whole season.
    for (const pollId of ['nominations', 'round1', 'round2', 'tracks', 'rules']) {
        const definition = await read(`${V1}/polls/${pollId}/definition`);
        assert.deepEqual(SB.compareTotals(SB.computeTotals(definition, await read(`${V1}/polls/${pollId}/ballots`)), await read(`${V1}/polls/${pollId}/totals`)), [], pollId);
    }
});
