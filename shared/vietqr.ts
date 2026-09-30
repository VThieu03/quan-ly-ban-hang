// Tạo nội dung mã VietQR (chuẩn EMVCo của NAPAS) để khách quét bằng app ngân hàng.

function field(id: string, value: string) {
  return id + String(value.length).padStart(2, '0') + value;
}

/** CRC-16/CCITT-FALSE theo yêu cầu của chuẩn EMVCo. */
function crc16(input: string) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(input)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export type VietQrInput = {
  bin: string; // mã ngân hàng 6 số, ví dụ 970436 (Vietcombank)
  accountNumber: string;
  amount?: number;
  description?: string; // nên không dấu, tối đa 25 ký tự
};

export function buildVietQrPayload({ bin, accountNumber, amount, description }: VietQrInput) {
  const merchant = field(
    '38',
    field('00', 'A000000727') + field('01', field('00', bin) + field('01', accountNumber)) + field('02', 'QRIBFTTA'),
  );
  let payload =
    field('00', '01') +
    field('01', amount ? '12' : '11') +
    merchant +
    field('53', '704') +
    (amount ? field('54', String(Math.round(amount))) : '') +
    field('58', 'VN') +
    (description ? field('62', field('08', description.slice(0, 25))) : '');
  payload += '6304';
  return payload + crc16(payload);
}

/** Nội dung chuyển khoản gắn với một lượt ngồi, dùng để tự khớp giao dịch. */
export function transferCode(sessionId: number) {
  return `KBBQ${sessionId}`;
}

export const TRANSFER_CODE_PATTERN = /KBBQ\s?(\d+)/i;
