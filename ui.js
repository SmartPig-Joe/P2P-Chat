// ui.js
import * as dom from './dom.js';
import * as state from './state.js';
import { escapeHTML, formatTime, getUserColorClass } from './utils.js';
import * as connection from './connection.js'; // Import connection to call loadAndDisplayHistory
import * as storage from './storage.js'; // Import storage for potential future use (e.g., removing contacts)
import * as fileTransfer from './fileTransfer.js'; // Needed for formatting bytes

// Remove global selectedPeerId, use state.activeChatPeerId
// let selectedPeerId = null; // DEPRECATED

// Store active ObjectURLs to revoke them later
const activeObjectURLs = new Set();

/**
 * Returns the currently selected peer ID from state.
 * @returns {string | null}
 */
export function getSelectedPeerId() {
    // return selectedPeerId; // DEPRECATED
    return state.getActiveChatPeerId();
}

// --- UI Helper Functions ---

/**
 * Scrolls the message list to the bottom.
 */
export function scrollToBottom() {
    if (dom.messageList) {
        setTimeout(() => {
             dom.messageList.scrollTop = dom.messageList.scrollHeight;
        }, 0);
    }
}

/**
 * Clears text, system, and file messages from the message list UI.
 * Revokes any active ObjectURLs associated with file messages.
 */
export function clearMessageList() { // Renamed from clearChatMessages for clarity
    if (dom.messageList) {
        dom.messageList.querySelectorAll('.file-message-container[data-download-url]').forEach(el => {
            const url = el.dataset.downloadUrl;
            if (url && activeObjectURLs.has(url)) {
                console.log(`[UI Cleanup] Revoking ObjectURL: ${url}`);
                URL.revokeObjectURL(url);
                activeObjectURLs.delete(url);
            }
        });
        dom.messageList.innerHTML = '';
        updateEmptyState();
    }
}

// --- Empty State ---
export function updateEmptyState() {
    if (!dom.messageList || !dom.emptyMessageListDiv) return;
    const hasMessages = dom.messageList.querySelector('.message-item, .file-message-container') !== null;
    // const hasSelectedContact = !!selectedPeerId; // DEPRECATED
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

// --- System Messages ---
// Modified to accept optional peerId. Only displays if peerId matches active chat or if peerId is null (global message).
export function addSystemMessage(text, peerId = null, isError = false) {
     const activePeerId = state.getActiveChatPeerId();

     // Display message only if it's global (peerId is null) or targets the active chat
     if (dom.messageList && (peerId === null || peerId === activePeerId)) {
         const colorClass = isError ? 'text-discord-red' : 'text-discord-text-muted';
         const messageHTML = `<div class="flex justify-center items-center my-2"><span class="text-xs ${colorClass} px-2 py-0.5 bg-discord-gray-2 rounded-full">${escapeHTML(text)}</span></div>`;
         dom.messageList.insertAdjacentHTML('beforeend', messageHTML);
         scrollToBottom();
     } else {
         // Log messages for non-active chats or if messageList isn't available
         console.log(`[System Message${peerId ? ` for ${peerId}` : ''}${isError ? ' ERROR' : ''}: ${text}`);
     }
}

// --- Chat Messages ---
function renderMessageContent(text) {
    const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|])/ig;
    // Basic markdown for bold and italics
    let processedText = escapeHTML(text)
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
        .replace(/\*(.*?)\*/g, '<em>$1</em>');       // Italics

    return processedText.replace(urlRegex, function(url) {
        // Make sure the URL inside <a> tag is not escaped
        return `<a href="${url.replace(/&amp;/g, '&')}" target="_blank" rel="noopener noreferrer" class="text-discord-text-link hover:underline">${url}</a>`;
    });
}

// Generates a placeholder avatar color based on User ID
function getAvatarColor(userId) {
    const colors = [
        '7289da', // Blurple
        '43b581', // Green
        'f04747', // Red
        'faa61a', // Yellow/Orange
        '3498db', // Blue
        '9b59b6', // Purple
        'e91e63', // Pink
        '1abc9c'  // Teal
    ];
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash % colors.length)];
}

