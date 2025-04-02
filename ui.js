// ui.js
import * as dom from './dom.js';
import * as state from './state.js';
import { escapeHTML, formatTime, mockUsers, getUserColorClass } from './utils.js';

// --- Empty State --- 
export function updateEmptyState() {
    if (!dom.messageList || !dom.emptyMessageListDiv) return;
    const hasMessages = dom.messageList.querySelector('.message-item') !== null;
    if (hasMessages) {
        dom.emptyMessageListDiv.classList.add('hidden');
    } else {
        dom.emptyMessageListDiv.classList.remove('hidden');
    }
}

// --- Connection Status --- 
export function updateConnectionStatus(statusText, statusType = 'neutral') {
    if (dom.connectionStatusSpan) {
        dom.connectionStatusSpan.textContent = statusText;
        let colorClass = 'text-discord-text-muted';
        if (statusType === 'success') colorClass = 'text-discord-green';
        else if (statusType === 'error') colorClass = 'text-discord-red';
        else if (statusType === 'progress') colorClass = 'text-yellow-400';
        dom.connectionStatusSpan.className = `text-xs ml-2 font-semibold ${colorClass}`;
    }

    if (dom.chatInputArea) {
        dom.chatInputArea.style.display = state.isConnected && state.sharedKey ? '' : 'none';
    }

    if (dom.connectButton) {
        dom.connectButton.disabled = state.isConnecting;
        if (state.isConnected) {
            dom.connectButton.textContent = '断开连接';
            dom.connectButton.dataset.action = 'disconnect';
            dom.connectButton.classList.remove('bg-discord-green', 'hover:bg-green-600');
            dom.connectButton.classList.add('bg-discord-red', 'hover:bg-red-600');
            if (dom.remoteUserIdInput) dom.remoteUserIdInput.disabled = true;
        } else {
            dom.connectButton.textContent = '连接';
            dom.connectButton.dataset.action = 'connect';
            dom.connectButton.classList.remove('bg-discord-red', 'hover:bg-red-600');
            dom.connectButton.classList.add('bg-discord-green', 'hover:bg-green-600');
            if (dom.remoteUserIdInput) dom.remoteUserIdInput.disabled = !(state.ws?.readyState === WebSocket.OPEN);
            dom.connectButton.disabled = !(state.ws?.readyState === WebSocket.OPEN) || state.isConnecting; // Also disable if connecting
        }
    }
    populateMemberList(); // Update member list whenever connection status changes
}

// --- System Messages --- 
export function addSystemMessage(text, isError = false) {
    const colorClass = isError ? 'text-discord-red' : 'text-discord-text-muted';
    const messageHTML = `<div class="flex justify-center items-center my-2"><span class="text-xs ${colorClass} px-2 py-0.5 bg-discord-gray-2 rounded-full">${escapeHTML(text)}</span></div>`;
    if (dom.messageList) {
        dom.messageList.insertAdjacentHTML('beforeend', messageHTML);
        dom.messageList.scrollTop = dom.messageList.scrollHeight;
    }
}

// --- Chat Messages --- 
function renderMessageContent(text) {
    const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
    return escapeHTML(text).replace(urlRegex, function(url) {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-discord-text-link hover:underline">${url}</a>`;
    });
}

function createP2PMessageHTML(msgData) {
    const sender = msgData.isLocal ? mockUsers[0] : (mockUsers.find(u => u.id === state.remoteUserId) || { name: state.remoteUserId || '远程用户', avatar: '99aab5' });
    const avatarColor = sender?.avatar || '5865f2';
    const userColorClass = msgData.isLocal ? getUserColorClass(sender.name) : 'text-yellow-400'; // Example: Remote user yellow
    const timeString = formatTime(new Date(msgData.timestamp));
    const lockIcon = state.sharedKey ? '<span class="lucide text-xs ml-1 text-discord-green" title="端到端加密">&#xe297;</span>' : '';

    return (
       `<div class="flex items-start space-x-3 group message-item py-1 pr-4 hover:bg-discord-gray-4/30 rounded">
            <img src="https://placehold.co/40x40/${avatarColor}/ffffff?text=${escapeHTML(sender.name.charAt(0).toUpperCase())}" alt="${escapeHTML(sender.name)} 头像" class="rounded-full mt-1 flex-shrink-0 cursor-pointer" title="${escapeHTML(sender.name)}" onerror="this.src='https://placehold.co/40x40/2c2f33/ffffff?text=Err'">
            <div class="flex-1">
                <div class="flex items-baseline space-x-2">
                    <span class="${userColorClass} font-medium hover:underline cursor-pointer">${escapeHTML(sender.name)}</span>
                    <span class="text-xs text-discord-text-muted message-timestamp" title="${new Date(msgData.timestamp).toLocaleString('zh-CN')}">${timeString}</span>
                    ${lockIcon}
                </div>
                <p class="text-discord-text-primary text-sm message-content">${renderMessageContent(msgData.text)}</p>
            </div>
        </div>`
    );
}

