/** Store catalog of cosmetic items (purely visual, zero gameplay advantage). */
export interface StoreItemDef {
  id: string;
  kind: 'table_skin' | 'ball_skin' | 'uniform' | 'frame' | 'celebration';
  name: string;
  price: number;
  preview: string;
}

export const STORE_ITEMS: readonly StoreItemDef[] = [
  { id: 'skin-emerald', kind: 'table_skin', name: 'Emerald Arena', price: 400, preview: '#0f7a56' },
  { id: 'skin-neon', kind: 'table_skin', name: 'Neon Circuit', price: 650, preview: '#1e1b4b' },
  { id: 'skin-royal', kind: 'table_skin', name: 'Royal Velvet', price: 800, preview: '#3b1d52' },
  { id: 'skin-ice', kind: 'table_skin', name: 'Ice Rink', price: 550, preview: '#c7e6ff' },
  { id: 'ball-gold', kind: 'ball_skin', name: 'Golden Ball', price: 300, preview: '#f5c451' },
  { id: 'ball-flame', kind: 'ball_skin', name: 'Flame Ball', price: 450, preview: '#ff6b35' },
  { id: 'ball-star', kind: 'ball_skin', name: 'Star Ball', price: 500, preview: '#e2e8ff' },
  { id: 'kit-away', kind: 'uniform', name: 'Away Kit', price: 250, preview: '#38bdf8' },
  { id: 'kit-neon', kind: 'uniform', name: 'Neon Kit', price: 400, preview: '#a3e635' },
  { id: 'frame-gold', kind: 'frame', name: 'Gold Frame', price: 500, preview: '#f5c451' },
  { id: 'frame-flame', kind: 'frame', name: 'Flame Frame', price: 700, preview: '#ff6b35' },
  { id: 'celebration-fireworks', kind: 'celebration', name: 'Fireworks', price: 600, preview: '#f472b6' },
  { id: 'celebration-confetti', kind: 'celebration', name: 'Confetti Storm', price: 350, preview: '#38bdf8' },
] as const;
