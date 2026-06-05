#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import {
  parseArgs,
  readCsvRows,
  toNumberOrNull,
  writeCsvRows,
} from "./gbis-client.mjs";

const DATASET_COLUMNS = [
  "sample_id",
  "target_label",
  "route_id",
  "route_name",
  "target_station_name",
  "target_station_seq",
  "veh_id",
  "plate_no",
  "before_collected_at",
  "after_collected_at",
  "kst_date",
  "kst_minute_of_day",
  "day_of_week",
  "is_weekend",
  "direction_code",
  "before_station_seq",
  "after_station_seq",
  "remaining_stops",
  "before_remain_seat_count",
  "target_remain_seat_count",
  "seat_delta",
  "is_low_seat",
  "is_zero_seat",
];

const FEATURE_NAMES = [
  "target_station_seq",
  "before_station_seq",
  "remaining_stops",
  "before_remain_seat_count",
  "kst_minute_sin",
  "kst_minute_cos",
  "day_of_week",
  "is_weekend",
  "direction_code",
];

const args = parseArgs(process.argv.slice(2));
const estimatesPath = args.estimates ?? "data/gbis-boarded-estimates.csv";
const datasetPath = args.dataset ?? "data/seatflow-training-dataset.csv";
const metricsPath = args.metrics ?? "data/seatflow-model-metrics.json";
const reportPath = args.report ?? "docs/23-seatflow-model-report.md";
const forestSize = Number(args.trees ?? 80);
const maxDepth = Number(args["max-depth"] ?? 7);
const minSamplesLeaf = Number(args["min-samples-leaf"] ?? 8);
const featureSampleCount = Number(args["feature-sample-count"] ?? 4);

const estimateRows = await readCsvRows(estimatesPath);
const dataset = buildDataset(estimateRows);

if (dataset.length < 50) {
  throw new Error(`SeatFlow dataset is too small: ${dataset.length} rows`);
}

await writeCsvRows(datasetPath, DATASET_COLUMNS, dataset);

const split = splitByLatestDate(dataset);
const baselineModel = trainBaseline(split.train);
const baselineTrainPredictions = split.train.map((row) => predictBaseline(baselineModel, row));
const baselineValidationPredictions = split.validation.map((row) => predictBaseline(baselineModel, row));
const baselineThresholds = calibrateRiskThresholds(split.train, baselineTrainPredictions);
const baselineTrainMetrics = evaluate(split.train, baselineTrainPredictions, baselineThresholds);
const baselineValidationMetrics = evaluate(split.validation, baselineValidationPredictions, baselineThresholds);

const forest = trainRandomForest(split.train, {
  forestSize,
  maxDepth,
  minSamplesLeaf,
  featureSampleCount,
});
const forestTrainPredictions = split.train.map((row) => predictRandomForest(forest, row));
const forestValidationPredictions = split.validation.map((row) => predictRandomForest(forest, row));
const forestThresholds = calibrateRiskThresholds(split.train, forestTrainPredictions);
const forestTrainMetrics = evaluate(split.train, forestTrainPredictions, forestThresholds);
const forestValidationMetrics = evaluate(split.validation, forestValidationPredictions, forestThresholds);

const metrics = {
  generatedAt: new Date().toISOString(),
  dataset: summarizeDataset(dataset),
  split: {
    strategy: "latest_kst_date_holdout",
    trainRows: split.train.length,
    validationRows: split.validation.length,
    trainDates: [...new Set(split.train.map((row) => row.kst_date))].sort(),
    validationDates: [...new Set(split.validation.map((row) => row.kst_date))].sort(),
  },
  baseline: {
    model: "target_label + before_station_seq average seat-delta fallback",
    train: baselineTrainMetrics,
    validation: baselineValidationMetrics,
    thresholds: baselineThresholds,
  },
  randomForest: {
    model: "pure-js random forest regressor",
    params: {
      forestSize,
      maxDepth,
      minSamplesLeaf,
      featureSampleCount,
      features: FEATURE_NAMES,
    },
    train: forestTrainMetrics,
    validation: forestValidationMetrics,
    thresholds: forestThresholds,
    overfit: overfitSummary(forestTrainMetrics, forestValidationMetrics),
    featureUsage: summarizeFeatureUsage(forest),
  },
  dateCrossValidation: runDateCrossValidation(dataset, {
    forestSize: Math.max(30, Math.floor(forestSize / 2)),
    maxDepth,
    minSamplesLeaf,
    featureSampleCount,
  }),
  comparison: compareModels(baselineValidationMetrics, forestValidationMetrics),
  guardrails: {
    leakageControls: [
      "latest KST date holdout validation",
      "no random row-level validation split as the primary score",
      "baseline comparison required",
      "tree depth and leaf size constrained",
      "vehicle/target/date summaries reported for manual review",
    ],
    limitations: [
      "Only GBIS-derived labels are used; actual queue length and left-behind labels require app or field data.",
      "Five observed days are enough for MVP evidence, not for production-level generalization claims.",
      "Random Forest is implemented as a dependency-free baseline; LightGBM/XGBoost should be compared when dependencies are available.",
    ],
  },
};

