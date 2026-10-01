import { useState } from 'react';
import { LANGS } from '../../../shared/types.ts';
import type { Banner, BannerTarget, Lang, LocalizedText, MenuCategory } from '../../../shared/types.ts';
import { api, errorText, run } from '../api.ts';
import { useData } from '../context.ts';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select } from '../components/ui.tsx';
import { moveItem, resizeImage } from '../images.ts';

const LANG_LABELS: Record<Lang, string> = { vi: 'Tiếng Việt', en: 'English', ko: '한국어', zh: '中文', ja: '日本語' };
const emptyText = (): LocalizedText => ({ vi: '', en: '', ko: '', zh: '', ja: '' });

function status(b: Banner): { label: string; color: 'green' | 'gray' | 'amber' | 'red' } {
  const now = new Date().toISOString();
  if (!b.active) return { label: 'Tắt', color: 'gray' };
  if (b.startsAt && now < b.startsAt) return { label: 'Chưa tới ngày', color: 'amber' };
  if (b.endsAt && now > b.endsAt) return { label: 'Hết hạn', color: 'red' };
  return { label: 'Đang chạy', color: 'green' };
}

function targetLabel(b: Banner, menu: MenuCategory[] | null) {
  if (b.targetType === 'category') return `Danh mục: ${menu?.find((c) => c.id === b.targetId)?.title.vi ?? '?'}`;
  if (b.targetType === 'item') {
    const item = menu?.flatMap((c) => c.items).find((i) => i.id === b.targetId);
    return `Món: ${item?.name.vi ?? '?'}`;
  }
  return 'Chỉ hiển thị';
}

