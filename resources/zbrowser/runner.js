/**
 * zbrowser runner - 子进程执行器
 *
 * 由主进程通过 child_process.fork() 启动。
 * 接收操作队列，逐项执行，通过 process.send() / process.on('message') 与主进程通信。
 *
 * 通信协议：
 * - runner → main:  { method, methodEndKey, args }
 * - main → runner:  { action, payload: { data?, error?, message? } }
 * - 特殊 action:
 *   - action='run'  → 开始执行队列（payload 为队列数组）
 *   - action=methodEndKey → 某个方法的执行结果
 * - 特殊 method:
 *   - method='runEnd' → 队列执行完毕，args[0] 为 { data, error?, message? }
 */

const { EventEmitter } = require('events')

/** 事件总线：用于匹配主进程返回的响应 */
const emitter = new EventEmitter()

/** 请求 ID 递增计数器 */
let idCounter = 0

/**
 * 调用主进程方法
 *
 * @param {string} method - 方法名（如 javascript / goto / css 等）
 * @param {unknown[]} args - 方法参数
 * @returns {Promise<unknown>} 主进程执行结果
 */
function callRemoteFunction(method, args) {
  return new Promise((resolve, reject) => {
    // 生成唯一请求 ID（递增计数器 + 时间戳，避免碰撞）
    const methodEndKey = `req_${++idCounter}_${Date.now()}`

    // 监听主进程返回（一次性）
    emitter.once(methodEndKey, (payload) => {
      if (payload.error) {
        return reject(new Error(payload.message))
      }
      resolve(payload.data)
    })

    // 发送请求到主进程
    process.send({ method, methodEndKey, args })
  })
}

/**
 * 等待指定毫秒数
 *
 * @param {number} ms - 等待时长（毫秒）
 */
function waitTime(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * 轮询等待条件满足
 *
 * @param {string} jsCode - 要执行的 JS 代码（返回 true 表示条件满足）
 * @param {number} timeout - 超时时间（毫秒）
 * @param {number} interval - 轮询间隔（毫秒，默认 1000）
 */
function waitCall(jsCode, timeout, interval = 1000) {
  return new Promise((resolve, reject) => {
    if (timeout < interval) {
      return reject(new Error('wait: ' + timeout + ' ms timeout'))
    }

    const codeArgs = [jsCode]
    let pollTimer
    let timeoutTimer = null
    let aborted = false

    const poll = () => {
      if (aborted) return
      callRemoteFunction('javascript', codeArgs)
        .then((result) => {
          if (aborted) return
          if (result === true) {
            clearTimeout(timeoutTimer)
            resolve()
            return
          }
          // 条件未满足，继续轮询
          pollTimer = setTimeout(poll, interval)
        })
        .catch((err) => {
          if (aborted) return
          aborted = true
          clearTimeout(timeoutTimer)
          reject(new Error('wait: ' + err.message))
        })
    }

    // 首次轮询（延迟 interval 后开始）
    pollTimer = setTimeout(poll, interval)

    // 超时计时器
    timeoutTimer = setTimeout(() => {
      aborted = true
      clearTimeout(pollTimer)
      reject(new Error('wait: ' + timeout + ' ms timeout'))
    }, timeout)
  })
}

/**
 * 处理 wait 操作
 *
 * 支持三种调用方式：
 * 1. wait(ms) - 等待指定毫秒
 * 2. wait(jsCode, timeout, interval) - 轮询等待条件
 * 3. 参数错误时抛出异常
 */
async function runWait(...args) {
  if (typeof args[0] === 'number') {
    // wait(ms) - 时间等待
    await waitTime(args[0])
  } else if (typeof args[0] === 'string') {
    // wait(jsCode, timeout, interval) - 条件等待
    await waitCall(args[0], args[1], args[2])
  } else {
    throw new Error('wait: parameter error')
  }
}

/**
 * 在队列中查找匹配的 end 操作的索引
 *
 * when/end 支持嵌套，通过计数器匹配。
 *
 * @param {Array} queue - 操作队列
 * @param {number} startIndex - 从哪个索引开始搜索
 * @returns {number} 匹配的 end 操作的索引，未找到返回 -1
 */
function findWhenEndIndex(queue, startIndex) {
  let depth = 0
  for (let i = startIndex; i < queue.length; i++) {
    const item = queue[i]
    if (!item) continue
    if (item.method === 'when') {
      depth++
    } else if (item.method === 'end') {
      if (depth === 0) return i
      depth--
    }
  }
  return -1
}

/**
 * 执行操作队列
 *
 * 按顺序遍历队列，处理以下特殊方法：
 * - wait: 等待（时间/条件）
 * - when/end: 条件分支（条件为 false 时跳过到 end）
 * - 其它: 调用主进程执行，收集返回值
 *
 * @param {Array} queue - 操作队列
 */
async function run(queue) {
  const results = []

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]

    // 跳过已置空的项（被 when 条件跳过的操作）
    if (!item || item.method === 'end') continue

    try {
      // ── wait: 等待操作 ──
      if (item.method === 'wait') {
        await runWait(...item.args)
        continue
      }

      // ── when: 条件分支 ──
      if (item.method === 'when') {
        const endIndex = findWhenEndIndex(queue, i + 1)

        // 执行条件表达式
        const conditionResult = await callRemoteFunction('javascript', item.args)

        if (conditionResult === true) {
          // 条件为 true → 执行分支内的操作，移除 end 标记
          if (endIndex !== -1) {
            queue[endIndex] = null
          }
          continue
        }

        // 条件为 false → 跳过到 end（将分支内操作置空）
        if (endIndex !== -1) {
          for (let j = i; j <= endIndex; j++) {
            queue[j] = null
          }
          continue
        }

        // 没有 end → 无法找到分支边界，终止执行
        break
      }

      // ── 普通操作：发送到主进程执行 ──
      const result = await callRemoteFunction(item.method, item.args)
      if (result !== undefined) {
        results.push(result)
      }
    } catch (err) {
      // 发生错误时立即终止，返回已收集的结果和错误信息
      process.send({
        method: 'runEnd',
        args: [{ data: results, error: true, message: err.message }]
      })
      return
    }
  }

  // 队列全部执行完毕
  process.send({
    method: 'runEnd',
    args: [{ data: results }]
  })
}

/**
 * 监听主进程消息
 *
 * - action='run' → 开始执行操作队列
 * - 其它 action → 作为方法响应分发到 emitter
 */
process.on('message', ({ action, payload }) => {
  if (action === 'run') {
    return run(payload)
  }
  // 方法调用的响应（action 为 methodEndKey）
  emitter.emit(action, payload)
})
