/**
 * React 自定义 reconciler — 将 React 元素树映射到终端 DOM 节点。
 *
 * 使用 react-reconciler 的 createReconciler() 定义 host config。
 * 每次 React commit 后，resetAfterCommit 触发渲染生命周期。
 *
 * PR2 增强：
 * - hideInstance: 设置 isHidden 标志
 * - commitUpdate: 同步 style 变更到 Yoga 节点
 *
 * PR7 增强：
 * - 事件处理器属性识别和存储（_eventHandlers）
 * - Dispatcher 集成（事件优先级、事件类型、时间戳）
 * - applyProp() 统一属性处理
 */

import { createContext } from 'react';
import createReconciler from 'react-reconciler';
import type { DOMElement, ElementName, TextNode } from './dom';
import * as dom from './dom';
import { Dispatcher } from './events/dispatcher';
import { EVENT_HANDLER_PROPS } from './events/event-handlers';
import { applyStyles } from './styles';

// ---------------------------------------------------------------------------
// 类型参数
// ---------------------------------------------------------------------------

type Type = ElementName;
type Props = Record<string, unknown>;
type Container = DOMElement;
type Instance = DOMElement;
type TextInstance = TextNode;
type SuspenseInstance = DOMElement;
type HydratableInstance = never;
type FormInstance = never;
type PublicInstance = DOMElement;
type HostContext = { isInsideText: boolean };
type ChildSet = never;
type TimeoutHandle = ReturnType<typeof setTimeout>;
type NoTimeout = -1;
type TransitionStatus = unknown;

// ---------------------------------------------------------------------------
// 事件处理器辅助函数
// ---------------------------------------------------------------------------

function setEventHandler(node: DOMElement, key: string, value: unknown): void {
  if (!node._eventHandlers) {
    node._eventHandlers = {};
  }
  node._eventHandlers[key] = value;
}

function applyProp(node: DOMElement, key: string, value: unknown): void {
  if (key === 'children') return;

  if (key === 'style') {
    if (typeof value === 'object' && value !== null) {
      Object.assign(node.style, value);
      if (node.yogaNode) {
        applyStyles(value as Parameters<typeof applyStyles>[0], node.yogaNode);
      }
    }
    return;
  }

  if (EVENT_HANDLER_PROPS.has(key)) {
    setEventHandler(node, key, value);
    return;
  }

  dom.setAttribute(node, key, value);
}

// ---------------------------------------------------------------------------
// Dispatcher 实例
// ---------------------------------------------------------------------------

export const dispatcher = new Dispatcher();

// ---------------------------------------------------------------------------
// Reconciler 实例
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reconciler = createReconciler<
  Type,
  Props,
  Container,
  Instance,
  TextInstance,
  SuspenseInstance,
  HydratableInstance,
  FormInstance,
  PublicInstance,
  HostContext,
  ChildSet,
  TimeoutHandle,
  NoTimeout,
  TransitionStatus
