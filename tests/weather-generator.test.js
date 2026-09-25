const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../weatherGenerator.js'), 'utf8');

function makeElement() {
  return {
    disabled: false,
    title: '',
    textContent: '',
    listeners: {},
    addEventListener(name, callback) { this.listeners[name] = callback; },
    classList: { add() {}, remove() {} }
  };
}

function setup(values = {}) {
  const elements = {
    generateRandomWeather: makeElement(),
    generateRaceWeather: makeElement(),
    weather1: makeElement(),
    weather2: makeElement(),
    weatherMessage: makeElement()
  };
  const data = { race_date: '', weather1: 'TBD', weather2: 'TBD', ...values };
  const updates = [];
  const subscriptions = {};
  const database = {
    ref(pathName) {
      return {
        once: async () => ({ val: () => data[pathName] }),
        on(_event, callback) {
          subscriptions[pathName] = callback;
          callback({ val: () => data[pathName] });
        },
        off() { delete subscriptions[pathName]; },
        async transaction(updateFn) {
          const next = updateFn(data[pathName]);
          if (next === undefined) return { committed: false, snapshot: { val: () => data[pathName] } };
          updates.push({ [pathName]: next });
          data[pathName] = next;
          return { committed: true, snapshot: { val: () => next } };
        }
      };
    }
  };
  const context = vm.createContext({
    console: { log() {}, error() {} },
    Intl,
    Date,
    Math,
    Promise,
    confirm: () => true,
    firebase: { database: () => database, auth: () => ({ onAuthStateChanged() {} }) },
    document: {
      addEventListener() {},
      getElementById: id => elements[id] || null,
      body: { appendChild() {}, removeChild() {} },
      createElement: () => makeElement()
    },
    window: {}
  });
  vm.runInContext(source, context);
  return {
    context,
    elements,
    data,
    updates,
    emit(pathName, value) {
      data[pathName] = value;
      subscriptions[pathName]?.({ val: () => value });
    }
  };
}

test('race date comparison accepts the poll year and legacy yearless dates', () => {
  const { context: c } = setup();
  const raceDay = new Date('2026-09-22T12:00:00Z');
  assert.equal(c.getUkDateKey(raceDay), '2026-09-22');
  assert.equal(c.formatDate(raceDay), 'Tue, 22nd Sep 2026');
  assert.equal(c.raceDateTextMatches('Tue, 22nd Sep 2026', raceDay), true);
  assert.equal(c.raceDateTextMatches('Tue, 22nd Sep', raceDay), true);
  assert.equal(c.raceDateTextMatches('Tue 22nd sep 2026', raceDay), true);
  assert.equal(c.raceDateTextMatches('Tue, 22nd Sep 2025', raceDay), false);
  assert.equal(c.raceDateTextToKey('31st Feb 2026', '2026-02-01'), '');
  assert.equal(c.raceDateTextToKey('TBD', '2026-09-22'), '');
});

test('today follows the UK date even when UTC is still on the previous day', () => {
  const { context: c } = setup();
  assert.equal(c.getUkDateKey(new Date('2026-06-30T23:30:00Z')), '2026-07-01');
  assert.equal(c.getUkDateKey(new Date('2026-12-31T23:30:00Z')), '2026-12-31');
});

test('live database changes immediately update whether race weather can be generated', () => {
  const state = setup();
  const today = state.context.formatDate(new Date());
  vm.runInContext('currentUserIsActiveDriver = true', state.context);
  state.data.race_date = today;
  state.context.startLiveWeatherStatus();
  assert.equal(state.elements.generateRaceWeather.disabled, false);

  state.emit('weather1', 'Clear');
  state.emit('weather2', 'Rain');
  assert.equal(state.elements.generateRaceWeather.disabled, true);
  assert.equal(state.elements.generateRaceWeather.title, 'Race weather has already been generated.');

  state.emit('weather2', 'TBD');
  assert.equal(state.elements.generateRaceWeather.disabled, false);
  state.emit('race_date', 'Thu, 1st Jan 2099');
  assert.equal(state.elements.generateRaceWeather.disabled, true);
  assert.equal(state.elements.generateRaceWeather.title, 'Race-day weather can only be generated on the race date.');
});

test('generation rechecks the date and fills only missing weather slots', async () => {
  const state = setup({ weather1: 'Clear', weather2: 'TBD' });
  state.data.race_date = state.context.formatDate(new Date());
  vm.runInContext('currentUserIsActiveDriver = true; raceDateMatchesToday = true', state.context);
  state.context.setupButtonEventListeners();
  await state.elements.generateRaceWeather.listeners.click();

  assert.equal(state.updates.length, 1);
  assert.deepEqual(Object.keys(state.updates[0]), ['weather2']);
  assert.equal(state.elements.weather1.textContent, 'Clear');
  assert.notEqual(state.elements.weather2.textContent, 'TBD');
  assert.match(state.elements.weatherMessage.textContent, /Race weathers generated/);
});

test('a stale enabled button cannot generate weather after the race date changes', async () => {
  const state = setup({ race_date: 'Thu, 1st Jan 2099' });
  vm.runInContext('currentUserIsActiveDriver = true; raceDateMatchesToday = true', state.context);
  state.context.setupButtonEventListeners();
  await state.elements.generateRaceWeather.listeners.click();

  assert.equal(state.updates.length, 0);
  assert.equal(state.elements.weatherMessage.textContent, 'Race-day weather can only be generated on the race date.');
});

test('a slot generated by another driver at the same moment is not overwritten', async () => {
  const state = setup({ weather1: 'TBD', weather2: 'TBD' });
  state.data.race_date = state.context.formatDate(new Date());
  vm.runInContext('currentUserIsActiveDriver = true; raceDateMatchesToday = true', state.context);
  state.context.setupButtonEventListeners();
  // Another driver saves both slots after this page's check but before its write.
  state.context.confirm = () => {
    state.data.weather1 = 'Storm';
    state.data.weather2 = 'Fog';
    return true;
  };
  await state.elements.generateRaceWeather.listeners.click();

  assert.equal(state.updates.length, 0);
  assert.equal(state.elements.weather1.textContent, 'Storm');
  assert.equal(state.elements.weather2.textContent, 'Fog');
  assert.equal(state.elements.weatherMessage.textContent, 'Race weather has already been generated by another driver.');
});
