# 中文

---

# 文件下载站 v3.1.2

一个面向内网 / 小团队的自建文件分发站点。支持大文件分片上传与断点续传、上传审核、公告、在线预览，以及每位用户的私有云盘。

---

## 目录

- [功能特性](#功能特性)
- [可靠性设计](#可靠性设计)
- [安全设计](#安全设计)

---

## 功能特性

| 能力 | 说明 |
| --- | --- |
| 大文件分片上传 | 默认 5MB 一片，4 路并发，单片失败自动重试 3 次 |
| 断点续传 | 刷新页面或断网后可继续，已上传的分片不会丢失 |
| 秒传 | 相同文件（SHA-256 + 文件大小联合指纹）二次上传直接命中 |
| HTTP Range 断点下载 | 支持 `bytes=0-99` 与后缀形式 `bytes=-100`，并支持 HEAD 探测 |
| 上传审核 | 公开文件先进入待审区，管理员通过后才对外公开 |
| 私有云盘 | 注册用户可上传「仅自己可见」的文件，每人独立配额 |
| 在线预览 | 压缩包清单（zip / tar / tar.gz）、图片、文本、说明文档 |
| 公告系统 | 发布 / 编辑 / 删除，带未读红点提醒 |
| 邮件停机通知 | 群发通知给所有填写了邮箱的用户（需配置 SMTP） |
| 用户反馈 | 支持附带图片 |
| 个性化 | 中英双语界面、字号、字体、背景色、背景图、浏览框透明度 |
| 用户头像 | 用户可上传专属头像与主页背景图 |

### 可靠性设计

- **原子落盘**：合并、审核、改名的所有文件移动都走统一封装，跨设备（`EXDEV`）时自动回退为「复制 + 删除」，不会因为 `/tmp` 与数据目录不在同一挂载点而失败。
- **可重试的失败态**：合并失败会把会话恢复为可重试状态，而不是永久卡死。
- **幂等的秒传校验**：秒传分支会先做配额预检，避免「秒传成功但立刻超配额」。
- **保留名保护**：上传名为 `meta.json` / `package.json` / `说明.md` 的文件时自动改名，不会覆盖包的元数据。

### 安全设计

| 措施 | 说明 |
| --- | --- |
| 口令哈希 | 使用 scrypt（N=16384, r=8, p=1），比较走时序安全实现 |
| 路径穿越防护 | 分片上传的 `uploadId` 必须匹配 `^[a-f0-9]{32}$`，且会话必须存在，杜绝路径穿越与匿名刷目录 |
| 越权防护 | 上传会话做所有权校验，他人无法写入、合并或取消你的会话 |
| 符号链接防护 | 下载路径做 `realpath` 校验，符号链接无法逃逸出下载目录 |
| 限速与锁定 | 登录、注册、管理员口令、反馈接口均有限速与临时锁定 |
| 会话 Cookie | HttpOnly + SameSite=Lax，并在 HTTPS 下自动加 Secure |
| 响应头 | 统一的 `nosniff` / `X-Frame-Options` / `Referrer-Policy`，并为 HTML 文档下发内容安全策略 |
| 口令传输 | 管理员口令通过请求头提交，不会出现在地址栏、历史记录或 Referer 中 |
| 预览限额 | 压缩包预览有体积上限，超大文件不会撑爆内存或阻塞事件循环 |

---


`3.1.2`

## 许可

内部项目，请按团队约定使用。




################################################################
################################################################
##
##                      ENGLISH
##
##              File Download Station v3.1.2
##
################################################################
################################################################


A self-hosted file distribution site for intranets and small teams. It supports chunked large-file
uploads with resume, upload review, announcements, in-browser preview, and a per-user private drive.

---

## TABLE OF CONTENTS

- [Features](#features)
- [Reliability](#reliability)
- [Security](#security)

---

## FEATURES

| Capability | Description |
| --- | --- |
| Chunked large-file upload | 5MB per chunk by default, 4-way concurrency, 3 automatic retries per failed chunk |
| Resumable upload | Continue after a page refresh or a network drop; previously uploaded chunks are kept |
| Instant upload | Identical files (SHA-256 + file size fingerprint) are matched instantly on re-upload |
| HTTP Range downloads | Supports `bytes=0-99` and the suffix form `bytes=-100`, plus HEAD probing |
| Upload review | Public files land in a pending area until an administrator approves them |
| Private drive | Registered users can upload "visible only to me" files, each with an individual quota |
| In-browser preview | Archive listings (zip / tar / tar.gz), images, text, and description documents |
| Announcements | Create, edit, delete, with an unread red-dot indicator |
| Email outage notifications | Broadcast notices to every user who supplied an email (SMTP required) |
| User feedback | With optional image attachments |
| Personalization | Bilingual UI (Chinese / English), font size, font family, background color and image, panel opacity |
| User avatars | Upload a personal avatar and a home-page background image |

### RELIABILITY

- **Atomic moves**: every file move (merge, approve, rename) goes through one shared helper that
  falls back to copy + unlink on `EXDEV`, so it never fails when `/tmp` and the data directory live
  on different mount points.
- **Retryable failure state**: a failed merge restores the session to a retryable state instead of
  bricking it permanently.
- **Idempotent instant upload**: the instant-upload branch pre-checks the quota, so it cannot succeed
  and then immediately overflow.
- **Reserved-name protection**: uploading a file named `meta.json` / `package.json` / `说明.md` is
  automatically renamed, so package metadata is never clobbered.

### SECURITY

| Measure | Description |
| --- | --- |
| Password hashing | scrypt (N=16384, r=8, p=1), compared in constant time |
| Path traversal protection | The chunked-upload `uploadId` must match `^[a-f0-9]{32}$` and the session must exist — no path traversal, no anonymous directory spam |
| Ownership checks | Upload sessions are ownership-checked: nobody else can write to, merge, or cancel yours |
| Symlink protection | Download paths are `realpath`-checked, so symlinks cannot escape the download root |
| Rate limiting and lockout | Login, registration, admin password, and feedback endpoints are all rate-limited with temporary lockout |
| Session cookies | HttpOnly + SameSite=Lax, gaining Secure automatically under HTTPS |
| Response headers | Uniform `nosniff` / `X-Frame-Options` / `Referrer-Policy`, plus a Content-Security-Policy for HTML documents |
| Password transport | The admin password travels in a request header, never in the URL bar, history, or Referer |
| Preview limit | Archive preview has a size cap, so huge files cannot exhaust memory or block the event loop |

---

## LICENSE

Internal project — use according to your team's conventions.
