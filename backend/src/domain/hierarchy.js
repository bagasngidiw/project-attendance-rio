/**
 * Pure hierarchy domain rules.
 *
 * A chart is a forest of user nodes. `parentNodeId` expresses reporting
 * direction and `sortOrder` controls the visual left/right order of siblings.
 * No RBAC or persistence concerns belong in this module.
 */

const { ValidationError, ConflictError } = require("./errors");

const HIERARCHY_STATUSES = Object.freeze(["DRAFT", "ACTIVE", "ARCHIVED"]);
const HIERARCHY_RELATIONS = Object.freeze([
  "ROOT",
  "CHILD",
  "PARENT",
  "SIBLING_BEFORE",
  "SIBLING_AFTER",
]);
const HIERARCHY_EVENTS = Object.freeze([
  "CREATED",
  "NODE_ADDED",
  "NODE_REPARENTED",
  "NODE_REMOVED",
  "ACTIVATED",
  "ARCHIVED",
]);

function idOf(value) {
  if (value == null) return null;
  return String(value);
}

function cloneNodes(nodes = []) {
  return nodes.map((node) => ({
    nodeId: idOf(node.nodeId ?? node._id),
    userId: idOf(node.userId),
    parentNodeId: idOf(node.parentNodeId),
    sortOrder: Number.isFinite(Number(node.sortOrder)) ? Number(node.sortOrder) : 0,
  }));
}

function findNode(nodes, nodeId) {
  const wanted = idOf(nodeId);
  return nodes.find((node) => idOf(node.nodeId) === wanted) ?? null;
}

function siblingNodes(nodes, parentNodeId) {
  const parent = idOf(parentNodeId);
  return nodes
    .filter((node) => idOf(node.parentNodeId) === parent)
    .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder) || idOf(a.nodeId).localeCompare(idOf(b.nodeId)));
}

function normalizeSortOrder(nodes) {
  const parents = new Map();
  for (const node of nodes) {
    const key = idOf(node.parentNodeId) ?? "ROOT";
    if (!parents.has(key)) parents.set(key, []);
    parents.get(key).push(node);
  }
  for (const siblings of parents.values()) {
    siblings.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder) || idOf(a.nodeId).localeCompare(idOf(b.nodeId)));
    siblings.forEach((node, index) => {
      node.sortOrder = index;
    });
  }
  return nodes;
}

function assertNoCycle(nodes) {
  const byId = new Map(nodes.map((node) => [idOf(node.nodeId), node]));
  for (const node of nodes) {
    const visited = new Set();
    let current = node;
    while (current?.parentNodeId != null) {
      const parentId = idOf(current.parentNodeId);
      if (visited.has(parentId) || parentId === idOf(node.nodeId)) {
        throw new ValidationError("Hierarchy cannot contain a reporting cycle.", {
          field: "parentNodeId",
        });
      }
      visited.add(parentId);
      current = byId.get(parentId);
      if (!current) {
        throw new ValidationError("Hierarchy node references an unknown parent.", {
          field: "parentNodeId",
        });
      }
    }
  }
}

function validateNodes(nodes = []) {
  const normalized = cloneNodes(nodes);
  const nodeIds = new Set();
  const userIds = new Set();
  for (const node of normalized) {
    if (!node.nodeId || !node.userId) {
      throw new ValidationError("Every hierarchy node requires a node and user.", {
        field: "nodes",
      });
    }
    if (nodeIds.has(node.nodeId)) {
      throw new ValidationError("A hierarchy node cannot be duplicated.", { field: "nodes" });
    }
    if (userIds.has(node.userId)) {
      throw new ConflictError("A user can appear only once in the same hierarchy.", "HIERARCHY_DUPLICATE_USER");
    }
    nodeIds.add(node.nodeId);
    userIds.add(node.userId);
    if (node.parentNodeId && !nodeIds.has(node.parentNodeId)) {
      // Parent nodes are not required to appear earlier in persistence, so the
      // complete reference check is performed below after collecting IDs.
    }
  }
  for (const node of normalized) {
    if (node.parentNodeId && !nodeIds.has(node.parentNodeId)) {
      throw new ValidationError("Hierarchy node references an unknown parent.", { field: "parentNodeId" });
    }
  }
  assertNoCycle(normalized);
  return normalizeSortOrder(normalized);
}

function assertRelation(relation) {
  if (!HIERARCHY_RELATIONS.includes(relation)) {
    throw new ValidationError(`Relation must be one of ${HIERARCHY_RELATIONS.join(", ")}.`, {
      field: "relation",
    });
  }
}

