"""Run after npm run build. Uses local rendered pages and mocks; never calls live APIs."""
import asyncio
import json
import mimetypes
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright, expect

WEB = Path(__file__).resolve().parents[1]
OUT = WEB.parent / 'artifacts' / 'interaction-review'
FIXTURE = '''<!doctype html><html><body><button id="trigger">Open</button><div id="card" data-video-id="fixture"></div>
<script type="module">
import {openProcessConfig} from '/src/legacy/process-config-controller.js';
import {createProcessConfigDialog} from '/src/legacy/process-config-dialog.js';
window.processCount=0; window.aiAborted=0; window.aiStarted=0;
const card=document.getElementById('card');
const video={video_id:'fixture',title:'Test video',downloaded:false};
window.reupEngineClient={
  mediaUrl:async()=>'/missing-preview.mp4',
  json:(path,options)=>new Promise((resolve,reject)=>{
    if(path!=='/api/assistant') {resolve({});return;}
    window.aiStarted++;
    options.signal.addEventListener('abort',()=>{window.aiAborted++;reject(new DOMException('Aborted','AbortError'));},{once:true});
  })
};
const NativeFileReader=window.FileReader;
window.FileReader=class extends NativeFileReader { readAsDataURL(file) {setTimeout(()=>super.readAsDataURL(file),100);} };
window.openConfig=()=>openProcessConfig(video,card,'voiceover',{
  document,window,localStorage,uiIcon:()=>'',formatDuration:()=>'',formatVideoRatio:()=>'',
  processConfigDefaults:()=>({}),downloadVideo:async()=>{},processVideo:(_video,_card,mode,config)=>{window.processCount++;window.lastProcess={mode,config};},
  ensureProcessConfigDialog:async()=>createProcessConfigDialog({document,uiIcon:()=>''})
});
window.fixtureReady=true;
</script></body></html>'''

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self):
        path=urlparse(self.path).path
        if path=='/fixture': return self.send(FIXTURE.encode(),'text/html')
        if path == '/api/engine/release':
            return self.send(json.dumps({'release': self.server.engine_release} if self.server.engine_release else {'available':False}).encode(), 'application/json')
        if path == '/api/billing/me':
            self.server.billing_requests += 1
            return self.send(json.dumps({'error':'Fixture unavailable'} if self.server.billing_fail else self.server.billing_response).encode(),'application/json',503 if self.server.billing_fail else 200)
        if path.startswith('/api/'):
            return self.send(json.dumps({'authenticated':True,'plan':'admin','unlimited':True}).encode(),'application/json')
        if path.startswith('/_next/static/'):
            target=WEB / '.next' / path.removeprefix('/_next/')
        elif path.startswith('/src/'):
            target=WEB / path.lstrip('/')
        elif (WEB / 'public' / path.lstrip('/')).is_file():
            target=WEB / 'public' / path.lstrip('/')
        else:
            route=path.strip('/') or 'index'
            ext='.rsc' if self.headers.get('RSC')=='1' else '.html'
            target=WEB / '.next/server/app' / (route+ext)
        if not target.is_file(): self.send_error(404);return
        mime='text/x-component' if target.suffix=='.rsc' else 'text/javascript' if target.suffix=='.js' else mimetypes.guess_type(str(target))[0] or 'application/octet-stream'
        self.send(target.read_bytes(),mime)
    def send(self,data,mime,status=200):
        self.send_response(status);self.send_header('Content-Type',mime);self.end_headers()
        try: self.wfile.write(data)
        except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError): pass

