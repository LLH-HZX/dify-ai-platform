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
    knowledgeBases: [],

    // ── Tab 切换 ──
    switchTab: function (tab) {
      var tabs = document.querySelectorAll('.admin-tab');
      var panels = {
        workflows: document.getElementById('tab-workflows'),
        accounts: document.getElementById('tab-accounts'),
        dashboard: document.getElementById('tab-dashboard'),
        knowledge: document.getElementById('tab-knowledge'),
        audit: document.getElementById('tab-audit'),
      };
      tabs.forEach(function (t) {
        t.classList.toggle('active', t.getAttribute('data-tab') === tab);
      });
      ['workflows', 'accounts', 'dashboard', 'knowledge', 'audit'].forEach(function (k) {
        if (panels[k]) panels[k].hidden = (k !== tab);
      });

      if (tab === 'workflows') Admin.loadWorkflows();
      if (tab === 'accounts') Admin.loadAccounts();
      if (tab === 'dashboard') Admin.loadDashboard();
      if (tab === 'knowledge') Admin.loadKnowledge();
      if (tab === 'audit') Admin.loadAudit();
    },

    // ── 操作日志 ──
    loadAudit: async function () {
      try {
        var logs = await window.API.getAuditLogs();
        renderAuditTable(logs || []);
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

    // ── 知识库管理（多知识库实体，每条自带 RAGFlow 地址/Key，有归属） ──
    loadKnowledge: async function () {
      try {
        Admin.knowledgeBases = await window.API.listKnowledgeBases();
        renderKnowledgeTable();
      } catch (e) {
        window.showToast(e.message);
      }
    },

    showKnowledgeForm: function (kb) {
      var isEdit = !!kb;
      var wrap = document.getElementById('kb-form-wrap');
      wrap.hidden = false;
      document.getElementById('kb-form-title').textContent = isEdit ? '编辑知识库' : '添加知识库';
      document.getElementById('kb-id').value = kb ? kb.id : '';
      document.getElementById('kb-name').value = kb ? kb.name : '';
      document.getElementById('kb-baseurl').value = kb ? kb.baseUrl : '';
      // apiKey 不回显，编辑时留空表示不修改
      document.getElementById('kb-apikey').value = '';
      document.getElementById('kb-apikey').required = !isEdit;
      wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    submitKnowledgeForm: async function (e) {
      e.preventDefault();
      var id = document.getElementById('kb-id').value;
      var payload = {
        name: document.getElementById('kb-name').value.trim(),
        baseUrl: document.getElementById('kb-baseurl').value.trim(),
        apiKey: document.getElementById('kb-apikey').value.trim(),
      };
      if (!payload.name) { window.showToast('请输入知识库名称'); return; }
      if (!payload.baseUrl) { window.showToast('请输入 RAGFlow 服务地址'); return; }
      if (!id && !payload.apiKey) { window.showToast('请输入 API Key'); return; }
      try {
        if (id) {
          await window.API.updateKnowledgeBase(id, payload);
          window.showToast('保存成功');
        } else {
          await window.API.createKnowledgeBase(payload);
          window.showToast('添加成功');
        }
        document.getElementById('kb-form-wrap').hidden = true;
        document.getElementById('kb-form').reset();
        Admin.loadKnowledge();
      } catch (err) {
        window.showToast(err.message);
      }
    },

    deleteKnowledgeBase: async function (kb) {
      if (!confirm('确定删除知识库「' + (kb.name || kb.id) + '」吗？\n若该知识库正被工作流使用，将被阻止删除。')) return;
      try {
        await window.API.deleteKnowledgeBase(kb.id);
        window.showToast('已删除知识库');
        Admin.loadKnowledge();
      } catch (e) {
        window.showToast(e.message);
      }
    },

    editKnowledgeBase: function (id) {
      var kb = Admin.knowledgeBases.find(function (b) { return b.id === id; });
      if (kb) Admin.showKnowledgeForm(kb);
    },

    deleteKnowledgeBaseById: function (id) {
      var kb = Admin.knowledgeBases.find(function (b) { return b.id === id; });
      if (kb) Admin.deleteKnowledgeBase(kb);
    },

    testKnowledgeForm: async function () {
      var baseUrl = document.getElementById('kb-baseurl').value.trim();
      var apiKey = document.getElementById('kb-apikey').value.trim();
      var resultEl = document.getElementById('kb-test-result');
      if (!resultEl) return;
      if (!baseUrl || !apiKey) {
        resultEl.className = 'kb-test-result fail';
        resultEl.textContent = '请先填写 RAGFlow 服务地址和 API Key';
        return;
      }
      resultEl.className = 'kb-test-result';
      resultEl.textContent = '测试中…';
      try {
        var res = await window.API.testKnowledgeBase({ baseUrl: baseUrl, apiKey: apiKey });
        if (res && res.connected) {
          var names = (res.datasets || []).map(function (d) { return d.name || d.id; });
          resultEl.className = 'kb-test-result ok';
          resultEl.textContent = '✓ 连接成功，共 ' + (names.length) + ' 个数据集' +
            (names.length ? '：' + names.slice(0, 3).join('、') + (names.length > 3 ? ' 等' : '') : '');
        } else {
          resultEl.className = 'kb-test-result fail';
          resultEl.textContent = '✗ ' + (res && res.message) || '连接失败';
        }
      } catch (e) {
        resultEl.className = 'kb-test-result fail';
        resultEl.textContent = '✗ ' + e.message;
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
          '<td>' + esc(w.icon || '🤖') + ' ' + esc(w.name) + '</td>' +
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
    tbody.innerHTML = recent.slice().reverse().map(function (r) {
      return (
        '<tr>' +
          '<td>' + esc(r.created_at || '-') + '</td>' +
          '<td>' + esc(r.username || '-') + '</td>' +
          '<td>' + esc(r.workflow_id || '-') + '</td>' +
          '<td>' + esc((r.query || '').substring(0, 40)) + '</td>' +
        '</tr>'
      );
    }).join('');
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

  // ═══════════════ 渲染知识库实体列表（管理页，带归属与操作） ═══════════════
  function renderKnowledgeTable() {
    var tbody = document.getElementById('kb-table-body');
    if (!tbody) return;
    if (!Admin.knowledgeBases.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">暂无知识库，点击右上角「添加知识库」创建</td></tr>';
      return;
    }
    var me = window.Auth && window.Auth.user ? window.Auth.user.username : '';
    tbody.innerHTML = Admin.knowledgeBases.map(function (b) {
      var isOwner = b.owner === me;
      var actions;
      if (isOwner) {
        actions =
          '<button class="btn-sm btn-edit" data-kb-action="edit" data-kb-id="' + escAttr(b.id) + '">编辑</button>' +
          '<button class="btn-sm btn-danger" data-kb-action="delete" data-kb-id="' + escAttr(b.id) + '">删除</button>';
      } else {
        actions = '<span style="color:#9CA3AF;font-size:0.8rem;">仅归属人可操作</span>';
      }
      var ownerBadge = '<span class="badge ' + (isOwner ? 'badge-green' : 'badge-gray') + '">' + esc(b.owner || '-') + (isOwner ? '（我）' : '') + '</span>';
      return (
        '<tr>' +
          '<td>' + esc(b.name || b.id) + '</td>' +
          '<td>' + esc(b.baseUrl || '-') + '</td>' +
          '<td>' + ownerBadge + '</td>' +
          '<td class="row-actions">' + actions + '</td>' +
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
    document.getElementById('wf-icon').value = wf ? wf.icon : '🤖';
    document.getElementById('wf-type').value = wf ? wf.type : 'chatflow';
    document.getElementById('wf-category').value = wf ? wf.category : '默认';
    document.getElementById('wf-desc').value = wf ? wf.description : '';
    document.getElementById('wf-apikey').value = wf ? (wf.apiKey || '') : '';
    document.getElementById('wf-baseurl').value = wf ? wf.baseUrl : '';
    document.getElementById('wf-iframeurl').value = wf ? wf.iframeUrl : '';
    document.getElementById('wf-enabled').checked = wf ? wf.enabled : true;
    document.getElementById('wf-ragenabled').checked = wf ? !!wf.ragEnabled : false;
    document.getElementById('wf-ragtopk').value = wf ? (wf.ragTopK || 3) : 3;
    document.getElementById('wf-ragcontextvar').value = wf ? (wf.ragContextVar || 'context') : 'context';
    // 加载知识库列表并回显已绑定项（优先文件级 ragBindings，兼容旧 ragDatasetIds）
    Admin.loadWorkflowDatasets(wf ? (wf.ragBindings || wf.ragDatasetIds || []) : []);
  };

  // 加载知识库实体列表到工作流表单（可展开 → 勾选知识库/数据集，整库绑定）
  // prev: 数组。可为整库绑定 [{baseId,datasetId,documentIds:[]}]，或兼容旧数据 [知识库实体id字符串]
  Admin.loadWorkflowDatasets = async function (prev) {
    var wrap = document.getElementById('wf-ragdatasets-list');
    if (!wrap) {
      wrap.innerHTML = '<p class="empty-tip" style="font-size:0.85rem;">当前工作流表单不可用</p>';
      return;
    }
    var loading = document.getElementById('wf-ragdatasets-loading');
    if (loading) loading.textContent = '加载知识库中...';
    try {
      var bases = await window.API.listKnowledgeBases();
      wrap.classList.add('wf-check-list');
      if (!bases || !bases.length) {
        wrap.innerHTML = '<p class="empty-tip" style="font-size:0.85rem;">' +
          '暂无知识库，请先在「知识库管理」中添加需要绑定的知识库。</p>';
        return;
      }
      // 预处理 prev：归一化为按 baseId 索引，收集已绑定的数据集 id 列表
      var prevMap = {};  // baseId -> { datasetIds: [] }
      (prev || []).forEach(function (p) {
        if (p && typeof p === 'object') {
          if (!prevMap[p.baseId]) prevMap[p.baseId] = { datasetIds: [] };
          if (p.datasetId) prevMap[p.baseId].datasetIds.push(p.datasetId);
        } else {
          // 兼容旧数据：整库（旧 ragDatasetIds）绑定，回显时置空数组（不预勾选数据集，避免误绑）
          if (!prevMap[p]) prevMap[p] = { datasetIds: [] };
        }
      });
      wrap.innerHTML = bases.map(function (b) {
        var p = prevMap[b.id];
        var open = !!(p && p.datasetIds && p.datasetIds.length);
        return (
          '<div class="kb-node' + (open ? ' open' : '') + '" data-base-id="' + escAttr(b.id) + '" data-base-name="' + escAttr(b.name || b.id) + '">' +
            '<div class="kb-node-header">' +
              '<span class="kb-node-arrow">▶</span>' +
              '<span class="kb-node-title">' + esc(b.name || b.id) + '</span>' +
              '<span class="kb-file-count">选择知识库</span>' +
            '</div>' +
            '<div class="kb-node-body"' + (open ? '' : ' hidden') + '>' +
              '<p class="kb-node-empty">加载知识库…</p>' +
            '</div>' +
          '</div>'
        );
      }).join('');

      // 展开所有需要回显的知识库节点（已绑定数据集）
      bases.forEach(function (b) {
        var node = wrap.querySelector('.kb-node[data-base-id="' + b.id + '"]');
        if (!node) return;
        var p = prevMap[b.id];
        if (p && p.datasetIds && p.datasetIds.length) {
          openBaseNode(node, b, { datasetIds: p.datasetIds });
        }
      });
    } catch (e) {
      wrap.innerHTML = '<p class="empty-tip" style="font-size:0.85rem;">加载知识库失败：' + esc(e.message) + '</p>';
    }
  };

  // 展开某个知识库节点：拉取数据集，渲染数据集复选框（整库绑定）
  async function openBaseNode(node, base, preselect) {
    var body = node.querySelector('.kb-node-body');
    var countEl = node.querySelector('.kb-file-count');
    node.classList.add('open');
    body.hidden = false;

    // 已有内容则不重复拉取（除非需要回显）
    if (body.dataset.loaded && !preselect) return;

    body.innerHTML = '<p class="kb-node-empty">加载知识库…</p>';
    var datasets = [];
    try {
      var res = await window.API.listBaseDatasets(base.id);
      datasets = (res && res.datasets) || [];
      if (!datasets || !datasets.length) {
        body.innerHTML = '<p class="kb-node-empty">该服务器下没有知识库，或连接失败：' + esc((res && res.message) || '') + '</p>';
        body.dataset.loaded = '1';
        countEl.textContent = '无知识库';
        return;
      }
    } catch (e) {
      body.innerHTML = '<p class="kb-node-empty">加载知识库失败：' + esc(e.message) + '</p>';
      body.dataset.loaded = '1';
      return;
    }

    // 已勾选的数据集 id（回显用）
    var pre = preselect && preselect.datasetIds ? preselect.datasetIds.map(String) : [];

    // 渲染数据集复选框列表：勾选 = 整库绑定
    body.innerHTML = datasets.map(function (d) {
      var checked = pre.indexOf(String(d.id)) >= 0 ? ' checked' : '';
      return (
        '<label class="kb-dataset-check">' +
          '<input type="checkbox" class="kb-dataset-cb" value="' + escAttr(d.id) + '"' + checked + ' />' +
          '<span title="' + escAttr(d.name || d.id) + '">' + esc(d.name || d.id) + '</span>' +
        '</label>'
      );
    }).join('');
    body.dataset.loaded = '1';

    // 勾选/取消时更新该服务器已选知识库数
    body.addEventListener('change', function (ev) {
      if (ev.target.classList && ev.target.classList.contains('kb-dataset-cb')) {
        updateDatasetCount(countEl, body);
      }
    });
    updateDatasetCount(countEl, body);
  }

  // 更新某服务器节点已选知识库数
  function updateDatasetCount(countEl, body) {
    var n = body.querySelectorAll('.kb-dataset-cb:checked').length;
    countEl.textContent = n ? (n + ' 个知识库') : '选择知识库';
  }

  // 读取工作流表单勾选的知识库绑定（整库绑定结构）
  // 返回 [{ baseId, datasetId, documentIds: [] }]，documentIds 为空表示整库检索
  function readCheckedWorkflowDatasets() {
    var bindings = [];
    document.querySelectorAll('#wf-ragdatasets-list .kb-node').forEach(function (node) {
      var baseId = node.getAttribute('data-base-id');
      var body = node.querySelector('.kb-node-body');
      if (!body) return;
      body.querySelectorAll('.kb-dataset-cb:checked').forEach(function (cb) {
        bindings.push({ baseId: baseId, datasetId: cb.value, documentIds: [] });
      });
    });
    return bindings;
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
    var ragEnabled = document.getElementById('wf-ragenabled').checked;
    var ragBindings = readCheckedWorkflowDatasets();
    var payload = {
      name: document.getElementById('wf-name').value.trim(),
      icon: document.getElementById('wf-icon').value.trim() || '🤖',
      type: document.getElementById('wf-type').value,
      category: document.getElementById('wf-category').value.trim() || '默认',
      description: document.getElementById('wf-desc').value.trim(),
      apiKey: document.getElementById('wf-apikey').value.trim(),
      baseUrl: document.getElementById('wf-baseurl').value.trim(),
      iframeUrl: document.getElementById('wf-iframeurl').value.trim(),
      enabled: document.getElementById('wf-enabled').checked,
      ragEnabled: ragEnabled,
      ragBindings: ragBindings,
      ragDatasetIds: [],
      ragTopK: parseInt(document.getElementById('wf-ragtopk').value, 10) || 3,
      ragContextVar: document.getElementById('wf-ragcontextvar').value.trim() || 'context',
    };
    if (!payload.name) { window.showToast('请输入名称'); return; }
    if (ragEnabled && !ragBindings.length) {
      // 提示而非阻断：防止用户误以为已勾选知识库却保存成"无绑定"，从而出现"无知识库"困惑
      window.showToast('已启用知识库检索，但未绑定任何知识库。如需整库检索，请展开知识库→勾选一个或多个知识库。');
    }

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

  // 渲染"可用工作流"复选框列表（用于账号表单）
  function renderWorkflowCheckboxes() {
    var wrap = document.getElementById('acc-workflow-list');
    if (!wrap) return;
    var wfs = Admin.allWorkflows || [];
    if (!wfs.length) {
      wrap.innerHTML = '<p class="empty-tip" style="font-size:0.85rem;">暂无工作流，请先在「工作流管理」中新增。</p>';
      return;
    }
    wrap.innerHTML = wfs.map(function (w) {
      return (
        '<label class="wf-check">' +
          '<input type="checkbox" value="' + escAttr(w.id) + '" />' +
          '<span>' + esc(w.icon || '🤖') + ' ' + esc(w.name) + '</span>' +
        '</label>'
      );
    }).join('');
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

    // 知识库管理（多实体）
    var kbAddBtn = document.getElementById('kb-add-btn');
    if (kbAddBtn) {
      kbAddBtn.addEventListener('click', function () {
        document.getElementById('kb-id').value = '';
        document.getElementById('kb-apikey').required = true;
        Admin.showKnowledgeForm(null);
      });
    }
    var kbForm = document.getElementById('kb-form');
    if (kbForm) kbForm.addEventListener('submit', Admin.submitKnowledgeForm);
    var kbFormCancel = document.getElementById('kb-form-cancel');
    if (kbFormCancel) {
      kbFormCancel.addEventListener('click', function () {
        document.getElementById('kb-form-wrap').hidden = true;
        document.getElementById('kb-form').reset();
      });
    }
    // 知识库表格的编辑/删除按钮（事件委托）
    var kbTable = document.getElementById('kb-table-body');
    if (kbTable) {
      kbTable.addEventListener('click', function (ev) {
        var btn = ev.target.closest('[data-kb-action]');
        if (!btn) return;
        var id = btn.getAttribute('data-kb-id');
        if (btn.getAttribute('data-kb-action') === 'edit') Admin.editKnowledgeBase(id);
        else Admin.deleteKnowledgeBaseById(id);
      });
    }
    // 工作流表单：知识库节点展开/收起（勾选计数在 openBaseNode 内的 change 事件中处理）
    var wfKbList = document.getElementById('wf-ragdatasets-list');
    if (wfKbList) {
      wfKbList.addEventListener('click', function (ev) {
        var header = ev.target.closest('.kb-node-header');
        if (header) {
          var node = header.closest('.kb-node');
          var baseId = node.getAttribute('data-base-id');
          var baseName = node.getAttribute('data-base-name');
          if (node.classList.contains('open')) {
            node.classList.remove('open');
            node.querySelector('.kb-node-body').hidden = true;
          } else {
            openBaseNode(node, { id: baseId, name: baseName }, null);
          }
          return;
        }
      });
    }
    // 知识库表单：测试连接按钮
    var kbTestBtn = document.getElementById('kb-test-btn');
    if (kbTestBtn) kbTestBtn.addEventListener('click', Admin.testKnowledgeForm);

    // 操作日志刷新
    var auditRefreshBtn = document.getElementById('audit-refresh-btn');
    if (auditRefreshBtn) auditRefreshBtn.addEventListener('click', Admin.loadAudit);
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
