/**
 * zbrowser client - 插件端 Builder 模式客户端
 *
 * 所有方法返回 this，支持链式调用。
 * 调用 run() 时将队列通过 IPC 发送到主进程执行。
 *
 * 注意：run() 方法不在此文件中定义，由 preload.js 运行时注入。
 *
 * 用法：
 *   ztools.zbrowser
 *     .goto('https://example.com')
 *     .click('.button')
 *     .evaluate(() => document.title)
 *     .run({ width: 800, height: 600 })
 */

/**
 * 将用户函数序列化为 IIFE 字符串
 *
 * 生成的代码在目标页面中执行，支持：
 * - 同步函数：直接返回 { data: result }
 * - 异步函数（返回 Promise）：自动 await 并返回 { data: result }
 * - 异常捕获：返回 { error: true, message: err.message }
 *
 * @param {Function} fn - 用户提供的函数
 * @param {Array} args - 传递给函数的参数
 * @returns {string} 可在页面中执行的 JS 代码字符串
 */
const jsCodeTemplate = (fn, args) =>
  `(() => {
    const fn = ${String(fn)}
    const args = ${JSON.stringify(args)}
    const callResult = (result) => {
      if (!!result && (typeof result === 'object' || typeof result === 'function') && typeof result.then === 'function') {
        return new Promise(resolve => {
          result.then(ret => { resolve(callResult(ret)) }).catch( err => { resolve({ error: true, message: err.message }) })
        })
      }
      return { data: result }
    }
    try {
      return callResult(fn.apply(null, args))
    } catch (err) {
      return { error: true, message: err.message }
    }
  })()`

/**
 * 内置方法列表
 *
 * 这些方法直接将 { method, args } 推入队列，不做额外处理。
 * 实际执行逻辑在主进程的 zbrowserExecutor 中。
 */
const METHODS = [
  'goto', // 页面导航
  'hide', // 隐藏窗口
  'show', // 显示窗口
  'useragent', // 设置 User-Agent
  'viewport', // 设置视口大小
  'css', // 注入 CSS
  'press', // 模拟键盘按键
  'paste', // 粘贴文本
  'screenshot', // 截图
  'pdf', // 导出 PDF
  'device', // 设备模拟
  'end', // when 条件分支结束标记
  'cookies', // 获取 Cookie
  'setCookies', // 设置 Cookie
  'removeCookies', // 删除指定 Cookie
  'clearCookies', // 清除所有 Cookie
  'devTools' // 打开开发者工具
]

class ZBrowserClient {
  constructor() {
    /** 操作队列 */
    this._queue = []

    // 注册内置方法（统一的队列入队逻辑）
    METHODS.forEach((method) => {
      this[method] = (...args) => {
        this._queue.push({ method, args })
        return this
      }
    })
  }

  /**
   * 在目标页面中执行 JS 函数
   *
   * 函数会被序列化为字符串，在目标页面上下文中执行。
   * 支持异步函数（返回 Promise），结果会自动 unwrap。
   *
   * @param {Function} fn - 要执行的函数
   * @param {...*} args - 传递给函数的参数（必须是可 JSON 序列化的）
   * @returns {ZBrowserClient} this
   *
   * 示例：
   *   .evaluate(() => document.title)
   *   .evaluate((selector) => document.querySelector(selector)?.textContent, '.title')
   */
  evaluate(fn, ...args) {
    if (typeof fn !== 'function') {
      throw new Error('evaluate: first argument should be a function')
    }
    this._queue.push({
      method: 'javascript',
      args: [jsCodeTemplate(fn, args)]
    })
    return this
  }