>({
  // ---- 模式 ----
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: true,
  supportsMicrotasks: true,
  warnsIfNotActing: false,

  // ---- 树构造 ----
  createInstance(type, newProps, _root, _hostContext) {
    const sanitized: ElementName =
      type === 'ink-root' ||
      type === 'ink-box' ||
      type === 'ink-text' ||
      type === 'ink-virtual-text' ||
      type === 'ink-scroll-box'
        ? type
        : 'ink-box';
    const node = dom.createNode(sanitized);

    for (const [key, value] of Object.entries(newProps)) {
      applyProp(node, key, value);
    }

    return node;
  },

  createTextInstance(text, _root, hostContext) {
    if (!hostContext.isInsideText) {
      throw new Error('Text 节点只能在 <Text> 组件内使用');
    }
    return dom.createTextNode(text);
  },

  appendInitialChild(parent, child) {
    dom.appendChildNode(parent, child);
  },

  finalizeInitialChildren() {
    return false;
  },

  shouldSetTextContent() {
    return false;
  },

  getRootHostContext() {
    return { isInsideText: false };
  },

  getChildHostContext(_parentHostContext, type) {
    const isInsideText = type === 'ink-text' || type === 'ink-virtual-text';
    return { isInsideText };
  },

  getPublicInstance(instance) {
    return instance as DOMElement;
  },

  prepareForCommit() {
    return null;
  },

  resetAfterCommit(rootNode) {
    // 触发渲染生命周期
    if (typeof rootNode.onComputeLayout === 'function') {
      rootNode.onComputeLayout();
    }
    if (rootNode.isStaticDirty) {
      rootNode.isStaticDirty = false;
      if (typeof rootNode.onImmediateRender === 'function') {
        rootNode.onImmediateRender();
      }
      return;
    }
    if (typeof rootNode.onRender === 'function') {
      rootNode.onRender();
    }
  },

  preparePortalMount() {
    // no-op
  },

  clearContainer(container) {
    container.childNodes = [];
  },

  // ---- 突变操作 ----
  appendChild(parent, child) {
    dom.appendChildNode(parent, child);
  },

  appendChildToContainer(container, child) {
    dom.appendChildNode(container, child);
  },

  insertBefore(parent, child, beforeChild) {
    dom.insertBeforeNode(parent, child, beforeChild);
  },

  insertInContainerBefore(container, child, beforeChild) {
    dom.insertBeforeNode(container, child, beforeChild);
  },

  removeChild(parent, child) {
    dom.removeChildNode(parent, child);
  },

  removeChildFromContainer(container, child) {
    dom.removeChildNode(container, child);
  },

  commitUpdate(node, _type, _oldProps, newProps) {
    for (const [key, value] of Object.entries(newProps)) {
      if (key === 'children') continue;

      // 事件处理器
      if (EVENT_HANDLER_PROPS.has(key)) {
        setEventHandler(node, key, value);
        continue;
      }

      // style
      if (key === 'style') {
        if (typeof value === 'object' && value !== null) {
          Object.assign(node.style, value);
          if (node.yogaNode) {
            applyStyles(value as Parameters<typeof applyStyles>[0], node.yogaNode);
          }
        }
        continue;
      }

      // 普通属性
      dom.setAttribute(node, key, value);
    }
  },

  commitTextUpdate(node, _oldText, newText) {
    dom.setTextNodeValue(node, newText);
  },

  /** 隐藏实例 */
  hideInstance(node: DOMElement): void {
    node.isHidden = true;
    dom.markDirty?.(node);
  },

  /** 取消隐藏 */
  unhideInstance(node: DOMElement): void {
    node.isHidden = false;
    dom.markDirty?.(node);
  },

  hideTextInstance(node) {
    dom.setTextNodeValue(node, '');
  },

  unhideTextInstance(node, text) {
    dom.setTextNodeValue(node, text);
  },

  // ---- Schedule ----
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1 as NoTimeout,
  scheduleMicrotask: queueMicrotask,

  // ---- 事件优先级 ----
  setCurrentUpdatePriority(priority: number) {
    dispatcher.currentUpdatePriority = priority;
  },
  getCurrentUpdatePriority() {
    return dispatcher.currentUpdatePriority;
  },
  resolveUpdatePriority() {
    return dispatcher.resolveEventPriority();
  },

  // ---- 暂停/过渡 ----
  NotPendingTransition: undefined as TransitionStatus,
  HostTransitionContext: createContext(null as unknown as TransitionStatus) as any,

  // ---- 表单 ----
  resetFormInstance() {
    // no-op
  },

  // ---- 渲染后回调 ----
  requestPostPaintCallback() {
    // no-op
  },

  // ---- 过渡 ----
  shouldAttemptEagerTransition() {
    return false;
  },

  // ---- 事件追踪 ----
  trackSchedulerEvent() {
    // no-op
  },
  resolveEventType() {
    return dispatcher.currentEvent?.type ?? null;
  },
  resolveEventTimeStamp() {
    return dispatcher.currentEvent?.timeStamp ?? -1.1;
  },

  // ---- 暂停提交 ----
  maySuspendCommit() {
    return false;
  },
  preloadInstance() {
    return true;
  },
  startSuspendingCommit() {
    // no-op
  },
  suspendInstance() {
    // no-op
  },
  waitForCommitToBeReady() {
    return null;
  },

  // ---- 实例追踪 ----
  getInstanceFromNode() {
    return null;
  },
  beforeActiveInstanceBlur() {
    // no-op
  },
  afterActiveInstanceBlur() {
    // no-op
  },
  prepareScopeUpdate() {
    // no-op
  },
  getInstanceFromScope() {
    return null;
  },
  detachDeletedInstance() {
    // no-op
  },
});

// 注入 discreteUpdates 到 Dispatcher（打破循环导入）
dispatcher.discreteUpdates = reconciler.discreteUpdates.bind(reconciler);

export default reconciler;
