# Microsoft Store release: ReupAI Local Engine

This is a second distribution channel for the Windows Local Engine. The existing direct-download Inno Setup installer is separate. Store distribution uses a full-trust MSIX package, not the Inno Setup EXE.

## What is ready in the repository

- `scripts/build_msix.ps1` packages an existing `dist/ReupAI` output with Microsoft's MakeAppx tool. It keeps MakeAppx semantic validation enabled and writes a SHA256 file, package log, and JSON build report beside the MSIX.
- `packaging/msix/AppxManifest.xml.in` declares an x64 packaged desktop app for Windows 10 2004 or newer. The only restricted capability is `runFullTrust`; the package does not request administrator elevation, services, or automatic startup.
- `packaging/msix/generate_assets.py` resizes the existing ReupAI logo from `web/public/images/reupai-logo.png`. It creates the required 44, 150 and 50 pixel package logos plus a 300 pixel listing logo.
- A `reupai-distribution.json` marker in the package describes the MSIX distribution and optional Store product ID. The running Engine must use actual Windows package identity to enforce Store-owned updates. A marker file alone is not proof that an app came from the Store.

## Identity that the account owner must supply

Reserve the real product name in Partner Center and copy the following values from **Product identity**. Do not invent them and do not use preview values for submission:

| Build argument | Partner Center value |
| --- | --- |
| `-IdentityName` | `Package/Identity/Name` |
| `-Publisher` | `Package/Identity/Publisher`, including the complete `CN=...` string |
| `-PublisherDisplayName` | `Package/Properties/PublisherDisplayName` |
| `-DisplayName` | The reserved Store display name |
| `-StoreProductId` | Optional 12-character product ID used in the Store link |

For ReupAI distributed as part of a business, trade, or profession, use the appropriate Company publisher account. Microsoft's current onboarding flow has no registration fee, but publisher/business verification is still required. The account owner completes identity documents and agreements directly with Microsoft.

## Build commands

Create the frozen Windows output first with the runtime changes for packaged operation:

```powershell
.\scripts\build_windows.ps1 -SkipInstaller -Incremental
```

Run a packaging-only preview. This uses an explicit development identity and produces an **unsigned, non-submittable** package:

```powershell
.\scripts\build_msix.ps1 -Preview -BootstrapSdk
```

The optional `-BootstrapSdk` downloads a pinned `Microsoft.Windows.SDK.BuildTools` package from official NuGet into ignored `build/msix-tools`. It verifies the package SHA256 and Microsoft's Authenticode signature on MakeAppx. It does not install or change the system SDK. An installed Windows SDK or an explicit `-MakeAppxPath` works without a download.

After receiving the actual Partner Center values, create a Store submission package:

```powershell
.\scripts\build_msix.ps1 `
  -IdentityName '<exact Package/Identity/Name>' `
  -Publisher '<exact Package/Identity/Publisher>' `
  -PublisherDisplayName '<exact Package/Properties/PublisherDisplayName>' `
  -DisplayName '<reserved Store app name>' `
  -StoreProductId '<actual Store product ID>' `
  -BootstrapSdk
```

The package version comes from the frozen EXE's ProductVersion with a final `.0`, for example `0.2.45.0`. All four version fields must fit the MSIX range. The script refuses a version that differs from the executable or reuses an existing output unless `-Overwrite` is explicitly supplied.

The resulting Store package is intentionally unsigned. Microsoft signs an MSIX submitted to the Store after certification. It is not a directly installable public download. Do not instruct customers to disable security protections or install a preview certificate. A direct EXE/MSI or sideloaded MSIX requires a separate trusted code-signing approach.

## Runtime and certification checks

Before submission, rebuild the EXE with MSIX-aware update guards and check it on a clean Windows account/VM:

1. Launch and tray exit work without elevation. A user with an existing direct-install Engine receives a useful already-running response rather than a second server competing for port 17888.
2. The website connects to the Engine at loopback and validates its browser authorization. No non-loopback network listener is added by packaging.
3. Google desktop OAuth opens the system browser, returns through its loopback callback, refreshes tokens, and keeps the customer's own Cloud project/quota. Do not put a shared ReupAI Gemini key into the package.
4. A complete local video job can find FFmpeg, OCR, Whisper and voice resources and launch child Engine processes. The package install folder is read-only, so models, logs, video, downloads and job state must stay in writable per-user storage.
5. The packaged Engine rejects the direct EXE updater and sends the user to the Store/update mechanism for its channel. Updating from the Store preserves user data.
6. Account sign-out removes the intended session while keeping other authorized browser tabs/Windows users isolated.
7. Run the Windows App Certification Kit where available and attach results to the release review. MakeAppx semantic validation is necessary but does not replace runtime tests or Store certification.
8. Test upgrade and uninstall behavior. Explain in the support page which video/project files remain in user-selected folders, and do not delete customer media automatically.

## Store submission material

- Public homepage: `https://www.reupai.cloud/`.
- Public privacy policy: `https://www.reupai.cloud/privacy`.
- Support: `phuongndps39487@gmail.com` and the website feedback flow.
- Listing description: Local Windows processing companion for ReupAI: prepares source videos the user has permission to use, creates subtitles and voiceovers, renders results on the user's device, and connects to the user's own Google Cloud project for Gemini.
- Capability explanation for `runFullTrust`: the existing Python desktop Engine runs FFmpeg, OCR, speech recognition and text-to-speech processes, writes user-owned video/project files, displays a tray icon and communicates with the ReupAI website via an authenticated localhost API. It runs at the current Windows user's integrity level without administrator privileges.
- Reviewer notes: the website login can be completed before installing the Engine. The reviewer needs a test account/entitlement with enough jobs; use the reviewer's own Google Cloud project or provide a safe dedicated review setup rather than personal credentials. Show any required Gemini setup and disclose any model downloads or network dependencies.
- Screenshots must show the actual product, including the connected Engine and a working video-processing flow. Do not use mockup-only screens as evidence of working features.
- Commercial non-game PC apps may retain secure third-party commerce such as payOS subject to Store policy. Disclose the payment provider and obtain clear transaction confirmation. Store signing does not imply Store billing is mandatory.

## Official references

- [Create an MSIX package with MakeAppx](https://learn.microsoft.com/en-us/windows/uwp/packaging/create-app-package-with-makeappx-tool)
- [Package a desktop application manually](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-manual-conversion)
- [Store signing: MSIX versus MSI/EXE](https://learn.microsoft.com/en-us/windows/apps/publish/faq/get-started-with-the-microsoft-store)
- [Packaged desktop runtime and read-only install files](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes)
- [Store policies, including capabilities, commerce and account type](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies)
- [Open a publisher account](https://learn.microsoft.com/en-us/windows/apps/publish/faq/open-developer-account)

Prepared on 2026-11-10. The final publisher identity, account eligibility, actual install/upgrade test and Microsoft certification remain external prerequisites.
