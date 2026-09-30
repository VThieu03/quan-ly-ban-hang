# K-BBQ – Hệ thống gọi món & quản lý nhà hàng

| Thư mục        | Vai trò                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| `kiosk-app/`   | App gọi món cho khách: quét mã QR tại bàn hoặc tablet đặt ở bàn. 5 ngôn ngữ.                               |
| `pos-app/`     | App nhân viên (mở ở `/pos`): bàn, thanh toán, bếp, đặt bàn, hóa đơn, khách hàng, thực đơn, kho, báo cáo… |
| `server/`      | API Node.js + SQLite, đẩy cập nhật realtime (Server-Sent Events).                                          |
| `print-agent/` | Chương trình in chạy trên máy tính trong quán, in phiếu bếp / hóa đơn ra máy in nhiệt qua mạng LAN.       |
| `shared/`      | Kiểu dữ liệu, phân quyền, VietQR… dùng chung.                                                             |

Yêu cầu: **Node.js 24** trở lên (dùng SQLite và chạy TypeScript có sẵn trong Node).

## Tính năng

**Khách (QR tại bàn):** xem thực đơn có ảnh, 5 ngôn ngữ, gọi món, ghi chú cho bếp, theo dõi trạng thái món, gọi thanh toán.

**Nhân viên (app quầy):**

- **Bàn:** sơ đồ theo khu vực, mở bàn (số khách, lịch đặt), nhân viên gọi món thay khách, hủy món (một phần, có lý do),
  chuyển bàn, gộp bàn, tách món sang bàn khác, in tạm tính kèm VietQR.
- **Thanh toán:** tiền mặt (tính tiền thối), thẻ, chuyển khoản bằng **VietQR đúng số tiền, tự đóng bill khi tiền về**
  (webhook SePay); giảm giá theo % / số tiền, mã khuyến mãi, khách hàng thành viên & tích / dùng điểm, xuất hóa đơn công ty.
- **Bếp:** danh sách đơn theo thứ tự, cảnh báo đơn chờ lâu, phiếu bếp tự in theo máy in / danh mục.
- **Đặt bàn**, **khách hàng thành viên**, **mã khuyến mãi** (thời hạn, giới hạn lượt, hóa đơn tối thiểu).
- **Hóa đơn:** tra cứu, in lại, **hóa đơn điện tử** (khung kết nối nhà cung cấp + chế độ thử nghiệm), tự gửi lại khi lỗi.
- **Kho:** nguyên liệu, định lượng món, nhập hàng (giá vốn bình quân), xuất hủy, kiểm kho, nhà cung cấp; tự trừ kho khi bán.
- **Báo cáo:** doanh thu theo ngày / giờ, món bán chạy, danh mục, thu ngân, hình thức thanh toán, giá vốn & lãi gộp, xuất CSV.
- **Nhân viên:** tài khoản riêng bằng mã PIN, phân quyền (Quản lý / Thu ngân / Phục vụ / Bếp), chấm công, **chốt ca thu ngân**.
- **Cài đặt:** thông tin nhà hàng, VAT, tài khoản ngân hàng, tích điểm, HĐĐT, máy in, bàn & khu vực, sao lưu tự động.

## Quy trình

1. Nhân viên **Mở bàn** trên app quầy.
2. Khách quét mã QR → gọi món → đơn hiện ở **Sơ đồ bàn** và **Bếp** (có tiếng "ting"), phiếu bếp tự in.
3. Bếp bấm **Bắt đầu làm** → **Đã lên món**; khách thấy trạng thái trong mục "Đã gọi".
4. Khách bấm **Gọi thanh toán** → bàn nhấp nháy màu cam.
5. Thu ngân mở **Thanh toán**: áp giảm giá / mã / điểm, chọn hình thức. Chuyển khoản thì bấm **Hiện mã QR**, khách quét,
   tiền về là bill tự đóng. Kho tự trừ, khách được cộng điểm, hóa đơn điện tử tự xuất.

## Chạy khi phát triển

```bash
npm install
npm run dev
```

- App gọi món: http://localhost:5173/?t=<mã bàn> (lấy link ở trang **Mã QR bàn** của app quầy)
- App quầy: http://localhost:5174/pos/ — tài khoản quản lý đầu tiên dùng PIN trong `STAFF_PIN` (mặc định `1234`).
  **Vào Nhân viên để tạo PIN riêng cho từng người và đổi PIN quản lý.**

Dữ liệu nằm trong `server/data/` (database, ảnh tải lên, bản sao lưu). Database cũ được tự nâng cấp khi khởi động.

## Đưa lên cloud

