/**
 * zbrowser 设备模拟配置
 *
 * 定义常用移动设备的屏幕尺寸和 UserAgent 字符串，
 * 供 zbrowser.device(name) 方法使用。
 *
 * 与 uTools ubrowser 内置设备列表保持一致。
 */

/** 设备配置项 */
export interface DeviceConfig {
  /** 屏幕尺寸 */
  size: {
    /** 宽度（像素） */
    width: number
    /** 高度（像素） */
    height: number
  }
  /** UserAgent 字符串 */
  useragent: string
}

/** 内置设备预设列表 */
export const ZBROWSER_DEVICES: Record<string, DeviceConfig> = {
  'iPhone 11': {
    size: { width: 414, height: 896 },
    useragent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1'
  },
  'iPhone X': {
    size: { width: 375, height: 812 },
    useragent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1'
  },
  iPad: {
    size: { width: 768, height: 1024 },
    useragent:
      'Mozilla/5.0 (iPad; CPU OS 11_0 like Mac OS X) AppleWebKit/604.1.34 (KHTML, like Gecko) Version/11.0 Mobile/15A5341f Safari/604.1'
  },
  'iPhone 6/7/8 Plus': {
    size: { width: 414, height: 736 },
    useragent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1'
  },
  'iPhone 6/7/8': {
    size: { width: 375, height: 667 },
    useragent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1'
  },
  'iPhone 5/SE': {
    size: { width: 320, height: 568 },
    useragent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_1 like Mac OS X) AppleWebKit/603.1.30 (KHTML, like Gecko) Version/10.0 Mobile/14E304 Safari/602.1'
  },
  'HUAWEI Mate10': {
    size: { width: 360, height: 640 },
    useragent:
      'Mozilla/5.0 (Linux; U; Android 8.1.0; ALP-AL00 Build/HUAWEIALP-AL00) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/80.0.3987.86 Mobile Safari/537.36'
  },
  'HUAWEI Mate20': {
    size: { width: 360, height: 748 },
    useragent:
      'Mozilla/5.0 (Linux; U; Android 9; HMA-AL00 Build/HUAWEIHMA-AL00) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/80.0.3987.86 Mobile Safari/537.36'
  },
  'HUAWEI Mate30': {
    size: { width: 360, height: 780 },
    useragent:
      'Mozilla/5.0 (Linux; U; Android 10; TAS-AL00 Build/HUAWEITAS-AL00) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/80.0.3987.86 Mobile Safari/537.36'
  },
  'HUAWEI Mate30 Pro': {
    size: { width: 392, height: 800 },
    useragent:
      'Mozilla/5.0 (Linux; U; Android 10; LIO-AL00 Build/HUAWEILIO-AL00) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/80.0.3987.86 Mobile Safari/537.36'
  }
}
