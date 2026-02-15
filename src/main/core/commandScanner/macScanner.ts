import { app } from 'electron'
import fsSync from 'fs'
import fs from 'fs/promises'
import path from 'path'
import plist from 'simple-plist'
import { extractAcronym } from '../../utils/common'
import { Command } from './types'
import { pLimit } from './utils'

// 缓存系统语言对应的 lproj 目录名列表
let _lprojNames: string[] | null = null
// 缓存系统语言对应的 loctable key 列表
let _loctableKeys: string[] | null = null

// 将 BCP 47 语言标签转换为 macOS lproj 目录名候选列表
// 例如: "zh-Hans-CN" → ["zh-Hans", "zh-Hans_CN", "zh_CN"]
//       "en-CN"      → ["en_CN", "en"]
//       "ja-JP"      → ["ja", "Japanese", "ja_JP"]
function bcp47ToLprojNames(tag: string): string[] {
  const candidates: string[] = []
  // BCP 47 格式: language[-Script][-Region]
  const parts = tag.split('-')
  const lang = parts[0]
  let script: string | undefined
  let region: string | undefined

  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]
    if (p.length === 4 && p[0] === p[0].toUpperCase()) {
      script = p // e.g., "Hans", "Hant"
    } else if (p.length === 2 && p === p.toUpperCase()) {
      region = p // e.g., "CN", "TW", "US"
    }
  }

  // 中文需要 script 信息来区分简繁体
  if (lang === 'zh' && script) {
    candidates.push(`zh-${script}`) // zh-Hans, zh-Hant
    if (region) {
      candidates.push(`zh-${script}_${region}`) // zh-Hans_CN
      candidates.push(`zh_${region}`) // zh_CN
    }
  }

  // 常见语言的传统 lproj 名称映射
  const legacyNames: Record<string, string> = {
    ja: 'Japanese',
    ko: 'Korean',
    fr: 'French',
    de: 'German',
    es: 'Spanish',
    it: 'Italian',
    pt: 'Portuguese',
    nl: 'Dutch',
    sv: 'Swedish',
    da: 'Danish',
    fi: 'Finnish',
    nb: 'Norwegian',
    pl: 'Polish',
    ru: 'Russian',
    en: 'English'
  }

  if (region) {
    candidates.push(`${lang}_${region}`) // en_US, ja_JP
  }
  candidates.push(lang) // en, ja, zh
  if (legacyNames[lang]) {
    candidates.push(legacyNames[lang]) // Japanese, English
  }

  return candidates
}

// 获取系统语言对应的 lproj 目录名候选列表
function getLocaleLprojNames(): string[] {
  if (_lprojNames) return _lprojNames

  // 使用 getPreferredSystemLanguages() 获取准确的系统语言偏好
  // app.getLocale() 在某些情况下返回不准确（如系统中文但返回 en-US）
  const preferredLangs = app.getPreferredSystemLanguages()

  const candidates: string[] = []
  for (const lang of preferredLangs) {
    candidates.push(...bcp47ToLprojNames(lang))
  }

  _lprojNames = [...new Set(candidates)]
  return _lprojNames
}

// 获取系统语言对应的 loctable key 候选列表
// loctable 使用的 key 格式与 lproj 不同，如 "zh_CN"、"en"、"ja"
function getLocaleLoctableKeys(): string[] {
  if (_loctableKeys) return _loctableKeys

  const preferredLangs = app.getPreferredSystemLanguages()
  const candidates: string[] = []

  for (const tag of preferredLangs) {
    const parts = tag.split('-')
    const lang = parts[0]
    let region: string | undefined

    for (let i = 1; i < parts.length; i++) {
      const p = parts[i]
      if (p.length === 2 && p === p.toUpperCase()) {
        region = p
      }
    }

    // loctable 中的 key 格式: "zh_CN", "en", "ja" 等
    if (region) {
      candidates.push(`${lang}_${region}`)
    }
    candidates.push(lang)
  }

  _loctableKeys = [...new Set(candidates)]
  return _loctableKeys
}

// 解析 .strings 文件内容
// 支持两种格式：
//   "key" = "value";  （key 有引号）
//   key = "value";    （key 无引号，如 Chromium 系应用）
function parseStringsContent(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  const regex = /(?:"((?:[^"\\]|\\.)*)"|([A-Za-z_]\w*))\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    const key = match[1] ?? match[2]
    result[key] = match[3]
  }
  return result
}

// 读取 .strings 文件（支持 binary plist、XML plist 和 UTF-16 文本三种格式）
async function readStringsFile(filePath: string): Promise<Record<string, string> | null> {
  // 先尝试 simple-plist（支持 binary plist 和 XML plist）
  try {
    const data: any = await new Promise((resolve, reject) => {
      plist.readFile(filePath, (err: any, result: any) => {
        if (err) reject(err)
        else resolve(result)
      })
    })
    if (data) return data
  } catch {
    // simple-plist 无法解析，可能是 UTF-16 文本格式
  }

  // 回退：手动读取并解析文本格式的 .strings 文件
  try {
    const buf = await fs.readFile(filePath)
    let content: string

    // 检测 BOM 判断编码
    if (buf[0] === 0xff && buf[1] === 0xfe) {
      content = buf.toString('utf16le') // UTF-16 LE
    } else if (buf[0] === 0xfe && buf[1] === 0xff) {
      content = buf.swap16().toString('utf16le') // UTF-16 BE
    } else {
      content = buf.toString('utf8')
    }

    return parseStringsContent(content)
  } catch {
    return null
  }
}

