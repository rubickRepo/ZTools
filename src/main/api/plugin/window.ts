import { ipcMain, webContents } from 'electron'
import pluginWindowManager from '../../core/pluginWindowManager.js'
import windowManager from '../../managers/windowManager.js'
import detachedWindowManager from '../../core/detachedWindowManager.js'

/**
 * 插件独立窗口管理API - 插件专用
 */
export class PluginWindowAPI {
  private pluginManager: any = null
  private mainWindow: Electron.BrowserWindow | null = null

  public init(mainWindow: Electron.BrowserWindow, pluginManager: any): void {
    this.pluginManager = pluginManager
    this.mainWindow = mainWindow
    this.setupIPC()
  }

  private setupIPC(): void {
    // 创建独立窗口
    ipcMain.on(
      'create-browser-window',
      (
        event,
        url: string,
        options: Electron.BrowserWindowConstructorOptions,
        callbackId: string
      ) => {
        const pluginInfo = this.pluginManager.getPluginInfoByWebContents(event.sender)
        if (!pluginInfo) {
          console.error('[PluginWindow] 创建窗口失败: 未找到插件信息')
          event.returnValue = null
          return
        }
        event.returnValue = pluginWindowManager.createWindow(
          pluginInfo.path,
          pluginInfo.name,
          url,
          options,
          callbackId,
          event.sender
        )
      }
    )

    // 窗口方法调用
    ipcMain.handle(
      'browser-window-action',
      (_event, windowId: string, path: string[], args: any[]) => {
        return pluginWindowManager.executeMethod(windowId, path, args)
      }
    )

    ipcMain.handle('browser-window-get-prop', (_event, windowId: string, path: string[]) => {
      return pluginWindowManager.getPropertyByPath(windowId, path)
    })

    ipcMain.on('browser-window-get-prop-sync', (event, windowId: string, path: string[]) => {
      event.returnValue = pluginWindowManager.getPropertyInfo(windowId, path)
    })

    ipcMain.on(
      'browser-window-call-sync',
      (event, windowId: string, path: string[], args: any[]) => {
        event.returnValue = pluginWindowManager.callMethodSync(windowId, path, args)
      }
    )

    ipcMain.handle('browser-window-wait-task', async (_event, taskId: string) => {
      return await pluginWindowManager.waitForTask(taskId)
    })

    // 发送消息到父窗口
    ipcMain.on('send-to-parent', (event, channel: string, ...args: any[]) => {
      pluginWindowManager.sendToParent(event.sender, channel, args)
    })

    // 显示主窗口
    ipcMain.handle('show-main-window', () => {
      windowManager.showWindow()
    })

    // 隐藏主窗口
    ipcMain.handle('hide-main-window', (_event, isRestorePreWindow: boolean = true) => {
      windowManager.hideWindow(isRestorePreWindow)
    })

    // ipcRenderer.sendTo polyfill
    ipcMain.on('ipc-send-to', (_event, webContentsId: number, channel: string, ...args: any[]) => {
      try {
        const targetWebContents = webContents.fromId(webContentsId)
        if (targetWebContents && !targetWebContents.isDestroyed()) {
          targetWebContents.send(channel, ...args)
          console.log(`[PluginWindow] 转发消息: ${channel} -> webContentsId: ${webContentsId}`)
        } else {
          console.warn(`[PluginWindow] 目标 webContents 不存在或已销毁: ${webContentsId}`)
        }
      } catch (error) {
        console.error('[PluginWindow] 转发消息失败:', error)
      }
    })

    // 获取窗口类型（同步方法，供插件使用）
    ipcMain.on('get-window-type', (event) => {
      try {
        const windowType = this.getWindowType(event.sender)
        event.returnValue = windowType
      } catch (error) {
        console.error('[PluginWindow] get-window-type error:', error)
        event.returnValue = 'main' // 默认返回 main
      }
    })
  }

  /**
   * 获取窗口类型
   * @param webContents 调用者的 WebContents
   * @returns 'main' | 'detach' | 'browser'
   */
  private getWindowType(webContents: Electron.WebContents): 'main' | 'detach' | 'browser' {
    // 检查是否是主窗口
    if (this.mainWindow && webContents.id === this.mainWindow.webContents.id) {
      return 'main'
    }

    // 检查是否是分离窗口
    if (detachedWindowManager.isDetachedWindow(webContents)) {
      return 'detach'
    }

    // 检查是否是 browser 窗口
    if (pluginWindowManager.isBrowserWindow(webContents)) {
      return 'browser'
    }

    // 默认返回 main（可能是插件的 WebContentsView）
    return 'main'
  }
}

export default new PluginWindowAPI()
