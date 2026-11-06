# Google consent on customer machines

Web account login uses the web Google provider and never requires a local app.
After the account is authenticated, Gemini onboarding waits for the Engine.

From Engine 0.2.36, Settings sends `browser=web` and an allowed Settings return
URL when requesting Gemini consent. The Engine publishes the live Google
authorization URL through its existing authenticated diagnostics/status API.
The website navigates the current tab automatically. It uses no popup and does
not depend on the Windows default-browser registration.

A listener on a random IPv4 loopback port checks the callback path and OAuth
state before accepting a code. The Google library retains the PKCE verifier and
performs the token exchange, with a 20-second network timeout. The browser gets
a 303 back to the allowed Settings URL; codes and Google tokens are not placed
in that redirect. Callback logging is suppressed, and the redirect includes
`Referrer-Policy: no-referrer` and `Cache-Control: no-store`.

Cancellation invalidates the attempt and closes the web listener; late callbacks
cannot save credentials. A five-minute deadline clears the consent link and
shows a retry message. The fallback URL is cleared during token exchange and
after completion/cancellation. Desktop callers retain the native browser opener,
but a failed opener does not close the live consent flow.

See Google's [desktop OAuth and loopback guidance](https://developers.google.com/identity/protocols/oauth2/native-app).

Validation covers actual local HTTP callbacks with mocked Google token exchange,
state/PKCE checks, Windows browser failures, cancellation/deadlines, and browser
navigation with mocked Google consent. It does not silently approve Google scopes
for a customer. Customers still choose an account, approve access and select their
own quota project.
