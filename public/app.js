let ultimosJuegos = [];
let fechaSeleccionada;
const expandidos = new Set();
const cacheEnfrentamientos = new Map();
const cacheBoxscoreDetalle = new Map();
const cachePersonas = new Map();
const cachePitcherStats = new Map();
const cacheStandings = new Map();
const cacheJugadasAnotadoras = new Map();
const cacheBateadoresHistorial = new Map();
const equipoActivo = new Map();
const abridorEquipoActivo = new Map();
const seccionActiva = new Map();

const MANO_LANZADOR = { L: 'LHP', R: 'RHP' };

// Coordenadas en escala 0-100 (tanto x como y), compartida con el viewBox
// del SVG del campo para que marcadores y dibujo queden alineados sin
// importar el aspect-ratio real del contenedor (ver crearCampoDiamante).
const POSICIONES_CAMPO = {
  P: { x: 50, y: 73 },
  C: { x: 50, y: 97 },
  '1B': { x: 70, y: 62 },
  '2B': { x: 57, y: 48 },
  '3B': { x: 30, y: 62 },
  SS: { x: 43, y: 48 },
  LF: { x: 14, y: 23 },
  CF: { x: 50, y: 7 },
  RF: { x: 86, y: 23 },
};

function fechaHoy() {
  const hoy = new Date();
  const y = hoy.getFullYear();
  const m = String(hoy.getMonth() + 1).padStart(2, '0');
  const d = String(hoy.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function sumarDias(fechaISO, dias) {
  const d = new Date(`${fechaISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

fechaSeleccionada = fechaHoy();

function formatoHora(isoString) {
  return new Date(isoString).toLocaleTimeString('es', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatoFechaCorta(fechaISO) {
  return new Date(`${fechaISO}T12:00:00`).toLocaleDateString('en', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function infoEstado(game) {
  const estado = game.status.detailedState;

  if (estado === 'Final' || estado === 'Game Over') {
    return { texto: 'Final', enVivo: false };
  }

  if (estado === 'In Progress' || estado === 'Manager challenge') {
    const linea = game.linescore;
    const mitad = linea?.inningState === 'Top' ? 'Alta' : 'Baja';
    return { texto: `${mitad} ${linea?.currentInningOrdinal ?? ''}`.trim(), enVivo: true };
  }

  if (estado === 'Postponed' || estado === 'Cancelled') {
    return { texto: estado === 'Postponed' ? 'Pospuesto' : 'Cancelado', enVivo: false };
  }

  if (estado === 'Delayed' || estado === 'Delayed Start') {
    return { texto: 'Retrasado', enVivo: false };
  }

  return { texto: formatoHora(game.gameDate), enVivo: false };
}

function crearBoxscore(game) {
  const innings = game.linescore?.innings ?? [];

  if (innings.length === 0) {
    return '<p class="vacio">Boxscore not available yet.</p>';
  }

  const totales = game.linescore.teams;
  const away = game.teams.away;
  const home = game.teams.home;

  const filaInnings = (lado) =>
    innings.map((i) => `<td>${i[lado].runs}</td>`).join('');

  const filaTotales = (lado) => `
    <td>${totales?.[lado]?.runs ?? ''}</td>
    <td>${totales?.[lado]?.hits ?? ''}</td>
    <td>${totales?.[lado]?.errors ?? ''}</td>
  `;

  return `
    <div class="boxscore-wrap">
      <table class="boxscore">
        <thead>
          <tr>
            <th></th>
            ${innings.map((i) => `<th>${i.num}</th>`).join('')}
            <th>R</th><th>H</th><th>E</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${away.team.name}</td>
            ${filaInnings('away')}
            ${filaTotales('away')}
          </tr>
          <tr>
            <td>${home.team.name}</td>
            ${filaInnings('home')}
            ${filaTotales('home')}
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

async function obtenerPaises(ids) {
  const pendientes = [...new Set(ids)].filter((id) => !cachePersonas.has(id));
  if (pendientes.length === 0) return;

  const resp = await fetch(`${API_BASE}/people?personIds=${pendientes.join(',')}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();

  (data.people ?? []).forEach((persona) => {
    cachePersonas.set(persona.id, { pais: persona.birthCountry ?? null });
  });
}

async function obtenerDatosAbridor(personId, temporada) {
  if (cachePitcherStats.has(personId)) {
    return cachePitcherStats.get(personId);
  }

  const [respPersona, respStats] = await Promise.all([
    fetch(`${API_BASE}/people/${personId}`),
    fetch(`${API_BASE}/people/${personId}/stats?stats=season,gameLog&group=pitching&season=${temporada}&sportId=1`),
  ]);
  if (!respPersona.ok) throw new Error(`HTTP ${respPersona.status}`);
  if (!respStats.ok) throw new Error(`HTTP ${respStats.status}`);

  const datosPersona = await respPersona.json();
  const datosStats = await respStats.json();

  const persona = datosPersona.people?.[0];
  const bloqueTemporada = datosStats.stats?.find((s) => s.type.displayName === 'season');
  const bloqueJuegos = datosStats.stats?.find((s) => s.type.displayName === 'gameLog');

  const resultado = {
    id: personId,
    nombre: persona?.fullName ?? '',
    mano: persona?.pitchHand?.code ?? null,
    temporada: bloqueTemporada?.splits?.[0]?.stat ?? null,
    ultimosJuegos: (bloqueJuegos?.splits ?? [])
      .slice()
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 7),
  };

  cachePitcherStats.set(personId, resultado);
  return resultado;
}

async function obtenerStandings(temporada) {
  if (cacheStandings.has(temporada)) {
    return cacheStandings.get(temporada);
  }

  const resp = await fetch(`${API_BASE}/standings?leagueId=103,104&season=${temporada}&standingsTypes=regularSeason`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();

  const registros = new Map();
  (data.records ?? []).forEach((division) => {
    const nombreDivision = division.division?.nameShort ?? division.division?.name ?? '';
    (division.teamRecords ?? []).forEach((tr) => {
      registros.set(tr.team.id, {
        wins: tr.wins,
        losses: tr.losses,
        posicion: Number(tr.divisionRank),
        division: nombreDivision,
      });
    });
  });

  cacheStandings.set(temporada, registros);
  return registros;
}

function alineacionInicial(equipoBox) {
  const jugadores = Object.values(equipoBox.players);
  const titulares = jugadores.filter((j) => j.battingOrder && Number(j.battingOrder) % 100 === 0);

  const dh = titulares.find((j) => j.position.abbreviation === 'DH') ?? null;
  const fielders = titulares.filter((j) => j.position.abbreviation !== 'DH');

  if (!fielders.some((j) => j.position.abbreviation === 'P')) {
    const idPitcher = equipoBox.pitchers?.[0];
    const pitcher = idPitcher ? equipoBox.players[`ID${idPitcher}`] : null;
    if (pitcher) fielders.push(pitcher);
  }

  return { fielders, dh };
}

function crearMarcadorCampo(jugador) {
  const coord = POSICIONES_CAMPO[jugador.position.abbreviation];
  if (!coord) return '';

  const nombre = jugador.person.boxscoreName ?? jugador.person.fullName;
  const pais = cachePersonas.get(jugador.person.id)?.pais ?? null;
  const bandera = banderaUrl(pais);

  return `
    <div class="marcador-campo" style="left:${coord.x}%; top:${coord.y}%" title="${jugador.person.fullName} — ${pais ?? 'Nationality unknown'}">
      <span class="marcador-pos">${jugador.position.abbreviation}</span>
      <img class="marcador-foto" src="${fotoJugador(jugador.person.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <span class="marcador-nombre">${nombre}</span>
      <span class="marcador-pais">
        ${bandera ? `<img class="marcador-bandera" src="${bandera}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
        ${pais ?? '—'}
      </span>
    </div>
  `;
}

function crearCampoDiamante(fielders) {
  const marcadores = fielders.map(crearMarcadorCampo).join('');

  return `
    <div class="campo-diamante">
      <svg class="campo-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path d="M50,91.5 L4,38 A60,60 0 0 1 96,38 Z" fill="var(--campo-pasto)" />
        <path d="M50,91.5 L18,66.5 A40,40 0 0 1 82,66.5 Z" fill="var(--campo-tierra)" />
        <path d="M50,90 L76,70 L50,45 L24,70 Z" fill="none" stroke="var(--campo-linea)" stroke-width="0.5" />
        <path d="M50,90 L4,38 M50,90 L96,38" stroke="var(--campo-linea)" stroke-width="0.5" fill="none" />
        <circle cx="50" cy="73" r="3.3" fill="var(--campo-tierra)" stroke="var(--campo-linea)" stroke-width="0.35" />
        <rect x="73.9" y="67.1" width="4.2" height="4.2" fill="var(--campo-base)" transform="rotate(45 76 69.2)" />
        <rect x="47.9" y="42.1" width="4.2" height="4.2" fill="var(--campo-base)" transform="rotate(45 50 44.2)" />
        <rect x="21.9" y="67.1" width="4.2" height="4.2" fill="var(--campo-base)" transform="rotate(45 24 69.2)" />
        <rect x="47.9" y="88.3" width="4.2" height="4.2" fill="var(--campo-base)" />
      </svg>
      ${marcadores}
    </div>
  `;
}

function crearNotaDH(dh) {
  const nombre = dh.person.boxscoreName ?? dh.person.fullName;
  const pais = cachePersonas.get(dh.person.id)?.pais ?? null;
  const bandera = banderaUrl(pais);

  return `
    <div class="campo-dh">
      <span class="campo-dh-etiqueta">DH</span>
      <img class="foto-jugador" src="${fotoJugador(dh.person.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <span class="campo-dh-nombre">${nombre}</span>
      ${bandera ? `<img class="campo-dh-bandera" src="${bandera}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
      <span class="campo-dh-pais">${pais ?? ''}</span>
    </div>
  `;
}

function cambiarEquipoActivo(event, gamePk, lado) {
  event.stopPropagation();
  equipoActivo.set(gamePk, lado);
  renderContenedor();
}

function crearPestanasEquipo(game, lado) {
  const away = game.teams.away.team;
  const home = game.teams.home.team;

  const pestana = (equipo, valor) => `
    <button type="button" class="campo-tab ${lado === valor ? 'activo' : ''}" onclick="cambiarEquipoActivo(event, ${game.gamePk}, '${valor}')">
      <img class="campo-tab-logo" src="${logoEquipo(equipo.id)}" alt="" loading="lazy">
      ${equipo.name}
    </button>
  `;

  return `<div class="campo-tabs">${pestana(away, 'away')}${pestana(home, 'home')}</div>`;
}

function crearFilaGameLogAbridor(split) {
  const s = split.stat;
  const esAbridor = Number(s.gamesStarted) === 1;
  const decision = s.wins === 1 ? 'W' : s.losses === 1 ? 'L' : s.saves === 1 ? 'SV' : '—';

  return `
    <tr>
      <td>${formatoFechaCorta(split.date)}</td>
      <td class="nombre-jugador">${split.opponent?.name ?? ''}</td>
      <td><span class="rol-badge ${esAbridor ? 'rol-abridor' : 'rol-relevo'}">${esAbridor ? 'Starter' : 'Bullpen'}</span></td>
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

function crearTarjetaAbridor(datos) {
  if (datos === undefined) {
    return `<div class="abridor-card"><p class="vacio">Loading...</p></div>`;
  }

  if (datos === null) {
    return `<div class="abridor-card"><p class="vacio">Starter not yet announced.</p></div>`;
  }

  const t = datos.temporada;
  const resumenTemporada = t
    ? `${t.wins}-${t.losses} · ERA ${t.era} · WHIP ${t.whip} · ${t.strikeOuts} K`
    : 'No season stats yet';

  const filas = datos.ultimosJuegos.length
    ? datos.ultimosJuegos.map(crearFilaGameLogAbridor).join('')
    : `<tr><td colspan="10" class="vacio">No recent games.</td></tr>`;

  return `
    <div class="abridor-card">
      <div class="abridor-jugador">
        <img class="foto-jugador foto-abridor" src="${fotoJugador(datos.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <div>
          <div class="abridor-nombre">${datos.nombre}${datos.mano ? ` <span class="abridor-mano">(${MANO_LANZADOR[datos.mano] ?? datos.mano})</span>` : ''}</div>
          <div class="abridor-resumen">${resumenTemporada}</div>
        </div>
      </div>
      <div class="boxscore-wrap">
        <table class="tabla-stats tabla-abridor">
          <thead>
            <tr>
              <th>Date</th><th>Opp</th><th>Role</th><th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>K</th><th>Dec</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
    </div>
  `;
}

function cambiarAbridorEquipo(event, gamePk, lado) {
  event.stopPropagation();
  abridorEquipoActivo.set(gamePk, lado);
  renderContenedor();
}

function crearPestanasAbridor(game, lado) {
  const away = game.teams.away.team;
  const home = game.teams.home.team;

  const pestana = (equipo, valor) => `
    <button type="button" class="campo-tab ${lado === valor ? 'activo' : ''}" onclick="cambiarAbridorEquipo(event, ${game.gamePk}, '${valor}')">
      <img class="campo-tab-logo" src="${logoEquipo(equipo.id)}" alt="" loading="lazy">
      ${equipo.name}
    </button>
  `;

  return `<div class="campo-tabs">${pestana(away, 'away')}${pestana(home, 'home')}</div>`;
}

function renderRegistroEquipo(game, teamId) {
  const temporada = game.season;

  if (!cacheStandings.has(temporada)) {
    obtenerStandings(temporada)
      .then(() => {
        if (expandidos.has(game.gamePk)) renderContenedor();
      })
      .catch(() => {});
    return '<p class="vacio equipo-registro">Loading team record...</p>';
  }

  const registro = cacheStandings.get(temporada).get(teamId);
  if (!registro) return '';

  return `
    <div class="equipo-registro">
      <span class="equipo-registro-item">${registro.division}</span>
      <span class="equipo-registro-item">${ordinal(registro.posicion)} place</span>
      <span class="equipo-registro-item">${registro.wins}-${registro.losses}</span>
    </div>
  `;
}

function renderAbridoresSlot(game) {
  const lado = abridorEquipoActivo.get(game.gamePk) ?? 'away';
  const tabs = crearPestanasAbridor(game, lado);
  const infoEquipo = lado === 'away' ? game.teams.away : game.teams.home;
  const probable = infoEquipo.probablePitcher;

  const registro = renderRegistroEquipo(game, infoEquipo.team.id);

  let tarjeta;
  if (!probable) {
    tarjeta = crearTarjetaAbridor(null);
  } else if (!cachePitcherStats.has(probable.id)) {
    obtenerDatosAbridor(probable.id, game.season)
      .then(() => {
        if (expandidos.has(game.gamePk)) renderContenedor();
      })
      .catch(() => {});
    tarjeta = crearTarjetaAbridor(undefined);
  } else {
    tarjeta = crearTarjetaAbridor(cachePitcherStats.get(probable.id));
  }

  return `${tabs}${registro}${tarjeta}`;
}

function crearFilaBateo(jugador) {
  const b = jugador.stats.batting;
  const avg = jugador.seasonStats?.batting?.avg ?? '';
  return `
    <tr>
      <td><img class="foto-jugador" src="${fotoJugador(jugador.person.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></td>
      <td class="nombre-jugador">${jugador.person.boxscoreName}<span class="pos-jugador">${jugador.position.abbreviation}</span></td>
      <td>${b.atBats}</td>
      <td>${b.runs}</td>
      <td>${b.hits}</td>
      <td>${b.rbi}</td>
      <td>${b.baseOnBalls}</td>
      <td>${b.strikeOuts}</td>
      <td>${avg}</td>
    </tr>
  `;
}

function crearFilaPitcheo(jugador) {
  const p = jugador.stats.pitching;
  const era = jugador.seasonStats?.pitching?.era ?? '';
  return `
    <tr>
      <td><img class="foto-jugador" src="${fotoJugador(jugador.person.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></td>
      <td class="nombre-jugador">${jugador.person.boxscoreName}</td>
      <td>${p.inningsPitched}</td>
      <td>${p.hits}</td>
      <td>${p.runs}</td>
      <td>${p.earnedRuns}</td>
      <td>${p.baseOnBalls}</td>
      <td>${p.strikeOuts}</td>
      <td>${era}</td>
    </tr>
  `;
}

function crearFilaBateadorHistorial(b) {
  const s = b.stat;
  return `
    <tr>
      <td><img class="foto-jugador" src="${fotoJugador(b.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></td>
      <td class="nombre-jugador">${b.nombre}</td>
      <td>${s.gamesPlayed}</td>
      <td>${s.atBats}</td>
      <td>${s.hits}</td>
      <td>${s.homeRuns}</td>
      <td>${s.avg}</td>
      <td>${s.ops}</td>
    </tr>
  `;
}

function renderListaBateadores(game, rosterTeamId, opponentTeamId) {
  const clave = `${rosterTeamId}-${opponentTeamId}`;
  if (!cacheBateadoresHistorial.has(clave)) {
    obtenerBateadoresHistoricos(rosterTeamId, opponentTeamId)
      .then(() => {
        if (expandidos.has(game.gamePk)) renderContenedor();
      })
      .catch(() => {});
    return '<p class="vacio">Loading...</p>';
  }

  return crearTablaJugadores(
    cacheBateadoresHistorial.get(clave),
    ['G', 'AB', 'H', 'HR', 'AVG', 'OPS'],
    crearFilaBateadorHistorial
  );
}

function crearEstadisticasEquipo(boxscore, lado) {
  const equipoBox = boxscore.teams[lado];
  const jugadoresDe = (ids) => ids.map((id) => equipoBox.players[`ID${id}`]).filter(Boolean);

  // El array `batters` incluye lanzadores que nunca llegaron a batear
  // (stats.batting queda como objeto vacío), así que se descartan aquí.
  const bateadores = jugadoresDe(equipoBox.batters).filter((j) => j.stats.batting.atBats !== undefined);
  const lanzadores = jugadoresDe(equipoBox.pitchers);

  if (bateadores.length === 0 && lanzadores.length === 0) {
    return '<p class="vacio">Stats not available yet.</p>';
  }

  const columnasBateo = ['AB', 'R', 'H', 'RBI', 'BB', 'SO', 'AVG'];
  const columnasPitcheo = ['IP', 'H', 'R', 'ER', 'BB', 'SO', 'ERA'];

  return `
    <h4 class="subtitulo">Hitting</h4>
    ${crearTablaJugadores(bateadores, columnasBateo, crearFilaBateo)}
    <h4 class="subtitulo">Pitching</h4>
    ${crearTablaJugadores(lanzadores, columnasPitcheo, crearFilaPitcheo)}
  `;
}

async function obtenerBoxscoreDetalle(game) {
  if (cacheBoxscoreDetalle.has(game.gamePk)) {
    return cacheBoxscoreDetalle.get(game.gamePk);
  }

  const resp = await fetch(`${API_BASE}/game/${game.gamePk}/boxscore`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();

  cacheBoxscoreDetalle.set(game.gamePk, data);
  return data;
}

function renderEquipoSlot(game) {
  const lado = equipoActivo.get(game.gamePk) ?? 'away';
  const tabs = crearPestanasEquipo(game, lado);

  if (!cacheBoxscoreDetalle.has(game.gamePk)) {
    obtenerBoxscoreDetalle(game)
      .then(() => {
        if (expandidos.has(game.gamePk)) renderContenedor();
      })
      .catch(() => {});
    return `${tabs}<p class="vacio">Loading...</p>`;
  }

  const boxscore = cacheBoxscoreDetalle.get(game.gamePk);
  const { fielders, dh } = alineacionInicial(boxscore.teams[lado]);

  const lineupListo = fielders.length >= 9;
  if (lineupListo) {
    const idsNecesarios = (dh ? [...fielders, dh] : fielders).map((j) => j.person.id);
    if (idsNecesarios.some((id) => !cachePersonas.has(id))) {
      obtenerPaises(idsNecesarios)
        .then(() => {
          if (expandidos.has(game.gamePk)) renderContenedor();
        })
        .catch(() => {});
    }
  }

  const lineupHtml = lineupListo
    ? `${crearCampoDiamante(fielders)}${dh ? crearNotaDH(dh) : ''}`
    : '<p class="vacio">Lineup not confirmed yet.</p>';

  return `
    ${tabs}
    <h4 class="subtitulo">Starting Lineup</h4>
    ${lineupHtml}
    <h4 class="subtitulo">Game Stats</h4>
    ${crearEstadisticasEquipo(boxscore, lado)}
  `;
}

function fechaAnterior(fechaOficial) {
  return sumarDias(fechaOficial, -1);
}

function claveEquipos(game) {
  const homeId = game.teams.home.team.id;
  const awayId = game.teams.away.team.id;
  return [homeId, awayId].sort((a, b) => a - b).join('-');
}

async function buscarEnfrentamientosTemporada(homeId, awayId, anio, fechaLimite) {
  const startDate = `${anio}-01-01`;
  const endDate = fechaLimite ?? `${anio}-12-31`;
  const url = `${API_BASE}/schedule?sportId=1&teamId=${homeId}&opponentId=${awayId}&gameType=R&startDate=${startDate}&endDate=${endDate}`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();

  return (data.dates ?? [])
    .flatMap((f) => f.games)
    .filter((g) => g.status.abstractGameState === 'Final');
}

async function obtenerEnfrentamientos(game) {
  const clave = claveEquipos(game);

  if (cacheEnfrentamientos.has(clave)) {
    return cacheEnfrentamientos.get(clave);
  }

  const homeId = game.teams.home.team.id;
  const awayId = game.teams.away.team.id;
  const anioActual = parseInt(game.officialDate.slice(0, 4), 10);

  // La API de MLB ignora años posteriores cuando opponentId + un rango
  // de fechas cruza temporadas, así que se consulta año por año.
  let encontrados = [];
  for (let anio = anioActual; anio > anioActual - 5 && encontrados.length < 3; anio--) {
    const fechaLimite = anio === anioActual ? fechaAnterior(game.officialDate) : undefined;
    const partidos = await buscarEnfrentamientosTemporada(homeId, awayId, anio, fechaLimite);
    encontrados = encontrados.concat(partidos);
  }

  const ultimos = encontrados
    .sort((a, b) => new Date(b.gameDate) - new Date(a.gameDate))
    .slice(0, 3);

  cacheEnfrentamientos.set(clave, ultimos);
  return ultimos;
}

async function obtenerBateadoresHistoricos(rosterTeamId, opponentTeamId) {
  const clave = `${rosterTeamId}-${opponentTeamId}`;
  if (cacheBateadoresHistorial.has(clave)) return cacheBateadoresHistorial.get(clave);

  const respRoster = await fetch(`${API_BASE}/teams/${rosterTeamId}/roster?rosterType=active`);
  if (!respRoster.ok) throw new Error(`HTTP ${respRoster.status}`);
  const datosRoster = await respRoster.json();

  const bateadores = (datosRoster.roster ?? []).filter((j) => j.position.type !== 'Pitcher');

  let resultado = [];
  if (bateadores.length > 0) {
    const ids = bateadores.map((j) => j.person.id);
    const respStats = await fetch(
      `${API_BASE}/people?personIds=${ids.join(',')}&hydrate=stats(group=hitting,type=vsTeamTotal,opposingTeamId=${opponentTeamId},sportId=1)`
    );
    if (!respStats.ok) throw new Error(`HTTP ${respStats.status}`);
    const datosStats = await respStats.json();

    resultado = (datosStats.people ?? [])
      .map((persona) => {
        const stat = persona.stats?.[0]?.splits?.[0]?.stat;
        if (!stat || Number(stat.hits) === 0) return null;
        return { id: persona.id, nombre: persona.boxscoreName ?? persona.fullName, stat };
      })
      .filter(Boolean)
      .sort((a, b) => b.stat.hits - a.stat.hits || Number(b.stat.avg) - Number(a.stat.avg))
      .slice(0, 5);
  }

  cacheBateadoresHistorial.set(clave, resultado);
  return resultado;
}

function crearEnfrentamientos(partidos) {
  if (partidos.length === 0) {
    return '<p class="vacio">No recent matchups.</p>';
  }

  return partidos
    .map((g) => {
      const away = g.teams.away;
      const home = g.teams.home;
      return `
        <div class="enfrentamiento">
          <div class="fecha-e">${formatoFechaCorta(g.officialDate)}</div>
          <div class="fila-e">
            <span class="${away.isWinner ? 'ganador' : ''}">
              <img class="logo logo-sm" src="${logoEquipo(away.team.id)}" alt="" loading="lazy">
              ${away.team.name}
            </span>
            <span>${away.score}</span>
          </div>
          <div class="fila-e">
            <span class="${home.isWinner ? 'ganador' : ''}">
              <img class="logo logo-sm" src="${logoEquipo(home.team.id)}" alt="" loading="lazy">
              ${home.team.name}
            </span>
            <span>${home.score}</span>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderHistorialSeccion(game) {
  const clave = claveEquipos(game);
  const contenido = cacheEnfrentamientos.has(clave)
    ? crearEnfrentamientos(cacheEnfrentamientos.get(clave))
    : (() => {
        obtenerEnfrentamientos(game)
          .then(() => {
            if (expandidos.has(game.gamePk)) renderContenedor();
          })
          .catch(() => {});
        return '<p class="vacio">Loading...</p>';
      })();

  return `<h4 class="subtitulo">Last 3 Matchups</h4>${contenido}`;
}

function renderBateadoresSeccion(game) {
  const away = game.teams.away.team;
  const home = game.teams.home.team;

  return `
    <h4 class="subtitulo">Top Hitters vs ${home.name}</h4>
    ${renderListaBateadores(game, away.id, home.id)}
    <h4 class="subtitulo">Top Hitters vs ${away.name}</h4>
    ${renderListaBateadores(game, home.id, away.id)}
  `;
}

function crearJugadaAnotadora(play, game) {
  const esVisitante = play.about.halfInning === 'top';
  const equipo = esVisitante ? game.teams.away.team : game.teams.home.team;

  const anotadores = (play.runners ?? [])
    .filter((r) => r.movement?.end === 'score')
    .map((r) => r.details?.runner?.fullName ?? '')
    .filter(Boolean);

  // El RBI se acredita siempre al bateador de la jugada, no a cada corredor
  // que anota, así que se muestra junto al nombre del bateador.
  const rbi = play.result.rbi ?? 0;
  const bateador = play.matchup?.batter?.fullName ?? '—';
  const bateadorTexto = rbi > 0 ? `${bateador} (${rbi} RBI)` : bateador;

  return `
    <div class="jugada-anotadora">
      <img class="logo logo-sm" src="${logoEquipo(equipo.id)}" alt="" loading="lazy">
      <div class="jugada-cuerpo">
        <div class="jugada-cabecera">
          <span class="jugada-inning">${esVisitante ? 'Top' : 'Bot'} ${play.about.inning}</span>
          <span class="jugada-marcador">${play.result.awayScore}-${play.result.homeScore}</span>
        </div>
        <p class="jugada-desc">${play.result.description}</p>
        <div class="jugada-detalle">
          <span><strong>Scored:</strong> ${anotadores.join(', ') || '—'}</span>
          <span><strong>Batter:</strong> ${bateadorTexto}</span>
          <span><strong>Pitcher:</strong> ${play.matchup?.pitcher?.fullName ?? '—'}</span>
        </div>
      </div>
    </div>
  `;
}

async function obtenerJugadasAnotadoras(game) {
  if (cacheJugadasAnotadoras.has(game.gamePk)) {
    return cacheJugadasAnotadoras.get(game.gamePk);
  }

  const resp = await fetch(`${API_BASE}/game/${game.gamePk}/playByPlay`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();

  const jugadas = (data.allPlays ?? []).filter((p) => p.about?.isScoringPlay);
  cacheJugadasAnotadoras.set(game.gamePk, jugadas);
  return jugadas;
}

function renderJugadasAnotadorasSeccion(game) {
  const yaEmpezo = game.status.abstractGameState !== 'Preview';
  if (!yaEmpezo) return '';

  if (!cacheJugadasAnotadoras.has(game.gamePk)) {
    obtenerJugadasAnotadoras(game)
      .then(() => {
        if (expandidos.has(game.gamePk)) renderContenedor();
      })
      .catch(() => {});
    return `<h4 class="subtitulo">Scoring Plays</h4><p class="vacio">Loading...</p>`;
  }

  const jugadas = cacheJugadasAnotadoras.get(game.gamePk);
  const contenido = jugadas.length
    ? jugadas.map((p) => crearJugadaAnotadora(p, game)).join('')
    : '<p class="vacio">No runs scored yet.</p>';

  return `<h4 class="subtitulo">Scoring Plays</h4>${contenido}`;
}

function renderResumenSeccion(game) {
  return `
    <h4 class="subtitulo">Boxscore</h4>
    ${crearBoxscore(game)}
    ${renderJugadasAnotadorasSeccion(game)}
  `;
}

function cambiarSeccion(event, gamePk, seccion) {
  event.stopPropagation();
  seccionActiva.set(gamePk, seccion);
  renderContenedor();
}

const SECCIONES_JUEGO = [
  { id: 'resumen', etiqueta: 'Summary' },
  { id: 'abridores', etiqueta: 'Starting Pitchers' },
  { id: 'equipos', etiqueta: 'Teams' },
  { id: 'historial', etiqueta: 'Matchups' },
  { id: 'bateadores', etiqueta: 'Top Hitters' },
];

function crearPestanasSeccion(gamePk, activa) {
  return `
    <div class="seccion-tabs" role="tablist">
      ${SECCIONES_JUEGO.map(
        (s) => `
        <button type="button" class="seccion-tab ${activa === s.id ? 'activo' : ''}" role="tab" aria-selected="${activa === s.id}" onclick="cambiarSeccion(event, ${gamePk}, '${s.id}')">${s.etiqueta}</button>
      `
      ).join('')}
    </div>
  `;
}

function renderSeccion(game, seccion) {
  switch (seccion) {
    case 'abridores':
      return renderAbridoresSlot(game);
    case 'equipos':
      return renderEquipoSlot(game);
    case 'historial':
      return renderHistorialSeccion(game);
    case 'bateadores':
      return renderBateadoresSeccion(game);
    default:
      return renderResumenSeccion(game);
  }
}

function crearTarjetaJuego(game) {
  const away = game.teams.away;
  const home = game.teams.home;
  const estado = infoEstado(game);
  const yaEmpezo = game.status.abstractGameState !== 'Preview';
  const abierto = expandidos.has(game.gamePk);

  const div = document.createElement('div');
  div.className = `juego ${abierto ? 'abierto' : ''}`;

  div.innerHTML = `
    <div class="encabezado">
      <div class="fila">
        <span class="equipo ${away.isWinner ? 'ganador' : ''}">
          <img class="logo" src="${logoEquipo(away.team.id)}" alt="" loading="lazy">
          ${away.team.name}
        </span>
        <span class="marcador">${yaEmpezo ? away.score : ''}</span>
      </div>
      <div class="fila">
        <span class="equipo ${home.isWinner ? 'ganador' : ''}">
          <img class="logo" src="${logoEquipo(home.team.id)}" alt="" loading="lazy">
          ${home.team.name}
        </span>
        <span class="marcador">${yaEmpezo ? home.score : ''}</span>
      </div>
      <div class="info">
        <span>${game.venue?.name ?? ''}</span>
        <span class="${estado.enVivo ? 'en-vivo' : ''}">${estado.texto}</span>
      </div>
    </div>
    ${
      abierto
        ? `
      <div class="detalle">
        ${crearPestanasSeccion(game.gamePk, seccionActiva.get(game.gamePk) ?? 'resumen')}
        <div class="seccion-contenido">
          ${renderSeccion(game, seccionActiva.get(game.gamePk) ?? 'resumen')}
        </div>
      </div>
    `
        : ''
    }
  `;

  div.querySelector('.encabezado').addEventListener('click', () => {
    if (expandidos.has(game.gamePk)) {
      expandidos.delete(game.gamePk);
    } else {
      expandidos.add(game.gamePk);
    }
    renderContenedor();
  });

  return div;
}

function ordenarJuegos(a, b) {
  const aEnVivo = a.status.abstractGameState === 'Live';
  const bEnVivo = b.status.abstractGameState === 'Live';

  if (aEnVivo !== bEnVivo) {
    return aEnVivo ? -1 : 1;
  }

  return new Date(a.gameDate) - new Date(b.gameDate);
}

function renderContenedor() {
  const contenedor = document.getElementById('juegos');
  contenedor.innerHTML = '';

  if (ultimosJuegos.length === 0) {
    contenedor.innerHTML = '<p class="estado">No games scheduled for this date.</p>';
    return;
  }

  ultimosJuegos.forEach((game) => {
    contenedor.appendChild(crearTarjetaJuego(game));
  });
}

function actualizarControlesFecha() {
  document.getElementById('date-picker').value = fechaSeleccionada;

  const hoy = fechaHoy();
  document.querySelectorAll('.date-tab').forEach((btn) => {
    const fechaTab = sumarDias(hoy, Number(btn.dataset.offset));
    btn.classList.toggle('activo', fechaTab === fechaSeleccionada);
  });
}

function irAFecha(fecha) {
  fechaSeleccionada = fecha;
  expandidos.clear();
  cargarJuegos();
}

async function cargarJuegos() {
  const contenedor = document.getElementById('juegos');
  const fecha = fechaSeleccionada;

  actualizarControlesFecha();

  document.getElementById('fecha').textContent = new Date(`${fecha}T12:00:00`).toLocaleDateString('es', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  try {
    const url = `${API_BASE}/schedule?sportId=1&date=${fecha}&hydrate=linescore,probablePitcher`;
    const resp = await fetch(url);

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const data = await resp.json();
    ultimosJuegos = (data.dates?.[0]?.games ?? []).sort(ordenarJuegos);

    renderContenedor();
  } catch (err) {
    contenedor.innerHTML = `<p class="estado">Error al cargar los resultados: ${err.message}</p>`;
  }
}

document.querySelectorAll('.date-tab').forEach((btn) => {
  btn.addEventListener('click', () => irAFecha(sumarDias(fechaHoy(), Number(btn.dataset.offset))));
});

document.getElementById('prev-day').addEventListener('click', () => irAFecha(sumarDias(fechaSeleccionada, -1)));
document.getElementById('next-day').addEventListener('click', () => irAFecha(sumarDias(fechaSeleccionada, 1)));

document.getElementById('date-picker').addEventListener('change', (e) => {
  if (!e.target.value) return;
  irAFecha(e.target.value);
});

cargarJuegos();
setInterval(cargarJuegos, 15000);
