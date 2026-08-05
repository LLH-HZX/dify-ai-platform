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

    // ── Tab 切换 ──
    switchTab: function (tab) {
      var tabs = document.querySelectorAll('.admin-tab');
      var panels = {
        workflows: document.getElementById('tab-workflows'),
        accounts: document.getElementById('tab-accounts'),
        dashboard: document.getElementById('tab-dashboard'),
        knowledge: document.getElementById('tab-knowledge'),
      };
      tabs.forEach(function (t) {
        t.classList.toggle('active', t.getAttribute('data-tab') === tab);
      });
      ['workflows', 'accounts', 'dashboard', 'knowledge'].forEach(function (k) {
        if (panels[k]) panels[k].hidden = (k !== tab);
      });

      if (tab === 'workflows') Admin.loadWorkflows();
      if (tab === 'accounts') Admin.loadAccounts();
      if (tab === 'dashboard') Admin.loadDashboard();
      if (tab === 'knowledge') Admin.loadKnowledge();
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

    // ── 知识库管理（RAGFlow 全局配置） ──
    loadKnowledge: async function () {
      try {
        var cfg = await window.API.getKnowledgeConfig();
        document.getElementById('kb-baseurl').value = cfg.baseUrl || '';
        document.getElementById('kb-enabled').checked = !!cfg.enabled;
        // apiKey 不回显，留空表示不修改
        document.getElementById('kb-apikey').value = '';
        renderDatasetSelect([]);
      } catch (e) {
        window.showToast(e.message);
      }
    },

    saveKnowledge: async function () {
      var payload = {
        baseUrl: document.getElementById('kb-baseurl').value.trim(),
        apiKey: document.getElementById('kb-apikey').value.trim(),
        enabled: document.getElementById('kb-enabled').checked,
      };
      try {
        await window.API.saveKnowledgeConfig(payload);
        window.showToast('知识库配置已保存');
        Admin.loadKnowledge();
      } catch (e) {
        window.showToast(e.message);
      }
    },

    testKnowledge: async function () {
      var btn = document.getElementById('kb-test-btn');
      btn.disabled = true;
      btn.textContent = '测试中...';
      var status = document.getElementById('kb-test-status');
      status.className = 'kb-status';
      status.textContent = '';
      try {
        var result = await window.API.testKnowledge({
          baseUrl: document.getElementById('kb-baseurl').value.trim(),
          apiKey: document.getElementById('kb-apikey').value.trim(),
        });
        if (result.connected) {
          status.className = 'kb-status kb-status--ok';
          status.textContent = '✅ ' + (result.message || '连接成功') + (result.datasets ? '，发现 ' + result.datasets.length + ' 个数据集' : '');
          renderDatasetSelect(result.datasets || []);
        } else {
          status.className = 'kb-status kb-status--err';
          status.textContent = '❌ ' + (result.message || '连接失败');
          renderDatasetSelect([]);
        }
      } catch (e) {
        status.className = 'kb-status kb-status--err';
        status.textContent = '❌ ' + e.message;
      } finally {
        btn.disabled = false;
        btn.textContent = '测试连接';
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
      tbody.innerHTML = '<tr><td colspan="3" class="empty-cell">暂无账号</td></tr>';
      return;
    }
    tbody.innerHTML = Admin.accounts.map(function (a) {
      var roleBadge = a.role === 'admin'
        ? '<span class="badge badge-blue">管理员</span>'
        : '<span class="badge badge-green">用户</span>';
      var delBtn = a.username === 'admin'
        ? ''
        : '<button class="btn-sm btn-danger" onclick="window.Admin.deleteAccount(\'' + escAttr(a.username) + '\')">删除</button>';
      return (
        '<tr>' +
          '<td>' + esc(a.username) + '</td>' +
          '<td>' + roleBadge + '</td>' +
          '<td class="row-actions">' + delBtn + '</td>' +
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

  // ═══════════════ 渲染数据集下拉 ═══════════════
  function renderDatasetSelect(datasets) {
    var select = document.getElementById('kb-datasets');
    if (!select) return;
    var current = (document.getElementById('kb-dataset-ids').value || '').split(/[,，\s]+/).filter(Boolean);
    if (!datasets || !datasets.length) {
      select.innerHTML = '<option value="">— 测试连接后可选 —</option>';
      return;
    }
    select.innerHTML = datasets.map(function (d) {
      var sel = current.indexOf(String(d.id)) >= 0 ? ' selected' : '';
      return '<option value="' + escAttr(d.id) + '"' + sel + '>' + esc(d.name || d.id) + '</option>';
    }).join('');
  }

  function syncDatasetIds() {
    var select = document.getElementById('kb-datasets');
    var input = document.getElementById('kb-dataset-ids');
    var selected = Array.prototype.filter.call(select.selectedOptions, function (o) { return o.value; })
      .map(function (o) { return o.value; });
    input.value = selected.join(',');
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
    document.getElementById('wf-ragdatasets').value = wf ? (wf.ragDatasetIds || []).join(',') : '';
    document.getElementById('wf-ragtopk').value = wf ? (wf.ragTopK || 3) : 3;
    document.getElementById('wf-ragcontextvar').value = wf ? (wf.ragContextVar || 'context') : 'context';
  };

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
      icon: document.getElementById('wf-icon').value.trim() || '🤖',
      type: document.getElementById('wf-type').value,
      category: document.getElementById('wf-category').value.trim() || '默认',
      description: document.getElementById('wf-desc').value.trim(),
      apiKey: document.getElementById('wf-apikey').value.trim(),
      baseUrl: document.getElementById('wf-baseurl').value.trim(),
      iframeUrl: document.getElementById('wf-iframeurl').value.trim(),
      enabled: document.getElementById('wf-enabled').checked,
      ragEnabled: document.getElementById('wf-ragenabled').checked,
      ragDatasetIds: document.getElementById('wf-ragdatasets').value
        .split(/[,，\s]+/).map(function (s) { return s.trim(); }).filter(Boolean),
      ragTopK: parseInt(document.getElementById('wf-ragtopk').value, 10) || 3,
      ragContextVar: document.getElementById('wf-ragcontextvar').value.trim() || 'context',
    };
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

  // ═══════════════ 账号增删 ═══════════════
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
    var payload = {
      username: document.getElementById('acc-username').value.trim(),
      password: document.getElementById('acc-password').value,
      role: document.getElementById('acc-role').value,
    };
    if (!payload.username || !payload.password) { window.showToast('请填写用户名和密码'); return; }
    window.API.createAccount(payload).then(function () {
      window.showToast('添加成功');
      document.getElementById('acc-form-wrap').hidden = true;
      document.getElementById('acc-form').reset();
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
      document.getElementById('acc-form-wrap').hidden = false;
    });
    document.getElementById('acc-form').addEventListener('submit', submitAccountForm);
    document.getElementById('acc-form-cancel').addEventListener('click', function () {
      document.getElementById('acc-form-wrap').hidden = true;
      document.getElementById('acc-form').reset();
    });

    // 知识库配置
    var kbSaveBtn = document.getElementById('kb-save-btn');
    if (kbSaveBtn) kbSaveBtn.addEventListener('click', Admin.saveKnowledge);
    var kbTestBtn = document.getElementById('kb-test-btn');
    if (kbTestBtn) kbTestBtn.addEventListener('click', Admin.testKnowledge);
    var kbDatasets = document.getElementById('kb-datasets');
    if (kbDatasets) kbDatasets.addEventListener('change', syncDatasetIds);
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
