"""One LLM client for the assistant and invoice reading, two providers.

  AI_PROVIDER=gemini  — Google Gemini REST (GEMINI_API_KEY / GEMINI_MODEL)
  AI_PROVIDER=openai  — any OpenAI-compatible /chat/completions (AI_BASE_URL /
                        AI_API_KEY / AI_MODEL): Ollama, vLLM, Open WebUI. For Open
                        WebUI use its Ollama passthrough (…/ollama/v1) — the
                        /api route runs the instance's filters, and a PII
                        filter there turns names into [NAME_1] and rejects images.

Callers stay provider-agnostic: tool declarations and the extraction schema are
written once in plain JSON Schema (Gemini's uppercase dialect is accepted too)
and translated here.
"""
import asyncio
import base64
import json
import logging
from typing import Awaitable, Callable, Optional

import httpx

from app.core.config import get_settings
from app.core.dynamic_settings import eff

logger = logging.getLogger(__name__)

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
PDF_MAX_PAGES = 5
PDF_DPI = 150


class LLMError(Exception):
    """A user-presentable failure; status_code is what the API should answer."""
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def provider() -> str:
    return (eff("AI_PROVIDER", get_settings().AI_PROVIDER) or "gemini").strip().lower()


def enabled() -> bool:
    s = get_settings()
    if provider() == "openai":
        return bool(eff("AI_BASE_URL", s.AI_BASE_URL) and eff("AI_MODEL", s.AI_MODEL))
    return bool(eff("GEMINI_API_KEY", s.GEMINI_API_KEY))


def model_name() -> str:
    s = get_settings()
    if provider() == "openai":
        return eff("AI_MODEL", s.AI_MODEL)
    return eff("GEMINI_MODEL", s.GEMINI_MODEL)


# ─── Transport ────────────────────────────────────────────────────────

async def _post(client: httpx.AsyncClient, tag: str, retries: int, **kw) -> dict:
    """POST with backoff on 500/503 (Google's "high demand" bursts, a busy GPU);
    maps failures to LLMError so callers only handle one exception."""
    try:
        for attempt in range(retries):
            resp = await client.post(**kw)
            if resp.status_code not in (500, 502, 503):
                break
            logger.warning("[%s] %s %s, attempt %d/%d", tag, provider(), resp.status_code, attempt + 1, retries)
            await asyncio.sleep(2 * (attempt + 1))
    except httpx.TimeoutException as exc:
        raise LLMError("The AI model took too long to answer — try again", 504) from exc
    except httpx.HTTPError as exc:
        raise LLMError(f"Cannot reach the AI service: {exc}") from exc
    if resp.status_code in (500, 502, 503):
        raise LLMError("The AI model is overloaded right now — try again in a minute", 503)
    if resp.status_code == 429:
        logger.warning("[%s] rate-limited: %s", tag, resp.text[:300])
        raise LLMError("The AI service is rate-limited right now — try again in a minute", 429)
    if resp.status_code >= 400:
        logger.warning("[%s] %s %s: %s", tag, provider(), resp.status_code, resp.text[:300])
        raise LLMError(f"AI service error ({resp.status_code})")
    try:
        return resp.json()
    except ValueError as exc:
        raise LLMError("AI service returned a non-JSON response") from exc


def _openai_target() -> tuple[str, dict]:
    s = get_settings()
    url = eff("AI_BASE_URL", s.AI_BASE_URL).rstrip("/") + "/chat/completions"
    key = eff("AI_API_KEY", s.AI_API_KEY)
    return url, ({"Authorization": f"Bearer {key}"} if key else {})


def _json_schema(schema: dict, strict: bool = False) -> dict:
    """Gemini's OBJECT/STRING + nullable dialect → plain lowercase JSON Schema.
    strict (structured output): every property is required and nullable ones
    accept null — with optional properties a constrained model skips fields
    instead of reading them. Tool parameters stay optional (strict=False)."""
    out = {}
    nullable = bool(schema.get("nullable"))
    for k, v in schema.items():
        if k == "nullable":
            continue
        if k == "type" and isinstance(v, str):
            out[k] = [v.lower(), "null"] if strict and nullable else v.lower()
        elif k == "properties":
            out[k] = {name: _json_schema(p, strict) for name, p in v.items()}
            if strict:
                out["required"] = list(v)
        elif k == "items":
            out[k] = _json_schema(v, strict)
        else:
            out[k] = v
    return out


