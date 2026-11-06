// API enablement can succeed before Google's Gemini endpoint sees the change.
export function geminiSetupActionUrl(action, projectId) {
  const project = encodeURIComponent(projectId || '');
  if (action === 'open_cloud_console') return 'https://console.cloud.google.com/';
  if (!projectId) return null;
  if (action === 'open_project_permissions') return `https://console.cloud.google.com/iam-admin/iam?project=${project}`;
  if (action === 'open_billing') return `https://console.cloud.google.com/billing/linkedaccount?project=${project}`;
  if (['open_api_console', 'open_setup_api'].includes(action)) return `https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com?project=${project}`;
  return null;
}

export function settleGeminiEnablement(result, pending, accountProject, now = Date.now()) {
  if (result?.ready) return { result, pending: null };
  if (result?.state === 'enabling') {
    const next = pending?.key === accountProject ? pending : { key: accountProject, until: now + 300000 };
    return { result, pending: next };
  }
  if (pending?.key === accountProject && now < pending.until && ['disabled', 'temporary_error'].includes(result?.state)) {
    return { pending, result: { ...result, state: 'enabling', ready: false,
      message: 'Đã gửi yêu cầu bật Gemini API. Đang chờ Google cập nhật; ReupAI sẽ tự kiểm tra lại.',
      action: 'retry', action_label: 'Kiểm tra lại', retryable: true } };
  }
  return { result, pending: null };
}
