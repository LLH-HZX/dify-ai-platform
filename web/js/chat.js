/**
 * 聊天面板模块：站内自定义聊天（走后端 /api/chat，支持流式 SSE）
 * 依赖 window.Apps, window.API
 */
(function () {
  'use strict';

  var chatPanel = document.getElementById('chat-panel');
  var chatPanelName = document.getElementById('chat-panel-name');
  var chatPanelIcon = document.getElementById('chat-panel-icon');
  var closeBtn = document.getElementById('chat-panel-close');
  var clearBtn = document.getElementById('chat-clear-btn');
  var chatMessages = document.getElementById('chat-messages');
  var chatInput = document.getElementById('chat-input');
  var sendBtn = document.getElementById('chat-send-btn');
  var emptyName = document.getElementById('chat-empty-name');
  var fileInput = document.getElementById('chat-file-input');
  var attachBtn = document.getElementById('chat-attach-btn');
  var voiceBtn = document.getElementById('chat-voice-btn');
  var chatAttachments = document.getElementById('chat-attachments');
  // 历史会话侧栏
  var chatHistory = document.getElementById('chat-history');
  var historyList = document.getElementById('history-list');
  var historyEmpty = document.getElementById('history-empty');
  var historyNewBtn = document.getElementById('history-new-btn');
  var historyToggleBtn = document.getElementById('chat-history-toggle');

  // 待发送附件列表：[{upload_file_id, name, size, type}]
  var pendingFiles = [];
  // 当前用户历史会话摘要（用于刷新列表高亮）
  var historyData = [];

  var Chat = {
    currentWorkflow: null,
    conversationId: '',
    currentSessionId: '',
    historyOpen: true,
    busy: false,
    voiceSupported: false,

    /**
     * 打开聊天面板，准备站内聊天
     */
    open: function (workflowId) {
      var app = window.Apps.getById(workflowId);
      if (!app) {
        showToast('未找到该应用');
        return;
      }

      Chat.currentWorkflow = app;
      Chat.conversationId = '';
      Chat.currentSessionId = '';
      Chat.busy = false;

      chatPanelName.textContent = app.name || 'AI助手';
      if (emptyName) emptyName.textContent = app.name || 'AI助手';
      chatPanelIcon.textContent = app.icon || '🤖';
      var color = app.color || '#2563EB';
      chatPanelIcon.style.backgroundColor = color + '1A';
      chatPanelIcon.style.color = color;

      // 清空历史消息（新会话）
      chatMessages.innerHTML = '<div class="chat-empty-tip">👋 你好，我是 <span id="chat-empty-name">' + esc(app.name || 'AI助手') + '</span>，有什么可以帮你？</div>';

      // 展示侧栏并加载当前用户的历史会话
      setHistoryOpen(true);
      loadHistory();

      chatPanel.classList.add('chat-panel--open');
      chatPanel.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';

      setTimeout(function () {
        chatInput.focus();
      }, 300);
    },

    close: function () {
      if (!chatPanel.classList.contains('chat-panel--open')) return;
      chatPanel.classList.remove('chat-panel--open');
      chatPanel.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      setTimeout(function () {
        chatMessages.innerHTML = '';
        Chat.currentWorkflow = null;
        Chat.conversationId = '';
        Chat.currentSessionId = '';
        Chat.busy = false;
        if (historyList) historyList.innerHTML = '';
      }, 280);
    },

    send: function () {
      if (Chat.busy) return;
      var text = chatInput.value.trim();
      if (!text && pendingFiles.length === 0) return;
      if (!Chat.currentWorkflow) { showToast('请先选择应用'); return; }

      var attachments = pendingFiles.slice();
      chatInput.value = '';
      autoResize();
      clearAttachments();

      // 追加用户消息（含附件描述）
      var userText = text;
      if (attachments.length > 0) {
        var names = attachments.map(function (a) { return a.name || '附件'; }).join('、');
        userText = (text ? text + '\n' : '') + '📎 [附件] ' + names;
      }
      appendMessage('user', userText);

      // 追加助手占位消息（用于流式输出）
      var aiMsg = appendMessage('assistant', '');

      Chat.busy = true;
      setSendState();

      var payload = {
        workflow_id: Chat.currentWorkflow.id,
        query: text,
        response_mode: 'streaming',
        conversation_id: Chat.conversationId,
        session_id: Chat.currentSessionId,
        inputs: {},
      };
      if (attachments.length > 0) {
        payload.files = attachments.map(function (a) {
          return { type: a.type, transfer_method: 'local_file', upload_file_id: a.upload_file_id };
        });
      }

      window.API.chat(payload, function (delta) {
        appendStream(aiMsg, delta);
      }, function (_fullAnswer, conversationId, sessionId) {
        if (conversationId) Chat.conversationId = conversationId;
        if (sessionId) Chat.currentSessionId = sessionId;
        Chat.busy = false;
        setSendState();
        loadHistory();
      }, function (errMsg) {
        appendStream(aiMsg, '\n\n⚠️ ' + (errMsg || '请求失败'));
        Chat.busy = false;
        setSendState();
      });
    },

    clear: function () {
      Chat.conversationId = '';
      Chat.busy = false;
      setSendState();
      clearAttachments();
      if (Chat.currentWorkflow) {
        chatMessages.innerHTML = '<div class="chat-empty-tip">👋 已清空，我是 <span>' + esc(Chat.currentWorkflow.name || 'AI助手') + '</span>，有什么可以帮你？</div>';
      } else {
        chatMessages.innerHTML = '<div class="chat-empty-tip">👋 你好，有什么可以帮你？</div>';
      }
    },

    init: function () {
      if (closeBtn) closeBtn.addEventListener('click', Chat.close);
      if (clearBtn) clearBtn.addEventListener('click', Chat.clear);
      if (sendBtn) sendBtn.addEventListener('click', Chat.send);

      if (chatPanel) {
        chatPanel.addEventListener('click', function (e) {
          if (e.target === chatPanel) Chat.close();
        });
      }

      if (chatInput) {
        chatInput.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            Chat.send();
          }
        });
        chatInput.addEventListener('input', autoResize);
      }

      // 文件上传
      if (attachBtn && fileInput) {
        attachBtn.addEventListener('click', function () {
          fileInput.value = '';
          fileInput.click();
        });
        fileInput.addEventListener('change', function () {
          if (fileInput.files && fileInput.files.length > 0) {
            handleFileSelect(fileInput.files[0]);
          }
        });
      }

      // 语音输入
      if (voiceBtn) {
        Chat.voiceSupported = !!initSpeechRecognition();
        voiceBtn.addEventListener('click', toggleVoice);
        if (!Chat.voiceSupported) {
          voiceBtn.classList.add('chat-panel__tool--disabled');
          voiceBtn.setAttribute('title', '当前浏览器不支持语音输入（请使用 Chrome/Edge）');
        }
      }

      // 历史会话侧栏
      if (historyToggleBtn) historyToggleBtn.addEventListener('click', toggleHistory);
      if (historyNewBtn) historyNewBtn.addEventListener('click', newSession);
      if (historyList) {
        historyList.addEventListener('click', function (e) {
          var delBtn = e.target.closest('.chat-panel__history-item-del');
          if (delBtn) {
            e.stopPropagation();
            deleteSessionItem(delBtn.getAttribute('data-id'));
            return;
          }
          var item = e.target.closest('.chat-panel__history-item');
          if (item) openSession(item.getAttribute('data-id'));
        });
      }

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') Chat.close();
      });
    },
  };

  // ═══════════════ 消息渲染 ═══════════════
  function appendMessage(role, text) {
    var wrapper = document.createElement('div');
    wrapper.className = 'chat-msg chat-msg--' + role;

    var avatar = document.createElement('div');
    avatar.className = 'chat-msg__avatar';
    if (role === 'user') {
      avatar.textContent = '我';
    } else {
      avatar.textContent = (Chat.currentWorkflow && Chat.currentWorkflow.icon) || '🤖';
    }

    var bubble = document.createElement('div');
    bubble.className = 'chat-msg__bubble';
    if (text) bubble.textContent = text;

    wrapper.appendChild(avatar);
    wrapper.appendChild(bubble);
    chatMessages.appendChild(wrapper);
    scrollToBottom();
    return bubble;
  }

  function appendStream(bubble, delta) {
    bubble.textContent += delta;
    scrollToBottom();
  }

  function setSendState() {
    if (sendBtn) {
      sendBtn.disabled = Chat.busy;
      sendBtn.textContent = Chat.busy ? '思考中...' : '发送';
    }
    if (chatInput) chatInput.disabled = Chat.busy;
  }

  function autoResize() {
    if (!chatInput) return;
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 140) + 'px';
  }

  function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // ═══════════════ 附件管理 ═══════════════
  function handleFileSelect(file) {
    if (Chat.busy) { showToast('等待回复完成后可上传'); return; }
    if (pendingFiles.length >= 5) { showToast('最多同时上传 5 个附件'); return; }

    showToast('正在上传「' + (file.name || '文件') + '」...');
    window.API.upload(file).then(function (data) {
      var item = {
        upload_file_id: data.upload_file_id || data.id,
        name: data.name || file.name,
        size: data.size || 0,
        type: data.type || 'document',
      };
      pendingFiles.push(item);
      renderAttachments();
      showToast('附件已添加');
    }).catch(function (err) {
      showToast(err.message || '上传失败');
    });
  }

  function renderAttachments() {
    if (!chatAttachments) return;
    chatAttachments.innerHTML = '';
    pendingFiles.forEach(function (item, index) {
      var chip = document.createElement('span');
      chip.className = 'chat-panel__attachment';
      var icon = item.type === 'image' ? '🖼️' : '📄';
      var sizeText = formatSize(item.size);
      chip.innerHTML = '<span class="chat-panel__attachment-icon">' + icon + '</span>' +
        '<span class="chat-panel__attachment-name" title="' + esc(item.name) + '">' + esc(item.name) + '</span>' +
        '<span class="chat-panel__attachment-size">' + sizeText + '</span>' +
        '<button type="button" class="chat-panel__attachment-remove" data-index="' + index + '" title="移除附件">×</button>';
      chip.querySelector('.chat-panel__attachment-remove').addEventListener('click', function (e) {
        e.stopPropagation();
        pendingFiles.splice(index, 1);
        renderAttachments();
      });
      chatAttachments.appendChild(chip);
    });
  }

  function clearAttachments() {
    pendingFiles = [];
    if (chatAttachments) chatAttachments.innerHTML = '';
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / 1024 / 1024).toFixed(1) + 'MB';
  }

  // ═══════════════ 语音输入（Web Speech API） ═══════════════
  var SpeechRecognitionImpl = null;
  var recognition = null;
  var voiceListening = false;

  function initSpeechRecognition() {
    if (SpeechRecognitionImpl) return SpeechRecognitionImpl;
    var w = window;
    SpeechRecognitionImpl = w.SpeechRecognition || w.webkitSpeechRecognition || null;
    return SpeechRecognitionImpl;
  }

  function toggleVoice() {
    if (Chat.busy) { showToast('等待回复完成后可使用语音'); return; }
    if (!initSpeechRecognition()) {
      showToast('当前浏览器不支持语音输入');
      return;
    }
    if (voiceListening) {
      stopVoice();
    } else {
      startVoice();
    }
  }

  function startVoice() {
    if (!recognition) {
      recognition = new SpeechRecognitionImpl();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'zh-CN';

      recognition.onresult = function (event) {
        var transcript = '';
        for (var i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        chatInput.value = transcript;
        autoResize();
      };

      recognition.onerror = function (event) {
        stopVoice();
        var msg = event.error === 'not-allowed' ? '未授权麦克风，请允许后重试'
          : event.error === 'no-speech' ? '未检测到语音'
          : '语音识别出错';
        showToast(msg);
      };

      recognition.onend = function () {
        // 若手动停止则不再自动重启
        if (voiceListening) {
          setVoiceState(false);
        }
      };
    }

    chatInput.placeholder = '正在聆听，请说话...';
    chatInput.focus();
    voiceListening = true;
    setVoiceState(true);
    try {
      recognition.start();
    } catch (e) {
      voiceListening = false;
      setVoiceState(false);
      chatInput.placeholder = '输入你的问题，Enter 发送，Shift+Enter 换行';
      showToast('语音识别启动失败');
    }
  }

  function stopVoice() {
    voiceListening = false;
    if (recognition) {
      try { recognition.stop(); } catch (e) { /* 忽略 */ }
    }
    setVoiceState(false);
    chatInput.placeholder = '输入你的问题，Enter 发送，Shift+Enter 换行';
  }

  function setVoiceState(on) {
    if (!voiceBtn) return;
    var icon = document.getElementById('chat-voice-icon');
    voiceBtn.classList.toggle('chat-panel__tool--active', on);
    voiceBtn.setAttribute('title', on ? '停止录音' : '语音输入');
    if (icon) {
      icon.style.color = on ? '#ef4444' : '';
      icon.style.transform = on ? 'scale(1.15)' : '';
    }
  }

  function showToast(message) {
    var toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('toast--show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () {
      toast.classList.remove('toast--show');
    }, 3000);
  }

  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ═══════════════ 历史会话 ═══════════════
  function loadHistory() {
    if (!historyList) return;
    historyList.innerHTML = '';
    if (historyEmpty) historyEmpty.style.display = 'none';
    window.API.listSessions().then(function (data) {
      historyData = (data && data.sessions) || [];
      if (historyEmpty) historyEmpty.style.display = historyData.length ? 'none' : 'block';
      renderHistory(historyData);
    }).catch(function () {
      historyData = [];
      if (historyEmpty) historyEmpty.style.display = 'block';
    });
  }

  function renderHistory(sessions) {
    if (!historyList) return;
    historyList.innerHTML = '';
    (sessions || []).forEach(function (s) {
      var item = document.createElement('div');
      item.className = 'chat-panel__history-item' + (s.id === Chat.currentSessionId ? ' chat-panel__history-item--active' : '');
      item.setAttribute('data-id', s.id);
      var icon = s.type === 'chatflow' ? '💬' : '⚙️';
      item.innerHTML =
        '<span class="chat-panel__history-item-icon">' + icon + '</span>' +
        '<div class="chat-panel__history-item-main">' +
        '<div class="chat-panel__history-item-title" title="' + esc(s.title) + '">' + esc(s.title) + '</div>' +
        '<div class="chat-panel__history-item-time">' + formatTime(s.updated_at) + '</div>' +
        '</div>' +
        '<button type="button" class="chat-panel__history-item-del" data-id="' + esc(s.id) + '" title="删除会话">' + trashSvg() + '</button>';
      historyList.appendChild(item);
    });
  }

  function openSession(sessionId) {
    if (Chat.busy) { showToast('等待回复完成后可切换会话'); return; }
    window.API.getSession(sessionId).then(function (s) {
      if (!s) { showToast('会话不存在'); return; }
      Chat.currentSessionId = s.id;
      Chat.conversationId = s.conversation_id || '';

      // 切换当前应用上下文（历史会话可能属于其他工作流）
      var app = window.Apps.getById(s.workflow_id);
      if (app) {
        Chat.currentWorkflow = app;
        chatPanelName.textContent = app.name || 'AI助手';
        if (emptyName) emptyName.textContent = app.name || 'AI助手';
        chatPanelIcon.textContent = app.icon || '🤖';
        var color = app.color || '#2563EB';
        chatPanelIcon.style.backgroundColor = color + '1A';
        chatPanelIcon.style.color = color;
      }

      // 渲染历史消息
      renderSessionMessages(s.messages || []);
      renderHistory(historyData);
      chatInput.focus();
      // 普通 workflow 提示不支持续聊
      if (s.type && s.type !== 'chatflow') {
        showToast('该应用为 workflow 类型，不支持上下文续聊，仅展示历史');
      }
    }).catch(function (err) {
      showToast(err.message || '加载会话失败');
    });
  }

  function renderSessionMessages(messages) {
    chatMessages.innerHTML = '';
    if (!messages || messages.length === 0) {
      chatMessages.innerHTML = '<div class="chat-empty-tip">👋 该会话暂无消息</div>';
      return;
    }
    messages.forEach(function (m) {
      var role = m.role === 'assistant' ? 'assistant' : 'user';
      appendMessage(role, m.content || '');
    });
    scrollToBottom();
  }

  function newSession() {
    if (Chat.busy) { showToast('等待回复完成后可新建对话'); return; }
    Chat.currentSessionId = '';
    Chat.conversationId = '';
    var app = Chat.currentWorkflow;
    chatMessages.innerHTML = '<div class="chat-empty-tip">👋 你好，我是 <span>' + esc(app ? app.name : 'AI助手') + '</span>，有什么可以帮你？</div>';
    loadHistory();
    chatInput.focus();
  }

  function deleteSessionItem(sessionId) {
    window.API.deleteSession(sessionId).then(function () {
      if (Chat.currentSessionId === sessionId) {
        newSession();
      } else {
        loadHistory();
      }
      showToast('会话已删除');
    }).catch(function (err) {
      showToast(err.message || '删除失败');
    });
  }

  function setHistoryOpen(open) {
    Chat.historyOpen = open;
    if (chatPanel) chatPanel.classList.toggle('chat-panel--history-collapsed', !open);
  }

  function toggleHistory() {
    setHistoryOpen(!Chat.historyOpen);
  }

  function formatTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (d.toDateString() === now.toDateString()) return hm;
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
  }

  function trashSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>' +
      '<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
      '<line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>' +
      '</svg>';
  }

  window.Chat = Chat;
  window.showToast = showToast;
})();
