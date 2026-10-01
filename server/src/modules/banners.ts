import { db, transaction } from '../db.ts';
import { bad, HttpError, oneOf, optionalDate, str } from '../http.ts';
import { LANGS } from '../../../shared/types.ts';
import type { Banner, BannerTarget, LocalizedText } from '../../../shared/types.ts';

// Banner quảng cáo hiện ở đầu menu của khách khi chạy chương trình.

type BannerRow = {
  id: number;
  title: string;
  subtitle: string;
  image: string;
  target_type: BannerTarget;
  target_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  active: number;
};

const toBanner = (r: BannerRow): Banner => ({
  id: r.id,
  title: JSON.parse(r.title),
  subtitle: JSON.parse(r.subtitle),
  image: r.image,
  targetType: r.target_type,
  targetId: r.target_id,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  active: r.active === 1,
});

export function listBanners(): Banner[] {
  return (db.prepare('SELECT * FROM banners ORDER BY sort, id').all() as BannerRow[]).map(toBanner);
}

/** Banner đang chạy (đang bật và trong thời gian hiệu lực) cho app gọi món. */
export function activeBanners(): Banner[] {
  const nowIso = new Date().toISOString();
  return listBanners().filter((b) => b.active && (!b.startsAt || b.startsAt <= nowIso) && (!b.endsAt || b.endsAt >= nowIso));
}

/** Chữ trên banner không bắt buộc; ngôn ngữ nào trống thì dùng tiếng Việt. */
function optionalText(value: unknown): LocalizedText {
  const input = (value ?? {}) as Partial<Record<string, unknown>>;
  const vi = str(input.vi, 'invalid_text', { max: 120, required: false });
  return Object.fromEntries(
    LANGS.map((lang) => [lang, lang === 'vi' ? vi : str(input[lang], 'invalid_text', { max: 120, required: false }) || vi]),
  ) as LocalizedText;
}

function input(body: Record<string, unknown>) {
  const targetType = oneOf(body.targetType ?? 'none', ['none', 'category', 'item'] as const, 'invalid_target');
  let targetId: string | null = null;
  if (targetType !== 'none') {
    targetId = str(body.targetId, 'invalid_target', { max: 40 });
    const table = targetType === 'category' ? 'categories' : 'menu_items';
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(targetId)) throw bad('invalid_target');
  }
  const startsAt = optionalDate(body.startsAt, 'invalid_date');
  const endsAt = optionalDate(body.endsAt, 'invalid_date');
  if (startsAt && endsAt && endsAt < startsAt) throw bad('invalid_date');
  return {
    title: JSON.stringify(optionalText(body.title)),
    subtitle: JSON.stringify(optionalText(body.subtitle)),
    image: str(body.image, 'invalid_image', { max: 300 }),
    targetType,
    targetId,
    startsAt,
    endsAt,
    active: body.active === false ? 0 : 1,
  };
}

export function createBanner(body: Record<string, unknown>) {
  const b = input(body);
  const { sort } = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS sort FROM banners').get() as { sort: number };
  db.prepare(
    `INSERT INTO banners (title, subtitle, image, target_type, target_id, starts_at, ends_at, active, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(b.title, b.subtitle, b.image, b.targetType, b.targetId, b.startsAt, b.endsAt, b.active, sort);
}

export function updateBanner(id: number, body: Record<string, unknown>) {
  const b = input(body);
  const result = db
    .prepare(
      `UPDATE banners SET title = ?, subtitle = ?, image = ?, target_type = ?, target_id = ?, starts_at = ?, ends_at = ?, active = ?
       WHERE id = ?`,
    )
    .run(b.title, b.subtitle, b.image, b.targetType, b.targetId, b.startsAt, b.endsAt, b.active, id);
  if (result.changes === 0) throw new HttpError(404, 'not_found');
}

export function deleteBanner(id: number) {
  db.prepare('DELETE FROM banners WHERE id = ?').run(id);
}

export function reorderBanners(ids: unknown) {
  if (!Array.isArray(ids) || ids.some((id) => !Number.isInteger(id))) throw bad('invalid_order');
  const update = db.prepare('UPDATE banners SET sort = ? WHERE id = ?');
  transaction(() => (ids as number[]).forEach((id, i) => update.run(i, id)));
}
