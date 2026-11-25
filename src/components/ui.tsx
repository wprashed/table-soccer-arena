/** Reusable UI atoms: rank badge, avatar, stat pills, modal, toast host. */
import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { tierFor, TIERS } from '../../shared/rating';
import { useApp } from '../lib/store';

const TIER_GRADIENTS: Record<string, string> = {
  Bronze: 'linear-gradient(135deg,#c8804f,#7c4522)',
  Silver: 'linear-gradient(135deg,#dbe4ee,#8b95a1)',
  Gold: 'linear-gradient(135deg,#ffe08a,#b8860b)',
  Platinum: 'linear-gradient(135deg,#8ff5e9,#1f9e91)',
  Diamond: 'linear-gradient(135deg,#b3d4ff,#2a6fd6)',
  Master: 'linear-gradient(135deg,#e0b8ff,#7c3aed)',
  Legend: 'linear-gradient(135deg,#ffb37a,#e11d48)',
};

/**
 * Rank badge drawn as inline SVG (no emoji font dependency) so it looks
 * identical on every platform, including Linux browsers without a colour emoji
 * font: a tier-coloured shield with the tier initial and a chevron count.
 */
export function RankBadge({ rating, size = 'md' }: { rating: number; size?: 'sm' | 'md' | 'lg' }) {
  const tier = tierFor(rating);
  const px = size === 'sm' ? 28 : size === 'lg' ? 56 : 40;
  const tierIndex = TIERS.findIndex((t) => t.tier === tier.tier);
  const chevrons = Math.max(1, Math.min(3, Math.ceil((tierIndex + 1) / 2.4)));
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 64 64"
      className="shrink-0"
      role="img"
      aria-label={`${tier.tier} rank`}
      style={{ filter: `drop-shadow(0 6px 14px ${tier.color}55)` }}
    >
      <defs>
        <linearGradient id={`rb-${tier.tier}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={tier.color} />
          <stop offset="100%" stopColor={tier.color2} />
        </linearGradient>
      </defs>
      <path
        d="M32 3 56 11v20c0 14-10 25-24 30C18 56 8 45 8 31V11L32 3Z"
        fill={`url(#rb-${tier.tier})`}
        stroke="rgba(255,255,255,.55)"
        strokeWidth="2"
      />
      <path d="M32 3 56 11v20c0 14-10 25-24 30" fill="rgba(255,255,255,.13)" />
      <text
        x="32"
        y="38"
        textAnchor="middle"
        fontSize="24"
        fontWeight="900"
        fill="#08111d"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {tier.tier[0]}
      </text>
      {Array.from({ length: chevrons }).map((_, i) => (
        <circle key={i} cx={32 + (i - (chevrons - 1) / 2) * 9} cy="47" r="2.4" fill="rgba(8,17,29,.55)" />
      ))}
    </svg>
  );
}

export function TierPill({ rating }: { rating: number }) {
  const tier = tierFor(rating);
  return (
    <span
      className="chip"
      style={{ background: `${tier.color}22`, color: tier.color, border: `1px solid ${tier.color}55` }}
    >
      <svg width="11" height="11" viewBox="0 0 64 64" aria-hidden="true">
        <path d="M32 3 56 11v20c0 14-10 25-24 30C18 56 8 45 8 31V11L32 3Z" fill={tier.color} />
      </svg>
      {tier.tier}
    </span>
  );
}

export function Avatar({
  emoji,
  size = 40,
  frame,
  className = '',
}: {
  emoji: string;
  size?: number;
  frame?: string;
  className?: string;
}) {
  const border =
    frame === 'frame-gold' ? '#f5c451' : frame === 'frame-flame' ? '#ff6b35' : 'rgba(130,170,230,0.35)';
  const glow =
    frame === 'frame-gold'
      ? '0 0 0 3px rgba(245,196,81,.18)'
      : frame === 'frame-flame'
      ? '0 0 0 3px rgba(255,107,53,.18)'
      : 'none';
  return (
    <div
      className={`grid shrink-0 place-items-center rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.5),
        lineHeight: 1,
        background: 'linear-gradient(160deg,#22334c,#0b1220)',
        border: `2px solid ${border}`,
        boxShadow: glow,
      }}
      title={undefined}
    >
      <span style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.5))' }}>{emoji || '⚽'}</span>
    </div>
  );
}

export function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: string }) {
  return (
    <div className="glass-soft rounded-xl px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-slate-400">{label}</div>
      <div className="text-lg font-black" style={{ color: accent ?? '#e8eefc' }}>
        {value}
      </div>
    </div>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <span
      className="spin-slow inline-block rounded-full border-2 border-white/20 border-t-white/80"
      style={{ width: size, height: size }}
    />
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  width?: string;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ y: 18, scale: 0.97, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 10, scale: 0.98, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            className={`glass relative w-full ${width} max-h-[88vh] overflow-y-auto scroll-thin rounded-2xl p-5`}
          >
            {title && (
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-black">{title}</h3>
                <button className="btn btn-ghost h-8 w-8 !p-0 text-lg" onClick={onClose} aria-label="Close">
                  ×
                </button>
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ToastHost() {
  const { toasts, dismiss } = useApp();
  return (
    <div
      className="pointer-events-none fixed left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col-reverse gap-2 px-3"
      style={{ bottom: 'calc(4.75rem + env(safe-area-inset-bottom))' }}
    >
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto rounded-xl px-4 py-3 text-left text-sm font-semibold shadow-2xl backdrop-blur ${
              t.kind === 'error'
                ? 'bg-rose-500/90 text-white'
                : t.kind === 'success'
                ? 'bg-emerald-500/90 text-emerald-950'
                : 'bg-slate-800/90 text-slate-100'
            }`}
          >
            {t.message}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="scroll-thin flex gap-1 overflow-x-auto rounded-xl bg-black/30 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-[40px] shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold transition ${
            value === o.value ? 'bg-emerald-500 text-emerald-950' : 'text-slate-300 hover:bg-white/5'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="grid place-items-center gap-1 rounded-xl border border-dashed border-white/10 py-8 text-center">
      <div className="text-3xl opacity-60">{icon}</div>
      <div className="font-bold text-slate-300">{title}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  );
}
