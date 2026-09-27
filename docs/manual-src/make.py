# -*- coding: utf-8 -*-
"""Assemble the Life OS user manual as one HTML page, ready for Chromium to print.

Chromium is the renderer on purpose: Thai needs real OpenType shaping to put
vowels and tone marks where they belong, and a PDF library that draws glyph by
glyph stacks them on top of each other. Sarabun is embedded so the output does
not depend on a font being installed wherever this runs.
"""
import base64, html, pathlib, sys

ROOT = pathlib.Path("/tmp/manual")
IMG = ROOT / "img"
sys.path.insert(0, str(ROOT / "build"))

import chapters_a, chapters_b, chapters_c  # noqa: E402

CHAPTERS = chapters_a.CH + chapters_b.CH + chapters_c.CH
FONT_CSS = (ROOT / "font.css").read_text(encoding="utf-8")


def img(name):
    p = IMG / (name + ".jpg")
    if not p.exists():
        raise SystemExit("missing screenshot: " + str(p))
    return "data:image/jpeg;base64," + base64.b64encode(p.read_bytes()).decode()


def steps_html(steps):
    out = []
    for i, (shot, text) in enumerate(steps, 1):
        out.append(
            f'<figure class="step"><img src="{img(shot)}" alt="">'
            f'<figcaption><span class="num">{i}</span>'
            f'<span class="steptext">{text}</span></figcaption></figure>'
        )
    return '<div class="steps">' + "".join(out) + "</div>"


def links_html(links):
    rows = "".join(
        f"<tr><td class=\"lmenu\">{m}</td><td>{d}</td></tr>" for m, d in links
    )
    return (
        '<h3 class="lh">เชื่อมกับเมนูอื่นอย่างไร</h3>'
        f'<table class="links"><tbody>{rows}</tbody></table>'
    )


PRICE_TABLE = """
<table class="prices"><thead><tr><th>แพ็กเกจ</th><th>ราคา</th><th>ได้อะไร</th></tr></thead><tbody>
<tr><td>ฟรี</td><td>฿0</td><td>แชท 40 · เอกสาร 12 · ตัดสินใจ 8 · เสียง 15 — รวมไม่เกิน 60 ครั้ง/เดือน</td></tr>
<tr><td>Pay-as-you-go</td><td>฿0.50 / ครั้ง</td><td>ส่วนที่เกินโควต้าฟรี สรุปยอดวันที่ 1 ของเดือน ชำระภายใน 7 วัน</td></tr>
<tr><td>Premium รายเดือน</td><td>฿89</td><td>ใช้ AI ไม่ติดโควต้าฟรี ไม่ถูกคิด PAYG</td></tr>
<tr><td>Premium รายปี</td><td>฿890</td><td>เท่ารายเดือน ประหยัด 17%</td></tr>
<tr><td>Family รายเดือน</td><td>฿149</td><td>สมาชิกในกลุ่มครอบครัวใช้ AI ร่วมกันแบบไม่จำกัด</td></tr>
<tr><td>Family รายปี</td><td>฿1,490</td><td>เท่ารายเดือน ประหยัด 17%</td></tr>
</tbody></table>"""

CROSS = [
    ("คุยกับน้องภูมิ", "รายรับ-รายจ่าย", "พูดว่าใช้เงิน/ได้เงิน → บันทึกรายการพร้อมหมวดอัตโนมัติ"),
    ("คุยกับน้องภูมิ", "เรื่องที่ต้องทำ", "พูดว่าอยากให้เตือน → สร้างงานพร้อมวันครบกำหนด"),
    ("คุยกับน้องภูมิ", "คลังเอกสาร", "ถามถึงเรื่องในเอกสาร → ค้นจากสรุปที่ AI อ่านไว้"),
    ("คุยกับน้องภูมิ", "สิทธิฉัน", "ถามเรื่องสิทธิ → แสดงการ์ดสิทธิใต้คำตอบ"),
    ("คลังเอกสาร", "รายรับ-รายจ่าย", "ใบเสร็จ/บิล → เสนอบันทึกเป็นรายจ่ายพร้อมยอดที่อ่านได้"),
    ("คลังเอกสาร", "เรื่องที่ต้องทำ", "ปุ่มสร้างเตือนความจำจากวันหมดอายุในเอกสาร"),
    ("คลังเอกสาร", "ครอบครัว", "ปุ่มแชร์กับครอบครัว (เฉพาะที่กดแชร์)"),
    ("เรื่องที่ต้องทำ", "ปฏิทินรวม", "งานที่มีวันครบกำหนดแสดงในปฏิทินอัตโนมัติ"),
    ("เรื่องที่ต้องทำ", "การแจ้งเตือน", "ใกล้ถึงกำหนด/เลยกำหนด → แจ้งเตือน"),
    ("ครอบครัว", "เรื่องที่ต้องทำ", "งานที่มอบหมาย ไปอยู่ในรายการของผู้รับผิดชอบ"),
    ("ครอบครัว", "ปฏิทินรวม", "นัดหมายครอบครัวแสดงในปฏิทินของทุกคน"),
    ("รายรับ-รายจ่าย", "วันนี้", "ยอดค่าใช้จ่ายเดือนนี้บนหน้าแรก"),
    ("รายรับ-รายจ่าย", "การแจ้งเตือน", "ใช้ถึงเกณฑ์งบที่ตั้งไว้ → แจ้งเตือน"),
    ("สิทธิฉัน", "เรื่องที่ต้องทำ", "ปุ่มตั้งเตือนบนกำหนดการ → สร้างงาน"),
    ("สิทธิฉัน", "ครอบครัว", "ลิงก์แชร์ผลสิทธิ อายุ 30 วัน ไม่แสดงข้อมูลส่วนตัว"),
    ("ช่วยฉันที", "ปฏิทินรวม", "นัดหมายกับผู้ช่วยแสดงในปฏิทิน"),
    ("ช่วยฉันที", "การแจ้งเตือน", "ข้อเสนอใหม่ · ข้อความ · การโอนเงิน"),
    ("ของดีใกล้บ้าน", "ปฏิทินรวม", "ตั้งเตือนกิจกรรมที่สนใจเข้าปฏิทิน"),
    ("มรดกแห่งชีวิต", "คลังเอกสาร", "อ้างอิงเอกสารที่สแกนไว้ในส่วนพินัยกรรมและทรัพย์สิน"),
    ("ตั้งค่า", "การแจ้งเตือน", "เชื่อม LINE → ส่งการแจ้งเตือนถึง LINE ด้วย"),
    ("ทุกเมนู", "ค้นหาทุกอย่างของฉัน", "ทุกอย่างที่บันทึกไว้ ค้นได้จากช่องเดียว"),
]


