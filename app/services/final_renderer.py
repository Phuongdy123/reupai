import gc
import hashlib
import json



import math



import os



import re
import shutil



import subprocess
from functools import lru_cache



from pathlib import Path



def _detached_media_process_kwargs():
    """Keep ffmpeg/ffprobe isolated from the packaged app console on Windows."""
    kwargs = {
        "stdin": subprocess.DEVNULL,
    }
    if os.name == "nt":
        kwargs["creationflags"] = (
            getattr(subprocess, "CREATE_NO_WINDOW", 0)
            | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        )
    return kwargs











# =========================================================



# CONFIG



# pipeline.py se override cac bien nay theo tung job



# =========================================================







VIDEO_PATH = (



    "app/downloads/test2.mp4"



)







VOICE_PATH = (



    "app/output/vietnamese_voice.wav"



)







SRT_PATH = (



    "app/output/vietnamese.srt"



)

RENDER_PROGRESS_CALLBACK = None







REGION_PATH = (



    "app/output/subtitle_region.json"



)







ASS_PATH = (



    "app/output/final.ass"



)







OUTPUT_PATH = (



    "app/output/final.mp4"



)







ORIGINAL_VOLUME = 0.15



VOICE_VOLUME = 1.0



PREVIEW_SECONDS = None







# "subtitle" / "voiceover".



# pipeline.py se set bien nay.



RENDER_MODE = None











# =========================================================



# RENDER CONFIG



# =========================================================







NVENC_PRESET = "p1"



NVENC_TUNE = "ll"



NVENC_QP = "23"



NVENC_BFRAMES = "0"







# Vi tri sub Viet trong vung blur.



# 0.50 = chinh giua



# 0.55 = hoi thap hon giua mot chut



SUB_Y_RATIO_IN_BLUR = 0.55







# Subtitle chi duoc chiem toi da bao nhieu % vung blur theo chieu ngang.



SUB_MAX_WIDTH_RATIO = 0.92







# Toi da bao nhieu dong.



MAX_SUB_LINES = 2

# Gioi han ky tu toi da tren moi dong de chu khong bi ep nho hay tran man hinh.
try:
    SUB_MAX_LINE_CHARS = min(60, max(24, int(os.getenv("REUP_SUB_MAX_LINE_CHARS", "38") or 38)))
except (TypeError, ValueError):
    SUB_MAX_LINE_CHARS = 38







# Font.



FONT_NAME = "Arial"



FONT_BOLD = True

# Web jobs may override this while keeping automatic sizing as the default.
FONT_SIZE_OVERRIDE = None
SUBTITLE_STYLE = "minimal"

OUTPUT_ASPECT_RATIO = None
LOGO_SIZE_OVERRIDE = None
LOGO_WIDTH_OVERRIDE = None
LOGO_HEIGHT_OVERRIDE = None
LOGO_X_OVERRIDE = None
LOGO_Y_OVERRIDE = None
LOGO_MODE = "none"
LOGO_SHAPE = "rect"
LOGO_TEXT = None
LOGO_PATH_OVERRIDE = None
BLUR_INTERVALS = []
SECONDARY_SUB_REGION = None
SECONDARY_SUB_BLUR = True
SECONDARY_SUBTITLES = []
MUSIC_PATH = None
MUSIC_VOLUME = 0.25







# Blur subtitle goc.



BLUR_RADIUS = 16



BLUR_POWER = 2





# =========================================================

# BILIBILI WATERMARK CLEANUP

# =========================================================

#

# Muc tieu moi:

# - KHONG them nen den nua.

# - Lam mo cac vung watermark / id / @name cua Bilibili.

# - Sau khi lam mo, overlay text thuong "Lật Chuyện Vietsub"

#   len goc tren trai bang ASS, nen trong suot.

#

# Chi ap dung cho Bilibili. Douyin khong bi anh huong.

# =========================================================



BILIBILI_BRAND_ENABLED = True
# Tự động che ID/watermark độc lập với logo chèn lên video.
AUTO_BRAND_BLUR_ENABLED = False

BILIBILI_BRAND_TEXT = ""

# Logo kenh. Dat tai D:\reup-ai\app\assets\lat_chuyen_logo.png
BILIBILI_LOGO_PATH = "app/assets/lat_chuyen_logo.png"
BILIBILI_LOGO_SIZE_RATIO = 0.10
BILIBILI_LOGO_MIN_SIZE = 82
BILIBILI_LOGO_MAX_SIZE = 150
BILIBILI_LOGO_X_RATIO = 0.025
BILIBILI_LOGO_Y_RATIO = 0.025



# Vi tri dat chu branding (khong phai vung nen den).

BILIBILI_BRAND_REGION = (

    0.040,

    0.035,

    0.26,

    0.080,

)



# Cac vung watermark / ID / @name can lam mo.

# Format: (x, y, width, height) theo ti le frame.

# Các vùng watermark/ID chỉ được dùng khi người dùng bật chế độ tự động.
# Watermark rectangles are measured from the source by watermark_detector.



# Mau chu branding (ASS outline se giup de doc).

BILIBILI_BRAND_FONT_MIN = 24

BILIBILI_BRAND_FONT_MAX = 52











# =========================================================



# HELPERS



# =========================================================







def file_ok(path):



    try:



        path = Path(



            path



        )







        return (



            path.exists()



            and path.is_file()



            and path.stat().st_size > 0



        )







    except Exception:



        return False











@lru_cache(maxsize=1)
def ffmpeg_has_nvenc():







    result = subprocess.run(



        [



            "ffmpeg",



            "-hide_banner",



            "-encoders",



        ],



        capture_output=True,



        text=True,



        encoding="utf-8",



        errors="replace",



        check=False,



        **_detached_media_process_kwargs(),



    )







    text = (



        (result.stdout or "")



        +



        (result.stderr or "")



    )







    return (



        "h264_nvenc"



        in text



    )











@lru_cache(maxsize=1)
def ffmpeg_has_cuda_hwaccel():
    """Check whether the selected FFmpeg build advertises CUDA decode support."""
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-hwaccels"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
            **_detached_media_process_kwargs(),
        )
    except OSError:
        return False
    output = (result.stdout or "") + (result.stderr or "")
    return any(line.strip().lower() == "cuda" for line in output.splitlines())


def _with_cuda_video_decode(command):
    """Use NVDEC on the source input; filters can download frames to system RAM."""
    if not ffmpeg_has_cuda_hwaccel() or "-hwaccel" in command:
        return None
    try:
        input_index = command.index("-i")
    except ValueError:
        return None
    accelerated = list(command)
    accelerated[input_index:input_index] = ["-hwaccel", "cuda"]
    return accelerated


def ffmpeg_filter_path(path):



    """

    Tao path an toan cho filter subtitles cua FFmpeg tren Windows.



    QUAN TRONG:

    - Uu tien path relative de tranh drive colon D:

    - Dung forward slash /

    - Neu bat buoc dung absolute Windows path thi chi escape colon 1 lan.



    Loi cu:

        D:\\\reup-ai\\\app\\\\...

    bi FFmpeg tach ':' thanh tham so original_size.

    """



    path_obj = Path(

        path

    )



    # Pipeline cua project truyen ASS_PATH dang relative:

    # app/channels/.../final_voice.ass

    # Giu relative la an toan nhat cho FFmpeg filter parser.

    if not path_obj.is_absolute():



        value = (

            path_obj

            .as_posix()

        )



    else:



        # Neu absolute nam trong cwd, chuyen ve relative.

        # Vi du:

        # D:\reup-ai\app\\... -> app/...

        try:



            value = (

                path_obj

                .resolve()

                .relative_to(

                    Path.cwd().resolve()

                )

                .as_posix()

            )



        except Exception:



            # Truong hop bat buoc phai dung absolute.

            value = str(

                path_obj

            ).replace(

                "\\",

                "/",

            )



            # Windows drive:

            # D:/abc/file.ass -> D\\:/abc/file.ass

            if re.match(

                r"^[A-Za-z]:/",

                value,

            ):



                value = (

                    value[0]

                    + r"\:"

                    + value[2:]

                )



    # Escape quote neu ten folder/file co dau '.

    value = value.replace(

        "'",

        r"\'",

    )



    return value







def get_render_mode():







    if RENDER_MODE in {



        "subtitle",



        "voiceover",



    }:



        return RENDER_MODE







    name = (



        Path(



            OUTPUT_PATH



        )



        .name



        .lower()



    )







    if (



        "voice"



        in name



        or



        "dub"



        in name



    ):



        return "voiceover"







    return "subtitle"











def detect_source_platform():



    """

    Pipeline hien tai khong can sua.



    Bilibili job thuong co BV id trong VIDEO_PATH /

    OUTPUT_PATH / REGION_PATH. Douyin thuong dung numeric aweme id.

    """



    joined = " | ".join(

        [

            str(VIDEO_PATH),

            str(OUTPUT_PATH),

            str(REGION_PATH),

        ]

    )



    if re.search(

        r"(^|[\\\\/])BV[0-9A-Za-z]{6,24}([\\\\/]|$)",

        joined,

        flags=re.IGNORECASE,

    ):

        return "bilibili"



    if re.search(

        r"(^|[\\\\/])\d{12,25}([\\\\/]|$)",

        joined,

    ):

        return "douyin"



    return "unknown"





