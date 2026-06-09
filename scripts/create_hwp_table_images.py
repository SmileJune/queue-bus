#!/usr/bin/env python3
"""Render business-plan tables as PNG assets for HWP insertion."""

from __future__ import annotations

from pathlib import Path
from typing import Sequence

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "submission" / "hwp-assets" / "tables"
FONT_PATHS = [
    Path("/System/Library/Fonts/Supplemental/AppleGothic.ttf"),
    Path("/System/Library/Fonts/Supplemental/NotoSansGothic-Regular.ttf"),
]

WIDTH = 1800
MARGIN_X = 60
MARGIN_Y = 48
CELL_PAD_X = 20
CELL_PAD_Y = 15
GRID = (180, 187, 199)
TEXT = (17, 24, 39)
MUTED = (75, 85, 99)
HEADER_BG = (229, 236, 255)
FIRST_COL_BG = (243, 244, 246)
WHITE = (255, 255, 255)


def font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_PATHS:
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    raise FileNotFoundError("No Korean font found")


TITLE_FONT = font(44)
CAPTION_FONT = font(24)
HEADER_FONT = font(31)
CELL_FONT = font(29)


def text_width(draw: ImageDraw.ImageDraw, text: str, fnt: ImageFont.FreeTypeFont) -> float:
    if not text:
        return 0
    return draw.textbbox((0, 0), text, font=fnt)[2]


def wrap_segment(
    draw: ImageDraw.ImageDraw,
    segment: str,
    fnt: ImageFont.FreeTypeFont,
    max_width: int,
) -> list[str]:
    if not segment:
        return [""]
    words = segment.split(" ")
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if text_width(draw, candidate, fnt) <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
            current = ""
        if text_width(draw, word, fnt) <= max_width:
            current = word
            continue
        chunk = ""
        for ch in word:
            candidate = chunk + ch
            if text_width(draw, candidate, fnt) <= max_width:
                chunk = candidate
            else:
                if chunk:
                    lines.append(chunk)
                chunk = ch
        current = chunk
    if current:
        lines.append(current)
    return lines or [""]


def wrap_text(
    draw: ImageDraw.ImageDraw,
    text: object,
    fnt: ImageFont.FreeTypeFont,
    max_width: int,
) -> list[str]:
    lines: list[str] = []
    for segment in str(text).split("\n"):
        lines.extend(wrap_segment(draw, segment, fnt, max_width))
    return lines or [""]


def draw_multiline(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    lines: Sequence[str],
    fnt: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int] = TEXT,
    leading: int = 8,
) -> int:
    x, y = xy
    line_height = fnt.size + leading
    for line in lines:
        draw.text((x, y), line, font=fnt, fill=fill)
        y += line_height
    return y