// 从 .lproj 目录读取本地化应用名称
async function getLocalizedNameFromLproj(appPath: string): Promise<string | null> {
  const lprojNames = getLocaleLprojNames()

  for (const lprojName of lprojNames) {
    const stringsPath = path.join(
      appPath,
      'Contents',
      'Resources',
      `${lprojName}.lproj`,
      'InfoPlist.strings'
    )
    try {
      if (!fsSync.existsSync(stringsPath)) continue

      const data = await readStringsFile(stringsPath)
      const name = data?.CFBundleDisplayName || data?.CFBundleName
      if (name) return name
    } catch {
      continue
    }
  }

  return null
}

// 从 InfoPlist.loctable 读取本地化应用名称（新版 macOS 系统应用使用此格式）
async function getLocalizedNameFromLoctable(appPath: string): Promise<string | null> {
  const loctablePath = path.join(appPath, 'Contents', 'Resources', 'InfoPlist.loctable')
  if (!fsSync.existsSync(loctablePath)) return null

  try {
    const data: any = await new Promise((resolve, reject) => {
      plist.readFile(loctablePath, (err: any, result: any) => {
        if (err) reject(err)
        else resolve(result)
      })
    })

    const keys = getLocaleLoctableKeys()
    for (const key of keys) {
      const entry = data?.[key]
      const name = entry?.CFBundleDisplayName || entry?.CFBundleName
      if (name) return name
    }
  } catch {
    // ignore
  }

  return null
}

// 获取本地化应用名称（先尝试 lproj，再尝试 loctable）
async function getLocalizedName(appPath: string): Promise<string | null> {
  return (await getLocalizedNameFromLproj(appPath)) ?? (await getLocalizedNameFromLoctable(appPath))
}

// 获取应用显示名称（优先本地化名称，无需子进程）
async function getAppDisplayName(appPath: string): Promise<string> {
  // 1. 尝试从 .lproj 获取本地化名称（如 "时钟"、"访达"）
  const localizedName = await getLocalizedName(appPath)
  if (localizedName) return localizedName

  // 2. 从 Info.plist 读取 CFBundleDisplayName / CFBundleName
  try {
    const data: any = await new Promise((resolve, reject) => {
      const plistPath = path.join(appPath, 'Contents', 'Info.plist')
      plist.readFile(plistPath, (err: any, result: any) => {
        if (err) reject(err)
        else resolve(result)
      })
    })
    const name = data?.CFBundleDisplayName || data?.CFBundleName
    if (name) return name
  } catch {
    // ignore
  }
  // 3. 兜底：使用文件名
  return path.basename(appPath, '.app')
}

// 获取应用图标文件路径
async function getIconFile(appPath: string): Promise<string> {
  return new Promise((resolve) => {
    const plistPath = path.join(appPath, 'Contents', 'Info.plist')

    plist.readFile(plistPath, (err: any, data: any) => {
      if (err || !data || !data.CFBundleIconFile) {
        // 返回系统默认图标
        return resolve(
          '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns'
        )
      }

      const iconFileName = data.CFBundleIconFile
      const baseIconPath = path.join(appPath, 'Contents', 'Resources', iconFileName)

      // 尝试多种扩展名
      const iconCandidates = [
        baseIconPath,
        `${baseIconPath}.icns`,
        `${baseIconPath}.tiff`,
        `${baseIconPath}.png`
      ]

      // 同步检查文件存在性(在回调中使用同步方法)
      for (const candidate of iconCandidates) {
        try {
          if (fsSync.existsSync(candidate)) {
            return resolve(candidate)
          }
        } catch {
          continue
        }
      }

      // 都找不到,返回默认图标
      resolve(
        '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns'
      )
    })
  })
}

export async function scanApplications(): Promise<Command[]> {
  try {
    console.time('[Scanner] 扫描应用')

    // 只扫描常用应用目录
    const searchPaths = [
      '/Applications',
      '/System/Applications',
      '/System/Applications/Utilities/',
      `${process.env.HOME}/Applications`
    ]

    const allAppPaths: string[] = []

    // 快速读取所有应用路径
    for (const searchPath of searchPaths) {
      try {
        const entries = await fs.readdir(searchPath, { withFileTypes: true })
        const appDirs = entries
          .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
          .map((entry) => path.join(searchPath, entry.name))

        allAppPaths.push(...appDirs)
      } catch {
        continue
      }
    }

    console.log(`[Scanner] 找到 ${allAppPaths.length} 个应用`)

    // 创建任务数组,使用并发控制
    const tasks = allAppPaths.map((appPath) => async () => {
      
      try {
        const name = await getAppDisplayName(appPath)

        // 获取图标文件路径
        const iconPath = await getIconFile(appPath)

        // 使用 ztools-icon:// 协议（与 Windows 保持一致）
        const iconUrl = `ztools-icon://${encodeURIComponent(iconPath)}`

        return {
          name,
          path: appPath,
          icon: iconUrl,
          acronym: extractAcronym(name)
        }
      } catch {
        const defaultIconPath =
          '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns'
        const name = path.basename(appPath, '.app')
        return {
          name,
          path: appPath,
          icon: `ztools-icon://${encodeURIComponent(defaultIconPath)}`,
          acronym: extractAcronym(name)
        }
      }
    })

    // 限制并发数为 50
    const apps = await pLimit(tasks, 50)

    console.timeEnd('[Scanner] 扫描应用')
    console.log(`[Scanner] 成功加载 ${apps.length} 个应用`)

    return apps
  } catch (error) {
    console.error('[Scanner] 扫描应用失败:', error)
    return []
  }
}
