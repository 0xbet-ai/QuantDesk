<p align="center">
  <a href="README.md">English</a> &middot;
  <a href="README.ko.md">한국어</a> &middot;
  <a href="README.zh.md">中文</a> &middot;
  <a href="README.ja.md">日本語</a> &middot;
  <a href="README.es.md">Español</a>
</p>

<h1 align="center">QuantDesk</h1>
<p align="center">量化交易 AI 智能体工作空间</p>

<p align="center">
  <a href="#快速开始"><strong>快速开始</strong></a> &middot;
  <a href="doc/OVERVIEW.md"><strong>文档</strong></a> &middot;
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

## 什么是 QuantDesk？

**快速找到盈利策略 -- 在市场变化之前。**

在 vibe coding 时代，每天有数百个产品发布，但维护和迭代才是真正的瓶颈。交易策略不同：**一个只能用一天的策略已经是盈利的了。** 当它失效时，你只需要找到下一个。

困难的不是写代码 -- 而是下载数据、回测、调整参数、检查过拟合、在模拟模式中验证这个枯燥循环。QuantDesk 用 AI 智能体自动化整个流程，让你专注于想法而非繁琐的工程。

> **所有脚本都在隔离的 Docker 容器中运行。** 不会影响你的主机 -- 策略、回测、数据获取和模拟交易都在固定镜像的沙箱容器中执行。无论智能体写什么代码，你的本地环境都保持干净。

|        | 步骤                      | 说明                                                                                           |
| ------ | ------------------------- | ---------------------------------------------------------------------------------------------- |
| **01** | 描述你的策略                | 用自然语言告诉分析师智能体你想交易什么。或者从精选目录中选择。                                      |
| **02** | 回测与迭代                  | 智能体编写策略代码、获取数据、运行回测，并根据结果进行迭代。                                        |
| **03** | 风控经理验证                | 将结果提交验证。风控经理检查过拟合、偏差和异常。                                                    |
| **04** | 模拟交易                   | 将已批准的策略升级到模拟交易。真实市场数据，虚拟资金。                                               |

<br/>

## 适合这些人群

- 想要比手动回测**更快地研究和验证交易策略**的人
- 有**交易想法**但不想自己搭建数据管道、引擎配置和 Docker 容器的人
- 想要一个能**编写、运行并迭代策略代码**的 AI，而不只是生成文本的人
- 想要一个在投入资金前独立验证结果的**风控经理**的人
- 想在不动用真金白银的情况下对已验证策略进行**模拟交易**的人
- 想要一个在同一个地方追踪实验、数据集、运行和代码版本的**统一工作空间**的人

<br/>

## 功能

<table>
<tr>
<td align="center" width="33%">
<strong>分析师智能体</strong><br/>
编写策略代码、获取市场数据、运行回测、根据结果迭代。用自然语言描述策略思路，智能体即可构建。
</td>
<td align="center" width="33%">
<strong>风控经理</strong><br/>
独立验证智能体。检查过拟合、前视偏差、幸存者偏差和不切实际的假设。在批准之前阻止模拟交易。
</td>
<td align="center" width="33%">
<strong>模拟交易</strong><br/>
将已批准的策略升级到模拟模式。真实市场行情、模拟钱包。无需 API 密钥，无真实资金风险。
</td>
</tr>
<tr>
<td align="center">
<strong>实验追踪</strong><br/>
每个假设都有独立的实验。使用标准化指标在不同引擎和时间框架下并排比较运行结果。
</td>
<td align="center">
<strong>代码版本管理</strong><br/>
每个 Desk 独立的 git 工作空间。智能体在每次更改时自动提交。每次运行都链接到精确的 commit hash -- 完全可复现。
</td>
<td align="center">
<strong>可插拔引擎</strong><br/>
经典 TA 策略使用 Freqtrade。事件驱动的 tick 级策略使用 Nautilus Trader。其他情况使用 Generic 回退 -- 智能体可用 Python、Node、Rust 或 Go 编写脚本。
</td>
</tr>
</table>

<br/>

## 工作流

<p align="center">
  <img src="doc/assets/workflow.svg" alt="QuantDesk 工作流：Strategy Desk → Analyst Agent → Experiment Loop → Risk Manager → Paper Trading" width="640" />
</p>

<br/>

## 为什么不让 AI 直接交易？

QuantDesk **不**专注于让 AI 智能体自主执行交易。这种方式成本效率低下，且在大规模场景中不现实。

大多数盈利性交易是一个研究过程：收集数据、回测假设、调整参数以避免过拟合、在投入资金前通过模拟模式验证。瓶颈在于这个循环的迭代速度，而不是执行本身。

QuantDesk 将 AI 智能体放在最有价值的地方：**自动化研究和验证循环**，让你能更快地测试更多想法。

