# 文件下载站 v3.1.9

> **一句话介绍**：把「发文件」这件事，从到处传网盘、发链接、怕过期，变成**一个装在自己服务器上、自己说了算的下载站**。

一个用 Node.js 写的自建文件分发站点。上传、审核、下载、个人云盘、操作历史，一整套都在里面；
装在自己的机器上，文件不出内网，链接不经过第三方，谁来下载、什么时候下载，由你决定。

**不需要数据库服务器、不需要对象存储、不需要买云服务**——一个 Node 进程 + 一个 SQLite 文件就能跑起来。

---

## 这是给谁用的？

| 你是… | 它能帮你… |
| --- | --- |
| **小团队 / 工作室** | 把安装包、设计稿、素材包集中放一处，同事点开链接就能下，不用再靠聊天软件传来传去 |
| **内网 / 实验室环境** | 整套服务跑在内网机房里，文件全程不出网，满足「资料不得外传」的要求 |
| **要给客户发大文件的人** | 丢一个链接过去就行，支持断点续传，客户网络抖动中断了也能接着下 |
| **在乎隐私的个人用户** | 每个人都有独立的「我的云盘」，上传的私人文件默认只有自己能看到 |
| **懒得折腾运维的人** | 不用装 MySQL / Redis / Nginx，解压、起步、打开浏览器就能用 |

**它不适合谁**：需要多人实时协作编辑文档的团队（这不是在线文档工具）；需要 PB 级对象存储的场景（它是单机方案，适合几十 GB 到几个 TB。不过你可以对其进行修改）。

---

## 为什么不用公共网盘？

公共网盘能解决「传」，但解决不了这几件事：

- **文件去哪了？** 上传后链接、有效期、是否被扫描，全由平台说了算。
- **谁下载了？** 多数网盘不给你下载记录。
- **能改吗？** 想加一条「这个包怎么装」的说明、想给文件打标签分类，基本做不到。
- **合规吗？** 内部资料放在公有云上，很多单位是明确不允许的。
- **收费吗？** 国内网盘基本上是收费的，且价格不菲。而这一个，收不收费由你自己决定。

这个项目的思路反过来：**文件放在你自己的硬盘上，规则也由你自己定**。
上传要不要审核、管理员要不要免审、每个人给多少云盘空间、允许不允许注册——全都能改，改完立刻生效。

---

## 它能做什么

### 传文件

| 能力 | 说明 |
| --- | --- |
| **大文件分片上传** | 默认 5 MB 一片，4 路并发，单片失败自动重试 3 次 |
| **断点续传** | 关了页面、断了网，回来接着传，已经传过的分片不会白传 |
| **秒传** | 服务器已有相同文件（SHA-256 + 大小双重指纹），直接复制，不用再传一遍 |
| **上传审核** | 普通用户上传的公开文件先进待审区，管理员点了「通过」才出现在下载列表 |

### 下文件

| 能力 | 说明 |
| --- | --- |
| **HTTP Range 下载** | 支持 `bytes=0-99` 和 `bytes=-100`，下载器、播放器、`wget -c` 都能用 |
| **断线续传** | 基于 Range，中断后重连接着下 |
| **在线预览** | 压缩包内容清单（zip / tar / tar.gz）、图片、文本、说明文档，不用先下载再打开 |
| **图片查看器** ⭐ | 打开 jpg / png / gif / webp 等图片时点一下就能放大：滚轮缩放、拖动平移、`←` `→` 左右切换、窗口可拖动可缩放可最大化，`Esc` 关闭；可在「设置 → 通用」里关掉 |

### 管文件

