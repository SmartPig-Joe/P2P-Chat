// ui/profile.js
import * as dom from '/src/dom.js';
import * as state from '/src/state.js';
import { escapeHTML } from '/src/utils.js';
import { getAvatarColor } from './main.js'; // Import from ui/main.js
import { renderContactList } from './contactList.js'; // Needed to update self name/avatar
import { loadAndDisplayHistory } from '/src/connection.js'; // Needed to update messages


// Display local user ID (e.g., in settings or profile area)
export function displayLocalUserInfo() {
    console.log("[Debug] displayLocalUserInfo called. Checking dom.localUserInfoDiv:", dom.localUserInfoDiv);
    if (dom.localUserInfoDiv) {
        const userId = state.localUserId;
        // If userId is not available yet, wait or return
        if (!userId) {
            console.log("[Debug] localUserId not available yet in displayLocalUserInfo.");
            // Optionally set a loading state?
            dom.localUserInfoDiv.innerHTML = '<div class="p-4 text-sm text-discord-text-muted">加载用户信息...</div>';
            return;
        }

        const nickname = state.localUserNickname || userId; // Fallback to userId if nickname is unset
        const avatar = state.localUserAvatar || 'default_avatar.png'; // Fallback avatar

        console.log(`[Debug] User info data: ID=${userId}, Nickname=${nickname}, Avatar=${avatar}`);

        const avatarPlaceholderColor = getAvatarColor(userId);
        const avatarPlaceholderText = escapeHTML(nickname.charAt(0).toUpperCase());
        const avatarSrc = (avatar && avatar !== 'default_avatar.png' && (avatar.startsWith('http:') || avatar.startsWith('https:') || avatar.startsWith('blob:'))) // Allow blob URLs too
            ? escapeHTML(avatar)
            : `https://placehold.co/40x40/${avatarPlaceholderColor}/ffffff?text=${avatarPlaceholderText}`;

        const userInfoHTML = `
            <div class="flex items-center space-x-3 p-2 hover:bg-discord-gray-5/30 rounded relative group">
                 <img src="${avatarSrc}" alt="本地用户头像" class="w-10 h-10 rounded-full bg-discord-gray-4 object-cover" onerror="this.src='https://placehold.co/40x40/2c2f33/ffffff?text=Err'">
                 <div class="flex-1 min-w-0">
                    <div class="font-semibold text-discord-text-primary truncate" title="${escapeHTML(nickname)}">${escapeHTML(nickname)}</div>
                    <div class="text-xs text-discord-text-muted truncate" title="${userId}">ID: ${userId} <button id="copy-user-id-btn" class="ml-1 text-xs text-discord-text-link hover:text-discord-text-link-hover opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100" title="复制 ID"><span class="material-symbols-outlined text-sm align-middle">content_copy</span></button></div>
                 </div>
                 <button id="edit-profile-btn" class="ml-auto p-1 text-discord-text-muted hover:text-discord-text-primary opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100" title="编辑个人资料">
                     <span class="material-symbols-outlined text-lg align-middle">edit</span>
                 </button>
            </div>
        `;

        console.log("[Debug] Generated userInfoHTML:", userInfoHTML);
        dom.localUserInfoDiv.innerHTML = userInfoHTML;

        // Add event listener for copy button
        const copyBtn = dom.localUserInfoDiv.querySelector('#copy-user-id-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(userId)
                    .then(() => {
                        console.log('User ID copied to clipboard');
                        const originalText = copyBtn.innerHTML;
                        copyBtn.innerHTML = '<span class="material-symbols-outlined text-sm align-middle text-discord-green">check</span>';
                        setTimeout(() => { copyBtn.innerHTML = originalText; }, 1500);
                    })
                    .catch(err => {
                        console.error('Failed to copy user ID: ', err);
                        alert('复制失败: ' + err);
                    });
            });
        }

        // Add event listener for edit profile button
        const editBtn = dom.localUserInfoDiv.querySelector('#edit-profile-btn');
        if (editBtn) {
            editBtn.addEventListener('click', (e) => {
                 e.stopPropagation();
                showProfileEditModal();
            });
        }

    } else {
        // Don't log error here if called early during init before DOM is ready
    }
}

// --- Profile Editing Elements and Logic ---

