import json
import subprocess
import os


VIDEO_PATH = "app/downloads/horizontal_test.mp4"
REGION_PATH = "app/output/subtitle_region.json"
OUTPUT_PATH = "app/output/horizontal_auto_blur.mp4"


def load_region():

    with open(
        REGION_PATH,
        "r",
        encoding="utf-8"
    ) as f:
        return json.load(f)


def render_auto_blur():

    region = load_region()

    blur = region["blur"]

    x = int(blur["x"])
    y = int(blur["y"])
    w = int(blur["width"])
    h = int(blur["height"])

    print("\nAUTO BLUR")
    print(f"x = {x}")
    print(f"y = {y}")
    print(f"w = {w}")
    print(f"h = {h}")

    os.makedirs(
        os.path.dirname(OUTPUT_PATH),
        exist_ok=True
    )

    filter_complex = (
        f"[0:v]split=2[base][area];"
        f"[area]crop={w}:{h}:{x}:{y},"
        f"boxblur=20:2[blur];"
        f"[base][blur]overlay={x}:{y}[v]"
    )

    command = [
        "ffmpeg",
        "-y",

        "-i",
        VIDEO_PATH,

        "-filter_complex",
        filter_complex,

        "-map",
        "[v]",

        "-map",
        "0:a?",

        "-c:v",
        "libx264",

        "-preset",
        "veryfast",

        "-crf",
        "22",

        "-c:a",
        "copy",

        OUTPUT_PATH
    ]

    print("\nDang render...\n")

    subprocess.run(
        command,
        check=True
    )

    print("\n==============================")
    print("HOAN THANH AUTO BLUR")
    print("==============================")

    print(OUTPUT_PATH)


if __name__ == "__main__":

    render_auto_blur()