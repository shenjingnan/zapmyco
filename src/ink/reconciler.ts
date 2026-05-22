/**
 * React 自定义 reconciler — 将 React 元素树映射到终端 DOM 节点。
 *
 * 使用 react-reconciler 的 createReconciler() 定义 host config。
 * 每次 React commit 后，resetAfterCommit 触发渲染生命周期。
 *
 * PR2 增强：
 * - hideInstance: 设置 isHidden 标志
 * - commitUpdate: 同步 style 变更到 Yoga 节点
 */

import { createContext } from 'react';
import createReconciler from 'react-reconciler';
import { DefaultEventPriority, NoEventPriority } from 'react-reconciler/constants.js';
import type { DOMElement, ElementName, TextNode } from './dom';
import * as dom from './dom';
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
// 事件优先级追踪
// ---------------------------------------------------------------------------

let currentUpdatePriority: number = DefaultEventPriority;

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
      type === 'ink-virtual-text'
        ? type
        : 'ink-box';
    const node = dom.createNode(sanitized);

    for (const [key, value] of Object.entries(newProps)) {
      if (key === 'children') continue;
      dom.setAttribute(node, key, value);
    }

    // 将 style props 映射到 node.style 并同步到 Yoga 节点
    if (newProps.style && typeof newProps.style === 'object') {
      const style = newProps.style as Record<string, unknown>;
      Object.assign(node.style, style);

      // 同步到 Yoga 节点
      if (node.yogaNode) {
        applyStyles(style as Parameters<typeof applyStyles>[0], node.yogaNode);
      }
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
    // 同步 style 变更到 node
    for (const [key, value] of Object.entries(newProps)) {
      if (key === 'children') continue;
      dom.setAttribute(node, key, value);
    }

    // 同步到 Yoga 节点
    if (newProps.style && typeof newProps.style === 'object') {
      const style = newProps.style as Record<string, unknown>;
      Object.assign(node.style, style);
      if (node.yogaNode) {
        applyStyles(style as Parameters<typeof applyStyles>[0], node.yogaNode);
      }
    }
  },

  commitTextUpdate(node, _oldText, newText) {
    dom.setTextNodeValue(node, newText);
  },

  /** 隐藏实例 — 设置 isHidden 标志（PR2 实现） */
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
    currentUpdatePriority = priority;
  },
  getCurrentUpdatePriority() {
    return currentUpdatePriority;
  },
  resolveUpdatePriority() {
    return currentUpdatePriority !== NoEventPriority ? currentUpdatePriority : DefaultEventPriority;
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
    return null;
  },
  resolveEventTimeStamp() {
    return -1.1;
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

export default reconciler;
