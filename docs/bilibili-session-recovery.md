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
