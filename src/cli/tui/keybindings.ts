/**
 * 键绑定管理
 *
 * 键绑定管理器。
 * 保留 setUserBindings 接口以供兼容。
 */

const userBindings: Record<string, string[]> = {};

/**
 * 获取键绑定管理器
 *
 * 当前为桩实现，仅存储用户绑定配置（SelectList 导航键）。
 */
export function getKeybindings() {
  return {
    setUserBindings(bindings: Record<string, string[]>) {
      Object.assign(userBindings, bindings);
    },
  };
}
