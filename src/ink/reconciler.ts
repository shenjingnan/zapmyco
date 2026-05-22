/**
 * React 自定义 reconciler — 将 React 元素树映射到终端 DOM 节点。
 *
 * 使用 react-reconciler 的 createReconciler() 定义 host config。
 * 每次 React commit 后，resetAfterCommit 触发渲染生命周期。
 */

import { createContext } from 'react';
import createReconciler from 'react-reconciler';
import { DefaultEventPriority, NoEventPriority } from 'react-reconciler/constants.js';
import type { DOMElement, ElementName, TextNode } from './dom';
import * as dom from './dom';

// ---------------------------------------------------------------------------
// 类型参数（匹配 @types/react-reconciler 的 15 个泛型参数）
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

    // 将 style props 映射到 node.style
    if (newProps.style && typeof newProps.style === 'object') {
      Object.assign(node.style, newProps.style);
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
      dom.setAttribute(node, key, value);
    }
  },

  commitTextUpdate(node, _oldText, newText) {
    dom.setTextNodeValue(node, newText);
  },

  hideInstance() {
    // PR1: no-op
  },

  unhideInstance() {
    // PR1: no-op
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
  // biome-ignore lint/suspicious/noExplicitAny: reconciler 内部类型不匹配 React 公开类型
  HostTransitionContext: createContext(null as unknown as TransitionStatus) as any,

  // ---- 表单 ----
  resetFormInstance() {
    // no-op (FormInstance = never)
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