| 能力 | 说明 |
| --- | --- |
| **四种可见性** | `公开`（谁都能下）/ `私密`（仅管理员）/ `隐藏`（仅管理员，列表里完全不出现）/ `仅自己可见` |
| **个人云盘** | 每个注册用户有独立空间，配额默认 10 GB，可调 |
| **从云盘删除** | 云盘里的文件可以随时自己删掉，删完配额立刻释放 |
| **操作历史** ⭐ | 云盘顶部有「历史记录」，谁在什么时候传了什么、删了什么，一条条列清楚，可单条删、可批量删 |
| **主页背景图** | 个性化里上传的背景图也存在你的云盘里（`我的背景图/`），计入配额、可预览下载、可随时删除；从云盘删掉它等同于移除背景图 |
| **文件说明与标签** | 每个文件可以配一段说明文字和若干标签，方便分类和检索 |

### 站点本身

| 能力 | 说明 |
| --- | --- |
| **站内公告** | 发布通知，用户端有未读小红点 |
| **全文搜索** | 按文件名、说明、标签搜 |
| **用户反馈** | 带截图的反馈提交，管理员集中查看 |
| **邮件通知** | 配好 SMTP，可以把公告群发给留了邮箱的用户 |
| **中英双语界面** | 右上角设置里一键切换 |
| **隐藏式管理员入口** | 管理员入口不在页面上，需要连点 7 次 Logo 才出现，减少被扫的风险 |

⭐ = v3.1.6 新增

---

## 3 分钟跑起来

**环境要求**：Node.js **≥ 18**（建议 20 LTS），需要有编译工具链（`better-sqlite3` 是本机编译的）。

Ubuntu / Debian 先装编译依赖：

```bash
sudo apt update
sudo apt install -y build-essential python3
```

然后：

```bash
# 1. 装依赖
npm install

# 2. 起服务
node server.js

# 3. 打开浏览器
#    http://localhost:8080
```

就这样。第一次启动会自动建好所有目录和数据库，**不需要任何额外配置**。

> **Windows 用户**：解压后的包已经带了 `node_modules`，装好 Node 18+ 之后直接 `node server.js` 即可，
> 不需要重新 `npm install`，也就不需要 Visual Studio 编译环境。

### 第一个管理员怎么来？

出于安全考虑，**系统不预置任何账号，也没有默认密码**。第一个管理员这样产生：

1. 在页面上正常注册一个账号；
2. 把它提升为管理员，任选一种：
   - 启动时带上环境变量：`ADMIN_USERS=你的用户名 node server.js`
   - 或直接改数据库：`UPDATE users SET is_admin = 1 WHERE username = '你的用户名';`

之后用这个账号登录，**连点左上角 Logo 7 次**（每次间隔 ≥ 0.5 秒），管理后台就出来了。

---

## 日常怎么用

### 如果你是管理员

- **看有多少东西等着审**：后台 → 待审核，逐条「通过」或「拒绝」（拒绝会连带删除文件）。
- **决定要不要审**：后台 → 设置，可以关掉「管理员上传公开文件需要审核」。
  关掉之后，管理员自己上传的公开文件直接进下载列表，普通用户仍然要走审核。
- **管用户**：后台 → 用户，可以解除某个用户的「上传锁死」（配额超了会自动锁）。

### 如果你只是普通用户

- **想下载**：顶部「下载列表」，点预览先看看内容，满意再点下载。
- **想看图片**：图片文件的预览页会直接显示图片，**点一下图片**就打开大图查看器。
  - 滚轮或工具栏 +/− 缩放，按住图片拖动平移
  - `‹` `›` 或键盘 `←` `→` 在同一个列表的图片之间切换（右下角有 `3 / 7` 这样的计数）
  - 拖标题栏移动窗口、拖右下角改窗口大小、双击标题栏最大化，`Esc` 或 `×` 关闭
  - 不想要这个功能：设置 → 通用 → 取消勾选「开启图片预览」
- **想上传**：顶部「我要上传」，拖文件进去，选好可见性，填一段说明（至少 10 个字）和标签。
  - 选「公开」→ 等管理员审核通过后大家都能看到
  - 选「仅自己可见」→ 直接进你的云盘，不用审核