def render_table(
    filename: str,
    title: str,
    rows: Sequence[Sequence[str]],
    col_ratios: Sequence[float],
    source: str | None = None,
    first_col_shaded: bool = False,
) -> None:
    temp = Image.new("RGB", (WIDTH, 100), WHITE)
    draw = ImageDraw.Draw(temp)

    table_width = WIDTH - MARGIN_X * 2
    total = sum(col_ratios)
    col_widths = [int(table_width * ratio / total) for ratio in col_ratios]
    col_widths[-1] += table_width - sum(col_widths)

    title_lines = wrap_text(draw, title, TITLE_FONT, table_width)
    source_lines = wrap_text(draw, source or "", CAPTION_FONT, table_width) if source else []

    row_heights: list[int] = []
    wrapped_rows: list[list[list[str]]] = []
    for row_index, row in enumerate(rows):
        row_cells: list[list[str]] = []
        max_lines = 1
        for col_index, cell in enumerate(row):
            fnt = HEADER_FONT if row_index == 0 else CELL_FONT
            max_cell_width = col_widths[col_index] - CELL_PAD_X * 2
            lines = wrap_text(draw, cell, fnt, max_cell_width)
            row_cells.append(lines)
            max_lines = max(max_lines, len(lines))
        wrapped_rows.append(row_cells)
        fnt = HEADER_FONT if row_index == 0 else CELL_FONT
        row_heights.append(max(62, max_lines * (fnt.size + 8) + CELL_PAD_Y * 2))

    title_height = len(title_lines) * (TITLE_FONT.size + 10)
    source_height = len(source_lines) * (CAPTION_FONT.size + 8) + (14 if source_lines else 0)
    table_height = sum(row_heights)
    height = MARGIN_Y + title_height + 30 + table_height + source_height + MARGIN_Y
    image = Image.new("RGB", (WIDTH, height), WHITE)
    draw = ImageDraw.Draw(image)

    y = MARGIN_Y
    y = draw_multiline(draw, (MARGIN_X, y), title_lines, TITLE_FONT, TEXT, 10)
    y += 30

    x_positions = [MARGIN_X]
    for width in col_widths[:-1]:
        x_positions.append(x_positions[-1] + width)

    for row_index, row_cells in enumerate(wrapped_rows):
        row_height = row_heights[row_index]
        x = MARGIN_X
        for col_index, lines in enumerate(row_cells):
            width = col_widths[col_index]
            bg = WHITE
            if row_index == 0:
                bg = HEADER_BG
            elif first_col_shaded and col_index == 0:
                bg = FIRST_COL_BG
            draw.rectangle((x, y, x + width, y + row_height), fill=bg, outline=GRID, width=2)
            fnt = HEADER_FONT if row_index == 0 else CELL_FONT
            fill = TEXT if row_index == 0 else TEXT
            draw_multiline(
                draw,
                (x + CELL_PAD_X, y + CELL_PAD_Y),
                lines,
                fnt,
                fill,
                8,
            )
            x += width
        y += row_height

    if source_lines:
        y += 14
        draw_multiline(draw, (MARGIN_X, y), source_lines, CAPTION_FONT, MUTED, 8)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    image.save(OUT_DIR / filename, "PNG", optimize=True)
    print(OUT_DIR / filename)


