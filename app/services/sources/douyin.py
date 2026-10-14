import argparse
import json
import os
import re
import subprocess
import time
import urllib.parse
from datetime import datetime
from pathlib import Path

from runtime_paths import get_browser_dir


DEFAULT_TIMEOUT_MS = 45000
DEFAULT_SCROLL_WAIT_MS = 1100

# Neu khong bat duoc video sau 3 vong thi dung thu ngam
# va mo Chrome visible de user login ngay.
EMPTY_SCAN_BEFORE_LOGIN = 3

# Khi Chrome visible da mo, cho user toi da 90 giay de
# login/captcha. Response listener van hoat dong trong luc cho.
VISIBLE_LOGIN_WAIT_MS = 90000

DOUYIN_USER_RE = re.compile(
    r"/user/([^/?#]+)"
)

DOUYIN_VIDEO_RE = re.compile(
    r"/video/(\d{10,25})"
)


class DouyinUnavailable(
    RuntimeError
):
    pass


def _browser_profile_dir() -> Path:
    """Return the persistent, user-owned Chrome profile for Douyin.

    The Local Engine package itself is replaced when the app is updated.  A
    Chrome profile inside that immutable bundle can be left locked after an
    update or a crash, which makes Chrome exit immediately with code 21.
    Runtime paths keep browser state in ``%LOCALAPPDATA%\\ReupAI`` for the
    packaged application while preserving the existing app-local path in
    development.
    """

    return get_browser_dir() / "douyin"


# =========================================================
# URL HELPERS
# =========================================================

def normalize_profile_url(
    url: str,
) -> str:

    value = (
        str(url)
        .strip()
    )

    parsed = (
        urllib.parse
        .urlsplit(
            value
        )
    )

    host = (
        parsed.netloc
        .lower()
    )

    if (
        "douyin.com"
        not in host
    ):
        raise ValueError(
            "Khong phai URL Douyin."
        )

    match = (
        DOUYIN_USER_RE.search(
            parsed.path
        )
    )

    if not match:
        raise ValueError(
            "Can link profile dang "
            "https://www.douyin.com/user/<sec_uid>"
        )

    sec_uid = (
        match.group(1)
        .strip()
    )

    if not sec_uid:
        raise ValueError(
            "Khong tim thay sec_uid Douyin."
        )

    return (
        "https://www.douyin.com/user/"
        + sec_uid
    )


def extract_sec_uid(
    url: str,
) -> str:

    return (
        normalize_profile_url(
            url
        )
        .rstrip("/")
        .split("/")[-1]
    )


# =========================================================
# DATA HELPERS
# =========================================================

def _first_url(
    value,
):
    if not value:
        return ""

    if isinstance(
        value,
        str
    ):
        return value

    if isinstance(
        value,
        dict
    ):
        url_list = (
            value.get(
                "url_list"
            )
            or value.get(
                "urlList"
            )
            or []
        )

        if (
            isinstance(
                url_list,
                list
            )
            and url_list
        ):
            return str(
                url_list[0]
                or ""
            )

    return ""


def _published_at(
    value,
):
    try:
        timestamp = int(
            value
            or 0
        )

        if timestamp <= 0:
            return None

        return (
            datetime
            .fromtimestamp(
                timestamp
            )
            .isoformat(
                timespec="seconds"
            )
        )

    except Exception:
        return None


def _safe_int(
    value,
):
    try:
        return int(
            value
            or 0
        )

    except Exception:
        return 0


def _aweme_to_video(
    aweme,
    target_sec_uid,
):
    if not isinstance(
        aweme,
        dict
    ):
        return None

    video_id = (
        aweme.get(
            "aweme_id"
        )
        or aweme.get(
            "awemeId"
        )
        or ""
    )

    video_id = str(
        video_id
    ).strip()

    if not re.fullmatch(
        r"\d{10,25}",
        video_id,
    ):
        return None

    # Rat quan trong:
    # chi nhan video cua DUNG profile.
    author = (
        aweme.get(
            "author"
        )
        or {}
    )

    author_sec_uid = (
        author.get(
            "sec_uid"
        )
        or author.get(
            "secUid"
        )
        or ""
    )

    if (
        author_sec_uid
        and target_sec_uid
        and author_sec_uid
            != target_sec_uid
    ):
        return None

    stats = (
        aweme.get(
            "statistics"
        )
        or aweme.get(
            "stats"
        )
        or {}
    )

    video_obj = (
        aweme.get(
            "video"
        )
        or {}
    )

    duration_raw = (
        video_obj.get("duration")
        or aweme.get("duration")
        or 0
    )
    duration_ms = _safe_int(duration_raw)

    cover_url = ""

    for key in (
        "cover",
        "origin_cover",
        "dynamic_cover",
    ):
        cover_url = (
            _first_url(
                video_obj.get(
                    key
                )
            )
        )

        if cover_url:
            break

    title = (
        aweme.get(
            "desc"
        )
        or aweme.get(
            "preview_title"
        )
        or f"Douyin {video_id}"
    )

    return {
        "platform":
            "douyin",

        "video_id":
            video_id,

        "url":
            (
                "https://www.douyin.com/video/"
                + video_id
            ),

        "title":
            str(
                title
            ).strip(),

        "cover_url":
            cover_url,

        # Douyin returns the duration in milliseconds in its aweme payload.
        "duration_seconds": (
            round(duration_ms / 1000, 3)
            if duration_ms >= 1000
            else duration_ms or None
        ),

        "video_width": _safe_int(video_obj.get("width")) or None,

        "video_height": _safe_int(video_obj.get("height")) or None,

        "published_at":
            _published_at(
                aweme.get(
                    "create_time"
                )
            ),

        "play_count":
            _safe_int(
                stats.get(
                    "play_count"
                )
                or stats.get(
                    "playCount"
                )
            ),

        "like_count":
            _safe_int(
                stats.get(
                    "digg_count"
                )
                or stats.get(
                    "like_count"
                )
                or stats.get(
                    "diggCount"
                )
            ),

        "comment_count":
            _safe_int(
                stats.get(
                    "comment_count"
                )
                or stats.get(
                    "commentCount"
                )
            ),

        "share_count":
            _safe_int(
                stats.get(
                    "share_count"
                )
                or stats.get(
                    "shareCount"
                )
            ),
    }