- **管自己的云盘**：顶部「我的云盘」
  - 每个文件后面有 **预览 / 下载 / 删除** 三个按钮
  - 点顶部的 **历史记录**，可以看到自己所有的上传和删除记录
  - 历史记录支持**勾选多条一起删**，也支持点单条后面的 `×` 删掉
  - 历史记录一旦删除就是**永久删除**——直接从记录文件里抹掉那一条，没有回收站，也恢复不了

---

## 我怎么知道它靠得住

这个项目对安全细节做了不少处理，都是实际测试过的：

| 方面 | 做法 |
| --- | --- |
| 密码存储 | scrypt（N=16384, r=8, p=1）加盐哈希，恒定时间比对 |
| 路径穿越 | 所有目录名走白名单清洗；分片上传的 `uploadId` 必须匹配 `^[a-f0-9]{32}$` |
| 越权访问 | 云盘文件三重校验：必须登录 → 路径必须在本人的命名空间下 → `meta.owner` 必须是自己 |
| 符号链接 | 下载路径做 `realpath` 检查，软链无法逃逸出下载根目录 |
| 暴力破解 | 登录、注册、管理员口令、反馈接口都有限速与临时锁定 |
| 会话安全 | Cookie 走 HttpOnly + SameSite=Lax，HTTPS 下自动加 Secure |
| 响应头 | 统一 `nosniff` / `X-Frame-Options` / `Referrer-Policy`，HTML 文档额外加 CSP |
| 管理员口令 | 走请求头传输，不落在地址栏、历史记录和 Referer 里 |
| 大包预览 | 压缩包预览有体积上限，避免大文件把内存吃满、把事件循环卡住 |
| 文件名处理 | 统一清洗非法字符、限制长度（120 字节）、规避 Windows 保留名（CON/PRN/NUL 等），中文自动转拼音 |

---

## 环境变量

不改也能跑，需要定制时再用：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `FILES_DIR` | `./files` | 公开下载目录 |
| `PRIVATE_FILES_DIR` | `./files-private` | 私密文件与用户云盘根目录 |
| `PENDING_DIR` | `./pending` | 待审核目录 |
| `DATA_DIR` | `./data` | 数据库与公告目录 |
| `FEEDBACK_DIR` | `./feedback` | 用户反馈目录 |
| `CHUNK_UPLOAD_DIR` | `./chunks` | 分片暂存目录 |
| `CHUNK_SIZE_BYTES` | `5242880`（5 MB） | 默认分片大小，范围 64KB~10MB |
| `USER_QUOTA_BYTES` | `10737418240`（10 GB） | 每用户云盘配额 |
| `ADMIN_PASSWORD` | 随机生成 | 后台口令；不设置则启动时随机生成并打印在日志里 |
| `ADMIN_USERS` | 空 | 逗号分隔的用户名，启动时把其中已注册的用户提升为管理员 |
| `ALLOW_REGISTER` | `true` | 设为 `false` 关闭注册 |
| `ADMIN_UPLOAD_REVIEW` | 未设置 | 设为 `false` 让管理员上传公开文件免审核；一旦设置，后台对应开关变为只读 |
| `ADMIN_EMAIL` | 空 | 设置页展示的联系邮箱 |
| `TRUST_PROXY` | 未设置 | 部署在反向代理后设为 `true`，否则拿不到真实 IP 和 HTTPS 状态 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | — | 邮件通知所需，不配就不发邮件 |

---

## 部署到服务器

**要求**：Node.js ≥ 18（建议 20 LTS）。Nginx 等反向代理可选，但公网部署建议加上。

```bash
# 1. 上传并解压
scp 文件下载站v3.1.9.zip 你的用户名@服务器IP:/opt/
cd /opt && unzip 文件下载站v3.1.9.zip

# 2. 装依赖（包内已含 node_modules，一般可跳过）
cd 文件下载站v3.1.9
npm install --omit=dev
```

systemd 服务（`/etc/systemd/system/file-download.service`）：

