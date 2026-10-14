import re
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests


# =========================================================
# CONFIG
# =========================================================

ARCHIVE_API = (
    "https://api.bilibili.com/"
    "x/series/recArchivesByKeywords"
)

DYNAMIC_SPACE_API = (
    "https://api.bilibili.com/"
    "x/polymer/web-dynamic/v1/feed/space"
)

DEFAULT_LIMIT = 10
MAX_LIMIT = 50
TIMEOUT = 12

USER_AGENT = (
    "Mozilla/5.0 "
    "(Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 "
    "(KHTML, like Gecko) "
    "Chrome/154.0.0.0 Safari/537.36"
)

session = requests.Session()

session.headers.update({
    "User-Agent": USER_AGENT,
    "Accept": "application/json,text/plain,*/*",
})


# =========================================================
# ERRORS
# =========================================================

class BilibiliRateLimited(RuntimeError):
    pass


# =========================================================
# HELPERS
# =========================================================

def safe_int(value):
    if value is None:
        return 0

    if isinstance(value, bool):
        return int(value)

    if isinstance(value, (int, float)):
        return int(value)

    text = str(value).strip()

    if not text:
        return 0

    try:
        if text.endswith("万"):
            return int(
                float(text[:-1])
                * 10_000
            )

        if text.endswith("亿"):
            return int(
                float(text[:-1])
                * 100_000_000
            )

        return int(
            float(text)
        )

    except Exception:
        return 0


def format_timestamp(value):
    if value in (
        None,
        "",
        0,
        "0",
    ):
        return None

    try:
        timestamp = int(
            float(value)
        )

        return (
            datetime
            .fromtimestamp(
                timestamp,
                tz=timezone.utc,
            )
            .astimezone()
            .isoformat(
                timespec="seconds"
            )
        )

    except Exception:
        return None


def extract_mid(profile_url):
    value = str(
        profile_url
    ).strip()

    match = re.search(
        r"space\.bilibili\.com/(\d+)",
        value,
        flags=re.IGNORECASE,
    )

    if match:
        return match.group(1)

    parsed = urlparse(
        value
    )

    parts = [
        item
        for item
        in parsed.path.split("/")
        if item
    ]

    for item in parts:
        if item.isdigit():
            return item

    if value.isdigit():
        return value

    raise ValueError(
        "Không lấy được Bilibili MID "
        f"từ URL: {profile_url}"
    )


def normalize_video(item):
    if not isinstance(
        item,
        dict,
    ):
        return None

    bvid = (
        item.get("bvid")
        or item.get("bv_id")
    )

    if not bvid:
        return None

    stat = (
        item.get("stat")
        or {}
    )

    cover = (
        item.get("pic")
        or item.get("cover")
        or ""
    )

    if cover.startswith("//"):
        cover = (
            "https:"
            + cover
        )

    elif cover.startswith(
        "http://"
    ):
        cover = (
            "https://"
            + cover[
                len("http://"):
            ]
        )

    published = (
        item.get("pubdate")
        or item.get("ctime")
        or item.get("created")
    )

    dimension = item.get("dimension") or {}

    def duration_seconds(value):
        if isinstance(value, str) and ":" in value:
            try:
                total = 0
                for unit in value.split(":"):
                    total = total * 60 + int(unit)
                return total
            except ValueError:
                return None
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return None

    return {
        "platform":
            "bilibili",

        "video_id":
            bvid,

        "url":
            (
                "https://www.bilibili.com/"
                f"video/{bvid}/"
            ),

        "title":
            item.get("title")
            or "",

        "cover_url":
            cover,

        "duration_seconds": duration_seconds(item.get("duration")),

        "video_width": safe_int(
            dimension.get("width")
            if isinstance(dimension, dict)
            else item.get("width")
        ) or None,

        "video_height": safe_int(
            dimension.get("height")
            if isinstance(dimension, dict)
            else item.get("height")
        ) or None,

        "published_at":
            format_timestamp(
                published
            ),

        "play_count":
            safe_int(
                stat.get("view")
                if isinstance(
                    stat,
                    dict,
                )
                else 0
            ),

        "like_count":
            safe_int(
                stat.get("like")
                if isinstance(
                    stat,
                    dict,
                )
                else 0
            ),

        "comment_count":
            safe_int(
                (
                    stat.get("reply")
                    or stat.get("danmaku")
                    or 0
                )
                if isinstance(
                    stat,
                    dict,
                )
                else 0
            ),

        "share_count":
            safe_int(
                stat.get("share")
                if isinstance(
                    stat,
                    dict,
                )
                else 0
            ),
    }