def _read_pdf(content: bytes) -> tuple[list[bytes], str]:
    """Open models take images, not PDFs: render the first pages, and keep the
    text layer — a digital invoice's text is exact where a model reading pixels
    misreads serial numbers. Scans have no text layer and go on images alone."""
    import pymupdf
    with pymupdf.open(stream=content, filetype="pdf") as doc:
        if doc.page_count == 0:
            raise LLMError("The PDF has no pages", 422)
        pages = list(doc.pages(0, min(doc.page_count, PDF_MAX_PAGES)))
        images = [page.get_pixmap(dpi=PDF_DPI).tobytes("png") for page in pages]
        text = "\n\n".join(page.get_text("text", sort=True).strip() for page in pages).strip()
    return images, text


# ─── Chat with tools ──────────────────────────────────────────────────

ToolRunner = Callable[[str, dict], Awaitable[dict]]


async def chat(system: str, history: list[dict], tools: list[dict], run_tool: ToolRunner,
               max_rounds: int, max_tokens: int = 1024) -> tuple[str, list[str]]:
    """One assistant turn. history = [{role: user|model, text}]; run_tool(name, args)
    executes a call. Returns (reply text, names of tools used)."""
    if not enabled():
        raise LLMError("Assistant is not configured (no AI provider set up)", 503)
    if provider() == "openai":
        return await _chat_openai(system, history, tools, run_tool, max_rounds, max_tokens)
    return await _chat_gemini(system, history, tools, run_tool, max_rounds, max_tokens)


async def _chat_gemini(system, history, tools, run_tool, max_rounds, max_tokens):
    s = get_settings()
    url = GEMINI_URL.format(model=eff("GEMINI_MODEL", s.GEMINI_MODEL))
    key = eff("GEMINI_API_KEY", s.GEMINI_API_KEY)
    body = {
        "system_instruction": {"parts": [{"text": system}]},
        "contents": [{"role": "model" if m["role"] == "model" else "user", "parts": [{"text": m["text"]}]}
                     for m in history],
        "tools": [{"function_declarations": tools}],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": max_tokens},
    }
    used: list[str] = []
    async with httpx.AsyncClient(timeout=45) as client:
        for _ in range(max_rounds):
            data = await _post(client, "assistant", 3, url=url, params={"key": key}, json=body)
            try:
                parts = data["candidates"][0]["content"]["parts"]
            except (KeyError, IndexError):
                raise LLMError("AI returned an empty response")
            calls = [p["functionCall"] for p in parts if "functionCall" in p]
            if not calls:
                return "".join(p.get("text", "") for p in parts).strip() or "…", used
            body["contents"].append({"role": "model", "parts": parts})
            responses = []
            for call in calls:
                name = call.get("name")
                used.append(name)
                result = await run_tool(name, call.get("args") or {})
                responses.append({"functionResponse": {"name": name, "response": result}})
            body["contents"].append({"role": "user", "parts": responses})
    raise LLMError("Too many tool rounds — please rephrase", 503)


