/** /join/:code — invitation links land here. */
import { useEffect, useState } from 'react';
import { request } from '../lib/socket';
import { navigate } from '../lib/router';
import { Spinner } from '../components/ui';
import { useApp } from '../lib/store';

export function JoinRoom({ code }: { code: string }) {
  const { toast, profile } = useApp();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    const tryJoin = async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const res = await request<any>('room:join', { code });
          if (res?.ok) {
            if (!cancelled) navigate(`/match/${res.matchId}`);
            return;
          }
          setError(res?.error ?? 'Could not join that room');
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 700));
        }
      }
      setError('Could not reach the server');
    };
    tryJoin();
    return () => {
      cancelled = true;
    };
  }, [code, profile, toast]);

  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="glass w-full max-w-sm rounded-2xl p-6 text-center">
        <div className="text-3xl">🔒</div>
        <div className="mt-2 text-lg font-black">Joining room {code}</div>
        {error ? (
          <>
            <p className="mt-1 text-xs text-rose-300">{error}</p>
            <button className="btn btn-primary mt-3 w-full py-2.5" onClick={() => navigate('/')}>
              Back to dashboard
            </button>
          </>
        ) : (
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-400">
            <Spinner size={16} /> Connecting…
          </div>
        )}
      </div>
    </div>
  );
}