export function addP2PMessageToList(msgData) {
    if (dom.messageList) {
        const messageElement = document.createElement('div');
        messageElement.innerHTML = createP2PMessageHTML(msgData);
        if (messageElement.firstElementChild) {
            dom.messageList.appendChild(messageElement.firstElementChild);
        }
        dom.messageList.scrollTop = dom.messageList.scrollHeight;
        updateEmptyState();
    }
}

// --- Typing Indicator --- 
export function showTypingIndicator() {
    if (!dom.typingIndicator || !dom.typingUsersSpan || !state.isConnected) return; // Don't show if disconnected
    const remoteName = mockUsers.find(u => u.id === state.remoteUserId)?.name || state.remoteUserId || '对方';
    dom.typingUsersSpan.textContent = escapeHTML(remoteName);
    dom.typingIndicator.classList.remove('hidden');
    dom.typingIndicator.classList.add('flex');
    state.setPeerIsTyping(true);
}

export function hideTypingIndicator() {
    if (!dom.typingIndicator) return;
    dom.typingIndicator.classList.add('hidden');
    dom.typingIndicator.classList.remove('flex');
    state.setPeerIsTyping(false);
}

// --- File Messages --- 
function createFileMessageHTML(fileInfo, isLocal, downloadUrl = null, progress = 0) {
    const sender = isLocal ? mockUsers[0] : (mockUsers.find(u => u.id === state.remoteUserId) || { name: state.remoteUserId || '远程用户', avatar: '99aab5' });
    const avatarColor = sender?.avatar || '5865f2';
    const userColorClass = isLocal ? getUserColorClass(sender.name) : 'text-yellow-400'; // Example: Remote user yellow
    const timeString = formatTime(new Date(fileInfo.timestamp || Date.now()));
    const fileSizeMB = (fileInfo.size / 1024 / 1024).toFixed(2);
    const fileNameEscaped = escapeHTML(fileInfo.name);
    const transferId = fileInfo.transferId;

    let fileContentHTML;
    if (downloadUrl) {
        // Receiver's completed state with download link
        fileContentHTML = `
            <div class="mt-1 bg-discord-gray-4 p-3 rounded-discord flex items-center space-x-3">
                <span class="lucide text-3xl text-discord-text-muted">&#xe1b8;</span> <!-- File icon -->
                <div class="flex-1">
                    <a href="${downloadUrl}" download="${fileNameEscaped}" class="text-discord-text-link hover:underline font-medium">${fileNameEscaped}</a>
                    <div class="text-xs text-discord-text-muted">${fileSizeMB} MB</div>
                </div>
                <a href="${downloadUrl}" download="${fileNameEscaped}" class="text-discord-text-muted hover:text-white" title="下载">
                    <span class="lucide text-xl">&#xe195;</span> <!-- Download icon -->
                </a>
            </div>`;
    } else if (isLocal && progress >= 1) {
        // Sender's completed state
         fileContentHTML = `
            <div class="mt-1 bg-discord-gray-4 p-3 rounded-discord">
                <div class="flex items-center space-x-3">
                    <span class="lucide text-3xl text-discord-text-muted">&#xe1b8;</span> <!-- File icon -->
                    <div class="flex-1">
                        <span class="text-discord-text-primary font-medium">${fileNameEscaped}</span>
                        <div class="text-xs text-discord-text-muted">${fileSizeMB} MB - 已发送</div>
                    </div>
                     <span class="lucide text-xl text-discord-green">&#xe07a;</span> <!-- Check icon for sent -->
                </div>
            </div>`;
    } else {
        // Progress indicator state (sender or receiver)
        const progressPercent = Math.round(progress * 100);
        const statusText = isLocal ? '发送中...' : '接收中...';
        fileContentHTML = `
            <div class="mt-1 bg-discord-gray-4 p-3 rounded-discord">
                <div class="flex items-center space-x-3 mb-1">
                    <span class="lucide text-3xl text-discord-text-muted">&#xe1b8;</span> <!-- File icon -->
                    <div class="flex-1">
                        <span class="text-discord-text-primary font-medium">${fileNameEscaped}</span>
                        <div class="text-xs text-discord-text-muted">${fileSizeMB} MB - ${statusText}</div>
                    </div>
                </div>
                <div class="w-full bg-discord-gray-1 rounded-full h-1.5">
                    <div class="bg-discord-blurple h-1.5 rounded-full" style="width: ${progressPercent}%" id="progress-${transferId}"></div>
                </div>
            </div>`;
    }

    return (
       `<div class="flex items-start space-x-3 group message-item py-1 pr-4 hover:bg-discord-gray-4/30 rounded" id="file-msg-${transferId}">
            <img src="https://placehold.co/40x40/${avatarColor}/ffffff?text=${escapeHTML(sender.name.charAt(0).toUpperCase())}" alt="${escapeHTML(sender.name)} 头像" class="rounded-full mt-1 flex-shrink-0 cursor-pointer" title="${escapeHTML(sender.name)}" onerror="this.src='https://placehold.co/40x40/2c2f33/ffffff?text=Err'">
            <div class="flex-1">
                <div class="flex items-baseline space-x-2">
                    <span class="${userColorClass} font-medium hover:underline cursor-pointer">${escapeHTML(sender.name)}</span>
                    <span class="text-xs text-discord-text-muted message-timestamp" title="${new Date(fileInfo.timestamp || Date.now()).toLocaleString('zh-CN')}">${timeString}</span>
                </div>
                ${fileContentHTML}
            </div>
        </div>`
    );
}

