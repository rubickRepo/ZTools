import { exec } from 'child_process'
import { BrowserWindow, clipboard, shell } from 'electron'
import { promisify } from 'util'
import { GLOBAL_SCROLLBAR_CSS } from '../../core/globalStyles'
import windowManager from '../../managers/windowManager'

interface SystemCommandContext {
  mainWindow: Electron.BrowserWindow | null
  pluginManager: any
}

/**
 * 执行系统内置指令
 */
export async function executeSystemCommand(
  command: string,
  ctx: SystemCommandContext,
  param?: any
): Promise<any> {
  const execAsync = promisify(exec)

  const platform = process.platform

  let cmd = ''

  switch (command) {
    case 'clear':
      return handleClear(ctx)

    case 'reboot':
      if (platform === 'darwin') {
        cmd = 'osascript -e "tell application \\"System Events\\" to restart"'
      } else if (platform === 'win32') {
        cmd = 'shutdown /r /t 0'
      }
      break

    case 'shutdown':
      if (platform === 'darwin') {
        cmd = 'osascript -e "tell application \\"System Events\\" to shut down"'
      } else if (platform === 'win32') {
        cmd = 'shutdown /s /t 0'
      }
      break

    case 'sleep':
      if (platform === 'darwin') {
        cmd = 'osascript -e "tell application \\"System Events\\" to sleep"'
      } else if (platform === 'win32') {
        cmd = 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0'
      }
      break

    case 'search':
      return handleSearch(ctx, param, 'https://www.baidu.com/s?wd=', '百度搜索')

    case 'bing-search':
      return handleSearch(ctx, param, 'https://www.bing.com/search?q=', '必应搜索')

    case 'open-url':
      return handleOpenUrl(ctx, param)

    case 'window-info':
      return handleWindowInfo(ctx)

    case 'copy-path':
      return handleCopyPath(ctx, execAsync)

    case 'open-terminal':
      return handleOpenTerminal(ctx, execAsync)

    default:
      return { success: false, error: `Unknown system command: ${command}` }
  }

  if (!cmd) {
    return { success: false, error: `Unsupported platform: ${platform}` }
  }

  console.log('[SystemCmd] 执行系统命令:', cmd)

  try {
    const { stdout, stderr } = await execAsync(cmd)
    if (stderr) console.error('[SystemCmd] 系统命令错误输出:', stderr)
    if (stdout) console.log('[SystemCmd] 系统命令输出:', stdout)

    ctx.mainWindow?.webContents.send('app-launched')
    ctx.mainWindow?.hide()

    return { success: true }
  } catch (error) {
    console.error('[SystemCmd] 执行系统命令失败:', error)
    return { success: false, error: String(error) }
  }
}

function handleClear(ctx: SystemCommandContext): any {
  console.log('[SystemCmd] 执行 Clear 指令：停止所有插件')
  if (ctx.pluginManager) {
    ctx.pluginManager.killAllPlugins()
  }
  ctx.mainWindow?.webContents.send('app-launched')
  return { success: true }
}

async function handleSearch(
  ctx: SystemCommandContext,
  param: any,
  baseUrl: string,
  label: string
): Promise<any> {
  console.log(`[SystemCmd] 执行${label}:`, param)
  if (param?.payload) {
    const query = encodeURIComponent(param.payload)
    await shell.openExternal(`${baseUrl}${query}`)
    ctx.mainWindow?.webContents.send('app-launched')
    ctx.mainWindow?.hide()
    return { success: true }
  }
  return { success: false, error: '缺少搜索关键词' }
}

