/**
 * Photo Studio backgrounds: 8 dealership / automotive-studio scenes drawn on this server (SVG → image with sharp),
 * so they never depend on an outside link. Each scene is built like a photograph: multi-stop light gradients, a floor
 * plane in perspective (vanishing point on the horizon), soft light sources and their reflections on the floor,
 * fine surface texture (concrete, asphalt, wood grain), depth-of-field blur on distant parts and a natural vignette.
 * Drawn for any size / aspect ratio (wider scenes are cropped in the middle).
 *
 * For each scene:
 *  ground      where the front tyres stand, as a share of the height
 *  maxW, maxH  the largest share of the width / height the vehicle may take
 *  reflection  strength of the mirror image on the floor (0 = matte)
 *  shadow      darkness of the contact shadow and ambient occlusion
 *  blur        extra blur of the whole scene, % of the width (0: the scene draws its own depth of field)
 *  exposure    small brightness match of the vehicle to the scene's light (gain, colour ratios kept)
 */
export interface StudioPreset {
  id: string;
  name: string;
  desc: string;
  ground: number;
  maxW: number;
  maxH: number;
  reflection: number;
  shadow: number;
  blur: number;
  exposure: number;
  svg: (w: number, h: number) => string;
}

export const DEFAULT_PRESET = 'cyclorama';
/** the cut-out vehicle on its own (PNG with transparency) with a soft ground shadow */
export const TRANSPARENT = 'transparent';
/** the cut-out vehicle on its own, no shadow at all */
export const TRANSPARENT_CLEAN = 'transparent-clean';
/** a photo the dealer uploaded (their own showroom wall or lot) */
export const CUSTOM = 'custom';

const VB_W = 1600;
const VB_H = 1200;
const VX = 800; // vanishing point x (centre)

