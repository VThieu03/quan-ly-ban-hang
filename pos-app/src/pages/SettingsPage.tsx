import { useEffect, useState } from 'react';
import { formatPrice } from '../../../shared/format.ts';
import { BANKS } from '../../../shared/banks.ts';
import type { Printer, Settings, StaffTable } from '../../../shared/types.ts';
import { api, download, run } from '../api.ts';
import { useData } from '../context.ts';
import { Badge, Button, Card, Field, Input, Modal, MoneyInput, NumberInput, PageHeader, Select, Table, Tabs } from '../components/ui.tsx';
import { formatDateTime } from '../dates.ts';

type Tab = 'restaurant' | 'payment' | 'loyalty' | 'invoice' | 'printers' | 'tables' | 'backup';

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('restaurant');
  const [data, reload] = useData(api.settings);
  const [draft, setDraft] = useState<Settings | null>(null);

  // Bản nháp chỉnh sửa, khởi tạo khi tải xong cài đặt.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- đồng bộ bản nháp khi dữ liệu server thay đổi
    if (data) setDraft(data.settings);
  }, [data]);

  const save = (patch: Partial<Settings>) =>
    run(async () => {
      await api.saveSettings(patch);
      reload();
      alert('Đã lưu.');
    });

  const formTabs: Tab[] = ['restaurant', 'payment', 'loyalty', 'invoice'];

  return (
    <div className="max-w-4xl">
      <PageHeader title="Cài đặt" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'restaurant', label: 'Nhà hàng' },
          { id: 'payment', label: 'Thanh toán' },
          { id: 'loyalty', label: 'Tích điểm' },
          { id: 'invoice', label: 'Hóa đơn điện tử' },
          { id: 'printers', label: 'Máy in' },
          { id: 'tables', label: 'Bàn' },
          { id: 'backup', label: 'Sao lưu' },
        ]}
      />
      {formTabs.includes(tab) && draft && data && (
        <Card className="space-y-4">
          {tab === 'restaurant' && (
            <>
              <div className="grid md:grid-cols-2 gap-3">
                <Field label="Tên nhà hàng">
                  <Input value={draft.restaurant.name} onChange={(e) => setDraft({ ...draft, restaurant: { ...draft.restaurant, name: e.target.value } })} />
                </Field>
                <Field label="Số điện thoại">
                  <Input value={draft.restaurant.phone} onChange={(e) => setDraft({ ...draft, restaurant: { ...draft.restaurant, phone: e.target.value } })} />
                </Field>
                <Field label="Địa chỉ">
                  <Input value={draft.restaurant.address} onChange={(e) => setDraft({ ...draft, restaurant: { ...draft.restaurant, address: e.target.value } })} />
                </Field>
                <Field label="Mã số thuế">
                  <Input value={draft.restaurant.taxCode} onChange={(e) => setDraft({ ...draft, restaurant: { ...draft.restaurant, taxCode: e.target.value } })} />
                </Field>
              </div>
              <Button onClick={() => save({ restaurant: draft.restaurant })}>Lưu</Button>
            </>
          )}

          {tab === 'payment' && (
            <>
              <h3 className="font-bold">Tài khoản nhận chuyển khoản (VietQR)</h3>
              <div className="grid md:grid-cols-3 gap-3">
                <Field label="Ngân hàng">
                  <Select value={draft.bank.bin} onChange={(e) => setDraft({ ...draft, bank: { ...draft.bank, bin: e.target.value } })}>
                    <option value="">— Chọn —</option>
                    {BANKS.map((b) => (
                      <option key={b.bin} value={b.bin}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Số tài khoản">
                  <Input value={draft.bank.accountNumber} onChange={(e) => setDraft({ ...draft, bank: { ...draft.bank, accountNumber: e.target.value.trim() } })} />
                </Field>
                <Field label="Tên chủ tài khoản">
                  <Input
                    value={draft.bank.accountName}
                    onChange={(e) => setDraft({ ...draft, bank: { ...draft.bank, accountName: e.target.value.toUpperCase() } })}
                  />
                </Field>
              </div>
              <Field label="Thuế suất GTGT đã gồm trong giá bán (%)" hint="Dịch vụ ăn uống hiện thường là 8% (đang giảm 2%). Hỏi kế toán để đặt đúng.">
                <NumberInput decimal className="w-32" value={draft.vatRate} placeholder="0" onChange={(n) => setDraft({ ...draft, vatRate: n })} />
              </Field>
              <Button onClick={() => save({ bank: draft.bank, vatRate: draft.vatRate })}>Lưu</Button>

              <div className="border-t pt-4 space-y-2 text-sm">
                <h3 className="font-bold text-base">Tự xác nhận chuyển khoản (SePay)</h3>
                <p>
                  Đăng ký tài khoản tại <b>sepay.vn</b>, liên kết tài khoản ngân hàng ở trên, rồi tạo Webhook với thông tin sau. Khi khách
                  chuyển đúng số tiền với nội dung <code>KBBQ…</code>, bill sẽ tự đóng.
                </p>
                <SecretRow label="URL webhook" value={data.bankWebhookUrl} />
                <SecretRow label="Kiểu xác thực" value="API Key" />
                <SecretRow
                  label="API Key"
                  value={data.secrets.bankWebhookKey}
                  onRegenerate={() => run(() => api.regenerateSecret('bankWebhookKey')).then(reload)}
                />
                <BankTransactions />
              </div>
            </>
          )}

          {tab === 'loyalty' && (
            <>
              <label className="flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={draft.loyalty.enabled}
                  onChange={(e) => setDraft({ ...draft, loyalty: { ...draft.loyalty, enabled: e.target.checked } })}
                />
                Bật tích điểm cho khách hàng thành viên
              </label>
              <div className="grid md:grid-cols-2 gap-3">
                <Field label="Chi bao nhiêu được 1 điểm">
                  <MoneyInput value={draft.loyalty.spendPerPoint} onChange={(v) => setDraft({ ...draft, loyalty: { ...draft.loyalty, spendPerPoint: v } })} />
                </Field>
                <Field label="1 điểm trừ được bao nhiêu tiền">
                  <MoneyInput value={draft.loyalty.pointValue} onChange={(v) => setDraft({ ...draft, loyalty: { ...draft.loyalty, pointValue: v } })} />
                </Field>
              </div>
              {draft.loyalty.spendPerPoint > 0 && (
                <p className="text-sm text-gray-600">
                  Tương đương hoàn lại {((draft.loyalty.pointValue / draft.loyalty.spendPerPoint) * 100).toFixed(1)}% giá trị hóa đơn. Ví dụ
                  hóa đơn {formatPrice(1_000_000)} → {Math.floor(1_000_000 / draft.loyalty.spendPerPoint)} điểm.
                </p>
              )}
              <Button onClick={() => save({ loyalty: draft.loyalty })}>Lưu</Button>
            </>
          )}

          {tab === 'invoice' && (
            <>
              <div className="bg-amber-50 text-amber-900 rounded-xl p-3 text-sm">
                Hóa đơn điện tử khởi tạo từ máy tính tiền cần hợp đồng với một nhà cung cấp (Viettel S-Invoice, VNPT, MISA meInvoice…)
                và đăng ký với cơ quan thuế. Chế độ <b>Thử nghiệm</b> chỉ tạo số hóa đơn giả để chạy thử quy trình, không gửi lên cơ quan
                thuế. Khi đã chọn nhà cung cấp, cần bổ sung bộ kết nối cho nhà cung cấp đó.
              </div>
              <div className="grid md:grid-cols-3 gap-3">
                <Field label="Nhà cung cấp">
                  <Select
                    value={draft.invoice.provider}
                    onChange={(e) => setDraft({ ...draft, invoice: { ...draft.invoice, provider: e.target.value as Settings['invoice']['provider'] } })}
                  >
                    <option value="none">Tắt</option>
                    <option value="mock">Thử nghiệm (không gửi thuế)</option>
                  </Select>
                </Field>
                <Field label="Mẫu số">
                  <Input value={draft.invoice.templateCode} onChange={(e) => setDraft({ ...draft, invoice: { ...draft.invoice, templateCode: e.target.value } })} />
                </Field>
                <Field label="Ký hiệu">
                  <Input value={draft.invoice.series} onChange={(e) => setDraft({ ...draft, invoice: { ...draft.invoice, series: e.target.value } })} />
                </Field>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.invoice.autoIssue}
                  onChange={(e) => setDraft({ ...draft, invoice: { ...draft.invoice, autoIssue: e.target.checked } })}
                />
                Tự xuất hóa đơn cho mọi bill khi thanh toán (bắt buộc với HĐĐT từ máy tính tiền)
              </label>
              <Button onClick={() => save({ invoice: draft.invoice })}>Lưu</Button>
            </>
          )}
        </Card>
      )}
      {tab === 'printers' && draft && data && (
        <PrintersTab
          settings={draft}
          onSaveSettings={(printing) => save({ printing })}
          onChange={(printing) => setDraft({ ...draft, printing })}
          agentKey={data.secrets.printAgentKey}
          serverUrl={data.printAgentUrl}
          onRegenerate={() => run(() => api.regenerateSecret('printAgentKey')).then(reload)}
        />
      )}
      {tab === 'tables' && <TablesTab />}
      {tab === 'backup' && <BackupTab />}
    </div>
  );
}