async function handleOpenUrl(ctx: SystemCommandContext, param: any): Promise<any> {
  console.log('[SystemCmd] 打开网址:', param)
  if (param?.payload) {
    let url = param.payload.trim()
    if (!url.match(/^https?:\/\//i)) {
      url = `https://${url}`
    }
    await shell.openExternal(url)
    ctx.mainWindow?.webContents.send('app-launched')
    ctx.mainWindow?.hide()
    return { success: true }
  }
  return { success: false, error: '缺少网址' }
}

function handleWindowInfo(ctx: SystemCommandContext): any {
  console.log('[SystemCmd] 执行窗口信息')
  const winInfo = windowManager.getPreviousActiveWindow()

  ctx.mainWindow?.hide()

  const items = [
    { label: '窗口标题', value: winInfo?.title || '未知' },
    { label: '坐标 X', value: winInfo?.x ?? '未知' },
    { label: '坐标 Y', value: winInfo?.y ?? '未知' },
    { label: '窗口宽度', value: winInfo?.width ?? '未知' },
    { label: '窗口高度', value: winInfo?.height ?? '未知' },
    { label: '进程 ID', value: winInfo?.pid ?? '未知' },
    { label: '应用', value: winInfo?.app || '未知' },
    { label: '应用位置', value: winInfo?.appPath || '未知' }
  ]

  const infoRows = items
    .map(
      (item) =>
        `<div class="row"><span class="label">${item.label}</span><span class="value">${item.value}</span></div>`
    )
    .join('')

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: rgba(0, 0, 0, 0.75);
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    -webkit-app-region: drag;
  }
  .container {
    padding: 32px 40px;
    min-width: 420px;
    -webkit-app-region: no-drag;
    user-select: text;
    cursor: text;
  }
  .title {
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 24px;
    color: rgba(255, 255, 255, 0.9);
    letter-spacing: 0.5px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .row:last-child { border-bottom: none; }
  .label {
    color: rgba(255, 255, 255, 0.5);
    font-size: 13px;
    flex-shrink: 0;
    margin-right: 20px;
  }
  .value {
    color: rgba(255, 255, 255, 0.95);
    font-size: 13px;
    font-family: "SF Mono", "Menlo", monospace;
    text-align: right;
    word-break: break-all;
  }
  .hint {
    margin-top: 20px;
    text-align: center;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.3);
  }
</style>
</head>
<body>
  <div class="container">
    <div class="title">窗口信息</div>
    ${infoRows}
    <div class="hint">点击窗口外部区域关闭</div>
  </div>
</body>
</html>`

  const infoWindow = new BrowserWindow({
    width: 500,
    height: 420,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  infoWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

  infoWindow.webContents.on('did-finish-load', () => {
    infoWindow.webContents.insertCSS(GLOBAL_SCROLLBAR_CSS)
  })

  infoWindow.on('blur', () => {
    if (!infoWindow.isDestroyed()) {
      infoWindow.close()
    }
  })

  return { success: true }
}

async function handleCopyPath(
  ctx: SystemCommandContext,
  execAsync: (cmd: string) => Promise<{ stdout: string; stderr: string }>
): Promise<any> {
  console.log('[SystemCmd] 执行复制路径')
  const previousWindow = windowManager.getPreviousActiveWindow()

  if (!previousWindow) {
    return { success: false, error: '无法获取当前窗口信息' }
  }

  if (process.platform === 'darwin') {
    try {
      const script = `
      tell application "Finder"
        if (count of Finder windows) is 0 then
          return POSIX path of (desktop as alias)
        else
          return POSIX path of (target of front window as alias)
        end if
      end tell
    `
      const { stdout } = await execAsync(`osascript -e '${script}'`)
      const folderPath = stdout.trim()
      clipboard.writeText(folderPath)
      console.log('[SystemCmd] 已复制路径:', folderPath)
      ctx.mainWindow?.hide()
      return { success: true, path: folderPath }
    } catch (error) {
      console.error('[SystemCmd] 获取 Finder 路径失败:', error)
      return { success: false, error: String(error) }
    }
  }
  return { success: false, error: `不支持的平台: ${process.platform}` }
}

async function handleOpenTerminal(
  ctx: SystemCommandContext,
  execAsync: (cmd: string) => Promise<{ stdout: string; stderr: string }>
): Promise<any> {
  console.log('[SystemCmd] 执行在终端打开')
  const previousWindow = windowManager.getPreviousActiveWindow()

  if (!previousWindow) {
    return { success: false, error: '无法获取当前窗口信息' }
  }

  if (process.platform === 'darwin') {
    try {
      const script = `
      tell application "Finder"
        if (count of Finder windows) is 0 then
          set folderPath to POSIX path of (desktop as alias)
        else
          set folderPath to POSIX path of (target of front window as alias)
        end if
      end tell

      tell application "Terminal"
        activate
        do script "cd " & quoted form of folderPath
      end tell
    `
      await execAsync(`osascript -e '${script}'`)
      console.log('[SystemCmd] 已在终端打开')
      ctx.mainWindow?.hide()
      return { success: true }
    } catch (error) {
      console.error('[SystemCmd] 在终端打开失败:', error)
      return { success: false, error: String(error) }
    }
  }
  return { success: false, error: `不支持的平台: ${process.platform}` }
}
