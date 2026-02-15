import { ipcMain } from 'electron'
import lmdbInstance from '../../core/lmdb/lmdbInstance'
import type { AiModel } from '../renderer/aiModels'
import detachedWindowManager from '../../core/detachedWindowManager'

/**
 * AI 选项
 */
export interface AiOption {
  model?: string // AI 模型，为空默认使用第一个配置的模型
  messages: Message[] // 消息列表
  tools?: Tool[] // 工具列表
}

/**
 * 消息
 */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool' // 消息角色
  content?: string // 消息内容
  reasoning_content?: string // 消息推理内容
  tool_calls?: ToolCall[] // 工具调用
  tool_call_id?: string // 工具调用 ID（role 为 tool 时使用）
}

/**
 * 工具调用
 */
export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

/**
 * 工具
 */
export interface Tool {
  type: 'function'
  function?: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, any>
    }
    required?: string[]
  }
}

/**
 * AI 调用 API（插件专用）
 */
class PluginAiAPI {
  private pluginManager: any = null
  private mainWindow: Electron.BrowserWindow | null = null
  private abortControllers: Map<string, AbortController> = new Map()

  /**
   * 初始化 API
   */
  public init(mainWindow: Electron.BrowserWindow, pluginManager: any): void {
    this.mainWindow = mainWindow
    this.pluginManager = pluginManager
    this.setupIPC()
  }