// Renders HTML for a single message object (text or file meta)
function createMessageHTML(message) {
    const isLocal = message.senderId === state.localUserId;
    const senderId = message.senderId;
    const peerId = isLocal ? state.getActiveChatPeerId() : senderId; // Context peer for crypto checks etc.

    const senderName = isLocal
        ? (state.contacts[state.localUserId]?.name || '我') // Use contact name if self is added, else '我'
        : (state.contacts[senderId]?.name || senderId); // Use contact name or fallback to ID

    const avatarColor = getAvatarColor(senderId);
    const userColorClass = getUserColorClass(senderName);
    const timeString = formatTime(new Date(message.timestamp));

    // TODO: Update lock icon logic based on per-peer crypto state if implemented
    // const peerKeys = state.getPeerKeys(peerId);
    // const lockIcon = peerKeys?.sharedKey ? '<span ... title="端到端加密">lock</span>' : '';
    const lockIcon = ''; // Placeholder for now

    const avatarText = escapeHTML(senderName.charAt(0).toUpperCase());
    const senderNameEscaped = escapeHTML(senderName);

    let messageBodyHTML;

    if (message.type === 'text') {
        messageBodyHTML = `<p class="text-discord-text-primary text-sm message-content">${renderMessageContent(message.payload.text)}</p>`;
    } else if (message.type === 'fileMeta') {
        // Render file metadata using the dedicated function
        // Pass message.payload (fileInfo), isLocal, and potential initial state
        messageBodyHTML = createFileContentHTML(message.payload, isLocal);
    } else {
        messageBodyHTML = `<p class="text-discord-text-muted text-sm italic">[Unsupported message type: ${message.type}]</p>`;
    }

    // Use data attributes for easy identification
    const dataAttributes = `data-message-id="${message.id}" data-sender-id="${senderId}" data-timestamp="${message.timestamp}"`;
    const messageClasses = `flex items-start space-x-3 group message-item py-1 pr-4 hover:bg-discord-gray-4/30 rounded ${message.type === 'fileMeta' ? 'file-message-container' : ''}`;

    return (
       `<div class="${messageClasses}" ${dataAttributes}>
            <img src="https://placehold.co/40x40/${avatarColor}/ffffff?text=${avatarText}" alt="${senderNameEscaped} 头像" class="rounded-full mt-1 flex-shrink-0 cursor-pointer" title="${senderNameEscaped} (${senderId})" onerror="this.src='https://placehold.co/40x40/2c2f33/ffffff?text=Err'">
            <div class="flex-1">
                <div class="flex items-baseline space-x-2">
                    <span class="${userColorClass} font-medium hover:underline cursor-pointer">${senderNameEscaped}</span>
                    <span class="text-xs text-discord-text-muted message-timestamp" title="${new Date(message.timestamp).toLocaleString('zh-CN')}">${timeString}</span>
                    ${lockIcon}
                </div>
                ${messageBodyHTML}
            </div>
        </div>`
    );
}

// Displays a message object (text or file meta) in the chat window IF it belongs to the active chat.
export function displayMessage(peerId, message) {
    const activePeerId = state.getActiveChatPeerId();
    if (dom.messageList && peerId === activePeerId) {
        const messageElement = document.createElement('div');
        // createMessageHTML creates the outer div structure directly
        messageElement.innerHTML = createMessageHTML(message);
        if (messageElement.firstElementChild) {
            // Special handling for file messages: Check if placeholder exists
            if (message.type === 'fileMeta') {
                const existingElement = dom.messageList.querySelector(`[data-message-id="${message.id}"]`);
                if (existingElement) {
                     console.log(`Updating existing file message placeholder for ${message.id}`);
                     existingElement.outerHTML = messageElement.innerHTML; // Replace placeholder
                } else {
                     dom.messageList.appendChild(messageElement.firstElementChild);
                }
            } else {
                 dom.messageList.appendChild(messageElement.firstElementChild);
            }
        }
        scrollToBottom();
        updateEmptyState();
    } else if (peerId !== activePeerId) {
        // If message is for an inactive chat, just ensure the unread indicator is shown
         console.log(`Message received for inactive chat ${peerId}, showing indicator.`);
         showUnreadIndicator(peerId, true); // Ensure indicator is on
    }
}

