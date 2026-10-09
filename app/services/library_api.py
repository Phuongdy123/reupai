import json
import re
import subprocess
import sys
import urllib.parse
from pathlib import Path
from typing import Optional

from fastapi import (
    APIRouter,
    HTTPException,
    Query,
    Request,
)
from pydantic import BaseModel

from services.source_db import (
    add_source,
    get_connection,
    init_db,
)

from services.library_db import (
    add_video_to_collection,
    create_collection,
    delete_collection,
    library_meta,
    list_collections,
    list_library_videos,
    list_series,
    load_ui_state,
    remove_video_from_collection,
    save_ui_state,
    toggle_favorite,
    upsert_video_dict,
    detect_series,
)


router = APIRouter(
    prefix="/api/library",
    tags=[
        "library",
    ],
)


# =========================================================
# MODELS
# =========================================================

class VideoBody(BaseModel):
    video_id: str
    platform: str = "unknown"
    url: str = ""
    title: str = ""
    cover_url: str = ""
    source_id: Optional[int] = None
    source_name: Optional[str] = None
    channel_key: Optional[str] = None
    published_at: Optional[str] = None
    play_count: int = 0
    like_count: int = 0
    comment_count: int = 0
    share_count: int = 0


class FavoriteBody(VideoBody):
    pass


class CollectionCreateBody(BaseModel):
    name: str
    description: str = ""


class CollectionVideoBody(VideoBody):
    pass


class SavedSourceBody(BaseModel):
    platform: str
    name: str
    url: str
    channel: str = "2d_animation"
    auto_process: bool = False
    min_views: int = 0
    cover_url: str = ""


class SavedSourcePatchBody(BaseModel):
    name: Optional[str] = None
    channel: Optional[str] = None
    auto_process: Optional[bool] = None
    min_views: Optional[int] = None
    enabled: Optional[bool] = None
    cover_url: Optional[str] = None


class DirectVideoBody(BaseModel):
    url: str
    channel: str = "2d_animation"


# Keep older databases compatible with saved source thumbnails.
init_db()


class UiStateBody(BaseModel):
    value: dict


# =========================================================
# HELPERS
# =========================================================

def user_id_from_request(
    request: Request,
):
    user = getattr(
        request.state,
        "user",
        None,
    )

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Chưa đăng nhập.",
        )

    return int(
        user[
            "id"
        ]
    )


def detect_platform(
    url,
):
    value = str(
        url
    ).lower()

    if (
        "bilibili.com"
        in value
        or "b23.tv"
        in value
    ):
        return "bilibili"

    if "douyin.com" in value:
        return "douyin"

    return "unknown"


def normalize_profile_url(
    platform,
    url,
):
    platform = str(
        platform
    ).strip().lower()

    value = str(
        url
    ).strip()

    if platform == "douyin":

        try:
            from services.sources.douyin import (
                normalize_profile_url
                as normalize_douyin_profile,
            )

            return (
                normalize_douyin_profile(
                    value
                )
            )

        except Exception as error:
            raise HTTPException(
                status_code=400,
                detail=str(
                    error
                ),
            )

    if platform == "bilibili":

        parsed = (
            urllib.parse
            .urlsplit(
                value
            )
        )

        if (
            "bilibili.com"
            not in parsed.netloc.lower()
            and "b23.tv"
            not in parsed.netloc.lower()
        ):
            raise HTTPException(
                status_code=400,
                detail="Link Bilibili không hợp lệ.",
            )

        return (
            urllib.parse
            .urlunsplit(
                (
                    parsed.scheme
                    or "https",
                    parsed.netloc.lower(),
                    parsed.path.rstrip(
                        "/"
                    )
                    or "/",
                    "",
                    "",
                )
            )
        )

    raise HTTPException(
        status_code=400,
        detail=(
            "Chỉ hỗ trợ nguồn "
            "Bilibili và Douyin."
        ),
    )


def parse_video_id(
    platform,
    url,
):
    value = str(
        url
    ).strip()

    if platform == "bilibili":

        match = re.search(
            r"\b(BV[0-9A-Za-z]+)\b",
            value,
        )

        if match:
            return (
                match.group(1)
            )

    if platform == "douyin":

        patterns = [
            r"douyin\.com/video/(\d{10,25})",
            r"[?&]modal_id=(\d{10,25})",
            r"[?&]vid=(\d{10,25})",
        ]

        for pattern in patterns:

            match = re.search(
                pattern,
                value,
            )

            if match:
                return (
                    match.group(1)
                )

    return None


