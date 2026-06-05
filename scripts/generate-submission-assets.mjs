import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const assetDir = path.join(rootDir, "docs", "assets");
const evidencePath = path.join(rootDir, "docs", "15-gbis-evidence-report.md");
const bucketPath = path.join(rootDir, "data", "gbis-evening-station-buckets.csv");

await mkdir(assetDir, { recursive: true });

const evidence = await readFile(evidencePath, "utf8");
const stationRows = parseEvidenceStationRows(evidence);

if (stationRows.length === 0) {
  throw new Error(`No station rows found in ${evidencePath}`);
}

const bucketRows = parseCsv(await readFile(bucketPath, "utf8"));

const assets = [
  ["gbis-evening-station-risk.svg", renderStationRisk(stationRows)],
  ["gbis-evening-heatmap.svg", renderHeatmap(stationRows, bucketRows)],
  ["queuebus-service-flow.svg", renderServiceFlow()],
  ["privacy-data-flow.svg", renderPrivacyFlow()],
];

for (const [fileName, svg] of assets) {
  await writeFile(path.join(assetDir, fileName), svg, "utf8");
}

console.log(`Generated ${assets.length} assets in ${path.relative(rootDir, assetDir)}`);

function parseEvidenceStationRows(markdown) {
  const rows = parseMarkdownTable(markdown, "## 4. 퇴근길 핵심 근거");
  return rows.map((row) => ({
    seq: Number(row["순번"]),
    station: row["정류장"],
    samples: toNumber(row["샘플"]),
    days: toNumber(row["관측일"]),
    p20: toNumber(row["p20 좌석"]),
    median: toNumber(row["중앙값"]),
    zeroRate: toNumber(row["0석 신호"] ?? row["0석 비율"]),
    le10Rate: toNumber(row["10석 이하"]),
    interpretation: row["제출 해석"],
  }));
}

function parseMarkdownTable(markdown, heading) {
  const headingIndex = markdown.indexOf(heading);
  if (headingIndex < 0) {
    return [];
  }

  const lines = markdown.slice(headingIndex + heading.length).split(/\r?\n/);
  const tableLines = [];

  for (const line of lines) {
    if (line.trim().startsWith("|")) {
      tableLines.push(line.trim());
      continue;
    }
    if (tableLines.length > 0) {
      break;
    }
  }

  if (tableLines.length < 3) {
    return [];
  }

  const [headerLine, , ...bodyLines] = tableLines;
  const headers = splitMarkdownRow(headerLine);

  return bodyLines
    .filter((line) => !/^\|\s*-/.test(line))
    .map((line) => {
      const cells = splitMarkdownRow(line);
      return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    });
}