  /**
   * 等待操作
   *
   * 支持三种调用方式：
   * 1. wait(ms) - 等待指定毫秒数
   * 2. wait(selector, options?) - 等待 DOM 元素出现
   *    - options: number（超时毫秒） 或 { timeout, interval }
   * 3. wait(fn, options?, ...args) - 等待函数返回 true
   *    - 函数在目标页面上下文中执行
   *
   * @returns {ZBrowserClient} this
   */
  wait(...args) {
    // wait(ms)
    if (typeof args[0] === 'number') {
      this._queue.push({ method: 'wait', args: [args[0]] })
      return this
    }

    // wait(selector, options?)
    if (typeof args[0] === 'string') {
      const optArg = args[1]
      let timeout, interval
      if (typeof optArg === 'object') {
        timeout = optArg.timeout
        interval = optArg.interval
      } else if (typeof optArg === 'number') {
        timeout = optArg
      }
      if (typeof timeout !== 'number' || timeout < 0) timeout = 60000
      if (typeof interval !== 'number' || interval < 0) interval = 1000

      this._queue.push({
        method: 'wait',
        args: [
          jsCodeTemplate((selector) => !!document.querySelector(selector), [args[0]]),
          timeout,
          interval
        ]
      })
      return this
    }

    // wait(fn, options?, ...fnArgs)
    if (typeof args[0] === 'function') {
      const fn = args.shift()
      const optArg = args.shift()
      let timeout, interval
      if (typeof optArg === 'object') {
        timeout = optArg.timeout
        interval = optArg.interval
      } else if (typeof optArg === 'number') {
        timeout = optArg
      }
      if (typeof timeout !== 'number' || timeout < 0) timeout = 60000
      if (typeof interval !== 'number' || interval < 0) interval = 1000

      this._queue.push({
        method: 'wait',
        args: [jsCodeTemplate(fn, args), timeout, interval]
      })
      return this
    }

    throw new Error('wait: parameter error')
  }

  /**
   * 条件分支
   *
   * 与 end() 配对使用。
   * 条件为 true 时执行 when...end 之间的操作，否则跳过。
   *
   * 支持两种用法：
   * 1. when(selector, result?) - 检查 DOM 元素是否存在（result=false 时检查不存在）
   * 2. when(fn, ...args) - 执行函数，检查返回值是否为 true
   *
   * @param {string|Function} selectorOrFn - CSS 选择器或判断函数
   * @param {boolean} [result] - 期望的检查结果（默认 true，传 false 表示元素不存在时为 true）
   * @returns {ZBrowserClient} this
   */
  when(...args) {
    if (typeof args[0] === 'string') {
      const checkNotExists = args[1] === false
      this._queue.push({
        method: 'when',
        args: [
          jsCodeTemplate(
            (selector, checkNotExists) => {
              const exists = !!document.querySelector(selector)
              return checkNotExists ? !exists : exists
            },
            [args[0], checkNotExists]
          )
        ]
      })
      return this
    }

    if (typeof args[0] === 'function') {
      const fn = args.shift()
      this._queue.push({
        method: 'when',
        args: [jsCodeTemplate(fn, args)]
      })
      return this
    }

    throw new Error('when: parameter error')
  }

  /**
   * 模拟鼠标事件（选择器模式 - JS 事件分发）
   *
   * 在目标元素中心点触发指定类型的 MouseEvent。
   * 仅用于无 mouseButton 参数的选择器模式。
   *
   * @param {string} eventName - 事件类型（click / mousedown / mouseup / dblclick）
   * @param {string} selector - CSS 选择器
   * @returns {ZBrowserClient} this
   */
  mouse(eventName, selector) {
    if (!['click', 'mousedown', 'mouseup', 'dblclick'].includes(eventName)) {
      throw new Error('eventName error')
    }
    return this.evaluate(
      (eventName, selector) => {
        document.activeElement.blur()
        const element = document.querySelector(selector)
        if (!element) {
          throw new Error(eventName + ': unable to find element by selector "' + selector + '"')
        }
        const rect = element.getBoundingClientRect()
        const event = new window.MouseEvent(eventName, {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2
        })
        element.dispatchEvent(event)
      },
      eventName,
      selector
    )
  }

  /**
   * 鼠标点击
   *
   * 支持两种调用方式：
   * 1. click(selector, mouseButton?) - 点击元素
   * 2. click(x, y, mouseButton?) - 在坐标位置点击（物理鼠标事件）
   *
   * @returns {ZBrowserClient} this
   */
  click(...args) {
    if (typeof args[0] === 'number' && typeof args[1] === 'number') {
      // click(x, y, mouseButton?) - 坐标物理点击
      this._queue.push({ method: 'mouseEvent', args: ['click', args[0], args[1], args[2]] })
      return this
    }
    if (typeof args[0] === 'string') {
      if (args[1]) {
        // click(selector, mouseButton) - 带按钮的物理点击
        this._queue.push({ method: 'mouseEvent', args: ['click', args[0], args[1]] })
        return this
      }
      // click(selector) - JS 事件分发
      return this.mouse('click', args[0])
    }
    throw new Error('click: parameter error')
  }