function SecretRow({ label, value, onRegenerate }: { label: string; value: string; onRegenerate?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-28 text-gray-600">{label}</span>
      <code className="bg-gray-100 rounded px-2 py-1 break-all flex-1">{value}</code>
      <Button variant="ghost" className="text-sm px-2 py-1" onClick={() => navigator.clipboard?.writeText(value)}>
        Sao chép
      </Button>
      {onRegenerate && (
        <Button
          variant="ghost"
          className="text-sm px-2 py-1 text-red-600"
          onClick={() => confirm('Tạo khóa mới? Khóa cũ sẽ ngừng hoạt động, phải cập nhật lại bên kết nối.') && onRegenerate()}
        >
          Tạo mới
        </Button>
      )}
    </div>
  );
}

function BankTransactions() {
  const [rows] = useData(api.bankTransactions);
  if (!rows?.length) return <p className="text-gray-500">Chưa nhận giao dịch nào từ webhook.</p>;
  return (
    <details>
      <summary className="cursor-pointer font-semibold">Giao dịch nhận được gần đây</summary>
      <Table head={['Thời gian', 'Số tiền', 'Nội dung', 'Khớp bàn']}>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(r.createdAt)}</td>
            <td className="px-3 py-2">{formatPrice(r.amount)}</td>
            <td className="px-3 py-2 text-gray-600">{r.content}</td>
            <td className="px-3 py-2">{r.tableName ?? <Badge color="amber">Không khớp</Badge>}</td>
          </tr>
        ))}
      </Table>
    </details>
  );
}