function splitMarkdownRow(line) {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(value);
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  const [headers, ...body] = rows;
  return body.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function renderStationRisk(rows) {
  const width = 1280;
  const rowHeight = 84;
  const top = 150;
  const height = top + rowHeight * rows.length + 96;
  const labelX = 72;
  const p20X = 432;
  const zeroX = 754;
  const barWidth = 278;
  const maxP20 = 40;
  const maxZero = 80;

  const rowSvg = rows
    .map((row, index) => {
      const y = top + index * rowHeight;
      const p20Width = clamp((row.p20 / maxP20) * barWidth, 0, barWidth);
      const zeroWidth = clamp((row.zeroRate / maxZero) * barWidth, 0, barWidth);
      const riskColor = row.p20 <= 0 || row.zeroRate >= 20 ? "#c2410c" : row.p20 <= 15 ? "#b45309" : "#047857";
      const fill = index % 2 === 0 ? "#f8fafc" : "#ffffff";

      return `
        <rect x="48" y="${y - 24}" width="1184" height="72" rx="8" fill="${fill}" />
        <text x="${labelX}" y="${y}" class="station">${row.seq}. ${escapeXml(shortStation(row.station))}</text>
        <text x="${labelX}" y="${y + 26}" class="meta">샘플 ${row.samples}개 · ${row.days}일 · ${escapeXml(row.interpretation)}</text>
        <rect x="${p20X}" y="${y - 14}" width="${barWidth}" height="18" rx="4" fill="#e2e8f0" />
        <rect x="${p20X}" y="${y - 14}" width="${p20Width}" height="18" rx="4" fill="${riskColor}" />
        <text x="${p20X + barWidth + 16}" y="${y + 2}" class="value">p20 ${row.p20}석</text>
        <rect x="${zeroX}" y="${y + 14}" width="${barWidth}" height="18" rx="4" fill="#fee2e2" />
        <rect x="${zeroX}" y="${y + 14}" width="${zeroWidth}" height="18" rx="4" fill="#e11d48" />
        <text x="${zeroX + barWidth + 16}" y="${y + 30}" class="value">신호 ${formatPct(row.zeroRate)}</text>
      `;
    })
    .join("\n");

  return svgShell(
    width,
    height,
    `
      <text x="48" y="58" class="title">M4137 다음 버스 승차 가능성 판단 지표</text>
      <text x="48" y="92" class="subtitle">잔여좌석 분포는 줄을 세우기 위한 자료가 아니라, 호출 구간·다음차 안내·운영 알림을 정하는 신호입니다.</text>
      <text x="${p20X}" y="126" class="axis">하위 20% 잔여좌석</text>
      <text x="${zeroX}" y="126" class="axis">다음차 안내 신호</text>
      ${rowSvg}
      <text x="48" y="${height - 34}" class="footnote">출처: 경기도 GBIS 공식 API 수집 결과, docs/15-gbis-evidence-report.md 생성값</text>
    `
  );
}

function renderHeatmap(stationRows, bucketRows) {
  const stations = stationRows.map((row) => ({ seq: row.seq, station: shortStation(row.station) }));
  const buckets = [...new Set(
    bucketRows
      .filter((row) => row.window === "평일 퇴근 16:00-20:30")
      .map((row) => row.bucket)
  )].sort();
  const rowHeight = 58;
  const cellWidth = 58;
  const labelWidth = 292;
  const left = 48;
  const top = 156;
  const width = left + labelWidth + buckets.length * cellWidth + 56;
  const height = top + stations.length * rowHeight + 132;
  const lookup = new Map(
    bucketRows
      .filter((row) => row.window === "평일 퇴근 16:00-20:30")
      .map((row) => [`${row.seq}:${row.bucket}`, row])
  );

  const bucketLabels = buckets
    .map((bucket, index) => {
      const x = left + labelWidth + index * cellWidth + cellWidth / 2;
      return `<text x="${x}" y="134" class="bucket" transform="rotate(-45 ${x} 134)">${escapeXml(bucket)}</text>`;
    })
    .join("\n");

  const rowsSvg = stations
    .map((station, rowIndex) => {
      const y = top + rowIndex * rowHeight;
      const cells = buckets
        .map((bucket, colIndex) => {
          const row = lookup.get(`${station.seq}:${bucket}`);
          const x = left + labelWidth + colIndex * cellWidth;
          const samples = row ? Number(row.samples) : 0;
          const zeroRate = row ? Number(row.zero_rate_pct) : null;
          const fill = heatColor(zeroRate, samples);
          const text = row ? (samples >= 8 ? `${Math.round(zeroRate)}%` : `n=${samples}`) : "-";
          const textColor = zeroRate !== null && zeroRate >= 45 && samples >= 8 ? "#ffffff" : "#0f172a";
          return `
            <rect x="${x}" y="${y}" width="${cellWidth - 4}" height="${rowHeight - 6}" rx="6" fill="${fill}" />
            <text x="${x + (cellWidth - 4) / 2}" y="${y + 32}" class="cell" fill="${textColor}">${escapeXml(text)}</text>
          `;
        })
        .join("\n");

      return `
        <text x="${left}" y="${y + 24}" class="station">${station.seq}. ${escapeXml(station.station)}</text>
        <text x="${left}" y="${y + 46}" class="meta">안내 신호</text>
        ${cells}
      `;
    })
    .join("\n");

  const legendY = height - 70;

  return svgShell(
    width,
    height,
    `
      <text x="48" y="58" class="title">평일 퇴근 호출·다음차 안내 지표</text>
      <text x="48" y="92" class="subtitle">각 셀은 다음차 안내가 필요한 저좌석 신호입니다. 높은 구간은 호출 인원과 운수사 수요 알림에 반영합니다.</text>
      ${bucketLabels}
      ${rowsSvg}
      <rect x="48" y="${legendY}" width="24" height="18" rx="4" fill="#dcfce7" /><text x="82" y="${legendY + 14}" class="legend">0%</text>
      <rect x="140" y="${legendY}" width="24" height="18" rx="4" fill="#fde68a" /><text x="174" y="${legendY + 14}" class="legend">1~19%</text>
      <rect x="260" y="${legendY}" width="24" height="18" rx="4" fill="#fb7185" /><text x="294" y="${legendY + 14}" class="legend">20~39%</text>
      <rect x="398" y="${legendY}" width="24" height="18" rx="4" fill="#e11d48" /><text x="432" y="${legendY + 14}" class="legend">40~59%</text>
      <rect x="540" y="${legendY}" width="24" height="18" rx="4" fill="#9f1239" /><text x="574" y="${legendY + 14}" class="legend">60%+</text>
      <text x="48" y="${height - 30}" class="footnote">출처: data/gbis-evening-station-buckets.csv</text>
    `
  );
}

function renderServiceFlow() {
  const boxes = [
    ["위치 인증", "정류장 100m 반경 체크인", "#0f766e"],
    ["가상 대기번호", "줄 대신 순번 유지", "#2563eb"],
    ["승차 가능성", "이번·다음 버스 판단", "#7c3aed"],
    ["탑승 호출", "가능 구간만 대기 위치로", "#c2410c"],
    ["운영 신호", "운수사에 수요 데이터 제공", "#334155"],
  ];
  const width = 1440;
  const height = 420;
  const startX = 64;
  const boxWidth = 232;
  const gap = 42;
  const y = 150;

  const flow = boxes
    .map(([title, body, color], index) => {
      const x = startX + index * (boxWidth + gap);
      const arrow = index < boxes.length - 1
        ? `<path d="M ${x + boxWidth + 8} ${y + 64} L ${x + boxWidth + gap - 10} ${y + 64}" class="arrow" />`
        : "";
      return `
        <rect x="${x}" y="${y}" width="${boxWidth}" height="128" rx="12" fill="#ffffff" stroke="${color}" stroke-width="3" />
        <circle cx="${x + 32}" cy="${y + 32}" r="16" fill="${color}" />
        <text x="${x + 32}" y="${y + 38}" class="step">${index + 1}</text>
        <text x="${x + 60}" y="${y + 40}" class="boxTitle">${escapeXml(title)}</text>
        <text x="${x + 28}" y="${y + 82}" class="boxBody">${escapeXml(body)}</text>
        ${arrow}
      `;
    })
    .join("\n");

  return svgShell(
    width,
    height,
    `
      <text x="64" y="64" class="title">QueueBus 서비스 흐름</text>
      <text x="64" y="100" class="subtitle">좌석 예약이 아니라 줄 대신 대기번호로 기다리게 하고, AI가 다음 버스 승차 가능성과 운영 수요 신호를 계산합니다.</text>
      ${flow}
      <text x="64" y="352" class="footnote">심사서 삽입 위치: Ⅰ-1 개발 동기 또는 Ⅳ 기술성</text>
    `
  );
}

function renderPrivacyFlow() {
  const width = 1280;
  const height = 560;
  const boxes = [
    ["사용자 단말", "현재 위치는 체크인 순간에만 사용", 70, 160, "#0f766e"],
    ["지오펜스 검증", "정류장 반경 내 도착 여부만 판정", 360, 160, "#2563eb"],
    ["대기열 이벤트", "대기번호·호출·탑승 이벤트 저장", 650, 160, "#7c3aed"],
    ["집계 처리", "정류장·노선·시간대 집계", 360, 348, "#c2410c"],
    ["운영 대시보드", "개인 위치 없이 집계 지표 표시", 650, 348, "#334155"],
  ];

  const boxSvg = boxes
    .map(([title, body, x, y, color]) => `
      <rect x="${x}" y="${y}" width="250" height="112" rx="12" fill="#ffffff" stroke="${color}" stroke-width="3" />
      <text x="${x + 24}" y="${y + 40}" class="boxTitle">${escapeXml(title)}</text>
      <text x="${x + 24}" y="${y + 76}" class="boxBody">${escapeXml(body)}</text>
    `)
    .join("\n");

  return svgShell(
    width,
    height,
    `
      <text x="70" y="64" class="title">개인정보·위치정보 보호 구조</text>
      <text x="70" y="100" class="subtitle">정밀 이동 경로를 장기 저장하지 않고, 운영자는 집계 데이터만 확인합니다.</text>
      ${boxSvg}
      <path d="M 320 216 L 350 216" class="arrow" />
      <path d="M 610 216 L 640 216" class="arrow" />
      <path d="M 775 276 L 520 342" class="arrow" />
      <path d="M 610 404 L 640 404" class="arrow" />
      <rect x="948" y="210" width="240" height="150" rx="12" fill="#f8fafc" stroke="#94a3b8" stroke-width="2" />
      <text x="972" y="250" class="boxTitle">보호 원칙</text>
      <text x="972" y="288" class="boxBody">목적 제한 · 최소 수집</text>
      <text x="972" y="320" class="boxBody">개인 위치 미표시</text>
      <text x="972" y="352" class="boxBody">탑승 후 보관 최소화</text>
      <text x="70" y="500" class="footnote">심사서 삽입 위치: Ⅳ 기술성 개인정보 및 위치정보 보호 항목</text>
    `
  );
}

function svgShell(width, height, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <defs>
    <marker id="arrowHead" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L0,6 L8,3 z" fill="#475569" />
    </marker>
    <style>
      .title { font-family: AppleGothic, Arial, sans-serif; font-size: 30px; font-weight: 700; fill: #0f172a; }
      .subtitle { font-family: AppleGothic, Arial, sans-serif; font-size: 18px; font-weight: 400; fill: #475569; }
      .station { font-family: AppleGothic, Arial, sans-serif; font-size: 20px; font-weight: 700; fill: #0f172a; }
      .meta { font-family: AppleGothic, Arial, sans-serif; font-size: 15px; font-weight: 400; fill: #64748b; }
      .axis { font-family: AppleGothic, Arial, sans-serif; font-size: 16px; font-weight: 700; fill: #334155; }
      .value { font-family: AppleGothic, Arial, sans-serif; font-size: 17px; font-weight: 700; fill: #0f172a; }
      .bucket { font-family: AppleGothic, Arial, sans-serif; font-size: 13px; font-weight: 600; fill: #334155; }
      .cell { font-family: AppleGothic, Arial, sans-serif; font-size: 14px; font-weight: 700; text-anchor: middle; dominant-baseline: middle; }
      .legend { font-family: AppleGothic, Arial, sans-serif; font-size: 14px; font-weight: 500; fill: #334155; }
      .footnote { font-family: AppleGothic, Arial, sans-serif; font-size: 14px; font-weight: 400; fill: #64748b; }
      .boxTitle { font-family: AppleGothic, Arial, sans-serif; font-size: 22px; font-weight: 700; fill: #0f172a; }
      .boxBody { font-family: AppleGothic, Arial, sans-serif; font-size: 16px; font-weight: 400; fill: #475569; }
      .step { font-family: Arial, sans-serif; font-size: 18px; font-weight: 700; fill: #ffffff; text-anchor: middle; dominant-baseline: middle; }
      .arrow { fill: none; stroke: #475569; stroke-width: 3; marker-end: url(#arrowHead); }
    </style>
  </defs>
  <rect width="${width}" height="${height}" fill="#ffffff" />
  ${body}
</svg>
`;
}

function heatColor(value, samples) {
  if (value === null || Number.isNaN(value)) {
    return "#e2e8f0";
  }
  if (samples < 8) {
    return "#f1f5f9";
  }
  if (value >= 60) {
    return "#9f1239";
  }
  if (value >= 40) {
    return "#e11d48";
  }
  if (value >= 20) {
    return "#fb7185";
  }
  if (value > 0) {
    return "#fde68a";
  }
  return "#dcfce7";
}

function shortStation(station) {
  return station
    .replace("서울역버스환승센터(6번승강장)(중)", "서울역환승센터")
    .replace("국가인권위.안중근활동터(중)", "국가인권위")
    .replace("신한은행본점", "신한은행본점");
}

function toNumber(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).replace(/,/g, "").replace("%", "").trim();
  if (normalized === "" || normalized === "-") {
    return null;
  }
  return Number(normalized);
}

function formatPct(value) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
