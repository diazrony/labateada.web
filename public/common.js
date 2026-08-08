const API_BASE = 'https://statsapi.mlb.com/api/v1';

const MAPA_PAISES = {
  USA: 'us',
  'Dominican Republic': 'do',
  Venezuela: 've',
  'Puerto Rico': 'pr',
  Cuba: 'cu',
  Mexico: 'mx',
  Japan: 'jp',
  'South Korea': 'kr',
  Canada: 'ca',
  Colombia: 'co',
  Panama: 'pa',
  Curacao: 'cw',
  Netherlands: 'nl',
  Nicaragua: 'ni',
  Australia: 'au',
  Germany: 'de',
  Brazil: 'br',
  Bahamas: 'bs',
  Aruba: 'aw',
  Honduras: 'hn',
  Taiwan: 'tw',
  China: 'cn',
  'United Kingdom': 'gb',
  'South Africa': 'za',
  Italy: 'it',
  France: 'fr',
  Jamaica: 'jm',
  Belize: 'bz',
  Guam: 'gu',
  'US Virgin Islands': 'vi',
  'Czech Republic': 'cz',
  Israel: 'il',
  Spain: 'es',
  Poland: 'pl',
  'Saudi Arabia': 'sa',
  India: 'in',
  Singapore: 'sg',
  Indonesia: 'id',
  Sweden: 'se',
  Ireland: 'ie',
  Vietnam: 'vn',
  Ecuador: 'ec',
  Guatemala: 'gt',
  'El Salvador': 'sv',
  'Costa Rica': 'cr',
  Argentina: 'ar',
  Chile: 'cl',
  Peru: 'pe',
  Portugal: 'pt',
  Slovakia: 'sk',
  Lithuania: 'lt',
};

function logoEquipo(teamId) {
  return `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
}

function fotoJugador(personId) {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/w_60,q_100/v1/people/${personId}/headshot/67/current`;
}

function banderaUrl(pais) {
  const codigo = MAPA_PAISES[pais];
  return codigo ? `https://flagcdn.com/w40/${codigo}.png` : null;
}

const TOOLTIPS_STATS = {
  G: 'Games Played',
  AB: 'At Bats',
  R: 'Runs',
  H: 'Hits',
  HR: 'Home Runs',
  RBI: 'Runs Batted In',
  BB: 'Walks (Base on Balls)',
  SO: 'Strikeouts',
  K: 'Strikeouts',
  AVG: 'Batting Average',
  OPS: 'On-base Plus Slugging',
  IP: 'Innings Pitched',
  ER: 'Earned Runs',
  ERA: 'Earned Run Average',
  Opp: 'Opponent',
  Role: 'Starter or Bullpen role',
  Dec: 'Decision (Win, Loss or Save)',
  Date: 'Game Date',
};

// Estado de orden por tabla: la clave es un id estable por tabla (ej. gamePk +
// equipo) para que el orden elegido sobreviva a los re-renders del contenedor.
const sortStateTablas = new Map();

function valorOrdenable(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? String(v).toLowerCase() : n;
}

function ordenarFilas(tablaId, filas, obtenerValores) {
  const estado = sortStateTablas.get(tablaId);
  if (!estado || !obtenerValores) return filas;

  return filas
    .map((fila, indice) => ({ fila, indice, valores: obtenerValores(fila) }))
    .sort((a, b) => {
      const va = valorOrdenable(a.valores[estado.columna]);
      const vb = valorOrdenable(b.valores[estado.columna]);
      let cmp;
      if (va === null && vb === null) cmp = a.indice - b.indice;
      else if (va === null) cmp = 1;
      else if (vb === null) cmp = -1;
      else if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb));
      return estado.asc ? cmp : -cmp;
    })
    .map((x) => x.fila);
}

// Se llama desde el onclick de un <th>; el refresco real de la vista lo hace
// refrescarVista(), que cada página define apuntando a su propio render.
function ordenarTabla(event, tablaId, columna) {
  event.stopPropagation();
  const actual = sortStateTablas.get(tablaId);
  sortStateTablas.set(
    tablaId,
    actual && actual.columna === columna ? { columna, asc: !actual.asc } : { columna, asc: true }
  );
  if (typeof refrescarVista === 'function') refrescarVista();
}

function crearEncabezadoOrdenable(tablaId, columnas) {
  const estado = sortStateTablas.get(tablaId);
  return columnas
    .map((c, i) => {
      const activa = estado?.columna === i;
      const flecha = activa ? (estado.asc ? ' ▲' : ' ▼') : '';
      const tooltip = TOOLTIPS_STATS[c] ?? c;
      return `<th class="th-ordenable ${activa ? 'th-activo' : ''}" title="${tooltip}" onclick="ordenarTabla(event, '${tablaId}', ${i})">${c}${flecha}</th>`;
    })
    .join('');
}

function crearTablaJugadores(tablaId, jugadores, columnas, crearFila, obtenerValores) {
  if (jugadores.length === 0) {
    return '<p class="vacio">No data yet.</p>';
  }

  const filasOrdenadas = ordenarFilas(tablaId, jugadores, obtenerValores);

  return `
    <div class="boxscore-wrap">
      <table class="tabla-stats">
        <thead>
          <tr><th></th><th>Player</th>${crearEncabezadoOrdenable(tablaId, columnas)}</tr>
        </thead>
        <tbody>${filasOrdenadas.map(crearFila).join('')}</tbody>
      </table>
    </div>
  `;
}

function ordinal(n) {
  if (!Number.isFinite(n)) return `${n}`;
  const resto100 = n % 100;
  if (resto100 >= 11 && resto100 <= 13) return `${n}th`;
  const resto10 = n % 10;
  if (resto10 === 1) return `${n}st`;
  if (resto10 === 2) return `${n}nd`;
  if (resto10 === 3) return `${n}rd`;
  return `${n}th`;
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.error('SW registration failed:', err));
  });
}
