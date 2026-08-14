let ultimosJuegos = [];
let fechaSeleccionada;
const expandidos = new Set();

fechaSeleccionada = fechaHoy();

// Hook que consume game-detail.js: cuando una sección termina de cargar sus
// datos async, sólo hace falta re-renderizar si la tarjeta sigue expandida.
function actualizarDetalleJuego(gamePk) {
  if (expandidos.has(gamePk)) renderContenedor();
}

// Hook que consume game-detail.js al construir links a otro partido (ej.
// desde Last 10 Games o Starting Pitchers): vuelve a esta tarjeta expandida,
// en la misma sección y sub-pestaña de equipo que estaba activa, en la
// fecha actual y con el scroll de la página tal cual estaba.
function urlRetorno(gamePk) {
  const seccion = seccionActiva.get(gamePk) ?? 'resumen';
  const params = new URLSearchParams({ game: gamePk, fecha: fechaSeleccionada, section: seccion });

  const lado = ladoActivoParaSeccion(gamePk, seccion);
  if (lado) params.set('lado', lado);
  params.set('scroll', Math.round(window.scrollY));

  return `/index.html?${params.toString()}`;
}

function crearTarjetaJuego(game) {
  const abierto = expandidos.has(game.gamePk);

  const div = document.createElement('div');
  div.className = `juego ${abierto ? 'abierto' : ''}`;
  div.dataset.gameId = game.gamePk;

  div.innerHTML = `
    <div class="encabezado">
      ${crearEncabezadoJuego(game)}
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
      detenerPollingEnVivo(game.gamePk);
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

function refrescarVista() {
  renderContenedor();
}

function renderContenedor() {
  const contenedor = document.getElementById('juegos');
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  // Si el elemento con foco (el botón que se acaba de clickear) queda
  // desconectado del DOM al limpiar el contenedor, el navegador mueve el
  // foco a <body> y hace scroll al tope de la página. Se quita el foco
  // explícitamente antes de desconectarlo para evitar ese salto.
  if (document.activeElement && contenedor.contains(document.activeElement)) {
    document.activeElement.blur();
  }

  contenedor.innerHTML = '';

  if (ultimosJuegos.length === 0) {
    contenedor.innerHTML = '<p class="estado">No games scheduled for this date.</p>';
  } else {
    ultimosJuegos.forEach((game) => {
      contenedor.appendChild(crearTarjetaJuego(game));
    });
  }

  // Reemplazar todo el contenedor puede achicar la página momentáneamente
  // (ej. mientras carga el tab de Abridores) y el navegador ajusta el
  // scroll a ese alto menor; se restaura para que no "salte" al tope.
  // El segundo restore en rAF cubre a los navegadores (sobre todo móviles)
  // que reajustan el scroll por el cambio de foco recién en el próximo frame.
  // Se salta este restore mientras hay un scroll pendiente hacia una tarjeta
  // pedida por URL (ver desplazarAJuegoDesdeURL): si no, el rAF de acá
  // pisaría ese scrollIntoView un frame después, devolviendo la página al
  // tope antes de que el usuario llegue a verlo.
  if (Number.isFinite(scrollGuardadoPendiente)) {
    aplicarScrollGuardado();
  } else if (!scrollAJuegoPendiente) {
    window.scrollTo(scrollX, scrollY);
    requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));
  }
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
  detenerTodoElPollingEnVivo();
  expandidos.clear();
  cargarJuegos();
}

// Soporta volver desde game.html (?game=ID&fecha=YYYY-MM-DD&section=ultimos
// &lado=home&scroll=1234) reabriendo la misma tarjeta de partido en la misma
// sección, sub-pestaña de equipo y fecha.
function aplicarParametrosURL() {
  const params = new URLSearchParams(window.location.search);
  const fecha = params.get('fecha');
  if (fecha) fechaSeleccionada = fecha;

  const gamePk = Number(params.get('game'));
  if (!Number.isFinite(gamePk)) return;

  expandidos.add(gamePk);
  const seccion = params.get('section');
  if (seccion) seccionActiva.set(gamePk, seccion);

  const lado = params.get('lado');
  if (lado && seccion) aplicarLadoParaSeccion(gamePk, seccion, lado);

  const scroll = params.get('scroll');
  if (scroll !== null) {
    scrollGuardadoPendiente = Number(scroll);
    scrollGuardadoVence = Date.now() + 5000;
  }
}

// Sólo se ejecuta una vez: cargarJuegos() se repite cada 15s por el polling
// (ver setInterval más abajo) y no debe reubicar el scroll en cada refresco.
let scrollAJuegoPendiente = true;
let scrollGuardadoPendiente = null;
let scrollGuardadoVence = 0;

function desplazarAJuegoDesdeURL() {
  if (!scrollAJuegoPendiente) return;
  scrollAJuegoPendiente = false;

  const gamePk = new URLSearchParams(window.location.search).get('game');
  if (!gamePk) return;

  // Si venimos de un link "de vuelta" con scroll guardado, se restaura la
  // posición exacta; si no, alcanza con llevar la tarjeta al inicio.
  if (Number.isFinite(scrollGuardadoPendiente)) {
    aplicarScrollGuardado();
    return;
  }

  document.querySelector(`[data-game-id="${gamePk}"]`)?.scrollIntoView({ block: 'start' });
}

// La sección activa puede seguir creciendo mientras terminan de llegar sus
// datos async (ver actualizarDetalleJuego) después de este primer scroll, así
// que el alto máximo de scroll en este momento puede ser menor al que había
// cuando se guardó esta posición. Se reintenta en cada render (ver
// renderContenedor) hasta que ese alto alcance para llegar exactamente ahí, o
// hasta que venza la ventana de reintento — para no seguir empujando el
// scroll del usuario una vez que ya se fue a otra parte de la página.
function aplicarScrollGuardado() {
  if (!Number.isFinite(scrollGuardadoPendiente)) return;

  if (Date.now() > scrollGuardadoVence) {
    scrollGuardadoPendiente = null;
    return;
  }

  window.scrollTo(0, scrollGuardadoPendiente);
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  if (maxScroll >= scrollGuardadoPendiente) scrollGuardadoPendiente = null;
}

async function cargarJuegos() {
  const contenedor = document.getElementById('juegos');
  const fecha = fechaSeleccionada;

  actualizarControlesFecha();

  document.getElementById('fecha').textContent = new Date(`${fecha}T12:00:00`).toLocaleDateString('es', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
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
    desplazarAJuegoDesdeURL();
  } catch (err) {
    contenedor.innerHTML = `
      <p class="estado">
        Error al cargar los resultados: ${err.message}
        <br><button type="button" class="retry-btn" onclick="cargarJuegos()">Retry</button>
      </p>
    `;
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

aplicarParametrosURL();
cargarJuegos();
setInterval(cargarJuegos, 15000);
