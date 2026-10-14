import hashlib
from pathlib import Path
import json
import os
import re
import time

from dotenv import dotenv_values, load_dotenv
from google import genai
from runtime_paths import get_config_dir
from google.genai import types


# =========================================================
# CONFIG
# =========================================================

# The packaged Local Engine stores user configuration outside the install folder.
# Load it explicitly because pipeline child processes do not inherit the desktop
# process environment on every Windows launch.
def _engine_env_candidates() -> list[Path]:
    """Return local-only config locations in order of preference.

    A frozen pipeline child may lose its inherited ``REUP_ENGINE_CONFIG_PATH``
    even though the desktop Engine is running.  The LocalAppData fallback is
    therefore explicit instead of relying only on its parent environment.
    """

    candidates = [
        Path(os.getenv("REUP_ENGINE_CONFIG_PATH", "").strip())
        if os.getenv("REUP_ENGINE_CONFIG_PATH", "").strip()
        else None,
        get_config_dir() / "engine.env",
    ]
    local_app_data = os.getenv("LOCALAPPDATA", "").strip()
    if local_app_data:
        candidates.append(Path(local_app_data) / "ReupAI" / "config" / "engine.env")

    unique: list[Path] = []
    for candidate in candidates:
        if candidate and candidate not in unique:
            unique.append(candidate)
    return unique


ENGINE_ENV_PATH = get_config_dir() / "engine.env"
engine_api_key = ""
for candidate in _engine_env_candidates():
    engine_values = dotenv_values(candidate)
    candidate_key = (engine_values.get("GEMINI_API_KEY") or "").strip()
    if candidate_key:
        ENGINE_ENV_PATH = candidate
        engine_api_key = candidate_key
        os.environ["REUP_ENGINE_CONFIG_PATH"] = str(candidate.resolve())
        os.environ["GEMINI_API_KEY"] = candidate_key
        break

load_dotenv(ENGINE_ENV_PATH, override=True)

# Preserve the existing development workflow where the project .env is used.
if not os.getenv("GEMINI_API_KEY"):
    load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)

API_KEY = os.getenv("GEMINI_API_KEY")

if not API_KEY:
    raise ValueError(
        r"Chua cau hinh GEMINI_API_KEY. Mo %LOCALAPPDATA%\ReupAI\config\engine.env va them GEMINI_API_KEY=<your-key>."
    )

client = genai.Client(
    api_key=API_KEY
)


# =========================================================
# JOB CONFIG
# pipeline.py se override cac bien nay theo tung video
# =========================================================

JOB_NAME = "default"

INPUT_SRT = "app/output/chinese.srt"

OUTPUT_SRT = "app/output/vietnamese.srt"

CHECKPOINT_FILE = (
    "app/output/translation_checkpoint.json"
)

DEBUG_FILE = (
    "app/output/translation_debug.json"
)


# =========================================================
# TRANSLATION CONFIG
# =========================================================

# Thu lan luot. Model nao het quota / khong co quyen truy cap
# thi bo qua model do trong phien chay hien tai.
GEMINI_MODELS = [
    os.getenv(
        "GEMINI_PRIMARY_MODEL",
        "gemini-3.1-flash-lite",
    ),
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-2.5-flash-lite",
]

# Cho phep them model bang .env, vi du:
# GEMINI_EXTRA_MODELS=gemini-3.7-flash,gemini-3.6-flash
EXTRA_MODELS = [
    value.strip()
    for value in os.getenv(
        "GEMINI_EXTRA_MODELS",
        "",
    ).split(",")
    if value.strip()
]

GEMINI_MODELS.extend(
    EXTRA_MODELS
)

# Xoa model trung lap nhung giu nguyen thu tu.
GEMINI_MODELS = list(
    dict.fromkeys(
        GEMINI_MODELS
    )
)

# Giu bien nay de pipeline / code cu van tuong thich.
PRIMARY_MODEL = (
    GEMINI_MODELS[0]
)

