#!/usr/bin/env python3
"""Build the PLC handoff PDF from the maintained Markdown source."""

from __future__ import annotations

import html
import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    CondPageBreak,
    Frame,
    HRFlowable,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "filling_permit_gateway_plc_handoff_2026-07-20.md"
OUTPUT = ROOT / "output" / "pdf" / "充装许可网关V1-PLC工程师现场交接书.pdf"
DOC_TITLE = "充装许可网关 V1 - PLC 工程师现场交接书"
DOC_SUBJECT = "TPC7022Ei + S7-200 SMART ST20 充装许可联锁"
DOC_HEADER = "充装许可网关 V1 · PLC 工程师现场交接书"
DOC_FOOTER = "现场投运前必须完成 PLC 地址复核、程序评审和断线验收"

FONT_BODY_PATH = Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf")
FONT_HEADING_PATH = Path("/System/Library/Fonts/STHeiti Medium.ttc")
FONT_BODY = "PLCBodyCN"
FONT_HEADING = "PLCHeadingCN"

PAGE_SIZE = landscape(A4)
PAGE_W, PAGE_H = PAGE_SIZE
LEFT = 16 * mm
RIGHT = 16 * mm
TOP = 17 * mm
BOTTOM = 15 * mm
CONTENT_W = PAGE_W - LEFT - RIGHT

NAVY = colors.HexColor("#17324D")
BLUE = colors.HexColor("#1D5D7A")
TEAL = colors.HexColor("#087F6B")
LIGHT_BLUE = colors.HexColor("#EAF3F7")
LIGHT_TEAL = colors.HexColor("#E8F6F2")
LIGHT_GRAY = colors.HexColor("#F5F7F8")
MID_GRAY = colors.HexColor("#D7DEE3")
TEXT = colors.HexColor("#17212B")
MUTED = colors.HexColor("#53636F")
WARN_BG = colors.HexColor("#FFF2E2")
WARN = colors.HexColor("#9A4D00")


def register_fonts() -> None:
    if not FONT_BODY_PATH.exists():
        raise FileNotFoundError(f"Chinese font not found: {FONT_BODY_PATH}")
    pdfmetrics.registerFont(TTFont(FONT_BODY, str(FONT_BODY_PATH)))
    if FONT_HEADING_PATH.exists():
        try:
            pdfmetrics.registerFont(TTFont(FONT_HEADING, str(FONT_HEADING_PATH)))
        except Exception:
            pdfmetrics.registerFont(TTFont(FONT_HEADING, str(FONT_BODY_PATH)))
    else:
        pdfmetrics.registerFont(TTFont(FONT_HEADING, str(FONT_BODY_PATH)))


def inline_markup(value: str) -> str:
    """Convert the small Markdown subset used by the handoff document."""
    escaped = html.escape(value.strip())
    escaped = re.sub(
        r"`([^`]+)`",
        rf'<font name="{FONT_HEADING}" color="#075D70">\1</font>',
        escaped,
    )
    escaped = re.sub(
        r"\*\*([^*]+)\*\*",
        rf'<font name="{FONT_HEADING}" color="#17324D">\1</font>',
        escaped,
    )
    return escaped


