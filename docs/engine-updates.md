# Local Engine release channel

The stable installer URL is `https://www.reupai.cloud/api/engine/download`.
`/api/engine/release` returns the signed release document used by both the web
notice and the Windows updater. Installers are immutable GitHub Release assets
in `Phuongdy123/reupai`.

Engines before 0.2.35 show a download button on the updated website and need one
manual installation. Engines from 0.2.35 support **Cập nhật ngay**. The updater
downloads in the background, verifies the pinned Ed25519 release signature and
the installer size/SHA-256, waits for active work and downloads to finish, and
then closes the work gate before launching Inno Setup. Setup rechecks activity,
closes the tray, installs to the existing directory, and the helper reopens the
Engine. User configuration and libraries stay under their existing runtime root.

The release signing key is stored outside Git:
`C:/Users/duyph/.codex/reupai-release/update-signing-key.pem`.
Back up this key privately. Do not regenerate it for each release: existing
installations trust the corresponding pinned public key. This release signature
is distinct from Windows Authenticode code signing.

For each release:

1. Set the same version in `app/local_engine.py`, `packaging/ReupAI.iss`, and
   `packaging/version_info.txt`; build and run the relevant checks.
2. Commit and push source, leaving the previous live release document intact.
3. Run the publisher using the existing Git Credential Manager login:

   ```powershell
   .\venv\Scripts\python.exe scripts/publish_engine_release.py --installer release/ReupAI-Setup-0.2.35.exe --version 0.2.35 --note "Mô tả bản sửa" --publish
   ```

4. The publisher uploads a draft release, validates the asset, publishes it,
   and only then updates `web/src/lib/engine-release.json` with a signed document.
5. Build, check, commit and deploy that document. Verify the public release API
   and stable download redirect. Never overwrite an installer at an existing tag.

The publisher reports progress while streaming and reuses an existing draft on
retry. If a regional upload route is stalled, `--upload-route-ip` accepts an IP
resolved for `uploads.github.com`; the HTTP hostname, SNI and TLS certificate
verification stay pinned to GitHub. Do not disable certificate validation or
store a regional IP as a permanent download URL.

For a bad release, stop offering its document and publish a higher version with
the correction. The updater rejects a downgrade and rejects unsigned/tampered
documents. It does not claim to roll back a partially failed Windows install;
the result and installer log are in the runtime `updates` directory for repair.