DISABLED_MODELS = set()

# 20 subtitle / request de giam so request Gemini.
BATCH_SIZE = 20

MAX_RETRIES = 3

WAIT_TIMES = [
    2,
    5,
    10,
]

# Local fallback: NLLB Trung -> Viet.
# Model chi duoc load khi tat ca Gemini deu that bai / het quota.
LOCAL_FALLBACK_ENABLED = (
    os.getenv(
        "LOCAL_TRANSLATION_FALLBACK",
        "1",
    ).strip().lower()
    not in {
        "0",
        "false",
        "no",
        "off",
    }
)

LOCAL_MODEL_NAME = os.getenv(
    "LOCAL_TRANSLATION_MODEL",
    "facebook/nllb-200-distilled-600M",
)

LOCAL_SOURCE_LANG = os.getenv(
    "LOCAL_SOURCE_LANG",
    "zho_Hans",
)

LOCAL_TARGET_LANG = os.getenv(
    "LOCAL_TARGET_LANG",
    "vie_Latn",
)

LOCAL_BATCH_SIZE = max(
    1,
    int(
        os.getenv(
            "LOCAL_TRANSLATION_BATCH_SIZE",
            "4",
        )
    ),
)

_LOCAL_TOKENIZER = None
_LOCAL_MODEL = None
_LOCAL_TORCH = None
_LOCAL_DEVICE = None


# =========================================================
# FILE HELPERS
# =========================================================

def ensure_parent(file_path):
    parent = os.path.dirname(
        str(file_path)
    )

    if parent:
        os.makedirs(
            parent,
            exist_ok=True
        )


def get_file_hash(file_path):
    sha256 = hashlib.sha256()

    with open(
        file_path,
        "rb"
    ) as file:
        while True:
            chunk = file.read(
                1024 * 1024
            )

            if not chunk:
                break

            sha256.update(
                chunk
            )

    return sha256.hexdigest()


# =========================================================
# READ SRT
# =========================================================

def read_srt(file_path):
    """
    Doc file SRT va tra ve list:
    [
        {
            "id": 1,
            "start": "00:00:01,000",
            "end": "00:00:03,000",
            "text": "..."
        }
    ]

    Ho tro:
    - UTF-8 / UTF-8 BOM
    - timeline dung dau , hoac .
    - SRT co ID
    - fallback neu block khong co ID
    """

    if not os.path.exists(
        file_path
    ):
        raise FileNotFoundError(
            f"Khong tim thay file: {file_path}"
        )

    with open(
        file_path,
        "r",
        encoding="utf-8-sig"
    ) as file:
        content = file.read()

    if not content.strip():
        return []

    blocks = re.split(
        r"\r?\n\s*\r?\n",
        content.strip()
    )

    results = []
    auto_id = 1

    time_pattern = re.compile(
        r"(\d{1,2}:\d{2}:\d{2}[,.]\d{3})"
        r"\s*-->\s*"
        r"(\d{1,2}:\d{2}:\d{2}[,.]\d{3})"
    )

    for block in blocks:
        lines = [
            line.strip()
            for line in block.splitlines()
            if line.strip()
        ]

        if len(lines) < 2:
            continue

        if lines[0].isdigit():
            subtitle_id = int(
                lines[0]
            )
            time_index = 1
        else:
            subtitle_id = auto_id
            time_index = 0

        if time_index >= len(lines):
            continue

        match = time_pattern.search(
            lines[time_index]
        )

        if not match:
            print(
                "Bo qua timeline loi:",
                lines[time_index]
            )
            continue

        start = (
            match.group(1)
            .replace(".", ",")
        )

        end = (
            match.group(2)
            .replace(".", ",")
        )

        text = " ".join(
            lines[
                time_index + 1:
            ]
        ).strip()

        if not text:
            continue

        results.append({
            "id":
                subtitle_id,

            "start":
                start,

            "end":
                end,

            "text":
                text,
        })

        auto_id = max(
            auto_id + 1,
            subtitle_id + 1
        )

    return results