# =========================================================
# PLAYWRIGHT
# =========================================================

def _playwright_import():
    try:
        from playwright.sync_api import (
            sync_playwright,
        )

    except ImportError as error:
        raise DouyinUnavailable(
            "Chua cai Playwright. Chay: "
            "venv\\Scripts\\python.exe "
            "-m pip install -U playwright"
        ) from error

    return sync_playwright


def _headless_default():
    value = (
        os.getenv(
            "DOUYIN_HEADLESS",
            "1",
        )
        .strip()
        .lower()
    )

    return (
        value
        not in {
            "0",
            "false",
            "no",
            "off",
        }
    )


def _install_headless_resource_filter(page, *, on_media=None):
    """Skip browser assets the scraper does not use and duplicate media reads."""

    def handle_route(route):
        try:
            request = route.request
            resource_type = request.resource_type

            if resource_type in {"image", "font"}:
                route.abort()
                return

            if resource_type == "media":
                if on_media is not None:
                    try:
                        on_media(request.url)
                    except Exception:
                        pass
                route.abort()
                return

            route.continue_()
        except Exception:
            try:
                route.continue_()
            except Exception:
                pass

    page.route("**/*", handle_route)


def _open_context(
    *,
    headless,
):
    sync_playwright = (
        _playwright_import()
    )

    profile_dir = (
        _browser_profile_dir()
    )

    profile_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    playwright = (
        sync_playwright()
        .start()
    )

    try:
        context = (
            playwright
            .chromium
            .launch_persistent_context(
                user_data_dir=str(
                    profile_dir
                ),

                channel="chrome",

                headless=headless,

                viewport={
                    "width":
                        1440,

                    "height":
                        1000,
                },

                locale="zh-CN",

                args=[
                    "--disable-blink-features="
                    "AutomationControlled",
                ],
            )
        )

    except Exception as error:
        playwright.stop()

        error_text = str(error).lower()
        if (
            "target page, context or browser has been closed"
            in error_text
            or "exitcode=21" in error_text
            or "existing browser session" in error_text
        ):
            raise DouyinUnavailable(
                "Chrome khong mo duoc profile Douyin. "
                "Hay dong cua so Chrome ma ReupAI da mo, "
                "sau do thu lai."
            ) from error

        raise

    return (
        playwright,
        context
    )


# =========================================================
# PROFILE NETWORK CAPTURE
# =========================================================

