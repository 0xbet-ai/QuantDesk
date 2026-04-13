<h1 align="center">QuantDesk</h1>
<p align="center">퀀트 트레이딩을 위한 AI 에이전트 워크스페이스</p>

<p align="center">
  <a href="#빠른-시작"><strong>빠른 시작</strong></a> &middot;
  <a href="doc/OVERVIEW.md"><strong>문서</strong></a> &middot;
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

## QuantDesk란?

**수익성 있는 전략을 빠르게 찾으세요 — 시장이 움직이기 전에.**

바이브 코딩 시대에 매일 수백 개의 제품이 출시되지만, 유지보수와 반복 개선이 진짜 병목입니다. 트레이딩 전략은 다릅니다: **하루만 작동하는 전략도 이미 수익성이 있습니다.** 작동을 멈추면 다음 전략을 찾으면 됩니다.

어려운 것은 코드를 작성하는 게 아닙니다 — 데이터 다운로드, 백테스트, 파라미터 조정, 과적합 확인, 페이퍼 모드 검증이라는 지루한 사이클이 문제입니다. QuantDesk는 AI 에이전트로 이 전체 루프를 자동화하여 아이디어에만 집중할 수 있게 합니다.

> **모든 스크립트는 격리된 Docker 컨테이너에서 실행됩니다.** 호스트 머신에는 아무것도 영향을 주지 않습니다 — 전략, 백테스트, 데이터 fetch, 페이퍼 트레이딩 모두 고정 이미지의 샌드박스 컨테이너에서 실행됩니다.

|        | 단계                      | 설명                                                                                           |
| ------ | ------------------------- | ---------------------------------------------------------------------------------------------- |
| **01** | 전략 설명                  | 애널리스트 에이전트에게 원하는 트레이딩을 설명하세요. 또는 큐레이션된 카탈로그에서 선택하세요.       |
| **02** | 백테스트 및 반복            | 에이전트가 전략 코드를 작성하고, 데이터를 가져오고, 백테스트를 실행하고, 결과를 기반으로 반복합니다. |
| **03** | 리스크 매니저 검증          | 결과를 검증에 넘깁니다. 리스크 매니저가 과적합, 편향, 이상치를 확인합니다.                         |
| **04** | 페이퍼 트레이딩             | 승인된 전략을 페이퍼 트레이딩으로 승격합니다. 실제 시장 데이터, 가상 자금.                         |

<br/>

## 이런 분에게 적합합니다

- 수동 백테스트보다 **빠르게 트레이딩 전략을 연구하고 검증**하고 싶은 분
- **트레이딩 아이디어**는 있지만 데이터 파이프라인, 엔진 설정, Docker 컨테이너를 직접 구성하고 싶지 않은 분
- 텍스트만 생성하는 것이 아니라 **전략 코드를 직접 작성, 실행, 반복하는 AI**를 원하는 분
- 자본을 투입하기 전에 결과를 독립적으로 검증하는 **리스크 매니저**를 원하는 분
- 실제 돈 없이 라이브 시장에서 검증된 전략을 **페이퍼 트레이딩**하고 싶은 분
- 실험, 데이터셋, 실행, 코드 버전을 한 곳에서 추적하는 **하나의 워크스페이스**를 원하는 분

<br/>

## 기능

<table>
<tr>
<td align="center" width="33%">
<strong>애널리스트 에이전트</strong><br/>
전략 코드 작성, 시장 데이터 fetch, 백테스트 실행, 결과 기반 반복. 자연어로 전략을 설명하면 에이전트가 구축합니다.
</td>
<td align="center" width="33%">
<strong>리스크 매니저</strong><br/>
독립적 검증 에이전트. 과적합, 미래 참조 편향, 생존자 편향, 비현실적 가정을 확인합니다. 승인 전까지 페이퍼 트레이딩을 차단합니다.
</td>
<td align="center" width="33%">
<strong>페이퍼 트레이딩</strong><br/>
승인된 전략을 페이퍼 모드로 승격. 실제 시장 피드, 시뮬레이션 지갑. API 키 없이, 실제 자금 위험 없이 전략을 검증합니다.
</td>
</tr>
<tr>
<td align="center">
<strong>실험 추적</strong><br/>
각 가설마다 고유한 실험을 생성합니다. 다양한 엔진과 타임프레임에서 정규화된 지표로 실행을 나란히 비교합니다.
</td>
<td align="center">
<strong>코드 버전 관리</strong><br/>
데스크별 git 워크스페이스. 에이전트가 매 변경마다 커밋합니다. 각 실행은 정확한 커밋 해시에 연결됩니다 — 완전한 재현성.
</td>
<td align="center">
<strong>플러거블 엔진</strong><br/>
클래식 TA 전략에는 Freqtrade. 이벤트 기반 틱 단위 전략에는 Nautilus Trader. 그 외에는 Generic 폴백 — Python, Node, Rust, Go로 스크립트를 작성합니다.
</td>
</tr>
</table>

<br/>

## 워크플로우

<p align="center">
  <img src="doc/assets/workflow.svg" alt="QuantDesk 워크플로우: Strategy Desk → Analyst Agent → Experiment Loop → Risk Manager → Paper Trading" width="640" />
</p>

<br/>

## 왜 AI가 직접 트레이딩하지 않나요?

QuantDesk는 AI 에이전트가 자율적으로 거래를 실행하는 것에 초점을 두지 **않습니다**. 그 방식은 비용 비효율적이고 대규모에서 비현실적입니다.

대부분의 수익성 있는 트레이딩은 연구 과정입니다: 데이터 수집, 가설 백테스트, 과적합을 피하기 위한 파라미터 조정, 자본을 투입하기 전 페이퍼 모드 검증. 병목은 이 루프의 반복 속도이지 실행이 아닙니다.

