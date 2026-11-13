"""Detect Windows package identity before selecting an update mechanism."""
from functools import lru_cache
import ctypes
import json
import os
from pathlib import Path
import re
import sys

STORE_UPDATES_URI = "ms-windows-store://downloadsandupdates"


def package_full_name():
    """Return None only when Windows explicitly reports an unpackaged process."""
    if os.name != "nt":
        return None
    query = ctypes.WinDLL("kernel32", use_last_error=True).GetCurrentPackageFullName
    query.argtypes = [ctypes.POINTER(ctypes.c_uint32), ctypes.c_wchar_p]
    query.restype = ctypes.c_long
    length = ctypes.c_uint32()
    result = query(ctypes.byref(length), None)
    if result == 15700:  # APPMODEL_ERROR_NO_PACKAGE
        return None
    if result != 122 or not 1 < length.value <= 4096:  # ERROR_INSUFFICIENT_BUFFER
        raise OSError(result, "Cannot determine Windows package identity")
    value = ctypes.create_unicode_buffer(length.value)
    result = query(ctypes.byref(length), value)
    if result:
        raise OSError(result, "Cannot read Windows package identity")
    return value.value


@lru_cache(maxsize=1)
def distribution_info():
    try:
        identity = package_full_name()
    except (OSError, AttributeError):
        # Never choose an EXE installer when Windows could not establish the
        # update owner. Package contents are protected by Windows/Store.
        return {"channel": "unknown", "managedUpdates": True, "updateUrl": None}
    if not identity:
        return {"channel": "direct", "managedUpdates": False, "updateUrl": None}
    product_id = ""
    try:
        marker = Path(sys.executable).resolve().parent / "reupai-distribution.json"
        if marker.stat().st_size <= 4096:
            data = json.loads(marker.read_text(encoding="utf-8-sig"))
            if data.get("packageIdentityName") == identity.split("_", 1)[0]:
                candidate = data.get("storeProductId", "")
                if isinstance(candidate, str) and re.fullmatch(r"[A-Z0-9]{12}", candidate):
                    product_id = candidate
    except (OSError, ValueError, AttributeError, TypeError):
        pass
    return {
        "channel": "msix", "managedUpdates": True,
        "updateUrl": f"ms-windows-store://pdp/?ProductId={product_id}" if product_id else STORE_UPDATES_URI,
    }


def open_store_updates():
    info = distribution_info()
    if info["channel"] != "msix":
        raise ValueError("Không xác định được gói Microsoft Store của Local Engine.")
    try:
        os.startfile(info["updateUrl"])
    except OSError as error:
        raise RuntimeError("Chưa mở được Microsoft Store. Hãy mở Store → Thư viện để kiểm tra cập nhật.") from error
