<p align="center">
  <a href="README.md">English</a> &middot;
  <a href="README.ko.md">한국어</a> &middot;
  <a href="README.zh.md">中文</a> &middot;
  <a href="README.ja.md">日本語</a> &middot;
  <a href="README.es.md">Español</a>
</p>

<h1 align="center">QuantDesk</h1>
<p align="center">クオンツトレーディングのための AI エージェントワークスペース</p>

<p align="center">
  <a href="#クイックスタート"><strong>クイックスタート</strong></a> &middot;
  <a href="doc/OVERVIEW.md"><strong>ドキュメント</strong></a> &middot;
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

## QuantDesk とは？

**収益性のある戦略を素早く見つけましょう — 市場が動く前に。**

バイブコーディング時代には毎日何百もの製品がリリースされますが、メンテナンスと反復改善こそが本当のボトルネックです。トレーディング戦略は違います：**1日だけ機能する戦略でも、すでに収益性があります。** 機能しなくなったら、次の戦略を見つければいいのです。

難しいのはコードを書くことではありません — データのダウンロード、バックテスト、パラメータ調整、過学習のチェック、ペーパーモードでの検証という退屈なサイクルが問題です。QuantDesk は AI エージェントでこのループ全体を自動化し、アイデアに集中できるようにします。

> **すべてのスクリプトは隔離された Docker コンテナ内で実行されます。** ホストマシンには一切影響しません — 戦略、バックテスト、データ取得、ペーパートレーディングはすべて固定イメージのサンドボックスコンテナで実行されます。

|        | ステップ                    | 説明                                                                                           |
| ------ | ------------------------- | ---------------------------------------------------------------------------------------------- |
| **01** | 戦略の説明                  | アナリストエージェントにトレードしたい内容を伝えてください。または、キュレーションされたカタログから選択できます。 |
| **02** | バックテストと反復            | エージェントが戦略コードを書き、データを取得し、バックテストを実行し、結果に基づいて反復します。 |
| **03** | リスクマネージャーによる検証    | 結果を検証に回します。リスクマネージャーが過学習、バイアス、異常値をチェックします。                |
| **04** | ペーパートレーディング         | 承認された戦略をペーパートレーディングに昇格します。実際の市場データ、仮想資金で検証します。          |

<br/>

## こんな方に最適です

- 手動バックテストよりも**速くトレーディング戦略を研究・検証**したい方
- **トレーディングアイデア**はあるが、データパイプライン、エンジン設定、Docker コンテナを自分で構築したくない方
- テキストを生成するだけでなく、**戦略コードを書き、実行し、反復する AI** を求めている方
- 資金を投入する前に結果を独立して検証する**リスクマネージャー**が欲しい方
- 実際のお金を使わずにライブ市場で検証済み戦略を**ペーパートレーディング**したい方
- 実験、データセット、実行、コードバージョンを一箇所で管理する**統合ワークスペース**が欲しい方

<br/>

## 機能

<table>
<tr>
<td align="center" width="33%">
<strong>アナリストエージェント</strong><br/>
戦略コードの作成、市場データの取得、バックテストの実行、結果に基づく反復。自然言語で戦略を説明すれば、エージェントが構築します。
</td>
<td align="center" width="33%">
<strong>リスクマネージャー</strong><br/>
独立した検証エージェント。過学習、先読みバイアス、生存者バイアス、非現実的な仮定をチェックします。承認するまでペーパートレーディングをブロックします。
</td>
<td align="center" width="33%">
<strong>ペーパートレーディング</strong><br/>
承認された戦略をペーパーモードに昇格。実際の市場フィード、シミュレーションウォレット。API キー不要、実際の資金リスクなしで戦略を検証します。
</td>
</tr>
<tr>
<td align="center">
<strong>実験トラッキング</strong><br/>
各仮説ごとに固有の実験を作成します。異なるエンジンやタイムフレーム間で正規化された指標を使い、実行結果を並べて比較します。
</td>
<td align="center">
<strong>コードバージョン管理</strong><br/>
デスクごとの git ワークスペース。エージェントが変更のたびにコミットします。各実行は正確なコミットハッシュにリンク — 完全な再現性を実現します。
</td>
<td align="center">
<strong>プラガブルエンジン</strong><br/>
クラシック TA 戦略には Freqtrade。イベント駆動ティックレベル戦略には Nautilus Trader。その他には Generic フォールバック — Python、Node、Rust、Go でスクリプトを作成します。
</td>
</tr>
</table>

<br/>

## ワークフロー

<p align="center">
  <img src="doc/assets/workflow.svg" alt="QuantDesk ワークフロー: Strategy Desk → Analyst Agent → Experiment Loop → Risk Manager → Paper Trading" width="640" />
</p>

<br/>

## なぜ AI に直接トレードさせないのか？

QuantDesk は AI エージェントが自律的に取引を実行することに焦点を置いて**いません**。そのアプローチはコスト効率が悪く、大規模では非現実的です。

収益性のあるトレーディングの大部分は研究プロセスです：データ収集、仮説のバックテスト、過学習を避けるためのパラメータ調整、資金を投入する前のペーパーモード検証。ボトルネックはこのループの反復速度であり、実行ではありません。