// ---------- Máy in ----------

function PrintersTab({
  settings,
  onChange,
  onSaveSettings,
  agentKey,
  serverUrl,
  onRegenerate,
}: {
  settings: Settings;
  onChange: (printing: Settings['printing']) => void;
  onSaveSettings: (printing: Settings['printing']) => void;
  agentKey: string;
  serverUrl: string;
  onRegenerate: () => void;
}) {
  const [data, reload] = useData(api.printers);
  const [menu] = useData(api.menu);
  const [editing, setEditing] = useState<Printer | 'new' | null>(null);
  const p = settings.printing;

  return (
    <div className="space-y-4">
      <Card className="space-y-2 text-sm">
        <h3 className="font-bold text-base">Chương trình in trên máy quầy</h3>
        <p>
          Server có thể chạy trên cloud nên không nói chuyện trực tiếp được với máy in trong quán. Cài chương trình{' '}
          <code>print-agent</code> trên một máy tính trong quán (cùng mạng với máy in), cấu hình như sau:
        </p>
        <SecretRow label="SERVER_URL" value={serverUrl} />
        <SecretRow label="AGENT_KEY" value={agentKey} onRegenerate={onRegenerate} />
      </Card>

      <Card className="space-y-2">
        {(
          [
            ['kitchenTickets', 'In phiếu bếp tự động khi có đơn mới'],
            ['receiptOnCheckout', 'In hóa đơn tự động khi thanh toán'],
            ['removeAccents', 'In không dấu (cho máy in không hỗ trợ tiếng Việt)'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2">
            <input type="checkbox" checked={p[key]} onChange={(e) => onChange({ ...p, [key]: e.target.checked })} /> {label}
          </label>
        ))}
        <Button onClick={() => onSaveSettings(p)}>Lưu</Button>
      </Card>

      <div className="flex justify-between items-center">
        <h3 className="font-bold">Máy in</h3>
        <Button onClick={() => setEditing('new')}>+ Máy in</Button>
      </div>
      <Table head={['Tên', 'Loại', 'Địa chỉ', 'Danh mục in', '']}>
        {data?.printers.map((pr) => (
          <tr key={pr.id} className={pr.active ? '' : 'opacity-50'}>
            <td className="px-3 py-2 font-semibold">{pr.name}</td>
            <td className="px-3 py-2">{pr.kind === 'kitchen' ? 'Bếp / bar' : 'Hóa đơn'}</td>
            <td className="px-3 py-2 font-mono">{pr.address}</td>
            <td className="px-3 py-2 text-sm">
              {pr.kind === 'kitchen'
                ? pr.categoryIds.length
                  ? pr.categoryIds.map((id) => menu?.find((c) => c.id === id)?.title.vi ?? id).join(', ')
                  : 'Tất cả'
                : ''}
            </td>
            <td className="px-3 py-2 whitespace-nowrap">
              <Button variant="ghost" className="text-sm px-2 py-1" onClick={() => run(() => api.testPrinter(pr.id)).then(reload)}>
                In thử
              </Button>
              <Button variant="ghost" className="text-sm px-2 py-1" onClick={() => setEditing(pr)}>
                Sửa
              </Button>
            </td>
          </tr>
        ))}
      </Table>

      <h3 className="font-bold">Lệnh in gần đây</h3>
      <Table head={['#', 'Máy in', 'Tạo lúc', 'Trạng thái', 'Lỗi', '']}>
        {data?.jobs.map((j) => (
          <tr key={j.id}>
            <td className="px-3 py-2">{j.id}</td>
            <td className="px-3 py-2">{j.printer}</td>
            <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(j.createdAt)}</td>
            <td className="px-3 py-2">
              {j.status === 'printed' ? (
                <Badge color="green">Đã in</Badge>
              ) : j.status === 'failed' ? (
                <Badge color="red">Lỗi</Badge>
              ) : (
                <Badge color="amber">Chờ in{j.attempts ? ` (thử ${j.attempts})` : ''}</Badge>
              )}
            </td>
            <td className="px-3 py-2 text-sm text-red-600">{j.error}</td>
            <td className="px-3 py-2">
              {j.status !== 'printed' && (
                <Button variant="ghost" className="text-sm px-2 py-1" onClick={() => run(() => api.retryPrintJob(j.id)).then(reload)}>
                  In lại
                </Button>
              )}
            </td>
          </tr>
        ))}
      </Table>

      {editing && (
        <PrinterDialog
          printer={editing === 'new' ? null : editing}
          categories={menu?.map((c) => ({ id: c.id, name: c.title.vi })) ?? []}
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

function PrinterDialog({
  printer,
  categories,
  onClose,
  onSaved,
}: {
  printer: Printer | null;
  categories: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: printer?.name ?? '',
    kind: printer?.kind ?? ('kitchen' as Printer['kind']),
    address: printer?.address ?? '192.168.1.100:9100',
    categoryIds: printer?.categoryIds ?? [],
    active: printer?.active ?? true,
  });

  const save = async () => {
    const ok = await run(() => (printer ? api.updatePrinter(printer.id, form) : api.createPrinter(form)));
    if (ok) onSaved();
  };
  const remove = async () => {
    if (printer && confirm(`Xóa máy in ${printer.name}?`) && (await run(() => api.deletePrinter(printer.id)))) onSaved();
  };

  return (
    <Modal
      title={printer ? `Sửa ${printer.name}` : 'Thêm máy in'}
      onClose={onClose}
      footer={
        <>
          {printer && (
            <Button variant="danger" className="mr-auto" onClick={remove}>
              Xóa
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={!form.name || !form.address} onClick={save}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tên">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Bếp nướng" />
        </Field>
        <Field label="Loại">
          <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Printer['kind'] })}>
            <option value="kitchen">Bếp / bar (phiếu làm món)</option>
            <option value="receipt">Hóa đơn (quầy thu ngân)</option>
          </Select>
        </Field>
      </div>
      <Field label="Địa chỉ IP:cổng" hint="Máy in LAN (Xprinter, Epson...) thường dùng cổng 9100. Xem IP bằng cách in trang tự kiểm tra của máy in.">
        <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value.trim() })} className="font-mono" />
      </Field>
      {form.kind === 'kitchen' && (
        <Field label="Chỉ in các danh mục (bỏ trống = in tất cả)">
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <label key={c.id} className="flex items-center gap-1 border rounded-lg px-2 py-1">
                <input
                  type="checkbox"
                  checked={form.categoryIds.includes(c.id)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      categoryIds: e.target.checked ? [...form.categoryIds, c.id] : form.categoryIds.filter((id) => id !== c.id),
                    })
                  }
                />
                {c.name}
              </label>
            ))}
          </div>
        </Field>
      )}
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Đang dùng
      </label>
    </Modal>
  );
}

