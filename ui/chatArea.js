// ui/chatArea.js
import * as dom from '../src/dom.js';
import * as state from '../src/state.js';
import { escapeHTML } from '../src/utils.js';

// --- Empty State ---
export function updateEmptyState() {
    if (!dom.messageList || !dom.emptyMessageListDiv) return;
    const hasMessages = dom.messageList.querySelector('.message-item, .file-message-container') !== null;
    const hasSelectedContact = !!state.getActiveChatPeerId();

    if (hasMessages) {
        dom.emptyMessageListDiv.classList.add('hidden');
    } else if (hasSelectedContact) {
        dom.emptyMessageListDiv.innerHTML = `
             <span class="material-symbols-outlined text-6xl mb-4">forum</span>
             <h3 class="text-lg font-semibold text-discord-text-primary">还没有消息</h3>
             <p class="text-sm">看起来这里很安静。开始对话或发送一个文件吧！</p>
        `;
        dom.emptyMessageListDiv.classList.remove('hidden');
    } else {
        dom.emptyMessageListDiv.innerHTML = `
             <span class="material-symbols-outlined text-6xl mb-4">chat</span>
             <h3 class="text-lg font-semibold text-discord-text-primary">选择联系人</h3>
             <p class="text-sm">从左侧选择一个联系人以查看聊天记录。</p>
        `;
        dom.emptyMessageListDiv.classList.remove('hidden');
    }
}

// --- Typing Indicator (Modified for Multi-Peer) ---
export function showTypingIndicator(peerId, isTyping) {
    const activePeerId = state.getActiveChatPeerId();
    state.setPeerIsTyping(peerId, isTyping); // Update state regardless of active chat

    if (dom.typingIndicator && dom.typingUsersSpan) {
        // Only show indicator if the typing peer is the currently selected chat
        if (peerId === activePeerId && isTyping) {
            const contacts = state.getContacts();
            const typerName = contacts[peerId]?.name || peerId || '对方';
            dom.typingUsersSpan.textContent = escapeHTML(typerName);
            dom.typingIndicator.classList.remove('hidden');
            dom.typingIndicator.classList.add('flex');
        } else if (peerId === activePeerId && !isTyping) {
            // Hide if the active peer stopped typing
            dom.typingIndicator.classList.add('hidden');
            dom.typingIndicator.classList.remove('flex');
        }
        // If the typing indicator is for a non-active chat, do nothing visually here
    }
}

// Simplified hide function - called when switching chats or explicitly hiding
export function hideActiveTypingIndicator() {
     if (dom.typingIndicator) {
        dom.typingIndicator.classList.add('hidden');
        dom.typingIndicator.classList.remove('flex');
     }
}

// Updates the header of the chat area
export function updateChatHeader(peerId) {
    if (!dom.chatHeaderName || !dom.chatHeaderStatus) return;

    if (!peerId) {
        // No active chat
        dom.chatHeaderName.textContent = '选择对话';
        dom.chatHeaderStatus.textContent = '从左侧列表选择一个联系人开始聊天';
        dom.chatHeaderStatus.className = 'text-xs text-discord-text-muted'; // Reset class
        return;
    }

    const contacts = state.getContacts();
    const contact = contacts[peerId];
    const name = contact?.name || peerId;
    let statusText = '';
    let statusClass = 'text-xs text-discord-text-muted';

    const connectionState = state.getConnectionState(peerId);
    const contactOnlineStatus = contact?.online;

    if (contactOnlineStatus === true) {
        statusText = '在线';
        statusClass = 'text-xs text-discord-green';
    } else if (contactOnlineStatus === 'connecting' || connectionState === 'connecting') {
         statusText = '连接中...';
         statusClass = 'text-xs text-discord-yellow';
    } else {
        statusText = '离线';
        // Could add last seen later if tracked
    }

    dom.chatHeaderName.textContent = escapeHTML(name);
    dom.chatHeaderStatus.textContent = statusText;
    dom.chatHeaderStatus.className = statusClass;
}

// --- Input Area Visibility ---
export function updateChatInputVisibility(forceVisible = null) {
    if (!dom.chatInputContainer) {
        console.error("UI Error: dom.chatInputContainer is null or undefined in updateChatInputVisibility!");
        return; // Exit if the element doesn't exist
    }
    let shouldBeVisible = false;

    if (forceVisible !== null) {
        shouldBeVisible = forceVisible;
    } else {
        const activePeerId = state.getActiveChatPeerId();
        // Show the input container if *any* contact is selected
        shouldBeVisible = !!activePeerId; // Changed: Now depends only on whether a chat is active
    }

    console.log(`[UI Debug] Updating input visibility. Element:`, dom.chatInputContainer, `Should be visible: ${shouldBeVisible}`); // Added log
    dom.chatInputContainer.classList.toggle('hidden', !shouldBeVisible);

    // Also update chat header when input visibility changes (unless no peer is active)
     if (shouldBeVisible) {
        updateChatHeader(state.getActiveChatPeerId());
     } else {
         updateChatHeader(null); // Ensure header clears if input hides due to no selection
     }

}


/**
 * Clears the chat input field.
 */
export function clearChatInput() {
    if (dom.chatInput) {
        dom.chatInput.value = '';
        dom.chatInput.dispatchEvent(new Event('input')); // Trigger input event for potential autosize adjustments
    }
}