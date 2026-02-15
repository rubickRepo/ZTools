import { ipcMain } from 'electron'
import { WindowManager } from '../../core/native/index.js'

/**
 * 输入事件API - 插件专用
 */
export class PluginInputAPI {
  private pluginManager: any = null

  public init(pluginManager: any): void {
    this.pluginManager = pluginManager
    this.setupIPC()
  }

  private setupIPC(): void {
    // 发送输入事件到插件
    ipcMain.handle(
      'send-input-event',
      (
        _event,
        inputEvent:
          | Electron.MouseInputEvent
          | Electron.MouseWheelInputEvent
          | Electron.KeyboardInputEvent
      ) => this.sendInputEvent(inputEvent)
    )

    // 模拟键盘按键
    ipcMain.on('simulate-keyboard-tap', (event, key: string, modifiers: string[]) => {
      event.returnValue = this.simulateKeyboardTap(key, modifiers)
    })

    // 检查当前插件是否处于开发模式
    ipcMain.on('is-dev', (event) => {
      event.returnValue = this.pluginManager.isPluginDev(event.sender.id)
    })

    // 获取当前 WebContents ID
    ipcMain.on('get-web-contents-id', (event) => {
      event.returnValue = event.sender.id
    })
  }

  private sendInputEvent(
    inputEvent:
      | Electron.MouseInputEvent
      | Electron.MouseWheelInputEvent
      | Electron.KeyboardInputEvent
  ): { success: boolean; error?: string } {
    try {
      if (this.pluginManager) {
        const result = this.pluginManager.sendInputEvent(inputEvent)
        if (result) {
          return { success: true }
        } else {
          return { success: false, error: '没有活动的插件' }
        }
      }
      return { success: false, error: '功能不可用' }
    } catch (error: unknown) {
      console.error('[PluginInput] 发送输入事件失败:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误'
      }
    }
  }

  private simulateKeyboardTap(key: string, modifiers: string[] = []): boolean {
    try {
      return WindowManager.simulateKeyboardTap(key, ...modifiers)
    } catch (error: unknown) {
      console.error('[PluginInput] 模拟键盘按键失败:', error)
      return false
    }
  }
}

export default new PluginInputAPI()
