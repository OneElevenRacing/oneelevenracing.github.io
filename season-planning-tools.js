// Season tools for the Season Planning Admin page: Suggestions, Voting rounds,
// Tracks, Rules and History. Decisions are stored in seasonPlanning/v1/planAdmin
// (admins only) and every decision adds a log entry. Logic is in season-admin-core.js.
(function () {
    'use strict';
    const A = window.SeasonAdmin;
    const AC = window.SeasonAdminCore;
    const UI = window.SeasonUI;
    const P = window.SeasonPolls;
    const R = window.SeasonResults;
    const C = window.OneElevenCatalogue;
    const SB = window.SeasonBallot;
    const { h, fill } = UI;
    const V1 = A.V1;
    const db = () => firebase.database();
    const sv = () => firebase.database.ServerValue;
    const tools = { planId: null, planAdmin: {}, cache: {}, seasons: null, written: null };

    // Firebase keys can't contain . # $ [ ] /, so written-suggestion keys are encoded.
    const encodeKey = key => key.replace(/[.#$[\]/%]/g, ch => `%${ch.charCodeAt(0).toString(16)}`);
    const decodeKey = key => key.replace(/%([0-9a-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    const planPath = () => `${V1}/planAdmin/${tools.planId}`;

    // Saved track-name resolutions as { name: locationId } (new entries keep the name
    // inside the value; older ones used the encoded name as the key).
    function unknownNames(stored) {
        return Object.fromEntries(Object.entries((stored && stored.unknown) || {}).filter(([, v]) => v)
            .map(([k, v]) => (typeof v === 'object' ? [v.name, v.locationId] : [decodeKey(k), v])));
    }
    const stamp = () => ({ at: sv().TIMESTAMP, by: A.state.uid });

    function logEntry(action, summary) {
        return { [`${planPath()}/log/${A.newId()}`]: { ...stamp(), action, summary: String(summary).slice(0, 500) } };
    }

    async function decide(updates, action, summary, message) {
        return A.save({ ...updates, ...logEntry(action, summary) }, message || 'Saved.');
    }

    function planPolls(kind) {
        return Object.entries(A.state.index || {}).map(([id, e]) => ({ id, ...e, phase: P.pollPhase(e, A.now()) }))
            .filter(p => p.planId === tools.planId && (!kind || p.kind === kind) && !p.replacedBy)
            .sort((a, b) => a.opensAt - b.opensAt);
    }

    // A poll's definition (an admin can still edit it while it's open) plus live
    // totals, control and, when asked for, live ballots. Each is subscribed to once for the page's lifetime, so
    // decisions always use the current answers and a failed read isn't retried in a loop.
    function pollData(id, { ballots = false } = {}) {
        const entry = tools.cache[id] || (tools.cache[id] = {});
        const base = `${V1}/polls/${id}`;
        const failed = error => { entry.error = error.message; A.rerender(); };
        if (!entry.subscribed) {
            entry.subscribed = true;
            db().ref(`${base}/definition`).on('value', s => {
                entry.definition = s.val();
                entry.error = entry.definition ? entry.error : 'This poll has no questions saved.';
                A.rerender();
            }, failed);
            db().ref(`${base}/totals`).on('value', s => { entry.totals = s.val(); A.rerender(); }, failed);
            db().ref(`${base}/control`).on('value', s => { entry.control = s.val(); A.rerender(); }, failed);
        }
        if (ballots && !entry.ballotsSubscribed) {
            entry.ballotsSubscribed = true;
            db().ref(`${base}/ballots`).on('value', s => { entry.ballots = s.val() || {}; A.rerender(); }, error => { entry.ballots = entry.ballots || {}; failed(error); });
        }
        return entry;
    }

    const loading = () => h('p', { class: 'sp-muted', text: 'Loading…' });
    // append() would print null as text, so leave empty parts out.
    const put = (element, ...children) => element.append(...children.flat().filter(c => c !== null && c !== undefined && c !== false && c !== ''));
    const needPlan = () => h('p', { class: 'sp-status sp-warn' }, 'Start a season on the ', h('a', { href: 'season-planning-admin.html', text: 'Season' }), ' page first.');
    const optionList = (pairs, value) => pairs.map(([v, label]) => h('option', { value: v, text: label, selected: v === value }));
    const select = (pairs, value, label) => h('select', { 'aria-label': label }, optionList(pairs, value));
    const classPairs = () => Object.entries((A.state.catalogue && A.state.catalogue.classes) || {}).filter(([, c]) => c.active !== false)
        .sort(([, a], [, b]) => a.name.localeCompare(b.name)).map(([id, c]) => [id, c.name]);

    function pollPicker(polls, chosen, onPick, label) {
        if (polls.length < 2) return null;
        const picker = select(polls.map(p => [p.id, `${p.title} (${p.phase})`]), chosen, label);
        picker.addEventListener('change', () => onPick(picker.value));
        return h('div', { class: 'sp-field' }, h('label', { text: label }), picker);
    }

    // A poll prepared by a season step: set the closing date (and an optional message),
    // then publish straight away, or save it as a draft to edit the questions first.
    // Remembers what the admin was shown. Call the returned check when they confirm:
    // if the live data has changed meanwhile it explains, redraws and returns false,
    // so a decision is never saved on the basis of out-of-date information.
    function snapshotOf(compute, message) {
        const before = JSON.stringify(compute());
        return () => {
            if (JSON.stringify(compute()) === before) return true;
            A.setStatus(message || 'Something changed while this was open, so nothing was saved. Check the latest information and try again.', 'warn');
            A.rerender();
            return false;
        };
    }

    async function createDraft(draft, action, summary, extraUpdates = () => ({}), stillCurrent = () => true) {
        const definition = P.buildDefinition({ ...draft, title: draft.title || 'Poll' }, A.state.catalogue);
        const closes = h('input', { type: 'datetime-local', value: P.utcToLondonInput(draft.closesAt) });
        const message = h('textarea', { rows: 2, maxLength: 4000, style: 'min-height:0;font-family:inherit;font-size:16px' });
        message.value = draft.description || '';
        const first = definition.questions[0];
        const body = h('div', null,
            h('p', { style: 'margin-top:0' }, h('strong', { text: draft.title }), ` · ${A.plural(definition.questionCount, 'question')}`),
            first ? h('p', { class: 'sp-small sp-muted', text: `Drivers see: “${first.prompt}” — ${P.describeQuota(first)}` }) : null,
            A.field('Voting closes (UK time)', closes),
            A.field('Message for drivers (optional)', message),
            h('p', { class: 'sp-small sp-muted', text: `Opens as soon as you publish. Results: ${P.VISIBILITY[draft.resultVisibility] || 'after closing'}${draft.labelsHidden ? ', class names hidden' : ''}.` }));
        const choice = await A.confirmDialog({ title: 'Ready to publish', body, confirmLabel: 'Publish now', altLabel: 'Edit questions first' });
        if (!choice || !stillCurrent()) return;
        const id = A.newId();
        const closesAt = P.londonInputToUtc(closes.value);
        const ready = A.clean({ ...draft, opensAt: A.now(), closesAt: Number.isNaN(closesAt) ? draft.closesAt : closesAt, description: message.value.trim() || undefined });
        if (choice.alt) {
            const ok = await decide({ [`${V1}/drafts/${id}`]: A.clean({ ...ready, updatedAt: sv().TIMESTAMP, updatedBy: A.state.uid }), ...extraUpdates(id) }, action, `${summary} (draft)`, 'Draft saved.');
            if (ok) location.href = `season-planning-admin.html?draft=${encodeURIComponent(id)}`;
            return;
        }
        const errors = P.validateDraft(ready, A.state.catalogue);
        if (errors.length) { A.setStatus(`Not published: ${errors.join(' ')}`, 'error'); return; }
        await decide({ ...A.publishUpdatesFor(id, ready), ...extraUpdates(id) }, action, `${summary} (published)`, `Published “${ready.title}”.`);
    }

    // Drafts saved from a step ("Edit questions first", or Save draft in the editor),
    // newest first, so the step can offer them again.
    function planDrafts(kind) {
        return Object.entries(A.state.drafts || {}).filter(([, d]) => d && d.kind === kind && d.planId === tools.planId)
            .map(([id, d]) => ({ id, ...d })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }

    function draftNotice(kind) {
        const list = planDrafts(kind);
        if (!list.length) return null;
        return h('section', { class: 'sp-card sp-draft-notice' },
            h('h2', { text: list.length === 1 ? 'Saved draft' : 'Saved drafts' }),
            h('p', { class: 'sp-small sp-muted', style: 'margin:0 0 4px', text: 'Drivers can’t see drafts. Open one to finish the questions and publish it.' }),
            h('ul', { class: 'sp-clist' }, list.map(d => h('li', { class: 'sp-crow' },
                h('span', { class: 'sp-crow-name' }, h('span', { class: 'sp-crow-title', text: d.title || 'Untitled poll' }),
                    h('span', { class: 'sp-crow-meta', text: d.updatedAt ? `Saved ${P.formatDateTime(d.updatedAt, { year: false })}` : 'Not published yet' })),
                h('span', { class: 'sp-crow-actions' }, h('a', { class: 'sp-btn sp-btn-small', href: `season-planning-admin.html?draft=${encodeURIComponent(d.id)}`, text: 'Open draft' }))))));
    }

    // ---------- Suggestions ----------

    const nomination = { pollId: null };

    function suggestionsTab() {
        if (!tools.planId) return needPlan();
        const polls = planPolls('nomination');
        if (!polls.length) return h('div', null, h('p', { class: 'sp-status', text: 'No car-class suggestion poll in this season plan yet.' }),
            h('p', { class: 'sp-muted', text: 'Create one from the “Car-class suggestions” template on the Polls tab and link it to this plan.' }));
        if (!polls.some(p => p.id === nomination.pollId)) nomination.pollId = polls[polls.length - 1].id;
        const data = pollData(nomination.pollId, { ballots: true });
        if (data.error) return h('p', { class: 'sp-status sp-error', text: data.error });
        if (!data.definition || !data.ballots) return loading();
        const reviewRaw = ((tools.planAdmin.nominations || {})[nomination.pollId]) || {};
        // Stored under safe codes with the text in `key`; older entries used encoded text keys.
        const review = Object.fromEntries(Object.entries(reviewRaw).map(([k, v]) => [v && typeof v.key === 'string' ? v.key : decodeKey(k), v]));
        const result = AC.aggregateNominations(data.definition, data.ballots, A.state.catalogue, review);
        const liveReview = () => Object.fromEntries(Object.entries(((tools.planAdmin.nominations || {})[nomination.pollId]) || {})
            .map(([k, v]) => [v && typeof v.key === 'string' ? v.key : decodeKey(k), v]));
        const unchanged = snapshotOf(() => AC.aggregateNominations(data.definition, data.ballots, A.state.catalogue, liveReview()).candidates.map(c => [c.id, c.count, c.label]),
            'The suggestions or your review changed while you were choosing. Nothing was saved; check the shortlist again.');
        const poll = polls.find(p => p.id === nomination.pollId);
        return h('div', null,
            pollPicker(polls, nomination.pollId, id => { nomination.pollId = id; A.rerender(); }, 'Suggestion poll'),
            h('p', null, h('strong', { text: poll.title }), ` · ${A.plural(result.respondents, 'response')} · `, A.phaseBadge(poll.phase),
),
            writeInCard(result),
            shortlistCard(result, unchanged));
    }

    function writeInCard(result) {
        const groups = result.writeIns;
        const statusBadge = g => ({ pending: h('span', { class: 'sp-badge sp-amber', text: 'To review' }), merged: h('span', { class: 'sp-badge', text: 'Merged' }),
            mapped: h('span', { class: 'sp-badge sp-green', text: `Counts for ${className(g.classId)}` }), excluded: h('span', { class: 'sp-badge', text: 'Excluded' }) }[g.status]);
        return h('section', { class: 'sp-card' }, h('h2', { text: 'Written suggestions' }),
            h('p', { class: 'sp-muted sp-small', text: 'Identical wording (ignoring capitals, accents and spaces) is grouped automatically. Drivers’ original text is never changed.' }),
            groups.length ? h('ul', { class: 'sp-list' }, groups.map(g => h('li', { class: 'sp-item', style: 'grid-template-columns:1fr' },
                h('div', null,
                    h('div', { class: 'sp-item-title' }, g.label, ' ', statusBadge(g)),
                    h('div', { class: 'sp-item-meta', text: `${A.plural(g.count, 'driver')} · written as: ${g.variants.map(v => `“${v}”`).join(', ')}` }),
                    g.decision && g.decision.note ? h('div', { class: 'sp-item-meta', text: `Note: ${g.decision.note}` }) : null,
                    g.decision && g.decision.action === 'merge' ? h('div', { class: 'sp-item-meta', text: `Merged into “${(groups.find(x => x.key === g.decision.target) || {}).label || g.decision.target}”` }) : null),
                h('div', { class: 'sp-inline-actions' }, writeInActions(g, groups)))))
                : h('p', { class: 'sp-muted', text: 'No written suggestions.' }));
    }

    const className = id => ((A.state.catalogue.classes || {})[id] || {}).name || id;

    function writeInActions(group, groups) {
        const path = `${planPath()}/nominations/${nomination.pollId}/${C.storageKey(group.key, 'w')}`;
        const legacyPath = `${planPath()}/nominations/${nomination.pollId}/${encodeKey(group.key)}`;
        const record = (decision, summary) => decide({
            [path]: decision ? { ...decision, key: group.key, ...stamp() } : null,
            ...(group.decision && !group.decision.key ? { [legacyPath]: null } : {})
        }, 'review-suggestion', summary);
        if (group.decision) return [h('button', { type: 'button', class: 'sp-link', text: 'Undo decision', onclick: () => record(null, `Undid the decision for “${group.label}”`) })];
        const actions = [];
        if (group.suggestedClassId) {
            actions.push(h('button', { type: 'button', class: 'sp-secondary', text: `Count for ${className(group.suggestedClassId)}`,
                onclick: () => record({ action: 'map', classId: group.suggestedClassId }, `“${group.label}” counts for ${className(group.suggestedClassId)}`) }));
        }
        actions.push(h('button', { type: 'button', class: 'sp-link', text: 'Match to a class…', onclick: async () => {
            const picker = select(classPairs(), '', 'Class');
            const ok = await A.confirmDialog({ title: `Match “${group.label}”`, body: h('div', null, h('p', { text: 'Votes for this suggestion will count for the class you choose.' }), picker), confirmLabel: 'Match' });
            if (ok && picker.value) record({ action: 'map', classId: picker.value }, `“${group.label}” counts for ${className(picker.value)}`);
        } }));
        const others = groups.filter(g => g.key !== group.key && g.root === g.key);
        if (others.length) actions.push(h('button', { type: 'button', class: 'sp-link', text: 'Merge with…', onclick: async () => {
            const picker = select(others.map(g => [g.key, g.label]), '', 'Merge into');
            const ok = await A.confirmDialog({ title: `Merge “${group.label}”`, body: h('div', null, h('p', { text: 'Treat this as the same suggestion as:' }), picker), confirmLabel: 'Merge' });
            if (ok) record({ action: 'merge', target: picker.value }, `“${group.label}” merged into “${(groups.find(g => g.key === picker.value) || {}).label}”`);
        } }));
        actions.push(h('button', { type: 'button', class: 'sp-link', text: 'Add as a new class', onclick: async () => {
            const name = h('input', { type: 'text', value: group.label, maxLength: 120 });
            // Spellings merged into this suggestion become search aliases too.
            const spellings = groups.filter(g => g.root === group.key).flatMap(g => g.variants);
            const ok = await A.confirmDialog({ title: 'Add a new car class', body: h('div', null, A.field('Class name', name), h('p', { class: 'sp-muted sp-small', text: `Other spellings (${spellings.join(', ')}) are saved as search aliases.` })), confirmLabel: 'Add class' });
            if (!ok || !name.value.trim()) return;
            const conflicts = C.findConflicts(A.state.catalogue.classes || {}, { name: name.value.trim() }, null);
            if (conflicts.length) { A.setStatus(`“${name.value.trim()}” is already a class (${conflicts[0].otherName}). Use “Match to a class” instead.`, 'error'); return; }
            const classId = C.uniqueId(name.value.trim(), new Set(Object.keys(A.state.catalogue.classes || {})));
            const aliases = C.parseAliases(spellings).filter(v => C.nameKey(v) !== C.nameKey(name.value));
            decide({
                [`${V1}/catalogue/classes/${classId}`]: A.clean({ name: name.value.trim(), aliases: aliases.length ? aliases : undefined, active: true, updatedAt: sv().TIMESTAMP, updatedBy: A.state.uid }),
                [`${V1}/catalogue/revision`]: sv().increment(1),
                [path]: { action: 'new', classId, ...stamp() }
            }, 'review-suggestion', `Added “${name.value.trim()}” to the catalogue from a written suggestion`, `Added ${name.value.trim()} to the catalogue.`);
        } }));
        actions.push(h('button', { type: 'button', class: 'sp-link', text: 'Exclude…', onclick: async () => {
            const result = await A.confirmDialog({ title: `Exclude “${group.label}”`, body: h('p', { text: 'It won’t be offered in voting. Drivers don’t see this note.' }), reason: true, reasonLabel: 'Internal note', confirmLabel: 'Exclude' });
            if (result) record({ action: 'exclude', note: result.reason }, `Excluded “${group.label}”: ${result.reason}`);
        } }));
        return actions;
    }

    function shortlistCard(result, unchanged) {
        const saved = (tools.planAdmin.shortlist && tools.planAdmin.shortlist.pollId === nomination.pollId) ? tools.planAdmin.shortlist : null;
        const chosen = new Map((saved ? Object.values(saved.items || {}) : []).map(item => [item.classId, item.label]));
        const rows = result.candidates.map(c => {
            const box = h('input', { type: 'checkbox', checked: c.classId && chosen.has(c.classId), disabled: !c.classId, 'aria-label': `Include ${c.label}` });
            const label = h('input', { type: 'text', value: (c.classId && chosen.get(c.classId)) || c.label, maxLength: 200, disabled: !c.classId, 'aria-label': `Ballot wording for ${c.label}` });
            return { c, box, label, row: h('tr', null, h('td', null, box), h('td', null, label, c.needsDecision ? h('div', { class: 'sp-small sp-red-text', text: 'Decide on this written suggestion first' }) : null),
                h('td', { text: String(c.count) }), h('td', { class: 'sp-muted', text: `${c.fromCatalogue} picked · ${c.fromWriteIns} written` })) };
        });
        const count = h('p', { class: 'sp-small', 'aria-live': 'polite' });
        const picked = () => rows.filter(r => r.box.checked && r.c.classId).map(r => ({ classId: r.c.classId, label: r.label.value.trim() || r.c.label }));
        const updateCount = () => {
            const n = picked().length;
            count.textContent = n ? `${A.plural(n, 'class', 'classes')} on the shortlist. Round 1 would ask drivers to choose ${P.defaultQuota(n)}.` : 'Tick the classes for round 1.';
        };
        rows.forEach(r => { r.box.addEventListener('change', updateCount); });
        updateCount();
        const saveShortlist = () => decide({ [`${planPath()}/shortlist`]: { pollId: nomination.pollId, items: picked(), ...stamp() } }, 'shortlist', `Shortlist: ${picked().map(i => i.label).join(', ')}`, 'Shortlist saved.');
        return h('section', { class: 'sp-card' }, h('h2', { text: 'Candidates and shortlist' }),
            h('p', { class: 'sp-muted sp-small', text: 'Each driver counts once per class, however many ways they suggested it. Edit the wording drivers will see on the ballot if needed.' }),
            result.pending ? h('p', { class: 'sp-status sp-warn', text: `${A.plural(result.pending, 'written suggestion')} still to review.` }) : null,
            h('div', { class: 'sp-table-wrap' }, h('table', null,
                h('thead', null, h('tr', null, h('th', { text: 'Use' }), h('th', { text: 'Class (ballot wording)' }), h('th', { text: 'Drivers' }), h('th', { text: 'How' }))),
                h('tbody', null, rows.map(r => r.row)))),
            count,
            h('div', { class: 'sp-inline-actions' },
                h('button', { type: 'button', class: 'sp-secondary', text: 'Save shortlist', onclick: saveShortlist }),
                h('button', { type: 'button', text: 'Start round 1', onclick: () => {
                    const items = picked();
                    if (items.length < 2) { A.setStatus('Choose at least two classes for a voting round.', 'error'); return; }
                    if (!unchanged()) return;
                    const draft = AC.roundDraft({ plan: A.activePlan(), number: 1, options: items.map(i => ({ id: i.classId, label: i.label })), settings: A.settings(), now: A.now() });
                    createDraft(draft, 'create-round', `Round 1 with ${items.length} classes`, id => ({
                        [`${planPath()}/shortlist`]: { pollId: nomination.pollId, items, ...stamp() },
                        [`${planPath()}/rounds/${id}`]: { number: 1, ...stamp() }
                    }), unchanged);
                } })));
    }

    // ---------- Voting rounds ----------

    function roundsTab() {
        if (!tools.planId) return needPlan();
        const rounds = planPolls('elimination');
        const meta = tools.planAdmin.rounds || {};
        const draftRounds = Object.entries(A.state.drafts || {}).filter(([id, d]) => d && d.kind === 'elimination' && (d.planId === tools.planId || meta[id]));
        return h('div', null,
            winnerCard(),
            rounds.length ? rounds.map(poll => roundCard(poll, meta[poll.id] || {})) : h('p', { class: 'sp-status', text: 'No voting rounds yet. Pick the shortlist in the suggestions step to start round 1.' }),
            draftRounds.length ? h('section', { class: 'sp-card' }, h('h2', { text: 'Rounds still in draft' }),
                h('ul', { class: 'sp-list' }, draftRounds.map(([id, d]) => h('li', { class: 'sp-item' }, h('div', { class: 'sp-item-title', text: d.title }),
                    h('a', { class: 'sp-small', href: `season-planning-admin.html?draft=${encodeURIComponent(id)}`, text: 'Edit and publish' }))))) : null);
    }

    function winnerCard() {
        const winner = tools.planAdmin.winner;
        const record = async preset => {
            const picker = select(classPairs(), preset || (winner && winner.classId) || '', 'Winning class');
            const result = await A.confirmDialog({ title: 'Record the winning class', body: h('div', null, A.field('Class', picker)), reason: true,
                reasonLabel: 'Explanation (for example, a compromise decision)', reasonValue: preset ? 'Won the final round' : '', confirmLabel: 'Record winner' });
            if (!result || !picker.value) return;
            decide({ [`${planPath()}/winner`]: { classId: picker.value, label: className(picker.value), explanation: result.reason, ...stamp() } },
                'winner', `Winning class: ${className(picker.value)} — ${result.reason}`, 'Winner recorded.');
        };
        tools.recordWinner = record;
        return h('section', { class: 'sp-card' }, h('h2', { text: 'Winning class' }),
            winner ? h('div', null, h('p', null, h('strong', { text: winner.label }), winner.explanation ? ` — ${winner.explanation}` : ''),
                h('p', { class: 'sp-muted sp-small', text: `Recorded ${P.formatDateTime(winner.at)} by ${A.driverName(winner.by)}.` }),
                h('button', { type: 'button', class: 'sp-link', text: 'Change', onclick: () => record() }))
                : h('div', { class: 'sp-inline-actions', style: 'align-items:center' }, h('span', { class: 'sp-muted sp-small', text: 'Not decided yet — set when one class remains.' }),
                    h('button', { type: 'button', class: 'sp-link', text: 'Record a winner', onclick: () => record() })));
    }

    function roundCard(poll, meta) {
        const card = h('section', { class: 'sp-card' }, h('div', { class: 'sp-card-head' },
            h('h2', null, h('a', { href: `season-planning-admin.html?poll=${encodeURIComponent(poll.id)}`, text: poll.title })), A.phaseBadge(poll.phase)));
        if (poll.phase === 'open' || poll.phase === 'scheduled') {
            put(card, h('p', { class: 'sp-muted', text: `The decision appears here once the round closes (${P.formatDateTime(poll.closesAt)}). You can close it early from the poll page.` }));
            return card;
        }
        const data = pollData(poll.id);
        if (!data.definition) { put(card, loading()); return card; }
        const qIndex = 0;
        const rows = R.rows(data.definition, qIndex, data.totals || {}, {});
        const n = rows.length;
        const target = meta.runoffFor ? meta.needed : meta.advanceTarget || AC.roundDefaults(n).advance;
        const result = AC.advancement(rows, target);
        const advancingSet = new Set(result.advancing || result.safe);
        const tiedSet = new Set(result.tied);
        const respondents = (data.totals && data.totals.respondents) || 0;
        put(card, 
            h('p', { class: 'sp-small', text: `${A.plural(respondents, 'driver')} voted. ${meta.runoffFor ? `Runoff for ${result.needed || meta.needed} place(s); ${A.plural((meta.safe || []).length, 'class', 'classes')} already through.` : ''}` }),
            h('div', { class: 'sp-table-wrap' }, h('table', null,
                h('thead', null, h('tr', null, h('th', { text: 'Rank' }), h('th', { text: 'Class' }), h('th', { text: 'Votes' }), h('th', { text: 'Result' }))),
                h('tbody', null, rows.map((row, i) => h('tr', null, h('td', { text: String(i + 1) }), h('td', { text: row.label }), h('td', { text: String(row.count) }),
                    h('td', null, tiedSet.has(row.id) ? h('span', { class: 'sp-badge sp-amber', text: 'Tied at cutoff' }) : advancingSet.has(row.id) ? h('span', { class: 'sp-badge sp-green', text: 'Through' }) : h('span', { class: 'sp-muted', text: 'Out' }))))))));
        if (meta.decision) {
            put(card, h('p', { class: 'sp-status sp-ok' }, `Decided (${meta.decision.method}): ${meta.decision.labels.join(', ')}.`, meta.decision.note ? ` ${meta.decision.note}` : '',
                meta.decision.nextDraftId ? [' ', A.state.index[meta.decision.nextDraftId]
                    ? h('a', { href: `season-planning-admin.html?poll=${encodeURIComponent(meta.decision.nextDraftId)}`, text: 'Next round' })
                    : h('a', { href: `season-planning-admin.html?draft=${encodeURIComponent(meta.decision.nextDraftId)}`, text: 'Next round draft' })] : null));
            return card;
        }
        if (!meta.runoffFor) {
            const targetInput = h('input', { type: 'number', min: 1, max: Math.max(1, n - 1), value: String(target), style: 'max-width:100px' });
            targetInput.addEventListener('change', () => {
                const value = Math.max(1, Math.min(n, Number(targetInput.value) || 1));
                decide({ [`${planPath()}/rounds/${poll.id}/advanceTarget`]: value }, 'round-target', `${poll.title}: advance ${value}`);
            });
            put(card, A.field('How many classes go through', targetInput, `Suggested: half rounded up (${AC.roundDefaults(n).advance}).`));
        }
        const label = id => (rows.find(r => r.id === id) || { label: id }).label;
        const safe = meta.runoffFor ? meta.safe || [] : [];
        const unchanged = snapshotOf(() => ({
            rows: R.rows(data.definition, 0, (tools.cache[poll.id] || {}).totals || {}, {}).map(r => [r.id, r.count]),
            decided: Boolean(((tools.planAdmin.rounds || {})[poll.id] || {}).decision)
        }), 'This round’s results or decision changed while you were deciding (perhaps another admin). Nothing was saved; check again.');
        const finish = (method, ids, note) => {
            if (!unchanged()) return;
            const advancing = [...safe, ...ids];
            const labels = advancing.map(id => labelFor(id, data.definition, meta));
            const nextNumber = (meta.number || 1) + 1;
            const updates = id => ({ [`${planPath()}/rounds/${poll.id}/decision`]: { method, advancing, labels, note: note || '', nextDraftId: id || null, ...stamp() } });
            if (advancing.length === 1) {
                decide({ ...updates(null), [`${planPath()}/winner`]: { classId: advancing[0], label: labels[0], explanation: note || `Won ${poll.title}`, ...stamp() } },
                    'winner', `${poll.title}: ${labels[0]} wins`, 'Winner recorded.');
                return;
            }
            const draft = AC.roundDraft({ plan: A.activePlan(), number: nextNumber, options: advancing.map((id, i) => ({ id, label: labels[i] })), settings: A.settings(), now: A.now() });
            createDraft(draft, 'round-decision', `${poll.title}: ${labels.join(', ')} go through (${method})`, id => ({
                ...updates(id), [`${planPath()}/rounds/${id}`]: { number: nextNumber, ...stamp() }
            }), unchanged);
        };
        if (!result.tie) {
            const ids = result.advancing.filter(id => !safe.includes(id));
            put(card, h('p', { text: result.advancing.length === 1 && !safe.length ? `${label(result.advancing[0])} is the only class left.` : `Going through: ${[...safe, ...ids].map(id => labelFor(id, data.definition, meta)).join(', ')}.` }),
                h('button', { type: 'button', text: safe.length + ids.length === 1 ? `Confirm ${labelFor([...safe, ...ids][0], data.definition, meta)} as the winner` : 'Set up the next round',
                    onclick: async () => { if (await A.confirmDialog({ title: 'Confirm this result?', body: h('p', { text: 'Next you’ll set the closing date and publish the next round.' }), confirmLabel: 'Confirm' })) finish('top', ids); } }));
            return card;
        }
        put(card, h('p', { class: 'sp-status sp-warn', text: `Tie at the cutoff: ${result.tied.map(label).join(', ')} all have ${result.cutoffCount} votes, with ${A.plural(result.needed, 'place')} left. Choose how to settle it.` }),
            h('div', { class: 'sp-inline-actions' },
                h('button', { type: 'button', class: 'sp-secondary', text: 'Run a runoff', onclick: async () => {
                    const carry = AC.runoffCarry(meta, result, label);
                    if (!await A.confirmDialog({ title: 'Create a runoff?', body: h('p', { text: `Drivers choose ${result.needed} of the ${result.tied.length} tied classes. ${carry.safeLabels.join(', ') || 'No classes'} go through already.` }), confirmLabel: 'Set up runoff' })) return;
                    if (!unchanged()) return;
                    const draft = AC.roundDraft({ plan: A.activePlan(), number: meta.number || 1, options: result.tied.map(id => ({ id, label: label(id) })), quota: result.needed, settings: A.settings(), now: A.now(), runoff: true });
                    createDraft(draft, 'runoff', `${poll.title}: runoff between ${result.tied.map(label).join(', ')}`, id => ({
                        [`${planPath()}/rounds/${poll.id}/decision`]: { method: 'runoff', advancing: carry.safe, labels: carry.safeLabels, note: 'Runoff for the tied places', nextDraftId: id, ...stamp() },
                        [`${planPath()}/rounds/${id}`]: { number: meta.number || 1, runoffFor: poll.id, safe: carry.safe, needed: carry.needed, safeLabels: carry.safeLabels, ...stamp() }
                    }), unchanged);
                } }),
                h('button', { type: 'button', class: 'sp-secondary', text: 'Put all tied classes through', onclick: async () => {
                    const r = await A.confirmDialog({ title: 'Put all tied classes through?', body: h('p', { text: `${A.plural(result.safe.length + result.tied.length, 'class', 'classes')} go through instead of ${target}.` }), reason: true, reasonValue: 'All tied classes advance', confirmLabel: 'Confirm' });
                    if (r) finish('all tied', [...result.safe, ...result.tied], r.reason);
                } }),
                h('button', { type: 'button', class: 'sp-secondary', text: 'Choose manually', onclick: async () => {
                    const boxes = result.tied.map(id => ({ id, input: h('input', { type: 'checkbox' }) }));
                    const r = await A.confirmDialog({ title: `Choose ${result.needed} of the tied classes`,
                        body: h('div', null, boxes.map(b => h('label', { class: 'sp-check' }, b.input, label(b.id)))), reason: true, reasonLabel: 'Explanation (kept in the history)', confirmLabel: 'Confirm' });
                    if (!r) return;
                    const chosen = boxes.filter(b => b.input.checked).map(b => b.id);
                    if (chosen.length !== result.needed) { A.setStatus(`Choose exactly ${result.needed}.`, 'error'); return; }
                    finish('manual', [...result.safe, ...chosen], r.reason);
                } })));
        return card;
    }

    // Class labels for a runoff include the classes already through from the original round.
    function labelFor(id, definition, meta) {
        const option = definition.questions[0].options[id];
        if (option) return option.label;
        const i = (meta.safe || []).indexOf(id);
        return i >= 0 && meta.safeLabels ? meta.safeLabels[i] : className(id);
    }

    // ---------- Tracks ----------

    const track = { pollId: null };

    function loadSeasons() {
        if (tools.seasons !== null || tools.seasonsLoading) return;
        tools.seasonsLoading = true;
        firebase.firestore().collection('championships').get().then(snapshot => {
            tools.seasons = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), name: doc.data().seasonName || doc.id }))
                .sort((a, b) => b.id.localeCompare(a.id, 'en', { numeric: true }));
            A.rerender();
        }).catch(error => { tools.seasons = []; tools.seasonsError = error.message; A.rerender(); });
    }

    function tracksTab() {
        if (!tools.planId) return needPlan();
        if (!Object.keys((A.state.catalogue && A.state.catalogue.layouts) || {}).length) {
            return h('p', { class: 'sp-status sp-warn' }, 'Set up the track catalogue in ', h('a', { href: 'racing-setup.html', text: 'Racing Setup' }), ' first.');
        }
        return h('div', null, planPolls('track').length ? null : draftNotice('track'), exclusionsCard(), duplicatesCard());
    }

    function exclusionsCard() {
        loadSeasons();
        const card = h('section', { class: 'sp-card' }, h('h2', { text: 'Track poll: excluded locations' }));
        if (tools.seasons === null) { put(card, loading()); return card; }
        if (tools.seasonsError) put(card, h('p', { class: 'sp-status sp-error', text: `Could not read championships: ${tools.seasonsError}` }));
        const stored = tools.planAdmin.trackSetup || {};
        const setup = { ...stored, unknown: unknownNames(stored) };
        const seasonIds = setup.seasonIds ? Object.values(setup.seasonIds) : tools.seasons.slice(0, A.settings().exclusionSeasons).map(s => s.id);
        const chosen = tools.seasons.filter(s => seasonIds.includes(s.id));
        const plan = AC.exclusionPlan(A.state.catalogue, chosen, setup);
        const locations = A.state.catalogue.locations || {};
        const locationPairs = Object.entries(locations).filter(([, l]) => l.active !== false).sort(([, a], [, b]) => a.name.localeCompare(b.name)).map(([id, l]) => [id, l.name]);
        const saveSetup = (changes, summary) => decide(Object.fromEntries(Object.entries(changes).map(([k, v]) => [`${planPath()}/trackSetup/${k}`, v])), 'track-setup', summary);

        const seasonBoxes = h('div', { class: 'sp-checklist' }, tools.seasons.map(season => {
            const input = h('input', { type: 'checkbox', checked: seasonIds.includes(season.id) });
            input.addEventListener('change', () => {
                const next = tools.seasons.filter(s => (s.id === season.id ? input.checked : seasonIds.includes(s.id))).map(s => s.id);
                saveSetup({ seasonIds: next }, `Exclusions use seasons: ${next.join(', ') || 'none'}`);
            });
            return h('label', { class: 'sp-check' }, input, `${season.name}${season.isActive ? ' (active)' : ''}`);
        }));
        put(card, h('p', { class: 'sp-muted sp-small', text: `Every layout at a location used in the ticked seasons is left out of the track poll. Default: the latest ${A.plural(A.settings().exclusionSeasons, 'season')} (Racing Setup → Templates & defaults).` }),
            tools.seasons.length ? seasonBoxes : h('p', { class: 'sp-muted', text: 'No championships found.' }));

        if (plan.unknown.length) {
            put(card, h('div', { class: 'sp-status sp-error' }, h('strong', { text: 'Resolve these track names before creating the poll:' }),
                h('ul', { class: 'sp-list', style: 'border:0' }, plan.unknown.map(u => {
                    const picker = select([['', 'Choose the location…'], ...locationPairs, ['ignore', 'Ignore this name']], '', `Location for ${u.name}`);
                    picker.addEventListener('change', () => { if (picker.value) saveSetup({ [`unknown/${C.storageKey(u.name, 'u')}`]: { name: u.name, locationId: picker.value } }, `“${u.name}” → ${picker.value === 'ignore' ? 'ignored' : locations[picker.value].name}`); });
                    return h('li', { class: 'sp-item', style: 'grid-template-columns:1fr' }, h('div', null, h('strong', { text: u.name }), h('span', { class: 'sp-small', text: ` (used in ${u.uses.join(', ')})` })), picker);
                }))));
        }
        put(card, h('h3', { style: 'margin:14px 0 4px', text: `Excluded (${plan.excluded.length})` }),
            plan.excluded.length ? h('ul', { class: 'sp-list' }, plan.excluded.map(e => h('li', { class: 'sp-item' },
                h('div', null, h('div', { class: 'sp-item-title', text: e.name }), h('div', { class: 'sp-item-meta', text: e.reasons.join(' · ') })),
                h('button', { type: 'button', class: 'sp-link', text: 'Allow anyway', onclick: async () => {
                    const r = await A.confirmDialog({ title: `Allow ${e.name}?`, body: h('p', { text: 'Drivers will be able to choose its layouts.' }), reason: true, confirmLabel: 'Allow' });
                    if (r) saveSetup({ [`removed/${e.locationId}`]: r.reason, [`added/${e.locationId}`]: null }, `${e.name} allowed: ${r.reason}`);
                } })))) : h('p', { class: 'sp-muted', text: 'Nothing excluded.' }),
            plan.kept.length ? h('div', null, h('h3', { style: 'margin:14px 0 4px', text: 'Allowed despite last season' }),
                h('ul', { class: 'sp-list' }, plan.kept.map(k => h('li', { class: 'sp-item' }, h('div', null, h('div', { class: 'sp-item-title', text: k.name }), h('div', { class: 'sp-item-meta', text: k.note })),
                    h('button', { type: 'button', class: 'sp-link', text: 'Exclude again', onclick: () => saveSetup({ [`removed/${k.locationId}`]: null }, `${k.name} excluded again`) }))))) : null,
            h('div', { class: 'sp-inline-actions', style: 'margin-top:10px' },
                h('button', { type: 'button', class: 'sp-link', text: 'Exclude another location…', onclick: async () => {
                    const picker = select(locationPairs, '', 'Location');
                    const r = await A.confirmDialog({ title: 'Exclude a location', body: A.field('Location', picker), reason: true, confirmLabel: 'Exclude' });
                    if (r && picker.value) saveSetup({ [`added/${picker.value}`]: r.reason, [`removed/${picker.value}`]: null }, `${locations[picker.value].name} excluded: ${r.reason}`);
                } })),
            h('p', { class: 'sp-small', text: `${A.plural(plan.eligible.length, 'layout')} at ${A.plural(new Set(plan.eligible.map(t => t.locationId)).size, 'location')} will be offered. The list is frozen when the poll is published.` }),
            h('button', { type: 'button', text: 'Open track picks', disabled: plan.blocking || !plan.eligible.length, onclick: () => {
                const draft = AC.trackDraft({ plan: A.activePlan(), eligible: plan.eligible, catalogue: A.state.catalogue, settings: A.settings(), now: A.now() });
                createDraft(draft, 'create-track-poll', `Track poll draft with ${plan.eligible.length} layouts; excluded ${plan.excluded.map(e => e.name).join(', ') || 'none'}`, () => ({}));
            } }));
        return card;
    }

    function duplicatesCard() {
        const polls = planPolls('track').filter(p => p.phase !== 'scheduled');
        const card = h('section', { class: 'sp-card' }, h('h2', { text: 'Duplicate locations' }));
        if (!polls.length) { put(card, h('p', { class: 'sp-muted', text: 'Appears once a track poll in this plan has opened.' })); return card; }
        if (!polls.some(p => p.id === track.pollId)) track.pollId = polls[polls.length - 1].id;
        const poll = polls.find(p => p.id === track.pollId);
        const data = pollData(track.pollId, { ballots: true });
        put(card, pollPicker(polls, track.pollId, id => { track.pollId = id; A.rerender(); }, 'Track poll') || '');
        if (!data.definition || !data.ballots) { put(card, loading()); return card; }
        const config = ((tools.planAdmin.trackResolution || {})[track.pollId]) || {};
        const result = AC.trackResolution(data.definition, data.ballots, config);
        const unchanged = snapshotOf(() => AC.trackResolution(data.definition, data.ballots, ((tools.planAdmin.trackResolution || {})[track.pollId]) || {})
            .rows.map(r => [r.uid, r.layoutId, r.status, r.finalLayoutId || null]),
        'Drivers’ track choices changed while this was open (perhaps another admin). Nothing was saved; check again.');
        const options = data.definition.questions[0].options;
        const layoutLabel = id => (options[id] || { label: id }).label;
        const locationName = id => (Object.values(options).find(o => o.locationId === id) || {}).locationName || id;
        const base = `${planPath()}/trackResolution/${track.pollId}`;
        put(card, 
            h('p', null, A.phaseBadge(poll.phase), ` ${A.plural(result.rows.length, 'driver')} chose a layout. `, poll.phase === 'open' ? 'Provisional until the poll closes. ' : '',
),
            result.unresolved ? h('p', { class: 'sp-status sp-warn', text: `${A.plural(result.unresolved, 'driver')} still ${result.unresolved === 1 ? 'needs' : 'need'} a replacement or a decision. The calendar can’t be finalised until this is resolved.` })
                : h('p', { class: 'sp-status sp-ok', text: 'No unresolved duplicates.' }),
            h('p', { class: 'sp-muted sp-small', text: 'Rule: when drivers chose layouts at the same location, the one who submitted last keeps it; earlier drivers pick again. Contact them outside the website and record their new choice here.' }));
        result.conflicts.forEach(conflict => {
            const rows = conflict.uids.map(uid => result.rows.find(r => r.uid === uid));
            put(card, h('div', { class: 'sp-conflict' },
                h('h3', { text: locationName(conflict.locationId) }),
                conflict.exception ? h('p', { class: 'sp-small', text: `Shared on purpose: ${conflict.exception}` }) : null,
                conflict.tie ? h('p', { class: 'sp-status sp-warn', text: 'Two drivers submitted at exactly the same time. Choose who keeps the location.' }) : null,
                h('ul', { class: 'sp-list' }, rows.map(row => h('li', { class: 'sp-item' },
                    h('div', null, h('div', { class: 'sp-item-title' }, A.driverName(row.uid), ' ', statusBadge(row)),
                        h('div', { class: 'sp-item-meta', text: `Chose ${layoutLabel(row.layoutId)} · submitted ${P.formatDateTime(row.submittedAt)}${row.status === 'replaced' ? ` · now ${layoutLabel(row.finalLayoutId)}` : ''}` })),
                    h('div', { class: 'sp-item-actions' }, rowActions(row, conflict, result, base, layoutLabel, locationName, unchanged))))),
                conflict.exception ? h('button', { type: 'button', class: 'sp-link', text: 'Remove the exception', onclick: () => decide({ [`${base}/exceptions/${conflict.locationId}`]: null }, 'track-exception', `${locationName(conflict.locationId)}: exception removed`) })
                    : h('button', { type: 'button', class: 'sp-link', text: 'Allow them to share this location…', onclick: async () => {
                        const r = await A.confirmDialog({ title: `Let drivers share ${locationName(conflict.locationId)}?`, body: h('p', { text: 'Both layouts stay in the calendar. This is recorded as an exception.' }), reason: true, confirmLabel: 'Record exception' });
                        if (r && unchanged()) decide({ [`${base}/exceptions/${conflict.locationId}`]: r.reason }, 'track-exception', `${locationName(conflict.locationId)} shared: ${r.reason}`);
                    } })));
        });
        if (result.invalid.length) put(card, h('p', { class: 'sp-status sp-error', text: `Some recorded replacements clash with another driver’s location: ${result.invalid.map(i => A.driverName(i.uid)).join(', ')}. Choose a free location for them.` }));
        if (result.random.length) put(card, h('p', { class: 'sp-small', text: `Happy with a random track (no clash possible; the calendar draw fills their place): ${result.random.map(A.driverName).join(', ')}.` }));
        put(card, h('details', { class: 'sp-table-toggle' }, h('summary', { text: 'Show every driver’s current track' }),
            h('div', { class: 'sp-table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: 'Driver' }), h('th', { text: 'Track' }), h('th', { text: 'Source' }))),
                h('tbody', null, result.assignments.map(a => h('tr', null, h('td', { text: A.driverName(a.uid) }), h('td', { text: layoutLabel(a.layoutId) }), h('td', { text: a.source === 'replacement' ? 'Replacement' : 'Original' }))))))));
        return card;
    }

    function statusBadge(row) {
        return {
            keeps: h('span', { class: 'sp-badge sp-green', text: 'Keeps it' }),
            replace: h('span', { class: 'sp-badge sp-red', text: 'Needs a replacement' }),
            replaced: h('span', { class: 'sp-badge sp-green', text: 'Replacement recorded' }),
            tie: h('span', { class: 'sp-badge sp-amber', text: 'Tie' }),
            exception: h('span', { class: 'sp-badge', text: 'Shared' }),
            random: h('span', { class: 'sp-badge', text: 'Random track' })
        }[row.status] || null;
    }

    function rowActions(row, conflict, result, base, layoutLabel, locationName, unchanged) {
        const actions = [];
        if (row.status === 'tie') {
            actions.push(h('button', { type: 'button', class: 'sp-secondary', text: `${A.driverName(row.uid)} keeps it`, onclick: async () => {
                const r = await A.confirmDialog({ title: `${A.driverName(row.uid)} keeps ${locationName(conflict.locationId)}?`, body: h('p', { text: 'The others will need replacements.' }), reason: true, confirmLabel: 'Confirm' });
                if (r && unchanged()) decide({ [`${base}/keeps/${conflict.locationId}`]: row.uid }, 'track-tie', `${locationName(conflict.locationId)}: ${A.driverName(row.uid)} keeps it (${r.reason})`);
            } }));
        }
        if (row.status === 'replace' || row.status === 'replaced') {
            actions.push(h('button', { type: 'button', class: row.status === 'replace' ? '' : 'sp-link', text: row.status === 'replace' ? 'Record replacement…' : 'Change replacement…', onclick: async () => {
                const picker = h('select', { 'aria-label': 'Replacement layout' }, h('option', { value: '', text: 'Choose a free layout…' }),
                    result.freeLocations.map(loc => h('optgroup', { label: loc.name }, loc.layouts.map(l => h('option', { value: l.id, text: l.label })))));
                const r = await A.confirmDialog({ title: `Replacement for ${A.driverName(row.uid)}`, body: h('div', null,
                    h('p', { text: `Originally chose ${layoutLabel(row.layoutId)}. Only locations nobody else has are listed.` }), A.field('New choice', picker)),
                reason: true, reasonLabel: 'Note (e.g. how they told you)', confirmLabel: 'Save replacement' });
                if (!r || !picker.value || !unchanged()) return;
                const audit = A.auditId();
                decide({
                    [`${base}/replacements/${row.uid}`]: { layoutId: picker.value, note: r.reason, ...stamp() },
                    [`${V1}/polls/${track.pollId}/audit/${audit}`]: { at: sv().TIMESTAMP, by: A.state.uid, action: 'track-replacement', reason: r.reason, targetUid: row.uid,
                        before: { layoutId: row.layoutId }, after: { layoutId: picker.value } }
                }, 'track-replacement', `${A.driverName(row.uid)}: ${layoutLabel(row.layoutId)} → ${layoutLabel(picker.value)} (${r.reason})`, 'Replacement recorded.');
            } }));
        }
        if (row.status === 'replaced') actions.push(h('button', { type: 'button', class: 'sp-link', text: 'Undo', onclick: () => decide({ [`${base}/replacements/${row.uid}`]: null }, 'track-replacement', `${A.driverName(row.uid)}: replacement removed`) }));
        return actions;
    }

    // ---------- Rules ----------

    function rulesTab() {
        if (!tools.planId) return needPlan();
        return h('div', null, planPolls('rules').length ? null : draftNotice('rules'), proposalsCard(), outcomesCard(), writtenCard());
    }

    function proposals() {
        return Object.entries(tools.planAdmin.proposals || {}).filter(([, p]) => p).map(([id, p]) => ({ id, ...p })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    }

    async function editProposal(existing, preset) {
        const text = h('textarea', { rows: 3, maxLength: 1000, style: 'min-height:0;font-family:inherit;font-size:1rem' });
        text.value = existing ? existing.text : preset || '';
        const detail = h('textarea', { rows: 3, maxLength: 2000, style: 'min-height:0;font-family:inherit;font-size:1rem' });
        detail.value = existing ? existing.detail || '' : '';
        const ok = await A.confirmDialog({ title: existing ? 'Edit proposal' : 'New rule proposal', body: h('div', null,
            A.field('Proposal (the Yes/No question drivers will see)', text), A.field('Extra detail (optional)', detail)), confirmLabel: 'Save proposal' });
        if (!ok || !text.value.trim()) return;
        const id = existing ? existing.id : A.newId();
        decide({ [`${planPath()}/proposals/${id}`]: A.clean({ ...(existing || {}), id: undefined, text: text.value.trim(), detail: detail.value.trim(), status: existing ? existing.status : 'draft',
            createdAt: existing ? existing.createdAt : sv().TIMESTAMP, updatedAt: sv().TIMESTAMP }) }, 'proposal', `${existing ? 'Edited' : 'Added'} proposal: ${text.value.trim()}`);
    }

    function proposalsCard() {
        const list = proposals();
        const boxes = new Map();
        const byId = Object.fromEntries(list.map(p => [p.id, p]));
        const item = p => {
            const box = h('input', { type: 'checkbox', disabled: p.status !== 'draft', 'aria-label': `Include “${p.text}” in a vote` });
            boxes.set(p.id, box);
            const related = Object.entries(p.related || {}).filter(([otherId]) => byId[otherId]);
            return h('li', { class: 'sp-item', style: 'grid-template-columns:auto 1fr' }, box,
                h('div', null,
                    h('div', { class: 'sp-item-title' }, p.text, ' ', h('span', { class: `sp-badge ${p.status === 'in-vote' ? 'sp-green' : p.status === 'withdrawn' ? '' : 'sp-amber'}`, text: { draft: 'Not yet voted on', 'in-vote': 'In a vote', withdrawn: 'Withdrawn' }[p.status] || p.status })),
                    p.detail ? h('div', { class: 'sp-item-meta', text: p.detail }) : null,
                    related.map(([otherId, link]) => h('div', { class: 'sp-small sp-red-text', text: `⚠ ${link.type === 'contradicts' ? 'Contradicts' : 'Related to'}: “${byId[otherId].text}”${link.note ? ` — ${link.note}` : ''}` })),
                    h('div', { class: 'sp-inline-actions' },
                        p.status === 'draft' ? h('button', { type: 'button', class: 'sp-link', text: 'Edit', onclick: () => editProposal(p) }) : null,
                        h('button', { type: 'button', class: 'sp-link', text: 'Flag related…', onclick: () => linkProposal(p, list) }),
                        p.status !== 'withdrawn' && p.status !== 'in-vote' ? h('button', { type: 'button', class: 'sp-link', text: 'Withdraw', onclick: () => decide({ [`${planPath()}/proposals/${p.id}/status`]: 'withdrawn' }, 'proposal', `Withdrew: ${p.text}`) }) : null,
                        p.status === 'withdrawn' ? h('button', { type: 'button', class: 'sp-link', text: 'Restore', onclick: () => decide({ [`${planPath()}/proposals/${p.id}/status`]: 'draft' }, 'proposal', `Restored: ${p.text}`) }) : null)));
        };
        return h('section', { class: 'sp-card' }, h('h2', { text: 'Rule proposals' }),
            h('p', { class: 'sp-muted sp-small', text: 'Word each proposal as a clear Yes/No question. Flag proposals that are related or contradict each other so they can be reviewed together.' }),
            list.length ? h('ul', { class: 'sp-list' }, list.map(item)) : h('p', { class: 'sp-muted', text: 'No proposals yet.' }),
            h('div', { class: 'sp-inline-actions', style: 'margin-top:10px' },
                h('button', { type: 'button', class: 'sp-secondary', text: 'Add proposal', onclick: () => editProposal(null) }),
                h('button', { type: 'button', text: 'Open the vote for ticked proposals', onclick: () => {
                    const chosen = list.filter(p => boxes.get(p.id) && boxes.get(p.id).checked);
                    if (!chosen.length) { A.setStatus('Tick at least one proposal.', 'error'); return; }
                    const unreviewed = chosen.filter(p => Object.keys(p.related || {}).some(id => byId[id] && byId[id].status !== 'withdrawn' && !chosen.includes(byId[id])));
                    const draft = AC.rulesDraft({ plan: A.activePlan(), proposals: chosen, settings: A.settings(), now: A.now(), minTurnout: tools.planAdmin.minTurnout || 0 });
                    const go = () => createDraft(draft, 'create-rules-poll', `Rule vote draft with ${chosen.length} proposals`, id => Object.fromEntries(chosen.flatMap((p, i) => [
                        [`${planPath()}/proposals/${p.id}/status`, 'in-vote'], [`${planPath()}/proposals/${p.id}/pollId`, id], [`${planPath()}/proposals/${p.id}/questionIndex`, i]])));
                    if (!unreviewed.length) { go(); return; }
                    A.confirmDialog({ title: 'Related proposals left out', body: h('p', { text: `${unreviewed.map(p => `“${p.text}”`).join(', ')} ${unreviewed.length === 1 ? 'is' : 'are'} flagged as related to a proposal you didn’t tick. Create the vote anyway?` }), confirmLabel: 'Create anyway' })
                        .then(ok => { if (ok) go(); });
                } })));
    }

    async function linkProposal(p, list) {
        const others = list.filter(o => o.id !== p.id);
        if (!others.length) { A.setStatus('Add another proposal first.', 'error'); return; }
        const picker = select(others.map(o => [o.id, o.text.slice(0, 80)]), '', 'Other proposal');
        const type = select([['related', 'Related'], ['contradicts', 'Contradicts']], 'related', 'Type of link');
        const r = await A.confirmDialog({ title: 'Flag related proposals', body: h('div', null, A.field('Other proposal', picker), A.field('How they relate', type)), reason: true, reasonLabel: 'Note', confirmLabel: 'Flag' });
        if (!r) return;
        const link = { type: type.value, note: r.reason };
        decide({ [`${planPath()}/proposals/${p.id}/related/${picker.value}`]: link, [`${planPath()}/proposals/${picker.value}/related/${p.id}`]: link },
            'proposal-link', `“${p.text}” ${type.value === 'contradicts' ? 'contradicts' : 'is related to'} “${others.find(o => o.id === picker.value).text}”`);
    }

    function outcomesCard() {
        const polls = planPolls('rules');
        const card = h('section', { class: 'sp-card' }, h('h2', { text: 'Outcomes' }),
            h('p', { class: 'sp-muted sp-small', text: 'A proposal passes only when Yes beats No. Drivers who don’t vote aren’t counted. Confirming an outcome doesn’t change the rules document or any scoring settings.' }));
        const minTurnout = tools.planAdmin.minTurnout || 0;
        const turnout = h('input', { type: 'number', min: 0, max: 100, value: String(minTurnout), style: 'max-width:100px' });
        turnout.addEventListener('change', () => decide({ [`${planPath()}/minTurnout`]: Math.max(0, Math.min(100, Number(turnout.value) || 0)) }, 'min-turnout', `Minimum turnout set to ${turnout.value || 0}`));
        put(card, A.field('Minimum votes for a decision in new rule votes (0 = no minimum)', turnout, 'Saved into each vote when it opens, so drivers’ results use the same rule.'));
        if (!polls.length) { put(card, h('p', { class: 'sp-muted', text: 'No rule votes in this plan yet.' })); return card; }
        const confirmed = tools.planAdmin.outcomes || {};
        const proposalFor = (pollId, index) => proposals().find(p => p.pollId === pollId && p.questionIndex === index);
        polls.forEach(poll => {
            put(card, h('h3', { style: 'margin:14px 0 4px' }, poll.title, ' ', A.phaseBadge(poll.phase)));
            if (poll.phase === 'open' || poll.phase === 'scheduled') { put(card, h('p', { class: 'sp-muted', text: `Outcomes appear when the vote closes (${P.formatDateTime(poll.closesAt)}).` })); return; }
            const data = pollData(poll.id);
            if (!data.definition) { put(card, loading()); return; }
            const pollMinimum = data.control && data.control.minTurnout !== undefined ? data.control.minTurnout : 0;
            put(card, h('ul', { class: 'sp-list' }, AC.ruleOutcomes(data.definition, data.totals, { minTurnout: pollMinimum }).map(o => {
                const key = `${poll.id}_${o.index}`;
                const done = confirmed[key];
                const proposal = proposalFor(poll.id, o.index);
                return h('li', { class: 'sp-item' },
                    h('div', null, h('div', { class: 'sp-item-title', text: o.prompt }),
                        h('div', { class: `sp-outcome sp-outcome-${o.outcome}` }, h('span', { 'aria-hidden': 'true', text: o.outcome === 'pass' ? '✓ ' : o.outcome === 'fail' ? '✕ ' : '– ' }), o.label,
                            done ? h('span', { class: 'sp-muted', text: ` · confirmed ${P.formatDate(done.at)}` }) : h('span', { class: 'sp-muted', text: ' · provisional' }))),
                    done ? h('button', { type: 'button', class: 'sp-link', text: 'Reopen', onclick: () => decide({ [`${planPath()}/outcomes/${key}`]: null }, 'rule-outcome', `Outcome reopened: ${o.prompt}`) })
                        : h('button', { type: 'button', class: 'sp-secondary', text: 'Confirm outcome', onclick: () => {
                            const fresh = AC.ruleOutcomes(data.definition, data.totals, { minTurnout: data.control && data.control.minTurnout ? data.control.minTurnout : 0 }).find(x => x.index === o.index);
                            if (!fresh || fresh.label !== o.label || (tools.planAdmin.outcomes || {})[key]) {
                                A.setStatus('This result changed or was already confirmed. Nothing was saved; check it again.', 'warn');
                                A.rerender();
                                return;
                            }
                            decide({ [`${planPath()}/outcomes/${key}`]: A.clean({
                            pollId: poll.id, questionIndex: o.index, prompt: o.prompt, outcome: o.outcome, label: o.label, yes: o.yes, no: o.no, proposalId: proposal ? proposal.id : undefined, ...stamp() }) },
                        'rule-outcome', `${o.prompt}: ${o.label}`, 'Outcome confirmed.');
                        } }));
            })));
        });
        return card;
    }

    function writtenCard() {
        const card = h('section', { class: 'sp-card' }, h('h2', { text: 'Written suggestions from drivers' }),
            h('p', { class: 'sp-muted sp-small', text: 'Answers to written questions in this plan’s polls and in suggestion boxes. Turn any into a proposal.' }));
        if (!tools.written) {
            put(card, h('button', { type: 'button', class: 'sp-secondary', text: 'Load written answers', onclick: loadWritten }));
            return card;
        }
        if (tools.written === 'loading') { put(card, loading()); return card; }
        put(card, tools.written.length ? h('ul', { class: 'sp-list' }, tools.written.map(w => h('li', { class: 'sp-item' },
            h('div', null, h('div', { class: 'sp-prewrap', text: w.text }), h('div', { class: 'sp-item-meta', text: `${A.driverName(w.uid)} · ${w.pollTitle} · ${w.prompt}` })),
            h('button', { type: 'button', class: 'sp-link', text: 'Make a proposal', onclick: () => editProposal(null, w.text.slice(0, 1000)) }))))
            : h('p', { class: 'sp-muted', text: 'No written answers yet.' }),
        h('button', { type: 'button', class: 'sp-link', text: 'Reload', onclick: loadWritten }));
        return card;
    }

    async function loadWritten() {
        tools.written = 'loading';
        A.rerender();
        const polls = Object.entries(A.state.index || {}).filter(([, e]) => e.planId === tools.planId || e.kind === 'suggestions');
        const out = [];
        try {
            for (const [id, entry] of polls) {
                const definition = (await db().ref(`${V1}/polls/${id}/definition`).once('value')).val();
                if (!definition || !SB.questionList(definition).some(q => q.kind === 'text')) continue;
                const ballots = (await db().ref(`${V1}/polls/${id}/ballots`).once('value')).val() || {};
                AC.writtenAnswers(definition, ballots).forEach(w => out.push({ ...w, pollTitle: entry.title }));
            }
            tools.written = out.sort((a, b) => b.submittedAt - a.submittedAt);
        } catch (error) {
            tools.written = null;
            A.setStatus(`Could not load answers: ${error.message}`, 'error');
        }
        A.rerender();
    }

    // ---------- History ----------

    function historyTab() {
        if (!tools.planId) return needPlan();
        const log = Object.values(tools.planAdmin.log || {}).filter(Boolean).map(e => ({ ...e, source: 'Season decision' }));
        const audits = [];
        planPolls().forEach(poll => {
            const entry = tools.cache[`audit:${poll.id}`];
            if (!entry) {
                tools.cache[`audit:${poll.id}`] = { loading: true };
                db().ref(`${V1}/polls/${poll.id}/audit`).once('value').then(s => { tools.cache[`audit:${poll.id}`] = { entries: s.val() || {} }; A.rerender(); });
                return;
            }
            Object.values(entry.entries || {}).forEach(a => audits.push({ at: a.at, by: a.by, action: a.action, summary: `${poll.title}: ${a.reason}${a.targetUid ? ` (for ${A.driverName(a.targetUid)})` : ''}`, source: 'Poll change' }));
        });
        const all = [...log, ...audits].sort((a, b) => (b.at || 0) - (a.at || 0));
        return h('section', { class: 'sp-card' }, h('h2', { text: 'History' }),
            h('p', { class: 'sp-muted sp-small', text: 'Every season decision and every change to this plan’s polls, newest first. Original ballots are never overwritten.' }),
            all.length ? h('ul', { class: 'sp-list' }, all.map(e => h('li', { class: 'sp-item', style: 'grid-template-columns:1fr' },
                h('div', null, h('div', { class: 'sp-item-title', text: e.summary }),
                    h('div', { class: 'sp-item-meta', text: `${P.formatDateTime(e.at)} · ${A.driverName(e.by)} · ${e.source} · ${String(e.action).replace(/-/g, ' ')}` })))))
                : h('p', { class: 'sp-muted', text: 'Nothing recorded yet.' }));
    }

    // ---------- Wiring ----------

    A.addTab({ id: 'suggestions', label: 'Suggestions', render: suggestionsTab });
    A.addTab({ id: 'rounds', label: 'Voting rounds', render: roundsTab });
    A.addTab({ id: 'tracks', label: 'Tracks', render: tracksTab });
    A.addTab({ id: 'rules', label: 'Rules', render: rulesTab });
    A.addTab({ id: 'history', label: 'History', render: historyTab });

    // Shared with season-planning-calendar.js and season-planning-season.js.
    window.SeasonTools = {
        tools, pollData, planPolls, decide, planPath, stamp, put, loading, needPlan, loadSeasons, decodeKey, unknownNames, createDraft, classPairs, snapshotOf, planDrafts, draftNotice,
        suggestionsTab, roundsTab, tracksTab, rulesTab, historyTab
    };

    // Follow the active plan's admin data.
    let listening = null;
    setInterval(watchPlan, 500);
    function watchPlan() {
        const plan = A.state.uid && A.state.plans ? A.activePlan() : null;
        const id = plan ? plan.id : null;
        if (id === listening) return;
        if (listening) db().ref(`${V1}/planAdmin/${listening}`).off();
        listening = id;
        tools.planId = id;
        tools.planAdmin = {};
        if (id) db().ref(`${V1}/planAdmin/${id}`).on('value', snapshot => { tools.planAdmin = snapshot.val() || {}; A.rerender(); });
        else A.rerender();
    }
})();
