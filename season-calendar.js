// Season calendar and summary logic: the random draw, editing operations that
// respect locks, checks before finalising, and summary exports (CSV, Markdown,
// JSON). No Firebase or page code (browser global SeasonCalendar; Node tests).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./catalogue.js'));
    else root.SeasonCalendar = factory(root.OneElevenCatalogue);
})(typeof self !== 'undefined' ? self : this, function (C) {
    'use strict';

    const GENERATION_VERSION = 1;
    const LIMITS = { minEvents: 1, maxEvents: 24 };

    // ---------- Randomness ----------

    // Browser cryptographic randomness as 32-bit unsigned integers.
    function cryptoSource() {
        const buffer = new Uint32Array(1);
        return () => { crypto.getRandomValues(buffer); return buffer[0]; };
    }

    // Unbiased integer in [0, max): values from the top, incomplete range of
    // 2^32 are rejected so every result is equally likely.
    function randomInt(max, source) {
        if (!(max >= 1)) throw new Error('randomInt needs a positive range.');
        const range = 2 ** 32;
        const limit = range - (range % max);
        let value = source();
        while (value >= limit) value = source();
        return value % max;
    }

    // Fisher–Yates: every order equally likely.
    function shuffle(list, source) {
        const out = [...list];
        for (let i = out.length - 1; i > 0; i--) {
            const j = randomInt(i + 1, source);
            [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
    }

    // ---------- Pool and events ----------

    // Locations available for random draws: active, not excluded, not already in
    // the calendar, with at least one active layout allowed in random draws.
    function randomPool(catalogue, { excluded = [], taken = [] } = {}) {
        const blocked = new Set([...excluded, ...taken]);
        const locations = (catalogue && catalogue.locations) || {};
        const groups = new Map();
        Object.entries((catalogue && catalogue.layouts) || {}).forEach(([id, layout]) => {
            if (!layout || layout.system || layout.active === false || layout.randomEligible === false) return;
            const location = locations[layout.locationId];
            if (!location || location.active === false || blocked.has(layout.locationId)) return;
            if (!groups.has(layout.locationId)) groups.set(layout.locationId, { locationId: layout.locationId, name: location.name, layouts: [] });
            groups.get(layout.locationId).layouts.push({ id, label: layout.name, imagePath: layout.imagePath || C.PLACEHOLDER_IMAGE });
        });
        return [...groups.values()].map(g => ({ ...g, layouts: g.layouts.sort((a, b) => a.id.localeCompare(b.id)) }))
            .sort((a, b) => a.locationId.localeCompare(b.locationId));
    }

    let eventCounter = 0;
    const eventId = prefix => `${prefix}${Date.now().toString(36)}${(eventCounter++).toString(36)}`;

    // Calendar events for the agreed driver choices (after duplicate resolution).
    function driverEvents(assignments, options) {
        return assignments.map(a => {
            const option = options[a.layoutId] || {};
            return { id: `d-${a.uid}`, layoutId: a.layoutId, label: option.label || a.layoutId, locationId: a.locationId, locationName: option.locationName || a.locationId,
                imagePath: option.imagePath || C.PLACEHOLDER_IMAGE, source: 'driver', uid: a.uid, keep: true, pinned: false };
        });
    }

    // Draws one location uniformly, then one of its layouts uniformly, so a
    // location with many layouts is no more likely than one with a single layout.
    function drawEvent(pool, source) {
        const index = randomInt(pool.length, source);
        const location = pool[index];
        const layout = location.layouts[randomInt(location.layouts.length, source)];
        pool.splice(index, 1);
        return { id: eventId('r-'), layoutId: layout.id, label: layout.label, locationId: location.locationId, locationName: location.name,
            imagePath: layout.imagePath, source: 'random', keep: false, pinned: false };
    }

    function usedLocations(events) { return events.map(e => e.locationId); }

    // How many random draws the target needs, and whether the pool can supply them.
    function shortfall(events, target, poolSize) {
        if (events.length > target) return { problem: 'too-many', message: `There are ${events.length} events but the target is ${target}. Raise the target or remove ${events.length - target}.` };
        const needed = target - events.length;
        if (needed > poolSize) return { problem: 'pool', needed, available: poolSize, message: `${needed} random tracks are needed but only ${poolSize} eligible locations are left. Lower the target by ${needed - poolSize} or allow more locations.` };
        return null;
    }

    // Full generation: keep driver choices, draw the rest, shuffle the whole order.
    function generate({ drivers, catalogue, excluded, target, source }) {
        const pool = randomPool(catalogue, { excluded, taken: usedLocations(drivers) });
        const problem = shortfall(drivers, target, pool.length);
        if (problem) return { problem, poolSnapshot: snapshot(pool) };
        const working = [...pool];
        const random = [];
        while (drivers.length + random.length < target) random.push(drawEvent(working, source));
        return { events: shuffle([...drivers, ...random], source), poolSnapshot: snapshot(pool) };
    }

    // Adds random events for empty spaces at the end; nothing else changes.
    function fillRemaining({ events, catalogue, excluded, target, source }) {
        const pool = randomPool(catalogue, { excluded, taken: usedLocations(events) });
        const problem = shortfall(events, target, pool.length);
        if (problem) return { problem, poolSnapshot: snapshot(pool) };
        const working = [...pool];
        const added = [];
        while (events.length + added.length < target) added.push(drawEvent(working, source));
        return { events: [...events, ...added], changed: added.map(e => e.id), poolSnapshot: snapshot(pool) };
    }

    // Replaces every random event that isn't kept, in place.
    function redraw({ events, catalogue, excluded, source }) {
        const fixed = events.filter(e => e.source === 'driver' || e.keep);
        const replace = events.filter(e => !(e.source === 'driver' || e.keep));
        const pool = randomPool(catalogue, { excluded, taken: usedLocations(fixed) });
        if (pool.length < replace.length) return { problem: { problem: 'pool', message: `Only ${pool.length} eligible locations for ${replace.length} random events.` }, poolSnapshot: snapshot(pool) };
        const working = [...pool];
        const out = events.map(e => (fixed.includes(e) ? e : { ...drawEvent(working, source), pinned: e.pinned, date: e.date }));
        return { events: out, changed: out.filter((e, i) => e !== events[i]).map(e => e.id), poolSnapshot: snapshot(pool) };
    }

    // Replaces one random event with a location not already in the calendar.
    function replaceOne({ events, index, catalogue, excluded, source }) {
        const target = events[index];
        if (!target || target.source === 'driver') return { problem: { message: 'Driver choices are never replaced at random.' } };
        const pool = randomPool(catalogue, { excluded, taken: usedLocations(events) });
        if (!pool.length) return { problem: { message: 'No other eligible locations are left.' } };
        const replacement = { ...drawEvent([...pool], source), pinned: target.pinned, keep: target.keep, date: target.date };
        const out = events.map((e, i) => (i === index ? replacement : e));
        return { events: out, changed: [replacement.id], poolSnapshot: snapshot(pool) };
    }

    // Shuffles every event that isn't pinned among the unpinned positions.
    function shuffleOrder({ events, source }) {
        const free = events.map((e, i) => (e.pinned ? null : i)).filter(i => i !== null);
        const shuffled = shuffle(free.map(i => events[i]), source);
        const out = [...events];
        free.forEach((position, k) => { out[position] = shuffled[k]; });
        return { events: out, changed: free.filter(i => out[i] !== events[i]).map(i => out[i].id) };
    }

    // Moves an event up or down one place; pinned events stay where they are.
    function move(events, index, direction) {
        const other = index + direction;
        if (other < 0 || other >= events.length || events[index].pinned || events[other].pinned) return null;
        const out = [...events];
        [out[index], out[other]] = [out[other], out[index]];
        return out;
    }

    // Brings driver choices up to date (e.g. after a replacement was recorded):
    // changed driver events are swapped in place, new ones are added at the end, and
    // random events at a location a driver now has are removed.
    function syncDrivers(events, drivers) {
        const byUid = new Map(drivers.map(d => [d.uid, d]));
        const driverLocations = new Set(drivers.map(d => d.locationId));
        const removed = [];
        const out = [];
        events.forEach(e => {
            if (e.source === 'driver') {
                const current = byUid.get(e.uid);
                if (current) { out.push({ ...current, pinned: e.pinned, date: e.date }); byUid.delete(e.uid); }
                else removed.push(e);
            } else if (driverLocations.has(e.locationId)) removed.push(e);
            else out.push(e);
        });
        const added = [...byUid.values()];
        return { events: [...out, ...added], removed, added };
    }

    function sameDrivers(events, drivers) {
        const key = list => list.filter(e => e.source === 'driver').map(e => `${e.uid}:${e.layoutId}`).sort().join('|');
        return key(events) === key(drivers);
    }

    // What explains each operation's effect before the admin confirms.
    function describeOperations(events, target) {
        const randomFree = events.filter(e => e.source === 'random' && !e.keep).length;
        const unpinned = events.filter(e => !e.pinned).length;
        return {
            fill: Math.max(0, target - events.length),
            redraw: randomFree,
            shuffle: unpinned
        };
    }

    // Problems that block finalising. Shared locations are only allowed where an
    // admin recorded an exception during duplicate resolution.
    function finaliseProblems({ events, target, unresolvedDuplicates = 0, exceptions = {} }) {
        const problems = [];
        if (unresolvedDuplicates > 0) problems.push(`${unresolvedDuplicates} driver track ${unresolvedDuplicates === 1 ? 'choice still needs' : 'choices still need'} a replacement or decision (Tracks tab).`);
        if (events.length !== target) problems.push(`The calendar has ${events.length} events but the target is ${target}.`);
        if (target < LIMITS.minEvents || target > LIMITS.maxEvents) problems.push(`The target must be ${LIMITS.minEvents}–${LIMITS.maxEvents} events.`);
        const seen = new Map();
        events.forEach(e => seen.set(e.locationId, (seen.get(e.locationId) || 0) + 1));
        seen.forEach((count, locationId) => {
            if (count > 1 && !exceptions[locationId]) {
                const name = events.find(e => e.locationId === locationId).locationName;
                problems.push(`${name} appears ${count} times.`);
            }
        });
        return problems;
    }

    function snapshot(pool) {
        return pool.map(location => ({ locationId: location.locationId, layouts: location.layouts.map(l => l.id) }));
    }

    // ---------- Summary exports ----------

    function calendarRows(summary) {
        return (summary.calendar || []).map((event, i) => ({ position: i + 1, ...event }));
    }

    function calendarCsv(summary) {
        const rows = [['round', 'track', 'location', 'chosen by', 'date']];
        calendarRows(summary).forEach(e => rows.push([e.position, e.label, e.locationName, e.source === 'driver' ? 'Driver choice' : 'Random draw', e.date || '']));
        return C.toCsv(rows);
    }

    const md = text => String(text == null ? '' : text).replace(/([\\`*_[\]#|<>])/g, '\\$1');

    function summaryMarkdown(summary) {
        const lines = [`# ${md(summary.title)}`, ''];
        if (summary.intro) lines.push(md(summary.intro), '');
        lines.push('## Car class', '', summary.winner ? `**${md(summary.winner.label)}**${summary.winner.explanation ? ` — ${md(summary.winner.explanation)}` : ''}` : 'Not decided.', '');
        lines.push('## Calendar', '');
        const rows = calendarRows(summary);
        if (rows.length) {
            lines.push('| Round | Track | Location | Chosen by | Date |', '|---|---|---|---|---|');
            rows.forEach(e => lines.push(`| ${e.position} | ${md(e.label)} | ${md(e.locationName)} | ${e.source === 'driver' ? 'Driver choice' : 'Random draw'} | ${md(e.date || '')} |`));
        } else lines.push('Not published.');
        lines.push('', '## Rule changes', '');
        const rules = summary.rules || [];
        if (rules.length) rules.forEach(r => lines.push(`- ${r.outcome === 'pass' ? 'Accepted' : r.outcome === 'fail' ? 'Rejected' : 'No decision'}: ${md(r.prompt)} (${md(r.label)})`));
        else lines.push('None.');
        if ((summary.rounds || []).length) {
            lines.push('', '## Voting rounds', '');
            summary.rounds.forEach(r => lines.push(`- ${md(r.title)}`));
        }
        return `${lines.join('\n')}\n`;
    }

    function summaryJson(summary) {
        return `${JSON.stringify({ schema: 1, ...summary }, null, 2)}\n`;
    }

    return {
        GENERATION_VERSION, LIMITS, cryptoSource, randomInt, shuffle, randomPool, driverEvents, generate, fillRemaining, redraw, replaceOne,
        shuffleOrder, move, describeOperations, syncDrivers, sameDrivers, finaliseProblems, shortfall, calendarCsv, summaryMarkdown, summaryJson
    };
});
