import os
os.environ["PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT"] = "0"
os.environ["FLAGS_use_mkldnn"] = "0"

import argparse
import json
import math
import re
import time
from pathlib import Path

import cv2
import numpy as np


VIDEO_PATH = "app/downloads/horizontal_test.mp4"
OUTPUT_JSON = "app/output/subtitle_region.json"
OUTPUT_PREVIEW = "app/output/subtitle_region_preview.jpg"

# =========================================================
# CONFIG
# =========================================================

# FAST PASS:
# Chạy ít frame + ảnh nhỏ trước. Nếu đủ tin cậy thì dừng luôn.
FAST_POSITIVE_SAMPLE_COUNT = 6
FAST_NEGATIVE_SAMPLE_COUNT = 3
FAST_UNIFORM_SAMPLE_COUNT = 8
FAST_OCR_MAX_WIDTH = 720

# FULL PASS:
# Chỉ chạy thêm khi fast pass chưa chắc chắn.
FULL_POSITIVE_SAMPLE_COUNT = 10
FULL_NEGATIVE_SAMPLE_COUNT = 6
FULL_UNIFORM_SAMPLE_COUNT = 14
FULL_OCR_MAX_WIDTH = 960

# Fast-pass acceptance.
FAST_MIN_SCORE = 0.60
FAST_MIN_POSITIVE_HITS = 3
FAST_MIN_TEMPORAL_COVERAGE = 0.50
FAST_MIN_SPEECH_LIFT = 0.30
FAST_MIN_MARGIN = 0.06

# OCR detector.
OCR_MIN_SCORE = 0.52

# Ưu tiên mobile detector để giảm CPU/RAM.
OCR_MOBILE_MODEL = "PP-OCRv5_mobile_det"

# Box OCR thô.
MIN_BOX_WIDTH_RATIO = 0.025
MIN_BOX_HEIGHT_RATIO = 0.010
MAX_BOX_HEIGHT_RATIO = 0.14

# Line merge.
LINE_Y_TOLERANCE_RATIO = 0.024
LINE_GAP_RATIO = 0.035

# Cluster subtitle theo trục Y.
CLUSTER_Y_TOLERANCE_RATIO = 0.035

# Điều kiện tối thiểu để tin đây là subtitle.
# A subtitle can legitimately be visible for only a short interval. Requiring
# three OCR hits from ten SRT-guided samples rejected otherwise valid videos.
# Keep the stricter score and temporal coverage checks below as the main guard.
try:
    MIN_POSITIVE_HITS = int(
        os.getenv("REUP_SUBTITLE_MIN_POSITIVE_HITS", "2")
    )
except ValueError:
    MIN_POSITIVE_HITS = 2

MIN_POSITIVE_HITS = max(
    1,
    min(MIN_POSITIVE_HITS, 5),
)
MIN_TEMPORAL_COVERAGE = 0.22
MIN_FINAL_CONFIDENCE = 0.48

# Blur.
BLUR_MIN_WIDTH_RATIO = 0.72
BLUR_MAX_WIDTH_RATIO = 0.92
BLUR_MIN_HEIGHT_RATIO = 0.075
BLUR_MAX_HEIGHT_RATIO = 0.18
BLUR_PAD_X_RATIO = 0.035
BLUR_PAD_Y_RATIO = 0.026

# Lazy PaddleOCR.
_DETECTOR = None


class SubtitleRegionNotFound(RuntimeError):
    """OCR ran successfully but did not identify a reliable subtitle region."""

    def __init__(self, message, reason):
        super().__init__(message)
        self.reason = reason


# =========================================================
# BASIC HELPERS
# =========================================================

def get_detector():

    global _DETECTOR

    if _DETECTOR is not None:
        return _DETECTOR

    print(
        "Dang load PaddleOCR TextDetection "
        "(mobile fast)..."
    )

    from paddleocr import TextDetection

    load_start = time.perf_counter()

    try:
        _DETECTOR = TextDetection(
            model_name=OCR_MOBILE_MODEL,
            engine="paddle",
            device="cpu",
            enable_mkldnn=False,
            cpu_threads=min(
                8,
                os.cpu_count() or 4,
            ),
        )

        model_name = OCR_MOBILE_MODEL

    except Exception as error:

        print(
            "[WARN] Khong load duoc mobile model:"
        )
        print(error)
        print(
            "Fallback PaddleOCR detector mac dinh..."
        )

        _DETECTOR = TextDetection(
            engine="paddle",
            device="cpu",
            enable_mkldnn=False,
            cpu_threads=min(
                8,
                os.cpu_count() or 4,
            ),
        )

        model_name = "default"

    elapsed = (
        time.perf_counter()
        - load_start
    )

    print(
        f"PaddleOCR ready: "
        f"{model_name} "
        f"({elapsed:.2f}s)"
    )

    return _DETECTOR


def get_video_info(
    video_path,
):

    cap = cv2.VideoCapture(
        str(video_path)
    )

    if not cap.isOpened():
        raise RuntimeError(
            f"Khong mo duoc video: {video_path}"
        )

    width = int(
        cap.get(
            cv2.CAP_PROP_FRAME_WIDTH
        )
    )

    height = int(
        cap.get(
            cv2.CAP_PROP_FRAME_HEIGHT
        )
    )

    fps = float(
        cap.get(
            cv2.CAP_PROP_FPS
        )
        or 0
    )

    frame_count = int(
        cap.get(
            cv2.CAP_PROP_FRAME_COUNT
        )
        or 0
    )

    duration = (
        frame_count / fps
        if fps > 0
        else 0.0
    )

    cap.release()

    return (
        width,
        height,
        duration,
    )