const svg = (w: number, h: number, body: string, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${VB_W} ${VB_H}" preserveAspectRatio="xMidYMid slice"><defs>${defs}${COMMON_DEFS}</defs>${body}</svg>`;

/** shared filters: blur levels, fine grain, asphalt and concrete texture, vignettes */
const COMMON_DEFS = `
<filter id="b2" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2"/></filter>
<filter id="b6" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>
<filter id="b14" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14"/></filter>
<filter id="b30" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="30"/></filter>
<filter id="b60" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="60"/></filter>
<filter id="streak" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="10 34"/></filter>
<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0.9 0.9 0.9 0 -0.85"/></filter>
<filter id="asphalt" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.55 1.4" numOctaves="3" seed="11" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.12  0 0 0 0 0.12  0 0 0 0 0.13  1.5 1.5 1.5 0 -1.35"/></filter>
<filter id="concrete" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.03" numOctaves="4" seed="5" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.6 -0.12"/></filter>
<radialGradient id="vig" cx="0.5" cy="0.48" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.38"/></radialGradient>
<radialGradient id="vigLight" cx="0.5" cy="0.5" r="0.78"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.14"/></radialGradient>`;

/** lines from the vanishing point (VX, horizon) to the bottom edge: floor joints, parking bays, pavers */
function rays(horizon: number, step: number, count: number, stroke: string, width: number, opacity: number) {
  let o = '';
  for (let i = -count; i <= count; i++) o += `<line x1="${VX}" y1="${horizon}" x2="${VX + i * step}" y2="${VB_H}" stroke="${stroke}" stroke-width="${width}" opacity="${opacity}"/>`;
  return o;
}
/** horizontal joints of a floor in perspective (closer together near the horizon) */
function rows(horizon: number, n: number, stroke: string, width: number, opacity: number) {
  let o = '';
  for (let k = 1; k <= n; k++) {
    const y = horizon + (VB_H - horizon) * Math.pow(k / n, 2.2);
    o += `<line x1="0" y1="${y.toFixed(1)}" x2="${VB_W}" y2="${y.toFixed(1)}" stroke="${stroke}" stroke-width="${(width * (0.4 + k / n)).toFixed(2)}" opacity="${opacity}"/>`;
  }
  return o;
}
/** ceiling light strips converging to the vanishing point, and their soft streaks on a shiny floor */
function ceilingStrips(horizon: number, ceilY: number, xs: number[], color: string, floorOpacity: number) {
  let lights = '';
  let refl = '';
  for (const x of xs) {
    const far = VX + (x - VX) * 0.18;
    const yFar = horizon - (horizon - ceilY) * 0.18;
    lights += `<polygon points="${x - 16},${ceilY} ${x + 16},${ceilY} ${far + 3},${yFar} ${far - 3},${yFar}" fill="${color}"/>`;
    const yNear = horizon + (horizon - ceilY) * 1.15;
    refl += `<polygon points="${far - 4},${2 * horizon - yFar} ${far + 4},${2 * horizon - yFar} ${x + 40},${yNear} ${x - 40},${yNear}" fill="${color}" opacity="${floorOpacity}"/>`;
  }
  return { lights, refl };
}

export const PRESETS: StudioPreset[] = [
  {
    id: 'showroom',
    name: 'Luxury Showroom',
    desc: 'Charcoal epoxy floor, LED strips, glass and concrete',
    ground: 0.86, maxW: 0.8, maxH: 0.6, reflection: 0.3, shadow: 0.7, blur: 0, exposure: 0.01,
    svg: (w, h) => {
      const H0 = 640;
      const s = ceilingStrips(H0, 0, [200, 520, 1080, 1400], '#ffffff', 0.32);
      let mullions = '';
      for (let i = 0; i <= 8; i++) mullions += `<rect x="${380 + i * 105}" y="250" width="5" height="${H0 - 250}" fill="#2a2f35" opacity="0.85"/>`;
      return svg(
        w,
        h,
        `<rect width="1600" height="${H0}" fill="url(#ceil)"/>
         <g filter="url(#b2)">${s.lights}</g><g filter="url(#b14)" opacity="0.7">${s.lights}</g>
         <rect x="0" y="230" width="1600" height="${H0 - 230}" fill="url(#wallc)"/>
         <rect x="0" y="230" width="1600" height="${H0 - 230}" filter="url(#concrete)" opacity="0.5"/>
         <g filter="url(#b2)"><rect x="380" y="250" width="845" height="${H0 - 250}" fill="url(#glass)"/>${mullions}
           <rect x="380" y="250" width="845" height="6" fill="#2a2f35"/></g>
         <ellipse cx="800" cy="330" rx="520" ry="140" fill="#ffffff" opacity="0.18" filter="url(#b60)"/>
         <rect x="0" y="${H0 - 8}" width="1600" height="8" fill="#15171a"/>
         <rect y="${H0}" width="1600" height="${1200 - H0}" fill="url(#epoxy)"/>
         <rect x="380" y="${H0}" width="845" height="230" fill="url(#glassRefl)" filter="url(#b14)" opacity="0.9"/>
         <g filter="url(#streak)">${s.refl}</g>
         ${rows(H0, 9, '#000', 1.2, 0.18)}${rays(H0, 260, 6, '#000', 1.2, 0.14)}
         <rect y="${H0}" width="1600" height="${1200 - H0}" filter="url(#grain)" opacity="0.35"/>
         <ellipse cx="800" cy="1000" rx="700" ry="170" fill="#ffffff" opacity="0.07" filter="url(#b60)"/>
         <rect width="1600" height="1200" fill="url(#vig)"/>`,
        `<linearGradient id="ceil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c1f23"/><stop offset="1" stop-color="#3a3f45"/></linearGradient>
         <linearGradient id="wallc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8d9197"/><stop offset="0.6" stop-color="#a7abb0"/><stop offset="1" stop-color="#7f8389"/></linearGradient>
         <linearGradient id="glass" x1="0" y1="0" x2="1" y2="0.6"><stop offset="0" stop-color="#4c5d6b"/><stop offset="0.35" stop-color="#9fb4c2"/><stop offset="0.55" stop-color="#d7e2e8"/><stop offset="0.75" stop-color="#8aa0af"/><stop offset="1" stop-color="#435463"/></linearGradient>
         <linearGradient id="glassRefl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8aa0af" stop-opacity="0.35"/><stop offset="1" stop-color="#8aa0af" stop-opacity="0"/></linearGradient>
         <linearGradient id="epoxy" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4e54"/><stop offset="0.25" stop-color="#34373c"/><stop offset="0.7" stop-color="#26282c"/><stop offset="1" stop-color="#1b1c1f"/></linearGradient>`,
      );
    },
  },
  {
    id: 'cyclorama',
    name: 'White Cyclorama Studio',
    desc: 'Seamless infinity cove, overhead softbox, glossy floor',
    ground: 0.84, maxW: 0.84, maxH: 0.66, reflection: 0.16, shadow: 0.62, blur: 0, exposure: 0.015,
    svg: (w, h) =>
      svg(
        w,
        h,
        `<rect width="1600" height="1200" fill="url(#cyc)"/>
         <rect y="520" width="1600" height="330" fill="url(#cove)" filter="url(#b30)"/>
         <rect x="330" y="-120" width="940" height="260" rx="120" fill="#ffffff" opacity="0.9" filter="url(#b60)"/>
         <ellipse cx="800" cy="1010" rx="820" ry="230" fill="#ffffff" opacity="0.85" filter="url(#b60)"/>
         <rect x="480" y="840" width="640" height="150" fill="url(#softRefl)" filter="url(#b30)"/>
         <rect width="1600" height="1200" fill="url(#vigLight)"/>`,
        `<linearGradient id="cyc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e7e9ec"/><stop offset="0.35" stop-color="#f4f5f6"/><stop offset="0.6" stop-color="#f9fafa"/><stop offset="1" stop-color="#fdfdfd"/></linearGradient>
         <linearGradient id="cove" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a7adb3" stop-opacity="0"/><stop offset="0.55" stop-color="#a7adb3" stop-opacity="0.09"/><stop offset="1" stop-color="#a7adb3" stop-opacity="0"/></linearGradient>
         <linearGradient id="softRefl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>`,
      ),
  },
  {
    id: 'boutique',
    name: 'Wood & Glass Boutique',
    desc: 'Walnut slat wall, spotlights, polished stone floor',
    ground: 0.86, maxW: 0.8, maxH: 0.6, reflection: 0.2, shadow: 0.68, blur: 0, exposure: 0,
    svg: (w, h) => {
      const H0 = 660;
      let slats = '';
      for (let i = 0; i < 64; i++) {
        const x = i * 16;
        const tone = ['#6b4128', '#5d3820', '#74472b', '#61391f'][i % 4];
        slats += `<rect x="${x}" y="170" width="12" height="${H0 - 170}" fill="${tone}"/><rect x="${x + 12}" y="170" width="4" height="${H0 - 170}" fill="#24150c"/>`;
      }
      let spots = '';
      for (const x of [150, 470, 790]) spots += `<ellipse cx="${x}" cy="360" rx="130" ry="260" fill="url(#spot)"/><ellipse cx="${x}" cy="176" rx="24" ry="7" fill="#fff4dc"/>`;
      let reflSlats = '';
      for (let i = 0; i < 64; i++) reflSlats += `<rect x="${i * 16}" y="${H0}" width="12" height="240" fill="${i % 2 ? '#5d3820' : '#74472b'}"/>`;
      return svg(
        w,
        h,
        `<rect width="1600" height="${H0}" fill="#2b1d14"/>
         <rect width="1600" height="170" fill="url(#ceilw)"/>
         <g>${slats}</g>
         <rect x="0" y="170" width="1024" height="${H0 - 170}" filter="url(#grain)" opacity="0.6"/>
         <g filter="url(#b14)">${spots}</g>
         <g filter="url(#b2)"><rect x="1024" y="170" width="576" height="${H0 - 170}" fill="url(#glassw)"/>
           <rect x="1024" y="170" width="8" height="${H0 - 170}" fill="#1a120c"/><rect x="1310" y="170" width="6" height="${H0 - 170}" fill="#1a120c"/>
           <ellipse cx="1300" cy="420" rx="240" ry="140" fill="#ffe6bf" opacity="0.25" filter="url(#b30)"/></g>
         <rect y="${H0 - 6}" width="1600" height="6" fill="#1a120c"/>
         <rect y="${H0}" width="1600" height="${1200 - H0}" fill="url(#stone)"/>
         <g opacity="0.22" filter="url(#streak)">${reflSlats}</g>
         <rect x="1024" y="${H0}" width="576" height="220" fill="url(#glassRefl2)" filter="url(#b14)"/>
         ${rows(H0, 7, '#3b2c22', 1.4, 0.25)}${rays(H0, 330, 5, '#3b2c22', 1.4, 0.22)}
         <rect y="${H0}" width="1600" height="${1200 - H0}" filter="url(#concrete)" opacity="0.35"/>
         <ellipse cx="800" cy="980" rx="720" ry="190" fill="#ffd9a8" opacity="0.1" filter="url(#b60)"/>
         <rect width="1600" height="1200" fill="url(#vig)"/>`,
        `<linearGradient id="ceilw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#140d08"/><stop offset="1" stop-color="#2e2016"/></linearGradient>
         <radialGradient id="spot" cx="0.5" cy="0.1" r="0.9"><stop offset="0" stop-color="#ffd59a" stop-opacity="0.55"/><stop offset="0.5" stop-color="#ffbe73" stop-opacity="0.18"/><stop offset="1" stop-color="#ffbe73" stop-opacity="0"/></radialGradient>
         <linearGradient id="glassw" x1="0" y1="0" x2="1" y2="0.7"><stop offset="0" stop-color="#3b3a36"/><stop offset="0.4" stop-color="#7c7a70"/><stop offset="0.6" stop-color="#a49f90"/><stop offset="1" stop-color="#4a463f"/></linearGradient>
         <linearGradient id="glassRefl2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a49f90" stop-opacity="0.3"/><stop offset="1" stop-color="#a49f90" stop-opacity="0"/></linearGradient>
         <linearGradient id="stone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a7b6d"/><stop offset="0.35" stop-color="#9b8c7d"/><stop offset="1" stop-color="#6e6155"/></linearGradient>`,
      );
    },
  },
  {
    id: 'dark-studio',
    name: 'Dark Performance Studio',
    desc: 'Obsidian studio, overhead LED bars, satin floor',
    ground: 0.85, maxW: 0.82, maxH: 0.62, reflection: 0.26, shadow: 0.85, blur: 0, exposure: -0.02,
    svg: (w, h) => {
      const H0 = 700;
      let bars = '';
      let barRefl = '';
      for (const [i, y] of [[0, 70], [1, 150], [2, 215]] as const) {
        const half = 520 - i * 120;
        bars += `<rect x="${800 - half}" y="${y}" width="${half * 2}" height="${10 - i * 2}" rx="4" fill="#ffffff"/>`;
        const ry = 2 * H0 - y - 340;
        barRefl += `<rect x="${800 - half * 0.95}" y="${ry}" width="${half * 1.9}" height="${22 - i * 4}" rx="8" fill="#ffffff" opacity="${0.4 - i * 0.08}"/>`;
      }
      return svg(
        w,
        h,
        `<rect width="1600" height="1200" fill="url(#obs)"/>
         <polygon points="300,90 1300,90 1560,${H0} 40,${H0}" fill="url(#beam)" filter="url(#b30)"/>
         <g filter="url(#b2)">${bars}</g><g filter="url(#b14)" opacity="0.9">${bars}</g><g filter="url(#b60)" opacity="0.6">${bars}</g>
         <rect y="${H0}" width="1600" height="${1200 - H0}" fill="url(#satin)"/>
         <g filter="url(#streak)">${barRefl}</g>
         <ellipse cx="800" cy="930" rx="640" ry="150" fill="#aeb6c0" opacity="0.13" filter="url(#b60)"/>
         <rect y="${H0}" width="1600" height="${1200 - H0}" filter="url(#grain)" opacity="0.4"/>
         <rect width="1600" height="1200" fill="url(#vig)"/>`,
        `<radialGradient id="obs" cx="0.5" cy="0.38" r="0.85"><stop offset="0" stop-color="#2f3337"/><stop offset="0.5" stop-color="#1a1c1f"/><stop offset="1" stop-color="#08090a"/></radialGradient>
         <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.12"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.01"/></linearGradient>
         <linearGradient id="satin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2d31"/><stop offset="0.4" stop-color="#1e2023"/><stop offset="1" stop-color="#0f1012"/></linearGradient>`,
      );
    },
  },
  {
    id: 'outdoor-lot',
    name: 'Outdoor Dealership Lot',
    desc: 'Asphalt lot, blurred modern dealership, clear sky',
    ground: 0.87, maxW: 0.8, maxH: 0.58, reflection: 0, shadow: 0.85, blur: 0, exposure: 0.01,
    svg: (w, h) => {
      const H0 = 600;
      let panes = '';
      for (let i = 0; i < 12; i++) panes += `<rect x="${330 + i * 80}" y="400" width="74" height="${H0 - 400}" fill="url(#pane)"/>`;
      let trees = '';
      for (const [x, r] of [[120, 90], [230, 70], [1420, 95], [1530, 75]]) trees += `<ellipse cx="${x}" cy="${H0 - r * 0.9}" rx="${r}" ry="${r * 1.1}" fill="#3f5a36"/>`;
      let bays = '';
      for (let i = -7; i <= 7; i++) {
        const xb = VX + i * 340;
        const xs = VX + (xb - VX) * 0.3;
        bays += `<line x1="${xs}" y1="${H0 + 120}" x2="${xb}" y2="1200" stroke="#ecebe5" stroke-width="10" opacity="0.6"/>`;
      }
      return svg(
        w,
        h,
        `<rect width="1600" height="${H0 + 20}" fill="url(#sky)"/>
         <ellipse cx="380" cy="150" rx="260" ry="34" fill="#ffffff" opacity="0.55" filter="url(#b30)"/>
         <ellipse cx="1220" cy="100" rx="300" ry="40" fill="#ffffff" opacity="0.45" filter="url(#b30)"/>
         <g filter="url(#b6)">
           ${trees}
           <rect x="290" y="330" width="1020" height="${H0 - 330}" fill="#e9ebee"/>
           <rect x="290" y="330" width="1020" height="62" fill="#f7f8f9"/><rect x="290" y="392" width="1020" height="8" fill="#b9c0c7"/>
           ${panes}
           <rect x="290" y="${H0 - 6}" width="1020" height="6" fill="#8c939a"/>
           <rect x="0" y="${H0 - 10}" width="1600" height="30" fill="#9aa08f"/>
         </g>
         <rect y="${H0 + 20}" width="1600" height="${1180 - H0}" fill="url(#asph)"/>
         <rect y="${H0 + 20}" width="1600" height="${1180 - H0}" filter="url(#asphalt)" opacity="0.9"/>
         <g filter="url(#b2)">${bays}</g>
         <rect y="${H0 + 20}" width="1600" height="200" fill="url(#hazeFloor)"/>
         <rect width="1600" height="1200" fill="url(#vigLight)"/>`,
        `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f6fc0"/><stop offset="0.55" stop-color="#6fa7e2"/><stop offset="1" stop-color="#d4e6f6"/></linearGradient>
         <linearGradient id="pane" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#46637b"/><stop offset="0.5" stop-color="#9bb6cb"/><stop offset="1" stop-color="#3d566b"/></linearGradient>
         <linearGradient id="asph" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7d8086"/><stop offset="0.4" stop-color="#5e6166"/><stop offset="1" stop-color="#44464a"/></linearGradient>
         <linearGradient id="hazeFloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9d3dc" stop-opacity="0.35"/><stop offset="1" stop-color="#c9d3dc" stop-opacity="0"/></linearGradient>`,
      );
    },
  },
  {
    id: 'mountain',
    name: 'Scenic Mountain Overlook',
    desc: 'Paved overlook, hazy mountain ridges, daylight',
    ground: 0.88, maxW: 0.8, maxH: 0.58, reflection: 0, shadow: 0.85, blur: 0, exposure: 0.01,
    svg: (w, h) =>
      svg(
        w,
        h,
        `<rect width="1600" height="760" fill="url(#msky)"/>
         <ellipse cx="1180" cy="120" rx="320" ry="40" fill="#ffffff" opacity="0.5" filter="url(#b30)"/>
         <g filter="url(#b6)">
           <path d="M0,560 C120,500 200,420 330,440 C430,455 470,330 600,320 C720,312 760,420 880,400 C1000,380 1060,280 1200,290 C1330,300 1420,410 1600,380 L1600,700 L0,700 Z" fill="url(#ridge1)"/>
           <path d="M0,610 C160,560 300,520 450,545 C600,570 700,500 860,505 C1020,510 1120,580 1280,560 C1420,545 1520,520 1600,530 L1600,720 L0,720 Z" fill="url(#ridge2)"/>
           <path d="M0,680 C200,640 380,650 560,665 C760,680 900,640 1100,650 C1300,660 1450,640 1600,650 L1600,760 L0,760 Z" fill="url(#ridge3)"/>
         </g>
         <rect y="560" width="1600" height="200" fill="url(#haze)"/>
         <g filter="url(#b2)"><rect y="728" width="1600" height="10" fill="#c9c7c0"/><rect y="742" width="1600" height="6" fill="#8a8c88"/></g>
         <rect y="748" width="1600" height="452" fill="url(#road)"/>
         <rect y="748" width="1600" height="452" filter="url(#asphalt)" opacity="0.85"/>
         <rect y="748" width="1600" height="140" fill="url(#hazeFloor2)"/>
         <rect width="1600" height="1200" fill="url(#vigLight)"/>`,
        `<linearGradient id="msky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3577c7"/><stop offset="0.6" stop-color="#8dbbe7"/><stop offset="1" stop-color="#dcebf7"/></linearGradient>
         <linearGradient id="ridge1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ea3b8"/><stop offset="1" stop-color="#b6c6d4"/></linearGradient>
         <linearGradient id="ridge2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5f7a7a"/><stop offset="1" stop-color="#8099a0"/></linearGradient>
         <linearGradient id="ridge3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#46603f"/><stop offset="1" stop-color="#55704c"/></linearGradient>
         <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3eef7" stop-opacity="0"/><stop offset="1" stop-color="#e3eef7" stop-opacity="0.45"/></linearGradient>
         <linearGradient id="road" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#85878a"/><stop offset="0.5" stop-color="#686a6e"/><stop offset="1" stop-color="#4c4e52"/></linearGradient>
         <linearGradient id="hazeFloor2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe8ef" stop-opacity="0.3"/><stop offset="1" stop-color="#dfe8ef" stop-opacity="0"/></linearGradient>`,
      ),
  },
  {
    id: 'urban-plaza',
    name: 'Urban Glass Plaza',
    desc: 'Concrete pavers, soft-focus glass towers, overcast light',
    ground: 0.87, maxW: 0.8, maxH: 0.58, reflection: 0.05, shadow: 0.75, blur: 0, exposure: 0.01,
    svg: (w, h) => {
      const H0 = 640;
      let towers = '';
      const T: [number, number, number][] = [[-40, 60, 330], [300, 0, 300], [610, 120, 330], [950, 30, 310], [1270, 90, 380]];
      for (const [x, y, tw] of T) {
        towers += `<rect x="${x}" y="${y}" width="${tw}" height="${H0 - y}" fill="url(#tower)"/>`;
        for (let r = y + 18; r < H0; r += 34) towers += `<rect x="${x}" y="${r}" width="${tw}" height="2.5" fill="#5f6e7a" opacity="0.55"/>`;
        for (let c = x + 36; c < x + tw; c += 54) towers += `<rect x="${c}" y="${y}" width="2.5" height="${H0 - y}" fill="#5f6e7a" opacity="0.4"/>`;
        towers += `<rect x="${x + tw * 0.15}" y="${y}" width="${tw * 0.22}" height="${H0 - y}" fill="#ffffff" opacity="0.12"/>`;
      }
      return svg(
        w,
        h,
        `<rect width="1600" height="${H0}" fill="url(#over)"/>
         <g filter="url(#b6)">${towers}<rect x="0" y="${H0 - 70}" width="1600" height="70" fill="#9aa3aa"/></g>
         <rect y="${H0}" width="1600" height="${1200 - H0}" fill="url(#plaza)"/>
         <rect y="${H0}" width="1600" height="${1200 - H0}" filter="url(#concrete)" opacity="0.5"/>
         ${rays(H0, 150, 12, '#7e8387', 2, 0.55)}${rows(H0, 12, '#7e8387', 2, 0.5)}
         <rect y="${H0}" width="1600" height="${1200 - H0}" filter="url(#grain)" opacity="0.3"/>
         <rect y="${H0}" width="1600" height="160" fill="url(#hazeP)"/>
         <rect width="1600" height="1200" fill="url(#vigLight)"/>`,
        `<linearGradient id="over" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8c0c8"/><stop offset="1" stop-color="#e3e7eb"/></linearGradient>
         <linearGradient id="tower" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7f93a3"/><stop offset="0.45" stop-color="#c2d0db"/><stop offset="1" stop-color="#8ea1b0"/></linearGradient>
         <linearGradient id="plaza" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c6c8c9"/><stop offset="0.5" stop-color="#b3b5b7"/><stop offset="1" stop-color="#9c9fa1"/></linearGradient>
         <linearGradient id="hazeP" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3e7eb" stop-opacity="0.5"/><stop offset="1" stop-color="#e3e7eb" stop-opacity="0"/></linearGradient>`,
      );
    },
  },
  {
    id: 'gray-studio',
    name: 'Neutral Gray Studio',
    desc: 'Cool-gray catalog sweep, 3-point light',
    ground: 0.84, maxW: 0.84, maxH: 0.66, reflection: 0.08, shadow: 0.7, blur: 0, exposure: 0.01,
    svg: (w, h) =>
      svg(
        w,
        h,
        `<rect width="1600" height="1200" fill="url(#sweep)"/>
         <ellipse cx="800" cy="380" rx="620" ry="330" fill="url(#key)"/>
         <ellipse cx="120" cy="520" rx="260" ry="420" fill="#ffffff" opacity="0.16" filter="url(#b60)"/>
         <ellipse cx="1480" cy="520" rx="260" ry="420" fill="#ffffff" opacity="0.16" filter="url(#b60)"/>
         <ellipse cx="800" cy="990" rx="700" ry="200" fill="url(#pool)"/>
         <rect width="1600" height="1200" filter="url(#grain)" opacity="0.18"/>
         <rect width="1600" height="1200" fill="url(#vigLight)"/>`,
        `<linearGradient id="sweep" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9ced3"/><stop offset="0.45" stop-color="#d9dde1"/><stop offset="0.66" stop-color="#cfd3d8"/><stop offset="0.74" stop-color="#d6dadf"/><stop offset="1" stop-color="#c4c9ce"/></linearGradient>
         <radialGradient id="key" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffffff" stop-opacity="0.5"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
         <radialGradient id="pool" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffffff" stop-opacity="0.45"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>`,
      ),
  },
];

export const PRESET_MAP = new Map(PRESETS.map((p) => [p.id, p]));

/** layout used for a custom (uploaded) background and for the transparent cut-outs */
export const CUSTOM_LAYOUT: Omit<StudioPreset, 'svg' | 'id' | 'name' | 'desc'> = {
  ground: 0.86, maxW: 0.8, maxH: 0.62, reflection: 0, shadow: 0.75, blur: 0, exposure: 0,
};
export const TRANSPARENT_LAYOUT: Omit<StudioPreset, 'svg' | 'id' | 'name' | 'desc'> = {
  ground: 0.9, maxW: 0.92, maxH: 0.8, reflection: 0, shadow: 0.5, blur: 0, exposure: 0,
};