await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
await writeFile(reportPath, buildReport(metrics), "utf8");

console.log(`[seatflow] dataset rows=${dataset.length} -> ${datasetPath}`);
console.log(`[seatflow] validation date=${metrics.split.validationDates.join(", ")}`);
console.log(
  `[seatflow] baseline validation MAE=${baselineValidationMetrics.mae.toFixed(2)} RMSE=${baselineValidationMetrics.rmse.toFixed(2)}`,
);
console.log(
  `[seatflow] randomForest validation MAE=${forestValidationMetrics.mae.toFixed(2)} RMSE=${forestValidationMetrics.rmse.toFixed(2)}`,
);
console.log(`[seatflow] metrics -> ${metricsPath}`);
console.log(`[seatflow] report -> ${reportPath}`);

function buildDataset(rows) {
  return rows
    .map((row, index) => {
      const beforeSeats = toNumberOrNull(row.before_remain_seat_count);
      const afterSeats = toNumberOrNull(row.after_remain_seat_count);
      const beforeSeq = toNumberOrNull(row.before_station_seq);
      const targetSeq = toNumberOrNull(row.target_station_seq);
      const afterSeq = toNumberOrNull(row.after_station_seq);
      const seatDelta = toNumberOrNull(row.seat_delta);
      const collectedAt = row.before_collected_at || row.after_collected_at;
      const kst = kstParts(collectedAt);

      if (
        beforeSeats === null ||
        afterSeats === null ||
        beforeSeq === null ||
        targetSeq === null ||
        afterSeq === null ||
        seatDelta === null ||
        !kst
      ) {
        return null;
      }

      const remainingStops = Math.max(targetSeq - beforeSeq, 0);

      return {
        sample_id: `SF-${String(index + 1).padStart(6, "0")}`,
        target_label: row.target_label,
        route_id: row.route_id,
        route_name: row.route_name,
        target_station_name: row.target_station_name,
        target_station_seq: targetSeq,
        veh_id: row.veh_id,
        plate_no: row.plate_no,
        before_collected_at: row.before_collected_at,
        after_collected_at: row.after_collected_at,
        kst_date: kst.date,
        kst_minute_of_day: kst.minuteOfDay,
        day_of_week: kst.dayOfWeek,
        is_weekend: kst.dayOfWeek === 0 || kst.dayOfWeek === 6 ? 1 : 0,
        direction_code: String(row.target_label ?? "").includes("seoul-to-dongtan") ? 1 : 0,
        before_station_seq: beforeSeq,
        after_station_seq: afterSeq,
        remaining_stops: remainingStops,
        before_remain_seat_count: beforeSeats,
        target_remain_seat_count: afterSeats,
        seat_delta: seatDelta,
        is_low_seat: afterSeats <= 10 ? 1 : 0,
        is_zero_seat: afterSeats === 0 ? 1 : 0,
      };
    })
    .filter(Boolean);
}

function splitByLatestDate(rows) {
  const dates = [...new Set(rows.map((row) => row.kst_date))].sort();
  const validationDate = dates[dates.length - 1];
  const validation = rows.filter((row) => row.kst_date === validationDate);
  const train = rows.filter((row) => row.kst_date !== validationDate);

  if (train.length === 0 || validation.length === 0) {
    throw new Error("Unable to split SeatFlow dataset by latest KST date.");
  }

  return { train, validation };
}

