import { globalShortcut } from 'electron'
import { platform } from '@electron-toolkit/utils'
import databaseAPI from '../api/shared/database'

export type DevToolsMode = 'right' | 'bottom' | 'undocked' | 'detach'

/**
 * 从数据库读取开发者工具默认位置配置
 */
export async function getDevToolsMode(): Promise<DevToolsMode> {
  try {
    const data = await databaseAPI.dbGet('settings-general')
    return (data?.devToolsMode as DevToolsMode) || 'detach'
  } catch {
    return 'detach'
  }
}

/**
 * 开发者工具快捷键管理器
 * 用于确保 DevTools 快捷键 (Option+Command+I / Ctrl+Shift+I) 只在相关窗口聚焦时生效，
 * 并且只针对当前聚焦的 webContents 打开。
 */
class DevToolsShortcutManager {
  private currentTarget: Electron.WebContents | null = null
  private readonly shortcut = platform.isMacOS ? 'Option+Command+I' : 'Ctrl+Shift+I'

  /**
   * 注册当前焦点的 DevTools 快捷键
   * @param target 需要打开开发者工具的 WebContents
   */
  public register(target: Electron.WebContents): void {
    // 如果已经注册且目标相同，无需重复注册
    if (this.currentTarget?.id === target.id && globalShortcut.isRegistered(this.shortcut)) {
      return
    }

    // 先注销可能存在的旧注册
    this.unregister()

    this.currentTarget = target

    // 注册全局快捷键
    const ret = globalShortcut.register(this.shortcut, async () => {
      if (this.currentTarget && !this.currentTarget.isDestroyed()) {
        console.log(`[DevTools] 触发开发者工具快捷键，目标: ${this.currentTarget.id}`)
        if (this.currentTarget.isDevToolsOpened()) {
          this.currentTarget.closeDevTools()
        } else {
          const mode = await getDevToolsMode()
          this.currentTarget.openDevTools({ mode })
        }
      }
    })

    if (!ret) {
      console.error(`[DevTools] 开发者工具快捷键注册失败: ${this.shortcut}`)
    }
  }

  /**
   * 注销快捷键
   */
  public unregister(): void {
    if (globalShortcut.isRegistered(this.shortcut)) {
      globalShortcut.unregister(this.shortcut)
    }
    this.currentTarget = null
  }
}

export default new DevToolsShortcutManager()
