const { test } = require('node:test');
const assert = require('node:assert/strict');
const K = require('../season-calendar.js');

// Deterministic "random" numbers for repeatable tests.
const scripted = values => { let i = 0; return () => values[i++ % values.length]; };

const catalogue = {
    locations: { a: { name: 'Anderstorp', active: true }, b: { name: 'Brands Hatch', active: true }, c: { name: 'Cadwell', active: true },
        d: { name: 'Donington', active: true }, old: { name: 'Old Ring', active: false } },
    layouts: {
        a1: { name: 'Anderstorp', locationId: 'a', active: true },
        b1: { name: 'Brands GP', locationId: 'b', active: true }, b2: { name: 'Brands Indy', locationId: 'b', active: true },
        b3: { name: 'Brands 1990', locationId: 'b', active: true }, b4: { name: 'Brands Club', locationId: 'b', active: false },
        c1: { name: 'Cadwell', locationId: 'c', active: true, randomEligible: false },
        d1: { name: 'Donington GP', locationId: 'd', active: true }, d2: { name: 'Donington National', locationId: 'd', active: true },
        o1: { name: 'Old Ring', locationId: 'old', active: true }, tbd: { name: 'TBD', system: true, active: true }
    }
};

test('random integers are unbiased: values from the incomplete top range are rejected', () => {
    assert.equal(K.randomInt(3, scripted([2 ** 32 - 1, 4])), 1);
    assert.equal(K.randomInt(1, scripted([123])), 0);
    assert.throws(() => K.randomInt(0, scripted([1])));
});

test('Fisher–Yates produces every order exactly once across all random choices', () => {
    const seen = new Set();
    for (let first = 0; first < 3; first++) for (let second = 0; second < 2; second++) {
        seen.add(K.shuffle(['x', 'y', 'z'], scripted([first, second])).join(''));
    }
    assert.equal(seen.size, 6);
});

test('the pool holds eligible locations only', () => {
    const pool = K.randomPool(catalogue, {});
    assert.deepEqual(pool.map(p => p.locationId), ['a', 'b', 'd'], 'Cadwell has no random-eligible layout; Old Ring is archived');
    assert.deepEqual(pool.find(p => p.locationId === 'b').layouts.map(l => l.id), ['b1', 'b2', 'b3']);
    assert.deepEqual(K.randomPool(catalogue, { excluded: ['a'], taken: ['d'] }).map(p => p.locationId), ['b']);
});

test('locations are equally likely however many layouts they have; layouts are uniform within', () => {
    const counts = {};
    for (let v = 0; v < 3; v++) {
        const result = K.generate({ drivers: [], catalogue, excluded: [], target: 1, source: scripted([v, 0, 0]) });
        counts[result.events[0].locationId] = (counts[result.events[0].locationId] || 0) + 1;
    }
    assert.deepEqual(counts, { a: 1, b: 1, d: 1 });
    const layouts = new Set();
    for (let w = 0; w < 3; w++) layouts.add(K.generate({ drivers: [], catalogue, excluded: [], target: 1, source: scripted([1, w, 0]) }).events[0].layoutId);
    assert.deepEqual([...layouts].sort(), ['b1', 'b2', 'b3']);
});

test('special rounds default to the middle and last race, and honour the admin’s choice', () => {
    assert.deepEqual(K.specialRounds(undefined, 10), [5, 10]);
    assert.deepEqual(K.specialRounds(undefined, 9), [5, 9]);
    assert.deepEqual(K.specialRounds(undefined, 1), [1]);
    assert.deepEqual(K.specialRounds(false, 10), [], 'false means the admin chose none');
    assert.deepEqual(K.specialRounds([8, 3, 12], 10), [3, 8], 'sorted, and rounds past the end are dropped');
});

const options = { b2: { label: 'Brands Indy', locationId: 'b', locationName: 'Brands Hatch' } };
const drivers = K.driverEvents([{ uid: 'sam', layoutId: 'b2', locationId: 'b' }], options);

