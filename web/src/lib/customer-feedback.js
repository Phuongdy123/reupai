export const FEEDBACK_BUCKET = 'reupai-customer-feedback';
export const FEEDBACK_CATEGORIES = { bug: 'Báo lỗi', idea: 'Góp ý tính năng', other: 'Phản hồi khác' };
export const FEEDBACK_STATUSES = { new: 'Chưa đọc', read: 'Đã đọc', resolved: 'Đã xử lý' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const feedbackIdValid = id => typeof id === 'string' && /^\d{13}-[0-9a-f-]{36}$/i.test(id) && UUID.test(id.slice(14));

export class FeedbackError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}

export function validateFeedback(body) {
  const text = (key, min, max) => {
    const value = typeof body?.[key] === 'string' ? body[key].trim() : '';
    if (value.length < min || value.length > max) throw new FeedbackError(`Nội dung ${key === 'subject' ? 'tiêu đề' : key === 'message' ? 'phản hồi' : key === 'details' ? 'chi tiết kỹ thuật' : 'liên kết'} phải từ ${min} đến ${max} ký tự.`, 400);
    return value;
  };
  if (!Object.hasOwn(FEEDBACK_CATEGORIES, body?.category)) throw new FeedbackError('Chọn loại phản hồi hợp lệ.', 400);
  if (!UUID.test(body?.requestId || '')) throw new FeedbackError('Lượt gửi không hợp lệ. Tải lại trang rồi thử lại.', 400);
  const subject = text('subject', 3, 120), message = text('message', 10, 4000);
  const details = text('details', 0, 6000), link = text('link', 0, 2048);
  if (link) {
    let url;
    try { url = new URL(link); } catch { throw new FeedbackError('Liên kết phải bắt đầu bằng https:// hoặc http://.', 400); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new FeedbackError('Liên kết không hợp lệ.', 400);
  }
  return { category: body.category, subject, message, details, link, requestId: body.requestId };
}

function code(error) { return Number(error?.statusCode || error?.status); }

export async function ensureFeedbackBucket(storage) {
  const existing = await storage.getBucket(FEEDBACK_BUCKET);
  if (existing.data) {
    if (existing.data.public) throw new FeedbackError('Kho phản hồi chưa được cấu hình riêng tư. Vui lòng liên hệ quản trị viên.');
    return;
  }
  if (code(existing.error) !== 404 && !/not found/i.test(existing.error?.message || '')) throw new FeedbackError('Chưa kết nối được hộp thư phản hồi. Vui lòng thử lại.');
  const created = await storage.createBucket(FEEDBACK_BUCKET, { public: false, fileSizeLimit: 65536, allowedMimeTypes: ['application/json'] });
  if (created.error) {
    // Concurrent first submissions may both try provisioning. Re-read instead
    // of treating every creation error as an already existing private bucket.
    const check = await storage.getBucket(FEEDBACK_BUCKET);
    if (!check.data || check.data.public) throw new FeedbackError('Chưa tạo được hộp thư phản hồi. Vui lòng thử lại.');
  }
}

async function readRecord(storage, id) {
  if (!feedbackIdValid(id)) throw new FeedbackError('Mã phản hồi không hợp lệ.', 400);
  const { data, error } = await storage.from(FEEDBACK_BUCKET).download(`${id}.json`);
  if (error) throw new FeedbackError('Không đọc được phản hồi. Hãy thử lại.', code(error) === 404 ? 404 : 503);
  let record;
  try { record = JSON.parse(await data.text()); } catch { throw new FeedbackError('Không đọc được nội dung phản hồi.'); }
  if (record?.id !== id) throw new FeedbackError('Dữ liệu phản hồi không hợp lệ.');
  return record;
}

export async function submitCustomerFeedback(storage, user, profile, input, now = Date.now()) {
  const value = validateFeedback(input);
  if (!UUID.test(user?.id || '')) throw new FeedbackError('Hãy đăng nhập để gửi phản hồi.', 401);
  await ensureFeedbackBucket(storage);
  // One durable slot per account per minute; atomic upload prevents spam
  // across multiple browsers and server instances without an in-memory limit.
  const id = `${String(Math.floor(now / 60000) * 60000).padStart(13, '0')}-${user.id}`;
  const record = { ...value, id, userId: user.id, email: user.email || '',
    displayName: profile?.display_name || '', status: 'new', createdAt: new Date(now).toISOString(), updatedAt: null };
  const { error } = await storage.from(FEEDBACK_BUCKET).upload(`${id}.json`, JSON.stringify(record), { contentType: 'application/json', cacheControl: '0', upsert: false });
  if (error) {
    if (code(error) === 409 || /already exists|duplicate/i.test(error.message || '')) {
      const previous = await readRecord(storage, id);
      if (previous.requestId === value.requestId && previous.userId === user.id) return { id, createdAt: previous.createdAt };
      throw new FeedbackError('Bạn vừa gửi phản hồi. Vui lòng chờ tối đa một phút để gửi thêm.', 429);
    }
    throw new FeedbackError('Chưa lưu được phản hồi. Nội dung vẫn được giữ để bạn gửi lại.');
  }
  return { id, createdAt: record.createdAt };
}

export async function listCustomerFeedback(storage, offset = 0) {
  await ensureFeedbackBucket(storage);
  const { data, error } = await storage.from(FEEDBACK_BUCKET).list('', { limit: 21, offset, sortBy: { column: 'name', order: 'desc' } });
  if (error) throw new FeedbackError('Chưa tải được hộp thư phản hồi.');
  const files = (data || []).filter(item => feedbackIdValid(item.name?.replace(/\.json$/, '')));
  const records = await Promise.all(files.slice(0, 20).map(file => readRecord(storage, file.name.replace(/\.json$/, ''))));
  return { items: records, hasMore: files.length > 20 };
}

export async function updateCustomerFeedback(storage, id, status) {
  if (!Object.hasOwn(FEEDBACK_STATUSES, status)) throw new FeedbackError('Trạng thái phản hồi không hợp lệ.', 400);
  const record = await readRecord(storage, id);
  const updated = { ...record, status, updatedAt: new Date().toISOString() };
  const { error } = await storage.from(FEEDBACK_BUCKET).update(`${id}.json`, JSON.stringify(updated), { contentType: 'application/json', cacheControl: '0' });
  if (error) throw new FeedbackError('Chưa lưu được trạng thái phản hồi.');
  return updated;
}