function trainBaseline(rows) {
  const globalDelta = average(rows.map((row) => row.seat_delta));
  const targetStationDelta = averageBy(rows, (row) => row.target_label, (row) => row.seat_delta);
  const targetBeforeDelta = averageBy(
    rows,
    (row) => `${row.target_label}|${row.before_station_seq}`,
    (row) => row.seat_delta,
  );

  return { globalDelta, targetStationDelta, targetBeforeDelta };
}

function predictBaseline(model, row) {
  const key = `${row.target_label}|${row.before_station_seq}`;
  const expectedDelta =
    model.targetBeforeDelta.get(key) ??
    model.targetStationDelta.get(row.target_label) ??
    model.globalDelta;

  return clampSeats(row.before_remain_seat_count - expectedDelta);
}

function trainRandomForest(rows, options) {
  const rng = mulberry32(42);
  const trees = [];

  for (let index = 0; index < options.forestSize; index += 1) {
    const sample = bootstrap(rows, rng);
    trees.push(buildTree(sample, {
      ...options,
      rng,
      depth: 0,
      featureUsage: new Map(),
    }));
  }

  return trees;
}

function buildTree(rows, options) {
  const prediction = average(rows.map((row) => row.target_remain_seat_count));
  const node = {
    prediction,
    count: rows.length,
    feature: null,
    threshold: null,
    left: null,
    right: null,
  };

  if (options.depth >= options.maxDepth || rows.length <= options.minSamplesLeaf * 2) {
    return node;
  }

  const currentSse = sse(rows.map((row) => row.target_remain_seat_count));
  const sampledFeatures = sampleFeatures(FEATURE_NAMES, options.featureSampleCount, options.rng);
  let best = null;

  for (const feature of sampledFeatures) {
    const candidates = splitCandidates(rows, feature);

    for (const threshold of candidates) {
      const left = [];
      const right = [];

      for (const row of rows) {
        if (featureValue(row, feature) <= threshold) {
          left.push(row);
        } else {
          right.push(row);
        }
      }

      if (left.length < options.minSamplesLeaf || right.length < options.minSamplesLeaf) {
        continue;
      }

      const splitSse =
        sse(left.map((row) => row.target_remain_seat_count)) +
        sse(right.map((row) => row.target_remain_seat_count));
      const gain = currentSse - splitSse;

      if (!best || gain > best.gain) {
        best = { feature, threshold, gain, left, right };
      }
    }
  }

  if (!best || best.gain <= 0.0001) {
    return node;
  }

  node.feature = best.feature;
  node.threshold = best.threshold;
  node.left = buildTree(best.left, { ...options, depth: options.depth + 1 });
  node.right = buildTree(best.right, { ...options, depth: options.depth + 1 });
  return node;
}

function predictRandomForest(forest, row) {
  return clampSeats(average(forest.map((tree) => predictTree(tree, row))));
}

function predictTree(node, row) {
  if (!node.feature || !node.left || !node.right) {
    return node.prediction;
  }

  return featureValue(row, node.feature) <= node.threshold
    ? predictTree(node.left, row)
    : predictTree(node.right, row);
}

function evaluate(rows, predictions, thresholds = { lowSeatThreshold: 10, zeroSeatThreshold: 1 }) {
  const errors = rows.map((row, index) => predictions[index] - row.target_remain_seat_count);
  const absErrors = errors.map(Math.abs);
  const squaredErrors = errors.map((error) => error ** 2);
  const lowMetrics = classificationMetrics(
    rows.map((row) => row.is_low_seat === 1),
    predictions.map((prediction) => prediction <= thresholds.lowSeatThreshold),
  );
  const zeroMetrics = classificationMetrics(
    rows.map((row) => row.is_zero_seat === 1),
    predictions.map((prediction) => prediction <= thresholds.zeroSeatThreshold),
  );

  return {
    rows: rows.length,
    mae: round(average(absErrors), 4),
    rmse: round(Math.sqrt(average(squaredErrors)), 4),
    bias: round(average(errors), 4),
    thresholds,
    lowSeat: lowMetrics,
    zeroSeat: zeroMetrics,
  };
}

