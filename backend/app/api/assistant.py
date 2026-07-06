"""AI assistant chat endpoint."""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.deps import get_current_user
from app.models.models import User
from app.services.assistant_service import run_chat

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/assistant", tags=["assistant"])


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|model)$")
    text: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=32)


@router.get("/status", summary="Is the assistant configured?")
async def assistant_status(_: User = Depends(get_current_user)):
    return {"enabled": bool(get_settings().GEMINI_API_KEY)}


@router.post("/chat", summary="Chat with the portal assistant")
async def chat(
    payload: ChatRequest,
    user: User = Depends(get_current_user),
):
    result = await run_chat(user, [m.model_dump() for m in payload.messages])
    if result.get("error"):
        raise HTTPException(status_code=503, detail=result["error"])
    return result
