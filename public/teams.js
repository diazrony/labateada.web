const TEMPORADA = new Date().getFullYear();

const LIGAS = { 103: 'American League', 104: 'National League' };

const DIVISIONES = {
  200: { nombre: 'AL West', liga: 103 },
  201: { nombre: 'AL East', liga: 103 },
  202: { nombre: 'AL Central', liga: 103 },
  203: { nombre: 'NL West', liga: 104 },
  204: { nombre: 'NL East', liga: 104 },
  205: { nombre: 'NL Central', liga: 104 },
};

const SECCIONES_EQUIPO = [
  { id: 'bateadores', etiqueta: 'Top Hitters vs Team' },
  { id: 'pitchers', etiqueta: 'Top K Pitchers vs Team' },
];

let registros = new Map();
const expandidos = new Set();
const seccionActiva = new Map();
const cacheRosterActivo = new Map();
const cacheTopBateadores = new Map();
const cacheTopPitchers = new Map();

function trocear(arr, tam) {
  const resultado = [];
  for (let i = 0; i < arr.length; i += tam) resultado.push(arr.slice(i, i + tam));
  return resultado;
}

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
        if (expandidos.has(equipo.id)) renderLigas();
      })
      .catch(() => {});
    return `<p class="vacio">Scanning ${equipo.leagueNombre} rosters, this can take a few seconds...</p>`;
  }

  const datos = cache.get(equipo.id);
  const columnas = grupo === 'pitching' ? ['G', 'K', 'BB', 'H', 'AVG'] : ['G', 'AB', 'H', 'HR', 'AVG', 'OPS'];
  const crearFila = grupo === 'pitching' ? crearFilaTopPitcher : crearFilaTopBateador;
  const titulo = grupo === 'pitching' ? 'Most strikeouts vs' : 'Most hits vs';
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

  return `
    <h4 class="subtitulo">${titulo} ${equipo.nombre}</h4>
    ${crearTablaJugadores(`top-${grupo}-${equipo.id}`, datos, columnas, crearFila, obtenerValores)}
  `;
}

function renderInfoSeccion(equipo) {
  const gb = equipo.gamesBack === '-' ? '0' : equipo.gamesBack;

  return `
    <div class="equipo-registro">
      <span class="equipo-registro-item"><strong>League:</strong> ${equipo.leagueNombre}</span>
      <span class="equipo-registro-item"><strong>Division:</strong> ${equipo.divisionNombre}</span>
      <span class="equipo-registro-item"><strong>Division rank:</strong> ${ordinal(equipo.divisionRank)}</span>
      <span class="equipo-registro-item"><strong>League rank:</strong> ${ordinal(equipo.leagueRank)}</span>
      <span class="equipo-registro-item"><strong>Record:</strong> ${equipo.wins}-${equipo.losses}</span>
      <span class="equipo-registro-item"><strong>GB:</strong> ${gb}</span>
    </div>
  `;
}

function renderSeccionEquipo(equipo, seccion) {
  switch (seccion) {
    case 'pitchers':
      return renderTopSeccion(equipo, 'pitching');
    default:
      return renderTopSeccion(equipo, 'hitting');
  }
}

function cambiarSeccionEquipo(event, teamId, seccion) {
  event.stopPropagation();
  seccionActiva.set(teamId, seccion);
  renderLigas();
}

function crearPestanasSeccionEquipo(teamId, activa) {
  return `
    <div class="seccion-tabs" role="tablist">
      ${SECCIONES_EQUIPO.map(
        (s) => `
        <button type="button" class="seccion-tab ${activa === s.id ? 'activo' : ''}" role="tab" aria-selected="${activa === s.id}" onclick="cambiarSeccionEquipo(event, ${teamId}, '${s.id}')">${s.etiqueta}</button>
      `
      ).join('')}
    </div>
  `;
}