// ---------- Bàn ----------

function TablesTab() {
  const [tables, reload] = useData(api.tables);
  const [editing, setEditing] = useState<StaffTable | 'new' | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-gray-600">Khu vực dùng để nhóm bàn trên sơ đồ (VD: Tầng 1, Sân vườn, Phòng VIP).</p>
        <Button onClick={() => setEditing('new')}>+ Bàn</Button>
      </div>
      <Table head={['Tên bàn', 'Khu vực', 'Trạng thái', '']}>
        {tables?.map((t) => (
          <tr key={t.id}>
            <td className="px-3 py-2 font-semibold">{t.name}</td>
            <td className="px-3 py-2">{t.area || '—'}</td>
            <td className="px-3 py-2">{t.session ? <Badge color="green">Có khách</Badge> : 'Trống'}</td>
            <td className="px-3 py-2">
              <Button variant="ghost" className="text-sm px-2 py-1" onClick={() => setEditing(t)}>
                Sửa
              </Button>
            </td>
          </tr>
        ))}
      </Table>
      {editing && (
        <TableDialog
          table={editing === 'new' ? null : editing}
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

function TableDialog({ table, onClose, onSaved }: { table: StaffTable | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(table?.name ?? '');
  const [area, setArea] = useState(table?.area ?? '');
  const save = async () => {
    const ok = await run(() => (table ? api.updateTable(table.id, { name, area }) : api.createTable({ name, area })));
    if (ok) onSaved();
  };
  const remove = async () => {
    if (table && confirm(`Xóa ${table.name}?`) && (await run(() => api.deleteTable(table.id)))) onSaved();
  };
  return (
    <Modal
      title={table ? `Sửa ${table.name}` : 'Thêm bàn'}
      onClose={onClose}
      footer={
        <>
          {table && (
            <Button variant="danger" className="mr-auto" onClick={remove}>
              Xóa
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={!name} onClick={save}>
            Lưu
          </Button>
        </>
      }
    >
      <Field label="Tên bàn">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Khu vực">
        <Input value={area} onChange={(e) => setArea(e.target.value)} />
      </Field>
    </Modal>
  );
}

// ---------- Sao lưu ----------

function BackupTab() {
  const [backups, reload] = useData(api.backups);
  return (
    <Card className="space-y-3">
      <p className="text-gray-600">
        Hệ thống tự sao lưu mỗi ngày và giữ 30 bản gần nhất trên server. Nên tải bản sao lưu về máy khác định kỳ (hoặc cấu hình
        sao lưu của nhà cung cấp cloud) phòng khi server hỏng.
      </p>
      <Button onClick={() => run(api.createBackup).then(reload)}>Sao lưu ngay</Button>
      <Table head={['Bản sao lưu', 'Dung lượng', '']}>
        {backups?.map((b) => (
          <tr key={b.name}>
            <td className="px-3 py-2 font-mono">{b.name}</td>
            <td className="px-3 py-2">{(b.size / 1024).toFixed(0)} KB</td>
            <td className="px-3 py-2">
              <Button variant="ghost" className="text-sm px-2 py-1" onClick={() => run(() => download(`/backups/${b.name}`, b.name))}>
                Tải về
              </Button>
            </td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}
