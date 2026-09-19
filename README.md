# 大学生的故事 · AI 人生采访者

> 你尽管和AI畅聊，我们来帮忙整理专属于你的人生故事。。

一个可运行的 MVP，用来验证一件事：**AI 会不会真的采访，而不是不断提问。**

核心循环：**听见 → 找到线索 → 判断什么重要 → 追问 → 更新理解 → 判断完成 → 整理 → 让用户确认。**

---

## 快速开始

```bash
cd interviewer
npm install
npm run dev
```

打开 https://hj-d5ggpl6f9e4e8453b-1484234591.tcloudbaseapp.com/。迅速体验完整功能

```bash
npm run build      # 类型检查 + 构建
npm run preview    # 预览构建产物（4176）
```

---

## 已部署地址

| 地址 | 说明 |
| --- | --- |
| https://ccbe031860a040e0a3a54e5ba75521e2.codebuddy.cloudstudio.run/ | Cloud Studio 沙箱（临时，用于快速预览） |
| https://hj-d5ggpl6f9e4e8453b-1484234591.tcloudbaseapp.com/ | CloudBase 静态托管（长期，与数据库同环境） |

两个地址都已加入 CloudBase 安全域名，匿名登录与云库读写都验证通过（会话 / 消息 / 故事实时落 PG）。
每个浏览器（更准确地说每个 origin）会拿到自己的匿名身份，数据按 `owner_id = auth.uid()` 完全隔离。

> 线上是纯静态构建，**没有 `/api/llm` 反向代理**，而模型厂商通常不允许浏览器直连；
> 所以线上主要用来体验产品流程（走内置剧本）。要接真实大模型，请本地 `npm run dev` 后再填密钥。

---

## 四个页面 + 一个开发功能

| 页面 | 做什么 |
| --- | --- |
| 首页 `/` | 六大话题分类、随机入口、「开始和我聊聊」 |
| AI 采访页 `/interview?topic=xxx` | 对话流、计时、「我不知道怎么说」、单问题追问、结束聊天 |
| 故事确认页 `/story/:id` | 一页纸的故事 + 这是我的故事 / 我想修改 / 重新整理 |
| 我的故事页 `/stories` | 已留下的故事、云端同步状态 |
| 🧠 AI 观察（右上角） | 开发测试用：把 AI 每一轮怎么判断的完整摊开 |

---

## 零配置试用路径（推荐先走这条）

1. 首页点「🧳 第一次离开家」；
2. 采访页点「用剧本台词」→ 发送，重复十几次，把《第一次离开家》讲完；
3. 随时点右上角「🧠 AI观察」，看人物星级、事件、情绪、高价值线索、推荐追问、推荐理由打勾、记忆分层 L1–L5、命中的判断；
4. 讲完后点「看看整理出来的故事」→ 确认页 →「这是我的故事」；
5. 回到「我的故事」看到它。

观察面板底部有 **10 种测试输入一键注入**，以及「测试集 · 下一句剧本台词」，用来演一遍 badcase。

---

## 接真实大模型

有两种方式，**密钥永远不会被打进前端产物**。

### 方式一：服务端密钥（推荐，零手动操作）

把密钥写进 `interviewer/.env.local`（该文件已被 `.gitignore` 覆盖）：

```
DEEPSEEK_API_KEY=sk-xxxxxxxx
DEEPSEEK_MODEL=deepseek-chat
```

**故意不加 `VITE_` 前缀**——所以它只存在于 dev server 进程里，浏览器拿不到、构建产物里也没有。
前端启动时会 GET 一次 `/api/llm/config`，服务端只回 `{ serverKey: true, model }` 这个布尔值，
前端据此走真实模型；具体请求由中间件在服务端拼上密钥转发。

### 方式二：设置页自己填

内置 DeepSeek / 智谱预设，填 **Base URL + 密钥 + 模型名**，点「测试连接」。
这种方式下密钥只保存在这台设备的浏览器里。填了会覆盖服务端密钥。

### 模型选择（踩过的坑）

| 模型 | 性质 | 适不适合 |
| --- | --- | --- |
| `deepseek-chat` | 直接回答 | ✅ 默认。本产品每回合要 2 次 JSON 调用，需要快而稳 |
| `deepseek-flash` / `deepseek-v4-pro` | **推理模型** | ❌ 会先吐一大段 `reasoning_content`；max_tokens 偏小时 `content` 直接是空的，而且慢很多 |