```ini
[Unit]
Description=Private File Download Server v3.1.9
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/文件下载站v3.1.9
ExecStart=/usr/bin/node /opt/文件下载站v3.1.9/server.js
Restart=always
RestartSec=5

Environment=PORT=8080
Environment=ADMIN_USERS=myadmin
Environment=ADMIN_EMAIL=admin@example.com
Environment=USER_QUOTA_BYTES=10737418240
Environment=TRUST_PROXY=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now file-download
sudo systemctl status file-download
```

> Nginx 反代、HTTPS 证书、防火墙、备份策略、迁移到 Windows 等更细的内容，
> 见同目录下的 **《部署指南.md》**（中英双语，内容比本文件详细得多）。

---

## 包里自带了一些演示数据

Git 不支持提交空目录，所以仓库里各目录都放了少量**演示占位文件**。
它们全部由程序自己生成的示例文本构成，**不含任何真实用户信息，也不含第三方版权内容，可以放心删除**。

| 位置 | 内容 | 说明 | 可否删除 |
| --- | --- | --- | --- |
| `files/示例数据表/` | CSV + 说明 | 公开文件示例 | ✅ |
| `files/示例日志/` | LOG | 公开文件（无随包说明）示例 | ✅ |
| `files/示例数据包/` | BIN + 说明 | 二进制文件示例 | ✅ |
| `files-private/私密示例/` | CSV + 说明 | 私密文件示例（仅管理员可见） | ✅ |
| `files-private/#[隐藏包示例.zip]/` | LOG | 隐藏包示例（列表里完全不出现） | ✅ |
| `pending/待审核示例.txt` | 待审核文件 | 演示审核队列 | ✅ |
| `feedback/fb_demo_00000001/` | 反馈示例 | 演示反馈存储结构 | ✅ |
| `files-private/users/demo_user/` | 5 个文件（含 2 张图片）+ 操作历史 | 演示「我的云盘」、图片预览与历史记录 | ✅ |
| `avatars/` `chunks/` | 占位文件 | 避免目录为空 | ✅ |
| `data/` | 数据库与公告 | 含 `demo_admin` / `demo_user` 两个演示账号 | ⚠️ 见下 |

**演示账号**（密码均为 `Demo@2026pass`，**正式上线前请务必删除或改密**）：

| 用户名 | 角色 | 说明 |
| --- | --- | --- |
| `demo_admin` | 管理员 | 可直接连点 Logo 7 次进后台 |
| `demo_user` | 普通用户 | 云盘里预置了 5 个演示文件（3 个文档 + 2 张图片）和 7 条操作历史 |

**一键清理全部演示数据**：

```bash
rm -rf files/* files-private/* pending/* feedback/* chunks/* avatars/*
rm -f data/app.db data/app.db-shm data/app.db-wal data/announcements.json data/settings.json
touch files/.gitkeep files-private/.gitkeep pending/.gitkeep feedback/.gitkeep chunks/.gitkeep avatars/.gitkeep
```

清完重启服务，程序会自动重建数据库和目录，站点回到全新的空状态。

---

## 常见问题

| 问题 | 原因与处理 |
| --- | --- |
| 启动报 `better-sqlite3` 编译失败 | 缺编译工具链，装 `build-essential python3` 后重试 |
| 忘了管理员口令 | 用 `ADMIN_USERS=用户名` 重启提升一个新管理员，或在设置页用口令登录后重置 |
| 上传提示「文件名过长」 | 文件名上限 120 字节（约 40 个汉字），换个短点的名字 |
| 上传提示「至少选择一个标签」/「说明不能为空」 | 说明至少 10 个字，标签至少选一个，这是为了防止列表里出现一堆无意义文件 |
| 上传后列表里没看到文件 | 公开文件需要管理员审核通过后才会出现；选「仅自己可见」则是直接进云盘，不用审 |
| 云盘文件删了，历史记录里还有 | 这是有意设计的：历史记录记录的是「发生过什么」，删文件不会连带删掉记录，需要你自己去历史里清理 |
| 云盘里怎么多了一个「我的背景图」 | 那是你的个人主页背景图。它本身就存在你的云盘里，会计入配额；不想用它就直接删掉这个文件夹，设置里的背景图会同步变为「未设置」 |
| 背景图占配额吗 | 占。它和别的云盘文件一视同仁（上限 5 MB）。换图时只算体积增量，所以配额满了也能换成更小的图 |
| 删掉的历史记录还能找回吗 | **不能**。历史删除是永久性的，直接从记录文件里抹掉，没有回收站 |
| 想换端口 | `PORT=9000 node server.js` |
| 想关掉注册 | `ALLOW_REGISTER=false node server.js` |
| 中文文件名变成拼音了 | 落盘和下载链接统一用拼音，避免跨平台编码问题；页面上显示的仍是原始中文名 |

