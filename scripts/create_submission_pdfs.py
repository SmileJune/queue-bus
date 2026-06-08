#!/usr/bin/env python3
"""Generate QueueBus submission PDFs from the current proposal content.

The official HWP templates are mostly table/image objects on macOS, so this
script creates clean PDF versions with the official file names and leaves
personal data, consent checks, and signature fields as direct-input items.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterable, Sequence
import html
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image,
    KeepTogether,
    LongTable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "submission" / "pdf"
ASSET_DIR = ROOT / "docs" / "assets"
FONT_PATH = Path("/System/Library/Fonts/Supplemental/AppleGothic.ttf")
FALLBACK_FONT_PATH = Path("/System/Library/Fonts/Supplemental/NotoSansGothic-Regular.ttf")

PAGE_WIDTH, PAGE_HEIGHT = A4
LEFT = 17 * mm
RIGHT = 17 * mm
TOP = 15 * mm
BOTTOM = 15 * mm
DOC_WIDTH = PAGE_WIDTH - LEFT - RIGHT


def setup_fonts() -> None:
    font_path = FONT_PATH if FONT_PATH.exists() else FALLBACK_FONT_PATH
    if not font_path.exists():
        raise FileNotFoundError("Korean system font not found")
    pdfmetrics.registerFont(TTFont("Korean", str(font_path)))
    pdfmetrics.registerFont(TTFont("KoreanBold", str(font_path)))
    pdfmetrics.registerFontFamily("Korean", normal="Korean", bold="KoreanBold")


def make_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "KoTitle",
            parent=base["Title"],
            fontName="KoreanBold",
            fontSize=18,
            leading=24,
            alignment=TA_CENTER,
            spaceAfter=8 * mm,
        ),
        "subtitle": ParagraphStyle(
            "KoSubtitle",
            parent=base["BodyText"],
            fontName="Korean",
            fontSize=9,
            leading=13,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#374151"),
            spaceAfter=5 * mm,
        ),
        "h1": ParagraphStyle(
            "KoH1",
            parent=base["Heading1"],
            fontName="KoreanBold",
            fontSize=14,
            leading=19,
            textColor=colors.HexColor("#111827"),
            spaceBefore=5 * mm,
            spaceAfter=3 * mm,
        ),
        "h2": ParagraphStyle(
            "KoH2",
            parent=base["Heading2"],
            fontName="KoreanBold",
            fontSize=11.2,
            leading=15.5,
            textColor=colors.HexColor("#1f2937"),
            spaceBefore=4 * mm,
            spaceAfter=2 * mm,
        ),
        "body": ParagraphStyle(
            "KoBody",
            parent=base["BodyText"],
            fontName="Korean",
            fontSize=8.9,
            leading=13.2,
            alignment=TA_LEFT,
            spaceAfter=2.1 * mm,
        ),
        "small": ParagraphStyle(
            "KoSmall",
            parent=base["BodyText"],
            fontName="Korean",
            fontSize=7.3,
            leading=10.3,
            alignment=TA_LEFT,
        ),
        "cell": ParagraphStyle(
            "KoCell",
            parent=base["BodyText"],
            fontName="Korean",
            fontSize=7.3,
            leading=9.7,
            alignment=TA_LEFT,
        ),
        "cell_small": ParagraphStyle(
            "KoCellSmall",
            parent=base["BodyText"],
            fontName="Korean",
            fontSize=6.4,
            leading=8.2,
            alignment=TA_LEFT,
        ),
        "caption": ParagraphStyle(
            "KoCaption",
            parent=base["BodyText"],
            fontName="Korean",
            fontSize=7.2,
            leading=9.6,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#4b5563"),
            spaceBefore=1 * mm,
            spaceAfter=3 * mm,
        ),
        "note": ParagraphStyle(
            "KoNote",
            parent=base["BodyText"],
            fontName="Korean",
            fontSize=7.7,
            leading=10.8,
            textColor=colors.HexColor("#4b5563"),
            leftIndent=2 * mm,
            spaceBefore=1.5 * mm,
            spaceAfter=2.5 * mm,
        ),
        "signature": ParagraphStyle(
            "KoSignature",
            parent=base["BodyText"],
            fontName="Korean",
            fontSize=10,
            leading=18,
            alignment=TA_CENTER,
            spaceBefore=4 * mm,
        ),
        "right": ParagraphStyle(
            "KoRight",
            parent=base["BodyText"],
            fontName="Korean",
            fontSize=9,
            leading=13,
            alignment=TA_RIGHT,
        ),
    }


STYLES: dict[str, ParagraphStyle]


def clean(text: object) -> str:
    value = "" if text is None else str(text)
    value = value.replace("\n", "<br/>")
    value = re.sub(r"`([^`]+)`", r"\1", value)
    return html.escape(value, quote=False).replace("&lt;br/&gt;", "<br/>")


def p(text: object, style: str = "body") -> Paragraph:
    return Paragraph(clean(text), STYLES[style])


def bullets(items: Iterable[str]) -> list[Paragraph]:
    return [Paragraph(clean(item), STYLES["body"], bulletText="•") for item in items]


def table(
    rows: Sequence[Sequence[object]],
    col_widths: Sequence[float] | None = None,
    *,
    header: bool = True,
    first_col_header: bool = False,
    small: bool = False,
    repeat_rows: int | None = None,
) -> LongTable:
    if not rows:
        raise ValueError("table requires at least one row")
    col_count = max(len(row) for row in rows)
    if col_widths is None:
        col_widths = [DOC_WIDTH / col_count] * col_count
    cell_style = STYLES["cell_small" if small else "cell"]
    normalized = []
    for row in rows:
        full = list(row) + [""] * (col_count - len(row))
        normalized.append([Paragraph(clean(cell), cell_style) for cell in full])
    repeat = (1 if header else 0) if repeat_rows is None else repeat_rows
    flowable = LongTable(normalized, colWidths=col_widths, repeatRows=repeat, splitByRow=True)
    style = [
        ("FONTNAME", (0, 0), (-1, -1), "Korean"),
        ("FONTSIZE", (0, 0), (-1, -1), 6.4 if small else 7.3),
        ("LEADING", (0, 0), (-1, -1), 8.2 if small else 9.7),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d1d5db")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    if header:
        style.extend(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eef2ff")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#111827")),
                ("FONTNAME", (0, 0), (-1, 0), "KoreanBold"),
            ]
        )
    if first_col_header:
        style.extend(
            [
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f3f4f6")),
                ("FONTNAME", (0, 0), (0, -1), "KoreanBold"),
            ]
        )
    flowable.setStyle(TableStyle(style))
    return flowable


def add_table(story: list, *args, **kwargs) -> None:
    story.append(table(*args, **kwargs))
    story.append(Spacer(1, 3.2 * mm))


def add_image(story: list, image_path: Path, caption: str, max_h: float = 82 * mm) -> None:
    if not image_path.exists():
        story.append(p(f"[이미지 누락: {image_path.name}]", "note"))
        return
    reader = ImageReader(str(image_path))
    width, height = reader.getSize()
    scale = min(DOC_WIDTH / width, max_h / height)
    img = Image(str(image_path), width=width * scale, height=height * scale)
    story.append(KeepTogether([img, p(caption, "caption")]))


def footer(canvas, doc) -> None:
    canvas.saveState()
    canvas.setFont("Korean", 7)
    canvas.setFillColor(colors.HexColor("#6b7280"))
    canvas.drawString(LEFT, 8 * mm, "2026 LBS 스타트업 챌린지 | QueueBus 팀")
    canvas.drawRightString(PAGE_WIDTH - RIGHT, 8 * mm, str(canvas.getPageNumber()))
    canvas.restoreState()


def build_pdf(
    filename: str,
    story: list,
    *,
    top_margin: float = TOP,
    bottom_margin: float = BOTTOM,
    left_margin: float = LEFT,
    right_margin: float = RIGHT,
) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / filename
    doc = SimpleDocTemplate(
        str(path),
        pagesize=A4,
        leftMargin=left_margin,
        rightMargin=right_margin,
        topMargin=top_margin,
        bottomMargin=bottom_margin,
        title=filename,
        author="QueueBus team",
    )
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return path


def title_page(title: str, subtitle: str) -> list:
    return [
        Spacer(1, 8 * mm),
        p(title, "title"),
        p(subtitle, "subtitle"),
    ]


def make_application_pdf() -> Path:
    story = title_page(
        "[붙임1] 참가신청서",
        "지원분야: 아이디어 분야 | 기업명(팀명): QueueBus 팀 | 서비스명: QueueBus",
    )
    story.append(p("아래 개인정보 항목은 제출자가 직접 입력해야 합니다. 임의 기재하지 않도록 [직접 입력]으로 표시했습니다.", "note"))
    add_table(
        story,
        [
            ("항목", "내용"),
            ("지원분야", "아이디어 분야"),
            ("기업명(팀명)", "QueueBus 팀"),
            ("서비스명", "QueueBus"),
            ("사업 아이템명", "QueueBus: AI 기반 위치인증형 광역버스 정류장 혼잡 예측 및 탑승 호출 서비스"),
            ("대표자명", "[직접 입력]"),
            ("생년월일", "[직접 입력]"),
            ("휴대전화", "[직접 입력]"),
            ("이메일", "[직접 입력]"),
            ("주소", "[직접 입력]"),
            ("팀원명", "[직접 입력]"),
            ("청년 요건 해당자", "[직접 입력]"),
            ("동일 아이템 수상 이력", "[직접 입력: 없음/있음]"),
            ("위치정보사업/위치기반서비스사업 보유 여부", "[직접 입력: 해당 없음/보유 여부 확인]"),
        ],
        [42 * mm, DOC_WIDTH - 42 * mm],
        first_col_header=True,
        repeat_rows=1,
    )

    story.append(p("1. 사업 아이템 요약", "h1"))
    add_table(
        story,
        [
            ("구분", "내용"),
            (
                "한 줄 소개",
                "QueueBus는 정류장 반경 내 위치 인증으로 광역버스 노선별 가상 대기열을 만들고, AI가 다음 버스 승차 가능성과 호출 타이밍을 예측해 이용자가 줄 대신 대기번호로 편하게 기다릴 수 있게 하는 LBS 기반 대중교통 대기 관리 서비스입니다.",
            ),
            (
                "3줄 요약",
                "QueueBus는 광역버스 정류장의 물리적 줄서기를 위치정보 기반 가상 대기열로 전환하는 서비스입니다.\n정류장에 실제 도착한 승객만 위치 인증 후 노선별 대기번호를 받고, AI는 차량 잔여좌석과 대기 수요를 바탕으로 안정 호출·불확실·다음차 권장을 안내합니다.\n이용자는 장시간 줄서기와 탑승 불확실성을 줄이고, 지자체와 운수사는 정류장별 실제 대기·미탑승 수요 데이터를 확보할 수 있습니다.",
            ),
            (
                "핵심 키워드",
                "위치 인증, 광역버스, 가상 대기열, 대기번호, 잔여좌석 예측, 탑승 호출, AI 호출 최적화, 정류장 혼잡 관리, 미탑승 수요 데이터, B2G/B2B SaaS",
            ),
        ],
        [35 * mm, DOC_WIDTH - 35 * mm],
        first_col_header=True,
        repeat_rows=1,
    )

    story.append(p("2. 참가신청서 서술란", "h1"))
    add_table(
        story,
        [
            ("항목", "복붙용 문구"),
            (
                "아이디어 개요",
                "QueueBus는 광역버스 정류장에 실제 도착한 승객만 위치 인증 후 노선별 가상 대기열에 등록하고, AI가 차량 잔여좌석과 대기 수요를 분석해 이번 차량 안정 호출 인원과 다음차 안내 대상을 예측하는 서비스입니다. 이용자는 계속 줄을 서지 않고 대기번호로 기다릴 수 있으며, 운영기관은 실제 대기·미탑승 수요 데이터를 확보할 수 있습니다.",
            ),
            (
                "개발 동기",
                "출퇴근 시간대 광역버스 정류장에서는 긴 줄, 폭염·한파 노출, 보행로 점유, 새치기 갈등, 탑승 가능성 불확실성이 반복됩니다. 반면 지자체와 운수사는 정류장별 실제 대기 인원과 미탑승 인원을 정량적으로 파악하기 어렵습니다. QueueBus는 이 오프라인 줄서기 문제를 위치 인증 대기열과 AI 예측 데이터로 전환해 이용자 편의와 운영 효율을 함께 높이고자 합니다.",
            ),
            (
                "LBS 활용",
                "QueueBus에서 위치정보는 서비스의 핵심 조건입니다. 사용자가 정류장 반경 내에 실제 도착했는지 GPS와 정류장 좌표를 비교해 확인하고, 위치 인증이 완료된 승객에게만 노선별 대기번호를 부여합니다. 이후 위치 이탈 여부, 버스 실시간 위치, 정류장 순번을 활용해 호출 시점과 기존 대기 위치 이동 안내를 계산합니다.",
            ),
            (
                "AI 활용",
                "QueueBus의 AI는 승객 순번을 정하지 않습니다. 순번은 위치 인증 기반 선착순으로 보장하고, AI는 차량별 잔여좌석, 시간대별 수요, 대기열 길이, 노쇼율, 현장 관찰 결과를 바탕으로 안정 호출 인원, 불확실 인원, 다음차 권장 인원, 반복 미탑승 위험을 예측합니다. 현재는 GBIS 데이터 기반 SeatFlow 모델과 보수 호출 정책으로 MVP를 검증합니다.",
            ),
            (
                "기대효과",
                "이용자는 정류장 앞에 계속 줄을 서지 않아도 내 대기번호와 다음 차량 승차 가능성을 확인할 수 있어 야외 대기 부담과 탑승 불확실성을 줄일 수 있습니다. 지자체와 운수사는 정류장별·노선별·시간대별 실제 대기 수요와 미탑승 신호를 확보해 배차 조정, 예비차 투입, 현장 안내 인력 배치, 폭염·한파 안전 대응의 근거로 활용할 수 있습니다.",
            ),
        ],
        [34 * mm, DOC_WIDTH - 34 * mm],
        first_col_header=True,
        repeat_rows=1,
    )

    story.append(p("3. 신청 확인", "h1"))
    add_table(
        story,
        [
            ("확인 항목", "체크"),
            ("제출 내용이 사실과 다름없음을 확인합니다.", "□ 확인"),
            ("타인의 지식재산권을 침해하지 않은 순수 창작물임을 확인합니다.", "□ 확인"),
            ("최근 3년 이내 동일 아이템으로 정부·공공기관 공모전/지원사업에서 선정된 이력이 있는지 확인했습니다.", "□ 없음  □ 있음"),
            ("개인정보 수집·이용 및 참가 신청 서약서에 동의했습니다.", "□ 동의"),
        ],
        [105 * mm, DOC_WIDTH - 105 * mm],
        first_col_header=True,
    )
    story.append(p("2026년        월        일", "signature"))
    story.append(p("신청자 성명: 대표  ______________________________  (인 또는 서명)", "signature"))
    return build_pdf("아이디어_QueueBus팀_참가신청서.pdf", story)


def make_business_plan_pdf() -> Path:
    story = title_page(
        "[붙임2] 사업계획서",
        "QueueBus: AI 기반 위치인증형 광역버스 정류장 혼잡 예측 및 탑승 호출 서비스",
    )
    add_table(
        story,
        [
            ("항목", "내용"),
            ("지원분야", "아이디어 분야"),
            ("기업명(팀명)", "QueueBus 팀"),
            ("서비스명", "QueueBus"),
            ("작성일", "2026-06-07"),
            ("제출처", "LBS@kmac.co.kr"),
        ],
        [42 * mm, DOC_WIDTH - 42 * mm],
        first_col_header=True,
    )

    story.append(p("핵심 검증 상태 요약", "h1"))
    add_table(
        story,
        [
            ("구분", "현재 확인된 내용", "PoC에서 추가 검증할 항목"),
            ("문제 검증", "2026-06-02 이주택지 현장 실사에서 08:46 이후 미탑승과 대기 해소 지연 확인", "다른 시간대·정류장에서도 반복되는지 확인"),
            ("공공데이터 근거", "M4137 GBIS 잔여좌석·도착·위치 스냅샷과 탑승 추정 데이터 수집", "공식 API 상시 연동, 장애 fallback"),
            ("AI 가능성", "SeatFlow 모델 비교에서 LightGBM이 규칙 baseline 대비 MAE 개선", "3~4주 이상 추가 데이터로 재학습·재평가"),
            ("사용자 UX", "React 프로토타입에서 위치 인증, 대기번호, 호출 보류, 다음차 안내 시연 가능", "실제 사용자 호출 응답률, 노쇼율 측정"),
            ("사업화", "지자체 PoC, 정류장 단위 SaaS, 운수사 리포트 모델 가정 수립", "구매자 인터뷰, 지자체/운수사 협력 의사 확인"),
        ],
        [27 * mm, 78 * mm, DOC_WIDTH - 105 * mm],
        small=True,
    )

    story.append(p("1. 사업 아이템 개요", "h1"))
    story += [
        p("QueueBus는 광역버스 정류장의 물리적 줄서기를 위치정보 기반 가상 대기열로 전환하고, AI가 다음 버스 승차 가능성과 호출 타이밍을 예측해 이용자가 줄 대신 대기번호로 편하게 기다릴 수 있게 하는 LBS 기반 대중교통 대기 관리 서비스입니다."),
        p("QueueBus는 좌석예약 서비스가 아닙니다. 특정 차량의 좌석을 사전에 확보하는 방식이 아니라, 정류장에 실제 도착한 승객만 위치 인증 후 노선별 대기열에 등록하고, 고정 대기번호와 내 앞 대기 인원을 안내합니다. AI는 이번 차량에 몇 명이 탈 수 있는지, 어느 대기번호 구간을 언제 기존 노선 대기 위치로 호출해야 하는지, 다음 차량 안내가 필요한지를 예측합니다."),
        p("핵심 고객은 출퇴근 광역버스 이용자와 지자체·운수사·교통 운영기관입니다. 이용자는 장시간 줄서기와 탑승 불확실성을 줄이고, 운영기관은 정류장별·노선별·시간대별 실제 대기 수요와 미탑승 신호를 확보할 수 있습니다."),
    ]
    add_image(
        story,
        ASSET_DIR / "queuebus-service-flow.png",
        "그림 1. 위치 인증부터 대기번호, AI 예측, 호출 안내, 운영자 집계까지 이어지는 QueueBus 서비스 흐름",
        max_h=60 * mm,
    )

    story.append(p("2. 문제 인식과 필요성", "h1"))
    story += [
        p("수도권 광역버스 정류장은 출퇴근 시간대에 긴 물리적 대기줄이 반복됩니다. 이용자는 이번 차를 탈 수 있는지 알기 어려워 줄을 계속 유지해야 하고, 폭염·한파·우천 상황에서는 야외 대기 자체가 안전 부담이 됩니다. 긴 줄은 보행로를 점유하고, 새치기나 순번 확인 과정에서 이용자 간 갈등을 만들기도 합니다."),
        p("운영기관에도 문제가 남습니다. 버스 도착 정보와 잔여좌석 정보는 제공되지만, 정류장별 실제 대기 인원, 탑승하지 못한 인원, 줄 길이, 분산 대기 가능성, 승차 포기 행동은 정량적으로 축적되기 어렵습니다. 그 결과 배차 조정, 예비차 투입, 현장 안내 인력 배치, 폭염·한파 안전 대응이 민원과 체감에 의존하게 됩니다."),
    ]
    story.append(p("현장 실사 근거", "h2"))
    add_table(
        story,
        [
            ("시각", "차량번호", "대기", "하차", "탑승", "미탑승/잔여", "비고"),
            ("08:33 이전", "3293", "6명", "미확인", "6명", "0명", "전원 탑승"),
            ("08:33", "6369", "8명", "미확인", "8명", "0명", "전원 탑승"),
            ("08:46", "1040", "7명", "1명", "3명", "4명", "도착 시 빈자리 2석, 하차 후 3명 탑승"),
            ("09:02 전후", "1043", "5명", "1명", "1명", "4명", "남은 인원이 적극적으로 줄을 서지 않는 모습 관측"),
            ("09:27 전후", "4811", "3명", "0명", "0명", "3명", "탑승 해소 없음"),
        ],
        [24 * mm, 21 * mm, 15 * mm, 15 * mm, 15 * mm, 23 * mm, DOC_WIDTH - 113 * mm],
        small=True,
    )
    story.append(p("이 실사 결과는 잔여좌석 정보만으로는 실제 대기 인원과 미탑승 인원이 보이지 않는다는 점을 보여줍니다. QueueBus는 위치 인증 대기열과 탑승 결과 데이터를 결합해 이용자에게는 다음 차량 승차 가능성을 안내하고, 운영기관에는 실제 미탑승 수요 신호를 제공합니다."))

    story.append(p("3. 공식 GBIS 데이터 기반 예비 검증", "h1"))
    add_table(
        story,
        [
            ("구분", "값"),
            ("수집 기간", "2026-05-28 13:47 ~ 2026-05-30 20:30"),
            ("원본 스냅샷 행", "30,930"),
            ("위치 스냅샷 행", "25,077"),
            ("도착 스냅샷 행", "5,849"),
            ("탑승 추정 행", "909"),
            ("대상 노선", "M4137"),
            ("대상 정류장", "14곳"),
        ],
        [45 * mm, DOC_WIDTH - 45 * mm],
        first_col_header=True,
    )
    add_table(
        story,
        [
            ("정류장", "샘플", "관측일", "p20 잔여좌석", "중앙값", "0석 신호", "10석 이하", "제출 해석"),
            ("서울역버스환승센터", "377", "3", "15석", "28석", "8.2%", "14.9%", "호출 인원 조정 필요"),
            ("명동입구", "452", "3", "0석", "12석", "32.1%", "45.6%", "다음차 안내 필요"),
            ("명동성당", "151", "3", "0석", "3석", "44.4%", "60.3%", "다음차 안내 필요"),
        ],
        [35 * mm, 16 * mm, 16 * mm, 24 * mm, 18 * mm, 18 * mm, 20 * mm, DOC_WIDTH - 147 * mm],
        small=True,
    )
    add_image(
        story,
        ASSET_DIR / "gbis-evening-station-risk.png",
        "그림 2. 서울 도심 후반 정류장으로 갈수록 잔여좌석 위험이 커지는 예비 데이터",
        max_h=78 * mm,
    )

    story.append(p("4. 해결 방안과 서비스 흐름", "h1"))
    story += bullets(
        [
            "사용자가 광역버스 정류장 근처에 도착하면 GPS와 정류장 좌표를 비교해 위치 인증을 수행합니다.",
            "위치 인증이 완료된 승객에게만 노선별 가상 대기번호를 부여하고, 순번은 선착순으로 고정합니다.",
            "앞사람의 탑승, 취소, 노쇼를 반영해 내 앞 대기 인원을 갱신합니다.",
            "AI는 차량 잔여좌석, 목표 정류장까지의 승하차 패턴, 현재 대기열, 시간대별 수요를 결합해 이번 버스와 다음 버스 승차 가능성을 계산합니다.",
            "버스 도착 전 탑승 가능성이 높은 대기번호 구간만 기존 노선 대기 위치로 호출하고, 호출되지 않은 이용자는 주변 그늘·쉼터·실내 공간에서 계속 대기할 수 있습니다.",
        ]
    )
    story.append(p("AI는 순번을 정하지 않습니다. 순번은 위치 인증 기반 선착순으로 보장하고, AI는 예측과 운영 최적화에만 사용합니다. 이 구조는 공정성 논란을 줄이고, 심사위원과 운영기관이 이해하기 쉬운 설명 가능한 서비스 구조를 만듭니다."))

    story.append(p("5. LBS 활용 계획", "h1"))
    add_table(
        story,
        [
            ("위치정보 요소", "활용 목적"),
            ("사용자 현재 위치", "실제 정류장 도착 여부 확인"),
            ("정류장 좌표", "100m 반경 지오펜스 기준"),
            ("위치 이탈 여부", "대기열 유지, 재인증, 노쇼 판단"),
            ("버스 실시간 위치", "호출 시점 계산"),
            ("차량 정류장 순번", "목표 정류장 도착 시 예상 잔여좌석 계산"),
            ("주변 공간 정보", "호출 전 분산 대기 장소 안내"),
        ],
        [42 * mm, DOC_WIDTH - 42 * mm],
        first_col_header=True,
    )
    story.append(p("운영 초기에는 Haversine 거리 계산으로 사용자와 정류장 간 거리를 산정하고, 100m 이내일 때 체크인을 허용합니다. 서비스 적용 단계에서는 PostGIS 기반 지오펜스, GPS 정확도 보정, 위치 이탈 감지, 정류장 주변 대기 가능 공간 안내를 함께 적용합니다."))

    story.append(p("6. AI 활용 계획", "h1"))
    add_table(
        story,
        [
            ("AI 기능", "설명", "운영 초기 구현"),
            ("Demand Forecast AI", "정류장·노선·시간대별 대기 수요 예측", "이동평균, 요일·시간대 규칙"),
            ("SeatFlow AI", "차량별 목표 정류장 도착 시 예상 잔여좌석 예측", "전역 LightGBM + 세그먼트 보정"),
            ("Boarding Probability AI", "대기번호별 이번 차량 탑승 가능성 계산", "안정 호출/불확실/다음차 권장 분리"),
            ("Call Optimizer AI", "호출 인원, 호출 타이밍, 호출 대상 대기번호 구간 산정", "보수 호출 정책"),
            ("Congestion & Risk AI", "반복 만차, 보행로 점유, 폭염·한파 위험 알림", "혼잡 점수 규칙"),
            ("Anomaly Detection", "위치조작, 반복 노쇼, 중복 체크인 의심 탐지", "규칙 기반 탐지"),
        ],
        [38 * mm, 78 * mm, DOC_WIDTH - 116 * mm],
        small=True,
    )
    story.append(p("GBIS 스냅샷과 좌석 변화 기반 탑승 추정치 1,937건으로 SeatFlow AI 학습 데이터셋을 생성하고, Random Forest, LightGBM, XGBoost 회귀 모델을 규칙 기반 baseline과 비교했습니다. 최신 날짜 holdout 검증에서 LightGBM은 MAE 2.69석으로 baseline 3.96석 대비 32.1% 개선했고, 날짜별 교차검증 평균에서도 LightGBM은 MAE 2.81석으로 baseline 4.10석 대비 31.4% 개선되어 운영 초기 기본 모델로 선정했습니다."))
    add_image(
        story,
        ASSET_DIR / "prototype-ai-prediction.jpg",
        "그림 3. SeatFlow AI는 안정 호출, 불확실, 다음차 권장을 분리해 보수적으로 안내한다",
        max_h=70 * mm,
    )

    story.append(p("7. 창의성 및 차별성", "h1"))
    add_table(
        story,
        [
            ("구분", "기존 좌석예약 서비스", "버스 도착 알림 서비스", "QueueBus"),
            ("핵심 목적", "특정 차량 좌석 확보", "도착 시간 안내", "편한 대기와 승차 가능성 안내"),
            ("위치정보 역할", "보조적", "선택적", "체크인의 필수 조건"),
            ("순번 기준", "예약 규칙 또는 예약 시점", "없음", "위치 인증 완료 시점"),
            ("AI 역할", "제한적", "제한적", "수요·잔여좌석·호출 타이밍 예측"),
            ("현장 UX", "예약 확인", "자율 대기", "대기번호로 기다리고 호출 시 이동"),
            ("운영 데이터", "예약 수요 중심", "조회·알림 중심", "대기·탑승·미탑승·노쇼 데이터"),
        ],
        [28 * mm, 48 * mm, 48 * mm, DOC_WIDTH - 124 * mm],
        small=True,
    )
    story += bullets(
        [
            "정류장에 실제 도착한 사람만 대기열에 들어갈 수 있습니다.",
            "대기 순번은 AI가 아니라 위치 인증 기반 선착순으로 보장합니다.",
            "이용자 편의와 운영기관 데이터 수요를 동시에 해결합니다.",
        ]
    )

    story.append(p("8. 시장성 및 고객 수요", "h1"))
    story += [
        p("1차 사용자는 출퇴근 광역버스 이용자입니다. 특히 장시간 줄서기 부담이 큰 직장인, 고령자, 임산부, 교통약자, 초행길 이용자, 폭염·한파 취약 이용자에게 필요성이 큽니다."),
        p("2차 고객은 지자체, 운수사, 교통 운영기관, 정류장 관리기관입니다. 이들은 혼잡 정류장 관리, 민원 대응, 배차 개선, 현장 질서 유지, 폭염·한파 안전 대응을 위해 실제 대기 수요 데이터가 필요합니다."),
    ]
    add_table(
        story,
        [
            ("우선순위", "후보 정류장/유형", "선정 근거", "초기 검증 방식"),
            ("1", "55305 이주택지, M4137 서울방향", "현장 실사에서 미탑승과 후속 차량 대기 해소 지연 확인", "출근 시간대 2~3주 관찰, 호출 응답률·미탑승 감지율 측정"),
            ("2", "명동입구·명동성당 등 서울 도심 후반 정류장", "GBIS 예비 데이터에서 p20 잔여좌석 0석, 0석 신호 반복", "퇴근 시간대 잔여좌석·대기열 동시 수집"),
            ("3", "서울역버스환승센터 등 대형 환승 정류장", "승차 가능성은 남아 있으나 시간대별 호출 인원 조정 필요", "호출 인원 보수 정책, 분산 대기 안내 효과 측정"),
        ],
        [22 * mm, 49 * mm, 59 * mm, DOC_WIDTH - 130 * mm],
        small=True,
    )

    story.append(p("9. 사업화 모델", "h1"))
    story.append(p("B2C 직접 과금보다 B2G/B2B SaaS 모델이 적합합니다. 개인 이용자는 무료 또는 지자체 서비스로 제공하고, 운영기관이 정류장 단위 SaaS 이용료와 수요 리포트 비용을 부담합니다."))
    add_table(
        story,
        [
            ("모델", "설명"),
            ("지자체 PoC 구축비", "혼잡 정류장 대상 초기 실증 구축"),
            ("정류장 단위 SaaS", "대기열·혼잡 대시보드 월 이용료"),
            ("운수사 데이터 구독", "노선별 대기 수요, 만차 반복, 배차 개선 리포트"),
            ("운영 알림 API", "피크 수요, 미탑승 반복, 예비차 검토 알림"),
            ("현장 키트 설치비", "QR 안내판, 바닥 노선번호 연계 안내, 전광판 연동"),
            ("API 연동·유지보수", "지자체·운수사 시스템 연동"),
        ],
        [45 * mm, DOC_WIDTH - 45 * mm],
        first_col_header=True,
    )
    add_table(
        story,
        [
            ("단계", "대상 범위", "과금 구조 가정", "검증할 지표"),
            ("1차 PoC", "혼잡 정류장 1곳, 노선 1~2개, 2~3개월", "구축·운영비 1,500만~3,000만원", "미탑승 감지율, 호출 응답률, 물리적 줄서기 시간 감소"),
            ("시범 운영", "같은 지자체 내 3~5개 정류장", "정류장당 월 30만~80만원 SaaS + 현장 키트 100만~300만원", "정류장별 반복 혼잡 알림 정확도, 운영자 리포트 활용도"),
            ("운수사 리포트", "혼잡 노선 단위 월간 수요 분석", "기관당 월 100만~300만원 데이터 리포트", "만차 반복 구간, 시간대별 수요 절단, 배차 조정 후보 도출"),
        ],
        [24 * mm, 53 * mm, 55 * mm, DOC_WIDTH - 132 * mm],
        small=True,
    )

    story.append(p("10. 기술 실현 가능성", "h1"))
    story.append(p("QueueBus는 Vite, React, TypeScript 기반 웹 화면과 미니PC GBIS 수집 파이프라인, SeatFlow 학습·검증 스크립트로 구성되어 있습니다. 현재 사용자 화면, AI 판단 화면, 운영자 대시보드에서 잔여좌석 예측, 안정 호출 인원, 불확실 인원, 다음차 권장 판단을 시연할 수 있습니다."))
    add_table(
        story,
        [
            ("모듈", "운영 초기", "확장 단계"),
            ("위치 인증", "Haversine 100m 판정", "PostGIS, 위치 이탈 감지"),
            ("대기열", "노선별 선착순 번호", "실시간 동기화, 운영자 개입 로그"),
            ("버스 데이터", "GBIS 수집 데이터", "공식 API 상시 연동, 장애 fallback"),
            ("예측", "전역 LightGBM + 세그먼트 보정", "세그먼트 모델 승격, 시계열 모델"),
            ("호출 정책", "안정 호출/불확실/다음차 권장 분리", "정책 최적화, A/B 검증"),
            ("대시보드", "React 집계 화면", "SaaS 관리자, 자동 리포트"),
            ("개인정보 보호", "최소 위치 저장, 집계 표시", "보관주기 자동화, 비식별화"),
        ],
        [37 * mm, 68 * mm, DOC_WIDTH - 105 * mm],
        small=True,
    )
    add_image(
        story,
        ASSET_DIR / "prototype-passenger-checkin.jpg",
        "그림 4. 사용자 화면: 위치 인증, 고정 대기번호, 호출 보류, 다음차 안내",
        max_h=68 * mm,
    )
    add_image(
        story,
        ASSET_DIR / "prototype-operator-dashboard.jpg",
        "그림 5. 운영자 대시보드: 대기 인원, 안정 호출 인원, 다음차 권장 인원, 미탑승 위험",
        max_h=68 * mm,
    )

    story.append(p("11. 개인정보 및 위치정보 보호", "h1"))
    story += bullets(
        [
            "위치정보는 정류장 체크인, 대기열 유지, 호출 안내 목적에 한정해 사용합니다.",
            "개인의 정밀 이동 경로를 장기 저장하지 않고, 운영자 대시보드에는 정류장·노선·시간대 단위 집계 데이터만 표시합니다.",
            "탑승 완료 후 개인 식별 가능한 위치정보는 최소 보관하고, 통계 목적 데이터는 비식별화합니다.",
            "위치정보사업 또는 위치기반서비스 신고·등록 필요 여부는 사업화 단계에서 법률 자문과 함께 검토합니다.",
        ]
    )
    add_table(
        story,
        [
            ("리스크", "발생 가능 상황", "대응 방안"),
            ("GPS 오차", "고층 건물, 지하 출구, 중앙차로 주변에서 위치가 흔들림", "100m 지오펜스와 GPS 정확도 값을 함께 확인하고, 정확도 낮음 상태에서는 체크인을 보류하거나 재인증 요청"),
            ("위치조작·대리 체크인", "정류장 밖에서 가짜 위치로 대기열 등록 시도", "위치 정확도, 체크인 후 이탈, 반복 이상 패턴을 탐지하고 운영자 검토 로그 생성"),
            ("노쇼", "호출받은 이용자가 기존 대기 위치로 오지 않음", "호출 확인 제한시간, 도착 구역 재인증, 반복 노쇼 사용자 보수 호출 반영"),
            ("앱 미사용자", "스마트폰 미사용자 또는 앱 접근이 어려운 이용자 존재", "PoC 단계에서는 QR 안내와 현장 안내 인력 보조를 병행하고, 상용 단계에서는 전광판·키오스크 연동 검토"),
            ("개인정보 과수집", "정밀 위치나 이동 경로가 장기 저장될 위험", "체크인 판정 후 원본 위치 장기 보관 금지, 집계·비식별 데이터 중심 대시보드 구성"),
        ],
        [34 * mm, 58 * mm, DOC_WIDTH - 92 * mm],
        small=True,
    )
    add_image(
        story,
        ASSET_DIR / "privacy-data-flow.png",
        "그림 6. 개인 단위 정밀 위치 대신 집계 지표 중심으로 운영하는 개인정보 보호 구조",
        max_h=62 * mm,
    )

    story.append(p("12. PoC 계획 및 성과지표", "h1"))
    add_table(
        story,
        [
            ("단계", "기간", "목표", "산출물"),
            ("MVP", "1개월", "발표용 프로토타입 완성", "사용자 화면, 운영자 대시보드, 예측 로직"),
            ("현장 PoC", "2~3개월", "정류장 1곳 실증", "관찰 데이터, 예측 오차, 사용자 피드백"),
            ("시범 운영", "4~6개월", "지자체·운수사 협력", "현장 안내, 대시보드, 수요 리포트"),
            ("사업화", "1년", "정류장 단위 SaaS", "구독형 대시보드, 운영 알림 API"),
        ],
        [24 * mm, 24 * mm, 60 * mm, DOC_WIDTH - 108 * mm],
        small=True,
    )
    add_table(
        story,
        [
            ("지표", "목표"),
            ("평균 물리적 줄서기 시간", "30% 이상 감소"),
            ("호출 응답률", "80% 이상"),
            ("차량별 탑승 가능 인원 예측 오차", "±3명 이내"),
            ("미탑승 발생 감지율", "80% 이상"),
            ("반복 혼잡 시간대 운영자 알림 정확도", "70% 이상"),
            ("정류장별·노선별·시간대별 리포트", "자동 생성"),
        ],
        [70 * mm, DOC_WIDTH - 70 * mm],
        first_col_header=True,
    )

    story.append(p("13. 사회적 가치", "h1"))
    add_table(
        story,
        [
            ("사회문제", "기대 효과"),
            ("폭염·한파·우천 노출", "호출 전 분산 대기로 야외 대기 시간 감소"),
            ("교통약자 부담", "고령자, 임산부, 이동 약자의 장시간 줄서기 완화"),
            ("보행로 점유", "전체 줄 대신 호출 대상만 이동해 보행 불편 완화"),
            ("이용자 갈등", "고정 대기번호와 내 앞 대기 인원으로 순번 갈등 감소"),
            ("운영 데이터 부족", "실제 대기·탑승·미탑승 수요를 운영기관에 제공"),
        ],
        [58 * mm, DOC_WIDTH - 58 * mm],
        first_col_header=True,
    )

    story.append(p("14. 팀 역량 및 향후 계획", "h1"))
    story.append(p("QueueBus 팀은 위치기반 서비스 기획, 프론트엔드 프로토타입 구현, 교통 데이터 수집·분석, 현장 PoC 설계 역량을 중심으로 사업을 추진합니다. 공모전 선정 후에는 BM 컨설팅, 기술 멘토링, AI 전환 컨설팅을 활용해 위치정보 법제 검토, 공식 API 연동, 지자체·운수사 협력, 현장 실증 운영 역량을 보완합니다."))
    add_table(
        story,
        [
            ("역량", "현재 산출물", "심사 대응 포인트"),
            ("문제 정의·기획", "최종 사업계획서, 1페이지 요약, 차별성 문서", "아이디어 구체성, 창의성"),
            ("프론트엔드 구현", "사용자 플로우, 운영자 대시보드, AI 예측 탭", "발표 시연 가능성, 기술 실현 가능성"),
            ("데이터 수집·분석", "GBIS 수집 스크립트, 잔여좌석 분석, 현장 관찰 CSV", "시장성 근거, PoC 검증 가능성"),
            ("AI 모델링", "SeatFlow 학습 데이터셋, LightGBM/XGBoost/Random Forest 비교", "AI 활용, 과적합 방지 계획"),
            ("운영 설계", "이벤트 로그, 보수 호출 정책, 재학습·fallback 기준", "실제 서비스 전환 가능성"),
        ],
        [38 * mm, 72 * mm, DOC_WIDTH - 110 * mm],
        small=True,
    )
    add_table(
        story,
        [
            ("기간", "실행 내용", "완료 기준"),
            ("1주차", "공식 API 연동 범위와 PoC 후보 정류장 1곳 확정", "대상 정류장, 노선, 관찰 시간대 고정"),
            ("2주차", "사용자 체크인·호출·탑승 결과 이벤트 로그 설계 구체화", "check_in, call_sent, boarding_failed 등 핵심 이벤트 스키마 확정"),
            ("3주차", "현장 관찰 3회 이상 추가 수집 및 모델 재학습", "날짜별 holdout 기준 예측 오차 재산정"),
            ("4주차", "지자체·운수사 제안용 PoC 패키지 작성", "PoC 범위, 비용, KPI, 개인정보 보호 방안 포함 제안서 완성"),
        ],
        [24 * mm, 80 * mm, DOC_WIDTH - 104 * mm],
        small=True,
    )

    story.append(p("최종 강조 문장", "h1"))
    story.append(p("QueueBus는 광역버스 좌석을 예약하는 서비스가 아니라, 정류장에 실제 도착한 승객의 대기 순서를 위치정보로 인증하고, AI가 차량별 승차 가능성과 호출 시점을 예측해 물리적 줄서기 부담을 줄이는 정류장 대기 관리 서비스입니다. GBIS 공식 API 데이터는 승차 가능성 변동을 보여주고, 55305 이주택지 현장 실사는 실제 미탑승과 대기 해소 지연이 발생함을 확인했습니다. QueueBus는 이 두 데이터를 결합해 이용자에게는 이번 차를 탈 수 있는지를 안내하고, 운영기관에는 어느 정류장·시간대에 실제 수요가 해소되지 않는지를 제공하는 LBS 기반 공공 교통 서비스입니다."))
    story.append(p("참고 자료: 2026 LBS 스타트업 챌린지 공식 모집요강, 경기도 GBIS 수집 데이터, 2026-06-02 이주택지 현장 실사 데이터, QueueBus React 프로토타입", "note"))

    return build_pdf("아이디어_QueueBus팀_사업계획서.pdf", story)


def make_consent_pdf() -> Path:
    story = [
        Spacer(1, 2 * mm),
        p("[붙임3] 개인정보 수집·이용 동의서 및 참가 신청 서약서", "title"),
        p("지원분야: 아이디어 분야 | 기업명(팀명): QueueBus 팀 | 서비스명: QueueBus", "subtitle"),
    ]
    story.append(p("대표자 정보, 동의 체크, 날짜, 서명 또는 날인은 제출자가 직접 작성해야 합니다.", "note"))
    add_table(
        story,
        [
            ("항목", "내용"),
            ("지원분야", "아이디어 분야"),
            ("기업명(팀명)", "QueueBus 팀"),
            ("서비스명", "QueueBus"),
            ("대표자 성명", "[직접 입력]"),
            ("대표자 생년월일", "[직접 입력]"),
            ("대표자 연락처", "[직접 입력]"),
            ("대표자 이메일", "[직접 입력]"),
        ],
        [42 * mm, DOC_WIDTH - 42 * mm],
        first_col_header=True,
    )

    story.append(p("1. 개인정보 수집 및 이용 동의", "h1"))
    add_table(
        story,
        [
            ("구분", "내용"),
            ("수집·이용 목적", "2026 LBS 스타트업 챌린지 참가 접수, 자격 확인, 심사, 선정 및 사업화 지원, 공지·연락, 사업 운영 및 통계 관리"),
            ("수집 항목", "성명, 생년월일, 휴대전화, 이메일, 주소, 소속/팀명, 신청서 및 사업계획서 기재 정보, 청년 요건 확인에 필요한 정보"),
            ("보유·이용 기간", "공모전 운영 및 관계 법령·사업관리상 필요한 기간까지 보유 후 파기"),
            ("동의 거부 권리", "개인정보 수집·이용에 대한 동의를 거부할 수 있으나, 거부 시 참가 접수 및 심사 진행이 제한될 수 있습니다."),
        ],
        [42 * mm, DOC_WIDTH - 42 * mm],
        first_col_header=True,
    )
    story.append(p("개인정보 수집 및 이용에 동의합니다.", "h2"))
    story.append(p("□ 동의합니다          □ 동의하지 않습니다", "signature"))

    story.append(p("2. 참가 신청 서약", "h1"))
    story += bullets(
        [
            "신청서와 사업계획서 내용이 사실과 다름없음을 확인합니다.",
            "제출 아이디어는 타인의 아이디어·기술·저작물·지식재산권을 침해하지 않은 순수 창작물이며, 분쟁 발생 시 책임은 신청자에게 있습니다.",
            "최근 3년 이내 동일 아이템 선정 이력, 제출 서류 미비, 허위 사실, 참여 제한 사유가 확인될 경우 심사 제외 또는 선정 취소가 될 수 있음을 확인합니다.",
            "수상자 또는 지원대상으로 선정될 경우 주최·주관기관의 사업 운영 기준, 자료 요청, 만족도 조사, 성과 모니터링에 성실히 협조하겠습니다.",
        ]
    )
    story.append(p("위 참가 신청 서약에 동의합니다.", "h2"))
    story.append(p("□ 동의합니다          □ 동의하지 않습니다", "signature"))

    story.append(Spacer(1, 2 * mm))
    story.append(p("2026년        월        일", "signature"))
    story.append(p("신청자 성명: 대표  ______________________________  (인 또는 서명)", "signature"))
    return build_pdf(
        "아이디어_QueueBus팀_동의서.pdf",
        story,
        top_margin=9 * mm,
        bottom_margin=9 * mm,
    )


def make_checklist_pdf() -> Path:
    story = title_page(
        "제출 전 확인표",
        "공식 제출물에는 포함하지 않고, 제출 직전 누락 점검용으로 사용합니다.",
    )
    add_table(
        story,
        [
            ("제출 파일", "현재 생성 상태", "사용자 직접 보완"),
            ("아이디어_QueueBus팀_참가신청서.pdf", "생성 완료", "대표자명, 생년월일, 주소, 휴대전화, 이메일, 팀원명, 확인 체크, 서명/날인"),
            ("아이디어_QueueBus팀_사업계획서.pdf", "생성 완료", "대표자/팀원 개인정보가 들어가는 공식 양식 칸이 있으면 직접 입력"),
            ("아이디어_QueueBus팀_동의서.pdf", "생성 완료", "개인정보, 동의 체크, 날짜, 대표자 서명/날인"),
            ("아이디어_QueueBus팀_신분증사본.pdf", "미생성", "청년 1인 이상 신분증 사본을 직접 준비하고 주민등록번호 뒷자리 등 불필요 정보 마스킹"),
        ],
        [55 * mm, 38 * mm, DOC_WIDTH - 93 * mm],
        small=True,
    )
    story.append(p("이 PDF 묶음은 macOS에서 HWP 편집이 어려운 상황을 고려한 제출용 초안입니다. 법적 동의 문구와 서명란은 제출 전 공식 HWP 원본과 한 번 더 대조하는 것이 안전합니다.", "note"))
    return build_pdf("00_제출전_확인표.pdf", story)


def main() -> None:
    setup_fonts()
    global STYLES
    STYLES = make_styles()
    outputs = [
        make_application_pdf(),
        make_business_plan_pdf(),
        make_consent_pdf(),
        make_checklist_pdf(),
    ]
    for path in outputs:
        print(path)


if __name__ == "__main__":
    main()
