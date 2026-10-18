// Season-planning poll logic shared by the driver hub and the admin pages:
// poll timing, London dates, question building, templates and hub grouping.
// No Firebase or page code, so it runs in the browser (window.SeasonPolls)
// and in Node tests.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./catalogue.js'));
    else root.SeasonPolls = factory(root.OneElevenCatalogue);
})(typeof self !== 'undefined' ? self : this, function (C) {
    'use strict';

    const ZONE = 'Europe/London';
    // A track question's "I'm happy with a random track" choice: an ordinary option
    // (so votes are counted and checked like any other) without a location.
    const RANDOM_TRACK = 'random-track';
    const RANDOM_TRACK_OPTION = { label: 'Random track' };
    const DAY = 24 * 60 * 60 * 1000;
    const LIMITS = { questions: 50, options: 1000, writeIns: 200, textLength: 2000 };
    const QUESTION_TYPES = {
        single: 'Single choice',
        multi: 'Multiple choice',
        class: 'Car-class vote',
        nomination: 'Car-class suggestions',
        track: 'Track layout choice',
        yesno: 'Yes/No proposal',
        text: 'Written answer'
    };
    const VISIBILITY = {
        live: 'Live results',
        afterClose: 'Results after closing',
        snapshot: 'Published snapshot only',
        hidden: 'Hidden'
    };

    // ---------- Timing ----------

    // What a poll is doing right now. Opening and closing follow the timestamps,
    // so no scheduled job is needed.
    function pollPhase(control, now) {
        if (!control) return 'unknown';
        if (control.state === 'draft') return 'draft';
        if (control.state === 'archived') return 'archived';
        if (control.state === 'finalised') return 'finalised';
        if (control.state === 'closed' || now >= control.closesAt) return 'closed';
        if (now < control.opensAt) return 'scheduled';
        return 'open';
    }

    // Whether this driver may read live totals under the poll's result setting.
    function resultsAccess(control, now) {
        const phase = pollPhase(control, now);
        switch (control && control.resultVisibility) {
            case 'live': return { totals: true, message: '' };
            case 'afterClose': return phase === 'open' || phase === 'scheduled'
                ? { totals: false, message: 'Results appear when the poll closes.' }
                : { totals: true, message: '' };
            case 'snapshot': return { totals: false, snapshot: true, message: 'Results appear when an admin publishes them.' };
            default: return { totals: false, message: 'Results for this poll are not shown to drivers.' };
        }
    }

    const londonParts = (ts, options) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, ...options })
        .formatToParts(new Date(ts)).map(part => [part.type, part.value]));

    // "Fri 24 Oct 2026, 7:00pm BST" — always London time, with the zone shown.
    function formatDateTime(ts, { year = true } = {}) {
        const p = londonParts(ts, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' });
        // Browsers differ: London winter time may appear as GMT or GMT+0, summer as BST or GMT+1.
        const zone = { 'GMT+1': 'BST', 'GMT+0': 'GMT', UTC: 'GMT' }[p.timeZoneName] || p.timeZoneName;
        return `${p.weekday} ${p.day} ${p.month}${year ? ` ${p.year}` : ''}, ${p.hour}:${p.minute}${(p.dayPeriod || '').toLowerCase()} ${zone}`;
    }

    function formatDate(ts) {
        const p = londonParts(ts, { weekday: 'short', day: 'numeric', month: 'short' });
        return `${p.weekday} ${p.day} ${p.month}`;
    }

    // "in 3 days", "in 5 hours", "in 20 minutes", or "3 days ago".
    function relative(ts, now) {
        const diff = ts - now;
        const abs = Math.abs(diff);
        const [n, unit] = abs >= 2 * DAY ? [Math.round(abs / DAY), 'day']
            : abs >= 2 * 3600000 ? [Math.round(abs / 3600000), 'hour']
                : [Math.max(1, Math.round(abs / 60000)), 'minute'];
        const text = `${n} ${unit}${n === 1 ? '' : 's'}`;
        return diff >= 0 ? `in ${text}` : `${text} ago`;
    }

    // London wall-clock "2026-10-24T19:00" (from a datetime-local input) → UTC ms.
    function londonInputToUtc(value) {
        const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || '');
        if (!match) return NaN;
        const [, y, mo, d, h, mi] = match.map(Number);
        const wall = Date.UTC(y, mo - 1, d, h, mi);
        let guess = wall;
        for (let i = 0; i < 3; i++) {
            const p = londonParts(guess, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
            const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
            guess += wall - shown;
        }
        return guess;
    }

    function utcToLondonInput(ts) {
        const p = londonParts(ts, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
        return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
    }

    // ---------- Drafts saved in the browser while answering ----------

    const DRAFT_PREFIX = 'oneElevenBallotDraft:';
    const draftKey = (uid, pollId, revision) => `${DRAFT_PREFIX}${uid}:${pollId}:${revision}`;

    // Removes unfinished answers belonging to anyone but `keepUid` (all of them on sign-out).
    function clearDrafts(storage, keepUid) {
        const keys = [];
        for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
        keys.filter(key => key && key.startsWith(DRAFT_PREFIX) && (!keepUid || !key.startsWith(`${DRAFT_PREFIX}${keepUid}:`)))
            .forEach(key => storage.removeItem(key));
    }

    // ---------- Questions ----------

    // Suggested quota for an elimination round: half the options, rounded up;
    // one when two remain.
    function defaultQuota(optionCount) {
        if (optionCount <= 2) return 1;
        return Math.ceil(optionCount / 2);
    }

    function describeQuota(question, optionCount) {
        const count = optionCount === undefined ? Object.keys(question.options || {}).length : optionCount;
        const { minSelections: min, maxSelections: max } = question;
        const random = question.type === 'track' && question.options && question.options[RANDOM_TRACK];
        const noun = question.type === 'track' ? 'layout' : question.type === 'class' || question.type === 'nomination' ? 'class' : 'option';
        const many = n => (n === 1 ? noun : noun === 'class' ? 'classes' : `${noun}s`);
        if (question.kind === 'text') return question.required ? 'Write your answer.' : 'Optional.';
        if (question.type === 'yesno') return 'Choose Yes or No.';
        if (question.type === 'nomination' && count === 0) {
            const up = question.maxWriteIns ? ` (up to ${question.maxWriteIns})` : '';
            return question.required ? `Write in the classes you’d like${up}.` : `Write in any classes you’d like${up}.`;
        }
        if (random && min === 1 && max === 1) return `Choose 1 of ${count - 1} ${many(count - 1)}, or ask for a random track.`;
        if (min === max) return `Choose exactly ${min} of ${count} ${many(count)}.`;
        if (min === 0) return `Choose up to ${max} ${many(max)}${question.allowWriteIns ? ', or write your own' : ''}.`;
        return `Choose ${min} to ${max} of ${count} ${many(count)}.`;
    }

    function blankQuestion(type) {
        const base = { type, prompt: '', help: '', required: true };
        switch (type) {
            case 'single': return { ...base, source: 'manual', options: [] };
            case 'multi': return { ...base, source: 'manual', options: [], minSelections: 1, maxSelections: 2 };
            case 'class': return { ...base, source: 'classes', sourceIds: [], minSelections: 1, maxSelections: 1 };
            case 'nomination': return { ...base, source: 'classes', sourceIds: [], minSelections: 0, maxSelections: 0, allowWriteIns: true, maxWriteIns: 20 };
            case 'track': return { ...base, source: 'layouts', sourceIds: [], allowRandom: true };
            case 'yesno': return { ...base };
            default: return { ...base, type: 'text', required: false, maxLength: 2000 };
        }
    }

    // The options a draft question would offer, from its manual list or the catalogue.
    // An empty sourceIds list means "every active entry", unless sourcePicked is set:
    // then exactly the ticked entries are offered (possibly none, for write-ins only).
    function resolveOptions(question, catalogue) {
        if (question.type === 'yesno') return [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }];
        if (question.type === 'text') return [];
        // A fixed list keeps exact option IDs, e.g. a duplicated poll or a shortlist.
        if (question.source === 'fixed') {
            return Object.entries(question.fixedOptions || {}).map(([id, option]) => ({ ...option, id }));
        }
        if (question.source === 'classes') {
            const classes = (catalogue && catalogue.classes) || {};
            const picked = question.sourcePicked === true || Boolean(question.sourceIds && question.sourceIds.length);
            const ids = picked ? (question.sourceIds || []) : Object.keys(classes).filter(id => classes[id].active !== false);
            return ids.filter(id => classes[id]).map(id => ({ id, label: classes[id].name }))
                .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
        }
        if (question.source === 'layouts') {
            const all = C.trackList(catalogue || {}).filter(track => !track.system);
            const allowed = question.sourceIds && question.sourceIds.length ? new Set(question.sourceIds) : null;
            const locations = (catalogue && catalogue.locations) || {};
            const layouts = all.filter(track => !allowed || allowed.has(track.id)).map(track => ({
                id: track.id, label: track.name, locationId: track.locationId,
                locationName: (locations[track.locationId] || {}).name || track.shortName, imagePath: track.imagePath
            }));
            return question.allowRandom ? [...layouts, { id: RANDOM_TRACK, ...RANDOM_TRACK_OPTION }] : layouts;
        }
        const taken = new Set();
        return (question.options || []).map(option => {
            const label = typeof option === 'string' ? option : option.label;
            const id = option.id && C.ID_PATTERN.test(option.id) && !taken.has(option.id) ? option.id : C.uniqueId(label, taken);
            taken.add(id);
            return { id, label: String(label).trim() };
        }).filter(option => option.label);
    }

    // Problems that stop a draft from being published.
    function validateDraft(draft, catalogue) {
        const errors = [];
        if (!draft.title || !draft.title.trim()) errors.push('Add a poll title.');
        if (!draft.questions || !draft.questions.length) errors.push('Add at least one question.');
        if ((draft.questions || []).length > LIMITS.questions) errors.push(`A poll can have up to ${LIMITS.questions} questions.`);
        if (!(draft.opensAt < draft.closesAt)) errors.push('The closing time must be after the opening time.');
        (draft.questions || []).forEach((question, i) => {
            const label = `Question ${i + 1}`;
            if (!question.prompt || !question.prompt.trim()) errors.push(`${label}: add the question text.`);
            if (question.type === 'text') {
                if (!(question.maxLength >= 1 && question.maxLength <= LIMITS.textLength)) errors.push(`${label}: the length limit must be 1–${LIMITS.textLength} characters.`);
                return;
            }
            const options = resolveOptions(question, catalogue);
            if (options.length > LIMITS.options) errors.push(`${label}: up to ${LIMITS.options} options.`);
            if (options.some(option => !String(option.label || '').trim())) errors.push(`${label}: every option needs a name.`);
            if (['single', 'track', 'yesno', 'class', 'multi'].includes(question.type) && options.length < 2) {
                errors.push(`${label}: needs at least two options.`);
            }
            if (question.type === 'multi' || question.type === 'class') {
                const { minSelections: min, maxSelections: max } = question;
                if (!(Number.isInteger(min) && Number.isInteger(max) && min >= 0 && min <= max)) errors.push(`${label}: the minimum must be no more than the maximum.`);
                else if (max > options.length) errors.push(`${label}: can't ask for ${max} choices from ${options.length} options.`);
                else if (max < 1) errors.push(`${label}: allow at least one choice.`);
            }
            if (question.type === 'nomination') {
                if (!options.length && !question.allowWriteIns) errors.push(`${label}: offer catalogue classes, written suggestions, or both.`);
                if (question.allowWriteIns && !(question.maxWriteIns >= 1 && question.maxWriteIns <= LIMITS.writeIns)) errors.push(`${label}: written suggestions must be limited to 1–${LIMITS.writeIns}.`);
                if (question.maxPicks !== undefined && question.maxPicks !== null && !(Number.isInteger(question.maxPicks) && question.maxPicks >= 1)) errors.push(`${label}: the most classes per driver must be 1 or more (or left blank for no limit).`);
            }
        });
        return errors;
    }

    // Freezes a draft into the published definition the database rules check.
    function buildDefinition(draft, catalogue) {
        const questions = {};
        // Kept question IDs stay (live edits compare them); new questions get a free one.
        const used = new Set(draft.questions.map(q => q.id).filter(Boolean));
        let next = 1;
        const freshId = () => { while (used.has(`q${next}`)) next++; used.add(`q${next}`); return `q${next}`; };
        const seen = new Set();
        draft.questions.forEach((question, index) => {
            const id = question.id && !seen.has(question.id) ? question.id : freshId();
            seen.add(id);
            const base = { id, index, type: question.type, required: question.required !== false, prompt: question.prompt.trim() };
            if (question.help && question.help.trim()) base.help = question.help.trim();
            if (question.type === 'text') {
                questions[index] = { ...base, kind: 'text', maxLength: question.maxLength };
                return;
            }
            const options = {};
            resolveOptions(question, catalogue).forEach(option => {
                const stored = { label: String(option.label).trim() };
                if (option.locationId) stored.locationId = option.locationId;
                if (option.locationName) stored.locationName = option.locationName;
                if (option.imagePath) stored.imagePath = option.imagePath;
                options[option.id] = stored;
            });
            const count = Object.keys(options).length;
            if (question.type === 'nomination') {
                // maxPicks caps how many listed classes one driver can pick (blank: no cap).
                const cap = question.maxPicks >= 1 ? Math.min(question.maxPicks, count) : count;
                questions[index] = { ...base, kind: 'nomination', minSelections: 0, maxSelections: cap, options,
                    ...(question.allowWriteIns ? { allowWriteIns: true, maxWriteIns: question.maxWriteIns } : { allowWriteIns: false }) };
                if (!count) delete questions[index].options;
                return;
            }
            const multi = question.type === 'multi' || question.type === 'class';
            questions[index] = { ...base, kind: 'choice', options,
                minSelections: multi ? question.minSelections : 1,
                maxSelections: multi ? question.maxSelections : 1 };
        });
        const definition = { schema: 1, revision: 1, title: draft.title.trim(), questionCount: draft.questions.length, questions };
        if (draft.description && draft.description.trim()) definition.description = draft.description.trim();
        return definition;
    }

    // A published definition back into editable draft questions (for Duplicate and
    // Replace). Options keep their IDs as a fixed list.
    function draftQuestions(definition) {
        const list = [];
        for (let i = 0; i < definition.questionCount; i++) {
            const q = definition.questions[i];
            const draft = { id: q.id, type: q.type || (q.kind === 'text' ? 'text' : 'single'), prompt: q.prompt, help: q.help || '', required: q.required !== false };
            if (q.kind === 'text') { list.push({ ...draft, type: 'text', maxLength: q.maxLength }); continue; }
            if (draft.type !== 'yesno') draft.source = 'fixed';
            draft.fixedOptions = JSON.parse(JSON.stringify(q.options || {}));
            draft.minSelections = q.minSelections;
            draft.maxSelections = q.maxSelections;
            if (q.kind === 'nomination') {
                Object.assign(draft, { allowWriteIns: q.allowWriteIns === true, maxWriteIns: q.maxWriteIns || 20 });
                if (q.maxSelections < Object.keys(q.options || {}).length) draft.maxPicks = q.maxSelections;
            }
            list.push(draft);
        }
        return list;
    }

    // Draft → control, with every configurable setting.
    function buildControl(draft) {
        const control = {
            state: 'published',
            opensAt: draft.opensAt,
            closesAt: draft.closesAt,
            resultVisibility: draft.resultVisibility || 'afterClose',
            labelsHidden: draft.labelsHidden === true,
            allDrivers: draft.allDrivers !== false
        };
        if (!control.allDrivers) control.eligible = Object.fromEntries((draft.eligible || []).map(uid => [uid, true]));
        if (draft.minTurnout > 0) control.minTurnout = draft.minTurnout;
        return control;
    }

    // Lightweight entry the driver hub lists.
    function indexEntry(draft, control) {
        const entry = {
            title: draft.title.trim(),
            kind: draft.kind || 'custom',
            state: control.state,
            opensAt: control.opensAt,
            closesAt: control.closesAt,
            resultVisibility: control.resultVisibility,
            labelsHidden: control.labelsHidden === true,
            standalone: !draft.planId
        };
        if (draft.summary && draft.summary.trim()) entry.summary = draft.summary.trim().slice(0, 300);
        if (draft.planId) entry.planId = draft.planId;
        if (draft.stageId) entry.stageId = draft.stageId;
        if (draft.replaces) entry.replaces = draft.replaces;
        return entry;
    }

    // ---------- Templates ----------

    const BUILT_IN_TEMPLATES = [
        { id: 'builtin-nomination', name: 'Car-class suggestions', kind: 'nomination', description: 'Drivers pick any classes from the catalogue and can write in new ones.',
            draft: { title: 'Car class suggestions', summary: 'Suggest the classes you would like to race next season.',
                questions: [{ ...blankQuestion('nomination'), maxPicks: 5, prompt: 'Which car classes would you like to race next season?', help: 'Choose up to 5 and add any that are missing.' },
                    { ...blankQuestion('text'), prompt: 'Anything else about the car choice?' }] } },
        { id: 'builtin-elimination', name: 'Car-class voting round', kind: 'elimination', description: 'An exact number of choices from a fixed shortlist.',
            draft: { title: 'Car class round 1', summary: 'Vote for the classes that should go through to the next round.', labelsHidden: true, resultVisibility: 'live',
                questions: [{ ...blankQuestion('class'), prompt: 'Which classes should go through?' }] } },
        { id: 'builtin-track', name: 'Track choice', kind: 'track', description: 'Each driver picks one track layout.',
            draft: { title: 'Track choice', summary: 'Pick one track layout for next season’s calendar.', resultVisibility: 'hidden',
                questions: [{ ...blankQuestion('track'), prompt: 'Which track layout would you like on the calendar?' }] } },
        { id: 'builtin-rules', name: 'Rule-change vote', kind: 'rules', description: 'A Yes/No question per proposal. Passes when Yes beats No.',
            draft: { title: 'Rule changes', summary: 'Vote on each proposed rule change.', resultVisibility: 'afterClose',
                questions: [{ ...blankQuestion('yesno'), prompt: 'Proposal 1: …' }] } },
        { id: 'builtin-suggestions', name: 'Suggestion box', kind: 'suggestions', description: 'One optional written answer.',
            draft: { title: 'Suggestions', summary: 'Share your ideas.', resultVisibility: 'hidden',
                questions: [{ ...blankQuestion('text'), prompt: 'What would you like to suggest?' }] } },
        { id: 'builtin-custom', name: 'Blank poll', kind: 'custom', description: 'Start from nothing.', draft: { title: '', questions: [] } }
    ];

    const DEFAULT_SETTINGS = {
        instructions: '',
        durationDays: 7,
        resultVisibility: 'afterClose',
        labelsHidden: true,
        exclusionSeasons: 1,
        targetEvents: 10
    };

    // A new draft from a template plus the admin's shared defaults (defaults only
    // shape new drafts; published polls never change when defaults do).
    function draftFromTemplate(template, settings, now) {
        const defaults = { ...DEFAULT_SETTINGS, ...(settings || {}) };
        const source = JSON.parse(JSON.stringify(template.draft || {}));
        // Opens straight away by default; closes on the hour after the default duration.
        const opensAt = Math.floor(now / 60000) * 60000;
        return {
            title: source.title || '',
            summary: source.summary || defaults.instructions || '',
            description: source.description || defaults.instructions || '',
            kind: template.kind || source.kind || 'custom',
            questions: source.questions || [],
            opensAt,
            closesAt: Math.ceil((opensAt + defaults.durationDays * DAY) / 3600000) * 3600000,
            resultVisibility: source.resultVisibility || defaults.resultVisibility,
            labelsHidden: source.labelsHidden !== undefined ? source.labelsHidden : defaults.labelsHidden,
            allDrivers: true,
            templateId: template.id
        };
    }

    // ---------- Hub ----------

    function groupPolls(index, now) {
        const groups = { open: [], scheduled: [], results: [], archived: [] };
        Object.entries(index || {}).forEach(([id, entry]) => {
            const item = { id, ...entry, phase: pollPhase(entry, now) };
            if (entry.replacedBy) item.replaced = true;
            if (item.phase === 'open') groups.open.push(item);
            else if (item.phase === 'scheduled') groups.scheduled.push(item);
            else if (item.phase === 'archived' || item.replaced) groups.archived.push(item);
            else groups.results.push(item);
        });
        groups.open.sort((a, b) => a.closesAt - b.closesAt);
        groups.scheduled.sort((a, b) => a.opensAt - b.opensAt);
        groups.results.sort((a, b) => b.closesAt - a.closesAt);
        groups.archived.sort((a, b) => b.closesAt - a.closesAt);
        return groups;
    }

    // Progress strip: one entry per configured stage, from the polls linked to it.
    function planProgress(plan, index, now) {
        const stages = [];
        for (let i = 0; i < (plan.stageCount || 0); i++) if (plan.stages && plan.stages[i]) stages.push(plan.stages[i]);
        const polls = Object.entries(index || {}).map(([id, entry]) => ({ id, ...entry, phase: pollPhase(entry, now) }))
            .filter(poll => poll.planId === plan.id && !poll.replacedBy);
        return stages.map(stage => {
            const linked = polls.filter(poll => poll.stageId === stage.id);
            const phases = linked.map(poll => poll.phase);
            let status = 'upcoming';
            // Stages without polls (such as the calendar) are finished once the summary is out.
            if (!linked.length && plan.summary) status = 'done';
            else if (phases.includes('open')) status = 'open';
            else if (linked.length && phases.every(p => p === 'closed' || p === 'finalised' || p === 'archived')) status = 'done';
            else if (phases.includes('scheduled')) status = 'scheduled';
            const next = linked.filter(p => p.phase === 'scheduled').sort((a, b) => a.opensAt - b.opensAt)[0];
            return { ...stage, status, polls: linked, opensAt: next ? next.opensAt : null };
        });
    }

    return {
        ZONE, DAY, LIMITS, RANDOM_TRACK, RANDOM_TRACK_OPTION, QUESTION_TYPES, VISIBILITY, BUILT_IN_TEMPLATES, DEFAULT_SETTINGS,
        pollPhase, resultsAccess, formatDateTime, formatDate, relative, londonInputToUtc, utcToLondonInput,
        draftKey, clearDrafts, defaultQuota, describeQuota, blankQuestion, resolveOptions, validateDraft,
        buildDefinition, buildControl, indexEntry, draftQuestions, draftFromTemplate, groupPolls, planProgress
    };
});