---

## 更新日志

见同目录下的 **[CHANGELOG.md](./CHANGELOG.md)**。


---
---

# Private File Download Station v3.1.9

> **In one sentence**: Turn "sending files" from juggling public cloud drives and expiring links into
> **a download site that runs on your own server and obeys your rules**.

A self-hosted file distribution site built with Node.js. Upload, review, download, personal drive, and
activity history — all included. Run it on your own machine, keep files inside your network, and keep
links out of third-party hands. Who downloads and when is yours to decide.

**No database server, no object storage, no cloud bill** — a single Node process plus one SQLite file is
all it takes.

---

## Who is this for?

| If you are… | It helps you… |
| --- | --- |
| **A small team or studio** | Keep installers, design assets and file packs in one place — teammates open a link and download, no more passing files around in chat apps |
| **On an intranet / lab network** | Run the whole service inside your own machine room; files never leave the network, satisfying "internal material must not go out" requirements |
| **Sending large files to clients** | Just hand over a link. Resumable downloads mean a flaky client connection doesn't start over |
| **Someone who values privacy** | Everyone gets a private "My Drive"; personal uploads are visible only to you and the administrator |
| **Someone who hates ops work** | No MySQL / Redis / Nginx to install — unzip, start, open a browser |

**What it is not for**: teams that need real-time collaborative document editing (this is not an online
office suite), or petabyte-scale object storage (this is a single-machine solution — comfortable from
tens of GB up to a few TB).

---

## Why not just use a public cloud drive?

Public drives solve "sending", but not these:

- **Where did the file go?** The link, the expiry, whether it got scanned — all decided by the platform.
- **Who downloaded it?** Most services give you no download log at all.
- **Can you change anything?** Adding a "here's how to install this" note, or tagging files into
  categories, is usually impossible.
- **Is it even allowed?** Many organisations explicitly forbid putting internal material on public clouds.

This project flips it around: **files live on your own disk, and the rules are yours to set.**
Whether uploads need review, whether admins skip review, how much drive space each person gets,
whether registration is open — all configurable, effective immediately.

---

## What it does

### Uploading

| Capability | Description |
| --- | --- |
| **Chunked large-file upload** | 5 MB per chunk by default, 4-way concurrency, each failed chunk retried 3 times |
| **Resumable upload** | Close the tab or lose the network, then continue — already-uploaded chunks are kept |
| **Instant upload** | If the server already has the identical file (SHA-256 + size fingerprint), it is copied instead of re-uploaded |
| **Upload review** | Public uploads from regular users go to a pending area until an administrator approves them |

### Downloading

| Capability | Description |
| --- | --- |
| **HTTP Range downloads** | Supports `bytes=0-99` and `bytes=-100`; works with download managers, players and `wget -c` |
| **Resume after interruption** | Built on Range requests — reconnect and pick up where you stopped |
| **In-browser preview** | Archive listings (zip / tar / tar.gz), images, text and description documents — no need to download first |
| **Image viewer** ⭐ | Opening a jpg / png / gif / webp image lets you click to enlarge: scroll to zoom, drag to pan, `←` `→` to switch, and a window you can move, resize or maximize — `Esc` to close. Can be turned off under Settings → General |

### Managing