async def main():
    OUT.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    server.billing_requests=0; server.billing_fail=False
    server.engine_release=None
    server.billing_response={'configured':True,'authenticated':True,'paymentsEnabled':True,'plan':'admin','unlimited':True,'proPrice':149000}
    threading.Thread(target=server.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{server.server_port}'
    checks=[]
    try:
        async with async_playwright() as p:
            browser=await p.chromium.launch(channel='chrome',headless=True)
            context=await browser.new_context(viewport={'width':1440,'height':1000})
            # All non-fixture requests are blocked, including Supabase and the real Engine.
            async def local_only(route):
                if route.request.url.startswith(base+'/'): await route.continue_()
                else: await route.abort()
            await context.route('**/*',local_only)
            page=await context.new_page(); errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            await page.goto(base+'/app',wait_until='networkidle')
            await expect(page.locator('.plan-status-admin')).to_be_visible()
            assert server.billing_requests==1, f'duplicate billing requests: {server.billing_requests}'
            await expect(page.locator('.sidebar-mobile-close')).to_be_hidden()
            await page.locator('.sidebar-collapse').click()
            await expect(page.locator('.app-shell')).to_have_class(__import__('re').compile('is-collapsed'))
            assert (await page.locator('.sidebar').bounding_box())['width']<100
            await page.locator('.sidebar-collapse').click()
            await page.locator('.quick-nav-trigger').click()
            await expect(page.locator('.quick-nav-dialog input')).to_be_focused()
            await page.keyboard.press('Escape')
            await expect(page.locator('.quick-nav-dialog')).to_have_count(0)
            await expect(page.locator('.quick-nav-trigger')).to_be_focused()
            await page.locator('.topbar-avatar').click()
            await expect(page.locator('.account-menu')).to_be_visible()
            await page.locator('.dashboard-welcome h2').click()
            await expect(page.locator('.account-menu')).to_have_count(0)
            checks.append('desktop: collapse, account menu, quick navigation and focus return')
            await page.screenshot(path=str(OUT/'dashboard-desktop.png'),full_page=True)
            for width in [390,768,1366]:
                await page.set_viewport_size({'width':width,'height':900})
                assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'), f'overflow at {width}'
                if width in [390,768]:
                    await page.locator('.sidebar-mobile-toggle').click()
                    await expect(page.locator('.sidebar-mobile-close')).to_be_visible()
                    await page.keyboard.press('Shift+Tab')
                    assert await page.evaluate('document.getElementById("workspace-sidebar").contains(document.activeElement)')
                    await page.keyboard.press('Escape')
                    await expect(page.locator('.sidebar-mobile-toggle')).to_be_focused()
                    await expect(page.locator('.sidebar')).to_be_hidden()
                    await page.screenshot(path=str(OUT/'dashboard-mobile.png'),full_page=True)
                checks.append(f'workspace responsive: {width}px')
            await page.set_viewport_size({'width':1440,'height':1000})
            await page.locator('.sidebar .nav-item[href="/downloads"]').click()
            await page.wait_for_url(base+'/downloads')
            await expect(page.locator('.topbar h1')).to_have_text('Video đã tải')
            checks.append('client navigation from dashboard to downloads')
            await page.locator('.sidebar .nav-item[href="/profile"]').click()
            await page.wait_for_url(base+'/profile')
            await page.locator('.sidebar .nav-item[href="/plans"]').click()
            await page.wait_for_url(base+'/plans')
            await expect(page.locator('.plans-account').first).to_contain_text('ReupAI Admin')
            await page.locator('.plans-nav a[href="/app"]').click()
            await page.wait_for_url(base+'/app')
            await expect(page.locator('.plan-status-admin')).to_be_visible()
            assert server.billing_requests==1, f'billing cache was lost on navigation: {server.billing_requests}'
            checks.append('one billing request shared across dashboard, shell, profile and plans navigation')
            server.billing_response={**server.billing_response,'plan':'pro','proUntil':'2030-01-01T00:00:00Z'}
            await page.evaluate("window.dispatchEvent(new CustomEvent('reupai:billing-changed'))")
            await expect(page.locator('.plan-status-pro')).to_be_visible()
            await expect(page.locator('.dashboard-plan-name')).to_contain_text('ReupAI Pro')
            checks.append('entitlement refresh updates both dashboard and account badge')
            server.billing_fail=True
            await page.evaluate("window.dispatchEvent(new CustomEvent('reupai:billing-changed'))")
            await expect(page.locator('.billing-load-notice')).to_be_visible()
            await expect(page.locator('.plan-status-pro')).to_be_visible()
            await expect(page.locator('.plan-status-free')).to_have_count(0)
            server.billing_fail=False
            await page.locator('.billing-load-notice button').click()
            await expect(page.locator('.billing-load-notice')).to_have_count(0)
            checks.append('failed refresh retains Pro and manual retry clears the error')
            server.billing_response={**server.billing_response,'orders':[{'order_code':123,'status':'paid','amount':149000}]}
            await page.goto(base+'/plans?order=123',wait_until='networkidle')
            await expect(page.locator('.plans-banner.success')).to_be_visible()
            paid_reads=server.billing_requests
            await page.wait_for_timeout(4300)
            assert server.billing_requests==paid_reads, 'paid order should stop polling'
            await page.locator('.plans-nav a[href="/app"]').click()
            await page.wait_for_url(base+'/app')
            await expect(page.locator('.plan-status-pro')).to_be_visible()
            assert server.billing_requests==paid_reads, 'workspace should use the confirmed paid plan'
            checks.append('confirmed payment stops polling and retains Pro when returning to workspace')
            await page.goto(base+'/fixture'); await page.wait_for_function('window.fixtureReady')
            for _ in range(3):
                await page.evaluate('openConfig()')
                await page.locator('#toggleProcessPicker').click()
                await expect(page.locator('#toggleProcessPicker')).to_have_attribute('aria-pressed','true')
                await page.locator('#toggleProcessPicker').click()
                await expect(page.locator('#toggleProcessPicker')).to_have_attribute('aria-pressed','false')
                await page.locator('#cancelProcessConfig').click()
                await expect(page.locator('#processConfigDialog')).not_to_be_visible()
            checks.append('configuration reopen: no duplicate picker handlers')
            await page.evaluate('openConfig()')
            await page.locator('#processAutoBrandBlur').check()
            await page.locator('#cancelProcessConfig').click()
            await expect(page.locator('#processConfigDialog')).not_to_be_visible()
            await page.evaluate('openConfig()')
            await expect(page.locator('#processAutoBrandBlur')).not_to_be_checked()
            await page.locator('#cancelProcessConfig').click()
            await expect(page.locator('#processConfigDialog')).not_to_be_visible()
            checks.append('watermark removal is opt-in for each new video configuration')
            await page.evaluate('openConfig()')
            await expect(page.locator('#processInspectorOcr')).not_to_be_visible()
            await page.locator('#processInspectorTabOcr').click()
            await expect(page.locator('#processInspectorOcr')).to_be_visible()
            await expect(page.locator('#processOcrOptions')).not_to_be_visible()
            await page.locator('#processTranscriptSource').select_option('video_subtitles')
            await expect(page.locator('#processOcrOptions')).to_be_visible()
            await page.locator('#processOutputFormat').select_option('srt')
            await page.screenshot(path=str(OUT/'ocr-srt-desktop.png'))
            await page.locator('#runProcessConfig').click()
            assert await page.evaluate('lastProcess.mode') == 'subtitle'
            assert await page.evaluate('lastProcess.config.output_format') == 'srt'
            assert await page.evaluate('lastProcess.config.transcript_source') == 'video_subtitles'
            await page.evaluate('openConfig()')
            await expect(page.locator('#processInspectorOcr')).not_to_be_visible()
            await expect(page.locator('#processTranscriptSource')).to_have_value('audio')
            await expect(page.locator('#processOutputFormat')).to_have_value('video')
            await page.locator('#cancelProcessConfig').click()
            await page.evaluate('window.processCount=0')
            checks.append('OCR is opt-in in the right inspector; standalone SRT uses subtitle mode and settings reset for the next video')
            await page.evaluate('openConfig()')
            await page.locator('.process-ai-disclosure summary').click()
            await page.locator('#processAiPrompt').fill('Test fixture')
            await page.locator('#processAiGenerate').click()
            await page.wait_for_function('aiStarted===1')
            await page.locator('#cancelProcessConfig').click()
            await page.wait_for_function('aiAborted===1')
            await page.evaluate('openConfig()')
            await expect(page.locator('#processAiGenerate')).to_be_enabled()
            checks.append('closing configuration aborts AI request and reopening enables retry')
            await page.evaluate("()=>{const form=document.querySelector('#processConfigDialog form');form.requestSubmit();form.requestSubmit();}")
            await page.wait_for_function('processCount===1')
            await page.wait_for_timeout(50)
            assert await page.evaluate('processCount')==1
            checks.append('double submission without files creates one job')
            await page.evaluate('openConfig()')
            await page.locator('#processMusicFile').set_input_files({'name':'fixture.mp3','mimeType':'audio/mpeg','buffer':b'fixture'})
            await page.evaluate('''()=>{const form=document.querySelector('#processConfigDialog form');form.requestSubmit();form.requestSubmit();}''')
            await page.wait_for_function('processCount===2')
            await page.wait_for_timeout(180)
            assert await page.evaluate('processCount')==2
            checks.append('double submission with asynchronous file reading creates one job')
            await page.evaluate('openConfig()')
            await page.locator('#processMusicFile').set_input_files({'name':'fixture.mp3','mimeType':'audio/mpeg','buffer':b'fixture'})
            await page.evaluate('''()=>{document.querySelector('#processConfigDialog form').requestSubmit();document.getElementById('processConfigDialog').close();}''')
            await page.wait_for_timeout(180)
            assert await page.evaluate('processCount')==2
            checks.append('closing during file reading does not start a late job')
            server.engine_release={'version':'0.2.36','size':450000000}
            await page.goto(base+'/app',wait_until='networkidle')
            await page.evaluate("""()=>{const client=window.reupEngineClient;
                client.check=async()=>true;client.json=async()=>({});
                client.request=async()=>new Response('{}',{headers:{'Content-Type':'application/json'}});
                client.health={version:'0.2.34',capabilities:{}};client.emit('connected');}""")
            await expect(page.locator('.engine-update-notice a')).to_have_attribute('href','/api/engine/download')
            await expect(page.locator('.engine-update-notice')).to_contain_text('0.2.34')
            checks.append('old Engine gets the stable installer download instead of an unsupported update call')
            await page.evaluate("""()=>{
              const client=window.reupEngineClient;
              client.check=async()=>true;
              client.request=async()=>new Response('{}',{headers:{'Content-Type':'application/json'}});
              window.updateStarts=0;window.fixtureUpdate={state:'available'};
              client.json=async(path,options)=>{
                if(path==='/api/updates/start'){window.updateStarts++;window.fixtureUpdate={state:'waiting',progress:100};return window.fixtureUpdate;}
                if(path==='/api/updates/cancel'){window.fixtureUpdate={state:'cancelled'};return window.fixtureUpdate;}
                if(path==='/api/updates')return window.fixtureUpdate;
                return {};
              };
              client.health={version:'0.2.35',capabilities:{verified_updates:true}};client.emit('connected');
            }""")
            await page.locator('.engine-update-notice button',has_text='Cập nhật ngay').click()
            await expect(page.locator('.engine-update-notice')).to_contain_text('Chờ công việc')
            await expect(page.locator('.engine-update-notice button',has_text='Đang cập nhật')).to_be_disabled()
            assert await page.evaluate('updateStarts')==1
            await page.locator('.engine-update-notice button',has_text='Hủy').click()
            await expect(page.locator('.engine-update-notice')).to_contain_text('Đã hủy')
            await page.locator('.engine-update-notice button',has_text='Cập nhật ngay').click()
            await page.evaluate("()=>{window.reupEngineClient.health.version='0.2.36';window.reupEngineClient.emit('connected');}")
            await expect(page.locator('.engine-update-notice')).to_contain_text('Cập nhật thành công')
            await page.locator('.engine-update-notice button',has_text='Đóng').click()
            await expect(page.locator('.engine-update-notice')).to_have_count(0)
            checks.append('new Engine update shows waiting, prevents repeated starts, supports cancellation and confirms reconnection')
            assert not errors,errors
            await browser.close()
    finally: server.shutdown()
    (OUT/'checks.json').write_text(json.dumps({'checks':checks,'pageErrors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'passed':len(checks),'checks':checks},ensure_ascii=True,indent=2))

if __name__=='__main__': asyncio.run(main())
