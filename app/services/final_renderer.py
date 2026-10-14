import json



import math



import os



import re



import subprocess



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







# Font.



FONT_NAME = "Arial"



FONT_BOLD = True

# Web jobs may override this while keeping automatic sizing as the default.
FONT_SIZE_OVERRIDE = None

OUTPUT_ASPECT_RATIO = None
LOGO_SIZE_OVERRIDE = None
LOGO_X_OVERRIDE = None
LOGO_Y_OVERRIDE = None
LOGO_MODE = "default"
LOGO_TEXT = None
LOGO_PATH_OVERRIDE = None
BLUR_INTERVALS = []
MUSIC_PATH = None
MUSIC_VOLUME = 0.12







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
BILIBILI_TEXT_BLUR_REGIONS = [
    (0.008, 0.008, 0.305, 0.125),
    (0.740, 0.008, 0.245, 0.105),
]



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





def get_bilibili_text_blur_boxes(

    width,

    height,

):



    if (

        not AUTO_BRAND_BLUR_ENABLED

        or detect_source_platform() != "bilibili"

    ):

        return []



    result = []



    for rx, ry, rw, rh in BILIBILI_TEXT_BLUR_REGIONS:



        x = int(round(width * rx))

        y = int(round(height * ry))

        w = int(round(width * rw))

        h = int(round(height * rh))



        x = int(clamp(x, 0, max(0, width - 2)))

        y = int(clamp(y, 0, max(0, height - 2)))

        w = int(clamp(w, 2, width - x))

        h = int(clamp(h, 2, height - y))



        result.append({

            "x": x,

            "y": y,

            "width": w,

            "height": h,

        })



    return result





def get_bilibili_logo_path():

    if LOGO_MODE == "none":
        return None

    if detect_source_platform() != "bilibili":
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