def read_frame_at(
    cap,
    time_sec,
):

    cap.set(
        cv2.CAP_PROP_POS_MSEC,
        max(
            0.0,
            float(
                time_sec
            )
        ) * 1000.0,
    )

    ok, frame = cap.read()

    if not ok:
        return None

    return frame


def parse_result(
    result,
):

    try:
        data = result.json
    except Exception:
        return [], []

    if callable(data):
        try:
            data = data()
        except Exception:
            return [], []

    if not isinstance(
        data,
        dict,
    ):
        return [], []

    if "res" in data:
        data = data["res"]

    polys = (
        data.get(
            "dt_polys",
            [],
        )
        or []
    )

    scores = (
        data.get(
            "dt_scores",
            [],
        )
        or []
    )

    return (
        polys,
        scores,
    )


# =========================================================
# SRT GUIDED SAMPLING
# =========================================================

_TIME_RE = re.compile(
    r"(\d+):(\d+):(\d+)[,.](\d+)"
)


def time_to_seconds(
    text,
):

    match = _TIME_RE.search(
        str(
            text
        )
    )

    if not match:
        return None

    hh, mm, ss, ms = (
        match.groups()
    )

    ms_value = int(
        str(
            ms
        )
        .ljust(
            3,
            "0",
        )[:3]
    )

    return (
        int(
            hh
        ) * 3600
        + int(
            mm
        ) * 60
        + int(
            ss
        )
        + ms_value / 1000.0
    )


def parse_srt_intervals(
    srt_path,
):

    path = Path(
        srt_path
    )

    if not path.exists():
        return []

    text = path.read_text(
        encoding="utf-8",
        errors="ignore",
    )

    blocks = re.split(
        r"\r?\n\s*\r?\n",
        text.strip(),
    )

    intervals = []

    for block in blocks:

        lines = [
            line.strip()
            for line in block.splitlines()
            if line.strip()
        ]

        if not lines:
            continue

        time_line = next(
            (
                line
                for line in lines
                if "-->" in line
            ),
            None,
        )

        if not time_line:
            continue

        left, right = (
            time_line.split(
                "-->",
                1,
            )
        )

        start = time_to_seconds(
            left
        )

        end = time_to_seconds(
            right
        )

        if (
            start is None
            or end is None
            or end <= start
        ):
            continue

        intervals.append(
            (
                float(
                    start
                ),
                float(
                    end
                ),
            )
        )

    return intervals


def spread_pick(
    items,
    count,
):

    items = list(
        items
    )

    if (
        len(
            items
        )
        <= count
    ):
        return items

    indexes = np.linspace(
        0,
        len(
            items
        ) - 1,
        count,
    )

    output = []

    used = set()

    for value in indexes:

        index = int(
            round(
                float(
                    value
                )
            )
        )

        if index in used:
            continue

        used.add(
            index
        )

        output.append(
            items[
                index
            ]
        )

    return output


def build_srt_samples(
    intervals,
    duration,
    positive_count,
    negative_count,
):

    usable = []

    for start, end in intervals:

        if (
            end - start
            < 0.22
        ):
            continue

        midpoint = (
            start
            + (
                end - start
            ) * 0.52
        )

        if (
            midpoint <= 0.05
            or midpoint
            >= max(
                0.05,
                duration - 0.05,
            )
        ):
            continue

        usable.append(
            (
                midpoint,
                start,
                end,
            )
        )

    positives = [
        item[
            0
        ]
        for item in spread_pick(
            usable,
            positive_count,
        )
    ]

    negatives = []

    sorted_intervals = sorted(
        intervals,
        key=lambda item:
            item[
                0
            ],
    )

    previous_end = 0.0

    for start, end in sorted_intervals:

        gap_start = (
            previous_end
        )

        gap_end = (
            start
        )

        gap = (
            gap_end
            - gap_start
        )

        if gap >= 0.65:

            negatives.append(
                gap_start
                + gap * 0.5
            )

        previous_end = max(
            previous_end,
            end,
        )

    tail_gap = (
        duration
        - previous_end
    )

    if tail_gap >= 0.65:

        negatives.append(
            previous_end
            + tail_gap * 0.5
        )

    negatives = spread_pick(
        negatives,
        negative_count,
    )

    return (
        positives,
        negatives,
    )


def guess_chinese_srt(
    video_path,
):

    video = Path(
        video_path
    )

    candidates = [
        video.parent
        / "chinese.srt",

        video.with_name(
            "chinese.srt"
        ),
    ]

    for candidate in candidates:

        if candidate.exists():
            return candidate

    return None


# =========================================================
# OCR BOX -> LINE
# =========================================================

def resize_for_ocr(
    frame,
    max_width,
):

    height, width = (
        frame.shape[:2]
    )

    if width <= max_width:

        return (
            frame,
            1.0,
        )

    scale = (
        max_width
        / float(
            width
        )
    )

    resized = cv2.resize(
        frame,
        (
            int(
                round(
                    width
                    * scale
                )
            ),
            int(
                round(
                    height
                    * scale
                )
            ),
        ),
        interpolation=
            cv2.INTER_AREA,
    )

    return (
        resized,
        scale,
    )


