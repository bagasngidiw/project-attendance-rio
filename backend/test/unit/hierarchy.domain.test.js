const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  addNode,
  removeNode,
  ancestorsOf,
  descendantsOf,
  validateNodes,
} = require("../../src/domain/hierarchy");

const node = (nodeId, userId, parentNodeId = null, sortOrder = 0) => ({
  nodeId,
  userId,
  parentNodeId,
  sortOrder,
});

test("hierarchy domain adds root, child, parent, and ordered siblings", () => {
  let nodes = addNode([], { nodeId: "n1", userId: "u1", relation: "ROOT" });
  nodes = addNode(nodes, { nodeId: "n2", userId: "u2", anchorNodeId: "n1", relation: "CHILD" });
  nodes = addNode(nodes, { nodeId: "n3", userId: "u3", anchorNodeId: "n2", relation: "PARENT" });
  nodes = addNode(nodes, { nodeId: "n4", userId: "u4", anchorNodeId: "n1", relation: "SIBLING_BEFORE" });

  assert.equal(nodes.find((item) => item.nodeId === "n2").parentNodeId, "n3");
  assert.equal(nodes.find((item) => item.nodeId === "n3").parentNodeId, "n1");
  assert.equal(nodes.find((item) => item.userId === "u4").parentNodeId, null);
  assert.deepEqual(
    nodes.filter((item) => item.parentNodeId === null).sort((a, b) => a.sortOrder - b.sortOrder).map((item) => item.userId),
    ["u4", "u1"]
  );
});

test("hierarchy domain rejects duplicate users and cycles", () => {
  assert.throws(
    () => addNode([node("n1", "u1")], { nodeId: "n2", userId: "u1", relation: "ROOT" }),
    (error) => error.code === "HIERARCHY_DUPLICATE_USER"
  );
  assert.throws(
    () => validateNodes([node("n1", "u1", "n2"), node("n2", "u2", "n1")]),
    (error) => error.code === "VALIDATION_ERROR"
  );
});

test("hierarchy domain computes ancestors and recursive descendants", () => {
  const nodes = [
    node("n1", "u1"),
    node("n2", "u2", "n1"),
    node("n3", "u3", "n2"),
    node("n4", "u4", "n1"),
  ];
  assert.deepEqual(ancestorsOf(nodes, "n3").map((item) => item.userId), ["u2", "u1"]);
  assert.deepEqual(descendantsOf(nodes, "n1").map((item) => item.userId).sort(), ["u2", "u3", "u4"]);
});

test("deleting a node can safely promote its children", () => {
  const nodes = [node("n1", "u1"), node("n2", "u2", "n1"), node("n3", "u3", "n2")];
  const next = removeNode(nodes, "n2", { promoteChildren: true });
  assert.equal(next.find((item) => item.nodeId === "n3").parentNodeId, "n1");
  assert.equal(next.some((item) => item.nodeId === "n2"), false);
});
