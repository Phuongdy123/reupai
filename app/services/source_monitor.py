import subprocess
import sys

from datetime import datetime
from pathlib import Path


# =========================================================
# PATH
# =========================================================

APP_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = APP_DIR.parent

if str(APP_DIR) not in sys.path:
    sys.path.insert(
        0,
        str(APP_DIR)
    )


# =========================================================
# DATABASE
# =========================================================

from services.source_db import (
    get_connection,
    list_sources,
    save_video,
    update_video_status,
)


# =========================================================
# BILIBILI
# =========================================================

from services.sources.bilibili import (
    fetch_latest as bilibili_fetch_latest,
    BilibiliRateLimited,
)

from services.sources.douyin import (
    fetch_latest as douyin_fetch_latest,
    DouyinUnavailable,
)


# =========================================================
# CONFIG
# =========================================================

DEFAULT_SCAN_LIMIT = 10


# =========================================================
# DB HELPERS
# =========================================================

def get_source_video_count(
    source_id
):
    """
    Dem tong video da luu cua source.
    Neu = 0 thi day la lan BASELINE dau tien.
    """

    conn = get_connection()

    try:

        row = conn.execute(
            """
            SELECT COUNT(*) AS total
            FROM source_videos
            WHERE source_id = ?
            """,
            (
                source_id,
            )
        ).fetchone()

        if not row:
            return 0

        return row["total"]

    finally:

        conn.close()


def video_exists(
    source_id,
    platform_video_id
):
    """
    Kiem tra video da co trong DB chua.

    Return:
        sqlite Row neu co
        None neu chua co
    """

    conn = get_connection()

    try:

        row = conn.execute(
            """
            SELECT
                id,
                status,
                job_id
            FROM source_videos
            WHERE source_id = ?
              AND platform_video_id = ?
            LIMIT 1
            """,
            (
                source_id,
                platform_video_id
            )
        ).fetchone()

        return row

    finally:

        conn.close()


def get_video_db_id(
    source_id,
    platform_video_id
):
    """
    Lay ID noi bo cua source_videos.
    """

    conn = get_connection()

    try:

        row = conn.execute(
            """
            SELECT id
            FROM source_videos
            WHERE source_id = ?
              AND platform_video_id = ?
            LIMIT 1
            """,
            (
                source_id,
                platform_video_id
            )
        ).fetchone()

        if not row:
            return None

        return row["id"]

    finally:

        conn.close()


def update_source_checked(
    source_id,
    last_video_id=None
):
    """
    Cap nhat lan scan gan nhat.
    """

    conn = get_connection()

    try:

        now = datetime.now().isoformat(
            timespec="seconds"
        )

        if last_video_id:

            conn.execute(
                """
                UPDATE sources
                SET
                    last_checked_at = ?,
                    last_video_id = ?
                WHERE id = ?
                """,
                (
                    now,
                    last_video_id,
                    source_id
                )
            )

        else:

            conn.execute(
                """
                UPDATE sources
                SET
                    last_checked_at = ?
                WHERE id = ?
                """,
                (
                    now,
                    source_id
                )
            )

        conn.commit()

    finally:

        conn.close()


# =========================================================
# SAVE VIDEO
# =========================================================

def save_source_video(
    source_id,
    video
):
    """
    Luu hoac update metadata cua video.
    """

    save_video(
        source_id=
            source_id,

        platform_video_id=
            video["video_id"],

        url=
            video["url"],

        title=
            video.get(
                "title",
                ""
            ),

        cover_url=
            video.get(
                "cover_url",
                ""
            ),

        published_at=
            video.get(
                "published_at"
            ),

        play_count=
            video.get(
                "play_count",
                0
            ),

        like_count=
            video.get(
                "like_count",
                0
            ),

        comment_count=
            video.get(
                "comment_count",
                0
            ),

        share_count=
            video.get(
                "share_count",
                0
            ),

        duration_seconds=
            video.get(
                "duration_seconds"
            ),

        video_width=
            video.get(
                "video_width"
            ),

        video_height=
            video.get(
                "video_height"
            ),
    )


# =========================================================
# PLATFORM ROUTER
# =========================================================

