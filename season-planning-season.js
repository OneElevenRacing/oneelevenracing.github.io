// The Season page: one checklist of fixed steps (suggestions → voting rounds →
// track picks → rule changes → calendar → summary). Each step is a card with a
// status and its tools; "What needs doing" points at the step that needs you.
// Also the Settings page. The step tools themselves live in season-planning-tools.js
// and season-planning-calendar.js.
(function () {
    'use strict';
    const A = window.SeasonAdmin;
    const T = window.SeasonTools;
    const CT = window.SeasonCalendarTabs;
    const AC = window.SeasonAdminCore;
    const P = window.SeasonPolls;
    const UI = window.SeasonUI;
    const C = window.OneElevenCatalogue;
    const { h } = UI;
    const V1 = A.V1;
    const sv = () => firebase.database.ServerValue;
    const params = new URLSearchParams(location.search);
    let openStep = params.get('step');
    let chosen = openStep !== null;

    const STATUS = {
        decide: ['Needs you', 'sp-red'],
        todo: ['To do', 'sp-amber'],
        waiting: ['Waiting', ''],
        done: ['Done', 'sp-green'],
        skipped: ['Skipped', '']
    };

    // Which log entries belong to which step's activity list.
    const ACTIVITY = {
        suggestions: ['review-suggestion', 'shortlist'],
        rounds: ['create-round', 'round-decision', 'runoff', 'winner', 'round-target'],
        tracks: ['track-setup', 'create-track-poll', 'track-replacement', 'track-tie', 'track-exception'],
        rules: ['proposal', 'proposal-link', 'create-rules-poll', 'rule-outcome', 'min-turnout'],
        calendar: ['calendar', 'calendar-target', 'calendar-finalise', 'calendar-reopen'],
        summary: ['summary']
    };

    function toggle(id) {
        openStep = openStep === id ? '' : id;
        chosen = true;
        const url = new URL(location.href);
        url.searchParams.delete('tab');
        if (openStep) url.searchParams.set('step', openStep); else url.searchParams.delete('step');
        history.replaceState(null, '', url);
        A.rerender();
        const card = document.getElementById(`step-${id}`);
        if (card && openStep) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }

    function inputs(plan) {
        const polls = { suggestions: T.planPolls('nomination'), rounds: T.planPolls('elimination'), tracks: T.planPolls('track'), rules: T.planPolls('rules') };
        const roundDrafts = Object.entries(A.state.drafts || {}).filter(([, d]) => d && d.kind === 'elimination' && d.planId === plan.id).map(([id, d]) => ({ id, ...d }));
        // Track clashes need the closed track poll's ballots (loaded once).
        let trackUnresolved = null;
        const track = polls.tracks[polls.tracks.length - 1];
        if (track && ['closed', 'finalised', 'archived'].includes(track.phase)) {
            const data = T.pollData(track.id, { ballots: true });
            if (data.definition && data.ballots) {
                trackUnresolved = AC.trackResolution(data.definition, data.ballots, ((T.tools.planAdmin.trackResolution || {})[track.id]) || {}).unresolved;
            }
        }
        return { plan, polls, roundDrafts, planAdmin: T.tools.planAdmin || {}, trackUnresolved, now: A.now() };
    }

    // ---------- Starting and editing a season ----------

    function stepChecklist(selected) {
        const boxes = AC.STEPS.filter(step => step.id !== 'summary').map(step => ({ step, input: h('input', { type: 'checkbox', checked: selected.includes(step.id) }) }));
        return { boxes, element: h('div', { class: 'sp-checklist', style: 'max-height:none' }, boxes.map(({ step, input }) => h('label', { class: 'sp-check' }, input, step.label))) };
    }

    function startCard() {
        const title = h('input', { type: 'text', maxLength: 200, value: 'Next season' });
        const intro = h('input', { type: 'text', maxLength: 2000, value: 'Help shape the next season. Take part in each stage below.' });
        const steps = stepChecklist(AC.STEPS.map(s => s.id));
        const past = Object.entries(A.state.plans || {}).filter(([, p]) => p && p.summary).sort(([, a], [, b]) => b.summary.publishedAt - a.summary.publishedAt);
        return h('div', null,
            h('section', { class: 'sp-card' }, h('h2', { text: 'Start a season' }),
                h('p', { class: 'sp-small', text: 'Choose which steps to run. Drivers see them as the progress strip on Polls & Forms. You can change this later.' }),
                A.field('Season name', title), A.field('Message for drivers', intro), steps.element,
                h('button', { type: 'button', style: 'margin-top:10px', text: 'Start season', onclick: () => {
                    const ids = steps.boxes.filter(b => b.input.checked).map(b => b.step.id);
                    const stages = AC.stagesForSteps(ids);
                    A.save({ [`${V1}/plans/${A.newId()}`]: { title: title.value.trim() || 'Next season', intro: intro.value.trim(), status: 'active', stageCount: stages.length, stages,
                        createdAt: sv().TIMESTAMP, updatedAt: sv().TIMESTAMP } }, 'Season started.');
                } })),
            past.length ? h('section', { class: 'sp-card' }, h('h2', { text: 'Past seasons' }),
                h('ul', { class: 'sp-clist' }, past.map(([id, p]) => h('li', { class: 'sp-crow' }, h('span', { class: 'sp-crow-name' }, h('span', { class: 'sp-crow-title', text: p.summary.title || p.title })),
                    h('span', { class: 'sp-crow-actions' }, h('a', { class: 'sp-small', href: `season-polls.html?summary=${encodeURIComponent(id)}`, text: 'Summary' })))))) : null);
    }

    async function editSeason(plan) {
        const title = h('input', { type: 'text', maxLength: 200, value: plan.title });
        const intro = h('input', { type: 'text', maxLength: 2000, value: plan.intro || '' });
        const steps = stepChecklist(AC.includedSteps(plan));
        const ok = await A.confirmDialog({ title: 'Edit season', body: h('div', null, A.field('Season name', title), A.field('Message for drivers', intro),
            h('p', { class: 'sp-small', style: 'font-weight:600;margin:6px 0 2px', text: 'Steps this season' }), steps.element,
            h('p', { class: 'sp-small sp-muted', text: 'Unticking a step hides it from drivers’ progress strip. Polls and decisions already made are kept.' })), confirmLabel: 'Save' });
        if (!ok) return;
        const ids = steps.boxes.filter(b => b.input.checked).map(b => b.step.id);
        // Keep existing stage IDs so polls already linked to a stage stay linked.
        const existing = Object.values(plan.stages || {}).filter(Boolean);
        const stages = AC.stagesForSteps(ids).map(stage => existing.find(s => s.label.toLowerCase() === stage.label.toLowerCase()) || stage);
        A.save({ [`${V1}/plans/${plan.id}/title`]: title.value.trim() || plan.title, [`${V1}/plans/${plan.id}/intro`]: intro.value.trim(),
            [`${V1}/plans/${plan.id}/stages`]: stages, [`${V1}/plans/${plan.id}/stageCount`]: stages.length, [`${V1}/plans/${plan.id}/updatedAt`]: sv().TIMESTAMP }, 'Season updated.');
    }

    // ---------- Step bodies ----------

    function stageId(plan, label) {
        const stage = Object.values(plan.stages || {}).find(s => s && s.label.toLowerCase() === label.toLowerCase());
        return stage ? stage.id : undefined;
    }

    function suggestionsBody(plan, state) {
        if (state.polls.suggestions.length) return T.suggestionsTab();
        return h('div', null,
            h('p', { class: 'sp-small', text: 'Drivers pick any car classes from the catalogue and can write in new ones. When it closes, you review the suggestions and pick the shortlist for voting.' }),
            h('button', { type: 'button', text: 'Create the suggestions poll', onclick: () => {
                const template = P.BUILT_IN_TEMPLATES.find(t => t.id === 'builtin-nomination');
                const draft = { ...P.draftFromTemplate(template, A.settings(), A.now()), planId: plan.id, stageId: stageId(plan, 'Suggestions') };
                T.createDraft(draft, 'create-suggestions-poll', 'Suggestions poll');
            } }));
    }

    function roundsBody(plan, state) {
        const hasShortlistSource = state.polls.suggestions.length > 0;
        if (state.polls.rounds.length || state.roundDrafts.length || hasShortlistSource) return T.roundsTab();
        // No suggestions step: pick round 1's classes straight from the catalogue.
        const classes = T.classPairs();
        const boxes = classes.map(([id, name]) => ({ id, name, input: h('input', { type: 'checkbox' }) }));
        const count = h('p', { class: 'sp-small', 'aria-live': 'polite', text: 'Tick at least two classes.' });
        boxes.forEach(b => b.input.addEventListener('change', () => {
            const n = boxes.filter(x => x.input.checked).length;
            count.textContent = n >= 2 ? `${n} classes. Drivers will choose ${P.defaultQuota(n)}.` : 'Tick at least two classes.';
        }));
        return h('div', null,
            classes.length ? null : h('p', { class: 'sp-status sp-warn' }, 'Add car classes in ', h('a', { href: 'racing-setup.html', text: 'Racing Setup' }), ' first.'),
            h('p', { class: 'sp-small', text: 'Choose the classes for round 1. Each round keeps the top half; ties at the cutoff are always your decision.' }),
            h('div', { class: 'sp-checklist' }, boxes.map(b => h('label', { class: 'sp-check' }, b.input, b.name))),
            count,
            h('button', { type: 'button', text: 'Open round 1', onclick: () => {
                const picked = boxes.filter(b => b.input.checked).map(b => ({ id: b.id, label: b.name }));
                if (picked.length < 2) { A.setStatus('Tick at least two classes.', 'error'); return; }
                const draft = AC.roundDraft({ plan, number: 1, options: picked, settings: A.settings(), now: A.now() });
                T.createDraft(draft, 'create-round', `Round 1 with ${picked.length} classes`, id => ({ [`${T.planPath()}/rounds/${id}`]: { number: 1, ...T.stamp() } }));
            } }));
    }

    function stepBody(step, plan, state) {
        if (step.status === 'skipped') {
            return h('p', { class: 'sp-small sp-muted' }, 'Not part of this season. ', h('button', { type: 'button', class: 'sp-link', text: 'Edit season', onclick: () => editSeason(plan) }), ' to include it.');
        }
        switch (step.id) {
            case 'suggestions': return suggestionsBody(plan, state);
            case 'rounds': return roundsBody(plan, state);
            case 'tracks': return T.tracksTab();
            case 'rules': return T.rulesTab();
            case 'calendar': return CT.calendarTab();
            default: return CT.summaryTab();
        }
    }

    function activity(stepId) {
        const actions = ACTIVITY[stepId] || [];
        const entries = Object.values(T.tools.planAdmin.log || {}).filter(e => e && actions.includes(e.action)).sort((a, b) => (b.at || 0) - (a.at || 0));
        if (!entries.length) return null;
        return h('details', { class: 'sp-fold sp-activity' }, h('summary', null, h('span', { class: 'sp-small', text: `Activity (${entries.length})` })),
            h('ul', { class: 'sp-clist' }, entries.slice(0, 20).map(e => h('li', { class: 'sp-crow', title: P.formatDateTime(e.at) },
                h('span', { class: 'sp-crow-name' }, h('span', { text: e.summary }), h('span', { class: 'sp-crow-meta', text: `${P.formatDate(e.at)} · ${A.driverName(e.by)}` }))))));
    }

    // ---------- Season page ----------

    function seasonTab() {
        const plan = A.activePlan();
        if (!plan) return startCard();
        if (!T.tools.planId) return T.loading();
        const state = inputs(plan);
        const steps = AC.seasonSteps(state);
        const next = AC.nextStep(steps);
        if (!chosen) openStep = next ? next.id : '';
        const hidden = !(A.state.visibility && A.state.visibility.drivers === true);
        return h('div', null,
            h('div', { class: 'sp-season-head' },
                h('div', null, h('h2', { text: plan.title }), plan.intro ? h('p', { class: 'sp-small sp-muted', style: 'margin:2px 0 0', text: plan.intro }) : null),
                h('div', { class: 'sp-inline-actions' },
                    h('button', { type: 'button', class: 'sp-link', text: 'Edit season', onclick: () => editSeason(plan) }),
                    h('button', { type: 'button', class: 'sp-link', text: 'Finish season', onclick: () => A.completePlan(plan) }))),
            hidden ? h('p', { class: 'sp-status sp-warn sp-small' }, 'Drivers can’t see Polls & Forms yet. ', h('a', { href: 'season-planning-admin.html?tab=settings', text: 'Settings' })) : null,
            next ? h('div', { class: `sp-next ${next.status === 'decide' ? 'sp-next-decide' : ''}` },
                h('span', null, h('strong', { text: 'What needs doing: ' }), next.line),
                openStep === next.id ? null : h('button', { type: 'button', class: 'sp-secondary', text: 'Go', onclick: () => toggle(next.id) }))
                : h('p', { class: 'sp-status sp-ok', text: 'Everything’s done for this season.' }),
            h('ol', { class: 'sp-steps' }, steps.map((step, i) => {
                const open = openStep === step.id;
                const [badge, tone] = STATUS[step.status];
                return h('li', { id: `step-${step.id}`, class: `sp-stepcard sp-step-${step.status}${open ? ' sp-open' : ''}` },
                    h('button', { type: 'button', class: 'sp-stephead', 'aria-expanded': String(open), onclick: () => toggle(step.id) },
                        h('span', { class: 'sp-stepnum', text: step.status === 'done' ? '✓' : String(i + 1) }),
                        h('span', { class: 'sp-steptext' }, h('span', { class: 'sp-steplabel', text: step.label }), h('span', { class: 'sp-stepline', text: step.line })),
                        h('span', { class: `sp-badge ${tone}`, text: badge })),
                    open ? h('div', { class: 'sp-stepbody' }, stepBody(step, plan, state), activity(step.id)) : null);
            })),
            h('p', { class: 'sp-small', style: 'margin-top:10px' }, h('a', { href: 'season-planning-admin.html?tab=history', text: 'Full activity log' })));
    }

    // ---------- Settings ----------

    function settingsTab() {
        const link = (href, title, text) => h('li', { class: 'sp-crow' }, h('span', { class: 'sp-crow-name' }, h('a', { class: 'sp-crow-title', href, text: title }), h('span', { class: 'sp-crow-meta', text })));
        return h('div', null,
            A.visibilityCard(),
            h('section', { class: 'sp-card' }, h('h2', { text: 'Setup' }),
                h('ul', { class: 'sp-clist' },
                    link('racing-setup.html', 'Car classes and tracks', 'The lists polls and the calendar use'),
                    link('racing-setup.html?tab=defaults', 'Templates and defaults', 'Poll length, results, exclusions, calendar size'),
                    link('season-planning-admin.html?tab=history', 'Activity log', 'Every season decision and poll change'))));
    }

    A.addTab({ id: 'season', label: 'Season', nav: true, order: 10, render: seasonTab });
    A.addTab({ id: 'settings', label: 'Settings', nav: true, order: 30, render: settingsTab });
})();
