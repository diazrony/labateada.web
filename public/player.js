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

function crearFilaRecienteBateo(split) {
  const s = split.stat;
  const urlJuego = split.game?.gamePk
    ? `/game.html?gamePk=${split.game.gamePk}${split.team?.id ? `&team=${split.team.id}` : ''}`
    : null;

  return `
    <tr${urlJuego ? ` class="fila-clicable" onclick="window.location.href='${urlJuego}'"` : ''}>
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

function crearTablaRecientesBateo(id, gameLog) {
  if (!gameLog || gameLog.length === 0) return '<p class="vacio">No recent games.</p>';

  const tablaId = `recientes-bateo-${id}`;
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
    <tr${urlJuego ? ` class="fila-clicable" onclick="window.location.href='${urlJuego}'"` : ''}>
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

function crearTablaRecientesPitcheo(id, gameLog) {
  if (!gameLog || gameLog.length === 0) return '<p class="vacio">No recent games.</p>';

  const tablaId = `recientes-pitcheo-${id}`;
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

function renderPerfil(p, bateo, pitcheo) {
  contenedorPerfil.innerHTML = `
    ${crearEncabezadoPerfil(p)}
    ${
      bateo
        ? `
      <h3 class="subtitulo">Season Hitting Stats</h3>
      ${statsBateoTiles(bateo.season)}
      <h3 class="subtitulo">Recent Games (Hitting)</h3>
      ${crearTablaRecientesBateo(p.id, bateo.gameLog)}
    `
        : ''
    }
    ${
      pitcheo
        ? `
      <h3 class="subtitulo">Season Pitching Stats</h3>
      ${statsPitcheoTiles(pitcheo.season)}
      <h3 class="subtitulo">Recent Games (Pitching)</h3>
      ${crearTablaRecientesPitcheo(p.id, pitcheo.gameLog)}
    `
        : ''
    }
    <h3 class="subtitulo">Batting vs Pitching</h3>
    <div class="splits-grid">
      ${bateo ? `${crearSplitBateo('vs LHP', bateo.vsLeft)}${crearSplitBateo('vs RHP', bateo.vsRight)}` : ''}
      ${pitcheo ? `${crearSplitPitcheo('vs LHB', pitcheo.vsLeft)}${crearSplitPitcheo('vs RHB', pitcheo.vsRight)}` : ''}
    </div>
  `;
}

// Hook consumido por common.js al ordenar una tabla por columna (th-ordenable).
function refrescarVista() {
  if (jugadorActual) renderPerfil(jugadorActual, bateoActual, pitcheoActual);
}

async function cargarPerfil(id) {
  contenedorPerfil.innerHTML = '<p class="estado">Loading player...</p>';

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

    const [bateo, pitcheo] = await Promise.all([
      mostrarBateo ? obtenerStatsGrupo(id, 'hitting', TEMPORADA) : Promise.resolve(null),
      mostrarPitcheo ? obtenerStatsGrupo(id, 'pitching', TEMPORADA) : Promise.resolve(null),
    ]);

    jugadorActual = persona;
    bateoActual = bateo;
    pitcheoActual = pitcheo;
    inputEl.value = persona.fullName;
    document.title = `${persona.fullName} · La Bateada`;

    renderPerfil(persona, bateo, pitcheo);
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
