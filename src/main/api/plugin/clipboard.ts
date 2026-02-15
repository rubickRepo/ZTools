import { ipcMain, clipboard, nativeImage } from 'electron'
import os from 'os'
import plist from 'simple-plist'
import { ClipboardMonitor } from '../../core/native'

/**
 * 剪贴板基础操作API - 插件专用
 * 注意：这里是基础的复制操作，与 shared/clipboard.ts 的历史管理不同
 */
export class PluginClipboardAPI {
  public init(): void {
    this.setupIPC()
  }

  private setupIPC(): void {
    // 复制文本到剪贴板
    ipcMain.on('copy-text', (event, text: string) => {
      try {
        clipboard.writeText(text)
        event.returnValue = true
      } catch (error) {
        console.error('[PluginClipboard] 复制文本失败:', error)
        event.returnValue = false
      }
    })

    // 复制图片到剪贴板
    ipcMain.on('copy-image', (event, image: string | Buffer | Uint8Array) => {
      console.log('[PluginClipboard] 复制图片', image)
      try {
        let nativeImg

        if (typeof image === 'string') {
          if (image.startsWith('data:image/')) {
            nativeImg = nativeImage.createFromDataURL(image)
          } else {
            nativeImg = nativeImage.createFromPath(image)
          }
        } else if (Buffer.isBuffer(image)) {
          nativeImg = nativeImage.createFromBuffer(image)
        } else if (image instanceof Uint8Array) {
          // 将 Uint8Array 转换为 Buffer
          const buffer = Buffer.from(image)
          nativeImg = nativeImage.createFromBuffer(buffer)
        } else {
          throw new Error('不支持的图片类型')
        }

        if (nativeImg.isEmpty()) {
          throw new Error('图片为空或无效')
        }

        clipboard.writeImage(nativeImg)
        event.returnValue = true
      } catch (error) {
        console.error('[PluginClipboard] 复制图片失败:', error)
        event.returnValue = false
      }
    })

    // 复制文件到剪贴板
    ipcMain.on('copy-file', (event, filePath: string | string[]) => {
      try {
        const files = Array.isArray(filePath) ? filePath : [filePath]

        if (os.platform() === 'win32') {
          // Windows 使用原生 API
          ClipboardMonitor.setClipboardFiles(files)
        } else if (os.platform() === 'darwin') {
          // macOS 使用 Electron API（原生 API 暂不支持）
          // macOS 需要使用 plist 格式
          const plistData = plist.stringify(files)
          clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plistData))
        }

        event.returnValue = true
      } catch (error) {
        console.error('[PluginClipboard] 复制文件失败:', error)
        event.returnValue = false
      }
    })
  }
}

export default new PluginClipboardAPI()
