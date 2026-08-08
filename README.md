# La Bateada

Página minimalista con los resultados de MLB del día. Sitio estático: no hay build de JS ni framework — el HTML/CSS/JS en `public/` se sirve tal cual, y `public/app.js` consulta la API pública de MLB Stats directamente desde el navegador.

## Desarrollo local

```bash
npm install
npm run dev          # sirve public/ en http://localhost:3000 vía server.js (Node http puro)
npm run watch:css    # en otra terminal, si estás tocando estilos (Tailwind)
```

`server.js` solo se usa para desarrollo local. En producción, Cloudflare sirve los archivos de `public/` directamente — no hay backend que desplegar.

## Despliegue en Cloudflare

El sitio se despliega como **Cloudflare Workers (static assets)**: no hay Worker script, solo la carpeta `public/` servida como assets. La configuración vive en `wrangler.jsonc`.

### Requisitos

- Cuenta de Cloudflare.
- `wrangler` (ya está como devDependency — se instala con `npm install`).

### Primer despliegue

```bash
npm install
npx wrangler login       # abre el navegador para autenticar la CLI con tu cuenta de Cloudflare
```

Antes de desplegar, generá el CSS compilado (es un artefacto que se sirve tal cual, no se compila en Cloudflare):

```bash
npm run build:css
```

Luego:

```bash
npm run deploy            # equivalente a: wrangler deploy
```

Esto sube los archivos de `public/` (definidos en `wrangler.jsonc` → `assets.directory`) y publica el sitio en `https://la-bateada.<tu-subdominio>.workers.dev`.

### Despliegues posteriores

Cada vez que cambien archivos en `public/` (o corras `npm run build:css` tras editar estilos), repetí:

```bash
npm run build:css   # solo si tocaste styles/input.css
npm run deploy
```

### Dominio propio (opcional)

Para usar un dominio propio en vez del subdominio `workers.dev`, agregá una ruta en el dashboard de Cloudflare (Workers & Pages → tu Worker → Settings → Domains & Routes) o vía `wrangler.jsonc` con `routes`. Ver la [documentación de Custom Domains para Workers](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

### Verificar antes de desplegar

```bash
npx wrangler deploy --dry-run
```

Valida la configuración y muestra qué archivos se subirían, sin publicar nada.

## Notas

- No hay variables de entorno ni bindings (KV, D1, etc.) — el sitio no tiene backend propio, todo el fetch de datos ocurre en el cliente contra `statsapi.mlb.com`.
- `public/style.css` es un artefacto generado por `npm run build:css` a partir de `styles/input.css`; no se edita a mano y debe regenerarse antes de cada deploy si cambiaron los estilos.