def fetch_source_videos(
    source,
    limit=DEFAULT_SCAN_LIMIT
):
    """
    Router cho tung platform.

    Bilibili -> bilibili adapter
    Douyin    -> se gan sau
    """

    platform = (
        source["platform"]
        .strip()
        .lower()
    )

    profile_url = (
        source["profile_url"]
    )

    # -----------------------------------------------------
    # BILIBILI
    # -----------------------------------------------------

    if platform == "bilibili":

        return bilibili_fetch_latest(
            profile_url,
            limit=limit
        )

    # -----------------------------------------------------
    # DOUYIN
    # -----------------------------------------------------

    if platform == "douyin":

        return douyin_fetch_latest(
            profile_url,
            limit=limit
        )

    raise ValueError(
        "Platform chua ho tro: "
        f"{platform}"
    )


# =========================================================
# AUTO PIPELINE
# =========================================================

def run_auto_pipeline(
    video,
    channel_key,
    db_video_id=None
):
    """
    Chay app/pipeline.py cho video NEW.

    Hien tai pipeline.py chua co --channel,
    nen chi truyen URL.

    Buoc sau se sua pipeline de output vao:
    app/channels/<channel>/jobs/<video_id>/
    """

    video_url = (
        video["url"]
    )

    video_id = (
        video["video_id"]
    )

    pipeline_file = (
        APP_DIR
        / "pipeline.py"
    )

    print(
        "\n=================================="
    )

    print(
        "AUTO PIPELINE"
    )

    print(
        "=================================="
    )

    print(
        "Video:",
        video_id
    )

    print(
        "Channel:",
        channel_key
    )

    print(
        "URL:",
        video_url
    )

    if not pipeline_file.exists():

        print(
            "[PIPELINE ERROR]"
        )

        print(
            "Khong tim thay:"
        )

        print(
            pipeline_file
        )

        return False

    # -----------------------------------------------------
    # STATUS -> PROCESSING
    # -----------------------------------------------------

    if db_video_id:

        try:

            update_video_status(
                db_video_id,
                "processing"
            )

        except Exception as error:

            print(
                "[WARN] Khong update duoc "
                "status processing:"
            )

            print(
                error
            )

    # -----------------------------------------------------
    # COMMAND
    # -----------------------------------------------------

    from services.engine_runtime import pipeline_command
    command = pipeline_command(
        video_url,
        "--channel",
        channel_key,
    )
    print(
        "\nCommand:"
    )

    print(
        " ".join(
            command
        )
    )

    print(
        "\nPipeline bat dau...\n"
    )

    # -----------------------------------------------------
    # RUN
    # -----------------------------------------------------

    try:

        result = subprocess.run(
            command,
            cwd=str(
                PROJECT_ROOT
            ),
            check=False
        )

    except KeyboardInterrupt:

        print(
            "\n[PIPELINE STOPPED]"
        )

        return False

    except Exception as error:

        print(
            "\n[PIPELINE ERROR]"
        )

        print(
            type(error).__name__
            + ": "
            + str(error)
        )

        return False

    # -----------------------------------------------------
    # RESULT
    # -----------------------------------------------------

    if result.returncode == 0:

        print(
            "\n=================================="
        )

        print(
            "[PIPELINE OK]"
        )

        print(
            video_id
        )

        print(
            "=================================="
        )

        return True

    print(
        "\n=================================="
    )

    print(
        "[PIPELINE FAILED]"
    )

    print(
        "Video:",
        video_id
    )

    print(
        "Exit code:",
        result.returncode
    )

    print(
        "=================================="
    )

    return False


# =========================================================
# SCAN ONE SOURCE
# =========================================================

