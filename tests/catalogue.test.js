const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const C = require('../catalogue.js');

// The real built-in list from tracks.js.
const source = readFileSync(path.join(__dirname, '../tracks.js'), 'utf8');
const bundled = Function(`${source.match(/const trackData = \[[\s\S]*?\n\];/)[0]} return trackData;`)();

function applyWrites(catalogue, writes) {
    const next = JSON.parse(JSON.stringify(catalogue));
    Object.entries(writes).forEach(([p, value]) => {
        const [group, id] = p.split('/');
        next[group] = next[group] || {};
        next[group][id] = value;
    });
    return next;
}

test('names match regardless of case, accents and spacing', () => {
    assert.equal(C.nameKey('  Nürburgring   GP '), 'nurburgring gp');
    assert.equal(C.slugify('Barcelona GP (No Chicane)'), 'barcelona-gp-no-chicane');
    assert.equal(C.slugify('1000km'), 't-1000km');
    assert.match(C.slugify('Spa-Francorchamps 2022'), C.ID_PATTERN);
});

test('seeding groups the built-in list, flags places to check, and keeps every image', () => {
    const proposal = C.proposeSeed(bundled, {});
    assert.deepEqual(proposal.system.map(t => t.name), ['TBD', 'Special Event']);
    const brands = proposal.groups.find(g => g.name === 'Brands Hatch');
    assert.deepEqual(brands.layouts.map(l => l.name), ['Brands Hatch', 'Brands Hatch Indy']);
    assert.equal(brands.flagged, false);
    const flagged = proposal.groups.filter(g => g.flagged).map(g => g.name);
    for (const name of ['Spa 2022', 'Spa 1993', 'Virginia North', 'Sebring Club', 'Le Mans']) assert.ok(flagged.includes(name), name);
    assert.ok(proposal.clusters.some(c => c.suggestedName === 'Spa'));
    assert.ok(proposal.clusters.some(c => c.suggestedName === 'Virginia'));

    const writes = C.seedWrites(proposal, {}, {}, { updatedBy: 'admin' });
    const catalogue = applyWrites({}, writes);
    assert.equal(Object.keys(catalogue.layouts).length, bundled.length);
    for (const track of bundled) {
        const found = C.resolveLayout(catalogue, C.buildLayoutIndex(catalogue), track.name);
        assert.equal(found.imagePath, track.imagePath, track.name);
        assert.equal(found.shortName, track.shortName, track.name);
    }
    const tbd = C.resolveLayout(catalogue, C.buildLayoutIndex(catalogue), 'TBD');
    assert.equal(tbd.system, true);
    assert.equal(tbd.randomEligible, false);
    assert.equal(tbd.locationId, undefined);
});

test('reviewed names merge groups into one location', () => {
    const proposal = C.proposeSeed(bundled, {});
    const names = {};
    proposal.groups.filter(g => g.name.startsWith('Spa ')).forEach(g => { names[g.key] = 'Spa-Francorchamps'; });
    const catalogue = applyWrites({}, C.seedWrites(proposal, names, {}, {}));
    const spa = Object.entries(catalogue.locations).filter(([, l]) => l.name === 'Spa-Francorchamps');
    assert.equal(spa.length, 1);
    const [spaId, spaLocation] = spa[0];
    assert.deepEqual(spaLocation.aliases.sort(), ['Spa 1970', 'Spa 1993', 'Spa 2022']);
    const layouts = Object.values(catalogue.layouts).filter(l => l.locationId === spaId);
    assert.equal(layouts.length, bundled.filter(t => t.shortName.startsWith('Spa ')).length);
});

test('running the seed again adds nothing, even after a rename', () => {
    const first = applyWrites({}, C.seedWrites(C.proposeSeed(bundled, {}), {}, {}, {}));
    const [id, layout] = Object.entries(first.layouts).find(([, l]) => l.name === 'Brands Hatch');
    first.layouts[id] = C.withRename(layout, { ...layout, name: 'Brands Hatch GP' });
    const again = C.proposeSeed(bundled, first);
    assert.ok(again.groups.every(g => g.complete));
    assert.deepEqual(C.seedWrites(again, {}, first, {}), {});
});

test('renaming keeps the old name as an alias so history still resolves', () => {
    const catalogue = { layouts: { bh: { name: 'Brands Hatch', imagePath: 'Logos_and_icons/racetracks/Brands_Hatch.png' } } };
    catalogue.layouts.bh = C.withRename(catalogue.layouts.bh, { ...catalogue.layouts.bh, name: 'Brands Hatch GP', active: false });
    assert.deepEqual(catalogue.layouts.bh.aliases, ['Brands Hatch']);
    const found = C.resolveLayout(catalogue, C.buildLayoutIndex(catalogue), 'brands hatch');
    assert.equal(found.imagePath, 'Logos_and_icons/racetracks/Brands_Hatch.png');
    assert.equal(C.trackList(catalogue).length, 0, 'archived layouts are not offered for new selections');
    assert.equal(C.trackList(catalogue, { includeArchived: true }).length, 1);
});

