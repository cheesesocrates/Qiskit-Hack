"""MOCK quantum-side fixtures (ablation, lottery, pareto, checks, risk, counting, scaling).

Everything here is invented to exercise the UI. Not real results.
"""
import math
import random

from fixture_core import (SEED, TERMS, SRC, meta, breakdown, cost, entropy, std_hours, to_bits,
                          valid_plans, write, free_ids, plan_row, round_robin)

MOCK = "MOCK FIXTURE - invented numbers, not real results."


def make_pareto(base, plans):
    bds = [breakdown(base, M) for M in plans]
    pts = []
    for i, wf in enumerate([0.0, 0.5, 1.0, 2.0, 4.0, 8.0]):
        w = dict(base["weights"], fairness=wf)
        costs = [sum(w[k] * b[k] for k in TERMS) for b in bds]
        j = min(range(len(plans)), key=lambda k: costs[k])
        M = plans[j]
        pts.append({"fairness_weight": wf, "plan": {"bits": to_bits(M), "matrix": M},
                    "cost": costs[j], "breakdown": bds[j], "fairness_metric": std_hours(base, M),
                    "fairness_entropy": entropy(base, M), "hardship_total": bds[j]["hardship"],
                    "exact_cost": costs[j], "matches_exact": i != 5, "p_optimal": round(0.9 - 0.08 * i, 3)})
    return pts


def make_ablation(base, ref):
    n_valid = sum(1 for _ in valid_plans(base))
    rr = round_robin(base)
    rr_ratio = (ref["cost_max"] - cost(base, rr)) / (ref["cost_max"] - ref["cost_min"])
    rows = []

    def row(method, label, kind, q, layers, shots, feas, popt, ratio, ent, rt, notes):
        rows.append({"method": method, "label": label, "kind": kind, "instance": base["name"],
                     "n_qubits": q, "layers": layers, "shots": shots, "feasibility_pct": feas,
                     "p_optimal": popt, "approx_ratio": ratio, "fairness_entropy": ent,
                     "runtime_s": rt, "best_cost": ref["cost_min"], "best_bits": None, "notes": notes})
    row("exact", "Exact brute force", "classical", None, None, None, 100.0, 1.0, 1.0, 0.97, 0.012, "Enumerates all valid plans.")
    row("round_robin", "Round-robin", "classical", None, None, None, 100.0, 0.0, round(rr_ratio, 4), 0.95, 0.0002, "No optimisation.")
    row("random_valid", "Random valid", "classical", None, None, 300, 100.0, 0.0007, 0.62, 0.94, 0.001, "Mean over 300 draws.")
    row("penalty_qaoa", "Penalty QAOA (X mixer)", "quantum", 24, 3, 4096, 3.1, 0.0004, 0.05, 0.9, 41.2, "Weak baseline: quota is a soft penalty.")
    row("xy_qaoa", "Dicke + XY-mixer QAOA", "quantum", 18, 3, 4096, 100.0, 0.021, 0.83, 0.96, 38.5, "Feasible by construction.")
    row("grover_mixer", "Grover-mixer QAOA", "quantum", 18, 3, 4096, 100.0, 0.034, 0.88, 0.97, 29.1, "Equal-cost plans get equal probability.")
    row("grover_adaptive", "Grover adaptive search (4x2 block)", "quantum", 8, None, None, 100.0, 1.0, 1.0, 0.96, 6.4, "Small block comparator.")
    return {**meta(), "instance_name": base["name"],
            "reference": {"cost_min": ref["cost_min"], "cost_max": ref["cost_max"], "n_valid": n_valid, "n_optimal": 1},
            "rows": rows, "notes": MOCK}


def make_lottery(base, plans, costs):
    cmin, tau, shots = min(costs), 3.0, 4096
    wts = [math.exp(-(c - cmin) / tau) for c in costs]
    s = sum(wts)
    probs = [w / s for w in wts]
    N, T = base["n_feeders"], base["n_hours"]
    marg = [[sum(p * M[t][f] for p, M in zip(probs, plans)) for f in range(N)] for t in range(T)]
    order = sorted(range(len(plans)), key=lambda i: -probs[i])[:12]
    samples = [{"bits": to_bits(plans[i]), "count": int(round(probs[i] * shots)), "prob": probs[i],
                "cost": costs[i], "feasible": True, "is_optimal": costs[i] <= cmin + 1e-9} for i in order]
    groups = {}
    for p, c in zip(probs, costs):
        groups.setdefault(round(c, 6), []).append(p)
    ties = [{"cost": k, "n_plans": len(v), "prob_min": min(v), "prob_max": max(v), "prob_spread": max(v) - min(v)}
            for k, v in sorted(groups.items()) if len(v) >= 2][:8]
    return {**meta(), "method": "grover_mixer_qaoa", "instance_name": base["name"], "shots": shots,
            "n_qubits": 18, "layers": 3, "all_feasible": True, "samples": samples, "marginals": marg,
            "expected_hours": [sum(marg[t][f] for t in range(T)) for f in range(N)],
            "tie_groups": ties, "notes": MOCK}