  /**
   * 鼠标按下
   *
   * 支持两种调用方式：
   * 1. mousedown(selector, mouseButton?) - 在元素上按下
   * 2. mousedown(x, y, mouseButton?) - 在坐标位置按下（物理鼠标事件）
   *
   * @returns {ZBrowserClient} this
   */
  mousedown(...args) {
    if (typeof args[0] === 'number' && typeof args[1] === 'number') {
      this._queue.push({ method: 'mouseEvent', args: ['mousedown', args[0], args[1], args[2]] })
      return this
    }
    if (typeof args[0] === 'string') {
      if (args[1]) {
        this._queue.push({ method: 'mouseEvent', args: ['mousedown', args[0], args[1]] })
        return this
      }
      return this.mouse('mousedown', args[0])
    }
    throw new Error('mousedown: parameter error')
  }

  /**
   * 鼠标按键抬起
   *
   * 支持两种调用方式：
   * 1. mouseup(selector, mouseButton?) - 在元素上抬起
   * 2. mouseup(x, y, mouseButton?) - 在坐标位置抬起（物理鼠标事件）
   *
   * @returns {ZBrowserClient} this
   */
  mouseup(...args) {
    if (typeof args[0] === 'number' && typeof args[1] === 'number') {
      this._queue.push({ method: 'mouseEvent', args: ['mouseup', args[0], args[1], args[2]] })
      return this
    }
    if (typeof args[0] === 'string') {
      if (args[1]) {
        this._queue.push({ method: 'mouseEvent', args: ['mouseup', args[0], args[1]] })
        return this
      }
      return this.mouse('mouseup', args[0])
    }
    throw new Error('mouseup: parameter error')
  }

  /**
   * 鼠标双击
   *
   * 支持两种调用方式：
   * 1. dblclick(selector, mouseButton?) - 双击元素
   * 2. dblclick(x, y, mouseButton?) - 在坐标位置双击（物理鼠标事件）
   *
   * @returns {ZBrowserClient} this
   */
  dblclick(...args) {
    if (typeof args[0] === 'number' && typeof args[1] === 'number') {
      this._queue.push({ method: 'mouseEvent', args: ['dblclick', args[0], args[1], args[2]] })
      return this
    }
    if (typeof args[0] === 'string') {
      if (args[1]) {
        this._queue.push({ method: 'mouseEvent', args: ['dblclick', args[0], args[1]] })
        return this
      }
      return this.mouse('dblclick', args[0])
    }
    throw new Error('dblclick: parameter error')
  }

  /**
   * 鼠标悬停
   *
   * 支持两种调用方式：
   * 1. hover(selector) - 在元素上悬停
   * 2. hover(x, y) - 在坐标位置悬停（物理鼠标移动）
   *
   * @returns {ZBrowserClient} this
   */
  hover(...args) {
    if (typeof args[0] === 'number' && typeof args[1] === 'number') {
      // hover(x, y) - 坐标物理鼠标移动
      this._queue.push({ method: 'mouseEvent', args: ['mouseMove', args[0], args[1]] })
      return this
    }
    if (typeof args[0] === 'string') {
      // hover(selector) - 触发 mouseover/mouseenter 事件
      return this.evaluate((selector) => {
        const element = document.querySelector(selector)
        if (!element) {
          throw new Error('hover: unable to find element by selector "' + selector + '"')
        }
        const rect = element.getBoundingClientRect()
        element.dispatchEvent(
          new window.MouseEvent('mouseenter', {
            view: window,
            bubbles: false,
            cancelable: false,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2
          })
        )
        element.dispatchEvent(
          new window.MouseEvent('mouseover', {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2
          })
        )
      }, args[0])
    }
    throw new Error('hover: parameter error')
  }

