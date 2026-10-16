"""Equipment intake: pure helpers and request validation (no NetBox/Gemini)."""
from datetime import date

import pytest
from pydantic import ValidationError

from app.schemas.schemas import HandoverRecordOut, IntakeRequest, PaymentOut
from app.services import intake_service as intake
from app.services.netbox_service import slugify

SUPPLIERS = ["Amazon", "micro speed computers", "apple m e dubai branch", "IKEA", "iTech", "sharafdg"]


def _req(**over):
    base = {
        "supplier": "Amazon", "invoice_no": "INV-1", "delivery_date": "2026-10-16",
        "items": [{"device_type_id": 5, "role_id": 3, "tenant_id": 3, "site_id": 2, "quantity": 2}],
    }
    base.update(over)
    return IntakeRequest.model_validate(base)


@pytest.mark.parametrize("raw,expected", [
    ("MICRO SPEED COMPUTERS L.L.C", "micro speed computers"),
    ("Micro Speed Computers LLC", "micro speed computers"),
    ("ikea", "IKEA"),
    ("Apple M E Dubai Branch", "apple m e dubai branch"),
    ("Totally Unknown Trading LLC", None),
    (None, None),
    ("LLC", None),
])
def test_match_supplier(raw, expected):
    assert intake.match_supplier(raw, SUPPLIERS) == expected


def test_attachment_naming_follows_existing_convention():
    name = intake.attachment_name(date(2024, 12, 7), "379153", "Micro Speed Computers")
    assert name == "2024-12-07 -- 379153 -- Micro Speed Computers"
    assert intake.attachment_filename(name, "pdf") == "2024-12-07_--_379153_--_Micro_Speed_Computers.pdf"


def test_price_is_written_like_existing_records():
    assert intake._price(4380.0) == "4380"
    assert intake._price(4380.5) == "4380.50"
    assert intake._price(None) is None


def test_slugify():
    assert slugify('MacBook Air 13.6" M2 - MLY33ZS/A') == "macbook-air-13-6-m2-mly33zs-a"
    assert slugify("!!!") == "item"


def test_intake_requires_a_type():
    with pytest.raises(ValidationError):
        _req(items=[{"role_id": 3, "tenant_id": 3, "site_id": 2}])
    ok = _req(items=[{"new_type": {"manufacturer": "Apple", "model": "MBA"}, "role_id": 3, "tenant_id": 3, "site_id": 2}])
    assert ok.items[0].new_type.model == "MBA"


def test_intake_serials_cleaned_and_bounded():
    r = _req(items=[{"device_type_id": 1, "role_id": 3, "tenant_id": 3, "site_id": 2, "quantity": 2,
                     "serials": [" A1 ", "", "B2"]}])
    assert r.items[0].serials == ["A1", "B2"]
    with pytest.raises(ValidationError):   # more serials than units
        _req(items=[{"device_type_id": 1, "role_id": 3, "tenant_id": 3, "site_id": 2, "quantity": 1,
                     "serials": ["A1", "B2"]}])


def test_intake_rejects_serial_on_two_lines():
    line = {"device_type_id": 1, "role_id": 3, "tenant_id": 3, "site_id": 2, "serials": ["X1"]}
    with pytest.raises(ValidationError):
        _req(items=[line, {**line, "serials": ["x1"]}])


def test_intake_payment_currency_validated():
    with pytest.raises(ValidationError):
        _req(payment={"paid_on": "2026-10-16", "amount": 10, "currency": "dollars"})
    assert _req(payment={"paid_on": "2026-10-16", "amount": 10, "currency": "usd"}).payment.currency == "USD"


def test_handover_record_devices_json():
    out = HandoverRecordOut.model_validate({
        "id": 1, "employee_contact_id": 7, "employee_name": "A", "handover_date": "2026-10-16",
        "devices": '[{"id": 5, "label": "MBA"}]', "status": "pending", "created_at": "2026-10-16T10:00:00Z",
    })
    assert out.devices == [{"id": 5, "label": "MBA"}]


def test_payment_device_ids_parse():
    base = {"id": 1, "paid_on": "2026-10-16", "vendor": "v", "category": "hardware", "payment_method": "card",
            "amount": 1, "currency": "AED", "amount_aed": 1, "status": "confirmed"}
    assert PaymentOut.model_validate({**base, "netbox_device_ids": "[4950, 4951]"}).netbox_device_ids == [4950, 4951]
    assert PaymentOut.model_validate({**base, "netbox_device_ids": None}).netbox_device_ids == []


def test_part_numbers_and_similarity():
    assert intake._PART_NO.findall('MS SURFACE 7TH ED SAPHIRE ZGM-00062') == ["ZGM-00062"]
    assert "MLY33ZS/A" in intake._PART_NO.findall("MACBOOK AIR M2 STARLIGHT - MLY33ZS/A")
    assert intake._PART_NO.findall("SURFACE 7TH EDITION 16GB 512GB") == []
    a = 'MS SURFACE 7TH EDITION 13.8" TOUCH QUALCOMM SNAPDRAGONX PLUS 16GB 512GB SSD WIN11'
    good = 'MS Surface 7th Ed 13.8" Touch, Snapdragon X Plus, 16GB/512GB SSD, Win11, Saphire - ZGM-00062'
    other = 'Microsoft Surface 7th Snapdragon X Elite 12-core, 32GB/1TB SSD, 15" Touch'
    assert intake._similarity(a, good) > intake._similarity(a, other)


def test_part_number_is_not_a_serial():
    desc = 'MS SURFACE 7TH EDITION 13.8" SAPHIRE ZGM-00062'
    assert intake._clean_serials(["zgm-00062", "0f38b7b24353hh", "0F38B7B24353HH", ""], desc) == ["0F38B7B24353HH"]


def test_inline_serial_kept_part_number_dropped():
    desc = "MACBOOK NEO 13 A18 PRO 8GB 256GB MXYZ3AB/A S/N: C02XK1ABCD12"
    assert intake._clean_serials(["c02xk1abcd12", "MXYZ3AB/A"], desc) == ["C02XK1ABCD12"]


def test_invoice_without_devices_needs_payment():
    with pytest.raises(ValidationError):
        _req(items=[])
    r = _req(items=[], payment={"paid_on": "2026-10-16", "amount": 50, "category": "software"})
    assert r.items == [] and r.payment.category == "software"