def scan_source(
    source,
    limit=DEFAULT_SCAN_LIMIT
):
    """
    Scan mot source.

    Lan dau:
        tat ca video hien tai -> seen

    Lan sau:
        video da ton tai -> OLD
        video chua co    -> NEW

    NEW + auto_process:
        -> pipeline.py
    """

    source_id = (
        source["id"]
    )

    platform = (
        source["platform"]
    )

    name = (
        source["name"]
    )

    channel_key = (
        source["channel_key"]
    )

    auto_process = bool(
        source["auto_process"]
    )

    print(
        "\n=================================="
    )

    print(
        f"SOURCE #{source_id}"
    )

    print(
        "=================================="
    )

    print(
        "Name:",
        name
    )

    print(
        "Platform:",
        platform
    )

    print(
        "Channel:",
        channel_key
    )

    print(
        "Auto:",
        auto_process
    )

    # =====================================================
    # BASELINE CHECK
    # =====================================================

    current_count = (
        get_source_video_count(
            source_id
        )
    )

    is_baseline = (
        current_count == 0
    )

    if is_baseline:

        print(
            "\nMode: BASELINE"
        )

    else:

        print(
            "\nMode: MONITOR"
        )

        print(
            "Videos trong DB:",
            current_count
        )

    # =====================================================
    # FETCH
    # =====================================================

    try:

        videos = fetch_source_videos(
            source,
            limit=limit
        )

    # -----------------------------------------------------
    # BILIBILI RATE LIMIT
    # -----------------------------------------------------

    except BilibiliRateLimited:

        print(
            "\n[RATE-LIMITED]"
        )

        print(
            "Bilibili dang chan tam thoi."
        )

        print(
            "Bo qua source nay."
        )

        print(
            "Khong retry ngay."
        )

        update_source_checked(
            source_id
        )

        return {
            "source_id":
                source_id,

            "status":
                "rate_limited",

            "new":
                0,

            "old":
                0,

            "baseline":
                0,

            "processed":
                0,

            "failed":
                0
        }

    # -----------------------------------------------------
    # DOUYIN TEMPORARY ERROR
    # -----------------------------------------------------

    except DouyinUnavailable as error:

        print(
            "\n[DOUYIN ERROR]"
        )

        print(
            error
        )

        update_source_checked(
            source_id
        )

        return {
            "source_id":
                source_id,

            "status":
                "douyin_error",

            "new":
                0,

            "old":
                0,

            "baseline":
                0,

            "processed":
                0,

            "failed":
                0
        }

    # -----------------------------------------------------
    # PLATFORM CHUA HO TRO
    # -----------------------------------------------------

    except NotImplementedError as error:

        print(
            "\n[SKIP]"
        )

        print(
            error
        )

        return {
            "source_id":
                source_id,

            "status":
                "unsupported",

            "new":
                0,

            "old":
                0,

            "baseline":
                0,

            "processed":
                0,

            "failed":
                0
        }

    # -----------------------------------------------------
    # OTHER ERROR
    # -----------------------------------------------------

    except Exception as error:

        print(
            "\n[SOURCE ERROR]"
        )

        print(
            type(error).__name__
            + ": "
            + str(error)
        )

        return {
            "source_id":
                source_id,

            "status":
                "error",

            "new":
                0,

            "old":
                0,

            "baseline":
                0,

            "processed":
                0,

            "failed":
                0
        }

    # =====================================================
    # EMPTY
    # =====================================================

    if not videos:

        print(
            "\nKhong co video."
        )

        update_source_checked(
            source_id
        )

        return {
            "source_id":
                source_id,

            "status":
                "empty",

            "new":
                0,

            "old":
                0,

            "baseline":
                0,

            "processed":
                0,

            "failed":
                0
        }

    # =====================================================
    # COUNTERS
    # =====================================================

    baseline_count = 0
    new_count = 0
    old_count = 0

    processed_count = 0
    failed_count = 0

    # =====================================================
    # LOOP
    # =====================================================

    for video in videos:

        video_id = (
            video["video_id"]
        )

        existed = video_exists(
            source_id,
            video_id
        )

        # -------------------------------------------------
        # SAVE / UPDATE METRICS
        # -------------------------------------------------

        save_source_video(
            source_id,
            video
        )

        db_video_id = (
            get_video_db_id(
                source_id,
                video_id
            )
        )

        # =================================================
        # BASELINE
        # =================================================

        if is_baseline:

            baseline_count += 1

            if db_video_id:

                update_video_status(
                    db_video_id,
                    "seen"
                )

            print(
                f"[BASELINE] "
                f"{video_id} | "
                f"{video['title']}"
            )

            continue

        # =================================================
        # OLD
        # =================================================

        if existed:

            old_count += 1

            print(
                f"[OLD] "
                f"{video_id} | "
                f"{video['title']}"
            )

            continue

        # =================================================
        # NEW
        # =================================================

        new_count += 1

        if db_video_id:

            update_video_status(
                db_video_id,
                "new"
            )

        print(
            "\n=================================="
        )

        print(
            "[NEW VIDEO]"
        )

        print(
            "=================================="
        )

        print(
            "ID:",
            video_id
        )

        print(
            "Title:",
            video[
                "title"
            ]
        )

        print(
            "URL:",
            video[
                "url"
            ]
        )

        print(
            "Views:",
            video.get(
                "play_count",
                0
            )
        )

        # =================================================
        # AUTO PROCESS
        # =================================================

        if auto_process:

            print(
                "\n[AUTO] "
                "Dua video vao pipeline."
            )

            pipeline_ok = (
                run_auto_pipeline(
                    video=
                        video,

                    channel_key=
                        channel_key,

                    db_video_id=
                        db_video_id
                )
            )

            # ---------------------------------------------
            # SUCCESS
            # ---------------------------------------------

            if pipeline_ok:

                processed_count += 1

                if db_video_id:

                    update_video_status(
                        db_video_id,
                        "processed",
                        job_id=video_id
                    )

            # ---------------------------------------------
            # FAILED
            # ---------------------------------------------

            else:

                failed_count += 1

                if db_video_id:

                    update_video_status(
                        db_video_id,
                        "failed",
                        job_id=video_id
                    )

        else:

            print(
                "[WAIT] "
                "Auto process dang OFF."
            )

    # =====================================================
    # UPDATE SOURCE
    # =====================================================

    latest_video_id = None

    if videos:

        latest_video_id = (
            videos[0][
                "video_id"
            ]
        )

    update_source_checked(
        source_id,
        latest_video_id
    )

    # =====================================================
    # SUMMARY
    # =====================================================

    print(
        "\n----------------------------------"
    )

    print(
        "Scan complete"
    )

    print(
        "Fetched:",
        len(videos)
    )

    print(
        "Baseline:",
        baseline_count
    )

    print(
        "Old:",
        old_count
    )

    print(
        "New:",
        new_count
    )

    print(
        "Processed:",
        processed_count
    )

    print(
        "Failed:",
        failed_count
    )

    return {
        "source_id":
            source_id,

        "status":
            "ok",

        "new":
            new_count,

        "old":
            old_count,

        "baseline":
            baseline_count,

        "processed":
            processed_count,

        "failed":
            failed_count
    }


