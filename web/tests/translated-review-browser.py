"""Exercise translation edits and origin-protected video playback without live jobs."""
import asyncio
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from playwright.async_api import async_playwright, expect

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("workspace_fixture", HERE / "workspace-browser.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


async def main():
    with tempfile.TemporaryDirectory() as folder:
        media = Path(folder) / "source.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=320x180:d=2",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(media)], check=True)

        class MediaHandler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                self.server.origins.append(self.headers.get("Origin"))
                if self.headers.get("Origin") != self.server.allowed_origin:
                    self.send_error(401)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Access-Control-Allow-Origin", self.server.allowed_origin)
                self.end_headers()
                self.wfile.write(media.read_bytes())

        media_server = ThreadingHTTPServer(("127.0.0.1", 0), MediaHandler)
        media_server.origins = []
        server = ThreadingHTTPServer(("127.0.0.1", 0), fixture.Handler)
        base = f"http://127.0.0.1:{server.server_port}"
        media_server.allowed_origin = base
        media_url = f"http://127.0.0.1:{media_server.server_port}/source.mp4"
        fixture.FIXTURE = '''<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/src/styles/process-editor.css">
<div id="card" data-video-id="fixture"></div>
<script type="module">
import {openProcessConfig} from '/src/legacy/process-config-controller.js';
import {createProcessConfigDialog} from '/src/legacy/process-config-dialog.js';
window.translationCalls=0; window.mediaPaths=[]; window.processCount=0;
const video={video_id:'fixture',channel:'selected_channel',downloaded:true};
window.reupEngineClient={
 health:{capabilities:{reviewed_translations:true}},
 mediaUrl:async path=>{window.mediaPaths.push(path); return MEDIA_URL;},
 json:async(path,options)=>{
   if(path==='/api/preview/transcript/fixture') return {task_id:'test',status:'processing',lines:[]};
   if(path==='/api/preview/transcript/fixture/test') { if(window.recognitionGate) await window.recognitionGate; return {status:'complete',progress:100,lines:[
     {id:1,start:0,end:1,text:'你好'},{id:2,start:1,end:2,text:'谢谢'}]}; }
   if(path==='/api/preview/subtitle-translation'){
     window.translationCalls++;
     const lines=JSON.parse(options.body).lines;
     return {translations:lines.filter(line=>window.translationCalls>1 || line.id===1)
       .map(line=>({id:line.id,text:line.id===1?'Xin chào':'Cảm ơn'}))};
   }
   return {};
 }
};
await openProcessConfig(video,document.getElementById('card'),'voiceover',{
 document,window,localStorage,uiIcon:()=>'',formatDuration:()=>'',formatVideoRatio:()=>'',
 processConfigDefaults:()=>({}),downloadVideo:async()=>{},
 processVideo:(_video,_card,mode,config)=>{window.processCount++;window.lastProcess={mode,config};},
 ensureProcessConfigDialog:async()=>createProcessConfigDialog({document,uiIcon:()=>''})
});
window.fixtureReady=true;
</script>'''.replace("MEDIA_URL", json.dumps(media_url))
        for item in [server, media_server]:
            threading.Thread(target=item.serve_forever, daemon=True).start()
        try:
            async with async_playwright() as playwright:
                browser = await playwright.chromium.launch(channel="chrome", headless=True)
                page = await browser.new_page(viewport={"width": 1440, "height": 900})
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                await page.route("**/*", lambda route: route.continue_() if route.request.url.startswith((base + "/", media_url)) else route.abort())
                await page.goto(base + "/fixture")
                await page.wait_for_function("window.fixtureReady")
                await page.locator("#runProcessConfig").click()
                await expect(page.locator("#processTranscriptTranslationRetry")).to_be_visible()
                first = page.locator(".ocr-line-translation").first
                await expect(first).to_have_value("Xin chào")
                await first.fill("Xin chào, bản dịch tôi tự sửa.")
                await page.locator("#processTranscriptTranslationRetry").click()
                await expect(page.locator("#processTranscriptReviewConfirm")).to_be_enabled()
                await expect(first).to_have_value("Xin chào, bản dịch tôi tự sửa.")
                await page.wait_for_function("document.getElementById('processTranscriptReviewPreview').readyState >= 2")
                assert base in media_server.origins, media_server.origins
                assert all("channel=selected_channel" in path for path in await page.evaluate("mediaPaths"))
                assert await first.evaluate("element=>element.getBoundingClientRect().width") > 200
                await page.evaluate("window.reupEngineClient.health.capabilities.reviewed_translations=false")
                await page.locator("#processTranscriptReviewConfirm").click()
                await expect(page.locator("#processTranscriptReviewStatus")).to_contain_text("0.2.51")
                assert await page.evaluate("processCount") == 0
                await page.evaluate("window.reupEngineClient.health.capabilities.reviewed_translations=true")
                await page.locator(".ocr-line-end").first.fill("0.95")
                await page.locator("#processTranscriptReviewSkip").click()
                await page.wait_for_function("window.processCount === 1")
                cues = await page.evaluate("lastProcess.config.manual_transcript")
                assert cues[0]["text"] == "你好"
                assert cues[0]["translated_text"] == "Xin chào, bản dịch tôi tự sửa."
                assert cues[0]["end"] == 0.95
                assert cues[1]["translated_text"] == "Cảm ơn"
                assert not errors, errors
                await page.reload()
                await page.wait_for_function("window.fixtureReady")
                await page.evaluate("translationCalls=1")
                await page.locator("#runProcessConfig").click()
                try:
                    await page.wait_for_function("window.processCount === 1",timeout=6000)
                except Exception:
                    print(await page.evaluate("({count:processCount,calls:translationCalls,status:document.getElementById('processTranscriptReviewStatus').textContent,open:document.getElementById('processTranscriptReviewDialog').open,confirm:document.getElementById('processTranscriptReviewConfirm').outerHTML,foot:document.querySelector('.process-transcript-review-footnote').textContent})"))
                    print('JS errors:',errors)
                    raise
                assert await page.evaluate("lastProcess.config.manual_transcript[0].translated_text") == "Xin chào"
                assert not await page.locator("#processTranscriptReviewDialog").is_visible()
                await page.reload()
                await page.wait_for_function("window.fixtureReady")
                await page.evaluate("translationCalls=1; window.recognitionGate=new Promise(resolve=>window.finishRecognition=resolve); void 0")
                await page.locator("#runProcessConfig").click()
                await page.locator("#processTranscriptReviewPause").click()
                await page.locator("#processTranscriptReviewSkip").click()
                assert await page.evaluate("processCount") == 0
                await page.evaluate("window.finishRecognition()")
                await page.wait_for_function("window.processCount === 1")
                assert await page.evaluate("lastProcess.config.manual_transcript[0].translated_text") == "Xin chào"
                assert await page.evaluate("translationCalls") == 2
                assert not errors, errors
                await browser.close()
                print("PASS: protected video plays; edits pause automatic export; retry preserves edits; old engines cannot discard edits; continue works during recognition and after editing; auto-export runs exactly once.")
        finally:
            server.shutdown()
            media_server.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
