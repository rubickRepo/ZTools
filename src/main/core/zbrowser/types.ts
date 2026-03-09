/**
 * zbrowser 类型定义
 *
 * 浏览器自动化引擎的核心类型，与 uTools ubrowser 兼容。
 */

/** 操作队列中的单个操作项 */
export interface ZBrowserQueueItem {
  /** 操作方法名（goto / javascript / css / press 等） */
  method: string
  /** 操作参数列表 */
  args: unknown[]
}

/** zbrowser.run() 的窗口配置选项（与 uTools UBrowserOptions 兼容） */
export interface ZBrowserRunOptions {
  /** 是否显示窗口（默认 true） */
  show?: boolean
  /** 窗口宽度 */
  width?: number
  /** 窗口高度 */
  height?: number
  /** 窗口 x 坐标 */
  x?: number
  /** 窗口 y 坐标 */
  y?: number
  /** 是否居中显示 */
  center?: boolean
  /** 最小宽度 */
  minWidth?: number
  /** 最小高度 */
  minHeight?: number
  /** 最大宽度 */
  maxWidth?: number
  /** 最大高度 */
  maxHeight?: number
  /** 是否可调整大小 */
  resizable?: boolean
  /** 是否可移动 */
  movable?: boolean
  /** 是否可最小化 */
  minimizable?: boolean
  /** 是否可最大化 */
  maximizable?: boolean
  /** 是否置顶 */
  alwaysOnTop?: boolean
  /** 是否全屏 */
  fullscreen?: boolean
  /** 是否可全屏 */
  fullscreenable?: boolean
  /** 是否允许窗口大于屏幕 */
  enableLargerThanScreen?: boolean
  /** 窗口透明度 (0-1) */
  opacity?: number
  /** 是否有边框（默认 true） */
  frame?: boolean
  /** 是否可关闭（默认 true） */
  closable?: boolean
  /** 是否可聚焦（默认 true） */
  focusable?: boolean
  /** 是否跳过任务栏（默认 false） */
  skipTaskbar?: boolean
  /** 窗口背景颜色（默认 #ffffff） */
  backgroundColor?: string
  /** 是否有阴影（默认 false） */
  hasShadow?: boolean
  /** 是否透明（默认 false） */
  transparent?: boolean
  /** 标题栏样式（macOS） */
  titleBarStyle?: string
  /** 是否加粗边框（Windows） */
  thickFrame?: boolean
}

/** zbrowser 运行结果 */
export interface ZBrowserRunResult {
  /** 收集的返回值列表（每个 evaluate/javascript 调用可能产生一个值） */
  data: unknown[]
  /** 是否出错 */
  error?: boolean
  /** 错误消息 */
  message?: string
  /** 窗口 ID（窗口保留时返回，用于后续复用） */
  windowId?: number
  /** 窗口信息（窗口保留时返回，与 uTools UBrowserInstance 兼容） */
  windowInfo?: {
    id: number
    url: string
    title: string
    width: number
    height: number
    x: number
    y: number
  }
}

/**
 * runner 子进程 → 主进程的消息格式
 *
 * runner 通过 process.send() 发送给主进程。
 */
export interface RunnerToMainMessage {
  /** 要调用的方法名（如 javascript / goto / runEnd） */
  method: string
  /** 请求唯一标识（用于匹配响应） */
  methodEndKey: string
  /** 方法参数 */
  args: unknown[]
}

/**
 * 主进程 → runner 子进程的消息格式
 *
 * 主进程通过 childProcess.send() 发送给 runner。
 */
export interface MainToRunnerMessage {
  /** 动作类型（run = 开始执行队列，其它 = 方法响应） */
  action: string
  /**
   * 载荷数据
   *
   * - action='run' 时为操作队列数组
   * - action=methodEndKey 时为方法执行结果
   */
  payload:
    | ZBrowserQueueItem[]
    | {
        /** 返回数据 */
        data?: unknown
        /** 是否出错 */
        error?: boolean
        /** 错误消息 */
        message?: string
      }
}

/** 空闲窗口信息（返回给插件的精简结构） */
export interface ZBrowserIdleWindowInfo {
  /** BrowserWindow 的 id */
  id: number
  /** 窗口标题 */
  title: string
  /** 当前页面 URL */
  url: string
}