function calibrateRiskThresholds(rows, predictions) {
  return {
    lowSeatThreshold: findBestThreshold(
      rows.map((row) => row.is_low_seat === 1),
      predictions,
      { min: 3, max: 18, target: "f1" },
    ),
    zeroSeatThreshold: findBestThreshold(
      rows.map((row) => row.is_zero_seat === 1),
      predictions,
      { min: 0, max: 12, target: "f1_with_recall_floor", recallFloor: 0.65 },
    ),
  };
}

function findBestThreshold(actual, predictions, options) {
  let best = { threshold: options.min, score: -Infinity, f1: 0, recall: 0 };

  for (let threshold = options.min; threshold <= options.max; threshold += 0.5) {
    const metrics = classificationMetrics(actual, predictions.map((prediction) => prediction <= threshold));
    let score = metrics.f1;

    if (options.target === "f1_with_recall_floor" && metrics.recall < options.recallFloor) {
      score -= (options.recallFloor - metrics.recall) * 2;
    }

    if (score > best.score) {
      best = { threshold, score, f1: metrics.f1, recall: metrics.recall };
    }
  }

  return best.threshold;
}

function classificationMetrics(actual, predicted) {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;

  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] && predicted[index]) tp += 1;
    else if (!actual[index] && predicted[index]) fp += 1;
    else if (!actual[index] && !predicted[index]) tn += 1;
    else fn += 1;
  }

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    tp,
    fp,
    tn,
    fn,
    precision: round(precision, 4),
    recall: round(recall, 4),
    f1: round(f1, 4),
  };
}

function summarizeDataset(rows) {
  const targetCounts = countBy(rows, (row) => row.target_label);
  const dateCounts = countBy(rows, (row) => row.kst_date);

  return {
    rows: rows.length,
    dates: [...dateCounts.entries()].map(([date, count]) => ({ date, count })),
    targets: [...targetCounts.entries()]
      .map(([target, count]) => ({ target, count }))
      .sort((a, b) => b.count - a.count),
    lowSeatRate: round(rows.filter((row) => row.is_low_seat === 1).length / rows.length, 4),
    zeroSeatRate: round(rows.filter((row) => row.is_zero_seat === 1).length / rows.length, 4),
  };
}

function overfitSummary(train, validation) {
  return {
    maeGap: round(validation.mae - train.mae, 4),
    maeGapRatio: train.mae === 0 ? null : round((validation.mae - train.mae) / train.mae, 4),
    warning:
      validation.mae - train.mae > 2 || (train.mae > 0 && (validation.mae - train.mae) / train.mae > 0.3)
        ? "검증 오차가 학습 오차보다 커서 과적합 가능성을 점검해야 합니다."
        : "학습/검증 오차 차이가 MVP 기준에서 과도하지 않습니다.",
  };
}

function compareModels(baseline, forest) {
  const maeImprovement = baseline.mae === 0 ? 0 : (baseline.mae - forest.mae) / baseline.mae;
  const rmseImprovement = baseline.rmse === 0 ? 0 : (baseline.rmse - forest.rmse) / baseline.rmse;

  return {
    maeImprovement: round(maeImprovement, 4),
    rmseImprovement: round(rmseImprovement, 4),
    verdict:
      maeImprovement >= 0.1
        ? "Random Forest가 규칙 baseline보다 의미 있게 개선했습니다."
        : maeImprovement > 0
          ? "Random Forest가 baseline보다 개선했지만 개선 폭은 작습니다."
          : "현재 분할에서는 baseline이 Random Forest보다 낫습니다. 특징/분할/모델 복잡도를 재점검해야 합니다.",
  };
}