TABLES = [
    {
        "filename": "01-field-observation-table.png",
        "title": "표 1. 2026-06-02 이주택지 M4137 현장 관측 결과",
        "rows": [
            ["시각", "차량번호", "대기", "하차", "탑승", "미탑승/잔여", "비고"],
            ["08:33 이전", "3293", "6명", "미확인", "6명", "0명", "전원 탑승"],
            ["08:33", "6369", "8명", "미확인", "8명", "0명", "전원 탑승"],
            ["08:46", "1040", "7명", "1명", "3명", "4명", "도착 시 빈자리 2석, 하차 후 3명 탑승"],
            ["09:02 전후", "1043", "5명", "1명", "1명", "4명", "남은 인원이 적극적으로 줄을 서지 않는 모습 관측"],
            ["09:27 전후", "4811", "3명", "0명", "0명", "3명", "탑승 해소 없음"],
        ],
        "col_ratios": [1.3, 1.0, 0.8, 0.8, 0.8, 1.2, 3.1],
        "source": "출처: QueueBus 팀 현장 직접 관찰, 2026-06-02, 55305 이주택지 서울방향 정류장",
    },
    {
        "filename": "02-market-entry-table.png",
        "title": "표 2. 초기 시장 진입 후보와 검증 방식",
        "rows": [
            ["우선순위", "후보 정류장/유형", "선정 근거", "초기 검증 방식"],
            ["1", "55305 이주택지, M4137 서울방향", "현장 실사에서 미탑승과 후속 차량 대기 해소 지연 확인", "출근 시간대 2~3주 관찰, 호출 응답률·미탑승 감지율 측정"],
            ["2", "명동입구·명동성당 등 서울 도심 후반 정류장", "GBIS 예비 데이터에서 p20 잔여좌석 0석, 0석 신호 반복", "퇴근 시간대 잔여좌석·대기열 동시 수집"],
            ["3", "서울역버스환승센터 등 대형 환승 정류장", "승차 가능성은 남아 있으나 시간대별 호출 인원 조정 필요", "호출 인원 보수 정책, 분산 대기 안내 효과 측정"],
            ["4", "강남역·판교역 등 광역버스 대기열 밀집 정류장", "장시간 줄서기, 보행로 점유, 날씨 노출 문제가 반복되는 유형", "지자체/운수사 협의 후 노선 1~2개 제한 PoC"],
        ],
        "col_ratios": [0.9, 2.2, 3.0, 3.0],
    },
    {
        "filename": "03-service-comparison-table.png",
        "title": "표 3. 기존 서비스 대비 QueueBus 차별성",
        "rows": [
            ["구분", "기존 좌석예약 서비스", "버스 도착 알림 서비스", "QueueBus"],
            ["핵심 목적", "특정 차량 좌석 확보", "도착 시간 안내", "편한 대기와 승차 가능성 안내"],
            ["이용 조건", "예약 가능 차량/시간 선택", "정류장/노선 조회", "정류장 반경 내 위치 인증 후 체크인"],
            ["순번 기준", "예약 규칙 또는 예약 시점", "없음", "위치 인증 완료 시점 선착순"],
            ["AI 역할", "제한적", "제한적", "대기 수요·잔여좌석·호출 타이밍 예측"],
            ["현장 UX", "예약 확인 중심", "이용자 자율 대기", "줄 대신 대기번호로 기다리고 호출 시 이동"],
            ["운영 데이터", "예약 수요 중심", "조회·알림 중심", "대기·호출·탑승·미탑승·노쇼 데이터"],
        ],
        "col_ratios": [1.2, 2.4, 2.4, 3.0],
        "first_col_shaded": True,
    },
    {
        "filename": "04-roadmap-table.png",
        "title": "표 4. 사업 추진 목표 및 추진 계획",
        "rows": [
            ["단계", "기간", "목표", "핵심 산출물"],
            ["MVP", "1개월", "발표용 PoC 구현", "React 프로토타입, mock 데이터, 예측 로직"],
            ["현장 PoC", "2~3개월", "정류장 1곳, 노선 1~2개 실증", "관찰 데이터, 예측 오차, 사용자 피드백"],
            ["시범 운영", "4~6개월", "지자체·운수사 협력", "관리자 대시보드, 현장 안내, 수요 리포트"],
            ["사업화", "1년", "정류장 단위 SaaS", "구독형 대시보드, 정기 리포트, 운수사 운영 알림 API"],
        ],
        "col_ratios": [1.2, 1.2, 2.8, 3.8],
    },
    {
        "filename": "05-kpi-table.png",
        "title": "표 5. PoC 성과목표",
        "rows": [
            ["지표", "목표"],
            ["평균 물리적 줄서기 시간", "30% 이상 감소"],
            ["호출 응답률", "80% 이상"],
            ["차량별 탑승 가능 인원 예측 오차", "±3명 이내"],
            ["미탑승 발생 감지율", "80% 이상"],
            ["반복 혼잡 시간대 운영자 알림 정확도", "70% 이상"],
            ["정류장별·노선별·시간대별 대기 수요 리포트", "자동 생성"],
        ],
        "col_ratios": [3.7, 2.3],
        "first_col_shaded": True,
    },
    {
        "filename": "06-esg-table.png",
        "title": "표 6. 사회문제 해결 및 ESG 기대 효과",
        "rows": [
            ["사회문제", "기대 효과"],
            ["폭염·한파·우천 노출", "호출 전 분산 대기로 야외 대기 시간 감소"],
            ["교통약자 부담", "고령자, 임산부, 이동 약자의 장시간 줄서기 완화"],
            ["보행로 점유", "전체 줄 대신 호출 대상만 이동해 보행 불편 완화"],
            ["이용자 갈등", "고정 대기번호와 내 앞 대기 인원으로 순번 갈등 감소"],
            ["운영 데이터 부족", "실제 대기·탑승·미탑승 수요를 운영기관에 제공"],
        ],
        "col_ratios": [2.2, 4.8],
        "first_col_shaded": True,
    },
    {
        "filename": "07-technology-architecture-table.png",
        "title": "표 7. QueueBus 기술 구조",
        "rows": [
            ["모듈", "운영 초기", "확장 단계"],
            ["위치 인증", "Haversine 100m 판정", "PostGIS, 위치 이탈 감지"],
            ["대기열", "노선별 선착순 번호", "실시간 동기화, 운영자 개입 로그"],
            ["버스 데이터", "GBIS 수집 데이터", "공식 API 상시 연동, 장애 fallback"],
            ["예측", "전역 LightGBM + 세그먼트 보정", "세그먼트 모델 승격, 시계열 모델"],
            ["호출 정책", "안정 호출/불확실/다음차 권장 분리", "정책 최적화, A/B 검증"],
            ["대시보드", "React 집계 화면", "SaaS 관리자, 자동 리포트"],
            ["개인정보 보호", "최소 위치 저장, 집계 표시", "보관주기 자동화, 비식별화"],
        ],
        "col_ratios": [1.6, 3.4, 3.6],
        "first_col_shaded": True,
    },
    {
        "filename": "08-ai-modules-table.png",
        "title": "표 8. AI 기능과 운영 초기 구현",
        "rows": [
            ["AI 기능", "설명", "운영 초기 구현"],
            ["Demand Forecast AI", "정류장·노선·시간대별 대기 수요 예측", "이동평균, 요일·시간대 규칙"],
            ["SeatFlow AI", "차량별 목표 정류장 도착 시 예상 잔여좌석 예측", "전역 LightGBM + 세그먼트 보정"],
            ["Boarding Probability AI", "대기번호별 이번 차량 탑승 가능성 계산", "안정 호출/불확실/다음차 권장 분리"],
            ["Call Optimizer AI", "호출 인원, 호출 타이밍, 호출 대상 대기번호 구간 산정", "보수 호출 정책"],
            ["Congestion & Risk AI", "반복 만차, 보행로 점유, 폭염·한파 위험 알림", "혼잡 점수 규칙"],
            ["Anomaly Detection", "위치조작, 반복 노쇼, 중복 체크인 의심 탐지", "규칙 기반 탐지"],
        ],
        "col_ratios": [2.3, 3.9, 2.8],
        "first_col_shaded": True,
    },
    {
        "filename": "09-risk-response-table.png",
        "title": "표 9. 운영·법제 리스크 대응",
        "rows": [
            ["리스크", "발생 가능 상황", "대응 방안"],
            ["GPS 오차", "고층 건물, 지하 출구, 중앙차로 주변에서 위치가 흔들림", "100m 지오펜스와 GPS 정확도 값을 함께 확인하고, 정확도 낮음 상태에서는 체크인을 보류하거나 재인증 요청"],
            ["위치조작·대리 체크인", "정류장 밖에서 가짜 위치로 대기열 등록 시도", "위치 정확도, 체크인 후 이탈, 반복 이상 패턴을 탐지하고 운영자 검토 로그 생성"],
            ["노쇼", "호출받은 이용자가 기존 대기 위치로 오지 않음", "호출 확인 제한시간, 도착 구역 재인증, 반복 노쇼 사용자 보수 호출 반영"],
            ["앱 미사용자", "스마트폰 미사용자 또는 앱 접근이 어려운 이용자 존재", "PoC 단계에서는 QR 안내와 현장 안내 인력 보조를 병행하고, 상용 단계에서는 전광판·키오스크 연동 검토"],
            ["개인정보 과수집", "정밀 위치나 이동 경로가 장기 저장될 위험", "체크인 판정 후 원본 위치 장기 보관 금지, 집계·비식별 데이터 중심 대시보드 구성"],
        ],
        "col_ratios": [1.7, 3.0, 4.3],
        "first_col_shaded": True,
    },
]


def main() -> None:
    for table in TABLES:
        render_table(**table)


if __name__ == "__main__":
    main()
