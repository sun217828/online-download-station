#online-download-station

#File Download Station v3.0

Internal large file direct download platform, supports resumable upload/download, file sharing, user cloud drive, and online preview.
A lightweight file sharing system designed for internal company use, easy to deploy without complex dependencies. Users can upload files via browser, get direct download links, and support resumable transfers. No registration required for downloads, no speed limits. Each user gets 10GB of personal cloud storage.

---

1. What can this website do?

For regular users (downloaders)

· Direct Download: Click the download button on the browser to directly retrieve files. No speed limits, no waiting for ads.
· Resumable Download: If the download is interrupted, it can be resumed. Large files won't fail.
· Online Preview: Preview text files, compressed packages (zip/7z/tar.gz), and internal folder structures of zip files.
· Quick Sharing: Generate direct links or QR codes for quick sharing. Downloaders can directly retrieve files.
· Search & Filter: Search by file name/description/tags. Filter by format, size, or category. Search history is saved.
· Personal Cloud Drive: 10GB space. Can upload personal files, share files, and support resumable uploads.
· Personalization: Customize background color/image. Adjust font size and blur/transparency for file descriptions.
· Avatar: Upload custom avatars in JPG/PNG/GIF/WEBP formats, up to 2MB.

For uploaders

· Chunked Upload: Large files are automatically split into 5MB chunks, uploaded concurrently with 4 threads, and automatically retried 3 times on failure.
· Instant Upload: SHA-256 fingerprint is calculated before upload. If the server has the same file, it completes instantly (users get a copy in their cloud drive).
· Resumable Upload: If the upload is interrupted, uploaded chunks are not lost and can be resumed.
· Three Visibility Options:
  · Public: Visible to everyone. Requires admin approval after upload.
  · Admin Only: Visible only to administrators after upload.
  · Private: Visible only to yourself. Stored in "My Cloud Drive". Accessible to others via link. 10GB capacity limit.
· Description Required: 10-200 character description required when uploading, used for preview display.
· Tags/Categories: Add tags when uploading (e.g., Movies/Images/Software/Drivers), convenient for search.

For Administrators (admin / root)

· Review Backend: Review files uploaded by users as public. Can approve/reject/transfer to private.
· User Management: View all users, space usage, upload progress. Can ban/unban/delete/adjust quotas/delete passwords/unblock transfer links.
· Company Management: Create company/department. Users can apply to join. Root can review (red dot reminder).
· Announcement Management: Post announcements on the homepage. Supports marquee effect.
· Email Notifications: Configure SMTP. Users receive emails after approval/rejection.
· Root Super Admin: Has highest privileges. Can manage admin, review join applications, and view all files.

---

2. Default Account Description

Role Default Source
root (Super Admin) Yes Automatically created on first server startup. Initial username root, initial password root123.
admin (Admin) No Created manually by root in "Settings -> Root Management -> User Management" after deployment.
Regular User No Self-register.

Review Backend Access (Hidden)

· Trigger: Click the Logo in the upper right corner 7 times within 10 seconds.
· Permission Levels (Based on Login):
  · root: Direct access, no password.
  · admin: Enter password to verify. (Enter your own set password, not the legacy ADMIN_PASSWORD).
  · Regular user/Not logged in: Blocked from entry.
· Description: ADMIN_PASSWORD is deprecated and only for backward compatibility. It is recommended to use the ADMIN_PASSWORD environment variable for verification. admin123 is the old default.
· Note: You must log in as root first, enter the backend, and change the initial password (root123 -> strong password).

---

3. File List

File List v3.0:

· package.json - Node.js dependency configuration
· package-lock.json - Locked version of dependencies
· server.js - Main backend program (Express)
· db.js - Database (SQLite) initialization and operations
· .env.example - Environment variable configuration example
· public/ - Frontend page
  · index.html - Main page
  · app.js - Frontend logic
  · style.css - Styles
  · preview.js - File preview logic
  · README.md - This file (for all users)

Automatically generated files upon running (No manual creation):

· files/ - Public download files
· files-private/ - User private files (My Cloud Drive + shared)
· pending/ - Pending review files
· data/ - SQLite database (app.db)
· chunks/ - Chunk upload temporary storage (auto-created/cleaned)
· feedback/ - User feedback
· avatars/ - User avatars

---

4. Beginner Quick Start (3 Minutes)

I am a Downloader:

1. Open the website link in a browser (provided by admin).
2. See the file list. Click "Download" to retrieve directly. Click "Preview" to view.
3. Want to search? Click the gear icon in the top right corner -> User -> Register (use email + password, email optional).

