<p align="center">
  <a href="README.md">English</a> &middot;
  <a href="README.ko.md">한국어</a> &middot;
  <a href="README.zh.md">中文</a> &middot;
  <a href="README.ja.md">日本語</a> &middot;
  <a href="README.es.md">Español</a>
</p>

<h1 align="center">QuantDesk</h1>
<p align="center">Espacio de trabajo con agentes de IA para trading cuantitativo</p>

<p align="center">
  <a href="#inicio-rápido"><strong>Inicio rápido</strong></a> &middot;
  <a href="doc/OVERVIEW.md"><strong>Documentación</strong></a> &middot;
  <a href="https://github.com/0xbet-ai/QuantDesk"><strong>GitHub</strong></a>
</p>

<p align="center">
  <a href="https://github.com/0xbet-ai/QuantDesk/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0 License" /></a>
  <a href="https://github.com/0xbet-ai/QuantDesk/stargazers"><img src="https://img.shields.io/github/stars/0xbet-ai/QuantDesk?style=flat" alt="Stars" /></a>
</p>

<br/>

<div align="center">
  <video src="https://github.com/user-attachments/assets/cd1ba16d-0e1f-466a-b8f7-4aad7675d997" width="100%" autoplay loop muted playsinline></video>
</div>

<br/>

## ¿Qué es QuantDesk?

**Encuentra estrategias rentables rápidamente — antes de que el mercado se mueva.**

En la era del vibe coding, cientos de productos se lanzan cada día, pero el mantenimiento y la iteración son el verdadero cuello de botella. Las estrategias de trading son diferentes: **una estrategia que funciona un solo día ya es rentable.** Cuando deja de funcionar, buscas la siguiente.

Lo difícil no es escribir el código — es el ciclo tedioso de descargar datos, hacer backtesting, ajustar parámetros, verificar el sobreajuste y validar en modo paper. QuantDesk automatiza todo este ciclo con agentes de IA para que puedas concentrarte en las ideas, no en la infraestructura.

> **Todos los scripts se ejecutan dentro de contenedores Docker aislados.** Nada toca tu máquina host — las estrategias, backtests, obtención de datos y paper trading se ejecutan en contenedores sandbox con imágenes fijas. Tu entorno local permanece limpio sin importar lo que el agente escriba.

|        | Paso                      | Qué sucede                                                                                           |
| ------ | ------------------------- | ---------------------------------------------------------------------------------------------------- |
| **01** | Describe tu estrategia    | Dile al agente Analista lo que quieres operar — en lenguaje natural. O elige del catálogo curado.    |
| **02** | Backtest e iteración      | El agente escribe el código de la estrategia, obtiene datos, ejecuta backtests e itera según los resultados. |
| **03** | Validación con Risk Manager | Envía los resultados a validación. El Risk Manager verifica sobreajuste, sesgos y anomalías.        |
| **04** | Paper trading             | Promueve una estrategia aprobada a paper trading. Datos de mercado reales, dinero simulado.          |

<br/>

## QuantDesk es para ti si

- Quieres **investigar y validar estrategias de trading más rápido** de lo que permite el backtesting manual
- Tienes **ideas de trading** pero no quieres configurar pipelines de datos, motores y contenedores Docker tú mismo
- Quieres una IA que **escriba, ejecute e itere código de estrategia** — no solo genere texto
- Quieres un **Risk Manager** que valide los resultados de forma independiente antes de arriesgar capital
- Quieres hacer **paper trading** con estrategias validadas contra mercados en vivo sin tocar dinero real
- Quieres **un solo espacio de trabajo** que registre experimentos, datasets, ejecuciones y versiones de código en un solo lugar

<br/>

## Funcionalidades

<table>
<tr>
<td align="center" width="33%">
<strong>Agente Analista</strong><br/>
Escribe código de estrategia, obtiene datos de mercado, ejecuta backtests e itera según los resultados. Habla tu idioma — describe una tesis en lenguaje natural y el agente la construye.
</td>
<td align="center" width="33%">
<strong>Risk Manager</strong><br/>
Agente de validación independiente. Verifica sobreajuste, sesgo de anticipación, sesgo de supervivencia y supuestos irrealistas. Bloquea el paper trading hasta que lo apruebe.
</td>
<td align="center" width="33%">
<strong>Paper Trading</strong><br/>
Promueve estrategias aprobadas a modo paper. Feeds de mercado reales, billetera simulada. Demuestra que una estrategia funciona antes de ir en vivo — sin API keys, sin dinero real en riesgo.
</td>
</tr>
<tr>
<td align="center">
<strong>Seguimiento de Experimentos</strong><br/>
Cada hipótesis tiene su propio experimento. Compara ejecuciones lado a lado con métricas normalizadas a través de diferentes motores y marcos temporales.
</td>
<td align="center">
<strong>Versionado de Código</strong><br/>
Workspace git por desk. El agente hace commit en cada cambio. Cada ejecución se vincula a su commit hash exacto — reproducibilidad completa.
</td>
<td align="center">
<strong>Motores Conectables</strong><br/>
Freqtrade para estrategias TA clásicas. Nautilus Trader para estrategias event-driven a nivel de tick. Generic como fallback para todo lo demás — el agente escribe scripts en Python, Node, Rust o Go.
</td>
</tr>
</table>

<br/>

## Flujo de Trabajo

<p align="center">
  <img src="doc/assets/workflow.svg" alt="Flujo de trabajo de QuantDesk: Strategy Desk → Analyst Agent → Experiment Loop → Risk Manager → Paper Trading" width="640" />
</p>

<br/>

## ¿Por qué no dejar que la IA opere directamente?