# =========================================================
# PROMPT
# =========================================================

def build_prompt(
    batch,
    previous_context=""
):
    data = [
        {
            "id":
                int(
                    item["id"]
                ),

            "text":
                str(
                    item["text"]
                )
        }
        for item in batch
    ]

    context = (
        previous_context.strip()
        if previous_context
        else "Khong co. Day la doan dau."
    )

    return f"""
Ban la bien dich vien Trung -> Viet.

Day la transcript duoc Whisper nhan dien
tu loi thoai trong video Trung Quoc.

NHIEM VU:
Dich sang tieng Viet tu nhien de dung cho:
- subtitle
- giong doc AI TTS

QUY TAC:
1. Dich theo ngu canh.
2. Khong dich tung tu may moc.
3. Tieng Viet ngan gon, tu nhien.
4. Phu hop de doc bang TTS.
5. Khong tu them noi dung.
6. Neu Whisper sai nhe, dua vao ngu canh de hieu cau hop ly.
7. Giu nguyen ID.
8. Khong bo ID.
9. Khong gop ID.
10. Moi ID dung 1 ban dich.
11. Chi tra JSON.
12. Khong Markdown.
13. Khong giai thich.
14. Khong dua nhieu phuong an.

NGU CANH CAC CAU TRUOC:
{context}

DU LIEU:
{json.dumps(
    data,
    ensure_ascii=False
)}

OUTPUT:
{{
    "translations": [
        {{
            "id": 1,
            "text": "Ban dich tieng Viet"
        }}
    ]
}}
""".strip()


# =========================================================
# VALIDATE GEMINI
# =========================================================

def validate_translations(
    translations,
    batch
):
    if not isinstance(
        translations,
        list
    ):
        raise ValueError(
            "translations khong phai list."
        )

    if len(translations) != len(batch):
        raise ValueError(
            f"Can {len(batch)} cau "
            f"nhung Gemini tra "
            f"{len(translations)} cau."
        )

    expected_ids = [
        int(
            item["id"]
        )
        for item in batch
    ]

    returned_ids = []

    for item in translations:
        if not isinstance(
            item,
            dict
        ):
            raise ValueError(
                "Translation item "
                "khong phai object."
            )

        if (
            "id" not in item
            or
            "text" not in item
        ):
            raise ValueError(
                "Translation thieu id/text."
            )

        item_id = int(
            item["id"]
        )

        translated_text = str(
            item["text"]
        ).strip()

        if not translated_text:
            raise ValueError(
                f"ID {item_id} bi rong."
            )

        returned_ids.append(
            item_id
        )

    if returned_ids != expected_ids:
        raise ValueError(
            "Thu tu ID Gemini "
            "tra ve khong khop."
        )


# =========================================================
# TRANSLATION ERROR HELPERS
# =========================================================

def _error_text(error):
    return str(
        error
    )


def _is_quota_error(error):
    value = _error_text(
        error
    ).lower()

    return any(
        token in value
        for token in (
            "resource_exhausted",
            "resource exhausted",
            "quota exceeded",
            "rate limit exceeded",
            "too many requests",
            "429",
        )
    )


def _is_daily_quota_error(error):
    value = _error_text(
        error
    ).lower()

    return any(
        token in value
        for token in (
            "perday",
            "requestsperday",
            "generate requests per day",
            "generate_requests_per_day",
            "rpd",
        )
    )


def _is_model_unavailable_error(error):
    value = _error_text(
        error
    ).lower()

    return (
        "not_found" in value
        or "404" in value
        or "model not found" in value
        or "is not found" in value
        or "does not exist" in value
        or "unsupported model" in value
        or "not supported" in value
    )


