"""Equipment handover .docx generator (Tools section).

Fills the actual legal handover template (templates/handover_template.docx —
a merge-field handover form) via docxtpl/Jinja2,
rather than recreating the document's layout in code. Pure function, no
I/O/DB access; the caller (tools.py) handles the HTTP response and audit
logging.

Template merge fields (see templates/handover_template.docx):
  - Header table: {{ assignor_name }}, {{ employee_name }}, {{ position }},
    {{ assignment_period }}, {{ purpose }}
  - Equipment table: a docxtpl row-GROUP loop (`{%tr for d in devices %}` /
    `{%tr endfor %}` wrapping the whole per-device Serial/Inventory/Additional
    info/Accessories block, matching the original template's layout — see the
    Device column's native vertical merge, left untouched by the template
    build script) over {{ d.description }}, {{ d.quantity }}, {{ d.serial_no }},
    {{ d.inventory_no }}, {{ d.additional_info }}, {{ d.accessories }}
  - {{ comments }} next to the Equipment Return "Comments:" label
Print name / Date signature lines are left blank on purpose — signed by hand
after printing.
"""
import io
import logging
from pathlib import Path

from docxtpl import DocxTemplate

from app.schemas.schemas import HandoverGenerate

logger = logging.getLogger(__name__)

TEMPLATE_PATH = Path(__file__).parent / "templates" / "handover_template.docx"


def _template_path() -> Path:
    """The branded override from HANDOVER_TEMPLATE_PATH when it points at a real
    file, otherwise the neutral form bundled with the app."""
    from app.core.config import get_settings
    custom = (get_settings().HANDOVER_TEMPLATE_PATH or "").strip()
    if custom:
        p = Path(custom)
        if p.is_file():
            return p
        logger.warning("HANDOVER_TEMPLATE_PATH %s not found — using the bundled template", custom)
    return TEMPLATE_PATH


def generate_handover_docx(data: HandoverGenerate, assignor_name: str, company_name: str = "the Company") -> bytes:
    tpl = DocxTemplate(str(_template_path()))
    context = {
        "assignor_name": assignor_name,
        "company_name": company_name,
        "employee_name": data.employee_name,
        "position": data.position,
        "assignment_period": data.assignment_period or "",
        "purpose": data.purpose or "",
        "devices": [
            {
                "description": d.description,
                "quantity": d.quantity,
                "serial_no": d.serial_no or "",
                "inventory_no": d.inventory_no or "",
                "additional_info": d.additional_info or "",
                "accessories": d.accessories or "",
            }
            for d in data.devices
        ],
        "comments": data.comments or "",
    }
    tpl.render(context)
    buf = io.BytesIO()
    tpl.save(buf)
    return buf.getvalue()
