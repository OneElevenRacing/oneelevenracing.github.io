// Season-poll results: ranked rows, hidden class names, rule outcomes, text
// summaries, SVG charts and CSV. No Firebase or page code (browser global
// SeasonResults; also used by Node tests).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./catalogue.js'));
    else root.SeasonResults = factory(root.OneElevenCatalogue);
})(typeof self !== 'undefined' ? self : this, function (C) {
    'use strict';

    const INK = '#111111';
    const BAR = '#c40000';
    const MUTED = '#5f5f5f';
    const TRACK = '#ececec';
    const YES = '#2a78d6';
    const NO = '#eb6834';
    const FONT = 'Arial, Helvetica, sans-serif';

    const optionsOf = question => Object.entries((question && question.options) || {});

    // A small deterministic hash, so hidden labels are stable for a poll but
    // unrelated to the ballot order.
    function hash(text) {
        let h = 2166136261;
        for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
        return h >>> 0;
    }

    const letters = n => {
        let s = '';
        for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
        return s;
    };

    function hiddenNoun(question) {
        if (question.type === 'track') return 'Track';
        if (question.type === 'class' || question.type === 'nomination') return 'Class';
        return 'Option';
    }

    // Neutral labels ("Class C") that stay the same for each option while totals change.
    function hiddenLabels(pollId, questionIndex, question) {
        const ids = optionsOf(question).map(([id]) => id)
            .sort((a, b) => hash(`${pollId}|${questionIndex}|${a}`) - hash(`${pollId}|${questionIndex}|${b}`) || a.localeCompare(b));
        const noun = hiddenNoun(question);
        return Object.fromEntries(ids.map((id, i) => [id, `${noun} ${letters(i)}`]));
    }

    // Rows sorted by total (highest first), never by ballot order.
    function rows(definition, questionIndex, totals, { labelsHidden = false, pollId = '' } = {}) {
        const question = definition.questions[questionIndex];
        const counts = (totals && totals.questions && totals.questions[questionIndex] && totals.questions[questionIndex].options) || {};
        const hidden = labelsHidden ? hiddenLabels(pollId, questionIndex, question) : null;
        return optionsOf(question).map(([id, option]) => ({
            id,
            label: hidden ? hidden[id] : option.label,
            count: Number(counts[id]) || 0
        })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'en', { numeric: true, sensitivity: 'base' }));
    }

    const totalSelections = list => list.reduce((sum, row) => sum + row.count, 0);

    // Rule votes: pass only when Yes beats No; nobody voting is no decision.
    function yesNoOutcome(yes, no, { minTurnout = 0 } = {}) {
        const votes = yes + no;
        if (!votes) return { outcome: 'none', label: 'No decision — nobody voted' };
        if (minTurnout && votes < minTurnout) return { outcome: 'none', label: `No decision — fewer than ${minTurnout} votes` };
        return yes > no
            ? { outcome: 'pass', label: `Passes (${yes} Yes, ${no} No)` }
            : { outcome: 'fail', label: yes === no ? `Fails on a tie (${yes} each)` : `Fails (${yes} Yes, ${no} No)` };
    }

    const percent = (n, total) => (total ? Math.round((n / total) * 100) : 0);

    // Plain-language summary for screen readers, exports and anyone not reading the chart.
    function summaryText(list, { respondents = 0, labelsHidden = false, yesNo = false, minTurnout = 0 } = {}) {
        const total = totalSelections(list);
        const people = `${respondents} ${respondents === 1 ? 'driver' : 'drivers'} responded`;
        if (yesNo) {
            const yes = (list.find(r => r.id === 'yes') || { count: 0 }).count;
            const no = (list.find(r => r.id === 'no') || { count: 0 }).count;
            return `${people}. Yes ${yes} (${percent(yes, yes + no)}%), No ${no} (${percent(no, yes + no)}%). ${yesNoOutcome(yes, no, { minTurnout }).label}.`;
        }
        if (!total) return `${people}. No selections yet.`;
        const ranked = list.filter(r => r.count).map(r => `${r.label} ${r.count}`).join(', ');
        return `${people}, making ${total} ${total === 1 ? 'selection' : 'selections'} in total. ${labelsHidden ? 'Class names are hidden. ' : ''}Ranked: ${ranked}.`;
    }

    const esc = text => String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

    // Shortens a label to fit roughly `width` pixels of 13px Arial.
    function fit(label, width) {
        const max = Math.max(4, Math.floor(width / 7));
        return label.length > max ? `${label.slice(0, max - 1)}…` : label;
    }

    // Splits a title into lines that fit roughly `width` pixels of 16px bold Arial.
    function wrap(text, width) {
        const max = Math.max(12, Math.floor(width / 9.5));
        const lines = [];
        String(text).split(/\s+/).forEach(word => {
            const last = lines[lines.length - 1];
            if (last !== undefined && `${last} ${word}`.length <= max) lines[lines.length - 1] = `${last} ${word}`;
            else lines.push(word);
        });
        return lines;
    }

    function titleBlock(title, subtitle, width) {
        const lines = title ? wrap(title, width) : [];
        let y = 0;
        const parts = lines.map((line, i) => `<text x="0" y="${(y = 20 + i * 21)}" font-size="16" font-weight="700" fill="${INK}">${esc(line)}</text>`);
        if (subtitle) parts.push(`<text x="0" y="${(y += 22)}" font-size="13" fill="${MUTED}">${esc(subtitle)}</text>`);
        return { svg: parts.join(''), height: lines.length || subtitle ? y + 18 : 8 };
    }

    // Rounded-end bar path (also used to animate a bar's width on the page).
    function barPath(x0, cy, bar, w) {
        if (!(w > 0)) return '';
        const r = Math.min(4, w / 2);
        return `M${x0},${cy - bar / 2}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${bar - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${w - r}z`;
    }

    // Horizontal bar chart: one series, so one colour and no legend; the value
    // sits at each bar's tip. Bars are at most 20px thick with a rounded end.
    // data-* attributes let the page animate each row; they don't affect exports.
    function barChartSvg(list, { title = '', subtitle = '', width = 640 } = {}) {
        const labelWidth = Math.min(200, Math.round(width * 0.32));
        const valueWidth = 44;
        const rowHeight = 28;
        const bar = 18;
        const heading = titleBlock(title, subtitle, width);
        const top = heading.height;
        const height = top + Math.max(1, list.length) * rowHeight + 8;
        const plot = width - labelWidth - valueWidth - 16;
        const max = Math.max(1, ...list.map(r => r.count));
        const parts = [heading.svg];
        list.forEach((row, i) => {
            const y = top + i * rowHeight;
            const cy = y + rowHeight / 2;
            const w = row.count ? Math.max(4, (row.count / max) * plot) : 0;
            const x0 = labelWidth;
            parts.push(`<g data-row="${esc(String(row.id || row.label))}" data-y="${y}" data-w="${w}" data-count="${row.count}" data-x0="${x0}" data-cy="${cy}" data-bar="${bar}"><title>${esc(`${row.label}: ${row.count}`)}</title>`
                + `<text x="${labelWidth - 10}" y="${cy + 4.5}" font-size="13" text-anchor="end" fill="${INK}">${esc(fit(row.label, labelWidth - 12))}</text>`
                + `<rect x="${x0}" y="${cy - bar / 2}" width="${plot}" height="${bar}" fill="${TRACK}"/>`
                + `<path class="sp-bar" d="${barPath(x0, cy, bar, w)}" fill="${BAR}"/>`
                + `<text class="sp-bar-value" x="${x0 + plot + 8}" y="${cy + 4.5}" font-size="13" font-weight="700" fill="${INK}">${row.count}</text></g>`);
        });
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="${FONT}" role="img">`
            + `<rect width="100%" height="100%" fill="#ffffff"/>${parts.join('')}</svg>`;
    }

    // Yes/No split bar: two segments with a 2px gap, direct labels and a legend line.
    // Both segments are always drawn (an empty one has no width) so they can animate.
    function yesNoSvg(yes, no, { title = '', width = 640 } = {}) {
        const total = yes + no;
        const heading = titleBlock(title, '', width);
        const top = heading.height;
        const bar = 24;
        const height = top + bar + 40;
        const parts = [heading.svg];
        parts.push(`<rect x="0" y="${top}" width="${width}" height="${bar}" rx="4" fill="${TRACK}"/>`);
        const gap = yes && no ? 2 : 0;
        const yesW = total ? ((width - gap) * yes) / total : 0;
        const noW = total ? width - gap - yesW : 0;
        parts.push(`<g><title>Yes: ${yes}</title><rect data-seg="yes" x="0" y="${top}" width="${yesW}" height="${bar}" rx="4" fill="${YES}"/></g>`);
        parts.push(`<g><title>No: ${no}</title><rect data-seg="no" data-end="${width}" x="${width - noW}" y="${top}" width="${noW}" height="${bar}" rx="4" fill="${NO}"/></g>`);
        const ly = top + bar + 24;
        parts.push(`<rect x="0" y="${ly - 10}" width="12" height="12" rx="2" fill="${YES}"/>`
            + `<text x="18" y="${ly}" font-size="13" fill="${INK}">Yes ${yes} (${percent(yes, total)}%)</text>`
            + `<rect x="${width - 130}" y="${ly - 10}" width="12" height="12" rx="2" fill="${NO}"/>`
            + `<text x="${width - 112}" y="${ly}" font-size="13" fill="${INK}">No ${no} (${percent(no, total)}%)</text>`);
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="${FONT}" role="img">`
            + `<rect width="100%" height="100%" fill="#ffffff"/>${parts.join('')}</svg>`;
    }

    // CSV of totals in the same label mode as the chart.
    function resultsCsv(definition, totals, options = {}) {
        const out = [['question', 'option', 'selections', 'respondents']];
        const respondents = (totals && totals.respondents) || 0;
        for (let i = 0; i < definition.questionCount; i++) {
            const question = definition.questions[i];
            if (!question || question.kind === 'text') continue;
            rows(definition, i, totals, options).forEach(row => out.push([question.prompt, row.label, row.count, respondents]));
        }
        return C.toCsv(out);
    }

    return { INK, YES, NO, hiddenLabels, rows, totalSelections, yesNoOutcome, percent, summaryText, barPath, barChartSvg, yesNoSvg, resultsCsv };
});
