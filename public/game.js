const params = new URLSearchParams(window.location.search);
const gamePk = Number(params.get('gamePk'));
const listaGamePks = (params.get('list') ?? '')
  .split(',')
  .map((v) => Number(v))
  .filter((v) => Number.isFinite(v));
const teamId = params.get('team');

let juegoActual = null;
let fechaPartidoTexto = '';

function urlJuego(pk) {
  const q = new URLSearchParams();
  q.set('gamePk', pk);
  if (listaGamePks.length) q.set('list', listaGamePks.join(','));
  if (teamId) q.set('team', teamId);
  // Preserva el origen ("from") actual para que Newer/Older no rompan la
  // cadena de vuelta hacia la pantalla y tarjeta desde la que se llegó aquí.
  return construirUrlConRetorno(`/game.html?${q.toString()}`, retornoDesdeURL());
}

// Hook que consume game-detail.js al construir links a otro partido (ej.
// desde Last 10 Games): la posición a la que "Back" debe volver es esta
// misma página, tal cual está en la URL ahora mismo.
function urlRetorno() {
  return window.location.pathname + window.location.search;
}

function configurarNavegacion() {
  document.getElementById('volver').href =
    retornoDesdeURL() ?? (teamId ? `/teams.html?team=${teamId}&section=ultimos` : '/teams.html');

  const indice = listaGamePks.indexOf(gamePk);
  const btnAnterior = document.getElementById('juego-anterior');
  const btnSiguiente = document.getElementById('juego-siguiente');

  // La lista viene ordenada de más reciente a más antigua: "Newer" retrocede
  // un índice (partido más nuevo), "Older" avanza uno (partido más viejo).
  if (indice > 0) {
    btnAnterior.disabled = false;
    btnAnterior.onclick = () => {
      window.location.href = urlJuego(listaGamePks[indice - 1]);
    };
  }

  if (indice !== -1 && indice < listaGamePks.length - 1) {
    btnSiguiente.disabled = false;
    btnSiguiente.onclick = () => {
      window.location.href = urlJuego(listaGamePks[indice + 1]);
    };
  }
}

// Hook que consume game-detail.js tras cada fetch async de una sección.
function actualizarDetalleJuego(pk) {
  if (juegoActual && juegoActual.gamePk === pk) renderDetalle();
}

// Hook que consume common.js al ordenar una tabla por columna (th-ordenable).
function refrescarVista() {
  if (juegoActual) renderDetalle();
}

function renderDetalle() {
  const contenedor = document.getElementById('detalle-juego');
  const seccion = seccionActiva.get(juegoActual.gamePk) ?? 'resumen';

  contenedor.innerHTML = `
    <div class="juego juego-detalle abierto">
      <p class="fecha-partido">${fechaPartidoTexto}</p>
      <div class="encabezado">
        ${crearEncabezadoJuego(juegoActual)}
      </div>
      <div class="detalle">
        ${crearPestanasSeccion(juegoActual.gamePk, seccion)}
        <div class="seccion-contenido">
          ${renderSeccion(juegoActual, seccion)}
        </div>
      </div>
    </div>
  `;
}

async function cargarJuego() {
  const contenedor = document.getElementById('detalle-juego');

  if (!Number.isFinite(gamePk)) {
    contenedor.innerHTML = '<p class="estado">No game specified.</p>';
    return;
  }

  try {
    const url = `${API_BASE}/schedule?sportId=1&gamePk=${gamePk}&hydrate=linescore,probablePitcher`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    const juego = data.dates?.[0]?.games?.[0];
    if (!juego) {
      contenedor.innerHTML = '<p class="estado">Game not found.</p>';
      return;
    }

    juegoActual = juego;

    const away = juego.teams.away.team.name;
    const home = juego.teams.home.team.name;
    document.title = `${away} @ ${home} · La Bateada`;
    const fechaLarga = new Date(`${juego.officialDate}T12:00:00`).toLocaleDateString('en', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const fechaCapitalizada = fechaLarga.charAt(0).toUpperCase() + fechaLarga.slice(1);
    fechaPartidoTexto = `${fechaCapitalizada} · ${formatoHora(juego.gameDate)}`;

    configurarNavegacion();
    renderDetalle();
  } catch (err) {
    contenedor.innerHTML = `
      <p class="estado">
        Error loading game: ${err.message}
        <br><button type="button" class="retry-btn" onclick="cargarJuego()">Retry</button>
      </p>
    `;
  }
}

cargarJuego();
