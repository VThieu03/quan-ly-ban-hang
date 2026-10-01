/** Thu nhỏ ảnh còn tối đa `maxWidth` px và nén JPEG để tải nhanh trên điện thoại khách. */
export async function resizeImage(file: File, maxWidth = 800): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

/** Đổi chỗ phần tử thứ i với phần tử kế bên (lên: -1, xuống: +1). */
export function moveItem<T>(list: T[], index: number, delta: -1 | 1): T[] | null {
  const target = index + delta;
  if (target < 0 || target >= list.length) return null;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
