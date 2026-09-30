import { removeAccents } from '../../shared/text.ts';
import type { PrintLine } from '../../shared/types.ts';

// Chuyển nội dung in sang lệnh ESC/POS cho máy in nhiệt (Xprinter, Epson, Rongta...).

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export type RenderOptions = {
  /** Số ký tự mỗi dòng: 48 cho giấy 80mm, 32 cho giấy 58mm. */
  columns: number;
  removeAccents: boolean;
};

/** Chỉ giữ ký tự ASCII: bỏ dấu, đổi ₫ · – và khoảng trắng không ngắt sang ký tự thường. */
export function toAscii(s: string) {
  return removeAccents(s)
    .replace(/₫/g, 'd')
    .replace(/[·•]/g, '-')
    .replace(/[–—]/g, '-')
    .replace(/[  ]/g, ' ')
    .replace(/[^\x20-\x7e]/g, '?');
}

export function render(lines: PrintLine[], options: RenderOptions): Buffer {
  const out: number[] = [ESC, 0x40]; // khởi tạo máy in
  const clean = (s: string) => (options.removeAccents ? toAscii(s) : s);
  const text = (s: string) => {
    out.push(...Buffer.from(clean(s), options.removeAccents ? 'ascii' : 'utf8'));
  };
  const align = (a: 'left' | 'center' | 'right' = 'left') => out.push(ESC, 0x61, { left: 0, center: 1, right: 2 }[a]);
  const bold = (on: boolean) => out.push(ESC, 0x45, on ? 1 : 0);
  const size = (large: boolean) => out.push(GS, 0x21, large ? 0x11 : 0x00);

  for (const line of lines) {
    switch (line.type) {
      case 'text':
        align(line.align);
        bold(Boolean(line.bold));
        size(line.size === 'large');
        text(line.text);
        out.push(LF);
        size(false);
        bold(false);
        break;
      case 'row': {
        align('left');
        bold(Boolean(line.bold));
        const left = clean(line.left);
        const right = clean(line.right);
        const gap = options.columns - [...left].length - [...right].length;
        if (gap >= 1) {
          text(left + ' '.repeat(gap) + right);
        } else {
          // Không đủ chỗ: phần tiền xuống dòng, căn phải.
          text(left);
          out.push(LF);
          text(' '.repeat(Math.max(0, options.columns - [...right].length)) + right);
        }
        out.push(LF);
        bold(false);
        break;
      }
      case 'divider':
        align('left');
        text('-'.repeat(options.columns));
        out.push(LF);
        break;
      case 'qr': {
        align('center');
        const data = Buffer.from(line.data, 'utf8');
        const len = data.length + 3;
        out.push(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00); // model 2
        out.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06); // cỡ ô 6
        out.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31); // sửa lỗi mức M
        out.push(GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...data); // lưu dữ liệu
        out.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30); // in
        out.push(LF);
        break;
      }
      case 'feed':
        out.push(ESC, 0x64, Math.min(line.lines, 10));
        break;
    }
  }
  out.push(GS, 0x56, 0x42, 0x00); // cắt giấy (nếu máy có dao cắt)
  return Buffer.from(out);
}
