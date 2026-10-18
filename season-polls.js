// Polls & Forms for drivers: the season hub (no ?poll=) and one poll's
// Vote / Results screens (?poll=ID&tab=vote|results).
(function () {
    'use strict';
    const UI = window.SeasonUI;
    const SB = window.SeasonBallot;
    const P = window.SeasonPolls;
    const { h, fill } = UI;
    const V1 = 'seasonPlanning/v1';
    const params = new URLSearchParams(location.search);
    const pollId = params.get('poll');
    const summaryId = params.get('summary');
    const $ = id => document.getElementById(id);
    const db = () => firebase.database();
    let uid = null;
    let driver = null;
    let serverOffset = 0;
    let connected = true;
    const now = () => Date.now() + serverOffset;

    // ---------- Hub ----------

    const hub = { index: null, plans: {}, submitted: {}, liveTotals: {}, definitions: {}, minTurnout: {}, error: '' };

    function activePlan() {
        return Object.entries(hub.plans || {}).map(([id, plan]) => ({ id, ...plan }))
            .filter(plan => plan.status === 'active')
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
    }

    // Whether this driver has submitted each open or closed poll (their own ballot only).
    function checkSubmitted() {
        Object.entries(hub.index || {}).forEach(([id, entry]) => {
            if (id in hub.submitted || P.pollPhase(entry, now()) === 'scheduled') return;
            hub.submitted[id] = null;
            db().ref(`${V1}/polls/${id}/ballots/${uid}/submittedAt`).once('value')
                .then(snapshot => { hub.submitted[id] = snapshot.exists(); renderHub(); })
                .catch(() => { hub.submitted[id] = undefined; renderHub(); });
        });
    }

    // Live chart on the hub for the first open poll with live results.
    function watchLiveResults(groups) {
        const live = groups.open.find(poll => poll.resultVisibility === 'live');
        if (!live || hub.liveTotals[live.id] !== undefined) return;
        hub.liveTotals[live.id] = null;
        db().ref(`${V1}/polls/${live.id}/control/minTurnout`).once('value').then(snapshot => { hub.minTurnout[live.id] = snapshot.val() || 0; }, () => {});
        db().ref(`${V1}/polls/${live.id}/definition`).on('value', snapshot => { hub.definitions[live.id] = snapshot.val(); renderHub(); }, () => {});
        db().ref(`${V1}/polls/${live.id}/totals`).on('value', totals => { hub.liveTotals[live.id] = totals.val(); renderHub(); }, () => {});
    }

    function deadline(entry) {
        const phase = P.pollPhase(entry, now());
        if (phase === 'open') return h('span', { class: 'sp-deadline', title: P.formatDateTime(entry.closesAt) }, `Closes ${P.relative(entry.closesAt, now())}`);
        if (phase === 'scheduled') return h('span', { class: 'sp-muted', title: P.formatDateTime(entry.opensAt) }, `Opens ${P.formatDate(entry.opensAt)}`);
        return h('span', { class: 'sp-muted' }, `Closed ${P.formatDate(entry.closesAt)}`);
    }

    function submittedBadge(id) {
        const state = hub.submitted[id];
        if (state === true) return h('span', { class: 'sp-badge sp-green', text: 'Submitted' });
        if (state === false) return h('span', { class: 'sp-badge sp-red', text: 'Not submitted' });
        return null;
    }

    function pollCard(poll) {
        const submitted = hub.submitted[poll.id] === true;
        return h('article', { class: 'sp-card sp-poll-card' },
            h('h2', { text: poll.title }),
            h('p', { class: 'sp-small' }, deadline(poll), submittedBadge(poll.id), poll.standalone ? h('span', { class: 'sp-badge', text: 'Standalone' }) : null),
            poll.summary ? h('p', { class: 'sp-small', text: poll.summary }) : null,
            h('a', { class: `sp-btn${submitted ? ' sp-btn-secondary' : ''}`, href: `season-polls.html?poll=${encodeURIComponent(poll.id)}` },
                submitted ? 'View your answers' : 'Cast your vote'));
    }

    // The strip fills in from the left when the hub first appears. The hub redraws
    // often (new data), so later drawings carry on from where the animation got to.
    let stripStart = null;
    function progressStrip(stages) {
        if (stripStart === null) stripStart = performance.now();
        const elapsed = Math.round(performance.now() - stripStart);
        const animate = !UI.reduceMotion() && elapsed < 2500;
        return h('ol', { class: `sp-progress${animate ? ' sp-progress-animate' : ''}`, 'aria-label': 'Season planning stages', style: `--elapsed:${elapsed}ms` }, stages.map((stage, i) => {
            // An open stage shows as done for this driver once they've answered all its open polls.
            const open = stage.polls.filter(poll => poll.phase === 'open');
            const answered = stage.status === 'open' && open.length > 0 && open.every(poll => hub.submitted[poll.id] === true);
            const status = answered ? 'done' : stage.status;
            const label = answered ? 'open now, you’ve taken part'
                : { done: 'finished', open: 'open now', scheduled: stage.opensAt ? `opens ${P.formatDate(stage.opensAt)}` : 'not yet open', upcoming: 'not yet open' }[stage.status];
            return h('li', { class: `sp-step sp-step-${status}`, style: `--i:${i}`, 'aria-current': stage.status === 'open' ? 'step' : undefined },
                h('span', { class: 'sp-step-dot', 'aria-hidden': 'true', text: status === 'done' ? '✓' : String(i + 1) }),
                h('span', { class: 'sp-step-label', text: stage.label }),
                h('span', { class: 'sp-visually-hidden', text: `, ${label}` }));
        }));
    }

    function yourProgress(stages) {
        const items = stages.flatMap(stage => (stage.polls.length ? stage.polls : [null]).map(poll => {
            let status;
            if (!poll) status = h('span', { class: 'sp-muted', text: 'Not yet open' });
            else if (poll.phase === 'scheduled') status = h('span', { class: 'sp-muted', text: `Opens ${P.formatDate(poll.opensAt)}` });
            else if (hub.submitted[poll.id] === true) status = h('span', { class: 'sp-green-text', text: 'Submitted' });
            else if (poll.phase === 'open') status = h('span', { class: 'sp-red-text', text: 'Open now' });
            else status = h('span', { class: 'sp-muted', text: 'Closed' });
            const icon = poll && hub.submitted[poll.id] === true ? 'done' : poll && poll.phase === 'open' ? 'open' : 'todo';
            return h('li', { class: `sp-mine sp-mine-${icon}` },
                h('span', { class: 'sp-mine-dot', 'aria-hidden': 'true' }),
                poll ? h('a', { href: `season-polls.html?poll=${encodeURIComponent(poll.id)}`, text: stages.length && stage.polls.length > 1 ? poll.title : stage.label }) : h('span', { text: stage.label }),
                status);
        }));
        const done = stages.filter(stage => stage.polls.length && stage.polls.every(poll => hub.submitted[poll.id] === true || poll.phase === 'closed' || poll.phase === 'finalised')).length;
        return h('section', { class: 'sp-card', 'aria-labelledby': 'mineTitle' },
            h('div', { class: 'sp-card-head' }, h('h2', { id: 'mineTitle', text: 'Your progress' }), h('span', { class: 'sp-muted sp-small', text: `${done} of ${stages.length} stages done` })),
            h('ul', { class: 'sp-mine-list' }, items));
    }

    function liveResultsCard(groups) {
        const live = groups.open.find(poll => poll.resultVisibility === 'live');
        if (!live || !hub.liveTotals[live.id] || !hub.definitions[live.id]) return null;
        const box = h('div');
        // On wider screens the card sits in a half-width column.
        const width = window.innerWidth >= 720 ? Math.max(300, Math.min(820, window.innerWidth - 48) / 2 - 64) : undefined;
        UI.renderResults(box, { definition: hub.definitions[live.id], totals: hub.liveTotals[live.id], pollId: live.id, labelsHidden: live.labelsHidden, provisional: true, title: live.title, downloads: false, width, compact: true, minTurnout: hub.minTurnout[live.id] || 0, animateKey: `hub:${live.id}` });
        return h('section', { class: 'sp-card', 'aria-labelledby': 'liveTitle' },
            h('div', { class: 'sp-card-head' }, h('h2', { id: 'liveTitle', text: 'Live results' }), h('a', { href: `season-polls.html?poll=${encodeURIComponent(live.id)}&tab=results`, class: 'sp-small', text: 'Full results' })),
            h('p', { class: 'sp-muted sp-small', text: live.title }), box);
    }

    // Published summaries of plans other than the active one, newest first.
    function pastSummaries(active) {
        return Object.entries(hub.plans || {}).filter(([id, p]) => p && p.summary && (!active || id !== active.id))
            .sort(([, a], [, b]) => b.summary.publishedAt - a.summary.publishedAt);
    }

    function renderHub() {
        const app = $('app');
        if (hub.error) { fill(app, h('p', { class: 'sp-status sp-error', text: hub.error })); return; }
        if (hub.index === null) return;
        const groups = P.groupPolls(hub.index, now());
        const plan = activePlan();
        const stages = plan ? P.planProgress(plan, hub.index, now()) : [];
        watchLiveResults(groups);
        fill(app,
            h('p', { class: 'sp-eyebrow', text: plan ? 'Season planning' : 'One Eleven' }),
            h('h1', { text: plan ? plan.title : 'Polls & forms' }),
            h('p', { class: 'sp-lede', text: plan ? (plan.intro || 'Help shape the next season. Take part in each stage below.') : 'Votes, suggestions and forms for drivers.' }),
            stages.length ? progressStrip(stages) : null,
            plan && plan.summary ? h('p', { class: 'sp-status sp-ok' }, 'The season summary is out: winning class, calendar and rule changes. ',
                h('a', { href: `season-polls.html?summary=${encodeURIComponent(plan.id)}`, text: 'See the summary' })) : null,
            stages.length ? yourProgress(stages) : null,
            h('div', { class: 'sp-hub-grid' },
                h('div', null,
                    h('h2', { class: 'sp-section-title', text: 'Open now' }),
                    groups.open.length ? groups.open.map(pollCard) : h('p', { class: 'sp-card sp-muted', text: 'No polls are open right now.' })),
                h('div', null, liveResultsCard(groups))),
            groups.scheduled.length ? h('section', null, h('h2', { class: 'sp-section-title', text: 'Coming up' }),
                h('ul', { class: 'sp-list' }, groups.scheduled.map(poll => h('li', { class: 'sp-item', style: 'grid-template-columns:1fr' },
                    h('div', null, h('div', { class: 'sp-item-title', text: poll.title }),
                        h('div', { class: 'sp-small', style: 'font-weight:600', text: `Opens ${P.formatDateTime(poll.opensAt, { year: false })}` }),
                        poll.summary ? h('div', { class: 'sp-item-meta', text: poll.summary }) : null))))) : null,
            groups.results.length ? h('section', null, h('h2', { class: 'sp-section-title', text: 'Closed polls and results' }),
                h('ul', { class: 'sp-list' }, groups.results.map(poll => h('li', { class: 'sp-item' },
                    h('div', null, h('div', { class: 'sp-item-title' }, poll.title, poll.phase === 'finalised' ? h('span', { class: 'sp-badge', text: 'Final' }) : null), h('div', { class: 'sp-item-meta' }, deadline(poll), ' ', submittedBadge(poll.id))),
                    h('a', { class: 'sp-small', href: `season-polls.html?poll=${encodeURIComponent(poll.id)}&tab=results`, text: poll.resultVisibility === 'hidden' ? 'Your answers' : 'Results' }))))) : null,
            pastSummaries(plan).length ? h('section', null, h('h2', { class: 'sp-section-title', text: 'Season summaries' }),
                h('ul', { class: 'sp-list' }, pastSummaries(plan).map(([id, p]) => h('li', { class: 'sp-item' },
                    h('div', null, h('div', { class: 'sp-item-title', text: p.summary.title }), h('div', { class: 'sp-item-meta', text: `Published ${P.formatDate(p.summary.publishedAt)}` })),
                    h('a', { class: 'sp-small', href: `season-polls.html?summary=${encodeURIComponent(id)}`, text: 'Open' }))))) : null,
            groups.archived.length ? h('details', { class: 'sp-archive' }, h('summary', { text: `Archive (${groups.archived.length})` }),
                h('ul', { class: 'sp-list' }, groups.archived.map(poll => h('li', { class: 'sp-item' },
                    h('div', null, h('div', { class: 'sp-item-title' }, poll.title, poll.replaced ? h('span', { class: 'sp-badge', text: 'Replaced' }) : null), h('div', { class: 'sp-item-meta' }, deadline(poll))),
                    h('a', { class: 'sp-small', href: `season-polls.html?poll=${encodeURIComponent(poll.id)}&tab=results`, text: 'View' }))))) : null,
            driver && driver.isAdmin ? h('p', { class: 'sp-admin-link' }, h('a', { class: 'sp-btn sp-btn-secondary', href: 'season-planning-admin.html', text: 'Manage season planning' })) : null);
    }

    function startHub() {
        db().ref(`${V1}/index`).on('value', snapshot => { hub.index = snapshot.val() || {}; checkSubmitted(); renderHub(); },
            error => { hub.error = `Polls could not be loaded: ${error.message}`; renderHub(); });
        db().ref(`${V1}/plans`).on('value', snapshot => { hub.plans = snapshot.val() || {}; renderHub(); }, () => {});
        // Re-evaluate opening and closing times every minute.
        setInterval(renderHub, 60000);
    }

    // ---------- One poll ----------

    const poll = { entry: undefined, control: undefined, definition: undefined, definitionError: null, ballot: undefined,
        tab: params.get('tab') === 'results' ? 'results' : 'vote', mode: 'form', answers: null, submissionId: null, voteKey: '', resultsRef: null, resultsKey: '' };

    const draftStorageKey = () => P.draftKey(uid, pollId, poll.definition.revision);

    function saveDraft() {
        try { sessionStorage.setItem(draftStorageKey(), JSON.stringify({ answers: poll.answers, submissionId: poll.submissionId })); } catch (error) { /* storage full or blocked */ }
    }

    function restoreDraft() {
        poll.answers = UI.blankAnswers(poll.definition);
        try {
            const saved = JSON.parse(sessionStorage.getItem(draftStorageKey()) || 'null');
            if (saved && Array.isArray(saved.answers) && saved.answers.length === poll.answers.length) {
                poll.answers = saved.answers.map(a => ({ selections: a.selections || [], writeIns: a.writeIns || [], text: a.text || '', skipped: a.skipped === true }));
                poll.submissionId = saved.submissionId || null;
            }
        } catch (error) { /* ignore unreadable drafts */ }
    }

    // After an admin edit, keep each answer whose question still exists, minus any
    // option that was removed, and ask the driver to check before submitting.
    function adoptRevision(previous, next) {
        poll.updated = true;
        poll.voteKey = '';
        if (!poll.answers) return;
        const oldIds = SB.questionList(previous).map(q => q && q.id);
        poll.answers = SB.questionList(next).map(question => {
            const blank = { selections: [], writeIns: [], text: '', skipped: false };
            const at = oldIds.indexOf(question.id);
            const old = at >= 0 ? poll.answers[at] : null;
            if (!old || previous.questions[at].kind !== question.kind) return blank;
            return { ...blank, ...old, selections: (old.selections || []).filter(id => question.options && question.options[id]) };
        });
        if (poll.mode === 'review') poll.mode = 'form';
        saveDraft();
    }

    function clearDraft() {
        try { sessionStorage.removeItem(draftStorageKey()); } catch (error) { /* ignore */ }
    }

    function header() {
        const control = poll.control || poll.entry || {};
        const phase = P.pollPhase(control, now());
        const line = phase === 'open' ? `Closes ${P.formatDateTime(control.closesAt)} (${P.relative(control.closesAt, now())})`
            : phase === 'scheduled' ? `Opens ${P.formatDateTime(control.opensAt)}`
                : control.closesAt ? `Closed ${P.formatDateTime(control.closesAt)}` : '';
        const tab = (id, label) => h('button', { type: 'button', role: 'tab', id: `tab-${id}`, 'aria-selected': String(poll.tab === id), 'aria-controls': 'pollPanel',
            onclick: () => {
                poll.tab = id;
                if (poll.resultsRef) { poll.resultsRef.off(); poll.resultsRef = null; }
                history.replaceState(null, '', `?poll=${encodeURIComponent(pollId)}${id === 'results' ? '&tab=results' : ''}`);
                poll.voteKey = ''; poll.resultsKey = ''; renderPoll();
            } }, label);
        return [
            h('h1', { text: (poll.definition && poll.definition.title) || (poll.entry && poll.entry.title) || 'Poll' }),
            poll.definition && poll.definition.description ? h('p', { class: 'sp-lede', text: poll.definition.description }) : null,
            line ? h('p', { class: phase === 'open' ? 'sp-deadline' : 'sp-muted', text: line }) : null,
            h('div', { class: 'sp-tabs', role: 'tablist', 'aria-label': 'Poll sections' }, tab('vote', 'Vote'), tab('results', 'Results'),
                h('a', { role: 'tab', class: 'sp-tab-link', href: 'season-polls.html', text: 'Season' }))
        ];
    }

    function renderPoll() {
        const app = $('app');
        if (poll.entry === undefined && poll.control === undefined) return;
        if (poll.entry === null && poll.control === null) {
            fill(app, h('p', { class: 'sp-status sp-warn', text: 'This poll could not be found.' }));
            return;
        }
        let panel = $('pollPanel');
        if (!panel || !app.contains(panel)) {
            panel = h('section', { id: 'pollPanel', role: 'tabpanel' });
            fill(app, h('div', { id: 'pollHeader' }), panel);
        }
        fill($('pollHeader'), ...header());
        if (poll.tab === 'results') renderResultsTab(panel);
        else renderVoteTab(panel);
    }

    function renderVoteTab(panel) {
        const control = poll.control;
        if (poll.definitionError) {
            const key = 'denied';
            if (poll.voteKey !== key) { poll.voteKey = key; fill(panel, h('p', { class: 'sp-status sp-warn', text: "This poll isn't open to you. If you think you should be able to vote, ask an admin." })); }
            return;
        }
        if (!control || poll.definition === undefined || poll.ballot === undefined) return;
        const phase = P.pollPhase(control, now());
        const key = `${phase}|${poll.ballot ? poll.ballot.revision : 'none'}|${poll.mode}|${poll.definition.revision}`;
        if (key === poll.voteKey) return;
        poll.voteKey = key;
        if (poll.ballot) {
            UI.renderReceipt(panel, { definition: poll.definition, ballot: poll.ballot, justSubmitted: poll.justSubmitted === true });
            poll.justSubmitted = false;
            poll.screen = 'receipt';
            return;
        }
        if (phase === 'scheduled') { fill(panel, h('p', { class: 'sp-status', text: `Voting opens ${P.formatDateTime(control.opensAt)}.` })); return; }
        if (phase !== 'open') { fill(panel, h('p', { class: 'sp-status', text: `This poll closed ${P.formatDateTime(control.closesAt)}. You didn't submit an answer.` })); return; }
        if (!poll.answers) restoreDraft();
        // Moving between the questions and the review slides the new screen in.
        const previous = poll.screen;
        if (poll.mode === 'review') {
            UI.renderReview(panel, { definition: poll.definition, answers: poll.answers, onBack: () => { poll.mode = 'form'; renderPoll(); }, onSubmit: submit });
        } else {
            UI.renderForm(panel, { definition: poll.definition, answers: poll.answers, onChange: saveDraft, onReview: () => { poll.mode = 'review'; renderPoll(); window.scrollTo(0, 0); } });
        }
        poll.screen = poll.mode;
        if (poll.updated) panel.prepend(h('p', { class: 'sp-status sp-warn', role: 'status', text: 'An admin has updated this poll. Please check your answers before submitting.' }));
        if (previous !== poll.screen) UI.enter(panel, previous === 'form' ? 'right' : previous === 'review' ? 'left' : 'below');
    }

    // The Submit button shows a spinner while sending and a tick once saved.
    function buttonState(button, state) {
        if (!button.dataset.label) button.dataset.label = button.textContent;
        button.classList.toggle('sp-sending', state === 'sending');
        button.classList.toggle('sp-sent', state === 'sent');
        button.setAttribute('aria-busy', String(state === 'sending'));
        const icon = state === 'sending' ? h('span', { class: 'sp-spinner', 'aria-hidden': 'true' })
            : state === 'sent' ? h('span', { class: 'sp-btn-tick', 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' }) : null;
        fill(button, icon, state === 'sending' ? 'Sending…' : state === 'sent' ? 'Saved' : button.dataset.label);
    }

    function setStatus(element, text, kind) {
        element.textContent = text;
        element.className = `sp-status${kind ? ` sp-${kind}` : ''}`;
    }

    // Saves the ballot and its counters together. If the answer is lost on the way
    // back, the saved submission ID shows whether it arrived before trying again.
    async function submit({ button, status }) {
        const answers = SB.normaliseAnswers(poll.definition, poll.answers);
        if (SB.validateAnswers(poll.definition, answers).length) { poll.mode = 'form'; renderPoll(); return; }
        button.disabled = true;
        buttonState(button, 'sending');
        if (!poll.submissionId) { poll.submissionId = db().ref().push().key; saveDraft(); }
        setStatus(status, connected ? 'Sending your vote…' : 'Waiting for a connection. Keep this page open and your vote will be sent.');
        const ballotPath = `${V1}/polls/${pollId}/ballots/${uid}`;
        const sv = firebase.database.ServerValue;
        poll.sending = true;
        poll.pendingBallot = null;
        try {
            await db().ref().update(SB.submissionUpdates({ pollId, uid, definition: poll.definition, answers, submissionId: poll.submissionId, increment: sv.increment, timestamp: sv.TIMESTAMP }));
            clearDraft();
            // The vote is saved; a brief tick on the button before the receipt.
            buttonState(button, 'sent');
            setStatus(status, '');
            if (!UI.reduceMotion()) await new Promise(resolve => setTimeout(resolve, 550));
            poll.sending = false;
            poll.justSubmitted = true;
            poll.mode = 'form';
            poll.ballot = poll.pendingBallot || (await db().ref(ballotPath).once('value')).val();
            poll.voteKey = '';
            renderPoll();
        } catch (error) {
            poll.sending = false;
            let saved = null;
            try { saved = (await db().ref(ballotPath).once('value')).val(); } catch (readError) { /* fall through */ }
            if (saved) {
                clearDraft();
                poll.justSubmitted = true;
                poll.ballot = saved;
                poll.voteKey = '';
                renderPoll();
                return;
            }
            const control = poll.control || {};
            if (control.state !== 'published' || now() >= control.closesAt) {
                buttonState(button, 'idle');
                setStatus(status, 'This poll closed before your vote arrived, so it was not counted. Your answers are still shown above.', 'error');
            } else {
                buttonState(button, 'idle');
                setStatus(status, `Your vote was not saved (${error.message}). Check your connection and try again.`, 'error');
                button.disabled = false;
            }
        }
    }

    function renderResultsTab(panel) {
        const control = poll.control;
        if (!control || poll.definition === undefined) {
            if (poll.definitionError && poll.resultsKey !== 'denied') { poll.resultsKey = 'denied'; fill(panel, h('p', { class: 'sp-status sp-warn', text: "This poll's results aren't available to you." })); }
            return;
        }
        const access = P.resultsAccess(control, now());
        const path = access.totals ? 'totals' : access.snapshot ? 'snapshot' : null;
        const key = `${path}|${control.labelsHidden}|${control.state}`;
        if (key !== poll.resultsKey) {
            poll.resultsKey = key;
            if (poll.resultsRef) { poll.resultsRef.off(); poll.resultsRef = null; }
            if (!path) { fill(panel, h('p', { class: 'sp-status', text: access.message })); return; }
            fill(panel, h('p', { class: 'sp-muted', text: 'Loading results…' }));
            poll.resultsRef = db().ref(`${V1}/polls/${pollId}/${path}`);
            poll.resultsRef.on('value', snapshot => {
                if (poll.tab !== 'results') return;
                const value = snapshot.val();
                if (!value) { fill(panel, h('p', { class: 'sp-status', text: access.snapshot ? access.message : 'No results yet.' })); return; }
                const totals = path === 'snapshot' ? value.totals : value;
                const box = h('div');
                UI.renderResults(box, { definition: poll.definition, totals, pollId, labelsHidden: control.labelsHidden === true, provisional: control.state !== 'finalised', title: poll.definition.title, downloads: false, minTurnout: control.minTurnout || 0, animateKey: `tab:${pollId}:${path}` });
                fill(panel, path === 'snapshot' ? h('p', { class: 'sp-muted sp-small', text: `Results published ${P.formatDateTime(value.at)}.` }) : null,
                    control.resultVisibility === 'live' && P.pollPhase(control, now()) === 'open' ? h('p', { class: 'sp-muted sp-small', text: 'Live: these totals update as votes arrive.' }) : null, box);
            }, () => fill(panel, h('p', { class: 'sp-status', text: access.message || 'Results are not available yet.' })));
        }
    }

    function startPoll() {
        $('backLink').href = 'season-polls.html';
        $('backLink').setAttribute('aria-label', 'Back to all polls');
        const base = `${V1}/polls/${pollId}`;
        db().ref(`${V1}/index/${pollId}`).on('value', snapshot => { poll.entry = snapshot.val(); renderPoll(); }, () => { poll.entry = null; renderPoll(); });
        db().ref(`${base}/control`).on('value', snapshot => { poll.control = snapshot.val(); renderPoll(); }, () => { poll.control = null; renderPoll(); });
        // Followed live: an admin can edit a published poll (wording, options).
        db().ref(`${base}/definition`).on('value', snapshot => {
            const next = snapshot.val();
            if (!next) { poll.definitionError = new Error('missing'); poll.definition = null; renderPoll(); return; }
            const previous = poll.definition;
            poll.definition = next;
            poll.definitionError = null;
            if (previous && previous.revision !== next.revision) adoptRevision(previous, next);
            renderPoll();
        }, error => { poll.definitionError = error; poll.definition = null; renderPoll(); });
        // Firebase shows a pending write locally before the server accepts it, so while
        // a vote is being sent the receipt waits for the server's answer.
        db().ref(`${base}/ballots/${uid}`).on('value', snapshot => {
            if (poll.sending) { poll.pendingBallot = snapshot.val(); return; }
            poll.ballot = snapshot.val(); poll.mode = 'form'; renderPoll();
        }, () => { poll.ballot = null; renderPoll(); });
        window.addEventListener('beforeunload', event => {
            if (poll.sending) { event.preventDefault(); event.returnValue = ''; }
        });
        // Opening and closing follow the clock; the phase is part of each screen's key.
        setInterval(renderPoll, 60000);
    }

    // ---------- Season summary ----------

    function startSummary() {
        $('backLink').href = 'season-polls.html';
        $('backLink').setAttribute('aria-label', 'Back to all polls');
        db().ref(`${V1}/plans/${summaryId}`).on('value', snapshot => {
            const plan = snapshot.val();
            const summary = plan && plan.summary;
            if (!summary) { fill($('app'), h('p', { class: 'sp-status', text: 'This season summary hasn’t been published yet.' })); return; }
            const body = h('div', { class: 'sp-summary' });
            UI.renderSummary(body, summary);
            fill($('app'),
                h('h1', { text: 'Season summary' }),
                h('p', { class: 'sp-muted', text: `Published ${P.formatDateTime(summary.publishedAt)}.` }),
                h('div', { class: 'sp-inline-actions', style: 'margin:6px 0 2px' },
                    h('button', { type: 'button', class: 'sp-secondary', text: 'Print', onclick: () => window.print() })),
                body);
        }, () => fill($('app'), h('p', { class: 'sp-status sp-error', text: 'The summary could not be loaded.' })));
    }

    // ---------- Start ----------

    document.addEventListener('oneEleven:activeDriver', event => {
        if (uid) return;
        uid = event.detail.user.uid;
        driver = event.detail.driver;
        try { P.clearDrafts(sessionStorage, uid); } catch (error) { /* storage blocked */ }
        db().ref('.info/serverTimeOffset').on('value', snapshot => { serverOffset = snapshot.val() || 0; });
        // Only warn after a few seconds offline, so the first connection doesn't flash a warning.
        let offlineTimer = null;
        db().ref('.info/connected').on('value', snapshot => {
            connected = snapshot.val() === true;
            clearTimeout(offlineTimer);
            if (connected) $('connection').hidden = true;
            else offlineTimer = setTimeout(() => { $('connection').hidden = connected; }, 4000);
        });
        // Hidden from drivers until an admin switches Polls & Forms on.
        db().ref(`${V1}/visibility/drivers`).once('value').then(snapshot => snapshot.val() === true, () => false).then(visible => {
            if (!visible && !driver.isAdmin) {
                fill($('app'), h('h1', { text: 'Polls & forms' }), h('p', { class: 'sp-status', text: 'Polls and forms aren’t open yet. Check back soon.' }));
                return;
            }
            if (!visible) $('app').before(h('p', { class: 'sp-status sp-warn' }, 'Drivers can’t see Polls & Forms yet. Switch it on in ', h('a', { href: 'season-planning-admin.html?tab=settings', text: 'Season Planning → Settings' }), '.'));
            if (summaryId) startSummary();
            else if (pollId) startPoll();
            else startHub();
        });
    });
})();
