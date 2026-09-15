const TEMPORADA = new Date().getFullYear();

const SECCIONES_EQUIPO = [
  { id: 'roster', etiqueta: 'Roster' },
  { id: 'ultimos', etiqueta: 'Last 10 Games' },
  { id: 'bateadores', etiqueta: 'Top Hitters vs Team' },
  { id: 'pitchers', etiqueta: 'Top K Pitchers vs Team' },
];

let registros = new Map();
let equipoActual = null;
let registroActual = null;
let rosterActual = null;
let seccionActiva = 'roster';
let scrollGuardadoPendiente = null;

const cacheRosterActivo = new Map();
const cacheTopBateadores = new Map();
const cacheTopPitchers = new Map();
const cacheUltimosPartidos = new Map();
const partidosMostrados = new Map();
const PARTIDOS_POR_PAGINA = 10;

function trocear(arr, tam) {
  const resultado = [];
  for (let i = 0; i < arr.length; i += tam) resultado.push(arr.slice(i, i + tam));
  return resultado;
}

// --- Roster con edad / posiciones / nacionalidad / stats --------------------

// El roster activo no trae edad ni país de nacimiento; las posiciones que
// puede jugar cada jugador tampoco vienen en la entrada de roster (sólo su
// posición actual). Se completa todo en un solo batch de /people hidratando
// fielding (posiciones jugadas), hitting y pitching de la temporada: cada
// posición en la que sumó entradas esa temporada aparece como un split
// separado, y hitting/pitching sólo aparecen si el jugador tiene stats en ese
// grupo (los bateadores no traen grupo "pitching" y viceversa).
async function obtenerRosterDetallado(teamId, temporada) {
  const respRoster = await fetch(`${API_BASE}/teams/${teamId}/roster?rosterType=active`);
  if (!respRoster.ok) throw new Error(`HTTP ${respRoster.status}`);
  const datosRoster = await respRoster.json();
  const roster = datosRoster.roster ?? [];
  if (roster.length === 0) return [];

  const lotes = trocear(roster.map((j) => j.person.id), 45);
  const respuestas = await Promise.all(
    lotes.map((lote) =>
      fetch(
        `${API_BASE}/people?personIds=${lote.join(',')}&hydrate=stats(group=[hitting,pitching,fielding],type=[season],season=${temporada})`
      ).then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
      })
    )
  );

  const personaPorId = new Map(respuestas.flatMap((d) => d.people ?? []).map((p) => [p.id, p]));

  return roster
    .map((entrada) => {
      const persona = personaPorId.get(entrada.person.id);
      if (!persona) return null;

      const statsGrupo = (grupo) => persona.stats?.find((s) => s.group?.displayName === grupo)?.splits ?? [];
      const statGrupo = (grupo) => statsGrupo(grupo)[0]?.stat ?? null;

      const posiciones = [...new Set(statsGrupo('fielding').map((s) => s.position?.abbreviation).filter(Boolean))];
      if (posiciones.length === 0 && persona.primaryPosition?.abbreviation) {
        posiciones.push(persona.primaryPosition.abbreviation);
      }

      // Los jugadores de dos vías (ej. Ohtani) traen position.type "Two-Way
      // Player" en la entrada de roster: se consideran pitcher y bateador a
      // la vez, así aparecen en ambas tablas.
      const tipoPosicion = entrada.position?.type;

      return {
        id: persona.id,
        nombre: persona.fullName,
        numero: entrada.jerseyNumber || persona.primaryNumber || null,
        posiciones,
        edad: persona.currentAge ?? null,
        pais: persona.birthCountry ?? null,
        bateo: persona.batSide?.code ?? null,
        lanza: persona.pitchHand?.code ?? null,
        esPitcher: tipoPosicion === 'Pitcher' || tipoPosicion === 'Two-Way Player',
        esBateador: tipoPosicion !== 'Pitcher',
        bateoStats: statGrupo('hitting'),
        pitcheoStats: statGrupo('pitching'),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function irAJugador(event, personId, teamId) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const retorno = `/team.html?id=${teamId}&scroll=${Math.round(window.scrollY)}`;
  window.location.href = construirUrlConRetorno(`/player.html?id=${personId}`, retorno);
}

function celdaNacionalidad(j) {
  const bandera = banderaUrl(j.pais);
  return bandera
    ? `<span class="inline-flex items-center gap-1"><img class="perfil-bandera" src="${bandera}" alt="" loading="lazy" onerror="this.style.display='none'">${j.pais}</span>`
    : (j.pais ?? '—');
}

function crearFilaBateador(j, teamId) {
  const bt = j.bateo || j.lanza ? `${j.bateo ?? '–'}/${j.lanza ?? '–'}` : '—';
  const s = j.bateoStats;

  return `
    <tr class="fila-clicable" onclick="irAJugador(event, ${j.id}, ${teamId})">
      <td><img class="foto-jugador" src="${fotoJugador(j.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></td>
      <td class="nombre-jugador">${j.nombre}${j.numero ? ` <span class="pos-jugador">#${j.numero}</span>` : ''}</td>
      <td>${j.posiciones.join('/') || '—'}</td>
      <td>${j.edad ?? '—'}</td>
      <td>${bt}</td>
      <td>${celdaNacionalidad(j)}</td>
      <td>${s?.gamesPlayed ?? '—'}</td>
      <td>${s?.avg ?? '—'}</td>
      <td>${s?.homeRuns ?? '—'}</td>
      <td>${s?.rbi ?? '—'}</td>
      <td>${s?.ops ?? '—'}</td>
    </tr>
  `;
}

function crearFilaPitcher(j, teamId, rol) {
  const bt = j.bateo || j.lanza ? `${j.bateo ?? '–'}/${j.lanza ?? '–'}` : '—';
  const s = j.pitcheoStats;
  const decision = s ? `${s.wins}-${s.losses}` : '—';

  return `
    <tr class="fila-clicable" onclick="irAJugador(event, ${j.id}, ${teamId})">
      <td><img class="foto-jugador" src="${fotoJugador(j.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></td>
      <td class="nombre-jugador">
        ${j.nombre}${j.numero ? ` <span class="pos-jugador">#${j.numero}</span>` : ''}
        <span class="rol-badge ${rol === 'SP' ? 'rol-abridor' : 'rol-relevo'}">${rol}</span>
      </td>
      <td>${j.edad ?? '—'}</td>
      <td>${bt}</td>
      <td>${celdaNacionalidad(j)}</td>
      <td>${s?.gamesPlayed ?? '—'}</td>
      <td>${s?.gamesStarted ?? '—'}</td>
      <td>${decision}</td>
      <td>${s?.era ?? '—'}</td>
      <td>${s?.whip ?? '—'}</td>
      <td>${s?.inningsPitched ?? '—'}</td>
      <td>${s?.strikeOuts ?? '—'}</td>
      <td>${s?.baseOnBalls ?? '—'}</td>
      <td>${s?.saves ?? '—'}</td>
    </tr>
  `;
}

const COLUMNAS_BATEADORES = ['Pos', 'Age', 'B/T', 'Nationality', 'G', 'AVG', 'HR', 'RBI', 'OPS'];
const COLUMNAS_PITCHERS = ['Age', 'B/T', 'Nationality', 'G', 'GS', 'W-L', 'ERA', 'WHIP', 'IP', 'K', 'BB', 'SV'];

function valoresBateador(j) {
  const s = j.bateoStats;
  return [j.posiciones.join('/'), j.edad, `${j.bateo ?? ''}/${j.lanza ?? ''}`, j.pais, s?.gamesPlayed, s?.avg, s?.homeRuns, s?.rbi, s?.ops];
}

function valoresPitcher(j) {
  const s = j.pitcheoStats;
  return [
    j.edad,
    `${j.bateo ?? ''}/${j.lanza ?? ''}`,
    j.pais,
    s?.gamesPlayed,
    s?.gamesStarted,
    s ? `${s.wins}-${s.losses}` : null,
    s?.era,
    s?.whip,
    s?.inningsPitched,
    s?.strikeOuts,
    s?.baseOnBalls,
    s?.saves,
  ];
}

// Un pitcher puede haber abierto juegos (gamesStarted > 0) y también relevado
// (apariciones sin abrir) en la misma temporada: en ese caso pertenece a
// ambas tablas. Uno sin apariciones todavía (recién subido, IL toda la
// temporada) cae por defecto en Bullpen, que es el rol más común.
function rolesPitcher(j) {
  const gp = Number(j.pitcheoStats?.gamesPlayed) || 0;
  const gs = Number(j.pitcheoStats?.gamesStarted) || 0;
  const roles = [];
  if (gs > 0) roles.push('SP');
  if (gp - gs > 0 || gp === 0) roles.push('RP');
  return roles;
}

function renderRosterSeccion() {
  if (!rosterActual) return '<p class="vacio">Loading roster...</p>';
  if (rosterActual.length === 0) return '<p class="vacio">No roster data available.</p>';

  const teamId = equipoActual.id;
  const bateadores = rosterActual.filter((j) => j.esBateador);
  const pitchers = rosterActual.filter((j) => j.esPitcher);
  const abridores = pitchers.filter((j) => rolesPitcher(j).includes('SP'));
  const bullpen = pitchers.filter((j) => rolesPitcher(j).includes('RP'));

  return `
    <h4 class="subtitulo">Position Players</h4>
    ${crearTablaJugadores(`roster-bateadores-${teamId}`, bateadores, COLUMNAS_BATEADORES, (j) => crearFilaBateador(j, teamId), valoresBateador)}
    <h4 class="subtitulo">Starting Pitchers</h4>
    ${crearTablaJugadores(`roster-abridores-${teamId}`, abridores, COLUMNAS_PITCHERS, (j) => crearFilaPitcher(j, teamId, 'SP'), valoresPitcher)}
    <h4 class="subtitulo">Bullpen</h4>
    ${crearTablaJugadores(`roster-bullpen-${teamId}`, bullpen, COLUMNAS_PITCHERS, (j) => crearFilaPitcher(j, teamId, 'RP'), valoresPitcher)}
  `;
}

// --- Últimos partidos / top rivales (portado desde la antigua teams.js) ----

async function obtenerRosterActivo(teamId) {
  if (cacheRosterActivo.has(teamId)) return cacheRosterActivo.get(teamId);

  const resp = await fetch(`${API_BASE}/teams/${teamId}/roster?rosterType=active`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();

  const roster = data.roster ?? [];
  cacheRosterActivo.set(teamId, roster);
  return roster;
}

async function obtenerStatsVsEquipo(personIds, grupo, teamId) {
  if (personIds.length === 0) return [];

  const lotes = trocear(personIds, 45);
  const respuestas = await Promise.all(
    lotes.map((ids) =>
      fetch(
        `${API_BASE}/people?personIds=${ids.join(',')}&hydrate=stats(group=${grupo},type=vsTeamTotal,opposingTeamId=${teamId},sportId=1)`
      ).then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
      })
    )
  );

  return respuestas.flatMap((data) => data.people ?? []);
}

// Compara bateadores/lanzadores de todo el resto de la liga contra un equipo:
// junta los rosters activos de los demás equipos de la misma liga y consulta
// sus stats vsTeamTotal frente al equipo seleccionado.
async function obtenerTopLigaVsEquipo(equipo, grupo) {
  const rivales = [...registros.values()].filter((r) => r.leagueId === equipo.leagueId && r.id !== equipo.id);

  const rosters = await Promise.all(
    rivales.map((rival) => obtenerRosterActivo(rival.id).then((roster) => ({ rival, roster })))
  );

  const candidatos = [];
  rosters.forEach(({ rival, roster }) => {
    roster.forEach((j) => {
      const esPitcher = j.position.type === 'Pitcher';
      if ((grupo === 'pitching') === esPitcher) {
        candidatos.push({
          id: j.person.id,
          nombre: j.person.fullName,
          equipoId: rival.id,
          equipoNombre: rival.nombre,
        });
      }
    });
  });

  const personas = await obtenerStatsVsEquipo(candidatos.map((c) => c.id), grupo, equipo.id);
  const statsPorId = new Map(personas.map((p) => [p.id, p.stats?.[0]?.splits?.[0]?.stat]));
  const statClave = grupo === 'pitching' ? 'strikeOuts' : 'hits';

  return candidatos
    .map((c) => ({ ...c, stat: statsPorId.get(c.id) }))
    .filter((c) => c.stat && Number(c.stat[statClave]) > 0)
    .sort((a, b) => Number(b.stat[statClave]) - Number(a.stat[statClave]))
    .slice(0, 8);
}

async function obtenerUltimosPartidos(teamId, temporada) {
  if (cacheUltimosPartidos.has(teamId)) return cacheUltimosPartidos.get(teamId);

  const url = `${API_BASE}/schedule?sportId=1&teamId=${teamId}&season=${temporada}&gameType=R&startDate=${temporada}-01-01&endDate=${fechaHoy()}&hydrate=linescore`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();

  const partidos = (data.dates ?? [])
    .flatMap((f) => f.games)
    .filter((g) => g.status.abstractGameState === 'Final')
    .sort((a, b) => new Date(b.gameDate) - new Date(a.gameDate));

  cacheUltimosPartidos.set(teamId, partidos);
  return partidos;
}

function crearFilaPartido(equipo, game, listaGamePks) {
  const esVisitante = game.teams.away.team.id === equipo.id;
  const propio = esVisitante ? game.teams.away : game.teams.home;
  const rival = esVisitante ? game.teams.home : game.teams.away;
  const gano = propio.isWinner;

  const url = `/game.html?gamePk=${game.gamePk}&list=${listaGamePks}&team=${equipo.id}`;

  return `
    <a class="partido-mini" href="${url}">
      <span class="partido-fecha">${formatoFechaCorta(game.officialDate)}</span>
      <span class="partido-rival">
        <span class="partido-arroba">${esVisitante ? '@' : 'vs'}</span>
        <img class="logo logo-sm" src="${logoEquipo(rival.team.id)}" alt="" loading="lazy">
        ${rival.team.name}
      </span>
      <span class="partido-decision ${gano ? 'partido-gano' : 'partido-perdio'}">${gano ? 'W' : 'L'}</span>
      <span class="partido-marcador">${propio.score}-${rival.score}</span>
    </a>
  `;
}

function renderUltimosPartidos(equipo) {
  if (!cacheUltimosPartidos.has(equipo.id)) {
    obtenerUltimosPartidos(equipo.id, TEMPORADA)
      .then(() => renderPerfil())
      .catch(() => {});
    return '<p class="vacio">Loading last games...</p>';
  }

  const todos = cacheUltimosPartidos.get(equipo.id);
  if (todos.length === 0) {
    return '<p class="vacio">No completed games yet.</p>';
  }

  const mostrados = partidosMostrados.get(equipo.id) ?? PARTIDOS_POR_PAGINA;
  const partidos = todos.slice(0, mostrados);
  const listaGamePks = partidos.map((g) => g.gamePk).join(',');
  const hayMas = mostrados < todos.length;

  return `
    <div class="partidos-lista">
      ${partidos.map((g) => crearFilaPartido(equipo, g, listaGamePks)).join('')}
    </div>
    ${hayMas ? `<button type="button" class="cargar-mas-btn" onclick="cargarMasPartidos(${equipo.id})">Load 10 more</button>` : ''}
  `;
}

function cargarMasPartidos(teamId) {
  const total = cacheUltimosPartidos.get(teamId)?.length ?? 0;
  const mostrados = partidosMostrados.get(teamId) ?? PARTIDOS_POR_PAGINA;
  partidosMostrados.set(teamId, Math.min(mostrados + PARTIDOS_POR_PAGINA, total));
  renderPerfil();
}

function crearFilaTopBateador(j) {
  const s = j.stat;
  return `
    <tr>
      <td><img class="foto-jugador" src="${fotoJugador(j.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></td>
      <td class="nombre-jugador">
        ${j.nombre}
        <span class="equipo-jugador"><img class="logo logo-sm" src="${logoEquipo(j.equipoId)}" alt="" loading="lazy">${j.equipoNombre}</span>
      </td>
      <td>${s.gamesPlayed}</td>
      <td>${s.atBats}</td>
      <td>${s.hits}</td>
      <td>${s.homeRuns}</td>
      <td>${s.avg}</td>
      <td>${s.ops}</td>
    </tr>
  `;
}

function crearFilaTopPitcher(j) {
  const s = j.stat;
  return `
    <tr>
      <td><img class="foto-jugador" src="${fotoJugador(j.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></td>
      <td class="nombre-jugador">
        ${j.nombre}
        <span class="equipo-jugador"><img class="logo logo-sm" src="${logoEquipo(j.equipoId)}" alt="" loading="lazy">${j.equipoNombre}</span>
      </td>
      <td>${s.gamesPlayed}</td>
      <td>${s.strikeOuts}</td>
      <td>${s.baseOnBalls}</td>
      <td>${s.hits}</td>
      <td>${s.avg}</td>
    </tr>
  `;
}

function renderTopSeccion(equipo, grupo) {
  const cache = grupo === 'pitching' ? cacheTopPitchers : cacheTopBateadores;

  if (!cache.has(equipo.id)) {
    obtenerTopLigaVsEquipo(equipo, grupo)
      .then((resultado) => {
        cache.set(equipo.id, resultado);
        renderPerfil();
      })
      .catch(() => {});
    return `<p class="vacio">Scanning ${equipo.leagueNombre} rosters, this can take a few seconds...</p>`;
  }

  const datos = cache.get(equipo.id);
  const columnas = grupo === 'pitching' ? ['G', 'K', 'BB', 'H', 'AVG'] : ['G', 'AB', 'H', 'HR', 'AVG', 'OPS'];
  const crearFila = grupo === 'pitching' ? crearFilaTopPitcher : crearFilaTopBateador;
  const obtenerValores =
    grupo === 'pitching'
      ? (j) => {
          const s = j.stat;
          return [s.gamesPlayed, s.strikeOuts, s.baseOnBalls, s.hits, s.avg];
        }
      : (j) => {
          const s = j.stat;
          return [s.gamesPlayed, s.atBats, s.hits, s.homeRuns, s.avg, s.ops];
        };

  return crearTablaJugadores(`top-${grupo}-${equipo.id}`, datos, columnas, crearFila, obtenerValores);
}

// --- Layout de la página -----------------------------------------------

function crearEncabezadoEquipo(equipo, registro) {
  const gb = registro ? (registro.gamesBack === '-' ? '0' : registro.gamesBack) : null;

  return `
    <div class="perfil-encabezado">
      <img class="equipo-perfil-logo" src="${logoEquipo(equipo.id)}" alt="" loading="lazy">
      <div class="perfil-info">
        <h2 class="perfil-nombre">${equipo.name}</h2>
        <div class="perfil-meta">
          ${
            registro
              ? `
            <span class="equipo-registro-item">${registro.leagueNombre}</span>
            <span class="equipo-registro-item">${registro.divisionNombre}</span>
            <span class="equipo-registro-item">${ordinal(registro.divisionRank)} in division</span>
            <span class="equipo-registro-item">${ordinal(registro.leagueRank)} in league</span>
            <span class="equipo-registro-item">${registro.wins}-${registro.losses}</span>
            <span class="equipo-registro-item">GB ${gb}</span>
          `
              : ''
          }
          ${equipo.venue?.name ? `<span class="equipo-registro-item">${equipo.venue.name}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

function crearPestanasSeccionEquipo(activa) {
  return `
    <div class="seccion-tabs" role="tablist">
      ${SECCIONES_EQUIPO.map(
        (s) => `
        <button type="button" class="seccion-tab ${activa === s.id ? 'activo' : ''}" role="tab" aria-selected="${activa === s.id}" onclick="cambiarSeccionEquipo('${s.id}')">${s.etiqueta}</button>
      `
      ).join('')}
    </div>
  `;
}

function cambiarSeccionEquipo(seccion) {
  seccionActiva = seccion;
  renderPerfil();
}

function renderSeccionEquipo(seccion) {
  switch (seccion) {
    case 'pitchers':
      return registroActual ? renderTopSeccion(registroActual, 'pitching') : '<p class="vacio">Standings data unavailable.</p>';
    case 'bateadores':
      return registroActual ? renderTopSeccion(registroActual, 'hitting') : '<p class="vacio">Standings data unavailable.</p>';
    case 'ultimos':
      return renderUltimosPartidos(equipoActual);
    default:
      return renderRosterSeccion();
  }
}

function renderPerfil() {
  const contenedor = document.getElementById('perfil-equipo');
  contenedor.innerHTML = `
    ${crearEncabezadoEquipo(equipoActual, registroActual)}
    ${crearPestanasSeccionEquipo(seccionActiva)}
    <div class="seccion-contenido">${renderSeccionEquipo(seccionActiva)}</div>
  `;
}

// Hook consumido por common.js al ordenar una tabla por columna (th-ordenable).
function refrescarVista() {
  if (equipoActual) renderPerfil();
}

function configurarBotonVolver() {
  document.getElementById('volver').href = retornoDesdeURL() ?? '/teams.html';
}

function aplicarParametrosURL() {
  const scroll = new URLSearchParams(window.location.search).get('scroll');
  scrollGuardadoPendiente = scroll !== null ? Number(scroll) : null;
}

async function cargarEquipo(teamId) {
  const contenedor = document.getElementById('perfil-equipo');
  contenedor.innerHTML = '<p class="estado">Loading team...</p>';

  try {
    const [respTeam, standings] = await Promise.all([fetch(`${API_BASE}/teams/${teamId}`), obtenerStandingsLiga(TEMPORADA)]);
    if (!respTeam.ok) throw new Error(`HTTP ${respTeam.status}`);
    const datosTeam = await respTeam.json();
    const equipo = datosTeam.teams?.[0];

    if (!equipo) {
      contenedor.innerHTML = '<p class="estado">Team not found.</p>';
      return;
    }

    registros = standings;
    equipoActual = equipo;
    registroActual = standings.get(equipo.id) ?? null;
    seccionActiva = 'roster';
    rosterActual = null;
    partidosMostrados.delete(equipo.id);

    document.title = `${equipo.name} · La Bateada`;
    document.getElementById('equipo-titulo').textContent = equipo.name;
    document.getElementById('equipo-subtitulo').textContent = registroActual
      ? `${registroActual.leagueNombre} · ${registroActual.divisionNombre}`
      : '';

    renderPerfil();

    if (Number.isFinite(scrollGuardadoPendiente)) {
      window.scrollTo(0, scrollGuardadoPendiente);
      scrollGuardadoPendiente = null;
    }

    rosterActual = await obtenerRosterDetallado(teamId, TEMPORADA);
    if (equipoActual?.id === teamId) renderPerfil();
  } catch (err) {
    contenedor.innerHTML = `
      <p class="estado">
        Error loading team: ${err.message}
        <br><button type="button" class="retry-btn" onclick="cargarEquipo(${teamId})">Retry</button>
      </p>
    `;
  }
}

function idEquipoDesdeURL() {
  const raw = new URLSearchParams(window.location.search).get('id');
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

aplicarParametrosURL();
configurarBotonVolver();

const teamIdInicial = idEquipoDesdeURL();
if (teamIdInicial !== null) {
  cargarEquipo(teamIdInicial);
} else {
  document.getElementById('perfil-equipo').innerHTML = '<p class="estado">No team specified.</p>';
}
