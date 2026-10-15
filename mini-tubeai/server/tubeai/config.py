"""Every tunable value for the server, as named constants.

The numbers below are UNTUNED GUESSES. They are a reasonable starting point
for lecture-style videos, not the result of any measurement.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

SERVER_DIR = Path(__file__).resolve().parent.parent
load_dotenv(SERVER_DIR / ".env")

# --- network --------------------------------------------------------------
HOST = "127.0.0.1"  # loopback only; never reachable from the network
PORT = 8000
# Fixed by the "key" in extension/manifest.json. Override if you change it.
EXTENSION_ID = os.environ.get("TUBE_EXTENSION_ID", "eclaebfeenkjabmcnnogpckkahoppkpn")
EXTENSION_ORIGIN = f"chrome-extension://{EXTENSION_ID}"

# --- storage --------------------------------------------------------------
DATA_DIR = Path(os.environ.get("TUBE_DATA_DIR", SERVER_DIR / "data"))
TOKEN_FILE = DATA_DIR / "token.txt"
LANCEDB_DIR = DATA_DIR / "lancedb"

# --- retrieval (untuned guesses) ------------------------------------------
CHUNK_SECONDS = 60
CHUNK_OVERLAP_SECONDS = 10
TOP_K = 5
MAX_HISTORY_TURNS = 4
EMBED_BATCH_SIZE = 100

# --- OpenAI (untuned guesses) ---------------------------------------------
MAX_OUTPUT_TOKENS = 500
EMBEDDING_MODEL = "text-embedding-3-small"
CHAT_MODEL = os.environ.get("TUBE_CHAT_MODEL", "gpt-4")  # change here or in .env
OPENAI_TIMEOUT_SECONDS = 30
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

# --- request limits -------------------------------------------------------
MAX_QUESTION_CHARS = 2000
