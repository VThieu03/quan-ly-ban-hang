import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import './db.ts';
import { HttpError } from './http.ts';
import { scheduleBackups } from './modules/backup.ts';
import { retryPendingInvoices } from './modules/invoices.ts';
import { seedMenu, uploadsDir } from './modules/menu.ts';
import { ensureAdmin } from './modules/staff.ts';
import { seedTables } from './modules/tables.ts';
import { adminRouter } from './routes/admin.ts';
import { authRouter } from './routes/auth.ts';
import { customerRouter } from './routes/customer.ts';
import { integrationsRouter } from './routes/integrations.ts';
import { operationsRouter } from './routes/operations.ts';
import { getSecrets } from './settings.ts';
import { INVOICE_RETRY_MS } from '../../shared/config.ts';

const isDev = process.argv.includes('--dev');
const PORT = Number(process.env.PORT ?? 3000);

/** IP trong mạng wifi của quán, ưu tiên dải IP nội bộ. */
function lanAddress() {
  const candidates = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a!.address);
  const isPrivate = (ip: string) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  return candidates.find(isPrivate) ?? candidates[0] ?? 'localhost';
}

// Địa chỉ in trong mã QR. Khi dev, app gọi món chạy bằng Vite ở cổng 5173.
const orderBaseUrl = process.env.ORDER_BASE_URL ?? `http://${lanAddress()}:${isDev ? 5173 : PORT}/`;

seedMenu();
seedTables();
ensureAdmin();
getSecrets();
if (process.env.BACKUP !== 'off') scheduleBackups();
// Gửi lại hóa đơn điện tử lỗi (mất mạng, nhà cung cấp bảo trì...) mỗi 5 phút.
setInterval(() => retryPendingInvoices().catch((err) => console.error('Gửi lại HĐĐT lỗi:', err)), INVOICE_RETRY_MS).unref();

const app = express();
app.set('orderBaseUrl', orderBaseUrl);
// Chạy sau reverse proxy (nginx, Cloudflare...) thì bật để lấy đúng IP khách khi chống dò PIN.
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : process.env.TRUST_PROXY);
app.use(express.json({ limit: '4mb' })); // đủ cho ảnh món tải lên dạng base64

app.use('/api', integrationsRouter);
// authRouter xử lý /login rồi chặn mọi request chưa đăng nhập trước khi tới các router phía sau.
app.use('/api/staff', authRouter, operationsRouter, adminRouter);
app.use('/api', customerRouter);
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

app.use('/uploads', express.static(uploadsDir, { maxAge: '30d', immutable: true }));

// Bản build production: app nhân viên ở /pos, app gọi món ở /.
const posDist = fileURLToPath(new URL('../../pos-app/dist', import.meta.url));
const kioskDist = fileURLToPath(new URL('../../kiosk-app/dist', import.meta.url));
if (existsSync(posDist)) app.use('/pos', express.static(posDist));
if (existsSync(kioskDist)) app.use(express.static(kioskDist));

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, itemId: err.itemId });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: 'invalid_json' });
    return;
  }
  if (err instanceof Error && 'type' in err && err.type === 'entity.too.large') {
    res.status(413).json({ error: 'too_large' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server chạy tại http://localhost:${PORT}`);
  console.log(`Mã QR sẽ trỏ tới: ${orderBaseUrl}`);
});