def _browser_profile_scan(
    profile_url,
    limit,
    *,
    headless=None,
):
    """
    Lay video tu response:
        /aweme/v1/web/aweme/post/

    Khong regex toan bo HTML nua,
    vi HTML profile co the chua video de xuat
    cua cac kenh khac.
    """

    if headless is None:
        headless = (
            _headless_default()
        )

    target_sec_uid = (
        extract_sec_uid(
            profile_url
        )
    )

    playwright = None
    context = None

    videos = {}
    order = []

    state = {
        "has_more":
            True,

        "max_cursor":
            None,

        "captured_responses":
            0,
    }

    def add_aweme_list(
        data
    ):
        if not isinstance(
            data,
            dict
        ):
            return

        aweme_list = (
            data.get(
                "aweme_list"
            )
            or []
        )

        if not isinstance(
            aweme_list,
            list
        ):
            return

        for aweme in aweme_list:

            item = (
                _aweme_to_video(
                    aweme,
                    target_sec_uid,
                )
            )

            if not item:
                continue

            video_id = (
                item[
                    "video_id"
                ]
            )

            if (
                video_id
                not in videos
            ):
                videos[
                    video_id
                ] = item

                order.append(
                    video_id
                )

            else:
                # Metadata response sau co the day du hon.
                old = (
                    videos[
                        video_id
                    ]
                )

                for key, value in (
                    item.items()
                ):
                    if (
                        value
                        not in {
                            None,
                            "",
                            0,
                        }
                    ):
                        old[
                            key
                        ] = value

        if (
            "has_more"
            in data
        ):
            state[
                "has_more"
            ] = bool(
                data.get(
                    "has_more"
                )
            )

        if (
            data.get(
                "max_cursor"
            )
            is not None
        ):
            state[
                "max_cursor"
            ] = data.get(
                "max_cursor"
            )

    def handle_response(
        response
    ):
        try:
            response_url = (
                response.url
            )

            if (
                "/aweme/v1/web/aweme/post/"
                not in response_url
            ):
                return

            if (
                response.status
                != 200
            ):
                return

            data = (
                response.json()
            )

            state[
                "captured_responses"
            ] += 1

            add_aweme_list(
                data
            )

        except Exception:
            # Khong lam chet browser neu mot response loi JSON.
            return

    try:
        (
            playwright,
            context,
        ) = _open_context(
            headless=headless
        )

        pages = (
            context.pages
        )

        page = (
            pages[0]
            if pages
            else context.new_page()
        )

        if headless:
            _install_headless_resource_filter(page)

        # Gan listener TRUOC goto.
        page.on(
            "response",
            handle_response,
        )

        print(
            "Mo Douyin profile..."
        )

        page.goto(
            profile_url,
            wait_until=
                "domcontentloaded",
            timeout=
                DEFAULT_TIMEOUT_MS,
        )

        # Cho request danh sach bai viet dau tien.
        page.wait_for_timeout(
            2500
        )

        if not headless:
            print()
            print(
                "[DOUYIN LOGIN] Chrome visible da mo."
            )
            print(
                "[DOUYIN LOGIN] Neu chua dang nhap/captcha, "
                "xu ly ngay trong cua so Chrome."
            )

        previous_count = -1
        stable_rounds = 0

        max_scrolls = max(
            10,
            min(
                70,
                int(
                    limit / 5
                )
                + 12,
            ),
        )

        for index in range(
            max_scrolls
        ):
            current_count = (
                len(
                    order
                )
            )

            print(
                f"Douyin scan "
                f"{index + 1}/"
                f"{max_scrolls}: "
                f"{current_count} video"
            )

            if (
                current_count
                >= limit
            ):
                break

            # Khong cho headless quay 10-14+ lan khi dang bi
            # login/captcha. Sau 3 vong rong thi fallback ngay.
            if (
                current_count == 0
                and (
                    index + 1
                ) >= EMPTY_SCAN_BEFORE_LOGIN
            ):
                if headless:
                    print(
                        "[DOUYIN] 3 vong khong co video "
                        "-> mo Chrome de dang nhap ngay."
                    )
                    break

                # Visible mode: giu Chrome mo de user login.
                print()
                print(
                    "[DOUYIN LOGIN] Chua bat duoc video sau "
                    f"{EMPTY_SCAN_BEFORE_LOGIN} lan."
                )
                print(
                    "[DOUYIN LOGIN] Dang cho dang nhap/captcha "
                    "toi da 90 giay..."
                )

                deadline = (
                    time.monotonic()
                    + (
                        VISIBLE_LOGIN_WAIT_MS
                        / 1000.0
                    )
                )

                login_poll = 0

                while (
                    len(order) == 0
                    and time.monotonic()
                    < deadline
                ):
                    page.wait_for_timeout(
                        1000
                    )

                    login_poll += 1

                    # Sau khi login, cu scroll nhe moi 5 giay
                    # de kich hoat lai aweme/post neu can.
                    if (
                        login_poll % 5
                        == 0
                    ):
                        try:
                            page.evaluate(
                                """
                                () => {
                                    window.scrollBy(
                                        0,
                                        Math.max(
                                            window.innerHeight * 1.2,
                                            900
                                        )
                                    );
                                }
                                """
                            )
                        except Exception:
                            pass

                if len(order) > 0:
                    print(
                        "[DOUYIN LOGIN] Da bat duoc video "
                        "sau khi dang nhap."
                    )

                    # Neu response dau tien da du limit thi dung.
                    if len(order) >= limit:
                        break

                    # Con thieu thi cho loop tiep tuc scroll.
                    previous_count = -1
                    stable_rounds = 0

                else:
                    print(
                        "[DOUYIN LOGIN] Het thoi gian cho "
                        "nhung van chua bat duoc video."
                    )
                    break

            if (
                current_count
                == previous_count
            ):
                stable_rounds += 1
            else:
                stable_rounds = 0

            previous_count = (
                current_count
            )

            # Khong dung som qua vi Douyin co lazy load cham.
            if (
                stable_rounds
                >= 6
                and current_count > 0
            ):
                break

            page.evaluate(
                """
                () => {
                    window.scrollBy(
                        0,
                        Math.max(
                            window.innerHeight * 1.8,
                            1400
                        )
                    );
                }
                """
            )

            page.wait_for_timeout(
                DEFAULT_SCROLL_WAIT_MS
            )

        result = [
            videos[
                video_id
            ]
            for video_id
            in order[:limit]
        ]

        if not result:

            body_text = ""

            try:
                body_text = (
                    page.locator(
                        "body"
                    )
                    .inner_text(
                        timeout=3000
                    )
                )

            except Exception:
                pass

            hint = (
                body_text[:300]
                .replace(
                    "\n",
                    " "
                )
            )

            raise DouyinUnavailable(
                "Khong bat duoc response "
                "/aweme/v1/web/aweme/post/. "
                "Co the Douyin yeu cau captcha/login "
                "hoac chan headless. "
                "Chay --login mot lan. "
                f"Page hint: {hint}"
            )

        return {
            "videos":
                result,

            "total":
                None,

            "has_more":
                bool(
                    state[
                        "has_more"
                    ]
                    or len(
                        order
                    ) > limit
                ),

            "profile_url":
                profile_url,

            "sec_uid":
                target_sec_uid,

            "method":
                "network_aweme_post",

            "captured_responses":
                state[
                    "captured_responses"
                ],
        }

    except DouyinUnavailable:
        raise

    except Exception as error:
        raise DouyinUnavailable(
            type(error).__name__
            + ": "
            + str(error)
        ) from error

    finally:
        try:
            if context is not None:
                context.close()
        except Exception:
            pass

        try:
            if playwright is not None:
                playwright.stop()
        except Exception:
            pass