/** Adds one user node and returns a new validated node array. */
function addNode(nodes, { nodeId, userId, anchorNodeId = null, relation = "ROOT" }) {
  assertRelation(relation);
  const next = cloneNodes(nodes);
  const normalizedUserId = idOf(userId);
  if (!normalizedUserId) throw new ValidationError("A user is required.", { field: "userId" });
  if (next.some((node) => idOf(node.userId) === normalizedUserId)) {
    throw new ConflictError("This user is already in the hierarchy.", "HIERARCHY_DUPLICATE_USER");
  }

  const generatedNodeId = idOf(nodeId);
  if (!generatedNodeId) throw new ValidationError("A node id is required.", { field: "nodeId" });
  if (next.some((node) => idOf(node.nodeId) === generatedNodeId)) {
    throw new ConflictError("The hierarchy node already exists.", "HIERARCHY_NODE_EXISTS");
  }

  if (relation === "ROOT") {
    if (anchorNodeId) throw new ValidationError("A root node cannot have an anchor.", { field: "anchorNodeId" });
    next.push({ nodeId: generatedNodeId, userId: normalizedUserId, parentNodeId: null, sortOrder: next.length });
    return normalizeSortOrder(next);
  }

  const anchor = findNode(next, anchorNodeId);
  if (!anchor) throw new ValidationError("The selected hierarchy anchor was not found.", { field: "anchorNodeId" });
  const anchorParent = idOf(anchor.parentNodeId);
  const anchorOrder = Number(anchor.sortOrder);
  let parentNodeId = anchorParent;
  let newOrder = anchorOrder;

  if (relation === "CHILD") {
    parentNodeId = idOf(anchor.nodeId);
    newOrder = siblingNodes(next, anchor.nodeId).length;
  } else if (relation === "PARENT") {
    parentNodeId = anchorParent;
    anchor.parentNodeId = generatedNodeId;
    newOrder = anchorOrder;
  } else if (relation === "SIBLING_AFTER") {
    newOrder = anchorOrder + 1;
  }

  if (relation === "SIBLING_BEFORE") newOrder = anchorOrder;
  next.forEach((node) => {
    if (idOf(node.parentNodeId) === idOf(parentNodeId) && Number(node.sortOrder) >= newOrder) {
      node.sortOrder += 1;
    }
  });
  next.push({
    nodeId: generatedNodeId,
    userId: normalizedUserId,
    parentNodeId,
    sortOrder: newOrder,
  });
  return validateNodes(next);
}

/** Removes a node, optionally promoting its children to the removed node's parent. */
function removeNode(nodes, nodeId, { promoteChildren = false } = {}) {
  const next = cloneNodes(nodes);
  const target = findNode(next, nodeId);
  if (!target) throw new ValidationError("The hierarchy node was not found.", { field: "nodeId" });
  const children = siblingNodes(next, target.nodeId);
  if (children.length > 0 && !promoteChildren) {
    throw new ConflictError(
      "This node still has subordinates. Confirm child promotion before deleting it.",
      "HIERARCHY_NODE_HAS_CHILDREN"
    );
  }
  const parentId = idOf(target.parentNodeId);
  const targetOrder = Number(target.sortOrder);
  const remaining = next.filter((node) => idOf(node.nodeId) !== idOf(nodeId));
  if (promoteChildren) {
    children.forEach((child, index) => {
      child.parentNodeId = parentId;
      child.sortOrder = targetOrder + index;
    });
    remaining.forEach((node) => {
      if (idOf(node.parentNodeId) === parentId && Number(node.sortOrder) > targetOrder) {
        node.sortOrder += children.length - 1;
      }
    });
  }
  return validateNodes(remaining);
}

function ancestorsOf(nodes, nodeId) {
  const validated = validateNodes(nodes);
  const byId = new Map(validated.map((node) => [idOf(node.nodeId), node]));
  const result = [];
  let current = byId.get(idOf(nodeId));
  const visited = new Set();
  while (current?.parentNodeId) {
    const parentId = idOf(current.parentNodeId);
    if (visited.has(parentId)) throw new ValidationError("Hierarchy contains a cycle.", { field: "nodes" });
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    result.push(parent);
    current = parent;
  }
  return result;
}

function descendantsOf(nodes, nodeId) {
  const validated = validateNodes(nodes);
  const children = new Map();
  for (const node of validated) {
    const parentId = idOf(node.parentNodeId);
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(node);
  }
  const result = [];
  const queue = [...(children.get(idOf(nodeId)) ?? [])];
  while (queue.length) {
    const node = queue.shift();
    result.push(node);
    queue.push(...(children.get(idOf(node.nodeId)) ?? []));
  }
  return result;
}

module.exports = {
  HIERARCHY_STATUSES,
  HIERARCHY_RELATIONS,
  HIERARCHY_EVENTS,
  addNode,
  removeNode,
  validateNodes,
  findNode,
  ancestorsOf,
  descendantsOf,
  normalizeSortOrder,
};
