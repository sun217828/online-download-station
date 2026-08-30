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
    loadUploadConfig(loadFiles);
    loadPendingCount();
    refreshAnnouncementDot();
    loadCurrentUser(); // 异步加载会话状态
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
        emptyState.querySelector('h3').textContent = '暂无文件';
        emptyState.querySelector('p').textContent = '等待管理员发布或前往「我要上传」分享文件';
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
        ? `<a href="javascript:void(0)" class="btn-preview" data-dirname="${escapeHtml(file.dirname)}" title="预览详情">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            <span>预览</span>
          </a>`
        : '';
      const tagsHtml = (file.tags && file.tags.length)
        ? `<div class="preview-tags-inline">${file.tags.map((t) => `<span class="tag-chip-sm">${escapeHtml(t)}</span>`).join('')}</div>`
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
            <a href="${downloadUrl}" class="btn-download" download title="点击下载 · 支持断点续传">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>下载</span>
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
            <span>正在读取文件列表...</span>
          </div>
        </td>
      </tr>`;
    fileCountBadge.textContent = '刷新中...';
    fileCountBadge.classList.add('badge-loading');
    fetch('/api/files', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        fileCountBadge.classList.remove('badge-loading');
        if (d.code === 0) {
          allFiles = d.data.files || [];
          fileCountBadge.textContent = `共 ${allFiles.length} 个文件`;
          populateFilterExt();
          applyFilter();
        } else {
          fileCountBadge.textContent = '加载失败';
          showErr(d.message || '加载失败');
        }
      })
      .catch((err) => {
        fileCountBadge.classList.remove('badge-loading');
        fileCountBadge.textContent = '网络错误';
        showErr('请求失败：' + err.message);
      });
  }

  function showErr(msg) {
    hideAllStates();
    fileTableBody.closest('.table-wrapper').classList.add('hidden');
    emptyState.classList.remove('hidden');
    emptyState.querySelector('h3').textContent = '加载出错';
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
    // 说明文档
    const descFileInput = $('descFileInput');
    const descFileBtn = $('descFileBtn');
    const descFileName = $('descFileName');
    const descFileClear = $('descFileClear');

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
    dropZone.addEventListener('click', () => fileInput.click());
    changeBtn.addEventListener('click', () => fileInput.click());

    // 说明文档选择
    if (descFileBtn) descFileBtn.addEventListener('click', () => descFileInput && descFileInput.click());
    if (descFileInput) descFileInput.addEventListener('change', function () {
      if (this.files && this.files.length > 0) {
        descFileName.textContent = this.files[0].name;
        descFileClear.classList.remove('hidden');
      } else {
        descFileName.textContent = '未选择（支持 .md / .txt / .doc / .pdf 等）';
        descFileClear.classList.add('hidden');
      }
    });
    if (descFileClear) descFileClear.addEventListener('click', () => {
      if (descFileInput) descFileInput.value = '';
      descFileName.textContent = '未选择（支持 .md / .txt / .doc / .pdf 等）';
      descFileClear.classList.add('hidden');
    });

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

    function handleFileSelected() {
      const f = fileInput.files[0];
      if (!f) {
        fileInfo.classList.add('hidden');
        return;
      }
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

    function checkReady() {
      const descOk = descInput.value.trim().length > 0;
      const fileOk = fileInput.files && fileInput.files.length > 0;
      const tagsOk = getSelectedUploadTags().length > 0;
      submitBtn.disabled = !(descOk && fileOk && tagsOk);
    }

    resetBtn.addEventListener('click', (e) => {
      setTimeout(() => {
        descCount.textContent = '0';
        dropZone.classList.remove('hidden');
        fileInfo.classList.add('hidden');
        progressBox.classList.add('hidden');
        resultBox.classList.add('hidden');
        submitBtn.disabled = true;
        pbFill.style.width = '0%';
        // 清标签 / 清说明文档
        clearUploadTags();
        if (descFileInput) descFileInput.value = '';
        if (descFileName) descFileName.textContent = '未选择（支持 .md / .txt / .doc / .pdf 等）';
        if (descFileClear) descFileClear.classList.add('hidden');
      }, 0);
    });

    // 上传提交
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const file = fileInput.files[0];
      const desc = descInput.value.replace(UNSAFE_REGEX, '').slice(0, MAX_DESC_LENGTH).trim();
      const tags = getSelectedUploadTags();
      if (!file || !desc) return;
      if (tags.length === 0) {
        alert('请至少选择一个文件标签');
        return;
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('description', desc);
      tags.forEach((t) => formData.append('tags', t));
      const visInput = document.querySelector('input[name="visibility"]:checked');
      formData.append('visibility', visInput ? visInput.value : 'public');
      // 说明文档
      if (descFileInput && descFileInput.files.length > 0) {
        formData.append('descFile', descFileInput.files[0]);
      }

      // XHR 做进度条
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');
      resultBox.classList.add('hidden');
      progressBox.classList.remove('hidden');
      submitBtn.disabled = true;
      let lastLoaded = 0;
      let lastTs = Date.now();
      let speed = 0;

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          const pct = Math.round((ev.loaded / ev.total) * 100);
          pbPercent.textContent = pct + '%';
          pbFill.style.width = pct + '%';
          const now = Date.now();
          const dt = now - lastTs;
          if (dt >= 500) {
            const dl = ev.loaded - lastLoaded;
            speed = (dl * 1000) / dt; // B/s
            pbSpeed.textContent = formatSize(speed) + '/s';
            const remainBytes = ev.total - ev.loaded;
            if (speed > 0) {
              const remainSec = Math.ceil(remainBytes / speed);
              pbRemain.textContent = formatTime(remainSec);
            } else {
              pbRemain.textContent = '-- 剩余';
            }
            lastLoaded = ev.loaded;
            lastTs = now;
          }
          if (pct === 100) {
            pbStatus.textContent = '服务器处理中...';
          } else {
            pbStatus.textContent = '上传中...';
          }
        }
      };

      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText || '{}'); } catch (e) { }
        if (xhr.status === 200 && data.code === 0) {
          pbStatus.textContent = '上传成功';
          resultBox.className = 'result-box result-ok';
          resultBox.classList.remove('hidden');
          resultBox.innerHTML = `
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <div class="rb-main">
              <strong>${escapeHtml(data.message || '上传成功')}</strong>
              <p>${escapeHtml((data.data || {}).pendingMessage || '文件已进入待审核区，等待管理员审核通过后发布')}</p>
              ${data.data && data.data.overSuggested ? `<p class="rb-warn">你上传的文件 ${escapeHtml(data.data.sizeFormatted)}，已超过建议大小，审核可能更慢。</p>` : ''}
            </div>`;
          submitBtn.disabled = true;
          loadPendingCount();
        } else {
          pbStatus.textContent = '上传失败';
          resultBox.className = 'result-box result-err';
          resultBox.classList.remove('hidden');
          resultBox.innerHTML = `
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
            <div class="rb-main">
              <strong>上传失败</strong>
              <p>${escapeHtml(data.message || '网络错误，请重试')}</p>
            </div>`;
          submitBtn.disabled = false;
        }
      };

      xhr.onerror = () => {
        pbStatus.textContent = '上传失败';
        resultBox.className = 'result-box result-err';
        resultBox.classList.remove('hidden');
        resultBox.innerHTML = `
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
          <div class="rb-main"><strong>网络错误</strong><p>请检查网络连接后重试</p></div>`;
        submitBtn.disabled = false;
      };

      xhr.send(formData);
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
      item.className = 'ann-item';
      const typeText = a.type === 'maintenance' ? '维护' : (a.type === 'release' ? '新版' : '普通');
      item.innerHTML = `
        <div class="ann-item-head">
          <span class="ann-item-title">${escapeHtml(a.title)}</span>
          <span class="ann-type-tag ann-type-${escapeHtml(a.type || 'normal')}">${typeText}</span>
        </div>
        <div class="ann-item-content">${escapeHtml(a.content)}</div>
        <div class="ann-item-time">${new Date(a.createdAt || 0).toLocaleString('zh-CN')}</div>`;
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
    if (langEl) langEl.addEventListener('change', () => persistSetting('lang', langEl.value));
    const fontSizeEl = $('setFontSize');
    if (fontSizeEl) fontSizeEl.addEventListener('change', () => persistSetting('fontSize', fontSizeEl.value));
    const fontFamilyEl = $('setFontFamily');
    if (fontFamilyEl) fontFamilyEl.addEventListener('change', () => persistSetting('fontFamily', fontFamilyEl.value));
    const bgColorEl = $('setBgColor');
    if (bgColorEl) bgColorEl.addEventListener('input', () => persistSetting('bgColor', bgColorEl.value));
    const showLinkEl = $('setShowLink');
    if (showLinkEl) showLinkEl.addEventListener('change', () => persistSetting('showLink', showLinkEl.checked));
    // 背景图模式
    const bgModeEl = $('setBgMode');
    if (bgModeEl) bgModeEl.addEventListener('change', () => persistSetting('bgMode', bgModeEl.value));
    // 文件浏览框透明度
    const boxOpacityEl = $('setBoxOpacity');
    if (boxOpacityEl) boxOpacityEl.addEventListener('input', () => {
      const val = boxOpacityEl.value;
      const valEl = $('boxOpacityVal');
      if (valEl) valEl.textContent = Math.round(parseFloat(val) * 100) + '%';
      persistSetting('boxOpacity', val);
    });
    // 文件浏览框颜色
    const boxColorEl = $('setBoxColor');
    if (boxColorEl) boxColorEl.addEventListener('input', () => persistSetting('boxColor', boxColorEl.value));
    const boxFollowEl = $('setBoxFollowBg');
    if (boxFollowEl) boxFollowEl.addEventListener('change', () => {
      persistSetting('boxFollowBg', boxFollowEl.checked);
      // 跟随时禁用颜色选择
      if (boxColorEl) boxColorEl.disabled = boxFollowEl.checked;
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
  function bindPreviewPage() {
    const backBtn = $('previewBackBtn');
    if (backBtn) backBtn.addEventListener('click', closePreview);
    // 浏览器后退键支持
    window.addEventListener('popstate', (e) => {
      const hash = window.location.hash || '';
      if (hash.startsWith('#preview/')) {
        const dirname = decodeURIComponent(hash.slice('#preview/'.length));
        loadPreview(dirname);
      } else {
        closePreview(true); // 不写 hash
      }
    });
    // 首次进入如有 hash 直接打开
    const hash = window.location.hash || '';
    if (hash.startsWith('#preview/')) {
      const dirname = decodeURIComponent(hash.slice('#preview/'.length));
      setTimeout(() => loadPreview(dirname), 50);
    }
  }

  function openPreview(dirname) {
    if (!dirname) return;
    const newHash = '#preview/' + encodeURIComponent(dirname);
    if (window.location.hash !== newHash) {
      window.location.hash = newHash; // 触发 popstate/loadPreview
      loadPreview(dirname);
    } else {
      loadPreview(dirname);
    }
  }

  function closePreview(skipHash) {
    const page = $('previewPage');
    if (page) page.classList.add('hidden');
    if (!skipHash && window.location.hash.startsWith('#preview/')) {
      // 清掉 hash 不触发刷新
      history.pushState('', document.title, window.location.pathname + window.location.search);
    }
  }

  function loadPreview(dirname) {
    const page = $('previewPage');
    if (!page) return;
    page.classList.remove('hidden');
    page.scrollTop = 0;
    // 滚动到顶
    document.body.scrollTop = 0;
    $('previewTitle').textContent = '加载中...';
    $('previewDoc').textContent = '（加载中...）';
    $('previewEntries').innerHTML = '';
    $('previewTags').innerHTML = '';
    $('previewExt').textContent = '';
    $('previewSize').textContent = '';
    $('previewTime').textContent = '';
    $('previewCover').innerHTML = '<div class="spinner"></div>';
    fetch('/api/preview/' + encodeURIComponent(dirname), { cache: 'no-store' })
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
    const fontSizeEl = $('setFontSize');
    if (fontSizeEl) fontSizeEl.value = s.fontSize || '14';
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
    if (boxOpacityEl2) boxOpacityEl2.value = s.boxOpacity || '1';
    const boxOpacityValEl = $('boxOpacityVal');
    if (boxOpacityValEl) boxOpacityValEl.textContent = Math.round(parseFloat(s.boxOpacity || 1) * 100) + '%';
    const boxColorEl2 = $('setBoxColor');
    if (boxColorEl2) boxColorEl2.value = s.boxColor || '#ffffff';
    const boxFollowEl2 = $('setBoxFollowBg');
    if (boxFollowEl2) {
      boxFollowEl2.checked = !!s.boxFollowBg;
      if (boxColorEl2) boxColorEl2.disabled = boxFollowEl2.checked;
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
    // 文件浏览框透明度/颜色（用 rgba 模拟，内容不透明）
    const boxOpacity = s.boxOpacity != null ? parseFloat(s.boxOpacity) : 1;
    const boxColor = s.boxFollowBg ? (s.bgColor || '#ffffff') : (s.boxColor || '#ffffff');
    const rgb = hexToRgb(boxColor);
    const rgba = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + boxOpacity + ')';
    document.querySelectorAll('#tab-downloads .table-wrapper, #tab-downloads .search-section').forEach((el) => {
      el.style.backgroundColor = rgba;
    });
  }

  // hex 转 rgb 数组
  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
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
    applySettingsToBody(readSettings());
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
    if (currentUser) {
      if (loggedOut) loggedOut.classList.add('hidden');
      if (loggedIn) loggedIn.classList.remove('hidden');
      if (userPrivateLabel) userPrivateLabel.classList.remove('hidden');
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
      // 加载用户主页背景图
      loadUserBgImage();
    } else {
      if (loggedOut) loggedOut.classList.remove('hidden');
      if (loggedIn) loggedIn.classList.add('hidden');
      if (userPrivateLabel) userPrivateLabel.classList.add('hidden');
      // 若当前选中的是 user-private，切回 public
      const upRadio = document.querySelector('input[name="visibility"][value="user-private"]');
      if (upRadio && upRadio.checked) {
        const pubRadio = document.querySelector('input[name="visibility"][value="public"]');
        if (pubRadio) pubRadio.checked = true;
      }
      // 清除用户背景图
      clearUserBgImage();
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