export function addFileMessageToList(fileInfo, isLocal, downloadUrl = null, progress = 0) {
    if (dom.messageList) {
        const transferId = fileInfo.transferId;
        const existingElement = document.getElementById(`file-msg-${transferId}`);

        if (existingElement) {
            // Update existing message
            if (downloadUrl) {
                // Receiver completed: Replace with download link version
                 existingElement.outerHTML = createFileMessageHTML(fileInfo, isLocal, downloadUrl);
            } else if (isLocal && progress >= 1) {
                 // Sender completed: Replace with "Sent" version
                 existingElement.outerHTML = createFileMessageHTML(fileInfo, isLocal, null, progress); // progress = 1 here
            } else {
                // Progress update (sender or receiver): Only update the progress bar width
                const progressBar = document.getElementById(`progress-${transferId}`);
                if (progressBar) {
                    const progressPercent = Math.round(progress * 100);
                    progressBar.style.width = `${progressPercent}%`;
                    // Optional: Could update status text here too if needed
                }
            }
        } else {
            // Add new message (initial display)
            const messageElement = document.createElement('div');
            messageElement.innerHTML = createFileMessageHTML(fileInfo, isLocal, downloadUrl, progress);
            if (messageElement.firstElementChild) {
                dom.messageList.appendChild(messageElement.firstElementChild);
            }
        }
        dom.messageList.scrollTop = dom.messageList.scrollHeight;
        updateEmptyState();
    }
}

// --- Member List --- 
export function toggleMemberList() {
    if (dom.memberListSidebar) {
        dom.memberListSidebar.classList.toggle('hidden');
        dom.memberListToggleButton?.classList.toggle('text-white');
    }
}

export function populateMemberList() {
    const onlineList = dom.memberListSidebar?.querySelector('.space-y-2:nth-of-type(1)');
    const offlineList = dom.memberListSidebar?.querySelector('.space-y-2:nth-of-type(2)');
    if (!onlineList || !offlineList || !dom.onlineCountSpan || !dom.offlineCountSpan) {
        console.warn("Member list elements not found for population.");
        return;
    }
    onlineList.innerHTML = '';
    offlineList.innerHTML = '';
    let onlineCount = 0;
    let offlineCount = 0;

    // Ensure local user is always in the list and updated
    const localUserIndex = mockUsers.findIndex(u => u.id === state.localUserId);
    if (localUserIndex !== -1) {
        mockUsers[localUserIndex].name = state.localUserId;
        mockUsers[localUserIndex].status = 'online';
    } else {
        // If the initial user ID wasn't 'user1', add the current local user
        mockUsers[0].id = state.localUserId;
        mockUsers[0].name = state.localUserId;
        mockUsers[0].status = 'online';
    }

    // Update remote user status in the mock list
    const remoteMockUserIndex = mockUsers.findIndex(u => u.id === state.remoteUserId);
    if (remoteMockUserIndex !== -1) {
        mockUsers[remoteMockUserIndex].status = state.isConnected ? 'online' : 'offline';
    } // If remote user isn't in mockUsers, they won't be shown anyway, which is fine.

    mockUsers.forEach(user => {
        const isUserOnline = user.id === state.localUserId || (user.id === state.remoteUserId && state.isConnected);
        const statusIndicatorClass = isUserOnline ? 'bg-discord-green' : 'bg-gray-500';
        const listToAdd = isUserOnline ? onlineList : offlineList;
        const opacityClass = isUserOnline ? '' : 'opacity-50';
        const nameColorClass = user.colorClass || getUserColorClass(user.name);
        const userHTML = `
            <div class="flex items-center space-x-2 group cursor-pointer p-1 rounded-discord hover:bg-discord-gray-4 ${opacityClass}">
                <div class="relative">
                    <img src="https://placehold.co/32x32/${user.avatar}/ffffff?text=${escapeHTML(user.name.charAt(0).toUpperCase())}" alt="${escapeHTML(user.name)} 头像" class="rounded-full" onerror="this.src='https://placehold.co/32x32/2c2f33/ffffff?text=Err'">
                    <span class="absolute bottom-0 right-0 block h-3 w-3 ${statusIndicatorClass} border-2 border-discord-gray-2 rounded-full"></span>
                </div>
                <span class="text-sm ${nameColorClass} font-medium group-hover:text-white truncate" title="${escapeHTML(user.name)}">${escapeHTML(user.name)}</span>
            </div>`;
        listToAdd.innerHTML += userHTML;
        if (isUserOnline) onlineCount++;
        else offlineCount++;
    });

    dom.onlineCountSpan.textContent = onlineCount;
    dom.offlineCountSpan.textContent = offlineCount;
} 