  /**
   * 拖放文件到元素或坐标位置
   *
   * 支持两种调用方式：
   * 1. drop(selector, payload) - 拖放到元素
   * 2. drop(x, y, payload) - 拖放到坐标位置
   *
   * @param {string|number} selectorOrX - CSS 选择器或 X 坐标
   * @param {*} payloadOrY - 文件数据或 Y 坐标
   * @param {*} [payload] - 文件数据（坐标模式时）
   * @returns {ZBrowserClient} this
   */
  drop(...args) {
    let filePaths
    let dropArgs

    if (typeof args[0] === 'number' && typeof args[1] === 'number') {
      // drop(x, y, payload) - 坐标模式
      filePaths = this._resolveFilePayload(args[2], 'drop')
      dropArgs = [args[0], args[1], filePaths]
    } else if (typeof args[0] === 'string') {
      // drop(selector, payload) - 选择器模式
      filePaths = this._resolveFilePayload(args[1], 'drop')
      dropArgs = [args[0], filePaths]
    } else {
      throw new Error('drop: parameter error')
    }

    this._queue.push({ method: 'drop', args: dropArgs })
    return this
  }

  /**
   * 将网页内容转换为 Markdown
   *
   * @param {string} [selector] - 要转换的元素选择器（可选，不传转换整个页面）
   * @returns {ZBrowserClient} this
   */
  markdown(selector) {
    this._queue.push({ method: 'markdown', args: selector ? [selector] : [] })
    return this
  }

  /**
   * 输入文本（模拟输入法输入，不触发键盘按键事件）
   *
   * 支持两种调用方式：
   * 1. input(text) - 在当前焦点元素中输入文本
   * 2. input(selector, text) - 先聚焦元素，再输入文本
   *
   * @param {string} selectorOrText - CSS 选择器或要输入的文本
   * @param {string} [text] - 要输入的文本（当第一个参数是选择器时）
   * @returns {ZBrowserClient} this
   */
  input(selectorOrText, text) {
    if (typeof text === 'string') {
      // input(selector, text) - 先聚焦再输入
      this._queue.push({ method: 'input', args: [selectorOrText, text] })
    } else {
      // input(text) - 直接输入
      this._queue.push({ method: 'input', args: [selectorOrText] })
    }
    return this
  }

  /**
   * 解析文件数据为文件路径数组
   *
   * 支持：Base64 data URI → 临时文件、Uint8Array → 临时文件、
   * 文件路径字符串、文件路径数组。
   *
   * @param {*} fileData - 文件数据
   * @param {string} methodName - 调用者方法名（用于错误信息）
   * @returns {string[]} 文件路径数组
   * @private
   */
  _resolveFilePayload(fileData, methodName) {
    if (typeof fileData === 'string') {
      // Base64 图片
      const m = fileData.match(/^(data:image\/([a-z]+?);base64,)/)
      if (m) {
        const base64Data = fileData.slice(m[1].length)
        const ext = m[2]
        const fileName = 'image_' + Date.now() + '.' + ext
        const path = require('path')
        const fs = require('fs')
        const tmpDir = path.join(require('os').tmpdir(), 'ztools-zbrowser')
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir)
        const filePath = path.join(tmpDir, fileName)
        fs.writeFileSync(filePath, base64Data, 'base64')
        return [filePath]
      }
      // 文件路径
      if (!require('fs').existsSync(fileData)) {
        throw new Error(methodName + ': file does not exist')
      }
      return [fileData]
    }