def _is_transient_error(error):
    value = _error_text(
        error
    ).lower()

    return any(
        token in value
        for token in (
            "unavailable",
            "503",
            "deadline_exceeded",
            "deadline exceeded",
            "timeout",
            "timed out",
            "connection",
            "temporarily",
            "internal",
            "500",
            "502",
            "504",
        )
    )


# =========================================================
# LOCAL NLLB FALLBACK
# =========================================================

def _load_local_translator():
    global _LOCAL_TOKENIZER
    global _LOCAL_MODEL
    global _LOCAL_TORCH
    global _LOCAL_DEVICE

    if (
        _LOCAL_TOKENIZER is not None
        and _LOCAL_MODEL is not None
    ):
        return (
            _LOCAL_TOKENIZER,
            _LOCAL_MODEL,
            _LOCAL_TORCH,
            _LOCAL_DEVICE,
        )

    try:
        import torch
        from transformers import (
            AutoModelForSeq2SeqLM,
            AutoTokenizer,
        )

    except ImportError as error:
        raise RuntimeError(
            "Tat ca Gemini deu khong dung duoc va local fallback "
            "chua duoc cai. Chay: "
            "python -m pip install -U transformers sentencepiece torch"
        ) from error

    device = (
        "cuda"
        if torch.cuda.is_available()
        else "cpu"
    )

    print(
        "\n=============================="
    )
    print(
        "LOCAL FALLBACK - NLLB"
    )
    print(
        "=============================="
    )
    print(
        f"Model: {LOCAL_MODEL_NAME}"
    )
    print(
        f"Device: {device}"
    )
    print(
        "Lan dau co the mat thoi gian tai model ve may."
    )

    tokenizer = (
        AutoTokenizer.from_pretrained(
            LOCAL_MODEL_NAME,
            src_lang=
                LOCAL_SOURCE_LANG,
        )
    )

    model_kwargs = {}

    if device == "cuda":
        model_kwargs[
            "torch_dtype"
        ] = torch.float16

    model = (
        AutoModelForSeq2SeqLM
        .from_pretrained(
            LOCAL_MODEL_NAME,
            **model_kwargs,
        )
    )

    model.to(
        device
    )
    model.eval()

    _LOCAL_TOKENIZER = tokenizer
    _LOCAL_MODEL = model
    _LOCAL_TORCH = torch
    _LOCAL_DEVICE = device

    return (
        tokenizer,
        model,
        torch,
        device,
    )


def translate_batch_local(
    batch,
    previous_context="",
):
    del previous_context

    (
        tokenizer,
        model,
        torch,
        device,
    ) = _load_local_translator()

    forced_bos_token_id = (
        tokenizer.convert_tokens_to_ids(
            LOCAL_TARGET_LANG
        )
    )

    if (
        forced_bos_token_id is None
        or forced_bos_token_id < 0
    ):
        raise RuntimeError(
            "Khong tim thay NLLB target language token: "
            f"{LOCAL_TARGET_LANG}"
        )

    results = []

    for start_index in range(
        0,
        len(batch),
        LOCAL_BATCH_SIZE,
    ):
        chunk = batch[
            start_index:
            start_index
            + LOCAL_BATCH_SIZE
        ]

        texts = [
            str(
                item.get(
                    "text",
                    "",
                )
            ).strip()
            for item in chunk
        ]

        encoded = tokenizer(
            texts,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=384,
        )

        encoded = {
            key:
                value.to(
                    device
                )
            for key, value
            in encoded.items()
        }

        with torch.inference_mode():
            generated = model.generate(
                **encoded,
                forced_bos_token_id=
                    forced_bos_token_id,
                max_new_tokens=192,
                num_beams=2,
            )

        translated_texts = (
            tokenizer.batch_decode(
                generated,
                skip_special_tokens=True,
            )
        )

        if (
            len(translated_texts)
            != len(chunk)
        ):
            raise RuntimeError(
                "Local NLLB tra ve sai so cau."
            )

        for original, translated_text in zip(
            chunk,
            translated_texts,
        ):
            value = str(
                translated_text
            ).strip()

            if not value:
                # Khong de pipeline vo o subtitle.
                value = str(
                    original.get(
                        "text",
                        "",
                    )
                ).strip()

            results.append({
                "id":
                    int(
                        original["id"]
                    ),
                "text":
                    value,
            })

    validate_translations(
        results,
        batch,
    )

    print(
        f"Local NLLB OK: {len(results)} cau."
    )

    return results