def canonical_video_url(
    platform,
    video_id,
    original_url,
):

    if platform == "bilibili":

        return (
            "https://www.bilibili.com/video/"
            + video_id
        )

    if platform == "douyin":

        return (
            "https://www.douyin.com/video/"
            + video_id
        )

    return original_url


def ytdlp_metadata(
    url,
):

    command = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--dump-single-json",
        "--skip-download",
        "--no-warnings",
        "--no-playlist",
        url,
    ]

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
        timeout=45,
    )

    if result.returncode != 0:
        return {}

    text = (
        result.stdout
        .strip()
    )

    if not text:
        return {}

    try:
        return json.loads(
            text.splitlines()[-1]
        )

    except Exception:
        return {}


def source_row(
    source_id,
):

    conn = get_connection()

    try:

        row = (
            conn.execute(
                """
                SELECT
                    s.*,
                    (
                        SELECT COUNT(*)
                        FROM source_videos sv
                        WHERE sv.source_id = s.id
                    ) AS video_count
                FROM sources s
                WHERE s.id = ?
                """,
                (
                    int(
                        source_id
                    ),
                ),
            )
            .fetchone()
        )

        return (
            dict(
                row
            )
            if row
            else None
        )

    finally:
        conn.close()


# =========================================================
# SAVED SOURCES
# =========================================================

@router.get(
    "/sources",
)
def api_saved_sources():

    conn = get_connection()

    try:

        rows = (
            conn.execute(
                """
                SELECT
                    s.*,
                    (
                        SELECT COUNT(*)
                        FROM source_videos sv
                        WHERE sv.source_id = s.id
                    ) AS video_count
                FROM sources s
                WHERE s.enabled = 1
                ORDER BY
                    s.platform,
                    s.name COLLATE NOCASE
                """
            )
            .fetchall()
        )

        return {
            "sources": [
                dict(
                    row
                )
                for row in rows
            ]
        }

    finally:
        conn.close()


@router.post(
    "/sources",
)
def api_save_source(
    body: SavedSourceBody,
):

    platform = (
        body.platform
        .strip()
        .lower()
    )

    url = normalize_profile_url(
        platform,
        body.url,
    )

    name = (
        body.name.strip()
        or platform.upper()
    )

    channel = (
        body.channel.strip()
        or "2d_animation"
    )

    conn = get_connection()

    try:

        existing = (
            conn.execute(
                """
                SELECT *
                FROM sources
                WHERE platform = ?
                AND profile_url = ?
                AND channel_key = ?
                LIMIT 1
                """,
                (
                    platform,
                    url,
                    channel,
                ),
            )
            .fetchone()
        )

        if existing:

            conn.execute(
                """
                UPDATE sources
                SET
                    name = ?,
                    enabled = 1,
                    auto_process = ?,
                    min_views = ?,
                    cover_url = ?
                WHERE id = ?
                """,
                (
                    name,
                    int(
                        body.auto_process
                    ),
                    int(
                        body.min_views
                    ),
                    body.cover_url.strip()
                    or existing["cover_url"]
                    or "",
                    existing[
                        "id"
                    ],
                ),
            )

            conn.commit()

            return {
                "ok":
                    True,

                "source":
                    source_row(
                        existing[
                            "id"
                        ]
                    ),

                "existing":
                    True,
            }

    finally:
        conn.close()

    try:

        source_id = add_source(
            platform=
                platform,

            name=
                name,

            profile_url=
                url,

            channel_key=
                channel,

            auto_process=
                bool(
                    body.auto_process
                ),

            min_views=
                int(
                    body.min_views
                ),

            cover_url=
                body.cover_url.strip(),
        )

    except Exception as error:

        raise HTTPException(
            status_code=400,
            detail=str(
                error
            ),
        )

    return {
        "ok":
            True,

        "source":
            source_row(
                source_id
            ),

        "existing":
            False,
    }