test('generation keeps driver choices, draws without replacement and never repeats a location', () => {
    const result = K.generate({ drivers, catalogue, excluded: [], target: 3, source: scripted([0, 0, 0, 1, 0]) });
    assert.equal(result.events.length, 3);
    assert.ok(result.events.some(e => e.source === 'driver' && e.uid === 'sam'));
    assert.equal(new Set(result.events.map(e => e.locationId)).size, 3);
    assert.ok(!result.events.some(e => e.source === 'random' && e.locationId === 'b'), 'a location already chosen by a driver is not drawn');
    assert.deepEqual(result.poolSnapshot.map(p => p.locationId), ['a', 'd']);
});

test('shortfalls are explained instead of producing an invalid calendar', () => {
    const tooFew = K.generate({ drivers, catalogue, excluded: [], target: 5, source: scripted([0]) });
    assert.equal(tooFew.problem.problem, 'pool');
    assert.match(tooFew.problem.message, /4 random tracks are needed but only 2 eligible locations are left\. Lower the target by 2/);
    const tooMany = K.generate({ drivers: [...drivers, { ...drivers[0], id: 'x', uid: 'kim', locationId: 'd' }], catalogue, excluded: [], target: 1, source: scripted([0]) });
    assert.equal(tooMany.problem.problem, 'too-many');
});

test('redraw and replace respect kept events and driver choices; shuffle respects pinned positions', () => {
    const start = [
        { ...drivers[0], pinned: true },
        { id: 'r1', source: 'random', locationId: 'a', layoutId: 'a1', keep: true, pinned: false },
        { id: 'r2', source: 'random', locationId: 'd', layoutId: 'd1', keep: false, pinned: false, date: '2027-01-08' }
    ];
    const redrawn = K.redraw({ events: start, catalogue: { ...catalogue, locations: { ...catalogue.locations, e: { name: 'Estoril', active: true } }, layouts: { ...catalogue.layouts, e1: { name: 'Estoril', locationId: 'e', active: true } } }, excluded: [], source: scripted([0, 0]) });
    assert.equal(redrawn.events[0], start[0]);
    assert.equal(redrawn.events[1], start[1]);
    assert.notEqual(redrawn.events[2].locationId, 'a');
    assert.equal(redrawn.events[2].date, '2027-01-08', 'dates stay with the position');
    assert.equal(K.replaceOne({ events: start, index: 0, catalogue, excluded: [], source: scripted([0]) }).problem.message, 'Driver choices are never replaced at random.');
    for (let v = 0; v < 2; v++) {
        const shuffled = K.shuffleOrder({ events: start, source: scripted([v]) }).events;
        assert.equal(shuffled[0], start[0], 'pinned first event stays first');
    }
    assert.equal(K.move(start, 1, -1), null, 'cannot swap with a pinned event');
    assert.deepEqual(K.move(start, 1, 1).map(e => e.id), ['d-sam', 'r2', 'r1']);
});

test('fill adds only the missing events and says how many', () => {
    const result = K.fillRemaining({ events: drivers, catalogue, excluded: [], target: 2, source: scripted([0, 0]) });
    assert.equal(result.events.length, 2);
    assert.equal(result.changed.length, 1);
    assert.equal(result.events[0], drivers[0]);
    assert.deepEqual(K.describeOperations(result.events, 3), { fill: 1, redraw: 1, shuffle: 2 });
});

test('finalising is blocked by unresolved duplicates, wrong counts and repeated locations', () => {
    const events = [{ locationId: 'b', locationName: 'Brands Hatch' }, { locationId: 'b', locationName: 'Brands Hatch' }];
    assert.deepEqual(K.finaliseProblems({ events, target: 3, unresolvedDuplicates: 1 }), [
        '1 driver track choice still needs a replacement or decision (track picks step).',
        'The calendar has 2 events but the target is 3.',
        'Brands Hatch appears 2 times.'
    ]);
    assert.deepEqual(K.finaliseProblems({ events, target: 2, exceptions: { b: 'Agreed' } }), []);
});

