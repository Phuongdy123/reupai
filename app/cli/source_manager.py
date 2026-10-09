import argparse
import sys
import urllib.parse
from pathlib import Path


APP_DIR = Path(__file__).resolve().parent.parent
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

from services.source_db import (
    init_db,
    create_channel,
    list_channels,
    add_source,
    list_sources,
    remove_source,
    list_videos
)


SUPPORTED_PLATFORMS = {
    "bilibili",
    "douyin",
}


def normalize_source_url(
    platform,
    url,
):
    platform = (
        str(platform)
        .strip()
        .lower()
    )

    value = (
        str(url)
        .strip()
    )

    if platform not in (
        SUPPORTED_PLATFORMS
    ):
        raise ValueError(
            "Platform chi ho tro: "
            "bilibili, douyin."
        )

    parsed = (
        urllib.parse
        .urlsplit(
            value
        )
    )

    if platform == "bilibili":
        if (
            "bilibili.com"
            not in parsed.netloc.lower()
            and "b23.tv"
            not in parsed.netloc.lower()
        ):
            raise ValueError(
                "URL khong phai Bilibili."
            )

    if platform == "douyin":
        if (
            "douyin.com"
            not in parsed.netloc.lower()
        ):
            raise ValueError(
                "URL khong phai Douyin."
            )

        # Source Douyin phai la profile /user/<sec_uid>.
        if (
            "/user/"
            not in parsed.path
        ):
            raise ValueError(
                "Douyin source can link profile "
                "https://www.douyin.com/user/<sec_uid>"
            )

    path = (
        parsed.path.rstrip("/")
        or "/"
    )

    return (
        urllib.parse
        .urlunsplit(
            (
                parsed.scheme.lower()
                or "https",

                parsed.netloc.lower(),

                path,

                "",

                "",
            )
        )
    )


def show_channels():
    rows = (
        list_channels()
    )

    print(
        "\nCHANNELS\n"
    )

    for item in rows:
        print(
            f"[{item['id']}] "
            f"{item['channel_key']} "
            f"- {item['name']}"
        )


def show_sources(
    channel=None
):
    rows = (
        list_sources(
            channel
        )
    )

    print(
        "\nSOURCES\n"
    )

    for item in rows:
        print(
            f"[{item['id']}] "
            f"{item['platform']} | "
            f"{item['name']}"
        )

        print(
            f"    Channel: "
            f"{item['channel_key']}"
        )

        print(
            f"    URL: "
            f"{item['profile_url']}"
        )

        print(
            f"    Auto: "
            f"{bool(item['auto_process'])}"
        )

        print()


def show_videos(
    source_id=None,
    mode="new"
):
    rows = (
        list_videos(
            source_id=
                source_id,

            order=
                mode
        )
    )

    print(
        "\nVIDEOS\n"
    )

    for item in rows:
        print(
            f"[{item['id']}] "
            f"{item['title']}"
        )

        print(
            f"    Source: "
            f"{item['source_name']}"
        )

        print(
            f"    Views: "
            f"{item['play_count']}"
        )

        print(
            f"    Likes: "
            f"{item['like_count']}"
        )

        print(
            f"    Hot: "
            f"{item['hot_score']}"
        )

        print(
            f"    Status: "
            f"{item['status']}"
        )

        print(
            f"    {item['url']}"
        )

        print()


def main():
    parser = (
        argparse.ArgumentParser()
    )

    sub = (
        parser.add_subparsers(
            dest="command"
        )
    )

    sub.add_parser(
        "init"
    )

    channel_add = (
        sub.add_parser(
            "add-channel"
        )
    )

    channel_add.add_argument(
        "key"
    )

    channel_add.add_argument(
        "name"
    )

    sub.add_parser(
        "channels"
    )

    source_add = (
        sub.add_parser(
            "add-source"
        )
    )

    source_add.add_argument(
        "--platform",
        required=True,
        choices=[
            "bilibili",
            "douyin",
        ],
    )

    source_add.add_argument(
        "--name",
        required=True
    )

    source_add.add_argument(
        "--url",
        required=True
    )

    source_add.add_argument(
        "--channel",
        required=True
    )

    source_add.add_argument(
        "--auto",
        action="store_true"
    )

    source_add.add_argument(
        "--min-views",
        type=int,
        default=0
    )

    sources = (
        sub.add_parser(
            "sources"
        )
    )

    sources.add_argument(
        "--channel"
    )

    remove = (
        sub.add_parser(
            "remove-source"
        )
    )

    remove.add_argument(
        "id",
        type=int
    )

    videos = (
        sub.add_parser(
            "videos"
        )
    )

    videos.add_argument(
        "--source",
        type=int
    )

    videos.add_argument(
        "--mode",
        choices=[
            "new",
            "hot"
        ],
        default="new"
    )

    args = (
        parser.parse_args()
    )

    if args.command == "init":
        init_db()

    elif (
        args.command
        == "add-channel"
    ):
        init_db()

        create_channel(
            args.key,
            args.name
        )

    elif (
        args.command
        == "channels"
    ):
        show_channels()

    elif (
        args.command
        == "add-source"
    ):
        init_db()

        normalized_url = (
            normalize_source_url(
                args.platform,
                args.url,
            )
        )

        add_source(
            platform=
                args.platform,

            name=
                args.name,

            profile_url=
                normalized_url,

            channel_key=
                args.channel,

            auto_process=
                args.auto,

            min_views=
                args.min_views
        )

    elif (
        args.command
        == "sources"
    ):
        show_sources(
            args.channel
        )

    elif (
        args.command
        == "remove-source"
    ):
        remove_source(
            args.id
        )

    elif (
        args.command
        == "videos"
    ):
        show_videos(
            source_id=
                args.source,

            mode=
                args.mode
        )

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
