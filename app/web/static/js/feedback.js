(() => {
    const originalAlert = window.alert.bind(window);
    let overlay;
    const close = () => overlay?.remove();
    const show = (message) => {
        close();
        overlay = document.createElement('div');
        overlay.className = 'reup-feedback-overlay';
        overlay.innerHTML = `<section class="reup-feedback-dialog" role="alertdialog" aria-modal="true" aria-label="Đã xảy ra lỗi"><span class="reup-feedback-mark">!</span><div><h2>Đã xảy ra lỗi</h2><p></p><button type="button">Đã hiểu</button></div></section>`;
        overlay.querySelector('p').textContent = String(message || 'Không thể hoàn tất thao tác. Hãy thử lại.');
        overlay.querySelector('button').onclick = close;
        document.body.appendChild(overlay);
        overlay.querySelector('button').focus();
    };
    window.alert = show;
    window.addEventListener('error', event => { if (event.error?.message) show(event.error.message); });
    window.addEventListener('unhandledrejection', event => { if (event.reason?.message) show(event.reason.message); });
    window.ReupFeedback = { showError: show, restoreAlert: () => { window.alert = originalAlert; } };
})();