test('updating driver choices swaps changed ones and removes clashing random events', () => {
    const events = [
        { id: 'd-alex', source: 'driver', uid: 'alex', layoutId: 'b1', locationId: 'b', pinned: true, date: '2027-01-01' },
        { id: 'r1', source: 'random', layoutId: 'd1', locationId: 'd' },
        { id: 'r2', source: 'random', layoutId: 'a1', locationId: 'a' }
    ];
    const now = K.driverEvents([{ uid: 'alex', layoutId: 'd2', locationId: 'd' }, { uid: 'sam', layoutId: 'b2', locationId: 'b' }],
        { d2: { label: 'Donington National', locationId: 'd' }, b2: { label: 'Brands Indy', locationId: 'b' } });
    assert.equal(K.sameDrivers(events, now), false);
    const result = K.syncDrivers(events, now);
    assert.deepEqual(result.events.map(e => e.id), ['d-alex', 'r2', 'd-sam']);
    assert.equal(result.events[0].layoutId, 'd2');
    assert.equal(result.events[0].date, '2027-01-01');
    assert.deepEqual(result.removed.map(e => e.id), ['r1']);
    assert.equal(K.sameDrivers(result.events, now), true);
});

test('finalising is blocked while driver choices are out of date', () => {
    const events = [{ locationId: 'b', locationName: 'Brands Hatch' }];
    assert.deepEqual(K.finaliseProblems({ events, target: 1, driversChanged: true }), ['Driver track choices have changed since this version. Update driver choices first.']);
});

const eventAt = (id, source, extra = {}) => ({ id, label: id, locationId: id, locationName: id, source, ...extra });

test('with driver-chosen tracks only, every special round gets a driver choice whatever the draw', () => {
    const picks = K.driverEvents([{ uid: 'sam', layoutId: 'b2', locationId: 'b' }, { uid: 'ian', layoutId: 'c1', locationId: 'c' }],
        { ...options, c1: { label: 'Cadwell', locationId: 'c', locationName: 'Cadwell' } });
    for (let seed = 0; seed < 12; seed++) {
        const { events } = K.generate({ drivers: picks, catalogue, excluded: [], target: 4, special: [2, 4], driverOnly: true, source: scripted([seed, seed + 1, seed + 2]) });
        assert.equal(events.length, 4);
        assert.equal(events[1].source, 'driver');
        assert.equal(events[3].source, 'driver');
    }
});

test('without the option, special rounds don’t change the draw', () => {
    const source = () => scripted([1, 0, 2, 1]);
    const plain = K.generate({ drivers, catalogue, excluded: [], target: 3, source: source() });
    const marked = K.generate({ drivers, catalogue, excluded: [], target: 3, special: [2, 3], source: source() });
    assert.deepEqual(marked.events.map(e => e.locationId), plain.events.map(e => e.locationId));
});

test('too few driver choices for the special rounds is explained, not half-done', () => {
    const result = K.generate({ drivers, catalogue, excluded: [], target: 3, special: [1, 3], driverOnly: true, source: scripted([0]) });
    assert.equal(result.problem.problem, 'special');
    assert.equal(result.events, undefined);
});

test('moving driver choices onto special rounds leaves pinned events alone', () => {
    const events = [eventAt('d1', 'driver', { pinned: true }), eventAt('r1', 'random'), eventAt('d2', 'driver'), eventAt('r2', 'random', { pinned: true })];
    const out = K.driversOnSpecial(events, [2, 4], scripted([0]));
    assert.deepEqual(out.map(e => e.id), ['d1', 'd2', 'r1', 'r2'], 'round 4 is pinned, so it stays; d1 is pinned, so it can’t move');
});

test('finalising is blocked while a special round isn’t a driver choice, only when that’s required', () => {
    const events = [eventAt('Monza', 'random'), eventAt('Spa', 'driver', { uid: 'sam' })];
    const base = { events, target: 2, special: [1, 2] };
    assert.deepEqual(K.finaliseProblems(base), []);
    assert.deepEqual(K.finaliseProblems({ ...base, driverOnly: true }), ['Round 1 is a special event but Monza isn’t a driver choice.']);
});