Cách đơn giản: một VPS Ubuntu (1 CPU, 1GB RAM là đủ) + tên miền, dùng [Caddy](https://caddyserver.com) để có HTTPS tự động.

```bash
# trên VPS, đã cài Node.js 24 và git
git clone <repo> /opt/kbbq && cd /opt/kbbq
npm ci && npm run build
```

Tạo dịch vụ systemd `/etc/systemd/system/kbbq.service`:

```ini
[Service]
WorkingDirectory=/opt/kbbq
ExecStart=/usr/bin/npm start
Environment=PORT=3000
Environment=ORDER_BASE_URL=https://order.ten-mien-cua-ban.vn/
Environment=STAFF_PIN=<PIN quản lý lần đầu>
Environment=TRUST_PROXY=loopback
Restart=always

[Install]
WantedBy=multi-user.target
```

`/etc/caddy/Caddyfile`:

```
order.ten-mien-cua-ban.vn {
    reverse_proxy localhost:3000
}
```

Sau đó `systemctl enable --now kbbq caddy`. Khách vào `https://order.../?t=...`, nhân viên vào `https://order.../pos/`.
Nhớ bật sao lưu / snapshot của nhà cung cấp VPS và định kỳ tải bản sao lưu trong **Cài đặt → Sao lưu** về máy khác.

| Biến môi trường  | Mặc định                  | Ý nghĩa                                                                        |
| ---------------- | ------------------------- | ------------------------------------------------------------------------------ |
| `STAFF_PIN`      | `1234`                    | PIN của tài khoản quản lý **tạo lần đầu** (sau đó đổi trong app).               |
| `PORT`           | `3000`                    | Cổng server.                                                                   |
| `ORDER_BASE_URL` | `http://<IP LAN>:<PORT>/` | Địa chỉ in trong mã QR.                                                        |
| `TRUST_PROXY`    | (tắt)                     | Đặt `loopback` / `true` khi chạy sau Caddy / nginx để chống dò PIN theo đúng IP. |
| `TABLE_COUNT`    | `10`                      | Số bàn tạo lần đầu.                                                            |
| `DB_PATH`        | `server/data/app.db`      | File database.                                                                 |
| `BACKUP_DIR`     | `server/data/backups/`    | Nơi lưu bản sao lưu tự động (mỗi ngày, giữ 30 bản; `BACKUP=off` để tắt).       |

## Kết nối bên ngoài

### Tự xác nhận chuyển khoản (SePay)

1. Đăng ký [sepay.vn](https://sepay.vn), liên kết tài khoản ngân hàng nhận tiền.
2. Trong app quầy: **Cài đặt → Thanh toán**, nhập ngân hàng + số tài khoản (để tạo VietQR), chép **URL webhook** và **API Key**.
3. Trên SePay: tạo webhook với URL và API Key đó (kiểu xác thực "API Key").

Khi khách chuyển đúng số tiền với nội dung `KBBQ<số>`, bill tự đóng và app quầy báo "Nhận chuyển khoản". Chuyển thiếu
tiền thì không tự đóng, thu ngân xử lý tay.

### Máy in (print-agent)

Chạy trên một máy tính trong quán, cùng mạng với máy in nhiệt LAN (Xprinter, Epson, Rongta… cổng 9100):

```bash
SERVER_URL=https://order.ten-mien-cua-ban.vn AGENT_KEY=<lấy trong Cài đặt → Máy in> npm run print-agent
# Windows PowerShell:
# $env:SERVER_URL="https://..."; $env:AGENT_KEY="..."; npm run print-agent
```

Tùy chọn: `PAPER_COLUMNS=32` cho giấy 58mm (mặc định 48 cho 80mm). Thêm máy in trong **Cài đặt → Máy in** (IP:cổng,
loại bếp / hóa đơn, danh mục in), bấm **In thử**. Máy in không hỗ trợ tiếng Việt thì bật "In không dấu".

### Hóa đơn điện tử

Hiện có chế độ **Thử nghiệm** (tạo số hóa đơn giả, không gửi cơ quan thuế) để chạy thử toàn bộ quy trình. Để dùng thật:
chọn nhà cung cấp (Viettel S-Invoice, VNPT, MISA meInvoice…), lấy tài liệu API + tài khoản test, rồi thêm adapter trong
`server/src/modules/invoices.ts` (giao diện `InvoiceProvider`). Hóa đơn lỗi được tự gửi lại mỗi 5 phút.

## Kiểm tra code

```bash
npm run typecheck   # server + print-agent
npm run lint        # 2 app
npm run build       # 2 app (kèm kiểm tra TypeScript)
```
