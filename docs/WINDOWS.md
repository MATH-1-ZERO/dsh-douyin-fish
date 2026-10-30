# Windows 安装、更新与卸载

推荐在 DSH“添加插件”输入 `https://github.com/MATH-1-ZERO/dsh-douyin-fish` 直接安装，无需运行下方本地脚本。GitHub 安装由宿主管理目录；下方目录保留要求只适用于本地 link 安装。更新第三方 GitHub 插件时，按 DSH 界面提示卸载后重新添加。

## 安装脚本

`scripts/Install-Windows.ps1` 支持 Windows PowerShell 5.1 和 PowerShell 7。自动发现依次检查参数、`DSH_INSTALL_DIR`、常见目录和卸载注册信息。自定义安装位置使用 `-DshPath`，既可传安装目录，也可传 `DeepSeek Harness.exe` 完整路径。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Windows.ps1 -DshPath "D:\Apps\DeepSeek Harness" -CheckOnly
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Windows.ps1 -DshPath "D:\Apps\DeepSeek Harness"
```

`Bypass` 仅对这次 PowerShell 进程生效，不修改系统执行策略。无需管理员权限；受组织策略管控的电脑按实际策略处理。

脚本调用本机桌面包自带 CLI：

```text
dsh plugin --profile desktop add link:<仓库绝对目录> --offline --ignore-scripts
```

通过官方管理器登记 `@local/dsh-douyin-fish` 及 `dsh.bundle`，不手写安装 profile，也不修改 app.asar。无 npm 运行依赖，所以本地安装不需要下载依赖。若官方 CLI 报运行时不兼容、缓存或 pnpm 问题，保留输出；脚本不会自动清空缓存或重建你的 profile。

配置备份保存在 DSH 用户目录 `fish-install-backups/<时间-随机后缀>`。备份可能含本机配置，请勿上传。安装失败时不自动覆盖用户的并发修改；需要回滚时先退出 DSH，再对照备份核对。

## 数据位置

| 内容 | 位置 |
| --- | --- |
| 插件状态、人设、互动台账 | `%USERPROFILE%\.dsh\douyin-fish-local` |
| 专用 Edge 登录资料 | `%USERPROFILE%\.dsh\douyin-fish-public-test` |
| 正式桌面 profile | `%USERPROFILE%\.dsh\profiles\desktop` |

仓库不携带这些目录。安装脚本的 `-DshHome` / `-Profile` 主要用于隔离安装检查；插件实际状态与浏览器仍属于当前 Windows 用户，改变安装 profile 不会隔离运行账号。不要同时运行多个 profile 争用同一浏览器。

Edge 支持机器级及当前用户安装位置，路径从系统环境获取；系统装在非 C 盘也会使用实际 `SystemRoot`。浏览器端口固定 `127.0.0.1:9222`，冲突时先核对占用进程，脚本不会杀掉别的软件。

## 更新

暂停任务、退出 DSH，再 `git pull` 或下载新版本替换源码。保留仓库位置并重跑安装检查，启动后用 `fish_status` 确认实际加载版本。不要把历史 state.json 或别人的已验证账号覆盖到本机。

## 卸载

在 DSH 的插件管理中停用/移除 `@local/dsh-douyin-fish`。若使用 CLI，采用官方 `dsh plugin --profile desktop remove @local/dsh-douyin-fish` 入口；先暂停并退出桌面程序。卸载不应清除聊天、台账或浏览器登录资料。先完成解除链接，再删除仓库目录。