def detect_raw_boxes(
    frame,
    ocr_max_width,
):

    full_h, full_w = (
        frame.shape[:2]
    )

    resized, scale = (
        resize_for_ocr(
            frame,
            ocr_max_width,
        )
    )

    detector = get_detector()

    results = detector.predict(
        resized
    )

    boxes = []

    for result in results:

        polys, scores = (
            parse_result(
                result
            )
        )

        for index, poly in enumerate(
            polys
        ):

            score = (
                float(
                    scores[
                        index
                    ]
                )
                if index
                < len(
                    scores
                )
                else 1.0
            )

            if (
                score
                < OCR_MIN_SCORE
            ):
                continue

            points = np.array(
                poly,
                dtype=np.float32,
            ).reshape(
                -1,
                2,
            )

            x1 = float(
                np.min(
                    points[
                        :,
                        0,
                    ]
                )
            ) / scale

            y1 = float(
                np.min(
                    points[
                        :,
                        1,
                    ]
                )
            ) / scale

            x2 = float(
                np.max(
                    points[
                        :,
                        0,
                    ]
                )
            ) / scale

            y2 = float(
                np.max(
                    points[
                        :,
                        1,
                    ]
                )
            ) / scale

            box_w = (
                x2 - x1
            )

            box_h = (
                y2 - y1
            )

            if (
                box_w
                < full_w
                * MIN_BOX_WIDTH_RATIO
            ):
                continue

            if (
                box_h
                < full_h
                * MIN_BOX_HEIGHT_RATIO
            ):
                continue

            if (
                box_h
                > full_h
                * MAX_BOX_HEIGHT_RATIO
            ):
                continue

            center_x = (
                x1 + x2
            ) / 2.0

            center_y = (
                y1 + y2
            ) / 2.0

            boxes.append(
                {
                    "x1":
                        x1,

                    "y1":
                        y1,

                    "x2":
                        x2,

                    "y2":
                        y2,

                    "width":
                        box_w,

                    "height":
                        box_h,

                    "center_x":
                        center_x,

                    "center_y":
                        center_y,

                    "score":
                        score,
                }
            )

    return boxes


def same_line(
    left,
    right,
    frame_height,
    frame_width,
):

    y_tolerance = max(
        6.0,
        frame_height
        * LINE_Y_TOLERANCE_RATIO,
    )

    if (
        abs(
            left[
                "center_y"
            ]
            - right[
                "center_y"
            ]
        )
        > y_tolerance
    ):
        return False

    gap = max(
        0.0,
        right[
            "x1"
        ]
        - left[
            "x2"
        ],
    )

    max_gap = max(
        frame_width
        * LINE_GAP_RATIO,
        max(
            left[
                "height"
            ],
            right[
                "height"
            ],
        )
        * 2.5,
    )

    return (
        gap
        <= max_gap
    )


def merge_boxes_to_lines(
    boxes,
    frame_width,
    frame_height,
):

    if not boxes:
        return []

    ordered = sorted(
        boxes,
        key=lambda item:
            (
                item[
                    "center_y"
                ],
                item[
                    "x1"
                ],
            ),
    )

    groups = []

    for box in ordered:

        placed = False

        for group in groups:

            probe = sorted(
                group,
                key=lambda item:
                    item[
                        "x1"
                    ],
            )[-1]

            if same_line(
                probe,
                box,
                frame_height,
                frame_width,
            ):

                group.append(
                    box
                )

                placed = True
                break

        if not placed:

            groups.append(
                [
                    box
                ]
            )

    lines = []

    for group in groups:

        x1 = min(
            item[
                "x1"
            ]
            for item in group
        )

        y1 = min(
            item[
                "y1"
            ]
            for item in group
        )

        x2 = max(
            item[
                "x2"
            ]
            for item in group
        )

        y2 = max(
            item[
                "y2"
            ]
            for item in group
        )

        width = (
            x2 - x1
        )

        height = (
            y2 - y1
        )

        center_x = (
            x1 + x2
        ) / 2.0

        center_y = (
            y1 + y2
        ) / 2.0

        score = float(
            np.mean(
                [
                    item[
                        "score"
                    ]
                    for item in group
                ]
            )
        )

        # Loại line rất lệch sang mép.
        if not (
            frame_width
            * 0.05
            <= center_x
            <= frame_width
            * 0.95
        ):
            continue

        # Subtitle thường là text ngang.
        if (
            width
            < max(
                frame_width
                * 0.055,
                height
                * 1.4,
            )
        ):
            continue

        lines.append(
            {
                "x1":
                    x1,

                "y1":
                    y1,

                "x2":
                    x2,

                "y2":
                    y2,

                "width":
                    width,

                "height":
                    height,

                "center_x":
                    center_x,

                "center_y":
                    center_y,

                "score":
                    score,

                "box_count":
                    len(
                        group
                    ),
            }
        )

    return lines


# =========================================================
# TEMPORAL CLUSTERING
# =========================================================

