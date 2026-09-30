import { useState } from 'react';
import { ROLE_LABELS, ROLE_PERMISSIONS, ROLES } from '../../../shared/permissions.ts';
import type { Role } from '../../../shared/permissions.ts';
import type { StaffMember } from '../../../shared/types.ts';
import { api, run } from '../api.ts';
import { useData } from '../context.ts';
import { Badge, Button, DateRange, Field, Input, Modal, PageHeader, Select, Table, Tabs } from '../components/ui.tsx';
import { formatDateTime, useDateRange } from '../dates.ts';

const PERMISSION_LABELS: Record<string, string> = {
  tables: 'Bàn & gọi món',
  checkout: 'Thanh toán',
  kitchen: 'Bếp',
  reservations: 'Đặt bàn',
  customers: 'Khách hàng',
  bills: 'Hóa đơn',
  cashShift: 'Ca thu ngân',
  menu: 'Thực đơn',
  promotions: 'Khuyến mãi',
  inventory: 'Kho',
  reports: 'Báo cáo',
  staff: 'Nhân viên',
  settings: 'Cài đặt',
};

export function StaffPage() {
  const [tab, setTab] = useState<'staff' | 'timesheets'>('staff');
  return (
    <div>
      <PageHeader title="Nhân viên" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'staff', label: 'Tài khoản' },
          { id: 'timesheets', label: 'Chấm công' },
        ]}
      />
      {tab === 'staff' ? <StaffTab /> : <TimesheetsTab />}
    </div>
  );
}

function StaffTab() {
  const [staff, reload] = useData(api.staff);
  const [editing, setEditing] = useState<StaffMember | 'new' | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>+ Nhân viên</Button>
      </div>
      <Table head={['Tên', 'Vai trò', 'Trạng thái', '']}>
        {staff?.map((s) => (
          <tr key={s.id} className={s.active ? '' : 'opacity-50'}>
            <td className="px-3 py-2 font-semibold">{s.name}</td>
            <td className="px-3 py-2">{ROLE_LABELS[s.role]}</td>
            <td className="px-3 py-2">{s.active ? <Badge color="green">Đang làm</Badge> : <Badge>Đã khóa</Badge>}</td>
            <td className="px-3 py-2">
              <Button variant="ghost" className="text-sm px-2 py-1" onClick={() => setEditing(s)}>
                Sửa
              </Button>
            </td>
          </tr>
        ))}
      </Table>
      <div className="bg-white rounded-2xl border p-4 text-sm">
        <h3 className="font-bold mb-2">Quyền của từng vai trò</h3>
        {ROLES.map((r) => (
          <p key={r}>
            <b>{ROLE_LABELS[r]}:</b> {ROLE_PERMISSIONS[r].map((p) => PERMISSION_LABELS[p]).join(', ')}
          </p>
        ))}
      </div>
      {editing && (
        <StaffDialog
          member={editing === 'new' ? null : editing}
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

function StaffDialog({ member, onClose, onSaved }: { member: StaffMember | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(member?.name ?? '');
  const [role, setRole] = useState<Role>(member?.role ?? 'waiter');
  const [pin, setPin] = useState('');
  const [active, setActive] = useState(member?.active ?? true);

  const save = async () => {
    const ok = await run(() =>
      member ? api.updateStaff(member.id, { name, role, active, pin: pin || undefined }) : api.createStaff({ name, role, pin }),
    );
    if (ok) onSaved();
  };

  return (
    <Modal
      title={member ? `Sửa ${member.name}` : 'Thêm nhân viên'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={!name || (!member && pin.length < 4)} onClick={save}>
            Lưu
          </Button>
        </>
      }
    >
      <Field label="Tên">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Vai trò">
        <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label={member ? 'Mã PIN mới (để trống nếu giữ nguyên)' : 'Mã PIN đăng nhập'}
        hint="4–12 chữ số, mỗi người một mã riêng. Nên dùng từ 6 số."
      >
        <Input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={12} />
      </Field>
      {member && (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Đang làm (bỏ chọn để khóa tài khoản)
        </label>
      )}
    </Modal>
  );
}

function TimesheetsTab() {
  const [range, setRange] = useDateRange(6);
  const [rows] = useData(() => api.timesheets(range.from, range.to), [range.from, range.to]);
  const totals = new Map<string, number>();
  for (const r of rows ?? []) totals.set(r.staffName, (totals.get(r.staffName) ?? 0) + r.minutes);
  const hours = (minutes: number) => `${Math.floor(minutes / 60)}g${String(minutes % 60).padStart(2, '0')}`;

  return (
    <div className="space-y-4">
      <DateRange value={range} onChange={setRange} />
      <div className="flex flex-wrap gap-2">
        {[...totals].map(([name, minutes]) => (
          <div key={name} className="bg-white border rounded-xl px-3 py-2">
            <b>{name}</b>: {hours(minutes)}
          </div>
        ))}
      </div>
      <Table head={['Nhân viên', 'Vào ca', 'Tan ca', 'Thời gian']}>
        {rows?.map((r) => (
          <tr key={r.id}>
            <td className="px-3 py-2">{r.staffName}</td>
            <td className="px-3 py-2">{formatDateTime(r.clockIn)}</td>
            <td className="px-3 py-2">{r.clockOut ? formatDateTime(r.clockOut) : <Badge color="green">Đang trong ca</Badge>}</td>
            <td className="px-3 py-2">{hours(r.minutes)}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