# =========================================================
# TRANSLATE ONE BATCH
# =========================================================

def translate_batch(
    batch,
    previous_context=""
):
    prompt = build_prompt(
        batch,
        previous_context
    )

    last_error = None

    for model_name in GEMINI_MODELS:
        if model_name in DISABLED_MODELS:
            print(
                f"\n[SKIP MODEL] {model_name}"
            )
            continue

        print(
            f"\nModel: {model_name}"
        )

        for attempt in range(
            MAX_RETRIES
        ):
            try:
                print(
                    f"Request "
                    f"{attempt + 1}/"
                    f"{MAX_RETRIES}"
                )

                response = (
                    client.models.generate_content(
                        model=
                            model_name,

                        contents=
                            prompt,

                        config=
                            types.GenerateContentConfig(
                                temperature=0.15,

                                response_mime_type=
                                    "application/json"
                            )
                    )
                )

                if not response.text:
                    raise ValueError(
                        "Gemini tra ve rong."
                    )

                raw_text = (
                    response.text
                    .strip()
                )

                if raw_text.startswith(
                    "```"
                ):
                    raw_text = re.sub(
                        r"^```(?:json)?\s*",
                        "",
                        raw_text,
                        flags=
                            re.IGNORECASE
                    )

                    raw_text = re.sub(
                        r"\s*```$",
                        "",
                        raw_text
                    )

                result = json.loads(
                    raw_text
                )

                if isinstance(
                    result,
                    list
                ):
                    translations = result

                elif isinstance(
                    result,
                    dict
                ):
                    translations = (
                        result.get(
                            "translations"
                        )
                    )

                else:
                    translations = None

                validate_translations(
                    translations,
                    batch
                )

                print(
                    f"Gemini OK: {model_name}"
                )

                return translations

            except Exception as error:
                last_error = error

                print(
                    "\nGemini loi:"
                )
                print(
                    _error_text(
                        error
                    )
                )

                # Model khong ton tai / project khong duoc dung model.
                # Khong retry cung model, chuyen model tiep theo.
                if _is_model_unavailable_error(
                    error
                ):
                    DISABLED_MODELS.add(
                        model_name
                    )

                    print(
                        f"[MODEL OFF] {model_name} "
                        "khong kha dung -> thu model tiep theo."
                    )
                    break

                # Quota / 429: neu la quota ngay thi chuyen model ngay.
                # Neu chi la rate-limit ngan han thi retry vai lan roi fallback.
                if _is_quota_error(
                    error
                ):
                    if _is_daily_quota_error(
                        error
                    ):
                        DISABLED_MODELS.add(
                            model_name
                        )

                        print(
                            f"[QUOTA] {model_name} "
                            "het quota ngay -> thu model tiep theo."
                        )
                        break

                    if (
                        attempt
                        >= MAX_RETRIES - 1
                    ):
                        DISABLED_MODELS.add(
                            model_name
                        )

                        print(
                            f"[RATE LIMIT] {model_name} "
                            "van bi gioi han -> thu model tiep theo."
                        )
                        break

                # Loi 5xx / timeout: retry cung model, sau do fallback.
                if (
                    attempt
                    < MAX_RETRIES - 1
                ):
                    wait_time = (
                        WAIT_TIMES[
                            min(
                                attempt,
                                len(
                                    WAIT_TIMES
                                ) - 1
                            )
                        ]
                    )

                    if (
                        _is_transient_error(
                            error
                        )
                        or _is_quota_error(
                            error
                        )
                        or isinstance(
                            error,
                            (
                                ValueError,
                                json.JSONDecodeError,
                            )
                        )
                    ):
                        print(
                            f"Thu lai sau "
                            f"{wait_time}s..."
                        )

                        time.sleep(
                            wait_time
                        )
                        continue

                # Het retry cua model hien tai -> model tiep theo.
                print(
                    f"[FALLBACK] {model_name} "
                    "khong dung duoc -> model tiep theo."
                )
                break

    if LOCAL_FALLBACK_ENABLED:
        print(
            "\nTat ca Gemini hien tai deu khong dung duoc."
        )
        print(
            "Chuyen sang local NLLB..."
        )

        return translate_batch_local(
            batch,
            previous_context,
        )

    raise RuntimeError(
        "Tat ca Gemini deu khong kha dung va "
        "LOCAL_TRANSLATION_FALLBACK dang tat."
    ) from last_error