function runDateCrossValidation(rows, options) {
  const dates = [...new Set(rows.map((row) => row.kst_date))].sort();
  const folds = [];

  for (const date of dates) {
    const train = rows.filter((row) => row.kst_date !== date);
    const validation = rows.filter((row) => row.kst_date === date);

    if (train.length < 100 || validation.length < 30) {
      continue;
    }

    const baselineModel = trainBaseline(train);
    const baselineTrainPredictions = train.map((row) => predictBaseline(baselineModel, row));
    const baselineThresholds = calibrateRiskThresholds(train, baselineTrainPredictions);
    const baselineValidationPredictions = validation.map((row) => predictBaseline(baselineModel, row));
    const baselineMetrics = evaluate(validation, baselineValidationPredictions, baselineThresholds);
    const forest = trainRandomForest(train, options);
    const forestTrainPredictions = train.map((row) => predictRandomForest(forest, row));
    const forestThresholds = calibrateRiskThresholds(train, forestTrainPredictions);
    const forestValidationPredictions = validation.map((row) => predictRandomForest(forest, row));
    const forestMetrics = evaluate(validation, forestValidationPredictions, forestThresholds);

    folds.push({
      validationDate: date,
      trainRows: train.length,
      validationRows: validation.length,
      baselineMae: baselineMetrics.mae,
      randomForestMae: forestMetrics.mae,
      randomForestLowSeatF1: forestMetrics.lowSeat.f1,
      randomForestZeroSeatRecall: forestMetrics.zeroSeat.recall,
      maeImprovement: compareModels(baselineMetrics, forestMetrics).maeImprovement,
    });
  }

  return {
    folds,
    summary: {
      foldCount: folds.length,
      baselineMaeMean: round(average(folds.map((fold) => fold.baselineMae)), 4),
      randomForestMaeMean: round(average(folds.map((fold) => fold.randomForestMae)), 4),
      randomForestLowSeatF1Mean: round(average(folds.map((fold) => fold.randomForestLowSeatF1)), 4),
      randomForestZeroSeatRecallMean: round(average(folds.map((fold) => fold.randomForestZeroSeatRecall)), 4),
      maeImprovementMean: round(average(folds.map((fold) => fold.maeImprovement)), 4),
    },
  };
}

function summarizeFeatureUsage(forest) {
  const usage = new Map();

  for (const tree of forest) {
    visitTree(tree, (node) => {
      if (node.feature) {
        usage.set(node.feature, (usage.get(node.feature) ?? 0) + 1);
      }
    });
  }

  return [...usage.entries()]
    .map(([feature, count]) => ({ feature, count }))
    .sort((a, b) => b.count - a.count);
}

function visitTree(node, fn) {
  fn(node);
  if (node.left) visitTree(node.left, fn);
  if (node.right) visitTree(node.right, fn);
}

function buildReport(metrics) {
  const rf = metrics.randomForest;
  const baseline = metrics.baseline;

  return `# SeatFlow 학습 모델 MVP 리포트

생성 시각: ${metrics.generatedAt}

## 1. 데이터셋

| 항목 | 값 |
| --- | ---: |
| 전체 학습 후보 행 | ${metrics.dataset.rows.toLocaleString()} |
| 학습 행 | ${metrics.split.trainRows.toLocaleString()} |
| 검증 행 | ${metrics.split.validationRows.toLocaleString()} |
| 검증 날짜 | ${metrics.split.validationDates.join(", ")} |
| 10석 이하 비율 | ${(metrics.dataset.lowSeatRate * 100).toFixed(1)}% |
| 0석 비율 | ${(metrics.dataset.zeroSeatRate * 100).toFixed(1)}% |

## 2. 모델 비교

| 모델 | Train MAE | Validation MAE | Validation RMSE | 10석 이하 F1 | 0석 Recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| 규칙 baseline | ${baseline.train.mae.toFixed(2)} | ${baseline.validation.mae.toFixed(2)} | ${baseline.validation.rmse.toFixed(2)} | ${baseline.validation.lowSeat.f1.toFixed(2)} | ${baseline.validation.zeroSeat.recall.toFixed(2)} |
| Random Forest | ${rf.train.mae.toFixed(2)} | ${rf.validation.mae.toFixed(2)} | ${rf.validation.rmse.toFixed(2)} | ${rf.validation.lowSeat.f1.toFixed(2)} | ${rf.validation.zeroSeat.recall.toFixed(2)} |

## 3. 판정

- MAE 개선율: ${(metrics.comparison.maeImprovement * 100).toFixed(1)}%
- RMSE 개선율: ${(metrics.comparison.rmseImprovement * 100).toFixed(1)}%
- 모델 비교: ${metrics.comparison.verdict}
- 과적합 점검: ${rf.overfit.warning}
- Random Forest 위험 임계값: 10석 이하 ${rf.thresholds.lowSeatThreshold}석, 0석 위험 ${rf.thresholds.zeroSeatThreshold}석 이하

## 4. 날짜별 교차검증

| 항목 | 값 |
| --- | ---: |
| fold 수 | ${metrics.dateCrossValidation.summary.foldCount} |
| baseline 평균 MAE | ${metrics.dateCrossValidation.summary.baselineMaeMean.toFixed(2)} |
| Random Forest 평균 MAE | ${metrics.dateCrossValidation.summary.randomForestMaeMean.toFixed(2)} |
| 평균 MAE 개선율 | ${(metrics.dateCrossValidation.summary.maeImprovementMean * 100).toFixed(1)}% |
| 10석 이하 평균 F1 | ${metrics.dateCrossValidation.summary.randomForestLowSeatF1Mean.toFixed(2)} |
| 0석 평균 Recall | ${metrics.dateCrossValidation.summary.randomForestZeroSeatRecallMean.toFixed(2)} |

## 5. 과적합 방지 설계

- 무작위 row split을 1차 검증으로 쓰지 않고, 최신 KST 날짜를 검증 데이터로 분리했습니다.
- 날짜별 교차검증으로 특정 검증 날짜에만 맞은 결과인지 점검했습니다.
- 트리 깊이와 leaf 최소 샘플 수를 제한했습니다.
- 규칙 baseline과 반드시 비교합니다.
- 같은 차량의 연속 스냅샷을 외우는 데이터 누수 가능성을 이후 차량 그룹 분리 검증으로 추가 점검합니다.

## 6. 주요 특징 사용 빈도

| 특징 | split 사용 횟수 |
| --- | ---: |
${rf.featureUsage.map((item) => `| ${item.feature} | ${item.count} |`).join("\n")}

## 7. 한계와 다음 단계

- 현재 라벨은 GBIS 좌석 변화 기반이므로 실제 대기 인원과 미탑승 인원을 직접 의미하지 않습니다.
- 5일 데이터는 공모전 MVP 검증에는 충분하지만, 상용 수준 일반화 검증에는 부족합니다.
- 다음 단계는 LightGBM/XGBoost 비교, 날짜별 교차검증, 차량 그룹 분리 검증, AI 탭 시각화입니다.
`;
}

