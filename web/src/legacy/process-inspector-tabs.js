// Keeps inspector sections in the form while showing one section at a time.
export function bindProcessInspectorTabs(dialog, { window, signal }) {
    const tabs = [...dialog.querySelectorAll('[data-inspector-tab]')];
    const panels = new Map([...dialog.querySelectorAll('[data-inspector-panel]')]
        .map(panel => [panel.dataset.inspectorPanel, panel]));
    const entries = tabs.filter(tab => panels.has(tab.dataset.inspectorTab));
    const rail = dialog.querySelector('.process-inspector-rail');
    const scroller = dialog.querySelector('.process-inspector-content');
    if (!entries.length || signal?.aborted) return { select: () => false };

    let currentName = null;
    const select = (name, { focus = false } = {}) => {
        if (signal?.aborted) return false;
        const target = entries.find(tab => tab.dataset.inspectorTab === name);
        if (!target || target.disabled) return false;
        entries.forEach(tab => {
            const selected = tab === target;
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
            tab.classList.toggle('active', selected);
            panels.get(tab.dataset.inspectorTab).hidden = !selected;
        });
        if (name !== currentName && scroller) scroller.scrollTop = 0;
        currentName = name;
        dialog.dataset.inspectorTab = name;
        if (focus) target.focus({ preventScroll: true });
        return true;
    };

    const options = { signal };
    entries.forEach(tab => {
        tab.addEventListener('click', () => select(tab.dataset.inspectorTab), options);
        tab.addEventListener('keydown', event => {
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            const enabled = entries.filter(entry => !entry.disabled);
            const index = enabled.indexOf(tab);
            let next;
            if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = enabled.length - 1;
            else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % enabled.length;
            else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + enabled.length) % enabled.length;
            else return;
            if (!enabled[next]) return;
            event.preventDefault();
            select(enabled[next].dataset.inspectorTab, { focus: true });
        }, options);
    });

    // Native validation can focus a field in an inactive section during submit.
    const form = dialog.querySelector('form');
    form?.addEventListener('invalid', event => {
        const panel = event.target.closest?.('[data-inspector-panel]');
        if (panel && panels.get(panel.dataset.inspectorPanel) === panel) {
            select(panel.dataset.inspectorPanel);
        }
    }, { ...options, capture: true });

    const media = window.matchMedia?.('(max-width: 640px)');
    const updateOrientation = () => rail?.setAttribute('aria-orientation', media?.matches ? 'horizontal' : 'vertical');
    updateOrientation();
    if (media?.addEventListener) {
        media.addEventListener('change', updateOrientation);
        signal?.addEventListener('abort', () => media.removeEventListener('change', updateOrientation), { once: true });
    } else if (media?.addListener) {
        media.addListener(updateOrientation);
        signal?.addEventListener('abort', () => media.removeListener(updateOrientation), { once: true });
    }

    const initial = dialog.dataset.inspectorTab || entries[0].dataset.inspectorTab;
    if (!select(initial)) {
        const fallback = entries.find(tab => !tab.disabled);
        if (fallback) select(fallback.dataset.inspectorTab);
    }
    return { select };
}