# =========================================================
# DIRECT VIDEO METADATA
# =========================================================

def _find_aweme_by_id(
    value,
    video_id,
):
    """
    Tim recursively aweme object dung video_id
    trong JSON response cua Douyin.
    """

    if isinstance(
        value,
        dict
    ):
        current_id = (
            value.get(
                "aweme_id"
            )
            or value.get(
                "awemeId"
            )
            or ""
        )

        if str(
            current_id
        ).strip() == str(
            video_id
        ):
            return value

        for child in value.values():
            found = (
                _find_aweme_by_id(
                    child,
                    video_id,
                )
            )

            if found is not None:
                return found

    elif isinstance(
        value,
        list
    ):
        for child in value:
            found = (
                _find_aweme_by_id(
                    child,
                    video_id,
                )
            )

            if found is not None:
                return found

    return None


def _page_meta_content(
    page,
    selector,
):
    try:
        locator = (
            page.locator(
                selector
            )
            .first
        )

        if locator.count() <= 0:
            return ""

        return (
            locator.get_attribute(
                "content"
            )
            or ""
        ).strip()

    except Exception:
        return ""


def _clean_direct_title(
    value,
    video_id,
):
    value = (
        str(value or "")
        .strip()
    )

    if not value:
        return (
            f"Douyin {video_id}"
        )

    # Bo mot so suffix pho bien cua page title Douyin.
    value = re.sub(
        r"\s*[-_]\s*抖音.*$",
        "",
        value,
        flags=re.IGNORECASE,
    ).strip()

    return (
        value
        or f"Douyin {video_id}"
    )


def _browser_direct_video_item(
    video_url,
    video_id,
):
    """
    Lay title + thumbnail + stats cho link video truc tiep.

    Uu tien aweme JSON response.
    Neu response bi chan, fallback OpenGraph meta cua page.
    """

    playwright = None
    context = None

    state = {
        "item":
            None,
    }

    def handle_response(
        response
    ):
        if state[
            "item"
        ] is not None:
            return

        try:
            if response.status != 200:
                return

            response_url = (
                response.url
                .lower()
            )

            content_type = (
                response.headers
                .get(
                    "content-type",
                    "",
                )
                .lower()
            )

            # Khong parse media binary.
            looks_json = (
                "json"
                in content_type
                or "aweme"
                    in response_url
                or "detail"
                    in response_url
            )

            if not looks_json:
                return

            data = (
                response.json()
            )

            aweme = (
                _find_aweme_by_id(
                    data,
                    video_id,
                )
            )

            if aweme is None:
                return

            item = (
                _aweme_to_video(
                    aweme,
                    "",
                )
            )

            if item:
                state[
                    "item"
                ] = item

        except Exception:
            return

    try:
        (
            playwright,
            context,
        ) = _open_context(
            headless=True,
        )

        page = (
            context.pages[
                0
            ]
            if context.pages
            else context.new_page()
        )

        _install_headless_resource_filter(page)

        page.on(
            "response",
            handle_response,
        )

        try:
            page.goto(
                video_url,
                wait_until=
                    "domcontentloaded",
                timeout=
                    min(
                        DEFAULT_TIMEOUT_MS,
                        20000,
                    ),
            )
        except Exception:
            # Van thu doc meta/response da bat duoc.
            pass

        # Cho response detail/aweme ve, nhung khong de direct link
        # lam web cham qua lau.
        for _ in range(
            6
        ):
            if state[
                "item"
            ] is not None:
                break

            page.wait_for_timeout(
                500
            )

        item = (
            state[
                "item"
            ]
        )

        if item is not None:
            print(
                "[DOUYIN] Direct metadata via aweme JSON:",
                video_id,
            )
            return item

        # Fallback OpenGraph.
        cover_url = (
            _page_meta_content(
                page,
                'meta[property="og:image"]',
            )
            or _page_meta_content(
                page,
                'meta[name="twitter:image"]',
            )
            or _page_meta_content(
                page,
                'meta[property="twitter:image"]',
            )
        )

        title = (
            _page_meta_content(
                page,
                'meta[property="og:title"]',
            )
            or _page_meta_content(
                page,
                'meta[name="twitter:title"]',
            )
        )

        if not title:
            try:
                title = (
                    page.title()
                    or ""
                )
            except Exception:
                title = ""

        description = (
            _page_meta_content(
                page,
                'meta[property="og:description"]',
            )
            or _page_meta_content(
                page,
                'meta[name="description"]',
            )
        )

        # Neu title la chuoi chung chung thi dung description.
        if (
            not title
            or title.lower()
            in {
                "抖音",
                "douyin",
            }
        ):
            title = (
                description
                or title
            )

        item = {
            "platform":
                "douyin",

            "video_id":
                str(
                    video_id
                ),

            "url":
                video_url,

            "title":
                _clean_direct_title(
                    title,
                    video_id,
                ),

            "cover_url":
                str(
                    cover_url
                    or ""
                ).strip(),

            "published_at":
                None,

            "play_count":
                0,

            "like_count":
                0,

            "comment_count":
                0,

            "share_count":
                0,
        }

        if item[
            "cover_url"
        ]:
            print(
                "[DOUYIN] Direct thumbnail via OpenGraph:",
                video_id,
            )
        else:
            print(
                "[DOUYIN] Direct metadata khong co thumbnail:",
                video_id,
            )

        return item

    except Exception as error:
        print(
            "[DOUYIN] Direct metadata warning:",
            type(error).__name__,
            str(error),
        )

        return None

    finally:
        try:
            if context is not None:
                context.close()
        except Exception:
            pass

        try:
            if playwright is not None:
                playwright.stop()
        except Exception:
            pass


