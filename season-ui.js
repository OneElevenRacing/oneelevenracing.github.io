// Shared screens for season polls: the ballot form, review step, receipt and
// results. Used by the driver pages and by the admin "Preview as driver" view.
// Needs catalogue.js, season-ballot.js, season-polls-core.js and season-results.js.
(function () {
    'use strict';
    const C = window.OneElevenCatalogue;
    const SB = window.SeasonBallot;
    const P = window.SeasonPolls;
    const R = window.SeasonResults;
    let uid = 0;
    const nextId = prefix => `${prefix}-${++uid}`;

    function h(tag, props, ...children) {
        const element = document.createElement(tag);
        Object.entries(props || {}).forEach(([key, value]) => {
            if (value === undefined || value === null || value === false) return;
            if (key === 'class') element.className = value;
            else if (key === 'text') element.textContent = value;
            else if (key === 'html') element.innerHTML = value;
            else if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
            else if (key in element && typeof value !== 'string') element[key] = value;
            else element.setAttribute(key, value === true ? '' : value);
        });
        children.flat(Infinity).forEach(child => {
            if (child === null || child === undefined || child === false) return;
            element.append(child instanceof Node ? child : document.createTextNode(String(child)));
        });
        return element;
    }

    const fill = (element, ...children) => element.replaceChildren(...children.flat().filter(c => c !== null && c !== undefined && c !== false));
    const questions = definition => SB.questionList(definition);
    const isMulti = q => !(q.minSelections === 1 && q.maxSelections === 1);
    const optionEntries = q => Object.entries(q.options || {});

    function blankAnswers(definition) {
        return questions(definition).map(() => ({ selections: [], writeIns: [], text: '', skipped: false }));
    }

    // Problems per question, using the same checks as the database rules (one pass).
    function errorsByQuestion(definition, answers) {
        const byQuestion = new Map();
        SB.validateAnswers(definition, SB.normaliseAnswers(definition, answers)).forEach(error => {
            if (!byQuestion.has(error.question)) byQuestion.set(error.question, []);
            byQuestion.get(error.question).push(error.message);
        });
        return byQuestion;
    }

    // ---------- Ballot form ----------

    // Renders every question with a bottom action bar. `answers` is edited in place.
    function renderForm(container, { definition, answers, onChange, onReview }) {
        const list = questions(definition);
        const blocks = list.map((question, index) => questionBlock(definition, question, index, answers, () => { update(); onChange(answers); }));
        const counter = h('p', { class: 'sp-actionbar-count', 'aria-live': 'polite' });
        const reviewButton = h('button', { type: 'button', text: 'Review answers' });
        const bar = h('div', { class: 'sp-actionbar' }, counter, reviewButton);

        function update() {
            const problems = errorsByQuestion(definition, answers);
            const ready = list.filter((q, i) => !problems.has(i)).length;
            if (list.length === 1 && list[0].kind !== 'text') {
                const q = list[0];
                const count = answers[0].selections.length + (answers[0].writeIns || []).filter(t => t.trim()).length;
                const target = q.minSelections === q.maxSelections ? ` of ${q.maxSelections}` : '';
                fill(counter, h('strong', { class: ready ? '' : 'sp-red-text', text: String(count) }), `${target} selected`);
            } else {
                fill(counter, h('strong', { class: ready === list.length ? '' : 'sp-red-text', text: String(ready) }), ` of ${list.length} questions ready`);
            }
        }

        reviewButton.addEventListener('click', () => {
            let firstProblem = null;
            const all = errorsByQuestion(definition, answers);
            blocks.forEach(block => {
                const problems = all.get(block.index) || [];
                block.showErrors(problems);
                if (problems.length && !firstProblem) firstProblem = block;
            });
            if (firstProblem) firstProblem.focus();
            else onReview();
        });
        fill(container, ...blocks.map(block => block.element), bar);
        update();
    }

    function questionBlock(definition, question, index, answers, changed) {
        const answer = answers[index];
        const total = definition.questionCount;
        const instructionId = nextId('instr');
        const errorBox = h('div', { class: 'sp-question-error', role: 'alert', hidden: true });
        const fieldset = h('fieldset', { class: 'sp-question', 'aria-describedby': instructionId });
        const legend = h('legend', null,
            total > 1 ? h('span', { class: 'sp-eyebrow', text: `Question ${index + 1} of ${total}${question.required ? '' : ' · optional'}` }) : null,
            h('span', { class: 'sp-question-prompt', text: question.prompt }));
        fieldset.append(legend);
        if (question.help) fieldset.append(h('p', { class: 'sp-muted', text: question.help }));
        fieldset.append(h('p', { class: 'sp-instruction', id: instructionId, text: P.describeQuota(question) }));

        const showErrors = problems => {
            errorBox.hidden = !problems.length;
            errorBox.textContent = problems.join(' ');
        };
        const onChange = () => { showErrors([]); changed(); };

        if (question.kind === 'text') {
            const textId = nextId('text');
            const area = h('textarea', { id: textId, maxLength: question.maxLength, rows: 5, 'aria-describedby': instructionId });
            area.value = answer.text || '';
            const count = h('p', { class: 'sp-muted sp-small', 'aria-live': 'polite' });
            const showCount = () => { count.textContent = `${area.value.length} / ${question.maxLength} characters`; };
            area.addEventListener('input', () => { answer.text = area.value; answer.skipped = false; showCount(); onChange(); });
            showCount();
            fieldset.append(h('label', { class: 'sp-visually-hidden', for: textId, text: question.prompt }), area, count);
        } else {
            fieldset.append(...choiceControls(question, index, answer, onChange));
        }
        fieldset.append(errorBox);
        return { element: fieldset, index, showErrors, focus: () => { fieldset.scrollIntoView({ block: 'center' }); (fieldset.querySelector('input, textarea') || fieldset).focus(); } };
    }

    function choiceControls(question, index, answer, onChange) {
        const options = optionEntries(question);
        const multi = isMulti(question);
        const name = nextId(`q${index}`);
        const searchable = options.length > 8;
        const parts = [];
        const inputs = new Map();
        const notice = h('p', { class: 'sp-muted sp-small', 'aria-live': 'polite' });

        const chips = h('div', { class: 'sp-chips', 'aria-label': 'Your choices' });
        const renderChips = () => {
            if (!searchable) return;
            fill(chips, answer.selections.length ? h('span', { class: 'sp-small sp-muted', text: 'Chosen:' }) : null,
                answer.selections.map(id => h('button', { type: 'button', class: 'sp-chip', 'aria-label': `Remove ${question.options[id].label}`,
                    onclick: () => { toggle(id, false); } }, question.options[id].label, h('span', { 'aria-hidden': 'true', text: ' ×' }))));
        };

        const syncLimit = () => {
            const full = multi && answer.selections.length >= question.maxSelections;
            inputs.forEach((input, id) => {
                input.checked = answer.selections.includes(id);
                if (multi) input.disabled = full && !input.checked;
            });
            notice.textContent = full && question.maxSelections > 0 ? `You've chosen ${question.maxSelections}. Untick one to change your choice.` : '';
            renderChips();
        };

        function toggle(id, checked) {
            if (multi) {
                if (checked && !answer.selections.includes(id)) {
                    if (answer.selections.length >= question.maxSelections) { syncLimit(); return; }
                    answer.selections.push(id);
                } else if (!checked) answer.selections = answer.selections.filter(other => other !== id);
            } else {
                answer.selections = checked ? [id] : [];
            }
            answer.skipped = false;
            syncLimit();
            onChange();
        }

        const optionRow = ([id, option]) => {
            const input = h('input', { type: multi ? 'checkbox' : 'radio', name, value: id, checked: answer.selections.includes(id) });
            input.addEventListener('change', () => toggle(id, input.checked));
            inputs.set(id, input);
            const thumb = question.type === 'track' && option.imagePath ? h('img', { class: 'sp-option-thumb', src: option.imagePath, alt: '', loading: 'lazy' }) : null;
            return h('label', { class: 'sp-option', 'data-search': C.nameKey(`${option.label} ${option.locationName || ''}`) }, input, thumb, h('span', { text: option.label }));
        };

        let list;
        if (question.type === 'track') {
            const groups = new Map();
            options.forEach(entry => {
                const key = entry[1].locationName || 'Other';
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(entry);
            });
            list = h('div', { class: 'sp-option-groups' }, [...groups.entries()]
                .sort(([a], [b]) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
                .map(([location, entries]) => h('details', { class: 'sp-option-group', 'data-search': C.nameKey(location), open: entries.some(([id]) => answer.selections.includes(id)) || undefined },
                    h('summary', null, h('span', { text: location }), h('span', { class: 'sp-count', text: entries.length === 1 ? '1 layout' : `${entries.length} layouts` })),
                    h('div', { class: 'sp-option-list' }, entries.map(optionRow)))));
        } else {
            list = h('div', { class: 'sp-option-list' }, options.map(optionRow));
        }

        if (searchable) {
            const searchId = nextId('search');
            const empty = h('p', { class: 'sp-muted', hidden: true, text: 'Nothing matches your search.' });
            const search = h('input', { type: 'search', id: searchId, placeholder: question.type === 'track' ? 'Search tracks' : 'Search', autocomplete: 'off' });
            search.addEventListener('input', () => {
                const query = C.nameKey(search.value);
                let shown = 0;
                list.querySelectorAll('.sp-option').forEach(row => {
                    const groupMatch = row.closest('details') && row.closest('details').dataset.search.includes(query);
                    const visible = !query || row.dataset.search.includes(query) || groupMatch;
                    row.hidden = !visible;
                    if (visible) shown++;
                });
                list.querySelectorAll('details').forEach(group => {
                    const any = [...group.querySelectorAll('.sp-option')].some(row => !row.hidden);
                    group.hidden = !any;
                    if (query) group.open = any;
                });
                empty.hidden = shown > 0;
            });
            parts.push(h('div', { class: 'sp-field sp-search' }, h('label', { for: searchId, class: 'sp-small', text: question.type === 'track' ? 'Find a track' : 'Find an option' }), search), chips, empty);
        }
        parts.push(list, notice);

        if (!multi && !question.required) {
            parts.push(h('button', { type: 'button', class: 'sp-link', text: 'Clear my choice', onclick: () => toggle(answer.selections[0], false) }));
        }

        if (question.kind === 'nomination' && question.allowWriteIns) {
            parts.push(writeInControls(question, answer, onChange));
        }
        syncLimit();
        return parts;
    }

    function writeInControls(question, answer, onChange) {
        if (!answer.writeIns) answer.writeIns = [];
        const box = h('div', { class: 'sp-writeins' });
        const render = () => {
            const rows = answer.writeIns.map((text, i) => {
                const id = nextId('writein');
                const input = h('input', { type: 'text', id, value: text, maxLength: 2000, autocomplete: 'off' });
                input.addEventListener('input', () => { answer.writeIns[i] = input.value; onChange(); });
                return h('div', { class: 'sp-writein' },
                    h('label', { class: 'sp-visually-hidden', for: id, text: `Written suggestion ${i + 1}` }), input,
                    h('button', { type: 'button', class: 'sp-link', 'aria-label': `Remove suggestion ${i + 1}`, text: 'Remove',
                        onclick: () => { answer.writeIns.splice(i, 1); render(); onChange(); } }));
            });
            const canAdd = answer.writeIns.length < question.maxWriteIns;
            fill(box, h('p', { class: 'sp-small', style: 'font-weight:600;margin:12px 0 6px', text: 'Not listed? Add your own suggestions' }), rows,
                h('button', { type: 'button', class: 'sp-secondary', disabled: !canAdd, text: 'Add a suggestion', onclick: () => {
                    answer.writeIns.push('');
                    render();
                    const inputs = box.querySelectorAll('input');
                    inputs[inputs.length - 1].focus();
                } }),
                canAdd ? null : h('p', { class: 'sp-muted sp-small', text: `Up to ${question.maxWriteIns} written suggestions.` }));
        };
        render();
        return box;
    }

    // ---------- Showing answers ----------

    // Answers from a stored ballot, in the same shape the form uses.
    function answersFromBallot(definition, ballot) {
        const selected = SB.selectedOptions(definition, ballot);
        return questions(definition).map((question, i) => {
            const stored = (ballot.answers && ballot.answers[i]) || {};
            const writeIns = [];
            for (let n = 0; n < (stored.writeInCount || 0); n++) writeIns.push(stored.writeIns[n].text);
            return { selections: selected[i], writeIns, text: stored.text || '', skipped: stored.skipped === true };
        });
    }

    function answerSummary(definition, answers) {
        return h('dl', { class: 'sp-answers' }, questions(definition).map((question, i) => {
            const answer = answers[i] || {};
            const labels = (answer.selections || []).map(id => (question.options[id] || { label: id }).label);
            const writeIns = (answer.writeIns || []).map(t => t.trim()).filter(Boolean);
            let body;
            if (answer.skipped || (!labels.length && !writeIns.length && !(answer.text || '').trim())) body = h('dd', { class: 'sp-muted', text: 'No answer' });
            else if (question.kind === 'text') body = h('dd', { class: 'sp-prewrap', text: answer.text.trim() });
            else body = h('dd', null, h('ul', null, labels.map(l => h('li', { text: l })), writeIns.map(t => h('li', null, t, h('span', { class: 'sp-badge', text: 'Your suggestion' })))));
            return [h('dt', { text: question.prompt }), body];
        }));
    }

    function renderReview(container, { definition, answers, onBack, onSubmit, preview }) {
        const status = h('div', { class: 'sp-status', role: 'status' });
        const submit = h('button', { type: 'button', text: preview ? 'Submit (preview only)' : 'Submit my vote' });
        submit.addEventListener('click', () => onSubmit({ button: submit, status }));
        fill(container,
            h('h2', { text: 'Check your answers' }),
            answerSummary(definition, SB.normaliseAnswers(definition, answers)),
            h('p', { class: 'sp-status sp-warn', text: preview
                ? 'This is a preview with sample answers. Nothing will be saved.'
                : 'Once you submit, only an admin can change your answers.' }),
            h('div', { class: 'sp-actionbar' }, h('button', { type: 'button', class: 'sp-secondary', text: 'Change answers', onclick: onBack }), submit),
            status);
        container.querySelector('h2').setAttribute('tabindex', '-1');
        container.querySelector('h2').focus();
    }

    function renderReceipt(container, { definition, ballot, preview }) {
        const updated = ballot.revision > 1;
        fill(container,
            h('div', { class: 'sp-receipt', role: 'status' },
                h('h2', { text: preview ? 'Preview submitted (nothing saved)' : 'Your vote is saved' }),
                h('p', { text: preview ? 'Drivers will see a receipt like this.' : `Submitted ${P.formatDateTime(ballot.submittedAt)}.` }),
                updated ? h('p', { class: 'sp-muted', text: 'An admin has since updated these answers.' }) : null),
            answerSummary(definition, answersFromBallot(definition, ballot)),
            h('p', { class: 'sp-muted sp-small', text: 'Only an admin can change these answers. Ask an admin if something is wrong.' }));
    }

    // ---------- Results ----------

    function downloadBlob(filename, blob) {
        const url = URL.createObjectURL(blob);
        const link = h('a', { href: url, download: filename });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // Draws the chart SVG onto a canvas at twice the size and downloads a PNG.
    function downloadSvgAsPng(svg, filename) {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = image.width * 2;
            canvas.height = image.height * 2;
            const context = canvas.getContext('2d');
            context.scale(2, 2);
            context.drawImage(image, 0, 0);
            canvas.toBlob(blob => downloadBlob(filename, blob), 'image/png');
        };
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }

    const slug = text => C.slugify(text || 'results');

    // Charts for every question that has totals. Respondents and total selections
    // are separate figures; names stay hidden everywhere when labels are hidden.
    function renderResults(container, { definition, totals, pollId, labelsHidden, provisional, title, downloads = true, width, compact = false, minTurnout = 0 }) {
        // Draw at the screen's width so text stays readable on phones; exports use the same drawing.
        const chartWidth = width || Math.max(300, Math.min(640, window.innerWidth - 72));
        const respondents = (totals && totals.respondents) || 0;
        const figures = questions(definition).map((question, i) => {
            if (question.kind === 'text') return null;
            const list = R.rows(definition, i, totals, { labelsHidden, pollId });
            const yesNo = question.type === 'yesno';
            const summary = R.summaryText(list, { respondents, labelsHidden, yesNo, minTurnout });
            const name = `${slug(title)}-q${i + 1}${labelsHidden ? '-names-hidden' : ''}`;
            let svg;
            let outcome = null;
            if (yesNo) {
                const yes = (list.find(r => r.id === 'yes') || {}).count || 0;
                const no = (list.find(r => r.id === 'no') || {}).count || 0;
                svg = R.yesNoSvg(yes, no, { title: question.prompt, width: chartWidth });
                const result = R.yesNoOutcome(yes, no, { minTurnout });
                outcome = h('p', { class: `sp-outcome sp-outcome-${result.outcome}` },
                    h('span', { 'aria-hidden': 'true', text: result.outcome === 'pass' ? '✓ ' : result.outcome === 'fail' ? '✕ ' : '– ' }),
                    result.label, provisional ? h('span', { class: 'sp-muted', text: ' · provisional until an admin confirms' }) : null);
            } else {
                svg = R.barChartSvg(list, { title: question.prompt, width: chartWidth });
            }
            const chart = h('div', { class: 'sp-chart', html: svg });
            chart.firstElementChild.setAttribute('aria-hidden', 'true');
            const table = h('details', { class: 'sp-table-toggle' }, h('summary', { text: 'Show as a table' }),
                h('div', { class: 'sp-table-wrap' }, h('table', null,
                    h('thead', null, h('tr', null, h('th', { text: labelsHidden ? 'Option (name hidden)' : 'Option' }), h('th', { text: 'Selections' }))),
                    h('tbody', null, list.map(row => h('tr', null, h('td', { text: row.label }), h('td', { text: String(row.count) })))))));
            return h('figure', { class: 'sp-figure' },
                h('div', { class: 'sp-stats' },
                    h('span', null, 'Respondents ', h('strong', { text: String(respondents) })),
                    yesNo ? null : h('span', null, 'Total selections ', h('strong', { text: String(R.totalSelections(list)) }))),
                chart,
                outcome,
                labelsHidden && !yesNo ? h('p', { class: 'sp-muted sp-small', text: 'Class names are hidden until the reveal.' }) : null,
                // In compact views the summary stays available to screen readers.
                h('figcaption', { class: compact ? 'sp-visually-hidden' : 'sp-small', text: summary }),
                compact ? null : h('div', { class: 'sp-figure-tools' }, table,
                    downloads ? h('button', { type: 'button', class: 'sp-link', text: 'Download chart (PNG)', onclick: () => downloadSvgAsPng(svg, `${name}.png`) }) : null));
        });
        const shown = figures.filter(Boolean);
        fill(container,
            shown.length ? shown : h('p', { class: 'sp-muted', text: 'This poll has only written answers, so there are no charts.' }),
            downloads && shown.length ? h('button', { type: 'button', class: 'sp-secondary', text: 'Download totals (CSV)',
                onclick: () => downloadBlob(`${slug(title)}${labelsHidden ? '-names-hidden' : ''}.csv`, new Blob([R.resultsCsv(definition, totals, { labelsHidden, pollId })], { type: 'text/csv' })) }) : null);
    }

    // ---------- Season summary (drivers' page and admin preview) ----------

    function renderSummary(container, summary, { admin = false } = {}) {
        const rules = summary.rules || [];
        fill(container,
            h('h2', { class: 'sp-summary-title', text: summary.title }),
            summary.intro ? h('p', { class: 'sp-muted', text: summary.intro }) : null,
            h('h3', { text: 'Car class' }),
            summary.winner ? h('p', { class: 'sp-summary-winner' }, h('strong', { text: summary.winner.label }), summary.winner.explanation ? h('span', { class: 'sp-muted', text: ` — ${summary.winner.explanation}` }) : null) : h('p', { class: 'sp-muted', text: 'Not decided yet.' }),
            h('h3', { text: 'Calendar' }),
            (summary.calendar || []).length ? h('ol', { class: 'sp-events sp-events-summary' }, summary.calendar.map((e, i) => h('li', { class: 'sp-event' },
                h('span', { class: 'sp-event-number', text: String(i + 1) }),
                h('img', { class: 'sp-thumb', src: e.imagePath || 'Logos_and_icons/racetracks/TBD.png', alt: '' }),
                h('div', null, h('div', { class: 'sp-item-title' }, e.label, ' ', h('span', { class: `sp-badge ${e.source === 'driver' ? 'sp-green' : ''}`, text: e.source === 'driver' ? 'Driver choice' : 'Random draw' })),
                    h('div', { class: 'sp-item-meta', text: [e.locationName, e.date ? P.formatDate(Date.parse(`${e.date}T12:00:00Z`)) : ''].filter(Boolean).join(' · ') })))))
                : h('p', { class: 'sp-muted', text: 'Not finalised yet.' }),
            h('h3', { text: 'Rule changes' }),
            rules.length ? h('ul', { class: 'sp-list' }, rules.map(r => h('li', { class: 'sp-item', style: 'grid-template-columns:1fr' },
                h('div', null, h('div', { class: 'sp-item-title', text: r.prompt }), h('div', { class: `sp-outcome sp-outcome-${r.outcome}` },
                    h('span', { 'aria-hidden': 'true', text: r.outcome === 'pass' ? '✓ ' : r.outcome === 'fail' ? '✕ ' : '– ' }),
                    `${r.outcome === 'pass' ? 'Accepted' : r.outcome === 'fail' ? 'Rejected' : 'No decision'} · ${r.label}`)))))
                : h('p', { class: 'sp-muted', text: 'No rule votes.' }),
            (summary.rounds || []).length ? [h('h3', { text: 'Voting rounds' }), h('ul', null, summary.rounds.map(r => h('li', null,
                h('a', { href: admin ? `season-planning-admin.html?poll=${encodeURIComponent(r.pollId)}` : `season-polls.html?poll=${encodeURIComponent(r.pollId)}&tab=results`, text: r.title }))))] : null);
    }


    window.SeasonUI = { h, fill, blankAnswers, renderForm, renderReview, renderReceipt, renderResults, answersFromBallot, answerSummary, downloadBlob, renderSummary };
})();
