"""Use rendered pages and mocked auth only; never signs in or calls a real Engine.

Build with public test config first, e.g. NEXT_PUBLIC_SUPABASE_URL set to
https://fixture-auth.supabase.co and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY set to
sb_publishable_fixture_only. Production uses the Vercel environment instead.
"""
import asyncio
import base64
import importlib.util
import json
from pathlib import Path
import threading
import time
from http.server import ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright, expect

spec = importlib.util.spec_from_file_location('workspace_fixture', Path(__file__).with_name('workspace-browser.py'))
fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)


async def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), fixture.Handler)
    server.engine_release = None; server.billing_requests = 0; server.billing_fail = False
    server.billing_response = {'configured':True, 'authenticated':True, 'plan':'free', 'freeLimit':3}
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    checks = []; errors = []; authorize = []; registrations = []; engine_before_login = []; auth_service = {}
    user = {'id':'00000000-0000-4000-8000-000000000001','email':'fixture@example.com','aud':'authenticated','role':'authenticated','app_metadata':{},'user_metadata':{},'identities':[]}
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', headless=True)
            async def route_request(route):
                request = route.request; parsed = urlparse(request.url)
                if parsed.port == 17888:
                    current = urlparse(request.frame.url).path
                    if current in ['/sign-in','/sign-up','/local-engine']: engine_before_login.append(current)
                    return await route.abort()
                if parsed.path == '/auth/v1/authorize':
                    auth_service['host'] = parsed.hostname
                    authorize.append(parse_qs(parsed.query))
                    return await route.fulfill(content_type='text/html', body='<h1>Google authorization fixture</h1>')
                if parsed.path == '/auth/v1/signup' and request.method == 'POST':
                    registrations.append(parse_qs(parsed.query))
                    return await route.fulfill(content_type='application/json', body=json.dumps({'user':user,'session':None}), headers={'Access-Control-Allow-Origin':'*'})
                if parsed.path == '/auth/v1/user':
                    return await route.fulfill(content_type='application/json', body=json.dumps(user), headers={'Access-Control-Allow-Origin':'*'})
                if parsed.path == '/api/auth/login' and request.method == 'POST':
                    return await route.fulfill(content_type='application/json', body='{"ok":true}')
                if request.url.startswith(base + '/'): return await route.continue_()
                return await route.abort()
            for path in ['sign-in','sign-up']:
                context = await browser.new_context(viewport={'width':1280,'height':950})
                await context.route('**/*', route_request)
                page = await context.new_page(); page.on('pageerror', lambda error: errors.append(str(error)))
                await page.goto(base + '/' + path + '?next=%2Fsources', wait_until='networkidle')
                await page.locator('.google-sign-in').click()
                await expect(page.locator('h1')).to_have_text('Google authorization fixture')
                assert authorize[-1]['provider'] == ['google']
                callback = urlparse(authorize[-1]['redirect_to'][0])
                assert callback.path == '/auth/callback'
                assert parse_qs(callback.query)['next'] == ['/sources']
                assert not engine_before_login, engine_before_login
                checks.append(path + ': Google account flow opens without an installed Engine')
                await context.close()
            context = await browser.new_context(viewport={'width':1280,'height':1050})
            await context.route('**/*', route_request)
            page = await context.new_page(); page.on('pageerror', lambda error: errors.append(str(error)))
            await page.goto(base + '/sign-up', wait_until='networkidle')
            await page.get_by_placeholder('Họ tên của bạn').fill('Fixture Customer')
            await page.get_by_placeholder('Tên đăng nhập', exact=True).fill('fixture_customer')
            await page.get_by_placeholder('Email của bạn').fill(user['email'])
            await page.get_by_placeholder('Mật khẩu', exact=True).fill('fixture-test-password')
            await page.locator('button.account-submit').click()
            await expect(page.locator('.account-notice.success')).to_contain_text('Tài khoản đã được tạo')
            assert registrations
            confirm = urlparse(registrations[-1]['redirect_to'][0])
            assert parse_qs(confirm.query)['next'] == ['/app?onboarding=1']
            assert await page.evaluate("localStorage.getItem('reupai.gemini.onboarding')") == '1'
            assert not engine_before_login, engine_before_login
            checks.append('email signup succeeds without Engine and keeps pending Gemini consent for after confirmation')
            await page.goto(base + '/sign-in', wait_until='networkidle')
            await page.get_by_placeholder('Email hoặc tên đăng nhập').fill(user['email'])
            await page.get_by_placeholder('Mật khẩu', exact=True).fill('fixture-test-password')
            await page.locator('button.account-submit').click()
            await page.wait_for_url(base + '/app')
            await expect(page.locator('.dashboard-engine-onboarding')).to_be_visible()
            await expect(page.locator('.dashboard-engine-download')).to_have_attribute('href','/api/engine/download')
            assert not engine_before_login, engine_before_login
            checks.append('password login reaches workspace first and then displays the required install steps')
            for width in [390,768,1366]:
                await page.set_viewport_size({'width':width,'height':950})
                assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'), f'overflow at {width}'
            fixture.OUT.mkdir(parents=True, exist_ok=True)
            await page.screenshot(path=str(fixture.OUT / 'install-after-login.png'), full_page=True)
            checks.append('post-login installation guide fits 390px, 768px and desktop')
            await context.close()
            context = await browser.new_context()
            await context.route('**/*', route_request)
            page = await context.new_page()
            await page.goto(base + '/local-engine', wait_until='networkidle')
            await expect(page.locator('.app-shell')).to_have_count(0)
            assert not engine_before_login, engine_before_login
            checks.append('public installer page does not mount the authenticated Engine shell')
            await context.close()
            encode = lambda value: base64.urlsafe_b64encode(json.dumps(value,separators=(',',':')).encode()).decode().rstrip('=')
            token = encode({'alg':'HS256','typ':'JWT'}) + '.' + encode({'sub':user['id'],'email':user['email'],'exp':int(time.time())+3600,'aud':'authenticated'}) + '.Zml4dHVyZQ'
            session = {'access_token':token,'refresh_token':'fixture-only','token_type':'bearer','expires_in':3600,'expires_at':int(time.time())+3600,'user':user}
            for grant_email, expected in [(user['email'],0),('other@example.com',1)]:
                context = await browser.new_context()
                await context.route('**/*', route_request)
                await context.add_cookies([{'name':'sb-'+auth_service['host'].split('.')[0]+'-auth-token','value':'base64-'+encode(session),'url':base}])
                await context.add_init_script("localStorage.setItem('reupai.gemini.onboarding','1')")
                page = await context.new_page(); page.on('pageerror', lambda error: errors.append(str(error)))
                await page.goto(base + '/app',wait_until='networkidle')
                assert urlparse(page.url).path == '/app'
                assert await page.evaluate("localStorage.getItem('reupai.gemini.onboarding')") == '1'
                await expect(page.locator('.dashboard-engine-download')).to_be_visible()
                await page.evaluate("""email=>{
                    const client=window.reupEngineClient;
                    window.fixtureOauthStarts=0;
                    client.check=async()=>true;
                    client.request=async()=>new Response('{}',{headers:{'Content-Type':'application/json'}});
                    client.json=async(path)=>{
                        if(path==='/api/gemini/oauth/start'){window.fixtureOauthStarts++;return {};}
                        if(path==='/api/diagnostics')return {readiness:{media:true,storage:true},components:{ocr:true,vietnamese_tts:true,whisper_modules:true},configuration:{gemini_oauth:{connected:true,google_email:email,needs_reauthorization:false}}};
                        if(path==='/api/gemini/oauth/verify')return {ready:true,state:'ready'};
                        return {};
                    };
                    client.health={version:'0.2.35',capabilities:{direct_authorization:true}};
                    client.emit('connected');
                }""",grant_email)
                await page.wait_for_url(__import__('re').compile('/settings'))
                await page.wait_for_function("localStorage.getItem('reupai.gemini.onboarding')===null")
                assert await page.evaluate('fixtureOauthStarts') == expected, grant_email
                checks.append('registered account waits for Engine then '+('keeps its existing Gemini grant' if expected==0 else 'requests Gemini consent when the local grant belongs to a different Google account'))
                await context.close()
            assert not errors, errors
            await browser.close()
    finally: server.shutdown()
    result = {'passed':len(checks),'checks':checks,'pageErrors':errors}
    (fixture.OUT / 'auth-before-engine.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=True,indent=2))


if __name__ == '__main__': asyncio.run(main())