def cluster_lines_by_y(
    observations,
    frame_height,
):

    if not observations:
        return []

    tolerance = max(
        12.0,
        frame_height
        * CLUSTER_Y_TOLERANCE_RATIO,
    )

    ordered = sorted(
        observations,
        key=lambda item:
            item[
                "center_y"
            ],
    )

    clusters = []

    for item in ordered:

        best_cluster = None
        best_distance = None

        for cluster in clusters:

            center = float(
                np.median(
                    [
                        member[
                            "center_y"
                        ]
                        for member in cluster
                    ]
                )
            )

            distance = abs(
                item[
                    "center_y"
                ]
                - center
            )

            if (
                distance <= tolerance
                and (
                    best_distance is None
                    or distance
                    < best_distance
                )
            ):

                best_cluster = cluster
                best_distance = distance

        if best_cluster is None:

            clusters.append(
                [
                    item
                ]
            )

        else:

            best_cluster.append(
                item
            )

    return clusters


def clamp01(
    value,
):

    return max(
        0.0,
        min(
            1.0,
            float(
                value
            ),
        ),
    )


def score_cluster(
    cluster,
    positive_frame_count,
    negative_frame_count,
    frame_width,
    frame_height,
    duration,
):

    positive_items = [
        item
        for item in cluster
        if item[
            "sample_type"
        ]
        == "positive"
    ]

    negative_items = [
        item
        for item in cluster
        if item[
            "sample_type"
        ]
        == "negative"
    ]

    positive_frames = {
        item[
            "sample_index"
        ]
        for item in positive_items
    }

    negative_frames = {
        item[
            "sample_index"
        ]
        for item in negative_items
    }

    pos_hits = len(
        positive_frames
    )

    neg_hits = len(
        negative_frames
    )

    pos_rate = (
        pos_hits
        / max(
            1,
            positive_frame_count,
        )
    )

    neg_rate = (
        neg_hits
        / max(
            1,
            negative_frame_count,
        )
        if negative_frame_count > 0
        else 0.0
    )

    centers_y = np.array(
        [
            item[
                "center_y"
            ]
            for item in positive_items
        ]
        or [
            item[
                "center_y"
            ]
            for item in cluster
        ],
        dtype=np.float32,
    )

    widths = np.array(
        [
            item[
                "width"
            ]
            for item in positive_items
        ]
        or [
            item[
                "width"
            ]
            for item in cluster
        ],
        dtype=np.float32,
    )

    centers_x = np.array(
        [
            item[
                "center_x"
            ]
            for item in positive_items
        ]
        or [
            item[
                "center_x"
            ]
            for item in cluster
        ],
        dtype=np.float32,
    )

    scores = np.array(
        [
            item[
                "score"
            ]
            for item in positive_items
        ]
        or [
            item[
                "score"
            ]
            for item in cluster
        ],
        dtype=np.float32,
    )

    times = sorted(
        {
            round(
                float(
                    item[
                        "time"
                    ]
                ),
                3,
            )
            for item in positive_items
        }
    )

    # Temporal coverage: subtitle thật phải xuất hiện
    # ở nhiều đoạn khác nhau của video, không chỉ 1 cảnh.
    if (
        times
        and duration > 0
    ):

        buckets = set()

        for time_sec in times:

            ratio = clamp01(
                time_sec
                / duration
            )

            bucket = min(
                3,
                int(
                    ratio
                    * 4
                ),
            )

            buckets.add(
                bucket
            )

        temporal_coverage = (
            len(
                buckets
            )
            / 4.0
        )

    else:

        temporal_coverage = 0.0

    median_y = float(
        np.median(
            centers_y
        )
    )

    y_std_ratio = float(
        np.std(
            centers_y
        )
        / max(
            1.0,
            frame_height,
        )
    )

    y_stability = (
        1.0
        - clamp01(
            y_std_ratio
            / 0.04
        )
    )

    median_width_ratio = float(
        np.median(
            widths
        )
        / max(
            1.0,
            frame_width,
        )
    )

    width_score = clamp01(
        median_width_ratio
        / 0.42
    )

    median_center_x_ratio = float(
        np.median(
            centers_x
        )
        / max(
            1.0,
            frame_width,
        )
    )

    horizontal_center_score = (
        1.0
        - clamp01(
            abs(
                median_center_x_ratio
                - 0.5
            )
            / 0.45
        )
    )

    ocr_score = clamp01(
        float(
            np.mean(
                scores
            )
        )
    )

    # Điểm quan trọng:
    # không hề hard-code "sub phải nằm dưới".
    # Chúng ta chọn theo temporal correlation với lời thoại.
    speech_lift = clamp01(
        pos_rate
        - neg_rate
        * 0.85
        + 0.15
    )

    final_score = (
        pos_rate
        * 0.34
        + speech_lift
        * 0.24
        + temporal_coverage
        * 0.14
        + y_stability
        * 0.10
        + width_score
        * 0.08
        + horizontal_center_score
        * 0.04
        + ocr_score
        * 0.06
    )

    # Chữ UI/logo cố định thường xuất hiện
    # cả lúc có và không có lời thoại.
    if (
        negative_frame_count > 0
        and neg_rate >= 0.67
    ):

        final_score *= 0.58

    return {
        "score":
            float(
                final_score
            ),

        "pos_hits":
            pos_hits,

        "neg_hits":
            neg_hits,

        "pos_rate":
            float(
                pos_rate
            ),

        "neg_rate":
            float(
                neg_rate
            ),

        "temporal_coverage":
            float(
                temporal_coverage
            ),

        "median_y":
            median_y,

        "median_width_ratio":
            median_width_ratio,

        "y_stability":
            float(
                y_stability
            ),

        "ocr_score":
            ocr_score,
    }