QuantDesk は AI エージェントを最も価値のある場所に配置します：**より多くのアイデアをより速くテストできるよう、研究と検証のサイクルを自動化します。**

ペーパートレーディングが QuantDesk の限界です。実際の取引には取引所 API キーやウォレット秘密鍵が必要です — それは異なる信頼モデルであり、このプロジェクトの明示的な非目標です。

<br/>

## 対応取引所

<div align="center">
<table>
  <tr>
    <td align="center"><strong>暗号資産 (CEX)</strong></td>
    <td>Binance &middot; Bybit &middot; OKX &middot; Kraken &middot; Gate.io &middot; KuCoin &middot; HTX &middot; Bitget &middot; BitMart &middot; BingX &middot; Bitvavo &middot; BitMEX &middot; Deribit</td>
  </tr>
  <tr>
    <td align="center"><strong>暗号資産 (DEX)</strong></td>
    <td>Hyperliquid &middot; dYdX</td>
  </tr>
  <tr>
    <td align="center"><strong>予測市場</strong></td>
    <td>Polymarket &middot; Kalshi &middot; Betfair</td>
  </tr>
  <tr>
    <td align="center"><strong>株式</strong></td>
    <td>Interactive Brokers</td>
  </tr>
</table>
</div>

エンジンの選択は自動です：戦略モード（`classic` または `realtime`）と取引所を選択すれば、システムがエンジンを決定します。

| モード | エンジン | 適した用途 |
|------|--------|----------|
| `classic` | Freqtrade | ローソク足ベースの TA 戦略 — トレンドフォロー、平均回帰、モメンタム |
| `realtime` | Nautilus Trader | イベント駆動ティックレベル戦略 — マーケットメイキング、裁定取引、HFT |
| (フォールバック) | Generic | マネージドエンジンのない取引所 — Python/Node/Rust/Go でスクリプトを作成 |

<br/>

## クイックスタート

オープンソース。セルフホスティング。アカウント不要。

```bash
npx quantdesk onboard --yes
```

これだけです。リポジトリのクローン、依存関係のインストール、エンジン Docker イメージのプル、データベースマイグレーション、`http://localhost:5173` でのサーバー起動まで自動で行われます。

内蔵 PostgreSQL がインプロセスで起動します — データベースに Docker は不要です。Docker はエンジンコンテナにのみ使用されます。

> **要件:** Node.js 20+, pnpm 9.15+, Docker (起動済み), Claude CLI (`claude`) または Codex CLI (`codex`)

<details>
<summary>手動セットアップ</summary>

```bash
git clone https://github.com/0xbet-ai/QuantDesk.git
cd QuantDesk
pnpm install
pnpm onboard --yes
```

</details>

<br/>

## 認証

デフォルトでは QuantDesk は**ローカル信頼モード**で動作します — ログイン不要、シングルユーザー、設定不要。ローカル開発に最適です。

ログインを有効にするには（共有サーバーやクラウドデプロイ用）：

```bash
QUANTDESK_DEPLOYMENT_MODE=authenticated pnpm dev
```

初回アクセス時にサインアップページが表示されます。メールアドレスとパスワードでアカウントを作成してください。

| 変数 | デフォルト値 | 説明 |
|----------|---------|-------------|
| `QUANTDESK_DEPLOYMENT_MODE` | `local_trusted` | `authenticated` に設定するとログインが必要になります |
| `BETTER_AUTH_SECRET` | `quantdesk-dev-secret` | セッション署名シークレット — **本番環境では必ず変更してください** |
| `DATABASE_URL` | (内蔵) | 共有デプロイ用の外部 Postgres URL |

本番環境では、アカウント作成後に `~/.quantdesk/config.json` で `auth.disableSignUp: true` を設定し、不正なサインアップを防止してください。

<br/>

## 開発

```bash
pnpm dev           # サーバー + UI を開発モードで起動
pnpm build         # すべてのパッケージをビルド
pnpm typecheck     # TypeScript 型チェック
pnpm check         # Biome リント + フォーマット
pnpm test          # Vitest テストスイート
pnpm db:migrate    # Drizzle マイグレーション実行
pnpm db:reset      # DB リセットとシードデータの再生成
```

アーキテクチャについては [`doc/OVERVIEW.md`](doc/OVERVIEW.md)、プロジェクトルールについては [`CLAUDE.md`](CLAUDE.md) を参照してください。

<br/>

## 技術スタック

| レイヤー | 選択 |
|-------|--------|
| モノレポ | pnpm workspaces |
| バックエンド | Express.js + WebSocket |
| データベース | PostgreSQL 17 (内蔵), Drizzle ORM |
| フロントエンド | React 19, Vite, Tailwind CSS, Radix UI |
| AI エージェント | Claude CLI / Codex CLI サブプロセス |
| エンジン | Freqtrade, Nautilus Trader, Generic (Docker) |
| バリデーション | Zod |
| テスト | Vitest |
| リンティング | Biome |

<br/>

## コントリビューション

コントリビューションを歓迎します。詳細は[コントリビューションガイド](CONTRIBUTING.md)をご覧ください。

<br/>

## ライセンス

AGPL-3.0

<br/>

---

<p align="center">
  <sub>AGPL-3.0 オープンソース。キー入力ではなくアイデアをトレードする人のために作られました。</sub>
</p>
