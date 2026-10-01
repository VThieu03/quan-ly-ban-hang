import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { subscribe } from '../events.ts';
import { HttpError } from '../http.ts';
import { clockIn, clockOut, currentShift, currentTimesheet, login, logout, staffFromToken } from '../modules/staff.ts';
import { getSettings } from '../settings.ts';
import { can } from '../../../shared/permissions.ts';
import type { Permission } from '../../../shared/permissions.ts';
import type { StaffMember } from '../../../shared/types.ts';

export const authRouter = Router();

function tokenOf(req: Request) {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  // EventSource không gửi được header nên cho phép truyền qua query.
  return typeof req.query.token === 'string' ? req.query.token : undefined;
}

/** Nhân viên đang đăng nhập (đã qua requireStaff). */
export function me(res: Response): StaffMember {
  return res.locals.staff as StaffMember;
}

export function requireStaff(req: Request, res: Response, next: NextFunction) {
  const token = tokenOf(req);
  const staff = token ? staffFromToken(token) : undefined;
  if (!staff) throw new HttpError(401, 'unauthorized');
  res.locals.staff = staff;
  res.locals.token = token;
  next();
}

/** Cho qua nếu nhân viên có ít nhất một trong các quyền. */
export function need(...permissions: Permission[]) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (!permissions.some((p) => can(me(res).role, p))) throw new HttpError(403, 'forbidden');
    next();
  };
}

export function idParam(req: Request) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new HttpError(400, 'invalid_id');
  return id;
}

authRouter.post('/login', (req, res) => {
  res.json(login(req.body?.pin, req.ip ?? 'unknown'));
});

authRouter.use(requireStaff);

authRouter.post('/logout', (_req, res) => {
  logout(res.locals.token as string);
  res.status(204).end();
});

authRouter.get('/me', (_req, res) => {
  const staff = me(res);
  res.json({ staff, timesheet: currentTimesheet(staff.id), cashShift: can(staff.role, 'cashShift') ? currentShift() : null });
});

authRouter.post('/me/clock-in', (_req, res) => {
  clockIn(me(res).id);
  res.status(204).end();
});

authRouter.post('/me/clock-out', (_req, res) => {
  clockOut(me(res).id);
  res.status(204).end();
});

/** Cấu hình app quầy cần biết (không chứa khóa bí mật). */
authRouter.get('/config', (_req, res) => {
  const settings = getSettings();
  res.json({
    orderBaseUrl: res.app.get('orderBaseUrl') as string,
    restaurantName: settings.restaurant.name,
    vatRate: settings.vatRate,
    loyalty: settings.loyalty,
    bankConfigured: Boolean(settings.bank.bin && settings.bank.accountNumber),
    invoiceEnabled: settings.invoice.provider !== 'none',
    autoSoldOut: settings.inventory.autoSoldOut,
    operations: settings.operations,
  });
});

authRouter.get('/events', (_req, res) => {
  subscribe(res, null);
});
