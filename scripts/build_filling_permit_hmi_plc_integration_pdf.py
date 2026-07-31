#!/usr/bin/env python3
"""Build the focused MCGS/PLC integration and safety-design PDF."""

from __future__ import annotations

import csv
import sys
from pathlib import Path

import build_filling_permit_handoff_pdf as pdf_base


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "docs" / "filling_permit_gateway_hmi_plc_integration_guide.md"
REFERENCE = ROOT / "docs" / "filling_permit_gateway_plc_handoff_2026-07-20.md"
VARIABLES = ROOT / "docs" / "tpc7022ei_filling_permit_variables.csv"
OUTPUT = ROOT / "output" / "pdf" / "充装许可网关V1-MCGS与PLC接入资料.pdf"


def section_body(markdown: str, heading: str) -> str:
    lines = markdown.splitlines()
    try:
        start = lines.index(heading) + 1
    except ValueError as exc:
        raise ValueError(f"Missing reference heading: {heading}") from exc
    end = len(lines)
    for index in range(start, len(lines)):
        if lines[index].startswith("## "):
            end = index
            break
    body = lines[start:end]
    while body and (not body[-1].strip() or body[-1].strip() == "---"):
        body.pop()
    return "\n".join(body).strip()


def mcgs_object(pdu: int) -> str:
    if pdu == 0:
        return "GW01"
    if pdu == 1:
        return "GW02"
    if pdu == 2:
        return "RQ00"
    if pdu == 3:
        return "RQ01"
    if pdu == 4:
        return "RQ02"
    if 5 <= pdu <= 20:
        return f"RQ{pdu - 2:02d}"
    if 21 <= pdu <= 27:
        return f"RS{pdu - 21:02d}"
    if 28 <= pdu <= 31:
        return f"GW{pdu - 25:02d}"
    raise ValueError(f"Unsupported PDU address: {pdu}")


def register_table() -> str:
    rows = [
        "| PDU | McgsPro通道 | 当前测试对象 | 访问 | 含义 |",
        "|---:|---|---|---|---|",
    ]
    with VARIABLES.open("r", encoding="utf-8-sig", newline="") as handle:
        source_rows = list(csv.DictReader(handle))
    gateway_rows = [row for row in source_rows if row["group"] == "Gateway"]
    if len(gateway_rows) != 32:
        raise ValueError(f"Expected 32 gateway registers, found {len(gateway_rows)}")
    for row in sorted(gateway_rows, key=lambda item: int(item["pdu_address"])):
        pdu = int(row["pdu_address"])
        access = "R/W" if 2 <= pdu <= 20 else "R"
        description = row["description"].replace("|", "\\|")
        rows.append(
            f"| {pdu} | `{row['mcgs_channel']}` | `{mcgs_object(pdu)}` | {access} | {description} |"
        )
    return "\n".join(rows)


def normalize_dashes(text: str) -> str:
    for char in ("\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2212"):
        text = text.replace(char, "-")
    return text


def build_markdown() -> str:
    template = TEMPLATE.read_text(encoding="utf-8")
    reference = REFERENCE.read_text(encoding="utf-8")
    replacements = {
        "{{REGISTER_TABLE}}": register_table(),
        "{{SUBMIT_SCRIPT_BODY}}": section_body(reference, "## 8. MCGS“提交查询”按钮最终脚本"),
        "{{CYCLE_SCRIPT_BODY}}": section_body(reference, "## 9. MCGS 全局 200 ms 循环策略最终脚本"),
        "{{REASON_SCRIPT_BODY}}": section_body(reference, "## 10. 原因码和 32 位明细位图"),
    }
    for marker, value in replacements.items():
        template = template.replace(marker, value)
    if "{{" in template or "}}" in template:
        raise ValueError("Unexpanded marker remains in integration guide")
    return normalize_dashes(template)


def main() -> int:
    for path in (TEMPLATE, REFERENCE, VARIABLES):
        if not path.exists():
            print(f"Required source not found: {path}", file=sys.stderr)
            return 2

    markdown = build_markdown()
    pdf_base.DOC_TITLE = "充装许可网关 V1 - MCGS/PLC 接入与安全设计说明"
    pdf_base.DOC_SUBJECT = "Windows网关配置、MCGS脚本安全设计、Modbus接口与验证依据"
    pdf_base.DOC_HEADER = "充装许可网关 V1 · MCGS/PLC 接入与安全设计说明"
    pdf_base.DOC_FOOTER = "通信异常、响应不匹配或系统故障时必须保持禁止充装"

    output = Path(sys.argv[1]) if len(sys.argv) > 1 else OUTPUT
    if not output.is_absolute():
        output = ROOT / output

    pdf_base.register_fonts()
    styles = pdf_base.make_styles()
    story = pdf_base.build_story(markdown, styles)
    output.parent.mkdir(parents=True, exist_ok=True)
    doc = pdf_base.HandoffDocTemplate(str(output), styles)
    doc.build(story)
    print(output)
    print(f"bytes={output.stat().st_size}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
