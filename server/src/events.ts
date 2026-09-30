import type { Response } from 'express';
import type { ServerEvent } from '../../shared/types.ts';

// Server-Sent Events: server đẩy thông báo "có thay đổi", client tự tải lại dữ liệu.

type Client = { res: Response; tableId: number | null }; // tableId null = nhân viên, nhận mọi sự kiện

const clients = new Set<Client>();

export function subscribe(res: Response, tableId: number | null) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    // no-transform: không cho proxy (Cloudflare, nginx...) nén/gom dữ liệu làm trễ sự kiện.
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  const client = { res, tableId };
  clients.add(client);
  res.on('close', () => clients.delete(client));
}

export function broadcast(event: ServerEvent) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    // Khách chỉ nhận thay đổi của bàn mình và thực đơn; nhân viên nhận tất cả.
    const wanted =
      client.tableId === null || event.type === 'menu' || (event.type === 'table' && event.tableId === client.tableId);
    if (wanted) client.res.write(data);
  }
}

// Giữ kết nối sống qua proxy / router wifi.
setInterval(() => {
  for (const client of clients) client.res.write(': ping\n\n');
}, 25_000).unref();