# =========================================================
# DETECTOR
# =========================================================

def collect_observations(
    cap,
    times,
    sample_type,
    frame_width,
    frame_height,
    ocr_max_width,
    *,
    sample_index_offset=0,
):

    observations = []

    preview_frames = {}

    for index, time_sec in enumerate(
        times
    ):

        print(
            f"{sample_type.upper()} "
            f"{index + 1}/{len(times)} "
            f"@ {time_sec:.2f}s"
        )

        frame = read_frame_at(
            cap,
            time_sec,
        )

        if frame is None:
            continue

        raw_boxes = detect_raw_boxes(
            frame,
            ocr_max_width,
        )

        lines = merge_boxes_to_lines(
            raw_boxes,
            frame_width,
            frame_height,
        )

        for line in lines:

            item = dict(
                line
            )

            item[
                "sample_type"
            ] = sample_type

            item[
                "sample_index"
            ] = (
                sample_index_offset
                + index
            )

            item[
                "time"
            ] = float(
                time_sec
            )

            observations.append(
                item
            )

        preview_frames[
            sample_index_offset
            + index
        ] = frame

    return (
        observations,
        preview_frames,
    )



def rank_clusters(
    observations,
    *,
    positive_frame_count,
    negative_frame_count,
    frame_width,
    frame_height,
    duration,
):

    clusters = (
        cluster_lines_by_y(
            observations,
            frame_height,
        )
    )

    ranked = []

    for cluster in clusters:

        metrics = (
            score_cluster(
                cluster,
                positive_frame_count,
                negative_frame_count,
                frame_width,
                frame_height,
                duration,
            )
        )

        ranked.append(
            (
                metrics[
                    "score"
                ],
                cluster,
                metrics,
            )
        )

    ranked.sort(
        key=lambda item:
            item[
                0
            ],
        reverse=True,
    )

    return ranked


def print_ranked_candidates(
    ranked,
    *,
    title="Top subtitle candidates:",
):

    print(
        "\\n" + title
    )

    for index, (
        score,
        _cluster,
        metrics,
    ) in enumerate(
        ranked[:5],
        start=1,
    ):

        print(
            f"#{index} "
            f"score={score:.3f} "
            f"y={metrics['median_y']:.0f} "
            f"pos={metrics['pos_hits']} "
            f"neg={metrics['neg_hits']} "
            f"coverage={metrics['temporal_coverage']:.2f}"
        )


def fast_result_is_confident(
    ranked,
    *,
    negative_frame_count,
):

    if not ranked:
        return False

    best_score, _cluster, metrics = (
        ranked[0]
    )

    second_score = (
        ranked[1][0]
        if len(ranked) > 1
        else 0.0
    )

    margin = (
        best_score
        - second_score
    )

    speech_lift = (
        metrics[
            "pos_rate"
        ]
        - metrics[
            "neg_rate"
        ]
    )

    if (
        metrics[
            "pos_hits"
        ]
        < FAST_MIN_POSITIVE_HITS
    ):
        return False

    if (
        metrics[
            "temporal_coverage"
        ]
        < FAST_MIN_TEMPORAL_COVERAGE
    ):
        return False

    if (
        best_score
        < FAST_MIN_SCORE
    ):
        return False

    if (
        negative_frame_count > 0
        and speech_lift
        < FAST_MIN_SPEECH_LIFT
    ):
        return False

    # Neu top-1 va top-2 qua sat nhau,
    # can them frame de tranh chot nham UI/text trong canh.
    if (
        len(ranked) > 1
        and margin
        < FAST_MIN_MARGIN
    ):
        return False

    return True


