import { Router } from 'express';
import { broadcast } from '../events.ts';
import { dateRange, int } from '../http.ts';
import {
  billDetail,
  cancelPendingTransfer,
  checkout,
  computeBreakdown,
  issueBillInvoice,
  listBills,
  parseCheckoutRequest,
  prepareTransfer,
  printProvisionalBill,
  reprintBill,
} from '../modules/checkout.ts';
import { createCustomer, listCustomers, lookupCustomer, updateCustomer } from '../modules/customers.ts';
import { getMenu } from '../modules/menu.ts';
import { cancelOrderItem, createOrder, getKitchenOrders, moveItems, updateOrderStatus } from '../modules/orders.ts';
import { createReservation, listReservations, updateReservation } from '../modules/reservations.ts';
import { closeShift, currentShift, listShifts, openShift } from '../modules/staff.ts';
import { getStaffTables, mergeTables, moveTable, openTable } from '../modules/tables.ts';
import { idParam, me, need } from './auth.ts';

// Nghiệp vụ hằng ngày: bàn, gọi món, bếp, thanh toán, hóa đơn, khách hàng, đặt bàn, ca thu ngân.

export const operationsRouter = Router();

operationsRouter.get('/menu', (_req, res) => {
  res.json(getMenu());
});

// ---------- Bàn ----------

operationsRouter.get('/tables', need('tables', 'checkout'), (_req, res) => {
  res.json(getStaffTables());
});

operationsRouter.post('/tables/:id/open', need('tables'), (req, res) => {
  const id = idParam(req);
  openTable(id, req.body ?? {}, me(res).id);
  broadcast({ type: 'table', tableId: id });
  res.status(204).end();
});

/** Nhân viên gọi món thay khách. */
operationsRouter.post('/tables/:id/orders', need('tables'), (req, res) => {
  const id = idParam(req);
  const order = createOrder(id, req.body, { source: 'staff', staffId: me(res).id });
  broadcast({ type: 'table', tableId: id });
  res.status(201).json(order);
});

operationsRouter.post('/tables/:id/move', need('tables'), (req, res) => {
  const from = idParam(req);
  const to = int(req.body?.toTableId, 'invalid_table');
  moveTable(from, to);
  broadcast({ type: 'table', tableId: from });
  broadcast({ type: 'table', tableId: to });
  res.status(204).end();
});

operationsRouter.post('/tables/:id/merge', need('tables'), (req, res) => {
  const from = idParam(req);
  const into = int(req.body?.intoTableId, 'invalid_table');
  mergeTables(from, into);
  broadcast({ type: 'table', tableId: from });
  broadcast({ type: 'table', tableId: into });
  res.status(204).end();
});

operationsRouter.post('/tables/:id/split', need('tables'), (req, res) => {
  const from = idParam(req);
  const to = int(req.body?.toTableId, 'invalid_table');
  const staffId = me(res).id;
  moveItems(from, to, req.body?.lines, staffId, (tableId) => openTable(tableId, {}, staffId));
  broadcast({ type: 'table', tableId: from });
  broadcast({ type: 'table', tableId: to });
  res.status(204).end();
});

operationsRouter.post('/tables/:id/print-bill', need('tables', 'checkout'), (req, res) => {
  printProvisionalBill(idParam(req), req.body?.paymentMethod ? parseCheckoutRequest(req.body) : null);
  res.status(204).end();
});

// ---------- Bếp / đơn ----------

operationsRouter.get('/kitchen', need('kitchen'), (_req, res) => {
  res.json(getKitchenOrders());
});

operationsRouter.patch('/orders/:id', need('kitchen', 'tables'), (req, res) => {
  const tableId = updateOrderStatus(idParam(req), req.body?.status);
  broadcast({ type: 'table', tableId });
  res.status(204).end();
});

operationsRouter.post('/order-items/:id/cancel', need('tables'), (req, res) => {
  const tableId = cancelOrderItem(idParam(req), req.body ?? {}, me(res).id);
  broadcast({ type: 'table', tableId });
  res.status(204).end();
});

// ---------- Thanh toán ----------

operationsRouter.post('/tables/:id/checkout/preview', need('checkout'), (req, res) => {
  res.json(computeBreakdown(idParam(req), parseCheckoutRequest(req.body)));
});

operationsRouter.post('/tables/:id/checkout/transfer', need('checkout'), (req, res) => {
  const id = idParam(req);
  const result = prepareTransfer(id, parseCheckoutRequest({ ...req.body, paymentMethod: 'transfer' }));
  broadcast({ type: 'table', tableId: id });
  res.json(result);
});

operationsRouter.delete('/tables/:id/checkout/transfer', need('checkout'), (req, res) => {
  const id = idParam(req);
  cancelPendingTransfer(id);
  broadcast({ type: 'table', tableId: id });
  res.status(204).end();
});

operationsRouter.post('/tables/:id/checkout', need('checkout'), async (req, res) => {
  const id = idParam(req);
  const result = await checkout(id, parseCheckoutRequest(req.body), me(res).id);
  broadcast({ type: 'table', tableId: id });
  broadcast({ type: 'data' });
  res.json(result);
});

// ---------- Hóa đơn đã thanh toán ----------

operationsRouter.get('/bills', need('bills'), (req, res) => {
  const { startIso, endIso } = dateRange(req.query.from, req.query.to);
  res.json(listBills(startIso, endIso));
});

operationsRouter.get('/bills/:id', need('bills'), (req, res) => {
  res.json(billDetail(idParam(req)));
});

operationsRouter.post('/bills/:id/reprint', need('bills'), (req, res) => {
  reprintBill(idParam(req));
  res.status(204).end();
});

operationsRouter.post('/bills/:id/invoice', need('bills'), async (req, res) => {
  res.json(await issueBillInvoice(idParam(req), req.body?.buyer));
});

// ---------- Khách hàng ----------

operationsRouter.get('/customers', need('customers'), (req, res) => {
  res.json(listCustomers(req.query.q));
});

operationsRouter.get('/customers/lookup', need('checkout', 'customers'), (req, res) => {
  res.json(lookupCustomer(req.query.phone));
});

operationsRouter.post('/customers', need('customers'), (req, res) => {
  createCustomer(req.body ?? {});
  res.status(201).end();
});

operationsRouter.patch('/customers/:id', need('customers'), (req, res) => {
  updateCustomer(idParam(req), req.body ?? {});
  res.status(204).end();
});

// ---------- Đặt bàn ----------

operationsRouter.get('/reservations', need('reservations'), (req, res) => {
  const { startIso, endIso } = dateRange(req.query.from, req.query.to);
  res.json(listReservations(startIso, endIso));
});

operationsRouter.post('/reservations', need('reservations'), (req, res) => {
  createReservation(req.body ?? {});
  broadcast({ type: 'data' });
  res.status(201).end();
});

operationsRouter.patch('/reservations/:id', need('reservations'), (req, res) => {
  updateReservation(idParam(req), req.body ?? {});
  broadcast({ type: 'data' });
  res.status(204).end();
});

// ---------- Ca thu ngân ----------

operationsRouter.get('/cash-shifts', need('cashShift'), (_req, res) => {
  res.json({ current: currentShift(), history: listShifts() });
});

operationsRouter.post('/cash-shifts/open', need('cashShift'), (req, res) => {
  openShift(me(res).id, req.body?.openingCash);
  res.status(204).end();
});

operationsRouter.post('/cash-shifts/close', need('cashShift'), (req, res) => {
  res.json(closeShift(me(res).id, req.body?.countedCash, req.body?.note));
});
