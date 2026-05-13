from __future__ import annotations

from .madara import MadaraSiteHandler


class ManhuaUSSiteHandler(MadaraSiteHandler):
    def __init__(self) -> None:
        super().__init__("manhuaus", "https://manhuaus.com")
        # See sites/manhuaplus.py — same `.read-container` story; the
        # default Madara reader_selectors don't cover it.
        self.reader_selectors = (
            "div.read-container img",
            "div.reading-content img",
            "div#chapter-images img",
            "div.page-break img",
        )


__all__ = ["ManhuaUSSiteHandler"]