def build_region_from_cluster(
    best_cluster,
    metrics,
    frame_width,
    frame_height,
):

    positive_items = [
        item
        for item in best_cluster
        if item[
            "sample_type"
        ]
        == "positive"
    ]

    chosen = (
        positive_items
        or best_cluster
    )

    centers_y = np.array(
        [
            item[
                "center_y"
            ]
            for item in chosen
        ],
        dtype=np.float32,
    )

    heights = np.array(
        [
            item[
                "height"
            ]
            for item in chosen
        ],
        dtype=np.float32,
    )

    x1s = np.array(
        [
            item[
                "x1"
            ]
            for item in chosen
        ],
        dtype=np.float32,
    )

    x2s = np.array(
        [
            item[
                "x2"
            ]
            for item in chosen
        ],
        dtype=np.float32,
    )

    center_y = int(
        round(
            float(
                np.median(
                    centers_y
                )
            )
        )
    )

    median_height = max(
        1,
        int(
            round(
                float(
                    np.median(
                        heights
                    )
                )
            )
        ),
    )

    # Robust text envelope.
    left = float(
        np.percentile(
            x1s,
            20,
        )
    )

    right = float(
        np.percentile(
            x2s,
            80,
        )
    )

    actual_width = max(
        1.0,
        right - left,
    )

    blur_width = int(
        round(
            max(
                frame_width
                * BLUR_MIN_WIDTH_RATIO,

                actual_width
                + frame_width
                * BLUR_PAD_X_RATIO
                * 2.0,
            )
        )
    )

    blur_width = min(
        blur_width,
        int(
            round(
                frame_width
                * BLUR_MAX_WIDTH_RATIO
            )
        ),
    )

    blur_x = int(
        round(
            (
                frame_width
                - blur_width
            )
            / 2.0
        )
    )

    blur_height = int(
        round(
            median_height
            + frame_height
            * BLUR_PAD_Y_RATIO
            * 2.0
        )
    )

    blur_height = max(
        blur_height,
        int(
            round(
                frame_height
                * BLUR_MIN_HEIGHT_RATIO
            )
        ),
    )

    blur_height = min(
        blur_height,
        int(
            round(
                frame_height
                * BLUR_MAX_HEIGHT_RATIO
            )
        ),
    )

    blur_y = int(
        round(
            center_y
            - blur_height
            / 2.0
        )
    )

    blur_y = max(
        0,
        min(
            blur_y,
            frame_height
            - blur_height,
        ),
    )

    sub_x = (
        blur_x
        + blur_width
        // 2
    )

    sub_y = (
        blur_y
        + blur_height
        // 2
    )

    confidence = clamp01(
        metrics[
            "score"
        ]
    )

    region = {
        "video": {
            "width":
                int(
                    frame_width
                ),

            "height":
                int(
                    frame_height
                ),
        },

        "blur": {
            "x":
                int(
                    blur_x
                ),

            "y":
                int(
                    blur_y
                ),

            "width":
                int(
                    blur_width
                ),

            "height":
                int(
                    blur_height
                ),
        },

        "subtitle": {
            "x":
                int(
                    sub_x
                ),

            "y":
                int(
                    sub_y
                ),

            "position_percent":
                int(
                    round(
                        (
                            sub_y
                            / max(
                                1,
                                frame_height,
                            )
                        )
                        * 100
                    )
                ),
        },

        "detected": {
            "center_y":
                int(
                    center_y
                ),

            "median_text_height":
                int(
                    median_height
                ),

            "method":
                "temporal_srt_paddleocr",

            "confidence":
                round(
                    confidence,
                    4,
                ),

            "positive_hits":
                int(
                    metrics[
                        "pos_hits"
                    ]
                ),

            "negative_hits":
                int(
                    metrics[
                        "neg_hits"
                    ]
                ),

            "positive_rate":
                round(
                    metrics[
                        "pos_rate"
                    ],
                    4,
                ),

            "negative_rate":
                round(
                    metrics[
                        "neg_rate"
                    ],
                    4,
                ),

            "temporal_coverage":
                round(
                    metrics[
                        "temporal_coverage"
                    ],
                    4,
                ),
        },
    }

    return region


