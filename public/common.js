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

function crearTablaJugadores(jugadores, columnas, crearFila) {
  if (jugadores.length === 0) {
    return '<p class="vacio">No data yet.</p>';
  }

  return `
    <div class="boxscore-wrap">
      <table class="tabla-stats">
        <thead>
          <tr><th></th><th>Player</th>${columnas.map((c) => `<th>${c}</th>`).join('')}</tr>
        </thead>
        <tbody>${jugadores.map(crearFila).join('')}</tbody>
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
