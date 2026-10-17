// Shared car-class and track catalogue logic: IDs, name/alias matching, imports,
// exports and seeding from the built-in track list. No Firebase or page code here,
// so it works in the browser (window.OneElevenCatalogue) and in Node tests.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.OneElevenCatalogue = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
    const IMAGE_PATTERN = /^Logos_and_icons\/[A-Za-z0-9_ ().\/-]+\.(png|jpe?g|webp|gif)$/i;
    const PLACEHOLDER_IMAGE = 'Logos_and_icons/racetracks/TBD.png';
    const SYSTEM_TRACKS = ['TBD', 'Special Event'];
    const LIMITS = { name: 120, shortName: 80, alias: 120, aliases: 30, tag: 80, description: 1000, imagePath: 250 };

    // Lower-case, accent-free, single-spaced form used for all name comparisons,
    // so "Nürburgring" and "nurburgring " match.
    function nameKey(text) {
        return String(text == null ? '' : text)
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            // Control characters (invisible, and not allowed in database keys) never count.
            .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
            .toLowerCase().replace(/\s+/g, ' ').trim();
    }

    // A short code that is always a valid database key, for storing something keyed by
    // free text (written suggestions, saved track names). Keep the text itself in the
    // stored value; the code is two 32-bit FNV-1a hashes, so clashes are vanishingly rare.
    function storageKey(text, prefix = 'k') {
        const value = String(text);
        const hash = (seed, input) => {
            let h = seed;
            for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619); }
            return (h >>> 0).toString(16).padStart(8, '0');
        };
        return `${prefix}${hash(2166136261, value)}${hash(2166136261, [...value].reverse().join('') + value.length)}`;
    }

    function slugify(text) {
        const slug = nameKey(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56);
        return /^[a-z]/.test(slug) ? slug : `t-${slug || 'item'}`;
    }

    function uniqueId(base, taken) {
        let id = slugify(base);
        for (let n = 2; taken.has(id); n++) id = `${slugify(base)}-${n}`;
        taken.add(id);
        return id;
    }

    // Accepts "a; b" text or an array; returns tidy unique aliases.
    function parseAliases(value) {
        const list = Array.isArray(value) ? value : String(value || '').split(/[;\n|]/);
        const seen = new Set();
        return list.map(item => String(item).replace(/\s+/g, ' ').trim()).filter(item => {
            const key = nameKey(item);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    // Firebase returns small numbered objects as arrays; always give an array back.
    const aliasList = entity => (entity && entity.aliases ? Object.values(entity.aliases) : []);
    const entries = group => Object.entries(group || {});
    const namesOf = entity => [entity.name, ...aliasList(entity)].filter(Boolean);

    // Renaming keeps the old name as an alias, so saved championship names still resolve.
    function withRename(before, after) {
        if (!before || nameKey(before.name) === nameKey(after.name)) return after;
        const aliases = parseAliases([...aliasList(after), before.name])
            .filter(alias => nameKey(alias) !== nameKey(after.name));
        return { ...after, aliases };
    }

    // Names/aliases of `entity` that clash with a different entry of the same kind.
    function findConflicts(group, entity, ownId) {
        const conflicts = [];
        const own = new Map(namesOf(entity).map(name => [nameKey(name), name]));
        entries(group).forEach(([id, other]) => {
            if (id === ownId) return;
            namesOf(other).forEach(name => {
                if (own.has(nameKey(name))) conflicts.push({ name: own.get(nameKey(name)), id, otherName: other.name });
            });
        });
        return conflicts;
    }

    function validateImagePath(path) {
        return !path || (path.length <= LIMITS.imagePath && IMAGE_PATTERN.test(path) && !path.includes('..'));
    }

    // ---------- Track lookups used by the existing pages ----------

    // Index of layout names and aliases (including archived layouts, so old
    // championships still resolve).
    function buildLayoutIndex(catalogue) {
        const index = new Map();
        entries(catalogue && catalogue.layouts).forEach(([id, layout]) => {
            namesOf(layout).forEach(name => {
                const key = nameKey(name);
                if (!index.has(key)) index.set(key, id);
            });
        });
        return index;
    }

    function resolveLayout(catalogue, index, name) {
        const id = index.get(nameKey(name));
        if (!id) return null;
        const layout = catalogue.layouts[id];
        const location = layout.locationId && catalogue.locations ? catalogue.locations[layout.locationId] : null;
        return { id, ...layout, location: location ? { id: layout.locationId, ...location } : null };
    }

    // Track list in the shape the existing pages expect: { name, shortName, imagePath }.
    // TBD and Special Event come first, then active layouts alphabetically.
    function trackList(catalogue, { includeArchived = false } = {}) {
        const locations = (catalogue && catalogue.locations) || {};
        const list = entries(catalogue && catalogue.layouts)
            .filter(([, layout]) => includeArchived || (layout.active !== false
                && (layout.system || !locations[layout.locationId] || locations[layout.locationId].active !== false)))
            .map(([id, layout]) => ({
                id,
                name: layout.name,
                shortName: layout.shortName || (locations[layout.locationId] || {}).name || layout.name,
                imagePath: layout.imagePath || PLACEHOLDER_IMAGE,
                locationId: layout.locationId || null,
                system: layout.system === true,
                active: layout.active !== false
            }));
        const systemOrder = name => {
            const i = SYSTEM_TRACKS.indexOf(name);
            return i === -1 ? SYSTEM_TRACKS.length : i;
        };
        return list.sort((a, b) => (Number(b.system) - Number(a.system)) || (systemOrder(a.name) - systemOrder(b.name))
            || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    }

    // ---------- Seeding from the built-in tracks.js list ----------

    // Groups the built-in list into proposed locations using short names, and flags
    // groups an admin should check (names that do not contain the short name, or
    // several groups that look like the same place).
    function proposeSeed(bundled, catalogue) {
        const index = buildLayoutIndex(catalogue);
        const groups = new Map();
        const system = [];
        bundled.forEach(track => {
            const existingId = index.get(nameKey(track.name)) || null;
            const layout = { ...track, existingId };
            if (SYSTEM_TRACKS.includes(track.name)) {
                system.push(layout);
                return;
            }
            const key = nameKey(track.shortName || track.name);
            if (!groups.has(key)) groups.set(key, { key, name: track.shortName || track.name, layouts: [], reasons: [] });
            groups.get(key).layouts.push(layout);
        });
        const list = [...groups.values()];
        list.forEach(group => {
            const mismatched = group.layouts.filter(layout => !nameKey(layout.name).includes(group.key));
            if (mismatched.length) group.reasons.push(`Layout names don't contain “${group.name}”: ${mismatched.map(l => l.name).join(', ')}`);
        });
        const byFirstWord = new Map();
        list.forEach(group => {
            const word = group.key.split(' ')[0];
            if (!byFirstWord.has(word)) byFirstWord.set(word, []);
            byFirstWord.get(word).push(group);
        });
        const clusters = [];
        byFirstWord.forEach(similar => {
            if (similar.length < 2) return;
            const names = similar.map(group => group.name);
            similar.forEach(group => group.reasons.push(`May be the same place as: ${names.filter(n => n !== group.name).join(', ')}`));
            clusters.push({ keys: similar.map(group => group.key), suggestedName: commonPrefix(names) });
        });
        list.forEach(group => {
            group.flagged = group.reasons.length > 0;
            group.complete = group.layouts.every(layout => layout.existingId);
        });
        list.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
        return { groups: list, system, clusters };
    }

    function commonPrefix(names) {
        const words = names.map(name => name.split(/\s+/));
        const prefix = [];
        for (let i = 0; words.every(w => i < w.length && nameKey(w[i]) === nameKey(words[0][i])); i++) prefix.push(words[0][i]);
        return prefix.join(' ') || names[0];
    }

    // Catalogue writes for a reviewed seed proposal. `locationNames` maps a group key
    // to the admin's chosen location name; groups given the same name are merged.
    // Only missing entries are written, so running it again adds nothing.
    function seedWrites(proposal, locationNames, catalogue, stamp) {
        const locations = (catalogue && catalogue.locations) || {};
        const layouts = (catalogue && catalogue.layouts) || {};
        const writes = {};
        const takenLocations = new Set(Object.keys(locations));
        const takenLayouts = new Set(Object.keys(layouts));
        const locationByName = new Map();
        entries(locations).forEach(([id, location]) => namesOf(location).forEach(name => {
            if (!locationByName.has(nameKey(name))) locationByName.set(nameKey(name), id);
        }));
        const addLayout = (track, locationId, system) => {
            if (track.existingId) return;
            const id = uniqueId(track.name, takenLayouts);
            writes[`layouts/${id}`] = {
                name: track.name,
                shortName: track.shortName || track.name,
                ...(locationId ? { locationId } : {}),
                imagePath: validateImagePath(track.imagePath) ? track.imagePath : '',
                active: true,
                randomEligible: !system,
                system,
                ...stamp
            };
        };
        proposal.system.forEach(track => addLayout(track, null, true));
        proposal.groups.forEach(group => {
            if (group.complete) return;
            const name = String((locationNames && locationNames[group.key]) || group.name).trim() || group.name;
            let locationId = locationByName.get(nameKey(name));
            if (!locationId) {
                locationId = uniqueId(name, takenLocations);
                locationByName.set(nameKey(name), locationId);
                const aliases = nameKey(name) === group.key ? [] : [group.name];
                writes[`locations/${locationId}`] = { name, ...(aliases.length ? { aliases } : {}), active: true, ...stamp };
            } else if (writes[`locations/${locationId}`] && nameKey(name) !== group.key) {
                const location = writes[`locations/${locationId}`];
                location.aliases = parseAliases([...(location.aliases || []), group.name]);
            }
            group.layouts.forEach(track => addLayout(track, locationId, false));
        });
        return writes;
    }

    // ---------- CSV ----------

    function parseCsv(text) {
        const rows = [];
        let row = [];
        let cell = '';
        let quoted = false;
        const input = String(text || '').replace(/^﻿/, '');
        for (let i = 0; i < input.length; i++) {
            const ch = input[i];
            if (quoted) {
                if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; }
                else if (ch === '"') quoted = false;
                else cell += ch;
            } else if (ch === '"' && cell === '') quoted = true;
            else if (ch === ',') { row.push(cell); cell = ''; }
            else if (ch === '\n' || ch === '\r') {
                if (ch === '\r' && input[i + 1] === '\n') i++;
                row.push(cell); rows.push(row); row = []; cell = '';
            } else cell += ch;
        }
        if (quoted) throw new Error('A quoted value is missing its closing quote.');
        if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
        return rows.filter(r => r.some(value => value.trim() !== ''));
    }

    // Spreadsheet apps run cells starting with = + - @ as formulas; prefix them.
    function csvCell(value) {
        let text = value == null ? '' : String(value);
        if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
        return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    const toCsv = rows => rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';

    function parseBoolean(value, fallback) {
        const key = nameKey(value);
        if (!key) return fallback;
        if (['yes', 'true', '1', 'y', 'active'].includes(key)) return true;
        if (['no', 'false', '0', 'n', 'archived'].includes(key)) return false;
        return null;
    }

    // Reads a CSV with a header row into objects keyed by lower-case header.
    function csvRecords(text, required) {
        const rows = parseCsv(text);
        if (!rows.length) return { records: [], errors: [{ line: 1, message: 'The file is empty.' }] };
        const headers = rows[0].map(h => nameKey(h).replace(/ /g, '_'));
        const missing = required.filter(h => !headers.includes(h));
        if (missing.length) return { records: [], errors: [{ line: 1, message: `Missing column: ${missing.join(', ')}` }] };
        const records = rows.slice(1).map((row, i) => {
            const record = { line: i + 2 };
            headers.forEach((h, c) => { record[h] = (row[c] || '').trim(); });
            return record;
        });
        return { records, errors: [] };
    }

    // ---------- Car classes ----------

    const CLASS_COLUMNS = ['id', 'name', 'aliases', 'category', 'era', 'dlc', 'description', 'image_path', 'active'];

    function classFromRecord(record, errors) {
        const fail = message => errors.push({ line: record.line, message });
        const name = (record.name || '').replace(/\s+/g, ' ').trim();
        if (!name) fail('Name is missing.');
        else if (name.length > LIMITS.name) fail(`Name is longer than ${LIMITS.name} characters.`);
        if (record.id && !ID_PATTERN.test(record.id)) fail(`ID “${record.id}” must start with a letter and use only a-z, 0-9, - and _.`);
        const active = parseBoolean(record.active, true);
        if (active === null) fail(`Active must be yes or no, not “${record.active}”.`);
        const imagePath = record.image_path || '';
        if (!validateImagePath(imagePath)) fail('Image path must be an image inside Logos_and_icons/.');
        const aliases = parseAliases(record.aliases);
        if (aliases.length > LIMITS.aliases || aliases.some(a => a.length > LIMITS.alias)) fail('Too many or too-long aliases.');
        ['category', 'era', 'dlc'].forEach(field => {
            if ((record[field] || '').length > LIMITS.tag) fail(`${field} is longer than ${LIMITS.tag} characters.`);
        });
        if ((record.description || '').length > LIMITS.description) fail(`Description is longer than ${LIMITS.description} characters.`);
        return {
            id: record.id || '',
            line: record.line,
            value: compact({ name, aliases, category: record.category, era: record.era, dlc: record.dlc, description: record.description, imagePath, active })
        };
    }

    // Drops empty optional fields so unchanged records compare equal.
    function compact(entity) {
        const out = {};
        Object.entries(entity).forEach(([key, value]) => {
            if (value === undefined || value === null || value === '') return;
            if (Array.isArray(value) && !value.length) return;
            out[key] = value;
        });
        return out;
    }

    // "Paste one class per line" or CSV text → class records.
    function parseClassText(text, format) {
        if (format === 'lines') {
            const errors = [];
            const records = String(text || '').split(/\r?\n/).map((line, i) => ({ line: i + 1, name: line }))
                .filter(record => record.name.trim())
                .map(record => classFromRecord(record, errors));
            return { records, errors };
        }
        let parsed;
        try { parsed = csvRecords(text, ['name']); }
        catch (error) { return { records: [], errors: [{ line: 1, message: error.message }] }; }
        const errors = [...parsed.errors];
        return { records: parsed.records.map(record => classFromRecord(record, errors)), errors };
    }

    // Compares imported records with the catalogue: what would be added, updated or
    // left alone, plus conflicts. Nothing is saved until the admin applies the plan.
    function planImport(group, records, initialErrors = []) {
        const errors = [...initialErrors];
        const current = group || {};
        const taken = new Set(Object.keys(current));
        const changes = [];
        const claimed = new Map();
        records.forEach(record => {
            let id = record.id;
            if (!id) {
                const match = entries(current).find(([, item]) => namesOf(item).some(n => nameKey(n) === nameKey(record.value.name)));
                id = match ? match[0] : uniqueId(record.value.name, taken);
            }
            const before = current[id] || null;
            const merged = before ? withRename(before, { ...stripStamp(before), ...record.value }) : record.value;
            namesOf(merged).forEach(name => {
                const key = nameKey(name);
                if (claimed.has(key) && claimed.get(key) !== id) errors.push({ line: record.line, message: `“${name}” appears more than once in this import.` });
                claimed.set(key, id);
            });
            const othersInImport = new Set(records.map(r => r.id).filter(Boolean));
            findConflicts(current, merged, id).forEach(conflict => {
                if (!othersInImport.has(conflict.id)) errors.push({ line: record.line, message: `“${conflict.name}” is already used by “${conflict.otherName}”.` });
            });
            const action = !before ? 'add' : sameEntity(stripStamp(before), merged) ? 'unchanged' : 'update';
            changes.push({ action, id, before, after: merged, line: record.line });
        });
        const ids = changes.map(change => change.id);
        ids.forEach((id, i) => {
            if (ids.indexOf(id) !== i) errors.push({ line: changes[i].line, message: `ID “${id}” appears more than once in this import.` });
        });
        return { changes, errors };
    }

    function stripStamp(entity) {
        const copy = { ...entity };
        delete copy.updatedAt;
        delete copy.updatedBy;
        if (copy.aliases) copy.aliases = aliasList(copy);
        return copy;
    }

    function sameEntity(a, b) {
        return JSON.stringify(sortKeys(compact(a))) === JSON.stringify(sortKeys(compact(b)));
    }

    function sortKeys(value) {
        if (Array.isArray(value)) return value.map(sortKeys);
        if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortKeys(value[k])]));
        return value;
    }

    function classesCsv(catalogue) {
        const rows = [CLASS_COLUMNS];
        entries(catalogue && catalogue.classes)
            .sort(([, a], [, b]) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
            .forEach(([id, c]) => rows.push([id, c.name, aliasList(c).join('; '), c.category, c.era, c.dlc, c.description, c.imagePath, c.active === false ? 'no' : 'yes']));
        return toCsv(rows);
    }

    // ---------- Tracks (locations + layouts in one CSV) ----------

    const TRACK_COLUMNS = ['layout_id', 'layout_name', 'short_name', 'location_id', 'location_name', 'aliases', 'era', 'dlc', 'image_path', 'active', 'random_eligible'];

    function tracksCsv(catalogue) {
        const locations = (catalogue && catalogue.locations) || {};
        const rows = [TRACK_COLUMNS];
        trackList(catalogue, { includeArchived: true }).forEach(track => {
            const layout = catalogue.layouts[track.id];
            const location = locations[layout.locationId] || {};
            rows.push([track.id, layout.name, layout.shortName, layout.locationId || '', location.name || '', aliasList(layout).join('; '),
                layout.era, layout.dlc, layout.imagePath, layout.active === false ? 'no' : 'yes', layout.randomEligible === false ? 'no' : 'yes']);
        });
        return toCsv(rows);
    }

    // Track CSV → plans for locations and layouts. New locations are created by name.
    function planTrackImport(catalogue, text) {
        let parsed;
        try { parsed = csvRecords(text, ['layout_name', 'location_name']); }
        catch (error) { return { locations: { changes: [], errors: [] }, layouts: { changes: [], errors: [{ line: 1, message: error.message }] } }; }
        const errors = [...parsed.errors];
        const locations = (catalogue && catalogue.locations) || {};
        const locationRecords = new Map();
        const layoutRecords = [];
        parsed.records.forEach(record => {
            const fail = message => errors.push({ line: record.line, message });
            const name = (record.layout_name || '').replace(/\s+/g, ' ').trim();
            const locationName = (record.location_name || '').replace(/\s+/g, ' ').trim();
            if (!name) fail('Layout name is missing.');
            if (!locationName && !SYSTEM_TRACKS.includes(name)) fail('Location name is missing.');
            ['layout_id', 'location_id'].forEach(field => {
                if (record[field] && !ID_PATTERN.test(record[field])) fail(`${field} “${record[field]}” must start with a letter and use only a-z, 0-9, - and _.`);
            });
            const active = parseBoolean(record.active, true);
            const randomEligible = parseBoolean(record.random_eligible, true);
            if (active === null || randomEligible === null) fail('Active and random_eligible must be yes or no.');
            if (!validateImagePath(record.image_path)) fail('Image path must be an image inside Logos_and_icons/.');
            if (name.length > LIMITS.name || locationName.length > LIMITS.name) fail(`Names must be ${LIMITS.name} characters or fewer.`);
            let locationId = record.location_id;
            if (locationName) {
                if (!locationId) {
                    const match = entries(locations).find(([, l]) => namesOf(l).some(n => nameKey(n) === nameKey(locationName)));
                    locationId = match ? match[0] : (locationRecords.get(nameKey(locationName)) || {}).id || '';
                }
                const key = locationId || nameKey(locationName);
                if (!locationRecords.has(key)) locationRecords.set(key, { id: locationId, line: record.line, value: { name: locationName, active: true } });
                record.locationKey = key;
            }
            layoutRecords.push({
                id: record.layout_id, line: record.line, locationKey: record.locationKey,
                value: compact({ name, shortName: record.short_name || name, aliases: parseAliases(record.aliases), era: record.era, dlc: record.dlc,
                    imagePath: record.image_path, active, randomEligible, system: SYSTEM_TRACKS.includes(name) || undefined })
            });
        });
        // Existing locations keep their other details; only new ones are added.
        const locationPlan = planImport(locations, [...locationRecords.values()].map(record => {
            const existing = record.id && locations[record.id];
            return existing ? { ...record, value: { ...stripStamp(existing), name: record.value.name } } : record;
        }));
        const idForKey = new Map();
        [...locationRecords.keys()].forEach((key, i) => idForKey.set(key, locationPlan.changes[i].id));
        layoutRecords.forEach(record => {
            if (record.locationKey) record.value.locationId = idForKey.get(record.locationKey);
            delete record.locationKey;
        });
        const layoutPlan = planImport(catalogue && catalogue.layouts, layoutRecords, errors);
        return { locations: locationPlan, layouts: layoutPlan };
    }

    return {
        ID_PATTERN, IMAGE_PATTERN, PLACEHOLDER_IMAGE, SYSTEM_TRACKS, LIMITS,
        nameKey, storageKey, slugify, uniqueId, parseAliases, aliasList, withRename, findConflicts, validateImagePath,
        buildLayoutIndex, resolveLayout, trackList,
        proposeSeed, seedWrites,
        parseCsv, csvCell, toCsv,
        parseClassText, planImport, classesCsv,
        tracksCsv, planTrackImport
    };
});
