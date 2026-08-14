// Lógica de renderizado de las secciones de detalle de un partido (Summary,
// Starting Pitchers, Teams, Matchups, Top Hitters), compartida entre la
// tarjeta expandible de index.html (app.js) y la página de detalle standalone
// (game.html / game.js). Cada página debe definir `actualizarDetalleJuego(gamePk)`
// antes de cargar este script: es el hook que dispara el re-render de esa
// página cuando termina de llegar una respuesta async (fetch de stats, etc).
// También debe definir `urlRetorno(gamePk)`, que devuelve la URL (path+query)
// que restaura la posición actual de esa página, para que los links a otro
// partido (ej. desde Last 10 Games) puedan traer de vuelta al origen exacto.

const cacheEnfrentamientos = new Map();
const cachePersonas = new Map();
const cachePitcherStats = new Map();
const cacheEnfrentamientosAbridor = new Map();
const cacheStandings = new Map();
const cacheBateadoresHistorial = new Map();
const cacheUltimosPartidosEquipo = new Map();
const equipoActivo = new Map();
const abridorEquipoActivo = new Map();
const ultimosEquipoActivo = new Map();
const seccionActiva = new Map();

// Estado en vivo (boxscore completo + scoring plays) por gamePk, respaldado
// por el feed GUMBO (v1.1/game/{pk}/feed/live). A diferencia de los demás
// caches de este archivo, esta entrada se sigue actualizando in-place
// mientras el partido está en vivo (ver iniciarPollingEnVivo), en vez de
// quedar fija con el primer fetch.
const feedEnVivo = new Map();

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

function nombreConApellido(persona) {
  const fullName = persona?.fullName ?? '';
  const apellido = persona?.boxscoreName ?? '';

  if (apellido && fullName.endsWith(apellido)) {
    const nombre = fullName.slice(0, fullName.length - apellido.length).trim();
    return nombre ? `${nombre} <strong>${apellido}</strong>` : `<strong>${apellido}</strong>`;
  }

  const partes = fullName.trim().split(/\s+/);
  if (partes.length <= 1) return fullName;
  const ultimo = partes.pop();
  return `${partes.join(' ')} <strong>${ultimo}</strong>`;
}

function infoEstado(game) {
  const estado = game.status.detailedState;

  if (estado === 'Final' || estado === 'Game Over') {
    return { texto: 'Final', enVivo: false, clase: 'final' };
  }

  if (estado === 'In Progress' || estado === 'Manager challenge') {
    const linea = game.linescore;
    const mitad = linea?.inningState === 'Top' ? 'Top' : 'Bot';
    return { texto: `${mitad} ${linea?.currentInningOrdinal ?? ''}`.trim(), enVivo: true, clase: 'live' };
  }

  if (estado === 'Postponed' || estado === 'Cancelled') {
    return { texto: estado === 'Postponed' ? 'Pospuesto' : 'Cancelado', enVivo: false, clase: 'off' };
  }

  if (estado === 'Delayed' || estado === 'Delayed Start') {
    return { texto: 'Retrasado', enVivo: false, clase: 'off' };
  }

  return { texto: formatoHora(game.gameDate), enVivo: false, clase: 'scheduled' };
}

function crearBasesMini(offense) {
  const ocupada = (base) => (offense?.[base] ? 'ocupada' : '');
  return `
    <div class="bases-mini" title="Runners on base" aria-hidden="true">
      <span class="base-mini base-2 ${ocupada('second')}"></span>
      <span class="base-mini base-3 ${ocupada('third')}"></span>
      <span class="base-mini base-1 ${ocupada('first')}"></span>
    </div>
  `;
}

function crearEstadoEnVivo(game) {
  const linea = game.linescore;
  if (linea?.balls === undefined || linea?.strikes === undefined || linea?.outs === undefined) {
    return '';
  }

  return `
    <div class="en-vivo-barra">
      ${crearBasesMini(linea.offense)}
      <span class="conteo-mini"><strong>${linea.balls}-${linea.strikes}</strong> · ${linea.outs} out${linea.outs === 1 ? '' : 's'}</span>
    </div>
  `;
}

