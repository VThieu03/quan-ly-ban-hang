import { connect } from 'node:net';
import { render } from './escpos.ts';
import type { PrintJob } from '../../shared/types.ts';

// Chương trình in chạy trên một máy tính trong quán (cùng mạng LAN với máy in).
// Định kỳ hỏi server có lệnh in mới không, gửi tới máy in qua TCP (cổng 9100), rồi báo kết quả.
//
//   SERVER_URL=https://quan-cua-ban.vn AGENT_KEY=... npm start -w print-agent

const SERVER_URL = (process.env.SERVER_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const AGENT_KEY = process.env.AGENT_KEY ?? '';
const POLL_MS = Number(process.env.POLL_MS ?? 2000);
const COLUMNS = Number(process.env.PAPER_COLUMNS ?? 48);
const PRINTER_TIMEOUT_MS = 5000;

if (!AGENT_KEY) {
  console.error('Thiếu AGENT_KEY (lấy trong app quầy: Cài đặt → Máy in).');
  process.exit(1);
}

function send(address: string, data: Buffer) {
  const [host, port = '9100'] = address.split(':');
  return new Promise<void>((resolve, reject) => {
    const socket = connect({ host, port: Number(port) });
    socket.setTimeout(PRINTER_TIMEOUT_MS, () => socket.destroy(new Error(`Máy in ${address} không phản hồi`)));
    socket.on('error', reject);
    socket.on('connect', () => socket.end(data));
    socket.on('close', (hadError) => !hadError && resolve());
  });
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${SERVER_URL}/api/print-agent${path}`, {
    ...init,
    headers: { 'x-agent-key': AGENT_KEY, 'Content-Type': 'application/json' },
  });
  if (res.status === 401) throw new Error('AGENT_KEY sai hoặc đã bị đổi.');
  if (!res.ok) throw new Error(`Server trả lỗi ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function tick() {
  const jobs = (await api('/jobs')) as PrintJob[];
  for (const job of jobs) {
    try {
      await send(job.address, render(job.lines, { columns: COLUMNS, removeAccents: job.removeAccents }));
      await api(`/jobs/${job.id}`, { method: 'POST', body: JSON.stringify({ ok: true }) });
      console.log(`${new Date().toLocaleTimeString('vi-VN')} ✓ In lệnh #${job.id} → ${job.printerName}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await api(`/jobs/${job.id}`, { method: 'POST', body: JSON.stringify({ ok: false, error: message }) });
      console.error(`${new Date().toLocaleTimeString('vi-VN')} ✗ Lệnh #${job.id} → ${job.printerName}: ${message}`);
    }
  }
}

console.log(`Chương trình in đang chạy, kết nối tới ${SERVER_URL} (mỗi ${POLL_MS / 1000}s).`);
let lastError = '';
for (;;) {
  try {
    await tick();
    if (lastError) console.log('Đã kết nối lại server.');
    lastError = '';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message !== lastError) console.error(`Không kết nối được server: ${message}`);
    lastError = message;
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