# =========================================================
# SCAN ALL SOURCES
# =========================================================

def scan_all_sources(
    limit=DEFAULT_SCAN_LIMIT
):
    """
    Scan tat ca source enabled.

    Neu 1 source loi/rate-limit,
    cac source khac van tiep tuc.
    """

    sources = list_sources()

    enabled_sources = [
        source
        for source in sources
        if bool(
            source["enabled"]
        )
    ]

    print(
        "\n=================================="
    )

    print(
        "SOURCE MONITOR"
    )

    print(
        "=================================="
    )

    print(
        "Enabled sources:",
        len(
            enabled_sources
        )
    )

    results = []

    # =====================================================
    # LOOP SOURCES
    # =====================================================

    for source in enabled_sources:

        try:

            result = scan_source(
                source,
                limit=limit
            )

            results.append(
                result
            )

        except KeyboardInterrupt:

            print(
                "\nMonitor da dung."
            )

            raise

        except Exception as error:

            print(
                "\n[MONITOR ERROR]"
            )

            print(
                "Source:",
                source[
                    "id"
                ]
            )

            print(
                type(error).__name__
                + ": "
                + str(error)
            )

            results.append({
                "source_id":
                    source["id"],

                "status":
                    "error",

                "new":
                    0,

                "old":
                    0,

                "baseline":
                    0,

                "processed":
                    0,

                "failed":
                    0
            })

    # =====================================================
    # TOTALS
    # =====================================================

    total_baseline = sum(
        item.get(
            "baseline",
            0
        )
        for item in results
    )

    total_old = sum(
        item.get(
            "old",
            0
        )
        for item in results
    )

    total_new = sum(
        item.get(
            "new",
            0
        )
        for item in results
    )

    total_processed = sum(
        item.get(
            "processed",
            0
        )
        for item in results
    )

    total_failed = sum(
        item.get(
            "failed",
            0
        )
        for item in results
    )

    # =====================================================
    # SUMMARY
    # =====================================================

    print(
        "\n=================================="
    )

    print(
        "MONITOR COMPLETE"
    )

    print(
        "=================================="
    )

    print(
        "Sources:",
        len(results)
    )

    print(
        "Baseline:",
        total_baseline
    )

    print(
        "Old:",
        total_old
    )

    print(
        "New:",
        total_new
    )

    print(
        "Processed:",
        total_processed
    )

    print(
        "Failed:",
        total_failed
    )

    return results


# =========================================================
# MAIN
# =========================================================

if __name__ == "__main__":

    try:

        scan_all_sources(
            limit=10
        )

    except KeyboardInterrupt:

        print(
            "\nDung Source Monitor."
        )
