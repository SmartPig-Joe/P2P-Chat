# P2P 信令服务器管理指南 (Systemd)

本文档介绍如何使用 `systemctl` 命令管理在服务器上运行的 P2P 信令服务 (`p2p-signaling.service`)。

**注意:** 以下命令通常需要 `sudo` 权限执行。

## 1. 查看服务状态

检查服务当前是否正在运行，以及查看最近的日志摘要：
```bash
sudo systemctl status p2p-signaling.service
```

*   如果看到 `Active: active (running)`，表示服务正在运行。
*   如果看到 `Active: inactive (dead)`，表示服务已停止。
*   如果看到 `Active: failed` 或 `activating (auto-restart)`，表示服务启动失败或遇到问题，需要查看日志。
*   按 `q` 退出状态查看。

## 2. 启动服务

如果服务未运行，可以使用以下命令启动它：

```bash
sudo systemctl start p2p-signaling.service
```

启动后，建议使用 `status` 命令确认服务是否成功运行。

## 3. 停止服务

如果需要临时停止服务：

```bash
sudo systemctl stop p2p-signaling.service
```

停止后，可以使用 `status` 命令确认服务是否已变为 `inactive (dead)`。

## 4. 重启服务

如果修改了配置或代码并重新部署了程序，或者只是想重新启动服务：

```bash
sudo systemctl restart p2p-signaling.service
```

## 5. 查看详细日志 (可选)

如果服务启动失败或运行异常，查看详细日志有助于排查问题：

```bash
# 查看最近的日志
sudo journalctl -u p2p-signaling.service

# 实时跟踪新日志 (-f for follow)
sudo journalctl -u p2p-signaling.service -f
```

*   按 `Ctrl+C` 停止实时跟踪。

---

**补充说明:**

*   该服务已被设置为开机自启 (`enable`)。如果想取消开机自启，可运行 `sudo systemctl disable p2p-signaling.service`。
*   如果想重新启用开机自启，可运行 `sudo systemctl enable p2p-signaling.service`。