# =========================================================
# CHECKPOINT
# =========================================================

def load_checkpoint(
    source_hash
):
    if not os.path.exists(
        CHECKPOINT_FILE
    ):
        return []

    try:
        with open(
            CHECKPOINT_FILE,
            "r",
            encoding="utf-8"
        ) as file:
            data = json.load(
                file
            )

    except Exception as error:
        print(
            "Checkpoint loi -> bo qua:"
        )
        print(
            error
        )
        return []

    if not isinstance(
        data,
        dict
    ):
        print(
            "Checkpoint cu -> reset."
        )
        return []

    if (
        data.get(
            "source_hash"
        )
        != source_hash
    ):
        print(
            "Input SRT da thay doi "
            "-> reset checkpoint."
        )
        return []

    items = (
        data.get(
            "translations",
            []
        )
    )

    if not isinstance(
        items,
        list
    ):
        return []

    print(
        f"Checkpoint hop le: "
        f"{len(items)} cau"
    )

    return items


def save_checkpoint(
    translations,
    source_hash
):
    ensure_parent(
        CHECKPOINT_FILE
    )

    data = {
        "job":
            JOB_NAME,

        "source_file":
            INPUT_SRT,

        "source_hash":
            source_hash,

        "model":
            "mixed-fallback",

        "gemini_models":
            GEMINI_MODELS,

        "local_fallback":
            LOCAL_FALLBACK_ENABLED,

        "translations":
            translations,
    }

    with open(
        CHECKPOINT_FILE,
        "w",
        encoding="utf-8"
    ) as file:
        json.dump(
            data,
            file,
            ensure_ascii=False,
            indent=2
        )


# =========================================================
# TRANSLATE ALL
# =========================================================

