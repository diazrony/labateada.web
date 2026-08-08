# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

La Bateada is a minimalist single-page site that displays today's MLB game results. It has no build step, no framework, and no dependencies — plain Node.js on the backend and vanilla JS/CSS/HTML on the frontend. UI labels, section names, and stats terminology are in English; a few date/status strings (e.g. the header date, inning half) use Spanish locale formatting.

## Commands

- `npm start` / `npm run dev` — run the server at `http://localhost:3000` (both scripts are identical: `node server.js`)
- No test suite, linter, or build step exists in this repo.

## Architecture

- `server.js` — a static file server built directly on Node's `http` module (no Express or other framework). It serves files from `public/`, maps `/` to `/index.html`, and guards against path traversal by resolving the request path and checking it stays within `PUBLIC_DIR`. Only `.html`, `.css`, `.js`, and `.ico` have explicit MIME types.
- `public/app.js` — all client-side logic lives in this one file:
  - Fetches today's schedule directly from the public MLB Stats API (`https://statsapi.mlb.com/api/v1/schedule`) client-side — there is no backend API proxy/route.
  - `cargarJuegos()` drives the page: builds the date, fetches the schedule with `hydrate=linescore,probablePitcher`, sorts games (live games first, then by start time via `ordenarJuegos`), and renders one card per game via `crearTarjetaJuego`.
  - `infoEstado()` maps MLB's `detailedState` values to the status labels/live indicator shown on each card.
  - Expanded game cards use a section-tab UI (`crearPestanasSeccion`/`renderSeccion`): Summary (boxscore), Starting Pitchers (probable pitcher + last 7 game logs via `obtenerDatosAbridor`, role derived from `gamesStarted`), Teams (lineup + hitting + pitching stats, all scoped to one team via a shared `equipoActivo` tab switcher), and Matchups (head-to-head history). Each section's data loads lazily, only when that tab is first opened.
  - Polls the API every 15 seconds (`setInterval(cargarJuegos, 15000)`) to keep live scores current.
- `public/index.html` / `public/style.css` — minimal markup and CSS; light theme only (no dark mode/`prefers-color-scheme` support, no JS-based theme toggle).

Since nearly all behavior lives in `public/app.js`, most feature work (new game states, different sorting, additional game info) happens there rather than in `server.js`.