I am an Uploader:

1. Register/Login.
2. Click "I want to upload" in the top right corner.
3. Select visibility (Public / Admin Only / Private).
4. Drag & drop the file. Fill in a 10-200 character description, add tags.
5. Upload, view progress. After 5 seconds, it will automatically reset to allow uploading the next file.
6. Want to see your files? Click "My Files".

I am an Admin:

1. Log in with root account (Initial password root123, please change it!).
2. Click Logo 7 times within 10 seconds to enter the backend, or click the gear icon in the top right corner -> Root Management. (Log in to the review backend using the password you set).
3. Click the gear icon in the top right corner -> Root Management to manage users, companies, and join requests (with red dot reminders).
4. Want others to be admins? In "User Management", click "Promote to Admin".

---

5. Core Feature Details

1. Chunked Upload

· Frontend uses File.slice to cut files into 5MB chunks, uploading with 4 concurrent threads.
· Single chunk automatically retried 3 times. Merge all chunks after completion and verify SHA-256.
· Interrupted uploads resume without losing uploaded chunks.
· Unfinished uploads are automatically cleaned up every 24 hours.

2. Instant Upload

· Calculate SHA-256 of the entire file before uploading.
· If server has the same file -> directly copy a copy to the specified directory, instant completion.
· If file is in "My Cloud Drive" -> instant copy (within user range).

3. File Preview

· Top: File icon, title, format, size, upload time, direct download/transfer link.
· Middle: File description.
· Bottom: Compressed package (zip/7z/tar.gz) internal file structure.
· Supported formats: Archive file list, archive content list, other files show plain text description.

4. My Cloud Drive

· Automatically gets 10GB space upon registration (default quota, root can adjust in user management).
· Uploading private files -> automatically saved to cloud drive.
· Supports resumable upload, instant upload, SHA-256 verification.
· Over-quota files are automatically blocked from uploading, admin can unblock.

5. Enterprise & Join Application

· Root can create enterprise/departments (supports总公司, subsidiaries, each with 8 enterprise quotas).
· Regular users can join enterprises via a code.
· Root reviews in "Root Management -> Join Applications". Settings and Root Management have red dot reminders (>99 is 99+). Or go to "Settings -> Root Management -> Join Application" to view the review list.

6. Personalization Settings

· Font size: 12/14/16/18px.
· Font: System/Default/Monospace, etc.
· Background color: 8 preset colors + custom upload. Background image: <=2MB.
· Background image: Built-in vertical/horizontal/center/anime.
· File description transparency: 0%-100% (0% fully opaque, 100% fully transparent).
· File description color: Auto or custom background color.
· Show/hide uploader.
· Set automatic cache clearing, takes effect on next visit.

7. Email Notification (Optional)

· After configuring SMTP, admin can batch send emails to users.
· Purpose: Notify recipients of approval/rejection of transfer links.
· Requires BC (BCC) or CC recipients, users won't see each other.
· Suitable for internal promotions, not for spam.

8. Security & Privacy

· Registration requires username + password, email optional. No phone number required.
· All file operations require permission verification.
· File visibility:
  · public: Everyone can see.
  · private/hidden: Only admin can see.
  · user-private: Only owner can see and manage.
  · transfer-link: Owner/Admin can manage.
· Password prompts are vague, can toggle to plain text.

---

6. Configuration Reference

Environment Variables (systemd service file or .env)

Variable Description Default Value
PORT Listening Port 8080
HOST Listening Address 0.0.0.0
ADMIN_PASSWORD Deprecated (backward compatibility only). Use admin password verification after review backend changes. admin123
ADMIN_EMAIL Contact Admin Email (for display) -
USER_QUOTA_BYTES Default user cloud drive quota (root can override in user management) 10737418240 (10GB)
SMTP_HOST SMTP Server -
SMTP_PORT SMTP Port 465
SMTP_SECURE Whether to use SSL true
SMTP_USER SMTP Account -
SMTP_PASS SMTP Auth Code -
SMTP_FROM Sender Address Same as SMTP_USER
CHUNK_SIZE_BYTES Chunk Size 5242880 (5MB)
CHUNK_UPLOAD_DIR Chunk Temporary Directory .chunks

For complete configuration instructions, see 部署指南.md (Deployment Guide).

---

7. Which file should I read?