export function BannersPage() {
  const [banners, reload] = useData(api.banners);
  const [menu] = useData(api.menu);
  const [editing, setEditing] = useState<Banner | 'new' | null>(null);

  const reorder = (ids: number[] | null) => {
    if (ids) run(() => api.reorderBanners(ids)).then(reload);
  };

  return (
    <div className="max-w-5xl">
      <PageHeader title="Banner quảng cáo">
        <Button onClick={() => setEditing('new')}>+ Banner</Button>
      </PageHeader>
      <p className="text-gray-500 mb-4">
        Banner hiện ở đầu menu khi khách quét QR, tự chuyển mỗi 5 giây. Khách bấm vào banner sẽ được đưa tới danh mục hoặc món
        đang khuyến mãi. Ảnh nên nằm ngang (tỉ lệ khoảng 16:6), chữ quan trọng đặt ở giữa ảnh.
      </p>
      {banners && banners.length === 0 && <Empty>Chưa có banner nào.</Empty>}
      <div className="space-y-3">
        {banners?.map((b, i) => {
          const s = status(b);
          const ids = banners.map((x) => x.id);
          return (
            <Card key={b.id} className="flex flex-col md:flex-row gap-4 items-start md:items-center">
              <img src={b.image} alt="" className="w-full md:w-72 aspect-[16/6] object-cover rounded-xl bg-gray-100" />
              <div className="flex-1 min-w-0 space-y-1">
                <div className="font-bold text-lg">{b.title.vi || <span className="text-gray-400">(không có chữ)</span>}</div>
                {b.subtitle.vi && <div className="text-gray-600">{b.subtitle.vi}</div>}
                <div className="text-sm text-gray-500">{targetLabel(b, menu)}</div>
                <div className="text-sm text-gray-500">
                  {b.startsAt ? new Date(b.startsAt).toLocaleDateString('vi-VN') : '…'} →{' '}
                  {b.endsAt ? new Date(b.endsAt).toLocaleDateString('vi-VN') : '…'} <Badge color={s.color}>{s.label}</Badge>
                </div>
              </div>
              <div className="flex md:flex-col gap-2">
                <Button variant="secondary" className="text-sm" disabled={i === 0} onClick={() => reorder(moveItem(ids, i, -1))}>
                  ▲
                </Button>
                <Button
                  variant="secondary"
                  className="text-sm"
                  disabled={i === ids.length - 1}
                  onClick={() => reorder(moveItem(ids, i, 1))}
                >
                  ▼
                </Button>
                <Button variant="secondary" className="text-sm" onClick={() => setEditing(b)}>
                  Sửa
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
      {editing && menu && (
        <BannerDialog
          banner={editing === 'new' ? null : editing}
          menu={menu}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

const dateInput = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('sv-SE') : '');

function BannerDialog({
  banner,
  menu,
  onClose,
  onSaved,
}: {
  banner: Banner | null;
  menu: MenuCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    image: banner?.image ?? '',
    title: banner?.title ?? emptyText(),
    subtitle: banner?.subtitle ?? emptyText(),
    targetType: banner?.targetType ?? ('none' as BannerTarget),
    targetId: banner?.targetId ?? '',
    startsAt: dateInput(banner?.startsAt ?? null),
    endsAt: dateInput(banner?.endsAt ?? null),
    active: banner?.active ?? true,
  });
  const [showLangs, setShowLangs] = useState(false);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await api.uploadImage(await resizeImage(file, 1600));
      setForm((f) => ({ ...f, image: url }));
    } catch (err) {
      alert(errorText(err));
    }
    setUploading(false);
  };

  const save = async () => {
    const body = {
      ...form,
      targetId: form.targetType === 'none' ? null : form.targetId,
      startsAt: form.startsAt ? new Date(`${form.startsAt}T00:00:00`).toISOString() : null,
      endsAt: form.endsAt ? new Date(`${form.endsAt}T23:59:59`).toISOString() : null,
    };
    const ok = await run(() => (banner ? api.updateBanner(banner.id, body) : api.createBanner(body)));
    if (ok) onSaved();
  };

  const remove = async () => {
    if (banner && confirm('Xóa banner này?') && (await run(() => api.deleteBanner(banner.id)))) onSaved();
  };

  const setText = (key: 'title' | 'subtitle', lang: Lang, value: string) =>
    setForm((f) => ({ ...f, [key]: { ...f[key], [lang]: value } }));

  return (
    <Modal
      wide
      title={banner ? 'Sửa banner' : 'Thêm banner'}
      onClose={onClose}
      footer={
        <>
          {banner && (
            <Button variant="danger" className="mr-auto" onClick={remove}>
              Xóa
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={!form.image || uploading || (form.targetType !== 'none' && !form.targetId)} onClick={save}>
            Lưu
          </Button>
        </>
      }
    >
      {/* Xem trước giống trên điện thoại khách */}
      <div className="relative rounded-2xl overflow-hidden bg-gray-100 aspect-[16/6]">
        {form.image ? (
          <img src={form.image} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">Chưa có ảnh</div>
        )}
        {(form.title.vi || form.subtitle.vi) && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 text-white">
            {form.title.vi && <div className="text-2xl font-bold">{form.title.vi}</div>}
            {form.subtitle.vi && <div>{form.subtitle.vi}</div>}
          </div>
        )}
      </div>
      <label className="block">
        <span className="block text-center bg-gray-100 hover:bg-gray-200 rounded-lg py-2 cursor-pointer font-semibold">
          {uploading ? 'Đang tải lên...' : '📷 Chọn ảnh banner'}
        </span>
        <input type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      </label>

      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Tiêu đề (không bắt buộc)">
          <Input value={form.title.vi} onChange={(e) => setText('title', 'vi', e.target.value)} placeholder="Giảm 20% combo bò Mỹ" />
        </Field>
        <Field label="Dòng phụ (không bắt buộc)">
          <Input value={form.subtitle.vi} onChange={(e) => setText('subtitle', 'vi', e.target.value)} placeholder="Chỉ trong tháng 10" />
        </Field>
      </div>
      <button className="text-sm text-blue-600 underline" onClick={() => setShowLangs(!showLangs)}>
        {showLangs ? 'Ẩn' : 'Dịch'} sang ngôn ngữ khác (để trống = dùng tiếng Việt)
      </button>
      {showLangs &&
        LANGS.filter((l) => l !== 'vi').map((lang) => (
          <div key={lang} className="grid md:grid-cols-2 gap-3">
            <Field label={`Tiêu đề – ${LANG_LABELS[lang]}`}>
              <Input value={form.title[lang]} onChange={(e) => setText('title', lang, e.target.value)} />
            </Field>
            <Field label={`Dòng phụ – ${LANG_LABELS[lang]}`}>
              <Input value={form.subtitle[lang]} onChange={(e) => setText('subtitle', lang, e.target.value)} />
            </Field>
          </div>
        ))}

      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Khi khách bấm vào banner">
          <Select
            value={form.targetType}
            onChange={(e) => setForm({ ...form, targetType: e.target.value as BannerTarget, targetId: '' })}
          >
            <option value="none">Không làm gì (chỉ hiển thị)</option>
            <option value="category">Mở một danh mục</option>
            <option value="item">Tới một món</option>
          </Select>
        </Field>
        {form.targetType === 'category' && (
          <Field label="Danh mục">
            <Select value={form.targetId} onChange={(e) => setForm({ ...form, targetId: e.target.value })}>
              <option value="">— Chọn —</option>
              {menu.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title.vi}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {form.targetType === 'item' && (
          <Field label="Món">
            <Select value={form.targetId} onChange={(e) => setForm({ ...form, targetId: e.target.value })}>
              <option value="">— Chọn —</option>
              {menu.map((c) => (
                <optgroup key={c.id} label={c.title.vi}>
                  {c.items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name.vi}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Chạy từ ngày (trống = ngay)">
          <Input type="date" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
        </Field>
        <Field label="Đến ngày (trống = không hạn)">
          <Input type="date" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
        </Field>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Đang bật
      </label>
    </Modal>
  );
}
