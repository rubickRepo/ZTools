import { BrowserWindow, ipcMain, screen } from 'electron'
import type { PluginManager } from '../../managers/pluginManager'

interface ToastOptions {
  message: string
  type?: 'info' | 'success' | 'warning' | 'error'
  duration?: number // 显示时长(毫秒),默认 3000
  position?: 'top' | 'bottom' // 显示位置,默认 bottom
}

/**
 * Toast 窗口管理器
 */
class ToastManager {
  private toastWindows: BrowserWindow[] = []
  private readonly TOAST_WIDTH = 360
  private readonly TOAST_HEIGHT = 60
  private readonly TOAST_MARGIN = 20
  private readonly DEFAULT_DURATION = 3000

  /**
   * 显示 toast
   */
  public showToast(options: ToastOptions): void {
    const {
      message,
      type = 'info',
      duration = this.DEFAULT_DURATION,
      position = 'bottom'
    } = options

    // 获取主屏幕尺寸
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

    // 计算 toast 位置
    const x = Math.floor((screenWidth - this.TOAST_WIDTH) / 2)
    let y: number

    if (position === 'top') {
      // 顶部显示,考虑已有的 toast
      y = this.TOAST_MARGIN + this.toastWindows.length * (this.TOAST_HEIGHT + 10)
    } else {
      // 底部显示,考虑已有的 toast
      y =
        screenHeight -
        this.TOAST_HEIGHT -
        this.TOAST_MARGIN -
        this.toastWindows.length * (this.TOAST_HEIGHT + 10)
    }

    // 创建 toast 窗口
    const toastWindow = new BrowserWindow({
      width: this.TOAST_WIDTH,
      height: this.TOAST_HEIGHT,
      x,
      y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      focusable: false,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    // 设置窗口级别(macOS)
    if (process.platform === 'darwin') {
      toastWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      toastWindow.setAlwaysOnTop(true, 'screen-saver')
    }

    // 禁用窗口阴影(macOS)
    if (process.platform === 'darwin') {
      toastWindow.setHasShadow(false)
    }

    // 生成 toast HTML
    const html = this.generateToastHTML(message, type)
    toastWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

    // 窗口加载完成后显示
    toastWindow.once('ready-to-show', () => {
      toastWindow.show()

      // 淡入动画
      toastWindow.setOpacity(0)
      let opacity = 0
      const fadeIn = setInterval(() => {
        opacity += 0.1
        if (opacity >= 1) {
          clearInterval(fadeIn)
          toastWindow.setOpacity(1)
        } else {
          toastWindow.setOpacity(opacity)
        }
      }, 30)
    })

    // 保存到窗口列表
    this.toastWindows.push(toastWindow)

    // 自动关闭
    setTimeout(() => {
      this.closeToast(toastWindow)
    }, duration)
  }

  /**
   * 关闭 toast
   */
  private closeToast(toastWindow: BrowserWindow): void {
    if (toastWindow.isDestroyed()) return

    // 淡出动画
    let opacity = 1
    const fadeOut = setInterval(() => {
      opacity -= 0.1
      if (opacity <= 0) {
        clearInterval(fadeOut)
        toastWindow.close()

        // 从列表中移除
        const index = this.toastWindows.indexOf(toastWindow)
        if (index > -1) {
          this.toastWindows.splice(index, 1)
        }
      } else {
        toastWindow.setOpacity(opacity)
      }
    }, 30)
  }

  /**
   * 生成 toast HTML
   */
  private generateToastHTML(message: string, type: string): string {
    // 根据类型选择颜色和图标
    const colors = {
      info: { bg: '#3b82f6', icon: 'ℹ️' },
      success: { bg: '#10b981', icon: '✓' },
      warning: { bg: '#f59e0b', icon: '⚠️' },
      error: { bg: '#ef4444', icon: '✕' }
    }

    const { bg, icon } = colors[type as keyof typeof colors] || colors.info

    // 转义消息中的 HTML 特殊字符
    const escapedMessage = message
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            -webkit-app-region: no-drag;
            overflow: hidden;
          }
          .toast {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 16px 20px;
            background: ${bg};
            border-radius: 12px;
            color: white;
            font-size: 14px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
            backdrop-filter: blur(10px);
          }
          .toast-icon {
            font-size: 20px;
            flex-shrink: 0;
          }
          .toast-message {
            flex: 1;
            word-break: break-word;
            line-height: 1.4;
          }
        </style>
      </head>
      <body>
        <div class="toast">
          <div class="toast-icon">${icon}</div>
          <div class="toast-message">${escapedMessage}</div>
        </div>
      </body>
      </html>
    `
  }

  /**
   * 关闭所有 toast
   */
  public closeAll(): void {
    this.toastWindows.forEach((window) => {
      if (!window.isDestroyed()) {
        window.close()
      }
    })
    this.toastWindows = []
  }
}

// 单例
const toastManager = new ToastManager()

/**
 * Toast API 模块
 */
class PluginToastAPI {
  private pluginManager: PluginManager | null = null

  public init(pluginManager: PluginManager): void {
    this.pluginManager = pluginManager
    this.setupIPC()
  }

  private setupIPC(): void {
    // 显示 toast
    ipcMain.handle('plugin:show-toast', async (event, options: ToastOptions) => {
      try {
        // 验证调用来源
        if (!this.pluginManager) {
          throw new Error('PluginManager not initialized')
        }

        // 可选:获取插件信息用于日志
        const pluginInfo = this.pluginManager.getPluginInfoByWebContents(event.sender)
        if (pluginInfo) {
          console.log(`[Toast] 插件 ${pluginInfo.name} 显示 toast:`, options.message)
        }

        // 显示 toast
        toastManager.showToast(options)

        return { success: true }
      } catch (error) {
        console.error('[Toast] 显示 toast 失败:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })
  }

  /**
   * 关闭所有 toast(供主进程使用)
   */
  public closeAll(): void {
    toastManager.closeAll()
  }
}

export default new PluginToastAPI()
