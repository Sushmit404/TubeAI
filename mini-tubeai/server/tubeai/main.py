"""FastAPI app. Build it with create_app(); __main__.py runs it."""
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import config
from .auth import load_or_create_token, require_token

VERSION = "0.1.0"


class HistoryTurn(BaseModel):
    role: str
    content: str


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=config.MAX_QUESTION_CHARS)
    videoId: str | None = None
    currentTime: float | None = None
    history: list[HistoryTurn] = []


class Source(BaseModel):
    startSec: float
    endSec: float


class AskResponse(BaseModel):
    answer: str
    sources: list[Source] = []


def create_app(token: str | None = None) -> FastAPI:
    app = FastAPI(title="mini TubeAI server", version=VERSION)
    app.state.token = token or load_or_create_token(config.TOKEN_FILE)

    # Only our extension's pages/worker may call us from a browser.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[config.EXTENSION_ORIGIN],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-Tube-Token"],
    )

    # No token needed: lets the extension tell "server down" from "bad token".
    # Returns nothing sensitive.
    @app.get("/health")
    def health():
        return {"ok": True, "version": VERSION}

    # Stage 1: echo only. Retrieval + OpenAI arrive in stage 3.
    @app.post("/ask", response_model=AskResponse, dependencies=[Depends(require_token)])
    def ask(req: AskRequest):
        return AskResponse(answer=f"Echo: {req.question}", sources=[])

    return app
