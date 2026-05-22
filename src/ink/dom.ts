import {
  type ELEMENT_BOX,
  type ELEMENT_ROOT,
  type ELEMENT_TEXT,
  type ELEMENT_VIRTUAL_TEXT,
  TEXT_NODE,
} from './constants';
import type { Styles } from './styles';

// ---------------------------------------------------------------------------
// 元素类型名
// ---------------------------------------------------------------------------

export type ElementName =
  | typeof ELEMENT_ROOT
  | typeof ELEMENT_BOX
  | typeof ELEMENT_TEXT
  | typeof ELEMENT_VIRTUAL_TEXT;
export type TextName = typeof TEXT_NODE;
export type NodeName = ElementName | TextName;

// ---------------------------------------------------------------------------
// 节点类型
// ---------------------------------------------------------------------------

/**
 * DOM 元素 — React reconciler 创建和管理的终端 DOM 节点。
 *
 * onComputeLayout / onRender / onImmediateRender 是 Ink class
 * 挂载的生命周期回调，在 reconciler 的 resetAfterCommit 中触发。
 */
export interface DOMElement {
  nodeName: ElementName;
  attributes: Record<string, unknown>;
  childNodes: DOMNode[];
  style: Styles;
  parentNode: DOMElement | undefined;
  yogaNode?: unknown;
  isStaticDirty?: boolean;
  staticNode?: DOMElement;
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

/** 创建一个 DOM 元素 */
export function createNode(nodeName: ElementName): DOMElement {
  return {
    nodeName,
    attributes: {},
    childNodes: [],
    style: {},
    parentNode: undefined,
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

/** 追加子节点 */
export function appendChildNode(parent: DOMElement, child: DOMNode): void {
  child.parentNode = parent;
  parent.childNodes.push(child);
}

/** 移除子节点 */
export function removeChildNode(parent: DOMElement, child: DOMNode): void {
  child.parentNode = undefined;
  const idx = parent.childNodes.indexOf(child);
  if (idx !== -1) {
    parent.childNodes.splice(idx, 1);
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