test('track list puts TBD and Special Event first and hides archived locations', () => {
    const catalogue = {
        locations: { a: { name: 'A' }, old: { name: 'Old', active: false } },
        layouts: {
            z: { name: 'Zandvoort', locationId: 'a' }, s: { name: 'Special Event', system: true },
            t: { name: 'TBD', system: true }, b: { name: 'Bygone', locationId: 'old' }
        }
    };
    assert.deepEqual(C.trackList(catalogue).map(t => t.name), ['TBD', 'Special Event', 'Zandvoort']);
    assert.equal(C.trackList(catalogue)[2].imagePath, C.PLACEHOLDER_IMAGE);
});

test('conflict check finds names and aliases used by another entry', () => {
    const group = { gt3: { name: 'GT3', aliases: ['GT3 Gen 1'] }, gt4: { name: 'GT4' } };
    assert.deepEqual(C.findConflicts(group, { name: 'gt3 gen 1' }, 'new').map(c => c.otherName), ['GT3']);
    assert.deepEqual(C.findConflicts(group, { name: 'GT3', aliases: ['GT3 Gen 1'] }, 'gt3'), []);
});

test('pasting one class per line previews adds, unchanged entries and duplicates', () => {
    const current = { gt3: { name: 'GT3', active: true, updatedAt: 1 } };
    const parsed = C.parseClassText('GT3\n\nGT4\n  Formula Junior  \ngt4', 'lines');
    const plan = C.planImport(current, parsed.records, parsed.errors);
    assert.deepEqual(plan.changes.map(c => `${c.action}:${c.after.name}`), ['unchanged:GT3', 'add:GT4', 'add:Formula Junior', 'add:gt4']);
    assert.ok(plan.errors.some(e => e.message.includes('more than once')));
});

test('class CSV import validates rows and detects updates and renames', () => {
    const current = { gt3: { name: 'GT3', active: true }, gt4: { name: 'GT4', active: true } };
    const csv = 'id,name,aliases,category,active,image_path\n'
        + 'gt3,GT3 Gen 2,GT3 2024,GT,yes,\n'
        + ',P2,,Prototype,maybe,\n'
        + 'Bad Id,X,,,,\n'
        + ',Group C,GT4,,yes,javascript:alert(1)\n';
    const parsed = C.parseClassText(csv, 'csv');
    const plan = C.planImport(current, parsed.records, parsed.errors);
    const gt3 = plan.changes.find(c => c.id === 'gt3');
    assert.equal(gt3.action, 'update');
    assert.deepEqual(gt3.after.aliases, ['GT3 2024', 'GT3']);
    const messages = plan.errors.map(e => `${e.line}: ${e.message}`);
    assert.ok(messages.some(m => m.startsWith('3: Active must be yes or no')));
    assert.ok(messages.some(m => m.startsWith('4: ID “Bad Id”')));
    assert.ok(messages.some(m => m.startsWith('5: Image path')));
    assert.ok(messages.some(m => m.startsWith('5: “GT4” is already used by “GT4”')));
    assert.ok(C.parseClassText('name\n"unclosed', 'csv').errors.length);
});

test('CSV export round-trips and defuses spreadsheet formulas', () => {
    assert.equal(C.csvCell('=SUM(A1)'), "'=SUM(A1)");
    assert.equal(C.csvCell('+44'), "'+44");
    assert.equal(C.csvCell('Say "hi", ok'), '"Say ""hi"", ok"');
    const catalogue = { classes: { gt3: { name: 'GT3', aliases: ['GT3 Gen 1', 'Gen1'], description: 'Line one\nline two', active: false } } };
    const rows = C.parseCsv(C.classesCsv(catalogue));
    assert.deepEqual(rows[1], ['gt3', 'GT3', 'GT3 Gen 1; Gen1', '', '', '', 'Line one\nline two', '', 'no']);
    const parsed = C.parseClassText(C.classesCsv(catalogue), 'csv');
    const plan = C.planImport(catalogue.classes, parsed.records, parsed.errors);
    assert.deepEqual(plan.errors, []);
    assert.equal(plan.changes[0].action, 'unchanged');
});

test('track CSV export and re-import is unchanged; new rows create locations', () => {
    const catalogue = applyWrites({}, C.seedWrites(C.proposeSeed(bundled.slice(0, 20), {}), {}, {}, {}));
    const csv = C.tracksCsv(catalogue);
    const same = C.planTrackImport(catalogue, csv);
    assert.deepEqual(same.layouts.errors, []);
    assert.ok(same.layouts.changes.every(c => c.action === 'unchanged'));
    assert.ok(same.locations.changes.every(c => c.action === 'unchanged'));

    const added = C.planTrackImport(catalogue, 'layout_name,location_name,short_name\nZolder GP,Zolder,Zolder\nZolder Club,Zolder,Zolder\nBrands Hatch Indy,Brands Hatch,Brands Hatch\n');
    assert.deepEqual(added.locations.changes.map(c => `${c.action}:${c.after.name}`), ['add:Zolder', 'unchanged:Brands Hatch']);
    const zolderId = added.locations.changes[0].id;
    assert.deepEqual(added.layouts.changes.map(c => `${c.action}:${c.after.locationId === zolderId}`), ['add:true', 'add:true', 'unchanged:false']);
});
