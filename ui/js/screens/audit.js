// Screen 3: Audit. Score any schedule against the four rules and list every violation.
// Stored examples come from results/audit_example.json (src/audit/rules.py). "Edit this plan"
// re-checks the edited plan in the browser with ui/js/rules.js, which uses the same rules and score.
import { el, fmt, clock } from '../util.js';
import { icon } from '../icons.js';
import { naPanel, panel, pageHead, segmented, table, kpi, passChip } from '../components/common.js';
import { planGrid } from '../components/planGrid.js';
import { RULES, checkPlan } from '../rules.js';

export default {
  id: 'audit',
  title: 'Audit',
  async mount({ root, results, params }) {
    const page = el('div', { class: 'page' }, pageHead('Audit', 'Score any schedule against four rules: quota, protected feeders, maximum consecutive hours and daily hours. Every violation is listed.'));
    root.append(page);
    const aud = results.ok('audit_example');
    if (!aud) { page.append(naPanel(results.get('audit_example'))); return { destroy() {} }; }

    const inst = aud.instance;
    const ex = aud.examples;
    const S = { i: 0, editing: false, M: null };
    const rules = aud.rules;

    const gridHost = el('div');
    const resultHost = el('div', { class: 'stack' });
    const editBtn = el('button', { type: 'button', class: 'btn' }, icon('audit', 18), 'Edit this plan');
    const resetBtn = el('button', { type: 'button', class: 'btn', hidden: true }, icon('reload', 18), 'Reset');
    const sourceNote = el('p', { class: 'subtle' });

    const seg = segmented({
      label: 'Example schedule',
      options: ex.map((e, i) => ({ value: i, label: e.label })),
      value: 0,
      onChange: (i) => { S.i = i; S.editing = false; S.M = null; render(); },
    });

    function current() {
      const e = ex[S.i];
      if (!S.editing || !S.M) return { M: e.matrix, res: { passed: e.passed, score: e.score, violations: e.violations, per_rule: e.per_rule }, edited: false };
      const res = checkPlan(inst, S.M, rules);
      return { M: S.M, res, edited: true };
    }

    function render() {
      const { M, res, edited } = current();
      const g = planGrid({
        inst, matrix: M, violations: res.violations, editable: S.editing, debug: params.debug,
        label: `Schedule: ${ex[S.i].label}`,
        onToggle: (t, f) => { S.M = S.M.map((r) => r.slice()); S.M[t][f] = S.M[t][f] ? 0 : 1; render(); },
      });
      gridHost.replaceChildren(g.root);
      editBtn.hidden = S.editing;
      resetBtn.hidden = !S.editing;
      sourceNote.textContent = edited
        ? 'Edited plan, re-checked in the browser with the same four rules and the same score as src/audit/rules.py.'
        : `Stored result from ${aud.source} (method: ${ex[S.i].method}).`;

      const perRule = table([
        { label: 'Rule', render: (r) => el('div', null, el('div', { class: 'm-name' }, r.label), el('div', { class: 'subtle' }, r.hint)) },
        { label: 'Result', render: (r) => passChip(res.per_rule[r.id].passed) },
        { label: 'Violations', num: true, render: (r) => String(res.per_rule[r.id].count) },
      ], RULES);
      const viol = res.violations.length
        ? table([
          { label: 'Rule', render: (v) => (RULES.find((r) => r.id === v.rule) || { label: v.rule }).label },
          { label: 'Hour', render: (v) => (v.hour === null || v.hour === undefined ? 'all' : clock(inst.start_hour, v.hour)) },
          { label: 'Feeder', render: (v) => (v.feeder === null || v.feeder === undefined ? 'n/a' : inst.feeders[v.feeder].name) },
          { label: 'Detail', cls: 'note', render: (v) => v.detail },
        ], res.violations)
        : el('p', { class: 'subtle' }, 'No violations.');
      resultHost.replaceChildren(
        el('div', { class: 'kpis' },
          kpi('Audit score', `${fmt(res.score, 1)}%`, 'Share of individual checks that pass'),
          kpi('Verdict', null, res.passed ? 'Every rule passes' : `${res.violations.length} violation${res.violations.length === 1 ? '' : 's'}`, passChip(res.passed, 'Passes', 'Fails'))),
        perRule,
        el('div', null, el('h3', { class: 'sec-h' }, 'Violations'), viol));
    }

    editBtn.addEventListener('click', () => { S.editing = true; S.M = ex[S.i].matrix.map((r) => r.slice()); render(); });
    resetBtn.addEventListener('click', () => { S.editing = false; S.M = null; render(); });

    page.append(
      el('div', { class: 'callout' }, `Scenario ${aud.scenario} (synthetic feeders). Rules from the instance: at most ${rules.max_consecutive} consecutive hour${rules.max_consecutive === 1 ? '' : 's'} off, at most ${rules.max_daily_hours} hours a day including the ledger.`),
      panel('Schedule', 'Hours down, feeders across. Violating cells are outlined with a warning icon.',
        el('div', { class: 'stack' }, el('div', { class: 'row' }, seg.root, editBtn, resetBtn), gridHost, sourceNote)),
      panel('Result', null, resultHost));
    render();
    return { destroy() {} };
  },
};
