/**
 * zbrowser 窗口池管理器
 *
 * 管理每个插件的 zbrowser 空闲窗口和独立 Session。
 *
 * 职责：
 * - 为每个插件创建并缓存独立的 Electron Session（分区键 `<pluginName.zbrowser>`）
 * - 维护每个插件的空闲窗口 ID 列表
 * - 提供代理设置和缓存清理接口
 */

import { BrowserWindow, session } from 'electron'
import type { ZBrowserIdleWindowInfo } from './types'

class ZBrowserManager {
  /** 每个插件的空闲窗口 ID 列表（pluginName → windowId[]） */
  private idleWindowIds: Map<string, number[]> = new Map()

  /** 每个插件的 zbrowser Session 缓存（pluginName → Session） */
  private sessionPool: Map<string, Electron.Session> = new Map()

  /**
   * 获取或创建插件的 zbrowser 专用 Session
   *
   * 使用 `<pluginName.zbrowser>` 作为分区名，
   * 与插件自身的 `persist:pluginName` 隔离。
   *
   * @param pluginName 插件名称
   * @returns Electron Session 实例
   */
  getOrCreateSession(pluginName: string): Electron.Session {
    let sess = this.sessionPool.get(pluginName)
    if (!sess) {
      const partition = `${pluginName}.zbrowser`
      sess = session.fromPartition(partition)
      this.sessionPool.set(pluginName, sess)
      console.log(`[zbrowser] 为插件 "${pluginName}" 创建 Session（分区: ${partition}）`)
    }
    return sess
  }

  /**
   * 获取插件的空闲窗口 ID 列表
   *
   * 会自动清理已销毁的窗口。
   *
   * @param pluginName 插件名称
   * @returns 空闲窗口 ID 数组
   */
  getIdleWindowIds(pluginName: string): number[] {
    const ids = this.idleWindowIds.get(pluginName)
    if (!ids) return []
    // 清理已销毁的窗口
    const validIds = ids.filter((id) => {
      const win = BrowserWindow.fromId(id)
      return win && !win.isDestroyed()
    })
    this.idleWindowIds.set(pluginName, validIds)
    return validIds
  }

  /**
   * 获取插件的空闲窗口详细信息
   *
   * 供 getIdleUBrowsers API 返回给插件使用。
   *
   * @param pluginName 插件名称
   * @returns 空闲窗口信息数组（id、标题、URL）
   */
  getIdleWindows(pluginName: string): ZBrowserIdleWindowInfo[] {
    const ids = this.getIdleWindowIds(pluginName)
    return ids
      .map((id) => {
        const win = BrowserWindow.fromId(id)
        if (!win || win.isDestroyed()) return null
        return {
          id: win.id,
          title: win.getTitle(),
          url: win.webContents.getURL()
        }
      })
      .filter((info): info is ZBrowserIdleWindowInfo => info !== null)
  }

  /**
   * 将窗口添加到插件的空闲池
   *
   * @param pluginName 插件名称
   * @param windowId BrowserWindow ID
   */
  addIdleWindow(pluginName: string, windowId: number): void {
    const ids = this.idleWindowIds.get(pluginName) || []
    if (!ids.includes(windowId)) {
      ids.push(windowId)
      this.idleWindowIds.set(pluginName, ids)
      console.log(`[zbrowser] 空闲窗口入池: pluginName="${pluginName}", windowId=${windowId}`)
    }
  }

  /**
   * 从插件的空闲池中移除窗口
   *
   * @param pluginName 插件名称
   * @param windowId BrowserWindow ID
   */
  removeIdleWindow(pluginName: string, windowId: number): void {
    const ids = this.idleWindowIds.get(pluginName)
    if (!ids) return
    const filtered = ids.filter((id) => id !== windowId)
    this.idleWindowIds.set(pluginName, filtered)
    if (filtered.length < ids.length) {
      console.log(`[zbrowser] 空闲窗口出池: pluginName="${pluginName}", windowId=${windowId}`)
    }
  }

  /**
   * 清除插件的 zbrowser 缓存
   *
   * @param pluginName 插件名称
   */
  async clearCache(pluginName: string): Promise<void> {
    const sess = this.sessionPool.get(pluginName)
    if (!sess) return
    await sess.clearCache()
    console.log(`[zbrowser] 已清除插件 "${pluginName}" 的缓存`)
  }

  /**
   * 设置插件 zbrowser Session 的代理
   *
   * @param pluginName 插件名称
   * @param config Electron 代理配置对象
   */
  async setProxy(pluginName: string, config: Electron.ProxyConfig): Promise<void> {
    const sess = this.getOrCreateSession(pluginName)
    await sess.setProxy(config)
    console.log(`[zbrowser] 已设置插件 "${pluginName}" 的代理`)
  }
}

export default new ZBrowserManager()
