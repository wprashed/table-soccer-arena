/**
 * InviteModal — Share challenges, copy room links, and invite friends via
 * native Web Share API, WhatsApp, Telegram, X / Twitter, or direct link.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '../lib/store';

export interface InviteModalProps {
  open: boolean;
  onClose: () => void;
  code: string;
  matchId?: string;
  title?: string;
  subtitle?: string;
  challengeName?: string;
  onEnterRoom?: () => void;
}

export function InviteModal({
  open,
  onClose,
  code,
  matchId,
  title = 'Invite Friends to Play',
  subtitle = 'Share this room code or link to play 2v2 foosball together.',
  challengeName,
  onEnterRoom,
}: InviteModalProps) {
  const { toast } = useApp();
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  if (!open) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const pathname = typeof window !== 'undefined' ? window.location.pathname.replace(/\/$/, '') : '';
  const inviteUrl = `${origin}${pathname}/?join=${code}`;

  const shareText = challengeName
    ? `🏆 I challenge you to "${challengeName}" on Table Soccer Arena!\nCan you beat my score? Join my match now:`
    : `⚽ Join my 2v2 Foosball match on Table Soccer Arena!\nRoom Code: ${code}\nJoin here:`;

  const fullShareMessage = `${shareText}\n${inviteUrl}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedLink(true);
      toast('Invite link copied to clipboard!', 'success');
      setTimeout(() => setCopiedLink(false), 2200);
    } catch {
      toast(inviteUrl, 'info');
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      toast(`Room code ${code} copied!`, 'success');
      setTimeout(() => setCopiedCode(false), 2200);
    } catch {
      toast(code, 'info');
    }
  };

  const shareNative = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'Table Soccer Arena Challenge',
          text: shareText,
          url: inviteUrl,
        });
      } catch {
        /* user cancelled or not allowed */
      }
    } else {
      copyLink();
    }
  };

  const shareWhatsApp = () => {
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(fullShareMessage)}`;
    window.open(url, '_blank');
  };

  const shareTelegram = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent(shareText)}`;
    window.open(url, '_blank');
  };

  const shareTwitter = () => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(fullShareMessage)}`;
    window.open(url, '_blank');
  };

  const canNativeShare = typeof navigator !== 'undefined' && !!navigator.share;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94 }}
          className="glass relative w-full max-w-md overflow-hidden rounded-3xl border border-white/15 p-6 shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-400">
                {challengeName ? 'Challenge Rival' : 'Multiplayer Room'}
              </span>
              <h2 className="mt-1 text-xl font-black text-white">{title}</h2>
              <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
            </div>
            <button
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-full bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
            >
              ✕
            </button>
          </div>

          {/* Room Code Badge */}
          <div className="mt-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
            <div className="text-[10px] font-black uppercase tracking-widest text-emerald-300">Room Code</div>
            <div className="mt-1 font-mono text-3xl font-black tracking-[0.25em] text-emerald-400">
              {code}
            </div>
            <button
              onClick={copyCode}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-300 hover:bg-emerald-500/30"
            >
              {copiedCode ? '✓ Copied' : 'Copy Code Only'}
            </button>
          </div>

          {/* Direct Link Box */}
          <div className="mt-4">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Direct Invite Link
            </label>
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 p-2">
              <input
                readOnly
                value={inviteUrl}
                className="min-w-0 flex-1 bg-transparent px-1 font-mono text-xs text-slate-300 outline-none"
              />
              <button
                onClick={copyLink}
                className={`btn shrink-0 px-3 py-1.5 text-xs font-bold ${
                  copiedLink ? 'bg-emerald-500 text-emerald-950' : 'btn-primary'
                }`}
              >
                {copiedLink ? '✓ Copied' : 'Copy Link'}
              </button>
            </div>
          </div>

          {/* Social Share Buttons */}
          <div className="mt-5">
            <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
              Share directly via
            </div>
            <div className="grid grid-cols-4 gap-2">
              {canNativeShare && (
                <button
                  onClick={shareNative}
                  className="flex flex-col items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/5 p-2.5 text-center transition hover:bg-white/10 active:scale-95"
                  title="Share with friends"
                >
                  <span className="text-xl">📱</span>
                  <span className="text-[10px] font-bold text-slate-300">Share</span>
                </button>
              )}
              <button
                onClick={shareWhatsApp}
                className="flex flex-col items-center justify-center gap-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-center transition hover:bg-emerald-500/20 active:scale-95"
                title="Share on WhatsApp"
              >
                <span className="text-xl">💬</span>
                <span className="text-[10px] font-bold text-emerald-300">WhatsApp</span>
              </button>
              <button
                onClick={shareTelegram}
                className="flex flex-col items-center justify-center gap-1 rounded-xl border border-sky-500/30 bg-sky-500/10 p-2.5 text-center transition hover:bg-sky-500/20 active:scale-95"
                title="Share on Telegram"
              >
                <span className="text-xl">✈️</span>
                <span className="text-[10px] font-bold text-sky-300">Telegram</span>
              </button>
              <button
                onClick={shareTwitter}
                className="flex flex-col items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/5 p-2.5 text-center transition hover:bg-white/10 active:scale-95"
                title="Share on X"
              >
                <span className="text-xl">✖️</span>
                <span className="text-[10px] font-bold text-slate-300">X / Post</span>
              </button>
            </div>
          </div>

          {/* Bottom actions */}
          <div className="mt-6 flex gap-2">
            <button className="btn btn-ghost flex-1 py-2.5 text-xs font-bold" onClick={onClose}>
              Close
            </button>
            {onEnterRoom && (
              <button className="btn btn-primary flex-1 py-2.5 text-xs font-black" onClick={onEnterRoom}>
                Enter Match Lobby →
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