# =========================================================
# DIRECT VIDEO AS ONE-ITEM SOURCE
# =========================================================

def _direct_video_meta(
    value,
):
    """
    Neu input la link video Douyin truc tiep,
    tra ve metadata dang 1-item source de web hien card
    giong nhu khi dan link Bilibili video.

    Profile URL se return None va tiep tuc flow scan kenh.
    """

    raw = (
        str(value or "")
        .strip()
    )

    if not raw:
        return None

    # QUAN TRONG:
    # Link profile Douyin co the mang query modal_id/vid khi user
    # copy URL luc dang mo popup video tren trang kenh.
    #
    # Vi du:
    #   https://www.douyin.com/user/SEC_UID?modal_id=123...
    #
    # Day van la LINK KENH, khong duoc bien thanh direct video.
    try:
        parsed_input = (
            urllib.parse
            .urlsplit(
                raw
            )
        )

        input_path = (
            parsed_input.path
            or ""
        )

        if (
            DOUYIN_USER_RE.search(
                input_path
            )
            is not None
        ):
            return None

    except Exception:
        pass

    try:
        canonical = (
            normalize_video_url(
                raw
            )
        )
    except Exception:
        return None

    match = (
        DOUYIN_VIDEO_RE.search(
            canonical
        )
    )

    if not match:
        return None

    video_id = (
        match.group(1)
    )

    # Link video truc tiep truoc day chi tao placeholder,
    # nen UI hien "No image". Bay gio lay metadata that cua video.
    item = (
        _browser_direct_video_item(
            canonical,
            video_id,
        )
    )

    if item is None:
        item = {
            "platform":
                "douyin",

            "video_id":
                video_id,

            "url":
                canonical,

            "title":
                f"Douyin {video_id}",

            "cover_url":
                "",

            "published_at":
                None,

            "play_count":
                0,

            "like_count":
                0,

            "comment_count":
                0,

            "share_count":
                0,
        }

    return {
        "videos":
            [
                item
            ],

        "total":
            1,

        "has_more":
            False,

        "source_type":
            "video",

        "profile_url":
            None,
    }


# =========================================================
# PUBLIC API
# =========================================================

def fetch_latest_meta(
    profile_url,
    limit=10,
):
    limit = max(
        1,
        min(
            int(limit),
            250,
        ),
    )

    # Neu user dan LINK VIDEO truc tiep:
    # khong ep normalize thanh profile.
    # Web se nhan 1 card video de Download/Vietsub/Voice.
    direct = (
        _direct_video_meta(
            profile_url
        )
    )

    if direct is not None:
        print(
            "[DOUYIN] Direct video input:",
            direct[
                "videos"
            ][0][
                "video_id"
            ],
        )

        return direct

    canonical = (
        normalize_profile_url(
            profile_url
        )
    )

    # Thu headless truoc de web chay ngam.
    # Neu Douyin redirect/chan headless thi tu dong
    # fallback sang Chrome visible.
    try:
        return (
            _browser_profile_scan(
                canonical,
                limit,
                headless=True,
            )
        )

    except DouyinUnavailable as first_error:

        print(
            "\n[DOUYIN] Headless khong lay duoc profile."
        )

        print(
            "[DOUYIN] Tu dong fallback sang Chrome visible..."
        )

        try:
            return (
                _browser_profile_scan(
                    canonical,
                    limit,
                    headless=False,
                )
            )

        except Exception as second_error:

            raise DouyinUnavailable(
                "Headless loi: "
                + str(first_error)
                + " | Visible Chrome loi: "
                + str(second_error)
            ) from second_error