| Capability | Description |
| --- | --- |
| **Four visibility levels** | `Public` (anyone) / `Private` (admins only) / `Hidden` (admins only, never listed) / `Only me` |
| **Personal drive** | Every registered user gets their own space, 10 GB quota by default and configurable |
| **Delete from your drive** | Remove your own drive files at any time; quota is freed immediately |
| **Activity history** ⭐ | A "History" button at the top of the drive lists every upload and deletion, with single-entry and batch deletion |
| **Home background image** | A background image uploaded under Appearance is stored in your drive too (`我的背景图/`), counts against the quota, can be previewed and downloaded, and can be deleted at any time; removing that folder is the same as unsetting the background |
| **Descriptions and tags** | Attach a description and tags to each file for easier organisation and search |

### The site itself

| Capability | Description |
| --- | --- |
| **Announcements** | Publish notices; users get an unread red dot |
| **Full-text search** | Search by file name, description and tags |
| **User feedback** | Feedback submission with screenshots, reviewed in one place by admins |
| **Email notifications** | With SMTP configured, broadcast announcements to users who left an email |
| **Bilingual UI** | Switch between Chinese and English from the settings panel |
| **Hidden admin entry** | The admin console is not linked anywhere — click the logo 7 times to reveal it, reducing scan exposure |

⭐ = new in v3.1.6

---

## Running it in 3 minutes

**Requirements**: Node.js **≥ 18** (20 LTS recommended), plus a build toolchain (`better-sqlite3` compiles natively).

On Ubuntu / Debian, install the build dependencies first:

```bash
sudo apt update
sudo apt install -y build-essential python3
```

Then:

```bash
# 1. Install dependencies
npm install

# 2. Start
node server.js

# 3. Open your browser
#    http://localhost:8080
```

That's it. The first start creates every directory and the database automatically — **no configuration required**.

> **Windows users**: the distributed zip already includes `node_modules`. With Node 18+ installed, just run
> `node server.js` — no `npm install`, and therefore no Visual Studio build tools needed.

### Where does the first administrator come from?

For safety, **the system ships with no accounts and no default password**. To create the first administrator:

1. Register an account normally through the web UI.
2. Promote it, either way:
   - Start with an environment variable: `ADMIN_USERS=yourname node server.js`
   - Or update the database directly: `UPDATE users SET is_admin = 1 WHERE username = 'yourname';`

Then log in and **click the top-left logo 7 times** (at least 0.5 s apart) to reveal the admin console.

---

## Day-to-day usage

### If you are the administrator

- **See what is waiting**: Admin → Pending review. Approve or reject each item (rejecting also deletes the file).
- **Decide whether review is needed**: Admin → Settings lets you turn off "admin uploads require review".
  Once off, public files uploaded by admins go straight to the download list — regular users are still reviewed.
- **Manage users**: Admin → Users lets you clear a user's "upload lock" (triggered automatically when the quota is exceeded).

### If you are a regular user

- **To download**: open the "Downloads" tab, preview the contents first, then download what you need.
- **To view an image**: the preview page of an image file shows the image itself — **click it** to open the
  large viewer.
  - Scroll or use the toolbar +/− to zoom; drag the image to pan
  - Use `‹` `›` or the `←` `→` keys to move between the images of the current list (a `3 / 7` counter sits
    in the bottom-right)
  - Drag the title bar to move the window, drag the bottom-right grip to resize it, double-click the title
    bar to maximize, and press `Esc` or `×` to close
  - To turn it off: Settings → General → untick "Enable image preview"
- **To upload**: open the "Upload" tab, drop in your file, pick a visibility, and fill in a description
  (at least 10 characters) and at least one tag.
  - Choose `Public` → appears to everyone once an administrator approves it
  - Choose `Only me` → goes straight into your drive with no review
- **To manage your drive**: open the "My Drive" tab
  - Every file has **Preview / Download / Delete** buttons
  - Click **History** at the top to see every upload and deletion you have made
  - History supports **selecting multiple entries for batch deletion**, or deleting a single entry with `×`
  - Deleting a history entry is **permanent** — the record is erased from the history file outright.
    There is no recycle bin and no way to restore it.

