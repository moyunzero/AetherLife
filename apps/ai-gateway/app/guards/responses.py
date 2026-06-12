from __future__ import annotations

from fastapi.responses import JSONResponse

from app.guards.content import GuardResult


def guard_denied_response(guard: GuardResult) -> JSONResponse:
    if guard.code == "moderation_unavailable":
        return JSONResponse(
            status_code=503,
            content={
                "ok": False,
                "code": "moderation_unavailable",
                "error": "内容审核暂时不可用，请稍后重试",
            },
        )
    return JSONResponse(
        status_code=400,
        content={"ok": False, "code": "content_blocked", "error": "无法处理该内容"},
    )
