"""Rendered Settings tests with fixture auth and Engine; no real Google calls."""
import asyncio
import base64
import importlib.util
import json
from pathlib import Path
import threading
import time
from http.server import ThreadingHTTPServer
from urllib.parse import urlparse
from playwright.async_api import async_playwright, expect

spec=importlib.util.spec_from_file_location('workspace_fixture',Path(__file__).with_name('workspace-browser.py'))
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)


async def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),fixture.Handler)
    server.engine_release=None;server.billing_requests=0;server.billing_fail=False
    server.billing_response={'configured':True,'authenticated':True,'plan':'free'}
    threading.Thread(target=server.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{server.server_port}'
    user={'id':'00000000-0000-4000-8000-000000000001','email':'fixture@example.com','aud':'authenticated','role':'authenticated','app_metadata':{},'user_metadata':{}}
    encode=lambda value:base64.urlsafe_b64encode(json.dumps(value,separators=(',',':')).encode()).decode().rstrip('=')
    token=encode({'alg':'HS256','typ':'JWT'})+'.'+encode({'sub':user['id'],'email':user['email'],'exp':int(time.time())+3600})+'.Zml4dHVyZQ'
    session={'access_token':token,'refresh_token':'fixture-only','token_type':'bearer','expires_at':int(time.time())+3600,'expires_in':3600,'user':user}
    checks=[];errors=[];state={}
    async def route_request(route):
        request=route.request;parsed=urlparse(request.url)
        if parsed.path=='/auth/v1/user': return await route.fulfill(content_type='application/json',body=json.dumps(user))
        if parsed.port==17888:
            oauth={'connected':True,'connecting':False,'google_email':user['email'],'google_subject':'fixture-user','project_id':state['selected']}
            value={}
            if parsed.path=='/api/health':value={'version':'0.2.37' if state['mode']!='legacy' else '0.2.36','capabilities':{'direct_authorization':True,'gemini_project_discovery':state['mode']!='legacy'}}
            elif parsed.path=='/api/authorize/connect':value={'session_token':'fixture-only','grant':'fixture-only'}
            elif parsed.path=='/api/diagnostics':value={'readiness':{'media':True,'storage':True},'components':{'ocr':True,'vietnamese_tts':True,'whisper_modules':True},'configuration':{'gemini_oauth':oauth}}
            elif parsed.path=='/api/gemini/oauth/verify':value={'ready':bool(state['selected']),'state':'ready' if state['selected'] else 'project_required'}
            elif parsed.path=='/api/gemini/projects/detect':
                state['lookups']+=1
                if state['mode']=='multiple':value={'state':'choose_project','projects':[{'project_id':'customer-one','display_name':'First project'},{'project_id':'customer-two','display_name':'Second project'}]}
                elif state['mode']=='empty':value={'state':'no_projects','projects':[],'message':'Chưa tìm thấy project riêng. Tạo project rồi bấm Tìm lại.'}
                else:
                    state['selected']='customer-project'
                    value={'state':'selected','project_id':'customer-project','auto_selected':True,'projects':[{'project_id':'customer-project','display_name':'Customer project'}],'message':'Đã tự chọn và lưu project duy nhất.'}
            elif parsed.path=='/api/gemini/project' and request.method=='PUT':
                state['saves']+=1;state['selected']=request.post_data_json['project_id'];value={'project_id':state['selected']}
            elif parsed.path=='/api/gemini/oauth/start':state['consents']+=1
            return await route.fulfill(content_type='application/json',body=json.dumps(value),headers={'Access-Control-Allow-Origin':'*'})
        if request.url.startswith(base+'/'):return await route.continue_()
        return await route.abort()
    try:
        async with async_playwright() as p:
            browser=await p.chromium.launch(channel='chrome',headless=True)
            for mode in ['unique','multiple','empty','legacy']:
                state={'mode':mode,'selected':None,'lookups':0,'saves':0,'consents':0}
                context=await browser.new_context(viewport={'width':1280,'height':1000})
                await context.route('**/*',route_request)
                await context.add_cookies([{'name':'sb-fixture-auth-auth-token','value':'base64-'+encode(session),'url':base}])
                page=await context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
                await page.goto(base+'/settings#diagnostics')
                field=page.locator('#gemini-project-id')
                if mode=='unique':
                    await expect(field).to_have_value('customer-project')
                    await expect(page.locator('.gemini-project-picker')).to_contain_text('Project đã kết nối')
                    assert state['lookups']==1 and state['saves']==0
                    await page.reload()
                    await expect(field).to_have_value('customer-project')
                    assert state['lookups']==1
                    checks.append('one customer project is filled, saved and retained after reload without new Google consent')
                elif mode=='multiple':
                    await expect(page.locator('#gemini-project-options')).to_be_visible()
                    assert state['selected'] is None and state['saves']==0
                    await page.locator('#gemini-project-options').select_option('customer-two')
                    await page.get_by_role('button',name='Dùng project này').click()
                    await expect(field).to_have_value('customer-two')
                    assert state['saves']==1
                    checks.append('multiple projects require one explicit choice and never select a quota project silently')
                elif mode=='empty':
                    await expect(page.locator('.gemini-project-picker')).to_contain_text('Chưa tìm thấy')
                    assert state['selected'] is None
                    state['mode']='unique'
                    await page.get_by_role('button',name='Tìm lại project').click()
                    await expect(field).to_have_value('customer-project')
                    assert state['lookups']==2
                    checks.append('no-project guidance supports refresh after creation without creating a project automatically')
                else:
                    await expect(page.locator('.gemini-project-picker')).to_contain_text('Cập nhật Local Engine')
                    assert state['lookups']==0
                    await expect(field).to_be_enabled()
                    checks.append('older Engine keeps manual entry and an update link instead of an unsupported discovery request')
                assert state['consents']==0
                await context.close()
            await browser.close()
    finally:server.shutdown()
    assert not errors,errors
    result={'passed':len(checks),'checks':checks,'pageErrors':errors}
    fixture.OUT.mkdir(parents=True,exist_ok=True)
    (fixture.OUT/'project-discovery.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=True,indent=2))


if __name__=='__main__':asyncio.run(main())
