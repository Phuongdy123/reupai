// API enablement can succeed before Google's Gemini endpoint sees the change.
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