def detect_subtitle_region(
    video_path,
    srt_path=None,
):

    total_start = (
        time.perf_counter()
    )

    video_path = Path(
        video_path
    )

    width, height, duration = (
        get_video_info(
            video_path
        )
    )

    print(
        f"Video: {width}x{height}"
    )

    print(
        f"Duration: {duration:.2f}s"
    )

    if srt_path is None:

        srt_path = (
            guess_chinese_srt(
                video_path
            )
        )

    intervals = (
        parse_srt_intervals(
            srt_path
        )
        if srt_path
        else []
    )

    if intervals:

        full_positive_times, full_negative_times = (
            build_srt_samples(
                intervals,
                duration,
                FULL_POSITIVE_SAMPLE_COUNT,
                FULL_NEGATIVE_SAMPLE_COUNT,
            )
        )

        fast_positive_times = (
            spread_pick(
                full_positive_times,
                FAST_POSITIVE_SAMPLE_COUNT,
            )
        )

        fast_negative_times = (
            spread_pick(
                full_negative_times,
                FAST_NEGATIVE_SAMPLE_COUNT,
            )
        )

        method_fast = (
            "temporal_srt_paddleocr_fast"
        )

        method_full = (
            "temporal_srt_paddleocr_adaptive"
        )

        print(
            f"FAST SRT guided: "
            f"{len(fast_positive_times)} positive, "
            f"{len(fast_negative_times)} negative"
        )

    else:

        start_time = min(
            0.8,
            max(
                0.0,
                duration
                * 0.04,
            ),
        )

        end_time = max(
            start_time,
            duration
            - start_time,
        )

        full_positive_times = [
            float(
                value
            )
            for value in np.linspace(
                start_time,
                end_time,
                FULL_UNIFORM_SAMPLE_COUNT,
            )
        ]

        full_negative_times = []

        fast_positive_times = (
            spread_pick(
                full_positive_times,
                FAST_UNIFORM_SAMPLE_COUNT,
            )
        )

        fast_negative_times = []

        method_fast = (
            "temporal_uniform_paddleocr_fast"
        )

        method_full = (
            "temporal_uniform_paddleocr_adaptive"
        )

        print(
            "Khong co chinese.srt -> "
            "fast uniform temporal scan."
        )

    if not fast_positive_times:

        raise RuntimeError(
            "Khong co frame hop le de detect subtitle."
        )

    cap = cv2.VideoCapture(
        str(
            video_path
        )
    )

    if not cap.isOpened():

        raise RuntimeError(
            f"Khong mo duoc video: {video_path}"
        )

    positive_obs = []
    negative_obs = []
    positive_frames = {}

    try:

        fast_start = (
            time.perf_counter()
        )

        fast_pos_obs, fast_pos_frames = (
            collect_observations(
                cap,
                fast_positive_times,
                "positive",
                width,
                height,
                FAST_OCR_MAX_WIDTH,
            )
        )

        fast_neg_obs, _ = (
            collect_observations(
                cap,
                fast_negative_times,
                "negative",
                width,
                height,
                FAST_OCR_MAX_WIDTH,
            )
            if fast_negative_times
            else (
                [],
                {},
            )
        )

        positive_obs.extend(
            fast_pos_obs
        )

        negative_obs.extend(
            fast_neg_obs
        )

        positive_frames.update(
            fast_pos_frames
        )

        fast_observations = (
            positive_obs
            + negative_obs
        )

        fast_ranked = (
            rank_clusters(
                fast_observations,
                positive_frame_count=
                    len(
                        fast_positive_times
                    ),
                negative_frame_count=
                    len(
                        fast_negative_times
                    ),
                frame_width=
                    width,
                frame_height=
                    height,
                duration=
                    duration,
            )
        )

        fast_elapsed = (
            time.perf_counter()
            - fast_start
        )

        print(
            f"FAST candidate lines: "
            f"{len(fast_observations)}"
        )

        if fast_ranked:

            print_ranked_candidates(
                fast_ranked,
                title=(
                    "FAST subtitle candidates:"
                ),
            )

        if (
            fast_result_is_confident(
                fast_ranked,
                negative_frame_count=
                    len(
                        fast_negative_times
                    ),
            )
        ):

            best_score, best_cluster, best_metrics = (
                fast_ranked[
                    0
                ]
            )

            region = (
                build_region_from_cluster(
                    best_cluster,
                    best_metrics,
                    width,
                    height,
                )
            )

            region[
                "detected"
            ][
                "method"
            ] = method_fast

            region[
                "detected"
            ][
                "scan_mode"
            ] = "fast"

            region[
                "detected"
            ][
                "ocr_max_width"
            ] = FAST_OCR_MAX_WIDTH

            region[
                "detected"
            ][
                "detect_seconds"
            ] = round(
                (
                    time.perf_counter()
                    - total_start
                ),
                3,
            )

            preview_frame = None

            positive_items = [
                item
                for item in best_cluster
                if item[
                    "sample_type"
                ]
                == "positive"
            ]

            if positive_items:

                target_y = float(
                    region[
                        "detected"
                    ][
                        "center_y"
                    ]
                )

                best_item = min(
                    positive_items,
                    key=lambda item:
                        abs(
                            item[
                                "center_y"
                            ]
                            - target_y
                        ),
                )

                preview_frame = (
                    positive_frames.get(
                        best_item[
                            "sample_index"
                        ]
                    )
                )

            print(
                f"\nFAST PASS OK "
                f"({fast_elapsed:.2f}s) "
                f"-> khong can scan full."
            )

            print(
                "\nDetected subtitle:"
            )

            print(
                json.dumps(
                    region,
                    ensure_ascii=False,
                    indent=2,
                )
            )

            return (
                region,
                preview_frame,
            )

        # =================================================
        # FULL PASS: chi OCR them cac frame chua scan.
        # =================================================

        print(
            "\nFAST PASS chua du tin cay "
            "-> scan them frame."
        )

        def not_in_fast(
            value,
            fast_values,
        ):
            return all(
                abs(
                    float(
                        value
                    )
                    - float(
                        old
                    )
                )
                > 0.001
                for old in fast_values
            )

        extra_positive_times = [
            value
            for value
            in full_positive_times
            if not_in_fast(
                value,
                fast_positive_times,
            )
        ]

        extra_negative_times = [
            value
            for value
            in full_negative_times
            if not_in_fast(
                value,
                fast_negative_times,
            )
        ]

        extra_pos_obs, extra_pos_frames = (
            collect_observations(
                cap,
                extra_positive_times,
                "positive",
                width,
                height,
                FULL_OCR_MAX_WIDTH,
                sample_index_offset=
                    len(
                        fast_positive_times
                    ),
            )
            if extra_positive_times
            else (
                [],
                {},
            )
        )

        extra_neg_obs, _ = (
            collect_observations(
                cap,
                extra_negative_times,
                "negative",
                width,
                height,
                FULL_OCR_MAX_WIDTH,
                sample_index_offset=
                    len(
                        fast_negative_times
                    ),
            )
            if extra_negative_times
            else (
                [],
                {},
            )
        )

        positive_obs.extend(
            extra_pos_obs
        )

        negative_obs.extend(
            extra_neg_obs
        )

        positive_frames.update(
            extra_pos_frames
        )

    finally:

        cap.release()

    observations = (
        positive_obs
        + negative_obs
    )

    print(
        f"FULL candidate lines: "
        f"{len(observations)}"
    )

    if not positive_obs:

        raise SubtitleRegionNotFound(
            "OCR khong tim thay text line "
            "o cac frame co loi thoai.",
            "no_text_lines",
        )

    ranked = (
        rank_clusters(
            observations,
            positive_frame_count=
                len(
                    full_positive_times
                ),
            negative_frame_count=
                len(
                    full_negative_times
                ),
            frame_width=
                width,
            frame_height=
                height,
            duration=
                duration,
        )
    )

    if not ranked:

        raise SubtitleRegionNotFound(
            "Khong gom duoc subtitle cluster.",
            "no_subtitle_cluster",
        )

    print_ranked_candidates(
        ranked
    )

    best_score, best_cluster, best_metrics = (
        ranked[
            0
        ]
    )

    if (
        best_metrics[
            "pos_hits"
        ]
        < MIN_POSITIVE_HITS
    ):

        raise SubtitleRegionNotFound(
            "Subtitle candidate xuat hien "
            "qua it frame.",
            "insufficient_hits",
        )

    if (
        best_metrics[
            "temporal_coverage"
        ]
        < MIN_TEMPORAL_COVERAGE
    ):

        raise SubtitleRegionNotFound(
            "Subtitle candidate chi xuat hien "
            "o mot doan ngan cua video.",
            "insufficient_coverage",
        )

    if (
        best_score
        < MIN_FINAL_CONFIDENCE
    ):

        raise SubtitleRegionNotFound(
            "Khong du tin cay de chot "
            "vi tri subtitle.",
            "low_confidence",
        )

    region = (
        build_region_from_cluster(
            best_cluster,
            best_metrics,
            width,
            height,
        )
    )

    region[
        "detected"
    ][
        "method"
    ] = method_full

    region[
        "detected"
    ][
        "scan_mode"
    ] = "full_fallback"

    region[
        "detected"
    ][
        "ocr_max_width"
    ] = FULL_OCR_MAX_WIDTH

    region[
        "detected"
    ][
        "detect_seconds"
    ] = round(
        (
            time.perf_counter()
            - total_start
        ),
        3,
    )

    # Chọn preview frame có candidate gần median Y nhất.
    preview_frame = None

    positive_items = [
        item
        for item in best_cluster
        if item[
            "sample_type"
        ]
        == "positive"
    ]

    if positive_items:

        target_y = float(
            region[
                "detected"
            ][
                "center_y"
            ]
        )

        best_item = min(
            positive_items,
            key=lambda item:
                abs(
                    item[
                        "center_y"
                    ]
                    - target_y
                ),
        )

        preview_frame = (
            positive_frames.get(
                best_item[
                    "sample_index"
                ]
            )
        )

    print(
        "\nDetected subtitle:"
    )

    print(
        json.dumps(
            region,
            ensure_ascii=False,
            indent=2,
        )
    )

    print(
        f"\nTotal detect time: "
        f"{region['detected']['detect_seconds']:.2f}s"
    )

    return (
        region,
        preview_frame,
    )


