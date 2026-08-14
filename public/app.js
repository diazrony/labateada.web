let ultimosJuegos = [];
let fechaSeleccionada;
const expandidos = new Set();

fechaSeleccionada = fechaHoy();

// Hook que consume game-detail.js: cuando una sección termina de cargar sus
// datos async, sólo hace falta re-renderizar si la tarjeta sigue expandida.
function actualizarDetalleJuego(gamePk) {
  if (expandidos.has(gamePk)) renderContenedor();
}

function crearTarjetaJuego(game) {
  const abierto = expandidos.has(game.gamePk);

  const div = document.createElement('div');
  div.className = `juego ${abierto ? 'abierto' : ''}`;

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
  window.scrollTo(scrollX, scrollY);
  requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));
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

cargarJuegos();
setInterval(cargarJuegos, 15000);