QuantDesk **no** se enfoca en que los agentes de IA ejecuten operaciones de forma autónoma. Ese enfoque es ineficiente en costos e irrealista a escala.

La mayor parte del trading rentable es un proceso de investigación: recopilar datos, hacer backtesting de hipótesis, ajustar parámetros para evitar el sobreajuste y validar en modo paper antes de comprometer capital. El cuello de botella es la velocidad de iteración de este ciclo — no la ejecución.

QuantDesk coloca a los agentes de IA donde aportan más valor: **automatizando el ciclo de investigación y validación** para que puedas probar más ideas, más rápido.

Paper trading es el límite de QuantDesk. El trading en vivo requiere API keys de exchanges o claves privadas de billeteras — ese es un modelo de confianza diferente y un no-objetivo explícito de este proyecto.

<br/>

## Exchanges Soportados

<div align="center">
<table>
  <tr>
    <td align="center"><strong>Cripto (CEX)</strong></td>
    <td>Binance &middot; Bybit &middot; OKX &middot; Kraken &middot; Gate.io &middot; KuCoin &middot; HTX &middot; Bitget &middot; BitMart &middot; BingX &middot; Bitvavo &middot; BitMEX &middot; Deribit</td>
  </tr>
  <tr>
    <td align="center"><strong>Cripto (DEX)</strong></td>
    <td>Hyperliquid &middot; dYdX</td>
  </tr>
  <tr>
    <td align="center"><strong>Mercados de Predicción</strong></td>
    <td>Polymarket &middot; Kalshi &middot; Betfair</td>
  </tr>
  <tr>
    <td align="center"><strong>Acciones</strong></td>
    <td>Interactive Brokers</td>
  </tr>
</table>
</div>

La selección del motor es automática: elige un modo de estrategia (`classic` o `realtime`) y un exchange — el sistema resuelve el motor por ti.

| Modo | Motor | Ideal para |
|------|-------|------------|
| `classic` | Freqtrade | Estrategias TA basadas en velas — seguimiento de tendencia, reversión a la media, momentum |
| `realtime` | Nautilus Trader | Estrategias event-driven a nivel de tick — market making, arbitraje, HFT |
| (fallback) | Generic | Cualquier exchange sin motor gestionado — el agente escribe scripts en Python/Node/Rust/Go |

<br/>

## Inicio Rápido

Código abierto. Auto-alojado. Sin cuenta requerida.

```bash
npx quantdesk onboard --yes
```

Eso es todo. Clona el repositorio, instala dependencias, descarga imágenes Docker de los motores, ejecuta migraciones de base de datos e inicia el servidor en `http://localhost:5173`.

Un PostgreSQL embebido se inicia en proceso — no se necesita Docker para la base de datos. Docker se usa exclusivamente para los contenedores de motores.

> **Requisitos:** Node.js 20+, pnpm 9.15+, Docker (en ejecución), Claude CLI (`claude`) o Codex CLI (`codex`)

<details>
<summary>Instalación manual</summary>

```bash
git clone https://github.com/0xbet-ai/QuantDesk.git
cd QuantDesk
pnpm install
pnpm onboard --yes
```

</details>

<br/>

## Autenticación

Por defecto, QuantDesk se ejecuta en **modo de confianza local** — sin inicio de sesión, usuario único, configuración cero. Ideal para desarrollo local.

Para habilitar el inicio de sesión (para servidores compartidos o despliegues en la nube):

```bash
QUANTDESK_DEPLOYMENT_MODE=authenticated pnpm dev
```

En la primera visita verás una página de registro. Crea tu cuenta con email y contraseña — eso es todo.

| Variable | Valor por defecto | Descripción |
|----------|-------------------|-------------|
| `QUANTDESK_DEPLOYMENT_MODE` | `local_trusted` | Establecer a `authenticated` para requerir inicio de sesión |
| `BETTER_AUTH_SECRET` | `quantdesk-dev-secret` | Secreto de firma de sesión — **cámbialo en producción** |
| `DATABASE_URL` | (embebido) | URL de Postgres externo para despliegues compartidos |

Para producción, también establece `auth.disableSignUp: true` en `~/.quantdesk/config.json` después de crear tu cuenta para prevenir registros no autorizados.

<br/>

## Desarrollo

```bash
pnpm dev           # Iniciar servidor + UI (modo desarrollo)
pnpm build         # Compilar todos los paquetes
pnpm typecheck     # Verificación de tipos TypeScript
pnpm check         # Lint + formato con Biome
pnpm test          # Suite de tests con Vitest
pnpm db:migrate    # Ejecutar migraciones de Drizzle
pnpm db:reset      # Reiniciar DB y re-sembrar datos
```

Consulta [`doc/OVERVIEW.md`](doc/OVERVIEW.md) para la arquitectura y [`CLAUDE.md`](CLAUDE.md) para las reglas del proyecto.

<br/>

## Stack Tecnológico

| Capa | Elección |
|------|----------|
| Monorepo | pnpm workspaces |
| Backend | Express.js + WebSocket |
| Base de datos | PostgreSQL 17 (embebido), Drizzle ORM |
| Frontend | React 19, Vite, Tailwind CSS, Radix UI |
| Agente IA | Claude CLI / Codex CLI subprocess |
| Motores | Freqtrade, Nautilus Trader, Generic (Docker) |
| Validación | Zod |
| Testing | Vitest |
| Linting | Biome |

<br/>

## Contribuir

Las contribuciones son bienvenidas. Consulta la [guía de contribución](CONTRIBUTING.md) para más detalles.

<br/>

## Licencia

AGPL-3.0

<br/>

---

<p align="center">
  <sub>Código abierto bajo AGPL-3.0. Hecho para personas que operan con ideas, no con pulsaciones de teclas.</sub>
</p>
