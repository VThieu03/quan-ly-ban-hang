import { Router } from 'express';
import { broadcast } from '../events.ts';
import { dateRange, HttpError, oneOf, str } from '../http.ts';
import { afterStockChange } from '../modules/availability.ts';
import { FORECAST_DAYS } from '../../../shared/config.ts';
import { backupPath, createBackup, listBackups } from '../modules/backup.ts';
import { recentBankTransactions } from '../modules/bank.ts';
import {
  adjustStock,
  createIngredient,
  createPurchase,
  createSupplier,
  deleteIngredient,
  deleteSupplier,
  getForecast,
  getRecipes,
  linkFromMenu,
  listIngredients,
  listMoves,
  listPurchases,
  listSuppliers,
  menuCosts,
  setIngredientCosts,
  setRecipe,
  stocktake,
  updateIngredient,
  updatePurchase,
  updateSupplier,
  voidPurchase,
} from '../modules/inventory.ts';
import { retryPendingInvoices } from '../modules/invoices.ts';
import {
  createCategory,
  createMenuItem,
  deleteCategory,
  deleteMenuItem,
  reorderCategories,
  reorderItems,
  saveImage,
  updateCategory,
  updateMenuItem,
} from '../modules/menu.ts';
import {
  createPrinter,
  deletePrinter,
  enqueueTestPage,
  listPrinters,
  recentJobs,
  retryJob,
  updatePrinter,
} from '../modules/printing.ts';
import { createBanner, deleteBanner, listBanners, reorderBanners, updateBanner } from '../modules/banners.ts';
import { createPromotion, deletePromotion, listPromotions, updatePromotion } from '../modules/promotions.ts';
import { billsCsv, getReport } from '../modules/reports.ts';
import { createStaff, listStaff, listTimesheets, updateStaff } from '../modules/staff.ts';
import { createTable, deleteTable, regenerateTableToken, updateTable } from '../modules/tables.ts';
import { getSecrets, getSettings, regenerateSecret, updateSettings } from '../settings.ts';
import { idParam, me, need } from './auth.ts';

// Quản trị: thực đơn, khuyến mãi, kho, báo cáo, nhân viên, cài đặt.

export const adminRouter = Router();

// ---------- Thực đơn ----------

adminRouter.post('/menu/categories', need('menu'), (req, res) => {
  const id = createCategory(req.body ?? {});
  broadcast({ type: 'menu' });
  res.status(201).json({ id });
});

adminRouter.patch('/menu/categories/:id', need('menu'), (req, res) => {
  updateCategory(req.params.id as string, req.body ?? {});
  broadcast({ type: 'menu' });
  res.status(204).end();
});

adminRouter.delete('/menu/categories/:id', need('menu'), (req, res) => {
  deleteCategory(req.params.id as string);
  broadcast({ type: 'menu' });
  res.status(204).end();
});

adminRouter.post('/menu/items', need('menu'), (req, res) => {
  const id = createMenuItem(req.body ?? {});
  broadcast({ type: 'menu' });
  res.status(201).json({ id });
});

adminRouter.patch('/menu/items/:id', need('menu'), (req, res) => {
  updateMenuItem(req.params.id as string, req.body ?? {});
  afterStockChange();
  broadcast({ type: 'menu' });
  res.status(204).end();
});

adminRouter.delete('/menu/items/:id', need('menu'), (req, res) => {
  deleteMenuItem(req.params.id as string);
  afterStockChange();
  broadcast({ type: 'menu' });
  res.status(204).end();
});

adminRouter.post('/menu/reorder', need('menu'), (req, res) => {
  if (req.body?.categoryId) reorderItems(req.body.categoryId, req.body.ids);
  else reorderCategories(req.body?.ids);
  broadcast({ type: 'menu' });
  res.status(204).end();
});

adminRouter.post('/menu/images', need('menu', 'promotions'), (req, res) => {
  res.status(201).json({ url: saveImage(req.body?.dataUrl) });
});

adminRouter.get('/menu/costs', need('menu', 'inventory', 'reports'), (_req, res) => {
  res.json(menuCosts());
});

// ---------- Bàn (cấu hình) ----------

adminRouter.post('/tables', need('settings'), (req, res) => {
  const id = createTable(req.body ?? {});
  broadcast({ type: 'table', tableId: id });
  res.status(201).json({ id });
});

adminRouter.patch('/tables/:id', need('settings'), (req, res) => {
  const id = idParam(req);
  updateTable(id, req.body ?? {});
  broadcast({ type: 'table', tableId: id });
  res.status(204).end();
});

adminRouter.post('/tables/:id/token', need('settings'), (req, res) => {
  regenerateTableToken(idParam(req));
  res.status(204).end();
});

