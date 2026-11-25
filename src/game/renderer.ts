/**
 * Canvas renderer for the foosball table.
 *
 * The table is drawn in a tilted pseudo-3D projection: the playing surface is a
 * trapezoid, figures are extruded cylinders with shading, and the ball gets a
 * shadow plus a raised highlight — cheap, but reads as a real table.
 * Everything is scaled from TABLE constants so physics and visuals always agree.
 */
import { BALL, FIGURE, TABLE, ROD_SPECS, TEAM_GOAL_X, type Team } from '../../shared/engine/constants';

export interface RenderColors {
  surface: string;
  surfaceDark: string;
  surfaceLine: string;
  rail: string;
  railDark: string;
  teamA: string;
  teamA2: string;
  teamB: string;
  teamB2: string;
  ball: string;
  ballAccent: string;
}

export const TABLE_SKINS: Record<string, { name: string; colors: RenderColors }> = {
  'classic-green': {
    name: 'Classic Green',
    colors: {
      surface: '#1e7d52', surfaceDark: '#14603e', surfaceLine: 'rgba(255,255,255,0.13)',
      rail: '#6b3f22', railDark: '#40230f', teamA: '#3b82f6', teamA2: '#1d4ed8',
      teamB: '#ef4444', teamB2: '#b91c1c', ball: '#f8fafc', ballAccent: '#0f172a',
    },
  },
  'skin-emerald': {
    name: 'Emerald Arena',
    colors: {
      surface: '#0f7a56', surfaceDark: '#084d37', surfaceLine: 'rgba(190,255,225,0.16)',
      rail: '#0c2b22', railDark: '#06170f', teamA: '#22d3ee', teamA2: '#0e7490',
      teamB: '#a3e635', teamB2: '#4d7c0f', ball: '#ffffff', ballAccent: '#065f46',
    },
  },
  'skin-neon': {
    name: 'Neon Circuit',
    colors: {
      surface: '#161a3d', surfaceDark: '#0b0d24', surfaceLine: 'rgba(129,140,248,0.35)',
      rail: '#241f47', railDark: '#100d24', teamA: '#22d3ee', teamA2: '#0891b2',
      teamB: '#f472b6', teamB2: '#be185d', ball: '#fef9c3', ballAccent: '#7c3aed',
    },
  },
  'skin-royal': {
    name: 'Royal Velvet',
    colors: {
      surface: '#3b1d52', surfaceDark: '#25103a', surfaceLine: 'rgba(233,213,255,0.2)',
      rail: '#150a1f', railDark: '#0a0510', teamA: '#fbbf24', teamA2: '#b45309',
      teamB: '#e879f9', teamB2: '#a21caf', ball: '#fdf4ff', ballAccent: '#581c87',
    },
  },
  'skin-ice': {
    name: 'Ice Rink',
    colors: {
      surface: '#c7e6ff', surfaceDark: '#93c5fd', surfaceLine: 'rgba(30,64,175,0.28)',
      rail: '#1e3a8a', railDark: '#0f1f4a', teamA: '#1d4ed8', teamA2: '#1e3a8a',
      teamB: '#dc2626', teamB2: '#991b1b', ball: '#0f172a', ballAccent: '#f8fafc',
    },
  },
};

export const BALL_SKINS: Record<string, { name: string; color: string; accent: string; pattern: 'classic' | 'star' | 'flame' }> = {
  'classic-ball': { name: 'Classic', color: '#f8fafc', accent: '#0f172a', pattern: 'classic' },
  'ball-gold': { name: 'Golden Ball', color: '#f5c451', accent: '#8a5a00', pattern: 'star' },
  'ball-flame': { name: 'Flame Ball', color: '#ff6b35', accent: '#7c2d12', pattern: 'flame' },
  'ball-star': { name: 'Star Ball', color: '#e2e8ff', accent: '#4338ca', pattern: 'star' },
};

export interface ProjectBox {
  /** origin of the table box */
  ox: number;
  oy: number;
  /** size of the table box */
  w: number;
  h: number;
  /**
   * Horizontal margin reserved at each end for the goal boxes and end rails.
   * Without it the pitch would fill the whole box and the nets would have to be
   * drawn outside the cabinet, which looks broken.
   */
  insetX?: number;
}

export interface RenderState {
  rods: Array<{ slide: number; angle: number }>;
  /** vx/vz in table units per second; spin is derived from them for the ball */
  ball: { x: number; z: number; lift: number; vx?: number; vz?: number };
  score: { A: number; B: number };
  teamA: { color: string; color2: string };
  teamB: { color: string; color2: string };
  controlledSlots: number[];
  mySlot: number | null;
  highlightRods: number[];
  /** 0..1 kick wind-up, used for the aim guide */
  windup?: number;
  /** which way the player is leaning the shot */
  aimZ?: number;
  myTeam?: Team | null;
  /** 0..1 flash used when a goal is scored */
  goalFlash?: number;
}

