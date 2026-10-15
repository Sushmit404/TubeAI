"""Shared-secret auth: the extension sends X-Tube-Token on every request."""
import hmac
import secrets
from pathlib import Path

from fastapi import Header, HTTPException, Request


def load_or_create_token(path: Path) -> str:
    """Return the token in `path`, creating a new random one on first start."""
    if path.exists():
        token = path.read_text().strip()
        if token:
            return token
    path.parent.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(32)
    path.write_text(token + "\n")
    path.chmod(0o600)
    return token


def require_token(request: Request, x_tube_token: str | None = Header(default=None)) -> None:
    expected = request.app.state.token
    if not x_tube_token or not hmac.compare_digest(x_tube_token.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Missing or wrong X-Tube-Token.")
