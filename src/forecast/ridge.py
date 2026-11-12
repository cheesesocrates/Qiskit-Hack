"""Closed-form ridge regression in numpy (CLASSICAL; no quantum content).

Features are standardised with the training mean and standard deviation; the intercept is the
training mean of y and is not penalised. With alpha = 0 this is ordinary least squares and
matches numpy.linalg.lstsq (tested).
"""
from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass

import numpy as np

FEATURE_NAMES = ["temperature_c", "temperature_c_sq", "hour_sin1", "hour_cos1",
                 "hour_sin2", "hour_cos2", "is_weekend", "intercept"]


@dataclass
class RidgeModel:
    alpha: float
    mean: np.ndarray       # per-feature training mean
    scale: np.ndarray      # per-feature training std (1 for constant columns)
    coef: np.ndarray       # weights in standardised feature space
    intercept: float

    def predict(self, X: np.ndarray) -> np.ndarray:
        Z = (np.asarray(X, dtype=float) - self.mean) / self.scale
        return Z @ self.coef + self.intercept


def fit_ridge(X: np.ndarray, y: np.ndarray, alpha: float = 1.0) -> RidgeModel:
    """w = (Z'Z + alpha I)^-1 Z'(y - mean(y)) on standardised features Z; intercept = mean(y)."""
    X = np.asarray(X, dtype=float)
    y = np.asarray(y, dtype=float)
    mean = X.mean(axis=0)
    scale = X.std(axis=0)
    scale = np.where(scale < 1e-12, 1.0, scale)
    Z = (X - mean) / scale
    yc = y - y.mean()
    gram = Z.T @ Z + float(alpha) * np.eye(Z.shape[1])
    coef = np.linalg.solve(gram, Z.T @ yc)
    return RidgeModel(alpha=float(alpha), mean=mean, scale=scale, coef=coef, intercept=float(y.mean()))


def make_features(times: list, temperature_c: list) -> np.ndarray:
    """Rows: temperature, temperature squared, hour sin/cos (first and second harmonic), weekend flag.

    The intercept is handled by the model (it is listed in FEATURE_NAMES for transparency).
    """
    rows = []
    for t, temp in zip(times, temperature_c):
        hour = int(t[11:13])
        weekend = 1.0 if _dt.date.fromisoformat(t[:10]).weekday() >= 5 else 0.0
        ang = 2.0 * np.pi * hour / 24.0
        rows.append([temp, temp * temp, np.sin(ang), np.cos(ang), np.sin(2 * ang), np.cos(2 * ang), weekend])
    return np.asarray(rows, dtype=float)


def regression_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    err = y_true - y_pred
    ss_res = float((err ** 2).sum())
    ss_tot = float(((y_true - y_true.mean()) ** 2).sum())
    return {"mae_mw": float(np.abs(err).mean()),
            "rmse_mw": float(np.sqrt((err ** 2).mean())),
            "r2": float(1.0 - ss_res / ss_tot) if ss_tot > 0 else 0.0}
