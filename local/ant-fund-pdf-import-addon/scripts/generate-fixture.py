"""Regenerate the synthetic fixture with reportlab; never reads a customer PDF."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import Table, TableStyle
from reportlab.lib import colors

pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
output = Path(__file__).resolve().parent.parent / "src/fixtures/statement.pdf"
output.parent.mkdir(parents=True, exist_ok=True)
pdf = canvas.Canvas(str(output), pagesize=(595, 842), invariant=True)
pdf.setFont("STSong-Light", 14)
pdf.drawString(60, 760, "蚂蚁（杭州）基金销售有限公司")
pdf.drawString(60, 730, "基金（含资产管理计划）交易明细")
pdf.showPage()
header = ["订单号", "交易时间", "交易类型", "基金名称", "组合基金名称", "基金代码", "申请金额", "申请份额", "确认金额", "确认份额", "手续费", "确认日期"]

def table(rows):
    widths = [50, 50, 42, 65, 40, 35, 36, 36, 36, 36, 32, 50]
    grid = Table(rows, colWidths=widths, rowHeights=[55] * len(rows))
    grid.setStyle(TableStyle([("FONTNAME", (0, 0), (-1, -1), "STSong-Light"), ("FONTSIZE", (0, 0), (-1, -1), 6), ("GRID", (0, 0), (-1, -1), .5, colors.black), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    grid.wrap(550, 700)
    grid.drawOn(pdf, 20, 760 - len(rows) * 55)
    pdf.showPage()

table([header,
    ["20261001\n00000000\n00000000\n00000001", "2026/10/01\n09:00", "用户买入", "合成测试\n债券基金A", "", "000032", "10000.00", "/", "10000.00", "9537.26", "4.00", "2026/10/02\n00:00"],
    ["20261002\n00000000\n00000000\n00000002", "", "机构分红", "合成测试\n债券基金A", "专属定制", "000032", "0.00", "/", "0.00", "0.44", "0.00", "2026/10/03\n00:00"],
    ["20261003\n00000000", "2026/10/03\n10:00", "用户卖出", "合成跨页", "", "017811", "0.00", "10.00", "99.00", "10.00", "1.00", "2026/10/0"],
])
table([["00000000\n00000003", "", "", "基金C", "", "", "", "", "", "", "", "4 00:00"]])
pdf.save()