# =========================================================
# PAGED ARCHIVE API
# =========================================================

def request_archive_page(
    *,
    mid,
    page,
    limit,
):
    params = {
        "mid":
            str(mid),

        "keywords":
            "",

        "ps":
            int(limit),

        "pn":
            int(page),

        "orderby":
            "pubdate",
    }

    headers = {
        "Referer":
            (
                "https://space.bilibili.com/"
                f"{mid}/video"
            ),
    }

    response = session.get(
        ARCHIVE_API,
        params=params,
        headers=headers,
        timeout=TIMEOUT,
    )

    if response.status_code == 412:
        raise BilibiliRateLimited(
            "BILIBILI_HTTP_412"
        )

    response.raise_for_status()

    payload = response.json()

    code = payload.get(
        "code"
    )

    if code in (
        -352,
        -412,
    ):
        raise BilibiliRateLimited(
            f"BILIBILI_API_{code}"
        )

    if code != 0:
        raise RuntimeError(
            "Bilibili archive API error: "
            f"code={code}, "
            f"message={payload.get('message')}"
        )

    return payload


def fetch_page(
    profile_url,
    *,
    page=1,
    limit=DEFAULT_LIMIT,
):
    page = max(
        1,
        int(page),
    )

    limit = max(
        1,
        min(
            int(limit),
            MAX_LIMIT,
        ),
    )

    mid = extract_mid(
        profile_url
    )

    payload = request_archive_page(
        mid=mid,
        page=page,
        limit=limit,
    )

    data = (
        payload.get("data")
        or {}
    )

    archives = (
        data.get("archives")
        or []
    )

    videos = []

    for item in archives:
        video = normalize_video(
            item
        )

        if video:
            videos.append(
                video
            )

    videos.sort(
        key=lambda item:
            item.get(
                "published_at"
            )
            or "",
        reverse=True,
    )

    return videos[:limit]



def fetch_page_meta(
    profile_url,
    *,
    page=1,
    limit=DEFAULT_LIMIT,
):
    page = max(
        1,
        int(page),
    )

    limit = max(
        1,
        min(
            int(limit),
            MAX_LIMIT,
        ),
    )

    mid = extract_mid(
        profile_url
    )

    payload = request_archive_page(
        mid=mid,
        page=page,
        limit=limit,
    )

    data = (
        payload.get("data")
        or {}
    )

    archives = (
        data.get("archives")
        or []
    )

    page_info = (
        data.get("page")
        or {}
    )

    total_raw = (
        page_info.get("total")
    )

    try:
        total = (
            int(total_raw)
            if total_raw is not None
            else None
        )
    except Exception:
        total = None

    videos = []

    for item in archives:
        video = normalize_video(
            item
        )

        if video:
            videos.append(
                video
            )

    videos.sort(
        key=lambda item:
            item.get(
                "published_at"
            )
            or "",
        reverse=True,
    )

    videos = videos[:limit]

    if total is not None:
        has_more = (
            page
            * limit
            < total
        )
    else:
        has_more = (
            len(videos)
            == limit
        )

    return {
        "videos":
            videos,

        "page":
            page,

        "page_size":
            limit,

        "total":
            total,

        "has_more":
            has_more,
    }


def fetch_latest_meta(
    profile_url,
    limit=DEFAULT_LIMIT,
):
    limit = max(
        1,
        min(
            int(limit),
            MAX_LIMIT,
        ),
    )

    try:
        return fetch_page_meta(
            profile_url,
            page=1,
            limit=limit,
        )

    except BilibiliRateLimited:

        print(
            "[PRIMARY] Rate-limited -> "
            "thử dynamic fallback."
        )

        videos = (
            fetch_latest_from_dynamic(
                profile_url,
                limit=limit,
            )
        )

        return {
            "videos":
                videos,

            "page":
                1,

            "page_size":
                limit,

            # Dynamic fallback does not reliably expose
            # the creator's total number of uploads.
            "total":
                None,

            "has_more":
                (
                    len(videos)
                    == limit
                ),
        }


