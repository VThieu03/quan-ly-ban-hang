import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorText } from '../api.ts';

type Props = { onLogin: (token: string) => void };

export function LoginScreen({ onLogin }: Props) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { token } = await api.login(pin);
      onLogin(token);
    } catch (err) {
      setError(errorText(err));
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-3xl shadow-xl p-8 w-full max-w-sm space-y-5">
        <div className="text-center">
          <div className="text-5xl mb-2">🔥</div>
          <h1 className="text-2xl font-bold text-gray-800">K-BBQ – Quản lý bàn</h1>
          <p className="text-gray-500">Nhập mã PIN nhân viên</p>
        </div>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="w-full text-center text-3xl tracking-[0.5em] border-2 border-gray-200 rounded-xl p-3 focus:outline-none focus:border-red-500"
        />
        {error && <p className="text-red-600 text-center">{error}</p>}
        <button
          disabled={!pin || loading}
          className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white font-bold text-lg py-3 rounded-xl"
        >
          {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
        </button>
      </form>
    </div>
  );
}
