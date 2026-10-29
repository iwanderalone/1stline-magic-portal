import json

import httpx
import pymupdf
import pytest

from app.core import dynamic_settings
from app.services import llm


@pytest.fixture
def openai_provider(monkeypatch):
    monkeypatch.setattr(dynamic_settings, "_cache", {
        "AI_PROVIDER": "openai", "AI_BASE_URL": "http://ai.test/ollama/v1/", "AI_MODEL": "gemma4:26b",
    })


def _mock_client(monkeypatch, handler):
    real = httpx.AsyncClient
    monkeypatch.setattr(llm.httpx, "AsyncClient",
                        lambda **kw: real(transport=httpx.MockTransport(handler), **kw))


def test_strict_schema_requires_every_field_and_allows_null():
    out = llm._json_schema({"type": "OBJECT", "properties": {
        "total": {"type": "NUMBER", "nullable": True}, "sn": {"type": "STRING"}}}, strict=True)
    assert out == {"type": "object", "required": ["total", "sn"], "properties": {
        "total": {"type": ["number", "null"]}, "sn": {"type": "string"}}}


def test_gemini_schema_dialect_becomes_plain_json_schema():
    out = llm._json_schema({
        "type": "OBJECT",
        "properties": {
            "total": {"type": "NUMBER", "nullable": True},
            "items": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {"sn": {"type": "STRING"}}}},
        },
    })
    assert out == {
        "type": "object",
        "properties": {
            "total": {"type": "number"},
            "items": {"type": "array", "items": {"type": "object", "properties": {"sn": {"type": "string"}}}},
        },
    }


def test_pdf_pages_rendered_and_capped():
    doc = pymupdf.open()
    for _ in range(llm.PDF_MAX_PAGES + 2):
        doc.new_page()
    doc[0].insert_text((50, 50), "S/N: C02XK1ABMD6T")
    pngs, text = llm._read_pdf(doc.tobytes())
    assert len(pngs) == llm.PDF_MAX_PAGES
    assert all(p.startswith(b"\x89PNG") for p in pngs)
    assert "C02XK1ABMD6T" in text


def test_provider_switch(openai_provider):
    assert llm.provider() == "openai"
    assert llm.enabled()


async def test_openai_chat_runs_tools_then_answers(openai_provider, monkeypatch):
    requests = []

    def handler(req: httpx.Request):
        body = json.loads(req.content)
        requests.append(body)
        assert str(req.url) == "http://ai.test/ollama/v1/chat/completions"
        if len(requests) == 1:
            return httpx.Response(200, json={"choices": [{"message": {"content": "", "tool_calls": [
                {"id": "c1", "type": "function",
                 "function": {"name": "get_my_schedule", "arguments": '{"start_date": "2026-11-02"}'}}]}}]})
        return httpx.Response(200, json={"choices": [{"message": {"content": "You work Monday."}}]})

    _mock_client(monkeypatch, handler)
    calls = []

    async def run_tool(name, args):
        calls.append((name, args))
        return {"shifts": [{"date": "2026-11-02"}]}

    tools = [{"name": "get_my_schedule", "description": "x",
              "parameters": {"type": "object", "properties": {"start_date": {"type": "string"}}}}]
    reply, used = await llm.chat("sys", [{"role": "user", "text": "next week?"}], tools, run_tool, max_rounds=3)

    assert reply == "You work Monday."
    assert used == ["get_my_schedule"]
    assert calls == [("get_my_schedule", {"start_date": "2026-11-02"})]
    assert requests[0]["tools"][0]["function"]["name"] == "get_my_schedule"
    tool_msg = requests[1]["messages"][-1]
    assert tool_msg["role"] == "tool" and tool_msg["tool_call_id"] == "c1"
    assert json.loads(tool_msg["content"]) == {"shifts": [{"date": "2026-11-02"}]}


async def test_openai_extract_sends_images_and_parses_fenced_json(openai_provider, monkeypatch):
    def handler(req: httpx.Request):
        body = json.loads(req.content)
        image = body["messages"][0]["content"][0]
        assert image["image_url"]["url"].startswith("data:image/png;base64,")
        assert body["response_format"]["json_schema"]["schema"]["type"] == "object"
        return httpx.Response(200, json={"choices": [{"message": {"content": '```json\n{"supplier": "ACME"}\n```'}}]})

    _mock_client(monkeypatch, handler)
    out = await llm.extract_json("read it", {"type": "OBJECT", "properties": {}}, b"\x89PNG...", "image/png")
    assert out == {"supplier": "ACME"}


async def test_server_errors_become_llm_errors(openai_provider, monkeypatch):
    _mock_client(monkeypatch, lambda req: httpx.Response(401, json={"detail": "bad key"}))
    with pytest.raises(llm.LLMError) as exc:
        await llm.chat("sys", [{"role": "user", "text": "hi"}], [], lambda n, a: None, max_rounds=1)
    assert "401" in str(exc.value)
