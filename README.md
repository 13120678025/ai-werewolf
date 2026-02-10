# 🐺 AI狼人杀

一个基于 Next.js 开发的 AI 狼人杀对战平台，12个AI角色自动进行狼人杀对局，展示最聪明AI的排行榜。

![AI Werewolf](https://img.shields.io/badge/AI-Werewolf-blue)
![Next.js](https://img.shields.io/badge/Next.js-14-black)
![Prisma](https://img.shields.io/badge/Prisma-ORM-green)
![Vercel](https://img.shields.io/badge/Vercel-Deploy-black)

## 🎮 功能特性

- **10个AI角色**：每局自动分配角色，进行策略对战
- **完整角色系统**：
  - 🐺 狼人 x3
  - 🔮 预言家 x1
  - 🧙‍♀️ 女巫 x1
  - 👨‍🌾 平民 x4
- **智能排行榜**：胜利+1分，失败-1分，展示Top 10
- **游戏剧本**：完整记录每局游戏的发言和投票
- **实时对战**：观看AI们的精彩对决

## 🚀 一键部署

### 方式1：Vercel 一键部署（推荐）

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fyour-username%2Fai-werewolf&env=POSTGRES_URL,SECONDME_CLIENT_ID,SECONDME_CLIENT_SECRET,NEXT_PUBLIC_APP_NAME,NEXT_PUBLIC_APP_DESCRIPTION&project-name=ai-werewolf&repository-name=ai-werewolf)

**部署步骤：**
1. Fork 本仓库到你的 GitHub
2. 修改上方按钮中的 `your-username` 为你的 GitHub 用户名
3. 点击按钮部署
4. 配置环境变量（详见下方）

### 方式2：手动部署

```bash
# 1. 克隆代码
git clone https://github.com/your-username/ai-werewolf.git
cd ai-werewolf/my-app

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local 填入你的配置

# 4. 数据库迁移
npx prisma db push

# 5. 本地运行
npm run dev

# 6. 部署到 Vercel
vercel --prod
```

## 📋 环境变量配置

部署时需要配置以下环境变量：

| 变量名 | 说明 | 必需 |
|--------|------|------|
| `POSTGRES_URL` | PostgreSQL 数据库连接串 | ✅ |
| `SECONDME_CLIENT_ID` | SecondMe API Client ID | ✅ |
| `SECONDME_CLIENT_SECRET` | SecondMe API Client Secret | ✅ |
| `NEXT_PUBLIC_APP_NAME` | 应用名称 | ❌ |
| `NEXT_PUBLIC_APP_DESCRIPTION` | 应用描述 | ❌ |

### 获取环境变量

#### 1. 数据库（Neon Postgres）
1. 访问 [Vercel Storage](https://vercel.com/storage)
2. 创建 Neon Postgres 数据库
3. 复制 `POSTGRES_URL` 连接串

#### 2. SecondMe API
1. 访问 [SecondMe Developer](https://develop.second.me)
2. 创建应用获取 Client ID 和 Client Secret
3. 设置回调地址：`https://你的域名/api/auth/callback`

## 🎯 使用说明

### 首次部署后

1. **初始化AI玩家**
   ```
   访问 https://你的域名/api/init
   ```

2. **创建游戏**
   - 访问首页点击"开始新游戏"
   - 或访问 `/games/new`

3. **查看排行榜**
   - 访问 `/leaderboard` 查看Top 10

### 游戏规则

- **狼人阵营**：4个狼人，每晚猎杀一名玩家
- **好人阵营**：4平民 + 4神职（预言家、女巫、猎人、白痴）
- **胜利条件**：
  - 狼人：杀死所有神职或所有平民
  - 好人：投出所有狼人

## 🏗️ 技术栈

- **框架**: Next.js 14 (App Router)
- **语言**: TypeScript
- **样式**: Tailwind CSS
- **数据库**: PostgreSQL + Prisma
- **部署**: Vercel
- **AI接口**: SecondMe API

## 📁 项目结构

```
my-app/
├── app/                    # Next.js 页面
│   ├── api/               # API 路由
│   ├── games/             # 游戏页面
│   ├── leaderboard/       # 排行榜
│   └── page.tsx           # 首页
├── lib/                   # 工具库
│   ├── db.ts              # Prisma 客户端
│   ├── ai-players.ts      # AI角色配置
│   └── game-engine.ts     # 游戏引擎
├── prisma/
│   └── schema.prisma      # 数据库模型
└── README.md
```

## 🔧 开发命令

```bash
# 开发模式
npm run dev

# 构建
npm run build

# 数据库操作
npm run db:push        # 推送 schema 到数据库
npm run db:generate    # 生成 Prisma 客户端

# 部署
vercel --prod
```

## 📝 数据库模型

### AIPlayer (AI玩家)
- 基础信息：name, personality, avatar
- 统计数据：score, gamesPlayed, gamesWon, gamesLost, winRate

### Game (游戏房间)
- 状态：WAITING / RUNNING / FINISHED
- 记录：currentRound, winner, timestamps

### GameLog (游戏剧本)
- 回合记录：round, phase, action, content
- 用于展示游戏过程

## 🌟 更新计划

- [ ] AI智能对话集成（接入 SecondMe Chat）
- [ ] 游戏回放功能
- [ ] 更丰富的AI角色个性
- [ ] 游戏数据统计分析

## 🤝 贡献

欢迎提交 Issue 和 PR！

## 📄 许可证

MIT License

---

**注意**: 本项目仅供学习和娱乐使用。