/** Perspective helpers. */
function project(x: number, z: number, w: number, h: number) {
  return projectIn(x, z, { ox: 0, oy: 0, w, h });
}

/**
 * Projection inside an explicit letterboxed box.
 *
 * This is a proper perspective projection rather than a linear squash: the far
 * edge of the table is both shorter *and* its rows are closer together, exactly
 * as they would be if you stood at the near end of a real cabinet. A single
 * vanishing point handles both, which is why the table now reads as a solid
 * object instead of a trapezoid sticker.
 */
function projectIn(x: number, z: number, box: ProjectBox) {
  const { w, h, ox, oy } = box;
  const insetX = box.insetX ?? 0;
  // z = -halfWidth is the FAR edge, z = +halfWidth is the NEAR edge
  const sz = z / TABLE.halfWidth; // -1 far .. +1 near
  // perspective foreshortening: far things are smaller and squeezed together
  // `sz` runs -1 (far) .. +1 (near). Things further away are *smaller*, so the
  // scale must fall as sz decreases — mapping sz through this line gives the
  // far edge `FAR_SCALE` of the near edge's width.
  const FAR_SCALE = 0.80;
  const scale = FAR_SCALE + ((sz + 1) / 2) * (1 - FAR_SCALE);
  const halfW = Math.max(10, w / 2 - insetX) * scale;
  const cx = w / 2;
  const cy = h * 0.44;
  // depth: rows bunch up toward the horizon. Kept below the full half-height so
  // there is room beneath the near rail for the rod handles and scoreboard.
  const halfH = (h / 2) * 0.80;
  return {
    px: ox + cx + (x / TABLE.halfLength) * halfW,
    py: oy + cy + sz * halfH,
    scale,
  };
}

