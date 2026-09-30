import type { Lang, OrderStatus } from '../../shared/types.ts';

export const texts = {
  appTitle: { vi: 'K-BBQ', en: 'K-BBQ', ko: 'K-BBQ', zh: 'K-BBQ', ja: 'K-BBQ' },
  cartTitle: { vi: 'Giỏ hàng', en: 'Cart', ko: '장바구니', zh: '购物车', ja: 'カート' },
  viewCart: { vi: 'Xem giỏ hàng', en: 'View cart', ko: '장바구니 보기', zh: '查看购物车', ja: 'カートを見る' },
  itemsCount: { vi: 'món', en: 'items', ko: '개', zh: '件', ja: '点' },
  historyBtn: { vi: 'Đã gọi', en: 'Ordered', ko: '주문 내역', zh: '已点', ja: '注文履歴' },
  emptyCart: { vi: 'Chưa có món nào', en: 'Cart is empty', ko: '장바구니가 비어 있습니다', zh: '购物车是空的', ja: 'カートは空です' },
  total: { vi: 'Tổng tiền', en: 'Total', ko: '합계', zh: '总计', ja: '合計' },
  notePlaceholder: {
    vi: 'Ghi chú cho bếp (không bắt buộc)',
    en: 'Note for the kitchen (optional)',
    ko: '주방 요청사항 (선택)',
    zh: '给厨房的备注（可选）',
    ja: '厨房へのメモ（任意）',
  },
  orderBtn: { vi: 'Gọi món', en: 'Place order', ko: '주문하기', zh: '下单', ja: '注文する' },
  sending: { vi: 'Đang gửi...', en: 'Sending...', ko: '전송 중...', zh: '发送中...', ja: '送信中...' },
  soldOut: { vi: 'Hết món', en: 'Sold out', ko: '품절', zh: '已售罄', ja: '売り切れ' },
  successTitle: { vi: 'Đã gửi vào Bếp!', en: 'Sent to Kitchen!', ko: '주방으로 전송되었습니다!', zh: '已发送至厨房！', ja: '厨房に送信されました！' },
  successDesc: {
    vi: 'Món ăn của bạn đang được chuẩn bị. Vui lòng đợi trong giây lát.',
    en: 'Your food is being prepared. Please wait a moment.',
    ko: '음식이 준비 중입니다. 잠시만 기다려주세요.',
    zh: '您的食物正在准备中，请稍候。',
    ja: '料理を準備しています。少々お待ちください。',
  },
  historyTitle: { vi: 'Món đã gọi', en: 'Your orders', ko: '주문 내역', zh: '已点菜品', ja: '注文履歴' },
  historyEmpty: { vi: 'Bàn chưa gọi món nào.', en: 'No orders yet.', ko: '아직 주문이 없습니다.', zh: '还没有点菜。', ja: 'まだ注文がありません。' },
  orderNumber: { vi: 'Lần gọi #', en: 'Order #', ko: '주문 #', zh: '第 # 次', ja: '注文 #' },
  subtotal: { vi: 'Tạm tính', en: 'Subtotal', ko: '소계', zh: '小计', ja: '小計' },
  requestBill: { vi: 'Gọi thanh toán', en: 'Request the bill', ko: '계산 요청', zh: '请求结账', ja: 'お会計をお願いする' },
  billRequested: {
    vi: 'Đã gọi thanh toán, nhân viên sẽ đến ngay.',
    en: 'Bill requested, staff will be with you shortly.',
    ko: '계산을 요청했습니다. 곧 직원이 옵니다.',
    zh: '已请求结账，服务员马上就到。',
    ja: 'お会計を依頼しました。スタッフがすぐに参ります。',
  },
  close: { vi: 'Đóng', en: 'Close', ko: '닫기', zh: '关闭', ja: '閉じる' },
  retry: { vi: 'Thử lại', en: 'Retry', ko: '다시 시도', zh: '重试', ja: '再試行' },
  loading: { vi: 'Đang tải...', en: 'Loading...', ko: '로딩 중...', zh: '加载中...', ja: '読み込み中...' },
  noTableTitle: { vi: 'Vui lòng quét mã QR tại bàn', en: 'Please scan the QR code on your table', ko: '테이블의 QR 코드를 스캔해 주세요', zh: '请扫描桌上的二维码', ja: 'テーブルのQRコードを読み取ってください' },
  noTableDesc: {
    vi: 'Mã bàn không hợp lệ hoặc đã thay đổi.',
    en: 'The table code is invalid or has changed.',
    ko: '테이블 코드가 올바르지 않거나 변경되었습니다.',
    zh: '桌号无效或已更改。',
    ja: 'テーブルコードが無効か、変更されています。',
  },
  closedTitle: { vi: 'Bàn chưa được mở', en: 'This table is not open yet', ko: '테이블이 아직 열리지 않았습니다', zh: '该桌尚未开台', ja: 'このテーブルはまだ開いていません' },
  closedDesc: {
    vi: 'Vui lòng gọi nhân viên để mở bàn trước khi gọi món.',
    en: 'Please ask our staff to open the table before ordering.',
    ko: '주문하기 전에 직원에게 테이블을 열어 달라고 요청해 주세요.',
    zh: '点菜前请请服务员开台。',
    ja: 'ご注文の前にスタッフにテーブルを開けてもらってください。',
  },
  thanksTitle: { vi: 'Cảm ơn quý khách!', en: 'Thank you!', ko: '감사합니다!', zh: '谢谢光临！', ja: 'ありがとうございました！' },
  thanksDesc: { vi: 'Hẹn gặp lại quý khách.', en: 'We hope to see you again.', ko: '또 방문해 주세요.', zh: '欢迎再次光临。', ja: 'またのお越しをお待ちしております。' },
  errorGeneric: {
    vi: 'Có lỗi xảy ra, vui lòng thử lại hoặc gọi nhân viên.',
    en: 'Something went wrong. Please try again or call our staff.',
    ko: '오류가 발생했습니다. 다시 시도하거나 직원을 불러주세요.',
    zh: '出错了，请重试或呼叫服务员。',
    ja: 'エラーが発生しました。もう一度お試しいただくか、スタッフをお呼びください。',
  },
  errorUnavailable: {
    vi: 'Có món vừa hết, đã bỏ khỏi giỏ hàng. Vui lòng kiểm tra lại.',
    en: 'An item just sold out and was removed from your cart. Please check again.',
    ko: '품절된 메뉴가 장바구니에서 삭제되었습니다. 다시 확인해 주세요.',
    zh: '有菜品刚售罄，已从购物车移除，请再次确认。',
    ja: '売り切れた商品をカートから削除しました。もう一度ご確認ください。',
  },
} satisfies Record<string, Record<Lang, string>>;

export type TextKey = keyof typeof texts;

export const statusTexts: Record<OrderStatus, Record<Lang, string>> = {
  new: { vi: 'Đã gửi', en: 'Sent', ko: '접수됨', zh: '已发送', ja: '送信済み' },
  preparing: { vi: 'Đang làm', en: 'Preparing', ko: '준비 중', zh: '制作中', ja: '調理中' },
  served: { vi: 'Đã lên món', en: 'Served', ko: '서빙 완료', zh: '已上菜', ja: '提供済み' },
  cancelled: { vi: 'Đã hủy', en: 'Cancelled', ko: '취소됨', zh: '已取消', ja: 'キャンセル' },
};

export function translator(lang: Lang) {
  return (key: TextKey) => texts[key][lang];
}

export type Translate = ReturnType<typeof translator>;