// --- Typing Indicator (Modified for Multi-Peer) ---
export function showTypingIndicator(peerId, isTyping) {
    const activePeerId = state.getActiveChatPeerId();
    state.setPeerIsTyping(peerId, isTyping); // Update state regardless of active chat

    if (dom.typingIndicator && dom.typingUsersSpan) {
        // Only show indicator if the typing peer is the currently selected chat
        if (peerId === activePeerId && isTyping) {
            const typerName = state.contacts[peerId]?.name || peerId || '对方';
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

// --- File Messages (Refactored) ---

// Renders just the content part of a file message (icon, name, size, status/action)
// Used by createMessageHTML and updateFileMessageProgress
function createFileContentHTML(fileInfo, isLocal, downloadUrl = null, progress = 0) {
    const fileSizeFormatted = fileTransfer.formatBytes(fileInfo.size);
    const fileNameEscaped = escapeHTML(fileInfo.name);
    const transferId = fileInfo.transferId;

    const fileIconClasses = "material-symbols-outlined text-3xl text-discord-text-muted flex-shrink-0 mr-3";
    const downloadIconClasses = "material-symbols-outlined text-xl";
    const checkIconClasses = "material-symbols-outlined text-xl text-discord-green";
    const errorIconClasses = "material-symbols-outlined text-xl text-discord-red";
    const progressIconClasses = "material-symbols-outlined text-xl text-discord-blurple animate-spin"; // Spinning icon for progress

    let statusText = '';
    let iconHTML = `<span class="${fileIconClasses}">description</span>`; // Default file icon
    let actionHTML = '';

    const isFailed = progress < 0;
    const isComplete = progress >= 1;

    if (isFailed) {
        statusText = `<div class="text-xs text-discord-red">${fileSizeFormatted} - 传输失败</div>`;
        iconHTML = `<span class="${errorIconClasses} flex-shrink-0 mr-3">error</span>`;
    } else if (isComplete) {
        if (downloadUrl) { // Receiver completed
            statusText = `<div class="text-xs text-discord-text-muted">${fileSizeFormatted}</div>`;
            actionHTML = `
                <a href="${downloadUrl}" download="${fileNameEscaped}" class="text-discord-text-muted hover:text-white ml-auto p-1 rounded hover:bg-discord-gray-3" title="下载">
                    <span class="${downloadIconClasses}">download</span>
                </a>`;
            // Store the URL to revoke later if needed
            activeObjectURLs.add(downloadUrl);
            // Auto-revoke after some time? Or rely on clearMessageList?
        } else if (isLocal) { // Sender completed
            statusText = `<div class="text-xs text-discord-text-muted">${fileSizeFormatted} - 已发送</div>`;
            iconHTML = `<span class="${checkIconClasses} flex-shrink-0 mr-3">check_circle</span>`;
        } else { // Receiver completed (but URL not ready? fallback)
             statusText = `<div class="text-xs text-discord-text-muted">${fileSizeFormatted} - 已接收</div>`;
             iconHTML = `<span class="${checkIconClasses} flex-shrink-0 mr-3">check_circle</span>`;
        }
    } else { // In progress
        const progressPercent = Math.round(progress * 100);
        statusText = `
            <div class="text-xs text-discord-text-muted">${fileSizeFormatted} - ${isLocal ? '正在发送' : '正在接收'} ${progressPercent}%</div>
            <div class="w-full bg-discord-gray-1 rounded-full h-1 mt-1 overflow-hidden">
                <div class="bg-discord-blurple h-1 rounded-full" style="width: ${progressPercent}%"></div>
            </div>`;
        // Keep default icon or use a progress icon?
        iconHTML = `<span class="${progressIconClasses} flex-shrink-0 mr-3">sync</span>`;
    }

    // Data attribute for transfer ID on the container
    return `
        <div class="mt-1 bg-discord-gray-3 p-3 rounded-lg flex items-center file-content" data-transfer-id="${transferId}">
            ${iconHTML}
            <div class="flex-1 min-w-0">
                 <div class="font-medium text-discord-text-link truncate" title="${fileNameEscaped}">${fileNameEscaped}</div>
                 ${statusText}
            </div>
             ${actionHTML}
        </div>
    `;
}

// Updates the progress/status of an existing file message in the UI
export function updateFileMessageProgress(peerId, transferId, progress, downloadUrl = null) {
    const activePeerId = state.getActiveChatPeerId();
    if (peerId !== activePeerId) return; // Only update visible chat

    if (dom.messageList) {
        const messageElement = dom.messageList.querySelector(`[data-message-id="${transferId}"]`);
        if (messageElement) {
            const fileContentElement = messageElement.querySelector('.file-content');
            const isLocal = messageElement.getAttribute('data-sender-id') === state.localUserId;
             // Find fileInfo from message payload if possible, or make a minimal one
            // This assumes the original message object might be needed, but it's complex to retrieve.
            // We can reconstruct the essential parts needed for createFileContentHTML.
            // A better approach might be to store fileInfo in state.incomingFiles more robustly.
            let fileInfo = state.incomingFiles[transferId]?.info || {}; // Get from state if receiver
            if (!fileInfo.name) {
                 // Attempt to get name from existing element if state is unavailable
                const nameElement = fileContentElement?.querySelector('.font-medium');
                 fileInfo.name = nameElement?.title || 'unknown_file';
                 // Guess size? Not ideal.
                 fileInfo.size = fileInfo.size || 0;
            }
             fileInfo.transferId = transferId; // Ensure transferId is set

            if (fileContentElement) {
                 const newContentHTML = createFileContentHTML(fileInfo, isLocal, downloadUrl, progress);
                 // Replace only the file content part
                 fileContentElement.outerHTML = newContentHTML;
            } else {
                 console.warn(`Could not find .file-content within message element for transfer ${transferId}`);
            }
             // Revoke old URL if a new one is provided and different
             const oldUrl = messageElement.dataset.downloadUrl;
             if (oldUrl && downloadUrl && oldUrl !== downloadUrl && activeObjectURLs.has(oldUrl)) {
                 console.log(`[UI Update] Revoking old ObjectURL: ${oldUrl}`);
                 URL.revokeObjectURL(oldUrl);
                 activeObjectURLs.delete(oldUrl);
             }
             // Store new URL if provided
             if (downloadUrl) {
                 messageElement.dataset.downloadUrl = downloadUrl;
             }
        } else {
             console.warn(`Could not find message element for transfer ID: ${transferId} to update progress.`);
        }
    }
}

// --- Contact List / Member List --- // Simplified - now only one list

// Re-renders the entire contact list based on state.contacts
export function renderContactList() {
    if (!dom.contactListDiv) return;

    dom.contactListDiv.innerHTML = ''; // Clear existing list

    const contactsArray = Object.values(state.contacts);
    // Sort contacts? Maybe alphabetically? Optional.
    contactsArray.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

    if (contactsArray.length === 0) {
        dom.contactListDiv.innerHTML = '<p class="text-discord-text-muted text-sm px-3 py-2">还没有联系人。</p>';
        return;
    }

    contactsArray.forEach(contact => {
        const contactElement = createContactItemElement(contact);
        dom.contactListDiv.appendChild(contactElement);
    });
}

// Creates a single contact list item element
function createContactItemElement(contact) {
    const element = document.createElement('div');
    element.className = 'flex items-center space-x-3 px-2 py-1.5 mx-2 rounded cursor-pointer hover:bg-discord-gray-3 group contact-item';
    element.dataset.peerId = contact.id;

    const avatarColor = getAvatarColor(contact.id);
    const avatarText = escapeHTML((contact.name || contact.id).charAt(0).toUpperCase());
    const nameEscaped = escapeHTML(contact.name || contact.id);

    // Status Indicator Logic
    let statusIndicatorHTML;
    let statusTitle;
    if (contact.online === true) {
        statusIndicatorHTML = '<span class="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-discord-green ring-2 ring-discord-gray-1"></span>';
        statusTitle = '在线';
    } else if (contact.online === 'connecting') {
         statusIndicatorHTML = '<span class="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-discord-yellow ring-2 ring-discord-gray-1"></span>'; // Yellow for connecting
         statusTitle = '连接中...';
    } else {
        statusIndicatorHTML = '<span class="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-discord-text-muted ring-2 ring-discord-gray-1 opacity-50 group-hover:opacity-100"></span>'; // Gray for offline
        statusTitle = '离线';
    }

    // Unread Indicator Placeholder (initially hidden)
    const unreadIndicatorHTML = '<span class="bg-discord-red w-2 h-2 rounded-full ml-auto hidden unread-indicator"></span>';

    element.innerHTML = `
        <div class="relative flex-shrink-0">
            <img src="https://placehold.co/32x32/${avatarColor}/ffffff?text=${avatarText}" alt="${nameEscaped} 头像" class="rounded-full" title="${nameEscaped} (${contact.id}) - ${statusTitle}">
            ${statusIndicatorHTML}
        </div>
        <span class="flex-1 text-discord-text-primary truncate font-medium text-sm contact-name">${nameEscaped}</span>
        ${unreadIndicatorHTML}
        <!-- Add delete button? Needs careful implementation -->
        <!-- <button class="delete-contact-btn material-symbols-outlined text-xs text-discord-text-muted hover:text-discord-red ml-auto hidden group-hover:block" title="删除联系人">delete</button> -->
    `;

    // Add click listener to the main element
    element.addEventListener('click', handleContactClick);

    // Optional: Add listener for delete button if implemented
    // const deleteBtn = element.querySelector('.delete-contact-btn');
    // if (deleteBtn) {
    //     deleteBtn.addEventListener('click', (e) => {
    //         e.stopPropagation(); // Prevent contact click event
    //         handleDeleteContact(contact.id);
    //     });
    // }

    return element;
}

// Updates the online status indicator and title for a specific contact in the list
export function updateContactStatusUI(peerId, status) { // status: boolean | 'connecting'
    if (!dom.contactListDiv) return;
    const contactElement = dom.contactListDiv.querySelector(`.contact-item[data-peer-id="${peerId}"]`);
    if (contactElement) {
        const img = contactElement.querySelector('img');
        const statusIndicatorContainer = contactElement.querySelector('.relative'); // Container for avatar + status
        if (!statusIndicatorContainer) return;

        // Remove existing status span
        const existingStatusSpan = statusIndicatorContainer.querySelector('span.absolute');
        if (existingStatusSpan) existingStatusSpan.remove();

        let statusIndicatorHTML = '';
        let statusTitle = '';

        if (status === true) {
            statusIndicatorHTML = '<span class="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-discord-green ring-2 ring-discord-gray-1"></span>';
            statusTitle = '在线';
        } else if (status === 'connecting') {
            statusIndicatorHTML = '<span class="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-discord-yellow ring-2 ring-discord-gray-1"></span>';
            statusTitle = '连接中...';
        } else {
            statusIndicatorHTML = '<span class="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-discord-text-muted ring-2 ring-discord-gray-1 opacity-50 group-hover:opacity-100"></span>';
            statusTitle = '离线';
        }

        statusIndicatorContainer.insertAdjacentHTML('beforeend', statusIndicatorHTML);
        if (img) {
             // Update title attribute on the image
             const name = contactElement.querySelector('.contact-name')?.textContent || peerId;
             img.title = `${name} (${peerId}) - ${statusTitle}`;
        }
        console.log(`Updated UI status for ${peerId} to ${status}`);
    } else {
         console.warn(`Contact element not found for peerId: ${peerId} during status UI update.`);
    }
}

// Shows or hides the unread message indicator for a contact
export function showUnreadIndicator(peerId, show) {
    if (!dom.contactListDiv) return;
    const contactElement = dom.contactListDiv.querySelector(`.contact-item[data-peer-id="${peerId}"]`);
    if (contactElement) {
        const indicator = contactElement.querySelector('.unread-indicator');
        if (indicator) {
            indicator.classList.toggle('hidden', !show);
            console.log(`Set unread indicator for ${peerId} to ${show}`);
        }
    }
}

// Handles clicking on a contact in the list
export async function handleContactClick(event) {
    const targetElement = event.currentTarget; // The div.contact-item
    const clickedPeerId = targetElement.dataset.peerId;
    const currentActivePeerId = state.getActiveChatPeerId();

    if (!clickedPeerId || clickedPeerId === currentActivePeerId) {
         console.log(`Clicked same peer (${clickedPeerId}) or invalid target.`);
        return; // Clicked already active peer or invalid item
    }

    console.log(`Contact clicked: ${clickedPeerId}`);

    // 1. Update State
    state.setActiveChat(clickedPeerId);

    // 2. Update UI Selection Highlight
    // Remove highlight from previously selected contact
    if (currentActivePeerId && dom.contactListDiv) {
        const previousElement = dom.contactListDiv.querySelector(`.contact-item[data-peer-id="${currentActivePeerId}"]`);
        if (previousElement) {
            previousElement.classList.remove('bg-discord-gray-4');
            previousElement.classList.add('hover:bg-discord-gray-3');
        }
    }
    // Add highlight to the newly selected contact
    targetElement.classList.add('bg-discord-gray-4');
    targetElement.classList.remove('hover:bg-discord-gray-3');

    // 3. Clear previous chat state (messages, typing indicator)
    clearMessageList();
    hideActiveTypingIndicator();

    // 4. Update Chat Header
    updateChatHeader(clickedPeerId);

    // 5. Load and Display History for the selected peer
    await connection.loadAndDisplayHistory(clickedPeerId);

    // 6. Mark chat as read (hide unread indicator)
    showUnreadIndicator(clickedPeerId, false);

    // 7. Update input visibility based on the *new* peer's connection status
    updateChatInputVisibility();

    // 8. Update empty state message
    updateEmptyState();

    // 9. Focus input field? (Optional)
    // if (dom.chatInput) dom.chatInput.focus();

     // 10. Check connection status and *potentially* initiate connection if offline? (Decision Point)
     // Option A: Connect automatically if offline when clicked
     /*
     const connectionStatus = state.getConnectionState(clickedPeerId);
     if (connectionStatus !== 'connected' && connectionStatus !== 'connecting') {
         console.log(`Contact ${clickedPeerId} is offline or disconnected. Attempting to connect...`);
         addSystemMessage(`正在尝试连接到 ${state.contacts[clickedPeerId]?.name || clickedPeerId}...`, clickedPeerId);
         try {
             await connection.connectToPeer(clickedPeerId);
             // Connection attempt initiated. UI status will update via events.
         } catch (e) {
              console.error(`Failed to initiate connection via click to ${clickedPeerId}:`, e);
              addSystemMessage(`无法发起与 ${state.contacts[clickedPeerId]?.name || clickedPeerId} 的连接。`, clickedPeerId, true);
         }
     } else {
          console.log(`Contact ${clickedPeerId} is already ${connectionStatus}.`);
     }
     */
     // Option B: Clicking only switches view, connection happens separately (e.g., on receiving offer, or manual connect button)
     // Current implementation follows Option B - clicking contact does *not* auto-connect.
}

// Updates the header of the chat area
function updateChatHeader(peerId) {
    if (!dom.chatHeaderName || !dom.chatHeaderStatus) return;

    if (!peerId) {
        // No active chat
        dom.chatHeaderName.textContent = '选择对话';
        dom.chatHeaderStatus.textContent = '从左侧列表选择一个联系人开始聊天';
        dom.chatHeaderStatus.className = 'text-xs text-discord-text-muted'; // Reset class
        return;
    }

    const contact = state.contacts[peerId];
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

    dom.chatHeaderName.textContent = name;
    dom.chatHeaderStatus.textContent = statusText;
    dom.chatHeaderStatus.className = statusClass;
}

// --- Input Area Visibility ---
export function updateChatInputVisibility(forceVisible = null) {
    if (!dom.chatInputContainer) return;
    let shouldBeVisible = false;

    if (forceVisible !== null) {
        shouldBeVisible = forceVisible;
    } else {
        const activePeerId = state.getActiveChatPeerId();
        if (activePeerId) {
            const connState = state.getConnectionState(activePeerId);
            const dc = state.getDataChannel(activePeerId);
            // Require connection to be fully 'connected' AND data channel to be 'open'
            shouldBeVisible = connState === 'connected' && dc?.readyState === 'open';
        }
    }

    dom.chatInputContainer.classList.toggle('hidden', !shouldBeVisible);

    // Also update chat header when input visibility changes
    updateChatHeader(state.getActiveChatPeerId());
}

// --- Other UI Updates ---

// Display local user ID (e.g., in settings or profile area)
export function displayLocalUserInfo() {
    if (dom.localUserIdSpan) {
        dom.localUserIdSpan.textContent = state.localUserId;
        dom.localUserIdSpan.title = '这是您的唯一ID，分享给朋友以添加您为联系人';
    }
    // Optionally display local user name if configurable
    // const localName = state.contacts[state.localUserId]?.name || state.localUserId;
    // if (dom.localUserNameSpan) { dom.localUserNameSpan.textContent = localName; }

    // Add copy functionality
    const copyButton = dom.localUserIdSpan?.parentElement?.querySelector('button');
    if (dom.localUserIdSpan && copyButton) {
        copyButton.onclick = () => {
            navigator.clipboard.writeText(state.localUserId).then(() => {
                 console.log('Local user ID copied to clipboard!');
                 // Simple visual feedback
                 const originalText = copyButton.innerHTML;
                 copyButton.innerHTML = '<span class="material-symbols-outlined text-sm">check</span>';
                 setTimeout(() => { copyButton.innerHTML = originalText; }, 1500);
            }).catch(err => {
                 console.error('Failed to copy local user ID: ', err);
                 // Show error feedback?
            });
        };
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

// --- Initialization ---
export function initializeUI() {
    console.log("Initializing UI...");
    // Initial render of contact list
    renderContactList();
    // Set initial empty state message
    updateEmptyState();
    // Display local user info
    displayLocalUserInfo();
    // Set initial chat input visibility (hidden)
    updateChatInputVisibility(false);
    // Set initial chat header
     updateChatHeader(null);
    // Clear any leftover typing indicators
    hideActiveTypingIndicator();

    console.log("UI Initialized.");
}

// Call initialization function once DOM is ready (usually done in main.js)
// initializeUI(); 