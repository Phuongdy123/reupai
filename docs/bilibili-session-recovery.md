# Bilibili session recovery (0.2.41)

Trigger: the customer can play a Bilibili video in their usual browser, but the
Engine's temporary browser receives HTTP 412. This establishes that ordinary
playback works; it does not establish which automated request Bilibili rejected.

The fallback now reads the browser/profile selected by `REUP_COOKIE_BROWSER`
(Chrome by default) using yt-dlp's existing cookie reader. Only live cookies for
`bilibili.com` and its subdomains are added to a temporary browser context.
Cookies are not exported to a file or the website. Other website cookies are
not added to this context. The context uses its actual browser User-Agent, also
used for subsequent media requests, rather than impersonating Chrome 131.

The browser lookup also checks the current Windows user's local Chrome/Edge
installation. It never searches another Windows user's profile automatically.

## Support signals

The log reports only a session state and count, never cookie values:

- `available`: one or more unexpired Bilibili cookies were imported. This does
  not prove the account is logged in or that a browser challenge is satisfied.
- `empty`: extraction succeeded but returned no usable Bilibili cookies. Check
  that the configured profile is the one used for playback.
- `unavailable`: extraction could not complete. This can require checking the
  selected profile, file locking or OS/browser credential protection. Raw
  extraction exceptions are intentionally not displayed in support logs.

If HTTP 412 remains after importing cookies, capture the session state and the
original yt-dlp error before the fallback. Do not conclude that the IP is banned
or promise an authentication/challenge bypass. A managed interactive session may
be required if the OS will not permit reading the customer's usual profile.

## Validation

Eight browser/cookie regression tests cover domain filtering, expiry, HttpOnly,
failed decryption, importing cookies before navigation, forwarding the browser
User-Agent to media requests, preserving existing sources and cleaning staging.
The complete Python suite (137 tests) and Node suite (36 tests) passed. Browser
fixtures never read real customer cookies or contact Bilibili. Customer-network
validation of video `BV1S7446fEFw` is still required; a passed fixture is not
proof that Bilibili will accept a particular customer session.

# URL compatibility in 0.2.41

Direct video input accepts full Bilibili/Douyin links, bare BV/AV identifiers,
mobile and localized Bilibili `/vi/video/` URLs, Markdown links and share text.
Official `b23.tv` and `v.douyin.com` redirects are resolved locally with bounded
timeouts; redirects to unsupported hosts or insecure destinations are rejected.
Tracking parameters are discarded while Bilibili `p` (episode) and `t` are kept.
BV identifiers retain their case. Multipart selections use a distinct `_pN`
library/job key so an existing first-part download is not reused for another part.

The website detects direct-video input even when the channel selector was left
selected. Channel/profile synchronization continues through its existing path.
This covers video link formats, not every content type (e.g. Douyin image notes
or Bilibili channel pages in the one-video input). It does not establish that a
source will allow the download or eliminate HTTP 412.

Validation: 143 Python tests and 38 web unit tests passed, including shared-text,
locale, tracking, multipart identity, official redirect and hostile-host fixtures.
Customer playback/session compatibility still requires an actual customer test.

Packaged 0.2.41 smoke checks: OCR reader/postprocessing, TTS phoneme data,
Whisper native imports and FFmpeg audio processing passed. The module is present
in the PyInstaller analysis. Running arbitrary modules through `--python-module`
remains intentionally denied; only yt-dlp is allowed.

## 0.2.42 localized-player recovery

The `/vi/video/` page can provide `__INITIAL_STATE__.videoData` with its BVID
and CID but never populate `__playinfo__`. The fallback now requests Bilibili's
player stream endpoint inside the browser context with the selected page's CID;
it only waits briefly for `__playinfo__` if that endpoint does not return a
usable stream. This removes the 30-second blind timeout for the reported case.

On 2026-11-10, the exact reported BV1S7446fEFw URL completed a full
140,146,614-byte MP4 download and mux on the development machine with
`browser session: unavailable` and zero imported cookies. A headless page and
player API check also returned HTTP 200. This establishes that public playback
works for that source on this machine; source-side access on a customer's
network still needs a customer test. The Python suite passed 144 tests.
