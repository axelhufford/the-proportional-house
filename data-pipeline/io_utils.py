"""Shared filesystem helpers for the data pipeline.

Everything the pipeline publishes is fetched directly by the live site, so a
half-written file is worse than a stale one: the browser gets a JSON parse
error and the whole page falls into the error boundary. These helpers make the
publish step all-or-nothing.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

# Files the site fetches must start with one of these once decoded. Used to
# reject an HTML error page or a CDN interstitial that arrived with HTTP 200.
_JSON_LEADING = ("{", "[")


def write_text_atomic(path: Path, text: str) -> None:
    """Write `text` to `path` atomically.

    Writes to a temporary file in the same directory (same filesystem, so the
    rename is atomic) and then `os.replace`s it into place. A crash, an OOM
    kill, or a CI timeout mid-write leaves the previous file untouched instead
    of a truncated one.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp"
    )
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def write_json_atomic(path: Path, payload: Any, *, indent: int = 2) -> None:
    """Serialize `payload` and write it atomically.

    Serialization happens *before* the file is touched, so a payload containing
    something unserializable raises without disturbing the previous good file.
    """
    text = json.dumps(payload, indent=indent)
    write_text_atomic(path, text)


def write_bytes_atomic(path: Path, data: bytes) -> None:
    """Binary counterpart of `write_text_atomic` (PDFs, PNGs)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp"
    )
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def looks_like_json(text: str) -> bool:
    """True if `text` plausibly is a JSON document rather than an HTML page.

    The site's SPA fallback (`/*  /index.html  200` in public/_redirects) means
    a request for a *missing* data file returns HTTP 200 with an HTML body — so
    status codes alone cannot tell a real payload from the app shell.
    """
    return text.lstrip()[:1] in _JSON_LEADING
