/** Private-room lobby: share code/link, invite friends, fill with bots, start. */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { request } from '../lib/socket';
import { useApp } from '../lib/store';
import { Avatar, Spinner } from '../components/ui';
import { InviteModal } from '../components/InviteModal';
import type { MatchView } from '../../shared/types';
import { sfx } from '../lib/sfx';

export function LobbyPanel({
  view,
  mySlot,
  onExit,
}: {
  view: MatchView;
  mySlot: number | null;
  onExit: () => void;
}) {
  const { profile, toast } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [friends, setFriends] = useState<{ id: string; username: string; avatar: string; online: boolean }[]>([]);
  const [invited, setInvited] = useState<string[]>([]);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  const code = (view as any).roomCode ?? '';
  const isHost = mySlot === 0;
  const seats = [0, 1, 2, 3];
  const all = [...view.teamA, ...view.teamB];
  const filled = all.length;

  useEffect(() => {
    api
      .get<{ friends: any[] }>('/friends')
      .then((d) => setFriends(d.friends))
      .catch(() => {});
  }, []);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label} copied`, 'success');
    } catch {
      toast(text, 'info');
    }
  };

  const addBot = async (slot: number) => {
    setBusy(`bot${slot}`);
    try {
      const res = await request<any>('room:add-bot', { matchId: view.id, slot });
      if (!res?.ok) throw new Error(res?.error ?? 'Could not add bot');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const invite = async (friendId: string) => {
    setBusy(`inv${friendId}`);
    try {
      const res = await request<any>('room:invite', { matchId: view.id, toUserId: friendId });
      if (!res?.ok) throw new Error(res?.error ?? 'Could not invite');
      setInvited((i) => [...i, friendId]);
      toast('Invitation sent', 'success');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    setBusy('start');
    sfx.whistle();
    try {
      const res = await request<any>('room:start', { matchId: view.id });
      if (!res?.ok) throw new Error(res?.error ?? 'Could not start');
    } catch (e: any) {
      toast(e.message, 'error');
      setBusy(null);
    }
  };

  const seatLabel = (slot: number) => (slot === 0 || slot === 2 ? '🛡️ Defence (Goalie & 2-bar)' : '⚽ Striker (Midfield & 3-bar)');

  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-black/70 p-3 backdrop-blur-sm">
      <div className="glass w-full max-w-lg rounded-2xl p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-black">Private room</div>
            <div className="text-[11px] text-slate-400">
              {isHost ? 'You are the host — start when four seats are filled.' : 'Waiting for the host to start…'}
            </div>
          </div>
          <button className="btn btn-ghost h-8 px-2 text-xs" onClick={onExit}>
            Leave
          </button>
        </div>

        {/* room code & share options */}
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <button
            onClick={() => copy(code, 'Room code')}
            className="glass-soft flex items-center justify-between rounded-xl px-3 py-2 text-left hover:border-emerald-400/50"
          >
            <div>
              <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Room code</div>
              <div className="font-mono text-xl font-black tracking-[0.25em] text-emerald-300">{code}</div>
            </div>
            <span className="text-xs text-slate-500">copy</span>
          </button>
          <button
            onClick={() => {
              const origin = typeof window !== 'undefined' ? window.location.origin : '';
              const pathname = typeof window !== 'undefined' ? window.location.pathname.replace(/\/$/, '') : '';
              copy(`${origin}${pathname}/?join=${code}`, 'Invite link');
            }}
            className="glass-soft flex items-center justify-between rounded-xl px-3 py-2 text-left hover:border-emerald-400/50"
          >
            <div>
              <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Invite link</div>
              <div className="truncate text-xs font-bold text-slate-300">/?join={code}</div>
            </div>
            <span className="text-xs text-slate-500">copy</span>
          </button>
          <button
            onClick={() => setShareModalOpen(true)}
            className="glass-soft flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-left hover:bg-emerald-500/20 active:scale-95 sm:col-span-1"
          >
            <div>
              <div className="text-[9px] font-black uppercase tracking-widest text-emerald-400">Share with friends</div>
              <div className="text-xs font-black text-white">📱 WhatsApp, X…</div>
            </div>
            <span className="text-xs text-emerald-300">📤</span>
          </button>
        </div>

        {/* seats */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          {(['A', 'B'] as const).map((team) => (
            <div key={team} className="glass-soft rounded-xl p-2">
              <div
                className={`mb-1 text-[9px] font-black uppercase tracking-widest ${
                  team === 'A' ? 'text-blue-400' : 'text-rose-400'
                }`}
              >
                Team {team}
              </div>
              {seats
                .filter((s) => (team === 'A' ? s < 2 : s >= 2))
                .map((slot) => {
                  const player = all.find((p) => p.slot === slot);
                  const teamSlot = team === 'A' ? (slot === 0 ? 0 : 1) : slot === 2 ? 0 : 1;
                  return (
                    <div key={slot} className="mb-1 flex items-center gap-2 rounded-lg px-1 py-1">
                      {player ? (
                        <>
                          <Avatar emoji={player.avatar} size={24} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[11px] font-bold">
                              {player.username}
                              {player.slot === mySlot && <span className="text-emerald-400"> (you)</span>}
                            </div>
                            <div className="text-[9px] text-slate-500">{seatLabel(slot)}</div>
                          </div>
                          {isHost && player.slot !== mySlot && (
                            <button
                              className="btn btn-ghost px-1.5 py-0.5 text-[9px]"
                              onClick={() => request('room:leave', { matchId: view.id })}
                              title="Remove"
                            >
                              ✕
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="grid h-6 w-6 place-items-center rounded-full border border-dashed border-white/20 text-[10px] text-slate-600">
                            {teamSlot + 1}
                          </div>
                          <div className="flex-1 text-[10px] text-slate-500">Open · {seatLabel(slot)}</div>
                          {isHost && (
                            <button
                              className="btn btn-ghost px-1.5 py-0.5 text-[9px]"
                              onClick={() => addBot(slot)}
                              disabled={busy === `bot${slot}`}
                            >
                              {busy === `bot${slot}` ? '…' : '+ bot'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>

        {/* friends */}
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Invite a friend</span>
            <span className="text-[9px] text-slate-600">{filled}/4 seated</span>
          </div>
          <div className="scroll-thin flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
            {friends.length === 0 && <span className="text-[10px] text-slate-500">No friends online yet.</span>}
            {friends.map((f) => (
              <button
                key={f.id}
                onClick={() => invite(f.id)}
                disabled={invited.includes(f.id) || busy === `inv${f.id}`}
                className="btn btn-ghost px-2 py-1 text-[10px]"
              >
                <Avatar emoji={f.avatar} size={14} />
                {invited.includes(f.id) ? `${f.username} ✓` : f.username}
              </button>
            ))}
          </div>
        </div>

        {/* actions */}
        <div className="mt-4 flex items-center gap-2">
          {isHost ? (
            <button
              className="btn btn-primary flex-1 py-2.5"
              onClick={start}
              disabled={filled < 4 || busy === 'start'}
            >
              {busy === 'start' ? <Spinner size={16} /> : filled < 4 ? `Need ${4 - filled} more player${4 - filled === 1 ? '' : 's'}` : 'Start match'}
            </button>
          ) : (
            <div className="flex-1 text-center text-xs text-slate-400">
              <Spinner size={14} /> Waiting for the host…
            </div>
          )}
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          Tip: open the invite link in another browser or incognito window to seat a second player, or
          press <b>+ bot</b> to fill empty seats (bot partners make the match unrated).
        </p>
      </div>

      <InviteModal
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        code={code}
        matchId={view.id}
        title="Invite Players to Lobby"
        subtitle="Send this link to friends so they can join your 2v2 foosball match directly."
      />
    </div>
  );
}
