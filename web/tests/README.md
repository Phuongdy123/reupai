Run logic checks from `web/` with `node --test tests/*.test.mjs`.

After `npm run build`, run the browser regression from the repository root:

```powershell
.\venv\Scripts\python.exe web/tests/workspace-browser.py
```

The browser check requires Python Playwright and installed Chrome. It serves built
pages on an ephemeral localhost port, exercises the real configuration controller
with injected test dependencies, and blocks requests to external services and the
real Local Engine. No production account, payment, or video job is created.
Screenshots and results are written to `artifacts/interaction-review/`.

This covers shell navigation, keyboard focus, responsive layout and configuration
lifecycle. It does not validate production OAuth, backend job idempotency across
tabs, or video rendering quality.
