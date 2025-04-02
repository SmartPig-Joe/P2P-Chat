// utils.js

// HTML 实体转义
export function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// 格式化时间 HH:MM
export function formatTime(date) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// --- 模拟数据 (暂时放在这里，之后可能需要移到更合适的地方或替换为真实数据) ---
export const mockUsers = [
    { id: "user1", name: "用户名", avatar: "5865f2", status: "online" },
    { id: "user2", name: "用户B", avatar: "43b581", status: "offline", colorClass: "text-green-400" },
    { id: "user3", name: "用户C", avatar: "f04747", status: "offline", colorClass: "text-red-400" },
    { id: "user4", name: "用户D", avatar: "99aab5", status: "offline", colorClass: "text-discord-text-muted" },
    { id: "admin", name: "管理员", avatar: "f1c40f", status: "offline" },
];

// 根据用户名获取颜色类（用于消息显示）
export function getUserColorClass(username) {
    const user = mockUsers.find(u => u.name === username);
    if (user && user.colorClass) return user.colorClass;
    const colors = ['text-white', 'text-green-400', 'text-red-400', 'text-yellow-400', 'text-blue-400', 'text-purple-400', 'text-pink-400'];
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
        hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash % colors.length)];
} 