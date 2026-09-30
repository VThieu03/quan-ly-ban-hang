import type {
  ApiError,
  CustomerTableView,
  MenuCategory,
  NewOrderRequest,
  Order,
  ServerEvent,
} from '../../shared/types.ts';

export class ApiRequestError extends Error {
  status: number;
  itemId?: string;

  constructor(status: number, body: Partial<ApiError>) {
    super(body.error ?? 'server_error');
    this.status = status;
    this.itemId = body.itemId;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!res.ok) throw new ApiRequestError(res.status, await res.json().catch(() => ({})));
  return res.status === 204 ? (undefined as T) : res.json();
}

const tablePath = (token: string) => `/api/table/${encodeURIComponent(token)}`;

export const api = {
  menu: () => request<MenuCategory[]>('/api/menu'),
  table: (token: string) => request<CustomerTableView>(tablePath(token)),
  placeOrder: (token: string, body: NewOrderRequest) =>
    request<Order>(`${tablePath(token)}/orders`, { method: 'POST', body: JSON.stringify(body) }),
  requestBill: (token: string) => request<void>(`${tablePath(token)}/bill-request`, { method: 'POST' }),
};

/** Nghe sự kiện realtime của bàn. `onChange` cũng được gọi mỗi lần kết nối lại để không lỡ cập nhật. */
export function subscribeTable(token: string, onChange: (event: ServerEvent | null) => void) {
  const source = new EventSource(`${tablePath(token)}/events`);
  source.onopen = () => onChange(null);
  source.onmessage = (e) => onChange(JSON.parse(e.data));
  return () => source.close();
}
