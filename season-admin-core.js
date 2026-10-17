// Season administration logic: nomination review, voting-round advancement,
// previous-season track exclusions, duplicate-location resolution and rule
// outcomes. No Firebase or page code (browser global SeasonAdminCore; Node tests).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./catalogue.js'), require('./season-ballot.js'), require('./season-polls-core.js'), require('./season-results.js'));
    } else {
        root.SeasonAdminCore = factory(root.OneElevenCatalogue, root.SeasonBallot, root.SeasonPolls, root.SeasonResults);
    }
})(typeof self !== 'undefined' ? self : this, function (C, SB, P, R) {
    'use strict';

    const entriesOf = value => Object.entries(value || {}).filter(([, v]) => v !== null && v !== undefined);

    // ---------- Car-class suggestions ----------

    function writeInsOf(ballot, index) {
        const answer = ballot && ballot.answers && ballot.answers[index];
        const list = [];
        for (let n = 0; n < ((answer && answer.writeInCount) || 0); n++) list.push(String(answer.writeIns[n].text || '').trim());
        return list.filter(Boolean);
    }

    function classIndex(catalogue) {
        const index = new Map();
        entriesOf(catalogue && catalogue.classes).forEach(([id, c]) => {
            [c.name, ...C.aliasList(c)].forEach(name => { if (!index.has(C.nameKey(name))) index.set(C.nameKey(name), id); });
        });
        return index;
    }

    // Follows "merge into" decisions to the group that finally decides a write-in.
    function finalGroup(key, review) {
        const seen = new Set();
        let current = key;
        while (review.has(current) && review.get(current).action === 'merge' && review.get(current).target && !seen.has(current)) {
            seen.add(current);
            current = review.get(current).target;
        }
        return current;
    }

    // Decisions keyed by the suggestion's text. Accepts a plain object (each value may
    // carry its own `key`, as stored) and returns a Map, so lookups only ever find
    // real decisions, never built-in properties such as "constructor".
    function decisionMap(review) {
        const map = new Map();
        Object.keys(review || {}).forEach(k => {
            const value = review[k];
            if (value && typeof value === 'object') map.set(typeof value.key === 'string' ? value.key : k, value);
        });
        return map;
    }

    // Everything drivers suggested: catalogue picks, written suggestions grouped by
    // obvious duplicates (same text ignoring case/accents/spaces) with their original
    // wording, and the combined candidates once the admin's decisions are applied.
    // Each driver counts once per candidate.
    function aggregateNominations(definition, ballots, catalogue, review) {
        const decisions = decisionMap(review);
        const known = classIndex(catalogue);
        const questions = SB.questionList(definition).map((q, i) => ({ q, i })).filter(({ q }) => q.kind === 'nomination');
        const classSupport = new Map();
        const groups = new Map();
        entriesOf(ballots).forEach(([uid, ballot]) => {
            const selected = SB.selectedOptions(definition, ballot);
            questions.forEach(({ i }) => {
                selected[i].forEach(id => {
                    if (!classSupport.has(id)) classSupport.set(id, new Set());
                    classSupport.get(id).add(uid);
                });
                writeInsOf(ballot, i).forEach(text => {
                    const key = C.nameKey(text);
                    if (!groups.has(key)) groups.set(key, { key, label: text, texts: [], uids: new Set() });
                    const group = groups.get(key);
                    group.texts.push({ text, uid });
                    group.uids.add(uid);
                });
            });
        });

        const classLabel = id => (catalogue && catalogue.classes && catalogue.classes[id] && catalogue.classes[id].name)
            || (questions.map(({ q }) => q.options && q.options[id]).find(Boolean) || {}).label || id;
        const writeIns = [...groups.values()].map(group => {
            const decision = decisions.get(group.key) || null;
            const root = finalGroup(group.key, decisions);
            const rootDecision = decisions.get(root) || null;
            let status = 'pending';
            let classId = null;
            if (decision && decision.action === 'exclude') status = 'excluded';
            else if (rootDecision && rootDecision.action === 'exclude') status = 'excluded';
            else if (rootDecision && (rootDecision.action === 'map' || rootDecision.action === 'new') && rootDecision.classId) { status = 'mapped'; classId = rootDecision.classId; }
            else if (root !== group.key) status = 'merged';
            return {
                key: group.key, label: group.label, count: group.uids.size, uids: [...group.uids],
                texts: group.texts, variants: [...new Set(group.texts.map(t => t.text))],
                suggestedClassId: known.get(group.key) || null,
                decision, root, status, classId
            };
        }).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

        // Combine supporters per final candidate.
        const candidates = new Map();
        const add = (id, label, uids, source) => {
            if (!candidates.has(id)) candidates.set(id, { id, classId: id.startsWith('class:') ? id.slice(6) : null, label, uids: new Set(), fromCatalogue: 0, fromWriteIns: 0, needsDecision: false });
            const candidate = candidates.get(id);
            uids.forEach(uid => candidate.uids.add(uid));
            candidate[source] += uids.size || uids.length;
        };
        classSupport.forEach((uids, id) => add(`class:${id}`, classLabel(id), uids, 'fromCatalogue'));
        writeIns.forEach(group => {
            if (group.status === 'excluded') return;
            if (group.status === 'mapped') add(`class:${group.classId}`, classLabel(group.classId), new Set(group.uids), 'fromWriteIns');
            else {
                const rootGroup = writeIns.find(g => g.key === group.root) || group;
                add(`writein:${rootGroup.key}`, rootGroup.label, new Set(group.uids), 'fromWriteIns');
                candidates.get(`writein:${rootGroup.key}`).needsDecision = true;
            }
        });
        const list = [...candidates.values()].map(c => ({ ...c, count: c.uids.size, uids: [...c.uids] }))
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
        return {
            respondents: entriesOf(ballots).length,
            writeIns,
            candidates: list,
            pending: writeIns.filter(g => g.status === 'pending' && !g.decision).length
        };
    }

    // ---------- Voting rounds ----------

    // Suggested settings for a round with n options.
    function roundDefaults(n) {
        if (n <= 1) return { quota: 0, advance: 0, winner: true };
        return { quota: P.defaultQuota(n), advance: P.defaultQuota(n), winner: false };
    }

    // Which options advance from ranked rows. A tie at the cutoff is never
    // settled automatically: the result lists the tied options instead.
    function advancement(rows, target) {
        const ranked = [...rows].sort((a, b) => b.count - a.count);
        if (target >= ranked.length) return { tie: false, advancing: ranked.map(r => r.id), safe: ranked.map(r => r.id), tied: [], needed: 0, cutoffCount: null };
        if (target <= 0) return { tie: false, advancing: [], safe: [], tied: [], needed: 0, cutoffCount: null };
        const cutoffCount = ranked[target - 1].count;
        const above = ranked.filter(r => r.count > cutoffCount);
        const atCutoff = ranked.filter(r => r.count === cutoffCount);
        if (above.length + atCutoff.length === target) {
            return { tie: false, advancing: [...above, ...atCutoff].map(r => r.id), safe: [...above, ...atCutoff].map(r => r.id), tied: [], needed: 0, cutoffCount };
        }
        return { tie: true, advancing: null, safe: above.map(r => r.id), tied: atCutoff.map(r => r.id), needed: target - above.length, cutoffCount };
    }

    function stageFor(plan, label) {
        return plan && (plan.stages || []).find(s => s && s.label.toLowerCase() === label.toLowerCase());
    }

    function baseDraft(settings, now, extra) {
        const defaults = { ...P.DEFAULT_SETTINGS, ...(settings || {}) };
        const opensAt = Math.floor(now / 60000) * 60000;
        return {
            summary: '', description: defaults.instructions || '', opensAt,
            closesAt: Math.ceil((opensAt + defaults.durationDays * P.DAY) / 3600000) * 3600000,
            resultVisibility: defaults.resultVisibility, labelsHidden: defaults.labelsHidden, allDrivers: true,
            ...extra
        };
    }

    // A draft voting round over a fixed list of class options.
    function roundDraft({ plan, number, options, quota, settings, now, runoff = false }) {
        const fixedOptions = Object.fromEntries(options.map(o => [o.id, { label: o.label }]));
        const n = options.length;
        const choose = quota || P.defaultQuota(n);
        const stage = stageFor(plan, 'Car votes');
        return baseDraft(settings, now, {
            title: runoff ? `Car class · Round ${number} runoff` : `Car class · Round ${number}`,
            summary: `Choose exactly ${choose} of ${n} classes.`,
            kind: 'elimination', resultVisibility: 'live', labelsHidden: true,
            planId: plan ? plan.id : undefined, stageId: stage ? stage.id : undefined,
            questions: [{ type: 'class', source: 'fixed', fixedOptions, prompt: runoff ? 'Which of the tied classes should go through?' : 'Which classes should go through to the next round?',
                help: '', required: true, minSelections: choose, maxSelections: choose }]
        });
    }

    // What a new runoff carries forward: the classes already through from earlier
    // rounds (when this round was itself a runoff) plus this round's safe ones.
    function runoffCarry(meta, result, labelOf) {
        const earlier = meta && meta.runoffFor ? (meta.safe || []) : [];
        const earlierLabels = meta && meta.runoffFor ? (meta.safeLabels || earlier.map(labelOf)) : [];
        return {
            safe: [...earlier, ...result.safe],
            safeLabels: [...earlierLabels, ...result.safe.map(labelOf)],
            needed: result.needed
        };
    }

    // ---------- Track exclusions ----------

    const SYSTEM = new Set(C.SYSTEM_TRACKS.map(C.nameKey));

    // Locations used in the chosen previous seasons are excluded (every layout at
    // them), plus admin additions, minus admin removals. Saved track names the
    // catalogue doesn't recognise must be resolved first.
    function exclusionPlan(catalogue, seasons, setup) {
        const config = setup || {};
        const resolved = new Map(Object.keys(config.unknown || {}).map(k => {
            const value = config.unknown[k];
            return value && typeof value === 'object' ? [value.name, value.locationId] : [k, value];
        }));
        const index = C.buildLayoutIndex(catalogue || {});
        const locations = (catalogue && catalogue.locations) || {};
        const excluded = new Map();
        const unknown = new Map();
        const exclude = (locationId, reason) => {
            if (!locations[locationId]) return;
            if (!excluded.has(locationId)) excluded.set(locationId, []);
            if (!excluded.get(locationId).includes(reason)) excluded.get(locationId).push(reason);
        };
        (seasons || []).forEach(season => {
            Object.entries(season.races || {}).forEach(([, race]) => {
                const name = race && typeof race.trackName === 'string' ? race.trackName.trim() : '';
                if (!name || SYSTEM.has(C.nameKey(name))) return;
                const layout = C.resolveLayout(catalogue, index, name);
                if (layout && layout.system) return;
                const fixed = resolved.get(name);
                const locationId = layout ? layout.locationId : fixed && fixed !== 'ignore' ? fixed : null;
                if (locationId) exclude(locationId, `Used in ${season.name || season.id} (${name})`);
                else if (fixed !== 'ignore') {
                    if (!unknown.has(name)) unknown.set(name, []);
                    unknown.get(name).push(season.name || season.id);
                }
            });
        });
        entriesOf(config.added).forEach(([locationId, reason]) => exclude(locationId, `Added by an admin: ${reason || 'no reason given'}`));
        const kept = [];
        entriesOf(config.removed).forEach(([locationId, note]) => {
            if (excluded.has(locationId)) { excluded.delete(locationId); kept.push({ locationId, name: (locations[locationId] || {}).name || locationId, note: note === true ? '' : note }); }
        });
        const eligible = C.trackList(catalogue || {}).filter(track => !track.system && !excluded.has(track.locationId));
        return {
            excluded: [...excluded.entries()].map(([locationId, reasons]) => ({ locationId, name: locations[locationId].name, reasons }))
                .sort((a, b) => a.name.localeCompare(b.name)),
            kept,
            unknown: [...unknown.entries()].map(([name, uses]) => ({ name, uses })),
            eligible,
            blocking: unknown.size > 0
        };
    }

    function trackDraft({ plan, eligible, catalogue, settings, now }) {
        const locations = (catalogue && catalogue.locations) || {};
        const fixedOptions = {};
        eligible.forEach(track => {
            fixedOptions[track.id] = { label: track.name, locationId: track.locationId, locationName: (locations[track.locationId] || {}).name || track.shortName, imagePath: track.imagePath };
        });
        const stage = stageFor(plan, 'Tracks');
        return baseDraft(settings, now, {
            title: 'Track choice', summary: 'Pick one track layout for next season’s calendar.', kind: 'track', resultVisibility: 'hidden', labelsHidden: false,
            planId: plan ? plan.id : undefined, stageId: stage ? stage.id : undefined,
            questions: [{ type: 'track', source: 'fixed', fixedOptions, prompt: 'Which track layout would you like on the calendar?', help: 'Locations used last season aren’t available.', required: true, minSelections: 1, maxSelections: 1 }]
        });
    }

    // ---------- Duplicate locations ----------

    // When several drivers chose layouts at the same location, the one who
    // submitted last keeps it and the earlier ones need a replacement. Identical
    // submission times need an admin decision. Replacements must use a location
    // nobody else has; exceptions let an admin accept a shared location.
    function trackResolution(definition, ballots, resolution) {
        const config = resolution || {};
        const index = SB.questionList(definition).findIndex(q => q.type === 'track');
        const options = (definition.questions[index] && definition.questions[index].options) || {};
        const locationOf = layoutId => (options[layoutId] || {}).locationId || null;
        const choices = [];
        entriesOf(ballots).forEach(([uid, ballot]) => {
            const layoutId = SB.selectedOptions(definition, ballot)[index][0];
            if (layoutId) choices.push({ uid, layoutId, locationId: locationOf(layoutId), submittedAt: ballot.submittedAt });
        });
        const byLocation = new Map();
        choices.forEach(choice => {
            if (!byLocation.has(choice.locationId)) byLocation.set(choice.locationId, []);
            byLocation.get(choice.locationId).push(choice);
        });
        const rows = new Map();
        const conflicts = [];
        const assigned = new Map();
        byLocation.forEach((group, locationId) => {
            const sorted = [...group].sort((a, b) => b.submittedAt - a.submittedAt || a.uid.localeCompare(b.uid));
            if (group.length === 1) {
                rows.set(group[0].uid, { ...group[0], status: 'unique', finalLayoutId: group[0].layoutId });
                assigned.set(locationId, group[0].uid);
                return;
            }
            const exception = config.exceptions && config.exceptions[locationId];
            const chosenKeeper = config.keeps && config.keeps[locationId];
            const tie = !chosenKeeper && sorted[0].submittedAt === sorted[1].submittedAt;
            const keeper = exception ? null : chosenKeeper && group.some(c => c.uid === chosenKeeper) ? chosenKeeper : tie ? null : sorted[0].uid;
            conflicts.push({ locationId, uids: sorted.map(c => c.uid), keeper, tie: tie && !exception, exception: exception || null });
            sorted.forEach(choice => {
                if (exception) rows.set(choice.uid, { ...choice, status: 'exception', finalLayoutId: choice.layoutId });
                else if (keeper === choice.uid) rows.set(choice.uid, { ...choice, status: 'keeps', finalLayoutId: choice.layoutId });
                else if (!keeper) rows.set(choice.uid, { ...choice, status: 'tie', finalLayoutId: null });
                else rows.set(choice.uid, { ...choice, status: 'replace', finalLayoutId: null });
            });
            if (exception || keeper) assigned.set(locationId, keeper || 'exception');
        });
        // Apply recorded replacements in submission order.
        const invalid = [];
        [...rows.values()].filter(row => row.status === 'replace').sort((a, b) => a.submittedAt - b.submittedAt).forEach(row => {
            const replacement = config.replacements && config.replacements[row.uid];
            if (!replacement) return;
            const locationId = locationOf(replacement.layoutId);
            if (!locationId || assigned.has(locationId)) { invalid.push({ uid: row.uid, layoutId: replacement.layoutId }); return; }
            assigned.set(locationId, row.uid);
            rows.set(row.uid, { ...row, status: 'replaced', finalLayoutId: replacement.layoutId, replacementLocationId: locationId });
        });
        const free = new Map();
        Object.entries(options).forEach(([layoutId, option]) => {
            if (assigned.has(option.locationId)) return;
            if (!free.has(option.locationId)) free.set(option.locationId, { locationId: option.locationId, name: option.locationName || option.locationId, layouts: [] });
            free.get(option.locationId).layouts.push({ id: layoutId, label: option.label });
        });
        const list = [...rows.values()];
        return {
            rows: list.sort((a, b) => a.submittedAt - b.submittedAt),
            conflicts,
            invalid,
            freeLocations: [...free.values()].sort((a, b) => a.name.localeCompare(b.name)),
            assignments: list.filter(r => r.finalLayoutId).map(r => ({ uid: r.uid, layoutId: r.finalLayoutId, locationId: locationOf(r.finalLayoutId), source: r.status === 'replaced' ? 'replacement' : 'original' })),
            unresolved: list.filter(r => r.status === 'replace' || r.status === 'tie').length
        };
    }

    // ---------- Rule changes ----------

    function rulesDraft({ plan, proposals, settings, now, minTurnout = 0 }) {
        const stage = stageFor(plan, 'Rules');
        return baseDraft(settings, now, {
            title: 'Rule changes', summary: `Vote Yes or No on ${proposals.length === 1 ? 'one proposal' : `${proposals.length} proposals`}.`,
            kind: 'rules', resultVisibility: 'afterClose', labelsHidden: false, minTurnout: minTurnout > 0 ? minTurnout : undefined,
            planId: plan ? plan.id : undefined, stageId: stage ? stage.id : undefined,
            questions: proposals.map(p => ({ type: 'yesno', prompt: p.text.slice(0, 1000), help: p.detail ? p.detail.slice(0, 2000) : '', required: false }))
        });
    }

    // Provisional outcome of every Yes/No question: passes only if Yes beats No.
    function ruleOutcomes(definition, totals, { minTurnout = 0 } = {}) {
        return SB.questionList(definition).map((question, index) => ({ question, index })).filter(({ question }) => question.type === 'yesno').map(({ question, index }) => {
            const counts = (totals && totals.questions && totals.questions[index] && totals.questions[index].options) || {};
            const yes = Number(counts.yes) || 0;
            const no = Number(counts.no) || 0;
            return { index, prompt: question.prompt, yes, no, votes: yes + no, ...R.yesNoOutcome(yes, no, { minTurnout }) };
        });
    }

    // Written answers across polls, for turning suggestions into proposals.
    function writtenAnswers(definition, ballots) {
        const out = [];
        SB.questionList(definition).forEach((question, index) => {
            if (question.kind !== 'text') return;
            entriesOf(ballots).forEach(([uid, ballot]) => {
                const answer = ballot.answers && ballot.answers[index];
                if (answer && answer.text) out.push({ uid, questionIndex: index, prompt: question.prompt, text: answer.text, submittedAt: ballot.submittedAt });
            });
        });
        return out;
    }

    // ---------- Season steps (admin checklist) ----------

    const STEPS = [
        { id: 'suggestions', label: 'Car-class suggestions', stage: 'Suggestions', kind: 'nomination' },
        { id: 'rounds', label: 'Car-class voting rounds', stage: 'Car votes', kind: 'elimination' },
        { id: 'tracks', label: 'Track picks', stage: 'Tracks', kind: 'track' },
        { id: 'rules', label: 'Rule changes', stage: 'Rules', kind: 'rules' },
        { id: 'calendar', label: 'Calendar', stage: 'Calendar' },
        { id: 'summary', label: 'Publish the summary' }
    ];

    // Drivers' progress-strip stages for the chosen steps (the summary isn't a stage).
    function stagesForSteps(stepIds) {
        return STEPS.filter(step => step.stage && stepIds.includes(step.id)).map(step => ({ id: C.slugify(step.stage), label: step.stage }));
    }

    // Which steps a plan includes, from its stages (matched by label so older plans work).
    function includedSteps(plan) {
        const labels = new Set(Object.values((plan && plan.stages) || {}).filter(Boolean).map(s => s.label.toLowerCase()));
        return STEPS.filter(step => !step.stage || labels.has(step.stage.toLowerCase())).map(step => step.id);
    }

    // Status of every step for the admin checklist: 'skipped', 'todo', 'waiting',
    // 'decide' (needs the admin) or 'done', with a one-line explanation.
    function seasonSteps({ plan, polls, roundDrafts = [], planAdmin = {}, trackUnresolved = null, now }) {
        const included = new Set(includedSteps(plan));
        const latest = list => (list && list.length ? list[list.length - 1] : null);
        const closed = poll => poll && (poll.phase === 'closed' || poll.phase === 'finalised' || poll.phase === 'archived');
        const when = ts => P.formatDateTime(ts, { year: false });
        const rounds = polls.rounds || [];
        const result = {};

        const suggestion = latest(polls.suggestions);
        if (!suggestion) result.suggestions = ['todo', 'Create the suggestions poll'];
        else if (!closed(suggestion)) result.suggestions = ['waiting', suggestion.phase === 'scheduled' ? `Opens ${when(suggestion.opensAt)}` : `Voting closes ${when(suggestion.closesAt)}`];
        else if (planAdmin.shortlist && (rounds.length || roundDrafts.length)) result.suggestions = ['done', `Shortlist of ${Object.values(planAdmin.shortlist.items || {}).length} classes`];
        else result.suggestions = ['decide', 'Review the suggestions and pick the shortlist'];

        const round = latest(rounds);
        const roundMeta = round && (planAdmin.rounds || {})[round.id];
        if (planAdmin.winner) result.rounds = ['done', `Winner: ${planAdmin.winner.label}`];
        else if (roundDrafts.length) result.rounds = ['decide', `${roundDrafts[0].title} is ready to open`];
        else if (!round) result.rounds = included.has('suggestions') && !closed(suggestion) ? ['waiting', 'Starts after the suggestions'] : ['todo', 'Pick the classes for round 1'];
        else if (!closed(round)) result.rounds = ['waiting', `${round.title} closes ${when(round.closesAt)}`];
        else if (!roundMeta || !roundMeta.decision) result.rounds = ['decide', `${round.title} has closed: choose what goes through`];
        else result.rounds = ['decide', 'Open the next round or confirm the winner'];

        const trackPoll = latest(polls.tracks);
        if (!trackPoll) result.tracks = ['todo', 'Check the exclusions and open track picks'];
        else if (!closed(trackPoll)) result.tracks = ['waiting', `Track picks close ${when(trackPoll.closesAt)}`];
        else if (trackUnresolved === null) result.tracks = ['decide', 'Check for drivers who picked the same location'];
        else if (trackUnresolved > 0) result.tracks = ['decide', `${trackUnresolved} ${trackUnresolved === 1 ? 'driver needs' : 'drivers need'} a replacement track`];
        else result.tracks = ['done', 'Every driver has a track'];

        const proposals = Object.values(planAdmin.proposals || {}).filter(p => p && p.status !== 'withdrawn');
        const rulePoll = latest(polls.rules);
        const outcomes = planAdmin.outcomes || {};
        if (!rulePoll && !proposals.length) result.rules = ['todo', 'Add the rule proposals'];
        else if (!rulePoll) result.rules = ['todo', `Open the rule vote (${proposals.length} ${proposals.length === 1 ? 'proposal' : 'proposals'})`];
        else if (!closed(rulePoll)) result.rules = ['waiting', `Rule vote closes ${when(rulePoll.closesAt)}`];
        else {
            const waiting = proposals.filter(p => p.pollId === rulePoll.id && !outcomes[`${rulePoll.id}_${p.questionIndex}`]).length;
            const anyConfirmed = Object.keys(outcomes).some(key => key.startsWith(`${rulePoll.id}_`));
            result.rules = waiting || !anyConfirmed ? ['decide', 'Confirm the outcomes'] : ['done', 'Outcomes confirmed'];
        }

        const calendar = planAdmin.calendar || {};
        const finalVersion = calendar.finalised && calendar.versions && calendar.versions[calendar.finalised.versionId];
        if (finalVersion) result.calendar = ['done', `Final: ${Object.values(finalVersion.events || {}).length} events`];
        else if (calendar.currentVersion) result.calendar = ['decide', 'Adjust and finalise the calendar'];
        else if (included.has('tracks') && result.tracks[0] !== 'done') result.calendar = ['waiting', 'After track picks are settled'];
        else result.calendar = ['todo', 'Generate the calendar'];

        result.summary = plan && plan.summary ? ['done', `Published ${P.formatDate(plan.summary.publishedAt)}`] : ['todo', 'Preview and publish the summary'];

        return STEPS.map(step => {
            const [status, line] = included.has(step.id) ? result[step.id] : ['skipped', 'Not this season'];
            return { ...step, status, line };
        });
    }

    // The step that most needs attention: the first decision, else the first to-do.
    function nextStep(steps) {
        return steps.find(s => s.status === 'decide') || steps.find(s => s.status === 'todo') || null;
    }

    return { STEPS, stagesForSteps, includedSteps, seasonSteps, nextStep, aggregateNominations, roundDefaults, advancement, runoffCarry, roundDraft, exclusionPlan, trackDraft, trackResolution, rulesDraft, ruleOutcomes, writtenAnswers };
});
