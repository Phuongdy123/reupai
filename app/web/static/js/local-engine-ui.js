(function () {
    'use strict';
    const client = window.reupEngineClient;
    if (!client) return;

    function render(detail) {
        const badge = document.getElementById('localEngineIndicator');
        const label = document.getElementById('localEngineLabel');
        const connect = document.getElementById('localEngineConnect');
        if (!badge || !label) return;
        const labels = {
            checking: 'Đang kiểm tra', connected: 'Local Engine đã kết nối',
            disconnected: 'Local Engine offline', authorization_required: 'Cần cấp quyền',
            authorizing: 'Đang cấp quyền', permission_denied: 'Bị từ chối',
            update_required: 'Cần cập nhật Local Engine', error: 'Lỗi Local Engine',
        };
        badge.dataset.state = detail.status;
        label.textContent = labels[detail.status] || detail.status;
        if (connect) connect.hidden = detail.status === 'connected' || detail.status === 'authorizing';
        badge.title = detail.error?.message || labels[detail.status] || detail.status;
    }

    client.onChange(render);
    window.addEventListener('reupai:connection', (event) => render(event.detail));
    document.getElementById('localEngineConnect')?.addEventListener('click', () => client.connect());
    document.getElementById('localEngineRetry')?.addEventListener('click', () => client.check());
    client.completeCallback().finally(() => client.check());
})();
