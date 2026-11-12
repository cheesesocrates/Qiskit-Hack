"""Risk (amplitude estimation) checks (Area 1)."""
from __future__ import annotations

import numpy as np
import pytest

from src.quantum.risk import _circuit, _estimate, _scenario_register, exact_measures


def test_exact_measures_small_distribution():
    losses = np.array([0.0, 0.0, 1.0, 3.0])
    probs = np.array([0.5, 0.3, 0.15, 0.05])
    m = exact_measures(losses, probs, alpha=0.9)
    assert m["expected_loss"] == pytest.approx(0.3)
    assert m["tail_prob"] == pytest.approx(0.2)
    assert m["var"] == pytest.approx(1.0)                      # P(L<=0)=0.8 < 0.9, P(L<=1)=0.95
    assert m["cvar"] == pytest.approx((0.15 * 1 + 0.05 * 3) / 0.2)


@pytest.mark.check(id="Q12", name="Amplitude estimation of expected loss and tail probability matches the exact values")
def test_iae_matches_exact(check_detail):
    losses = np.array([0.0, 0.0, 1.0, 3.0])
    probs = np.array([0.5, 0.3, 0.15, 0.05])
    k, prep = _scenario_register(probs)
    lmax = losses.max()
    theta = {i: 2 * np.arcsin(np.sqrt(L / lmax)) for i, L in enumerate(losses)}
    a, ci, _q = _estimate(_circuit(prep, k, angles=theta), k, seed=7)
    exact = exact_measures(losses, probs)
    assert ci[0] - 0.01 <= exact["expected_loss"] / lmax <= ci[1] + 0.01
    t, tci, _q = _estimate(_circuit(prep, k, flips=[2, 3]), k, seed=8)
    assert tci[0] - 0.01 <= exact["tail_prob"] <= tci[1] + 0.01
    check_detail(f"E[L] exact {exact['expected_loss']:.4f}, estimate {a * lmax:.4f}; "
                 f"P(L>0) exact {exact['tail_prob']:.4f}, estimate {t:.4f}")
