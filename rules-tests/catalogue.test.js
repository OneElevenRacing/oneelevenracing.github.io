// Realtime Database rules tests for the shared car-class and track catalogue.
const { describe, it, before, beforeEach, after } = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { ref, get, set, update, serverTimestamp } = require('firebase/database');
const C = require('../catalogue.js');

const CAT = 'seasonPlanning/v1/catalogue';
const trackSource = readFileSync(path.join(__dirname, '../tracks.js'), 'utf8');
const bundled = Function(`${trackSource.match(/const trackData = \[[\s\S]*?\n\];/)[0]} return trackData;`)();
let env;
const db = uid => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).database();

before(async () => {
    const [host, port] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000').split(':');
    env = await initializeTestEnvironment({
        projectId: 'demo-one-eleven-catalogue',
        database: { host, port: Number(port), rules: readFileSync(path.join(__dirname, '../database.rules.json'), 'utf8') }
    });
});

beforeEach(async () => {
    await env.clearDatabase();
    const driver = (name, extra = {}) => ({ active: true, isAdmin: false, name, carName: 'Car', carImage: 'car.png', ...extra });
    await env.withSecurityRulesDisabled(ctx => set(ref(ctx.database(), 'drivers'), {
        alice: driver('alice'), carol: driver('carol', { active: false }), admin: driver('admin', { isAdmin: true })
    }));
});

after(async () => { await env.cleanup(); });

const stamp = () => ({ updatedAt: serverTimestamp(), updatedBy: 'admin' });

describe('catalogue access', () => {
    it('active drivers read the catalogue; inactive and signed-out users cannot', async () => {
        await assertSucceeds(get(ref(db('alice'), CAT)));
        await assertFails(get(ref(db('carol'), CAT)));
        await assertFails(get(ref(db(null), CAT)));
        await assertFails(get(ref(db('alice'), 'seasonPlanning/v1')));
    });

    it('only admins can change it', async () => {
        const gt3 = { name: 'GT3', active: true, ...stamp() };
        await assertFails(set(ref(db('alice'), `${CAT}/classes/gt3`), gt3));
        await assertSucceeds(set(ref(db('admin'), `${CAT}/classes/gt3`), gt3));
    });
});

describe('catalogue validation', () => {
    it('accepts the full seeded built-in track list in one save', async () => {
        const writes = C.seedWrites(C.proposeSeed(bundled, {}), {}, {}, stamp());
        const updates = Object.fromEntries(Object.entries(writes).map(([p, v]) => [`${CAT}/${p}`, v]));
        await assertSucceeds(update(ref(db('admin')), updates));
        await assertSucceeds(get(ref(db('alice'), `${CAT}/layouts`)));
    });

    it('rejects bad IDs, unknown fields, unsafe image paths and missing names', async () => {
        const a = db('admin');
        await assertFails(set(ref(a, `${CAT}/classes/Bad Id`), { name: 'X', active: true }));
        await assertFails(set(ref(a, `${CAT}/classes/1gt`), { name: 'X', active: true }));
        await assertFails(set(ref(a, `${CAT}/classes/gt3`), { name: 'GT3', active: true, colour: 'red' }));
        await assertFails(set(ref(a, `${CAT}/classes/gt3`), { name: 'GT3', active: true, imagePath: 'javascript:alert(1)' }));
        await assertFails(set(ref(a, `${CAT}/classes/gt3`), { name: 'GT3', active: true, imagePath: 'Logos_and_icons/../x.png' }));
        await assertFails(set(ref(a, `${CAT}/classes/gt3`), { active: true }));
        await assertSucceeds(set(ref(a, `${CAT}/classes/gt3`), { name: 'GT3', active: true, aliases: ['GT3 Gen 1'], imagePath: 'Logos_and_icons/Car_Thumbnails/CJ.png' }));
    });

    it('layouts need an existing location unless they are system entries', async () => {
        const a = db('admin');
        await assertFails(set(ref(a, `${CAT}/layouts/zolder`), { name: 'Zolder', locationId: 'zolder', active: true }));
        await assertSucceeds(update(ref(a), {
            [`${CAT}/locations/zolder`]: { name: 'Zolder', active: true },
            [`${CAT}/layouts/zolder`]: { name: 'Zolder', shortName: 'Zolder', locationId: 'zolder', active: true, randomEligible: true }
        }));
        await assertSucceeds(set(ref(a, `${CAT}/layouts/tbd`), { name: 'TBD', active: true, system: true, randomEligible: false }));
    });
});