模拟交易是 QuantDesk 的边界。实盘交易需要交易所 API 密钥或钱包私钥 -- 那是一个不同的信任模型，也是本项目的明确非目标。

<br/>

## 支持的交易场所

<div align="center">
<table>
  <tr>
    <td align="center"><strong>加密货币 (CEX)</strong></td>
    <td>Binance &middot; Bybit &middot; OKX &middot; Kraken &middot; Gate.io &middot; KuCoin &middot; HTX &middot; Bitget &middot; BitMart &middot; BingX &middot; Bitvavo &middot; BitMEX &middot; Deribit</td>
  </tr>
  <tr>
    <td align="center"><strong>加密货币 (DEX)</strong></td>
    <td>Hyperliquid &middot; dYdX</td>
  </tr>
  <tr>
    <td align="center"><strong>预测市场</strong></td>
    <td>Polymarket &middot; Kalshi &middot; Betfair</td>
  </tr>
  <tr>
    <td align="center"><strong>股票</strong></td>
    <td>Interactive Brokers</td>
  </tr>
</table>
</div>

引擎选择是自动的：选择策略模式（`classic` 或 `realtime`）和交易场所，系统会自动匹配引擎。

| 模式 | 引擎 | 适用场景 |
|------|--------|----------|
| `classic` | Freqtrade | K 线级 TA 策略 -- 趋势跟踪、均值回归、动量 |
| `realtime` | Nautilus Trader | 事件驱动 tick 级策略 -- 做市、套利、高频交易 |
| (回退) | Generic | 没有托管引擎的交易场所 -- 用 Python/Node/Rust/Go 编写脚本 |

<br/>

## 快速开始

开源。自托管。无需注册。

```bash
npx quantdesk onboard --yes
```

就这么简单。自动完成仓库克隆、依赖安装、引擎 Docker 镜像拉取、数据库迁移，并在 `http://localhost:5173` 启动服务器。

内嵌的 PostgreSQL 在进程内启动 -- 数据库不需要 Docker。Docker 仅用于引擎容器。

> **系统要求：** Node.js 20+、pnpm 9.15+、Docker（需运行中）、Claude CLI (`claude`) 或 Codex CLI (`codex`)

<details>
<summary>手动安装</summary>

```bash
git clone https://github.com/0xbet-ai/QuantDesk.git
cd QuantDesk
pnpm install
pnpm onboard --yes
```

</details>

<br/>

## 认证

默认情况下，QuantDesk 以**本地信任模式**运行 -- 无需登录、单用户、零配置。适合本地开发。

要启用登录（用于共享服务器或云端部署）：

```bash
QUANTDESK_DEPLOYMENT_MODE=authenticated pnpm dev
```

首次访问时会显示注册页面。使用邮箱和密码创建账户即可。

| 变量 | 默认值 | 说明 |
|----------|---------|-------------|
| `QUANTDESK_DEPLOYMENT_MODE` | `local_trusted` | 设为 `authenticated` 以要求登录 |
| `BETTER_AUTH_SECRET` | `quantdesk-dev-secret` | 会话签名密钥 -- **生产环境中务必更改** |
| `DATABASE_URL` | (内嵌) | 共享部署用的外部 Postgres URL |

生产环境中，创建账户后在 `~/.quantdesk/config.json` 中设置 `auth.disableSignUp: true`，防止未授权注册。

<br/>

## 开发

```bash
pnpm dev           # 启动服务器 + UI（开发模式）
pnpm build         # 构建所有包
pnpm typecheck     # TypeScript 类型检查
pnpm check         # Biome 代码检查 + 格式化
pnpm test          # Vitest 测试套件
pnpm db:migrate    # 运行 Drizzle 迁移
pnpm db:reset      # 重置数据库并重新填充种子数据
```

架构详见 [`doc/OVERVIEW.md`](doc/OVERVIEW.md)，项目规则详见 [`CLAUDE.md`](CLAUDE.md)。

<br/>

## 技术栈

| 层级 | 选型 |
|-------|--------|
| 单体仓库 | pnpm workspaces |
| 后端 | Express.js + WebSocket |
| 数据库 | PostgreSQL 17（内嵌）、Drizzle ORM |
| 前端 | React 19、Vite、Tailwind CSS、Radix UI |
| AI 智能体 | Claude CLI / Codex CLI 子进程 |
| 引擎 | Freqtrade、Nautilus Trader、Generic (Docker) |
| 数据验证 | Zod |
| 测试 | Vitest |
| 代码检查 | Biome |

<br/>

## 贡献

欢迎贡献。详情请参阅[贡献指南](CONTRIBUTING.md)。

<br/>

## 许可证

AGPL-3.0

<br/>

---

<p align="center">
  <sub>基于 AGPL-3.0 开源。为交易想法而非键盘敲击而生。</sub>
</p>