Who are you? Which file to read?
Deployment/Ops Personnel 部署指南.md (Deployment Guide) - Complete steps from scratch + checklist
User wanting to know features This document (README.md)
Developer wanting to modify code server.js (Backend) + public/ (Frontend) + db.js (Database)

---

8. Tech Stack

· Backend: Node.js + Express
· Database: SQLite (better-sqlite3, no separate database service needed)
· Upload: Chunked + Resumable + SHA-256 instant upload
· Preview: adm-zip (zip) + tar (tar.gz)
· Email: nodemailer
· Frontend: Native HTML/CSS/JS, no framework dependencies
· Deployment: systemd auto-start, optional Nginx reverse proxy + Let's Encrypt HTTPS

---

9. FAQ

Q: What if I forget the root password?
A: Stop the service on the server, delete the root user from data/app.db or directly reset it, restart to reinitialize (will lose user data, use with caution). It is recommended to note the password beforehand.

Q: Upload stuck, not moving?
A: Check logs sudo journalctl -u file-download -f. Usually it's disk full or network issues. Uploaded chunks are not lost, retry later.

Q: Download speed slow?
A: This program does not limit speed. It depends on server upstream bandwidth or downloader's downstream bandwidth.

Q: How to change the default 10GB quota?
A: Change the environment variable USER_QUOTA_BYTES (bytes), restart the service. Or modify the quota for a specific user in Root Management.

Q: How to make the website accessible only from the company intranet?
A: See Deployment Guide Part 3 Option B, or use ufw to restrict IP ranges.

---

10. Version

v3.0 — Current version, includes chunked upload, user cloud drive, enterprise system, email notifications, personalization, avatars, etc.

If you have questions, first check the "FAQ" section of 部署指南.md (Deployment Guide).

---
# online-download-station
# 文件下载站 v3.0

> 内部大文件直链下载平台 · 支持断点续传 / 分片上传 / 用户云盘 / 在线预览

一个为团队/公司内部打造的轻量级文件分享与云盘系统。
无需复杂的客户端，打开浏览器即可上传、下载、预览大文件。
所有数据自托管，不收集敏感个人信息。

---

## 一、这个网站能干什么？

### 对普通用户（下载者）

- **直链下载**：点击下载按钮，浏览器直接拉取文件，不限速、不跳转广告。
- **断点续传**：下载中断后可从断点继续，大文件不怕断网。
- **在线预览**：点「预览」查看文件详情、压缩包（zip/7z/tar.gz）内部文件清单、文件夹结构。
- **一键复制直链**：预览页有直链输入框 + 复制按钮，可粘到下载器里拉取。
- **搜索与筛选**：按文件名/描述搜索，按格式、大小筛选，搜索历史可回看。
- **个人云盘**：注册后拥有 10GB「我的云盘」空间，可上传仅自己可见的文件，支持秒传、断点续传。
- **个性化**：自定义主页背景色/背景图、字号字体、文件浏览框透明度与颜色。
- **头像**：右上角可上传自己的头像（jpg/png/gif/webp，≤2MB）。

### 对上传者

- **分片上传**：大文件自动切成 5MB 分片，4 路并发，单片失败自动重试 3 次。
- **秒传**：上传前算 SHA-256 指纹，服务器已有相同文件则秒级完成（我的云盘内生效）。
- **断点续传**：上传中断后已传分片不丢，可继续上传。
- **三种可见性**：
  - 公开：上传后需管理员审核，通过后所有人可见。
  - 仅管理员可见：上传后仅管理员可见。
  - 仅自己可见：进「我的云盘」，仅本人可访问，占用 10GB 配额。
- **必填说明**：上传时必须填写 10-200 字文件说明，用于预览展示。
- **标签分类**：上传时勾选标签（软件/电影/图片/动漫/汽车等），便于检索。

### 对管理员（admin / root）

- **审核后台**：用户上传的公开文件先进待审核列表，可「通过 / 拒绝 / 转私密」。
- **用户管理**：查看所有用户、空间使用进度条，可拉黑/恢复/删除/调整配额/解锁上传通道。
- **企业管理**：创建企业/部门，用户可申请加入，root 审批（带红点提醒）。
- **公告管理**：发布首页右上角信箱公告，带未读小红点提醒。
- **停机通知**：配置 SMTP 后，可群发邮件给所有填了邮箱的用户。
- **root 超级管理员**：拥有最高权限，可管理 admin、审批加入申请、查看所有文件。

---

## 二、默认账号说明

