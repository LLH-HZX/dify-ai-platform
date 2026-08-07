/**
 * 管理后台模块：工作流管理 / 账号管理 / 数据概览
 * 仅管理员调用（前端入口做了隔离，后端接口也强制 admin）
 * 依赖 window.API, window.showToast
 */
(function () {
  'use strict';

  var Admin = {
    allWorkflows: [],
    accounts: [],
    // 操作日志筛选状态
    auditLogs: [],        // 全量日志缓存
    auditUsername: '',    // 当前筛选的操作人
    auditAction: '',      // 当前筛选的动作

    // ── Tab 切换 ──
    switchTab: function (tab) {
      var tabs = document.querySelectorAll('.admin-tab');
      var panels = {
        workflows: document.getElementById('tab-workflows'),
        accounts: document.getElementById('tab-accounts'),
        dashboard: document.getElementById('tab-dashboard'),
        audit: document.getElementById('tab-audit'),
      };
      tabs.forEach(function (t) {
        t.classList.toggle('active', t.getAttribute('data-tab') === tab);
      });
      ['workflows', 'accounts', 'dashboard', 'audit'].forEach(function (k) {
        if (panels[k]) panels[k].hidden = (k !== tab);
      });

      if (tab === 'workflows') Admin.loadWorkflows();
      if (tab === 'accounts') Admin.loadAccounts();
      if (tab === 'dashboard') Admin.loadDashboard();
      if (tab === 'audit') Admin.loadAudit();
    },

    // ── 操作日志 ──
    loadAudit: async function () {
      try {
        var logs = await window.API.getAuditLogs();
        Admin.auditLogs = logs || [];
        populateAuditFilters();
        applyAuditFilter();
      } catch (e) {
        window.showToast(e.message);
      }
    },

    // ── 工作流管理 ──
    loadWorkflows: async function () {
      try {
        Admin.allWorkflows = await window.API.listAllWorkflows();
        renderWorkflowTable();
      } catch (e) {
        window.showToast(e.message);
      }
    },

    // ── 账号管理 ──
    loadAccounts: async function () {
      try {
        // 账号表单的权限复选框需要工作流列表，确保已加载
        if (!Admin.allWorkflows.length) {
          Admin.allWorkflows = await window.API.listAllWorkflows();
        }
        Admin.accounts = await window.API.listAccounts();
        renderAccountTable();
      } catch (e) {
        window.showToast(e.message);
      }
    },

    // ── 数据概览 ──
    loadDashboard: async function () {
      try {
        var stats = await window.API.getStats();
        document.getElementById('stat-workflows').textContent = stats.workflow_count;
        document.getElementById('stat-users').textContent = stats.user_count;
        document.getElementById('stat-admins').textContent = stats.admin_count;
        document.getElementById('stat-convs').textContent = stats.conversation_count;

        var recent = await window.API.getRecent();
        renderRecentTable(recent || []);
      } catch (e) {
        window.showToast(e.message);
      }
    },

  };

  // ═══════════════ 渲染工作流表格 ═══════════════
  function renderWorkflowTable() {
    var tbody = document.getElementById('wf-table-body');
    if (!Admin.allWorkflows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">暂无工作流</td></tr>';
      return;
    }
    tbody.innerHTML = Admin.allWorkflows.map(function (w) {
      var status = w.enabled ? '<span class="badge badge-green">启用</span>' : '<span class="badge badge-gray">停用</span>';
      return (
        '<tr>' +
          '<td>' + esc(w.name) + '</td>' +
          '<td>' + esc(w.type) + '</td>' +
          '<td>' + esc(w.category || '-') + '</td>' +
          '<td>' + status + '</td>' +
          '<td class="row-actions">' +
            '<button class="btn-sm btn-edit" onclick="window.Admin.editWorkflow(\'' + escAttr(w.id) + '\')">编辑</button>' +
            '<button class="btn-sm btn-danger" onclick="window.Admin.deleteWorkflow(\'' + escAttr(w.id) + '\')">删除</button>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function renderAccountTable() {
    var tbody = document.getElementById('acc-table-body');
    if (!Admin.accounts.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">暂无账号</td></tr>';
      return;
    }
    tbody.innerHTML = Admin.accounts.map(function (a) {
      var roleBadge = a.role === 'admin'
        ? '<span class="badge badge-blue">管理员</span>'
        : '<span class="badge badge-green">用户</span>';

      // 普通用户显示已授权工作流数量
      var permBadge = a.role === 'admin'
        ? '<span class="badge badge-gray">全部</span>'
        : '<span class="badge badge-green">' + (a.allowed_workflow_ids || []).length + ' 个</span>';

      var editBtn = '<button class="btn-sm btn-edit" onclick="window.Admin.editAccount(\'' + escAttr(a.username) + '\')">编辑</button>';
      var delBtn = a.username === 'admin'
        ? ''
        : '<button class="btn-sm btn-danger" onclick="window.Admin.deleteAccount(\'' + escAttr(a.username) + '\')">删除</button>';
      return (
        '<tr>' +
          '<td>' + esc(a.username) + '</td>' +
          '<td>' + roleBadge + '</td>' +
          '<td>' + permBadge + '</td>' +
          '<td class="row-actions">' + editBtn + delBtn + '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function renderRecentTable(recent) {
    var tbody = document.getElementById('recent-table-body');
    if (!recent.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">暂无对话记录</td></tr>';
      return;
    }
    // 构建 id → 名称 映射（工作流 ID 显示为名称，更友好）
    var wfNameMap = {};
    (Admin.allWorkflows || []).forEach(function (w) { if (w && w.id) wfNameMap[w.id] = w.name; });
    function displayWf(id) {
      if (!id) return '-';
      var name = wfNameMap[id];
      if (name) return esc(name);
      // 未知/未加载 → 降级为 ID 前 8 位，避免长串
      return esc(id.substring(0, 8) + '…');
    }
    tbody.innerHTML = recent.slice().reverse().map(function (r) {
      return (
        '<tr>' +
          '<td>' + esc(r.created_at || '-') + '</td>' +
          '<td>' + esc(r.username || '-') + '</td>' +
          '<td>' + displayWf(r.workflow_id) + '</td>' +
          '<td>' + esc((r.query || '').substring(0, 40)) + '</td>' +
        '</tr>'
      );
    }).join('');
  }

  // ── 操作日志筛选 ──
  function populateAuditFilters() {
    var userSel = document.getElementById('audit-filter-user');
    var actionSel = document.getElementById('audit-filter-action');
    if (!userSel || !actionSel) return;

    var users = [];
    var actions = [];
    Admin.auditLogs.forEach(function (l) {
      if (l.username && users.indexOf(l.username) === -1) users.push(l.username);
      if (l.action && actions.indexOf(l.action) === -1) actions.push(l.action);
    });

    // 保留当前选中值，重建选项
    var curUser = userSel.value;
    var curAction = actionSel.value;
    userSel.innerHTML = '<option value="">全部</option>' + users.map(function (u) {
      return '<option value="' + esc(u) + '">' + esc(u) + '</option>';
    }).join('');
    actionSel.innerHTML = '<option value="">全部</option>' + actions.map(function (a) {
      return '<option value="' + esc(a) + '">' + esc(a) + '</option>';
    }).join('');

    // 恢复选中（若该值仍存在）；否则归零
    if (curUser && users.indexOf(curUser) !== -1) userSel.value = curUser; else userSel.value = '';
    if (curAction && actions.indexOf(curAction) !== -1) actionSel.value = curAction; else actionSel.value = '';
    Admin.auditUsername = userSel.value;
    Admin.auditAction = actionSel.value;
  }

  function applyAuditFilter() {
    var userSel = document.getElementById('audit-filter-user');
    var actionSel = document.getElementById('audit-filter-action');
    if (userSel) Admin.auditUsername = userSel.value;
    if (actionSel) Admin.auditAction = actionSel.value;

    var filtered = Admin.auditLogs;
    if (Admin.auditUsername) {
      filtered = filtered.filter(function (l) { return l.username === Admin.auditUsername; });
    }
    if (Admin.auditAction) {
      filtered = filtered.filter(function (l) { return l.action === Admin.auditAction; });
    }
    renderAuditTable(filtered);
  }

  function resetAuditFilter() {
    var userSel = document.getElementById('audit-filter-user');
    var actionSel = document.getElementById('audit-filter-action');
    if (userSel) userSel.value = '';
    if (actionSel) actionSel.value = '';
    applyAuditFilter();
  }

  function renderAuditTable(logs) {
    var tbody = document.getElementById('audit-table-body');
    if (!tbody) return;
    if (!logs.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">暂无操作日志</td></tr>';
      return;
    }
    tbody.innerHTML = logs.map(function (l) {
      return (
        '<tr>' +
          '<td>' + esc(l.time || '-') + '</td>' +
          '<td>' + esc(l.username || '-') + '</td>' +
          '<td><span class="badge badge-blue">' + esc(l.action || '-') + '</span></td>' +
          '<td>' + esc(l.detail || '') + '</td>' +
        '</tr>'
      );
    }).join('');
  }

  // ═══════════════ 工作流增删改 ═══════════════
  Admin.showWorkflowForm = function (wf) {
    var wrap = document.getElementById('wf-form-wrap');
    wrap.hidden = false;
    document.getElementById('wf-form-title').textContent = wf ? '编辑工作流' : '新增工作流';
    document.getElementById('wf-id').value = wf ? wf.id : '';
    document.getElementById('wf-name').value = wf ? wf.name : '';
    document.getElementById('wf-icon').value = (wf && wf.icon) ? wf.icon : '';
    renderIconPreview();
    document.getElementById('wf-type').value = wf ? wf.type : 'chatflow';
    document.getElementById('wf-category').value = wf ? wf.category : '默认';
    document.getElementById('wf-desc').value = wf ? wf.description : '';
    document.getElementById('wf-apikey').value = wf ? (wf.apiKey || '') : '';
    document.getElementById('wf-baseurl').value = wf ? wf.baseUrl : '';
    document.getElementById('wf-iframeurl').value = wf ? wf.iframeUrl : '';
    document.getElementById('wf-enabled').checked = wf ? wf.enabled : true;
    // 输入字段编辑区：仅 workflow 类型显示
    var wfType = wf ? wf.type : 'chatflow';
    Admin._renderWorkflowInputFields(wf ? (wf.inputFields || []) : []);
    toggleWorkflowInputFields(wfType);
  };

  // 切换"输入字段配置"区的显隐
  function toggleWorkflowInputFields(type) {
    var wrap = document.getElementById('wf-inputfields-wrap');
    if (wrap) wrap.hidden = (type !== 'workflow');
  }

  // 渲染输入字段编辑器（每行：key / label / type / required / 删除）
  Admin._renderWorkflowInputFields = function (fields) {
    var list = document.getElementById('wf-inputfields-list');
    if (!list) return;
    list.innerHTML = '';
    fields.forEach(function (f, i) { Admin._addWorkflowInputFieldRow(f, i); });
  };

  Admin._addWorkflowInputFieldRow = function (f, index) {
    var list = document.getElementById('wf-inputfields-list');
    if (!list) return;
    var row = document.createElement('div');
    row.className = 'wf-field-row';
    row.setAttribute('data-index', index == null ? list.children.length : index);
    row.innerHTML =
      '<input class="wf-field-key" placeholder="字段名(key)" value="' + escAttr((f && f.key) || '') + '" />' +
      '<input class="wf-field-label" placeholder="显示名" value="' + escAttr((f && f.label) || '') + '" />' +
      '<select class="wf-field-type">' +
        '<option value="text"' + (f && f.type === 'text' ? ' selected' : '') + '>文本</option>' +
        '<option value="number"' + (f && f.type === 'number' ? ' selected' : '') + '>数字</option>' +
        '<option value="file"' + (f && f.type === 'file' ? ' selected' : '') + '>文件</option>' +
      '</select>' +
      '<label class="wf-field-required"><input type="checkbox"' + (f && f.required ? ' checked' : '') + ' /> 必填</label>' +
      '<button type="button" class="wf-field-del">×</button>';
    row.querySelector('.wf-field-del').addEventListener('click', function () {
      row.remove();
    });
    list.appendChild(row);
  };

  // 从编辑器收集输入字段
  function collectWorkflowInputFields() {
    var fields = [];
    document.querySelectorAll('#wf-inputfields-list .wf-field-row').forEach(function (row) {
      var key = row.querySelector('.wf-field-key').value.trim();
      if (!key) return;
      fields.push({
        key: key,
        label: row.querySelector('.wf-field-label').value.trim() || key,
        type: row.querySelector('.wf-field-type').value,
        required: row.querySelector('.wf-field-required input').checked,
      });
    });
    return fields;
  }

  // 回显工作流图标预览
  function renderIconPreview() {
    var url = document.getElementById('wf-icon').value;
    var preview = document.getElementById('wf-icon-preview');
    var clearBtn = document.getElementById('wf-icon-clear');
    if (!preview) return;
    if (url) {
      var full = (window.API && window.API.resolveUrl) ? window.API.resolveUrl(url) : url;
      preview.innerHTML = '<img src="' + escAttr(full) + '" alt="icon" onerror="this.parentNode.innerHTML=\'<span class=wf-icon-placeholder>无</span>\'" />';
      if (clearBtn) clearBtn.hidden = false;
    } else {
      preview.innerHTML = '<span class="wf-icon-placeholder">未选择</span>';
      if (clearBtn) clearBtn.hidden = true;
    }
  }

  // 选择图标文件并上传
  function handleIconFileChange(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      window.showToast('仅支持 png/jpeg/gif/webp 图片');
      input.value = '';
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      window.showToast('图标不能超过 3MB');
      input.value = '';
      return;
    }
    window.showToast('正在上传图标...');
    window.API.uploadIcon(file).then(function (data) {
      document.getElementById('wf-icon').value = data.url || '';
      renderIconPreview();
      window.showToast('图标已上传');
      input.value = '';
    }).catch(function (err) {
      window.showToast(err.message || '上传失败');
      input.value = '';
    });
  }

  Admin.editWorkflow = function (id) {
    var wf = Admin.allWorkflows.find(function (w) { return w.id === id; });
    if (wf) Admin.showWorkflowForm(wf);
  };

  Admin.deleteWorkflow = async function (id) {
    if (!confirm('确定删除该工作流吗？')) return;
    try {
      await window.API.deleteWorkflow(id);
      window.showToast('已删除');
      Admin.loadWorkflows();
    } catch (e) {
      window.showToast(e.message);
    }
  };

  // 保存工作流表单
  function submitWorkflowForm(e) {
    e.preventDefault();
    var id = document.getElementById('wf-id').value;
    var payload = {
      name: document.getElementById('wf-name').value.trim(),
      icon: document.getElementById('wf-icon').value.trim(),
      type: document.getElementById('wf-type').value,
      category: document.getElementById('wf-category').value.trim() || '默认',
      description: document.getElementById('wf-desc').value.trim(),
      apiKey: document.getElementById('wf-apikey').value.trim(),
      baseUrl: document.getElementById('wf-baseurl').value.trim(),
      iframeUrl: document.getElementById('wf-iframeurl').value.trim(),
      enabled: document.getElementById('wf-enabled').checked,
    };
    if (payload.type === 'workflow') {
      payload.inputFields = collectWorkflowInputFields();
    }
    if (!payload.name) { window.showToast('请输入名称'); return; }

    var promise = id ? window.API.updateWorkflow(id, payload) : window.API.createWorkflow(payload);
    promise.then(function () {
      window.showToast('保存成功');
      document.getElementById('wf-form-wrap').hidden = true;
      Admin.loadWorkflows();
    }).catch(function (e) {
      window.showToast(e.message);
    });
  }

  // ═══════════════ 账号增删改 ═══════════════

  // 渲染"可用工作流"复选框列表（用于账号表单），按对话流/工作流分组
  function renderWorkflowCheckboxes() {
    var wrap = document.getElementById('acc-workflow-list');
    if (!wrap) return;
    var wfs = Admin.allWorkflows || [];
    if (!wfs.length) {
      wrap.innerHTML = '<p class="empty-tip" style="font-size:0.85rem;">暂无工作流，请先在「工作流管理」中新增。</p>';
      return;
    }
    // 按类型分组
    var groups = { chatflow: [], workflow: [], agent: [] };
    wfs.forEach(function (w) {
      var t = (w.type || 'chatflow');
      if (t === 'workflow' || t === 'agent') groups[t].push(w);
      else groups.chatflow.push(w);
    });
    var html = '';
    var typeMeta = [
      { key: 'chatflow', title: '对话流' },
      { key: 'workflow', title: '工作流' },
      { key: 'agent', title: '智能体' },
    ];
    typeMeta.forEach(function (g) {
      var items = groups[g.key];
      if (!items.length) return;
      html += '<div class="acc-wf-group"><div class="acc-wf-group-title">' + g.title + '</div>';
      html += items.map(function (w) {
        return (
          '<label class="wf-check">' +
            '<input type="checkbox" value="' + escAttr(w.id) + '" />' +
            '<span>' + esc(w.name) + '</span>' +
          '</label>'
        );
      }).join('');
      html += '</div>';
    });
    wrap.innerHTML = html;
  }

  // 读取当前勾选的工作流 id 列表
  function readCheckedWorkflows() {
    var boxes = document.querySelectorAll('#acc-workflow-list input[type="checkbox"]');
    var ids = [];
    boxes.forEach(function (b) {
      if (b.checked) ids.push(b.value);
    });
    return ids;
  }

  // 打开账号表单（新增或编辑）
  Admin.showAccountForm = function (account) {
    var isEdit = !!account;
    var wrap = document.getElementById('acc-form-wrap');
    wrap.hidden = false;

    document.getElementById('acc-form-title').textContent = isEdit ? '编辑账号：' + account.username : '添加账号';
    document.getElementById('acc-username').value = account ? account.username : '';
    document.getElementById('acc-username').disabled = !!account; // 编辑时用户名不可改
    document.getElementById('acc-password').value = '';
    document.getElementById('acc-password').required = !account; // 编辑时密码可留空表示不修改
    document.getElementById('acc-password').placeholder = account ? '留空表示不修改密码' : '';
    var pwdLabel = document.getElementById('acc-password-label');
    if (pwdLabel) pwdLabel.textContent = account ? '密码（留空不修改）' : '密码 *';
    document.getElementById('acc-role').value = account ? account.role : 'user';

    // 渲染工作流复选框并回显已授权项
    renderWorkflowCheckboxes();
    var allowed = (account && account.allowed_workflow_ids) || [];
    document.querySelectorAll('#acc-workflow-list input[type="checkbox"]').forEach(function (b) {
      b.checked = allowed.indexOf(b.value) >= 0;
    });

    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  Admin.editAccount = function (username) {
    var acc = Admin.accounts.find(function (a) { return a.username === username; });
    if (acc) Admin.showAccountForm(acc);
  };

  Admin.deleteAccount = async function (username) {
    if (!confirm('确定删除账号 ' + username + ' 吗？')) return;
    try {
      await window.API.deleteAccount(username);
      window.showToast('已删除');
      Admin.loadAccounts();
    } catch (e) {
      window.showToast(e.message);
    }
  };

  function submitAccountForm(e) {
    e.preventDefault();
    var username = document.getElementById('acc-username').value.trim();
    var isEdit = !!document.getElementById('acc-username').disabled;
    var payload = {
      role: document.getElementById('acc-role').value,
      allowed_workflow_ids: readCheckedWorkflows(),
    };

    if (!isEdit) {
      payload.username = username;
      payload.password = document.getElementById('acc-password').value;
      if (!payload.username || !payload.password) { window.showToast('请填写用户名和密码'); return; }
    } else {
      var pwd = document.getElementById('acc-password').value;
      if (pwd) payload.password = pwd;
    }

    var promise = isEdit
      ? window.API.updateAccount(username, payload)
      : window.API.createAccount(payload);
    promise.then(function () {
      window.showToast(isEdit ? '保存成功' : '添加成功');
      document.getElementById('acc-form-wrap').hidden = true;
      document.getElementById('acc-form').reset();
      document.getElementById('acc-username').disabled = false;
      Admin.loadAccounts();
    }).catch(function (err) {
      window.showToast(err.message);
    });
  }

  // ═══════════════ 初始化 ═══════════════
  Admin.init = function () {
    // Tab 切换
    document.querySelectorAll('.admin-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        Admin.switchTab(btn.getAttribute('data-tab'));
      });
    });

    // 工作流表单
    document.getElementById('wf-add-btn').addEventListener('click', function () {
      Admin.showWorkflowForm(null);
    });
    document.getElementById('wf-form').addEventListener('submit', submitWorkflowForm);
    document.getElementById('wf-form-cancel').addEventListener('click', function () {
      document.getElementById('wf-form-wrap').hidden = true;
    });
    // workflow 输入字段：切换显隐 + 添加字段
    document.getElementById('wf-type').addEventListener('change', function () {
      toggleWorkflowInputFields(this.value);
    });
    document.getElementById('wf-inputfield-add').addEventListener('click', function () {
      Admin._addWorkflowInputFieldRow(null);
    });
    // 图标上传 / 清除
    document.getElementById('wf-icon-file').addEventListener('change', function () {
      handleIconFileChange(this);
    });
    document.getElementById('wf-icon-clear').addEventListener('click', function () {
      document.getElementById('wf-icon').value = '';
      renderIconPreview();
    });

    // 账号表单
    document.getElementById('acc-add-btn').addEventListener('click', function () {
      document.getElementById('acc-username').disabled = false;
      document.getElementById('acc-password').required = true;
      document.getElementById('acc-password').placeholder = '';
      Admin.showAccountForm(null);
    });
    document.getElementById('acc-form').addEventListener('submit', submitAccountForm);
    document.getElementById('acc-form-cancel').addEventListener('click', function () {
      document.getElementById('acc-form-wrap').hidden = true;
      document.getElementById('acc-form').reset();
      document.getElementById('acc-username').disabled = false;
    });

    // 操作日志刷新
    var auditRefreshBtn = document.getElementById('audit-refresh-btn');
    if (auditRefreshBtn) auditRefreshBtn.addEventListener('click', Admin.loadAudit);

    // 操作日志筛选：change 时应用筛选，重置时清空
    var auditUserSel = document.getElementById('audit-filter-user');
    var auditActionSel = document.getElementById('audit-filter-action');
    var auditResetBtn = document.getElementById('audit-filter-reset');
    if (auditUserSel) auditUserSel.addEventListener('change', applyAuditFilter);
    if (auditActionSel) auditActionSel.addEventListener('change', applyAuditFilter);
    if (auditResetBtn) auditResetBtn.addEventListener('click', resetAuditFilter);
  };

  // ═══════════════ 工具 ═══════════════
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escAttr(str) { return esc(str); }

  window.Admin = Admin;
})();