---

## How do I know it is solid?

A fair amount of security work went into this, all of it tested:

| Area | Approach |
| --- | --- |
| Password storage | scrypt (N=16384, r=8, p=1) with per-user salt, compared in constant time |
| Path traversal | All directory names pass through a whitelist sanitiser; chunked-upload `uploadId` must match `^[a-f0-9]{32}$` |
| Unauthorised access | Drive files are triple-checked: must be logged in → path must be inside your own namespace → `meta.owner` must be you |
| Symlinks | Download paths are `realpath`-checked, so a symlink cannot escape the download root |
| Brute force | Login, registration, admin password and feedback endpoints are all rate-limited with temporary lockout |
| Session security | HttpOnly + SameSite=Lax cookies, automatically gaining Secure under HTTPS |
| Response headers | Uniform `nosniff` / `X-Frame-Options` / `Referrer-Policy`, plus a CSP on HTML documents |
| Admin password | Sent in a request header, never in the URL bar, history or Referer |
| Large-archive preview | Archive preview has a size cap so huge files cannot exhaust memory or block the event loop |
| File names | Illegal characters sanitised, length capped at 120 bytes, Windows reserved names (CON/PRN/NUL…) avoided, Chinese transliterated to pinyin |

---

## Environment variables

Everything has a sensible default — only reach for these when you need to customise:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` | Listening port |
| `HOST` | `0.0.0.0` | Bind address |
| `FILES_DIR` | `./files` | Public download directory |
| `PRIVATE_FILES_DIR` | `./files-private` | Private files and per-user drive root |
| `PENDING_DIR` | `./pending` | Pending review directory |
| `DATA_DIR` | `./data` | Database and announcements directory |
| `FEEDBACK_DIR` | `./feedback` | User feedback directory |
| `CHUNK_UPLOAD_DIR` | `./chunks` | Chunk staging directory |
| `CHUNK_SIZE_BYTES` | `5242880` (5 MB) | Default chunk size, valid range 64KB–10MB |
| `USER_QUOTA_BYTES` | `10737418240` (10 GB) | Per-user drive quota |
| `ADMIN_PASSWORD` | random | Admin console password; auto-generated and printed to the log if unset |
| `ADMIN_USERS` | empty | Comma-separated usernames; already-registered ones are promoted to admin on boot |
| `ALLOW_REGISTER` | `true` | Set to `false` to disable registration |
| `ADMIN_UPLOAD_REVIEW` | unset | Set to `false` so admin public uploads skip review; once set, the matching admin toggle becomes read-only |
| `ADMIN_EMAIL` | empty | Contact email shown on the settings page |
| `TRUST_PROXY` | unset | Set to `true` behind a reverse proxy, otherwise the real client IP and HTTPS state are lost |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | — | Required for email notifications; skip to disable email entirely |

---

## Deploying to a server

**Requirements**: Node.js ≥ 18 (20 LTS recommended). A reverse proxy such as Nginx is optional but
recommended for public deployments.

```bash
# 1. Upload and extract
scp 文件下载站v3.1.9.zip youruser@server-ip:/opt/
cd /opt && unzip 文件下载站v3.1.9.zip

# 2. Install dependencies (the zip already ships node_modules, so usually skippable)
cd 文件下载站v3.1.9
npm install --omit=dev
```

systemd unit (`/etc/systemd/system/file-download.service`):

```ini
[Unit]
Description=Private File Download Server v3.1.9
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/文件下载站v3.1.9
ExecStart=/usr/bin/node /opt/文件下载站v3.1.9/server.js
Restart=always
RestartSec=5

