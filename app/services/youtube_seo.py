"""YouTube Competitor Trend & SEO Keyword Analyzer."""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from typing import Any


def analyze_youtube_seo_trends(query: str, *, owner: str = "") -> dict[str, Any]:
    """Fetch top-performing YouTube titles/keywords for a niche query."""
    clean_q = " ".join(str(query or "").strip().split())
    if not clean_q:
        raise ValueError("Hãy nhập chủ đề hoặc từ khóa cần soi trend.")

    top_videos: list[dict[str, Any]] = []
    keywords: list[str] = []

    # 1. Try YouTube Data API v3 using connected channel OAuth if available
    if owner:
        try:
            from services.youtube_publishing import _credentials
            creds = _credentials(owner)
            if creds and getattr(creds, "token", None):
                url = (
                    "https://www.googleapis.com/youtube/v3/search"
                    f"?part=snippet&type=video&order=viewCount&maxResults=6&q={urllib.parse.quote(clean_q)}"
                )
                req = urllib.request.Request(url, headers={"Authorization": f"Bearer {creds.token}"})
                with urllib.request.urlopen(req, timeout=12) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                for item in data.get("items", []):
                    sn = item.get("snippet") or {}
                    title = str(sn.get("title") or "").strip()
                    if title:
                        top_videos.append({
                            "title": title,
                            "channel": str(sn.get("channelTitle") or ""),
                            "video_id": str((item.get("id") or {}).get("videoId") or ""),
                        })
        except Exception:
            pass

    # 2. Always enrich with YouTube Autocomplete suggestions (free, no quota)
    try:
        sug_url = (
            "https://suggestqueries.google.com/complete/search"
            f"?client=youtube&ds=yt&hl=vi&q={urllib.parse.quote(clean_q)}"
        )
        req = urllib.request.Request(sug_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
        # JSONP: window.google.ac.h(...)
        start = raw.find("(")
        end = raw.rfind(")")
        if start != -1 and end > start:
            parsed = json.loads(raw[start + 1:end])
            for entry in (parsed[1] if len(parsed) > 1 else []):
                kw = str(entry[0] if isinstance(entry, list) and entry else entry).strip()
                if kw and kw not in keywords:
                    keywords.append(kw)
    except Exception:
        pass

    hashtags = [
        "#" + "".join(c for c in kw.title() if c.isalnum())
        for kw in keywords[:6]
        if any(c.isalnum() for c in kw)
    ]
    return {
        "ok": True,
        "query": clean_q,
        "keywords": keywords[:10],
        "hashtags": hashtags,
        "top_videos": top_videos[:6],
    }
