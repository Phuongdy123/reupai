"""Check the real React editor with local fixtures; no account or upload calls."""
import asyncio
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import tempfile
import threading
from http.server import ThreadingHTTPServer
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("fixture", ROOT / "web/tests/workspace-browser.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


async def main():
    bundle = "\n".join(re.sub(r"^import .*?;\s*$", "", (ROOT / "web/src/components" / name).read_text(encoding="utf-8"), flags=re.M).replace("export function", "function")
                       for name in ["output-transcript-editor.jsx", "thumbnail-designer.jsx", "youtube-publish-dialog.jsx", "output-youtube-actions.jsx", "output-editor.jsx"])
    node = "const b=require('./web/node_modules/next/dist/compiled/babel/core');const p=require('./web/node_modules/next/dist/compiled/babel/preset-react');let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>process.stdout.write(b.transformSync(s,{presets:[[p,{runtime:'classic'}]],configFile:false,babelrc:false}).code));"
    js = subprocess.check_output(["node", "-e", node], input=bundle.encode(), cwd=ROOT).decode()
    with tempfile.TemporaryDirectory() as folder:
        media = Path(folder) / "sample.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=1280x720:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(media)], check=True)
        class Handler(fixture.Handler):
            def do_GET(self):
                if self.path == "/react.js": return self.send((ROOT / "web/node_modules/react/umd/react.development.js").read_bytes(), "text/javascript")
                if self.path == "/react-dom.js": return self.send((ROOT / "web/node_modules/react-dom/umd/react-dom.development.js").read_bytes(), "text/javascript")
                if self.path == "/sample.mp4": return self.send(media.read_bytes(), "video/mp4")
                super().do_GET()
        styles = "".join(f'<link rel="stylesheet" href="/src/styles/{name}">' for name in re.findall(r'@import "../src/styles/([^"]+)"', (ROOT / "web/app/globals.css").read_text()))
        fixture.FIXTURE = '<!doctype html><html class="theme-xports"><head><meta charset="utf-8">' + styles + '''</head><body class="theme-xports"><div id="app"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script>
const {useCallback,useEffect,useRef,useState}=React;const createPortal=ReactDOM.createPortal;
const Icon=()=>null,Loading=()=>null,Notice=({children})=>React.createElement('div',null,children),ErrorMessage=({error})=>React.createElement('div',null,error),modeLabel=()=> 'Voice';
const googleConsentUrl=()=>null;
const youtubeRequest=()=>{throw Error('Unexpected external API call');};
const useYoutubeConnection=()=>({supported:true,connection:{connected:true,account_id:'fixture-account',channel:{id:'channel',title:'Kênh kiểm thử'}},connect:()=>{},refresh:()=>{},client});
const client={mediaUrl:async()=>'/sample.mp4',json:async(path,options)=>{
 if(path.includes('/rerender')){window.payload=JSON.parse(options.body);return {job_id:1};}
 return {subtitles:[{start:0,end:1,text:'Xin chào'},{start:1,end:2,text:'Cảm ơn'}],subtitle_edit_supported:true,voice:'Trúc Ly',tts_speed:1.1,source_ready:true,can_rerender:true,blur_intervals:[],blur_region:null};
}};
''' + js + '''
ReactDOM.createRoot(document.getElementById('app')).render(React.createElement(OutputEditor,{client,item:{video_id:'fixture',channel:'test',mode:'voiceover'},onClose:()=>{},onQueued:()=>{window.queued=true;}}));
</script>'''
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(channel="chrome", headless=True)
                page = await browser.new_page(viewport={"width": 1366, "height": 1000})
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                await page.goto(f"http://127.0.0.1:{server.server_port}/fixture")
                await expect(page.get_by_label("Bản dịch câu 1")).to_have_value("Xin chào")
                await page.wait_for_function("document.querySelector('video')?.readyState>=2")
                (ROOT / "artifacts").mkdir(exist_ok=True)
                await page.screenshot(path=str(ROOT / "artifacts/output-editor-0.2.52-desktop.png"), full_page=True)
                await expect(page.get_by_role("button", name="Đăng YouTube", exact=True)).to_be_enabled()
                await page.get_by_role("button", name="Đăng YouTube", exact=True).click()
                publish = page.locator("dialog.youtube-publish-dialog")
                await expect(publish).to_be_visible()
                await expect(publish.get_by_role("button", name="Đăng thử riêng tư")).to_be_disabled()
                await publish.get_by_label("Video có dành cho trẻ em không?").select_option("no")
                await publish.get_by_role("checkbox").check()
                await expect(publish.get_by_role("button", name="Đăng thử riêng tư")).to_be_enabled()
                await page.screenshot(path=str(ROOT / "artifacts/output-youtube-0.2.52-desktop.png"), full_page=True)
                await page.keyboard.press("Escape")
                await expect(publish).to_have_count(0)
                await expect(page.get_by_label("Bản dịch câu 1")).to_be_visible()
                await page.get_by_label("Bản dịch câu 1").fill("Nội dung lồng tiếng đã sửa.")
                await page.get_by_label("Kết thúc câu 1").fill("0.9")
                await expect(page.get_by_role("button", name="Đăng YouTube", exact=True)).to_be_disabled()
                await page.get_by_role("combobox").select_option("Hải Đăng")
                await page.get_by_role("button", name="Xuất lại video").click()
                await page.wait_for_function("window.queued")
                payload = await page.evaluate("window.payload")
                assert payload["subtitles"][0] == {"start": 0, "end": .9, "text": "Nội dung lồng tiếng đã sửa."}
                assert payload["voice"] == "Hải Đăng"
                assert payload["blur_region"] is None
                await page.set_viewport_size({"width": 390, "height": 844})
                await page.screenshot(path=str(ROOT / "artifacts/output-editor-0.2.52-mobile.png"), full_page=True)
                assert await page.evaluate("document.documentElement.scrollWidth<=innerWidth")
                assert not errors, errors
                await browser.close()
                print("PASS: edit translated cues/timings and voice; no blur required; block publishing unsaved revisions; YouTube opens its confirmation dialog; mobile has no page overflow.")
        finally:
            server.shutdown()


if __name__ == "__main__": asyncio.run(main())