# =========================================================
# PREVIEW
# =========================================================

def save_preview(
    frame,
    region,
):

    if frame is None:
        return

    x = int(
        region[
            "blur"
        ][
            "x"
        ]
    )

    y = int(
        region[
            "blur"
        ][
            "y"
        ]
    )

    w = int(
        region[
            "blur"
        ][
            "width"
        ]
    )

    h = int(
        region[
            "blur"
        ][
            "height"
        ]
    )

    preview = (
        frame.copy()
    )

    crop = (
        preview[
            y:
                y + h,
            x:
                x + w,
        ]
    )

    if crop.size > 0:

        blurred = cv2.GaussianBlur(
            crop,
            (
                0,
                0,
            ),
            sigmaX=18,
            sigmaY=18,
        )

        preview[
            y:
                y + h,
            x:
                x + w,
        ] = blurred

    cv2.rectangle(
        preview,
        (
            x,
            y,
        ),
        (
            x + w,
            y + h,
        ),
        (
            0,
            255,
            0,
        ),
        3,
    )

    sub_x = int(
        region[
            "subtitle"
        ][
            "x"
        ]
    )

    sub_y = int(
        region[
            "subtitle"
        ][
            "y"
        ]
    )

    cv2.circle(
        preview,
        (
            sub_x,
            sub_y,
        ),
        9,
        (
            0,
            0,
            255,
        ),
        -1,
    )

    output = Path(
        OUTPUT_PREVIEW
    )

    output.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    cv2.imwrite(
        str(
            output
        ),
        preview,
    )


# =========================================================
# CLI
# =========================================================

def main():

    global OUTPUT_JSON
    global OUTPUT_PREVIEW

    parser = (
        argparse.ArgumentParser(
            description=(
                "Temporal subtitle detector "
                "using SRT-guided PaddleOCR."
            )
        )
    )

    parser.add_argument(
        "video",
        nargs="?",
        default=
            VIDEO_PATH,
    )

    parser.add_argument(
        "--srt",
        default=None,
    )

    parser.add_argument(
        "--output-json",
        default=
            OUTPUT_JSON,
    )

    parser.add_argument(
        "--preview",
        default=
            OUTPUT_PREVIEW,
    )

    args = (
        parser.parse_args()
    )

    OUTPUT_JSON = (
        args.output_json
    )

    OUTPUT_PREVIEW = (
        args.preview
    )

    region, preview = (
        detect_subtitle_region(
            args.video,
            args.srt,
        )
    )

    output_json = Path(
        OUTPUT_JSON
    )

    output_json.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    output_json.write_text(
        json.dumps(
            region,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    save_preview(
        preview,
        region,
    )

    print(
        "\nDa tao:"
    )

    print(
        OUTPUT_JSON
    )

    print(
        OUTPUT_PREVIEW
    )


if __name__ == "__main__":
    main()