def get_bilibili_brand_box(

    width,

    height,

):



    if (

        not BILIBILI_BRAND_ENABLED

        or detect_source_platform()

        != "bilibili"

    ):

        return None



    rx, ry, rw, rh = (

        BILIBILI_BRAND_REGION

    )



    x = int(

        round(

            width * rx

        )

    )



    y = int(

        round(

            height * ry

        )

    )



    w = int(

        round(

            width * rw

        )

    )



    h = int(

        round(

            height * rh

        )

    )



    x = int(

        clamp(

            x,

            0,

            max(

                0,

                width - 2,

            ),

        )

    )



    y = int(

        clamp(

            y,

            0,

            max(

                0,

                height - 2,

            ),

        )

    )



    w = int(

        clamp(

            w,

            2,

            width - x,

        )

    )



    h = int(

        clamp(

            h,

            2,

            height - y,

        )

    )



    return {

        "x": x,

        "y": y,

        "width": w,

        "height": h,

    }





def get_bilibili_text_blur_boxes(width, height):
    if not AUTO_BRAND_BLUR_ENABLED or detect_source_platform() != "bilibili":
        return []
    try:
        from services.watermark_detector import detect_watermark_regions
        detected = detect_watermark_regions(VIDEO_PATH)
        source = detected["video"]
        sx = width / source["width"]
        sy = height / source["height"]
        result = []
        for box in detected["boxes"]:
            # Even crop dimensions keep software and GPU encoding paths aligned.
            x = max(0, min(width - 2, int(box["x"] * sx) // 2 * 2))
            y = max(0, min(height - 2, int(box["y"] * sy) // 2 * 2))
            right = min(width // 2 * 2, math.ceil((box["x"] + box["width"]) * sx / 2) * 2)
            bottom = min(height // 2 * 2, math.ceil((box["y"] + box["height"]) * sy / 2) * 2)
            if right > x and bottom > y:
                result.append({"x": x, "y": y, "width": right - x, "height": bottom - y})
        if not result:
            print("[watermark] Khong du bang chung ve ID/watermark o goc tren; bo qua tu dong che.")
        return result
    except Exception as error:
        print(f"[watermark] Chua do duoc ID/watermark, bo qua de tranh che nham: {error}")
        return []


def get_bilibili_logo_path():

    if LOGO_MODE in {"none", "text"}:
        return None

    path = Path(
        BILIBILI_LOGO_PATH
        if LOGO_MODE != "custom"
        else str(LOGO_PATH_OVERRIDE or BILIBILI_LOGO_PATH)
    )

    if path.is_absolute():
        return path

    candidate = Path.cwd() / path
    if file_ok(candidate):
        return candidate

    try:
        project_root = Path(__file__).resolve().parents[2]
        candidate = project_root / path
        if file_ok(candidate):
            return candidate
    except Exception:
        pass

    return Path.cwd() / path


def _probe_logo_dimensions(logo_path):
    if not logo_path:
        return None
    try:
        from PIL import Image
        with Image.open(logo_path) as img:
            if img.width > 0 and img.height > 0:
                return int(img.width), int(img.height)
    except Exception:
        pass
    return None


def get_bilibili_logo_layout(width, height, logo_path=None):
    shape = str(LOGO_SHAPE or "rect").strip().lower()
    if shape not in {"rect", "circle"}:
        shape = "rect"
    short_side = min(width, height)

    if shape == "circle":
        if LOGO_SIZE_OVERRIDE:
            size = int(round(float(LOGO_SIZE_OVERRIDE)))
            size = int(clamp(size, 1, max(1, short_side)))
        elif LOGO_WIDTH_OVERRIDE and LOGO_HEIGHT_OVERRIDE:
            size = int(round(min(float(LOGO_WIDTH_OVERRIDE), float(LOGO_HEIGHT_OVERRIDE))))
            size = int(clamp(size, 1, max(1, short_side)))
        else:
            size = int(round(short_side * BILIBILI_LOGO_SIZE_RATIO))
            size = int(clamp(size, BILIBILI_LOGO_MIN_SIZE, BILIBILI_LOGO_MAX_SIZE))
        logo_w = size
        logo_h = size
    else:
        dims = _probe_logo_dimensions(logo_path)
        aspect = (dims[0] / dims[1]) if dims else 1.0
        if LOGO_WIDTH_OVERRIDE and LOGO_HEIGHT_OVERRIDE:
            box_w = float(LOGO_WIDTH_OVERRIDE)
            box_h = float(LOGO_HEIGHT_OVERRIDE)
            if dims:
                scale = min(box_w / dims[0], box_h / dims[1])
                logo_w = max(1, int(round(dims[0] * scale)))
                logo_h = max(1, int(round(dims[1] * scale)))
            else:
                logo_w = max(1, int(round(box_w)))
                logo_h = max(1, int(round(box_h)))
        elif LOGO_WIDTH_OVERRIDE:
            logo_w = max(1, int(round(float(LOGO_WIDTH_OVERRIDE))))
            logo_h = max(1, int(round(logo_w / aspect)))
        elif LOGO_SIZE_OVERRIDE:
            target = float(LOGO_SIZE_OVERRIDE)
            if aspect >= 1.0:
                logo_w = max(1, int(round(target)))
                logo_h = max(1, int(round(target / aspect)))
            else:
                logo_h = max(1, int(round(target)))
                logo_w = max(1, int(round(target * aspect)))
        else:
            default_w = clamp(int(round(short_side * BILIBILI_LOGO_SIZE_RATIO * (1.5 if aspect > 1.25 else 1.0))), BILIBILI_LOGO_MIN_SIZE, max(BILIBILI_LOGO_MIN_SIZE, int(width * 0.38)))
            logo_w = max(1, int(default_w))
            logo_h = max(1, int(round(logo_w / aspect)))

        if logo_w > width:
            scale = width / logo_w
            logo_w = max(1, int(width))
            logo_h = max(1, int(round(logo_h * scale)))
        if logo_h > height:
            scale = height / logo_h
            logo_h = max(1, int(height))
            logo_w = max(1, int(round(logo_w * scale)))
        size = max(logo_w, logo_h)

    x = (
        int(round(float(LOGO_X_OVERRIDE)))
        if LOGO_X_OVERRIDE is not None
        else int(round(width * BILIBILI_LOGO_X_RATIO))
    )
    y = (
        int(round(float(LOGO_Y_OVERRIDE)))
        if LOGO_Y_OVERRIDE is not None
        else int(round(height * BILIBILI_LOGO_Y_RATIO))
    )

    x = int(clamp(x, 0, max(0, width - logo_w)))
    y = int(clamp(y, 0, max(0, height - logo_h)))

    return {
        "x": x,
        "y": y,
        "size": size,
        "width": logo_w,
        "height": logo_h,
        "shape": shape,
    }


def get_bilibili_brand_font_size(

    video_width,

    video_height,

    box_height,

):



    short_side = min(

        video_width,

        video_height,

    )



    size = min(

        short_side * 0.042,

        box_height * 0.42,

    )



    size = clamp(

        size,

        BILIBILI_BRAND_FONT_MIN,

        BILIBILI_BRAND_FONT_MAX,

    )



    return int(

        round(

            size

        )

    )





def clamp(



    value,



    minimum,



    maximum,



):







    return max(



        minimum,



        min(



            value,



            maximum,



        ),



    )











def even_int(value):







    value = int(



        round(



            float(value)



        )



    )







    if value % 2:



        value -= 1







    return max(



        2,



        value,



    )











def ffprobe_video_size(



    path,



):







    try:







        result = subprocess.run(



            [



                "ffprobe",



                "-v",



                "error",



                "-select_streams",



                "v:0",



                "-show_entries",



                "stream=width,height",



                "-of",



                "csv=s=x:p=0",



                str(path),



            ],



            capture_output=True,



            text=True,



            encoding="utf-8",



            errors="replace",



            **_detached_media_process_kwargs(),



            check=True,



        )







        text = (



            result.stdout



            .strip()



        )







        match = re.fullmatch(



            r"(\d+)x(\d+)",



            text,



        )







        if not match:



            return None







        width = int(



            match.group(1)



        )







        height = int(



            match.group(2)



        )







        if (



            width > 0



            and height > 0



        ):



            return (



                width,



                height,



            )







    except Exception:



        pass







    return None











# =========================================================



# SRT



# =========================================================







def read_srt(path):







    text = (



        Path(path)



        .read_text(



            encoding="utf-8-sig"



        )



    )







    blocks = re.split(



        r"\r?\n\s*\r?\n",



        text.strip(),



    )







    results = []







    for block in blocks:







        lines = [



            line.strip()



            for line



            in block.splitlines()



            if line.strip()



        ]







        if len(lines) < 3:



            continue







        # Ho tro ca SRT co index va SRT khong co index.



        time_index = None







        for index, line in enumerate(



            lines



        ):



            if "-->" in line:



                time_index = index



                break







        if time_index is None:



            continue







        if (



            time_index + 1



            >= len(lines)



        ):



            continue







        start, end = (



            lines[



                time_index



            ]



            .split(



                "-->",



                1,



            )



        )







        subtitle_text = (



            " ".join(



                lines[



                    time_index + 1:



                ]



            )



            .strip()



        )







        if not subtitle_text:



            continue







        results.append({



            "start":



                start.strip(),







            "end":



                end.strip(),







            "text":



                subtitle_text,



        })







    return results











def srt_time_to_seconds(value):
    match = re.match(
        r"(\d+):(\d+):(\d+)[,.](\d+)",
        str(value or "").strip(),
    )
    if not match:
        raise ValueError("SRT time khong hop le: " + str(value))
    hours, minutes, seconds = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
    milliseconds = int(match.group(4).ljust(3, "0")[:3])
    return hours * 3600.0 + minutes * 60.0 + seconds + milliseconds / 1000.0


def srt_to_ass_time(value):
    return _format_ass_time(srt_time_to_seconds(value))


def escape_ass_text(value):







    value = str(



        value



    )







    value = value.replace(



        "\\\\\\\\",



        r"\\\\\\\\",



    )







    value = value.replace(



        "{",



        r"\\\\{",



    )







    value = value.replace(



        "}",



        r"\\\\}",



    )







    value = re.sub(



        r"\s+",



        " ",



        value,



    )







    return value.strip()











# =========================================================



# REGION / VIDEO GEOMETRY



# =========================================================







def get_video_geometry(



    region,



):







    video = (



        region.get(



            "video",



            {},



        )



        if isinstance(



            region,



            dict,



        )



        else {}



    )







    width = int(



        video.get(



            "width",



            0,



        )



        or 0



    )







    height = int(



        video.get(



            "height",



            0,



        )



        or 0



    )







    actual = (



        ffprobe_video_size(



            VIDEO_PATH



        )



        if file_ok(



            VIDEO_PATH



        )



        else None



    )







    if actual:







        actual_width, actual_height = (



            actual



        )







        # Uu tien kich thuoc source that.



        # Neu detector luu region theo kich thuoc khac thi scale region o normalize_region().



        if (



            width <= 0



            or height <= 0



        ):



            width = actual_width



            height = actual_height







        return (



            width,



            height,



            actual_width,



            actual_height,



        )







    if width <= 0:



        width = 1920







    if height <= 0:



        height = 1080







    return (



        width,



        height,



        width,



        height,



    )











def normalize_region(



    region,



):







    (



        region_width,



        region_height,



        actual_width,



        actual_height,



    ) = get_video_geometry(



        region



    )







    blur = dict(



        (



            region.get(



                "blur",



                {},



            )



            if isinstance(



                region,



                dict,



            )



            else {}



        )



    )







    x = float(



        blur.get(



            "x",



            0,



        )



        or 0



    )







    y = float(



        blur.get(



            "y",



            0,



        )



        or 0



    )







    width = float(



        blur.get(



            "width",



            0,



        )



        or 0



    )







    height = float(



        blur.get(



            "height",



            0,



        )



        or 0



    )







    # Neu region duoc detect tren kich thuoc khac source that,



    # scale tat ca toa do theo source.



    scale_x = (



        actual_width



        / region_width



        if region_width > 0



        else 1.0



    )







    scale_y = (



        actual_height



        / region_height



        if region_height > 0



        else 1.0



    )







    x *= scale_x



    width *= scale_x







    y *= scale_y



    height *= scale_y







    # Fallback neu blur region bi rong.



    if width <= 0:







        width = (



            actual_width



            * 0.86



        )







        x = (



            (



                actual_width



                - width



            )



            / 2



        )







    if height <= 0:







        height = max(



            actual_height



            * 0.10,



            72,



        )







        y = (



            actual_height



            * 0.80



        )







    # Clamp vao frame.



    x = clamp(



        x,



        0,



        max(



            0,



            actual_width - 2,



        ),



    )







    y = clamp(



        y,



        0,



        max(



            0,



            actual_height - 2,



        ),



    )







    width = clamp(



        width,



        2,



        actual_width - x,



    )







    height = clamp(



        height,



        2,



        actual_height - y,



    )







    # FFmpeg crop thich so chan hon.



    x = int(



        round(



            x



        )



    )







    y = int(



        round(



            y



        )



    )







    width = even_int(



        width



    )







    height = even_int(



        height



    )







    if (



        x + width



        > actual_width



    ):



        width = even_int(



            actual_width



            - x



        )







    if (



        y + height



        > actual_height



    ):



        height = even_int(



            actual_height



            - y



        )







    sub_x = int(



        round(



            x



            + width / 2



        )



    )







    sub_y = int(



        round(



            y



            + height



            * SUB_Y_RATIO_IN_BLUR



        )



    )







    result = {
        "blur_enabled": bool(
            region.get("blur_enabled", True)
            if isinstance(region, dict)
            else True
        ),

        "video": {



            "width":



                int(



                    actual_width



                ),







            "height":



                int(



                    actual_height



                ),



        },







        "blur": {



            "x":



                int(



                    x



                ),







            "y":



                int(



                    y



                ),







            "width":



                int(



                    width



                ),







            "height":



                int(



                    height



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



        },



    }







    return result











# =========================================================



# SUBTITLE LAYOUT



# =========================================================







def base_font_size(



    video_width,



    video_height,



    blur_width,



    blur_height,



):







    # Scale theo canh ngan de khong bi qua to voi video doc/vuong.



    short_side = min(



        video_width,



        video_height,



    )







    size = (



        short_side



        * 0.050



    )







    # Neu vung blur thap thi font phai nho theo.



    size = min(



        size,



        blur_height



        * 0.48,



    )







    # Gioi han hop ly.



    size = clamp(



        size,



        24,



        60,



    )







    return int(



        round(



            size



        )



    )











def estimate_text_width(



    text,



    font_size,



):







    """



    Uoc luong chieu rong text ASS.



    Khong can pixel-perfect; muc dich de wrap truoc khi libass render.



    """







    width_units = 0.0







    for char in str(



        text



    ):







        if char.isspace():



            width_units += 0.33







        elif ord(



            char



        ) > 0x2E80:



            # CJK.



            width_units += 1.00







        elif char in (



            "i",



            "l",



            "I",



            ".",



            ",",



            ":",



            ";",



            "'",



            "!",



            "|",



        ):



            width_units += 0.30







        elif char in (



            "m",



            "w",



            "M",



            "W",



            "@",



            "%",



        ):



            width_units += 0.90







        else:



            width_units += 0.56







    return (



        width_units



        * font_size



    )











def split_words_to_lines(



    text,



    font_size,



    max_width,



):







    words = (



        str(text)



        .strip()



        .split()



    )







    if not words:



        return [



            ""



        ]







    lines = []



    current = ""







    for word in words:







        candidate = (



            word



            if not current



            else current



            + " "



            + word



        )







        if (



            not current



            or estimate_text_width(



                candidate,



                font_size,



            )



            <= max_width



        ):



            current = candidate







        else:



            lines.append(



                current



            )







            current = word







    if current:



        lines.append(



            current



        )







    return lines











def fit_subtitle(



    text,



    *,



    base_size,



    max_width,



    blur_height,



):







    """



    Fit text vao vung blur:



    - uu tien 1 dong



    - neu dai thi 2 dong



    - neu van dai thi giam font



    """







    font_size = int(



        base_size



    )







    min_font = max(



        20,



        int(



            base_size



            * 0.66



        ),



    )







    while (



        font_size



        >= min_font



    ):







        lines = (



            split_words_to_lines(



                text,



                font_size,



                max_width,



            )



        )







        # Chieu cao thuc te cua 2 dong co line spacing.



        estimated_height = (



            len(lines)



            * font_size



            * 1.10



        )







        if (



            len(lines)



            <= MAX_SUB_LINES



            and estimated_height



                <= blur_height * 0.96



        ):



            return (



                font_size,



                lines,



            )







        font_size -= 2







    # Cuoi cung van uu tien khong tran ngang.



    lines = (



        split_words_to_lines(



            text,



            min_font,



            max_width,



        )



    )







    if (



        len(lines)



        > MAX_SUB_LINES



    ):



        # Gom thanh 2 dong can bang so tu,



        # tranh tao 3-4 dong tren video ngang/thap.



        words = (



            str(text)



            .strip()



            .split()



        )







        if len(words) >= 2:







            best = None



            best_score = None







            for index in range(



                1,



                len(words),



            ):







                left = (



                    " ".join(



                        words[:index]



                    )



                )







                right = (



                    " ".join(



                        words[index:]



                    )



                )







                left_width = (



                    estimate_text_width(



                        left,



                        min_font,



                    )



                )







                right_width = (



                    estimate_text_width(



                        right,



                        min_font,



                    )



                )







                overflow = max(



                    0,



                    left_width



                    - max_width,



                ) + max(



                    0,



                    right_width



                    - max_width,



                )







                balance = abs(



                    left_width



                    - right_width



                )







                score = (



                    overflow



                    * 10



                    + balance



                )







                if (



                    best_score is None



                    or score



                    < best_score



                ):



                    best_score = (



                        score



                    )







                    best = [



                        left,



                        right,



                    ]







            if best:



                lines = best







    return (



        min_font,



        lines[



            :MAX_SUB_LINES



        ],



    )


_PAGE_BREAK_PUNCT = (".", "!", "?", ";", ":", "…", ",", "—")


def _max_sub_lines_for_layout(font_size: int, blur_height: float) -> int:
    if blur_height > 0 and MAX_SUB_LINES > 1 and (2 * font_size * 1.10) > (blur_height * 0.98):
        return 1
    return max(1, MAX_SUB_LINES)


def subtitle_page_char_limit(font_size: int, max_width: float, max_lines: int) -> int:
    """Cap rendered characters per subtitle screen so font size stays fixed and readable."""
    width_chars = max(14, int(max_width / max(font_size * 0.58, 1.0)))
    per_line_chars = min(width_chars, SUB_MAX_LINE_CHARS if max_lines > 1 else SUB_MAX_LINE_CHARS + 4)
    return max(14, per_line_chars * max(1, max_lines))


def _balance_two_lines(words: list[str], font_size: int, max_width: float, per_line_chars: int) -> list[str]:
    joined = " ".join(words)
    if (
        len(words) <= 1
        or (
            len(joined) <= per_line_chars
            and estimate_text_width(joined, font_size) <= max_width
        )
    ):
        return [joined]

    best = None
    best_score = None
    for index in range(1, len(words)):
        left = " ".join(words[:index])
        right = " ".join(words[index:])
        left_w = estimate_text_width(left, font_size)
        right_w = estimate_text_width(right, font_size)
        overflow = max(0.0, left_w - max_width) + max(0.0, right_w - max_width)
        char_overflow = max(0, len(left) - per_line_chars) + max(0, len(right) - per_line_chars)
        balance = abs(left_w - right_w)
        punct_bonus = 36.0 if words[index - 1].endswith(_PAGE_BREAK_PUNCT) else 0.0
        score = overflow * 20.0 + char_overflow * 40.0 + balance - punct_bonus
        if best_score is None or score < best_score:
            best_score = score
            best = [left, right]
    return best or [joined]


def _page_fits(words: list[str], font_size: int, max_width: float, max_lines: int, char_limit: int) -> bool:
    candidate = " ".join(words)
    if len(candidate) > char_limit:
        return False
    return len(split_words_to_lines(candidate, font_size, max_width)) <= max_lines


def _split_words_into_pages(
    words: list[str],
    font_size: int,
    max_width: float,
    max_lines: int,
    char_limit: int,
) -> list[list[str]]:
    pages: list[list[str]] = []
    idx = 0
    total = len(words)
    while idx < total:
        end = idx + 1
        while end < total and _page_fits(words[idx : end + 1], font_size, max_width, max_lines, char_limit):
            end += 1
        # When more text follows, break cleanly at a clause/sentence punctuation mark
        # inside the back half of the page if available.
        if end < total and end - idx >= 4:
            min_cut = idx + max(2, (end - idx) // 2)
            for probe in range(end - 1, min_cut - 1, -1):
                if words[probe].endswith(_PAGE_BREAK_PUNCT):
                    end = probe + 1
                    break
        pages.append(words[idx:end])
        idx = end

    # Avoid an awkward 1-2 word orphan on the final flash by rebalancing from the prior page.
    if len(pages) >= 2 and len(pages[-1]) <= 2:
        prev_words = pages[-2]
        last_words = pages[-1]
        while len(prev_words) > 3 and len(last_words) < len(prev_words) - 1:
            candidate_last = [prev_words[-1], *last_words]
            if not _page_fits(candidate_last, font_size, max_width, max_lines, char_limit):
                break
            last_words = candidate_last
            prev_words = prev_words[:-1]
            if len(last_words) >= 3:
                break
        pages[-2] = prev_words
        pages[-1] = last_words

    return pages


def paginate_subtitle_cue(
    raw_text: str,
    start_seconds: float,
    end_seconds: float,
    *,
    font_size: int,
    max_width: float,
    blur_height: float,
) -> list[dict]:
    """Keep font size fixed and split dense cues into sequential rapid pages."""
    start_cs = max(0, int(round(float(start_seconds) * 100)))
    end_cs = max(start_cs + 1, int(round(float(end_seconds) * 100)))
    max_lines = _max_sub_lines_for_layout(font_size, blur_height)
    char_limit = subtitle_page_char_limit(font_size, max_width, max_lines)
    per_line_chars = max(14, char_limit // max(1, max_lines))

    explicit_lines = [" ".join(line.split()) for line in str(raw_text or "").splitlines() if line.strip()]
    normalized = " ".join(explicit_lines)
    if not normalized:
        return []

    if (
        1 <= len(explicit_lines) <= max_lines
        and len(normalized) <= char_limit
        and all(
            len(line) <= per_line_chars and estimate_text_width(line, font_size) <= max_width
            for line in explicit_lines
        )
    ):
        return [{"start": start_cs / 100.0, "end": end_cs / 100.0, "lines": explicit_lines}]

    words = normalized.split()
    pages = _split_words_into_pages(words, font_size, max_width, max_lines, char_limit)

    total_cs = end_cs - start_cs
    if len(pages) == 1 or total_cs < len(pages):
        # Too short to split into distinct centisecond frames; emit as one chunk safely.
        lines = (
            _balance_two_lines(words, font_size, max_width, per_line_chars)
            if max_lines >= 2
            else [normalized]
        )
        return [{"start": start_cs / 100.0, "end": end_cs / 100.0, "lines": lines}]

    weights = [max(1, sum(len(w) for w in page)) for page in pages]
    total_weight = sum(weights)
    cursor_cs = start_cs
    accum_weight = 0
    chunks = []
    for index, page_words in enumerate(pages):
        accum_weight += weights[index]
        if index == len(pages) - 1:
            chunk_end_cs = end_cs
        else:
            remaining_pages = len(pages) - 1 - index
            target_cs = start_cs + int(round(total_cs * (accum_weight / total_weight)))
            chunk_end_cs = max(cursor_cs + 1, min(end_cs - remaining_pages, target_cs))
        lines = (
            _balance_two_lines(page_words, font_size, max_width, per_line_chars)
            if max_lines >= 2
            else [" ".join(page_words)]
        )
        chunks.append({
            "start": cursor_cs / 100.0,
            "end": chunk_end_cs / 100.0,
            "lines": lines,
        })
        cursor_cs = chunk_end_cs
    return chunks











# =========================================================



# ASS



# =========================================================







def create_ass(region):







    subtitles = (



        read_srt(



            SRT_PATH



        )



    )







    if not subtitles:



        print("[SKIP] Khong co subtitle Viet, tao ASS rong de giu video goc.")







    layout = (



        normalize_region(



            region



        )



    )







    video = (



        layout[



            "video"



        ]



    )







    blur = (



        layout[



            "blur"



        ]



    )







    subtitle = (



        layout[



            "subtitle"



        ]



    )







    width = int(



        video[



            "width"



        ]



    )







    height = int(



        video[



            "height"



        ]



    )







    blur_width = int(



        blur[



            "width"



        ]



    )







    blur_height = int(



        blur[



            "height"



        ]



    )







    sub_x = int(



        subtitle[



            "x"



        ]



    )







    sub_y = int(



        subtitle[



            "y"



        ]



    )







    font_size = (
        int(FONT_SIZE_OVERRIDE)
        if FONT_SIZE_OVERRIDE
        else base_font_size(



            width,



            height,



            blur_width,



            blur_height,



        )
    )







    outline = max(



        2,



        min(



            5,



            int(



                round(



                    min(



                        width,



                        height,



                    )



                    / 360



                )



            ),



        ),



    )







    max_text_width = (



        blur_width



        * SUB_MAX_WIDTH_RATIO



    )







    bold = (



        -1



        if FONT_BOLD



        else 0



    )







    brand_box = (



        get_bilibili_brand_box(



            width,



            height,



        )



    )







    if brand_box:



        brand_x = int(



            brand_box["x"]



            + 18



        )







        brand_y = int(



            brand_box["y"]



            + max(14, int(brand_box["height"] * 0.18))



        )







        brand_font_size = (



            get_bilibili_brand_font_size(



                width,



                height,



                brand_box["height"],



            )



        )



    else:



        brand_x = 0



        brand_y = 0



        brand_font_size = 36







    style_profile = {
        "minimal": ("&H00FFFFFF", "&H00101010", "&H80000000", 1, outline, 0, bold),
        "bold": ("&H00FFFFFF", "&H000A0A0A", "&H80000000", 1, max(3, outline + 1), 0, -1),
        "cinema": ("&H00E9F3FF", "&H00181818", "&H80000000", 1, max(2, outline - 1), 2, 0),
        "neon": ("&H007346FF", "&H0020102A", "&H80000000", 1, outline, 2, -1),
        "box": ("&H00FFFFFF", "&H00101010", "&H99101010", 3, 1, 0, -1),
    }.get(SUBTITLE_STYLE, ("&H00FFFFFF", "&H00101010", "&H80000000", 1, outline, 0, bold))
    primary_color, outline_color, back_color, border_style, style_outline, shadow, style_bold = style_profile

    header = f"""[Script Info]



Title: Reup AI Vietnamese Subtitle



ScriptType: v4.00+



PlayResX: {width}



PlayResY: {height}



ScaledBorderAndShadow: yes



WrapStyle: 0



YCbCr Matrix: TV.709







[V4+ Styles]



Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding



Style: Default,{FONT_NAME},{font_size},{primary_color},&H000000FF,{outline_color},{back_color},{style_bold},0,0,0,100,100,0,0,{border_style},{style_outline},{shadow},5,24,24,10,1



Style: Brand,{FONT_NAME},{brand_font_size},&H00FFFFFF,&H000000FF,&H00202020,&H00000000,-1,0,0,0,100,100,0,0,1,3,0,7,10,10,10,1



Style: SecondarySub,{FONT_NAME},{max(16, int(font_size * 0.85))},&H00FFFFFF,&H000000FF,&H00121214,&HB8000000,-1,0,0,0,100,100,0,0,3,6,0,5,16,16,10,1







[Events]



Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text



"""







    events = []







    if brand_box and BILIBILI_BRAND_TEXT:



        brand_text = (



            escape_ass_text(



                BILIBILI_BRAND_TEXT



            )



        )







        # Layer 10 de brand nam tren panel, nhung van tach voi sub Viet.



        events.append(



            "Dialogue: 10,"



            "0:00:00.00,"



            "99:59:59.99,"



            "Brand,,0,0,0,,"



            r"{\an7"



            f"\\pos("



            f"{brand_x},"



            f"{brand_y}"



            f")"



            r"}"



            f"{brand_text}"



        )







    print()



    print(



        "=================================="



    )



    print(



        "AUTO SUBTITLE LAYOUT"



    )



    print(



        "=================================="



    )



    print(



        f"Video      : "



        f"{width}x{height}"



    )



    print(



        f"Blur       : "



        f"x={blur['x']} "



        f"y={blur['y']} "



        f"w={blur_width} "



        f"h={blur_height}"



    )



    print(



        f"Subtitle   : "



        f"x={sub_x} "



        f"y={sub_y}"



    )



    print(



        f"Base font  : "



        f"{font_size}"



    )



    print(



        f"Max width  : "



        f"{int(max_text_width)}"



    )



    print(



        f"Sub count  : "



        f"{len(subtitles)}"



    )







    if brand_box:



        print(



            f"Brand      : "



            f"{BILIBILI_BRAND_TEXT}"



        )



        print(



            f"Brand text : "



            f"x={brand_box['x']} "



            f"y={brand_box['y']} "



            f"w={brand_box['width']} "



            f"h={brand_box['height']}"



        )







    print(



        "=================================="



    )







    for item in subtitles:
        start_seconds = srt_time_to_seconds(item["start"])
        end_seconds = srt_time_to_seconds(item["end"])
        raw_text = item["text"]
        pages = paginate_subtitle_cue(
            raw_text,
            start_seconds,
            end_seconds,
            font_size=font_size,
            max_width=max_text_width,
            blur_height=blur_height,
        )
        for page in pages:
            start = _format_ass_time(page["start"])
            end = _format_ass_time(page["end"])
            escaped_lines = [escape_ass_text(line) for line in page["lines"]]
            text = r"\N".join(escaped_lines)
            # \an5 = center, \q2 = explicit balanced wrapping at fixed \fs{font_size}.
            override = (
                r"{\an5"
                f"\\pos({sub_x},{sub_y})"
                f"\\fs{font_size}"
                r"\q2}"
            )
            events.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{override}{text}")

    if SECONDARY_SUBTITLES:
        sec_reg = SECONDARY_SUB_REGION if isinstance(SECONDARY_SUB_REGION, dict) else {}
        sec_w = float(sec_reg.get("width") or 0)
        sec_h = float(sec_reg.get("height") or 0)
        sec_x = float(sec_reg.get("x") or 0)
        sec_y = float(sec_reg.get("y") or 0)
        if 0 < sec_w <= 1.0 and 0 < sec_h <= 1.0 and sec_x <= 1.0 and sec_y <= 1.0:
            sec_x *= width
            sec_y *= height
            sec_w *= width
            sec_h *= height
        if sec_w > 0 and sec_h > 0:
            sec_cx = int(clamp(round(sec_x + sec_w / 2.0), 40, max(40, width - 40)))
            sec_cy = int(clamp(round(sec_y + sec_h / 2.0), 28, max(28, height - 28)))
        else:
            sec_cx = width // 2
            sec_cy = max(36, int(round(height * 0.14)))

        for sec_item in SECONDARY_SUBTITLES:
            if not isinstance(sec_item, dict):
                continue
            sec_text = str(sec_item.get("translated_text") or sec_item.get("text") or "").strip()
            if not sec_text:
                continue
            try:
                sec_start = max(0.0, float(sec_item.get("start") or 0.0))
                sec_end = float(sec_item.get("end") or 0.0)
            except (TypeError, ValueError):
                continue
            if sec_end <= sec_start:
                continue
            events.append(
                f"Dialogue: 1,{ass_time(sec_start)},{ass_time(sec_end)},SecondarySub,,0,0,0,,"
                f"{{\\pos({sec_cx},{sec_cy})}}{escape_ass_text(sec_text)}"
            )

    ass_path = Path(



        ASS_PATH



    )







    ass_path.parent.mkdir(



        parents=True,



        exist_ok=True,



    )







    ass_path.write_text(



        header



        + "\n".join(



            events



        )



        + "\n",



        encoding="utf-8",



    )







    print(



        "\nASS:"



    )







    print(



        ASS_PATH



    )







    return layout











# =========================================================



# VIDEO FILTER



# =========================================================







def _safe_boxblur_filter(width, height, requested_radius, power=2):
    """Return a boxblur filter that is valid for YUV video planes.

    FFmpeg applies ``boxblur`` to chroma planes too.  With common 4:2:0
    sources those planes are half-resolution, so a radius that is valid for
    the visible crop can still be invalid for a short subtitle strip.  Keep
    the requested strength whenever it fits, and clamp it from the crop's
    actual dimensions otherwise.  This makes the render independent of the
    source aspect ratio and of the size selected in the editor.
    """
    try:
        minimum_dimension = min(int(width), int(height))
        requested = max(0, int(requested_radius))
        blur_power = max(1, int(power))
    except (TypeError, ValueError):
        return "boxblur=0:1"

    # Chroma is subsampled in both dimensions for yuv420p.  FFmpeg requires
    # the chroma radius to remain strictly below its calculated limit.
    maximum_safe_radius = max(0, (minimum_dimension // 4) - 1)
    radius = min(requested, maximum_safe_radius)
    return f"boxblur={radius}:{blur_power}"


def build_video_filter(
    region,
    logo_input_index=None,
    logo_is_prepared=False,
):

    layout = normalize_region(region)
    video = layout["video"]
    blur = layout["blur"]

    video_width = int(video["width"])
    video_height = int(video["height"])

    x = int(blur["x"])
    y = int(blur["y"])
    width = int(blur["width"])
    height = int(blur["height"])

    ass = ffmpeg_filter_path(ASS_PATH)
    platform = detect_source_platform()

    brand_blur_boxes = get_bilibili_text_blur_boxes(
        video_width,
        video_height,
    )

    resolved_logo_path = get_bilibili_logo_path()
    logo_layout = get_bilibili_logo_layout(
        video_width,
        video_height,
        logo_path=resolved_logo_path,
    )

    parts = []

    # 1) Blur subtitle Trung goc
    if layout.get("blur_enabled", True) and width > 0 and height > 0:
        parts.extend([
            "[0:v]split=2[base][crop_src]",
            f"[crop_src]crop={width}:{height}:{x}:{y},"
            f"{_safe_boxblur_filter(width, height, BLUR_RADIUS, BLUR_POWER)},"
            "format=yuv420p[blurred]",
            # Force matching pixel formats before overlay. Some source codecs
            # are decoded as 10-bit/4:2:2 while NVENC later requests yuv420p;
            # implicit overlay negotiation can otherwise produce green blocks.
            f"[base]format=yuv420p[base_420]",
            f"[base_420][blurred]overlay={x}:{y}:format=yuv420[clean_sub]",
        ])
        current = "clean_sub"
    else:
        parts.append("[0:v]null[clean_sub]")
        current = "clean_sub"

    # 2) Blur watermark / UID / @username Bilibili
    if brand_blur_boxes:
        for index, box in enumerate(brand_blur_boxes, start=1):
            bx = int(box["x"])
            by = int(box["y"])
            bw = int(box["width"])
            bh = int(box["height"])

            src_label = f"wm_src_{index}"
            crop_label = f"wm_crop_{index}"
            blur_label = f"wm_blur_{index}"
            out_label = f"wm_out_{index}"

            parts.extend([
                f"[{current}]split=2[{src_label}][{crop_label}]",
                f"[{crop_label}]crop={bw}:{bh}:{bx}:{by},"
                f"{_safe_boxblur_filter(bw, bh, 14, 2)},format=yuv420p[{blur_label}]",
                f"[{src_label}]format=yuv420p[{src_label}_420]",
                f"[{src_label}_420][{blur_label}]overlay={bx}:{by}:format=yuv420[{out_label}]",
            ])
            current = out_label

    # 2b) Additional blur-only intervals selected in the web editor.
    for interval_index, interval in enumerate(BLUR_INTERVALS or [], start=1):
        try:
            start = max(0.0, float(interval.get("start", 0)))
            end = max(start, float(interval.get("end", 0)))
            bx = max(0, int(float(interval.get("x", 0))))
            by = max(0, int(float(interval.get("y", 0))))
            bw = max(1, int(float(interval.get("width", video_width))))
            bh = max(1, int(float(interval.get("height", video_height))))
        except (TypeError, ValueError):
            continue
        bw = min(bw, video_width - bx)
        bh = min(bh, video_height - by)
        if end <= start or bw <= 0 or bh <= 0:
            continue
        src_label = f"interval_src_{interval_index}"
        crop_label = f"interval_crop_{interval_index}"
        blur_label = f"interval_blur_{interval_index}"
        out_label = f"interval_out_{interval_index}"
        parts.extend([
            f"[{current}]split=2[{src_label}][{crop_label}]",
            f"[{crop_label}]crop={bw}:{bh}:{bx}:{by},"
            f"{_safe_boxblur_filter(bw, bh, 20, 2)},format=yuv420p[{blur_label}]",
            f"[{src_label}]format=yuv420p[{src_label}_420]",
            f"[{src_label}_420][{blur_label}]overlay={bx}:{by}:format=yuv420:enable='between(t,{start},{end})'[{out_label}]",
        ])
        current = out_label

    # 3) Chen logo kenh (hinh chu nhat / vuong / tron tuy chon)
    if logo_input_index is not None:
        lx = int(logo_layout["x"])
        ly = int(logo_layout["y"])
        logo_size = int(logo_layout["size"])
        logo_w = int(logo_layout["width"])
        logo_h = int(logo_layout["height"])
        logo_shape = logo_layout.get("shape", "rect")

        if logo_is_prepared:
            parts.append(
                f"[{logo_input_index}:v]format=rgba[channel_logo]"
            )
        elif logo_shape == "circle":
            parts.append(
                f"[{logo_input_index}:v]"
                f"scale={logo_size}:{logo_size}:force_original_aspect_ratio=increase,"
                f"crop={logo_size}:{logo_size},format=rgba,"
                f"geq="
                f"r='r(X,Y)':"
                f"g='g(X,Y)':"
                f"b='b(X,Y)':"
                f"a='if(lte((X-W/2)*(X-W/2)+(Y-H/2)*(Y-H/2),(W/2)*(W/2)),255,0)'"
                f"[channel_logo]"
            )
        else:
            parts.append(
                f"[{logo_input_index}:v]"
                f"scale={logo_w}:{logo_h}:force_original_aspect_ratio=decrease,"
                f"format=rgba[channel_logo]"
            )

        parts.append(
            f"[{current}][channel_logo]"
            f"overlay=x={lx}:y={ly}:format=auto:shortest=1[with_logo]"
        )
        current = "with_logo"

    if LOGO_MODE == "text" and LOGO_TEXT:
        text_value = str(LOGO_TEXT).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
        text_label = "with_text_logo"
        parts.append(
            f"[{current}]drawtext=text='{text_value}':"
            f"x={logo_layout['x']}:y={logo_layout['y']}:"
            f"fontsize={max(18, int(logo_layout['size'] * 0.28))}:"
            f"fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=8[{text_label}]"
        )
        current = text_label

    # 4) Burn sub Viet
    if OUTPUT_ASPECT_RATIO in {"shorts", "tiktok"}:
        target_width, target_height = 1080, 1920
    elif OUTPUT_ASPECT_RATIO == "facebook":
        target_width, target_height = 1080, 1350
    elif OUTPUT_ASPECT_RATIO == "youtube":
        target_width, target_height = 1920, 1080
    else:
        target_width = target_height = None

    subtitle_label = "subtitled"
    parts.append(
        f"[{current}]subtitles=filename='{ass}'[{subtitle_label}]"
    )

    needs_output_resize = (
        target_width
        and target_height
        and (
            video_width != target_width
            or video_height != target_height
        )
    )

    if needs_output_resize:
        target_ratio = target_width / target_height
        source_ratio = video_width / video_height
        if source_ratio > target_ratio:
            crop_width = int(video_height * target_ratio)
            crop_height = video_height
            crop_x = max(0, (video_width - crop_width) // 2)
            crop_y = 0
        else:
            crop_width = video_width
            crop_height = int(video_width / target_ratio)
            crop_x = 0
            crop_y = max(0, (video_height - crop_height) // 2)
        parts.append(
            f"[{subtitle_label}]crop={crop_width}:{crop_height}:{crop_x}:{crop_y},"
            f"scale={target_width}:{target_height}[vout]"
        )
    else:
        parts.append(f"[{subtitle_label}]null[vout]")

    print()
    print("==================================")
    print("VIDEO CLEANUP")
    print("==================================")
    print(f"Platform   : {platform}")
    print(f"Sub blur   : x={x} y={y} w={width} h={height}")

    if brand_blur_boxes:
        print(f"Watermark  : {len(brand_blur_boxes)} vung blur")

    if logo_input_index is not None:
        print(f"Logo       : {LOGO_PATH_OVERRIDE or BILIBILI_LOGO_PATH}")
        print(
            f"Logo pos   : x={logo_layout['x']} y={logo_layout['y']} "
            f"{logo_layout['width']}x{logo_layout['height']} ({logo_layout.get('shape', 'rect')})"
        )

    print("==================================")
    return ";".join(parts)


def prepare_round_logo(source_path, output_dir, size, *, width=None, height=None, shape="rect"):
    """Resize (and optionally circle-mask) a logo once instead of running geq per frame."""
    from PIL import Image, ImageChops, ImageDraw, ImageOps

    source = Path(source_path)
    normalized_shape = "circle" if str(shape or "rect").strip().lower() == "circle" else "rect"
    target_w = max(1, int(width or size))
    target_h = max(1, int(height or size))
    target = Path(output_dir) / f".reupai_logo_{normalized_shape}_{target_w}x{target_h}.png"
    if (
        target.exists()
        and target.stat().st_size > 0
        and target.stat().st_mtime_ns >= source.stat().st_mtime_ns
    ):
        return target

    with Image.open(source) as image:
        rgba = image.convert("RGBA")
        if normalized_shape == "circle":
            circle_size = max(1, int(size or min(target_w, target_h)))
            fitted = ImageOps.fit(
                rgba,
                (circle_size, circle_size),
                method=Image.Resampling.LANCZOS,
                centering=(0.5, 0.5),
            )
            circle = Image.new("L", fitted.size, 0)
            ImageDraw.Draw(circle).ellipse(
                (0, 0, fitted.width - 1, fitted.height - 1),
                fill=255,
            )
            circle = ImageChops.multiply(fitted.getchannel("A"), circle)
            fitted.putalpha(circle)
        else:
            fitted = ImageOps.contain(
                rgba,
                (target_w, target_h),
                method=Image.Resampling.LANCZOS,
            )
        fitted.save(target, "PNG", optimize=True)
    return target


# =========================================================

# FFMPEG FALLBACK

# =========================================================



def _replace_video_encoder_with_cpu(command):



    command = list(command)



    try:



        start = command.index(

            "-c:v"

        )



        end = command.index(

            "-c:a",

            start + 2,

        )



    except ValueError:



        return command



    cpu_args = [

        "-c:v",

        "libx264",



        "-preset",
        "superfast" if os.getenv("REUP_BOOST_GPU", "").strip() == "1" or not _is_stability_mode() else "veryfast",



        "-crf",

        "23",



        "-pix_fmt",

        "yuv420p",

    ]



    return (

        command[:start]

        + cpu_args

        + command[end:]

    )





def _replace_audio_copy_with_aac(command):



    command = list(command)



    try:



        index = command.index(

            "-c:a"

        )



    except ValueError:



        return command



    if (

        index + 1

        >= len(command)

        or command[index + 1]

        != "copy"

    ):



        return command



    return (

        command[:index]

        + [

            "-c:a",

            "aac",



            "-b:a",

            "160k",



            "-ar",

            "44100",

        ]

        + command[index + 2:]

    )





def _ffmpeg_error_tail(text, lines=35):



    text = str(

        text

        or ""

    ).strip()



    if not text:



        return "(FFmpeg khong tra stderr.)"



    rows = text.splitlines()



    return "\n".join(

        rows[-lines:]

    )





def run_ffmpeg_with_fallback(

    command,

    *,

    use_voice,

):



    """

    Thu theo thu tu:

    1. Command hien tai.

    2. Neu NVENC loi -> CPU libx264.

    3. Neu subtitle mode + audio copy loi -> encode AAC.



    Nhờ vậy UI không chỉ trả CalledProcessError mơ hồ.

    """



    attempts = []

    # The filter graph below uses software filters (crop, boxblur, overlay,
    # libass). Decoding into CUDA surfaces and implicitly downloading them can
    # corrupt the second half of an overlaid crop on some driver/FFmpeg pairs,
    # producing a bright green rectangle behind subtitles. Decode in software
    # and keep NVENC for the expensive encoding stage.



    def add_attempt(

        name,

        cmd,

    ):



        signature = tuple(

            str(value)

            for value in cmd

        )



        for _, old in attempts:



            if tuple(

                str(value)

                for value in old

            ) == signature:



                return



        attempts.append(

            (

                name,

                list(cmd),

            )

        )



    add_attempt(

        "original",

        command,

    )



    if "h264_nvenc" in command:
        software_decode_command = list(command)
        try:
            hwaccel_index = software_decode_command.index("-hwaccel")
            if software_decode_command[hwaccel_index + 1] == "cuda":
                del software_decode_command[hwaccel_index:hwaccel_index + 2]
        except (ValueError, IndexError):
            pass
        add_attempt("software_decode_nvenc", software_decode_command)

        cpu_command = (

            _replace_video_encoder_with_cpu(

                software_decode_command

            )

        )



        add_attempt(

            "cpu_fallback",

            cpu_command,

        )



    else:



        cpu_command = list(

            command

        )



    if not use_voice:



        # MP4 khong phai luc nao cung copy duoc audio codec nguon

        # (vi du Opus). Neu copy fail thi encode AAC.

        add_attempt(

            "audio_aac_fallback",

            _replace_audio_copy_with_aac(

                cpu_command

            ),

        )



    errors = []



    for attempt_index, (

        name,

        current_command,

    ) in enumerate(

        attempts,

        start=1,

    ):



        current_command = list(current_command)
        if "-nostdin" not in current_command:
            current_command.insert(1, "-nostdin")



        print()

        print(

            "=================================="

        )

        print(

            f"FFMPEG ATTEMPT "

            f"{attempt_index}/"

            f"{len(attempts)}"

            f" - {name}"

        )

        print(

            "=================================="

        )



        print(

            " ".join(

                str(value)

                for value

                in current_command

            )

        )



        result = subprocess.run(

            current_command,

            stdout=subprocess.PIPE,

            stderr=subprocess.PIPE,

            text=True,

            encoding="utf-8",

            errors="replace",

            check=False,



            **_detached_media_process_kwargs(),

        )



        if result.returncode == 0:



            if attempt_index > 1:



                print()

                print(

                    "[RECOVERED] "

                    f"FFmpeg thanh cong bang "

                    f"{name}."

                )



            return



        error_text = (

            _ffmpeg_error_tail(

                result.stderr

            )

        )



        errors.append(

            (

                name,

                result.returncode,

                error_text,

            )

        )



        print()

        print(

            f"[FFMPEG ERROR] "

            f"{name} "

            f"return code "

            f"{result.returncode}"

        )

        print(

            error_text

        )



    summary = []



    for name, return_code, error_text in errors:



        summary.append(

            "\n"

            + "=" * 60

            + "\n"

            + f"{name} "

            + f"(code={return_code})"

            + "\n"

            + error_text

        )



    raise RuntimeError(

        "FFmpeg render that bai sau "

        "tat ca fallback:"

        + "".join(

            summary

        )

    )





# =========================================================



# RENDER



# =========================================================







def _is_stability_mode():
    return (
        str(os.getenv("REUP_STABILITY_MODE", "")).strip().lower() in {"1", "true", "yes", "on"}
        or str(os.getenv("REUP_OFFLINE_MODE", "")).strip().lower() in {"1", "true", "yes", "on"}
    )


def _probe_media_duration(path):
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=25,
            check=False,
            **_detached_media_process_kwargs(),
        )
        value = float((result.stdout or "").strip())
        return value if math.isfinite(value) and value > 0 else 0.0
    except (OSError, subprocess.SubprocessError, ValueError):
        return 0.0


def _probe_has_audio(path):
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=codec_type",
                "-of",
                "csv=p=0",
                str(path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
            check=False,
            **_detached_media_process_kwargs(),
        )
        return result.returncode == 0 and "audio" in (result.stdout or "")
    except (OSError, subprocess.SubprocessError):
        return True


def _parse_ass_time(text: str) -> float | None:
    match = re.match(r"^\s*(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,2})\s*$", text or "")
    if not match:
        return None
    hours, minutes, seconds, centis = (int(group) for group in match.groups())
    return hours * 3600.0 + minutes * 60.0 + seconds + centis / 100.0


def _format_ass_time(seconds: float) -> str:
    clamped = max(0.0, float(seconds))
    total_centis = int(round(clamped * 100))
    centis = total_centis % 100
    total_secs = total_centis // 100
    secs = total_secs % 60
    mins = (total_secs // 60) % 60
    hours = total_secs // 3600
    return f"{hours}:{mins:02d}:{secs:02d}.{centis:02d}"


def _slice_ass_file(source_ass: str | Path, target_ass: str | Path, seg_start: float, seg_end: float) -> None:
    """Copy ASS headers/styles and emit events overlapping [seg_start, seg_end) shifted to 0."""
    lines = Path(source_ass).read_text(encoding="utf-8-sig").splitlines()
    out_lines: list[str] = []
    seg_dur = max(0.05, seg_end - seg_start)
    for line in lines:
        if line.startswith("Dialogue:"):
            parts = line[9:].split(",", 9)
            if len(parts) < 10:
                continue
            ev_start = _parse_ass_time(parts[1])
            ev_end = _parse_ass_time(parts[2])
            if ev_start is None or ev_end is None:
                continue
            if ev_end <= seg_start or ev_start >= seg_end:
                continue
            parts[1] = _format_ass_time(max(0.0, ev_start - seg_start))
            parts[2] = _format_ass_time(min(seg_dur, ev_end - seg_start))
            out_lines.append("Dialogue:" + ",".join(parts))
        else:
            out_lines.append(line)
    Path(target_ass).write_text("\n".join(out_lines) + "\n", encoding="utf-8-sig")


def _render_checkpoint_signature(region, mode: str, use_voice: bool, use_music: bool, use_logo: bool) -> str:
    def _file_sig(path_value) -> str:
        if not path_value:
            return ""
        try:
            st = Path(path_value).stat()
            return f"{Path(path_value).name}:{st.st_size}:{st.st_mtime_ns}"
        except OSError:
            return ""

    ass_digest = ""
    try:
        ass_digest = hashlib.sha256(Path(ASS_PATH).read_bytes()).hexdigest()[:16]
    except OSError:
        pass

    payload = {
        "schema": 1,
        "video": _file_sig(VIDEO_PATH),
        "voice": _file_sig(VOICE_PATH) if use_voice else "",
        "music": _file_sig(MUSIC_PATH) if use_music else "",
        "ass": ass_digest,
        "mode": mode,
        "region": normalize_region(region),
        "aspect": OUTPUT_ASPECT_RATIO,
        "orig_vol": float(ORIGINAL_VOLUME),
        "voice_vol": float(VOICE_VOLUME),
        "music_vol": float(MUSIC_VOLUME),
        "blur_intervals": BLUR_INTERVALS or [],
        "auto_brand": bool(AUTO_BRAND_BLUR_ENABLED),
        "logo_mode": LOGO_MODE,
        "logo_shape": LOGO_SHAPE,
        "logo_size": LOGO_SIZE_OVERRIDE,
        "logo_width": LOGO_WIDTH_OVERRIDE,
        "logo_height": LOGO_HEIGHT_OVERRIDE,
        "logo_x": LOGO_X_OVERRIDE,
        "logo_y": LOGO_Y_OVERRIDE,
        "logo_text": LOGO_TEXT,
        "use_logo": bool(use_logo),
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _segment_video_ok(path: Path) -> bool:
    if not file_ok(path) or path.stat().st_size < 1024:
        return False
    return _probe_media_duration(path) > 0.05


def _render_segmented_long_video(
    region,
    *,
    mode: str,
    duration_sec: float,
    chunk_seconds: int,
    use_voice: bool,
    use_music: bool,
    use_logo: bool,
    logo_path,
    logo_is_prepared: bool,
    output_path: Path,
) -> bool:
    """Render long multi-hour videos in resumable segments and stream-concat at the end."""
    global ASS_PATH, BLUR_INTERVALS

    chunk_dir = output_path.with_name(f"{output_path.stem}.render_chunks")
    ckpt_path = chunk_dir / "checkpoint.json"
    signature = _render_checkpoint_signature(region, mode, use_voice, use_music, use_logo)

    reuse = False
    if ckpt_path.is_file():
        try:
            saved = json.loads(ckpt_path.read_text(encoding="utf-8"))
            reuse = isinstance(saved, dict) and saved.get("signature") == signature and int(saved.get("chunk_seconds", 0)) == chunk_seconds
        except (OSError, ValueError):
            reuse = False

    if not reuse and chunk_dir.exists():
        shutil.rmtree(chunk_dir, ignore_errors=True)
    chunk_dir.mkdir(parents=True, exist_ok=True)
    if not reuse:
        try:
            tmp_ckpt = chunk_dir / "checkpoint.json.tmp"
            tmp_ckpt.write_text(json.dumps({"signature": signature, "chunk_seconds": chunk_seconds, "duration": duration_sec}), encoding="utf-8")
            os.replace(tmp_ckpt, ckpt_path)
        except OSError:
            pass

    total_chunks = max(1, int(math.ceil(duration_sec / chunk_seconds)))
    seg_files: list[Path] = []
    source_has_audio = _probe_has_audio(VIDEO_PATH)
    orig_ass_path = ASS_PATH
    orig_blur_intervals = list(BLUR_INTERVALS or [])

    print()
    print("==================================")
    print(f"SEGMENTED RENDER ({total_chunks} DOAN · {chunk_seconds}s/DOAN · CO CHECKPOINT)")
    print("==================================")

    try:
        for idx in range(total_chunks):
            seg_start = idx * chunk_seconds
            seg_end = min(duration_sec, seg_start + chunk_seconds)
            seg_dur = seg_end - seg_start
            if seg_dur <= 0.02:
                continue

            seg_path = chunk_dir / f"seg_{idx:05d}.mp4"
            seg_tmp = chunk_dir / f"seg_{idx:05d}.tmp.mp4"
            if reuse and _segment_video_ok(seg_path):
                seg_files.append(seg_path)
                print(f"[CHECKPOINT] Bo qua doan render {idx + 1}/{total_chunks} ({seg_end / 60:.1f}/{duration_sec / 60:.1f} phut)")
                if callable(RENDER_PROGRESS_CALLBACK):
                    RENDER_PROGRESS_CALLBACK(seg_end, duration_sec)
                continue

            seg_ass = chunk_dir / f"seg_{idx:05d}.ass"
            _slice_ass_file(orig_ass_path, seg_ass, seg_start, seg_end)

            shifted_intervals = []
            for item in orig_blur_intervals:
                try:
                    iv_start = float(item.get("start", 0))
                    iv_end = float(item.get("end", 0))
                except (TypeError, ValueError):
                    continue
                if iv_end <= seg_start or iv_start >= seg_end:
                    continue
                shifted_intervals.append({
                    **item,
                    "start": max(0.0, iv_start - seg_start),
                    "end": min(seg_dur, iv_end - seg_start),
                })

            ASS_PATH = str(seg_ass)
            BLUR_INTERVALS = shifted_intervals

            logo_input_index = ((2 if use_voice else 1) + (1 if use_music else 0)) if use_logo else None
            seg_video_filter = build_video_filter(
                region,
                logo_input_index=logo_input_index,
                logo_is_prepared=logo_is_prepared,
            )

            cmd = [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "warning",
                "-ss", f"{seg_start:.3f}", "-t", f"{seg_dur:.3f}", "-i", str(VIDEO_PATH),
            ]
            if use_voice:
                cmd.extend(["-ss", f"{seg_start:.3f}", "-t", f"{seg_dur:.3f}", "-i", str(VOICE_PATH)])
            if use_music:
                cmd.extend(["-stream_loop", "-1", "-i", str(MUSIC_PATH)])
            if use_logo:
                cmd.extend(["-loop", "1", "-i", str(logo_path)])

            seg_use_voice = use_voice
            if seg_use_voice:
                music_index = 2
                music_filter = (
                    f"[{music_index}:a]volume={float(MUSIC_VOLUME)}[music];"
                    "[original][voice][music]amix=inputs=3:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.97[aout]"
                    if use_music
                    else "[original][voice]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.97[aout]"
                )
                audio_part = (
                    f"[0:a]volume={float(ORIGINAL_VOLUME)}[original];"
                    f"[1:a]volume={float(VOICE_VOLUME)}[voice];"
                    + music_filter
                )
                filter_complex = f"{seg_video_filter};{audio_part}"
            elif use_music:
                music_filter = (
                    f"[1:a]volume={float(MUSIC_VOLUME)}[music];"
                    "[0:a][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.97[aout]"
                    if source_has_audio
                    else f"[1:a]volume={float(MUSIC_VOLUME)},alimiter=limit=0.97[aout]"
                )
                filter_complex = f"{seg_video_filter};{music_filter}"
                seg_use_voice = True
            else:
                filter_complex = seg_video_filter

            cmd.extend(["-filter_complex", filter_complex, "-map", "[vout]"])
            if seg_use_voice:
                cmd.extend(["-map", "[aout]"])
            elif source_has_audio:
                cmd.extend(["-map", "0:a?"])

            if ffmpeg_has_nvenc():
                cmd.extend([
                    "-c:v", "h264_nvenc",
                    "-preset", NVENC_PRESET,
                    "-tune", NVENC_TUNE,
                    "-rc", "constqp",
                    "-qp", NVENC_QP,
                    "-bf", NVENC_BFRAMES,
                    "-pix_fmt", "yuv420p",
                ])
            else:
                cmd.extend(["-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p"])
                if _is_stability_mode():
                    cmd.extend(["-threads", "4"])

            if seg_use_voice or source_has_audio:
                cmd.extend(["-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2"])

            cmd.extend([
                "-t", f"{seg_dur:.3f}",
                "-video_track_timescale", "90000",
                str(seg_tmp),
            ])
            print(f"\n[RENDER SEGMENT {idx + 1}/{total_chunks}] {seg_start / 60:.1f} -> {seg_end / 60:.1f} phut")
            seg_tmp.unlink(missing_ok=True)
            run_ffmpeg_with_fallback(cmd, use_voice=seg_use_voice)
            if not _segment_video_ok(seg_tmp):
                raise RuntimeError(f"Doan render {idx + 1}/{total_chunks} bi hong hoac rong.")
            os.replace(seg_tmp, seg_path)
            seg_files.append(seg_path)
            seg_ass.unlink(missing_ok=True)
            gc.collect()
            if callable(RENDER_PROGRESS_CALLBACK):
                RENDER_PROGRESS_CALLBACK(seg_end, duration_sec)
    finally:
        ASS_PATH = orig_ass_path
        BLUR_INTERVALS = orig_blur_intervals

    concat_list = chunk_dir / "concat.txt"
    concat_list.write_text(
        "".join(f"file '{path.resolve().as_posix()}'\n" for path in seg_files),
        encoding="utf-8",
    )
    final_tmp = output_path.with_name(f"{output_path.stem}.concat.tmp{output_path.suffix}")
    final_tmp.unlink(missing_ok=True)
    concat_result = subprocess.run(
        [
            "ffmpeg", "-y", "-nostdin", "-hide_banner", "-loglevel", "warning",
            "-f", "concat", "-safe", "0", "-i", str(concat_list),
            "-c", "copy", "-movflags", "+faststart",
            str(final_tmp),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
        **_detached_media_process_kwargs(),
    )
    if concat_result.returncode != 0 or not file_ok(final_tmp):
        final_tmp.unlink(missing_ok=True)
        raise RuntimeError("Ghep cac doan render that bai: " + _ffmpeg_error_tail(concat_result.stderr))
    os.replace(final_tmp, output_path)
    shutil.rmtree(chunk_dir, ignore_errors=True)
    return True


def render_final(region):







    if not file_ok(



        VIDEO_PATH



    ):



        raise FileNotFoundError(



            "Khong tim thay video: "



            + str(



                VIDEO_PATH



            )



        )







    # Luon tao lai ASS de dam bao



    # dung resolution / aspect ratio hien tai.



    create_ass(



        region



    )







    output_path = Path(



        OUTPUT_PATH



    )







    output_path.parent.mkdir(



        parents=True,



        exist_ok=True,



    )







    mode = (



        get_render_mode()



    )







    use_voice = (



        mode



        == "voiceover"



        and file_ok(



            VOICE_PATH



        )



    )







    print(



        f"\nRender mode: "



        f"{mode}"



    )







    if (



        mode



        == "voiceover"



        and not use_voice



    ):



        raise FileNotFoundError(



            "Voiceover mode nhung "



            "khong tim thay: "



            + str(



                VOICE_PATH



            )



        )
    logo_path = get_bilibili_logo_path()

    use_logo = (
        logo_path is not None
        and file_ok(logo_path)
    )

    logo_is_prepared = False
    if use_logo:
        try:
            normalized = normalize_region(region)
            video_layout = normalized["video"]
            logo_layout = get_bilibili_logo_layout(
                int(video_layout["width"]),
                int(video_layout["height"]),
                logo_path=logo_path,
            )
            logo_path = prepare_round_logo(
                logo_path,
                output_path.parent,
                int(logo_layout["size"]),
                width=int(logo_layout["width"]),
                height=int(logo_layout["height"]),
                shape=logo_layout.get("shape", "rect"),
            )
            logo_is_prepared = True
        except Exception as exc:
            print(f"[WARN] Khong cache duoc logo, dung filter cu: {exc}")

    use_music = bool(MUSIC_PATH and file_ok(MUSIC_PATH))

    try:
        chunk_seconds = max(120, int(os.getenv("REUP_RENDER_CHUNK_SECONDS", "600")))
    except ValueError:
        chunk_seconds = 600
    long_threshold = 300 if _is_stability_mode() else 1800
    duration_sec = 0.0 if PREVIEW_SECONDS else _probe_media_duration(VIDEO_PATH)
    if not PREVIEW_SECONDS and duration_sec >= long_threshold:
        _render_segmented_long_video(
            region,
            mode=mode,
            duration_sec=duration_sec,
            chunk_seconds=chunk_seconds,
            use_voice=use_voice,
            use_music=use_music,
            use_logo=use_logo,
            logo_path=logo_path,
            logo_is_prepared=logo_is_prepared,
            output_path=output_path,
        )
        print()
        print("==================================")
        print("RENDER HOAN TAT")
        print(OUTPUT_PATH)
        print("==================================")
        return

    logo_input_index = (
        ((2 if use_voice else 1) + (1 if use_music else 0))
        if use_logo
        else None
    )

    video_filter = build_video_filter(
        region,
        logo_input_index=logo_input_index,
        logo_is_prepared=logo_is_prepared,
    )







    command = [



        "ffmpeg",



        "-y",







        "-hide_banner",







        "-loglevel",



        "warning",



    ]







    if PREVIEW_SECONDS:







        command.extend([



            "-t",



            str(



                PREVIEW_SECONDS



            ),



        ])







    command.extend([



        "-i",



        str(



            VIDEO_PATH



        ),



    ])







    if use_voice:







        command.extend([



            "-i",



            str(



                VOICE_PATH



            ),



        ])

    if use_music:
        command.extend([
            "-stream_loop", "-1",
            "-i", str(MUSIC_PATH),
        ])

    if use_logo:
        command.extend([
            "-loop",
            "1",
            "-i",
            str(logo_path),
        ])







    if use_voice:







        music_index = 2 if use_voice else 1
        music_filter = (
            f"[{music_index}:a]volume={float(MUSIC_VOLUME)}[music];"
            "[original][voice][music]amix=inputs=3:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.97[aout]"
            if use_music
            else "[original][voice]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.97[aout]"
        )
        filter_complex = (



            video_filter



            + ";"







            f"[0:a]"



            f"volume="



            f"{float(ORIGINAL_VOLUME)}"



            f"[original];"







            f"[1:a]"



            f"volume="



            f"{float(VOICE_VOLUME)}"



            f"[voice];"







            + music_filter



        )







    else:







        filter_complex = (



            video_filter



        )







    if use_music and not use_voice:
        filter_complex = (
            video_filter
            + ";[1:a]volume="
            + str(float(MUSIC_VOLUME))
            + "[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.97[aout]"
        )
        use_voice = True

    command.extend([



        "-filter_complex",



        filter_complex,







        "-map",



        "[vout]",



    ])







    if use_voice:







        command.extend([



            "-map",



            "[aout]",



        ])







    else:







        command.extend([



            "-map",



            "0:a?",



        ])







    # =====================================================



    # VIDEO ENCODE



    # =====================================================







    if ffmpeg_has_nvenc():







        print()



        print(



            "=================================="



        )



        print(



            "FAST RENDER: NVIDIA NVENC"



        )



        print(



            f"Preset: "



            f"{NVENC_PRESET}"



        )



        print(



            "=================================="



        )







        command.extend([



            "-c:v",



            "h264_nvenc",







            "-preset",



            NVENC_PRESET,







            "-tune",



            NVENC_TUNE,







            "-rc",



            "constqp",







            "-qp",



            NVENC_QP,







            "-bf",



            NVENC_BFRAMES,







            "-pix_fmt",



            "yuv420p",



        ])
        if _is_stability_mode():
            command.extend(["-threads", "4"])







    else:







        print()



        print(



            "[WARN] "



            "Khong tim thay h264_nvenc."



        )



        print(



            "Fallback CPU ultrafast."



        )







        command.extend([



            "-c:v",



            "libx264",







            "-preset",



            "ultrafast",







            "-crf",



            "23",







            "-pix_fmt",



            "yuv420p",



        ])
        if _is_stability_mode():
            command.extend(["-threads", "4"])







    # =====================================================



    # AUDIO



    # =====================================================







    if use_voice:







        command.extend([



            "-c:a",



            "aac",







            "-b:a",



            "160k",







            "-ar",



            "44100",



        ])







    else:







        # Subtitle mode giu nguyen audio source.



        command.extend([



            "-c:a",



            "copy",



        ])







    command.extend([



        "-movflags",



        "+faststart",







        str(



            OUTPUT_PATH



        ),



    ])







    print(



        "\nFFMPEG COMMAND:"



    )







    print(



        " ".join(



            str(value)



            for value



            in command



        )



    )







    run_ffmpeg_with_fallback(



        command,



        use_voice=

            use_voice,



    )







    if not file_ok(



        OUTPUT_PATH



    ):



        raise RuntimeError(



            "FFmpeg khong tao "



            "duoc final video."



        )







    print()



    print(



        "=================================="



    )



    print(



        "RENDER HOAN TAT"



    )



    print(



        OUTPUT_PATH



    )



    print(



        "=================================="



    )











# =========================================================



# MAIN



# =========================================================







if __name__ == "__main__":







    if not file_ok(



        REGION_PATH



    ):



        raise FileNotFoundError(



            REGION_PATH



        )







    with open(



        REGION_PATH,



        "r",



        encoding="utf-8",



    ) as file:







        region = json.load(



            file



        )







    create_ass(



        region



    )







    render_final(



        region



    )
