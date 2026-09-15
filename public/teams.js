const TEMPORADA = new Date().getFullYear();

const VISTAS_STANDINGS = [
  { id: 'division', etiqueta: 'Division' },
  { id: 'league', etiqueta: 'League' },
  { id: 'overall', etiqueta: 'Overall' },
];

let registros = new Map();
let vistaActiva = 'division';
let scrollGuardadoPendiente = null;

function ordenarPorPct(a, b) {
  const pa = a.wins / (a.wins + a.losses || 1);
  const pb = b.wins / (b.wins + b.losses || 1);
  return pb - pa;
}

function cambiarVista(vista) {
  vistaActiva = vista;
  renderLigas();
}

function crearPestanasVista() {
  return `
    <div class="seccion-tabs" role="tablist">
      ${VISTAS_STANDINGS.map(
        (v) => `
        <button type="button" class="seccion-tab ${vistaActiva === v.id ? 'activo' : ''}" role="tab" aria-selected="${vistaActiva === v.id}" onclick="cambiarVista('${v.id}')">${v.etiqueta}</button>
      `
      ).join('')}
    </div>
  `;
}

function irAEquipo(event, teamId) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const retorno = `/teams.html?scroll=${Math.round(window.scrollY)}`;
  window.location.href = construirUrlConRetorno(`/team.html?id=${teamId}`, retorno);
}

function crearFilaEquipo(equipo, rank, lider) {
  const l10 = equipo.lastTenWins !== null ? `${equipo.lastTenWins}-${equipo.lastTenLosses}` : '—';
  const streak = equipo.streakCode ?? '—';
  const streakClase = streak.startsWith('W') ? 'text-success' : streak.startsWith('L') ? 'text-live-600' : 'text-muted';

  return `
    <tr class="fila-clicable" onclick="irAEquipo(event, ${equipo.id})">
      <td>${rank}</td>
      <td class="nombre-jugador">
        <span class="inline-flex items-center gap-1.5">
          <img class="logo" src="${logoEquipo(equipo.id)}" alt="" loading="lazy">
          ${equipo.nombre}
        </span>
      </td>
      <td>${equipo.wins}</td>
      <td>${equipo.losses}</td>
      <td>${formatoPct(equipo.wins, equipo.losses)}</td>
      <td>${calcularJuegosAtras(equipo, lider)}</td>
      <td>${l10}</td>
      <td class="font-semibold ${streakClase}">${streak}</td>
    </tr>
  `;
}

function crearTablaEquipos(equipos, lider) {
  if (equipos.length === 0) return '<p class="vacio">No standings available.</p>';

  return `
    <div class="boxscore-wrap">
      <table class="tabla-stats">
        <thead>
          <tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>PCT</th><th>GB</th><th>L10</th><th>STRK</th></tr>
        </thead>
        <tbody>${equipos.map((e, i) => crearFilaEquipo(e, i + 1, lider)).join('')}</tbody>
      </table>
    </div>
  `;
}

function renderVistaDivision(todos) {
  return [103, 104]
    .map((leagueId) => {
      const divisiones = Object.entries(DIVISIONES_MLB).filter(([, info]) => info.liga === leagueId);
      const grupos = divisiones
        .map(([divisionId]) => {
          const equipos = todos
            .filter((e) => e.divisionId === Number(divisionId))
            .sort((a, b) => a.divisionRank - b.divisionRank);
          if (equipos.length === 0) return '';

          return `
            <div class="division-grupo">
              <h3 class="division-titulo">${equipos[0].divisionNombre}</h3>
              ${crearTablaEquipos(equipos, equipos[0])}
            </div>
          `;
        })
        .join('');

      return `
        <section class="liga">
          <h2 class="liga-titulo">${LIGAS_MLB[leagueId]}</h2>
          ${grupos}
        </section>
      `;
    })
    .join('');
}

function renderVistaLeague(todos) {
  return [103, 104]
    .map((leagueId) => {
      const equipos = todos.filter((e) => e.leagueId === leagueId).sort(ordenarPorPct);
      if (equipos.length === 0) return '';

      return `
        <section class="liga">
          <h2 class="liga-titulo">${LIGAS_MLB[leagueId]}</h2>
          ${crearTablaEquipos(equipos, equipos[0])}
        </section>
      `;
    })
    .join('');
}

function renderVistaOverall(todos) {
  const equipos = todos.slice().sort(ordenarPorPct);
  return `
    <section class="liga">
      <h2 class="liga-titulo">MLB Overall</h2>
      ${crearTablaEquipos(equipos, equipos[0])}
    </section>
  `;
}

function renderLigas() {
  const contenedor = document.getElementById('ligas');

  if (registros.size === 0) {
    contenedor.innerHTML = '<p class="estado">No standings available.</p>';
    return;
  }

  const todos = [...registros.values()];
  const cuerpo =
    vistaActiva === 'league' ? renderVistaLeague(todos) : vistaActiva === 'overall' ? renderVistaOverall(todos) : renderVistaDivision(todos);

  contenedor.innerHTML = `${crearPestanasVista()}${cuerpo}`;
}

function aplicarParametrosURL() {
  const scroll = new URLSearchParams(window.location.search).get('scroll');
  scrollGuardadoPendiente = scroll !== null ? Number(scroll) : null;
}

async function cargarEquipos() {
  const contenedor = document.getElementById('ligas');

  try {
    registros = await obtenerStandingsLiga(TEMPORADA);
    renderLigas();

    if (Number.isFinite(scrollGuardadoPendiente)) {
      window.scrollTo(0, scrollGuardadoPendiente);
      scrollGuardadoPendiente = null;
    }
  } catch (err) {
    contenedor.innerHTML = `
      <p class="estado">
        Error loading standings: ${err.message}
        <br><button type="button" class="retry-btn" onclick="cargarEquipos()">Retry</button>
      </p>
    `;
  }
}

aplicarParametrosURL();
cargarEquipos();