adminRouter.delete('/tables/:id', need('settings'), (req, res) => {
  const id = idParam(req);
  deleteTable(id);
  broadcast({ type: 'table', tableId: id });
  res.status(204).end();
});

// ---------- Khuyến mãi ----------

adminRouter.get('/promotions', need('promotions'), (_req, res) => {
  res.json(listPromotions());
});

adminRouter.post('/promotions', need('promotions'), (req, res) => {
  createPromotion(req.body ?? {});
  res.status(201).end();
});

adminRouter.patch('/promotions/:id', need('promotions'), (req, res) => {
  updatePromotion(idParam(req), req.body ?? {});
  res.status(204).end();
});

adminRouter.delete('/promotions/:id', need('promotions'), (req, res) => {
  deletePromotion(idParam(req));
  res.status(204).end();
});

// ---------- Banner quảng cáo ----------

adminRouter.get('/banners', need('promotions'), (_req, res) => {
  res.json(listBanners());
});

adminRouter.post('/banners', need('promotions'), (req, res) => {
  createBanner(req.body ?? {});
  broadcast({ type: 'menu' });
  res.status(201).end();
});

adminRouter.put('/banners/:id', need('promotions'), (req, res) => {
  updateBanner(idParam(req), req.body ?? {});
  broadcast({ type: 'menu' });
  res.status(204).end();
});

adminRouter.delete('/banners/:id', need('promotions'), (req, res) => {
  deleteBanner(idParam(req));
  broadcast({ type: 'menu' });
  res.status(204).end();
});

adminRouter.post('/banners/reorder', need('promotions'), (req, res) => {
  reorderBanners(req.body?.ids);
  broadcast({ type: 'menu' });
  res.status(204).end();
});

// ---------- Kho ----------

adminRouter.get('/inventory/ingredients', need('inventory'), (_req, res) => {
  res.json(listIngredients());
});

adminRouter.post('/inventory/ingredients', need('inventory'), (req, res) => {
  createIngredient(req.body ?? {}, me(res).id);
  afterStockChange();
  res.status(201).end();
});

adminRouter.patch('/inventory/ingredients/:id', need('inventory'), (req, res) => {
  updateIngredient(idParam(req), req.body ?? {});
  afterStockChange();
  res.status(204).end();
});

adminRouter.get('/inventory/forecast', need('inventory', 'menu'), (req, res) => {
  res.json(getForecast(req.query.days ? Math.min(365, Math.max(1, Number(req.query.days) || FORECAST_DAYS)) : FORECAST_DAYS));
});

adminRouter.post('/inventory/costs', need('inventory'), (req, res) => {
  setIngredientCosts(req.body ?? {}, me(res).id);
  res.status(204).end();
});

adminRouter.post('/inventory/from-menu', need('inventory'), (req, res) => {
  const result = linkFromMenu(req.body ?? {}, me(res).id);
  afterStockChange();
  res.status(201).json(result);
});

adminRouter.get('/inventory/recipes', need('inventory'), (_req, res) => {
  res.json(getRecipes());
});

adminRouter.put('/inventory/recipes/:menuItemId', need('inventory'), (req, res) => {
  setRecipe(req.params.menuItemId as string, req.body?.lines);
  afterStockChange();
  res.status(204).end();
});

adminRouter.get('/inventory/suppliers', need('inventory'), (_req, res) => {
  res.json(listSuppliers());
});

adminRouter.post('/inventory/suppliers', need('inventory'), (req, res) => {
  createSupplier(req.body ?? {});
  res.status(201).end();
});

adminRouter.patch('/inventory/suppliers/:id', need('inventory'), (req, res) => {
  updateSupplier(idParam(req), req.body ?? {});
  res.status(204).end();
});

adminRouter.delete('/inventory/suppliers/:id', need('inventory'), (req, res) => {
  deleteSupplier(idParam(req));
  res.status(204).end();
});

adminRouter.get('/inventory/purchases', need('inventory'), (req, res) => {
  const { startIso, endIso } = dateRange(req.query.from, req.query.to);
  res.json(listPurchases(startIso, endIso));
});

adminRouter.post('/inventory/purchases', need('inventory'), (req, res) => {
  createPurchase(req.body ?? {}, me(res).id);
  afterStockChange();
  res.status(201).end();
});

adminRouter.put('/inventory/purchases/:id', need('inventory'), (req, res) => {
  updatePurchase(idParam(req), req.body ?? {}, me(res).id);
  afterStockChange();
  res.status(204).end();
});

adminRouter.post('/inventory/purchases/:id/void', need('inventory'), (req, res) => {
  voidPurchase(idParam(req), req.body?.reason, me(res).id);
  afterStockChange();
  res.status(204).end();
});