def fetch_latest(
    profile_url,
    limit=10,
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


def fetch_page_meta(
    profile_url,
    page=1,
    limit=10,
):
    page = max(
        1,
        int(page),
    )

    limit = max(
        1,
        min(
            int(limit),
            50,
        ),
    )

    target = (
        page
        * limit
    )

    meta = (
        fetch_latest_meta(
            profile_url,
            limit=target,
        )
    )

    if (
        meta.get(
            "source_type"
        )
        == "video"
    ):
        return {
            "videos":
                (
                    meta.get(
                        "videos",
                        [],
                    )
                    if page == 1
                    else []
                ),

            "total":
                1,

            "has_more":
                False,
        }

    videos = (
        meta.get(
            "videos",
            [],
        )
    )

    start = (
        (page - 1)
        * limit
    )

    page_items = (
        videos[
            start:
            start + limit
        ]
    )

    return {
        "videos":
            page_items,

        "total":
            meta.get(
                "total"
            ),

        "has_more":
            bool(
                meta.get(
                    "has_more",
                    len(
                        videos
                    ) >= target,
                )
            ),
    }




# =========================================================
# DIRECT VIDEO DOWNLOAD
# =========================================================

def normalize_video_url(
    url: str,
) -> str:

    value = (
        str(url)
        .strip()
    )

    match = (
        DOUYIN_VIDEO_RE.search(
            value
        )
    )

    if not match:
        # Ho tro link jingxuan/modal_id.
        parsed = (
            urllib.parse
            .urlsplit(
                value
            )
        )

        query = (
            urllib.parse
            .parse_qs(
                parsed.query
            )
        )

        candidates = (
            query.get(
                "modal_id",
                [],
            )
            + query.get(
                "vid",
                [],
            )
        )

        video_id = None

        for candidate in candidates:
            if re.fullmatch(
                r"\d{10,25}",
                str(candidate),
            ):
                video_id = str(
                    candidate
                )
                break

        if not video_id:
            raise ValueError(
                "Khong tim thay Douyin video ID."
            )

    else:
        video_id = (
            match.group(1)
        )

    return (
        "https://www.douyin.com/video/"
        + video_id
    )


def _cookie_header_for_url(
    context,
    url,
):
    try:
        cookies = (
            context.cookies(
                [url]
            )
        )

    except Exception:
        cookies = []

    parts = []

    for item in cookies:
        name = (
            item.get(
                "name"
            )
            or ""
        )

        value = (
            item.get(
                "value"
            )
            or ""
        )

        if name:
            parts.append(
                f"{name}={value}"
            )

    return "; ".join(
        parts
    )


def _media_candidates_from_page(
    page,
):
    candidates = []

    try:
        values = (
            page.locator(
                "video"
            )
            .evaluate_all(
                """
                (videos) => {
                    const out = [];

                    for (const video of videos) {
                        if (video.currentSrc) {
                            out.push(video.currentSrc);
                        }

                        if (video.src) {
                            out.push(video.src);
                        }

                        for (
                            const source
                            of video.querySelectorAll('source')
                        ) {
                            if (source.src) {
                                out.push(source.src);
                            }
                        }
                    }

                    return out;
                }
                """
            )
        )

    except Exception:
        values = []

    for value in values:
        value = (
            str(value or "")
            .strip()
        )

        if (
            value.startswith(
                "http://"
            )
            or value.startswith(
                "https://"
            )
        ):
            if value not in candidates:
                candidates.append(
                    value
                )

    return candidates


def _probe_local_streams(
    media_path,
):
    """
    Kiem tra file local co video/audio stream hay khong.
    Douyin co luc tra ve adaptive stream chi co video.
    """

    media_path = Path(
        media_path
    )

    if (
        not media_path.exists()
        or media_path.stat().st_size <= 0
    ):
        return {
            "video": False,
            "audio": False,
        }

    command = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type",
        "-of",
        "json",
        str(media_path),
    ]

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )

        if result.returncode != 0:
            return {
                "video": False,
                "audio": False,
            }

        data = json.loads(
            result.stdout
            or "{}"
        )

        types = {
            str(
                item.get(
                    "codec_type",
                    ""
                )
            ).lower()
            for item in (
                data.get(
                    "streams"
                )
                or []
            )
            if isinstance(
                item,
                dict
            )
        }

        return {
            "video":
                "video" in types,

            "audio":
                "audio" in types,
        }

    except Exception:
        return {
            "video": False,
            "audio": False,
        }


def _build_media_headers(
    *,
    user_agent,
    cookie_header,
    referer,
):
    headers = (
        "Referer: "
        + referer
        + "\r\n"
        + "User-Agent: "
        + user_agent
        + "\r\n"
    )

    if cookie_header:
        headers += (
            "Cookie: "
            + cookie_header
            + "\r\n"
        )

    return headers


def _ffmpeg_download_candidate(
    media_url,
    temp_path,
    *,
    user_agent,
    cookie_header,
    referer,
):
    """
    Tai 1 media candidate va giu stream no co.
    Candidate co the la muxed, video-only hoac audio-only.
    """

    temp_path = Path(
        temp_path
    )

    temp_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    try:
        if temp_path.exists():
            temp_path.unlink()
    except OSError:
        pass

    headers = (
        _build_media_headers(
            user_agent=
                user_agent,
            cookie_header=
                cookie_header,
            referer=
                referer,
        )
    )

    command = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "warning",
        "-headers",
        headers,
        "-i",
        media_url,
        "-map",
        "0:v?",
        "-map",
        "0:a?",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        str(
            temp_path
        ),
    ]

    result = subprocess.run(
        command,
        check=False,
    )

    if (
        result.returncode != 0
        or not temp_path.exists()
        or temp_path.stat().st_size
            < 8 * 1024
    ):
        try:
            if temp_path.exists():
                temp_path.unlink()
        except OSError:
            pass

        return {
            "path":
                temp_path,

            "video":
                False,

            "audio":
                False,
        }

    streams = (
        _probe_local_streams(
            temp_path
        )
    )

    print(
        "[DOUYIN STREAM]",
        "video=",
        streams[
            "video"
        ],
        "audio=",
        streams[
            "audio"
        ],
        "size=",
        f"{temp_path.stat().st_size / 1024 / 1024:.1f} MB",
    )

    return {
        "path":
            temp_path,

        "video":
            bool(
                streams[
                    "video"
                ]
            ),

        "audio":
            bool(
                streams[
                    "audio"
                ]
            ),
    }


