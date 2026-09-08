const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname, '../race-track.js'), 'utf8');

function setup(initialSeason) {
    const events = {};
    const elements = { raceLocation: {}, raceTrackImage: {} };
    let season = initialSeason;
    let onSeason;
    let onFailure;
    let onFallback;
    let transactionFailure = false;
    const ref = {};
    const doc = () => ({ id: 'season1', ref, exists: true, data: () => season });
    const notify = () => onSeason({ empty: !season, docs: season ? [doc()] : [] });
    const context = {
        window: {}, console: { error() {} },
        trackData: [{ name: 'Monza', imagePath: 'monza.png' }, { name: 'Imola', imagePath: 'imola.png' }],
        document: { addEventListener: (name, fn) => { events[name] = fn; }, getElementById: id => elements[id] },
        firebase: {
            database: () => ({ ref: () => ({
                on: (_event, callback) => { onFallback = callback; callback({ val: () => 'Old manual track' }); },
                set: async value => onFallback({ val: () => value })
            }) }),
            firestore: () => ({
                collection: () => ({ where() { return this; }, limit() { return this; },
                    onSnapshot(callback, failure) { onSeason = callback; onFailure = failure; notify(); }
                }),
                runTransaction: async callback => {
                    if (transactionFailure) throw new Error('Permission denied');
                    let patch;
                    const result = await callback({ get: async () => doc(), update: (_ref, value) => { patch = value; } });
                    season = { ...season, ...patch };
                    notify();
                    return result;
                }
            })
        }
    };
    vm.runInNewContext(source, context);
    events['oneEleven:activeDriver']();
    return { api: context.window.oneElevenRaceTrack, elements,
        change: value => { season = value; notify(); },
        deactivate: () => { season = { ...season, isActive: false }; },
        fail: () => onFailure(new Error('Offline')),
        denyWrite: () => { transactionFailure = true; }
    };
}

const season = () => ({ isActive: true, races: {
    race1: { trackName: 'Monza' }, race2: { trackName: 'Imola' }
} });

test('automatic starts at first event and ignores the legacy manually saved track', () => {
    const { elements } = setup(season());
    assert.equal(elements.raceLocation.textContent, 'Monza');
    assert.equal(elements.raceTrackImage.src, 'monza.png');
});

test('results advance both name and image; finishing the season shows TBD', () => {
    const state = setup(season());
    const updated = season();
    updated.races.race1.resultsRace1 = { driver: 1 };
    state.change(updated);
    assert.equal(state.elements.raceLocation.textContent, 'Imola');
    assert.equal(state.elements.raceTrackImage.src, 'imola.png');
    updated.races.race2.resultsRace2 = { driver: 'DNF' };
    state.change(updated);
    assert.equal(state.elements.raceLocation.textContent, 'TBD');
});

test('numeric event ordering and progression past the latest result, including gaps', () => {
    const { api } = setup(season());
    const races = { race10: { trackName: 'Imola' }, race2: { trackName: 'Monza', resultsRace1: { d: 0 } }, race1: {} };
    assert.equal(api.nextTrack({ races }), 'Imola');
    assert.equal(api.nextTrack({ races: {} }), 'TBD');
    assert.equal(api.nextTrack({ races: { race1: {} } }), 'TBD');
});

test('empty result maps do not advance; participation and bonuses match championship completion rules', () => {
    const { api } = setup(season());
    for (const recorded of [{ participantsRace1: [] }, { participantsRace2: [] },
        { polePositionDriver: 'd' }, { fastestLapOffPodiumDriverR2: 'd' }]) {
        const value = season();
        Object.assign(value.races.race1, recorded);
        assert.equal(api.nextTrack(value), 'Imola');
    }
    const empty = season();
    empty.races.race1.resultsRace1 = {};
    assert.equal(api.nextTrack(empty), 'Monza');
});

test('manual override persists through results, automatic resumes, and new seasons default to automatic', async () => {
    const state = setup(season());
    await state.api.save('manual', 'Imola');
    assert.equal(state.elements.raceLocation.textContent, 'Imola');
    state.change({ ...season(), homepageTrackOverride: 'Imola' });
    assert.equal(state.elements.raceLocation.textContent, 'Imola');
    await state.api.save('auto', 'Imola');
    assert.equal(state.elements.raceLocation.textContent, 'Monza');
    await state.api.save('manual', 'TBD');
    assert.equal(state.elements.raceLocation.textContent, 'TBD');
    state.change(season());
    assert.equal(state.elements.raceLocation.textContent, 'Monza');
});

test('no active season uses and can save the legacy manual track', async () => {
    const state = setup(null);
    assert.equal(state.elements.raceLocation.textContent, 'Old manual track');
    await state.api.save('manual', 'Imola');
    assert.equal(state.elements.raceLocation.textContent, 'Imola');
});

test('unknown track names retain their label and use the placeholder image', async () => {
    const state = setup(season());
    await state.api.save('manual', 'New circuit');
    assert.equal(state.elements.raceLocation.textContent, 'New circuit');
    assert.equal(state.elements.raceTrackImage.src, 'Logos_and_icons/racetracks/TBD.png');
});

test('read failures block writes and transaction failures do not pretend to save', async () => {
    const state = setup(season());
    state.denyWrite();
    await assert.rejects(state.api.save('manual', 'Imola'), /Permission denied/);
    assert.equal(state.elements.raceLocation.textContent, 'Monza');
    state.fail();
    await assert.rejects(state.api.save('manual', 'Imola'), /still loading/);
});

test('a season deactivated while the admin form was open rejects the override', async () => {
    const state = setup(season());
    state.deactivate();
    await assert.rejects(state.api.save('manual', 'Imola'), /active season has changed/);
});
