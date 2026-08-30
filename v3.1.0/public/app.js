(function () {
  'use strict';

  // ====== DOM 元素 ======
  const $ = (id) => document.getElementById(id);

  const fileTableBody = $('fileTableBody');
  const fileCountBadge = $('fileCount');
  const searchInput = $('searchInput');
  const refreshBtn = $('refreshBtn');
  const emptyState = $('emptyState');
  const noResultState = $('noResultState');

  const pendingBadge = $('pendingBadge');

  // ====== 全局状态 ======
  let allFiles = [];
  let searchTimer = null;
  let currentTab = 'downloads';
  let adminToken = null; // 前端简单记录密码
  let uploadConfig = null;
  let SUGGEST_MAX_SIZE = 2 * 1024 * 1024 * 1024;
  let MAX_DESC_LENGTH = 20;
  const UNSAFE_REGEX = /[<>"'`|&;\\\x00-\x1f]/g;
  let currentUser = null; // 当前登录用户 {id, username, email, uploadLocked, isAdmin, usedBytes, quotaBytes, ...}
  let userBgImageUrl = null; // 当前用户主页背景图 URL（登录后加载）

  // ====== 初始化 ======
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    bindTabSwitch();
    bindDownloadsTab();
    bindUploadTab();
    bindAdminModal();
    bindAdminModalEvents();
    bindAnnouncementBox();
    bindAnnouncementAdmin();
    bindSettingsPanel();
    bindPreviewPage();
    bindFilterBar();
    bindAuthPanel();
    bindHistoryPanel();
    bindUserListView();
    bindUserAvatar();
    bindAvatarUpload();
    bindMyFilesTab();
    bindAccountToggle();
    bindDescText();
    loadUploadConfig(loadFiles);
    loadPendingCount();
    refreshAnnouncementDot();
    loadCurrentUser(); // 异步加载会话状态
  }

  // ====== 用户头像按钮：点击打开设置→用户 ======
  function bindUserAvatar() {
    const btn = $('userAvatarBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      openSettingsModal();
      // 切到用户 tab
      const userTab = document.querySelector('.settings-tab[data-stab="user"]');
      if (userTab) userTab.click();
    });
  }

  // ====== 设置页头像上传/删除/预览 ======
  function bindAvatarUpload() {
    const uploadBtn = $('avatarUploadBtn');
    const fileInput = $('avatarFileInput');
    const deleteBtn = $('avatarDeleteBtn');
    if (!uploadBtn || !fileInput) return;
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (!e.target.files || !e.target.files.length) return;
      const file = e.target.files[0];
      const formData = new FormData();
      formData.append('avatar', file);
      fetch('/api/user/avatar', { method: 'POST', body: formData, credentials: 'include' })
        .then((r) => r.json())
        .then((d) => {
          if (d.code === 0) {
            applyAvatar(d.data.url);
            alert('头像上传成功');
          } else {
            alert(d.message || '上传失败');
          }
        })
        .catch(() => alert('网络错误，上传失败'))
        .finally(() => { fileInput.value = ''; });
    });
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        if (!confirm('确定删除当前头像？')) return;
        fetch('/api/user/avatar', { method: 'DELETE', credentials: 'include' })
          .then((r) => r.json())
          .then((d) => {
            if (d.code === 0) { applyAvatar(null); alert('头像已删除'); }
            else alert(d.message || '删除失败');
          })
          .catch(() => alert('网络错误，删除失败'));
      });
    }
  }

  // 应用头像 URL 到设置页 + 顶部导航；url 为 null 表示清除为默认占位图标
  function applyAvatar(url) {
    const setImg = $('settingsAvatarImg');
    const setSvg = $('settingsAvatarSvg');
    const delBtn = $('avatarDeleteBtn');
    const topImg = $('userAvatarImg');
    const topSvg = $('userAvatarSvg');
    if (url) {
      const sep = url.indexOf('?') >= 0 ? '&' : '?';
      const full = url + sep + '_=' + Date.now();
      if (setImg) { setImg.src = full; setImg.classList.remove('hidden'); }
      if (setSvg) setSvg.classList.add('hidden');
      if (delBtn) delBtn.classList.remove('hidden');
      if (topImg) { topImg.src = full; topImg.classList.remove('hidden'); }
      if (topSvg) topSvg.classList.add('hidden');
    } else {
      if (setImg) setImg.classList.add('hidden');
      if (setSvg) setSvg.classList.remove('hidden');
      if (delBtn) delBtn.classList.add('hidden');
      if (topImg) topImg.classList.add('hidden');
      if (topSvg) topSvg.classList.remove('hidden');
    }
  }

  // 登录后加载当前用户头像（不存在则显示默认图标）
  function loadUserAvatar(username) {
    if (!username) { applyAvatar(null); return; }
    const url = '/api/avatar/' + encodeURIComponent(username);
    fetch(url, { method: 'HEAD', cache: 'no-store' })
      .then((r) => { applyAvatar(r.ok ? url : null); })
      .catch(() => applyAvatar(null));
  }

  // ====== 我的云盘 Tab：切到时加载文件列表 ======
  function bindMyFilesTab() {
    // 加载逻辑由 switchTab 直接触发，这里保留钩子便于未来扩展
  }

  function loadMyFilesTab() {
    if (!currentUser) {
      $('myFilesLoggedOut').classList.remove('hidden');
      $('myFilesLoggedIn').classList.add('hidden');
      return;
    }
    $('myFilesLoggedOut').classList.add('hidden');
    $('myFilesLoggedIn').classList.remove('hidden');
    const list = $('myFilesList');
    if (list) list.innerHTML = '<div class="list-empty">加载中...</div>';
    fetch('/api/user/private-files', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.code !== 0) { list.innerHTML = '<div class="list-empty">加载失败</div>'; return; }
        const data = d.data;
        // 更新计数和配额
        if ($('myFilesCount')) $('myFilesCount').textContent = data.total;
        if (data.usedBytes != null && currentUser) {
          currentUser.usedBytes = data.usedBytes;
          currentUser.usedFormatted = data.usedFormatted;
          currentUser.quotaBytes = data.quotaBytes;
          currentUser.quotaFormatted = data.quotaFormatted;
          currentUser.uploadLocked = data.uploadLocked;
          updateMyFilesQuota(data);
        }
        if (!data.total) {
          list.innerHTML = '<div class="list-empty">暂无文件，去「我要上传」选择「仅自己可见」即可</div>';
          return;
        }
        const frag = document.createDocumentFragment();
        data.files.forEach((f) => {
          const item = document.createElement('div');
          item.className = 'myfiles-item';
          item.innerHTML = `
            <div class="pf-name" title="${escapeHtml(f.name)}">${escapeHtml(f.chineseName || f.name)}</div>
            <div class="pf-meta">
              <span class="ext-tag ext-${escapeHtml(f.extension || 'bin')}">${escapeHtml(f.extension || '-')}</span>
              <span>${escapeHtml(f.sizeFormatted)}</span>
              <span>${escapeHtml(f.modifiedFormatted)}</span>
            </div>
            <div class="pf-actions">
              <a href="javascript:void(0)" class="pf-btn pf-preview" data-preview-dir="${escapeHtml(f.dirname || f.name)}" data-scope="user">预览</a>
              <a href="${escapeHtml(f.downloadUrl)}" class="pf-btn pf-download" download>下载</a>
            </div>`;
          frag.appendChild(item);
        });
        list.innerHTML = '';
        list.appendChild(frag);
      })
      .catch(() => { if (list) list.innerHTML = '<div class="list-empty">网络错误</div>'; });
  }

  function updateMyFilesQuota(data) {
    const pct = data.quotaBytes > 0
      ? Math.min(100, Math.round((data.usedBytes / data.quotaBytes) * 10000) / 100) : 0;
    const fill = $('myFilesQuotaFill');
    if (fill) {
      fill.style.width = pct + '%';
      fill.className = 'quota-fill' + (pct >= 100 ? ' full' : (pct >= 80 ? ' warn' : ''));
    }
    if ($('myFilesQuotaText')) $('myFilesQuotaText').textContent = data.usedFormatted + ' / ' + data.quotaFormatted;
    if ($('myFilesLockWarn')) $('myFilesLockWarn').classList.toggle('hidden', !data.uploadLocked);
    // 同步用户面板
    if ($('userQuotaFill')) {
      $('userQuotaFill').style.width = pct + '%';
      $('userQuotaFill').className = 'quota-fill' + (pct >= 100 ? ' full' : (pct >= 80 ? ' warn' : ''));
    }
    if ($('userQuotaText')) $('userQuotaText').textContent = data.usedFormatted + ' / ' + data.quotaFormatted + ' (' + pct + '%)';
    if ($('userLockWarn')) $('userLockWarn').classList.toggle('hidden', !data.uploadLocked);
    if ($('userInfoUsage')) $('userInfoUsage').textContent = data.usedFormatted + ' / ' + data.quotaFormatted;
  }

  // ====== 账号折叠面板 ======
  function bindAccountToggle() {
    const btn = $('accountToggleBtn');
    const panel = $('accountPanel');
    if (!btn || !panel) return;
    btn.addEventListener('click', () => {
      const isOpen = !panel.classList.contains('hidden');
      panel.classList.toggle('hidden');
      btn.classList.toggle('open', !isOpen);
    });
  }

  // ====== 文件说明文本框字符计数 ======
  function bindDescText() {
    const ta = $('descText');
    const cnt = $('descTextCount');
    if (!ta || !cnt) return;
    ta.addEventListener('input', () => {
      cnt.textContent = ta.value.length;
      // 触发上传按钮可用性检查
      if (typeof checkReady === 'function') checkReady();
    });
  }

  // ====== Tab 切换 ======
  function bindTabSwitch() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
  }

  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.classList.toggle('active', p.id === `tab-${tab}`);
    });
    if (tab === 'myfiles') loadMyFilesTab();
  }

  // ====== 隐藏管理入口：10 秒内累计点击 Logo 7 次触发 ======
  function bindAdminModal() {
    const logoIcon = document.querySelector('.logo-icon');
    if (!logoIcon) return;
    let clicks = [];
    const REQUIRED_CLICKS = 7;
    const WINDOW_MS = 10000; // 10 秒窗口

    logoIcon.style.cursor = 'pointer';
    logoIcon.addEventListener('click', () => {
      const now = Date.now();
      // 只保留窗口内的点击
      clicks = clicks.filter((t) => now - t <= WINDOW_MS);
      clicks.push(now);
      if (clicks.length >= REQUIRED_CLICKS) {
        clicks = [];
        openAdminModal();
      }
    });
  }

  function openAdminModal() {
    const modal = $('adminModal');
    modal.classList.remove('hidden');
    if (adminToken) {
      // 已登录，直接显示审核列表
      $('adminLoginArea').classList.add('hidden');
      $('adminPanel').classList.remove('hidden');
      loadPendingList();
    } else {
      $('adminLoginArea').classList.remove('hidden');
      $('adminPanel').classList.add('hidden');
      setTimeout(() => $('adminPwd').focus(), 100);
    }
  }

  function closeAdminModal() {
    $('adminModal').classList.add('hidden');
    // 清理窗口化状态
    const box = $('adminModalBox');
    if (box) {
      box.classList.remove('maximized');
      box.style.transform = '';
    }
    const ball = document.querySelector('.admin-mini-ball');
    if (ball) ball.classList.add('hidden');
  }

  // 最小化弹窗为右下角蓝底白字 A 小球
  function minimizeAdminModal() {
    const modal = $('adminModal');
    modal.classList.add('hidden');
    let ball = document.querySelector('.admin-mini-ball');
    if (!ball) {
      ball = document.createElement('div');
      ball.className = 'admin-mini-ball';
      ball.innerHTML = 'A<span class="mini-tip">单击恢复 · 双击放大</span>';
      document.body.appendChild(ball);
      bindDrag(ball, ball);
      // 单击 / 双击区分
      let clickCount = 0;
      let clickTimer = null;
      ball.addEventListener('click', () => {
        clickCount++;
        if (clickCount === 1) {
          clickTimer = setTimeout(() => {
            ball.classList.add('hidden');
            modal.classList.remove('hidden');
            clickCount = 0;
          }, 280);
        } else if (clickCount === 2) {
          clearTimeout(clickTimer);
          ball.classList.add('hidden');
          modal.classList.remove('hidden');
          const box = $('adminModalBox');
          if (box) box.classList.add('maximized');
          clickCount = 0;
        }
      });
    }
    ball.classList.remove('hidden');
  }

  // 切换最大化/还原
  function toggleMaximize() {
    const box = $('adminModalBox');
    if (!box) return;
    const isMax = box.classList.toggle('maximized');
    if (isMax) box.style.transform = ''; // 最大化时清除拖动偏移
  }

  // 通用拖动：按住 handle 拖动 target（用 transform translate）
  function bindDrag(handle, target) {
    let startX = 0, startY = 0, offsetX = 0, offsetY = 0, dragging = false;
    handle.addEventListener('mousedown', (e) => {
      // 标题栏拖动排除控件按钮区域
      if (handle.id === 'adminModalHead' && e.target.closest('.modal-controls')) return;
      if (target.classList.contains('maximized')) return; // 最大化时不可拖
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const cs = window.getComputedStyle(target);
      const matrix = cs.transform;
      offsetX = 0; offsetY = 0;
      if (matrix && matrix !== 'none') {
        const m = matrix.match(/matrix\(([^)]+)\)/);
        if (m) {
          const p = m[1].split(',').map((x) => parseFloat(x));
          offsetX = p[4] || 0;
          offsetY = p[5] || 0;
        }
      }
      target.classList.add('dragging');
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = offsetX + (e.clientX - startX);
      const dy = offsetY + (e.clientY - startY);
      target.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      target.classList.remove('dragging');
    });
  }

  // ====== 上传配置 ======
  function loadUploadConfig(cb) {
    fetch('/api/upload-config', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) {
          uploadConfig = d.data;
          SUGGEST_MAX_SIZE = d.data.suggestMaxSize || SUGGEST_MAX_SIZE;
          MAX_DESC_LENGTH = d.data.maxDescLength || MAX_DESC_LENGTH;
          const hint = $('sizeHint');
          const descMax = $('descMax');
          if (hint) hint.textContent = d.data.suggestMaxSizeFormatted || '2 GB';
          if (descMax) descMax.textContent = MAX_DESC_LENGTH;
          renderUploadTags();
          renderFilterTags();
        }
      })
      .catch(() => {})
      .finally(() => cb && cb());
  }

  // ====== 上传标签 ======
  let uploadTagsState = [];

  function renderUploadTags() {
    const box = $('uploadTagsBox');
    if (!box) return;
    const tags = (uploadConfig && uploadConfig.presetTags) || [];
    box.innerHTML = '';
    if (tags.length === 0) {
      box.innerHTML = '<span class="tag-empty">无可用标签</span>';
      return;
    }
    const frag = document.createDocumentFragment();
    tags.forEach((t) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag-chip-btn' + (uploadTagsState.includes(t) ? ' active' : '');
      chip.textContent = t;
      chip.dataset.tag = t;
      chip.addEventListener('click', () => {
        const idx = uploadTagsState.indexOf(t);
        if (idx >= 0) uploadTagsState.splice(idx, 1);
        else if (uploadTagsState.length < 10) uploadTagsState.push(t);
        else { alert('最多选 10 个标签'); return; }
        renderUploadTags();
        updateUploadTagCount();
        checkReady();
      });
      frag.appendChild(chip);
    });
    box.appendChild(frag);
  }

  function updateUploadTagCount() {
    const el = $('uploadTagCount');
    if (el) el.textContent = uploadTagsState.length;
  }

  function getSelectedUploadTags() {
    return uploadTagsState.slice();
  }

  function clearUploadTags() {
    uploadTagsState = [];
    renderUploadTags();
    updateUploadTagCount();
  }

  // ====== 下载列表 Tab ======
  function bindDownloadsTab() {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        applyFilter();
        // 登录用户保存搜索历史（非空、且输入停顿后）
        const kw = (searchInput.value || '').trim();
        if (currentUser && kw) saveSearchHistory(kw);
      }, 200);
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const kw = (searchInput.value || '').trim();
        if (currentUser && kw) saveSearchHistory(kw);
      }
    });
    refreshBtn.addEventListener('click', () => {
      refreshBtn.classList.add('spin');
      setTimeout(() => refreshBtn.classList.remove('spin'), 600);
      loadFiles();
      loadPendingCount();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        loadFiles();
        loadPendingCount();
      }
    });
  }

  function getExtTagClass(ext) {
    const map = { 'EXE': 'tag-blue', 'MSI': 'tag-blue', 'ZIP': 'tag-orange', 'RAR': 'tag-orange', '7Z': 'tag-orange', 'TAR': 'tag-orange', 'GZ': 'tag-orange', 'ISO': 'tag-purple', 'DMG': 'tag-purple', 'PDF': 'tag-red', 'DOC': 'tag-darkblue', 'DOCX': 'tag-darkblue', 'XLS': 'tag-green', 'XLSX': 'tag-green', 'PPT': 'tag-orange-red', 'PPTX': 'tag-orange-red', 'TXT': 'tag-gray', 'SH': 'tag-green-dark', 'DEB': 'tag-pink', 'RPM': 'tag-pink', 'MP4': 'tag-cyan', 'MKV': 'tag-cyan' };
    return map[ext && ext.toUpperCase()] || 'tag-default';
  }

  function renderFiles(files) {
    fileTableBody.innerHTML = '';
    if (files.length === 0) {
      if (allFiles.length === 0) {
        hideAllStates();
        fileTableBody.closest('.table-wrapper').classList.add('hidden');
        emptyState.classList.remove('hidden');
        emptyState.querySelector('h3').textContent = t('emptyFilesTitle');
        emptyState.querySelector('p').textContent = t('emptyFilesSub');
      } else {
        hideAllStates();
        fileTableBody.closest('.table-wrapper').classList.add('hidden');
        noResultState.classList.remove('hidden');
      }
      return;
    }
    hideAllStates();
    fileTableBody.closest('.table-wrapper').classList.remove('hidden');

    const frag = document.createDocumentFragment();
    files.forEach((file, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'file-row';
      const extTagClass = getExtTagClass(file.extension);
      const downloadUrl = file.isPackage && file.dirname
        ? `/download-dir/${encodeURIComponent(file.dirname)}`
        : `/download/${encodeURIComponent(file.name)}`;
      const previewBtnHtml = (file.isPackage && file.dirname)
        ? `<a href="javascript:void(0)" class="btn-preview" data-dirname="${escapeHtml(file.dirname)}" title="${t('tipPreviewDetail')}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            <span>${t('btnPreview')}</span>
          </a>`
        : '';
      const tagsHtml = (file.tags && file.tags.length)
        ? `<div class="preview-tags-inline">${file.tags.map((tag) => `<span class="tag-chip-sm">${escapeHtml(tag)}</span>`).join('')}</div>`
        : '';
      tr.innerHTML = `
        <td class="col-idx">${idx + 1}</td>
        <td class="col-name">
          <div class="file-main">
            <span class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.chineseName)}</span>
          </div>
          <div class="file-sub">
            <span class="version">${escapeHtml(file.version)}</span>
            <span class="file-realname mono" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
          </div>
          ${tagsHtml}
        </td>
        <td class="col-ext"><span class="ext-tag ${extTagClass}">${escapeHtml(file.extension || '-')}</span></td>
        <td class="col-size">${escapeHtml(file.sizeFormatted)}</td>
        <td class="col-time">${escapeHtml(file.modifiedFormatted)}</td>
        <td class="col-action">
          <div class="btn-group-right">
            ${previewBtnHtml}
            <a href="${downloadUrl}" class="btn-download" download title="${t('tipDownloadResume')}">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>${t('colDownload')}</span>
            </a>
          </div>
        </td>`;
      // 预览按钮
      const pvBtn = tr.querySelector('.btn-preview');
      if (pvBtn) {
        pvBtn.addEventListener('click', function (e) {
          e.preventDefault();
          openPreview(this.dataset.dirname);
        });
      }
      const dlBtn = tr.querySelector('.btn-download');
      dlBtn.addEventListener('click', function () {
        const btn = this;
        btn.classList.add('downloading');
        setTimeout(() => btn.classList.remove('downloading'), 1200);
      });
      frag.appendChild(tr);
    });
    fileTableBody.appendChild(frag);
  }

  function hideAllStates() {
    emptyState.classList.add('hidden');
    noResultState.classList.add('hidden');
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function loadFiles() {
    fileTableBody.innerHTML = `
      <tr class="loading-row">
        <td colspan="6">
          <div class="loading">
            <div class="spinner"></div>
            <span>${t('loadingFiles')}</span>
          </div>
        </td>
      </tr>`;
    fileCountBadge.textContent = t('badgeRefreshing');
    fileCountBadge.classList.add('badge-loading');
    fetch('/api/files', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        fileCountBadge.classList.remove('badge-loading');
        if (d.code === 0) {
          allFiles = d.data.files || [];
          fileCountBadge.textContent = t('fileCountTpl').replace('{n}', allFiles.length);
          populateFilterExt();
          applyFilter();
        } else {
          fileCountBadge.textContent = t('loadFailed');
          showErr(d.message || t('loadFailed'));
        }
      })
      .catch((err) => {
        fileCountBadge.classList.remove('badge-loading');
        fileCountBadge.textContent = t('badgeNetworkError');
        showErr(t('requestFailed') + err.message);
      });
  }

  function showErr(msg) {
    hideAllStates();
    fileTableBody.closest('.table-wrapper').classList.add('hidden');
    emptyState.classList.remove('hidden');
    emptyState.querySelector('h3').textContent = t('loadError');
    emptyState.querySelector('p').innerHTML = `<code>${escapeHtml(msg)}</code>`;
  }

  function applyFilter() {
    const kw = (searchInput.value || '').trim().toLowerCase();
    const extFilter = $('filterExt') ? $('filterExt').value : '';
    const sizeFilter = $('filterSize') ? $('filterSize').value : '';
    const dateFilter = $('filterDate') ? $('filterDate').value : '';
    const tagFilters = getSelectedFilterTags();

    let filtered = allFiles;

    // 关键词
    if (kw) {
      filtered = filtered.filter((f) =>
        (f.name || '').toLowerCase().includes(kw) ||
        (f.chineseName || '').toLowerCase().includes(kw) ||
        (f.description || '').toLowerCase().includes(kw) ||
        (f.version || '').toLowerCase().includes(kw) ||
        ((f.extension || '').toLowerCase().includes(kw))
      );
    }
    // 扩展名
    if (extFilter) {
      filtered = filtered.filter((f) => (f.extension || '').toUpperCase() === extFilter);
    }
    // 大小
    if (sizeFilter) {
      filtered = filtered.filter((f) => {
        const s = f.size || 0;
        if (sizeFilter === 'lt10') return s < 10 * 1024 * 1024;
        if (sizeFilter === '10to100') return s >= 10 * 1024 * 1024 && s < 100 * 1024 * 1024;
        if (sizeFilter === '100to1g') return s >= 100 * 1024 * 1024 && s < 1024 * 1024 * 1024;
        if (sizeFilter === 'gt1g') return s >= 1024 * 1024 * 1024;
        return true;
      });
    }
    // 上传日期
    if (dateFilter) {
      const now = Date.now();
      const ranges = {
        '1d': 24 * 3600 * 1000,
        '7d': 7 * 24 * 3600 * 1000,
        '30d': 30 * 24 * 3600 * 1000,
        '90d': 90 * 24 * 3600 * 1000,
        '1y': 365 * 24 * 3600 * 1000
      };
      const range = ranges[dateFilter];
      if (range) {
        filtered = filtered.filter((f) => (now - (f.modified || 0)) <= range);
      }
    }
    // 标签（AND 关系：选中的标签都得包含）
    if (tagFilters.length > 0) {
      filtered = filtered.filter((f) => {
        const tags = f.tags || [];
        return tagFilters.every((t) => tags.includes(t));
      });
    }
    renderFiles(filtered);
  }

  // ====== 筛选条 ======
  let filterTagsState = []; // 选中的筛选标签

  function bindFilterBar() {
    const toggleBtn = $('filterToggleBtn');
    const bar = $('filterBar');
    const extSel = $('filterExt');
    const sizeSel = $('filterSize');
    const dateSel = $('filterDate');
    const clearBtn = $('filterClearBtn');
    if (toggleBtn && bar) {
      toggleBtn.addEventListener('click', () => {
        bar.classList.toggle('hidden');
        if (!bar.classList.contains('hidden')) {
          populateFilterExt();
          renderFilterTags();
        }
      });
    }
    if (extSel) extSel.addEventListener('change', applyFilter);
    if (sizeSel) sizeSel.addEventListener('change', applyFilter);
    if (dateSel) dateSel.addEventListener('change', applyFilter);
    if (clearBtn) clearBtn.addEventListener('click', () => {
      if (extSel) extSel.value = '';
      if (sizeSel) sizeSel.value = '';
      if (dateSel) dateSel.value = '';
      filterTagsState = [];
      renderFilterTags();
      applyFilter();
    });
  }

  // 填充扩展名下拉（基于当前文件列表）
  function populateFilterExt() {
    const sel = $('filterExt');
    if (!sel) return;
    const cur = sel.value;
    const exts = new Set();
    allFiles.forEach((f) => {
      if (f.extension) exts.add(f.extension.toUpperCase());
    });
    const sorted = Array.from(exts).sort();
    // 重新构建
    sel.innerHTML = '<option value="">全部</option>';
    sorted.forEach((e) => {
      const opt = document.createElement('option');
      opt.value = e;
      opt.textContent = e;
      sel.appendChild(opt);
    });
    sel.value = cur;
  }

  // 渲染筛选标签 chips
  function renderFilterTags() {
    const box = $('filterTagsBox');
    if (!box) return;
    const tags = (uploadConfig && uploadConfig.presetTags) || [];
    box.innerHTML = '';
    if (tags.length === 0) {
      box.innerHTML = '<span class="tag-empty">无可用标签</span>';
      return;
    }
    const frag = document.createDocumentFragment();
    tags.forEach((t) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag-chip-btn' + (filterTagsState.includes(t) ? ' active' : '');
      chip.textContent = t;
      chip.dataset.tag = t;
      chip.addEventListener('click', () => {
        const idx = filterTagsState.indexOf(t);
        if (idx >= 0) filterTagsState.splice(idx, 1);
        else filterTagsState.push(t);
        renderFilterTags();
        applyFilter();
      });
      frag.appendChild(chip);
    });
    box.appendChild(frag);
  }

  function getSelectedFilterTags() {
    return filterTagsState.slice();
  }

  function loadPendingCount() {
    // 普通访客不显示待审核红圈，仅管理员已登录时拉取并展示
    if (!adminToken) {
      pendingBadge.classList.add('hidden');
      return;
    }
    fetch('/api/pending-count', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        const n = ((d && d.data) || {}).pendingCount || 0;
        if (n > 0) {
          pendingBadge.classList.remove('hidden');
          pendingBadge.textContent = n;
        } else {
          pendingBadge.classList.add('hidden');
        }
      })
      .catch(() => { });
  }

  // ====== 上传 Tab ======
  function bindUploadTab() {
    const dropZone = $('dropZone');
    const fileInput = $('fileInput');
    const fileInfo = $('fileInfo');
    const fiName = fileInfo.querySelector('.fi-name');
    const fiSize = fileInfo.querySelector('.fi-size');
    const sizeWarn = $('sizeWarn');
    const changeBtn = $('changeFileBtn');
    const form = $('uploadForm');
    const submitBtn = $('submitBtn');
    const descInput = $('descInput');
    const descCount = $('descCount');
    const progressBox = $('progressBox');
    const pbStatus = $('pbStatus');
    const pbPercent = $('pbPercent');
    const pbFill = $('pbFill');
    const pbSpeed = $('pbSpeed');
    const pbRemain = $('pbRemain');
    const resultBox = $('resultBox');
    const resetBtn = $('resetBtn');
    // 文件说明文本框（替代旧的说明文档上传）
    const descTextInput = $('descText');
    const descTextCount = $('descTextCount');

    // 描述字符过滤 + 计数
    descInput.addEventListener('input', function () {
      // 前端就做字符过滤
      let v = this.value.replace(UNSAFE_REGEX, '');
      if (v.length > MAX_DESC_LENGTH) v = v.slice(0, MAX_DESC_LENGTH);
      this.value = v;
      descCount.textContent = v.length;
      checkReady();
    });

    // 点击选择
    dropZone.addEventListener('click', (e) => {
      // 避免点击"选择文件夹"按钮时同时触发文件选择
      if (e.target.closest('#selectFolderBtn')) return;
      fileInput.click();
    });
    changeBtn.addEventListener('click', () => fileInput.click());

    // 文件夹选择
    const folderBtn = $('selectFolderBtn');
    const folderInput = $('folderInput');
    if (folderBtn && folderInput) {
      folderBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        folderInput.click();
      });
      folderInput.addEventListener('change', handleFolderSelected);
    }

    // 拖拽
    ['dragenter', 'dragover'].forEach((ev) =>
      dropZone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      dropZone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
      })
    );
    dropZone.addEventListener('drop', (e) => {
      if (e.dataTransfer.files.length > 0) {
        fileInput.files = e.dataTransfer.files;
        handleFileSelected();
      }
    });
    fileInput.addEventListener('change', handleFileSelected);

    // 当前选中的待上传文件对象（单文件或文件夹打包后的 zip blob）
    let pendingUploadFile = null;

    function handleFileSelected() {
      const f = fileInput.files[0];
      if (!f) {
        fileInfo.classList.add('hidden');
        return;
      }
      pendingUploadFile = f;
      dropZone.classList.add('hidden');
      fileInfo.classList.remove('hidden');
      fiName.textContent = f.name;
      fiSize.textContent = formatSize(f.size);
      if (f.size > SUGGEST_MAX_SIZE) {
        sizeWarn.classList.remove('hidden');
        sizeWarn.textContent = `⚠️ 超过建议 ${uploadConfig ? uploadConfig.suggestMaxSizeFormatted : '2 GB'}`;
      } else {
        sizeWarn.classList.add('hidden');
      }
      checkReady();
    }

    // 文件夹选择：用 JSZip 把整个目录打包成 zip 再走单文件上传流程
    function handleFolderSelected() {
      const files = Array.from(folderInput.files || []);
      if (!files.length) return;
      if (typeof JSZip === 'undefined') {
        alert('JSZip 库未加载，无法打包文件夹。请检查网络后刷新页面。');
        folderInput.value = '';
        return;
      }
      // 找出公共根目录名
      const rootName = files[0].webkitRelativePath.split('/')[0] || 'folder';
      const zipName = rootName + '.zip';
      const zip = new JSZip();
      files.forEach((f) => {
        // webkitRelativePath 形如 "myfolder/sub/file.txt"，去掉首段根目录
        const relPath = f.webkitRelativePath || f.name;
        const parts = relPath.split('/');
        parts.shift(); // 去掉根目录名
        const innerPath = parts.join('/');
        if (innerPath) zip.file(innerPath, f);
      });
      dropZone.classList.add('hidden');
      fileInfo.classList.remove('hidden');
      fiName.textContent = zipName + ' （文件夹打包）';
      fiSize.textContent = '打包中...';
      sizeWarn.classList.add('hidden');
      zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }).then((blob) => {
        // 包装成 File 对象
        const zipFile = new File([blob], zipName, { type: 'application/zip' });
        pendingUploadFile = zipFile;
        fiSize.textContent = formatSize(zipFile.size);
        if (zipFile.size > SUGGEST_MAX_SIZE) {
          sizeWarn.classList.remove('hidden');
          sizeWarn.textContent = `⚠️ 超过建议 ${uploadConfig ? uploadConfig.suggestMaxSizeFormatted : '2 GB'}`;
        }
        checkReady();
      }).catch((err) => {
        alert('文件夹打包失败：' + err.message);
        folderInput.value = '';
        fileInfo.classList.add('hidden');
        dropZone.classList.remove('hidden');
      });
    }

    function checkReady() {
      const descOk = descInput.value.trim().length > 0;
      const descTextOk = descTextInput && descTextInput.value.trim().length >= 10;
      const fileOk = pendingUploadFile || (fileInput.files && fileInput.files.length > 0);
      const tagsOk = getSelectedUploadTags().length > 0;
      submitBtn.disabled = !(descOk && descTextOk && fileOk && tagsOk);
    }

    resetBtn.addEventListener('click', (e) => {
      setTimeout(() => {
        descCount.textContent = '0';
        if (descTextCount) descTextCount.textContent = '0';
        dropZone.classList.remove('hidden');
        fileInfo.classList.add('hidden');
        progressBox.classList.add('hidden');
        resultBox.classList.add('hidden');
        submitBtn.disabled = true;
        pbFill.style.width = '0%';
        pendingUploadFile = null;
        if (folderInput) folderInput.value = '';
        // 清标签
        clearUploadTags();
      }, 0);
    });

    // 上传提交（分片上传版）
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const file = pendingUploadFile || fileInput.files[0];
      const desc = descInput.value.replace(UNSAFE_REGEX, '').slice(0, MAX_DESC_LENGTH).trim();
      const tags = getSelectedUploadTags();
      if (!file || !desc) return;
      if (tags.length === 0) {
        alert('请至少选择一个文件标签');
        return;
      }
      // 文件说明（必填，10-200 字）
      const descTextVal = descTextInput ? descTextInput.value.trim() : '';
      if (!descTextVal) {
        alert('请填写文件说明（10-200 字）');
        descTextInput && descTextInput.focus();
        return;
      }
      if (descTextVal.length < 10) {
        alert('文件说明过短，请至少输入 10 个字');
        descTextInput && descTextInput.focus();
        return;
      }
      if (descTextVal.length > 200) {
        alert('文件说明不能超过 200 字');
        descTextInput && descTextInput.focus();
        return;
      }
      const visInput = document.querySelector('input[name="visibility"]:checked');
      const visibility = visInput ? visInput.value : 'public';

      // 启动分片上传
      chunkedUpload({
        file, description: desc, tags, visibility, descText: descTextVal,
        onProgress: (pct, speedBps, remainSec) => {
          resultBox.classList.add('hidden');
          progressBox.classList.remove('hidden');
          submitBtn.disabled = true;
          pbPercent.textContent = pct + '%';
          pbFill.style.width = pct + '%';
          if (speedBps != null) pbSpeed.textContent = formatSize(speedBps) + '/s';
          if (remainSec != null) pbRemain.textContent = formatTime(remainSec);
          pbStatus.textContent = pct === 100 ? '服务器处理中...' : '上传中...';
        },
        onSuccess: (data) => {
          pbStatus.textContent = '上传成功';
          resultBox.className = 'result-box result-ok';
          resultBox.classList.remove('hidden');
          resultBox.innerHTML = `
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <div class="rb-main">
              <strong>${escapeHtml(data.message || '上传成功')}</strong>
              <p>${escapeHtml((data.data || {}).pendingMessage || '上传完成')}</p>
              ${data.data && data.data.overSuggested ? `<p class="rb-warn">文件 ${escapeHtml(data.data.sizeFormatted)}，已超过建议大小，审核可能更慢。</p>` : ''}
            </div>`;
          submitBtn.disabled = true;
          loadPendingCount();
        },
        onError: (msg) => {
          pbStatus.textContent = '上传失败';
          resultBox.className = 'result-box result-err';
          resultBox.classList.remove('hidden');
          resultBox.innerHTML = `
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
            <div class="rb-main"><strong>上传失败</strong><p>${escapeHtml(msg || '请重试')}</p></div>`;
          submitBtn.disabled = false;
        }
      });
    });
  } // end bindUploadForm

  // ============ 分片上传核心 ============
  // 参数：{file, description, tags, visibility, descText, onProgress, onSuccess, onError}
  // 流程：1. 计算MD5 2. 秒传检查 3. 初始化会话（含 descText） 4. 并发上传分片 5. 合并
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
  const CHUNK_CONCURRENCY = 4;         // 并发上传数
  const CHUNK_RETRIES = 3;              // 单片失败重试次数

  async function chunkedUpload(opts) {
    const { file, description, tags, visibility, descText, onProgress, onSuccess, onError } = opts;
    try {
      // 1. 计算 MD5
      onProgress(0, 0, null);
      const _pbStatus = document.getElementById('pbStatus');
      if (_pbStatus) _pbStatus.textContent = '计算文件指纹...';
      const fileMd5 = await calcFileMd5(file);

      // 2. 秒传检查
      const checkRes = await fetch('/api/upload/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileMd5, fileSize: file.size, visibility })
      }).then((r) => r.json());
      if (checkRes.code === 0 && checkRes.data && checkRes.data.instant) {
        // 秒传命中
        if (visibility === 'user-private') loadCurrentUser();
        return onSuccess({ code: 0, message: '秒传成功', data: checkRes.data });
      }

      // 3. 初始化上传会话（descText 随 init 一起传，服务端写入 说明.md）
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
      const initRes = await fetch('/api/upload/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileMd5, fileName: file.name, fileSize: file.size,
          chunkSize: CHUNK_SIZE, totalChunks, visibility, description, tags,
          descText: descText || ''
        })
      }).then((r) => r.json());
      if (initRes.code !== 0) return onError(initRes.message);
      const { uploadId, uploadedChunks, totalChunks: tc } = initRes.data;
      const done = new Set(uploadedChunks);

      // 4. 并发上传分片
      let uploadedBytes = 0;
      for (const idx of done) {
        uploadedBytes += (idx === tc - 1)
          ? (file.size - (tc - 1) * CHUNK_SIZE)
          : CHUNK_SIZE;
      }
      const queue = [];
      for (let i = 0; i < tc; i++) {
        if (done.has(i)) continue;
        queue.push(i);
      }
      let lastTs = Date.now();
      let lastBytes = uploadedBytes;
      const startTime = Date.now();

      async function uploadOne(idx, attempt) {
        const start = idx * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const blob = file.slice(start, end);
        const fd = new FormData();
        fd.append('uploadId', uploadId);
        fd.append('index', idx);
        fd.append('chunk', blob);
        try {
          const r = await fetch('/api/upload/chunk', { method: 'POST', body: fd });
          const d = await r.json();
          if (d.code !== 0) throw new Error(d.message || '上传失败');
          uploadedBytes += (end - start);
          const pct = Math.min(100, Math.round((uploadedBytes / file.size) * 100));
          const now = Date.now();
          const dt = now - lastTs;
          let speed = 0, remain = null;
          if (dt >= 500) {
            speed = ((uploadedBytes - lastBytes) * 1000) / dt;
            if (speed > 0) remain = Math.ceil((file.size - uploadedBytes) / speed);
            lastBytes = uploadedBytes;
            lastTs = now;
          }
          onProgress(pct, speed, remain);
        } catch (e) {
          if (attempt < CHUNK_RETRIES) {
            // 重试
            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
            return uploadOne(idx, attempt + 1);
          }
          throw e;
        }
      }

      // 并发控制器：同时跑 CHUNK_CONCURRENCY 个
      const workers = [];
      for (let w = 0; w < CHUNK_CONCURRENCY; w++) {
        workers.push((async () => {
          while (queue.length > 0) {
            const idx = queue.shift();
            if (idx == null) break;
            await uploadOne(idx, 0);
          }
        })());
      }
      await Promise.all(workers);

      // 5. 合并
      onProgress(100, 0, null);
      const mergeRes = await fetch('/api/upload/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId })
      }).then((r) => r.json());
      if (mergeRes.code !== 0) return onError(mergeRes.message);
      if (visibility === 'user-private') loadCurrentUser();
      onSuccess(mergeRes);
    } catch (e) {
      onError(e.message || '上传出错');
    }
  }

  // 计算文件 SHA-256（流式，避免大文件读入内存）
  // 优先用浏览器原生 crypto.subtle.digest（HTTPS/localhost 安全上下文）
  // 不可用时（HTTP 访问）回退到内嵌纯 JS SHA-256 流式实现
  // 字段名保留 fileMd5（语义为"文件指纹"），实际算法是 SHA-256
  function calcFileMd5(file) {
    // 安全上下文优先走原生 API（浏览器内部流式处理，效率高）
    if (window.crypto && window.crypto.subtle && typeof window.crypto.subtle.digest === 'function') {
      return window.crypto.subtle.digest('SHA-256', file).then((buf) => {
        const arr = new Uint8Array(buf);
        let hex = '';
        for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, '0');
        return hex;
      });
    }
    // 回退：纯 JS 流式 SHA-256（4MB 分块读取，避免大文件内存爆炸）
    return calcSha256PureJS(file);
  }

  // ============ 纯 JS SHA-256 流式实现（HTTP 回退用） ============
  function sha256Init() {
    // 初始哈希值
    return new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ]);
  }
  // SHA-256 常量 K
  const SHA256_K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ]);
  function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

  // 处理一个 512-bit（64 字节）块
  function sha256Block(H, block) {
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; i++) {
      w[i] = (block[i*4] << 24) | (block[i*4+1] << 16) | (block[i*4+2] << 8) | block[i*4+3];
      w[i] >>>= 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i-15],7) ^ rotr(w[i-15],18) ^ (w[i-15] >>> 3);
      const s1 = rotr(w[i-2],17) ^ rotr(w[i-2],19) ^ (w[i-2] >>> 10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0;
    }
    let a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0;
    H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+h)>>>0;
  }

  // 流式 SHA-256：分块读取文件，避免大文件内存爆炸
  function calcSha256PureJS(file) {
    return new Promise((resolve, reject) => {
      const H = sha256Init();
      const chunkSize = 4 * 1024 * 1024; // 4MB
      let offset = 0;
      const totalLen = file.size;
      // 缓冲区：保留最后不足 64 字节的尾部
      let buffer = new Uint8Array(0);

      function readNext() {
        if (offset >= totalLen) {
          // 结束：追加 0x80 + 填充 + 8 字节长度
          const padLen = ((buffer.length + 9 + 63) >> 6) << 6;
          const pad = new Uint8Array(padLen);
          pad.set(buffer);
          pad[buffer.length] = 0x80;
          // 末尾 8 字节：比特长度（大端）
          const bitLen = totalLen * 8;
          // 仅支持到 2^53，足够单文件场景
          const lo = bitLen >>> 0;
          const hi = Math.floor(bitLen / 0x100000000) >>> 0;
          pad[padLen-8] = (hi >>> 24) & 0xff;
          pad[padLen-7] = (hi >>> 16) & 0xff;
          pad[padLen-6] = (hi >>> 8) & 0xff;
          pad[padLen-5] = hi & 0xff;
          pad[padLen-4] = (lo >>> 24) & 0xff;
          pad[padLen-3] = (lo >>> 16) & 0xff;
          pad[padLen-2] = (lo >>> 8) & 0xff;
          pad[padLen-1] = lo & 0xff;
          for (let i = 0; i < padLen; i += 64) {
            sha256Block(H, pad.subarray(i, i+64));
          }
          // 输出 hex
          let hex = '';
          for (let i = 0; i < 8; i++) {
            hex += H[i].toString(16).padStart(8, '0');
          }
          resolve(hex);
          return;
        }
        const end = Math.min(offset + chunkSize, totalLen);
        const blob = file.slice(offset, end);
        const reader = new FileReader();
        reader.onload = function () {
          const data = new Uint8Array(reader.result);
          // 合并上次剩余 + 本次
          const combined = new Uint8Array(buffer.length + data.length);
          combined.set(buffer);
          combined.set(data, buffer.length);
          // 处理整 64 字节块，尾部不足 64 字节留到下一轮
          const fullBlocks = Math.floor(combined.length / 64) * 64;
          for (let i = 0; i < fullBlocks; i += 64) {
            sha256Block(H, combined.subarray(i, i+64));
          }
          buffer = combined.subarray(fullBlocks); // 可能是空
          offset = end;
          // 让出主线程，避免大文件卡 UI
          setTimeout(readNext, 0);
        };
        reader.onerror = function () { reject(new Error('文件读取失败')); };
        reader.readAsArrayBuffer(blob);
      }
      readNext();
    });
  }

  function formatSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatTime(sec) {
    if (!sec || sec < 0) sec = 0;
    if (sec < 60) return sec + '秒 剩余';
    if (sec < 3600) return Math.floor(sec / 60) + '分' + (sec % 60) + '秒 剩余';
    return Math.floor(sec / 3600) + '时' + Math.floor((sec % 3600) / 60) + '分 剩余';
  }

  // ====== 审核弹窗事件绑定 ======
  function bindAdminModalEvents() {
    const loginBtn = $('adminLoginBtn');
    const pwdInput = $('adminPwd');
    const logoutBtn = $('logoutAdminBtn');
    const closeBtn = $('closeAdminModal');
    const modalOverlay = $('adminModal');
    const privateListBtn = $('privateListBtn');
    const backToPendingBtn = $('backToPendingBtn');
    const minimizeBtn = $('minimizeAdminModal');
    const maximizeBtn = $('maximizeAdminModal');
    const modalBox = $('adminModalBox');
    const modalHead = $('adminModalHead');

    loginBtn.addEventListener('click', loginAdmin);
    pwdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginAdmin(); });
    logoutBtn.addEventListener('click', () => {
      adminToken = null;
      $('adminLoginArea').classList.remove('hidden');
      $('adminPanel').classList.add('hidden');
      $('privateListView').classList.add('hidden');
      pwdInput.value = '';
    });
    privateListBtn.addEventListener('click', showPrivateListView);
    backToPendingBtn.addEventListener('click', showAdminPanelView);
    closeBtn.addEventListener('click', closeAdminModal);
    if (minimizeBtn) minimizeBtn.addEventListener('click', minimizeAdminModal);
    if (maximizeBtn) maximizeBtn.addEventListener('click', toggleMaximize);
    // 标题栏拖动 + 双击最大化
    if (modalHead) {
      bindDrag(modalHead, modalBox);
      modalHead.addEventListener('dblclick', (e) => {
        if (e.target.closest('.modal-controls')) return; // 排除按钮区
        toggleMaximize();
      });
    }
    // 点击遮罩关闭
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeAdminModal();
    });
    // ESC 关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modalOverlay.classList.contains('hidden')) closeAdminModal();
    });
  }

  function loginAdmin() {
    const pwd = $('adminPwd').value;
    if (!pwd) {
      alert('请输入管理员密码');
      return;
    }
    fetch(`/api/admin/pending?pwd=${encodeURIComponent(pwd)}`, { cache: 'no-store' })
      .then((r) => {
        if (r.status === 401) throw new Error('密码错误');
        return r.json();
      })
      .then((d) => {
        if (d.code === 0) {
          adminToken = pwd;
          $('adminLoginArea').classList.add('hidden');
          $('adminPanel').classList.remove('hidden');
          renderPendingList(d.data.files || []);
        } else {
          throw new Error(d.message || '登录失败');
        }
      })
      .catch((e) => alert(e.message || '登录失败'));
  }

  function loadPendingList() {
    if (!adminToken) return;
    fetch(`/api/admin/pending?pwd=${encodeURIComponent(adminToken)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) renderPendingList(d.data.files || []);
      })
      .catch((e) => console.error(e));
  }

  function renderPendingList(files) {
    const count = files.length;
    $('pendingCount').textContent = count;
    const pendingEmpty = $('pendingEmpty');
    const pendingWrapper = $('pendingWrapper');
    const tbody = $('pendingTableBody');

    if (count === 0) {
      pendingEmpty.classList.remove('hidden');
      pendingWrapper.classList.add('hidden');
      return;
    }
    pendingEmpty.classList.add('hidden');
    pendingWrapper.classList.remove('hidden');
    tbody.innerHTML = '';

    const frag = document.createDocumentFragment();
    files.forEach((file, idx) => {
      const ext = (file.name.split('.').pop() || '').toUpperCase();
      const tr = document.createElement('tr');
      tr.className = 'file-row';
      tr.innerHTML = `
        <td class="col-idx">${idx + 1}</td>
        <td class="col-name">
          <div class="file-main">
            <span class="file-name">${escapeHtml(file.description || '(无描述)')}</span>
            ${file.overSuggested ? '<span class="tag-orange-red ml-xs">⚠️ 超2GB</span>' : ''}
          </div>
          <div class="file-sub">
            <span class="file-realname mono">${escapeHtml(file.originalName || file.name)}</span>
          </div>
        </td>
        <td class="col-ext"><span class="ext-tag ${getExtTagClass(ext)}">${ext || '-'}</span></td>
        <td class="col-size">${escapeHtml(file.sizeFormatted)}</td>
        <td class="col-time">${escapeHtml(file.uploadedAtFormatted)}</td>
        <td class="col-action">
          <div class="btn-group-right">
            <button class="btn-approve" data-name="${escapeHtml(file.name)}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span>通过</span>
            </button>
            <button class="btn-reject" data-name="${escapeHtml(file.name)}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              <span>拒绝</span>
            </button>
          </div>
        </td>`;
      tr.querySelector('.btn-approve').addEventListener('click', function () {
        const nm = this.dataset.name;
        if (!confirm(`审核通过「${nm}」？该文件会加入下载列表公开。`)) return;
        adminAction('approve', nm);
      });
      tr.querySelector('.btn-reject').addEventListener('click', function () {
        const nm = this.dataset.name;
        if (!confirm(`确认拒绝并删除「${nm}」？此操作不可恢复。`)) return;
        adminAction('reject', nm);
      });
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
  }

  function adminAction(type, filename) {
    const url = type === 'approve' ? '/api/admin/approve' : '/api/admin/reject';
    fetch(`${url}?pwd=${encodeURIComponent(adminToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename })
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) {
          loadPendingList();
          loadFiles();
          loadPendingCount();
        } else {
          alert((type === 'approve' ? '审核通过失败' : '拒绝失败') + '：' + (d.message || '未知错误'));
        }
      })
      .catch((e) => alert('请求失败：' + e.message));
  }

  // ====== 私密文件列表 ======
  function showPrivateListView() {
    $('adminPanel').classList.add('hidden');
    $('announcementAdminView').classList.add('hidden');
    $('userListView').classList.add('hidden');
    $('notifyView').classList.add('hidden');
    $('privateListView').classList.remove('hidden');
    loadPrivateList();
  }

  function loadPrivateList() {
    if (!adminToken) return;
    fetch(`/api/admin/private-list?pwd=${encodeURIComponent(adminToken)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) renderPrivateList(d.data.files || []);
      })
      .catch((e) => console.error(e));
  }

  function renderPrivateList(files) {
    const count = files.length;
    $('privateCount').textContent = count;
    const privateEmpty = $('privateEmpty');
    const privateWrapper = $('privateWrapper');
    const tbody = $('privateTableBody');

    if (count === 0) {
      privateEmpty.classList.remove('hidden');
      privateWrapper.classList.add('hidden');
      return;
    }
    privateEmpty.classList.add('hidden');
    privateWrapper.classList.remove('hidden');
    tbody.innerHTML = '';

    const frag = document.createDocumentFragment();
    files.forEach((file, idx) => {
      const ext = file.extension || (file.name.split('.').pop() || '').toUpperCase();
      const fullUrl = window.location.origin + file.downloadUrl;
      const tr = document.createElement('tr');
      tr.className = 'file-row';
      tr.innerHTML = `
        <td class="col-idx">${idx + 1}</td>
        <td class="col-name">
          <div class="file-main">
            <span class="file-name" title="${escapeHtml(file.name)}">#${escapeHtml(file.chineseName)}</span>
          </div>
          <div class="file-sub">
            <span class="file-realname mono" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
          </div>
        </td>
        <td class="col-ext"><span class="ext-tag ${getExtTagClass(ext)}">${escapeHtml(ext || '-')}</span></td>
        <td class="col-size">${escapeHtml(file.sizeFormatted)}</td>
        <td class="col-time">${escapeHtml(file.modifiedFormatted)}</td>
        <td class="col-action">
          <div class="btn-group-right">
            <a href="${file.downloadUrl}" class="btn-download btn-small" download title="下载">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              <span>下载</span>
            </a>
            <button class="btn-copy" data-url="${escapeHtml(fullUrl)}" title="复制直链">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              <span>复制链接</span>
            </button>
          </div>
        </td>`;
      tr.querySelector('.btn-copy').addEventListener('click', function () {
        const url = this.dataset.url;
        const btn = this;
        const orig = btn.innerHTML;
        navigator.clipboard.writeText(url).then(() => {
          btn.innerHTML = '<span>已复制 ✓</span>';
          btn.classList.add('copied');
          setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 2000);
        }).catch(() => {
          const tmp = document.createElement('input');
          tmp.value = url;
          document.body.appendChild(tmp);
          tmp.select();
          document.execCommand('copy');
          document.body.removeChild(tmp);
          btn.innerHTML = '<span>已复制 ✓</span>';
          setTimeout(() => { btn.innerHTML = orig; }, 2000);
        });
      });
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
  }

  // ====== 公告：信箱图标 + 弹层 ======
  const ANN_READ_KEY = 'ann_last_read_at';
  let annCache = []; // 公告列表缓存

  function getLastReadAt() {
    const v = localStorage.getItem(ANN_READ_KEY);
    return v ? parseInt(v, 10) || 0 : 0;
  }
  function markAnnRead(ts) {
    localStorage.setItem(ANN_READ_KEY, String(ts || Date.now()));
  }

  // 拉取公告列表（不渲染，只更新缓存 + 红点）
  function refreshAnnouncementDot() {
    fetch('/api/announcements', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.code !== 0) return;
        annCache = (d.data && d.data.announcements) || [];
        const last = getLastReadAt();
        const hasNew = annCache.some((a) => (a.createdAt || 0) > last);
        const dot = $('announcementDot');
        if (!dot) return;
        if (hasNew && annCache.length > 0) dot.classList.remove('hidden');
        else dot.classList.add('hidden');
      })
      .catch(() => {});
  }

  function bindAnnouncementBox() {
    const btn = $('announcementBtn');
    const panel = $('announcementPanel');
    const closeBtn = $('closeAnnouncementBtn');
    if (!btn || !panel) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !panel.classList.contains('hidden');
      if (isOpen) {
        panel.classList.add('hidden');
      } else {
        panel.classList.remove('hidden');
        loadAnnouncementList();
      }
    });
    closeBtn.addEventListener('click', () => panel.classList.add('hidden'));
    document.addEventListener('click', (e) => {
      if (panel.classList.contains('hidden')) return;
      if (!panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        panel.classList.add('hidden');
      }
    });
  }

  function loadAnnouncementList() {
    const list = $('announcementList');
    list.innerHTML = '<div class="dp-loading">加载中...</div>';
    fetch('/api/announcements', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.code !== 0) {
          list.innerHTML = '<div class="dp-empty">加载失败</div>';
          return;
        }
        annCache = (d.data && d.data.announcements) || [];
        // 标记已读为最新公告时间
        const maxTs = annCache.reduce((m, a) => Math.max(m, a.createdAt || 0), 0);
        if (maxTs > 0) markAnnRead(maxTs);
        $('announcementDot').classList.add('hidden');
        renderAnnouncementList(annCache);
      })
      .catch(() => {
        list.innerHTML = '<div class="dp-empty">网络错误</div>';
      });
  }

  function renderAnnouncementList(list) {
    const ul = $('announcementList');
    if (!list.length) {
      ul.innerHTML = '<div class="dp-empty">暂无公告</div>';
      return;
    }
    ul.innerHTML = '';
    const frag = document.createDocumentFragment();
    list.forEach((a) => {
      const item = document.createElement('div');
      item.className = 'ann-item ann-item-collapsed';
      const typeText = a.type === 'maintenance' ? '维护' : (a.type === 'release' ? '新版' : '普通');
      item.innerHTML = `
        <div class="ann-item-head">
          <span class="ann-item-title">${escapeHtml(a.title)}</span>
          <span class="ann-type-tag ann-type-${escapeHtml(a.type || 'normal')}">${typeText}</span>
          <svg class="ann-item-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </div>
        <div class="ann-item-detail hidden">
          <div class="ann-item-content">${escapeHtml(a.content)}</div>
          <div class="ann-item-time">${new Date(a.createdAt || 0).toLocaleString('zh-CN')}</div>
        </div>`;
      item.addEventListener('click', () => {
        const detail = item.querySelector('.ann-item-detail');
        if (!detail) return;
        const willOpen = detail.classList.contains('hidden');
        detail.classList.toggle('hidden', !willOpen);
        item.classList.toggle('ann-item-collapsed', !willOpen);
        item.classList.toggle('ann-item-expanded', willOpen);
      });
      frag.appendChild(item);
    });
    ul.appendChild(frag);
  }

  // ====== 公告管理（管理员） ======
  let editingAnnId = null;

  function bindAnnouncementAdmin() {
    const manageBtn = $('announcementManageBtn');
    const backBtn = $('backFromAnnouncementBtn');
    const submitBtn = $('annSubmitBtn');
    const cancelBtn = $('annCancelBtn');
    const titleInput = $('annTitle');
    const contentInput = $('annContent');
    const titleCount = $('annTitleCount');
    const contentCount = $('annContentCount');
    if (manageBtn) manageBtn.addEventListener('click', showAnnouncementAdminView);
    if (backBtn) backBtn.addEventListener('click', showAdminPanelView);
    if (titleInput) titleInput.addEventListener('input', () => {
      titleCount.textContent = titleInput.value.length;
    });
    if (contentInput) contentInput.addEventListener('input', () => {
      contentCount.textContent = contentInput.value.length;
    });
    if (submitBtn) submitBtn.addEventListener('click', submitAnnouncement);
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
      $('annTitle').value = '';
      $('annContent').value = '';
      $('annTitleCount').textContent = '0';
      $('annContentCount').textContent = '0';
      editingAnnId = null;
      submitBtn.textContent = '发布公告';
    });
  }

  function showAnnouncementAdminView() {
    $('adminPanel').classList.add('hidden');
    $('privateListView').classList.add('hidden');
    $('userListView').classList.add('hidden');
    $('notifyView').classList.add('hidden');
    $('announcementAdminView').classList.remove('hidden');
    loadAnnouncementAdminList();
  }

  function showAdminPanelView() {
    $('announcementAdminView').classList.add('hidden');
    $('privateListView').classList.add('hidden');
    $('userListView').classList.add('hidden');
    $('notifyView').classList.add('hidden');
    $('adminPanel').classList.remove('hidden');
  }

  function loadAnnouncementAdminList() {
    const tbody = $('annTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr class="loading-row"><td colspan="5"><div class="loading"><div class="spinner"></div><span>加载中...</span></div></td></tr>';
    fetch('/api/announcements?pwd=' + encodeURIComponent(adminToken), { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.code !== 0) {
          tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#c92e2e;padding:20px;">加载失败</td></tr>`;
          return;
        }
        const list = (d.data && d.data.announcements) || [];
        renderAnnouncementAdminList(list);
      })
      .catch(() => {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#c92e2e;padding:20px;">网络错误</td></tr>`;
      });
  }

  function renderAnnouncementAdminList(list) {
    const tbody = $('annTableBody');
    const empty = $('annEmpty');
    const wrapper = $('annWrapper');
    const countBadge = $('announcementCount');
    countBadge.textContent = list.length;
    if (!list.length) {
      empty.classList.remove('hidden');
      wrapper.classList.add('hidden');
      tbody.innerHTML = '';
      return;
    }
    empty.classList.add('hidden');
    wrapper.classList.remove('hidden');
    tbody.innerHTML = '';
    const frag = document.createDocumentFragment();
    list.forEach((a, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'file-row';
      const typeText = a.type === 'maintenance' ? '维护' : (a.type === 'release' ? '新版' : '普通');
      tr.innerHTML = `
        <td class="col-idx">${idx + 1}</td>
        <td class="col-name">
          <div class="file-main"><span class="file-name">${escapeHtml(a.title)}</span></div>
          <div class="file-sub"><span class="file-realname">${escapeHtml((a.content || '').slice(0, 60))}${a.content && a.content.length > 60 ? '...' : ''}</span></div>
        </td>
        <td><span class="ann-type-tag ann-type-${escapeHtml(a.type || 'normal')}">${typeText}</span></td>
        <td class="col-time">${escapeHtml(new Date(a.createdAt || 0).toLocaleString('zh-CN'))}</td>
        <td class="col-action">
          <div class="btn-group-right">
            <button class="btn-copy ann-edit-btn" data-id="${escapeHtml(a.id)}" title="编辑">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              <span>编辑</span>
            </button>
            <button class="btn-reject ann-del-btn" data-id="${escapeHtml(a.id)}" data-title="${escapeHtml(a.title)}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg>
              <span>删除</span>
            </button>
          </div>
        </td>`;
      tr.querySelector('.ann-edit-btn').addEventListener('click', function () {
        const item = list.find((x) => x.id === this.dataset.id);
        if (!item) return;
        editingAnnId = item.id;
        $('annTitle').value = item.title || '';
        $('annContent').value = item.content || '';
        $('annType').value = item.type || 'normal';
        $('annTitleCount').textContent = (item.title || '').length;
        $('annContentCount').textContent = (item.content || '').length;
        $('annSubmitBtn').textContent = '保存修改';
        $('annTitle').focus();
      });
      tr.querySelector('.ann-del-btn').addEventListener('click', function () {
        const id = this.dataset.id;
        const title = this.dataset.title;
        if (!confirm(`删除公告「${title}」？此操作不可恢复。`)) return;
        fetch('/api/admin/announcement?pwd=' + encodeURIComponent(adminToken), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', id: id })
        })
          .then((r) => r.json())
          .then((d) => {
            if (d.code === 0) {
              loadAnnouncementAdminList();
              refreshAnnouncementDot();
            } else {
              alert('删除失败：' + (d.message || '未知错误'));
            }
          })
          .catch((e) => alert('请求失败：' + e.message));
      });
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
  }

  function submitAnnouncement() {
    const title = $('annTitle').value.trim();
    const content = $('annContent').value.trim();
    const type = $('annType').value;
    if (!title || !content) {
      alert('标题和正文都不能为空');
      return;
    }
    const body = editingAnnId
      ? { action: 'update', id: editingAnnId, title: title, content: content, type: type }
      : { action: 'create', title: title, content: content, type: type };
    fetch('/api/admin/announcement?pwd=' + encodeURIComponent(adminToken), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) {
          $('annTitle').value = '';
          $('annContent').value = '';
          $('annTitleCount').textContent = '0';
          $('annContentCount').textContent = '0';
          $('annType').value = 'normal';
          editingAnnId = null;
          $('annSubmitBtn').textContent = '发布公告';
          loadAnnouncementAdminList();
          refreshAnnouncementDot();
        } else {
          alert((editingAnnId ? '保存失败' : '发布失败') + '：' + (d.message || '未知错误'));
        }
      })
      .catch((e) => alert('请求失败：' + e.message));
  }

  // ====== 国际化（中英文切换） ======
  const I18N = {
    zh: {
      // 顶部 / 标题
      docTitle: '文件下载站 | 内部资源镜像',
      siteTitle: '文件下载站',
      siteSubtitle: 'Internal File Mirror · 大文件直链下载',
      badgeNetworkError: '网络错误',
      avatarUnregistered: '未注册',
      tipAnnouncement: '站点公告',
      tipSettings: '设置',
      tipRefresh: '刷新列表',
      tipUser: '用户',
      // Tab 导航
      tabDownloads: '下载列表',
      tabUpload: '我要上传',
      tabMyFiles: '我的云盘',
      // 信息条
      infoBandwidth: '带宽',
      infoBandwidthVal: '上行满载 · 直链下载',
      infoFeature: '特性',
      infoFeatureVal: '断点续传 · 上传审核',
      infoNaming: '命名建议',
      // 搜索 / 筛选
      searchPlaceholder: '搜索软件名称、版本号或扩展名...',
      tipFilter: '筛选',
      btnFilter: '筛选',
      tipHistory: '搜索历史',
      btnHistory: '历史',
      historyTitle: '搜索历史',
      historyClear: '清空',
      historyEmpty: '登录后才会记录搜索历史',
      filterFormat: '格式',
      filterSize: '大小',
      filterDate: '上传日期',
      filterTags: '标签',
      filterAll: '全部',
      filterClear: '清空筛选',
      // 文件表头
      colIndex: '#',
      colName: '软件名称 / 版本',
      colType: '类型',
      colSize: '大小',
      colTime: '更新时间',
      colDownload: '下载',
      colActions: '操作',
      colFileDesc: '文件 / 型号描述',
      colFileDescShort: '文件 / 描述',
      colUploadTime: '上传时间',
      colDirectLink: '直链 / 操作',
      colTitle: '标题 / 正文',
      colCreated: '创建时间',
      colUsername: '用户名',
      colEmail: '邮箱',
      colSpace: '空间使用',
      colRegTime: '注册时间',
      loadingFiles: '正在读取文件列表...',
      loadError: '加载出错',
      loadErrorSub: '请求失败',
      noMatch: '未找到匹配的文件',
      noMatchSub: '请尝试其他关键词',
      emptyFilesTitle: '暂无文件',
      emptyFilesSub: '等待管理员发布或前往「我要上传」分享文件',
      btnPreview: '预览',
      tipPreviewDetail: '预览详情',
      tipDownloadResume: '点击下载 · 支持断点续传',
      badgeRefreshing: '刷新中...',
      fileCountTpl: '共 {n} 个文件',
      loadFailed: '加载失败',
      requestFailed: '请求失败：',
      // 上传表单
      uploadTitle: '分享文件给大家',
      uploadDesc: '填写型号/描述并选择文件，上传后进入待审核区，管理员审核通过后会发布到下载列表。',
      sizeHintStrong: '建议文件大小不超过 ',
      sizeHintSub: '超过也可以上传，只是审核会更严格，且下载速度受上行带宽限制。',
      labelDesc: '型号 / 描述',
      labelVisibility: '可见性',
      labelTags: '文件标签',
      labelDescText: '文件说明',
      labelSelectFile: '选择文件',
      visPublic: '公开（所有人可下载）',
      visPrivate: '仅管理员可见',
      visUserPrivate: '仅自己可见（需登录）',
      tagsTip: '至少选 1 个，最多 10 个（不选无法上传）',
      tagsLoading: '加载标签中...',
      tagsSelected: '已选',
      descTextPlaceholder: '必填：用 10-200 字描述这个文件的内容、用途、版本特点等，将展示在预览页中间区域...',
      descTextTip: '必填，10-200 字。此说明会展示在文件预览页的中间区域，用户点击预览按钮即可看到。',
      dzMain: '点击选择文件，或把文件拖到这里',
      dzSub: '支持所有格式，建议文件名格式：软件名_版本号.exe',
      sizeWarn: '⚠️ 超过建议 2GB',
      changeFile: '重新选择',
      pbUploading: '上传中...',
      pbRemain: '剩余',
      btnStartUpload: '开始上传',
      btnReset: '重置',
      // 我的云盘
      myDriveTitle: '我的云盘',
      myDriveLoginReq: '登录后可使用我的云盘',
      myDriveLoginTip: '点击右上角头像或齿轮图标 → 用户 → 登录/注册',
      myDriveRegTip: '注册即获 1GB 我的云盘存储空间，文件仅自己可见，免审核。',
      myDriveLockWarn: '⚠️ 上传通道已锁死（超出 1GB 配额），请删除部分文件后再上传。',
      myDriveEmpty: '暂无云盘文件，上传时选择「仅自己可见」即可',
      loading: '加载中...',
      // 预览页
      previewBack: '← 返回列表',
      previewDownload: '下载',
      previewDocTitle: '说明',
      previewDocEmpty: '（无说明）',
      previewEntriesTitle: '包内内容',
      // 设置弹窗
      settingsTitle: '设置',
      stabLang: '语言',
      stabPersonal: '个性化',
      stabGeneral: '通用',
      stabUser: '用户',
      stabFeedback: '反馈',
      setLangLabel: '界面语言',
      setLangTip: '英文为初步翻译，部分管理员文案仍为中文。',
      setFontSize: '字号',
      setFontFamily: '字体',
      setBgColor: '主页背景色',
      setBgColorTip: '恢复默认请输入 ',
      setBgImage: '主页背景图',
      bgImageEmpty: '未设置',
      bgImageBtn: '选择图片',
      bgImageDelete: '删除',
      bgImageTip: '登录后可上传主页背景图（jpg/png/gif/webp，单张 ≤ 5MB，非分片）',
      setBgMode: '背景图模式',
      bgModeCover: '覆盖（铺满）',
      bgModeContain: '居中（完整显示）',
      bgModeRepeat: '平铺（重复）',
      setBoxOpacity: '文件浏览框透明度',
      setBoxOpacityTip: '设为 0% 时文件浏览框完全透明，仅保留文字和分隔线，背景图/色直接透出。',
      setBoxColor: '文件浏览框颜色',
      setBoxFollowBg: '跟随主页背景色',
      setShowLink: '在主页文件列表显示下载链接',
      setShowLinkTip: '关闭后，下载按钮仍可用，但不再展示直链 URL。',
      setContactAdmin: '联系管理员',
      // 用户面板
      labelUsername: '用户名',
      labelPassword: '密码',
      labelConfirmPwd: '确认密码',
      labelEmail: '邮箱',
      labelOpt: '可选',
      phUsername: '3-20 位字母/数字/下划线/中划线',
      phPassword: '6-64 位',
      phRegUsername: '3-20 位，首字符须字母或数字',
      phPwdAgain: '再输一次',
      phEmail: '用于网站停机通知（可选）',
      btnLogin: '登录',
      btnGoRegister: '去注册',
      btnRegister: '注册并登录',
      btnCancel: '取消',
      registerTitle: '注册新账户',
      regTip: '注册后获得 1GB 我的云盘空间，可上传仅自己可见的文件。',
      userInfoName: '用户名',
      userInfoEmail: '邮箱',
      userInfoDrive: '我的云盘',
      userLockWarn: '⚠️ 上传通道已锁死（超出 1GB 配额），请删除部分我的云盘文件后再上传。',
      accountToggle: '更改账号',
      accountChangeUsername: '修改用户名',
      accountSaveUsername: '保存用户名',
      accountChangePwd: '修改密码',
      accountOldPwd: '原密码',
      accountNewPwd: '新密码',
      accountConfirmPwd: '确认新密码',
      accountSavePwd: '保存密码',
      myDriveFiles: '我的云盘文件',
      accountActions: '账户操作',
      btnLogout: '退出登录',
      btnDeleteAccount: '注销账户',
      deleteAccountTip: '注销会删除你的账户和所有云盘文件，不可恢复。',
      // 反馈
      feedbackDesc: '匿名反馈，可附 5 张以内图片。如需回复请填写联系方式。',
      feedbackContent: '反馈内容',
      feedbackContact: '联系方式',
      feedbackImages: '附图（最多 5 张，每张 ≤ 8MB）',
      feedbackContactPh: '邮箱 / QQ / 微信号（可选）',
      feedbackContentPh: '问题描述、建议或反馈（300 字以内）...',
      btnSubmitFeedback: '提交反馈',
      // 公告
      annTitle: '站点公告',
      // 管理员
      adminPanelTitle: '管理员审核面板',
      adminLoginDesc: '请输入管理员密码登录，以查看和管理待审核的上传文件。',
      adminPwdLabel: '管理员密码',
      adminPwdPh: '请输入管理员密码',
      btnAdminLogin: '进入审核',
      pendingListTitle: '待审核列表',
      btnAnnManage: '公告管理',
      btnUserList: '用户列表',
      btnNotify: '停机通知',
      btnPrivateList: '文件列表',
      btnAdminLogout: '退出登录',
      pendingEmpty: '没有待审核的文件',
      pendingEmptySub: '所有上传的文件都已经审核处理完毕',
      privateListTitle: '我的云盘文件列表',
      btnBack: '← 返回',
      privateEmptyTitle: '没有云盘文件',
      privateEmptySub: '所有「仅管理员可见」的文件会列在这里',
      annManageTitle: '公告管理',
      annLabelTitle: '标题',
      annLabelType: '类型',
      annLabelContent: '正文',
      annTypeNormal: '普通',
      annTypeMaintenance: '维护',
      annTypeRelease: '新版本',
      annPhTitle: '如：站点维护通知 / v3.1 发布',
      annPhContent: '公告详情...',
      btnPublishAnn: '发布公告',
      btnClearAnn: '清空',
      annEmptyTitle: '暂无公告',
      annEmptySub: '发布第一条公告后会展示在这里',
      userListTitle: '用户列表',
      userListEmpty: '暂无注册用户',
      userListEmptySub: '用户注册后会显示在这里，可查看空间使用情况',
      notifyTitle: '邮件停机通知',
      notifyLabelSubject: '主题',
      notifyPhSubject: '如：服务器维护通知',
      notifyLabelContent: '正文',
      notifyPhContent: '维护时间、影响范围、恢复预计等...',
      btnSendNotify: '发送通知',
      // 页脚
      footerCopyright: '© 2024 文件下载站 · 仅限内部使用 · 请勿外传',
      footerTip: 'Chrome / Edge 浏览器支持断点续传，下载中断后重新点击同一链接即可继续。'
    },
    en: {
      // Top / Title
      docTitle: 'File Download Station | Internal Mirror',
      siteTitle: 'File Download Station',
      siteSubtitle: 'Internal File Mirror · Large File Direct Download',
      badgeNetworkError: 'Network Error',
      avatarUnregistered: 'Sign Up',
      tipAnnouncement: 'Announcements',
      tipSettings: 'Settings',
      tipRefresh: 'Refresh',
      tipUser: 'User',
      // Tab nav
      tabDownloads: 'Downloads',
      tabUpload: 'Upload',
      tabMyFiles: 'My Drive',
      // Info bar
      infoBandwidth: 'Bandwidth',
      infoBandwidthVal: 'Full Upload · Direct Link',
      infoFeature: 'Features',
      infoFeatureVal: 'Resumable · Moderated Upload',
      infoNaming: 'Naming',
      // Search / Filter
      searchPlaceholder: 'Search software name, version, or extension...',
      tipFilter: 'Filter',
      btnFilter: 'Filter',
      tipHistory: 'Search History',
      btnHistory: 'History',
      historyTitle: 'Search History',
      historyClear: 'Clear',
      historyEmpty: 'Search history is recorded after login',
      filterFormat: 'Format',
      filterSize: 'Size',
      filterDate: 'Uploaded',
      filterTags: 'Tags',
      filterAll: 'All',
      filterClear: 'Clear Filter',
      // Table headers
      colIndex: '#',
      colName: 'Software Name / Version',
      colType: 'Type',
      colSize: 'Size',
      colTime: 'Updated',
      colDownload: 'Download',
      colActions: 'Actions',
      colFileDesc: 'File / Description',
      colFileDescShort: 'File / Desc',
      colUploadTime: 'Uploaded',
      colDirectLink: 'Direct Link / Actions',
      colTitle: 'Title / Content',
      colCreated: 'Created',
      colUsername: 'Username',
      colEmail: 'Email',
      colSpace: 'Storage Used',
      colRegTime: 'Registered',
      loadingFiles: 'Loading file list...',
      loadError: 'Load Failed',
      loadErrorSub: 'Request failed',
      noMatch: 'No Matching Files',
      noMatchSub: 'Try other keywords',
      emptyFilesTitle: 'No Files',
      emptyFilesSub: 'Waiting for admin to publish, or share a file via Upload.',
      btnPreview: 'Preview',
      tipPreviewDetail: 'Preview Details',
      tipDownloadResume: 'Click to download · resumable',
      badgeRefreshing: 'Refreshing...',
      fileCountTpl: '{n} files',
      loadFailed: 'Load failed',
      requestFailed: 'Request failed: ',
      // Upload form
      uploadTitle: 'Share a File with Everyone',
      uploadDesc: 'Fill in the description and select a file. After upload, it enters the moderation queue and is published once approved by an admin.',
      sizeHintStrong: 'Recommended max size: ',
      sizeHintSub: 'Larger files can still be uploaded, but moderation is stricter and download speed is limited by upload bandwidth.',
      labelDesc: 'Model / Description',
      labelVisibility: 'Visibility',
      labelTags: 'Tags',
      labelDescText: 'File Description',
      labelSelectFile: 'Select File',
      visPublic: 'Public (anyone can download)',
      visPrivate: 'Admin only',
      visUserPrivate: 'Private (login required)',
      tagsTip: 'Select 1–10 tags (required to upload)',
      tagsLoading: 'Loading tags...',
      tagsSelected: 'Selected',
      descTextPlaceholder: 'Required: 10–200 characters describing the file content, purpose, version highlights, etc. Shown in the preview page.',
      descTextTip: 'Required, 10–200 chars. Shown in the preview page when users click the preview button.',
      dzMain: 'Click to select a file, or drag one here',
      dzSub: 'All formats supported. Suggested name: SoftwareName_Version.exe',
      sizeWarn: '⚠️ Exceeds 2GB recommendation',
      changeFile: 'Choose another',
      pbUploading: 'Uploading...',
      pbRemain: 'remaining',
      btnStartUpload: 'Start Upload',
      btnReset: 'Reset',
      // My Drive
      myDriveTitle: 'My Drive',
      myDriveLoginReq: 'Sign in to use My Drive',
      myDriveLoginTip: 'Click the avatar or gear icon at the top right → User → Login/Register',
      myDriveRegTip: 'Register to get 1GB of personal drive storage. Files are private and require no review.',
      myDriveLockWarn: '⚠️ Upload locked (1GB quota exceeded). Delete some files before uploading.',
      myDriveEmpty: 'No files yet. Choose "Private" when uploading to add one.',
      loading: 'Loading...',
      // Preview page
      previewBack: '← Back to list',
      previewDownload: 'Download',
      previewDocTitle: 'Description',
      previewDocEmpty: '(No description)',
      previewEntriesTitle: 'Archive Contents',
      // Settings
      settingsTitle: 'Settings',
      stabLang: 'Language',
      stabPersonal: 'Personalization',
      stabGeneral: 'General',
      stabUser: 'User',
      stabFeedback: 'Feedback',
      setLangLabel: 'Interface Language',
      setLangTip: 'English is a partial translation; some admin-only text remains in Chinese.',
      setFontSize: 'Font Size',
      setFontFamily: 'Font Family',
      setBgColor: 'Homepage Background',
      setBgColorTip: 'Reset to default with ',
      setBgImage: 'Background Image',
      bgImageEmpty: 'Not set',
      bgImageBtn: 'Choose Image',
      bgImageDelete: 'Delete',
      bgImageTip: 'Sign in to upload a homepage background (jpg/png/gif/webp, max 5MB, non-chunked)',
      setBgMode: 'Background Mode',
      bgModeCover: 'Cover (fill)',
      bgModeContain: 'Contain (fit)',
      bgModeRepeat: 'Tile (repeat)',
      setBoxOpacity: 'File Box Opacity',
      setBoxOpacityTip: 'At 0% the file box is fully transparent, showing only text and divider lines over the background.',
      setBoxColor: 'File Box Color',
      setBoxFollowBg: 'Follow homepage background',
      setShowLink: 'Show direct download links in file list',
      setShowLinkTip: 'When off, the download button still works, but the direct URL is hidden.',
      setContactAdmin: 'Contact Admin',
      // User panel
      labelUsername: 'Username',
      labelPassword: 'Password',
      labelConfirmPwd: 'Confirm Password',
      labelEmail: 'Email',
      labelOpt: 'optional',
      phUsername: '3–20 chars: letters, digits, _ or -',
      phPassword: '6–64 chars',
      phRegUsername: '3–20 chars, must start with letter or digit',
      phPwdAgain: 'Type again',
      phEmail: 'For downtime notifications (optional)',
      btnLogin: 'Log In',
      btnGoRegister: 'Register',
      btnRegister: 'Register & Log In',
      btnCancel: 'Cancel',
      registerTitle: 'Create a New Account',
      regTip: 'Register to get 1GB of My Drive storage for private files.',
      userInfoName: 'Username',
      userInfoEmail: 'Email',
      userInfoDrive: 'My Drive',
      userLockWarn: '⚠️ Upload locked (1GB quota exceeded). Delete some files before uploading.',
      accountToggle: 'Account Settings',
      accountChangeUsername: 'Change Username',
      accountSaveUsername: 'Save',
      accountChangePwd: 'Change Password',
      accountOldPwd: 'Current Password',
      accountNewPwd: 'New Password',
      accountConfirmPwd: 'Confirm New Password',
      accountSavePwd: 'Save',
      myDriveFiles: 'My Drive Files',
      accountActions: 'Account Actions',
      btnLogout: 'Log Out',
      btnDeleteAccount: 'Delete Account',
      deleteAccountTip: 'Deleting your account removes all your drive files. This cannot be undone.',
      // Feedback
      feedbackDesc: 'Anonymous feedback, up to 5 images. Add contact info if you want a reply.',
      feedbackContent: 'Content',
      feedbackContact: 'Contact',
      feedbackImages: 'Images (max 5, ≤ 8MB each)',
      feedbackContactPh: 'Email / QQ / WeChat (optional)',
      feedbackContentPh: 'Describe your issue, suggestion, or feedback (≤ 300 chars)...',
      btnSubmitFeedback: 'Submit Feedback',
      // Announcement
      annTitle: 'Announcements',
      // Admin
      adminPanelTitle: 'Admin Moderation Panel',
      adminLoginDesc: 'Enter the admin password to view and moderate pending uploads.',
      adminPwdLabel: 'Admin Password',
      adminPwdPh: 'Enter admin password',
      btnAdminLogin: 'Enter',
      pendingListTitle: 'Pending Review',
      btnAnnManage: 'Announcements',
      btnUserList: 'Users',
      btnNotify: 'Downtime Notice',
      btnPrivateList: 'File List',
      btnAdminLogout: 'Log Out',
      pendingEmpty: 'No files pending review',
      pendingEmptySub: 'All uploaded files have been processed',
      privateListTitle: 'My Drive File List',
      btnBack: '← Back',
      privateEmptyTitle: 'No Drive Files',
      privateEmptySub: 'Files marked "Admin only" are listed here',
      annManageTitle: 'Announcement Management',
      annLabelTitle: 'Title',
      annLabelType: 'Type',
      annLabelContent: 'Content',
      annTypeNormal: 'Normal',
      annTypeMaintenance: 'Maintenance',
      annTypeRelease: 'Release',
      annPhTitle: 'e.g. Server maintenance / v3.1 release',
      annPhContent: 'Announcement details...',
      btnPublishAnn: 'Publish',
      btnClearAnn: 'Clear',
      annEmptyTitle: 'No Announcements',
      annEmptySub: 'Publish your first announcement to see it here',
      userListTitle: 'User List',
      userListEmpty: 'No registered users',
      userListEmptySub: 'Registered users appear here with their storage usage',
      notifyTitle: 'Email Downtime Notice',
      notifyLabelSubject: 'Subject',
      notifyPhSubject: 'e.g. Server maintenance notice',
      notifyLabelContent: 'Content',
      notifyPhContent: 'Maintenance time, impact, expected recovery, etc....',
      btnSendNotify: 'Send Notice',
      // Footer
      footerCopyright: '© 2024 File Download Station · Internal use only · Do not redistribute',
      footerTip: 'Chrome / Edge support resumable downloads. If a download is interrupted, click the same link again to resume.'
    }
  };

  let currentLang = 'zh';
  function t(key) {
    const dict = I18N[currentLang] || I18N.zh;
    return dict[key] != null ? dict[key] : (I18N.zh[key] != null ? I18N.zh[key] : key);
  }

  function applyI18n(lang) {
    currentLang = (lang === 'en') ? 'en' : 'zh';
    document.documentElement.lang = (currentLang === 'en') ? 'en' : 'zh-CN';
    document.title = t('docTitle');
    // 遍历所有带 data-i18n 的元素
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const val = t(key);
      // 保留子元素（如 <span class="req">*</span>）的场景：仅当元素没有 data-i18n-keep-children 时整体替换
      if (el.getAttribute('data-i18n-keep') === 'true') {
        // 只替换第一个文本节点
        const firstText = el.firstChild;
        if (firstText && firstText.nodeType === Node.TEXT_NODE) {
          firstText.nodeValue = val;
        } else {
          el.textContent = val;
        }
      } else {
        el.textContent = val;
      }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    // 动态更新页面中按 ID 定位的关键元素
    const setText = (id, key) => { const el = $(id); if (el) el.textContent = t(key); };
    setText('fileCount', 'badgeNetworkError');
    setText('userAvatarName', currentUser ? '' : 'avatarUnregistered');
    if (currentUser && $('userAvatarName')) $('userAvatarName').textContent = currentUser.username;
    // 重新渲染文件列表（表头/按钮文案）
    if (typeof renderFiles === 'function' && allFiles.length) renderFiles(allFiles);
    // 重新加载我的云盘（如果在已登录视图）
    if (currentUser && currentTab === 'myfiles' && typeof loadMyFilesTab === 'function') loadMyFilesTab();
    // 重新加载待审核列表（如果在管理员视图）
    if (adminToken && typeof loadPendingList === 'function' && !$('adminPanel').classList.contains('hidden')) loadPendingList();
  }

  // ====== 设置面板（第 1 期：语言/个性化/通用/反馈） ======
  function bindSettingsPanel() {
    const btn = $('settingsBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      openSettingsModal();
    });
    const closeBtn = $('settingsCloseBtn');
    const overlay = $('settingsModal');
    if (closeBtn) closeBtn.addEventListener('click', () => overlay.classList.add('hidden'));
    if (overlay) overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay && !overlay.classList.contains('hidden')) overlay.classList.add('hidden');
    });

    // 设置面板 tab 切换
    document.querySelectorAll('.settings-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.settings-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.settings-panel').forEach((p) => p.classList.add('hidden'));
        const target = $('stab-' + tab.dataset.stab);
        if (target) target.classList.remove('hidden');
      });
    });

    // 各字段 change 持久化
    const langEl = $('setLang');
    if (langEl) langEl.addEventListener('change', () => {
      persistSetting('lang', langEl.value);
      applyI18n(langEl.value);
    });
    const fontSizeEl = $('setFontSize');
    if (fontSizeEl) fontSizeEl.addEventListener('input', () => {
      const v = fontSizeEl.value;
      const valEl = $('fontSizeVal');
      if (valEl) valEl.textContent = v + ' px';
      persistSetting('fontSize', v);
    });
    const fontFamilyEl = $('setFontFamily');
    if (fontFamilyEl) fontFamilyEl.addEventListener('change', () => persistSetting('fontFamily', fontFamilyEl.value));
    const bgColorEl = $('setBgColor');
    if (bgColorEl) bgColorEl.addEventListener('input', () => persistSetting('bgColor', bgColorEl.value));
    const showLinkEl = $('setShowLink');
    if (showLinkEl) showLinkEl.addEventListener('change', () => persistSetting('showLink', showLinkEl.checked));
    // 背景图模式
    const bgModeEl = $('setBgMode');
    if (bgModeEl) bgModeEl.addEventListener('change', () => persistSetting('bgMode', bgModeEl.value));
    // 文件浏览框透明度（可调到 0 完全透明）
    const boxOpacityEl = $('setBoxOpacity');
    if (boxOpacityEl) boxOpacityEl.addEventListener('input', () => {
      const val = boxOpacityEl.value;
      const valEl = $('boxOpacityVal');
      if (valEl) valEl.textContent = Math.round(parseFloat(val) * 100) + '%';
      persistSetting('boxOpacity', val);
    });
    // 文件浏览框颜色（始终可选，不被 follow-bg 禁用）
    const boxColorEl = $('setBoxColor');
    if (boxColorEl) boxColorEl.addEventListener('input', () => persistSetting('boxColor', boxColorEl.value));
    const boxFollowEl = $('setBoxFollowBg');
    if (boxFollowEl) boxFollowEl.addEventListener('change', () => {
      persistSetting('boxFollowBg', boxFollowEl.checked);
      // 不再禁用颜色选择器：用户可同时设置颜色和 follow-bg，follow-bg 优先
    });
    // 背景图上传/删除
    const bgFileEl = $('bgImageFile');
    const bgUploadBtn = $('bgImageUploadBtn');
    const bgDeleteBtn = $('bgImageDeleteBtn');
    if (bgUploadBtn) bgUploadBtn.addEventListener('click', () => {
      if (!currentUser) { alert('请先登录后再上传背景图'); return; }
      bgFileEl && bgFileEl.click();
    });
    if (bgFileEl) bgFileEl.addEventListener('change', uploadBgImage);
    if (bgDeleteBtn) bgDeleteBtn.addEventListener('click', deleteBgImage);

    // 反馈：字符计数 + 提交
    const fbContent = $('fbContent');
    const fbCount = $('fbContentCount');
    if (fbContent && fbCount) {
      fbContent.addEventListener('input', () => {
        fbCount.textContent = fbContent.value.length;
      });
    }
    const fbSubmit = $('fbSubmitBtn');
    if (fbSubmit) fbSubmit.addEventListener('click', submitFeedback);

    initSettingsForm();
  }

  function openSettingsModal() {
    const modal = $('settingsModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    initSettingsForm();
  }

  // ====== 文件预览页 ======
  // scope: 'public'（公开下载列表）| 'user'（我的云盘）
  function bindPreviewPage() {
    const backBtn = $('previewBackBtn');
    if (backBtn) backBtn.addEventListener('click', closePreview);
    // 全局事件委托：我的云盘 / 管理员私密列表的预览按钮
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.pf-preview');
      if (btn && (btn.dataset.previewDir || btn.dataset.previewName)) {
        e.preventDefault();
        openPreview(btn.dataset.previewDir || btn.dataset.previewName, btn.dataset.scope || 'public');
      }
    });
    // 浏览器后退键 + hash 变化支持
    function handleHash(hash) {
      if (hash.startsWith('#preview-user/')) {
        const dirname = decodeURIComponent(hash.slice('#preview-user/'.length));
        loadPreview(dirname, 'user');
      } else if (hash.startsWith('#preview/')) {
        const dirname = decodeURIComponent(hash.slice('#preview/'.length));
        loadPreview(dirname, 'public');
      } else {
        closePreview(true);
      }
    }
    window.addEventListener('popstate', () => handleHash(window.location.hash || ''));
    window.addEventListener('hashchange', () => handleHash(window.location.hash || ''));
    // 首次进入如有 hash 直接打开
    const hash = window.location.hash || '';
    if (hash.startsWith('#preview/') || hash.startsWith('#preview-user/')) {
      setTimeout(() => handleHash(hash), 50);
    }
  }

  function openPreview(dirname, scope) {
    if (!dirname) return;
    scope = scope || 'public';
    const prefix = (scope === 'user') ? '#preview-user/' : '#preview/';
    const newHash = prefix + encodeURIComponent(dirname);
    if (window.location.hash !== newHash) {
      window.location.hash = newHash; // 触发 hashchange → loadPreview
    } else {
      loadPreview(dirname, scope);
    }
  }

  function closePreview(skipHash) {
    const page = $('previewPage');
    if (page) page.classList.add('hidden');
    if (!skipHash) {
      const h = window.location.hash || '';
      if (h.startsWith('#preview/') || h.startsWith('#preview-user/')) {
        history.pushState('', document.title, window.location.pathname + window.location.search);
      }
    }
  }

  function loadPreview(dirname, scope) {
    const page = $('previewPage');
    if (!page) return;
    scope = scope || 'public';
    page.classList.remove('hidden');
    page.scrollTop = 0;
    document.body.scrollTop = 0;
    $('previewTitle').textContent = '加载中...';
    $('previewDoc').textContent = '（加载中...）';
    $('previewEntries').innerHTML = '';
    $('previewTags').innerHTML = '';
    $('previewExt').textContent = '';
    $('previewSize').textContent = '';
    $('previewTime').textContent = '';
    $('previewCover').innerHTML = '<div class="spinner"></div>';
    const apiPath = (scope === 'user') ? '/api/preview-user/' : '/api/preview/';
    fetch(apiPath + encodeURIComponent(dirname), { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.code !== 0) {
          $('previewTitle').textContent = '加载失败';
          $('previewDoc').textContent = d.message || '加载失败';
          $('previewCover').innerHTML = '<span>?</span>';
          return;
        }
        renderPreview(d.data);
      })
      .catch((e) => {
        $('previewTitle').textContent = '网络错误';
        $('previewDoc').textContent = e.message || '网络错误';
      });
  }

  function renderPreview(data) {
    const body = data.body || {};
    $('previewTitle').textContent = data.title || body.name || '(未命名)';
    $('previewExt').textContent = body.extension || '-';
    $('previewExt').className = 'ext-tag ' + getExtTagClass(body.extension);
    $('previewSize').textContent = body.sizeFormatted || '';
    $('previewTime').textContent = body.modifiedFormatted || '';
    // 标签
    const tagsEl = $('previewTags');
    tagsEl.innerHTML = '';
    (data.tags || []).forEach((t) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.textContent = t;
      tagsEl.appendChild(chip);
    });
    // 封面
    $('previewCover').innerHTML = coverSvgForType(body.cover);
    // 下载
    const dl = $('previewDownloadBtn');
    if (dl) dl.href = data.downloadUrl;
    // 说明文档
    $('previewDoc').textContent = data.docContent && data.docContent.trim()
      ? data.docContent
      : (data.docName ? '（说明文档为空）' : '（无说明文档）');
    // 条目
    const entriesEl = $('previewEntries');
    entriesEl.innerHTML = '';
    let entries = data.archiveEntries;
    let isArchive = body.isArchive;
    if (!entries && data.entries) {
      entries = data.entries;
      isArchive = false;
    }
    $('previewEntriesTitle').textContent = isArchive ? '压缩包内容' : '包内文件';
    if (!entries || entries.length === 0) {
      entriesEl.innerHTML = '<div class="entry-empty">没有其他内容</div>';
    } else {
      const frag = document.createDocumentFragment();
      entries.slice(0, 200).forEach((e) => {
        const item = document.createElement('div');
        item.className = 'entry-item';
        const nameClass = 'entry-name' + (e.isDir ? ' is-dir' : '');
        item.innerHTML = `<span class="${nameClass}">${escapeHtml(e.name)}${e.isDir ? '/' : ''}</span>
          <span class="entry-size">${e.size != null ? formatSize(e.size) : '--'}</span>`;
        frag.appendChild(item);
      });
      entriesEl.appendChild(frag);
    }
  }

  // 按封面类型返回 SVG 图标
  function coverSvgForType(type) {
    const map = {
      exe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><circle cx="6" cy="6.5" r="0.5" fill="currentColor"></circle><circle cx="8" cy="6.5" r="0.5" fill="currentColor"></circle></svg>',
      archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8"></path><path d="M1 3h22v5H1z"></path><line x1="10" y1="12" x2="14" y2="12"></line></svg>',
      disk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="4"></circle></svg>',
      pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M9 15h1.5a1.5 1.5 0 0 0 0-3H9v6"></path><path d="M15 12v6"></path></svg>',
      doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="16" y2="17"></line></svg>',
      sheet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>',
      slides: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"></rect><line x1="12" y1="17" x2="12" y2="21"></line><line x1="8" y1="21" x2="16" y2="21"></line></svg>',
      text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="16" y2="17"></line></svg>',
      video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2"></rect></svg>',
      audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>',
      image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
      code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>',
      web: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>',
      unknown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>'
    };
    return map[type] || map.unknown;
  }

  // 设置面板：第 1 期基础实现（语言、个性化、通用、反馈）
  const SETTINGS_KEY = 'site_settings_v1';

  function readSettings() {
    try {
      const v = localStorage.getItem(SETTINGS_KEY);
      if (!v) return {};
      return JSON.parse(v);
    } catch (e) { return {}; }
  }
  function writeSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s || {}));
  }

  function initSettingsForm() {
    const s = readSettings();
    applySettingsToBody(s);
    // 表单初始化
    const langEl = $('setLang');
    if (langEl) langEl.value = s.lang || 'zh';
    // 应用国际化（页面加载即按保存的语言切换）
    applyI18n(s.lang || 'zh');
    const fontSizeEl = $('setFontSize');
    if (fontSizeEl) fontSizeEl.value = s.fontSize || '14';
    const fontSizeValEl = $('fontSizeVal');
    if (fontSizeValEl) fontSizeValEl.textContent = (s.fontSize || '14') + ' px';
    const fontFamilyEl = $('setFontFamily');
    if (fontFamilyEl) fontFamilyEl.value = s.fontFamily || 'system';
    const bgColorEl = $('setBgColor');
    if (bgColorEl) bgColorEl.value = s.bgColor || '#f6f8fa';
    const showLinkEl = $('setShowLink');
    if (showLinkEl) showLinkEl.checked = s.showLink !== false;
    // 背景图模式 / 文件浏览框
    const bgModeEl2 = $('setBgMode');
    if (bgModeEl2) bgModeEl2.value = s.bgMode || 'cover';
    const boxOpacityEl2 = $('setBoxOpacity');
    // 默认值：有背景图时为 0（透明），无背景图时为 1
    const defaultOpacity = userBgImageUrl ? '0' : '1';
    const opacityVal = s.boxOpacity != null ? s.boxOpacity : defaultOpacity;
    if (boxOpacityEl2) boxOpacityEl2.value = opacityVal;
    const boxOpacityValEl = $('boxOpacityVal');
    if (boxOpacityValEl) boxOpacityValEl.textContent = Math.round(parseFloat(opacityVal) * 100) + '%';
    const boxColorEl2 = $('setBoxColor');
    if (boxColorEl2) boxColorEl2.value = s.boxColor || '#ffffff';
    // 默认跟随主页背景色（首次进入即勾选）
    const boxFollowEl2 = $('setBoxFollowBg');
    if (boxFollowEl2) {
      boxFollowEl2.checked = s.boxFollowBg !== false; // 默认 true
      // 不再禁用颜色选择器
    }
    const adminEmailEl = $('setAdminEmail');
    if (adminEmailEl) {
      // 从后端拉管理员邮箱展示
      fetch('/api/site-config', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => {
          if (d.code === 0 && d.data && d.data.adminEmail) {
            adminEmailEl.textContent = d.data.adminEmail;
          } else {
            adminEmailEl.textContent = '（管理员未公开邮箱）';
          }
        })
        .catch(() => { adminEmailEl.textContent = '（加载失败）'; });
    }
  }

  function applySettingsToBody(s) {
    s = s || {};
    const root = document.documentElement;
    if (s.fontSize) root.style.setProperty('--app-font-size', s.fontSize + 'px');
    else root.style.removeProperty('--app-font-size');
    if (s.fontFamily === 'serif') {
      root.style.setProperty('--app-font-family', 'Georgia, "Songti SC", "SimSun", serif');
    } else if (s.fontFamily === 'mono') {
      root.style.setProperty('--app-font-family', '"SFMono-Regular", Consolas, monospace');
    } else {
      root.style.setProperty('--app-font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif');
    }
    if (s.bgColor) document.body.style.backgroundColor = s.bgColor;
    else document.body.style.backgroundColor = '';
    // 主页背景图
    if (userBgImageUrl) {
      document.body.style.backgroundImage = 'url("' + userBgImageUrl + '")';
      const mode = s.bgMode || 'cover';
      if (mode === 'repeat') {
        document.body.style.backgroundSize = 'auto';
        document.body.style.backgroundRepeat = 'repeat';
        document.body.style.backgroundPosition = 'left top';
        document.body.style.backgroundAttachment = 'scroll';
      } else {
        document.body.style.backgroundSize = mode; // cover / contain
        document.body.style.backgroundRepeat = 'no-repeat';
        document.body.style.backgroundPosition = 'center';
        document.body.style.backgroundAttachment = 'fixed';
      }
    } else {
      document.body.style.backgroundImage = '';
      document.body.style.backgroundSize = '';
      document.body.style.backgroundRepeat = '';
      document.body.style.backgroundPosition = '';
      document.body.style.backgroundAttachment = '';
    }
    // 文件浏览框透明度/颜色
    // 关键逻辑：
    //   1. 有背景图时，若用户未自定义过 boxOpacity，自动透明（值=0），让背景图透出
    //   2. boxFollowBg=true 时，颜色跟随主页背景色；否则用自定义颜色
    //   3. 透明度=0 时加 box-transparent-mode 类，只保留文字和分隔线
    let boxOpacity;
    if (s.boxOpacity != null) {
      boxOpacity = parseFloat(s.boxOpacity);
    } else {
      // 未设置过：有背景图时默认透明，否则默认不透明
      boxOpacity = userBgImageUrl ? 0 : 1;
    }
    const followBg = s.boxFollowBg !== false; // 默认 true
    const boxColor = followBg ? (s.bgColor || '#f6f8fa') : (s.boxColor || '#ffffff');
    const rgb = hexToRgb(boxColor);
    const rgba = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + boxOpacity + ')';
    document.querySelectorAll('#tab-downloads .table-wrapper, #tab-downloads .search-section').forEach((el) => {
      el.style.backgroundColor = rgba;
    });
    // 透明模式：仅文字 + 分隔线
    document.body.classList.toggle('box-transparent-mode', boxOpacity === 0);
  }

  // hex 转 rgb 数组
  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
  }

  // ====== 用户私密文件列表 ======
  function loadUserPrivateFiles() {
    const container = $('userPrivateList');
    const countBadge = $('userPrivateCount');
    if (!container) return;
    if (!currentUser) {
      container.innerHTML = '<div class="list-empty">请先登录</div>';
      if (countBadge) countBadge.textContent = '0';
      return;
    }
    fetch('/api/user/private-files', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.code !== 0) { container.innerHTML = '<div class="list-empty">加载失败</div>'; return; }
        const data = d.data;
        if (countBadge) countBadge.textContent = data.total;
        // 同步更新配额信息（从私密文件 API 获取最新值）
        if (data.usedBytes != null && currentUser) {
          currentUser.usedBytes = data.usedBytes;
          currentUser.usedFormatted = data.usedFormatted;
          currentUser.quotaBytes = data.quotaBytes;
          currentUser.quotaFormatted = data.quotaFormatted;
          currentUser.uploadLocked = data.uploadLocked;
          // 重新渲染配额条
          const pct = data.quotaBytes > 0
            ? Math.min(100, Math.round((data.usedBytes / data.quotaBytes) * 10000) / 100) : 0;
          const fill = $('userQuotaFill');
          if (fill) { fill.style.width = pct + '%'; fill.className = 'quota-fill' + (pct >= 100 ? ' full' : (pct >= 80 ? ' warn' : '')); }
          if ($('userQuotaText')) $('userQuotaText').textContent = data.usedFormatted + ' / ' + data.quotaFormatted + ' (' + pct + '%)';
          if ($('userLockWarn')) $('userLockWarn').classList.toggle('hidden', !data.uploadLocked);
          if ($('userInfoUsage')) $('userInfoUsage').textContent = data.usedFormatted + ' / ' + data.quotaFormatted;
        }
        // 渲染列表
        if (!data.total) {
          container.innerHTML = '<div class="list-empty">暂无云盘文件，上传时选择「仅自己可见」即可</div>';
          return;
        }
        const frag = document.createDocumentFragment();
        data.files.forEach((f) => {
          const item = document.createElement('div');
          item.className = 'private-file-item';
          item.innerHTML = `
            <div class="pf-name" title="${escapeHtml(f.name)}">${escapeHtml(f.chineseName || f.name)}</div>
            <div class="pf-meta">
              <span class="ext-tag ext-${escapeHtml(f.extension || 'bin')}">${escapeHtml(f.extension || '-')}</span>
              <span>${escapeHtml(f.sizeFormatted)}</span>
              <span>${escapeHtml(f.modifiedFormatted)}</span>
            </div>
            <div class="pf-actions">
              <a href="javascript:void(0)" class="pf-btn pf-preview" data-preview-name="${escapeHtml(f.name)}" data-scope="public">预览</a>
              <a href="${escapeHtml(f.downloadUrl)}" class="pf-btn pf-download" download>下载</a>
            </div>`;
          frag.appendChild(item);
        });
        container.innerHTML = '';
        container.appendChild(frag);
      })
      .catch(() => { container.innerHTML = '<div class="list-empty">加载失败</div>'; });
  }

  // ====== 用户主页背景图 ======
  function loadUserBgImage() {
    if (!currentUser) { clearUserBgImage(); return; }
    fetch('/api/user/bg-image/info', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0 && d.data && d.data.hasImage) {
          userBgImageUrl = d.data.url;
          // 更新预览
          const thumb = $('bgImageThumb');
          const empty = $('bgImageEmpty');
          const delBtn = $('bgImageDeleteBtn');
          if (thumb) { thumb.src = userBgImageUrl; thumb.classList.remove('hidden'); }
          if (empty) empty.classList.add('hidden');
          if (delBtn) delBtn.classList.remove('hidden');
        } else {
          userBgImageUrl = null;
          const thumb = $('bgImageThumb');
          const empty = $('bgImageEmpty');
          const delBtn = $('bgImageDeleteBtn');
          if (thumb) thumb.classList.add('hidden');
          if (empty) empty.classList.remove('hidden');
          if (delBtn) delBtn.classList.add('hidden');
        }
        applySettingsToBody(readSettings());
      })
      .catch(() => { /* 忽略 */ });
  }

  function uploadBgImage() {
    const fileEl = $('bgImageFile');
    if (!fileEl || !fileEl.files || !fileEl.files[0]) return;
    if (!currentUser) { alert('请先登录'); return; }
    const file = fileEl.files[0];
    if (file.size > 5 * 1024 * 1024) {
      alert('图片大小不能超过 5MB');
      fileEl.value = '';
      return;
    }
    const fd = new FormData();
    fd.append('image', file);
    const uploadBtn = $('bgImageUploadBtn');
    if (uploadBtn) { uploadBtn.disabled = true; uploadBtn.textContent = '上传中...'; }
    fetch('/api/user/bg-image', { method: 'POST', body: fd })
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) {
          userBgImageUrl = d.data.url;
          const thumb = $('bgImageThumb');
          const empty = $('bgImageEmpty');
          const delBtn = $('bgImageDeleteBtn');
          if (thumb) { thumb.src = userBgImageUrl; thumb.classList.remove('hidden'); }
          if (empty) empty.classList.add('hidden');
          if (delBtn) delBtn.classList.remove('hidden');
          // 上传背景图后：文件浏览框自动透明，让背景图透出
          autoAdjustBoxOpacityForBgImage();
          applySettingsToBody(readSettings());
        } else {
          alert('上传失败：' + (d.message || '未知错误'));
        }
      })
      .catch((e) => alert('请求失败：' + e.message))
      .finally(() => {
        if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = '选择图片'; }
        if (fileEl) fileEl.value = '';
      });
  }

  function deleteBgImage() {
    if (!currentUser) return;
    if (!confirm('确定删除主页背景图？')) return;
    fetch('/api/user/bg-image', { method: 'DELETE' })
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) {
          clearUserBgImage();
        } else {
          alert('删除失败：' + (d.message || '未知错误'));
        }
      })
      .catch((e) => alert('请求失败：' + e.message));
  }

  function clearUserBgImage() {
    userBgImageUrl = null;
    const thumb = $('bgImageThumb');
    const empty = $('bgImageEmpty');
    const delBtn = $('bgImageDeleteBtn');
    if (thumb) thumb.classList.add('hidden');
    if (empty) empty.classList.remove('hidden');
    if (delBtn) delBtn.classList.add('hidden');
    // 删除背景图后：文件浏览框恢复不透明
    autoAdjustBoxOpacityForBgImage();
    applySettingsToBody(readSettings());
  }

  // 有背景图时自动设透明度=0；无背景图时恢复=1
  function autoAdjustBoxOpacityForBgImage() {
    const s = readSettings();
    if (userBgImageUrl) {
      // 有背景图：自动透明（仅当用户未明确自定义过非 0 值时也强制透明，让背景图透出）
      s.boxOpacity = '0';
    } else {
      // 无背景图：恢复不透明
      s.boxOpacity = '1';
    }
    writeSettings(s);
    // 同步 UI
    const boxOpacityEl = $('setBoxOpacity');
    if (boxOpacityEl) boxOpacityEl.value = s.boxOpacity;
    const boxOpacityValEl = $('boxOpacityVal');
    if (boxOpacityValEl) boxOpacityValEl.textContent = Math.round(parseFloat(s.boxOpacity) * 100) + '%';
  }

  // 持久化某个字段
  function persistSetting(key, value) {
    const s = readSettings();
    s[key] = value;
    writeSettings(s);
    applySettingsToBody(s);
  }

  // 反馈表单
  function submitFeedback() {
    const content = $('fbContent');
    const contact = $('fbContact');
    if (!content) return;
    const text = content.value.trim();
    if (!text) { alert('请填写反馈内容'); return; }
    const fd = new FormData();
    fd.append('content', text);
    if (contact && contact.value.trim()) fd.append('contact', contact.value.trim());
    const files = $('fbImages').files;
    for (let i = 0; i < files.length && i < 5; i++) fd.append('images', files[i]);
    const btn = $('fbSubmitBtn');
    btn.disabled = true;
    btn.textContent = '提交中...';
    fetch('/api/feedback', { method: 'POST', body: fd })
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) {
          alert('反馈已提交，感谢支持');
          content.value = '';
          if (contact) contact.value = '';
          $('fbImages').value = '';
          const cnt = $('fbContentCount');
          if (cnt) cnt.textContent = '0';
        } else {
          alert('提交失败：' + (d.message || '未知错误'));
        }
      })
      .catch((e) => alert('请求失败：' + e.message))
      .finally(() => {
        btn.disabled = false;
        btn.textContent = '提交反馈';
      });
  }

  // ============================================================
  // 第 2 期：用户认证 / 搜索历史 / 管理员用户列表
  // ============================================================

  // ====== 当前用户加载 + UI 同步 ======
  function loadCurrentUser(cb) {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) {
          setCurrentUser(d.data.user || null);
        }
      })
      .catch(() => {})
      .finally(() => cb && cb());
  }

  function setCurrentUser(u) {
    currentUser = u;
    updateAuthUI();
  }

  function updateAuthUI() {
    const loggedOut = $('authLoggedOut');
    const loggedIn = $('authLoggedIn');
    const userPrivateLabel = document.querySelector('.user-private-label');
    // 用户头像/用户名显示
    const avatarName = $('userAvatarName');
    if (currentUser) {
      if (loggedOut) loggedOut.classList.add('hidden');
      if (loggedIn) loggedIn.classList.remove('hidden');
      if (userPrivateLabel) userPrivateLabel.classList.remove('hidden');
      // 头像区显示用户名
      if (avatarName) {
        avatarName.textContent = currentUser.username;
        avatarName.classList.remove('user-avatar-unregistered');
      }
      // 填充信息
      if ($('userInfoName')) $('userInfoName').textContent = currentUser.username;
      if ($('userInfoEmail')) $('userInfoEmail').textContent = currentUser.email || '（未填写）';
      if ($('userInfoUsage')) $('userInfoUsage').textContent =
        currentUser.usedFormatted + ' / ' + currentUser.quotaFormatted;
      // 进度条
      const pct = currentUser.quotaBytes > 0
        ? Math.min(100, Math.round((currentUser.usedBytes / currentUser.quotaBytes) * 10000) / 100)
        : 0;
      const fill = $('userQuotaFill');
      if (fill) {
        fill.style.width = pct + '%';
        fill.className = 'quota-fill' + (pct >= 100 ? ' full' : (pct >= 80 ? ' warn' : ''));
      }
      if ($('userQuotaText')) $('userQuotaText').textContent =
        currentUser.usedFormatted + ' / ' + currentUser.quotaFormatted + ' (' + pct + '%)';
      const lockWarn = $('userLockWarn');
      if (lockWarn) lockWarn.classList.toggle('hidden', !currentUser.uploadLocked);
      // 改名输入框预填
      if ($('changeUsernameInput') && !$('changeUsernameInput').value) {
        $('changeUsernameInput').value = currentUser.username;
      }
      // 加载用户头像
      loadUserAvatar(currentUser.username);
      // 加载用户主页背景图
      loadUserBgImage();
      // 加载用户私密文件列表
      loadUserPrivateFiles();
      // 若当前在我的云盘 Tab，刷新列表
      if (currentTab === 'myfiles') loadMyFilesTab();
    } else {
      if (loggedOut) loggedOut.classList.remove('hidden');
      if (loggedIn) loggedIn.classList.add('hidden');
      if (userPrivateLabel) userPrivateLabel.classList.add('hidden');
      // 头像区显示"未注册"
      if (avatarName) {
        avatarName.textContent = '未注册';
        avatarName.classList.add('user-avatar-unregistered');
      }
      // 若当前选中的是 user-private，切回 public
      const upRadio = document.querySelector('input[name="visibility"][value="user-private"]');
      if (upRadio && upRadio.checked) {
        const pubRadio = document.querySelector('input[name="visibility"][value="public"]');
        if (pubRadio) pubRadio.checked = true;
      }
      // 清除用户背景图
      clearUserBgImage();
      // 清除头像显示
      applyAvatar(null);
    }
  }

  // ====== 认证面板事件 ======
  function bindAuthPanel() {
    const loginBtn = $('loginBtn');
    const showRegBtn = $('showRegisterBtn');
    const cancelRegBtn = $('cancelRegisterBtn');
    const regBtn = $('registerBtn');
    const logoutBtn = $('logoutBtn');
    const deleteBtn = $('deleteAccountBtn');
    const changePwdBtn = $('changePasswordBtn');
    const changeNameBtn = $('changeUsernameBtn');

    if (loginBtn) loginBtn.addEventListener('click', doLogin);
    if ($('loginPassword')) $('loginPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
    if (showRegBtn) showRegBtn.addEventListener('click', () => $('registerBox').classList.remove('hidden'));
    if (cancelRegBtn) cancelRegBtn.addEventListener('click', () => {
      $('registerBox').classList.add('hidden');
      ['regUsername', 'regPassword', 'regPassword2', 'regEmail'].forEach((id) => { const el = $(id); if (el) el.value = ''; });
    });
    if (regBtn) regBtn.addEventListener('click', doRegister);
    if (logoutBtn) logoutBtn.addEventListener('click', doLogout);
    if (deleteBtn) deleteBtn.addEventListener('click', doDeleteAccount);
    if (changePwdBtn) changePwdBtn.addEventListener('click', doChangePassword);
    if (changeNameBtn) changeNameBtn.addEventListener('click', doChangeUsername);
  }

  function doLogin() {
    const username = $('loginUsername').value.trim();
    const password = $('loginPassword').value;
    if (!username || !password) { alert('请输入用户名和密码'); return; }
    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) {
          $('loginPassword').value = '';
          loadCurrentUser(() => {
            alert('登录成功');
            // 刷新搜索历史
            loadSearchHistory();
          });
        } else {
          alert(d.message || '登录失败');
        }
      })
      .catch((e) => alert('请求失败：' + e.message));
  }

  function doRegister() {
    const username = $('regUsername').value.trim();
    const password = $('regPassword').value;
    const password2 = $('regPassword2').value;
    const email = $('regEmail').value.trim();
    if (!username || !password) { alert('请填写用户名和密码'); return; }
    if (password !== password2) { alert('两次密码不一致'); return; }
    fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, email })
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) {
          ['regUsername', 'regPassword', 'regPassword2', 'regEmail'].forEach((id) => { const el = $(id); if (el) el.value = ''; });
          $('registerBox').classList.add('hidden');
          loadCurrentUser(() => {
            alert('注册成功，已自动登录');
            loadSearchHistory();
          });
        } else {
          alert(d.message || '注册失败');
        }
      })
      .catch((e) => alert('请求失败：' + e.message));
  }

  function doLogout() {
    fetch('/api/auth/logout', { method: 'POST' })
      .then((r) => r.json())
      .then(() => {
        setCurrentUser(null);
        alert('已退出登录');
      })
      .catch(() => {
        setCurrentUser(null);
      });
  }

  function doDeleteAccount() {
    const pwd = prompt('注销账户将删除你的账户和所有私密文件，不可恢复。\n请输入密码确认：');
    if (pwd === null) return;
    fetch('/api/auth/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) {
          setCurrentUser(null);
          alert('账户已注销');
        } else {
          alert(d.message || '注销失败');
        }
      })
      .catch((e) => alert('请求失败：' + e.message));
  }

  function doChangePassword() {
    const oldPwd = $('oldPassword').value;
    const newPwd = $('newPassword').value;
    const newPwd2 = $('newPassword2').value;
    if (!oldPwd || !newPwd) { alert('请填写原密码和新密码'); return; }
    if (newPwd !== newPwd2) { alert('两次新密码不一致'); return; }
    if (newPwd.length < 6 || newPwd.length > 64) { alert('新密码长度需 6-64 位'); return; }
    fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd })
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) {
          $('oldPassword').value = '';
          $('newPassword').value = '';
          $('newPassword2').value = '';
          alert('密码已修改');
        } else {
          alert(d.message || '修改失败');
        }
      })
      .catch((e) => alert('请求失败：' + e.message));
  }

  function doChangeUsername() {
    const newUsername = $('changeUsernameInput').value.trim();
    if (!newUsername) { alert('请输入新用户名'); return; }
    if (newUsername === currentUser.username) { alert('用户名未变化'); return; }
    if (!confirm(`将用户名从「${currentUser.username}」改为「${newUsername}」？`)) return;
    fetch('/api/auth/change-username', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: newUsername })
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) {
          loadCurrentUser(() => alert('用户名已修改'));
        } else {
          alert(d.message || '修改失败');
        }
      })
      .catch((e) => alert('请求失败：' + e.message));
  }

  // ====== 搜索历史 ======
  let saveHistoryTimer = null;
  function saveSearchHistory(kw) {
    // 防抖：连续输入只存最后一次
    clearTimeout(saveHistoryTimer);
    saveHistoryTimer = setTimeout(() => {
      fetch('/api/user/search-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: kw })
      }).catch(() => {});
    }, 800);
  }

  function bindHistoryPanel() {
    const btn = $('historyToggleBtn');
    const panel = $('historyPanel');
    const clearBtn = $('clearHistoryBtn');
    if (!btn || !panel) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !panel.classList.contains('hidden');
      if (isOpen) {
        panel.classList.add('hidden');
      } else {
        panel.classList.remove('hidden');
        loadSearchHistory();
      }
    });
    if (clearBtn) clearBtn.addEventListener('click', () => {
      if (!currentUser) return;
      if (!confirm('清空所有搜索历史？')) return;
      fetch('/api/user/search-history/clear', { method: 'POST' })
        .then((r) => r.json())
        .then((d) => { if (d.code === 0) loadSearchHistory(); })
        .catch(() => {});
    });
    document.addEventListener('click', (e) => {
      if (panel.classList.contains('hidden')) return;
      if (!panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        panel.classList.add('hidden');
      }
    });
  }

  function loadSearchHistory() {
    const list = $('historyList');
    if (!list) return;
    if (!currentUser) {
      list.innerHTML = '<div class="dp-empty">登录后才会记录搜索历史</div>';
      return;
    }
    list.innerHTML = '<div class="dp-loading">加载中...</div>';
    fetch('/api/user/search-history', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.code !== 0) {
          list.innerHTML = '<div class="dp-empty">加载失败</div>';
          return;
        }
        const history = (d.data && d.data.history) || [];
        if (!history.length) {
          list.innerHTML = '<div class="dp-empty">暂无搜索历史</div>';
          return;
        }
        list.innerHTML = '';
        const frag = document.createDocumentFragment();
        history.forEach((h) => {
          const item = document.createElement('div');
          item.className = 'history-item';
          item.innerHTML = `<span>${escapeHtml(h.keyword)}</span>
            <span class="history-item-time">${new Date(h.created_at).toLocaleString('zh-CN')}</span>`;
          item.addEventListener('click', () => {
            searchInput.value = h.keyword;
            applyFilter();
            $('historyPanel').classList.add('hidden');
          });
          frag.appendChild(item);
        });
        list.appendChild(frag);
      })
      .catch(() => { list.innerHTML = '<div class="dp-empty">网络错误</div>'; });
  }

  // ====== 管理员：用户列表 ======
  function bindUserListView() {
    const listBtn = $('userListBtn');
    const backBtn = $('backFromUserListBtn');
    if (listBtn) listBtn.addEventListener('click', showUserListView);
    if (backBtn) backBtn.addEventListener('click', showAdminPanelView);
    // 停机通知
    const notifyBtn = $('notifyBtn');
    const backFromNotify = $('backFromNotifyBtn');
    const sendNotifyBtn = $('sendNotifyBtn');
    if (notifyBtn) notifyBtn.addEventListener('click', showNotifyView);
    if (backFromNotify) backFromNotify.addEventListener('click', showAdminPanelView);
    if (sendNotifyBtn) sendNotifyBtn.addEventListener('click', sendNotify);
  }

  function showUserListView() {
    $('adminPanel').classList.add('hidden');
    $('privateListView').classList.add('hidden');
    $('announcementAdminView').classList.add('hidden');
    $('notifyView').classList.add('hidden');
    $('userListView').classList.remove('hidden');
    loadUserList();
  }

  function showNotifyView() {
    $('adminPanel').classList.add('hidden');
    $('privateListView').classList.add('hidden');
    $('announcementAdminView').classList.add('hidden');
    $('userListView').classList.add('hidden');
    $('notifyView').classList.remove('hidden');
    loadNotifyInfo();
  }

  function loadNotifyInfo() {
    const status = $('notifyStatus');
    const hint = $('notifyRecipientHint');
    const sendBtn = $('sendNotifyBtn');
    if (status) status.className = 'notify-status';
    if (status) status.textContent = '加载中...';
    if (sendBtn) sendBtn.disabled = true;
    fetch(`/api/admin/notify/info?pwd=${encodeURIComponent(adminToken)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.code !== 0) {
          if (status) { status.className = 'notify-status err'; status.textContent = '加载失败'; }
          return;
        }
        const data = d.data;
        if (hint) hint.textContent = `将发送至 ${data.recipientCount} 位填写了邮箱的用户`;
        if (!data.smtpReady) {
          if (status) {
            status.className = 'notify-status warn';
            status.textContent = '⚠️ SMTP 未配置，无法发送邮件。请在服务端设置环境变量：SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS（并安装 nodemailer）。';
          }
          if (sendBtn) sendBtn.disabled = true;
        } else {
          if (status) {
            status.className = 'notify-status ok';
            status.textContent = `✓ 邮件服务就绪（发件人：${data.from}）。收件人 ${data.recipientCount} 位。`;
          }
          if (sendBtn) sendBtn.disabled = false;
        }
      })
      .catch(() => {
        if (status) { status.className = 'notify-status err'; status.textContent = '网络错误'; }
      });
  }

  function sendNotify() {
    const subjectEl = $('notifySubject');
    const textEl = $('notifyText');
    const status = $('notifyStatus');
    const sendBtn = $('sendNotifyBtn');
    const subject = subjectEl ? subjectEl.value.trim() : '';
    const text = textEl ? textEl.value.trim() : '';
    if (!subject) { alert('请填写主题'); return; }
    if (!text) { alert('请填写正文'); return; }
    if (!confirm(`确认向所有填写了邮箱的用户发送此通知？`)) return;
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '发送中...'; }
    fetch(`/api/admin/notify?pwd=${encodeURIComponent(adminToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, text })
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.code === 0) {
          if (status) { status.className = 'notify-status ok'; status.textContent = '✓ ' + d.message; }
          if (subjectEl) subjectEl.value = '';
          if (textEl) textEl.value = '';
        } else {
          if (status) { status.className = 'notify-status err'; status.textContent = '发送失败：' + (d.message || '未知错误'); }
        }
      })
      .catch((e) => {
        if (status) { status.className = 'notify-status err'; status.textContent = '请求失败：' + e.message; }
      })
      .finally(() => {
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '发送通知'; }
      });
  }

  function loadUserList() {
    if (!adminToken) return;
    const tbody = $('userTableBody');
    tbody.innerHTML = '<tr class="loading-row"><td colspan="6"><div class="loading"><div class="spinner"></div><span>加载中...</span></div></td></tr>';
    fetch(`/api/admin/users?pwd=${encodeURIComponent(adminToken)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.code !== 0) {
          tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#c92e2e;padding:20px;">加载失败</td></tr>`;
          return;
        }
        renderUserList(d.data.users || []);
      })
      .catch(() => {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#c92e2e;padding:20px;">网络错误</td></tr>`;
      });
  }

  function renderUserList(users) {
    const countBadge = $('userCountBadge');
    const empty = $('userListEmpty');
    const wrapper = $('userListWrapper');
    const tbody = $('userTableBody');
    countBadge.textContent = users.length;
    if (!users.length) {
      empty.classList.remove('hidden');
      wrapper.classList.add('hidden');
      tbody.innerHTML = '';
      return;
    }
    empty.classList.add('hidden');
    wrapper.classList.remove('hidden');
    tbody.innerHTML = '';
    const frag = document.createDocumentFragment();
    users.forEach((u, idx) => {
      const pct = u.usagePercent;
      const fillClass = pct >= 100 ? 'full' : (pct >= 80 ? 'warn' : '');
      const tr = document.createElement('tr');
      tr.className = 'file-row';
      tr.innerHTML = `
        <td class="col-idx">${idx + 1}</td>
        <td>
          <span class="file-name">${escapeHtml(u.username)}</span>
          ${u.isAdmin ? '<span class="user-admin-tag">管理员</span>' : ''}
          ${u.uploadLocked ? '<span class="user-locked-tag">已锁</span>' : ''}
        </td>
        <td><span class="file-realname mono">${escapeHtml(u.email || '—')}</span></td>
        <td class="user-quota-cell">
          <div class="quota-bar"><div class="quota-fill ${fillClass}" style="width:${pct}%"></div></div>
          <div class="quota-meta">
            <span>${escapeHtml(u.usedFormatted)}</span>
            <span>${escapeHtml(u.quotaFormatted)} · ${pct}%</span>
          </div>
        </td>
        <td class="col-time">${escapeHtml(u.createdAtFormatted)}</td>
        <td class="col-action">
          ${u.uploadLocked ? `<button class="btn-unlock" data-id="${u.id}" data-name="${escapeHtml(u.username)}">解锁</button>` : ''}
        </td>`;
      const unlockBtn = tr.querySelector('.btn-unlock');
      if (unlockBtn) {
        unlockBtn.addEventListener('click', function () {
          const id = this.dataset.id;
          const name = this.dataset.name;
          if (!confirm(`解锁用户「${name}」的上传通道？`)) return;
          fetch(`/api/admin/unlock-user?pwd=${encodeURIComponent(adminToken)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: parseInt(id, 10) })
          })
            .then((r) => r.json())
            .then((d) => {
              if (d.code === 0) loadUserList();
              else alert('解锁失败：' + (d.message || '未知错误'));
            })
            .catch((e) => alert('请求失败：' + e.message));
        });
      }
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
  }
})();