function crearEquipoCard(equipo) {
  const abierto = expandidos.has(equipo.id);
  const div = document.createElement('div');
  div.className = `equipo-card ${abierto ? 'abierto' : ''}`;

  div.innerHTML = `
    <div class="equipo-card-encabezado">
      <img class="logo" src="${logoEquipo(equipo.id)}" alt="" loading="lazy">
      <span class="equipo-card-nombre">${equipo.nombre}</span>
      <span class="equipo-card-record">${equipo.wins}-${equipo.losses}</span>
    </div>
    ${
      abierto
        ? `
      <div class="detalle">
        ${renderInfoSeccion(equipo)}
        ${crearPestanasSeccionEquipo(equipo.id, seccionActiva.get(equipo.id) ?? 'bateadores')}
        <div class="seccion-contenido">
          ${renderSeccionEquipo(equipo, seccionActiva.get(equipo.id) ?? 'bateadores')}
        </div>
      </div>
    `
        : ''
    }
  `;

  div.querySelector('.equipo-card-encabezado').addEventListener('click', () => {
    if (expandidos.has(equipo.id)) {
      expandidos.delete(equipo.id);
    } else {
      expandidos.add(equipo.id);
    }
    renderLigas();
  });

  return div;
}

function refrescarVista() {
  renderLigas();
}

function renderLigas() {
  const contenedor = document.getElementById('ligas');
  contenedor.innerHTML = '';

  if (registros.size === 0) {
    contenedor.innerHTML = '<p class="estado">No standings available.</p>';
    return;
  }

  [103, 104].forEach((leagueId) => {
    const seccion = document.createElement('section');
    seccion.className = 'liga';

    const titulo = document.createElement('h2');
    titulo.className = 'liga-titulo';
    titulo.textContent = LIGAS[leagueId];
    seccion.appendChild(titulo);

    Object.entries(DIVISIONES)
      .filter(([, info]) => info.liga === leagueId)
      .forEach(([divisionId]) => {
        const equipos = [...registros.values()]
          .filter((e) => e.divisionId === Number(divisionId))
          .sort((a, b) => a.divisionRank - b.divisionRank);

        if (equipos.length === 0) return;

        const grupo = document.createElement('div');
        grupo.className = 'division-grupo';

        const subtitulo = document.createElement('h3');
        subtitulo.className = 'division-titulo';
        subtitulo.textContent = equipos[0].divisionNombre;
        grupo.appendChild(subtitulo);

        const lista = document.createElement('div');
        lista.className = 'equipo-lista';
        equipos.forEach((equipo) => lista.appendChild(crearEquipoCard(equipo)));
        grupo.appendChild(lista);

        seccion.appendChild(grupo);
      });

    contenedor.appendChild(seccion);
  });
}

async function cargarEquipos() {
  const contenedor = document.getElementById('ligas');

  try {
    const resp = await fetch(
      `${API_BASE}/standings?leagueId=103,104&season=${TEMPORADA}&standingsTypes=regularSeason`
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    const nuevosRegistros = new Map();
    (data.records ?? []).forEach((bloque) => {
      const divisionId = bloque.division?.id;
      const info = DIVISIONES[divisionId] ?? { nombre: '', liga: bloque.league?.id };

      (bloque.teamRecords ?? []).forEach((tr) => {
        nuevosRegistros.set(tr.team.id, {
          id: tr.team.id,
          nombre: tr.team.name,
          wins: tr.wins,
          losses: tr.losses,
          divisionRank: Number(tr.divisionRank),
          leagueRank: Number(tr.leagueRank),
          gamesBack: tr.gamesBack,
          divisionId,
          divisionNombre: info.nombre,
          leagueId: info.liga,
          leagueNombre: LIGAS[info.liga] ?? '',
        });
      });
    });

    registros = nuevosRegistros;
    renderLigas();
  } catch (err) {
    contenedor.innerHTML = `<p class="estado">Error loading teams: ${err.message}</p>`;
  }
}

cargarEquipos();