| 角色 | 是否默认存在 | 来源 |
|---|---|---|
| root（超级管理员） | 是 | 系统首次启动自动创建，用户名 `root`，初始密码 `root123` |
| admin（管理员） | 否 | 由 root 在「设置 → Root 管理 → 用户管理」手动升权 |
| 普通用户 | 否 | 自行注册 |

### 审核后台入口（隐藏入口）
- **触发方式**：10 秒内点击左上角 Logo 图标 7 次。
- **权限分层**（需先登录）：
  - root：直接进入，无需密码。
  - admin：弹出密码框，输入「自己的用户登录密码」验证后进入。
  - 普通用户 / 未登录：拒绝进入。
- **说明**：审核后台不再使用全局 `ADMIN_PASSWORD` 口令，改用管理员自己的登录密码验证，更安全、更清晰。环境变量 `ADMIN_PASSWORD` 仅作兼容保留，审核流程已不依赖它。

> **重要**：部署后请第一时间登录 root 修改初始密码（`root123` → 强密码）。

---

## 三、文件清单

```
文件下载站v3.0/
├── package.json          # Node.js 依赖配置
├── package-lock.json     # 依赖锁定版本
├── server.js             # 后端主程序（Express + 分片上传 + 用户系统 + 邮件）
├── db.js                 # 数据库模块（用户/会话/搜索历史/企业）
├── .env.example          # 环境变量示例配置（复制为 .env 后修改）
├── public/
│   ├── index.html        # 前端页面
│   ├── app.js            # 前端脚本
│   └── style.css         # 前端样式
├── 部署指南.md            # 运维部署完整指南（给部署者看）
└── README.md             # 本文件（给所有用户看）
```

运行时自动创建的目录（无需手动建）：

```
files/          # 公开下载文件
files-private/  # 用户私密文件（我的云盘）+ 头像 + 背景图
pending/        # 待审核上传
data/           # SQLite 数据库（app.db）+ 公告
chunks/         # 分片上传暂存（自动清理）
feedback/       # 用户反馈
avatars/        # 用户头像
```

---

## 四、新手 3 分钟上手

### 我是下载者
1. 浏览器打开网站地址（管理员给你的链接）。
2. 看到文件列表，点「下载」直接拉取，或点「预览」看详情。
3. 想保存搜索？点右上角齿轮 → 用户 → 注册（只需用户名+密码，邮箱选填）。

### 我是上传者
1. 注册并登录。
2. 切到「我要上传」标签。
3. 选可见性（公开 / 仅管理员可见 / 仅自己可见）。
4. 拖入文件，填 10-200 字说明，勾标签。
5. 点上传，看进度条，5 秒后自动重置可继续传下一个。
6. 想看自己传的？点「我的文件」。

### 我是管理员
1. 用 root 账号登录（首次密码 `root123`，请立刻改）。
2. 10 秒内点左上角 Logo 7 次 → root 直接进入审核后台（admin 角色则输入自己的登录密码）。
3. 或点右上角齿轮 → Root 管理，处理用户、企业、加入申请（有红点提示）。
4. 想让某人当管理员？在「用户管理」里点「升为管理员」。

---

## 五、核心功能详解

### 1. 分片上传
- 前端用 `File.slice` 把文件切成 5MB 分片，4 路并发上传。
- 单片失败自动重试 3 次，全部传完服务器流式合并 + SHA-256 校验。
- 中途断网可断点续传，已传分片不丢。
- 24 小时未完成的会话自动清理。

### 2. 秒传
- 上传前先算文件 SHA-256 + 大小联合指纹。
- 服务器已有相同文件 → 直接复制一份到你目录，秒级完成。
- 仅在「我的云盘」内生效（同用户范围）。

### 3. 文件预览
- 顶部：封面图标、标题、格式标签、大小、日期、**直链 + 复制按钮**。
- 中部：文件说明文字。
- 底部：压缩包（zip/7z/tar.gz）内部文件清单，文件夹结构展开。
- 支持的预览：文件夹列内容、压缩包列清单、其他显示基本信息。

### 4. 我的云盘
- 注册即获 10GB 空间（默认配额，root 可单独给某用户调整）。
- 上传选「仅自己可见」即存入云盘。
- 支持秒传、断点续传、SHA-256 校验。
- 超配额自动锁上传通道，管理员可解锁。

### 5. 企业与加入申请
- root 可创建企业/部门树（支持总公司/子公司层级，每个企业有 8 位企业码）。
- 普通用户可凭企业码申请加入企业。
- root 在「Root 管理 → 加入申请」审批，**设置齿轮和 Root 管理 tab 都有红点提醒**（>99 显示 99+），形成「设置齿轮 → Root 管理 → 加入申请」的明确路线指引。

