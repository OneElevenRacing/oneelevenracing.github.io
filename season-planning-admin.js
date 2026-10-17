// Season Planning Admin. Views (chosen by the address):
//   (none) or ?tab=polls  overview / poll list
//   ?draft=ID             poll builder for a draft
//   ?template=ID          template builder (built-in IDs start a copy)
//   ?poll=ID              a published poll: lifecycle, results, answers, history
(function () {
    'use strict';
    const UI = window.SeasonUI;
    const SB = window.SeasonBallot;
    const P = window.SeasonPolls;
    const C = window.OneElevenCatalogue;
    const { h, fill } = UI;
    const V1 = 'seasonPlanning/v1';
    const params = new URLSearchParams(location.search);
    const $ = id => document.getElementById(id);
    const db = () => firebase.database();
    const sv = () => firebase.database.ServerValue;
    const KINDS = { nomination: 'Car-class suggestions', elimination: 'Car-class voting round', track: 'Track choice', rules: 'Rule changes', suggestions: 'Suggestion box', custom: 'Custom poll' };
    const PHASE_LABEL = { draft: 'Draft', scheduled: 'Scheduled', open: 'Open', closed: 'Closed', finalised: 'Final', archived: 'Archived' };
    const DEFAULT_STAGES = ['Suggestions', 'Car votes', 'Tracks', 'Rules', 'Calendar'];

    const state = { uid: null, index: null, drafts: null, plans: {}, templates: {}, settings: {}, catalogue: {}, drivers: {} };
    let serverOffset = 0;
    const now = () => Date.now() + serverOffset;
    const newId = () => db().ref().push().key;
    const auditId = () => `a${newId()}`;
    const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;
    const driverName = uid => (state.drivers[uid] && state.drivers[uid].name) || 'Unknown driver';
    const activeDrivers = () => Object.entries(state.drivers).filter(([, d]) => d.active === true).sort(([, a], [, b]) => a.name.localeCompare(b.name));
    const settings = () => ({ ...P.DEFAULT_SETTINGS, ...(state.settings || {}) });

    function setStatus(message, kind) {
        const element = $('pageStatus');
        element.textContent = message || '';
        element.className = `sp-status${kind ? ` sp-${kind}` : ''}`;
    }

    async function save(updates, message) {
        try {
            await db().ref().update(updates);
            if (message) setStatus(message, 'ok');
            return true;
        } catch (error) {
            console.error('Save failed:', error);
            setStatus(`Not saved: ${error.message}`, 'error');
            return false;
        }
    }

    function activePlan() {
        return Object.entries(state.plans || {}).map(([id, plan]) => ({ id, ...plan }))
            .filter(plan => plan.status === 'active').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
    }

    function phaseBadge(phase) {
        const tone = { open: 'sp-green', closed: 'sp-amber', scheduled: '', finalised: '', archived: '', draft: 'sp-amber' }[phase] || '';
        return h('span', { class: `sp-badge ${tone}`, text: PHASE_LABEL[phase] || phase });
    }

    // ---------- Dialogs ----------

    // Resolves with { reason } when confirmed, or null when cancelled.
    function confirmDialog({ title, body, confirmLabel = 'Confirm', reason = false, reasonLabel = 'Reason (kept in the history)', reasonValue = '', danger = false, wide = false, altLabel = null }) {
        return new Promise(resolve => {
            const dialog = $('dialog');
            dialog.classList.toggle('sp-dialog-wide', wide);
            $('dialogTitle').textContent = title;
            const reasonInput = reason ? h('textarea', { id: 'dialogReason', rows: 3, maxLength: 1000, style: 'min-height:0;font-family:inherit;font-size:1rem' }) : null;
            if (reasonInput) reasonInput.value = reasonValue;
            const error = h('p', { class: 'sp-status sp-error', hidden: true, role: 'alert' });
            fill($('dialogBody'), body, reasonInput ? h('div', { class: 'sp-field', style: 'margin-top:12px' }, h('label', { for: 'dialogReason', text: reasonLabel }), reasonInput) : null, error);
            const ok = h('button', { type: 'submit', class: danger ? 'sp-danger' : '', text: confirmLabel });
            const cancel = h('button', { type: 'button', class: 'sp-secondary', text: 'Cancel' });
            const alt = altLabel ? h('button', { type: 'button', class: 'sp-link', text: altLabel }) : null;
            fill($('dialogFoot'), alt, cancel, ok);
            let done = false;
            const finish = value => { if (done) return; done = true; dialog.close(); resolve(value); };
            cancel.onclick = () => finish(null);
            if (alt) alt.onclick = () => finish({ alt: true, reason: reasonInput ? reasonInput.value.trim() : '' });
            dialog.onclose = () => finish(null);
            $('dialogForm').onsubmit = event => {
                event.preventDefault();
                if (reasonInput && !reasonInput.value.trim()) { error.hidden = false; error.textContent = 'Please give a reason.'; reasonInput.focus(); return; }
                finish({ reason: reasonInput ? reasonInput.value.trim() : '' });
            };
            dialog.showModal();
            (reasonInput || ok).focus();
        });
    }

    // "Preview as driver": the real ballot screens with sample answers. Nothing is
    // sent to Firebase from here.
    function previewDialog(definition, title) {
        const dialog = $('dialog');
        dialog.classList.add('sp-dialog-wide');
        $('dialogTitle').textContent = `Preview: ${title || definition.title}`;
        const panel = h('div', { class: 'sp-preview' });
        const answers = UI.blankAnswers(definition);
        const showForm = () => UI.renderForm(panel, { definition, answers, onChange: () => {}, onReview: showReview });
        const showReview = () => UI.renderReview(panel, { definition, answers, preview: true, onBack: showForm, onSubmit: () => {
            const tidy = SB.normaliseAnswers(definition, answers);
            const ballot = { submittedAt: now(), revision: 1, answers: SB.storedAnswers(definition, tidy) };
            UI.renderReceipt(panel, { definition, ballot, preview: true });
        } });
        fill($('dialogBody'), h('p', { class: 'sp-status sp-warn', text: 'Preview with sample answers. Nothing you choose here is saved or counted.' }), panel);
        const close = h('button', { type: 'button', text: 'Close preview' });
        close.onclick = () => dialog.close();
        fill($('dialogFoot'), close);
        $('dialogForm').onsubmit = event => event.preventDefault();
        dialog.onclose = null;
        showForm();
        dialog.showModal();
    }

    // ---------- Overview and poll list ----------

    const participation = {};
    function watchParticipation(id) {
        if (id in participation) return;
        participation[id] = null;
        db().ref(`${V1}/polls/${id}/totals/respondents`).on('value', snapshot => { participation[id] = snapshot.val() || 0; renderMain(); }, () => {});
    }

    function eligibleCount(entry, control) {
        if (control && control.allDrivers === false) return Object.keys(control.eligible || {}).length;
        return activeDrivers().length;
    }

    // Extra sections (season tools) register themselves here.
    const extraTabs = [];

    function renderMain() {
        if (state.index === null || state.drafts === null) return;
        const known = ['overview', 'polls', ...extraTabs.map(t => t.id)];
        const nav = [{ id: 'polls', label: 'Polls', order: 20 }, ...extraTabs.filter(t => t.nav)].sort((a, b) => a.order - b.order);
        const fallback = extraTabs.some(t => t.id === 'season') ? 'season' : 'overview';
        const tab = known.includes(params.get('tab')) ? params.get('tab') : fallback;
        const tabs = h('div', { class: 'sp-tabs', role: 'tablist', 'aria-label': 'Season planning sections' },
            nav.map(({ id, label }) =>
                h('a', { role: 'tab', class: 'sp-tab-link', 'aria-selected': String(tab === id), href: id === fallback ? 'season-planning-admin.html' : `season-planning-admin.html?tab=${id}`, text: label })));
        const extra = extraTabs.find(t => t.id === tab);
        const body = tab === 'polls' ? pollsTab() : tab === 'overview' ? overviewTab() : extra.render();
        // Keep a tool's own panel (and what's typed in it) when only background data changed.
        if (extra && $('view').dataset.tab === tab && extra.keep) { extra.refresh && extra.refresh(); return; }
        $('view').dataset.tab = tab;
        fill($('view'), tabs, body);
    }

    function overviewTab() {
        const plan = activePlan();
        const groups = P.groupPolls(state.index, now());
        groups.open.forEach(poll => watchParticipation(poll.id));
        const needsFinalising = Object.entries(state.index).map(([id, e]) => ({ id, ...e, phase: P.pollPhase(e, now()) }))
            .filter(p => p.phase === 'closed' && !p.replacedBy);
        const drafts = Object.values(state.drafts || {}).filter(Boolean).length;
        const planCard = plan
            ? h('section', { class: 'sp-card' },
                h('div', { class: 'sp-card-head' }, h('h2', { text: plan.title }), h('span', { class: 'sp-badge sp-green', text: 'Active plan' })),
                plan.intro ? h('p', { text: plan.intro }) : null,
                h('ol', { class: 'sp-admin-stages' }, P.planProgress(plan, state.index, now()).map(stage => h('li', null,
                    h('strong', { text: stage.label }), ' ',
                    h('span', { class: 'sp-muted sp-small', text: stage.polls.length ? `${plural(stage.polls.length, 'poll')} · ${{ done: 'finished', open: 'open now', scheduled: 'scheduled', upcoming: 'not started' }[stage.status]}` : 'No polls yet' })))),
                h('div', { class: 'sp-inline-actions' },
                    h('button', { type: 'button', class: 'sp-secondary', text: 'Edit plan', onclick: () => editPlan(plan) }),
                    h('button', { type: 'button', class: 'sp-link', text: 'Mark plan complete', onclick: () => completePlan(plan) })))
            : h('section', { class: 'sp-card' },
                h('h2', { text: 'Season plan' }),
                h('p', { text: 'Start a season plan to show drivers the stages on the Polls & Forms page. Polls can also run on their own without a plan.' }),
                h('button', { type: 'button', text: 'Start season planning', onclick: () => editPlan(null) }));
        return h('div', null,
            visibilityCard(),
            planCard,
            h('section', { class: 'sp-card' },
                h('h2', { text: 'Open polls' }),
                groups.open.length ? h('ul', { class: 'sp-list' }, groups.open.map(poll => h('li', { class: 'sp-item' },
                    h('div', null, h('a', { class: 'sp-item-title', href: `?poll=${encodeURIComponent(poll.id)}`, text: poll.title }),
                        h('div', { class: 'sp-item-meta', text: `Closes ${P.formatDateTime(poll.closesAt, { year: false })}` })),
                    h('span', { class: 'sp-small', text: participation[poll.id] === null || participation[poll.id] === undefined ? '…' : `${participation[poll.id]} of ${eligibleCount(poll)} responded` })))) : h('p', { class: 'sp-muted', text: 'No polls are open.' })),
            h('section', { class: 'sp-card' },
                h('h2', { text: 'To do' }),
                needsFinalising.length || drafts ? h('ul', { class: 'sp-list' },
                    needsFinalising.map(poll => h('li', { class: 'sp-item' },
                        h('div', null, h('div', { class: 'sp-item-title', text: poll.title }), h('div', { class: 'sp-item-meta', text: 'Closed — review the results and finalise.' })),
                        h('a', { class: 'sp-small', href: `?poll=${encodeURIComponent(poll.id)}`, text: 'Open' }))),
                    drafts ? h('li', { class: 'sp-item' }, h('div', null, h('div', { class: 'sp-item-title', text: plural(drafts, 'draft poll') }), h('div', { class: 'sp-item-meta', text: 'Not visible to drivers until published.' })),
                        h('a', { class: 'sp-small', href: '?tab=polls', text: 'View' })) : null)
                    : h('p', { class: 'sp-muted', text: 'Nothing waiting.' })),
            h('p', null, h('button', { type: 'button', text: 'New poll', onclick: newPoll })));
    }

    // The switch that shows Polls & Forms to drivers. Hiding it keeps all data.
    function visibilityCard() {
        const visible = state.visibility && state.visibility.drivers === true;
        return h('section', { class: 'sp-card sp-access' },
            h('div', null, h('strong', { text: 'Drivers’ access ' }), h('span', { class: `sp-badge ${visible ? 'sp-green' : 'sp-amber'}`, text: visible ? 'Visible' : 'Hidden' }),
                visible ? null : h('p', { class: 'sp-small sp-muted', style: 'margin:2px 0 0', text: 'Drivers see “Coming Soon”. Switch on once the rules are live and you’ve tried it.' })),
            h('button', { type: 'button', class: visible ? 'sp-secondary' : '', text: visible ? 'Hide from drivers' : 'Show to drivers', onclick: async () => {
                const ok = await confirmDialog({ title: visible ? 'Hide Polls & Forms from drivers?' : 'Show Polls & Forms to drivers?',
                    body: h('p', { text: visible ? 'Nothing is deleted. Polls, answers and results stay saved and come back when you switch it on again.' : 'Drivers will be able to open the hub and vote in open polls.' }),
                    confirmLabel: visible ? 'Hide' : 'Show' });
                if (ok) save({ [`${V1}/visibility`]: { drivers: !visible, updatedAt: sv().TIMESTAMP, updatedBy: state.uid } }, visible ? 'Hidden from drivers.' : 'Visible to drivers.');
            } }));
    }

    function pollsTab() {
        const all = Object.entries(state.index).map(([id, e]) => ({ id, ...e, phase: P.pollPhase(e, now()) }));
        const section = (title, items, empty) => h('section', { class: 'sp-card' }, h('h2', { text: title }),
            items.length ? h('ul', { class: 'sp-list' }, items) : h('p', { class: 'sp-muted', text: empty }));
        const pollRow = poll => h('li', { class: 'sp-item' },
            h('div', null,
                h('a', { class: 'sp-item-title', href: `?poll=${encodeURIComponent(poll.id)}`, text: poll.title }), ' ', phaseBadge(poll.phase),
                poll.replacedBy ? h('span', { class: 'sp-badge', text: 'Replaced' }) : null,
                h('div', { class: 'sp-item-meta', text: `${KINDS[poll.kind] || 'Poll'} · ${poll.phase === 'scheduled' ? `opens ${P.formatDateTime(poll.opensAt, { year: false })}` : `closes ${P.formatDateTime(poll.closesAt, { year: false })}`}${poll.standalone ? ' · standalone' : ''}` })),
            h('a', { class: 'sp-small', href: `?poll=${encodeURIComponent(poll.id)}`, text: 'Manage' }));
        const drafts = Object.entries(state.drafts || {}).filter(([, d]) => d).sort(([, a], [, b]) => (b.updatedAt || 0) - (a.updatedAt || 0)).map(([id, d]) => h('li', { class: 'sp-item' },
            h('div', null, h('a', { class: 'sp-item-title', href: `?draft=${encodeURIComponent(id)}`, text: d.title || 'Untitled draft' }), ' ', phaseBadge('draft'),
                h('div', { class: 'sp-item-meta', text: `${KINDS[d.kind] || 'Poll'} · ${plural((d.questions || []).length, 'question')}${d.replaces ? ' · replaces a published poll' : ''}` })),
            h('div', { class: 'sp-item-actions' },
                h('a', { class: 'sp-small', href: `?draft=${encodeURIComponent(id)}`, text: 'Edit' }),
                h('button', { type: 'button', class: 'sp-link', text: 'Delete', onclick: () => deleteDraft(id, d) }))));
        const by = phases => all.filter(p => phases.includes(p.phase)).sort((a, b) => b.closesAt - a.closesAt).map(pollRow);
        return h('div', null,
            h('p', null, h('button', { type: 'button', text: 'New poll', onclick: newPoll })),
            section('Drafts', drafts, 'No drafts.'),
            section('Open', by(['open']), 'No polls are open.'),
            section('Scheduled', by(['scheduled']), 'Nothing scheduled.'),
            section('Closed — waiting to be finalised', by(['closed']), 'Nothing waiting.'),
            section('Finalised', by(['finalised']), 'None yet.'),
            h('details', { class: 'sp-archive' }, h('summary', { text: `Archived (${by(['archived']).length})` }), h('ul', { class: 'sp-list' }, by(['archived']))));
    }

    async function newPoll() {
        const templates = [
            ...P.BUILT_IN_TEMPLATES.map(t => ({ ...t, builtIn: true })),
            ...Object.entries(state.templates || {}).map(([id, t]) => ({ id, ...t }))
        ];
        const choice = h('div', { class: 'sp-option-list', role: 'radiogroup', 'aria-label': 'Template' }, templates.map((t, i) => h('label', { class: 'sp-option' },
            h('input', { type: 'radio', name: 'templateChoice', value: t.id, checked: i === 0 }),
            h('span', null, h('strong', { text: t.name }), t.builtIn ? '' : h('span', { class: 'sp-badge', text: 'Saved' }), h('br'), h('span', { class: 'sp-muted sp-small', text: t.description || '' })))));
        const result = await confirmDialog({ title: 'New poll', body: h('div', null, h('p', { text: 'Start from a template. You can change everything before publishing.' }), choice), confirmLabel: 'Create draft' });
        if (!result) return;
        const id = document.querySelector('input[name="templateChoice"]:checked').value;
        const template = templates.find(t => t.id === id);
        const draft = { ...P.draftFromTemplate(template, settings(), now()), updatedAt: sv().TIMESTAMP, updatedBy: state.uid };
        const draftId = newId();
        if (await save({ [`${V1}/drafts/${draftId}`]: clean(draft) })) location.href = `?draft=${encodeURIComponent(draftId)}`;
    }

    async function deleteDraft(id, draft) {
        const ok = await confirmDialog({ title: 'Delete draft?', body: h('p', { text: `“${draft.title || 'Untitled draft'}” will be deleted. Drivers never saw it.` }), confirmLabel: 'Delete', danger: true });
        if (ok) save({ [`${V1}/drafts/${id}`]: null }, 'Draft deleted.');
    }

    // Firebase rejects undefined values; drop them (and keep nulls out of new data).
    function clean(value) {
        if (Array.isArray(value)) return value.map(clean);
        if (value && typeof value === 'object' && !('.sv' in value)) {
            const out = {};
            Object.entries(value).forEach(([k, v]) => { if (v !== undefined && v !== null) out[k] = clean(v); });
            return out;
        }
        return value;
    }

    // ---------- Season plan ----------

    async function editPlan(plan) {
        const stages = plan ? [] : DEFAULT_STAGES.map(label => ({ id: C.slugify(label), label }));
        if (plan) for (let i = 0; i < (plan.stageCount || 0); i++) if (plan.stages[i]) stages.push({ ...plan.stages[i] });
        const title = h('input', { type: 'text', id: 'planTitle', maxLength: 200, value: plan ? plan.title : 'Next season' });
        const intro = h('textarea', { id: 'planIntro', rows: 2, maxLength: 2000, style: 'min-height:0;font-family:inherit;font-size:1rem' });
        intro.value = plan ? plan.intro || '' : 'Help shape the next season. Take part in each stage below.';
        const list = h('ol', { class: 'sp-stage-editor' });
        const renderStages = () => fill(list, stages.map((stage, i) => {
            const input = h('input', { type: 'text', value: stage.label, maxLength: 60, 'aria-label': `Stage ${i + 1} name` });
            input.addEventListener('input', () => { stage.label = input.value; });
            const move = (d) => { const j = i + d; if (j < 0 || j >= stages.length) return; [stages[i], stages[j]] = [stages[j], stages[i]]; renderStages(); };
            return h('li', null, input,
                h('button', { type: 'button', class: 'sp-link', 'aria-label': `Move ${stage.label} up`, text: '↑', disabled: i === 0, onclick: () => move(-1) }),
                h('button', { type: 'button', class: 'sp-link', 'aria-label': `Move ${stage.label} down`, text: '↓', disabled: i === stages.length - 1, onclick: () => move(1) }),
                h('button', { type: 'button', class: 'sp-link', 'aria-label': `Remove ${stage.label}`, text: 'Remove', onclick: () => { stages.splice(i, 1); renderStages(); } }));
        }));
        renderStages();
        const add = h('button', { type: 'button', class: 'sp-secondary', text: 'Add stage', onclick: () => { if (stages.length < 12) { stages.push({ label: 'New stage' }); renderStages(); } } });
        const body = h('div', null,
            h('div', { class: 'sp-field' }, h('label', { for: 'planTitle', text: 'Title' }), title),
            h('div', { class: 'sp-field' }, h('label', { for: 'planIntro', text: 'Introduction for drivers' }), intro),
            h('p', { style: 'font-weight:600;margin-bottom:4px', text: 'Stages, in order' }),
            h('p', { class: 'sp-muted sp-small', text: 'Drivers see these as the progress strip. Polls are linked to a stage when you create them. Stages can overlap.' }),
            list, add);
        const result = await confirmDialog({ title: plan ? 'Edit season plan' : 'Start season planning', body, confirmLabel: 'Save plan' });
        if (!result) return;
        const taken = new Set();
        const tidy = stages.filter(s => s.label.trim()).map(s => {
            const id = s.id && !taken.has(s.id) ? s.id : C.uniqueId(s.label, taken);
            taken.add(id);
            return { id, label: s.label.trim().slice(0, 60) };
        });
        const id = plan ? plan.id : newId();
        const record = { title: title.value.trim() || 'Season planning', intro: intro.value.trim(), status: 'active', stageCount: tidy.length, stages: tidy,
            createdAt: plan ? plan.createdAt || now() : sv().TIMESTAMP, updatedAt: sv().TIMESTAMP };
        save({ [`${V1}/plans/${id}`]: record }, 'Season plan saved.');
    }

    async function completePlan(plan) {
        const ok = await confirmDialog({ title: 'Mark plan complete?', body: h('p', { text: 'The progress strip will no longer show on the drivers’ page. Polls and results stay available.' }), confirmLabel: 'Mark complete' });
        if (ok) save({ [`${V1}/plans/${plan.id}/status`]: 'complete', [`${V1}/plans/${plan.id}/updatedAt`]: sv().TIMESTAMP }, 'Plan marked complete.');
    }

    // ---------- Builder (drafts and templates) ----------

    const editor = { mode: null, id: null, data: null, dirty: false };

    function markDirty() {
        if (!editor.mode) return;
        editor.dirty = true;
        const flag = $('dirtyFlag');
        if (flag) flag.hidden = false;
    }

    window.addEventListener('beforeunload', event => {
        if (editor.dirty) { event.preventDefault(); event.returnValue = ''; }
    });

    function field(label, input, hint) {
        if (!input.id) input.id = `f-${Math.random().toString(36).slice(2, 8)}`;
        return h('div', { class: 'sp-field' }, h('label', { for: input.id, text: label }), hint ? h('p', { class: 'sp-hint', text: hint }) : null, input);
    }

    // A field that stays folded behind a link until it's needed or already filled in.
    function optionalField(label, obj, key, make, hint) {
        if (obj[key]) return field(label, make(), hint);
        const box = h('div');
        box.append(h('button', { type: 'button', class: 'sp-link', style: 'margin-left:-10px', text: `+ Add ${label.toLowerCase()}`, onclick: () => {
            const input = make();
            box.replaceChildren(field(label, input, hint));
            input.focus();
        } }));
        return box;
    }

    function bindText(obj, key, attrs = {}) {
        const input = h(attrs.multiline ? 'textarea' : 'input', { type: attrs.multiline ? undefined : 'text', maxLength: attrs.max || 200, rows: attrs.rows || undefined,
            style: attrs.multiline ? 'min-height:0;font-family:inherit;font-size:1rem' : undefined });
        input.value = obj[key] || '';
        input.addEventListener('input', () => { obj[key] = input.value; markDirty(); if (attrs.onInput) attrs.onInput(); });
        return input;
    }

    function bindNumber(obj, key, min, max, onInput) {
        const input = h('input', { type: 'number', inputMode: 'numeric', min, max, value: obj[key] === undefined ? '' : String(obj[key]), style: 'max-width:120px' });
        input.addEventListener('input', () => { obj[key] = input.value === '' ? undefined : Number(input.value); markDirty(); if (onInput) onInput(); });
        return input;
    }

    function bindCheck(obj, key, label, onChange) {
        const input = h('input', { type: 'checkbox', checked: obj[key] === true });
        input.addEventListener('change', () => { obj[key] = input.checked; markDirty(); if (onChange) onChange(); });
        return h('label', { class: 'sp-check' }, input, label);
    }

    function selectOf(options, value, onChange) {
        const select = h('select', null, options.map(([v, label]) => h('option', { value: v, text: label })));
        select.value = value === undefined || value === null ? '' : value;
        select.addEventListener('change', () => { onChange(select.value); markDirty(); });
        return select;
    }

    function startEditor() {
        const draftId = params.get('draft');
        const templateId = params.get('template');
        if (draftId) {
            if (state.drafts === null || editor.id === draftId) return;
            const draft = state.drafts[draftId];
            if (!draft) { fill($('view'), h('p', { class: 'sp-status sp-warn', text: 'This draft no longer exists. It may have been published or deleted.' }), h('a', { href: '?tab=polls', text: '← All polls' })); return; }
            Object.assign(editor, { mode: 'draft', id: draftId, data: JSON.parse(JSON.stringify(draft)), dirty: false });
        } else {
            if (editor.id === templateId) return;
            const builtIn = P.BUILT_IN_TEMPLATES.find(t => t.id === templateId);
            const saved = state.templates[templateId];
            if (!builtIn && !saved) { fill($('view'), h('p', { class: 'sp-status sp-warn', text: 'Template not found.' }), h('a', { href: 'racing-setup.html', text: '← Racing Setup' })); return; }
            const source = builtIn ? { name: `${builtIn.name} (copy)`, description: builtIn.description, kind: builtIn.kind, draft: builtIn.draft } : saved;
            Object.assign(editor, { mode: 'template', id: builtIn ? null : templateId, data: {
                ...JSON.parse(JSON.stringify(source.draft || {})), name: source.name, templateDescription: source.description || '', kind: source.kind || 'custom' }, dirty: Boolean(builtIn) });
            editor.id = templateId;
            editor.templateKey = builtIn ? null : templateId;
        }
        editor.data.questions = editor.data.questions || [];
        $('backLink').href = editor.mode === 'draft' ? 'season-planning-admin.html?tab=polls' : 'racing-setup.html';
        renderEditor();
    }

    function renderEditor() {
        const d = editor.data;
        const isDraft = editor.mode === 'draft';
        const plan = activePlan();
        const errors = h('div', { id: 'builderErrors', role: 'alert' });

        const basics = h('section', { class: 'sp-card' }, h('h2', { text: isDraft ? 'Poll details' : 'Template details' }),
            isDraft ? null : field('Template name', bindText(d, 'name', { max: 120 })),
            isDraft ? null : field('Template description', bindText(d, 'templateDescription', { max: 300 }), 'Shown when choosing a template.'),
            field(isDraft ? 'Poll title *' : 'Default poll title', bindText(d, 'title')),
            field('Short summary', bindText(d, 'summary', { max: 300 }), 'Shown on the drivers’ hub card.'),
            optionalField('Introduction', d, 'description', () => bindText(d, 'description', { multiline: true, rows: 3, max: 4000 }), 'Shown at the top of the poll.'),
            field('Type of poll', selectOf(Object.entries(KINDS), d.kind || 'custom', v => { d.kind = v; })),
            isDraft ? field('Season stage', selectOf([['', 'Standalone poll (not part of a season plan)'], ...(plan ? (plan.stages || []).filter(Boolean).map(s => [`${plan.id}|${s.id}`, `${plan.title}: ${s.label}`]) : [])],
                d.planId && d.stageId ? `${d.planId}|${d.stageId}` : '', v => { const [planId, stageId] = v.split('|'); d.planId = planId || undefined; d.stageId = stageId || undefined; })) : null);

        const timing = h('section', { class: 'sp-card' }, h('h2', { text: isDraft ? 'Timing and results' : 'Default results setting' }));
        if (isDraft) {
            const dateInput = key => {
                const input = h('input', { type: 'datetime-local', value: d[key] ? P.utcToLondonInput(d[key]) : '' });
                input.addEventListener('change', () => {
                    const value = P.londonInputToUtc(input.value);
                    d[key] = Number.isNaN(value) ? undefined : value;
                    markDirty();
                });
                return input;
            };
            timing.append(h('div', { class: 'sp-row' }, field('Opens (UK time)', dateInput('opensAt')), field('Closes (UK time)', dateInput('closesAt'))));
        }
        timing.append(field('Results', selectOf(Object.entries(P.VISIBILITY), d.resultVisibility || settings().resultVisibility, v => { d.resultVisibility = v; }),
            'Live: drivers see totals while voting. After closing: totals appear once the poll closes. Snapshot: only results you publish. Hidden: admins only.'),
            bindCheck(d, 'labelsHidden', 'Hide class names in results charts (presentation only)'));
        if (isDraft) {
            const pick = h('div', { class: 'sp-option-list', hidden: d.allDrivers !== false });
            const chosen = new Set(d.eligible || []);
            fill(pick, activeDrivers().map(([uid, driver]) => {
                const input = h('input', { type: 'checkbox', checked: chosen.has(uid) });
                input.addEventListener('change', () => { if (input.checked) chosen.add(uid); else chosen.delete(uid); d.eligible = [...chosen]; markDirty(); });
                return h('label', { class: 'sp-option' }, input, driver.name);
            }));
            const all = h('input', { type: 'checkbox', checked: d.allDrivers !== false });
            all.addEventListener('change', () => { d.allDrivers = all.checked; pick.hidden = all.checked; markDirty(); });
            timing.append(h('label', { class: 'sp-check' }, all, 'Every active driver can take part'), pick);
        }

        const questionsBox = h('div');
        const renderQuestions = () => fill(questionsBox, d.questions.map((q, i) => questionCard(q, i, renderQuestions)),
            d.questions.length ? null : h('p', { class: 'sp-muted', text: 'No questions yet.' }));
        renderQuestions();
        const addType = selectOf(Object.entries(P.QUESTION_TYPES), 'single', () => {});
        addType.setAttribute('aria-label', 'Type of question to add');
        const questions = h('section', { class: 'sp-card' }, h('h2', { text: 'Questions' }), questionsBox,
            h('div', { class: 'sp-add-question' }, addType,
                h('button', { type: 'button', class: 'sp-secondary', text: 'Add question', onclick: () => {
                    if (d.questions.length >= P.LIMITS.questions) return;
                    d.questions.push(P.blankQuestion(addType.value));
                    markDirty();
                    renderQuestions();
                    questionsBox.lastElementChild.querySelector('input').focus();
                } })));

        const actions = isDraft
            ? [h('button', { type: 'button', class: 'sp-secondary', text: 'Save draft', onclick: saveDraft }),
                h('button', { type: 'button', class: 'sp-secondary', text: 'Preview as driver', onclick: previewDraft }),
                h('button', { type: 'button', text: 'Publish…', onclick: publishDraft })]
            : [h('button', { type: 'button', class: 'sp-secondary', text: 'Preview as driver', onclick: previewDraft }),
                h('button', { type: 'button', text: 'Save template', onclick: saveTemplate })];
        fill($('view'),
            h('p', { class: 'sp-eyebrow' }, h('a', { href: isDraft ? '?tab=polls' : 'racing-setup.html', text: isDraft ? '← All polls' : '← Racing Setup' })),
            h('h2', { class: 'sp-section-title', style: 'margin-top:4px !important' }, isDraft ? 'Edit draft poll' : 'Edit template', ' ',
                h('span', { id: 'dirtyFlag', class: 'sp-badge sp-amber', hidden: !editor.dirty, text: 'Unsaved changes' })),
            d.replaces ? h('p', { class: 'sp-status sp-warn', text: 'This draft replaces a published poll. Publishing it closes the original and links the two.' }) : null,
            errors, basics, timing, questions,
            h('div', { class: 'sp-actionbar' }, h('span', { class: 'sp-small sp-muted', text: isDraft ? 'Drivers can’t see drafts.' : 'Templates only shape new drafts.' }), h('div', { class: 'sp-inline-actions' }, actions)),
            isDraft ? h('p', null, h('button', { type: 'button', class: 'sp-link', text: 'Save as template', onclick: draftToTemplate }),
                h('button', { type: 'button', class: 'sp-link', text: 'Delete draft', onclick: async () => { editor.dirty = false; await deleteDraft(editor.id, d); location.href = '?tab=polls'; } })) : null);
    }

    function questionCard(q, i, rerender) {
        const d = editor.data;
        const summary = h('p', { class: 'sp-question-summary', 'aria-live': 'polite' });
        const updateSummary = () => {
            const options = P.resolveOptions(q, state.catalogue);
            if (q.type === 'text') summary.textContent = `Written answer, up to ${q.maxLength || 0} characters${q.required ? '' : ' · optional'}.`;
            else {
                const built = P.buildDefinition({ title: 'x', questions: [q] }, state.catalogue).questions[0];
                summary.textContent = `${plural(options.length, 'option')}. Drivers see: “${P.describeQuota(built)}”${q.required ? '' : ' · optional'}`;
            }
        };
        const move = dir => { const j = i + dir; if (j < 0 || j >= d.questions.length) return; [d.questions[i], d.questions[j]] = [d.questions[j], d.questions[i]]; markDirty(); rerender(); };
        const typeSelect = selectOf(Object.entries(P.QUESTION_TYPES), q.type, value => {
            d.questions[i] = { ...P.blankQuestion(value), prompt: q.prompt, help: q.help };
            rerender();
        });
        const body = h('div');
        const card = h('article', { class: 'sp-question-card' },
            h('div', { class: 'sp-card-head' }, h('h3', { text: `Question ${i + 1}` }),
                h('div', { class: 'sp-inline-actions' },
                    h('button', { type: 'button', class: 'sp-link', text: '↑', 'aria-label': `Move question ${i + 1} up`, disabled: i === 0, onclick: () => move(-1) }),
                    h('button', { type: 'button', class: 'sp-link', text: '↓', 'aria-label': `Move question ${i + 1} down`, disabled: i === d.questions.length - 1, onclick: () => move(1) }),
                    h('button', { type: 'button', class: 'sp-link', text: 'Remove', 'aria-label': `Remove question ${i + 1}`, onclick: () => { d.questions.splice(i, 1); markDirty(); rerender(); } }))),
            field('Type', typeSelect),
            field('Question *', bindText(q, 'prompt', { max: 1000 })),
            optionalField('Help text', q, 'help', () => bindText(q, 'help', { max: 2000 }), 'Extra explanation under the question.'),
            bindCheck(q, 'required', 'Answer required', updateSummary),
            body, summary);
        if (q.required === undefined) q.required = true;
        card.querySelector('input[type="checkbox"]').checked = q.required !== false;
        fill(body, typeSpecific(q, updateSummary, rerender));
        updateSummary();
        return card;
    }

    function typeSpecific(q, updateSummary, rerender) {
        const parts = [];
        if (q.type === 'text') {
            parts.push(field('Character limit', bindNumber(q, 'maxLength', 1, 2000, updateSummary)));
            return parts;
        }
        if (q.type === 'yesno') return parts;
        if (q.source === 'fixed') {
            const labels = Object.values(q.fixedOptions || {}).map(o => o.label);
            parts.push(h('div', { class: 'sp-field' }, h('p', { style: 'font-weight:600;margin:0', text: 'Options (kept exactly from the original poll)' }),
                h('p', { class: 'sp-small', text: labels.join(', ') || 'None' }),
                q.type === 'single' || q.type === 'multi' ? h('button', { type: 'button', class: 'sp-link', text: 'Edit as a text list instead', onclick: () => { q.source = 'manual'; q.options = labels; delete q.fixedOptions; markDirty(); rerender(); } }) : null));
        } else if (q.type === 'single' || q.type === 'multi') {
            const area = h('textarea', { rows: 5, style: 'min-height:0;font-family:inherit;font-size:1rem' });
            area.value = (q.options || []).map(o => (typeof o === 'string' ? o : o.label)).join('\n');
            area.addEventListener('input', () => { q.options = area.value.split('\n').map(s => s.trim()).filter(Boolean); markDirty(); updateSummary(); });
            parts.push(field('Options, one per line', area));
        } else if (q.source === 'classes') {
            parts.push(catalogueChecklist(q, 'classes', updateSummary));
        } else if (q.source === 'layouts') {
            parts.push(locationChecklist(q, updateSummary));
        }
        if (q.type === 'multi' || q.type === 'class') {
            const min = bindNumber(q, 'minSelections', 0, 1000, updateSummary);
            const max = bindNumber(q, 'maxSelections', 0, 1000, updateSummary);
            const suggest = h('button', { type: 'button', class: 'sp-link', onclick: () => {
                const n = P.resolveOptions(q, state.catalogue).length;
                q.minSelections = q.maxSelections = P.defaultQuota(n);
                min.value = max.value = String(q.minSelections);
                markDirty();
                updateSummary();
            } }, 'Use the suggested quota (half, rounded up)');
            parts.push(h('div', { class: 'sp-row' }, field('Minimum choices', min), field('Maximum choices', max)),
                h('p', { class: 'sp-muted sp-small', style: 'margin-top:-6px', text: 'Set both to the same number for “choose exactly”.' }), suggest);
        }
        if (q.type === 'nomination') {
            parts.push(bindCheck(q, 'allowWriteIns', 'Drivers can write in their own suggestions', () => { updateSummary(); rerender(); }));
            if (q.allowWriteIns) parts.push(field('Most written suggestions per driver', bindNumber(q, 'maxWriteIns', 1, 200, updateSummary), 'A technical safeguard, not a quota (up to 200).'));
        }
        return parts;
    }

    function catalogueChecklist(q, group, updateSummary) {
        const entries = Object.entries((state.catalogue && state.catalogue[group]) || {}).filter(([, e]) => e.active !== false)
            .sort(([, a], [, b]) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
        if (!entries.length) return h('p', { class: 'sp-status sp-warn' }, 'No car classes in the catalogue yet. ', h('a', { href: 'racing-setup.html', text: 'Add them in Racing Setup' }), q.type === 'nomination' ? ' or rely on written suggestions.' : '.');
        const chosen = new Set(q.sourceIds || []);
        const list = h('div', { class: 'sp-checklist' }, entries.map(([id, e]) => {
            const input = h('input', { type: 'checkbox', checked: chosen.has(id) });
            input.addEventListener('change', () => { if (input.checked) chosen.add(id); else chosen.delete(id); q.sourceIds = [...chosen]; markDirty(); updateSummary(); });
            return h('label', { class: 'sp-check' }, input, e.name);
        }));
        return h('div', { class: 'sp-field' }, h('p', { style: 'font-weight:600;margin:0', text: 'Classes to offer' }),
            h('p', { class: 'sp-hint', text: 'Leave all unticked to offer every active class. Options are frozen when you publish.' }), list);
    }

    function locationChecklist(q, updateSummary) {
        const tracks = C.trackList(state.catalogue || {}).filter(t => !t.system);
        if (!tracks.length) return h('p', { class: 'sp-status sp-warn' }, 'The track catalogue isn’t set up yet. ', h('a', { href: 'racing-setup.html', text: 'Set it up in Racing Setup' }), ' first.');
        const locations = new Map();
        tracks.forEach(t => { if (!locations.has(t.locationId)) locations.set(t.locationId, { name: (state.catalogue.locations[t.locationId] || {}).name || t.shortName, layouts: [] }); locations.get(t.locationId).layouts.push(t.id); });
        const chosenLayouts = new Set(q.sourceIds || []);
        const sync = () => {
            const picked = [...list.querySelectorAll('input:checked')].flatMap(input => locations.get(input.value).layouts);
            q.sourceIds = picked.length === tracks.length ? [] : picked;
            markDirty();
            updateSummary();
        };
        const list = h('div', { class: 'sp-checklist' }, [...locations.entries()].sort(([, a], [, b]) => a.name.localeCompare(b.name)).map(([id, loc]) => {
            const input = h('input', { type: 'checkbox', value: id, checked: !chosenLayouts.size || loc.layouts.some(l => chosenLayouts.has(l)) });
            input.addEventListener('change', sync);
            return h('label', { class: 'sp-check' }, input, `${loc.name} (${loc.layouts.length})`);
        }));
        return h('div', { class: 'sp-field' }, h('p', { style: 'font-weight:600;margin:0', text: 'Locations to offer' }),
            h('p', { class: 'sp-hint', text: 'Each driver picks one layout. Untick locations to leave them out. Previous-season exclusions arrive with the season tools.' }), list);
    }

    function draftRecord() {
        return clean({ ...editor.data, updatedAt: sv().TIMESTAMP, updatedBy: state.uid });
    }

    async function saveDraft() {
        if (await save({ [`${V1}/drafts/${editor.id}`]: draftRecord() }, 'Draft saved.')) { editor.dirty = false; $('dirtyFlag').hidden = true; }
    }

    function previewDraft() {
        const d = editor.data;
        const errors = P.validateDraft({ ...d, title: d.title || 'Preview', opensAt: 0, closesAt: 1 }, state.catalogue).filter(e => !e.startsWith('Add a poll title'));
        if (errors.length) { showErrors(errors); return; }
        showErrors([]);
        previewDialog(P.buildDefinition({ ...d, title: d.title || 'Untitled poll' }, state.catalogue));
    }

    function showErrors(errors) {
        const box = $('builderErrors');
        if (!box) return;
        fill(box, errors.length ? h('div', { class: 'sp-status sp-error' }, 'Fix these first:', h('ul', { class: 'sp-errors' }, errors.map(e => h('li', { text: e })))) : null);
        if (errors.length) box.scrollIntoView({ block: 'center' });
    }

    // Everything written when a draft is published: frozen questions, counters at
    // zero, the hub entry and the history entry. Also closes a poll it replaces.
    function publishUpdatesFor(pollId, d) {
        const definition = P.buildDefinition(d, state.catalogue);
        const audit = auditId();
        const control = { ...P.buildControl(d), lastAuditId: audit };
        const updates = {
            ...SB.publishUpdates({ pollId, definition, control }),
            [`${V1}/polls/${pollId}/audit/${audit}`]: { at: sv().TIMESTAMP, by: state.uid, action: 'publish', reason: 'Published' },
            [`${V1}/index/${pollId}`]: { ...P.indexEntry(d, control), updatedAt: sv().TIMESTAMP },
            [`${V1}/drafts/${pollId}`]: null
        };
        if (d.replaces && state.index[d.replaces]) {
            const old = state.index[d.replaces];
            updates[`${V1}/index/${d.replaces}/replacedBy`] = pollId;
            if (['open', 'scheduled'].includes(P.pollPhase(old, now()))) {
                Object.assign(updates, SB.controlUpdates({ pollId: d.replaces, before: old, changes: { state: 'closed' }, auditId: auditId(), adminUid: state.uid,
                    reason: `Replaced by “${definition.title}”`, action: 'replace', timestamp: sv().TIMESTAMP }));
            }
        }
        return updates;
    }

    async function publishDraft() {
        const d = editor.data;
        const errors = P.validateDraft(d, state.catalogue);
        if (d.allDrivers === false && !(d.eligible || []).length) errors.push('Choose at least one driver, or let every active driver take part.');
        if (errors.length) { showErrors(errors); return; }
        showErrors([]);
        const definition = P.buildDefinition(d, state.catalogue);
        const phase = d.opensAt > now() ? `opens ${P.formatDateTime(d.opensAt)}` : 'opens straight away';
        const ok = await confirmDialog({
            title: 'Publish this poll?',
            body: h('div', null,
                h('p', null, h('strong', { text: definition.title }), ` ${phase} and closes ${P.formatDateTime(d.closesAt)}.`),
                h('p', { text: `${plural(definition.questionCount, 'question')}. Results: ${P.VISIBILITY[d.resultVisibility]}${d.labelsHidden ? ', names hidden' : ''}.` }),
                h('p', { class: 'sp-status sp-warn', text: 'Once published, the questions, options and quotas are frozen. You can still change the dates and the results setting.' })),
            confirmLabel: 'Publish'
        });
        if (!ok) return;
        const pollId = editor.id;
        const updates = publishUpdatesFor(pollId, d);
        editor.dirty = false;
        if (await save(updates, 'Published.')) location.href = `?poll=${encodeURIComponent(pollId)}`;
        else editor.dirty = true;
    }

    async function draftToTemplate() {
        const d = editor.data;
        const id = newId();
        const template = templateRecord({ ...d, name: d.title || 'Untitled template', templateDescription: d.summary || '' });
        if (await save({ [`${V1}/templates/${id}`]: template }, 'Saved as a template. Find it under Racing Setup → Templates & defaults.')) { /* stay on the draft */ }
    }

    function templateRecord(d) {
        return clean({
            name: (d.name || 'Untitled template').slice(0, 120), description: d.templateDescription || '', kind: d.kind || 'custom',
            draft: { title: d.title || '', summary: d.summary || '', description: d.description || '', questions: d.questions || [], resultVisibility: d.resultVisibility, labelsHidden: d.labelsHidden },
            updatedAt: sv().TIMESTAMP, updatedBy: state.uid
        });
    }

    async function saveTemplate() {
        const id = editor.templateKey || newId();
        if (await save({ [`${V1}/templates/${id}`]: templateRecord(editor.data) }, 'Template saved.')) {
            editor.dirty = false;
            if (!editor.templateKey) location.href = `?template=${encodeURIComponent(id)}`;
            else $('dirtyFlag').hidden = true;
        }
    }

    // ---------- A published poll ----------

    const detail = { control: undefined, definition: undefined, totals: null, audit: {}, snapshot: null, reveal: false, ballots: null };

    function startDetail() {
        const id = params.get('poll');
        $('backLink').href = 'season-planning-admin.html?tab=polls';
        const base = `${V1}/polls/${id}`;
        db().ref(`${base}/control`).on('value', s => { detail.control = s.val(); renderDetail(); });
        db().ref(`${base}/definition`).once('value').then(s => { detail.definition = s.val(); renderDetail(); });
        db().ref(`${base}/totals`).on('value', s => { detail.totals = s.val(); renderDetailResults(); });
        db().ref(`${base}/audit`).on('value', s => { detail.audit = s.val() || {}; renderHistory(); });
        db().ref(`${base}/snapshot`).on('value', s => { detail.snapshot = s.val(); renderDetailResults(); });
    }

    function renderDetail() {
        const id = params.get('poll');
        const control = detail.control;
        const definition = detail.definition;
        if (control === undefined || definition === undefined || state.index === null) return;
        if (!control || !definition) { fill($('view'), h('p', { class: 'sp-status sp-warn', text: 'Poll not found.' }), h('a', { href: '?tab=polls', text: '← All polls' })); return; }
        const entry = state.index[id] || {};
        const phase = P.pollPhase(control, now());
        const lifecycle = [];
        if (phase === 'open' || phase === 'scheduled') lifecycle.push(h('button', { type: 'button', class: 'sp-secondary', text: 'Close now', onclick: () => changeState(['closed'], 'Close this poll now?', 'close') }));
        if (phase === 'closed') lifecycle.push(h('button', { type: 'button', text: 'Finalise', onclick: () => changeState(control.state === 'published' ? ['closed', 'finalised'] : ['finalised'], 'Finalise this poll?', 'finalise') }));
        if (phase !== 'archived') lifecycle.push(h('button', { type: 'button', class: 'sp-link', text: 'Archive', onclick: () => changeState(['archived'], 'Archive this poll?', 'archive') }));
        lifecycle.push(h('button', { type: 'button', class: 'sp-link', text: 'Preview', 'aria-label': 'Preview as driver', onclick: () => previewDialog(definition) }),
            h('button', { type: 'button', class: 'sp-link', text: 'Duplicate', 'aria-label': 'Duplicate as a new draft', onclick: () => duplicate(false) }));
        if (phase !== 'finalised' && phase !== 'archived' && !entry.replacedBy) lifecycle.push(h('button', { type: 'button', class: 'sp-link', text: 'Replace…', 'aria-label': 'Replace with a corrected poll', onclick: () => duplicate(true) }));
        const eligible = control.allDrivers === false ? Object.keys(control.eligible || {}).map(driverName).join(', ') : 'Every active driver';

        fill($('view'),
            h('p', { class: 'sp-eyebrow' }, h('a', { href: '?tab=polls', text: '← All polls' })),
            h('h2', { class: 'sp-section-title', style: 'margin-top:4px !important' }, definition.title, ' ', phaseBadge(phase)),
            entry.replacedBy ? h('p', { class: 'sp-status sp-warn' }, 'Replaced by ', h('a', { href: `?poll=${encodeURIComponent(entry.replacedBy)}`, text: (state.index[entry.replacedBy] || {}).title || 'a newer poll' }), '.') : null,
            entry.replaces ? h('p', { class: 'sp-muted' }, 'Replaces ', h('a', { href: `?poll=${encodeURIComponent(entry.replaces)}`, text: (state.index[entry.replaces] || {}).title || 'an earlier poll' }), '.') : null,
            h('section', { class: 'sp-card' },
                h('dl', { class: 'sp-facts' },
                    h('dt', { text: 'Opens' }), h('dd', { text: P.formatDateTime(control.opensAt, { year: false }) }),
                    h('dt', { text: 'Closes' }), h('dd', { text: P.formatDateTime(control.closesAt, { year: false }) }),
                    h('dt', { text: 'Results' }), h('dd', { text: `${P.VISIBILITY[control.resultVisibility]}${control.labelsHidden ? ' · names hidden' : ''}` }),
                    h('dt', { text: 'Who can vote' }), h('dd', { text: eligible })),
                h('div', { class: 'sp-inline-actions' }, lifecycle)),
            phase === 'finalised' || phase === 'archived' ? null : settingsCard(control, phase),
            h('section', { class: 'sp-card' }, h('h2', { text: 'Results' }), h('div', { id: 'detailResults' })),
            h('section', { class: 'sp-card' }, h('h2', { text: 'Individual answers' }),
                h('p', { class: 'sp-muted sp-small', text: 'Only admins can see who answered what.' }), h('div', { id: 'detailBallots' },
                    h('button', { type: 'button', class: 'sp-secondary', text: 'Show individual answers', onclick: loadBallots }))),
            h('details', { class: 'sp-card sp-fold' }, h('summary', null, h('h2', { text: 'History' }), h('span', { class: 'sp-count', id: 'historyCount' })), h('div', { id: 'detailHistory' })));
        renderDetailResults();
        renderHistory();
        if (detail.ballots) renderBallots();
    }

    function settingsCard(control, phase) {
        const changes = {};
        const opens = h('input', { type: 'datetime-local', value: P.utcToLondonInput(control.opensAt), disabled: phase !== 'scheduled' });
        const closes = h('input', { type: 'datetime-local', value: P.utcToLondonInput(control.closesAt) });
        opens.addEventListener('change', () => { changes.opensAt = P.londonInputToUtc(opens.value); });
        closes.addEventListener('change', () => { changes.closesAt = P.londonInputToUtc(closes.value); });
        const visibility = selectOf(Object.entries(P.VISIBILITY), control.resultVisibility, v => { changes.resultVisibility = v; });
        const labels = h('input', { type: 'checkbox', checked: control.labelsHidden === true });
        labels.addEventListener('change', () => { changes.labelsHidden = labels.checked; });
        return h('details', { class: 'sp-card sp-fold' }, h('summary', null, h('h2', { text: 'Change dates or results setting' })),
            h('div', { class: 'sp-row' }, field('Opens (UK time)', opens, phase === 'scheduled' ? '' : 'Already open.'), field('Closes (UK time)', closes)),
            field('Results', visibility),
            h('label', { class: 'sp-check' }, labels, 'Hide class names in results (untick to reveal them to drivers)'),
            h('button', { type: 'button', text: 'Save changes', onclick: async () => {
                const diff = Object.fromEntries(Object.entries(changes).filter(([k, v]) => v !== control[k]));
                if (!Object.keys(diff).length) { setStatus('Nothing has changed.'); return; }
                const opensAt = diff.opensAt !== undefined ? diff.opensAt : control.opensAt;
                const closesAt = diff.closesAt !== undefined ? diff.closesAt : control.closesAt;
                if (!(opensAt < closesAt) || Number.isNaN(opensAt) || Number.isNaN(closesAt)) { setStatus('The closing time must be after the opening time.', 'error'); return; }
                const described = Object.entries(diff).map(([k, v]) => `${{ opensAt: 'Opens', closesAt: 'Closes', resultVisibility: 'Results', labelsHidden: 'Names hidden' }[k]}: ${k.endsWith('At') ? P.formatDateTime(v) : k === 'resultVisibility' ? P.VISIBILITY[v] : v ? 'yes' : 'no'}`);
                const result = await confirmDialog({ title: 'Save these changes?', body: h('ul', null, described.map(t => h('li', { text: t }))), reason: true, confirmLabel: 'Save changes',
                    reasonValue: diff.closesAt > control.closesAt ? 'Deadline extended' : diff.labelsHidden === false ? 'Class names revealed' : '' });
                if (!result) return;
                save(SB.controlUpdates({ pollId: params.get('poll'), before: control, changes: diff, auditId: auditId(), adminUid: state.uid, reason: result.reason, action: 'update-settings', timestamp: sv().TIMESTAMP }), 'Changes saved.');
            } }));
    }

    async function changeState(steps, title, action) {
        const control = detail.control;
        const body = h('p', { text: { close: 'Drivers will no longer be able to vote. Closed polls can’t be reopened; publish a replacement if needed.',
            finalise: 'This confirms the results. It doesn’t change any championship or rules settings.', archive: 'The poll moves to the archive for drivers and admins.' }[action] });
        const result = await confirmDialog({ title, body, reason: true, confirmLabel: title.replace(/ this poll\??| now\?/g, '').replace('?', '') });
        if (!result) return;
        let before = control;
        for (const next of steps) {
            const ok = await save(SB.controlUpdates({ pollId: params.get('poll'), before, changes: { state: next }, auditId: auditId(), adminUid: state.uid, reason: result.reason, action, timestamp: sv().TIMESTAMP }));
            if (!ok) return;
            before = { ...before, state: next };
        }
        setStatus('Saved.', 'ok');
    }

    async function duplicate(replace) {
        const id = params.get('poll');
        const definition = detail.definition;
        const control = detail.control;
        const entry = state.index[id] || {};
        const draft = clean({
            title: replace ? definition.title : `${definition.title} (copy)`, summary: entry.summary || '', description: definition.description || '', kind: entry.kind || 'custom',
            questions: P.draftQuestions(definition), opensAt: replace ? now() : Math.ceil(now() / 3600000) * 3600000, closesAt: replace ? control.closesAt : Math.ceil(now() / 3600000) * 3600000 + settings().durationDays * P.DAY,
            resultVisibility: control.resultVisibility, labelsHidden: control.labelsHidden === true, allDrivers: control.allDrivers !== false,
            eligible: control.allDrivers === false ? Object.keys(control.eligible || {}) : undefined, planId: entry.planId, stageId: entry.stageId,
            replaces: replace ? id : undefined, updatedAt: sv().TIMESTAMP, updatedBy: state.uid
        });
        const draftId = newId();
        if (await save({ [`${V1}/drafts/${draftId}`]: draft })) location.href = `?draft=${encodeURIComponent(draftId)}`;
    }

    function renderDetailResults() {
        const box = $('detailResults');
        if (!box || !detail.definition || !detail.control) return;
        const control = detail.control;
        const respondents = (detail.totals && detail.totals.respondents) || 0;
        const eligible = eligibleCount(null, control);
        const charts = h('div');
        const hidden = control.labelsHidden === true && !detail.reveal;
        UI.renderResults(charts, { definition: detail.definition, totals: detail.totals || {}, pollId: params.get('poll'), labelsHidden: hidden, provisional: control.state !== 'finalised', title: detail.definition.title });
        fill(box,
            h('p', null, h('strong', { text: `${respondents} of ${eligible}` }), ' eligible drivers have responded.'),
            control.labelsHidden ? h('label', { class: 'sp-check' }, h('input', { type: 'checkbox', checked: detail.reveal, onchange: e => { detail.reveal = e.target.checked; renderDetailResults(); } }),
                'Show class names here (only on your screen; downloads follow this choice)') : null,
            charts,
            h('div', { class: 'sp-inline-actions', style: 'margin-top:12px' },
                h('button', { type: 'button', class: 'sp-secondary', text: detail.snapshot ? 'Publish updated snapshot' : 'Publish results snapshot', onclick: publishSnapshot }),
                h('button', { type: 'button', class: 'sp-link', text: 'Recount from ballots', onclick: recount })),
            h('p', { class: 'sp-muted sp-small', text: detail.snapshot ? `Snapshot published ${P.formatDateTime(detail.snapshot.at)}. Drivers see it when Results is set to “Published snapshot only”.` : 'A snapshot freezes the current totals for drivers when Results is set to “Published snapshot only”.' }));
    }

    async function publishSnapshot() {
        const result = await confirmDialog({ title: 'Publish a results snapshot?', body: h('p', { text: `Freezes the current totals (${(detail.totals && detail.totals.respondents) || 0} respondents) for drivers.` }), reason: true, reasonValue: 'Results published', confirmLabel: 'Publish snapshot' });
        if (!result) return;
        const id = params.get('poll');
        const audit = auditId();
        save({ [`${V1}/polls/${id}/snapshot`]: { at: sv().TIMESTAMP, by: state.uid, totals: detail.totals || { respondents: 0 } },
            [`${V1}/polls/${id}/audit/${audit}`]: { at: sv().TIMESTAMP, by: state.uid, action: 'publish-snapshot', reason: result.reason } }, 'Snapshot published.');
    }

    async function recount() {
        const id = params.get('poll');
        let ballots;
        try { ballots = (await db().ref(`${V1}/polls/${id}/ballots`).once('value')).val() || {}; }
        catch (error) { setStatus(`Could not read ballots: ${error.message}`, 'error'); return; }
        const expected = SB.computeTotals(detail.definition, ballots);
        const differences = SB.compareTotals(expected, detail.totals);
        if (!differences.length) { await confirmDialog({ title: 'Recount complete', body: h('p', { text: `The totals match all ${plural(Object.keys(ballots).length, 'ballot')}.` }), confirmLabel: 'OK' }); return; }
        const result = await confirmDialog({ title: 'Totals don’t match the ballots', body: h('div', null, h('p', { text: 'Recounting the ballots found these differences:' }),
            h('ul', null, differences.map(d => h('li', { text: `${d.path}: stored ${d.actual}, ballots say ${d.expected === null ? 'not an option' : d.expected}` })))),
        reason: true, reasonValue: 'Recount repair', confirmLabel: 'Repair totals' });
        if (!result) return;
        const audit = auditId();
        save({ [`${V1}/polls/${id}/totals`]: expected, [`${V1}/polls/${id}/audit/${audit}`]: { at: sv().TIMESTAMP, by: state.uid, action: 'recount', reason: result.reason, before: { differences } } }, 'Totals repaired.');
    }

    async function loadBallots() {
        try {
            const snapshot = await db().ref(`${V1}/polls/${params.get('poll')}/ballots`).once('value');
            detail.ballots = snapshot.val() || {};
            renderBallots();
        } catch (error) { setStatus(`Could not read answers: ${error.message}`, 'error'); }
    }

    function renderBallots() {
        const box = $('detailBallots');
        if (!box) return;
        const entries = Object.entries(detail.ballots).sort(([a], [b]) => driverName(a).localeCompare(driverName(b)));
        fill(box, entries.length ? entries.map(([uid, ballot]) => h('details', { class: 'sp-group' },
            h('summary', null, h('span', { text: driverName(uid) }), ballot.revision > 1 ? h('span', { class: 'sp-badge sp-amber', text: 'Corrected' }) : null,
                h('span', { class: 'sp-count', text: P.formatDateTime(ballot.submittedAt, { year: false }) })),
            h('div', { class: 'sp-group-body' }, UI.answerSummary(detail.definition, UI.answersFromBallot(detail.definition, ballot)),
                h('button', { type: 'button', class: 'sp-secondary', text: 'Correct these answers', onclick: () => correctBallot(uid) }))))
            : h('p', { class: 'sp-muted', text: 'No answers yet.' }),
        h('button', { type: 'button', class: 'sp-link', text: 'Refresh', onclick: loadBallots }));
    }

    // Admin correction: edit with the normal form, give a reason, save the ballot,
    // counter changes and audit entry together.
    async function correctBallot(uid) {
        const id = params.get('poll');
        const definition = detail.definition;
        let oldBallot;
        try { oldBallot = (await db().ref(`${V1}/polls/${id}/ballots/${uid}`).once('value')).val(); }
        catch (error) { setStatus(`Could not read the ballot: ${error.message}`, 'error'); return; }
        const answers = UI.answersFromBallot(definition, oldBallot);
        const panel = h('div', { class: 'sp-preview' });
        UI.renderForm(panel, { definition, answers, onChange: () => {}, onReview: () => $('dialogReason').focus() });
        panel.querySelector('.sp-actionbar').hidden = true;
        const result = await confirmDialog({ title: `Correct ${driverName(uid)}’s answers`, wide: true, body: panel, reason: true, reasonLabel: 'Reason for the correction (kept in the history)', confirmLabel: 'Save correction' });
        if (!result) return;
        const tidy = SB.normaliseAnswers(definition, answers);
        const problems = SB.validateAnswers(definition, tidy);
        if (problems.length) { setStatus(`Not saved: ${problems.map(p => `question ${p.question + 1}: ${p.message}`).join(' ')}`, 'error'); return; }
        const ok = await save(SB.correctionUpdates({ pollId: id, uid, definition, oldBallot, answers: tidy, auditId: auditId(), adminUid: state.uid, reason: result.reason,
            increment: sv().increment, timestamp: sv().TIMESTAMP }), 'Correction saved.');
        if (!ok) setStatus('Not saved. Someone may have changed this ballot at the same time; refresh and try again.', 'error');
        loadBallots();
    }

    function renderHistory() {
        const box = $('detailHistory');
        if (!box) return;
        const entries = Object.values(detail.audit || {}).sort((a, b) => (b.at || 0) - (a.at || 0));
        if ($('historyCount')) $('historyCount').textContent = `(${entries.length})`;
        const describe = entry => {
            const after = entry.after && typeof entry.after === 'object' && !Array.isArray(entry.after) && entry.action !== 'correct-ballot'
                ? Object.entries(entry.after).map(([k, v]) => `${k} → ${k.endsWith('At') ? P.formatDateTime(v) : v}`).join(', ') : '';
            return [entry.targetUid ? `for ${driverName(entry.targetUid)}` : '', after].filter(Boolean).join(' · ');
        };
        fill(box, entries.length ? h('ul', { class: 'sp-list' }, entries.map(entry => h('li', { class: 'sp-item', style: 'grid-template-columns:1fr' },
            h('div', null, h('div', { class: 'sp-item-title', text: `${entry.action.replace(/-/g, ' ')} — ${entry.reason}` }),
                h('div', { class: 'sp-item-meta', text: `${P.formatDateTime(entry.at)} by ${driverName(entry.by)}${describe(entry) ? ` · ${describe(entry)}` : ''}` })))))
            : h('p', { class: 'sp-muted', text: 'No changes recorded.' }));
    }

    // ---------- Start ----------

    // Wait for every list the views use before drawing, so menus aren't missing entries.
    const loaded = new Set();
    const NEEDED = ['index', 'drafts', 'plans', 'templates', 'settings', 'catalogue', 'drivers', 'visibility'];
    function route() {
        if (!NEEDED.every(key => loaded.has(key))) return;
        if (params.get('poll')) renderDetail();
        else if (params.get('draft') || params.get('template')) startEditor();
        else renderMain();
    }

    function listen(path, key, fallback) {
        db().ref(path).on('value', snapshot => { state[key] = snapshot.val() || fallback; loaded.add(key); route(); }, error => {
            console.error(`Could not load ${path}:`, error);
            setStatus(`Could not load ${key}: ${error.message}`, 'error');
        });
    }

    // Shared with season-planning-tools.js.
    window.SeasonAdmin = {
        V1, state, params, now, newId, auditId, save, setStatus, confirmDialog, previewDialog, activePlan, driverName, activeDrivers, settings,
        clean, plural, phaseBadge, field, KINDS, rerender: () => route(), publishUpdatesFor, visibilityCard, pollsTab, newPoll, completePlan,
        addTab: tab => { extraTabs.push(tab); }
    };

    document.addEventListener('oneEleven:adminDriver', event => {
        if (state.uid) return;
        state.uid = event.detail.user.uid;
        setStatus('');
        db().ref('.info/serverTimeOffset').on('value', snapshot => { serverOffset = snapshot.val() || 0; });
        db().ref('drivers').once('value').then(snapshot => { state.drivers = snapshot.val() || {}; loaded.add('drivers'); route(); },
            error => setStatus(`Could not load drivers: ${error.message}`, 'error'));
        listen(`${V1}/index`, 'index', {});
        listen(`${V1}/drafts`, 'drafts', {});
        listen(`${V1}/plans`, 'plans', {});
        listen(`${V1}/templates`, 'templates', {});
        listen(`${V1}/settings`, 'settings', {});
        listen(`${V1}/catalogue`, 'catalogue', {});
        listen(`${V1}/visibility`, 'visibility', {});
        if (params.get('poll')) startDetail();
    });
})();