  /**
   * 设置 IPC 处理器
   */
  private setupIPC(): void {
    // 非流式调用 AI
    ipcMain.handle('plugin:ai-call', async (event, requestId: string, option: AiOption) => {
      try {
        const pluginInfo = this.pluginManager.getPluginInfoByWebContents(event.sender)
        if (!pluginInfo) {
          return { success: false, error: '无法获取插件信息' }
        }

        const result = await this.callAI(option, requestId, event.sender)
        return result
      } catch (error: unknown) {
        console.error('[AI] AI 调用失败:', error)
        // 确保失败时重置状态
        this.notifyAiStatus('idle', event.sender)
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    // 流式调用 AI
    ipcMain.handle('plugin:ai-call-stream', async (event, requestId: string, option: AiOption) => {
      try {
        const pluginInfo = this.pluginManager.getPluginInfoByWebContents(event.sender)
        if (!pluginInfo) {
          return { success: false, error: '无法获取插件信息' }
        }

        // 流式调用，通过事件发送数据块
        await this.callAIStream(option, requestId, event.sender, (chunk: Message) => {
          event.sender.send(`plugin:ai-stream-${requestId}`, chunk)
        })

        return { success: true }
      } catch (error: unknown) {
        console.error('[AI] AI 流式调用失败:', error)
        // 确保失败时重置状态
        this.notifyAiStatus('idle', event.sender)
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    // 中止 AI 调用
    ipcMain.handle('plugin:ai-abort', async (_event, requestId: string) => {
      try {
        this.abortAICall(requestId)
        return { success: true }
      } catch (error: unknown) {
        console.error('[AI] 中止 AI 调用失败:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    // 获取所有可用 AI 模型
    ipcMain.handle('plugin:ai-all-models', async () => {
      try {
        const models = await this.getAllAiModels()
        return { success: true, data: models }
      } catch (error: unknown) {
        console.error('[AI] 获取 AI 模型列表失败:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    // Function Calling - 调用插件函数
    ipcMain.handle('plugin:ai-call-function', async (event, functionName: string, args: string) => {
      try {
        const pluginInfo = this.pluginManager.getPluginInfoByWebContents(event.sender)
        if (!pluginInfo) {
          return { success: false, error: '无法获取插件信息' }
        }

        // 调用插件的函数（函数必须挂载到 window 对象上）
        const result = await event.sender.executeJavaScript(`
            (async () => {
              if (typeof window.${functionName} === 'function') {
                const args = ${args};
                return await window.${functionName}(args);
              } else {
                throw new Error('函数 ${functionName} 不存在');
              }
            })()
          `)

        return { success: true, data: result }
      } catch (error: unknown) {
        console.error('[AI] 调用插件函数失败:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })
  }

  /**
   * 通知窗口 AI 请求状态变化
   * @param status AI 状态
   * @param webContents 插件的 WebContents（用于确定通知目标窗口）
   */
  private notifyAiStatus(
    status: 'idle' | 'sending' | 'receiving',
    webContents: Electron.WebContents
  ): void {
    // 通过 pluginManager 获取插件信息
    const pluginInfo = this.pluginManager.getPluginInfoByWebContents(webContents)
    if (!pluginInfo) {
      console.warn('[AI] 无法获取插件信息，无法发送 AI 状态通知')
      return
    }

    // 检查是否在分离窗口中
    const detachedWindows = detachedWindowManager.getAllWindows()

    for (const windowInfo of detachedWindows) {
      if (windowInfo.view.webContents === webContents) {
        // 插件在分离窗口中，向分离窗口发送通知
        if (windowInfo.window && !windowInfo.window.isDestroyed()) {
          windowInfo.window.webContents.send('ai-status-changed', status)
        }
        return
      }
    }

    // 插件在主窗口中，向主窗口发送通知
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('ai-status-changed', status)
    }
  }

  /**
   * 获取所有可用 AI 模型
   */
  private async getAllAiModels(): Promise<
    Array<{
      id: string
      label: string
      description: string
      icon: string
      cost: number
    }>
  > {
    try {
      const doc = await lmdbInstance.promises.get('ZTOOLS/ai-models')
      if (doc && doc.data && Array.isArray(doc.data)) {
        const models: AiModel[] = doc.data
        return models.map((m) => ({
          id: m.id,
          label: m.label,
          description: m.description || '',
          icon: m.icon || '',
          cost: m.cost || 0
        }))
      }
      return []
    } catch {
      return []
    }
  }

  /**
   * 获取模型配置
   */
  private async getModelConfig(modelId?: string): Promise<AiModel | null> {
    try {
      const doc = await lmdbInstance.promises.get('ZTOOLS/ai-models')
      if (doc && doc.data && Array.isArray(doc.data)) {
        const models: AiModel[] = doc.data

        if (modelId) {
          // 查找指定模型
          return models.find((m) => m.id === modelId) || null
        } else {
          // 返回第一个模型
          return models[0] || null
        }
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * 构建请求体
   */
  private buildRequestBody(
    modelConfig: AiModel,
    messages: Message[],
    tools?: Tool[],
    isStream = false
  ): any {
    const requestBody: any = {
      model: modelConfig.id,
      messages: messages
    }

    if (isStream) {
      requestBody.stream = true
    }

    if (tools && tools.length > 0) {
      requestBody.tools = tools
    }

    return requestBody
  }

  /**
   * 发送 API 请求
   */
  private async sendAPIRequest(
    modelConfig: AiModel,
    requestBody: any,
    abortController: AbortController
  ): Promise<Response> {
    const response = await fetch(`${modelConfig.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${modelConfig.apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: abortController.signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API 请求失败: ${response.status} ${errorText}`)
    }

    return response
  }

  /**
   * 处理工具调用（执行工具并添加结果到消息历史）
   */
  private async handleToolCalls(
    toolCalls: ToolCall[],
    messages: Message[],
    webContents: Electron.WebContents
  ): Promise<void> {
    for (const toolCall of toolCalls) {
      try {
        const toolResult = await this.executeToolCall(toolCall, webContents)

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult)
        })
      } catch (error) {
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            error: error instanceof Error ? error.message : '工具调用失败'
          })
        })
      }
    }
  }

  /**
   * 非流式调用 AI（支持自动工具调用循环）
   */
  private async callAI(
    option: AiOption,
    requestId: string,
    webContents: Electron.WebContents
  ): Promise<{ success: boolean; data?: Message; error?: string }> {
    const modelConfig = await this.getModelConfig(option.model)
    if (!modelConfig) {
      return { success: false, error: '未找到 AI 模型配置，请先在设置中添加模型' }
    }

    const abortController = new AbortController()
    this.abortControllers.set(requestId, abortController)

    try {
      const messages = [...option.messages]
      let loopCount = 0
      const maxLoops = 10

      while (loopCount < maxLoops) {
        loopCount++

        // 通知开始发送请求
        this.notifyAiStatus('sending', webContents)

        const requestBody = this.buildRequestBody(modelConfig, messages, option.tools, false)
        const response = await this.sendAPIRequest(modelConfig, requestBody, abortController)

        // 通知开始接收响应
        this.notifyAiStatus('receiving', webContents)

        const data = await response.json()

        const assistantMessage: Message = {
          role: 'assistant',
          content: data.choices?.[0]?.message?.content || '',
          reasoning_content: data.choices?.[0]?.message?.reasoning_content
        }

        const toolCalls = data.choices?.[0]?.message?.tool_calls
        if (toolCalls) {
          assistantMessage.tool_calls = toolCalls
          messages.push(assistantMessage)
          await this.handleToolCalls(toolCalls, messages, webContents)
          continue
        }

        // 请求成功完成，重置状态
        this.notifyAiStatus('idle', webContents)
        return { success: true, data: assistantMessage }
      }

      // 循环超限，重置状态
      this.notifyAiStatus('idle', webContents)
      return {
        success: false,
        error: `工具调用循环超过最大次数 (${maxLoops})，可能存在无限循环`
      }
    } catch (error: unknown) {
      // 出错时重置状态
      this.notifyAiStatus('idle', webContents)
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: 'AI 调用已中止' }
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误'
      }
    } finally {
      this.abortControllers.delete(requestId)
    }
  }

  /**
   * 执行工具调用
   */
  private async executeToolCall(
    toolCall: ToolCall,
    webContents: Electron.WebContents
  ): Promise<any> {
    // 调用插件的工具函数
    const functionName = toolCall.function.name
    const args = toolCall.function.arguments

    try {
      const result = await webContents.executeJavaScript(`
        (async () => {
          if (typeof window.${functionName} === 'function') {
            const args = ${args};
            return await window.${functionName}(args);
          } else {
            throw new Error('函数 ${functionName} 不存在');
          }
        })()
      `)

      return result
    } catch (error) {
      throw new Error(
        `工具 ${functionName} 执行失败: ${error instanceof Error ? error.message : '未知错误'}`
      )
    }
  }

  /**
   * 解析流式响应（SSE 格式）
   */
  private async parseStreamResponse(
    response: Response,
    onChunk: (chunk: Message) => void
  ): Promise<{
    content: string
    reasoning_content: string
    tool_calls: ToolCall[]
  }> {
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('无法读取响应流')
    }

    const decoder = new TextDecoder()
    let buffer = ''

    let accumulatedContent = ''
    let accumulatedReasoningContent = ''
    const accumulatedToolCalls: ToolCall[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmedLine = line.trim()
        if (!trimmedLine || trimmedLine === 'data: [DONE]') continue

        if (trimmedLine.startsWith('data: ')) {
          try {
            const jsonStr = trimmedLine.slice(6)
            const data = JSON.parse(jsonStr)

            const delta = data.choices?.[0]?.delta
            if (delta) {
              const chunk: Message = {
                role: delta.role || 'assistant',
                content: delta.content || '',
                reasoning_content: delta.reasoning_content
              }

              if (delta.content) {
                accumulatedContent += delta.content
              }
              if (delta.reasoning_content) {
                accumulatedReasoningContent += delta.reasoning_content
              }

              if (delta.tool_calls) {
                chunk.tool_calls = delta.tool_calls

                for (const toolCall of delta.tool_calls) {
                  const index = toolCall.index || 0
                  if (!accumulatedToolCalls[index]) {
                    accumulatedToolCalls[index] = {
                      id: toolCall.id || '',
                      type: 'function',
                      function: {
                        name: toolCall.function?.name || '',
                        arguments: toolCall.function?.arguments || ''
                      }
                    }
                  } else {
                    if (toolCall.function?.name) {
                      accumulatedToolCalls[index].function.name += toolCall.function.name
                    }
                    if (toolCall.function?.arguments) {
                      accumulatedToolCalls[index].function.arguments += toolCall.function.arguments
                    }
                  }
                }
              }

              if (chunk.content || chunk.reasoning_content) {
                onChunk(chunk)
              }
            }
          } catch (error) {
            console.error('[AI] 解析流式数据失败:', error)
          }
        }
      }
    }

    return {
      content: accumulatedContent,
      reasoning_content: accumulatedReasoningContent,
      tool_calls: accumulatedToolCalls
    }
  }

  /**
   * 流式调用 AI（支持自动工具调用循环）
   */
  private async callAIStream(
    option: AiOption,
    requestId: string,
    webContents: Electron.WebContents,
    onChunk: (chunk: Message) => void
  ): Promise<void> {
    const modelConfig = await this.getModelConfig(option.model)
    if (!modelConfig) {
      throw new Error('未找到 AI 模型配置，请先在设置中添加模型')
    }

    const abortController = new AbortController()
    this.abortControllers.set(requestId, abortController)

    try {
      const messages = [...option.messages]
      let loopCount = 0
      const maxLoops = 10

      while (loopCount < maxLoops) {
        loopCount++

        // 通知开始发送请求
        this.notifyAiStatus('sending', webContents)

        const requestBody = this.buildRequestBody(modelConfig, messages, option.tools, true)
        const response = await this.sendAPIRequest(modelConfig, requestBody, abortController)

        // 通知开始接收响应
        this.notifyAiStatus('receiving', webContents)

        const { content, reasoning_content, tool_calls } = await this.parseStreamResponse(
          response,
          onChunk
        )

        if (tool_calls.length > 0) {
          const assistantMessage: Message = {
            role: 'assistant',
            content,
            reasoning_content,
            tool_calls
          }
          messages.push(assistantMessage)
          await this.handleToolCalls(tool_calls, messages, webContents)
          continue
        }

        // 流式调用成功完成，重置状态
        this.notifyAiStatus('idle', webContents)
        return
      }

      // 循环超限，重置状态
      this.notifyAiStatus('idle', webContents)
      throw new Error(`工具调用循环超过最大次数 (${maxLoops})，可能存在无限循环`)
    } catch (error: unknown) {
      // 出错时重置状态
      this.notifyAiStatus('idle', webContents)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('AI 调用已中止')
      }
      throw error
    } finally {
      this.abortControllers.delete(requestId)
    }
  }

  /**
   * 中止 AI 调用
   */
  private abortAICall(requestId: string): void {
    const abortController = this.abortControllers.get(requestId)
    if (abortController) {
      abortController.abort()
      this.abortControllers.delete(requestId)
    }
  }
}

// 导出单例
export default new PluginAiAPI()
