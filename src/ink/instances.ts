/**
 * Ink Instance Registry
 *
 * Maps each stdout to its Ink instance so that components like AlternateScreen
 * can access the Ink instance without prop drilling.
 *
 * In the Ink constructor the instance registers itself; on unmount it deletes
 * itself so the WeakMap-like semantics are clean.
 */

import type { Ink } from './ink';

const instances = new Map<NodeJS.WriteStream, Ink>();

export default instances;