@router.patch(
    "/sources/{source_id}",
)
def api_patch_source(
    source_id: int,
    body: SavedSourcePatchBody,
):

    conn = get_connection()

    try:

        row = (
            conn.execute(
                """
                SELECT *
                FROM sources
                WHERE id = ?
                """,
                (
                    int(
                        source_id
                    ),
                ),
            )
            .fetchone()
        )

        if not row:
            raise HTTPException(
                status_code=404,
                detail="Nguồn không tồn tại.",
            )

        current = dict(
            row
        )

        conn.execute(
            """
            UPDATE sources
            SET
                name = ?,
                channel_key = ?,
                auto_process = ?,
                min_views = ?,
                cover_url = ?,
                enabled = ?
            WHERE id = ?
            """,
            (
                (
                    body.name.strip()
                    if body.name
                    is not None
                    else current[
                        "name"
                    ]
                ),

                (
                    body.channel.strip()
                    if body.channel
                    is not None
                    else current[
                        "channel_key"
                    ]
                ),

                (
                    int(
                        body.auto_process
                    )
                    if body.auto_process
                    is not None
                    else current[
                        "auto_process"
                    ]
                ),

                (
                    int(
                        body.min_views
                    )
                    if body.min_views
                    is not None
                    else current[
                        "min_views"
                    ]
                ),

                (
                    body.cover_url.strip()
                    if body.cover_url is not None
                    else current.get(
                        "cover_url",
                        "",
                    )
                ),

                (
                    int(
                        body.enabled
                    )
                    if body.enabled
                    is not None
                    else current[
                        "enabled"
                    ]
                ),

                int(
                    source_id
                ),
            ),
        )

        conn.commit()

    finally:
        conn.close()

    return {
        "ok":
            True,

        "source":
            source_row(
                source_id
            ),
    }


@router.delete(
    "/sources/{source_id}",
)
def api_delete_source(
    source_id: int,
):

    conn = get_connection()

    try:

        conn.execute(
            """
            UPDATE sources
            SET enabled = 0
            WHERE id = ?
            """,
            (
                int(
                    source_id
                ),
            ),
        )

        conn.commit()

    finally:
        conn.close()

    return {
        "ok":
            True,
    }


# =========================================================
# DIRECT VIDEO
# =========================================================

@router.post(
    "/direct/inspect",
)
def api_direct_video(
    body: DirectVideoBody,
):

    url = (
        body.url.strip()
    )

    platform = (
        detect_platform(
            url
        )
    )

    if platform == "unknown":
        raise HTTPException(
            status_code=400,
            detail=(
                "Link video phải là "
                "Bilibili hoặc Douyin."
            ),
        )

    video_id = (
        parse_video_id(
            platform,
            url,
        )
    )

    if not video_id:
        raise HTTPException(
            status_code=400,
            detail=(
                "Không tìm thấy video ID "
                "trong link."
            ),
        )

    metadata = {}

    # Bilibili metadata thuong lay nhanh va on dinh.
    # Douyin neu yt-dlp fail thi van tra card de download
    # bang downloader Playwright hien tai.
    try:
        metadata = (
            ytdlp_metadata(
                url
            )
        )

    except Exception:
        metadata = {}

    title = (
        metadata.get(
            "title"
        )
        or (
            (
                "Bilibili "
                if platform
                == "bilibili"
                else "Douyin "
            )
            + video_id
        )
    )

    cover = (
        metadata.get(
            "thumbnail"
        )
        or ""
    )

    video = {
        "video_id":
            video_id,

        "platform":
            platform,

        "url":
            canonical_video_url(
                platform,
                video_id,
                url,
            ),

        "title":
            title,

        "cover_url":
            cover,

        "source_type":
            "direct",

        "channel_key":
            body.channel
            or "2d_animation",

        "published_at":
            None,

        "play_count":
            int(
                metadata.get(
                    "view_count"
                )
                or 0
            ),

        "like_count":
            int(
                metadata.get(
                    "like_count"
                )
                or 0
            ),

        "comment_count":
            int(
                metadata.get(
                    "comment_count"
                )
                or 0
            ),

        "share_count":
            0,
    }

    video.update(
        detect_series(
            title
        )
    )

    upsert_video_dict(
        video,
        source_type=
            "direct",
        channel_key=
            video[
                "channel_key"
            ],
    )

    # Lay lai tu library de co local state.
    rows = (
        list_library_videos(
            user_id=0,
            query=
                video_id,
            limit=20,
        )
    )

    match = next(
        (
            item
            for item in rows
            if item[
                "video_id"
            ]
            == video_id
        ),
        None,
    )

    if match:
        # user_id=0 chi dung de lay local state,
        # favorite se duoc client hydrate rieng.
        video.update(
            {
                key:
                    value
                for key, value
                in match.items()
                if key
                not in {
                    "favorite",
                }
            }
        )

    return {
        "ok":
            True,

        "video":
            video,
    }


# =========================================================
# FAVORITES
# =========================================================