def _mux_video_audio(
    video_path,
    audio_path,
    output_path,
):
    """
    Ghep adaptive video-only + audio-only cua Douyin.
    """

    video_path = Path(
        video_path
    )

    audio_path = Path(
        audio_path
    )

    output_path = Path(
        output_path
    )

    mux_path = (
        output_path
        .with_suffix(
            ".mux.mp4"
        )
    )

    try:
        if mux_path.exists():
            mux_path.unlink()
    except OSError:
        pass

    command = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "warning",
        "-i",
        str(
            video_path
        ),
        "-i",
        str(
            audio_path
        ),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c",
        "copy",
        "-shortest",
        "-movflags",
        "+faststart",
        str(
            mux_path
        ),
    ]

    result = subprocess.run(
        command,
        check=False,
    )

    if (
        result.returncode != 0
        or not mux_path.exists()
    ):
        try:
            if mux_path.exists():
                mux_path.unlink()
        except OSError:
            pass

        return False

    streams = (
        _probe_local_streams(
            mux_path
        )
    )

    if not (
        streams[
            "video"
        ]
        and streams[
            "audio"
        ]
    ):
        try:
            mux_path.unlink()
        except OSError:
            pass

        return False

    if output_path.exists():
        output_path.unlink()

    mux_path.replace(
        output_path
    )

    return True


def _cleanup_candidate_files(
    paths,
):
    for path in paths:
        if path is None:
            continue

        try:
            path = Path(
                path
            )

            if path.exists():
                path.unlink()

        except OSError:
            pass


def _ffmpeg_download_media(
    media_url,
    output_path,
    *,
    user_agent,
    cookie_header,
    referer,
):
    """
    Compatibility helper.
    Chi return True neu source co CA video VA audio.
    """

    output_path = Path(
        output_path
    )

    candidate_path = (
        output_path
        .with_suffix(
            ".candidate.mp4"
        )
    )

    info = (
        _ffmpeg_download_candidate(
            media_url,
            candidate_path,
            user_agent=
                user_agent,
            cookie_header=
                cookie_header,
            referer=
                referer,
        )
    )

    if (
        info[
            "video"
        ]
        and info[
            "audio"
        ]
    ):
        if output_path.exists():
            output_path.unlink()

        candidate_path.replace(
            output_path
        )

        return True

    _cleanup_candidate_files(
        [
            candidate_path
        ]
    )

    return False


def _download_video_browser_once(
    video_url,
    output_path,
    *,
    headless,
):
    """
    Mo trang video Douyin bang cung persistent browser session,
    lay media URL that tu <video> / network response,
    sau do de ffmpeg tai source.mp4.
    """

    playwright = None
    context = None

    network_candidates = []

    def remember_candidate(
        value
    ):
        value = (
            str(value or "")
            .strip()
        )

        if not (
            value.startswith(
                "http://"
            )
            or value.startswith(
                "https://"
            )
        ):
            return

        if value not in network_candidates:
            network_candidates.append(
                value
            )

    def handle_response(
        response
    ):
        try:
            if (
                response.status
                not in {
                    200,
                    206,
                }
            ):
                return

            url = (
                response.url
            )

            headers = (
                response.headers
                or {}
            )

            content_type = (
                headers.get(
                    "content-type",
                    ""
                )
                .lower()
            )

            low_url = (
                url.lower()
            )

            is_media = (
                "video/"
                in content_type
                or "audio/"
                    in content_type
                or "douyinvod"
                    in low_url
                or "bytevideo"
                    in low_url
                or "/video/tos/"
                    in low_url
                or "/audio/tos/"
                    in low_url
                or "v3-web"
                    in low_url
                or "v9-web"
                    in low_url
            )

            if is_media:
                remember_candidate(
                    url
                )

        except Exception:
            pass

    try:
        (
            playwright,
            context,
        ) = _open_context(
            headless=headless
        )

        page = (
            context.pages[0]
            if context.pages
            else context.new_page()
        )

        if headless:
            _install_headless_resource_filter(
                page,
                on_media=remember_candidate,
            )

        page.on(
            "response",
            handle_response,
        )

        print(
            "\nMo Douyin video..."
        )

        print(
            "Headless:",
            headless
        )

        page.goto(
            video_url,
            wait_until=
                "domcontentloaded",
            timeout=
                DEFAULT_TIMEOUT_MS,
        )

        page.wait_for_timeout(
            2500
        )

        # Mot so trang chi load media sau khi video vao viewport.
        try:
            video_locator = (
                page.locator(
                    "video"
                )
                .first
            )

            if (
                video_locator.count()
                > 0
            ):
                video_locator.scroll_into_view_if_needed(
                    timeout=3000
                )

                try:
                    video_locator.click(
                        timeout=1500,
                        force=True,
                    )
                except Exception:
                    pass

                page.wait_for_timeout(
                    1200
                )

        except Exception:
            pass

        candidates = (
            _media_candidates_from_page(
                page
            )
        )

        for item in network_candidates:
            if item not in candidates:
                candidates.append(
                    item
                )

        # Loai blob/data URL neu co.
        candidates = [
            item
            for item in candidates
            if (
                item.startswith(
                    "http://"
                )
                or item.startswith(
                    "https://"
                )
            )
        ]

        print(
            "Media candidates:",
            len(
                candidates
            )
        )

        if not candidates:
            raise DouyinUnavailable(
                "Khong tim thay media URL trong trang video."
            )

        try:
            user_agent = (
                page.evaluate(
                    "() => navigator.userAgent"
                )
            )

        except Exception:
            user_agent = (
                "Mozilla/5.0 "
                "(Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 "
                "(KHTML, like Gecko) "
                "Chrome/154.0.0.0 "
                "Safari/537.36"
            )

        candidate_files = []
        video_only_path = None
        audio_only_path = None

        try:
            for index, media_url in enumerate(
                candidates,
                start=1,
            ):
                print(
                    f"Thu media "
                    f"{index}/"
                    f"{len(candidates)}"
                )

                cookie_header = (
                    _cookie_header_for_url(
                        context,
                        media_url,
                    )
                )

                candidate_path = (
                    Path(
                        output_path
                    )
                    .with_name(
                        f".douyin_candidate_"
                        f"{index}.mp4"
                    )
                )

                candidate_files.append(
                    candidate_path
                )

                info = (
                    _ffmpeg_download_candidate(
                        media_url,
                        candidate_path,
                        user_agent=
                            user_agent,
                        cookie_header=
                            cookie_header,
                        referer=
                            video_url,
                    )
                )

                # Tot nhat: candidate da mux san video + audio.
                if (
                    info[
                        "video"
                    ]
                    and info[
                        "audio"
                    ]
                ):
                    output_path = Path(
                        output_path
                    )

                    if output_path.exists():
                        output_path.unlink()

                    candidate_path.replace(
                        output_path
                    )

                    print(
                        "[DOUYIN] Found muxed "
                        "video + audio."
                    )

                    return output_path

                # Adaptive stream: giu 1 video-only va 1 audio-only.
                if (
                    info[
                        "video"
                    ]
                    and not info[
                        "audio"
                    ]
                    and video_only_path
                        is None
                ):
                    video_only_path = (
                        candidate_path
                    )

                    print(
                        "[DOUYIN] Giu video-only "
                        "de cho audio stream."
                    )

                elif (
                    info[
                        "audio"
                    ]
                    and not info[
                        "video"
                    ]
                    and audio_only_path
                        is None
                ):
                    audio_only_path = (
                        candidate_path
                    )

                    print(
                        "[DOUYIN] Giu audio-only "
                        "de ghep voi video."
                    )

                if (
                    video_only_path
                    is not None
                    and audio_only_path
                        is not None
                ):
                    ok = (
                        _mux_video_audio(
                            video_only_path,
                            audio_only_path,
                            output_path,
                        )
                    )

                    if ok:
                        print(
                            "[DOUYIN] Da ghep "
                            "video + audio adaptive."
                        )

                        return Path(
                            output_path
                        )

            raise DouyinUnavailable(
                "Da tim thay media URL "
                "nhung khong tao duoc "
                "source co ca video va audio."
            )

        finally:
            _cleanup_candidate_files(
                candidate_files
            )

    finally:
        try:
            if context is not None:
                context.close()
        except Exception:
            pass

        try:
            if playwright is not None:
                playwright.stop()
        except Exception:
            pass