async def _chat_openai(system, history, tools, run_tool, max_rounds, max_tokens):
    url, headers = _openai_target()
    messages = [{"role": "system", "content": system}] + [
        {"role": "assistant" if m["role"] == "model" else "user", "content": m["text"]} for m in history
    ]
    body = {
        "model": eff("AI_MODEL", get_settings().AI_MODEL),
        "messages": messages,
        "tools": [{"type": "function", "function": {**t, "parameters": _json_schema(t.get("parameters") or {"type": "object", "properties": {}})}}
                  for t in tools],
        "temperature": 0.3,
        "max_tokens": max_tokens,
        "reasoning_effort": eff("AI_REASONING", get_settings().AI_REASONING) or None,
        "stream": False,
    }
    used: list[str] = []
    # A self-hosted model answers slower than Gemini, especially on a cold load.
    async with httpx.AsyncClient(timeout=120) as client:
        for _ in range(max_rounds):
            data = await _post(client, "assistant", 2, url=url, headers=headers, json=body)
            try:
                msg = data["choices"][0]["message"]
            except (KeyError, IndexError):
                raise LLMError("AI returned an empty response")
            calls = msg.get("tool_calls") or []
            if not calls:
                return (msg.get("content") or "").strip() or "…", used
            messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
            for i, call in enumerate(calls):
                fn = call.get("function") or {}
                name = fn.get("name")
                args = fn.get("arguments") or {}
                if isinstance(args, str):
                    try:
                        args = json.loads(args) if args.strip() else {}
                    except ValueError:
                        args = {}
                used.append(name)
                result = await run_tool(name, args)
                messages.append({"role": "tool", "tool_call_id": call.get("id") or f"call_{i}", "name": name,
                                 "content": json.dumps(result, ensure_ascii=False, default=str)})
    raise LLMError("Too many tool rounds — please rephrase", 503)


# ─── Structured extraction from a document ────────────────────────────

async def extract_json(prompt: str, schema: dict, content: bytes, mime: str,
                       max_tokens: int = 4096) -> dict:
    """Read one document (PDF or image) and answer with JSON matching schema."""
    if not enabled():
        raise LLMError("AI reading is not configured (no AI provider set up)", 503)
    if provider() == "openai":
        data = await _extract_openai(prompt, schema, content, mime, max_tokens)
    else:
        data = await _extract_gemini(prompt, schema, content, mime, max_tokens)
    if not isinstance(data, dict):
        raise LLMError("The AI answer is not a JSON object")
    return data


async def _extract_gemini(prompt, schema, content, mime, max_tokens):
    s = get_settings()
    body = {
        "contents": [{"role": "user", "parts": [
            {"inline_data": {"mime_type": mime, "data": base64.b64encode(content).decode()}},
            {"text": prompt},
        ]}],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            "responseSchema": schema,
            "maxOutputTokens": max_tokens,
        },
    }
    async with httpx.AsyncClient(timeout=90) as client:
        data = await _post(client, "extract", 4, url=GEMINI_URL.format(model=eff("GEMINI_MODEL", s.GEMINI_MODEL)),
                           params={"key": eff("GEMINI_API_KEY", s.GEMINI_API_KEY)}, json=body)
    try:
        return json.loads("".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"]))
    except (KeyError, IndexError, ValueError) as exc:
        raise LLMError("The AI answer is not valid JSON") from exc


async def _extract_openai(prompt, schema, content, mime, max_tokens):
    text = ""
    if mime == "application/pdf":
        images, text = await asyncio.to_thread(_read_pdf, content)
        mime = "image/png"
    else:
        images = [content]
    parts = [{"type": "image_url", "image_url": {"url": f"data:{mime};base64,{base64.b64encode(img).decode()}"}}
             for img in images]
    if text:
        prompt += ("\n\nThe document's own text layer follows. Copy values — serial numbers especially — "
                   "character for character from it; use the images for layout.\n<document_text>\n"
                   + text + "\n</document_text>")
    url, headers = _openai_target()
    body = {
        "model": eff("AI_MODEL", get_settings().AI_MODEL),
        "messages": [{"role": "user", "content": parts + [{"type": "text", "text": prompt}]}],
        "response_format": {"type": "json_schema", "json_schema": {"name": "extraction", "schema": _json_schema(schema, strict=True)}},
        "temperature": 0,
        "reasoning_effort": eff("AI_REASONING", get_settings().AI_REASONING) or None,
        "max_tokens": max_tokens,
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=240) as client:
        data = await _post(client, "extract", 2, url=url, headers=headers, json=body)
    try:
        text = (data["choices"][0]["message"].get("content") or "").strip()
    except (KeyError, IndexError) as exc:
        raise LLMError("AI returned an empty response") from exc
    if text.startswith("```"):  # some servers ignore response_format and fence the JSON
        text = text.strip("`").removeprefix("json").strip()
    try:
        return json.loads(text)
    except ValueError as exc:
        raise LLMError("The AI answer is not valid JSON") from exc
