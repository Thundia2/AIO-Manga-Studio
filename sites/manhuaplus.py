from __future__ import annotations

from .madara import MadaraSiteHandler


class ManhuaPlusSiteHandler(MadaraSiteHandler):
    def __init__(self) -> None:
        super().__init__("manhuaplus", "https://manhuaplus.com")
        # manhuaplus.com renders chapter images inside `.read-container`,
        # which the Madara base's default reader_selectors don't include.
        # Without this override get_chapter_images would return 0 images
        # and downloads would silently fail.
        self.reader_selectors = (
            "div.read-container img",
            "div.reading-content img",
            "div#chapter-images img",
            "div.page-break img",
        )


__all__ = ["ManhuaPlusSiteHandler"]
