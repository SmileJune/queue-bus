#!/usr/bin/env python3
import json
import os
from pathlib import Path

os.environ.setdefault("LOKY_MAX_CPU_COUNT", "1")

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, precision_recall_fscore_support
from xgboost import XGBRegressor


DATASET_PATH = Path("data/seatflow-training-dataset.csv")
OUTPUT_PATH = Path("data/seatflow-model-comparison.json")
REPORT_PATH = Path("docs/24-seatflow-model-comparison.md")

FEATURE_COLUMNS = [
    "target_station_seq",
    "before_station_seq",
    "remaining_stops",
    "before_remain_seat_count",
    "kst_minute_sin",
    "kst_minute_cos",
    "kst_hour",
    "is_commute_peak",
    "seat_risk_code",
    "day_of_week",
    "is_weekend",
    "direction_code",
]
TARGET_COLUMN = "target_remain_seat_count"
MODEL_NAMES = [
    "baseline",
    "randomForest",
    "lightgbm",
    "xgboost",
    "lightgbmPeriodSpecialized",
    "lightgbmRiskSpecialized",
]


def main():
    df = load_dataset(DATASET_PATH)
    latest_date = sorted(df["kst_date"].unique())[-1]
    train_df = df[df["kst_date"] != latest_date].copy().reset_index(drop=True)
    validation_df = df[df["kst_date"] == latest_date].copy().reset_index(drop=True)

    models = build_models()
    latest_holdout = {}
    date_cv = {}
    latest_predictions = {}
    train_predictions_by_model = {}

    baseline_model = fit_baseline(train_df)
    baseline_train_predictions = predict_baseline(baseline_model, train_df)
    baseline_validation_predictions = predict_baseline(baseline_model, validation_df)
    baseline_thresholds = calibrate_thresholds(train_df, baseline_train_predictions)
    latest_holdout["baseline"] = evaluate_predictions(
        validation_df,
        baseline_validation_predictions,
        baseline_thresholds,
    )
    latest_predictions["baseline"] = baseline_validation_predictions
    train_predictions_by_model["baseline"] = baseline_train_predictions
    date_cv["baseline"] = run_date_cv(df, "baseline")

    for name, model in models.items():
        fitted = fit_model(model, train_df)
        train_predictions = fitted.predict(train_df[FEATURE_COLUMNS])
        thresholds = calibrate_thresholds(train_df, train_predictions)
        validation_predictions = fitted.predict(validation_df[FEATURE_COLUMNS])
        latest_holdout[name] = evaluate_predictions(validation_df, validation_predictions, thresholds)
        latest_holdout[name]["train"] = evaluate_predictions(train_df, train_predictions, thresholds)
        latest_holdout[name]["thresholds"] = thresholds
        latest_predictions[name] = validation_predictions
        train_predictions_by_model[name] = train_predictions
        date_cv[name] = run_date_cv(df, name)

    for name, segment_column, min_train_rows in [
        ("lightgbmPeriodSpecialized", "period_segment", 200),
        ("lightgbmRiskSpecialized", "seat_risk_segment", 120),
    ]:
        segmented = fit_segmented_lightgbm(train_df, segment_column, min_train_rows)
        train_predictions = predict_segmented_model(segmented, train_df)
        thresholds = calibrate_thresholds(train_df, train_predictions)
        validation_predictions = predict_segmented_model(segmented, validation_df)
        latest_holdout[name] = evaluate_predictions(validation_df, validation_predictions, thresholds)
        latest_holdout[name]["train"] = evaluate_predictions(train_df, train_predictions, thresholds)
        latest_holdout[name]["thresholds"] = thresholds
        latest_holdout[name]["segmentColumn"] = segment_column
        latest_holdout[name]["trainedSegments"] = sorted(segmented["segments"].keys())
        latest_predictions[name] = validation_predictions
        train_predictions_by_model[name] = train_predictions
        date_cv[name] = run_date_cv(df, name)

    comparison = {
        "generatedAt": pd.Timestamp.now(tz="UTC").isoformat(),
        "dataset": summarize_dataset(df),
        "split": {
            "strategy": "latest_kst_date_holdout",
            "trainRows": int(len(train_df)),
            "validationRows": int(len(validation_df)),
            "trainDates": sorted(train_df["kst_date"].unique().tolist()),
            "validationDates": [latest_date],
        },
        "latestHoldout": latest_holdout,
        "dateCrossValidation": date_cv,
        "latestSegmentBreakdown": build_segment_breakdown(validation_df, latest_predictions, latest_holdout),
        "serviceCalibration": build_service_calibration(
            train_df,
            validation_df,
            train_predictions_by_model["lightgbm"],
            latest_predictions["lightgbm"],
            latest_holdout["lightgbm"]["thresholds"],
        ),
        "bestByLatestHoldoutMae": min(
            [name for name in latest_holdout.keys() if name != "baseline"],
            key=lambda name: latest_holdout[name]["mae"],
        ),
        "bestByDateCvMae": min(
            [name for name in date_cv.keys() if name != "baseline"],
            key=lambda name: date_cv[name]["summary"]["maeMean"],
        ),
    }

    OUTPUT_PATH.write_text(json.dumps(comparison, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    REPORT_PATH.write_text(build_report(comparison), encoding="utf-8")

    print(f"[seatflow:compare] dataset rows={len(df)}")
    print(f"[seatflow:compare] latest validation date={latest_date}")
    for name, metrics in latest_holdout.items():
        print(
            f"[seatflow:compare] {name} holdout MAE={metrics['mae']:.2f} "
            f"RMSE={metrics['rmse']:.2f} lowF1={metrics['lowSeat']['f1']:.2f} "
            f"zeroRecall={metrics['zeroSeat']['recall']:.2f}"
        )
    print(f"[seatflow:compare] report -> {REPORT_PATH}")


def load_dataset(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["kst_hour"] = (df["kst_minute_of_day"] // 60).astype(int)
    df["is_commute_peak"] = df["kst_hour"].between(6, 9).astype(int)
    df["period_segment"] = np.where(df["is_commute_peak"] == 1, "commute_peak", "off_peak")
    df["seat_risk_segment"] = pd.cut(
        df["before_remain_seat_count"],
        bins=[-1, 0, 10, 20, 70],
        labels=["zero", "low_1_10", "mid_11_20", "safe_21_plus"],
    ).astype(str)
    df["seat_risk_code"] = df["seat_risk_segment"].map({
        "zero": 0,
        "low_1_10": 1,
        "mid_11_20": 2,
        "safe_21_plus": 3,
    })
    df["kst_minute_sin"] = np.sin((2 * np.pi * df["kst_minute_of_day"]) / 1440)
    df["kst_minute_cos"] = np.cos((2 * np.pi * df["kst_minute_of_day"]) / 1440)
    for column in FEATURE_COLUMNS + [TARGET_COLUMN, "is_low_seat", "is_zero_seat"]:
        df[column] = pd.to_numeric(df[column], errors="coerce")
    df = df.dropna(subset=FEATURE_COLUMNS + [TARGET_COLUMN]).reset_index(drop=True)
    return df


def build_models():
    return {
        "randomForest": RandomForestRegressor(
            n_estimators=250,
            max_depth=8,
            min_samples_leaf=8,
            max_features="sqrt",
            random_state=42,
            n_jobs=1,
        ),
        "lightgbm": lgb.LGBMRegressor(
            objective="regression",
            n_estimators=500,
            learning_rate=0.04,
            num_leaves=15,
            max_depth=5,
            min_child_samples=12,
            subsample=0.85,
            colsample_bytree=0.85,
            reg_alpha=0.1,
            reg_lambda=0.5,
            random_state=42,
            verbose=-1,
        ),
        "xgboost": XGBRegressor(
            objective="reg:squarederror",
            n_estimators=500,
            learning_rate=0.04,
            max_depth=4,
            min_child_weight=6,
            subsample=0.85,
            colsample_bytree=0.85,
            reg_alpha=0.1,
            reg_lambda=1.0,
            random_state=42,
            n_jobs=1,
        ),
    }


def fit_model(model, train_df):
    return model.fit(train_df[FEATURE_COLUMNS], train_df[TARGET_COLUMN])


def fit_segmented_lightgbm(train_df, segment_column, min_train_rows):
    fallback = fit_model(build_models()["lightgbm"], train_df)
    segments = {}
    for segment, segment_df in train_df.groupby(segment_column):
        if len(segment_df) < min_train_rows:
            continue
        segments[str(segment)] = fit_model(build_models()["lightgbm"], segment_df)
    return {
        "fallback": fallback,
        "segments": segments,
        "segmentColumn": segment_column,
        "minTrainRows": min_train_rows,
    }


def predict_segmented_model(model, df):
    predictions = np.asarray(model["fallback"].predict(df[FEATURE_COLUMNS]), dtype=float)
    for segment, segment_model in model["segments"].items():
        mask = df[model["segmentColumn"]].astype(str) == segment
        if mask.any():
            predictions[mask.to_numpy()] = segment_model.predict(df.loc[mask, FEATURE_COLUMNS])
    return predictions


def fit_baseline(train_df):
    global_delta = float(train_df["seat_delta"].mean())
    by_target = train_df.groupby("target_label")["seat_delta"].mean().to_dict()
    by_target_before = train_df.groupby(["target_label", "before_station_seq"])["seat_delta"].mean().to_dict()
    return {
        "globalDelta": global_delta,
        "byTarget": by_target,
        "byTargetBefore": by_target_before,
    }


def predict_baseline(model, df):
    predictions = []
    for row in df.itertuples(index=False):
        key = (row.target_label, row.before_station_seq)
        delta = model["byTargetBefore"].get(
            key,
            model["byTarget"].get(row.target_label, model["globalDelta"]),
        )
        predictions.append(max(0.0, min(70.0, float(row.before_remain_seat_count) - float(delta))))
    return np.array(predictions)


def calibrate_thresholds(df, predictions):
    return {
        "lowSeatThreshold": find_best_threshold(df["is_low_seat"].astype(bool).to_numpy(), predictions, 3, 18),
        "zeroSeatThreshold": find_best_threshold(
            df["is_zero_seat"].astype(bool).to_numpy(),
            predictions,
            0,
            12,
            recall_floor=0.65,
        ),
    }


def find_best_threshold(actual, predictions, min_value, max_value, recall_floor=None):
    best = {"threshold": min_value, "score": -1e9}
    for threshold in np.arange(min_value, max_value + 0.001, 0.5):
        predicted = predictions <= threshold
        precision, recall, f1, _ = precision_recall_fscore_support(
            actual,
            predicted,
            average="binary",
            zero_division=0,
        )
        score = f1
        if recall_floor is not None and recall < recall_floor:
            score -= (recall_floor - recall) * 2
        if score > best["score"]:
            best = {
                "threshold": float(threshold),
                "score": float(score),
                "precision": float(precision),
                "recall": float(recall),
                "f1": float(f1),
            }
    return best["threshold"]


def evaluate_predictions(df, predictions, thresholds):
    predictions = np.clip(np.asarray(predictions, dtype=float), 0, 70)
    actual = df[TARGET_COLUMN].to_numpy(dtype=float)
    errors = predictions - actual
    return {
        "rows": int(len(df)),
        "mae": round_float(mean_absolute_error(actual, predictions)),
        "rmse": round_float(np.sqrt(mean_squared_error(actual, predictions))),
        "bias": round_float(errors.mean()),
        "thresholds": thresholds,
        "lowSeat": classification_metrics(df["is_low_seat"].astype(bool).to_numpy(), predictions <= thresholds["lowSeatThreshold"]),
        "zeroSeat": classification_metrics(df["is_zero_seat"].astype(bool).to_numpy(), predictions <= thresholds["zeroSeatThreshold"]),
    }


def classification_metrics(actual, predicted):
    precision, recall, f1, _ = precision_recall_fscore_support(
        actual,
        predicted,
        average="binary",
        zero_division=0,
    )
    tp = int(np.logical_and(actual, predicted).sum())
    fp = int(np.logical_and(~actual, predicted).sum())
    tn = int(np.logical_and(~actual, ~predicted).sum())
    fn = int(np.logical_and(actual, ~predicted).sum())
    return {
        "tp": tp,
        "fp": fp,
        "tn": tn,
        "fn": fn,
        "precision": round_float(precision),
        "recall": round_float(recall),
        "f1": round_float(f1),
    }


def run_date_cv(df, model_name):
    folds = []
    dates = sorted(df["kst_date"].unique())

    for date in dates:
        train_df = df[df["kst_date"] != date]
        validation_df = df[df["kst_date"] == date]
        if len(train_df) < 100 or len(validation_df) < 30:
            continue

        if model_name == "baseline":
            baseline = fit_baseline(train_df)
            train_predictions = predict_baseline(baseline, train_df)
            thresholds = calibrate_thresholds(train_df, train_predictions)
            predictions = predict_baseline(baseline, validation_df)
        elif model_name == "lightgbmPeriodSpecialized":
            model = fit_segmented_lightgbm(train_df, "period_segment", 200)
            train_predictions = predict_segmented_model(model, train_df)
            thresholds = calibrate_thresholds(train_df, train_predictions)
            predictions = predict_segmented_model(model, validation_df)
        elif model_name == "lightgbmRiskSpecialized":
            model = fit_segmented_lightgbm(train_df, "seat_risk_segment", 120)
            train_predictions = predict_segmented_model(model, train_df)
            thresholds = calibrate_thresholds(train_df, train_predictions)
            predictions = predict_segmented_model(model, validation_df)
        else:
            model = build_models()[model_name]
            fitted = fit_model(model, train_df)
            train_predictions = fitted.predict(train_df[FEATURE_COLUMNS])
            thresholds = calibrate_thresholds(train_df, train_predictions)
            predictions = fitted.predict(validation_df[FEATURE_COLUMNS])

        metrics = evaluate_predictions(validation_df, predictions, thresholds)
        folds.append({
            "validationDate": str(date),
            "trainRows": int(len(train_df)),
            "validationRows": int(len(validation_df)),
            "mae": metrics["mae"],
            "rmse": metrics["rmse"],
            "lowSeatF1": metrics["lowSeat"]["f1"],
            "zeroSeatRecall": metrics["zeroSeat"]["recall"],
        })

    return {
        "folds": folds,
        "summary": {
            "foldCount": len(folds),
            "maeMean": round_float(np.mean([fold["mae"] for fold in folds])),
            "rmseMean": round_float(np.mean([fold["rmse"] for fold in folds])),
            "lowSeatF1Mean": round_float(np.mean([fold["lowSeatF1"] for fold in folds])),
            "zeroSeatRecallMean": round_float(np.mean([fold["zeroSeatRecall"] for fold in folds])),
        },
    }


def build_segment_breakdown(validation_df, predictions_by_model, holdout_by_model):
    return {
        "hour": evaluate_by_segment(validation_df, predictions_by_model, holdout_by_model, "kst_hour"),
        "period": evaluate_by_segment(validation_df, predictions_by_model, holdout_by_model, "period_segment"),
        "seatRisk": evaluate_by_segment(validation_df, predictions_by_model, holdout_by_model, "seat_risk_segment"),
    }


def evaluate_by_segment(df, predictions_by_model, holdout_by_model, segment_column):
    rows = []
    for segment in sorted(df[segment_column].astype(str).unique(), key=segment_sort_key):
        segment_df = df[df[segment_column].astype(str) == segment]
        row = {
            "segment": str(segment),
            "rows": int(len(segment_df)),
            "lowSeatRate": round_float(float(segment_df["is_low_seat"].mean())),
            "zeroSeatRate": round_float(float(segment_df["is_zero_seat"].mean())),
            "metrics": {},
        }
        for model_name, predictions in predictions_by_model.items():
            segment_predictions = np.asarray(predictions)[segment_df.index.to_numpy()]
            row["metrics"][model_name] = evaluate_predictions(
                segment_df,
                segment_predictions,
                holdout_by_model[model_name]["thresholds"],
            )
        rows.append(row)
    return rows


def build_service_calibration(train_df, validation_df, train_predictions, validation_predictions, thresholds):
    calibration_groups = [
        ("period", "period_segment", 80),
        ("seatRisk", "seat_risk_segment", 60),
        ("hour", "kst_hour", 30),
    ]
    corrections = []
    for group_name, column, min_rows in calibration_groups:
        corrections.extend(build_group_corrections(train_df, train_predictions, group_name, column, min_rows))

    validation_corrections = apply_group_corrections(validation_df, corrections)
    calibrated_predictions = np.clip(np.asarray(validation_predictions) - validation_corrections, 0, 70)

    return {
        "strategy": "subtract_max_segment_overprediction_p75",
        "source": "train_residuals_only",
        "corrections": corrections,
        "rawLightgbm": service_operating_metrics(validation_df, validation_predictions, thresholds),
        "calibratedLightgbm": service_operating_metrics(validation_df, calibrated_predictions, thresholds),
    }


def build_group_corrections(train_df, train_predictions, group_name, column, min_rows):
    df = train_df.copy()
    df["prediction"] = np.asarray(train_predictions, dtype=float)
    df["over_prediction"] = np.maximum(df["prediction"] - df[TARGET_COLUMN], 0)
    corrections = []
    for segment, group_df in df.groupby(column):
        if len(group_df) < min_rows:
            continue
        correction = float(np.quantile(group_df["over_prediction"], 0.75))
        corrections.append({
            "group": group_name,
            "column": column,
            "segment": str(segment),
            "rows": int(len(group_df)),
            "meanOverPrediction": round_float(group_df["over_prediction"].mean()),
            "p75OverPrediction": round_float(correction),
            "correctionSeats": round_float(max(correction, 0.0)),
        })
    return corrections


def apply_group_corrections(df, corrections):
    applied = np.zeros(len(df), dtype=float)
    for correction in corrections:
        column = correction["column"]
        segment = correction["segment"]
        mask = df[column].astype(str) == segment
        if mask.any():
            applied[mask.to_numpy()] = np.maximum(
                applied[mask.to_numpy()],
                float(correction["correctionSeats"]),
            )
    return applied


def service_operating_metrics(df, predictions, thresholds):
    predictions = np.clip(np.asarray(predictions, dtype=float), 0, 70)
    actual = df[TARGET_COLUMN].to_numpy(dtype=float)
    errors = predictions - actual
    over_prediction = np.maximum(errors, 0)
    return {
        **evaluate_predictions(df, predictions, thresholds),
        "overPredictionRate": round_float(float((errors > 0).mean())),
        "severeOverPredictionRate": round_float(float((errors >= 2).mean())),
        "meanOverPredictionSeats": round_float(float(over_prediction.mean())),
        "p75OverPredictionSeats": round_float(float(np.quantile(over_prediction, 0.75))),
    }


def segment_sort_key(value):
    order = {
        "commute_peak": 0,
        "off_peak": 1,
        "zero": 0,
        "low_1_10": 1,
        "mid_11_20": 2,
        "safe_21_plus": 3,
    }
    if str(value).isdigit():
        return int(value)
    return order.get(str(value), 999)


def summarize_dataset(df):
    return {
        "rows": int(len(df)),
        "dates": [
            {"date": str(date), "count": int(count)}
            for date, count in df.groupby("kst_date").size().items()
        ],
        "periods": [
            {"period": str(period), "count": int(count)}
            for period, count in df.groupby("period_segment").size().items()
        ],
        "seatRiskSegments": [
            {"segment": str(segment), "count": int(count)}
            for segment, count in df.groupby("seat_risk_segment").size().items()
        ],
        "lowSeatRate": round_float(float(df["is_low_seat"].mean())),
        "zeroSeatRate": round_float(float(df["is_zero_seat"].mean())),
    }


def build_report(comparison):
    holdout = comparison["latestHoldout"]
    cv = comparison["dateCrossValidation"]
    baseline_mae = holdout["baseline"]["mae"]

    rows = []
    for name in MODEL_NAMES:
        metrics = holdout[name]
        improvement = 0 if name == "baseline" else (baseline_mae - metrics["mae"]) / baseline_mae
        rows.append(
            f"| {model_label(name)} | {metrics['mae']:.2f} | {metrics['rmse']:.2f} | "
            f"{improvement * 100:.1f}% | {metrics['lowSeat']['f1']:.2f} | "
            f"{metrics['zeroSeat']['recall']:.2f} |"
        )

    cv_rows = []
    baseline_cv_mae = cv["baseline"]["summary"]["maeMean"]
    for name in MODEL_NAMES:
        summary = cv[name]["summary"]
        improvement = 0 if name == "baseline" else (baseline_cv_mae - summary["maeMean"]) / baseline_cv_mae
        cv_rows.append(
            f"| {model_label(name)} | {summary['maeMean']:.2f} | {summary['rmseMean']:.2f} | "
            f"{improvement * 100:.1f}% | {summary['lowSeatF1Mean']:.2f} | "
            f"{summary['zeroSeatRecallMean']:.2f} |"
        )

    return f"""# SeatFlow 모델 비교 리포트

생성 시각: {comparison['generatedAt']}

## 1. 데이터셋

| 항목 | 값 |
| --- | ---: |
| 전체 행 | {comparison['dataset']['rows']:,} |
| 학습 행 | {comparison['split']['trainRows']:,} |
| 최신 날짜 검증 행 | {comparison['split']['validationRows']:,} |
| 검증 날짜 | {', '.join(comparison['split']['validationDates'])} |
| 10석 이하 비율 | {comparison['dataset']['lowSeatRate'] * 100:.1f}% |
| 0석 비율 | {comparison['dataset']['zeroSeatRate'] * 100:.1f}% |
| 출근 피크 행 | {dataset_segment_count(comparison['dataset']['periods'], 'period', 'commute_peak'):,} |
| 비피크 행 | {dataset_segment_count(comparison['dataset']['periods'], 'period', 'off_peak'):,} |

## 2. 최신 날짜 holdout 비교

| 모델 | MAE | RMSE | baseline 대비 MAE 개선 | 10석 이하 F1 | 0석 Recall |
| --- | ---: | ---: | ---: | ---: | ---: |
{chr(10).join(rows)}

## 3. 날짜별 교차검증 평균

| 모델 | 평균 MAE | 평균 RMSE | baseline 대비 평균 MAE 개선 | 10석 이하 평균 F1 | 0석 평균 Recall |
| --- | ---: | ---: | ---: | ---: | ---: |
{chr(10).join(cv_rows)}

## 4. 최신 날짜 세그먼트별 성능

### 4-1. 시간대별 MAE

{segment_table(comparison['latestSegmentBreakdown']['hour'], ['baseline', 'lightgbm', 'lightgbmPeriodSpecialized', 'lightgbmRiskSpecialized'])}

### 4-2. 출근 피크/비피크별 MAE

{segment_table(comparison['latestSegmentBreakdown']['period'], ['baseline', 'lightgbm', 'lightgbmPeriodSpecialized', 'lightgbmRiskSpecialized'])}

### 4-3. 잔여좌석 위험구간별 MAE

{segment_table(comparison['latestSegmentBreakdown']['seatRisk'], ['baseline', 'lightgbm', 'lightgbmPeriodSpecialized', 'lightgbmRiskSpecialized'])}

## 5. 실서비스 보정 적용 판단

실제 서비스에서는 예측 잔여좌석을 그대로 호출 인원으로 쓰지 않습니다. 학습 데이터의 세그먼트별 과대예측 분포를 이용해 보수 보정값을 만들고, 안정 호출 인원과 불확실 인원을 분리합니다.

### 5-1. 보정 전/후 운영 지표

{service_calibration_table(comparison['serviceCalibration'])}

### 5-2. 주요 세그먼트 보정값

{correction_table(comparison['serviceCalibration']['corrections'])}

## 6. 분리 학습 판단

- 최신 날짜 holdout MAE 최저 모델: {model_label(comparison['bestByLatestHoldoutMae'])}
- 날짜별 교차검증 평균 MAE 최저 모델: {model_label(comparison['bestByDateCvMae'])}
- 출근 피크/비피크는 데이터가 각각 존재하므로 전용 모델 후보를 검증했습니다.
- 잔여좌석 0석/1~10석 구간은 핵심 위험구간이지만 표본이 아직 작아 전용 모델은 전역 LightGBM fallback과 함께 사용했습니다.
- 현재 단계에서는 전역 LightGBM에 시간대·피크·위험구간 feature를 포함하고, 피크/비피크 전용 모델을 비교 후보로 유지하는 전략이 가장 안전합니다.

## 7. 과적합 방지

- 최신 날짜 holdout으로 미래 날짜 예측 성능을 확인했습니다.
- 날짜별 교차검증으로 특정 날짜에만 맞는지 확인했습니다.
- 각 모델은 tree depth, leaf/min child sample, subsample, column sample, regularization을 제한했습니다.
- 세그먼트 전용 모델은 최소 학습 행 수를 만족하는 구간만 학습하고, 부족한 구간은 전역 LightGBM으로 fallback합니다.
- 모든 모델은 규칙 baseline과 비교했습니다.

## 8. 한계

- 현재 정답 라벨은 GBIS 좌석 변화 기반이므로 실제 대기 인원과 미탑승 인원을 직접 의미하지 않습니다.
- 사용자 체크인·호출·노쇼 데이터가 쌓이면 Boarding Probability와 Call Optimizer도 별도 학습해야 합니다.
"""


def segment_table(segment_rows, model_names):
    header = "| 세그먼트 | 행 | 위험<=10석 비율 | 0석 비율 | " + " | ".join(
        [f"{model_label(name)} MAE" for name in model_names]
    ) + " |"
    divider = "| --- | ---: | ---: | ---: | " + " | ".join(["---:" for _ in model_names]) + " |"
    rows = [header, divider]
    for segment in segment_rows:
        cells = [
            str(segment["segment"]),
            f"{segment['rows']:,}",
            f"{segment['lowSeatRate'] * 100:.1f}%",
            f"{segment['zeroSeatRate'] * 100:.1f}%",
        ]
        for model_name in model_names:
            cells.append(f"{segment['metrics'][model_name]['mae']:.2f}")
        rows.append("| " + " | ".join(cells) + " |")
    return "\n".join(rows)


def service_calibration_table(calibration):
    rows = [
        "| 모델 | MAE | 평균 과대예측 | 2석 이상 과대예측률 | 10석 이하 F1 | 0석 Recall |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for label, key in [
        ("LightGBM 원 예측", "rawLightgbm"),
        ("LightGBM 보수 보정", "calibratedLightgbm"),
    ]:
        metrics = calibration[key]
        rows.append(
            f"| {label} | {metrics['mae']:.2f} | {metrics['meanOverPredictionSeats']:.2f} | "
            f"{metrics['severeOverPredictionRate'] * 100:.1f}% | {metrics['lowSeat']['f1']:.2f} | "
            f"{metrics['zeroSeat']['recall']:.2f} |"
        )
    return "\n".join(rows)


def correction_table(corrections):
    rows = [
        "| 구분 | 세그먼트 | 학습 행 | 평균 과대예측 | p75 과대예측 | 적용 보정 |",
        "| --- | --- | ---: | ---: | ---: | ---: |",
    ]
    for correction in corrections:
        if correction["group"] == "hour" and int(correction["segment"]) not in [6, 7, 8, 9]:
            continue
        rows.append(
            f"| {correction_group_label(correction['group'])} | {correction['segment']} | "
            f"{correction['rows']:,} | {correction['meanOverPrediction']:.2f} | "
            f"{correction['p75OverPrediction']:.2f} | {correction['correctionSeats']:.2f} |"
        )
    return "\n".join(rows)


def correction_group_label(group):
    return {
        "period": "피크/비피크",
        "seatRisk": "잔여좌석 위험구간",
        "hour": "시간대",
    }[group]


def dataset_segment_count(rows, key_name, key_value):
    for row in rows:
        if row[key_name] == key_value:
            return row["count"]
    return 0


def model_label(name):
    return {
        "baseline": "규칙 baseline",
        "randomForest": "Random Forest",
        "lightgbm": "LightGBM",
        "xgboost": "XGBoost",
        "lightgbmPeriodSpecialized": "LightGBM 피크/비피크 전용",
        "lightgbmRiskSpecialized": "LightGBM 위험구간 전용",
    }[name]


def round_float(value):
    return round(float(value), 4)


if __name__ == "__main__":
    main()
