/**
 * NavigationService — builds the filtered navigation tree for a user
 * (FR-003). Pure: takes an effective permission set and the module catalog,
 * returns the visible tree. No I/O.
 */

const { NAVIGATION_CATALOG } = require("../domain/navigation-catalog");

/**
 * Returns true when the user's effective permissions grant any of the
 * required keys. Wildcard `*` grants everything.
 *
 * @param {readonly string[]} permissions
 * @param {readonly string[]} anyOf
 */
function canView(permissions, anyOf) {
  if (permissions.includes("*")) return true;
  return anyOf.some((key) => permissions.includes(key));
}

/**
 * Builds the navigation tree visible to the given permission set.
 *
 * Group nodes (with children) carry no permission of their own: a group is
 * visible when at least one descendant leaf is visible and is pruned entirely
 * when every child is filtered out. Nested group nodes are supported — a child
 * that is itself a group is kept when it has visible descendants. Leaf nodes
 * render on their own `anyOf`.
 *
 * @param {readonly string[]} permissions effective permission keys
 * @returns {Array<object>} filtered, serializable navigation tree
 */
function buildNavigationFor(permissions) {
  const visible = [];
  for (const node of NAVIGATION_CATALOG) {
    const built = buildNode(node, permissions);
    if (built) visible.push(built);
  }
  return visible;
}

/**
 * Recursively filters one catalog node: leaves render when the user holds any
 * of their `anyOf` keys; group nodes render when at least one descendant leaf
 * is visible (nested groups included). Returns null when pruned.
 */
function buildNode(node, permissions) {
  const children = (node.children ?? [])
    .map((child) => buildNode(child, permissions))
    .filter(Boolean);

  if ((node.children ?? []).length > 0) {
    // Group node: prune when none of its (possibly nested) children are visible.
    if (children.length === 0) return null;
    return {
      id: node.id,
      module: node.module,
      label: node.label,
      path: node.path ?? null,
      icon: node.icon ?? null,
      children,
    };
  }

  if (!canView(permissions, node.anyOf)) return null;
  return toNavigationNode(node);
}

function toNavigationNode(node) {
  return {
    id: node.id,
    label: node.label,
    path: node.path,
    icon: node.icon,
    children: (node.children ?? []).map(toNavigationNode),
  };
}

/**
 * Bulk permission check (design §5.1 POST /access/check). Answers for every
 * requested key whether the user holds it, plus wildcard semantics.
 *
 * @param {readonly string[]} permissions
 * @param {readonly string[]} requestedKeys
 * @returns {Array<{ key: string, granted: boolean }>}
 */
function checkPermissions(permissions, requestedKeys) {
  return [...new Set(requestedKeys)].map((key) => ({
    key,
    granted: canView(permissions, [key]),
  }));
}

module.exports = {
  buildNavigationFor,
  checkPermissions,
  canView,
  NAVIGATION_CATALOG,
};
