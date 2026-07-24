"""Equipment handover PDF generator (Tools section).

Recreates the layout of ``examples/Handover_template.docx`` in code via
reportlab, rather than filling the .docx template — avoids adding a
LibreOffice dependency to the container just to convert docx -> pdf. Pure
function, no I/O/DB access; the caller (tools.py) handles the HTTP response
and audit logging.
"""
import io

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    ListFlowable,
    ListItem,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.schemas.schemas import HandoverGenerate

# Verbatim from examples/Handover_template.docx acknowledgement clauses.
TERMS = [
    'I have been issued with the equipment and/or accessories listed above '
    '(the “Equipment”); I am solely responsible for the Equipment and shall '
    'use all reasonable endeavors to protect it from damage or theft;',
    'I will use the Equipment only for purpose for which it is intended and for '
    'the purposes (i) of the assignment specified above (ii) or, if an employee, '
    'only for the purposes of my employment with (iii) or, if a freelancer, only '
    'for the purposes of my Freelance contract with Viory;',
    'I am liable for any damage done to the Equipment (excluding normal wear and tear);',
    'I will not install personal software on the Equipment;',
    'I will not use the Equipment for personal use such as personal emails, IMs, '
    'web browsing, etc.;',
    'I will report Loss or Theft of the Equipment to IT or management immediately;',
    'I acknowledge and agree that any repair of the Equipment should only be done '
    'after consultation with IT in order to avoid ceasing of warranty obligations;',
    'I will take all reasonable measures to ensure the physical and digital '
    'security of the Equipment including but not limited to: (a) locking the '
    'Equipment in a secure location when it is not in use; (b) ensuring that '
    'Anti-virus, Firewall, or Encryption software provided by Assignor is functioning;',
    'I shall return the Equipment to Assignor forthwith (i) at the end of the '
    'assignment (ii) or, if an employee, upon termination of my employment with '
    'Viory (iii) or, if a freelancer, upon termination of my Freelance contract '
    'with Viory;',
    'I shall repair or replace, at Assignor’s discretion, any Equipment which is '
    'damaged or lost and I authorize Assignor to deduct the costs of such repair '
    'or replacement from any payments due to me from Viory or, if a freelancer, '
    'from my invoice amount;',
    'Mobile phones, sim cards and laptops are provided to the employees or '
    'freelancers for the performance of their job responsibilities or contractual '
    'services and must be used only for this business purpose, private usage is '
    'not allowed;',
    'I hereby declare that I have read and understood the above rules and will '
    'abide by them.',
]


def generate_handover_pdf(data: HandoverGenerate, assignor_name: str) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=18 * mm, bottomMargin=18 * mm, leftMargin=18 * mm, rightMargin=18 * mm,
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("HandoverTitle", parent=styles["Title"], fontSize=16, spaceAfter=4)
    label_style = ParagraphStyle("HandoverLabel", parent=styles["Normal"], fontSize=9, textColor=colors.grey)
    value_style = ParagraphStyle("HandoverValue", parent=styles["Normal"], fontSize=10, spaceAfter=6)
    heading_style = ParagraphStyle("HandoverHeading", parent=styles["Heading2"], fontSize=12, spaceBefore=10, spaceAfter=6)
    term_style = ParagraphStyle("HandoverTerm", parent=styles["Normal"], fontSize=8, leading=11)
    small_style = ParagraphStyle("HandoverSmall", parent=styles["Normal"], fontSize=9, leading=13)

    story = [Paragraph("Equipment Handover Form", title_style), Spacer(1, 4)]

    info_rows = [
        [Paragraph("Assignor", label_style), Paragraph("Recipient", label_style)],
        [Paragraph(assignor_name, value_style), Paragraph(data.employee_name, value_style)],
        [Paragraph("Title:", label_style), Paragraph(data.position, value_style)],
    ]
    if data.assignment_period:
        info_rows.append([Paragraph("Period:", label_style), Paragraph(data.assignment_period, value_style)])
    if data.purpose:
        info_rows.append([Paragraph("Purpose:", label_style), Paragraph(data.purpose, value_style)])
    info_rows.append([Paragraph("Date:", label_style), Paragraph(data.date.isoformat(), value_style)])

    info_table = Table(info_rows, colWidths=[85 * mm, 85 * mm])
    info_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.grey),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 4),
    ]))
    story.append(info_table)

    story.append(Paragraph("List of equipment and accessories", heading_style))
    device_header = ["Description", "Quantity", "Serial No.", "Inventory No."]
    device_rows = [device_header]
    for line in data.devices:
        device_rows.append([
            Paragraph(line.description, small_style),
            str(line.quantity),
            line.serial_no or "—",
            line.inventory_no or "—",
        ])
    device_table = Table(device_rows, colWidths=[80 * mm, 22 * mm, 34 * mm, 34 * mm], repeatRows=1)
    device_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.whitesmoke),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(device_table)

    story.append(Paragraph(
        "By signing this form, I confirm my acceptance of and agreement to the following terms:",
        heading_style,
    ))
    story.append(ListFlowable(
        [ListItem(Paragraph(term, term_style), spaceAfter=3) for term in TERMS],
        bulletType="1", start=1, leftIndent=14,
    ))

    story.append(Paragraph("Equipment Return", heading_style))
    sign_rows = [
        [Paragraph("Print name:", label_style), Paragraph("Print name:", label_style)],
        [Paragraph("_" * 30, small_style), Paragraph("_" * 30, small_style)],
        [Paragraph("Date:", label_style), Paragraph("Date:", label_style)],
        [Paragraph("_" * 30, small_style), Paragraph("_" * 30, small_style)],
    ]
    sign_table = Table(sign_rows, colWidths=[85 * mm, 85 * mm])
    sign_table.setStyle(TableStyle([("TOPPADDING", (0, 0), (-1, -1), 6)]))
    story.append(Spacer(1, 8))
    story.append(sign_table)

    story.append(Paragraph("Comments:", label_style))
    story.append(Paragraph(data.comments or "—", value_style))

    doc.build(story)
    return buf.getvalue()
