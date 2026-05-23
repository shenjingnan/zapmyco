/**
 * DOM 节点树 — Ink 的虚拟 DOM
 *
 * 定义 React reconciler 使用的 DOM 节点类型和树操作。
 * 每个 DOMElement 可以关联一个 Yoga 布局节点用于 flexbox 布局。
 */

import {
  type ELEMENT_BOX,
  type ELEMENT_ROOT,
  type ELEMENT_SCROLL_BOX,
  type ELEMENT_TEXT,
  type ELEMENT_VIRTUAL_TEXT,
  TEXT_NODE,
} from './constants';
import { createLayoutNode } from './layout/engine';
import type { LayoutNode } from './layout/node';
import type { Styles } from './styles';

// ---------------------------------------------------------------------------
// 元素类型名
// ---------------------------------------------------------------------------

export type ElementName =
  | typeof ELEMENT_ROOT
  | typeof ELEMENT_BOX
  | typeof ELEMENT_TEXT
  | typeof ELEMENT_VIRTUAL_TEXT
  | typeof ELEMENT_SCROLL_BOX;
export type TextName = typeof TEXT_NODE;
export type NodeName = ElementName | TextName;

// ---------------------------------------------------------------------------
// 节点类型
// ---------------------------------------------------------------------------

/**
 * DOM 元素 — React reconciler 创建和管理的终端 DOM 节点。
 */
export interface DOMElement {
  nodeName: ElementName;
  attributes: Record<string, unknown>;
  childNodes: DOMNode[];
  style: Styles;
  parentNode: DOMElement | undefined;
  /** Yoga 布局节点（PR2: 每个 DOM 元素创建时自动关联） */
  yogaNode?: LayoutNode;
  isStaticDirty?: boolean;
  staticNode?: DOMElement;
  /** 是否隐藏（由 reconciler hideInstance 设置） */
  isHidden?: boolean;
  /** 生命周期回调 — 由 Ink class 挂载 */
  onComputeLayout?: () => void;
  onRender?: () => void;
  onImmediateRender?: () => void;
}

/** 文本节点 */
export interface TextNode {
  nodeName: TextName;
  nodeValue: string;
  parentNode: DOMElement | undefined;
  yogaNode?: undefined;
}

export type DOMNode = DOMElement | TextNode;

// ---------------------------------------------------------------------------
// 树操作
// ---------------------------------------------------------------------------

/** 创建一个 DOM 元素，自动关联 Yoga 布局节点 */
export function createNode(nodeName: ElementName): DOMElement {
  return {
    nodeName,
    attributes: {},
    childNodes: [],
    style: {},
    parentNode: undefined,
    yogaNode: createLayoutNode(),
  };
}

/** 创建一个文本节点 */
export function createTextNode(text: string): TextNode {
  return {
    nodeName: TEXT_NODE,
    nodeValue: text,
    parentNode: undefined,
  };
}

/** 追加子节点 — 同时维护 Yoga 树结构 */
export function appendChildNode(parent: DOMElement, child: DOMNode): void {
  child.parentNode = parent;
  parent.childNodes.push(child);

  if ('yogaNode' in child && child.yogaNode && parent.yogaNode) {
    parent.yogaNode.insertChild(child.yogaNode, parent.childNodes.length - 1);
  }
}

/** 移除子节点 — 同时维护 Yoga 树结构 */
export function removeChildNode(parent: DOMElement, child: DOMNode): void {
  child.parentNode = undefined;
  const idx = parent.childNodes.indexOf(child);
  if (idx !== -1) {
    parent.childNodes.splice(idx, 1);
  }

  if ('yogaNode' in child && child.yogaNode && parent.yogaNode) {
    parent.yogaNode.removeChild(child.yogaNode);
  }
}

/** 在指定位置插入子节点 */
export function insertBeforeNode(
  parent: DOMElement,
  newChild: DOMNode,
  beforeChild: DOMNode
): void {
  newChild.parentNode = parent;
  const idx = parent.childNodes.indexOf(beforeChild);
  if (idx !== -1) {
    parent.childNodes.splice(idx, 0, newChild);
  } else {
    parent.childNodes.push(newChild);
  }

  if ('yogaNode' in newChild && newChild.yogaNode && parent.yogaNode) {
    parent.yogaNode.insertChild(newChild.yogaNode, idx !== -1 ? idx : parent.childNodes.length - 1);
  }
}

/** 设置属性 */
export function setAttribute(node: DOMElement, key: string, value: unknown): void {
  node.attributes[key] = value;
  // style 特殊处理
  if (key === 'style' && typeof value === 'object' && value !== null) {
    Object.assign(node.style, value);
  }
}

/** 设置文本节点内容 */
export function setTextNodeValue(node: TextNode, text: string): void {
  node.nodeValue = text;
}

/**
 * 标记节点为 dirty（需要重新渲染）。
 * 向上遍历祖先节点设置 dirty 标记。
 */
export function markDirty(node: DOMElement): void {
  node.attributes['data-dirty'] = true;
  let current: DOMElement | undefined = node;
  while (current) {
    current.attributes['data-dirty'] = true;
    current = current.parentNode;
  }
}