export function createProfileEditSectionHTML() {
    // Check if modal already exists to prevent duplicates during HMR or re-initialization
    if (document.getElementById('profile-edit-modal')) {
        return ''; // Return empty string if already exists
    }
    return `
        <div id="profile-edit-modal" class="hidden fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
            <div class="bg-discord-gray-2 p-6 rounded-lg shadow-xl max-w-sm w-full">
                <h3 class="text-lg font-semibold mb-4 text-discord-text-primary">编辑个人资料</h3>
                <div class="mb-4">
                    <label for="nickname-input" class="block text-sm font-medium text-discord-text-muted mb-1">昵称</label>
                    <input type="text" id="nickname-input" class="w-full p-2 bg-discord-gray-3 border border-discord-gray-5 rounded text-discord-text-primary focus:outline-none focus:ring-2 focus:ring-discord-blurple">
                </div>
                <div class="mb-6">
                    <label for="avatar-url-input" class="block text-sm font-medium text-discord-text-muted mb-1">头像 URL</label>
                    <input type="url" id="avatar-url-input" placeholder="https://example.com/avatar.png 或留空使用默认" class="w-full p-2 bg-discord-gray-3 border border-discord-gray-5 rounded text-discord-text-primary focus:outline-none focus:ring-2 focus:ring-discord-blurple">
                     <p class="text-xs text-discord-text-muted mt-1">输入有效的图像 URL。清空以使用默认头像。</p>
                </div>
                <div class="flex justify-end space-x-3">
                    <button id="cancel-profile-edit-btn" class="px-4 py-2 bg-discord-gray-4 hover:bg-discord-gray-5 text-discord-text-primary rounded transition duration-150">取消</button>
                    <button id="save-profile-edit-btn" class="px-4 py-2 bg-discord-blurple hover:bg-discord-blurple-dark text-white rounded transition duration-150">保存</button>
                </div>
            </div>
        </div>
    `;
}

export function showProfileEditModal() {
    const modal = document.getElementById('profile-edit-modal');
    const nicknameInput = document.getElementById('nickname-input');
    const avatarInput = document.getElementById('avatar-url-input');

    if (!modal || !nicknameInput || !avatarInput) {
        console.error("Profile edit modal elements not found!");
        return;
    }

    // Populate with current values
    nicknameInput.value = state.localUserNickname || ''; // Use empty string if null/undefined
    avatarInput.value = state.localUserAvatar && state.localUserAvatar !== 'default_avatar.png' ? state.localUserAvatar : '';

    modal.classList.remove('hidden');
     nicknameInput.focus(); // Focus nickname input when opening
}

export function hideProfileEditModal() {
    const modal = document.getElementById('profile-edit-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

export function handleProfileSave() {
    const nicknameInput = document.getElementById('nickname-input');
    const avatarInput = document.getElementById('avatar-url-input');

    if (!nicknameInput || !avatarInput) {
        console.error("Cannot save profile: Input elements not found.");
        hideProfileEditModal();
        return;
    }

    const newNickname = nicknameInput.value.trim();
    let newAvatar = avatarInput.value.trim();

    // Validate Nickname (must not be empty)
    if (!newNickname) {
         alert("昵称不能为空。");
         nicknameInput.focus();
         return; // Keep modal open
    }
    state.setLocalNickname(newNickname);


    // Validate and set Avatar
    if (newAvatar) {
        try {
            // Basic check for http/https, allow empty string
            const url = new URL(newAvatar); // Use URL constructor for better validation
             if (!['http:', 'https:', 'blob:'].includes(url.protocol)) {
                throw new Error("Invalid protocol");
             }
            state.setLocalAvatar(newAvatar);
        } catch (e) {
             console.warn("Invalid Avatar URL provided:", newAvatar, e);
             alert("请输入有效的头像 URL (例如以 http:// 或 https:// 开头)。");
             avatarInput.focus();
             return; // Keep modal open
        }
    } else {
        // If input is empty, set to default
        state.setLocalAvatar('default_avatar.png');
    }

    hideProfileEditModal();
    displayLocalUserInfo(); // Re-render user info panel immediately
    // Re-render contact list might be needed if self-view is ever added, but currently not essential
    // renderContactList();
    // Re-render active chat messages if local user sent messages to reflect avatar/name change
    const activePeerId = state.getActiveChatPeerId();
    if(activePeerId) {
         // Use connection.loadAndDisplayHistory as it re-renders messages
        console.log("Reloading active chat history to reflect profile changes...");
        loadAndDisplayHistory(activePeerId);
    }

    // TODO: Trigger broadcastProfileUpdate() here via connection module if implemented
    // connection.broadcastProfileUpdate({ nickname: state.localUserNickname, avatar: state.localUserAvatar });
     console.log("Profile updated. Broadcast update if implemented.");
}