### 6. 个性化设置
- 字号：12/14/16/18 px。
- 字体：系统默认/衬线/等宽。
- 主页背景色 + 背景图（登录后可上传，≤5MB）。
- 背景图模式：覆盖/居中/平铺。
- 文件浏览框透明度：0%-100%（0% 全透仅留白色分隔线）。
- 文件浏览框颜色：自定义或跟随主页背景。
- 设置自动存浏览器，下次访问自动恢复。

### 7. 邮件停机通知（可选）
- 配置 SMTP 后，管理员可群发邮件给所有填了邮箱的用户。
- 邮件用密送（BCC），用户之间看不到彼此邮箱。
- 适用于维护通知、新版本上线提醒。

### 8. 安全与隐私
- 注册只收用户名 + 密码 + 可选邮箱，不收真实姓名/手机/QQ/地址。
- 所有文件操作接口有所有权鉴权中间件：
  - public 任何人可读
  - private/hidden 仅管理员
  - user-private 仅 owner 本人或管理员
  - 修改/删除仅 owner 或管理员
- 密码框带小眼睛图标，可切换明文/密文显示。

---

## 六、配置参考

### 环境变量（systemd 服务文件或 .env）

| 变量 | 说明 | 默认值 |
|---|---|---|
| `PORT` | 监听端口 | `8080` |
| `HOST` | 监听地址 | `0.0.0.0` |
| `ADMIN_PASSWORD` | 已废弃（仅兼容保留）。审核后台改用管理员登录密码验证 | `admin123` |
| `ADMIN_EMAIL` | 联系管理员邮箱（展示用） | - |
| `USER_QUOTA_BYTES` | 每用户云盘默认配额（root 可在用户管理里单独覆盖） | `10737418240`（10GB） |
| `SMTP_HOST` | SMTP 服务器 | - |
| `SMTP_PORT` | SMTP 端口 | `465` |
| `SMTP_SECURE` | 是否 SSL | `true` |
| `SMTP_USER` | SMTP 账号 | - |
| `SMTP_PASS` | SMTP 授权码 | - |
| `SMTP_FROM` | 发件人地址 | 同 SMTP_USER |
| `CHUNK_SIZE_BYTES` | 分片大小 | `5242880`（5MB） |
| `CHUNK_UPLOAD_DIR` | 分片暂存目录 | `./chunks` |

完整配置说明见 [部署指南.md](部署指南.md)。

---

## 七、我该看哪个文件？

| 你是谁 | 看哪个文件 |
|---|---|
| 部署运维人员 | [部署指南.md](部署指南.md) — 从零到上线的完整步骤 + 清单 |
| 想了解功能的用户 | 本文件（README.md） |
| 想改代码的开发者 | `server.js`（后端）+ `public/`（前端）+ `db.js`（数据库） |

---

## 八、技术栈

- **后端**：Node.js + Express
- **数据库**：SQLite（better-sqlite3，无需单独装数据库服务）
- **上传**：分片 + 断点续传 + SHA-256 秒传
- **预览**：adm-zip（zip）、tar（tar.gz）
- **邮件**：nodemailer
- **前端**：原生 HTML/CSS/JS，无框架依赖
- **部署**：systemd 开机自启，可选 Nginx 反代 + Let's Encrypt HTTPS

---

## 九、常见问题速答

**Q：忘记 root 密码怎么办？**
A：在服务器上停止服务，删除 `data/app.db` 里的 root 用户或直接重置，重启即重新初始化（会丢用户数据，慎用）。建议提前记好密码。

**Q：上传卡住不动？**
A：看日志 `sudo journalctl -u file-download -f`，常见是磁盘满或网络抖动，已传分片不会丢，稍后重试。

**Q：下载速度慢？**
A：本程序不限速，瓶颈在服务器上行带宽或下载者下行带宽。

**Q：怎么改默认 10GB 配额？**
A：改环境变量 `USER_QUOTA_BYTES`（字节），重启服务。或在 Root 管理里单独给某用户改。

**Q：怎么让网站只能公司内网访问？**
A：见部署指南第三部分方案 B，或用 ufw 限制 IP 段。

---

## 十、版本

v3.0 — 当前版本，含分片上传、用户云盘、企业体系、邮件通知、个性化、头像等。

有问题先看 [部署指南.md](部署指南.md) 的「常见问题排查」部分。

