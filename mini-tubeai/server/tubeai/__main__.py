"""Run with:  python -m tubeai   (from the server/ folder)"""
import uvicorn

from . import config
from .auth import load_or_create_token
from .main import create_app


def main() -> None:
    token = load_or_create_token(config.TOKEN_FILE)
    bar = "=" * 64
    print(f"\n{bar}\n mini TubeAI server on http://{config.HOST}:{config.PORT}\n"
          f" Paste this token into the extension popup (once):\n\n   {token}\n\n"
          f" (stored in {config.TOKEN_FILE})\n{bar}\n", flush=True)
    if not config.OPENAI_API_KEY:
        print(" Note: OPENAI_API_KEY is not set in server/.env (needed from stage 2 on).\n", flush=True)
    uvicorn.run(create_app(token), host=config.HOST, port=config.PORT, log_level="info")


if __name__ == "__main__":
    main()