def make_misc(out, base, block):
    names = [("C01", "Cost model equals classical cost", True), ("C02", "QUBO equals direct cost on all bitstrings", True),
             ("C03", "Baselines are valid plans", True), ("Q01", "Dicke preparation gives uniform weight-m states", True),
             ("Q02", "Sampled XY and Grover-mixer plans satisfy quota and protected rules", True),
             ("Q03", "Equal-cost plans get equal Grover-mixer amplitude", True),
             ("Q04", "Qubit-to-plan bit order is correct", True), ("Q05", "Counting is within tolerance of enumeration", True),
             ("Q06", "Risk estimate within tolerance of exact CVaR", False), ("S01", "All results JSON validates against schemas", True),
             ("U01", "Dashboard loads all seven screens with no console errors", True)]
    area = {"C": "classical", "Q": "quantum", "S": "shared", "U": "ui"}
    checks = [{"id": i, "name": n, "passed": p, "detail": (MOCK if p else "MOCK failure to exercise the UI."),
               "area": area[i[0]], "test": f"tests/mock/test_{i.lower()}.py"} for i, n, p in names]
    npass = sum(1 for c in checks if c["passed"])
    write("checks.json", {**meta(), "checks": checks, "summary": {"total": len(checks), "passed": npass, "failed": len(checks) - npass}})

    n_valid = sum(1 for _ in valid_plans(block))
    write("counting.json", {**meta(), "method": "quantum_counting_iae",
          "instance": {"n_feeders": 4, "n_hours": 2, "quotas": block["quotas"], "protected": [1]},
          "n_qubits_search": 8, "n_qubits_total": 12, "search_space": 256, "exact_count": n_valid,
          "estimated_count": n_valid + 0.31, "estimated_count_rounded": n_valid, "ci": [n_valid - 0.9, n_valid + 1.5],
          "tolerance": 1.0, "within_tolerance": True, "epsilon_target": 0.01, "confidence_alpha": 0.05,
          "oracle_queries": 412, "flexibility_bits": math.log2(n_valid), "notes": MOCK})

    labels = ["Forecast", "+10% shortfall", "+20% shortfall", "+35% shortfall", "+50% shortfall"]
    probs = [0.45, 0.27, 0.15, 0.09, 0.04]
    loss = [0.0, 1.5, 4.0, 7.5, 12.0]
    alpha = 0.9
    el = sum(p * l for p, l in zip(probs, loss))
    cum, var = 0.0, loss[-1]
    for p, l in zip(probs, loss):
        cum += p
        if cum >= alpha - 1e-12:
            var = l
            break
    cvar = var + sum(p * max(0, l - var) for p, l in zip(probs, loss)) / (1 - alpha)
    tail = sum(p for p, l in zip(probs, loss) if l >= var)
    write("risk.json", {**meta(), "method": "iterative_amplitude_estimation",
          "block": {"n_feeders": 4, "feeder_ids": [0, 1, 2, 3], "critical_feeder_ids": [1], "description": "4-feeder block with the hospital feeder"},
          "alpha": alpha, "loss_unit": "customer-hours", "residual_source": "forecast residuals (MOCK)",
          "scenarios": [{"label": a, "shortfall_extra_mw": 2.5 * i, "prob": p, "loss": l} for i, (a, p, l) in enumerate(zip(labels, probs, loss))],
          "n_qubits": 7, "epsilon_target": 0.01, "confidence_alpha": 0.05, "oracle_queries": 3340,
          "exact": {"expected_loss": el, "tail_prob": tail, "var": var, "cvar": cvar},
          "estimated": {"expected_loss": el * 1.01, "expected_loss_ci": [el * 0.97, el * 1.05],
                        "tail_prob": tail * 0.98, "tail_prob_ci": [tail * 0.9, tail * 1.1],
                        "var": var, "cvar": cvar * 0.99, "cvar_ci": [cvar * 0.93, cvar * 1.06]},
          "within_tolerance": True, "notes": MOCK})

    pts = []
    for n in (6, 8, 10, 12):
        for chi in (2, 4, 8, 16):
            if n == 12 and chi == 16:
                pts.append({"n_feeders": n, "n_hours": 2, "n_qubits": n * 2 - 4, "bond_dim": chi, "simulator": "aer_mps",
                            "approx_ratio": None, "feasibility_pct": None, "exact_cost_min": None, "exact_cost_max": None,
                            "exact_method": None, "best_sampled_cost": None, "runtime_s": None, "status": "skipped",
                            "notes": "MOCK: skipped, over the time budget."})
                continue
            ratio = max(0.2, 0.55 + 0.1 * math.log2(chi) - 0.02 * (n - 6)) if True else 0
            pts.append({"n_feeders": n, "n_hours": 2, "n_qubits": n * 2 - 4, "bond_dim": chi, "simulator": "aer_mps",
                        "approx_ratio": min(0.99, ratio), "feasibility_pct": 100.0, "exact_cost_min": 10.0 + n,
                        "exact_cost_max": 40.0 + 3 * n, "exact_method": "brute_force", "best_sampled_cost": 10.0 + n,
                        "runtime_s": 0.5 * chi * n / 6, "status": "ok", "notes": ""})
        pts.append({"n_feeders": n, "n_hours": 2, "n_qubits": n * 2 - 4, "bond_dim": None, "simulator": "aer_statevector",
                    "approx_ratio": 0.97 - 0.01 * (n - 6), "feasibility_pct": 100.0, "exact_cost_min": 10.0 + n,
                    "exact_cost_max": 40.0 + 3 * n, "exact_method": "brute_force", "best_sampled_cost": 10.0 + n,
                    "runtime_s": 0.3 * n, "status": "ok" if n <= 10 else "failed",
                    "notes": "" if n <= 10 else "MOCK: statevector out of memory."})
    write("scaling.json", {**meta(), "method": "grover_mixer_qaoa", "layers": 2, "shots": 2048,
          "parameter_source": "MOCK: parameters transferred from the 8x3 optimum", "points": pts, "notes": MOCK})