Environment=PORT=8080
Environment=ADMIN_USERS=myadmin
Environment=ADMIN_EMAIL=admin@example.com
Environment=USER_QUOTA_BYTES=10737418240
Environment=TRUST_PROXY=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now file-download
sudo systemctl status file-download
```

> For Nginx reverse proxying, HTTPS certificates, firewalls, backup strategy and migrating to Windows,
> see **《部署指南.md》** (deployment guide, bilingual and considerably more detailed than this file).

---

## The package ships with demo data

Git cannot track empty directories, so a small amount of **placeholder demo data** is pre-seeded in each
directory. It is all sample text generated by the program itself — **no real user information and no
third-party copyrighted content. It is safe to delete.**

| Location | Content | Description | Deletable |
| --- | --- | --- | --- |
| `files/示例数据表/` | CSV + doc | Public file sample | ✅ |
| `files/示例日志/` | LOG | Public file with no companion doc | ✅ |
| `files/示例数据包/` | BIN + doc | Binary content sample | ✅ |
| `files-private/私密示例/` | CSV + doc | Private file sample (admins only) | ✅ |
| `files-private/#[隐藏包示例.zip]/` | LOG | Hidden package sample (never listed) | ✅ |
| `pending/待审核示例.txt` | Pending file | Demonstrates the review queue | ✅ |
| `feedback/fb_demo_00000001/` | Feedback sample | Demonstrates the feedback layout | ✅ |
| `files-private/users/demo_user/` | 5 files (incl. 2 images) + history | Demonstrates "My Drive", image preview and activity history | ✅ |
| `avatars/` `chunks/` | Placeholders | Keeps directories non-empty | ✅ |
| `data/` | Database and announcements | Contains the `demo_admin` / `demo_user` demo accounts | ⚠️ see below |

**Demo accounts** (password for both: `Demo@2026pass` — **delete or change before going live**):

| Username | Role | Notes |
| --- | --- | --- |
| `demo_admin` | Administrator | Can open the admin console by clicking the logo 7 times |
| `demo_user` | Regular user | Drive pre-seeded with 5 demo files (3 documents + 2 images) and 7 history entries |

**One-shot cleanup of all demo data**:

```bash
rm -rf files/* files-private/* pending/* feedback/* chunks/* avatars/*
rm -f data/app.db data/app.db-shm data/app.db-wal data/announcements.json data/settings.json
touch files/.gitkeep files-private/.gitkeep pending/.gitkeep feedback/.gitkeep chunks/.gitkeep avatars/.gitkeep
```

Restart the service afterwards and the program recreates the database and directories automatically,
leaving a brand-new empty site.

---

## Troubleshooting

| Problem | Cause and fix |
| --- | --- |
| `better-sqlite3` fails to compile on start | Missing build toolchain — install `build-essential python3` and retry |
| Forgot the admin password | Restart with `ADMIN_USERS=yourname` to promote a fresh admin, or sign in with the password from the boot log |
| "File name too long" on upload | The cap is 120 bytes (≈40 Chinese characters) — use a shorter name |
| "Select at least one tag" / "Description cannot be empty" | Descriptions need at least 10 characters and at least one tag; this keeps the listing free of meaningless entries |
| Uploaded file does not appear in the list | Public uploads appear only after an administrator approves them; "Only me" uploads go straight to your drive with no review |
| I deleted a drive file but it is still in the history | By design: history records *what happened*. Deleting a file does not delete its record — clear it from the history panel yourself |
| Why is there a "我的背景图" folder in my drive? | That is your home background image. It genuinely lives in your drive and counts against the quota. Don't want it? Just delete the folder — the setting switches back to "not set" |
| Does the background image count against the quota? | Yes, it is treated like any other drive file (capped at 5 MB). Replacing it counts only the size delta, so even on a full quota you can swap in a smaller image |
| Can I recover a deleted history entry? | **No.** History deletion is permanent; the entry is erased from the history file. There is no recycle bin |
| Changing the port | `PORT=9000 node server.js` |
| Disabling registration | `ALLOW_REGISTER=false node server.js` |
| Chinese file names turned into pinyin | Files on disk and download URLs use pinyin to avoid cross-platform encoding issues; the original Chinese name is still what you see in the UI |

---

## Changelog

See **[CHANGELOG.md](./CHANGELOG.md)** in the same directory.
