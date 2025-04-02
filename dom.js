// dom.js

// --- DOM 元素引用 ---
// export const channelLinks = document.querySelectorAll('.channel-link'); // Removed
export const contactsListContainer = document.getElementById('contacts-list-container'); // Added
export const messageInput = document.getElementById('message-input');
export const messageList = document.getElementById('message-list');
export const channelNameHeader = document.getElementById('channel-name');
export const typingIndicator = document.getElementById('typing-indicator');
export const typingUsersSpan = document.getElementById('typing-users');
export const memberListSidebar = document.getElementById('member-list-sidebar');
export const memberListToggleButton = document.getElementById('member-list-toggle-button');
export const onlineCountSpan = document.getElementById('online-count');
export const offlineCountSpan = document.getElementById('offline-count');
export const connectionStatusSpan = document.getElementById('connection-status');
export const localUserIdSpan = document.getElementById('local-user-id');
export const remoteUserIdInput = document.getElementById('remote-user-id-input');
export const connectButton = document.getElementById('connect-button');
// export const chatInputArea = document.querySelector('.px-4.pb-4'); // Old selector
export const chatInputArea = document.querySelector('.chat-input-area'); // Updated selector
export const uploadButton = document.getElementById('upload-button');
export const fileInput = document.getElementById('file-input');
export const emptyMessageListDiv = document.getElementById('empty-message-list');
// Add references for add contact elements
export const addContactButton = document.getElementById('add-contact-button');
export const addContactInput = document.getElementById('add-contact-input');
// Add references for user info at bottom-left if needed for dynamic updates
export const localUsernameDiv = document.querySelector('.local-username'); // Changed selector name
export const localUserTagDiv = document.querySelector('.local-usertag'); // Changed selector name
export const userAvatarSmall = document.querySelector('.user-avatar-small'); // Changed selector name
export const userStatusIndicator = document.querySelector('.user-status-indicator'); // Changed selector name 