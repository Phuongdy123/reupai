"""Exercise the actual process form using local fixture data and no real jobs."""
import asyncio
import importlib.util
import json
from pathlib import Path
import threading
from http.server import ThreadingHTTPServer
from playwright.async_api import async_playwright, expect

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("workspace_fixture", HERE / "workspace-browser.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


async def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), fixture.Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    checks = []
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(channel="chrome", headless=True)
            page = await browser.new_page(viewport={"width": 1366, "height": 900})
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            await page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(base + "/") else route.abort())
            await page.goto(base + "/fixture")
            await page.wait_for_function("window.fixtureReady")
            await page.evaluate("openConfig()")
            await expect(page.locator("#processInspectorVideo")).to_be_visible()
            await expect(page.locator("#processInspectorOcr")).not_to_be_visible()
            await expect(page.locator("#processSourceLanguage")).to_have_value("auto")
            await page.locator("#processInspectorTabOcr").click()
            await expect(page.locator("#processInspectorOcr")).to_be_visible()
            await expect(page.locator("#processOcrOptions")).not_to_be_visible()
            await page.locator("#processTranscriptSource").select_option("video_subtitles")
            await expect(page.locator("#processOcrOptions")).to_be_visible()
            await page.locator("#processOcrFps").fill("4")
            await expect(page.locator('output[data-for="processOcrFps"]')).to_have_text("4 fps")
            await page.locator("#processOutputFormat").select_option("srt")
            await page.locator("#runProcessConfig").click()
            assert await page.evaluate("lastProcess.mode") == "subtitle"
            assert await page.evaluate("lastProcess.config.output_format") == "srt"
            assert await page.evaluate("lastProcess.config.transcript_source") == "video_subtitles"
            assert await page.evaluate("lastProcess.config.ocr_fps") == 4
            checks.append("OCR options require explicitly choosing the right inspector tab and image source; standalone SRT keeps manual settings")
            await page.evaluate("openConfig()")
            await expect(page.locator("#processInspectorVideo")).to_be_visible()
            await expect(page.locator("#processInspectorOcr")).not_to_be_visible()
            await expect(page.locator("#processTranscriptSource")).to_have_value("audio")
            await expect(page.locator("#processOutputFormat")).to_have_value("video")
            await page.locator("#runProcessConfig").click()
            assert await page.evaluate("lastProcess.mode") == "voiceover"
            assert await page.evaluate("lastProcess.config.output_format") == "video"
            checks.append("the next video restores automatic defaults and normal voice/video output")
            await page.set_viewport_size({"width": 390, "height": 844})
            await page.evaluate("openConfig()")
            await expect(page.locator(".process-inspector-rail")).to_have_attribute("aria-orientation", "horizontal")
            await page.locator("#processInspectorTabOcr").focus()
            await page.keyboard.press("ArrowRight")
            await expect(page.locator("#processInspectorTabAudio")).to_have_attribute("aria-selected", "true")
            await expect(page.locator("#processInspectorOcr")).not_to_be_visible()
            checks.append("the extra OCR tab supports keyboard navigation and the mobile horizontal rail")
            assert not errors, errors
            await browser.close()
    finally:
        server.shutdown()
    print(json.dumps({"checks": checks}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