QuantDesk는 AI 에이전트를 가장 가치 있는 곳에 배치합니다: **더 많은 아이디어를 더 빠르게 테스트할 수 있도록 연구 및 검증 사이클을 자동화합니다.**

페이퍼 트레이딩이 QuantDesk의 한계입니다. 실제 거래에는 거래소 API 키나 지갑 개인키가 필요합니다 — 이는 다른 신뢰 모델이며 이 프로젝트의 명시적 비목표입니다.

<br/>

## 지원 거래소

<div align="center">
<table>
  <tr>
    <td align="center"><strong>암호화폐 (CEX)</strong></td>
    <td>Binance &middot; Bybit &middot; OKX &middot; Kraken &middot; Gate.io &middot; KuCoin &middot; HTX &middot; Bitget &middot; BitMart &middot; BingX &middot; Bitvavo &middot; BitMEX &middot; Deribit</td>
  </tr>
  <tr>
    <td align="center"><strong>암호화폐 (DEX)</strong></td>
    <td>Hyperliquid &middot; dYdX</td>
  </tr>
  <tr>
    <td align="center"><strong>예측 시장</strong></td>
    <td>Polymarket &middot; Kalshi &middot; Betfair</td>
  </tr>
  <tr>
    <td align="center"><strong>주식</strong></td>
    <td>Interactive Brokers</td>
  </tr>
</table>
</div>

엔진 선택은 자동입니다: 전략 모드(`classic` 또는 `realtime`)와 거래소를 선택하면 시스템이 엔진을 결정합니다.

| 모드 | 엔진 | 적합한 용도 |
|------|--------|----------|
| `classic` | Freqtrade | 캔들 기반 TA 전략 — 추세 추종, 평균 회귀, 모멘텀 |
| `realtime` | Nautilus Trader | 이벤트 기반 틱 단위 전략 — 마켓 메이킹, 차익거래, HFT |
| (폴백) | Generic | 관리 엔진이 없는 거래소 — Python/Node/Rust/Go 스크립트 작성 |

<br/>

## 빠른 시작

오픈소스. 셀프 호스팅. 계정 불필요.

```bash
npx quantdesk onboard --yes
```

이게 전부입니다. 레포 클론, 의존성 설치, 엔진 Docker 이미지 풀, 데이터베이스 마이그레이션, `http://localhost:3000`에서 서버 시작까지 자동으로 수행됩니다.

내장 PostgreSQL이 인프로세스로 부팅됩니다 — 데이터베이스에 Docker가 필요하지 않습니다. Docker는 엔진 컨테이너에만 사용됩니다.

> **요구사항:** Node.js 20+, pnpm 9.15+, Docker (실행 중), Claude CLI (`claude`) 또는 Codex CLI (`codex`)

<details>
<summary>수동 설치</summary>

```bash
git clone https://github.com/0xbet-ai/QuantDesk.git
cd QuantDesk
pnpm install
pnpm onboard --yes
```

</details>

<br/>

## 인증

기본적으로 QuantDesk는 **로컬 신뢰 모드**로 실행됩니다 — 로그인 없음, 단일 사용자, 설정 불필요. 로컬 개발에 이상적입니다.

로그인을 활성화하려면 (공유 서버 또는 클라우드 배포용):

```bash
QUANTDESK_DEPLOYMENT_MODE=authenticated pnpm dev
```

처음 방문하면 회원가입 페이지가 표시됩니다. 이메일과 비밀번호로 계정을 만드세요.

| 변수 | 기본값 | 설명 |
|----------|---------|-------------|
| `QUANTDESK_DEPLOYMENT_MODE` | `local_trusted` | `authenticated`로 설정하면 로그인 필요 |
| `BETTER_AUTH_SECRET` | `quantdesk-dev-secret` | 세션 서명 시크릿 — **프로덕션에서는 반드시 변경** |
| `DATABASE_URL` | (내장) | 공유 배포용 외부 Postgres URL |

프로덕션에서는 계정 생성 후 `~/.quantdesk/config.json`에서 `auth.disableSignUp: true`를 설정하여 무단 가입을 방지하세요.

<br/>

## 개발

```bash
pnpm dev           # 서버 + UI 개발 모드 시작
pnpm build         # 모든 패키지 빌드
pnpm typecheck     # TypeScript 타입 체크
pnpm check         # Biome 린트 + 포맷
pnpm test          # Vitest 테스트 스위트
pnpm db:migrate    # Drizzle 마이그레이션 실행
pnpm db:reset      # DB 리셋 및 시드 데이터 재생성
```

아키텍처는 [`doc/OVERVIEW.md`](doc/OVERVIEW.md), 프로젝트 규칙은 [`CLAUDE.md`](CLAUDE.md)를 참고하세요.

<br/>

## 기술 스택

| 레이어 | 선택 |
|-------|--------|
| 모노레포 | pnpm workspaces |
| 백엔드 | Express.js + WebSocket |
| 데이터베이스 | PostgreSQL 17 (내장), Drizzle ORM |
| 프론트엔드 | React 19, Vite, Tailwind CSS, Radix UI |
| AI 에이전트 | Claude CLI / Codex CLI 서브프로세스 |
| 엔진 | Freqtrade, Nautilus Trader, Generic (Docker) |
| 유효성 검증 | Zod |
| 테스트 | Vitest |
| 린팅 | Biome |

<br/>

## 기여

기여를 환영합니다. 자세한 내용은 [기여 가이드](CONTRIBUTING.md)를 참고하세요.

<br/>

## 라이선스

AGPL-3.0

<br/>

---

<p align="center">
  <sub>AGPL-3.0 오픈소스. 키 입력이 아닌 아이디어를 트레이딩하는 사람들을 위해 만들어졌습니다.</sub>
</p>
