// Racing Setup: admins manage the shared car-class and track catalogue.
// Catalogue logic (matching, imports, seeding) lives in catalogue.js.
(function () {
    'use strict';
    const C = window.OneElevenCatalogue;
    const CAT = 'seasonPlanning/v1/catalogue';
    const $ = id => document.getElementById(id);
    let catalogue = {};
    let adminUid = null;
    let loaded = false;
    let seedNames = {};

    // ---------- Small helpers ----------

    function h(tag, props, ...children) {
        const element = document.createElement(tag);
        Object.entries(props || {}).forEach(([key, value]) => {
            if (value === undefined || value === null || value === false) return;
            if (key === 'class') element.className = value;
            else if (key === 'text') element.textContent = value;
            else if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
            else if (key in element && typeof value !== 'string') element[key] = value;
            else element.setAttribute(key, value === true ? '' : value);
        });
        children.flat().forEach(child => {
            if (child === null || child === undefined || child === false) return;
            element.append(child instanceof Node ? child : document.createTextNode(String(child)));
        });
        return element;
    }

    const group = name => catalogue[name] || {};
    const sortByName = list => list.sort(([, a], [, b]) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    const matches = (entity, query) => !query || [entity.name, ...C.aliasList(entity)].some(name => C.nameKey(name).includes(query));
    const plural = (n, word, many) => `${n} ${n === 1 ? word : (many || `${word}s`)}`;
    // replaceChildren() would print null/false as text, so leave those out.
    const fill = (element, ...children) => element.replaceChildren(...children.flat().filter(child => child !== null && child !== undefined && child !== false));

    function setStatus(element, message, kind) {
        element.textContent = message || '';
        element.className = `sp-status${kind ? ` sp-${kind}` : ''}`;
    }

    // Removes empty optional values so the database only stores what was entered.
    function clean(entity) {
        const out = {};
        Object.entries(entity).forEach(([key, value]) => {
            if (typeof value === 'string') value = value.replace(/\s+/g, ' ').trim();
            if (value === '' || value === null || value === undefined) return;
            if (Array.isArray(value) && !value.length) return;
            out[key] = value;
        });
        return out;
    }

    function withoutStamp(entity) {
        const copy = { ...entity };
        delete copy.updatedAt;
        delete copy.updatedBy;
        if (copy.aliases) copy.aliases = C.aliasList(copy);
        return copy;
    }

    // Saves catalogue entries together with a revision bump, as one update.
    async function save(writes, message) {
        const sv = firebase.database.ServerValue;
        const updates = {};
        Object.entries(writes).forEach(([path, value]) => {
            updates[`${CAT}/${path}`] = value && typeof value === 'object'
                ? { ...value, updatedAt: sv.TIMESTAMP, updatedBy: adminUid }
                : value;
        });
        updates[`${CAT}/revision`] = sv.increment(1);
        updates[`${CAT}/updatedAt`] = sv.TIMESTAMP;
        try {
            await firebase.database().ref().update(updates);
            setStatus($('loadStatus'), message, 'ok');
            return true;
        } catch (error) {
            console.error('Catalogue save failed:', error);
            setStatus($('loadStatus'), `Not saved: ${error.message}`, 'error');
            return false;
        }
    }

    function download(filename, text, type) {
        const url = URL.createObjectURL(new Blob([text], { type }));
        const link = h('a', { href: url, download: filename });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function fillSelect(select, options, allLabel) {
        const previous = select.value;
        select.replaceChildren(h('option', { value: '', text: allLabel }),
            ...options.map(([value, label]) => h('option', { value, text: label })));
        select.value = options.some(([value]) => value === previous) ? previous : '';
    }

    function readFileInto(input, textarea) {
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => { textarea.value = reader.result; };
            reader.readAsText(file);
        });
    }

    // ---------- Tabs ----------

    function setupTabs() {
        const tabs = [...document.querySelectorAll('[role="tab"]')];
        const select = tab => {
            tabs.forEach(other => {
                const selected = other === tab;
                other.setAttribute('aria-selected', String(selected));
                other.tabIndex = selected ? 0 : -1;
                $(other.getAttribute('aria-controls')).hidden = !selected;
            });
            tab.focus();
        };
        tabs.forEach((tab, i) => {
            tab.addEventListener('click', () => select(tab));
            tab.addEventListener('keydown', event => {
                const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
                if (step) select(tabs[(i + step + tabs.length) % tabs.length]);
                if (event.key === 'Home') select(tabs[0]);
                if (event.key === 'End') select(tabs[tabs.length - 1]);
            });
        });
        return select;
    }

    // ---------- Edit dialog ----------

    // fields: [{ name, label, type: text|textarea|aliases|select|checkbox|image, hint, options, required }]
    function openEditor({ title, fields, values, conflicts, save: onSave }) {
        const body = $('editBody');
        const inputs = {};
        body.replaceChildren();
        $('editTitle').textContent = title;
        fields.forEach(field => {
            const id = `edit-${field.name}`;
            const value = values[field.name];
            let input;
            if (field.type === 'checkbox') {
                input = h('input', { type: 'checkbox', id, checked: value !== false });
                body.append(h('label', { class: 'sp-check', for: id }, input, field.label));
                if (field.hint) body.append(h('p', { class: 'sp-muted sp-small', style: 'margin:-6px 0 12px 32px', text: field.hint }));
            } else {
                if (field.type === 'textarea' || field.type === 'aliases') {
                    input = h('textarea', { id, rows: field.type === 'aliases' ? 3 : 4, style: 'min-height:0;font-family:inherit;font-size:1rem' });
                    input.value = field.type === 'aliases' ? C.aliasList(values).join('\n') : (value || '');
                } else if (field.type === 'select') {
                    input = h('select', { id, required: field.required }, field.options.map(([v, label]) => h('option', { value: v, text: label })));
                    input.value = value || '';
                } else {
                    input = h('input', { type: 'text', id, value: value || '', required: field.required, autocomplete: 'off', maxLength: field.maxLength || 120 });
                }
                const wrap = h('div', { class: 'sp-field' }, h('label', { for: id, text: field.label + (field.required ? ' *' : '') }));
                if (field.hint) wrap.append(h('p', { class: 'sp-hint', text: field.hint }));
                wrap.append(input);
                if (field.type === 'image') {
                    const img = h('img', { alt: '' });
                    const showImage = () => {
                        img.src = input.value.trim() && C.validateImagePath(input.value.trim()) ? input.value.trim() : C.PLACEHOLDER_IMAGE;
                    };
                    img.addEventListener('error', () => { img.src = C.PLACEHOLDER_IMAGE; });
                    input.addEventListener('input', showImage);
                    showImage();
                    wrap.append(h('div', { class: 'sp-image-preview' }, img, h('span', { class: 'sp-muted sp-small', text: 'Missing images show this placeholder.' })));
                }
                body.append(wrap);
            }
            inputs[field.name] = input;
        });
        const message = h('div', { class: 'sp-status', role: 'status' });
        body.append(message);

        const read = () => {
            const out = {};
            fields.forEach(field => {
                const input = inputs[field.name];
                if (field.type === 'checkbox') out[field.name] = input.checked;
                else if (field.type === 'aliases') out[field.name] = C.parseAliases(input.value);
                else out[field.name] = input.value.trim();
            });
            return out;
        };
        const check = () => {
            const current = read();
            const problems = [];
            fields.forEach(field => { if (field.required && !current[field.name]) problems.push(`${field.label} is required.`); });
            fields.filter(field => field.type === 'image').forEach(field => {
                if (!C.validateImagePath(current[field.name])) problems.push('The image must be a file inside Logos_and_icons/, for example Logos_and_icons/racetracks/Monza.png.');
            });
            (conflicts ? conflicts(current) : []).forEach(conflict => problems.push(`“${conflict.name}” is already used by “${conflict.otherName}”.`));
            setStatus(message, problems.join(' '), problems.length ? 'error' : '');
            $('editSave').disabled = problems.length > 0;
            return problems.length === 0;
        };
        body.addEventListener('input', check);
        body.addEventListener('change', check);
        check();

        const dialog = $('editDialog');
        $('editForm').onsubmit = async event => {
            event.preventDefault();
            if (!check()) return;
            $('editSave').disabled = true;
            const ok = await onSave(read());
            if (ok) dialog.close();
            else $('editSave').disabled = false;
        };
        $('editCancel').onclick = () => dialog.close();
        dialog.showModal();
        const first = body.querySelector('input:not([type="checkbox"]), select, textarea');
        if (first) first.focus();
    }

    const tagFields = [
        { name: 'era', label: 'Era', hint: 'Optional, e.g. 1990s or Modern.' },
        { name: 'dlc', label: 'DLC', hint: 'Optional, e.g. Base game or the DLC pack name.' }
    ];
    const aliasField = { name: 'aliases', label: 'Aliases', type: 'aliases', hint: 'Other names to match when searching or reading old championships, one per line. Old names are kept here automatically when you rename.' };

    // ---------- Car classes ----------

    function editClass(id) {
        const before = id ? group('classes')[id] : null;
        openEditor({
            title: before ? 'Edit car class' : 'Add car class',
            values: before || { active: true },
            fields: [
                { name: 'name', label: 'Name', required: true },
                aliasField,
                { name: 'category', label: 'Category', hint: 'Optional, e.g. GT, Prototype, Open wheel.' },
                ...tagFields,
                { name: 'description', label: 'Description', type: 'textarea' },
                { name: 'imagePath', label: 'Image path', type: 'image', maxLength: 250, hint: 'Optional existing image in this website, e.g. Logos_and_icons/Car_Thumbnails/….png' },
                { name: 'active', label: 'Active (can be offered in new polls)', type: 'checkbox' }
            ],
            conflicts: values => C.findConflicts(group('classes'), values, id),
            save: values => {
                const newId = id || C.uniqueId(values.name, new Set(Object.keys(group('classes'))));
                const entity = clean(C.withRename(before && withoutStamp(before), values));
                return save({ [`classes/${newId}`]: entity }, `Saved ${values.name}.`);
            }
        });
    }

    function toggleActive(groupName, id, label) {
        const entity = withoutStamp(group(groupName)[id]);
        const active = entity.active === false;
        return save({ [`${groupName}/${id}`]: { ...entity, active } }, `${active ? 'Restored' : 'Archived'} ${label || entity.name}.`);
    }

    function renderClasses() {
        const classes = sortByName(Object.entries(group('classes')));
        fillSelect($('classCategory'), [...new Set(classes.map(([, c]) => c.category).filter(Boolean))].sort().map(c => [c, c]), 'All categories');
        const query = C.nameKey($('classSearch').value);
        const status = $('classStatus').value;
        const category = $('classCategory').value;
        const shown = classes.filter(([, c]) => matches(c, query)
            && (status === 'all' || (status === 'active') === (c.active !== false))
            && (!category || c.category === category));
        $('classCount').textContent = classes.length
            ? `Showing ${shown.length} of ${plural(classes.length, 'class', 'classes')}.`
            : 'No car classes yet. Add them one at a time, or paste a list on the Import & export tab.';
        $('classList').replaceChildren(...shown.map(([id, c]) => {
            const tags = [c.category, c.era, c.dlc].filter(Boolean).join(' · ');
            const aliases = C.aliasList(c);
            return h('li', { class: `sp-item${c.active === false ? ' sp-archived' : ''}` },
                h('div', null,
                    h('div', { class: 'sp-item-title' }, c.name, c.active === false ? h('span', { class: 'sp-badge', text: 'Archived' }) : null),
                    tags ? h('div', { class: 'sp-item-meta', text: tags }) : null,
                    aliases.length ? h('div', { class: 'sp-item-meta', text: `Also: ${aliases.join(', ')}` }) : null),
                h('div', { class: 'sp-item-actions' },
                    h('button', { type: 'button', class: 'sp-link', 'aria-label': `Edit ${c.name}`, text: 'Edit', onclick: () => editClass(id) }),
                    h('button', { type: 'button', class: 'sp-link', 'aria-label': `${c.active === false ? 'Restore' : 'Archive'} ${c.name}`,
                        text: c.active === false ? 'Restore' : 'Archive', onclick: () => toggleActive('classes', id) })));
        }));
        if (classes.length && !shown.length) $('classList').append(h('li', { class: 'sp-empty', text: 'Nothing matches these filters.' }));
    }

    // ---------- Tracks ----------

    function locationOptions() {
        return sortByName(Object.entries(group('locations'))).map(([id, l]) => [id, l.active === false ? `${l.name} (archived)` : l.name]);
    }

    function editLocation(id) {
        const before = id ? group('locations')[id] : null;
        openEditor({
            title: before ? 'Edit location' : 'Add location',
            values: before || { active: true },
            fields: [
                { name: 'name', label: 'Location name', required: true, hint: 'The real-world place, e.g. Brands Hatch. Layouts at the same location count as the same track for exclusions and duplicates.' },
                aliasField,
                { name: 'country', label: 'Country' },
                { name: 'active', label: 'Active (archiving hides all its layouts from new selections)', type: 'checkbox' }
            ],
            conflicts: values => C.findConflicts(group('locations'), values, id),
            save: values => {
                const newId = id || C.uniqueId(values.name, new Set(Object.keys(group('locations'))));
                return save({ [`locations/${newId}`]: clean(C.withRename(before && withoutStamp(before), values)) }, `Saved ${values.name}.`);
            }
        });
    }

    function editLayout(id, presetLocation) {
        const before = id ? group('layouts')[id] : null;
        const system = Boolean(before && before.system);
        const locations = locationOptions();
        if (!system && !locations.length) {
            setStatus($('loadStatus'), 'Add a location first; every layout belongs to a location.', 'warn');
            return;
        }
        openEditor({
            title: before ? 'Edit layout' : 'Add layout',
            values: before || { active: true, randomEligible: true, locationId: presetLocation || '' },
            fields: [
                ...(system ? [] : [{ name: 'locationId', label: 'Location', type: 'select', required: true, options: [['', 'Choose a location'], ...locations], hint: 'Change this to move the layout to another location.' }]),
                { name: 'name', label: 'Layout name', required: true, hint: 'The full name saved in championships, e.g. Brands Hatch Indy.' },
                { name: 'shortName', label: 'Short name', maxLength: 80, hint: 'Short label used on championship tables. Defaults to the location name.' },
                aliasField,
                ...tagFields,
                { name: 'imagePath', label: 'Image path', type: 'image', maxLength: 250, hint: 'Existing image in this website, e.g. Logos_and_icons/racetracks/Monza.png' },
                { name: 'active', label: 'Active (can be chosen for new races and polls)', type: 'checkbox' },
                ...(system ? [] : [{ name: 'randomEligible', label: 'Can be picked when the calendar fills spaces at random', type: 'checkbox' }])
            ],
            conflicts: values => C.findConflicts(group('layouts'), values, id),
            save: values => {
                const newId = id || C.uniqueId(values.name, new Set(Object.keys(group('layouts'))));
                const location = group('locations')[values.locationId];
                const entity = { ...values, shortName: values.shortName || (location ? location.name : values.name) };
                if (system) Object.assign(entity, { system: true, randomEligible: false });
                else entity.system = false;
                return save({ [`layouts/${newId}`]: clean(C.withRename(before && withoutStamp(before), entity)) }, `Saved ${values.name}.`);
            }
        });
    }

    function layoutStatus(layout) {
        const location = group('locations')[layout.locationId];
        return layout.active !== false && (layout.system || !location || location.active !== false);
    }

    function renderTracks() {
        const layouts = Object.entries(group('layouts'));
        const locations = group('locations');
        $('seedPrompt').hidden = layouts.length > 0;
        fillSelect($('trackLocation'), locationOptions(), 'All locations');
        fillSelect($('trackEra'), [...new Set(layouts.map(([, l]) => l.era).filter(Boolean))].sort().map(v => [v, v]), 'Any era');
        fillSelect($('trackDlc'), [...new Set(layouts.map(([, l]) => l.dlc).filter(Boolean))].sort().map(v => [v, v]), 'Any DLC');
        const query = C.nameKey($('trackSearch').value);
        const filters = { location: $('trackLocation').value, era: $('trackEra').value, dlc: $('trackDlc').value, status: $('trackStatus').value };
        const filtering = Boolean(query || filters.location || filters.era || filters.dlc || filters.status !== 'active');

        const groups = new Map();
        sortByName(Object.entries(locations)).forEach(([id, location]) => groups.set(id, { id, location, layouts: [] }));
        groups.set('__system', { id: '__system', location: { name: 'System entries', system: true }, layouts: [] });
        let shownCount = 0;
        sortByName(layouts).forEach(([id, layout]) => {
            const key = layout.system ? '__system' : layout.locationId;
            const target = groups.get(key);
            if (!target) return;
            const location = target.location;
            const visible = (!query || matches(layout, query) || matches(location, query))
                && (!filters.location || layout.locationId === filters.location)
                && (!filters.era || layout.era === filters.era)
                && (!filters.dlc || layout.dlc === filters.dlc)
                && (filters.status === 'all' || (filters.status === 'active') === layoutStatus(layout));
            if (visible) { target.layouts.push([id, layout]); shownCount++; }
        });
        const showEmptyLocations = !query && !filters.era && !filters.dlc && filters.status !== 'archived';
        const visibleGroups = [...groups.values()].filter(g => g.layouts.length
            || (showEmptyLocations && !g.location.system && (!filters.location || g.id === filters.location)
                && (filters.status === 'all' || g.location.active !== false)));

        $('trackCount').textContent = layouts.length
            ? `Showing ${plural(shownCount, 'layout')} of ${layouts.length}, at ${plural(Object.keys(locations).length, 'location')}.`
            : '';
        $('trackGroups').replaceChildren(...visibleGroups.map(g => renderLocationGroup(g, filtering)));
        if (layouts.length && !visibleGroups.length) $('trackGroups').append(h('p', { class: 'sp-empty', text: 'Nothing matches these filters.' }));
    }

    function renderLocationGroup({ id, location, layouts }, open) {
        const archived = location.active === false;
        const aliases = C.aliasList(location);
        const details = h('details', { class: 'sp-group', open: open || undefined },
            h('summary', null,
                h('span', { text: location.name }),
                archived ? h('span', { class: 'sp-badge', text: 'Archived' }) : null,
                h('span', { class: 'sp-count', text: plural(layouts.length, 'layout') })));
        const body = h('div', { class: 'sp-group-body' });
        if (!location.system) {
            const meta = [location.country, aliases.length ? `Also: ${aliases.join(', ')}` : ''].filter(Boolean).join(' · ');
            if (meta) body.append(h('p', { class: 'sp-item-meta', style: 'margin:0 0 6px', text: meta }));
            body.append(h('div', { class: 'sp-item-actions', style: 'justify-content:flex-start;margin-bottom:4px' },
                h('button', { type: 'button', class: 'sp-link', text: 'Edit location', onclick: () => editLocation(id) }),
                h('button', { type: 'button', class: 'sp-link', text: archived ? 'Restore location' : 'Archive location', onclick: () => toggleActive('locations', id) }),
                h('button', { type: 'button', class: 'sp-link', text: 'Add layout here', onclick: () => editLayout(null, id) })));
        } else {
            body.append(h('p', { class: 'sp-item-meta', style: 'margin:0 0 6px', text: 'Used by existing screens only; never offered in track polls or random draws.' }));
        }
        body.append(h('ul', { class: 'sp-list' }, layouts.map(([layoutId, layout]) => {
            const tags = [layout.shortName && layout.shortName !== location.name ? `Short: ${layout.shortName}` : '', layout.era, layout.dlc,
                !layout.system && layout.randomEligible === false ? 'Not in random draws' : ''].filter(Boolean).join(' · ');
            const layoutAliases = C.aliasList(layout);
            const img = h('img', { class: 'sp-thumb', alt: '', loading: 'lazy', src: layout.imagePath || C.PLACEHOLDER_IMAGE });
            img.addEventListener('error', () => { img.src = C.PLACEHOLDER_IMAGE; });
            return h('li', { class: `sp-item sp-with-thumb${layoutStatus(layout) ? '' : ' sp-archived'}` }, img,
                h('div', null,
                    h('div', { class: 'sp-item-title' }, layout.name, layout.active === false ? h('span', { class: 'sp-badge', text: 'Archived' }) : null,
                        !layout.imagePath ? h('span', { class: 'sp-badge sp-amber', text: 'No image' }) : null),
                    tags ? h('div', { class: 'sp-item-meta', text: tags }) : null,
                    layoutAliases.length ? h('div', { class: 'sp-item-meta', text: `Also: ${layoutAliases.join(', ')}` }) : null),
                h('div', { class: 'sp-item-actions' },
                    h('button', { type: 'button', class: 'sp-link', 'aria-label': `Edit ${layout.name}`, text: 'Edit', onclick: () => editLayout(layoutId) }),
                    layout.system ? null : h('button', { type: 'button', class: 'sp-link', 'aria-label': `${layout.active === false ? 'Restore' : 'Archive'} ${layout.name}`,
                        text: layout.active === false ? 'Restore' : 'Archive', onclick: () => toggleActive('layouts', layoutId) })));
        })));
        if (!layouts.length) body.append(h('p', { class: 'sp-muted sp-small', text: 'No layouts match.' }));
        details.append(body);
        return details;
    }

    // ---------- Seed from the built-in list ----------

    function renderSeedReview() {
        const box = $('seedReview');
        box.hidden = false;
        const proposal = C.proposeSeed(typeof trackData !== 'undefined' ? trackData : [], catalogue);
        const pending = proposal.groups.filter(g => !g.complete);
        const flagged = pending.filter(g => g.flagged);
        const systemPending = proposal.system.filter(t => !t.existingId);
        if (!pending.length && !systemPending.length) {
            box.replaceChildren(h('p', { class: 'sp-status sp-ok', text: 'Every built-in track is already in the catalogue. Nothing to add.' }));
            return;
        }
        const layoutsToAdd = pending.reduce((n, g) => n + g.layouts.filter(l => !l.existingId).length, 0) + systemPending.length;
        const nameInputs = new Map();
        const confirm = h('input', { type: 'checkbox', id: 'seedConfirm' });
        const importButton = h('button', { type: 'button', text: `Add ${plural(layoutsToAdd, 'layout')}` });
        const status = h('div', { class: 'sp-status', role: 'status' });
        const syncButton = () => { importButton.disabled = flagged.length > 0 && !confirm.checked; };
        confirm.addEventListener('change', syncButton);

        const clusterCards = proposal.clusters
            .filter(cluster => cluster.keys.some(key => pending.some(g => g.key === key)))
            .map(cluster => {
                const groups = cluster.keys.map(key => proposal.groups.find(g => g.key === key));
                const input = h('input', { type: 'text', value: cluster.suggestedName, 'aria-label': `Shared location name for ${groups.map(g => g.name).join(', ')}` });
                return h('div', { class: 'sp-seed-group sp-flagged' },
                    h('strong', { text: `Same place? ${groups.map(g => g.name).join(', ')}` }),
                    h('p', { class: 'sp-muted sp-small', style: 'margin:4px 0 8px', text: 'If these are layouts of one real-world location, give them one location name. Otherwise leave them separate.' }),
                    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, h('div', { style: 'flex:1 1 180px' }, input),
                        h('button', { type: 'button', class: 'sp-secondary', text: 'Use for all', onclick: () => {
                            const name = input.value.trim();
                            if (!name) return;
                            cluster.keys.forEach(key => { seedNames[key] = name; if (nameInputs.get(key)) nameInputs.get(key).value = name; });
                        } }),
                        h('button', { type: 'button', class: 'sp-link', text: 'Keep separate', onclick: () => {
                            cluster.keys.forEach(key => {
                                delete seedNames[key];
                                const g = proposal.groups.find(item => item.key === key);
                                if (nameInputs.get(key)) nameInputs.get(key).value = g.name;
                            });
                        } })));
            });

        const ordered = [...pending].sort((a, b) => Number(b.flagged) - Number(a.flagged));
        const groupRows = ordered.map(g => {
            const input = h('input', { type: 'text', value: seedNames[g.key] || g.name, 'aria-label': `Location name for ${g.layouts.map(l => l.name).join(', ')}` });
            input.addEventListener('input', () => { seedNames[g.key] = input.value; });
            nameInputs.set(g.key, input);
            return h('div', { class: `sp-seed-group${g.flagged ? ' sp-flagged' : ''}` },
                h('label', { class: 'sp-small', text: `Location for ${plural(g.layouts.length, 'layout')}` }), input,
                h('ul', null, g.layouts.map(l => h('li', { text: l.existingId ? `${l.name} (already added)` : l.name }))),
                g.reasons.map(reason => h('p', { class: 'sp-reason', text: reason })));
        });

        importButton.addEventListener('click', async () => {
            importButton.disabled = true;
            const writes = C.seedWrites(C.proposeSeed(trackData, catalogue), seedNames, catalogue, {});
            const added = Object.keys(writes);
            const ok = await save(writes, `Added ${plural(added.filter(p => p.startsWith('layouts/')).length, 'layout')} and ${plural(added.filter(p => p.startsWith('locations/')).length, 'location')} from the built-in list.`);
            setStatus(status, ok ? 'Done. The site now uses the catalogue for track menus and images.' : 'Not saved. See the message at the top of the page.', ok ? 'ok' : 'error');
            if (!ok) syncButton();
        });

        fill(box,
            h('p', { style: 'margin-top:12px' }, `${plural(layoutsToAdd, 'layout')} will be added in ${plural(pending.length, 'location')}. `,
                flagged.length ? h('strong', { text: `${plural(flagged.length, 'location')} need a check (marked in red).` }) : 'Nothing looks ambiguous.'),
            clusterCards.length ? h('h3', { style: 'margin:16px 0 4px', text: 'Possible duplicates' }) : null,
            ...clusterCards,
            h('h3', { style: 'margin:16px 0 4px', text: 'Proposed locations' }),
            ...groupRows,
            systemPending.length ? h('p', { class: 'sp-muted sp-small', text: `Also adds the system entries ${systemPending.map(t => t.name).join(' and ')} (kept for existing screens, never used in polls or random draws).` }) : null,
            flagged.length ? h('label', { class: 'sp-check', for: 'seedConfirm' }, confirm, 'I’ve checked the locations marked in red') : null,
            importButton,
            status);
        syncButton();
    }

    // ---------- Imports ----------

    function changeTable(title, plan, describe) {
        const counts = { add: 0, update: 0, unchanged: 0 };
        plan.changes.forEach(change => { counts[change.action]++; });
        const rows = plan.changes.filter(change => change.action !== 'unchanged');
        return h('div', null,
            h('h3', { style: 'margin:14px 0 4px', text: title }),
            h('p', { class: 'sp-small', text: `${counts.add} to add, ${counts.update} to update, ${counts.unchanged} unchanged.` }),
            rows.length ? h('div', { class: 'sp-table-wrap' }, h('table', null,
                h('thead', null, h('tr', null, h('th', { text: 'Change' }), h('th', { text: 'Name' }), h('th', { text: 'Details' }))),
                h('tbody', null, rows.map(change => h('tr', null,
                    h('td', null, h('span', { class: `sp-badge ${change.action === 'add' ? 'sp-green' : 'sp-amber'}`, text: change.action === 'add' ? 'Add' : 'Update' })),
                    h('td', { text: change.after.name }),
                    h('td', { class: 'sp-muted', text: describe(change) })))))) : null);
    }

    function describeChange(change) {
        if (change.action === 'add') {
            return [change.after.category, change.after.era, change.after.dlc, C.aliasList(change.after).length ? `Also: ${C.aliasList(change.after).join(', ')}` : ''].filter(Boolean).join(' · ');
        }
        const before = withoutStamp(change.before);
        const fields = new Set([...Object.keys(before), ...Object.keys(change.after)]);
        return [...fields].filter(key => JSON.stringify(before[key]) !== JSON.stringify(change.after[key]))
            .map(key => `${key}: ${formatValue(before[key])} → ${formatValue(change.after[key])}`).join('; ');
    }

    const formatValue = value => (value === undefined ? '—' : Array.isArray(value) ? value.join(', ') || '—' : String(value));

    function renderPlan(container, sections, apply) {
        const errors = sections.flatMap(section => section.plan.errors);
        const changed = sections.some(section => section.plan.changes.some(change => change.action !== 'unchanged'));
        const button = h('button', { type: 'button', text: 'Apply changes', disabled: Boolean(errors.length || !changed) });
        const status = h('div', { class: 'sp-status', role: 'status' });
        button.addEventListener('click', async () => {
            button.disabled = true;
            const ok = await apply();
            setStatus(status, ok ? 'Saved.' : 'Not saved. See the message at the top of the page.', ok ? 'ok' : 'error');
        });
        fill(container,
            errors.length ? h('div', { class: 'sp-status sp-error', role: 'alert' }, 'Fix these rows, then preview again:',
                h('ul', { class: 'sp-errors' }, errors.map(e => h('li', { text: `Line ${e.line}: ${e.message}` })))) : null,
            ...sections.map(section => changeTable(section.title, section.plan, describeChange)),
            !changed && !errors.length ? h('p', { class: 'sp-status sp-ok', text: 'Everything already matches the catalogue.' }) : null,
            button, status);
    }

    function previewClassImport() {
        const format = document.querySelector('input[name="classFormat"]:checked').value;
        const parsed = C.parseClassText($('classImportText').value, format);
        const plan = C.planImport(group('classes'), parsed.records, parsed.errors);
        renderPlan($('classImportPreview'), [{ title: 'Car classes', plan }], () => {
            const writes = {};
            plan.changes.filter(c => c.action !== 'unchanged').forEach(c => { writes[`classes/${c.id}`] = clean(c.after); });
            return save(writes, `Imported ${plural(Object.keys(writes).length, 'car class', 'car classes')}.`);
        });
    }

    function previewTrackImport() {
        const plan = C.planTrackImport(catalogue, $('trackImportText').value);
        renderPlan($('trackImportPreview'), [{ title: 'Locations', plan: plan.locations }, { title: 'Layouts', plan: plan.layouts }], () => {
            const writes = {};
            plan.locations.changes.filter(c => c.action !== 'unchanged').forEach(c => { writes[`locations/${c.id}`] = clean(c.after); });
            plan.layouts.changes.filter(c => c.action !== 'unchanged').forEach(c => { writes[`layouts/${c.id}`] = clean({ system: false, ...c.after }); });
            return save(writes, `Imported ${plural(Object.keys(writes).length, 'track change')}.`);
        });
    }

    // ---------- Checks ----------

    async function scanChampionships() {
        const results = $('scanResults');
        if (!Object.keys(group('layouts')).length) {
            results.replaceChildren(h('p', { class: 'sp-status sp-warn', text: 'Set up the track catalogue first (Import & export → Built-in track list).' }));
            return;
        }
        results.replaceChildren(h('p', { class: 'sp-status', text: 'Checking championships…' }));
        try {
            const snapshot = await firebase.firestore().collection('championships').get();
            const index = C.buildLayoutIndex(catalogue);
            const unknown = new Map();
            let checked = 0;
            snapshot.docs.forEach(doc => {
                const season = doc.data() || {};
                Object.entries(season.races || {}).forEach(([key, race]) => {
                    const name = race && typeof race.trackName === 'string' ? race.trackName.trim() : '';
                    if (!name) return;
                    checked++;
                    if (index.has(C.nameKey(name))) return;
                    if (!unknown.has(name)) unknown.set(name, []);
                    unknown.get(name).push(`${season.seasonName || doc.id} ${key.replace(/^race/, 'race ')}`);
                });
            });
            if (!unknown.size) {
                results.replaceChildren(h('p', { class: 'sp-status sp-ok', text: `All ${plural(checked, 'saved race')} use names the catalogue recognises.` }));
                return;
            }
            const layoutOptions = sortByName(Object.entries(group('layouts'))).map(([id, l]) => h('option', { value: id, text: l.active === false ? `${l.name} (archived)` : l.name }));
            results.replaceChildren(
                h('p', { class: 'sp-status sp-warn', text: `${plural(unknown.size, 'track name')} not recognised, out of ${plural(checked, 'saved race')}.` }),
                h('ul', { class: 'sp-list' }, [...unknown.entries()].map(([name, uses]) => {
                    const select = h('select', { 'aria-label': `Layout for ${name}` }, h('option', { value: '', text: 'Choose the matching layout' }), layoutOptions.map(o => o.cloneNode(true)));
                    return h('li', { class: 'sp-item', style: 'grid-template-columns:1fr' },
                        h('div', null, h('div', { class: 'sp-item-title', text: name }), h('div', { class: 'sp-item-meta', text: `Used in ${uses.join(', ')}` })),
                        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, h('div', { style: 'flex:1 1 200px' }, select),
                            h('button', { type: 'button', class: 'sp-secondary', text: 'Add as alias', onclick: async () => {
                                const layout = group('layouts')[select.value];
                                if (!layout) return;
                                const entity = withoutStamp(layout);
                                entity.aliases = C.parseAliases([...C.aliasList(entity), name]);
                                const conflicts = C.findConflicts(group('layouts'), entity, select.value);
                                if (conflicts.length) { setStatus($('loadStatus'), `“${name}” is already used by “${conflicts[0].otherName}”.`, 'error'); return; }
                                if (await save({ [`layouts/${select.value}`]: entity }, `“${name}” now matches ${layout.name}.`)) scanChampionships();
                            } })));
                })));
        } catch (error) {
            console.error('Championship check failed:', error);
            results.replaceChildren(h('p', { class: 'sp-status sp-error', text: `Could not read championships: ${error.message}` }));
        }
    }

    function renderProblems() {
        const problems = [];
        ['classes', 'locations', 'layouts'].forEach(name => {
            const seen = new Set();
            Object.entries(group(name)).forEach(([id, entity]) => {
                C.findConflicts(group(name), entity, id).forEach(conflict => {
                    const pair = [id, conflict.id].sort().join('|') + C.nameKey(conflict.name);
                    if (seen.has(pair)) return;
                    seen.add(pair);
                    problems.push(`“${conflict.name}” is used by both “${entity.name}” and “${conflict.otherName}” (${name}).`);
                });
            });
        });
        Object.values(group('layouts')).forEach(layout => {
            if (!layout.system && !group('locations')[layout.locationId]) problems.push(`${layout.name} belongs to a location that no longer exists.`);
            else if (layout.active !== false && !layout.system && group('locations')[layout.locationId].active === false) {
                problems.push(`${layout.name} is active, but its location is archived, so it is hidden.`);
            }
        });
        const noImage = Object.values(group('layouts')).filter(layout => !layout.imagePath).map(layout => layout.name);
        if (noImage.length) problems.push(`Using the placeholder image: ${noImage.join(', ')}.`);
        $('catalogueProblems').replaceChildren(problems.length
            ? h('ul', { style: 'margin:0;padding-left:20px' }, problems.map(text => h('li', { text })))
            : h('p', { class: 'sp-status sp-ok', text: 'No problems found.' }));
    }

    // ---------- Start ----------

    function renderAll() {
        renderClasses();
        renderTracks();
        renderProblems();
        if (!$('seedReview').hidden) renderSeedReview();
    }

    function start(uid) {
        if (adminUid) return;
        adminUid = uid;
        firebase.database().ref(CAT).on('value', snapshot => {
            catalogue = snapshot.val() || {};
            if (!loaded) setStatus($('loadStatus'), '');
            loaded = true;
            renderAll();
        }, error => {
            console.error('Catalogue load failed:', error);
            setStatus($('loadStatus'), `Could not load the catalogue: ${error.message}`, 'error');
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        const selectTab = setupTabs();
        ['classSearch', 'classStatus', 'classCategory'].forEach(id => $(id).addEventListener('input', renderClasses));
        ['trackSearch', 'trackLocation', 'trackEra', 'trackDlc', 'trackStatus'].forEach(id => $(id).addEventListener('input', renderTracks));
        $('addClass').addEventListener('click', () => editClass(null));
        $('addLocation').addEventListener('click', () => editLocation(null));
        $('addLayout').addEventListener('click', () => editLayout(null));
        $('openSeed').addEventListener('click', renderSeedReview);
        $('openSeedFromTracks').addEventListener('click', () => { selectTab($('tab-import')); renderSeedReview(); $('seedCard').scrollIntoView(); });
        $('previewClassImport').addEventListener('click', previewClassImport);
        $('previewTrackImport').addEventListener('click', previewTrackImport);
        readFileInto($('classImportFile'), $('classImportText'));
        readFileInto($('trackImportFile'), $('trackImportText'));
        $('exportClasses').addEventListener('click', () => download('one-eleven-car-classes.csv', C.classesCsv(catalogue), 'text/csv'));
        $('exportTracks').addEventListener('click', () => download('one-eleven-tracks.csv', C.tracksCsv(catalogue), 'text/csv'));
        $('exportJson').addEventListener('click', () => download('one-eleven-catalogue.json', JSON.stringify(catalogue, null, 2), 'application/json'));
        $('scanChampionships').addEventListener('click', scanChampionships);
    });

    document.addEventListener('oneEleven:adminDriver', event => start(event.detail.user.uid));
})();
