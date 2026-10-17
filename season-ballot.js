// Season-planning ballots: building submissions, admin corrections and recounts.
// Works in the browser (window.SeasonBallot) and in Node tests. It has no Firebase
// dependency: callers pass Firebase's increment() and server timestamp in.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SeasonBallot = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const BASE = 'seasonPlanning/v1/polls';
    const LIMITS = { questions: 50, options: 1000, writeIns: 200, textLength: 2000 };
    const OPTION_ID = /^[a-z][a-z0-9_-]{0,63}$/;

    const pollPath = pollId => `${BASE}/${pollId}`;

    // Firebase returns objects with keys "0", "1"... as arrays; accept either form.
    function questionList(definition) {
        const list = [];
        for (let i = 0; i < definition.questionCount; i++) list.push(definition.questions[i]);
        return list;
    }

    // Turns form input into tidy answers: one entry per question, keyed by index.
    // Raw answer shape: { selections: [optionId], writeIns: [text], text, skipped }.
    function normaliseAnswers(definition, raw) {
        return questionList(definition).map((question, i) => {
            const input = (raw && raw[i]) || {};
            if (question.kind === 'text') {
                const text = typeof input.text === 'string' ? input.text.trim() : '';
                return text ? { text } : { skipped: true };
            }
            const selections = [...new Set(input.selections || [])];
            const writeIns = question.kind === 'nomination' && question.allowWriteIns
                ? (input.writeIns || []).map(t => String(t).trim()).filter(Boolean)
                : [];
            if (input.skipped && !question.required && !selections.length && !writeIns.length) return { skipped: true };
            return { selections, writeIns };
        });
    }

    // Mirrors the database rules so drivers see a helpful message before submitting.
    // The rules remain the real protection.
    function validateAnswers(definition, answers) {
        const errors = [];
        questionList(definition).forEach((question, i) => {
            const answer = answers[i];
            const fail = message => errors.push({ question: i, message });
            if (!answer) return fail('Missing answer.');
            if (answer.skipped) {
                if (question.required) fail('This question needs an answer.');
                return;
            }
            if (question.kind === 'text') {
                if (!answer.text) fail('This question needs an answer.');
                else if (answer.text.length > question.maxLength) fail(`Use ${question.maxLength} characters or fewer.`);
                return;
            }
            const count = answer.selections.length;
            const min = question.minSelections;
            const max = question.maxSelections;
            if (new Set(answer.selections).size !== count) fail('Each option can be chosen only once.');
            if (answer.selections.some(id => !question.options || !question.options[id])) fail('An option is no longer available.');
            if (min === max && count !== min) fail(`Choose exactly ${min}.`);
            else if (count < min) fail(`Choose at least ${min}.`);
            else if (count > max) fail(`Choose no more than ${max}.`);
            const writeIns = answer.writeIns || [];
            if (writeIns.length > (question.allowWriteIns ? question.maxWriteIns : 0)) fail('Too many written suggestions.');
            if (writeIns.some(text => text.length > LIMITS.textLength)) fail(`Keep each suggestion under ${LIMITS.textLength} characters.`);
            if (question.required && question.kind === 'nomination' && count + writeIns.length === 0) fail('Add at least one suggestion.');
        });
        return errors;
    }

    // Stored form of one answer. Selections use numbered slots plus a reverse
    // option-to-slot map, so the rules can prove the list is complete and unique.
    function storedAnswer(question, answer) {
        if (answer.skipped) return { skipped: true };
        if (question.kind === 'text') return { text: answer.text };
        const stored = { count: answer.selections.length };
        if (stored.count) {
            stored.slots = {};
            stored.byOption = {};
            answer.selections.forEach((id, slot) => {
                stored.slots[slot] = id;
                stored.byOption[id] = slot;
            });
        }
        if (question.kind === 'nomination' && question.allowWriteIns) {
            const writeIns = answer.writeIns || [];
            stored.writeInCount = writeIns.length;
            if (writeIns.length) {
                stored.writeIns = {};
                writeIns.forEach((text, n) => { stored.writeIns[n] = { n, text }; });
            }
        }
        return stored;
    }

    function storedAnswers(definition, answers) {
        const stored = {};
        questionList(definition).forEach((question, i) => { stored[i] = storedAnswer(question, answers[i]); });
        return stored;
    }

    // Selected option IDs per question index, from a stored or freshly built ballot.
    function selectedOptions(definition, ballot) {
        return questionList(definition).map((question, i) => {
            const answer = ballot && ballot.answers && ballot.answers[i];
            if (!answer || !answer.count) return [];
            const ids = [];
            for (let slot = 0; slot < answer.count; slot++) ids.push(answer.slots[slot]);
            return ids;
        });
    }

    // One atomic update: the private ballot plus every counter it affects.
    function submissionUpdates({ pollId, uid, definition, answers, submissionId, increment, timestamp }) {
        const base = pollPath(pollId);
        const ballot = {
            schema: 1,
            submissionId,
            submittedAt: timestamp,
            revision: 1,
            answers: storedAnswers(definition, answers)
        };
        const updates = {
            [`${base}/ballots/${uid}`]: ballot,
            [`${base}/totals/respondents`]: increment(1)
        };
        selectedOptions(definition, ballot).forEach((ids, q) => {
            ids.forEach(id => { updates[`${base}/totals/questions/${q}/options/${id}`] = increment(1); });
        });
        return updates;
    }

    // Publishing freezes the definition and starts every counter at zero; the rules
    // only accept +1 changes to counters that already exist.
    function publishUpdates({ pollId, definition, control }) {
        const base = pollPath(pollId);
        return {
            [`${base}/definition`]: definition,
            [`${base}/control`]: { ...control, state: 'published' },
            [`${base}/totals`]: emptyTotals(definition)
        };
    }

    function emptyTotals(definition) {
        const totals = { respondents: 0 };
        questionList(definition).forEach((question, i) => {
            const ids = Object.keys(question.options || {});
            if (!ids.length) return;
            totals.questions = totals.questions || {};
            totals.questions[i] = { options: Object.fromEntries(ids.map(id => [id, 0])) };
        });
        return totals;
    }

    // Recomputes totals from the stored ballots (admin recount).
    function computeTotals(definition, ballots) {
        const totals = emptyTotals(definition);
        Object.values(ballots || {}).forEach(ballot => {
            totals.respondents += 1;
            selectedOptions(definition, ballot).forEach((ids, q) => {
                ids.forEach(id => {
                    const options = totals.questions && totals.questions[q] && totals.questions[q].options;
                    if (options && id in options) options[id] += 1;
                });
            });
        });
        return totals;
    }

    // Differences between recomputed totals and the stored totals.
    function compareTotals(expected, actual) {
        const differences = [];
        const stored = actual || {};
        if ((stored.respondents || 0) !== expected.respondents) {
            differences.push({ path: 'respondents', expected: expected.respondents, actual: stored.respondents || 0 });
        }
        Object.entries(expected.questions || {}).forEach(([q, question]) => {
            const storedOptions = (stored.questions && stored.questions[q] && stored.questions[q].options) || {};
            Object.entries(question.options).forEach(([id, count]) => {
                const found = storedOptions[id] || 0;
                if (found !== count) differences.push({ path: `questions/${q}/options/${id}`, expected: count, actual: found });
            });
            Object.keys(storedOptions).forEach(id => {
                if (!(id in question.options)) differences.push({ path: `questions/${q}/options/${id}`, expected: null, actual: storedOptions[id] });
            });
        });
        return differences;
    }

    // Repairs found by a recount, as changes rather than replacements: each counter
    // moves by (ballots − stored) from one consistent snapshot. Votes that arrive
    // later add to both the ballots and the counters, so they're unaffected.
    // Counters for options the poll doesn't have are removed.
    function repairUpdates(pollId, differences, increment) {
        const base = `${pollPath(pollId)}/totals`;
        return Object.fromEntries(differences.map(d => [`${base}/${d.path}`, d.expected === null ? null : increment(d.expected - d.actual)]));
    }

    // Admin correction: new answers, counter differences and an audit entry, all in
    // one update. The rules reject it if another admin changed the ballot first.
    function correctionUpdates({ pollId, uid, definition, oldBallot, answers, auditId, adminUid, reason, increment, timestamp }) {
        const base = pollPath(pollId);
        const ballot = {
            ...oldBallot,
            revision: oldBallot.revision + 1,
            lastAuditId: auditId,
            answers: storedAnswers(definition, answers)
        };
        const updates = {
            [`${base}/ballots/${uid}`]: ballot,
            [`${base}/audit/${auditId}`]: {
                at: timestamp,
                by: adminUid,
                action: 'correct-ballot',
                reason,
                targetUid: uid,
                fromRevision: oldBallot.revision,
                before: oldBallot,
                after: ballot.answers
            }
        };
        const before = selectedOptions(definition, oldBallot);
        const after = selectedOptions(definition, ballot);
        after.forEach((ids, q) => {
            const removed = before[q].filter(id => !ids.includes(id));
            const added = ids.filter(id => !before[q].includes(id));
            removed.forEach(id => { updates[`${base}/totals/questions/${q}/options/${id}`] = increment(-1); });
            added.forEach(id => { updates[`${base}/totals/questions/${q}/options/${id}`] = increment(1); });
        });
        return updates;
    }

    // Changing a published poll's timing, visibility or state: the control fields,
    // the matching hub index fields and an audit entry, in one update.
    const INDEX_FIELDS = ['state', 'opensAt', 'closesAt', 'resultVisibility', 'labelsHidden'];
    function controlUpdates({ pollId, before, changes, auditId, adminUid, reason, action, timestamp }) {
        const base = pollPath(pollId);
        const updates = {};
        const previous = {};
        Object.entries(changes).forEach(([key, value]) => {
            updates[`${base}/control/${key}`] = value;
            previous[key] = before && before[key] !== undefined ? before[key] : null;
            if (INDEX_FIELDS.includes(key)) updates[`seasonPlanning/v1/index/${pollId}/${key}`] = value;
        });
        updates[`${base}/control/lastAuditId`] = auditId;
        updates[`seasonPlanning/v1/index/${pollId}/updatedAt`] = timestamp;
        updates[`${base}/audit/${auditId}`] = { at: timestamp, by: adminUid, action, reason, before: previous, after: changes };
        return updates;
    }

    return {
        LIMITS,
        controlUpdates,
        repairUpdates,
        OPTION_ID,
        pollPath,
        questionList,
        normaliseAnswers,
        validateAnswers,
        storedAnswers,
        selectedOptions,
        submissionUpdates,
        publishUpdates,
        emptyTotals,
        computeTotals,
        compareTotals,
        correctionUpdates
    };
});
