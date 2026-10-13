// Imported content never gets to supply executable link schemes.
export function webSourceUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
export function webStatus(tile) {
  return ({ PENDING: '等待读取', FETCHING: '正在读取网页', READY: '正文已保存', FAILED: '读取失败' })[tile?.fetchStatus] || '网页';
}
export function webFetchedAt(value) {
  if (!value) return '尚未读取';
  return String(value).replace('T', ' ').slice(0, 19);
}
