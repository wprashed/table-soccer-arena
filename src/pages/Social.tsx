/** Friends, friend requests, recent opponents, blocking & reporting. */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { Avatar, Empty, Modal, TierPill, Spinner } from '../components/ui';
import { InviteModal } from '../components/InviteModal';
import { getSocket, request } from '../lib/socket';
import type { FriendView } from '../../shared/types';
import { navigate } from '../lib/router';

interface SocialData {
  friends: FriendView[];
  requests: { requestId: number; id: string; username: string; avatar: string; rating: number }[];
  recent: { id: string; username: string; avatar: string; rating: number; tier: string; lastPlayed: string }[];
}

export function Social() {
  const { toast, refresh } = useApp();
  const [data, setData] = useState<SocialData | null>(null);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteModalData, setInviteModalData] = useState<{ open: boolean; code: string; matchId?: string } | null>(null);
  const [report, setReport] = useState<{ id: string; username: string } | null>(null);
  const [reportReason, setReportReason] = useState('cheating');
  const [reportDetails, setReportDetails] = useState('');

  const load = () =>
    api.get<SocialData>('/friends').then(setData).catch((e) => toast(e.message, 'error'));

  useEffect(() => {
    load();
    const socket = getSocket();
    const onPresence = () => load();
    socket.on('presence', onPresence);
    return () => {
      socket.off('presence', onPresence);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFriend = async () => {
    if (!username.trim()) return;
    setBusy(true);
    try {
      await api.post('/friends/request', { username: username.trim() });
      toast('Friend request sent', 'success');
      setUsername('');
      load();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const respond = async (requestId: number, accept: boolean) => {
    try {
      await api.post('/friends/respond', { requestId, accept });
      toast(accept ? 'Friend added' : 'Request declined', 'success');
      load();
      refresh();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const remove = async (id: string) => {
    await api.del(`/friends/${id}`).catch(() => {});
    load();
  };

  const block = async (id: string) => {
    await api.post(`/users/${id}/block`).catch(() => {});
    toast('Player blocked', 'success');
    load();
  };

  const submitReport = async () => {
    if (!report) return;
    try {
      await api.post(`/users/${report.id}/report`, { reason: reportReason, details: reportDetails });
      toast('Report submitted — our moderators will review it', 'success');
      setReport(null);
      setReportDetails('');
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const invite = async (f: FriendView) => {
    try {
      const created = await request<any>('room:create', { rated: true });
      if (!created?.ok) throw new Error(created?.error ?? 'Could not create room');
      await request('room:invite', { toUserId: f.id, matchId: created.matchId });
      toast(`Invite sent to ${f.username} · room ${created.code || created.roomCode}`, 'success');
      navigate(`/match/${created.matchId}`);
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const createShareableInvite = async () => {
    setInviteBusy(true);
    try {
      const created = await request<any>('room:create', { rated: true });
      if (!created?.ok) throw new Error(created?.error ?? 'Could not create room');
      setInviteModalData({
        open: true,
        code: created.code || created.roomCode,
        matchId: created.matchId,
      });
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setInviteBusy(false);
    }
  };

  if (!data) {
    return (
      <div className="grid place-items-center py-20">
        <Spinner size={26} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black">Friends & Invites</h1>
          <p className="text-xs text-slate-400">Invite friends to private rooms, share match links, or compare ratings.</p>
        </div>
        <button
          onClick={createShareableInvite}
          disabled={inviteBusy}
          className="btn btn-primary inline-flex items-center gap-2 self-start py-2 sm:self-auto"
        >
          {inviteBusy ? <Spinner size={16} /> : '📤'} Invite via Link / Social
        </button>
      </div>

      <div className="glass rounded-2xl p-4">
        <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">
          Add a player by username
        </label>
        <div className="flex gap-2">
          <input
            className="input"
            placeholder="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addFriend()}
          />
          <button className="btn btn-primary px-4" onClick={addFriend} disabled={busy}>
            {busy ? <Spinner size={16} /> : 'Add'}
          </button>
        </div>
      </div>

      {data.requests.length > 0 && (
        <div className="glass rounded-2xl p-4">
          <h2 className="mb-2 text-sm font-black uppercase tracking-widest text-slate-300">
            Requests ({data.requests.length})
          </h2>
          <div className="space-y-2">
            {data.requests.map((r) => (
              <div key={r.requestId} className="flex items-center gap-2 rounded-xl bg-white/[0.05] p-2">
                <Avatar emoji={r.avatar} size={30} />
                <div className="flex-1">
                  <div className="text-sm font-bold">{r.username}</div>
                  <div className="text-[10px] text-slate-500">{r.rating} rating</div>
                </div>
                <button className="btn btn-primary px-3 py-1 text-xs" onClick={() => respond(r.requestId, true)}>
                  Accept
                </button>
                <button className="btn btn-ghost px-3 py-1 text-xs" onClick={() => respond(r.requestId, false)}>
                  Decline
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="glass rounded-2xl p-4">
          <h2 className="mb-2 text-sm font-black uppercase tracking-widest text-slate-300">
            Friends ({data.friends.length})
          </h2>
          {data.friends.length === 0 ? (
            <Empty icon="👥" title="No friends yet" hint="Search a username above" />
          ) : (
            <div className="space-y-1.5">
              {data.friends.map((f) => (
                <div key={f.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-white/[0.05]">
                  <div className="relative">
                    <Avatar emoji={f.avatar} size={32} />
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-ink-900 ${
                        f.online ? 'bg-emerald-400' : 'bg-slate-600'
                      }`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">{f.username}</div>
                    <div className="flex items-center gap-1 text-[10px] text-slate-500">
                      {f.rating} · <TierPill rating={f.rating} />
                    </div>
                  </div>
                  <button className="btn btn-primary px-2.5 py-1 text-[11px]" onClick={() => invite(f)}>
                    Invite
                  </button>
                  <button
                    className="btn btn-ghost h-9 w-9 !p-0 text-[13px]"
                    onClick={() => remove(f.id)}
                    title="Remove friend"
                    aria-label={`Remove ${f.username}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="glass rounded-2xl p-4">
          <h2 className="mb-2 text-sm font-black uppercase tracking-widest text-slate-300">Recent opponents</h2>
          {data.recent.length === 0 ? (
            <Empty icon="🎮" title="No recent opponents" />
          ) : (
            <div className="space-y-1.5">
              {data.recent.map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-white/[0.05]">
                  <Avatar emoji={r.avatar} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">{r.username}</div>
                    <div className="text-[10px] text-slate-500">{r.rating} rating</div>
                  </div>
                  <button
                    className="btn btn-ghost px-2 py-1 text-[10px]"
                    onClick={() => api.post('/friends/request', { username: r.username }).then(() => toast('Request sent', 'success')).catch((e) => toast(e.message, 'error'))}
                  >
                    Add
                  </button>
                  <button className="btn btn-ghost px-2 py-1 text-[10px]" onClick={() => block(r.id)}>
                    Block
                  </button>
                  <button className="btn btn-ghost px-2 py-1 text-[10px]" onClick={() => setReport(r)}>
                    Report
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal open={!!report} onClose={() => setReport(null)} title={`Report ${report?.username ?? ''}`}>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Reason</label>
            <select className="input" value={reportReason} onChange={(e) => setReportReason(e.target.value)}>
              <option value="cheating">Cheating / exploiting</option>
              <option value="abuse">Abusive chat</option>
              <option value="collusion">Match collusion</option>
              <option value="inappropriate_name">Inappropriate name</option>
              <option value="other">Other</option>
            </select>
          </div>
          <textarea
            className="input min-h-[90px]"
            placeholder="What happened?"
            value={reportDetails}
            maxLength={500}
            onChange={(e) => setReportDetails(e.target.value)}
          />
          <button className="btn btn-flame w-full py-2.5" onClick={submitReport}>
            Submit report
          </button>
        </div>
      </Modal>

      {inviteModalData && (
        <InviteModal
          open={inviteModalData.open}
          onClose={() => setInviteModalData(null)}
          code={inviteModalData.code}
          matchId={inviteModalData.matchId}
          title="Invite Friends to 2v2 Match"
          subtitle="Share your link or code directly to play foosball together."
          onEnterRoom={
            inviteModalData.matchId ? () => navigate(`/match/${inviteModalData.matchId}`) : undefined
          }
        />
      )}
    </div>
  );
}