def chapter_html(c):
    parts = [f'<section class="ch"><div class="chhead"><span class="chno">{c["n"]}</span>'
             f'<div><h2>{c["title"]}</h2><div class="route">{c["route"]}</div></div></div>']
    parts.append(f'<p class="what">{c["what"]}</p>')
    parts.append(steps_html(c["steps"]))
    if c.get("prices"):
        parts.append('<h3 class="lh">ตารางแพ็กเกจ</h3>' + PRICE_TABLE)
    if c.get("note"):
        parts.append(f'<div class="note"><b>หมายเหตุ</b><br>{c["note"]}</div>')
    parts.append(links_html(c["links"]))
    parts.append("</section>")
    return "".join(parts)


toc = "".join(
    f'<li><span class="tn">{c["n"]}</span> {c["title"]}'
    f' <span class="tr">{c["route"]}</span></li>'
    for c in CHAPTERS
)
cross_rows = "".join(
    f'<tr><td class="lmenu">{a}</td><td class="arrow">→</td>'
    f'<td class="lmenu">{b}</td><td>{d}</td></tr>'
    for a, b, d in CROSS
)

HTML = f"""<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>คู่มือการใช้งาน Life OS</title>
<style>
{FONT_CSS}
:root {{ --ink:#12313a; --mut:#5b7480; --line:#d7e5e8; --teal:#0f6f7a; --bg:#f3fafa; }}
@page {{ size: A4; margin: 15mm 13mm 14mm 13mm; }}
* {{ box-sizing: border-box; }}
body {{ font-family:'Sarabun',sans-serif; color:var(--ink); font-size:10.5pt;
       line-height:1.62; margin:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }}
h1,h2,h3 {{ margin:0; line-height:1.35; }}

.cover {{ height:265mm; display:flex; flex-direction:column; justify-content:center;
          page-break-after:always; text-align:center; }}
.cover .k {{ color:var(--teal); font-weight:700; letter-spacing:.14em; font-size:11pt; }}
.cover h1 {{ font-size:34pt; font-weight:700; margin:10mm 0 4mm; }}
.cover .sub {{ font-size:13pt; color:var(--mut); }}
.cover .meta {{ margin-top:18mm; font-size:10pt; color:var(--mut); line-height:2; }}
.rule {{ width:38mm; height:3px; background:var(--teal); margin:7mm auto; border-radius:2px; }}

.toc {{ page-break-after:always; }}
.toc h2 {{ font-size:19pt; margin-bottom:6mm; color:var(--teal); }}
.toc ol {{ list-style:none; padding:0; margin:0; }}
.toc li {{ padding:2.4mm 0; border-bottom:1px solid var(--line); font-size:11pt; }}
.tn {{ display:inline-block; width:9mm; color:var(--teal); font-weight:700; }}
.tr {{ float:right; color:var(--mut); font-size:8.5pt; font-family:monospace; }}

.ch {{ page-break-before:always; }}
.chhead {{ display:flex; gap:5mm; align-items:center; border-bottom:2px solid var(--teal);
           padding-bottom:3mm; margin-bottom:4mm; }}
.chno {{ background:var(--teal); color:#fff; width:12mm; height:12mm; border-radius:50%;
         display:flex; align-items:center; justify-content:center; font-size:15pt;
         font-weight:700; flex:0 0 auto; }}
.ch h2 {{ font-size:18pt; }}
.route {{ font-family:monospace; font-size:8.5pt; color:var(--mut); }}
.what {{ background:var(--bg); border-left:3px solid var(--teal); padding:3mm 4mm;
         margin:0 0 5mm; border-radius:0 4px 4px 0; }}

.steps {{ display:flex; flex-wrap:wrap; gap:4mm 5mm; }}
.step {{ width:55mm; margin:0; page-break-inside:avoid; }}
.step img {{ width:55mm; border:1px solid var(--line); border-radius:5px; display:block; }}
.step figcaption {{ display:flex; gap:2mm; margin-top:2mm; font-size:9pt; line-height:1.55; }}
.num {{ flex:0 0 auto; width:5.6mm; height:5.6mm; border-radius:50%; background:var(--bg);
        border:1.4px solid var(--teal); color:var(--teal); font-weight:700; font-size:8.5pt;
        display:flex; align-items:center; justify-content:center; margin-top:.3mm; }}
.steptext {{ flex:1; }}

.lh {{ font-size:12pt; color:var(--teal); margin:6mm 0 2.5mm; }}
table {{ width:100%; border-collapse:collapse; font-size:9.5pt; }}
.links td {{ padding:2.2mm 2.5mm; border-bottom:1px solid var(--line); vertical-align:top; }}
.lmenu {{ width:34mm; font-weight:600; color:var(--teal); white-space:nowrap; }}
.note {{ background:#fff8e8; border:1px solid #f0d79a; border-radius:5px;
         padding:3mm 4mm; margin:5mm 0; font-size:9.5pt; page-break-inside:avoid; }}
.prices th {{ text-align:left; background:var(--bg); padding:2.2mm 2.5mm;
              border-bottom:1.5px solid var(--teal); }}
.prices td {{ padding:2.2mm 2.5mm; border-bottom:1px solid var(--line); vertical-align:top; }}
.arrow {{ width:6mm; text-align:center; color:var(--mut); }}
.cross td {{ padding:2mm 2.5mm; border-bottom:1px solid var(--line); vertical-align:top; }}
.cross .lmenu {{ width:30mm; }}
</style></head><body>

<div class="cover">
  <div class="k">LIFE OS · น้องภูมิ</div>
  <h1>คู่มือการใช้งาน</h1>
  <div class="rule"></div>
  <div class="sub">สำหรับผู้ใช้ทั่วไป — ทุกเมนู พร้อมภาพประกอบจากระบบจริง</div>
  <div class="meta">
    ภาพทั้งหมดถ่ายจากการใช้งานจริงบนหน้าจอมือถือ<br>
    ไม่รวมเมนูผู้ดูแลระบบ<br>
    ปรับปรุง 27 กันยายน 2569
  </div>
</div>

<div class="toc">
  <h2>สารบัญ</h2>
  <ol>{toc}<li><span class="tn">16</span> แผนผังความเชื่อมโยงระหว่างเมนู</li></ol>
</div>

{''.join(chapter_html(c) for c in CHAPTERS)}

<section class="ch">
  <div class="chhead"><span class="chno">16</span>
  <div><h2>แผนผังความเชื่อมโยงระหว่างเมนู</h2>
  <div class="route">สรุปว่าทำอะไรที่หนึ่ง แล้วไปโผล่ที่ไหนบ้าง</div></div></div>
  <p class="what">Life OS ไม่ได้เป็นเมนูที่แยกขาดจากกัน สิ่งที่บันทึกในเมนูหนึ่งมักไปปรากฏในอีกเมนูโดยอัตโนมัติ
  ตารางนี้อ่านจากซ้ายไปขวา: <b>ทำที่เมนูนี้</b> → <b>ผลไปอยู่ที่เมนูนี้</b></p>
  <table class="cross"><tbody>{cross_rows}</tbody></table>
  <div class="note"><b>หลักการที่ใช้ทั้งระบบ</b><br>
  ข้อมูลทั้งหมดเป็นของคุณคนเดียว ไม่มีอะไรถูกแชร์ให้ใครโดยอัตโนมัติ —
  ทุกการแชร์ต้องกดเองเสมอ ไม่ว่าจะเป็นการแชร์เอกสาร งาน รายรับ-รายจ่ายให้ครอบครัว
  การแชร์ผลสิทธิ หรือการแชร์ร้านของคุณให้คนอื่นเห็น<br>
  ขอสำเนาข้อมูลทั้งหมดของตัวเอง และลบบัญชีพร้อมข้อมูลทุกอย่างได้ทุกเมื่อที่ <b>ตั้งค่า</b></div>
</section>

</body></html>"""

out = ROOT / "manual.html"
out.write_text(HTML, encoding="utf-8")
print("html bytes:", len(HTML), "->", out)