def get_bilibili_logo_layout(width, height):

    short_side = min(width, height)
    if LOGO_SIZE_OVERRIDE:
        # Khi người dùng chọn cỡ logo, tôn trọng đúng giá trị đó.
        size = int(round(float(LOGO_SIZE_OVERRIDE)))
        size = int(clamp(size, 1, max(1, min(width, height))))
    else:
        size = int(round(short_side * BILIBILI_LOGO_SIZE_RATIO))
        size = int(clamp(size, BILIBILI_LOGO_MIN_SIZE, BILIBILI_LOGO_MAX_SIZE))

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

    x = int(clamp(x, 0, max(0, width - size)))
    y = int(clamp(y, 0, max(0, height - size)))

    return {
        "x": x,
        "y": y,
        "size": size,
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











def srt_to_ass_time(value):







    match = re.match(



        r"(\d+):"



        r"(\d+):"



        r"(\d+)[,.]"



        r"(\d+)",



        value.strip(),



    )







    if not match:



        raise ValueError(



            "SRT time khong hop le: "



            + str(value)



        )







    hours = int(



        match.group(1)



    )







    minutes = int(



        match.group(2)



    )







    seconds = int(



        match.group(3)



    )







    milliseconds = int(



        match.group(4)



        .ljust(



            3,



            "0",



        )[:3]



    )







    centiseconds = int(



        round(



            milliseconds / 10



        )



    )







    if centiseconds >= 100:



        seconds += 1



        centiseconds = 0







    if seconds >= 60:



        minutes += (



            seconds // 60



        )



        seconds %= 60







    if minutes >= 60:



        hours += (



            minutes // 60



        )



        minutes %= 60







    return (



        f"{hours}:"



        f"{minutes:02d}:"



        f"{seconds:02d}."



        f"{centiseconds:02d}"



    )











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



Style: Default,{FONT_NAME},{font_size},&H00FFFFFF,&H000000FF,&H00101010,&H80000000,{bold},0,0,0,100,100,0,0,1,{outline},0,5,24,24,10,1



Style: Brand,{FONT_NAME},{brand_font_size},&H00FFFFFF,&H000000FF,&H00202020,&H00000000,-1,0,0,0,100,100,0,0,1,3,0,7,10,10,10,1







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







        start = (



            srt_to_ass_time(



                item[



                    "start"



                ]



            )



        )







        end = (



            srt_to_ass_time(



                item[



                    "end"



                ]



            )



        )







        raw_text = (



            item[



                "text"



            ]



        )







        (



            item_font_size,



            lines,



        ) = fit_subtitle(



            raw_text,



            base_size=



                font_size,



            max_width=



                max_text_width,



            blur_height=



                blur_height,



        )







        escaped_lines = [



            escape_ass_text(



                line



            )



            for line in lines



        ]







        text = (



            r"\N".join(



                escaped_lines



            )



        )







        # \an5 = center.



        # \pos = toa do absolute theo PlayRes.



        # \q2 = no smart wrap; minh da wrap chu dong bang \N.



        override = (



            r"{\an5"



            f"\\pos("



            f"{sub_x},"



            f"{sub_y}"



            f")"



            f"\\fs{item_font_size}"



            r"\q2}"



        )







        event = (



            "Dialogue: 0,"



            f"{start},"



            f"{end},"



            "Default,,0,0,0,,"



            f"{override}"



            f"{text}"



        )







        events.append(



            event



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

    logo_layout = get_bilibili_logo_layout(
        video_width,
        video_height,
    )

    parts = []

    # 1) Blur subtitle Trung goc
    if layout.get("blur_enabled", True) and width > 0 and height > 0:
        parts.extend([
            "[0:v]split=2[base][crop_src]",
            f"[crop_src]crop={width}:{height}:{x}:{y},"
            f"{_safe_boxblur_filter(width, height, BLUR_RADIUS, BLUR_POWER)}[blurred]",
            f"[base][blurred]overlay={x}:{y}[clean_sub]",
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
                f"{_safe_boxblur_filter(bw, bh, 14, 2)}[{blur_label}]",
                f"[{src_label}][{blur_label}]overlay={bx}:{by}[{out_label}]",
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
            f"{_safe_boxblur_filter(bw, bh, 20, 2)}[{blur_label}]",
            f"[{src_label}][{blur_label}]overlay={bx}:{by}:enable='between(t,{start},{end})'[{out_label}]",
        ])
        current = out_label

    # 3) Chen logo kenh dang tron
    if logo_input_index is not None and platform == "bilibili":
        lx = int(logo_layout["x"])
        ly = int(logo_layout["y"])
        logo_size = int(logo_layout["size"])

        if logo_is_prepared:
            parts.append(
                f"[{logo_input_index}:v]format=rgba[channel_logo]"
            )
        else:
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

    if logo_input_index is not None and platform == "bilibili":
        print(f"Logo       : {BILIBILI_LOGO_PATH}")
        print(
            f"Logo pos   : x={logo_layout['x']} "
            f"y={logo_layout['y']} size={logo_layout['size']}"
        )

    print("==================================")
    return ";".join(parts)


def prepare_round_logo(source_path, output_dir, size):
    """Resize and mask a logo once instead of running geq for every video frame."""
    from PIL import Image, ImageChops, ImageDraw, ImageOps

    source = Path(source_path)
    target = Path(output_dir) / f".reupai_round_logo_{int(size)}.png"
    if (
        target.exists()
        and target.stat().st_size > 0
        and target.stat().st_mtime_ns >= source.stat().st_mtime_ns
    ):
        return target

    with Image.open(source) as image:
        rgba = image.convert("RGBA")
        fitted = ImageOps.fit(
            rgba,
            (int(size), int(size)),
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

        "veryfast",



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



        cpu_command = (

            _replace_video_encoder_with_cpu(

                command

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
        detect_source_platform() == "bilibili"
        and logo_path is not None
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
            )
            logo_path = prepare_round_logo(
                logo_path,
                output_path.parent,
                int(logo_layout["size"]),
            )
            logo_is_prepared = True
        except Exception as exc:
            print(f"[WARN] Khong cache duoc logo tron, dung filter cu: {exc}")

    use_music = bool(MUSIC_PATH and file_ok(MUSIC_PATH))

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
            "[original][voice][music]amix=inputs=3:duration=first:dropout_transition=0[aout]"
            if use_music
            else "[original][voice]amix=inputs=2:duration=first:dropout_transition=0[aout]"
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
            + "[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=0[aout]"
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