adminRouter.delete('/inventory/ingredients/:id', need('inventory'), (req, res) => {
  deleteIngredient(idParam(req));
  afterStockChange();
  res.status(204).end();
});

adminRouter.post('/inventory/adjust', need('inventory'), (req, res) => {
  adjustStock(req.body ?? {}, me(res).id);
  afterStockChange();
  res.status(204).end();
});

adminRouter.post('/inventory/stocktake', need('inventory'), (req, res) => {
  stocktake(req.body ?? {}, me(res).id);
  afterStockChange();
  res.status(204).end();
});

adminRouter.get('/inventory/moves', need('inventory'), (req, res) => {
  const { startIso, endIso } = dateRange(req.query.from, req.query.to);
  res.json(listMoves(startIso, endIso, { ingredientId: req.query.ingredientId, type: req.query.type }));
});

// ---------- Báo cáo ----------

adminRouter.get('/reports', need('reports'), (req, res) => {
  const { from, to, startIso, endIso } = dateRange(req.query.from, req.query.to);
  res.json(getReport(from, to, startIso, endIso));
});

adminRouter.get('/reports/bills.csv', need('reports'), (req, res) => {
  const { from, to, startIso, endIso } = dateRange(req.query.from, req.query.to);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="hoa-don_${from}_${to}.csv"`);
  res.send(billsCsv(startIso, endIso));
});

/** Doanh thu hôm nay cho thanh tiêu đề. */
adminRouter.get('/summary', need('bills', 'reports'), (_req, res) => {
  const { from, to, startIso, endIso } = dateRange(undefined, undefined);
  const report = getReport(from, to, startIso, endIso);
  res.json({ date: from, bills: report.bills, revenue: report.revenue, byMethod: report.byMethod });
});

// ---------- Nhân viên ----------

adminRouter.get('/staff', need('staff'), (_req, res) => {
  res.json(listStaff());
});

adminRouter.post('/staff', need('staff'), (req, res) => {
  res.status(201).json(createStaff(req.body ?? {}));
});

adminRouter.patch('/staff/:id', need('staff'), (req, res) => {
  updateStaff(idParam(req), req.body ?? {});
  res.status(204).end();
});

adminRouter.get('/timesheets', need('staff'), (req, res) => {
  const { startIso, endIso } = dateRange(req.query.from, req.query.to);
  res.json(listTimesheets(startIso, endIso));
});

// ---------- Cài đặt ----------

adminRouter.get('/settings', need('settings'), (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({
    settings: getSettings(),
    secrets: getSecrets(),
    bankWebhookUrl: `${base}/api/webhooks/bank`,
    printAgentUrl: base,
  });
});

adminRouter.put('/settings', need('settings'), (req, res) => {
  const settings = updateSettings(req.body);
  afterStockChange();
  broadcast({ type: 'data' });
  res.json(settings);
});

adminRouter.post('/settings/secrets/:name/regenerate', need('settings'), (req, res) => {
  res.json(regenerateSecret(oneOf(req.params.name, ['bankWebhookKey', 'printAgentKey'] as const, 'invalid_secret')));
});

adminRouter.get('/printers', need('settings'), (_req, res) => {
  res.json({ printers: listPrinters(), jobs: recentJobs() });
});

adminRouter.post('/printers', need('settings'), (req, res) => {
  createPrinter(req.body ?? {});
  res.status(201).end();
});

adminRouter.put('/printers/:id', need('settings'), (req, res) => {
  updatePrinter(idParam(req), req.body ?? {});
  res.status(204).end();
});

adminRouter.delete('/printers/:id', need('settings'), (req, res) => {
  deletePrinter(idParam(req));
  res.status(204).end();
});

adminRouter.post('/printers/:id/test', need('settings'), (req, res) => {
  enqueueTestPage(idParam(req));
  res.status(204).end();
});

adminRouter.post('/print-jobs/:id/retry', need('settings'), (req, res) => {
  retryJob(idParam(req));
  res.status(204).end();
});

adminRouter.get('/bank-transactions', need('settings', 'reports'), (_req, res) => {
  res.json(recentBankTransactions());
});

adminRouter.post('/invoices/retry', need('settings', 'bills'), async (_req, res) => {
  res.json({ retried: await retryPendingInvoices() });
});

adminRouter.get('/backups', need('settings'), (_req, res) => {
  res.json(listBackups());
});

adminRouter.post('/backups', need('settings'), (_req, res) => {
  createBackup();
  res.status(201).json(listBackups());
});

adminRouter.get('/backups/:name', need('settings'), (req, res) => {
  const path = backupPath(str(req.params.name, 'invalid_name'));
  if (!path) throw new HttpError(404, 'not_found');
  res.download(path);
});
