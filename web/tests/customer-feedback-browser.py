"""Rendered feedback forms with local fixture APIs; no customer data/network."""
import asyncio
import importlib.util
import json
from pathlib import Path
import threading
from http.server import ThreadingHTTPServer
from urllib.parse import urlparse
from playwright.async_api import async_playwright, expect

spec = importlib.util.spec_from_file_location('feedback_fixture', Path(__file__).with_name('workspace-browser.py'))
fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)

async def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), fixture.Handler)
    server.engine_release = None; server.billing_requests = 0; server.billing_fail = False
    server.billing_response = {'configured':True, 'authenticated':True, 'plan':'admin', 'unlimited':True}
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    out = Path(__file__).resolve().parents[2] / 'artifacts' / 'feedback-review'; out.mkdir(parents=True, exist_ok=True)
    sent = []; errors = []; state = {'fail':True, 'status':'new'}
    item = {'id':'1794000000000-12345678-1234-1234-1234-123456789abc', 'subject':'Lỗi Bilibili trên máy khách', 'message':'Video trả HTTP 412 khi tải về.', 'details':'HTTP 412', 'link':'https://www.bilibili.com/video/fixture', 'email':'customer@example.test', 'displayName':'Khách thử nghiệm', 'category':'bug', 'status':'new', 'createdAt':'2026-11-06T09:00:00Z'}
    async def routes(route):
        request = route.request; path = urlparse(request.url).path
        if path == '/api/feedback':
            sent.append(request.post_data_json)
            return await route.fulfill(status=state.get('failure_status',503) if state['fail'] else 201, content_type='application/json', body=json.dumps({'error':'Lỗi mạng thử nghiệm'} if state['fail'] else {'id':item['id']}))
        if path == '/api/admin/feedback':
            if request.method == 'PATCH':
                state['status'] = request.post_data_json['status']
                return await route.fulfill(content_type='application/json', body=json.dumps({'item':{**item, 'status':state['status']}}))
            return await route.fulfill(content_type='application/json', body=json.dumps({'items':[{**item, 'status':state['status']}], 'hasMore':False}))
        if request.url.startswith(base + '/'): return await route.continue_()
        return await route.abort()
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel='chrome', headless=True)
            context = await browser.new_context(viewport={'width':1366, 'height':1000})
            await context.route('**/*', routes)
            page = await context.new_page(); page.on('pageerror', lambda error: errors.append(str(error)))
            await page.goto(base + '/feedback')
            await page.get_by_label('Tiêu đề', exact=True).fill(item['subject'])
            await page.get_by_label('Nội dung phản hồi').fill(item['message'])
            await page.get_by_label('Link video liên quan').fill(item['link'])
            await page.get_by_role('button', name='Gửi phản hồi', exact=True).click()
            await expect(page.locator('.customer-feedback-error')).to_contain_text('Lỗi mạng thử nghiệm')
            await expect(page.get_by_label('Nội dung phản hồi')).to_have_value(item['message'])
            state['fail'] = False
            await page.get_by_role('button', name='Gửi phản hồi', exact=True).click()
            await expect(page.locator('.customer-feedback-success')).to_be_visible()
            assert sent[0]['requestId'] == sent[1]['requestId'], 'retry lost idempotency key'
            await page.get_by_label('Tiêu đề', exact=True).fill(item['subject'])
            await page.get_by_label('Nội dung phản hồi').fill(item['message'])
            state.update(fail=True,failure_status=429)
            await page.get_by_role('button', name='Gửi phản hồi', exact=True).click()
            await expect(page.locator('.customer-feedback-error')).to_be_visible()
            state['fail']=False
            await page.get_by_role('button', name='Gửi phản hồi', exact=True).click()
            await expect(page.locator('.customer-feedback-success')).to_be_visible()
            assert sent[2]['requestId'] != sent[3]['requestId'], 'definite rate rejection trapped the next submission'
            for width in (1366, 390):
                await page.set_viewport_size({'width':width, 'height':900})
                if width < 940:
                    await expect(page.locator('.sidebar')).to_be_hidden()
                assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'overflow {width}'
                await page.screenshot(path=str(out / f'feedback-{width}.png'), full_page=True)
            await page.set_viewport_size({'width':1366, 'height':1000})
            await page.goto(base + '/admin/feedback')
            await expect(page.get_by_role('heading', name=item['subject'])).to_be_visible()
            await page.get_by_label('Trạng thái phản hồi ' + item['subject']).select_option('resolved')
            await expect(page.locator('.customer-feedback-status')).to_have_text('Đã xử lý')
            await page.get_by_text('Chi tiết kỹ thuật', exact=True).click()
            await expect(page.locator('.admin-feedback-card pre')).to_have_text('HTTP 412')
            await page.screenshot(path=str(out / 'admin-feedback.png'), full_page=True)
            assert not errors, errors
            await browser.close()
    finally:
        server.shutdown(); server.server_close()
    print(json.dumps({'passed':['send failure preserves draft', 'retry keeps request id', 'rate rejection starts fresh attempt', 'successful receipt', 'desktop/mobile no overflow', 'admin reads details and resolves'], 'screenshots':str(out)}, ensure_ascii=False))

asyncio.run(main())
