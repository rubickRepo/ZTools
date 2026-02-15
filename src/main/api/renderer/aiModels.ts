import { ipcMain } from 'electron'
import databaseAPI from '../shared/database'

/**
 * AI 模型数据结构
 */
export interface AiModel {
  id: string // 模型ID（例如：qwen-plus-latest）
  label: string // 模型名称（例如：通义千问）
  apiUrl: string // API地址（必须使用与 OpenAI 兼容的 API 格式）
  apiKey: string // API密钥
  description?: string // 模型描述
  icon?: string // 模型图标
  cost?: number // 模型调用消耗
}

/**
 * AI 模型管理 API（主程序渲染进程专用）
 */
class AiModelsAPI {
  private readonly DB_KEY = 'ai-models' // databaseAPI 会自动添加 ZTOOLS/ 前缀

  /**
   * 初始化 API
   */
  public init(): void {
    this.setupIPC()
  }

  /**
   * 设置 IPC 处理器
   */
  private setupIPC(): void {
    // 获取所有 AI 模型
    ipcMain.handle('ai-models:get-all', async () => {
      try {
        const models = await this.getAllModels()
        return { success: true, data: models }
      } catch (error: unknown) {
        console.error('[AIModels] 获取 AI 模型列表失败:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    // 添加 AI 模型
    ipcMain.handle('ai-models:add', async (_event, model: AiModel) => {
      try {
        const result = await this.addModel(model)
        return result
      } catch (error: unknown) {
        console.error('[AIModels] 添加 AI 模型失败:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    // 更新 AI 模型
    ipcMain.handle('ai-models:update', async (_event, model: AiModel) => {
      try {
        const result = await this.updateModel(model)
        return result
      } catch (error: unknown) {
        console.error('[AIModels] 更新 AI 模型失败:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })

    // 删除 AI 模型
    ipcMain.handle('ai-models:delete', async (_event, modelId: string) => {
      try {
        const result = await this.deleteModel(modelId)
        return result
      } catch (error: unknown) {
        console.error('[AIModels] 删除 AI 模型失败:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : '未知错误'
        }
      }
    })
  }

  /**
   * 获取所有 AI 模型
   */
  public async getAllModels(): Promise<AiModel[]> {
    try {
      const data = await databaseAPI.dbGet(this.DB_KEY)
      if (data && Array.isArray(data)) {
        return data
      }
      return []
    } catch {
      // 如果文档不存在，返回空数组
      return []
    }
  }

  /**
   * 添加 AI 模型
   */
  private async addModel(model: AiModel): Promise<{ success: boolean; error?: string }> {
    // 验证必填字段
    if (!model.id || !model.label || !model.apiUrl || !model.apiKey) {
      return { success: false, error: '模型ID、名称、API地址和密钥不能为空' }
    }

    const models = await this.getAllModels()

    // 检查是否已存在相同 ID 的模型
    if (models.some((m: AiModel) => m.id === model.id)) {
      return { success: false, error: '该模型ID已存在' }
    }

    // 添加新模型
    models.push(model)

    // 保存到数据库（databaseAPI 会自动处理 _rev）
    await databaseAPI.dbPut(this.DB_KEY, models)

    return { success: true }
  }

  /**
   * 更新 AI 模型
   */
  private async updateModel(model: AiModel): Promise<{ success: boolean; error?: string }> {
    // 验证必填字段
    if (!model.id || !model.label || !model.apiUrl || !model.apiKey) {
      return { success: false, error: '模型ID、名称、API地址和密钥不能为空' }
    }

    const models = await this.getAllModels()

    // 查找要更新的模型
    const index = models.findIndex((m: AiModel) => m.id === model.id)
    if (index === -1) {
      return { success: false, error: '未找到该模型' }
    }

    // 更新模型
    models[index] = model

    // 保存到数据库（databaseAPI 会自动处理 _rev）
    await databaseAPI.dbPut(this.DB_KEY, models)

    return { success: true }
  }

  /**
   * 删除 AI 模型
   */
  private async deleteModel(modelId: string): Promise<{ success: boolean; error?: string }> {
    const models = await this.getAllModels()

    // 查找要删除的模型
    const index = models.findIndex((m: AiModel) => m.id === modelId)
    if (index === -1) {
      return { success: false, error: '未找到该模型' }
    }

    // 删除模型
    models.splice(index, 1)

    // 保存到数据库（databaseAPI 会自动处理 _rev）
    await databaseAPI.dbPut(this.DB_KEY, models)

    return { success: true }
  }
}

// 导出单例
export default new AiModelsAPI()