def translate_all(
    subtitles,
    source_hash=None
):
    if source_hash is None:
        if os.path.exists(
            INPUT_SRT
        ):
            source_hash = (
                get_file_hash(
                    INPUT_SRT
                )
            )
        else:
            raw = json.dumps(
                subtitles,
                ensure_ascii=False,
                sort_keys=True
            )

            source_hash = (
                hashlib.sha256(
                    raw.encode(
                        "utf-8"
                    )
                )
                .hexdigest()
            )

    translated = (
        load_checkpoint(
            source_hash
        )
    )

    translated.sort(
        key=lambda item:
            int(
                item["id"]
            )
    )

    completed_ids = {
        int(
            item["id"]
        )
        for item in translated
    }

    remaining = [
        item
        for item in subtitles
        if int(
            item["id"]
        )
        not in completed_ids
    ]

    total = len(
        subtitles
    )

    print(
        f"\nTong subtitle: {total}"
    )

    print(
        f"Da dich: {len(translated)}"
    )

    print(
        f"Con lai: {len(remaining)}"
    )

    if not remaining:
        return translated

    total_batches = (
        len(remaining)
        + BATCH_SIZE
        - 1
    ) // BATCH_SIZE

    for start_index in range(
        0,
        len(remaining),
        BATCH_SIZE
    ):
        batch = remaining[
            start_index:
            start_index
            + BATCH_SIZE
        ]

        batch_number = (
            start_index
            // BATCH_SIZE
        ) + 1

        print(
            "\n=============================="
        )

        print(
            f"BATCH "
            f"{batch_number}/"
            f"{total_batches}"
        )

        print(
            f"ID "
            f"{batch[0]['id']} "
            f"-> "
            f"{batch[-1]['id']}"
        )

        print(
            "=============================="
        )

        previous = (
            translated[-5:]
        )

        context = "\n".join(
            f"{item['id']}: "
            f"{item['translated_text']}"
            for item in previous
        )

        try:
            translations = (
                translate_batch(
                    batch,
                    context
                )
            )

        except Exception:
            # Giu lai tat ca batch da dich truoc do.
            save_checkpoint(
                translated,
                source_hash
            )
            raise

        translation_map = {
            int(
                item["id"]
            ):
                str(
                    item["text"]
                ).strip()

            for item
            in translations
        }

        for original in batch:
            subtitle_id = int(
                original["id"]
            )

            vietnamese = (
                translation_map[
                    subtitle_id
                ]
            )

            translated.append({
                "id":
                    subtitle_id,

                "start":
                    original["start"],

                "end":
                    original["end"],

                "original_text":
                    original["text"],

                "translated_text":
                    vietnamese,
            })

        translated.sort(
            key=lambda item:
                int(
                    item["id"]
                )
        )

        # Save sau moi batch de co the resume.
        save_checkpoint(
            translated,
            source_hash
        )

        print(
            f"Tien do: "
            f"{len(translated)}/"
            f"{total}"
        )

        # Khong sleep 1 giay/batch.
        time.sleep(
            0.05
        )

    return translated


# =========================================================
# SAVE SRT
# =========================================================

def save_srt(
    subtitles,
    output_path
):
    ensure_parent(
        output_path
    )

    subtitles = sorted(
        subtitles,
        key=lambda item:
            int(
                item["id"]
            )
    )

    with open(
        output_path,
        "w",
        encoding="utf-8-sig"
    ) as file:
        for index, item in enumerate(
            subtitles,
            start=1
        ):
            file.write(
                f"{index}\n"
            )

            file.write(
                f"{item['start']} --> "
                f"{item['end']}\n"
            )

            file.write(
                f"{item['translated_text']}"
                f"\n\n"
            )

    print(
        "\nDa tao Vietnamese SRT:"
    )

    print(
        output_path
    )


# =========================================================
# SAVE DEBUG JSON
# =========================================================

def save_json(
    subtitles,
    output_path
):
    ensure_parent(
        output_path
    )

    with open(
        output_path,
        "w",
        encoding="utf-8"
    ) as file:
        json.dump(
            subtitles,
            file,
            ensure_ascii=False,
            indent=2
        )


# =========================================================
# MAIN
# =========================================================

if __name__ == "__main__":
    print(
        "\n=============================="
    )

    print(
        "BAT DAU DICH TRUNG -> VIET"
    )

    print(
        "=============================="
    )

    print(
        "Models: "
        + " -> ".join(
            GEMINI_MODELS
        )
        + " -> local NLLB"
    )

    print(
        f"Batch: {BATCH_SIZE}"
    )

    subtitles = read_srt(
        INPUT_SRT
    )

    if not subtitles:
        raise RuntimeError(
            "Khong co subtitle Trung."
        )

    source_hash = (
        get_file_hash(
            INPUT_SRT
        )
    )

    translated = (
        translate_all(
            subtitles,
            source_hash
        )
    )

    if (
        len(translated)
        != len(subtitles)
    ):
        raise RuntimeError(
            "So cau dich "
            "khong khop source."
        )

    save_srt(
        translated,
        OUTPUT_SRT
    )

    save_json(
        translated,
        DEBUG_FILE
    )

    print(
        "\nHOAN THANH"
    )