# =========================================================
# PAGE 1 FALLBACK
# =========================================================

def fetch_latest_from_dynamic(
    profile_url,
    limit=DEFAULT_LIMIT,
):
    mid = extract_mid(
        profile_url
    )

    params = {
        "host_mid":
            mid,

        "timezone_offset":
            -480,

        "features":
            "itemOpusStyle",
    }

    headers = {
        "Referer":
            (
                "https://space.bilibili.com/"
                f"{mid}/dynamic"
            ),
    }

    response = session.get(
        DYNAMIC_SPACE_API,
        params=params,
        headers=headers,
        timeout=TIMEOUT,
    )

    if response.status_code == 412:
        raise BilibiliRateLimited(
            "BILIBILI_DYNAMIC_HTTP_412"
        )

    response.raise_for_status()

    payload = response.json()

    code = payload.get(
        "code"
    )

    if code in (
        -352,
        -412,
    ):
        raise BilibiliRateLimited(
            f"BILIBILI_DYNAMIC_API_{code}"
        )

    if code != 0:
        raise RuntimeError(
            "Bilibili dynamic API error: "
            f"code={code}, "
            f"message={payload.get('message')}"
        )

    data = (
        payload.get("data")
        or {}
    )

    items = (
        data.get("items")
        or []
    )

    videos = []
    seen = set()

    for item in items:
        modules = (
            item.get("modules")
            or {}
        )

        dynamic = (
            modules.get(
                "module_dynamic"
            )
            or {}
        )

        major = (
            dynamic.get("major")
            or {}
        )

        archive = (
            major.get("archive")
            or {}
        )

        bvid = archive.get(
            "bvid"
        )

        if not bvid:
            continue

        if bvid in seen:
            continue

        seen.add(
            bvid
        )

        author = (
            modules.get(
                "module_author"
            )
            or {}
        )

        module_stat = (
            modules.get(
                "module_stat"
            )
            or {}
        )

        archive_stat = (
            archive.get("stat")
            or {}
        )

        cover = (
            archive.get("cover")
            or ""
        )

        if cover.startswith("//"):
            cover = (
                "https:"
                + cover
            )

        elif cover.startswith(
            "http://"
        ):
            cover = (
                "https://"
                + cover[
                    len("http://"):
                ]
            )

        videos.append({
            "platform":
                "bilibili",

            "video_id":
                bvid,

            "url":
                (
                    "https://www.bilibili.com/"
                    f"video/{bvid}/"
                ),

            "title":
                archive.get(
                    "title"
                )
                or "",

            "cover_url":
                cover,

            "published_at":
                format_timestamp(
                    author.get(
                        "pub_ts"
                    )
                ),

            "play_count":
                safe_int(
                    archive_stat.get(
                        "play"
                    )
                ),

            "like_count":
                safe_int(
                    (
                        module_stat.get(
                            "like"
                        )
                        or {}
                    ).get(
                        "count"
                    )
                ),

            "comment_count":
                safe_int(
                    (
                        module_stat.get(
                            "comment"
                        )
                        or {}
                    ).get(
                        "count"
                    )
                ),

            "share_count":
                safe_int(
                    (
                        module_stat.get(
                            "forward"
                        )
                        or {}
                    ).get(
                        "count"
                    )
                ),
        })

        if len(
            videos
        ) >= limit:
            break

    videos.sort(
        key=lambda item:
            item.get(
                "published_at"
            )
            or "",
        reverse=True,
    )

    return videos


# =========================================================
# PUBLIC API
# =========================================================

def fetch_latest(
    profile_url,
    limit=DEFAULT_LIMIT,
):
    return (
        fetch_latest_meta(
            profile_url,
            limit=limit,
        )
        .get(
            "videos",
            [],
        )
    )


def sort_popular(
    videos,
):
    return sorted(
        videos,
        key=lambda item:
            int(
                item.get(
                    "play_count",
                    0,
                )
                or 0
            ),
        reverse=True,
    )
