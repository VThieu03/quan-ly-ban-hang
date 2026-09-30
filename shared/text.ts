/** Bỏ dấu tiếng Việt (cho máy in nhiệt không hỗ trợ Unicode, nội dung chuyển khoản...). */
export function removeAccents(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}