def make_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "TitleCN",
            parent=base["Title"],
            fontName=FONT_HEADING,
            fontSize=22,
            leading=29,
            textColor=NAVY,
            alignment=TA_CENTER,
            spaceBefore=20 * mm,
            spaceAfter=8 * mm,
        ),
        "h1": ParagraphStyle(
            "H1CN",
            parent=base["Heading1"],
            fontName=FONT_HEADING,
            fontSize=17,
            leading=23,
            textColor=NAVY,
            spaceBefore=3 * mm,
            spaceAfter=4 * mm,
            keepWithNext=True,
        ),
        "h2": ParagraphStyle(
            "H2CN",
            parent=base["Heading2"],
            fontName=FONT_HEADING,
            fontSize=14,
            leading=20,
            textColor=BLUE,
            spaceBefore=4 * mm,
            spaceAfter=2.5 * mm,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "H3CN",
            parent=base["Heading3"],
            fontName=FONT_HEADING,
            fontSize=12.3,
            leading=17,
            textColor=TEAL,
            spaceBefore=3 * mm,
            spaceAfter=1.8 * mm,
            keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "BodyCN",
            parent=base["BodyText"],
            fontName=FONT_BODY,
            fontSize=11.5,
            leading=17.2,
            textColor=TEXT,
            alignment=TA_LEFT,
            wordWrap="CJK",
            spaceAfter=2.2 * mm,
            allowWidows=0,
            allowOrphans=0,
        ),
        "bullet": ParagraphStyle(
            "BulletCN",
            parent=base["BodyText"],
            fontName=FONT_BODY,
            fontSize=11.3,
            leading=16.8,
            textColor=TEXT,
            leftIndent=6 * mm,
            firstLineIndent=-3.5 * mm,
            bulletIndent=1.2 * mm,
            wordWrap="CJK",
            spaceAfter=1.2 * mm,
        ),
        "numbered": ParagraphStyle(
            "NumberedCN",
            parent=base["BodyText"],
            fontName=FONT_BODY,
            fontSize=11.3,
            leading=16.8,
            textColor=TEXT,
            leftIndent=8 * mm,
            firstLineIndent=-5 * mm,
            wordWrap="CJK",
            spaceAfter=1.2 * mm,
        ),
        "quote": ParagraphStyle(
            "QuoteCN",
            parent=base["BodyText"],
            fontName=FONT_BODY,
            fontSize=11.5,
            leading=18,
            textColor=WARN,
            backColor=WARN_BG,
            borderColor=colors.HexColor("#EDC793"),
            borderWidth=0.8,
            borderPadding=(8, 10, 8, 10),
            leftIndent=5 * mm,
            rightIndent=5 * mm,
            spaceAfter=1.8 * mm,
            wordWrap="CJK",
        ),
        "code": ParagraphStyle(
            "CodeCN",
            parent=base["Code"],
            fontName=FONT_BODY,
            fontSize=9.3,
            leading=13.5,
            textColor=colors.HexColor("#12303D"),
            backColor=LIGHT_GRAY,
            borderColor=MID_GRAY,
            borderWidth=0.6,
            borderPadding=(7, 8, 7, 8),
            leftIndent=2 * mm,
            rightIndent=2 * mm,
            spaceBefore=1.5 * mm,
            spaceAfter=3 * mm,
        ),
        "table": ParagraphStyle(
            "TableCellCN",
            parent=base["BodyText"],
            fontName=FONT_BODY,
            fontSize=9.2,
            leading=12.8,
            textColor=TEXT,
            wordWrap="CJK",
        ),
        "table_head": ParagraphStyle(
            "TableHeadCN",
            parent=base["BodyText"],
            fontName=FONT_HEADING,
            fontSize=9.3,
            leading=13,
            textColor=colors.white,
            wordWrap="CJK",
            alignment=TA_CENTER,
        ),
        "toc_title": ParagraphStyle(
            "TOCTitleCN",
            parent=base["Heading1"],
            fontName=FONT_HEADING,
            fontSize=18,
            leading=24,
            textColor=NAVY,
            spaceAfter=6 * mm,
        ),
        "toc": ParagraphStyle(
            "TOCCN",
            parent=base["BodyText"],
            fontName=FONT_BODY,
            fontSize=11.5,
            leading=16,
            textColor=BLUE,
            leftIndent=4 * mm,
            spaceAfter=0.7 * mm,
        ),
        "footer": ParagraphStyle(
            "FooterCN",
            parent=base["BodyText"],
            fontName=FONT_BODY,
            fontSize=8.5,
            leading=10,
            textColor=MUTED,
        ),
    }


