import { Router } from 'express';
import type { Request } from 'express';
import { broadcast, subscribe } from '../events.ts';
import { HttpError } from '../http.ts';
import { afterStockChange } from '../modules/availability.ts';
import { activeBanners } from '../modules/banners.ts';
import { getMenu } from '../modules/menu.ts';
import { createOrder } from '../modules/orders.ts';
import { getSettings } from '../settings.ts';
import { findTableByToken, getCustomerSession, requestBill } from '../modules/tables.ts';
import type { CustomerTableView } from '../../../shared/types.ts';

// API cho khách: bàn được xác định bằng token trong mã QR, không cần đăng nhập.

export const customerRouter = Router();

function tableFromToken(req: Request) {
  const table = findTableByToken(req.params.token as string);
  if (!table) throw new HttpError(404, 'table_not_found');
  return table;
}

customerRouter.get('/menu', (_req, res) => {
  // Khách chỉ thấy số phần còn lại khi quán bật tự báo hết món (số liệu kho được dùng thật)
  // và khi món sắp hết (≤ ngưỡng trong Cài đặt → Vận hành) để hiện nhãn "Chỉ còn N phần".
  const { inventory, operations } = getSettings();
  const show = (remaining: number | null) =>
    inventory.autoSoldOut && remaining !== null && remaining <= operations.lowStockBadge ? remaining : null;
  res.json(getMenu().map((c) => ({ ...c, items: c.items.map((i) => ({ ...i, remaining: show(i.remaining) })) })));
});

customerRouter.get('/banners', (_req, res) => {
  res.json(activeBanners());
});

customerRouter.get('/table/:token', (req, res) => {
  const table = tableFromToken(req);
  const { pollSeconds, bannerSeconds, maxQuantityPerItem, maxNoteLength } = getSettings().system;
  const view: CustomerTableView = {
    id: table.id,
    name: table.name,
    session: getCustomerSession(table.id),
    kiosk: { pollSeconds, bannerSeconds, maxQuantityPerItem, maxNoteLength },
  };
  res.json(view);
});

customerRouter.post('/table/:token/orders', (req, res) => {
  const table = tableFromToken(req);
  const order = createOrder(table.id, req.body);
  broadcast({ type: 'table', tableId: table.id });
  afterStockChange();
  res.status(201).json(order);
});

customerRouter.post('/table/:token/bill-request', (req, res) => {
  const table = tableFromToken(req);
  requestBill(table.id);
  broadcast({ type: 'table', tableId: table.id });
  res.status(204).end();
});

customerRouter.get('/table/:token/events', (req, res) => {
  const table = tableFromToken(req);
  subscribe(res, table.id);
});
