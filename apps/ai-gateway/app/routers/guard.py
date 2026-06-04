from fastapi import APIRouter

from app.guards.reply import audit_reply
from app.models.requests import CheckReplyBody

router = APIRouter(prefix="/v1/guard", tags=["guard"])


@router.post("/check-reply")
async def check_reply(body: CheckReplyBody):
    text = audit_reply(body.text, body.toolCalls)
    return {"text": text}