export function renderTable(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  state: RenderState,
  skinKey: string,
  ballKey: string,
  time: number
) {
  const skin = TABLE_SKINS[skinKey] ?? TABLE_SKINS['classic-green'];
  const ballSkin = BALL_SKINS[ballKey] ?? BALL_SKINS['classic-ball'];
  const c = skin.colors;

  ctx.clearRect(0, 0, cssW, cssH);

  // ---- fit the table into the viewport without distorting it --------------
  const portrait = cssH > cssW * 1.05;
  const TABLE_ASPECT = portrait ? 1.08 : 1.46;
  const availW = cssW;
  const availH = cssH;
  let boxW = availW;
  let boxH = boxW / TABLE_ASPECT;
  if (boxH > availH) {
    boxH = availH;
    boxW = boxH * TABLE_ASPECT;
  }
  const offX = (availW - boxW) / 2;
  const offY = (availH - boxH) / 2;
  // the end rails + goal boxes need room at each end of the cabinet
  const endMargin = Math.max(14, boxW * 0.075);
  const BOX: ProjectBox = { ox: offX, oy: offY, w: boxW, h: boxH, insetX: endMargin };
  const project = (x: number, z: number) => projectIn(x, z, BOX);

  // ---- cabinet geometry ---------------------------------------------------
  // The cabinet is drawn as a solid: a side panel with real thickness on each
  // side, a lip that overhangs the pitch, and legs at the near corners. All of
  // it is derived from the projected pitch corners, so it can never drift out
  // of register with the ball and figures.
  // Project the four *corners* of the pitch. (Projecting z only, at x = 0,
  // returns the centre line and collapses the whole cabinet to zero width.)
  const cornerNear = project(TABLE.halfLength, TABLE.halfWidth);
  const cornerFar = project(TABLE.halfLength, -TABLE.halfWidth);
  const pitchNearHalf = cornerNear.px - (offX + boxW / 2);
  const pitchFarHalf = cornerFar.px - (offX + boxW / 2);
  const nearY = cornerNear.py;
  const farY = cornerFar.py;

  // outer rail (the top surface of the cabinet, around the pitch)
  /** thickness of the near/far rails (the long sides) */
  const railT = Math.max(7, boxW * 0.020);
  /** the ends are much thicker: the goal boxes are recessed into them */
  const endT = endMargin * 0.92;
  const outerNearHalf = pitchNearHalf + endT;
  const outerFarHalf = pitchFarHalf + endT * (pitchFarHalf / pitchNearHalf);
  const cx0 = offX + boxW / 2;
  const cabinetDepth = Math.max(10, boxH * 0.07); // visible panel thickness below
  const apronH = Math.max(12, boxH * 0.115);      // how far the cabinet body drops

  // ---- side panels (the thick body of the cabinet) -----------------------
  // Left and right walls: quadrilaterals whose top edge follows the rail and
  // whose bottom edge is the apron. This is what gives the table mass.
  for (const dir of [-1, 1]) {
    ctx.save();
    const xFarOuter = cx0 + dir * outerFarHalf;
    const xNearOuter = cx0 + dir * outerNearHalf;
    ctx.beginPath();
    ctx.moveTo(xFarOuter, farY);
    ctx.lineTo(xNearOuter, nearY);
    ctx.lineTo(xNearOuter, nearY + apronH);
    ctx.lineTo(xFarOuter, farY + apronH * 0.62);
    ctx.closePath();
    const sg = ctx.createLinearGradient(0, farY, 0, nearY + apronH);
    sg.addColorStop(0, c.railDark);
    sg.addColorStop(0.55, c.rail);
    sg.addColorStop(1, c.railDark);
    ctx.fillStyle = sg;
    ctx.fill();
    // inner shading where the panel meets the pitch
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  // ---- end panels (behind the goals) --------------------------------------
  for (const dir of [-1, 1]) {
    ctx.save();
    const x0 = cx0 + dir * (pitchNearHalf + railT);
    ctx.beginPath();
    ctx.moveTo(cx0 + dir * outerFarHalf, farY);
    ctx.lineTo(cx0 + dir * outerNearHalf, nearY);
    ctx.lineTo(cx0 + dir * outerNearHalf * 0.995, nearY + apronH * 0.9);
    ctx.lineTo(cx0 + dir * outerFarHalf, farY + apronH * 0.55);
    ctx.closePath();
    ctx.fillStyle = c.railDark;
    ctx.globalAlpha = 0.55;
    ctx.fill();
    ctx.restore();
  }

  // ---- rail top surface (frame between pitch and outer edge) ------------
  ctx.save();
  ctx.beginPath();
  // outer boundary
  ctx.moveTo(cx0 - outerFarHalf, farY - railT * 0.55);
  ctx.lineTo(cx0 + outerFarHalf, farY - railT * 0.55);
  ctx.lineTo(cx0 + outerNearHalf, nearY + railT * 0.34);
  ctx.lineTo(cx0 - outerNearHalf, nearY + railT * 0.34);
  ctx.closePath();
  // inner boundary (the pitch aperture) — subtracted with evenodd
  ctx.moveTo(cx0 - pitchFarHalf, farY);
  ctx.lineTo(cx0 + pitchFarHalf, farY);
  ctx.lineTo(cx0 + pitchNearHalf, nearY);
  ctx.lineTo(cx0 - pitchNearHalf, nearY);
  ctx.closePath();
  const rg = ctx.createLinearGradient(0, farY - railT, 0, nearY + railT);
  rg.addColorStop(0, c.railDark);
  rg.addColorStop(0.45, c.rail);
  rg.addColorStop(1, c.railDark);
  ctx.fillStyle = rg;
  ctx.fill('evenodd');
  // subtle top highlight
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = Math.max(1, boxW * 0.0016);
  ctx.stroke();
  ctx.restore();

  // ---- playing surface ---------------------------------------------------
  const surfTop = farY;
  const surfBot = nearY;
  const surfCx = cx0;

  ctx.save();
  // clip to the pitch so markings and the ball never spill onto the rails
  ctx.beginPath();
  ctx.moveTo(surfCx - pitchFarHalf, surfTop);
  ctx.lineTo(surfCx + pitchFarHalf, surfTop);
  ctx.lineTo(surfCx + pitchNearHalf, surfBot);
  ctx.lineTo(surfCx - pitchNearHalf, surfBot);
  ctx.closePath();
  ctx.clip();

  // felt: vertical gradient + a soft vignette, like a real cloth under a light
  const fg2 = ctx.createLinearGradient(0, surfTop, 0, surfBot);
  fg2.addColorStop(0, c.surfaceDark);
  fg2.addColorStop(0.45, c.surface);
  fg2.addColorStop(1, c.surfaceDark);
  ctx.fillStyle = fg2;
  ctx.fillRect(surfCx - pitchNearHalf, surfTop - 4, pitchNearHalf * 2, surfBot - surfTop + 8);

  // felt texture: fine speckle so the surface is not a flat colour field
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = '#ffffff';
  const speckStep = Math.max(5, boxW * 0.012);
  for (let y = surfTop; y < surfBot; y += speckStep) {
    const t = (y - surfTop) / (surfBot - surfTop);
    const halfAt = pitchFarHalf + (pitchNearHalf - pitchFarHalf) * t;
    for (let x = -halfAt; x < halfAt; x += speckStep) {
      ctx.fillRect(surfCx + x + ((y / speckStep) % 2) * speckStep * 0.5, y, 1.2, 1.2);
    }
  }
  ctx.globalAlpha = 1;

  // markings, drawn with the same projection so they sit in perspective
  const lineW = Math.max(1.2, boxW * 0.0026);
  ctx.strokeStyle = c.surfaceLine;
  ctx.lineWidth = lineW;

  // halfway line
  ctx.beginPath();
  ctx.moveTo(project(0, -TABLE.halfWidth).px, farY);
  ctx.lineTo(project(0, TABLE.halfWidth).px, nearY);
  ctx.stroke();

  // centre circle (ellipse in screen space because of the tilt)
  const cc = project(0, 0);
  ctx.beginPath();
  ctx.ellipse(cc.px, cc.py, (pitchNearHalf + pitchFarHalf) * 0.5 * 0.17, (surfBot - surfTop) * 0.17, 0, 0, Math.PI * 2);
  ctx.stroke();
  // centre spot
  ctx.fillStyle = c.surfaceLine;
  ctx.beginPath();
  ctx.arc(cc.px, cc.py, Math.max(1.5, lineW * 0.9), 0, Math.PI * 2);
  ctx.fill();

  // goal areas (penalty-style boxes at each end)
  for (const side of [-1, 1]) {
    const gx = side * TABLE.halfLength;
    const bx = side * (TABLE.halfLength - 12);
    const zh = TABLE.goalHalfWidth + 5;
    const a = project(gx, -zh), b2 = project(gx, zh);
    const d = project(bx, -zh), e2 = project(bx, zh);
    ctx.beginPath();
    ctx.moveTo(a.px, a.py);
    ctx.lineTo(b2.px, b2.py);
    ctx.lineTo(e2.px, e2.py);
    ctx.lineTo(d.px, d.py);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();

  // inner shadow along the rails so the pitch sits *in* the cabinet
  ctx.save();
  const shade = ctx.createLinearGradient(0, farY, 0, farY + (nearY - farY) * 0.18);
  shade.addColorStop(0, 'rgba(0,0,0,0.42)');
  shade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.moveTo(surfCx - pitchFarHalf, surfTop);
  ctx.lineTo(surfCx + pitchFarHalf, surfTop);
  ctx.lineTo(surfCx + pitchNearHalf, surfBot);
  ctx.lineTo(surfCx - pitchNearHalf, surfBot);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const fx0 = surfCx - pitchNearHalf;
  const fx1 = surfCx + pitchNearHalf;
  const fyTop = surfTop;
  const fyBot = surfBot;
  const midY = (surfTop + surfBot) / 2;
  const goalBoxW = Math.max(10, (nearY - farY) * 0.1);

  // ---- goals: a netted box recessed into the end of the cabinet -----------
  // The mouth spans the goal width at the end of the pitch; the net recedes the
  // short distance the cabinet allows, so it is always contained.
  const drawGoalBox = (side: -1 | 1) => {
    const gxWorld = side * TABLE.halfLength;
    const zHalf = TABLE.goalHalfWidth;
    const gNear = project(gxWorld, zHalf);
    const gFar = project(gxWorld, -zHalf);
    // depth of the net box in world units, capped by the reserved margin
    const boxDepthPx = endT * 0.72;
    const dir = side;
    const backNearX = gNear.px + dir * boxDepthPx;
    const backFarX = gFar.px + dir * boxDepthPx;
    const mouthH = Math.abs(gNear.py - gFar.py);
    const rise = mouthH * 0.52;

    ctx.save();
    // net area
    ctx.beginPath();
    ctx.moveTo(gNear.px, gNear.py);
    ctx.lineTo(gFar.px, gFar.py);
    ctx.lineTo(backFarX, gFar.py - rise * 0.55);
    ctx.lineTo(backNearX, gNear.py - rise * 0.55);
    ctx.closePath();
    const ig = ctx.createLinearGradient(gNear.px, 0, backNearX, 0);
    ig.addColorStop(0, 'rgba(2,5,10,0.95)');
    ig.addColorStop(1, 'rgba(6,12,20,0.7)');
    ctx.fillStyle = ig;
    ctx.fill();
    ctx.clip();
    // back mesh
    ctx.strokeStyle = 'rgba(220,232,250,0.34)';
    ctx.lineWidth = Math.max(0.7, boxW * 0.0008);
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const x = backNearX + (backFarX - backNearX) * t;
      const y = (gNear.py - rise * 0.55) + ((gFar.py - rise * 0.55) - (gNear.py - rise * 0.55)) * t;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - rise);
      ctx.stroke();
    }
    for (let j = 0; j <= 4; j++) {
      const t = j / 4;
      ctx.beginPath();
      ctx.moveTo(backNearX, gNear.py - rise * 0.55 - rise * t);
      ctx.lineTo(backFarX, gFar.py - rise * 0.55 - rise * t);
      ctx.stroke();
    }
    // net bulge when the ball is in there
    const inMouth = side === -1 ? state.ball.x < -TABLE.halfLength + 7 : state.ball.x > TABLE.halfLength - 7;
    if (inMouth) {
      const bulge = Math.max(0, 1 - Math.abs(state.ball.z) / (TABLE.goalHalfWidth * 1.6));
      const bp3 = project(state.ball.x, state.ball.z);
      ctx.globalAlpha = 0.18 + bulge * 0.26;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(bp3.px, bp3.py - rise * 0.4, mouthH * 0.4, mouthH * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // frame: a bright crossbar reads the mouth at a glance; thin posts only
    ctx.save();
    ctx.strokeStyle = 'rgba(240,247,255,0.92)';
    ctx.lineWidth = Math.max(2.2, boxW * 0.0032);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(gNear.px, gNear.py - rise);
    ctx.lineTo(gFar.px, gFar.py - rise);
    ctx.stroke();
    ctx.lineWidth = Math.max(1.4, boxW * 0.002);
    ctx.strokeStyle = 'rgba(240,247,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(gNear.px, gNear.py); ctx.lineTo(gNear.px, gNear.py - rise);
    ctx.moveTo(gFar.px, gFar.py); ctx.lineTo(gFar.px, gFar.py - rise);
    ctx.stroke();
    ctx.restore();
  };
  drawGoalBox(-1);
  drawGoalBox(1);

  // ---- ball shadow + ball (drawn on the surface, under the figures) --------
  const bp = project(state.ball.x, state.ball.z);
  const ballR = Math.max(4.5, (BALL.radius / TABLE.halfWidth) * ((fx1 - fx0) / 2.04) * bp.scale);

  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(bp.px + 2, bp.py + ballR * 0.75, ballR * 1.02, ballR * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ball trail
  ctx.restore(); // end surface clip so figures can overhang slightly
  ctx.save();

  // ---- interaction feedback: rod slide tracks + aim line -------------------
  // Shows exactly which part of the table your rods can reach, so aiming stops
  // being guesswork — the biggest source of "I don't know what I'm doing".
  if (state.mySlot !== null || state.highlightRods.length) {
    // only the player's own rods: outlining every rod made the table noisy
    const mineSpecs = ROD_SPECS.filter(
      (spec, i) => state.highlightRods.includes(i) || (state.mySlot !== null && spec.slotIndex === state.mySlot)
    );
    mineSpecs.forEach((spec) => {
      const idx = ROD_SPECS.findIndex((r) => r.id === spec.id);
      const rod = state.rods[idx];
      if (!rod) return;
      const half = TABLE.halfWidth - FIGURE.radius;
      // reachable band for this rod
      ctx.save();
      ctx.strokeStyle = spec.team === 'A' ? 'rgba(147,197,253,0.24)' : 'rgba(253,164,175,0.24)';
      ctx.setLineDash([4, 9]);
      ctx.lineWidth = Math.max(1.2, boxW * 0.0016);
      for (const off of figureOffsetsLocal(spec.count)) {
        const z = Math.max(-half, Math.min(half, off + rod.slide));
        const a = project(spec.x, z);
        ctx.beginPath();
        ctx.arc(a.px, a.py, Math.max(3, boxW * 0.004), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    });

    // aim line: only while a kick is wound up, from the ball along the aim
    const wound = state.windup ?? 0;
    if (wound > 0.05) {
      const bp2 = project(state.ball.x, state.ball.z);
      const dir = state.myTeam === 'B' ? -1 : 1;
      const len = 34 + wound * 60;
      const ex = project(state.ball.x + dir * len, state.ball.z + (state.aimZ ?? 0) * 20);
      ctx.save();
      const grad = ctx.createLinearGradient(bp2.px, bp2.py, ex.px, ex.py);
      grad.addColorStop(0, `rgba(255,255,255,${0.30 + wound * 0.4})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(2, boxW * 0.004);
      ctx.lineCap = 'round';
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.moveTo(bp2.px, bp2.py);
      ctx.lineTo(ex.px, ex.py);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---- rods & figures ------------------------------------------------------
  // Every rod is a single steel bar through the side rails, with a grip poking
  // out at each end. Figures are moulded men mounted *on* the bar: as the rod
  // rotates, each one swings its body and kicks its foot through the ball.
  // Drawing them like this (rather than as free-floating cylinders) is what
  // makes the table read as a real foosball cabinet.
  const rodOrder = [...ROD_SPECS].sort((a, b) => a.x - b.x);

  // --- pass 1: the bars themselves, so figures always sit on top of steel ---
  rodOrder.forEach((spec) => {
    const rodIdx = ROD_SPECS.findIndex((r) => r.id === spec.id);
    const rodState = state.rods[rodIdx] ?? { slide: 0, angle: 0 };
    // the bar is carried by the side rails: it runs just past them, no further
    const outZ = TABLE.halfWidth + 2.5;
    const pNear = project(spec.x, outZ);
    const pFar = project(spec.x, -outZ);
    ctx.save();
    // steel bar: bright core with a soft shadow underneath
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = Math.max(3, boxW * 0.0042);
    ctx.beginPath();
    ctx.moveTo(pNear.px + 1.5, pNear.py + 2);
    ctx.lineTo(pFar.px + 1.5, pFar.py + 2);
    ctx.stroke();
    const steel = ctx.createLinearGradient(pNear.px, pNear.py, pFar.px, pFar.py);
    steel.addColorStop(0, '#cfd8e6');
    steel.addColorStop(0.5, '#8e9bb0');
    steel.addColorStop(1, '#e6edf8');
    ctx.strokeStyle = steel;
    ctx.lineWidth = Math.max(2, boxW * 0.0028);
    ctx.beginPath();
    ctx.moveTo(pNear.px, pNear.py);
    ctx.lineTo(pFar.px, pFar.py);
    ctx.stroke();
    ctx.restore();
  });

  // --- pass 2: figures, far rows first so near rows overlap them correctly --
  rodOrder.forEach((spec) => {
    const rodIdx = ROD_SPECS.findIndex((r) => r.id === spec.id);
    const rodState = state.rods[rodIdx] ?? { slide: 0, angle: 0 };
    const teamPal = spec.team === 'A' ? state.teamA : state.teamB;
    const offsets = figureOffsetsLocal(spec.count);
    // the foot leads the rod by footOffset * sin(angle); the body leans with it
    const lean = Math.sin(rodState.angle);
    const footX = spec.x + FIGURE.footOffset * lean;

    offsets.forEach((off) => {
      const fz = Math.max(
        -TABLE.halfWidth + FIGURE.radius,
        Math.min(TABLE.halfWidth - FIGURE.radius, off + rodState.slide)
      );
      const base = project(footX, fz);
      const top = project(footX, fz - 0.001);
      const r = Math.max(6, (FIGURE.radius / TABLE.halfWidth) * pitchNearHalf * 0.40 * base.scale);
      const isMine = state.mySlot !== null && spec.slotIndex === state.mySlot;
      const isHighlighted = state.highlightRods.includes(rodIdx);

      // ground shadow
      ctx.save();
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(base.px + r * 0.1, base.py + r * 0.5, r * 1.05, r * 0.36, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // The figure: seen from the player's side we look at its back, so the
      // body is a rounded slab, arms out to the rod, and the foot points at us.
      // A foosball man is tall and slim: roughly 1.5 cm wide but 4 cm tall, so
      // on screen the height is several times the width. Getting this ratio
      // right is what stops them reading as pins stuck in the table.
      const bodyH = r * 4.6;
      const shoulderY = base.py - bodyH * 0.86;

      // legs (two thin struts from the body down to the foot plate)
      ctx.save();
      ctx.strokeStyle = teamPal.color2;
      ctx.lineWidth = Math.max(1.6, r * 0.30);
      ctx.lineCap = 'round';
      for (const sx of [-0.30, 0.30]) {
        ctx.beginPath();
        ctx.moveTo(base.px + r * sx * 0.6, base.py - bodyH * 0.34);
        ctx.lineTo(base.px + r * sx, base.py - r * 0.10);
        ctx.stroke();
      }
      ctx.restore();

      // torso
      const torsoGrad = ctx.createLinearGradient(base.px - r, 0, base.px + r, 0);
      torsoGrad.addColorStop(0, teamPal.color2);
      torsoGrad.addColorStop(0.4, teamPal.color);
      torsoGrad.addColorStop(1, teamPal.color2);
      ctx.beginPath();
      roundRect(ctx, base.px - r * 0.62, base.py - bodyH, r * 1.24, bodyH * 0.82, r * 0.52);
      ctx.fillStyle = torsoGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // shoulders + arms reaching to the bar
      ctx.strokeStyle = teamPal.color;
      ctx.lineWidth = Math.max(1.8, r * 0.4);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(base.px - r * 0.62, base.py - bodyH * 0.90);
      ctx.lineTo(base.px - r * 1.02, base.py - bodyH * 0.74);
      ctx.moveTo(base.px + r * 0.62, base.py - bodyH * 0.90);
      ctx.lineTo(base.px + r * 1.02, base.py - bodyH * 0.74);
      ctx.stroke();
      // the bar passing through the shoulders
      ctx.strokeStyle = 'rgba(214,226,244,0.75)';
      ctx.lineWidth = Math.max(1.4, r * 0.22);
      ctx.beginPath();
      ctx.moveTo(base.px - r * 1.22, base.py - bodyH * 0.74);
      ctx.lineTo(base.px + r * 1.22, base.py - bodyH * 0.74);
      ctx.stroke();

      // head, tilted with the swing
      const headX = base.px + lean * r * 0.55;
      const headY = base.py - bodyH - r * 0.30;
      const headGrad = ctx.createRadialGradient(headX - r * 0.16, headY - r * 0.18, r * 0.08, headX, headY, r * 0.62);
      headGrad.addColorStop(0, '#ffe2c4');
      headGrad.addColorStop(1, '#c98b5c');
      ctx.beginPath();
      ctx.arc(headX, headY, r * 0.52, 0, Math.PI * 2);
      ctx.fillStyle = headGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // foot: a wedge that swings out over the ball as the rod turns
      const footW = r * (0.9 + Math.abs(lean) * 0.35);
      ctx.save();
      ctx.translate(base.px, base.py);
      ctx.rotate(lean * 0.5);
      const footGrad = ctx.createLinearGradient(-footW, 0, footW, 0);
      footGrad.addColorStop(0, teamPal.color2);
      footGrad.addColorStop(0.5, teamPal.color);
      footGrad.addColorStop(1, teamPal.color2);
      ctx.beginPath();
      roundRect(ctx, -footW, -r * 0.30, footW * 2, r * 0.62, r * 0.24);
      ctx.fillStyle = footGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();

      // ownership rings: yours are solid, others dashed, so you always know
      // which rods you actually control
      if (isMine || isHighlighted) {
        ctx.save();
        const pulse = isHighlighted ? 0.55 + Math.sin(time / 200) * 0.3 : 0.5;
        ctx.strokeStyle = `rgba(255,255,255,${pulse})`;
        ctx.lineWidth = Math.max(1.4, r * 0.16);
        ctx.setLineDash(isMine ? [] : [3, 3]);
        ctx.beginPath();
        ctx.ellipse(base.px, base.py + r * 0.52, r * 1.25, r * 0.44, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      void top;
    });
  });

  // --- pass 3: handles out past the side rails -----------------------------
  rodOrder.forEach((spec) => {
    const rodIdx = ROD_SPECS.findIndex((r) => r.id === spec.id);
    const rodState = state.rods[rodIdx] ?? { slide: 0, angle: 0 };
    const teamPal = spec.team === 'A' ? state.teamA : state.teamB;
    // handles sit just outside the near rail where a player would grip them
    const hz = TABLE.halfWidth + 4.5;
    const hp = project(spec.x, hz);
    const hr = Math.max(6, boxW * 0.011) * hp.scale;
    ctx.save();
    // shadow under the grip
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(hp.px, hp.py + hr * 0.5, hr * 1.05, hr * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // moulded grip: a bright cylinder end-on, with a team-coloured cap
    const hg = ctx.createRadialGradient(hp.px - hr * 0.3, hp.py - hr * 0.34, hr * 0.1, hp.px, hp.py, hr);
    hg.addColorStop(0, '#ffffff');
    hg.addColorStop(0.4, '#d7dfec');
    hg.addColorStop(1, '#78849a');
    ctx.beginPath();
    ctx.ellipse(hp.px, hp.py, hr, hr * 0.86, 0, 0, Math.PI * 2);
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(4,8,15,0.6)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(hp.px, hp.py, hr * 0.46, hr * 0.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = teamPal.color;
    ctx.fill();
    ctx.restore();
  });

  // ---- ball (raised, drawn last so it sits above figures) ------------------
  const liftPx = state.ball.lift * ballR * 0.9;
  ctx.save();
  ctx.translate(bp.px, bp.py - liftPx);
  const bg = ctx.createRadialGradient(-ballR * 0.35, -ballR * 0.4, ballR * 0.1, 0, 0, ballR * 1.15);
  bg.addColorStop(0, '#ffffff');
  bg.addColorStop(0.45, ballSkin.color);
  bg.addColorStop(1, ballSkin.accent);
  ctx.beginPath();
  ctx.arc(0, 0, ballR, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();

  // ---- rolling: the ball spins in proportion to its ground speed -----------
  const speed = Math.hypot(state.ball.vx ?? 0, state.ball.vz ?? 0);
  // rolling without slipping: omega = v / r, projected onto the tilted view
  const spin = (speed / Math.max(1, BALL.radius)) * 60;
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, ballR, 0, Math.PI * 2);
  ctx.clip();
  if (ballSkin.pattern === 'classic') {
    // pentagon spots roll past as the ball travels
    ctx.fillStyle = ballSkin.accent;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + spin * 0.11;
      const rr = ballR * (0.62 - 0.12 * Math.cos(a));
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr * 0.86, ballR * (0.2 + 0.04 * Math.sin(a * 2)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(Math.cos(spin * 0.05) * ballR * 0.12, Math.sin(spin * 0.05) * ballR * 0.1, ballR * 0.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (ballSkin.pattern === 'star') {
    ctx.fillStyle = ballSkin.accent;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2 + spin * 0.09;
      drawStar(ctx, Math.cos(a) * ballR * 0.55, Math.sin(a) * ballR * 0.42, 5, ballR * 0.2, ballR * 0.09);
    }
  } else {
    const fg = ctx.createLinearGradient(-ballR, ballR, ballR, -ballR);
    fg.addColorStop(0, 'rgba(255,220,120,0.95)');
    fg.addColorStop(1, 'rgba(180,40,10,0.35)');
    ctx.fillStyle = fg;
    ctx.fillRect(-ballR, -ballR, ballR * 2, ballR * 2);
    // comet streak for the flame ball
    if (speed > 40) {
      ctx.globalAlpha = Math.min(0.55, speed / 400);
      ctx.fillStyle = '#ffd6a5';
      ctx.beginPath();
      ctx.ellipse(-Math.sign(state.ball.vx || 1) * ballR * 0.5, 0, ballR * 0.7, ballR * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();

  // ---- motion blur: a short smear along the velocity vector ---------------
  if (speed > 55) {
    const ang = Math.atan2((state.ball.vz ?? 0) * 0.3, state.ball.vx ?? 0);
    const len = Math.min(ballR * 3.2, (speed / 260) * ballR * 2.6);
    ctx.save();
    ctx.globalAlpha = Math.min(0.4, speed / 700);
    const mg = ctx.createLinearGradient(-Math.cos(ang) * len, -Math.sin(ang) * len, 0, 0);
    mg.addColorStop(0, 'rgba(255,255,255,0)');
    mg.addColorStop(1, 'rgba(255,255,255,0.85)');
    ctx.fillStyle = mg;
    ctx.beginPath();
    ctx.moveTo(-Math.cos(ang) * len - Math.sin(ang) * ballR * 0.55, -Math.sin(ang) * len + Math.cos(ang) * ballR * 0.55);
    ctx.lineTo(-Math.sin(ang) * ballR * 0.2, Math.cos(ang) * ballR * 0.2);
    ctx.lineTo(Math.sin(ang) * ballR * 0.2, -Math.cos(ang) * ballR * 0.2);
    ctx.lineTo(-Math.cos(ang) * len + Math.sin(ang) * ballR * 0.55, -Math.sin(ang) * len - Math.cos(ang) * ballR * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(0, 0, ballR, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // ---- scoreboard strip on the rail ---------------------------------------
  // The React HUD already shows the score and clock, so the canvas strip is
  // only drawn when the letterbox leaves real room for it (wide screens).
  if (cssW > 700) {
    drawScoreboard(ctx, boxW, nearY + apronH * 1.05, Math.max(8, boxW * 0.02), state, offX);
  }
}

function drawScoreboard(
  ctx: CanvasRenderingContext2D,
  w: number,
  y: number,
  pad: number,
  state: RenderState,
  ox = 0
) {
  const h = Math.max(26, Math.min(44, y * 0.55));
  if (y + h > cssHGuard(ctx)) return;
  if (typeof window !== 'undefined' && y + h > ctx.canvas.height / (window.devicePixelRatio || 1)) return;
  ctx.save();
  ctx.globalAlpha = 0.94;
  roundRect(ctx, ox + pad * 2, y, Math.max(120, w - pad * 4), h, h / 2);
  ctx.fillStyle = 'rgba(4,8,15,0.82)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,160,220,0.25)';
  ctx.stroke();

  ctx.font = `700 ${Math.round(h * 0.5)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = state.teamA.color;
  ctx.fillText(String(state.score.A), w / 2 - h * 0.9, y + h / 2 + 1);
  ctx.fillStyle = 'rgba(232,238,252,0.55)';
  ctx.fillText('—', w / 2, y + h / 2 + 1);
  ctx.fillStyle = state.teamB.color;
  ctx.fillText(String(state.score.B), w / 2 + h * 0.9, y + h / 2 + 1);
  ctx.restore();
}
function cssHGuard(ctx: CanvasRenderingContext2D) {
  return ctx.canvas.height;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, spikes: number, outer: number, inner: number) {
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outer);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot) * outer, cy + Math.sin(rot) * outer);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * inner, cy + Math.sin(rot) * inner);
    rot += step;
  }
  ctx.closePath();
  ctx.fill();
}

function figureOffsetsLocal(count: number): number[] {
  const span = TABLE.halfWidth * 2;
  return Array.from({ length: count }, (_, i) => -span / 2 + (span * (i + 0.5)) / count);
}

export { project, TEAM_GOAL_X };