代码已针对推理模型做了识别：`content` 为空且带 `reasoning_content` 或 `finish_reason=length` 时，
会给出「请换成 deepseek-chat」这种可操作的提示，而不是笼统报错。

### 验证密钥真的能用

```bash
# 用真实模型跑一遍三段提示词的 JSON 契约
node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/llm-check.ts

# 不打开浏览器，回放整段采访 + 10 个 badcase
node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/replay.ts
```

`llm-check.ts` 会用《第一次离开家》测试集去打真实模型，逐项检查：
理解器抽出的线索、候选追问是不是「只问一个问题」、故事正文有没有出现用户没说过的词。

---

## 架构：LLM 负责理解与生成，产品逻辑负责约束与决策

刻意**没有把所有东西塞进一个 Prompt**：

```
用户输入
  ↓
InterviewMachine   状态机取态（8 主状态 + 4 旁路状态）
  ↓
LLM1 understander  理解器：线索 + Memory 增量 + 用户状态信号 + 完整度
  ↓
Rules  rules.ts    硬规则：想停 / 敏感 / 拒绝话题 / 指出理解有误 /
                   连线追问 / 心理定性 / 事实不确定 —— 全部前置拦截
  ↓
LLM2 questioner    候选追问 2~3 个（每个挂一条线索，带 9 个评分字段）
  ↓
Ranker ranker.ts   P0~P5 优先级 + 评分公式，最终只输出一个问题
  ↓
LLM3 storyWriter   故事整理（忠于原始讲述，不虚构）
  ↓
CloudBase PG       会话 / 消息 / Memory / 观察快照落库
```

评分公式（规格原文）：`追问价值 = 故事价值 × 用户主动程度 × 情绪信号 × 信息增益 × 愿意程度 − 打扰成本 − 敏感风险`
直接连乘会爆炸，实现里对每个正向因子归一化后取**几何平均**，保留「任一维度极低就压住整个候选」的性质。

### Memory 分五层

| 层 | 内容 | 约束 |
| --- | --- | --- |
| L1 事实 | 人物、时间、地点 | 自动提取 |
| L2 故事 | 事件、转折、细节 | 自动提取 |
| L3 情绪 | 情绪 + 原文佐证 | 自动提取 |
| L4 主题 | 「这件事意味着什么」 | 只作为**未确认的理解**存在 |
| L5 对用户的理解 | 用户确认过的理解 | **必须用户确认**才能长期留存 |

L4 → L5 的升级条件很严：用户要给出短确认句（「对」「差不多」），**并且上一条 AI 说的是邀请确认的句式**。
否则「好呀，你整理吧」这种对流程的同意，会被误当成「认同了你的分析」。

---

## 逻辑回放（不打开浏览器也能验证）

```bash
node ../fuyuan/node_modules/tsx/dist/cli.mjs scripts/replay.ts
```

它会把测试集 14 轮 + 10 种 badcase 全跑一遍，打印每一轮的状态、完整度、候选数、被拦下的候选、高价值线索、命中判断，最后统计「有没有出现连环追问」。

---

## 数据结构（CloudBase PostgreSQL）

环境是 **PG 模式**，所以浏览器侧走 `@cloudbase/js-sdk` v3 的 `app.rdb()`（不要用 `app.database()` / `.where()` / `.count()`）。

三张表，`owner_id` 默认 `auth.uid()`，RLS 只认 `auth.uid()`：

- `stories` —— 最后留下的故事（title / topic / content / memory jsonb）
- `interview_sessions` —— 一次采访（state / story_status / memory jsonb / observer jsonb / duration_sec）
- `interview_messages` —— 逐条消息（session_id / seq / role / text）

迁移文件：`cloudbase/migrations/20260914153000_init_interview_tables.sql`

零门槛：打开就是**匿名游客**（`auth.signInAnonymously()`），不需要注册。同步失败时进入「离线暂存中」，故事仍在本地，不会丢。

---

## 已知边界（第一版刻意不做的）

- **语音只留了入口**，MVP 只做文字输入——点麦克风会明确告诉用户「这一版先支持打字」。
- 演示剧本是**固定的 15 句台词回放**，它读不懂剧本以外的内容；剧本外的话题会走「关键词 + 模板」的保守追问。要验证真正的采访能力，请配置模型密钥。
- 跨设备同步需要账号体系（用户名密码），这一版只做匿名游客。
- 不收集任何账号信息。故事详情页可以切到「分享版」（只有故事，不含任何对用户的观察或分析），但**不做导出到第三方、不做对外发布**；跨设备搬运仍靠设置页的 JSON 导出/导入。
