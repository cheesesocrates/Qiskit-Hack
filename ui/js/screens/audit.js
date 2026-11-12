// Screen 3: Audit. Score any schedule against the four rules and list every violation.
// Stored examples come from results/audit_example.json (src/audit/rules.py). "Edit this plan"
// re-checks the edited plan in the browser with ui/js/rules.js, which uses the same rules and score.
import { el, fmt, clock } from '../util.js';
import { icon } from '../icons.js';
import { naPanel, panel, segmented, table, kpi, passChip } from '../components/common.js';
import { explainPanel, pageHeader, rawJson } from '../explain.js';
import { term } from '../glossary.js';
import { planGrid } from '../components/planGrid.js';
import { RULES, checkPlan } from '../rules.js';

export default {
  id: 'audit',
  title: 'Audit',
  async mount({ root, results, params }) {
    const page = el('div', { class: 'page' }, pageHeader('Does this schedule follow the rules?', 'Replay and rules: rule checker (was Audit)',
      'Pick an example or edit one by clicking cells. The checker lists every broken rule in plain words.'));
    root.append(page);
    const aud = results.ok('audit_example');
    if (!aud) {
      page.append(explainPanel('rules', { what: 'A checker for any schedule.', how: 'Not available.', notice: null, not: 'Not available.' }), naPanel(results.get('audit_example')));
      return { destroy() {} };
    }

    const inst = aud.instance;
    const ex = aud.examples;
    const S = { i: 0, editing: false, M: null, undo: [] };
    const rules = aud.rules;

    const gridHost = el('div');
    const resultHost = el('div', { class: 'stack' });
    const editBtn = el('button', { type: 'button', class: 'btn' }, icon('audit', 18), 'Edit this plan');
    const resetBtn = el('button', { type: 'button', class: 'btn', hidden: true }, icon('reload', 18), 'Reset');
    const undoBtn = el('button', { type: 'button', class: 'btn', hidden: true, disabled: true }, icon('arrowl', 18), 'Undo');
    const sourceNote = el('p', { class: 'subtle' });

    const seg = segmented({
      label: 'Example schedule',
      options: ex.map((e, i) => ({ value: i, label: e.label })),
      value: 0,
      onChange: (i) => { S.i = i; S.editing = false; S.M = null; S.undo = []; render(); },
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
        onToggle: (t, f) => { S.undo.push(S.M.map((r) => r.slice())); S.M = S.M.map((r) => r.slice()); S.M[t][f] = S.M[t][f] ? 0 : 1; render(); },
      });
      gridHost.replaceChildren(g.root);
      editBtn.hidden = S.editing;
      resetBtn.hidden = !S.editing;
      undoBtn.hidden = !S.editing;
      undoBtn.disabled = !S.undo.length;
      sourceNote.textContent = edited
        ? 'Edited plan, re-checked in the browser with the same four rules and the same score as src/audit/rules.py.'
        : `Result stored by ${aud.source}. Click "Edit this plan" to change cells and re-check.`;

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
        el('div', { class: `callout${res.passed ? '' : ' callout--honest'}`, role: 'status' }, el('div', { class: 'row' }, passChip(res.passed, 'This schedule passes every rule', 'This schedule breaks the rules'),
          el('b', null, res.passed ? 'Nothing to fix.' : `${res.violations.length} problem${res.violations.length === 1 ? '' : 's'} found. Red outlines in the grid show where.`))),
        el('div', { class: 'kpis' },
          kpi('Checks passed', `${fmt(res.score, 0)}%`, 'Share of the individual checks (one per hour, feeder and rule) that pass')),
        perRule,
        el('div', null, el('h3', { class: 'sec-h' }, 'Violations'), viol));
    }

    editBtn.addEventListener('click', () => { S.editing = true; S.undo = []; S.M = ex[S.i].matrix.map((r) => r.slice()); render(); });
    resetBtn.addEventListener('click', () => { S.editing = false; S.M = null; S.undo = []; render(); });
    undoBtn.addEventListener('click', () => { if (S.undo.length) { S.M = S.undo.pop(); render(); } });

    const passedN = ex.filter((e) => e.passed).length;
    page.append(
      explainPanel('rules', {
        what: [el('span', null, 'An ', term('audit'), ' of one schedule in the heatwave scenario (synthetic feeders): hours down, feeders across.')],
        how: ['Pick an example. Each cell says On, Off or Protected with an icon.', 'A red outline marks a cell that breaks a rule. Click "Edit this plan", then click cells to switch them; Undo and Reset are next to it.'],
        notice: [`The four rules: exactly the ${term('quota', 'quota').textContent} of feeders off each hour; protected feeders never off; at most ${rules.max_consecutive} hour${rules.max_consecutive === 1 ? '' : 's'} in a row off; at most ${rules.max_daily_hours} hours in a day, counting hours already served.`,
          `${passedN} of ${ex.length} examples pass. ${ex.filter((e) => !e.passed).map((e) => e.label).join(' and ')} ${ex.length - passedN === 1 ? 'breaks' : 'break'} the rules.`],
        not: ['Which plan is best: a plan can pass every rule and still score badly.', 'Real feeders: the scenario is synthetic.'],
      }),
      panel('Schedule', 'Hours down, feeders across.',
        el('div', { class: 'stack' }, el('span', { class: 'field-label' }, 'Example'), el('div', { class: 'row' }, seg.root), el('div', { class: 'row' }, editBtn, undoBtn, resetBtn), gridHost, sourceNote)),
      panel('Result', null, resultHost),
      rawJson('results/audit_example.json', aud));
    render();
    return { destroy() {} };
  },
};
