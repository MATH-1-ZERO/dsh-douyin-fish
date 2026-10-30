# dev.19 Windows 发布验收

2026-10-30，基于 DeepSeek Harness 0.2.1-rc.2 Windows x64 / Node.js 24.21.0。

| 检查 | 结果 |
| --- | --- |
| dev.19 控制台启动兼容 | Windows 优先直接启动已安装 Edge；无 Edge 时检查系统打开命令退出结果；设置页始终提供可选中地址和复制按钮。419项测试通过，覆盖启动失败与剪贴板拒绝回退。尚未在报错的另一台设备现场确认 |
| 免 Git 地址安装 | 隔离进程 PATH 仅含 Windows 系统目录与 Node，确认找不到 git；官方 CLI 使用仓库 main.tar.gz 地址下载安装 dev.18 并合成 bundle 配置成功 |
| GitHub 地址安装 | 官方 DSH CLI 使用 https://github.com/MATH-1-ZERO/dsh-douyin-fish，在隔离 DSH_HOME / github-check profile 下载并安装 dev.18，登记 bundle 并合成配置成功 |
| 安装产物 | 实际下载包的 src/index.js 可导入、client 导出正确，配置、人设、控制台资源和工具说明均存在，tests 不进入安装包 |
| 目录重构 | src/、src/browser/、tests/unit/、tests/browser/、config/、docs/ 按用途分层，重构后416项测试通过 |
| 自动化回归 | 416项通过，0失败、0跳过；不触发真实发送 |
| Windows PowerShell 5.1 | 安装位置检查、官方 CLI 版本查询通过 |
| 实际安装 | 使用桌面包自带正式 CLI，在隔离 DSH_HOME 内安装本地链接并登记 bundle；包含中文和空格路径 |
| 原环境保护 | 原桌面 package.json、cordis.patch.yml、插件 state.json 的 SHA-256 前后一致 |
| 首次配置 | 合成测试验证空状态导入人设、两次稳定公开身份读取后绑定、不同主人拒绝覆盖、失败不写 verified |
| 路径兼容 | 测试覆盖非 C 盘 SystemRoot 与当前用户 Edge 路径 |
| 打包检查 | 发布清单存在、主人为空、作息关闭、无状态/浏览器资料/已保存访问片段 |

dev.16 已完成的真实宿主控制台启动/建立基线/暂停和主人会话读取属于此前开发验证，**没有把作者私有状态打包到本仓库**。本版本新主人绑定使用合成页面测试，不使用作者账号冒充新用户首次配置验收。

隔离安装没有启动真实机器人、登录抖音或向外发送消息。指定联系人真实持续收件、原生卡片、自动评论、多视频长期循环仍需新用户在自己的账号逐项验证。

本仓库是源码开发预览版；不声明支持所有 DSH 版本、所有抖音页面或无人干预长期稳定运行。完整技术测试可在本机运行 `npm test` 与 `npm run check`，无需真实账号。
