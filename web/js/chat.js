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

  var Chat = {
    currentWorkflow: null,
    conversationId: '',
    busy: false,

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
      Chat.busy = false;

      chatPanelName.textContent = app.name || 'AI助手';
      if (emptyName) emptyName.textContent = app.name || 'AI助手';
      chatPanelIcon.textContent = app.icon || '🤖';
      var color = app.color || '#2563EB';
      chatPanelIcon.style.backgroundColor = color + '1A';
      chatPanelIcon.style.color = color;

      // 清空历史消息（新会话）
      chatMessages.innerHTML = '<div class="chat-empty-tip">👋 你好，我是 <span id="chat-empty-name">' + esc(app.name || 'AI助手') + '</span>，有什么可以帮你？</div>';

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
        Chat.busy = false;
      }, 280);
    },

    send: function () {
      if (Chat.busy) return;
      var text = chatInput.value.trim();
      if (!text) return;
      if (!Chat.currentWorkflow) { showToast('请先选择应用'); return; }

      chatInput.value = '';
      autoResize();

      // 追加用户消息
      appendMessage('user', text);

      // 追加助手占位消息（用于流式输出）
      var aiMsg = appendMessage('assistant', '');

      Chat.busy = true;
      setSendState();

      var payload = {
        workflow_id: Chat.currentWorkflow.id,
        query: text,
        response_mode: 'streaming',
        conversation_id: Chat.conversationId,
        inputs: {},
      };

      window.API.chat(payload, function (delta) {
        appendStream(aiMsg, delta);
      }, function (_fullAnswer, conversationId) {
        if (conversationId) Chat.conversationId = conversationId;
        Chat.busy = false;
        setSendState();
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

  window.Chat = Chat;
  window.showToast = showToast;
})();
