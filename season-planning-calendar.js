// Calendar and Summary tabs for the Season Planning Admin page. Every calendar
// change is saved as a new version (planAdmin/<plan>/calendar/versions), so
// reloading never re-runs a draw and any version can be restored.
(function () {
    'use strict';
    const A = window.SeasonAdmin;
    const T = window.SeasonTools;
    const AC = window.SeasonAdminCore;
    const K = window.SeasonCalendar;
    const P = window.SeasonPolls;
    const UI = window.SeasonUI;
    const { h, fill } = UI;
    const V1 = A.V1;
    const sv = () => firebase.database.ServerValue;
    const tools = T.tools;

    const calendar = () => (tools.planAdmin && tools.planAdmin.calendar) || {};
    const versions = () => Object.entries(calendar().versions || {}).filter(([, v]) => v).map(([id, v]) => ({ id, ...v })).sort((a, b) => (a.at || 0) - (b.at || 0));
    const current = () => { const id = calendar().currentVersion; return id ? versions().find(v => v.id === id) || null : null; };
    const eventsOf = version => (version ? Object.values(version.events || {}) : []);
    const target = () => calendar().target || A.settings().targetEvents || 10;
    const finalised = () => calendar().finalised || null;

    // Driver choices after duplicate resolution, from the plan's latest track poll.
    function driverInfo() {
        const polls = T.planPolls('track').filter(p => p.phase !== 'scheduled');
        if (!polls.length) return { ready: true, drivers: [], note: 'No track poll in this plan, so every event is drawn at random.' };
        const poll = polls[polls.length - 1];
        const data = T.pollData(poll.id, { ballots: true });
        if (!data.definition || !data.ballots) return { ready: false, pollId: poll.id };
        const config = ((tools.planAdmin.trackResolution || {})[poll.id]) || {};
        const resolution = AC.trackResolution(data.definition, data.ballots, config);
        const options = AC.trackOptions(data.definition);
        return {
            ready: true, poll, open: poll.phase === 'open', unresolved: resolution.unresolved, exceptions: config.exceptions || {},
            drivers: K.driverEvents(resolution.assignments, options), randomCount: resolution.random.length
        };
    }

    // Locations excluded by the Tracks tab settings (previous seasons and overrides).
    function excludedLocations() {
        T.loadSeasons();
        if (tools.seasons === null) return null;
        const stored = tools.planAdmin.trackSetup || {};
        const setup = { ...stored, unknown: T.unknownNames(stored) };
        const seasonIds = stored.seasonIds ? Object.values(stored.seasonIds) : tools.seasons.slice(0, A.settings().exclusionSeasons).map(s => s.id);
        const plan = AC.exclusionPlan(A.state.catalogue, tools.seasons.filter(s => seasonIds.includes(s.id)), setup);
        return plan.excluded.map(e => e.locationId);
    }

    const CHANGED = 'The calendar changed while this was open (perhaps another admin is editing it). Nothing was saved; check the latest version.';

    // Saves a new version and makes it current, but only if the calendar is still on
    // the version the admin was looking at (`basedOn`). Done as one database
    // transaction, so two admins can't overwrite each other's changes.
    async function saveVersion(events, action, note, extra = {}, basedOn = null) {
        const id = A.newId();
        const record = A.clean({ events, action, note, parent: basedOn, generation: K.GENERATION_VERSION, at: A.now(), by: A.state.uid, ...extra });
        let outcome;
        try {
            outcome = await firebase.database().ref(`${T.planPath()}/calendar`).transaction(current => {
                const cal = current || {};
                if ((cal.currentVersion || null) !== basedOn) return undefined;
                if (cal.finalised && cal.finalised.versionId === cal.currentVersion) return undefined;
                cal.versions = cal.versions || {};
                cal.versions[id] = record;
                cal.currentVersion = id;
                return cal;
            });
        } catch (error) { A.setStatus(`Not saved: ${error.message}`, 'error'); return false; }
        if (!outcome.committed) { A.setStatus(CHANGED, 'warn'); A.rerender(); return false; }
        return T.decide({}, 'calendar', `${action}: ${note}`, 'Calendar saved.');
    }

    function calendarTab() {
        if (!tools.planId) return T.needPlan();
        if (!Object.keys((A.state.catalogue && A.state.catalogue.layouts) || {}).length) {
            return h('p', { class: 'sp-status sp-warn' }, 'Set up the track catalogue in ', h('a', { href: 'racing-setup.html', text: 'Racing Setup' }), ' first.');
        }
        const info = driverInfo();
        const excluded = excludedLocations();
        if (!info.ready) return T.pollLoading(info.pollId);
        if (excluded === null) return T.seasonsLoading();
        const version = current();
        const events = eventsOf(version);
        const locked = Boolean(finalised() && finalised().versionId === calendar().currentVersion);
        return h('div', null, setupCard(info, excluded, version, locked), version ? eventsCard(version, events, info, excluded, locked) : null, version ? finaliseCard(events, info, locked) : null);
    }

    function setupCard(info, excluded, version, locked) {
        const card = h('section', { class: 'sp-card' }, h('h2', { text: 'Season calendar' }));
        const targetInput = h('input', { type: 'number', min: 1, max: 24, value: String(target()), disabled: locked, style: 'max-width:100px' });
        targetInput.addEventListener('change', () => {
            const value = Math.max(1, Math.min(24, Number(targetInput.value) || 1));
            T.decide({ [`${T.planPath()}/calendar/target`]: value }, 'calendar-target', `Target set to ${value} events`);
        });
        const pool = K.randomPool(A.state.catalogue, { excluded, taken: info.drivers.map(d => d.locationId) });
        T.put(card,
            A.field('Number of events (1–24)', targetInput),
            h('p', { class: 'sp-small' }, info.poll ? `${A.plural(info.drivers.length, 'driver choice')}${info.randomCount ? ` (${info.randomCount} more asked for a random track)` : ''} · ` : `${info.note || ''} `,
                `${A.plural(pool.length, 'location')} left for random draws.`),
            info.open ? h('p', { class: 'sp-status sp-warn', text: 'The track poll is still open, so driver choices may change.' }) : null,
            info.unresolved ? h('p', { class: 'sp-status sp-warn', text: `${A.plural(info.unresolved, 'driver choice')} still ${info.unresolved === 1 ? 'needs' : 'need'} a decision in the track picks step.` }) : null);
        if (!version) {
            const problem = K.shortfall(info.drivers, target(), pool.length);
            T.put(card,
                problem ? h('p', { class: 'sp-status sp-error', text: problem.message }) : null,
                T.help('Generating keeps every driver choice, draws the rest at random (each location equally likely, then one of its layouts) and shuffles the order. Excluded and already-chosen locations, and layouts not allowed in random draws, are left out. The result is saved, so reloading won’t change it.'),
                h('button', { type: 'button', text: 'Generate calendar', disabled: Boolean(problem), onclick: () => {
                    const result = K.generate({ drivers: info.drivers, catalogue: A.state.catalogue, excluded, target: target(), source: K.cryptoSource() });
                    if (result.problem) { A.setStatus(result.problem.message, 'error'); return; }
                    saveVersion(result.events, 'generate', `${info.drivers.length} driver choices + ${result.events.length - info.drivers.length} random, shuffled`, { poolSnapshot: result.poolSnapshot }, null);
                } }));
        } else if (!locked && !K.sameDrivers(eventsOf(version), info.drivers)) {
            T.put(card, h('div', { class: 'sp-status sp-warn' }, 'Driver choices have changed since this version (for example a replacement was recorded). ',
                h('button', { type: 'button', class: 'sp-link', text: 'Update driver choices', onclick: async () => {
                    const result = K.syncDrivers(eventsOf(version), info.drivers);
                    const body = h('ul', null, result.added.map(e => h('li', { text: `Add ${e.label} (driver choice)` })), result.removed.map(e => h('li', { text: `Remove ${e.label} (${e.source === 'driver' ? 'old driver choice' : 'its location is now a driver choice'})` })));
                    if (await A.confirmDialog({ title: 'Update driver choices?', body, confirmLabel: 'Update' })) saveVersion(result.events, 'update drivers', `${result.added.length} added, ${result.removed.length} removed`, {}, version.id);
                } })));
        }
        return card;
    }

    function eventsCard(version, events, info, excluded, locked) {
        const ops = K.describeOperations(events, target());
        const source = () => K.cryptoSource();
        const run = async (title, explanation, compute, action) => {
            if (!await A.confirmDialog({ title, body: h('p', { text: explanation }), confirmLabel: title })) return;
            const result = compute();
            if (!result || result.problem) { A.setStatus((result && result.problem.message) || 'Nothing to change.', 'error'); return; }
            saveVersion(result.events, action, explanation, result.poolSnapshot ? { poolSnapshot: result.poolSnapshot } : {}, version.id);
        };
        const update = (list, action, note) => saveVersion(list, action, note, {}, version.id);
        const rows = events.map((event, index) => {
            const dateInput = h('input', { type: 'date', value: event.date || '', disabled: locked, 'aria-label': `Date for round ${index + 1}`, style: 'max-width:170px' });
            dateInput.addEventListener('change', () => update(events.map((e, i) => (i === index ? { ...e, date: dateInput.value || null } : e)), 'date', `Round ${index + 1}: ${dateInput.value || 'no date'}`));
            const toggle = (key, label) => {
                const input = h('input', { type: 'checkbox', checked: event[key] === true, disabled: locked || (key === 'keep' && event.source === 'driver') });
                input.addEventListener('change', () => update(events.map((e, i) => (i === index ? { ...e, [key]: input.checked } : e)), key === 'keep' ? 'keep' : 'pin', `${event.label}: ${label} ${input.checked ? 'on' : 'off'}`));
                return h('label', { class: 'sp-check sp-small' }, input, label);
            };
            const img = h('img', { class: 'sp-thumb', src: event.imagePath || 'Logos_and_icons/racetracks/TBD.png', alt: '', loading: 'lazy' });
            return h('li', { class: 'sp-event' },
                h('span', { class: 'sp-event-number', text: String(index + 1) }), img,
                h('div', null,
                    h('div', { class: 'sp-item-title' }, event.label, ' ', h('span', { class: `sp-badge ${event.source === 'driver' ? 'sp-green' : ''}`, text: event.source === 'driver' ? `Driver choice · ${A.driverName(event.uid)}` : 'Random draw' })),
                    h('div', { class: 'sp-item-meta', text: event.locationName }),
                    h('div', { class: 'sp-event-controls' }, dateInput,
                        event.source === 'random' ? toggle('keep', 'Keep this track') : null,
                        toggle('pinned', 'Pin this position'))),
                locked ? null : h('div', { class: 'sp-item-actions' },
                    h('button', { type: 'button', class: 'sp-link', text: '↑', 'aria-label': `Move round ${index + 1} up`, disabled: !K.move(events, index, -1), onclick: () => update(K.move(events, index, -1), 'move', `${event.label} moved up`) }),
                    h('button', { type: 'button', class: 'sp-link', text: '↓', 'aria-label': `Move round ${index + 1} down`, disabled: !K.move(events, index, 1), onclick: () => update(K.move(events, index, 1), 'move', `${event.label} moved down`) }),
                    event.source === 'random' ? h('button', { type: 'button', class: 'sp-link', text: 'Replace', onclick: () => run('Replace this track', `${event.label} is swapped for a random location not already in the calendar. Nothing else changes.`,
                        () => K.replaceOne({ events, index, catalogue: A.state.catalogue, excluded, source: source() }), 'replace') }) : null,
                    event.source === 'random' && !event.pinned ? h('button', { type: 'button', class: 'sp-link', text: 'Remove', onclick: async () => {
                        if (await A.confirmDialog({ title: `Remove ${event.label}?`, body: h('p', { text: 'Later events move up one round. Driver choices can’t be removed here.' }), confirmLabel: 'Remove' })) {
                            update(events.filter((e, i) => i !== index), 'remove', `${event.label} removed`);
                        }
                    } }) : null));
        });
        return h('section', { class: 'sp-card' },
            h('div', { class: 'sp-card-head' }, h('h2', { text: `Events (${events.length} of ${target()})` }), locked ? h('span', { class: 'sp-badge sp-green', text: 'Final' }) : null),
            h('ol', { class: 'sp-events' }, rows),
            locked ? null : h('div', { class: 'sp-inline-actions', style: 'margin-top:12px' },
                h('button', { type: 'button', class: 'sp-secondary', text: `Fill empty spaces (${ops.fill})`, disabled: !ops.fill, onclick: () => run('Fill empty spaces',
                    `Adds ${A.plural(ops.fill, 'random track')} at the end. Existing events don’t change.`,
                    () => K.fillRemaining({ events, catalogue: A.state.catalogue, excluded, target: target(), source: source() }), 'fill') }),
                h('button', { type: 'button', class: 'sp-secondary', text: `Redraw random tracks (${ops.redraw})`, disabled: !ops.redraw, onclick: () => run('Redraw random tracks',
                    `Replaces ${A.plural(ops.redraw, 'random track')} that ${ops.redraw === 1 ? 'isn’t' : 'aren’t'} kept. Driver choices and kept tracks stay; positions stay the same.`,
                    () => K.redraw({ events, catalogue: A.state.catalogue, excluded, source: source() }), 'redraw') }),
                h('button', { type: 'button', class: 'sp-secondary', text: `Shuffle order (${ops.shuffle})`, disabled: ops.shuffle < 2, onclick: () => run('Shuffle order',
                    `Shuffles ${A.plural(ops.shuffle, 'event')} that ${ops.shuffle === 1 ? 'isn’t' : 'aren’t'} pinned. Pinned events keep their round number.`,
                    () => K.shuffleOrder({ events, source: source() }), 'shuffle') })),
            T.help('Keep: a random track survives a redraw. Pin: the event keeps its round number when shuffling. Use ↑ ↓ to move events without dragging.'));
    }

    function finaliseCard(events, info, locked) {
        const card = h('section', { class: 'sp-card' }, h('h2', { text: 'Finalise' }));
        if (locked) {
            const f = finalised();
            T.put(card, h('p', { class: 'sp-status sp-ok' }, `Final since ${P.formatDateTime(f.at)} (${A.driverName(f.by)}) and shown on the drivers’ `, h('a', { href: 'season-polls.html', text: 'Polls & Forms page' }), '.'),
            h('button', { type: 'button', class: 'sp-link', text: 'Reopen for changes…', onclick: async () => {
                const r = await A.confirmDialog({ title: 'Reopen the calendar?', body: h('p', { text: 'Drivers stop seeing it until you finalise again.' }), confirmLabel: 'Reopen' });
                if (r) T.decide({ [`${T.planPath()}/calendar/finalised`]: null, [`${V1}/plans/${tools.planId}/summary`]: null }, 'calendar-reopen', 'Calendar reopened', 'Calendar reopened.');
            } }));
            return card;
        }
        const problems = K.finaliseProblems({ events, target: target(), unresolvedDuplicates: info.unresolved || 0, exceptions: info.exceptions || {},
            driversChanged: !K.sameDrivers(events, info.drivers) });
        if (info.open) problems.push('The track poll is still open.');
        T.put(card, problems.length ? h('div', { class: 'sp-status sp-warn' }, 'Before finalising:', h('ul', { class: 'sp-errors', style: 'color:inherit' }, problems.map(p => h('li', { text: p }))))
            : h('p', { text: 'Everything checks out. Finalising fixes this version as the season calendar and shows it on the drivers’ Polls & Forms page.' }),
        h('button', { type: 'button', text: 'Finalise calendar', disabled: problems.length > 0, onclick: async () => {
            const shown = calendar().currentVersion;
            if (!await A.confirmDialog({ title: 'Finalise the calendar?', body: h('p', { text: 'Drivers will see it on Polls & Forms. This doesn’t create or change a championship.' }), confirmLabel: 'Finalise' })) return;
            const fresh = driverInfo();
            const freshEvents = eventsOf(current());
            const freshProblems = K.finaliseProblems({ events: freshEvents, target: target(), unresolvedDuplicates: fresh.unresolved || 0, exceptions: fresh.exceptions || {},
                driversChanged: !K.sameDrivers(freshEvents, fresh.drivers || []) });
            if (fresh.open) freshProblems.push('The track poll is still open.');
            if (freshProblems.length) { A.setStatus(`Not finalised: ${freshProblems.join(' ')}`, 'warn'); A.rerender(); return; }
            let outcome;
            try {
                outcome = await firebase.database().ref(`${T.planPath()}/calendar`).transaction(currentCal => {
                    const cal = currentCal || {};
                    if (cal.currentVersion !== shown || cal.finalised) return undefined;
                    cal.finalised = { versionId: shown, at: A.now(), by: A.state.uid };
                    return cal;
                });
            } catch (error) { A.setStatus(`Not finalised: ${error.message}`, 'error'); return; }
            if (!outcome.committed) { A.setStatus(CHANGED, 'warn'); A.rerender(); return; }
            T.decide(driverCalendar(freshEvents), 'calendar-finalise', `Calendar finalised with ${freshEvents.length} events`, 'Calendar finalised and shown to drivers.');
        } }));
        return card;
    }

    // The final calendar as drivers see it (stored as the plan's summary, which drivers
    // can read). Who chose each track isn't included.
    function driverCalendar(events) {
        const plan = A.activePlan();
        return { [`${V1}/plans/${tools.planId}/summary`]: A.clean({ title: plan.title, publishedAt: sv().TIMESTAMP, publishedBy: A.state.uid,
            calendar: events.map(e => A.clean({ label: e.label, locationName: e.locationName, imagePath: e.imagePath, source: e.source, date: e.date || undefined })) }) };
    }

    // Keeps the drivers' copy in step with the final calendar: written when it's
    // missing or out of date (a calendar finalised before this existed, say), without
    // the admin having to do anything.
    let syncing = '';
    function syncDriverCalendar() {
        const plan = A.activePlan();
        const f = finalised();
        if (!plan || !tools.planId || !f || f.versionId !== calendar().currentVersion) return;
        const version = versions().find(v => v.id === f.versionId);
        if (!version) return;
        const wanted = Object.values(driverCalendar(eventsOf(version)))[0].calendar;
        const shown = plan.summary && plan.summary.calendar ? Object.values(plan.summary.calendar) : null;
        const key = JSON.stringify(wanted);
        if (shown && JSON.stringify(shown) === key) return;
        if (syncing === key) return;
        syncing = key;
        A.save(driverCalendar(eventsOf(version))).then(ok => { if (!ok) syncing = ''; });
    }

    window.SeasonCalendarTabs = { calendarTab, syncDriverCalendar };
    A.addTab({ id: 'calendar', label: 'Calendar', render: calendarTab });
})();