@router.post(
    "/favorites/toggle",
)
def api_toggle_favorite(
    body: FavoriteBody,
    request: Request,
):

    user_id = (
        user_id_from_request(
            request
        )
    )

    upsert_video_dict(
        body.model_dump(),
        source_type=
            (
                "source"
                if body.source_id
                else "direct"
            ),
    )

    favorite = (
        toggle_favorite(
            user_id,
            body.video_id,
        )
    )

    return {
        "ok":
            True,

        "favorite":
            favorite,
    }


# =========================================================
# COLLECTIONS
# =========================================================

@router.get(
    "/collections",
)
def api_collections(
    request: Request,
):

    user_id = (
        user_id_from_request(
            request
        )
    )

    return {
        "collections":
            list_collections(
                user_id
            )
    }


@router.post(
    "/collections",
)
def api_create_collection(
    body: CollectionCreateBody,
    request: Request,
):

    user_id = (
        user_id_from_request(
            request
        )
    )

    try:

        item = (
            create_collection(
                user_id,
                body.name,
                body.description,
            )
        )

    except ValueError as error:

        raise HTTPException(
            status_code=400,
            detail=str(
                error
            ),
        )

    return {
        "ok":
            True,

        "collection":
            item,
    }


@router.delete(
    "/collections/{collection_id}",
)
def api_delete_collection(
    collection_id: int,
    request: Request,
):

    user_id = (
        user_id_from_request(
            request
        )
    )

    ok = (
        delete_collection(
            user_id,
            collection_id,
        )
    )

    if not ok:
        raise HTTPException(
            status_code=404,
            detail="Danh mục không tồn tại.",
        )

    return {
        "ok":
            True,
    }


@router.post(
    "/collections/{collection_id}/videos",
)
def api_add_collection_video(
    collection_id: int,
    body: CollectionVideoBody,
    request: Request,
):

    user_id = (
        user_id_from_request(
            request
        )
    )

    upsert_video_dict(
        body.model_dump(),
        source_type=
            (
                "source"
                if body.source_id
                else "direct"
            ),
    )

    try:

        add_video_to_collection(
            user_id,
            collection_id,
            body.video_id,
        )

    except ValueError as error:

        raise HTTPException(
            status_code=400,
            detail=str(
                error
            ),
        )

    return {
        "ok":
            True,
    }


@router.delete(
    "/collections/{collection_id}/videos/{video_id}",
)
def api_remove_collection_video(
    collection_id: int,
    video_id: str,
    request: Request,
):

    user_id = (
        user_id_from_request(
            request
        )
    )

    ok = (
        remove_video_from_collection(
            user_id,
            collection_id,
            video_id,
        )
    )

    return {
        "ok":
            bool(
                ok
            ),
    }


# =========================================================
# LIBRARY / SERIES
# =========================================================

@router.get(
    "/videos",
)
def api_library_videos(
    request: Request,
    favorite: bool = False,
    collection_id: Optional[int] = None,
    source_id: Optional[int] = None,
    series: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = Query(
        default=500,
        ge=1,
        le=2000,
    ),
):

    user_id = (
        user_id_from_request(
            request
        )
    )

    videos = (
        list_library_videos(
            user_id,
            favorite=
                favorite,
            collection_id=
                collection_id,
            source_id=
                source_id,
            series_key=
                series,
            query=
                q,
            limit=
                limit,
        )
    )

    return {
        "count":
            len(
                videos
            ),

        "videos":
            videos,
    }


@router.get(
    "/series",
)
def api_series(
    request: Request,
):

    user_id = (
        user_id_from_request(
            request
        )
    )

    series = (
        list_series(
            user_id
        )
    )

    return {
        "count":
            len(
                series
            ),

        "series":
            series,
    }


@router.get(
    "/meta",
)
def api_meta(
    request: Request,
    ids: str = "",
):

    user_id = (
        user_id_from_request(
            request
        )
    )

    values = [
        value.strip()
        for value
        in ids.split(",")
        if value.strip()
    ]

    return {
        "meta":
            library_meta(
                user_id,
                values,
            )
    }


# =========================================================
# UI STATE DB BACKUP
# =========================================================

@router.get(
    "/ui-state/{state_key}",
)
def api_get_ui_state(
    state_key: str,
    request: Request,
):

    user_id = (
        user_id_from_request(
            request
        )
    )

    return {
        "value":
            load_ui_state(
                user_id,
                state_key,
            )
    }


@router.put(
    "/ui-state/{state_key}",
)
def api_put_ui_state(
    state_key: str,
    body: UiStateBody,
    request: Request,
):

    user_id = (
        user_id_from_request(
            request
        )
    )

    save_ui_state(
        user_id,
        state_key,
        body.value,
    )

    return {
        "ok":
            True,
    }
