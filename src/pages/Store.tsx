/** Cosmetic store — every item is purely visual (no gameplay advantage). */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { Spinner } from '../components/ui';
import { sfx } from '../lib/sfx';

interface StoreItem {
  id: string;
  kind: string;
  name: string;
  price: number;
  preview: string;
}

const KIND_LABEL: Record<string, string> = {
  table_skin: 'Table skins',
  ball_skin: 'Balls',
  uniform: 'Uniforms',
  frame: 'Avatar frames',
  celebration: 'Victory celebrations',
};

export function Store() {
  const { toast, refresh, user } = useApp();
  const [data, setData] = useState<{
    items: StoreItem[];
    coins: number;
    equipped: Record<string, string>;
    owned: string[];
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    api
      .get<any>('/store')
      .then(setData)
      .catch((e) => toast(e.message, 'error'));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buy = async (item: StoreItem) => {
    setBusy(item.id);
    try {
      const owned = data?.owned.includes(item.id);
      const res = await api.post<{ charged: boolean }>(owned ? '/store/equip' : '/store/buy', { itemId: item.id });
      if (!owned) sfx.coin();
      toast(owned ? `${item.name} equipped` : `${item.name} purchased and equipped`, 'success');
      await load();
      refresh();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!data)
    return (
      <div className="grid place-items-center py-20">
        <Spinner size={26} />
      </div>
    );

  const grouped = Object.keys(KIND_LABEL).map((kind) => ({
    kind,
    items: data.items.filter((i) => i.kind === kind),
  }));

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-black">Locker room</h1>
          <p className="text-xs text-slate-400">Cosmetics only — nothing here changes gameplay.</p>
        </div>
        <div className="rounded-xl bg-amber-400/15 px-3 py-2 text-sm font-black text-amber-300">
          🪙 {user?.coins ?? data.coins}
        </div>
      </div>

      {grouped.map((g) => (
        <section key={g.kind}>
          <h2 className="mb-2 text-xs font-black uppercase tracking-widest text-slate-400">{KIND_LABEL[g.kind]}</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map((item) => {
              const equipped = data.equipped[g.kind] === item.id;
              const owned = data.owned.includes(item.id);
              const affordable = owned || (user?.coins ?? data.coins) >= item.price;
              return (
                <div key={item.id} className={`glass card-hover rounded-xl p-3 ${equipped ? 'ring-1 ring-emerald-400/60' : ''}`}>
                  <div className="flex items-center gap-3">
                    <div
                      className="h-12 w-12 shrink-0 rounded-lg border border-white/15"
                      style={{ background: item.preview }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold">{item.name}</div>
                      <div className="text-[11px] text-amber-300">🪙 {item.price}</div>
                    </div>
                  </div>
                  <button
                    className={`btn mt-2 w-full py-1.5 text-xs ${equipped || !affordable ? 'btn-ghost' : 'btn-primary'}`}
                    disabled={equipped || busy === item.id || !affordable}
                    onClick={() => buy(item)}
                  >
                    {busy === item.id ? (
                      <Spinner size={14} />
                    ) : equipped ? (
                      'Equipped ✓'
                    ) : owned ? (
                      'Equip'
                    ) : affordable ? (
                      'Buy & equip'
                    ) : (
                      `Need ${item.price - (user?.coins ?? data.coins)} more 🪙`
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