function featureValue(row, feature) {
  if (feature === "kst_minute_sin") {
    return Math.sin((2 * Math.PI * Number(row.kst_minute_of_day)) / 1440);
  }
  if (feature === "kst_minute_cos") {
    return Math.cos((2 * Math.PI * Number(row.kst_minute_of_day)) / 1440);
  }
  return Number(row[feature] ?? 0);
}

function splitCandidates(rows, feature) {
  const values = [...new Set(rows.map((row) => featureValue(row, feature)).filter(Number.isFinite))]
    .sort((a, b) => a - b);

  if (values.length <= 1) {
    return [];
  }

  const candidates = [];
  const bucketCount = Math.min(12, values.length - 1);

  for (let index = 1; index <= bucketCount; index += 1) {
    const valueIndex = Math.floor((index * values.length) / (bucketCount + 1));
    candidates.push(values[valueIndex]);
  }

  return [...new Set(candidates)];
}

function sampleFeatures(features, count, rng) {
  const remaining = [...features];
  const sampled = [];

  while (sampled.length < Math.min(count, features.length)) {
    const index = Math.floor(rng() * remaining.length);
    sampled.push(remaining.splice(index, 1)[0]);
  }

  return sampled;
}

function bootstrap(rows, rng) {
  return Array.from({ length: rows.length }, () => rows[Math.floor(rng() * rows.length)]);
}

function sse(values) {
  const mean = average(values);
  return values.reduce((total, value) => total + (value - mean) ** 2, 0);
}

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + Number(value), 0) / values.length;
}

function averageBy(rows, keyFn, valueFn) {
  const groups = new Map();

  for (const row of rows) {
    const key = keyFn(row);
    const current = groups.get(key) ?? [];
    current.push(valueFn(row));
    groups.set(key, current);
  }

  return new Map([...groups.entries()].map(([key, values]) => [key, average(values)]));
}

function countBy(rows, keyFn) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function kstParts(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const weekday = get("weekday");
  const dayOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);

  return {
    date: `${year}-${month}-${day}`,
    minuteOfDay: hour * 60 + minute,
    dayOfWeek: dayOfWeek === -1 ? date.getUTCDay() : dayOfWeek,
  };
}

function clampSeats(value) {
  return Math.min(Math.max(value, 0), 70);
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mulberry32(seed) {
  return function random() {
    let t = seed += 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