def col_widths(row_count: int) -> list[float]:
    ratios_by_count = {
        2: [0.28, 0.72],
        3: [0.20, 0.56, 0.24],
        4: [0.15, 0.25, 0.18, 0.42],
        5: [0.10, 0.17, 0.18, 0.12, 0.43],
        6: [0.10, 0.16, 0.18, 0.13, 0.13, 0.30],
    }
    ratios = ratios_by_count.get(row_count, [1 / row_count] * row_count)
    return [CONTENT_W * ratio for ratio in ratios]


def parse_table(lines: list[str], styles: dict[str, ParagraphStyle]) -> Table:
    parsed: list[list[str]] = []
    for line in lines:
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        parsed.append(cells)
    if len(parsed) >= 2 and all(re.fullmatch(r":?-{3,}:?", c) for c in parsed[1]):
        parsed.pop(1)
    count = max(len(row) for row in parsed)
    normalized = [row + [""] * (count - len(row)) for row in parsed]
    data = []
    for row_index, row in enumerate(normalized):
        style = styles["table_head"] if row_index == 0 else styles["table"]
        data.append([Paragraph(inline_markup(cell), style) for cell in row])
    table = Table(
        data,
        colWidths=col_widths(count),
        repeatRows=1,
        splitByRow=1,
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), BLUE),
                ("GRID", (0, 0), (-1, -1), 0.45, colors.HexColor("#AAB8C2")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_BLUE]),
            ]
        )
    )
    return table


class HandoffDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str, styles: dict[str, ParagraphStyle]):
        super().__init__(
            filename,
            pagesize=PAGE_SIZE,
            leftMargin=LEFT,
            rightMargin=RIGHT,
            topMargin=TOP,
            bottomMargin=BOTTOM,
            title=DOC_TITLE,
            author="项目交接资料",
            subject=DOC_SUBJECT,
            creator="Codex / ReportLab",
            pageCompression=1,
        )
        self.styles = styles
        frame = Frame(
            LEFT,
            BOTTOM,
            CONTENT_W,
            PAGE_H - TOP - BOTTOM,
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
            id="content",
        )
        self.addPageTemplates(PageTemplate(id="main", frames=[frame], onPage=self.draw_page))

    def draw_page(self, canvas, doc) -> None:
        canvas.saveState()
        if doc.page > 1:
            canvas.setStrokeColor(MID_GRAY)
            canvas.setLineWidth(0.5)
            canvas.line(LEFT, PAGE_H - 10.5 * mm, PAGE_W - RIGHT, PAGE_H - 10.5 * mm)
            canvas.setFont(FONT_BODY, 8.5)
            canvas.setFillColor(MUTED)
            canvas.drawString(LEFT, PAGE_H - 8.3 * mm, DOC_HEADER)
            canvas.drawRightString(PAGE_W - RIGHT, PAGE_H - 8.3 * mm, "交接日期：2026-07-20")
        canvas.setStrokeColor(MID_GRAY)
        canvas.line(LEFT, 9 * mm, PAGE_W - RIGHT, 9 * mm)
        canvas.setFont(FONT_BODY, 8.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(LEFT, 5.2 * mm, DOC_FOOTER)
        canvas.drawRightString(PAGE_W - RIGHT, 5.2 * mm, f"第 {doc.page} 页")
        canvas.restoreState()


def build_story(text: str, styles: dict[str, ParagraphStyle]) -> list:
    lines = text.splitlines()
    major_headings = [line[3:].strip() for line in lines if line.startswith("## ")]
    story: list = []
    paragraph_buf: list[str] = []
    quote_buf: list[str] = []
    in_code = False
    code_buf: list[str] = []
    table_buf: list[str] = []
    first_major = True
    toc_added = False

    def flush_paragraph() -> None:
        nonlocal paragraph_buf
        if paragraph_buf:
            joined = " ".join(part.strip() for part in paragraph_buf if part.strip())
            if joined:
                story.append(Paragraph(inline_markup(joined), styles["body"]))
            paragraph_buf = []

    def flush_quote() -> None:
        nonlocal quote_buf
        if quote_buf:
            joined = "<br/>".join(inline_markup(part) for part in quote_buf)
            story.append(Paragraph(joined, styles["quote"]))
            quote_buf = []

    def flush_table() -> None:
        nonlocal table_buf
        if table_buf:
            story.append(parse_table(table_buf, styles))
            story.append(Spacer(1, 3 * mm))
            table_buf = []

    for raw in lines:
        line = raw.rstrip()

        if in_code:
            if line.startswith("```"):
                code_text = "\n".join(code_buf).rstrip()
                story.append(
                    Preformatted(
                        code_text,
                        styles["code"],
                        maxLineLength=116,
                        splitChars=" /,=AND",
                    )
                )
                in_code = False
                code_buf = []
            else:
                code_buf.append(line)
            continue

        if line.startswith("```"):
            flush_paragraph()
            flush_quote()
            flush_table()
            in_code = True
            code_buf = []
            continue

        if line.startswith("|"):
            flush_paragraph()
            flush_quote()
            table_buf.append(line)
            continue
        flush_table()

        if line.startswith(">"):
            flush_paragraph()
            quote_buf.append(line[1:].strip())
            continue
        flush_quote()

        if not line.strip():
            flush_paragraph()
            continue

        if re.fullmatch(r"-{3,}", line.strip()):
            flush_paragraph()
            # Major numbered sections already start on a new page. Ignoring the
            # Markdown divider avoids a divider-only spill page.
            continue

        if line.startswith("# "):
            flush_paragraph()
            story.append(Paragraph(inline_markup(line[2:]), styles["title"]))
            continue

        if line.startswith("## "):
            flush_paragraph()
            if not toc_added:
                story.append(PageBreak())
                story.append(Paragraph("目录", styles["toc_title"]))
                for heading in major_headings:
                    story.append(Paragraph(inline_markup(heading), styles["toc"]))
                story.append(PageBreak())
                toc_added = True
            elif not first_major:
                story.append(PageBreak())
            first_major = False
            story.append(Paragraph(inline_markup(line[3:]), styles["h1"]))
            continue

        if line.startswith("### "):
            flush_paragraph()
            story.append(CondPageBreak(32 * mm))
            story.append(Paragraph(inline_markup(line[4:]), styles["h2"]))
            continue

        if line.startswith("#### "):
            flush_paragraph()
            story.append(CondPageBreak(24 * mm))
            story.append(Paragraph(inline_markup(line[5:]), styles["h3"]))
            continue

        bullet_match = re.match(r"^\s*-\s+(.*)$", line)
        if bullet_match:
            flush_paragraph()
            item = bullet_match.group(1)
            if item.startswith("[ ] "):
                bullet = "□"
                item = item[4:]
            elif item.lower().startswith("[x] "):
                bullet = "■"
                item = item[4:]
            else:
                bullet = "•"
            story.append(Paragraph(inline_markup(item), styles["bullet"], bulletText=bullet))
            continue

        numbered_match = re.match(r"^\s*(\d+)\.\s+(.*)$", line)
        if numbered_match:
            flush_paragraph()
            story.append(
                Paragraph(
                    inline_markup(numbered_match.group(2)),
                    styles["numbered"],
                    bulletText=f"{numbered_match.group(1)}.",
                )
            )
            continue

        paragraph_buf.append(line)

    flush_paragraph()
    flush_quote()
    flush_table()
    if in_code and code_buf:
        story.append(Preformatted("\n".join(code_buf), styles["code"], maxLineLength=116))
    return story


def main() -> int:
    if not SOURCE.exists():
        print(f"Source not found: {SOURCE}", file=sys.stderr)
        return 2
    register_fonts()
    styles = make_styles()
    text = SOURCE.read_text(encoding="utf-8")
    story = build_story(text, styles)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = HandoffDocTemplate(str(OUTPUT), styles)
    doc.build(story)
    print(OUTPUT)
    print(f"bytes={OUTPUT.stat().st_size}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