    if (fileData instanceof Uint8Array) {
      const fileName = 'file_' + Date.now()
      const path = require('path')
      const fs = require('fs')
      const tmpDir = path.join(require('os').tmpdir(), 'ztools-zbrowser')
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir)
      const filePath = path.join(tmpDir, fileName)
      fs.writeFileSync(filePath, Buffer.from(fileData))
      return [filePath]
    }

    if (Array.isArray(fileData) && fileData.length > 0 && typeof fileData[0] === 'string') {
      const fs = require('fs')
      if (fileData.find((f) => !fs.existsSync(f))) {
        throw new Error(methodName + ': file does not exist')
      }
      return fileData
    }

    throw new Error(methodName + ': parameter error')
  }

  /**
   * 设置文件输入
   *
   * @param {string} selector - 文件 input 元素的 CSS 选择器
   * @param {string|Uint8Array|string[]} fileData - 文件路径 / Base64 / 二进制数据 / 路径数组
   * @returns {ZBrowserClient} this
   */
  file(selector, fileData) {
    const filePaths = this._resolveFilePayload(fileData, 'file')
    this._queue.push({ method: 'file', args: [selector, filePaths] })
    return this
  }

  /**
   * 下载文件
   *
   * 支持两种调用方式：
   * 1. download(url, savePath?) - 直接下载 URL
   * 2. download(func, savePath, ...params) - 在页面中执行函数获取下载 URL，再下载
   *
   * @returns {ZBrowserClient} this
   */
  download(urlOrFunc, savePath, ...params) {
    if (typeof urlOrFunc === 'function') {
      // 函数模式：序列化函数，执行器会在页面中运行获取 URL 后下载
      this._queue.push({
        method: 'download',
        args: [jsCodeTemplate(urlOrFunc, params), savePath, true]
      })
    } else {
      // URL 模式
      this._queue.push({ method: 'download', args: [urlOrFunc, savePath] })
    }
    return this
  }

  /**
   * 设置表单元素的值
   *
   * 设置后会触发 input（文本框）或 change（其它类型）事件。
   *
   * @param {string} selector - CSS 选择器
   * @param {string} value - 要设置的值
   * @returns {ZBrowserClient} this
   */
  value(selector, value) {
    return this.evaluate(
      (selector, value) => {
        const el = document.querySelector(selector)
        if (!el) {
          throw new Error('value: unable to find element by selector "' + selector + '"')
        }
        el.value = value
        if (
          el.tagName === 'TEXTAREA' ||
          (el.tagName === 'INPUT' && ['text', 'password', 'search'].includes(el.type))
        ) {
          el.dispatchEvent(new window.Event('input', { bubbles: true, cancelable: true }))
        } else {
          el.dispatchEvent(new window.Event('change', { bubbles: true, cancelable: true }))
        }
      },
      selector,
      value
    )
  }

  /**
   * 设置复选框状态
   *
   * @param {string} selector - CSS 选择器
   * @param {boolean} checked - 是否选中（默认 true）
   * @returns {ZBrowserClient} this
   */
  check(selector, checked) {
    return this.evaluate(
      (selector, checked) => {
        const el = document.querySelector(selector)
        if (!el) {
          throw new Error('check: unable to find element by selector "' + selector + '"')
        }
        el.checked = checked === undefined ? true : checked === true
        el.dispatchEvent(new window.Event('change', { bubbles: true, cancelable: true }))
      },
      selector,
      checked
    )
  }

  /**
   * 聚焦元素
   *
   * @param {string} selector - CSS 选择器
   * @returns {ZBrowserClient} this
   */
  focus(selector) {
    return this.evaluate((selector) => {
      const el = document.querySelector(selector)
      if (!el) {
        throw new Error('focus: unable to find element by selector "' + selector + '"')
      }
      el.focus()
    }, selector)
  }

  /**
   * 滚动页面
   *
   * 支持三种调用方式：
   * 1. scroll(y) - 垂直滚动到 y 位置
   * 2. scroll(x, y) - 滚动到 (x, y) 位置
   * 3. scroll(selector, optional?) - 滚动到元素位置
   *    - optional: boolean 或 ScrollIntoViewOptions（传递给 element.scrollIntoView）
   *
   * @returns {ZBrowserClient} this
   */
  scroll(...args) {
    if (typeof args[0] === 'number') {
      if (args.length === 1) {
        return this.evaluate((y) => {
          window.scrollTo(window.scrollX, y)
        }, args[0])
      }
      if (args.length === 2 && typeof args[1] === 'number') {
        return this.evaluate(
          (x, y) => {
            window.scrollTo(x, y)
          },
          args[0],
          args[1]
        )
      }
      throw new Error('scroll: parameter error')
    }

    if (typeof args[0] === 'string') {
      if (args[1] !== undefined) {
        // scroll(selector, optional) - 使用 scrollIntoView
        return this.evaluate(
          (selector, optional) => {
            const el = document.querySelector(selector)
            if (!el) {
              throw new Error('scroll: unable to find element by selector "' + selector + '"')
            }
            el.scrollIntoView(optional)
          },
          args[0],
          args[1]
        )
      }
      // scroll(selector) - 默认滚动到元素位置
      return this.evaluate((selector) => {
        const el = document.querySelector(selector)
        if (!el) {
          throw new Error('scroll: unable to find element by selector "' + selector + '"')
        }
        const rect = el.getBoundingClientRect()
        window.scrollTo(rect.left, rect.top)
      }, args[0])
    }

    throw new Error('scroll: parameter error')
  }
}

module.exports = { ZBrowserClient }
