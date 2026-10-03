import { connect } from 'node:net';
import { render } from './escpos.ts';
import { PRINT_AGENT_POLL_SECONDS, PRINTER_TIMEOUT_SECONDS } from '../../shared/config.ts';
import type { PrintJob } from '../../shared/types.ts';

// Chương trình in chạy trên một máy tính trong quán (cùng mạng LAN với máy in).
// Định kỳ hỏi server có lệnh in mới không, gửi tới máy in qua TCP (cổng 9100), rồi báo kết quả.
//
//   SERVER_URL=https://quan-cua-ban.vn AGENT_KEY=... npm start -w print-agent

const SERVER_URL = (process.env.SERVER_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const AGENT_KEY = process.env.AGENT_KEY ?? '';
// Chu kỳ hỏi lệnh, thời gian chờ máy in và khổ giấy lấy từ server (Cài đặt → Hệ thống).
// Đặt biến môi trường POLL_MS / PAPER_COLUMNS nếu muốn ghi đè riêng cho máy này.
const POLL_OVERRIDE = Number(process.env.POLL_MS) || 0;
const COLUMNS_OVERRIDE = Number(process.env.PAPER_COLUMNS) || 0;
let pollMs = POLL_OVERRIDE || PRINT_AGENT_POLL_SECONDS * 1000;
let printerTimeoutMs = PRINTER_TIMEOUT_SECONDS * 1000;

if (!AGENT_KEY) {
  console.error('Thiếu AGENT_KEY (lấy trong app quầy: Cài đặt → Máy in).');
  process.exit(1);
}

function send(address: string, data: Buffer) {
  const [host, port = '9100'] = address.split(':');
  return new Promise<void>((resolve, reject) => {
    const socket = connect({ host, port: Number(port) });
    socket.setTimeout(printerTimeoutMs, () => socket.destroy(new Error(`Máy in ${address} không phản hồi`)));
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
  const poll = Number(res.headers.get('x-poll-seconds'));
  const timeout = Number(res.headers.get('x-printer-timeout-seconds'));
  if (poll > 0 && !POLL_OVERRIDE) pollMs = poll * 1000;
  if (timeout > 0) printerTimeoutMs = timeout * 1000;
  return res.status === 204 ? null : res.json();
}

async function tick() {
  const jobs = (await api('/jobs')) as PrintJob[];
  for (const job of jobs) {
    try {
      await send(job.address, render(job.lines, { columns: COLUMNS_OVERRIDE || job.columns, removeAccents: job.removeAccents }));
      await api(`/jobs/${job.id}`, { method: 'POST', body: JSON.stringify({ ok: true }) });
      console.log(`${new Date().toLocaleTimeString('vi-VN')} ✓ In lệnh #${job.id} → ${job.printerName}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await api(`/jobs/${job.id}`, { method: 'POST', body: JSON.stringify({ ok: false, error: message }) });
      console.error(`${new Date().toLocaleTimeString('vi-VN')} ✗ Lệnh #${job.id} → ${job.printerName}: ${message}`);
    }
  }
}

console.log(`Chương trình in đang chạy, kết nối tới ${SERVER_URL}.`);
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
  await new Promise((r) => setTimeout(r, pollMs));
}
