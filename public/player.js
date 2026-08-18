const TEMPORADA = new Date().getFullYear();

const inputEl = document.getElementById('jugador-input');
const sugerenciasEl = document.getElementById('jugador-sugerencias');
const contenedorPerfil = document.getElementById('perfil-jugador');

let temporizadorBusqueda = null;
let sugerenciasActuales = [];
let indiceSugerencia = -1;

let jugadorActual = null;
let bateoActual = null;
let pitcheoActual = null;
let torneosBateoActual = [];
let torneosPitcheoActual = [];

// Torneos colapsados por el usuario (vacío = todos abiertos por defecto).
// Se guarda por id estable en vez de por índice para que la colapsada
// sobreviva a los re-renders (ej. al ordenar una tabla).
const torneosColapsados = new Set();

async function buscarJugadores(query) {
  try {
    const resp = await fetch(
      `${API_BASE}/people/search?names=${encodeURIComponent(query)}&sportId=1&active=true&hydrate=currentTeam`
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const personas = (data.people ?? []).filter((p) => p.isPlayer).slice(0, 8);
    mostrarSugerencias(personas);
  } catch (err) {
    ocultarSugerencias();
  }
}

function mostrarSugerencias(personas) {
  sugerenciasActuales = personas;
  indiceSugerencia = -1;

  if (personas.length === 0) {
    sugerenciasEl.innerHTML = '<p class="vacio" style="padding:0.75rem 1rem">No players found.</p>';
    sugerenciasEl.hidden = false;
    return;
  }

  sugerenciasEl.innerHTML = personas
    .map(
      (p, i) => `
    <button type="button" class="sugerencia-item" data-index="${i}">
      <img class="sugerencia-foto" src="${fotoJugador(p.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <span class="sugerencia-info">
        <span class="sugerencia-nombre">${p.fullName}</span>
        <span class="sugerencia-meta">
          ${
            p.currentTeam
              ? `<img class="logo logo-sm" src="${logoEquipo(p.currentTeam.id)}" alt="" loading="lazy">${p.currentTeam.name}`
              : 'Free agent'
          }
          · ${p.primaryPosition?.abbreviation ?? ''}
        </span>
      </span>
    </button>
  `
    )
    .join('');

  sugerenciasEl.querySelectorAll('.sugerencia-item').forEach((el, i) => {
    el.addEventListener('click', () => seleccionarJugador(sugerenciasActuales[i]));
  });

  sugerenciasEl.hidden = false;
}

function ocultarSugerencias() {
  sugerenciasEl.hidden = true;
  sugerenciasEl.innerHTML = '';
  sugerenciasActuales = [];
  indiceSugerencia = -1;
}

function moverSeleccion(delta) {
  const items = [...sugerenciasEl.querySelectorAll('.sugerencia-item')];
  if (items.length === 0) return;

  items[indiceSugerencia]?.classList.remove('activo');
  indiceSugerencia = (indiceSugerencia + delta + items.length) % items.length;
  items[indiceSugerencia].classList.add('activo');
  items[indiceSugerencia].scrollIntoView({ block: 'nearest' });
}

function seleccionarJugador(persona) {
  inputEl.value = persona.fullName;
  ocultarSugerencias();

  const url = new URL(window.location);
  url.searchParams.set('id', persona.id);
  window.history.pushState({}, '', url);

  cargarPerfil(persona.id);
}

inputEl.addEventListener('input', () => {
  clearTimeout(temporizadorBusqueda);
  const query = inputEl.value.trim();
  if (query.length < 2) {
    ocultarSugerencias();
    return;
  }
  temporizadorBusqueda = setTimeout(() => buscarJugadores(query), 300);
});

inputEl.addEventListener('keydown', (event) => {
  if (sugerenciasEl.hidden) return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moverSeleccion(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moverSeleccion(-1);
  } else if (event.key === 'Enter') {
    if (indiceSugerencia >= 0) {
      event.preventDefault();
      seleccionarJugador(sugerenciasActuales[indiceSugerencia]);
    }
  } else if (event.key === 'Escape') {
    ocultarSugerencias();
  }
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.buscador-jugador')) ocultarSugerencias();
});

async function obtenerJugador(id) {
  const resp = await fetch(`${API_BASE}/people/${id}?hydrate=currentTeam`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  return data.people?.[0] ?? null;
}

async function obtenerStatsGrupo(id, grupo, temporada) {
  const [respStats, respSplits] = await Promise.all([
    fetch(`${API_BASE}/people/${id}/stats?stats=season,gameLog&group=${grupo}&season=${temporada}&sportId=1`),
    fetch(`${API_BASE}/people/${id}/stats?stats=statSplits&group=${grupo}&sitCodes=vl,vr&season=${temporada}&sportId=1`),
  ]);
  if (!respStats.ok) throw new Error(`HTTP ${respStats.status}`);
  if (!respSplits.ok) throw new Error(`HTTP ${respSplits.status}`);

  const datosStats = await respStats.json();
  const datosSplits = await respSplits.json();

  const season = datosStats.stats?.find((s) => s.type.displayName === 'season')?.splits?.[0]?.stat ?? null;
  const gameLog = (datosStats.stats?.find((s) => s.type.displayName === 'gameLog')?.splits ?? [])
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10);
  const splits = datosSplits.stats?.[0]?.splits ?? [];

  return {
    season,
    gameLog,
    vsLeft: splits.find((s) => s.split?.code === 'vl')?.stat ?? null,
    vsRight: splits.find((s) => s.split?.code === 'vr')?.stat ?? null,
  };
}

// sportId 51 ("International Baseball") es donde la MLB Stats API agrupa toda
// la actividad con selecciones nacionales de jugadores de MLB (Clásico Mundial,
// Juegos Olímpicos, series de exhibición): un mismo jugador puede aparecer bajo
// distintos gameType según la etapa (R exhibición, F fase de grupos del Clásico,
// D/L/W sus rondas eliminatorias). Se listan como códigos "hoja": el código
// agregado "P" (Postseason) hace que la API devuelva duplicados de D/L/W/F.
const GAME_TYPES_INTERNACIONAL = ['R', 'F', 'D', 'L', 'W', 'E', 'S', 'A', 'C'];

function queryGameTypes() {
  return GAME_TYPES_INTERNACIONAL.map((t) => `gameType=${t}`).join('&');
}

function sumarEntradasLanzadas(valores) {
  const outsTotal = valores.reduce((acc, ip) => {
    const [enteros, tercios] = String(ip ?? '0.0').split('.');
    return acc + Number(enteros) * 3 + Number(tercios ?? '0');
  }, 0);
  return `${Math.floor(outsTotal / 3)}.${outsTotal % 3}`;
}

function formatoPromedio(valor) {
  if (!Number.isFinite(valor)) return '.000';
  const fijo = valor.toFixed(3);
  return valor >= 1 ? fijo : fijo.replace(/^0/, '');
}

function agregarStatsBateo(partidos) {
  const s = partidos.reduce(
    (acc, split) => {
      const st = split.stat;
      acc.atBats += Number(st.atBats) || 0;
      acc.hits += Number(st.hits) || 0;
      acc.runs += Number(st.runs) || 0;
      acc.homeRuns += Number(st.homeRuns) || 0;
      acc.rbi += Number(st.rbi) || 0;
      acc.baseOnBalls += Number(st.baseOnBalls) || 0;
      acc.strikeOuts += Number(st.strikeOuts) || 0;
      acc.stolenBases += Number(st.stolenBases) || 0;
      acc.hitByPitch += Number(st.hitByPitch) || 0;
      acc.sacFlies += Number(st.sacFlies) || 0;
      acc.totalBases += Number(st.totalBases) || 0;
      return acc;
    },
    { atBats: 0, hits: 0, runs: 0, homeRuns: 0, rbi: 0, baseOnBalls: 0, strikeOuts: 0, stolenBases: 0, hitByPitch: 0, sacFlies: 0, totalBases: 0 }
  );

  const obpDen = s.atBats + s.baseOnBalls + s.hitByPitch + s.sacFlies;
  const obp = obpDen > 0 ? (s.hits + s.baseOnBalls + s.hitByPitch) / obpDen : 0;
  const slg = s.atBats > 0 ? s.totalBases / s.atBats : 0;

  return {
    ...s,
    avg: formatoPromedio(s.atBats > 0 ? s.hits / s.atBats : 0),
    obp: formatoPromedio(obp),
    slg: formatoPromedio(slg),
    ops: formatoPromedio(obp + slg),
    gamesPlayed: partidos.length,
  };
}

function agregarStatsPitcheo(partidos) {
  const s = partidos.reduce(
    (acc, split) => {
      const st = split.stat;
      acc.hits += Number(st.hits) || 0;
      acc.runs += Number(st.runs) || 0;
      acc.earnedRuns += Number(st.earnedRuns) || 0;
      acc.baseOnBalls += Number(st.baseOnBalls) || 0;
      acc.strikeOuts += Number(st.strikeOuts) || 0;
      acc.wins += Number(st.wins) || 0;
      acc.losses += Number(st.losses) || 0;
      acc.saves += Number(st.saves) || 0;
      acc.ipList.push(st.inningsPitched);
      return acc;
    },
    { hits: 0, runs: 0, earnedRuns: 0, baseOnBalls: 0, strikeOuts: 0, wins: 0, losses: 0, saves: 0, ipList: [] }
  );

  const inningsPitched = sumarEntradasLanzadas(s.ipList);
  const [entIP, terIP] = inningsPitched.split('.').map(Number);
  const ipDecimal = entIP + terIP / 3;

  return {
    ...s,
    inningsPitched,
    era: ipDecimal > 0 ? (s.earnedRuns * 9 / ipDecimal).toFixed(2) : '0.00',
    whip: ipDecimal > 0 ? ((s.hits + s.baseOnBalls) / ipDecimal).toFixed(2) : '0.00',
    gamesPlayed: partidos.length,
    gamesStarted: partidos.filter((split) => Number(split.stat.gamesStarted) === 1).length,
  };
}

// Agrupa los game logs internacionales por (temporada, torneo, selección), ya
// que un mismo jugador puede sumar apariciones con distinto gameType dentro
// del mismo torneo (ej. fase de grupos y eliminatorias del Clásico Mundial).
function agruparTorneos(partidosConDuplicados) {
  // La API a veces repite el mismo juego bajo más de un gameType; se
  // deduplica por gamePk (o fecha, si el juego no trae gamePk).
  const vistos = new Set();
  const partidos = partidosConDuplicados.filter((split) => {
    const clave = split.game?.gamePk ?? `${split.date}-${split.team?.id}`;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });

  const grupos = new Map();

  partidos.forEach((split) => {
    const clave = `${split.season}-${split.league?.id ?? 'na'}-${split.team?.id ?? 'na'}`;
    if (!grupos.has(clave)) {
      grupos.set(clave, { season: split.season, league: split.league, team: split.team, partidos: [] });
    }
    grupos.get(clave).partidos.push(split);
  });

  return [...grupos.values()]
    .map((torneo) => ({ ...torneo, partidos: torneo.partidos.slice().sort((a, b) => new Date(b.date) - new Date(a.date)) }))
    .sort((a, b) => Number(b.season) - Number(a.season));
}

async function obtenerParticipacionesInternacionales(id, grupo) {
  const respYearByYear = await fetch(
    `${API_BASE}/people/${id}/stats?stats=yearByYear&group=${grupo}&sportId=51&${queryGameTypes()}`
  );
  if (!respYearByYear.ok) throw new Error(`HTTP ${respYearByYear.status}`);
  const datosYearByYear = await respYearByYear.json();
  const splitsAnuales = datosYearByYear.stats?.find((s) => s.type.displayName === 'yearByYear')?.splits ?? [];
  const temporadas = [...new Set(splitsAnuales.map((s) => s.season))];

  if (temporadas.length === 0) return [];

  const respuestasGameLog = await Promise.all(
    temporadas.map((temporada) =>
      fetch(`${API_BASE}/people/${id}/stats?stats=gameLog&group=${grupo}&sportId=51&season=${temporada}&${queryGameTypes()}`)
    )
  );
  const listasPartidos = await Promise.all(
    respuestasGameLog.map(async (resp) => {
      if (!resp.ok) return [];
      const datos = await resp.json();
      return datos.stats?.find((s) => s.type.displayName === 'gameLog')?.splits ?? [];
    })
  );

  return agruparTorneos(listasPartidos.flat());
}

function crearEncabezadoPerfil(p) {
  const equipo = p.currentTeam;
  const bandera = banderaUrl(p.birthCountry);

  return `
    <div class="perfil-encabezado">
      <img class="perfil-foto" src="${fotoJugadorGrande(p.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="perfil-info">
        <h2 class="perfil-nombre">
          ${p.fullName}
          ${p.primaryNumber ? `<span class="perfil-numero">#${p.primaryNumber}</span>` : ''}
        </h2>
        <div class="perfil-meta">
          ${
            equipo
              ? `<span class="perfil-equipo"><img class="logo logo-sm" src="${logoEquipo(equipo.id)}" alt="" loading="lazy">${equipo.name}</span>`
              : '<span class="equipo-registro-item">Free agent</span>'
          }
          ${p.primaryPosition?.name ? `<span class="equipo-registro-item">${p.primaryPosition.name}</span>` : ''}
          ${p.batSide ? `<span class="equipo-registro-item">Bats: ${p.batSide.code}</span>` : ''}
          ${p.pitchHand ? `<span class="equipo-registro-item">Throws: ${p.pitchHand.code}</span>` : ''}
          ${p.currentAge ? `<span class="equipo-registro-item">Age ${p.currentAge}</span>` : ''}
          ${
            bandera
              ? `<span class="equipo-registro-item"><img class="perfil-bandera" src="${bandera}" alt="" loading="lazy" onerror="this.style.display='none'"> ${p.birthCountry}</span>`
              : ''
          }
        </div>
      </div>
    </div>
  `;
}

function crearStatsGrid(stats) {
  return `
    <div class="stat-grid">
      ${stats
        .map(
          ([etiqueta, valor]) => `
        <div class="stat-tile" title="${TOOLTIPS_STATS[etiqueta] ?? etiqueta}">
          <span class="stat-valor">${valor ?? '—'}</span>
          <span class="stat-etiqueta">${etiqueta}</span>
        </div>
      `
        )
        .join('')}
    </div>
  `;
}

function statsBateoTiles(s) {
  if (!s) return '<p class="vacio">No hitting stats yet this season.</p>';
  return crearStatsGrid([
    ['AVG', s.avg],
    ['OBP', s.obp],
    ['SLG', s.slg],
    ['OPS', s.ops],
    ['HR', s.homeRuns],
    ['RBI', s.rbi],
    ['H', s.hits],
    ['R', s.runs],
    ['SB', s.stolenBases],
    ['BB', s.baseOnBalls],
    ['SO', s.strikeOuts],
    ['G', s.gamesPlayed],
  ]);
}

function statsPitcheoTiles(s) {
  if (!s) return '<p class="vacio">No pitching stats yet this season.</p>';
  return crearStatsGrid([
    ['ERA', s.era],
    ['W-L', `${s.wins}-${s.losses}`],
    ['SV', s.saves],
    ['WHIP', s.whip],
    ['IP', s.inningsPitched],
    ['SO', s.strikeOuts],
    ['BB', s.baseOnBalls],
    ['H', s.hits],
    ['G', s.gamesPlayed],
    ['GS', s.gamesStarted],
  ]);
}

// URL de vuelta hacia este perfil (ver urlRetorno en game.js): se recalcula
// en el momento del click en vez de dejarla fija en el href, para que el
// scroll guardado sea el real al momento de irse, no el que había al
// renderizar la fila.
function urlRetornoJugador() {
  const q = new URLSearchParams({ id: jugadorActual.id });
  q.set('scroll', Math.round(window.scrollY));
  return construirUrlConRetorno(`/player.html?${q.toString()}`, retornoDesdeURL());
}

function irAJuego(event, urlBase) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  window.location.href = construirUrlConRetorno(urlBase, urlRetornoJugador());
}

function crearFilaRecienteBateo(split) {
  const s = split.stat;
  const urlJuego = split.game?.gamePk
    ? `/game.html?gamePk=${split.game.gamePk}${split.team?.id ? `&team=${split.team.id}` : ''}`
    : null;

  return `
    <tr${urlJuego ? ` class="fila-clicable" onclick="irAJuego(event, '${urlJuego}')"` : ''}>
      <td>${formatoFechaCorta(split.date)}</td>
      <td class="nombre-jugador">${split.opponent?.id ? `<img class="logo logo-sm" src="${logoEquipo(split.opponent.id)}" alt="${split.opponent.name}" title="${split.opponent.name}" loading="lazy">` : ''}</td>
      <td>${s.atBats}</td>
      <td>${s.runs}</td>
      <td>${s.hits}</td>
      <td>${s.homeRuns}</td>
      <td>${s.rbi}</td>
      <td>${s.baseOnBalls}</td>
      <td>${s.strikeOuts}</td>
    </tr>
  `;
}

function crearTablaRecientesBateo(tablaId, gameLog) {
  if (!gameLog || gameLog.length === 0) return '<p class="vacio">No recent games.</p>';

  const columnas = ['Date', 'Opp', 'AB', 'R', 'H', 'HR', 'RBI', 'BB', 'SO'];
  const filas = ordenarFilas(tablaId, gameLog, (split) => {
    const s = split.stat;
    return [split.date, split.opponent?.name ?? '', s.atBats, s.runs, s.hits, s.homeRuns, s.rbi, s.baseOnBalls, s.strikeOuts];
  });

  return `
    <div class="boxscore-wrap">
      <table class="tabla-stats tabla-abridor">
        <thead><tr>${crearEncabezadoOrdenable(tablaId, columnas)}</tr></thead>
        <tbody>${filas.map(crearFilaRecienteBateo).join('')}</tbody>
      </table>
    </div>
  `;
}

function crearFilaRecientePitcheo(split) {
  const s = split.stat;
  const esAbridor = Number(s.gamesStarted) === 1;
  const decision = s.wins === 1 ? 'W' : s.losses === 1 ? 'L' : s.saves === 1 ? 'SV' : '—';
  const urlJuego = split.game?.gamePk
    ? `/game.html?gamePk=${split.game.gamePk}${split.team?.id ? `&team=${split.team.id}` : ''}`
    : null;

  return `
    <tr${urlJuego ? ` class="fila-clicable" onclick="irAJuego(event, '${urlJuego}')"` : ''}>
      <td>${formatoFechaCorta(split.date)}</td>
      <td class="nombre-jugador">${split.opponent?.id ? `<img class="logo logo-sm" src="${logoEquipo(split.opponent.id)}" alt="${split.opponent.name}" title="${split.opponent.name}" loading="lazy">` : ''}</td>
      <td><span class="rol-badge ${esAbridor ? 'rol-abridor' : 'rol-relevo'}">${esAbridor ? 'SP' : 'RP'}</span></td>
      <td>${s.inningsPitched}</td>
      <td>${s.hits}</td>
      <td>${s.runs}</td>
      <td>${s.earnedRuns}</td>
      <td>${s.baseOnBalls}</td>
      <td>${s.strikeOuts}</td>
      <td>${decision}</td>
    </tr>
  `;
}

function crearTablaRecientesPitcheo(tablaId, gameLog) {
  if (!gameLog || gameLog.length === 0) return '<p class="vacio">No recent games.</p>';

  const columnas = ['Date', 'Opp', 'Role', 'IP', 'H', 'R', 'ER', 'BB', 'K', 'Dec'];
  const filas = ordenarFilas(tablaId, gameLog, (split) => {
    const s = split.stat;
    const esAbridor = Number(s.gamesStarted) === 1;
    const decision = s.wins === 1 ? 'W' : s.losses === 1 ? 'L' : s.saves === 1 ? 'SV' : '';
    return [split.date, split.opponent?.name ?? '', esAbridor ? 'SP' : 'RP', s.inningsPitched, s.hits, s.runs, s.earnedRuns, s.baseOnBalls, s.strikeOuts, decision];
  });

  return `
    <div class="boxscore-wrap">
      <table class="tabla-stats tabla-abridor">
        <thead><tr>${crearEncabezadoOrdenable(tablaId, columnas)}</tr></thead>
        <tbody>${filas.map(crearFilaRecientePitcheo).join('')}</tbody>
      </table>
    </div>
  `;
}

function crearSplitBateo(titulo, s) {
  if (!s) return `<div class="split-card"><p class="split-titulo">${titulo}</p><p class="vacio">No data.</p></div>`;
  return `
    <div class="split-card">
      <p class="split-titulo">${titulo}</p>
      ${crearStatsGrid([
        ['AVG', s.avg],
        ['OBP', s.obp],
        ['SLG', s.slg],
        ['OPS', s.ops],
        ['HR', s.homeRuns],
        ['SO', s.strikeOuts],
      ])}
    </div>
  `;
}

function crearSplitPitcheo(titulo, s) {
  if (!s) return `<div class="split-card"><p class="split-titulo">${titulo}</p><p class="vacio">No data.</p></div>`;
  return `
    <div class="split-card">
      <p class="split-titulo">${titulo}</p>
      ${crearStatsGrid([
        ['AVG', s.avg],
        ['OBP', s.obp],
        ['WHIP', s.whip],
        ['IP', s.inningsPitched],
        ['SO', s.strikeOuts],
        ['BB', s.baseOnBalls],
      ])}
    </div>
  `;
}

function idTorneo(tipo, torneo) {
  return `${tipo}-${torneo.season}-${torneo.league?.id ?? 'na'}-${torneo.team?.id ?? 'na'}`;
}

// Colapsa/expande una tarjeta de torneo sin perder el resto del estado de la
// vista (re-renderiza vía refrescarVista, igual que al ordenar una tabla).
function alternarTorneo(id) {
  if (torneosColapsados.has(id)) torneosColapsados.delete(id);
  else torneosColapsados.add(id);
  refrescarVista();
}

function crearTarjetaTorneo(personaId, tipo, torneo) {
  const equipo = torneo.team;
  const id = idTorneo(tipo, torneo);
  const abierto = !torneosColapsados.has(id);
  const stats = tipo === 'bateo' ? agregarStatsBateo(torneo.partidos) : agregarStatsPitcheo(torneo.partidos);
  const tablaId = `torneo-${tipo}-${personaId}-${torneo.season}-${torneo.league?.id ?? 'na'}-${equipo?.id ?? 'na'}`;
  const tablaHtml =
    tipo === 'bateo' ? crearTablaRecientesBateo(tablaId, torneo.partidos) : crearTablaRecientesPitcheo(tablaId, torneo.partidos);

  return `
    <div class="torneo-card">
      <button type="button" class="torneo-cabecera" onclick="alternarTorneo('${id}')" aria-expanded="${abierto}">
        ${equipo ? `<img class="logo logo-sm" src="${logoEquipo(equipo.id)}" alt="" loading="lazy">` : ''}
        <span class="torneo-info">
          <span class="torneo-titulo">${torneo.league?.name ?? 'International'} · ${torneo.season}</span>
          ${equipo ? `<span class="torneo-subtitulo">${equipo.name}</span>` : ''}
        </span>
        <svg class="torneo-flecha ${abierto ? 'torneo-flecha-abierta' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6"></path>
        </svg>
      </button>
      ${abierto ? `${tipo === 'bateo' ? statsBateoTiles(stats) : statsPitcheoTiles(stats)}${tablaHtml}` : ''}
    </div>
  `;
}

function crearSeccionTorneos(personaId, torneosBateo, torneosPitcheo) {
  const tarjetas = [
    ...torneosBateo.map((t) => crearTarjetaTorneo(personaId, 'bateo', t)),
    ...torneosPitcheo.map((t) => crearTarjetaTorneo(personaId, 'pitcheo', t)),
  ];

  return `
    <h3 class="subtitulo">National Team &amp; Tournaments</h3>
    ${
      tarjetas.length === 0
        ? '<p class="vacio">No international tournament appearances found.</p>'
        : `<div class="torneos-lista">${tarjetas.join('')}</div>`
    }
  `;
}

function renderPerfil(p, bateo, pitcheo, torneosBateo, torneosPitcheo) {
  contenedorPerfil.innerHTML = `
    ${crearEncabezadoPerfil(p)}
    ${
      bateo
        ? `
      <h3 class="subtitulo">Season Hitting Stats</h3>
      ${statsBateoTiles(bateo.season)}
      <h3 class="subtitulo">Recent Games (Hitting)</h3>
      ${crearTablaRecientesBateo(`recientes-bateo-${p.id}`, bateo.gameLog)}
    `
        : ''
    }
    ${
      pitcheo
        ? `
      <h3 class="subtitulo">Season Pitching Stats</h3>
      ${statsPitcheoTiles(pitcheo.season)}
      <h3 class="subtitulo">Recent Games (Pitching)</h3>
      ${crearTablaRecientesPitcheo(`recientes-pitcheo-${p.id}`, pitcheo.gameLog)}
    `
        : ''
    }
    <h3 class="subtitulo">Batting vs Pitching</h3>
    <div class="splits-grid">
      ${bateo ? `${crearSplitBateo('vs LHP', bateo.vsLeft)}${crearSplitBateo('vs RHP', bateo.vsRight)}` : ''}
      ${pitcheo ? `${crearSplitPitcheo('vs LHB', pitcheo.vsLeft)}${crearSplitPitcheo('vs RHB', pitcheo.vsRight)}` : ''}
    </div>
    ${crearSeccionTorneos(p.id, torneosBateo, torneosPitcheo)}
  `;
}

// Hook consumido por common.js al ordenar una tabla por columna (th-ordenable).
function refrescarVista() {
  if (jugadorActual) renderPerfil(jugadorActual, bateoActual, pitcheoActual, torneosBateoActual, torneosPitcheoActual);
}

// Soporta llegar acá como destino de un link "de vuelta" (ver urlRetornoJugador
// más arriba): restaura el scroll con que se dejó el perfil.
let scrollGuardadoPendiente = null;

function aplicarParametrosURL() {
  const scroll = new URLSearchParams(window.location.search).get('scroll');
  scrollGuardadoPendiente = scroll !== null ? Number(scroll) : null;
}

async function cargarPerfil(id) {
  contenedorPerfil.innerHTML = '<p class="estado">Loading player...</p>';
  aplicarParametrosURL();

  try {
    const persona = await obtenerJugador(id);
    if (!persona) {
      contenedorPerfil.innerHTML = '<p class="estado">Player not found.</p>';
      return;
    }

    const esPitcher = persona.primaryPosition?.type === 'Pitcher';
    const esDosVias = persona.primaryPosition?.type === 'Two-Way Player';
    const mostrarBateo = !esPitcher;
    const mostrarPitcheo = esPitcher || esDosVias;

    const [bateo, pitcheo, torneosBateo, torneosPitcheo] = await Promise.all([
      mostrarBateo ? obtenerStatsGrupo(id, 'hitting', TEMPORADA) : Promise.resolve(null),
      mostrarPitcheo ? obtenerStatsGrupo(id, 'pitching', TEMPORADA) : Promise.resolve(null),
      mostrarBateo ? obtenerParticipacionesInternacionales(id, 'hitting') : Promise.resolve([]),
      mostrarPitcheo ? obtenerParticipacionesInternacionales(id, 'pitching') : Promise.resolve([]),
    ]);

    jugadorActual = persona;
    bateoActual = bateo;
    pitcheoActual = pitcheo;
    torneosBateoActual = torneosBateo;
    torneosPitcheoActual = torneosPitcheo;
    inputEl.value = persona.fullName;
    document.title = `${persona.fullName} · La Bateada`;

    renderPerfil(persona, bateo, pitcheo, torneosBateo, torneosPitcheo);

    if (Number.isFinite(scrollGuardadoPendiente)) {
      window.scrollTo(0, scrollGuardadoPendiente);
      scrollGuardadoPendiente = null;
    }
  } catch (err) {
    contenedorPerfil.innerHTML = `
      <p class="estado">
        Error loading player: ${err.message}
        <br><button type="button" class="retry-btn" onclick="cargarPerfil(${id})">Retry</button>
      </p>
    `;
  }
}

function idJugadorDesdeURL() {
  const raw = new URLSearchParams(window.location.search).get('id');
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

// Si se llegó acá desde un link "de vuelta" (ver urlRetorno/construirUrlConRetorno
// en game-detail.js, ej. clickeando un jugador en Top Hitters), muestra el
// botón Back apuntando a esa URL, que restaura la tarjeta y el scroll de origen.
function configurarBotonVolver() {
  const nav = document.getElementById('jugador-nav');
  const retorno = retornoDesdeURL();
  if (retorno) {
    document.getElementById('volver').href = retorno;
    nav.hidden = false;
  } else {
    nav.hidden = true;
  }
}

window.addEventListener('popstate', () => {
  const id = idJugadorDesdeURL();
  if (id !== null) cargarPerfil(id);
});

configurarBotonVolver();
const idInicial = idJugadorDesdeURL();
if (idInicial !== null) cargarPerfil(idInicial);
