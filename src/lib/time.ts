/** 采访页顶部的「今天已经聊了 N 分钟」 */
export function elapsedMinutes(startedAt: number, now: number = Date.now()): number {
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 60_000));
}

/** 计时文案：不足 1 分钟时说「刚开始」，避免 0 分钟的尴尬 */
export function elapsedLabel(startedAt: number, now: number = Date.now()): string {
  const minutes = elapsedMinutes(startedAt, now);
  if (minutes < 1) return '刚刚开始';
  return `今天已经聊了 ${minutes} 分钟`;
}

export function formatDate(iso: string | number | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}.${m}.${d}`;
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 具体日期 */
export function formatRelative(iso: string | number | undefined): string {
  if (!iso) return '';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return formatDate(ts);
}

/** 取首句作为故事卡片摘要 */
export function firstSentence(text: string, limit = 34): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const matched = clean.match(/^[^。！？!?]*[。！？!?]/);
  const sentence = (matched ? matched[0] : clean).replace(/[。！？!?]$/, '');
  return sentence.length > limit ? `${sentence.slice(0, limit)}……` : sentence;
}