def download_video(
    video_url,
    output_path,
):
    """
    Downloader Douyin cho pipeline/web.

    yt-dlp Douyin hien co the loi o web detail API,
    nen dung browser session da co de lay media URL that.
    """

    canonical = (
        normalize_video_url(
            video_url
        )
    )

    output_path = Path(
        output_path
    )

    errors = []

    # Headless truoc cho automation.
    for headless in (
        True,
        False,
    ):
        try:
            return (
                _download_video_browser_once(
                    canonical,
                    output_path,
                    headless=
                        headless,
                )
            )

        except Exception as error:
            errors.append(
                (
                    "headless"
                    if headless
                    else "visible"
                )
                + ": "
                + str(error)
            )

            print(
                "[DOUYIN DOWNLOAD WARN]",
                errors[-1]
            )

    raise DouyinUnavailable(
        "Khong tai duoc video Douyin. "
        + " | ".join(
            errors
        )
    )


# =========================================================
# LOGIN / CAPTCHA
# =========================================================

def login(
    profile_url,
):
    canonical = (
        normalize_profile_url(
            profile_url
        )
    )

    playwright = None
    context = None

    try:
        (
            playwright,
            context,
        ) = _open_context(
            headless=False
        )

        page = (
            context.pages[0]
            if context.pages
            else context.new_page()
        )

        page.goto(
            canonical,
            wait_until=
                "domcontentloaded",
            timeout=
                DEFAULT_TIMEOUT_MS,
        )

        print()
        print(
            "Chrome da mo."
        )

        print(
            "Neu co captcha/login, "
            "xu ly trong cua so Chrome."
        )

        print(
            "Sau khi profile hien dung video, "
            "quay lai terminal va nhan Enter."
        )

        input()

    finally:
        try:
            if context is not None:
                context.close()
        except Exception:
            pass

        try:
            if playwright is not None:
                playwright.stop()
        except Exception:
            pass


# =========================================================
# CLI
# =========================================================

def main():
    parser = (
        argparse.ArgumentParser()
    )

    parser.add_argument(
        "url",
        nargs="?",
    )

    parser.add_argument(
        "--limit",
        type=int,
        default=10,
    )

    parser.add_argument(
        "--login",
        dest="login_url",
    )

    args = (
        parser.parse_args()
    )

    if args.login_url:

        login(
            args.login_url
        )

        return

    if not args.url:

        parser.print_help()

        return

    result = (
        fetch_latest_meta(
            args.url,
            limit=args.limit,
        )
    )

    print()
    print(
        "Method:",
        result.get(
            "method"
        )
    )

    print(
        "Captured API responses:",
        result.get(
            "captured_responses"
        )
    )

    print(
        "\nDouyin videos:"
    )

    for video in (
        result.get(
            "videos",
            [],
        )
    ):

        print(
            video[
                "video_id"
            ],
            "|",
            video[
                "title"
            ],
        )


if __name__ == "__main__":
    main()