function crearBadgeRecord(record) {
  if (!record || record.wins === undefined || record.losses === undefined) return '';
  return `<span class="equipo-record">${record.wins}-${record.losses}</span>`;
}

function nombreProbable(probable) {
  return probable?.fullName ?? 'TBD';
}

function crearProbablesPreview(game) {
  const awayP = game.teams.away.probablePitcher;
  const homeP = game.teams.home.probablePitcher;
  if (!awayP && !homeP) return '';

  return `
    <div class="juego-probables">
      <span class="probable-pitcher"><span class="probable-tag">SP</span>${nombreProbable(awayP)}</span>
      <span class="probable-vs">vs</span>
      <span class="probable-pitcher"><span class="probable-tag">SP</span>${nombreProbable(homeP)}</span>
    </div>
  `;
}

function crearEncabezadoJuego(game) {
  const away = game.teams.away;
  const home = game.teams.home;
  const estado = infoEstado(game);
  const yaEmpezo = game.status.abstractGameState !== 'Preview';

  return `
    <div class="fila">
      <span class="equipo ${away.isWinner ? 'ganador' : ''}">
        <img class="logo" src="${logoEquipo(away.team.id)}" alt="" loading="lazy">
        <span class="equipo-nombre">${away.team.name}</span>
        ${crearBadgeRecord(away.leagueRecord)}
      </span>
      <span class="marcador">${yaEmpezo ? away.score : ''}</span>
    </div>
    <div class="fila">
      <span class="equipo ${home.isWinner ? 'ganador' : ''}">
        <img class="logo" src="${logoEquipo(home.team.id)}" alt="" loading="lazy">
        <span class="equipo-nombre">${home.team.name}</span>
        ${crearBadgeRecord(home.leagueRecord)}
      </span>
      <span class="marcador">${yaEmpezo ? home.score : ''}</span>
    </div>
    <div class="info">
      <span class="badge-estado badge-${estado.clase} ${estado.enVivo ? 'en-vivo' : ''}">${estado.texto}</span>
      <span class="juego-venue">${game.venue?.name ?? ''}</span>
    </div>
    ${estado.enVivo ? crearEstadoEnVivo(game) : ''}
    ${!yaEmpezo ? crearProbablesPreview(game) : ''}
  `;
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
    nombre: nombreConApellido(persona),
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

async function obtenerEnfrentamientosAbridor(personId, opponentTeamId, temporadaActual) {
  const clave = `${personId}-${opponentTeamId}`;
  if (cacheEnfrentamientosAbridor.has(clave)) {
    return cacheEnfrentamientosAbridor.get(clave);
  }

  let encontrados = [];
  for (let anio = temporadaActual; anio > temporadaActual - 5 && encontrados.length < 5; anio--) {
    const resp = await fetch(`${API_BASE}/people/${personId}/stats?stats=gameLog&group=pitching&season=${anio}&sportId=1`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const splits = data.stats?.[0]?.splits ?? [];
    encontrados = encontrados.concat(splits.filter((s) => s.opponent?.id === opponentTeamId));
  }

  const ultimos = encontrados
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  cacheEnfrentamientosAbridor.set(clave, ultimos);
  return ultimos;
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

  const nombre = nombreConApellido(jugador.person);
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
  const nombre = nombreConApellido(dh.person);
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
  actualizarDetalleJuego(gamePk);
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

function crearFilaGameLogAbridor(split, retorno) {
  const s = split.stat;
  const esAbridor = Number(s.gamesStarted) === 1;
  const decision = s.wins === 1 ? 'W' : s.losses === 1 ? 'L' : s.saves === 1 ? 'SV' : '—';
  // split.team es el equipo con el que jugó ESE partido puntual (puede
  // diferir del equipo actual del jugador si fue cambiado de equipo).
  const gamePk = split.game?.gamePk;
  const url = gamePk
    ? construirUrlConRetorno(`/game.html?gamePk=${gamePk}${split.team?.id ? `&team=${split.team.id}` : ''}`, retorno)
    : null;

  return `
    <tr${url ? ` class="fila-clicable" onclick="window.location.href='${url}'"` : ''}>
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

function crearTarjetaAbridor(datos, retorno) {
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

  const tablaId = `abridor-${datos.id}`;
  const columnasAbridor = ['Date', 'Opp', 'Role', 'IP', 'H', 'R', 'ER', 'BB', 'K', 'Dec'];
  const juegosOrdenados = ordenarFilas(tablaId, datos.ultimosJuegos, (split) => {
    const s = split.stat;
    const esAbridor = Number(s.gamesStarted) === 1;
    const decision = s.wins === 1 ? 'W' : s.losses === 1 ? 'L' : s.saves === 1 ? 'SV' : '';
    return [split.date, split.opponent?.name ?? '', esAbridor ? 'SP' : 'RP', s.inningsPitched, s.hits, s.runs, s.earnedRuns, s.baseOnBalls, s.strikeOuts, decision];
  });

  const filas = juegosOrdenados.length
    ? juegosOrdenados.map((split) => crearFilaGameLogAbridor(split, retorno)).join('')
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
            <tr>${crearEncabezadoOrdenable(tablaId, columnasAbridor)}</tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
    </div>
  `;
}

function crearTarjetaEnfrentamientosAbridor(personId, opponentTeamId, nombreRival, datos, retorno) {
  if (datos.length === 0) {
    return `<div class="abridor-card"><p class="vacio">No previous starts vs ${nombreRival}.</p></div>`;
  }

  const tablaId = `abridor-vs-${personId}-${opponentTeamId}`;
  const columnas = ['Date', 'Opp', 'Role', 'IP', 'H', 'R', 'ER', 'BB', 'K', 'Dec'];
  const juegosOrdenados = ordenarFilas(tablaId, datos, (split) => {
    const s = split.stat;
    const esAbridor = Number(s.gamesStarted) === 1;
    const decision = s.wins === 1 ? 'W' : s.losses === 1 ? 'L' : s.saves === 1 ? 'SV' : '';
    return [split.date, split.opponent?.name ?? '', esAbridor ? 'SP' : 'RP', s.inningsPitched, s.hits, s.runs, s.earnedRuns, s.baseOnBalls, s.strikeOuts, decision];
  });

  return `
    <div class="abridor-card">
      <div class="boxscore-wrap">
        <table class="tabla-stats tabla-abridor">
          <thead>
            <tr>${crearEncabezadoOrdenable(tablaId, columnas)}</tr>
          </thead>
          <tbody>${juegosOrdenados.map((split) => crearFilaGameLogAbridor(split, retorno)).join('')}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderEnfrentamientosAbridor(game, probable, rival) {
  const clave = `${probable.id}-${rival.id}`;
  const encabezado = `<h4 class="subtitulo">vs ${rival.name} (last starts)</h4>`;

  if (!cacheEnfrentamientosAbridor.has(clave)) {
    obtenerEnfrentamientosAbridor(probable.id, rival.id, game.season)
      .then(() => actualizarDetalleJuego(game.gamePk))
      .catch(() => {});
    return `${encabezado}<div class="abridor-card"><p class="vacio">Loading...</p></div>`;
  }

  const retorno = urlRetorno(game.gamePk);
  return `${encabezado}${crearTarjetaEnfrentamientosAbridor(probable.id, rival.id, rival.name, cacheEnfrentamientosAbridor.get(clave), retorno)}`;
}

function cambiarAbridorEquipo(event, gamePk, lado) {
  event.stopPropagation();
  abridorEquipoActivo.set(gamePk, lado);
  actualizarDetalleJuego(gamePk);
}

function crearPestanasAbridor(game, lado) {
  const away = game.teams.away.team;
  const home = game.teams.home.team;

  const pestana = (equipo, valor) => `
    <button type="button" class="campo-tab ${lado === valor ? 'activo' : ''}" title="${equipo.name}" onclick="cambiarAbridorEquipo(event, ${game.gamePk}, '${valor}')">
      <img class="campo-tab-logo campo-tab-logo-solo" src="${logoEquipo(equipo.id)}" alt="${equipo.name}" loading="lazy">
    </button>
  `;

  return `<div class="campo-tabs">${pestana(away, 'away')}${pestana(home, 'home')}</div>`;
}

function renderRegistroEquipo(game, teamId) {
  const temporada = game.season;

  if (!cacheStandings.has(temporada)) {
    obtenerStandings(temporada)
      .then(() => actualizarDetalleJuego(game.gamePk))
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
  const infoRival = lado === 'away' ? game.teams.home : game.teams.away;
  const probable = infoEquipo.probablePitcher;

  const registro = renderRegistroEquipo(game, infoEquipo.team.id);
  const retorno = urlRetorno(game.gamePk);

  let tarjeta;
  if (!probable) {
    tarjeta = crearTarjetaAbridor(null, retorno);
  } else if (!cachePitcherStats.has(probable.id)) {
    obtenerDatosAbridor(probable.id, game.season)
      .then(() => actualizarDetalleJuego(game.gamePk))
      .catch(() => {});
    tarjeta = crearTarjetaAbridor(undefined, retorno);
  } else {
    tarjeta = crearTarjetaAbridor(cachePitcherStats.get(probable.id), retorno);
  }

  const historial = probable ? renderEnfrentamientosAbridor(game, probable, infoRival.team) : '';

  return `${tabs}${registro}${tarjeta}${historial}`;
}

function crearFilaBateo(jugador) {
  const b = jugador.stats.batting;
  const avg = jugador.seasonStats?.batting?.avg ?? '';
  return `
    <tr>
      <td><img class="foto-jugador" src="${fotoJugador(jugador.person.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></td>
      <td class="nombre-jugador">${nombreConApellido(jugador.person)}<span class="pos-jugador">${jugador.position.abbreviation}</span></td>
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
      <td class="nombre-jugador">${nombreConApellido(jugador.person)}</td>
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

function crearFilaBateadorHistorial(b, idsAlineacion) {
  const s = b.stat;
  const enAlineacion = idsAlineacion?.has(b.id) ?? false;
  return `
    <tr>
      <td>
        <span class="foto-wrap">
          <img class="foto-jugador" src="${fotoJugador(b.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
          ${enAlineacion ? '<span class="punto-alineacion" title="In starting lineup"></span>' : ''}
        </span>
      </td>
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

function idsAlineacionInicial(game, lado) {
  if (!feedEnVivo.has(game.gamePk)) {
    obtenerFeedEnVivo(game)
      .then(() => actualizarDetalleJuego(game.gamePk))
      .catch(() => {});
    return null;
  }

  const boxscore = feedEnVivo.get(game.gamePk).data.liveData.boxscore;
  const { fielders, dh } = alineacionInicial(boxscore.teams[lado]);
  return new Set((dh ? [...fielders, dh] : fielders).map((j) => j.person.id));
}

function renderListaBateadores(game, rosterTeamId, opponentTeamId, idsAlineacion) {
  const clave = `${rosterTeamId}-${opponentTeamId}`;
  if (!cacheBateadoresHistorial.has(clave)) {
    obtenerBateadoresHistoricos(rosterTeamId, opponentTeamId)
      .then(() => actualizarDetalleJuego(game.gamePk))
      .catch(() => {});
    return '<p class="vacio">Loading...</p>';
  }

  return crearTablaJugadores(
    `hist-${clave}`,
    cacheBateadoresHistorial.get(clave),
    ['G', 'AB', 'H', 'HR', 'AVG', 'OPS'],
    (b) => crearFilaBateadorHistorial(b, idsAlineacion),
    (b) => {
      const s = b.stat;
      return [s.gamesPlayed, s.atBats, s.hits, s.homeRuns, s.avg, s.ops];
    }
  );
}

function crearEstadisticasEquipo(boxscore, lado, gamePk) {
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
    ${crearTablaJugadores(`bateo-${gamePk}-${lado}`, bateadores, columnasBateo, crearFilaBateo, (jugador) => {
      const b = jugador.stats.batting;
      const avg = jugador.seasonStats?.batting?.avg ?? '';
      return [b.atBats, b.runs, b.hits, b.rbi, b.baseOnBalls, b.strikeOuts, avg];
    })}
    <h4 class="subtitulo">Pitching</h4>
    ${crearTablaJugadores(`pitcheo-${gamePk}-${lado}`, lanzadores, columnasPitcheo, crearFilaPitcheo, (jugador) => {
      const p = jugador.stats.pitching;
      const era = jugador.seasonStats?.pitching?.era ?? '';
      return [p.inningsPitched, p.hits, p.runs, p.earnedRuns, p.baseOnBalls, p.strikeOuts, era];
    })}
  `;
}

// Trae el feed GUMBO completo una única vez por gamePk (cacheado en
// feedEnVivo) y, si el partido está en vivo, arranca el polling incremental
// vía diffPatch para que boxscore/plays se mantengan al día mientras la
// tarjeta siga abierta — sin necesidad de repetir este fetch completo.
async function obtenerFeedEnVivo(game) {
  const gamePk = game.gamePk;
  if (feedEnVivo.has(gamePk)) {
    return feedEnVivo.get(gamePk).data;
  }

  const resp = await fetch(`${API_BASE_LIVE}/game/${gamePk}/feed/live`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();

  feedEnVivo.set(gamePk, {
    data,
    timeStamp: data.metaData?.timeStamp ?? null,
    wait: data.metaData?.wait ?? 10,
    timer: null,
    pollActivo: false,
  });

  if (data.gameData?.status?.abstractGameState === 'Live') {
    iniciarPollingEnVivo(gamePk);
  }

  return data;
}

// Pide sólo lo que cambió desde el último timecode conocido. La API responde
// con un array de operaciones JSON Patch (RFC 6902) cuando puede calcular el
// diff, o con el documento completo (marcado con metaData.logicalEvents:
// ["fullUpdate"]) cuando el timecode ya expiró — ambos casos se manejan acá.
async function actualizarFeedEnVivo(gamePk) {
  const entrada = feedEnVivo.get(gamePk);
  if (!entrada) return;

  try {
    const resp = await fetch(
      `${API_BASE_LIVE}/game/${gamePk}/feed/live/diffPatch?startTimecode=${entrada.timeStamp}`
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const payload = await resp.json();

    if (Array.isArray(payload)) {
      if (payload.length > 0) aplicarParcheJSON(entrada.data, payload);
    } else {
      entrada.data = payload;
    }

    entrada.timeStamp = entrada.data.metaData?.timeStamp ?? entrada.timeStamp;
    entrada.wait = entrada.data.metaData?.wait ?? entrada.wait;
    actualizarDetalleJuego(gamePk);
  } catch (err) {
    // Fetch fallido o transitorio: se reintenta en el próximo ciclo del
    // polling conservando el último estado conocido.
  }
}

function programarSiguientePoll(gamePk) {
  const entrada = feedEnVivo.get(gamePk);
  if (!entrada) return;

  const esperaMs = Math.max(entrada.wait ?? 10, 5) * 1000;
  entrada.timer = setTimeout(async () => {
    await actualizarFeedEnVivo(gamePk);
    const sigueEnVivo = entrada.data?.gameData?.status?.abstractGameState === 'Live';
    if (entrada.pollActivo && sigueEnVivo) {
      programarSiguientePoll(gamePk);
    } else {
      entrada.timer = null;
    }
  }, esperaMs);
}

function iniciarPollingEnVivo(gamePk) {
  const entrada = feedEnVivo.get(gamePk);
  if (!entrada || entrada.timer) return;
  entrada.pollActivo = true;
  programarSiguientePoll(gamePk);
}

function detenerPollingEnVivo(gamePk) {
  const entrada = feedEnVivo.get(gamePk);
  if (!entrada) return;
  entrada.pollActivo = false;
  if (entrada.timer) {
    clearTimeout(entrada.timer);
    entrada.timer = null;
  }
}

// Corta todo el polling activo, ej. al cambiar de fecha en index.html: las
// tarjetas expandidas de la fecha anterior ya no están a la vista.
function detenerTodoElPollingEnVivo() {
  feedEnVivo.forEach((_entrada, gamePk) => detenerPollingEnVivo(gamePk));
}

function renderEquipoSlot(game) {
  const lado = equipoActivo.get(game.gamePk) ?? 'away';
  const tabs = crearPestanasEquipo(game, lado);

  if (!feedEnVivo.has(game.gamePk)) {
    obtenerFeedEnVivo(game)
      .then(() => actualizarDetalleJuego(game.gamePk))
      .catch(() => {});
    return `${tabs}<p class="vacio">Loading...</p>`;
  }

  const boxscore = feedEnVivo.get(game.gamePk).data.liveData.boxscore;
  const { fielders, dh } = alineacionInicial(boxscore.teams[lado]);

  const lineupListo = fielders.length >= 9;
  if (lineupListo) {
    const idsNecesarios = (dh ? [...fielders, dh] : fielders).map((j) => j.person.id);
    if (idsNecesarios.some((id) => !cachePersonas.has(id))) {
      obtenerPaises(idsNecesarios)
        .then(() => actualizarDetalleJuego(game.gamePk))
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
    ${crearEstadisticasEquipo(boxscore, lado, game.gamePk)}
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
        return { id: persona.id, nombre: nombreConApellido(persona), stat };
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
          .then(() => actualizarDetalleJuego(game.gamePk))
          .catch(() => {});
        return '<p class="vacio">Loading...</p>';
      })();

  return `<h4 class="subtitulo">Last 3 Matchups</h4>${contenido}`;
}

function renderBateadoresSeccion(game) {
  const away = game.teams.away.team;
  const home = game.teams.home.team;

  const idsAlineacionAway = idsAlineacionInicial(game, 'away');
  const idsAlineacionHome = idsAlineacionInicial(game, 'home');

  return `
    <h4 class="subtitulo">Top Hitters vs ${home.name}</h4>
    ${renderListaBateadores(game, away.id, home.id, idsAlineacionAway)}
    <h4 class="subtitulo">Top Hitters vs ${away.name}</h4>
    ${renderListaBateadores(game, home.id, away.id, idsAlineacionHome)}
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

function renderJugadasAnotadorasSeccion(game) {
  const yaEmpezo = game.status.abstractGameState !== 'Preview';
  if (!yaEmpezo) return '';

  if (!feedEnVivo.has(game.gamePk)) {
    obtenerFeedEnVivo(game)
      .then(() => actualizarDetalleJuego(game.gamePk))
      .catch(() => {});
    return `<h4 class="subtitulo">Scoring Plays</h4><p class="vacio">Loading...</p>`;
  }

  const allPlays = feedEnVivo.get(game.gamePk).data.liveData.plays.allPlays ?? [];
  const jugadas = allPlays.filter((p) => p.about?.isScoringPlay);
  const contenido = jugadas.length
    ? jugadas.map((p) => crearJugadaAnotadora(p, game)).join('')
    : '<p class="vacio">No runs scored yet.</p>';

  return `<h4 class="subtitulo">Scoring Plays</h4>${contenido}`;
}

async function obtenerUltimosPartidosEquipo(teamId, temporada, fechaLimite) {
  const clave = `${teamId}-${fechaLimite}`;
  if (cacheUltimosPartidosEquipo.has(clave)) {
    return cacheUltimosPartidosEquipo.get(clave);
  }

  const url = `${API_BASE}/schedule?sportId=1&teamId=${teamId}&season=${temporada}&gameType=R&startDate=${temporada}-01-01&endDate=${fechaLimite}&hydrate=linescore`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();

  const partidos = (data.dates ?? [])
    .flatMap((f) => f.games)
    .filter((g) => g.status.abstractGameState === 'Final')
    .sort((a, b) => new Date(b.gameDate) - new Date(a.gameDate))
    .slice(0, 10);

  cacheUltimosPartidosEquipo.set(clave, partidos);
  return partidos;
}

function crearFilaUltimoPartido(equipoId, g, retorno) {
  const esVisitante = g.teams.away.team.id === equipoId;
  const propio = esVisitante ? g.teams.away : g.teams.home;
  const rival = esVisitante ? g.teams.home : g.teams.away;
  const gano = propio.isWinner;
  const url = construirUrlConRetorno(`/game.html?gamePk=${g.gamePk}&team=${equipoId}`, retorno);

  return `
    <a class="partido-mini" href="${url}">
      <span class="partido-fecha">${formatoFechaCorta(g.officialDate)}</span>
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

function renderUltimosPartidosEquipo(game, equipo) {
  const fechaLimite = fechaAnterior(game.officialDate);
  const clave = `${equipo.id}-${fechaLimite}`;

  if (!cacheUltimosPartidosEquipo.has(clave)) {
    obtenerUltimosPartidosEquipo(equipo.id, game.season, fechaLimite)
      .then(() => actualizarDetalleJuego(game.gamePk))
      .catch(() => {});
    return '<p class="vacio">Loading...</p>';
  }

  const partidos = cacheUltimosPartidosEquipo.get(clave);
  if (partidos.length === 0) {
    return '<p class="vacio">No completed games yet.</p>';
  }

  const retorno = urlRetorno(game.gamePk);
  return `<div class="partidos-lista">${partidos.map((g) => crearFilaUltimoPartido(equipo.id, g, retorno)).join('')}</div>`;
}

function cambiarUltimosEquipo(event, gamePk, lado) {
  event.stopPropagation();
  ultimosEquipoActivo.set(gamePk, lado);
  actualizarDetalleJuego(gamePk);
}

function crearPestanasUltimos(game, lado) {
  const away = game.teams.away.team;
  const home = game.teams.home.team;

  const pestana = (equipo, valor) => `
    <button type="button" class="campo-tab ${lado === valor ? 'activo' : ''}" title="${equipo.name}" onclick="cambiarUltimosEquipo(event, ${game.gamePk}, '${valor}')">
      <img class="campo-tab-logo campo-tab-logo-solo" src="${logoEquipo(equipo.id)}" alt="${equipo.name}" loading="lazy">
    </button>
  `;

  return `<div class="campo-tabs">${pestana(away, 'away')}${pestana(home, 'home')}</div>`;
}

function renderUltimosPartidosSeccion(game) {
  const lado = ultimosEquipoActivo.get(game.gamePk) ?? 'away';
  const tabs = crearPestanasUltimos(game, lado);
  const equipo = lado === 'away' ? game.teams.away.team : game.teams.home.team;

  return `
    ${tabs}
    <h4 class="subtitulo">Last 10 Games — ${equipo.name}</h4>
    ${renderUltimosPartidosEquipo(game, equipo)}
  `;
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
  actualizarDetalleJuego(gamePk);
}

const SECCIONES_JUEGO = [
  { id: 'resumen', etiqueta: 'Summary' },
  { id: 'abridores', etiqueta: 'Starting Pitchers' },
  { id: 'equipos', etiqueta: 'Teams' },
  { id: 'historial', etiqueta: 'Matchups' },
  { id: 'ultimos', etiqueta: 'Last 10 Games' },
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
    case 'ultimos':
      return renderUltimosPartidosSeccion(game);
    case 'bateadores':
      return renderBateadoresSeccion(game);
    default:
      return renderResumenSeccion(game);
  }
}
