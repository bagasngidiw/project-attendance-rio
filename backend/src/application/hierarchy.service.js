const mongoose = require("mongoose");
const {
  addNode,
  removeNode,
  validateNodes,
  ancestorsOf,
  descendantsOf,
} = require("../domain/hierarchy");
const { ValidationError, NotFoundError, ConflictError } = require("../domain/errors");

class HierarchyService {
  constructor({
    hierarchyRepository,
    hierarchyHistoryRepository,
    contractPlacementRepository,
    contractTypeRepository,
    placementRepository,
    userRepository,
    userRoleRepository,
    roleRepository,
    auditService,
  }) {
    this.hierarchyRepository = hierarchyRepository;
    this.hierarchyHistoryRepository = hierarchyHistoryRepository;
    this.contractPlacementRepository = contractPlacementRepository;
    this.contractTypeRepository = contractTypeRepository;
    this.placementRepository = placementRepository;
    this.userRepository = userRepository;
    this.userRoleRepository = userRoleRepository;
    this.roleRepository = roleRepository;
    this.auditService = auditService;
  }

  async list(filters = {}) {
    const items = await this.hierarchyRepository.list(filters);
    return items.map((item) => this.toDto(item));
  }

  async getById(id) {
    const chart = await this.requireChart(id);
    return this.toDto(chart);
  }

  async listPlacements(contractTypeId) {
    const contract = await this.contractTypeRepository.findById(contractTypeId);
    if (!contract || contract.status !== "ACTIVE") {
      throw new ValidationError("Pilih kontrak yang aktif.", { field: "contractTypeId" });
    }
    const relations = await this.contractPlacementRepository.listActiveForContract(contractTypeId);
    const placementIds = relations.length ? relations.map((row) => String(row.placementId)) : null;
    const placements = await this.placementRepository.listActive();
    return placements
      .filter((placement) => !placementIds || placementIds.includes(String(placement.id ?? placement._id)))
      .map((placement) => this.masterDto(placement));
  }

  async create({ contractTypeId, placementId }, actor = {}) {
    await this.assertActiveScope(contractTypeId, placementId);
    const existing = await this.hierarchyRepository.findByScope(contractTypeId, placementId);
    if (existing) return this.toDto(existing);
    const created = await this.hierarchyRepository.create({ contractTypeId, placementId, actorId: actor.actorId });
    await this.recordHistory(created, "CREATED", actor, null, created.nodes);
    await this.audit("HIERARCHY.CREATED", created, actor, { contractTypeId, placementId });
    return this.toDto(created);
  }

  async eligibleUsers(id, { search = "", includeAssigned = false } = {}) {
    const chart = await this.requireChart(id);
    const usedIds = (chart.nodes ?? []).map((node) => String(node.userId));
    const { items } = await this.userRepository.list({
      search: String(search ?? "").trim() || undefined,
      status: "ACTIVE",
      contractTypeId: chart.contractTypeId,
      placementId: chart.placementId,
      page: 1,
      pageSize: 100,
    });
    const candidates = includeAssigned
      ? items
      : items.filter((user) => !usedIds.includes(String(user.id ?? user._id)));
    return this.enrichUsers(candidates);
  }

  async addNode(id, input, actor = {}) {
    const chart = await this.requireChart(id);
    this.assertEditable(chart);
    const user = await this.userRepository.findById(input.userId);
    this.assertUserMatchesScope(user, chart);
    const nodeId = input.nodeId && mongoose.Types.ObjectId.isValid(input.nodeId)
      ? input.nodeId
      : new mongoose.Types.ObjectId();
    const before = chart.nodes;
    const nextNodes = addNode(before, {
      nodeId,
      userId: input.userId,
      anchorNodeId: input.anchorNodeId ?? null,
      relation: input.relation,
    });
    const updated = await this.hierarchyRepository.replaceVersioned(chart.id, input.expectedVersion, {
      nodes: nextNodes,
      updatedBy: actor.actorId,
    });
    await this.recordHistory(updated, "NODE_ADDED", actor, before, updated.nodes);
    await this.audit("HIERARCHY.NODE_ADDED", updated, actor, {
      userId: String(input.userId),
      relation: input.relation,
      anchorNodeId: input.anchorNodeId ?? null,
    });
    return this.toDto(updated);
  }

  async removeNode(id, nodeId, { expectedVersion, promoteChildren = false } = {}, actor = {}) {
    const chart = await this.requireChart(id);
    this.assertEditable(chart);
    const before = chart.nodes;
    const nextNodes = removeNode(before, nodeId, { promoteChildren });
    const updated = await this.hierarchyRepository.replaceVersioned(chart.id, expectedVersion, {
      nodes: nextNodes,
      updatedBy: actor.actorId,
    });
    await this.recordHistory(updated, "NODE_REMOVED", actor, before, updated.nodes);
    await this.audit("HIERARCHY.NODE_REMOVED", updated, actor, { nodeId, promoteChildren });
    return this.toDto(updated);
  }

  async activate(id, expectedVersion, actor = {}) {
    const chart = await this.requireChart(id);
    if (!chart.nodes?.length) throw new ValidationError("Tambahkan minimal satu user sebelum mengaktifkan bagan.", { field: "nodes" });
    validateNodes(chart.nodes);
    const updated = await this.hierarchyRepository.replaceVersioned(chart.id, expectedVersion, {
      nodes: chart.nodes,
      status: "ACTIVE",
      updatedBy: actor.actorId,
      activatedAt: new Date(),
      activatedBy: actor.actorId,
    });
    await this.recordHistory(updated, "ACTIVATED", actor, chart.nodes, updated.nodes);
    await this.audit("HIERARCHY.ACTIVATED", updated, actor, {});
    return this.toDto(updated);
  }

  async archive(id, expectedVersion, actor = {}) {
    const chart = await this.requireChart(id);
    const updated = await this.hierarchyRepository.replaceVersioned(chart.id, expectedVersion, {
      nodes: chart.nodes,
      status: "ARCHIVED",
      updatedBy: actor.actorId,
    });
    await this.recordHistory(updated, "ARCHIVED", actor, chart.nodes, updated.nodes);
    await this.audit("HIERARCHY.ARCHIVED", updated, actor, {});
    return this.toDto(updated);
  }

  async history(id) {
    await this.requireChart(id);
    const events = await this.hierarchyHistoryRepository.findByHierarchyId(id);
    return events.map((event) => ({
      id: String(event._id ?? event.id),
      hierarchyId: String(event.hierarchyId),
      event: event.event,
      actorId: event.actorId ? String(event.actorId) : null,
      actorNameSnapshot: event.actorNameSnapshot ?? null,
      actorRoleNameSnapshots: event.actorRoleNameSnapshots ?? [],
      before: event.before ?? null,
      after: event.after ?? null,
      version: event.version ?? null,
      recordedAt: event.recordedAt ?? null,
    }));
  }

  /** Returns the active chart and node for a user, or null when unconfigured. */
  async locateUser(userId) {
    const user = await this.userRepository.findById(userId);
    if (!user?.contractTypeId || !user?.placementId) return null;
    const chart = await this.hierarchyRepository.findActiveByScope(user.contractTypeId, user.placementId);
    if (!chart) return null;
    const node = (chart.nodes ?? []).find((item) => String(item.userId) === String(userId));
    return node ? { chart, node, user } : null;
  }

  async getAncestorUsers(userId) {
    const located = await this.locateUser(userId);
    if (!located) {
      const requester = await this.userRepository.findById(userId);
      return {
        chart: null,
        requesterNode: null,
        ancestors: [],
        requesterScoped: Boolean(requester?.contractTypeId && requester?.placementId),
      };
    }
    const ancestorNodes = ancestorsOf(located.chart.nodes, located.node.nodeId);
    const users = await this.userRepository.findByIdsActive(ancestorNodes.map((node) => node.userId));
    const byId = new Map(users.map((user) => [String(user.id ?? user._id), user]));
    const enriched = await this.enrichUsers(ancestorNodes.map((node) => byId.get(String(node.userId))).filter(Boolean));
    const enrichedById = new Map(enriched.map((user) => [String(user.userId), user]));
    return {
      chart: this.toDto(located.chart),
      requesterNode: this.nodeDto(located.node),
      requesterScoped: true,
      ancestors: ancestorNodes
        .map((node, index) => ({
          ...enrichedById.get(String(node.userId)),
          nodeId: String(node.nodeId),
          distance: index + 1,
        }))
        .filter((item) => item.userId),
    };
  }

  async getDescendantUserIds(userId, { includeSelf = true, recursive = true } = {}) {
    const located = await this.locateUser(userId);
    if (!located) return includeSelf ? [String(userId)] : [];
    const descendants = recursive
      ? descendantsOf(located.chart.nodes, located.node.nodeId)
      : located.chart.nodes.filter((node) => String(node.parentNodeId) === String(located.node.nodeId));
    const ids = descendants.map((node) => String(node.userId));
    return includeSelf ? [String(userId), ...ids] : ids;
  }

  async assertActiveScope(contractTypeId, placementId) {
    const [contract, placement, relations] = await Promise.all([
      this.contractTypeRepository.findById(contractTypeId),
      this.placementRepository.findById(placementId),
      this.contractPlacementRepository.listActiveForContract(contractTypeId),
    ]);
    if (!contract || contract.status !== "ACTIVE") throw new ValidationError("Kontrak tidak aktif atau tidak ditemukan.", { field: "contractTypeId" });
    if (!placement || placement.status !== "ACTIVE") throw new ValidationError("Penempatan tidak aktif atau tidak ditemukan.", { field: "placementId" });
    if (relations.length && !relations.some((relation) => String(relation.placementId) === String(placementId))) {
      throw new ValidationError("Penempatan tidak terdaftar pada kontrak yang dipilih.", { field: "placementId" });
    }
  }

  assertUserMatchesScope(user, chart) {
    if (!user || user.status !== "ACTIVE") throw new ValidationError("User yang dipilih tidak aktif atau tidak ditemukan.", { field: "userId" });
    if (String(user.contractTypeId) !== String(chart.contractTypeId) || String(user.placementId) !== String(chart.placementId)) {
      throw new ValidationError("User harus memiliki kontrak dan penempatan yang sama dengan bagan.", { field: "userId" });
    }
  }

  assertEditable(chart) {
    if (chart.status === "ARCHIVED") throw new ConflictError("Bagan yang sudah diarsipkan tidak dapat diubah.", "HIERARCHY_ARCHIVED");
  }

  async requireChart(id) {
    const chart = await this.hierarchyRepository.findById(id);
    if (!chart) throw new NotFoundError("Hierarchy chart not found.", "HIERARCHY_NOT_FOUND");
    return chart;
  }

  async enrichUsers(users) {
    const roleIds = [...new Set(users.flatMap((user) => (user.roleIds ?? []).map(String)))];
    const roles = roleIds.length ? await this.roleRepository.findByIds(roleIds) : [];
    const roleById = new Map(roles.map((role) => [String(role.id ?? role._id), role]));
    return users.map((user) => ({
      userId: String(user.id ?? user._id),
      userName: user.name ?? user.username,
      username: user.username,
      nip: user.nip ?? "",
      departmentId: user.departmentId ? String(user.departmentId) : null,
      positionId: user.positionId ? String(user.positionId) : null,
      roleNames: (user.roleIds ?? []).map((id) => roleById.get(String(id))?.name).filter(Boolean),
      status: user.status,
    }));
  }

  nodeDto(node) {
    return {
      nodeId: String(node.nodeId),
      userId: String(node.userId),
      parentNodeId: node.parentNodeId ? String(node.parentNodeId) : null,
      sortOrder: node.sortOrder ?? 0,
    };
  }

  toDto(chart) {
    return {
      id: String(chart.id ?? chart._id),
      contractTypeId: String(chart.contractTypeId),
      placementId: String(chart.placementId),
      status: chart.status,
      nodes: (chart.nodes ?? []).map((node) => this.nodeDto(node)),
      version: chart.version ?? 1,
      createdBy: chart.createdBy ? String(chart.createdBy) : null,
      updatedBy: chart.updatedBy ? String(chart.updatedBy) : null,
      activatedAt: chart.activatedAt ?? null,
      activatedBy: chart.activatedBy ? String(chart.activatedBy) : null,
      createdAt: chart.createdAt ?? null,
      updatedAt: chart.updatedAt ?? null,
    };
  }

  masterDto(item) {
    return { id: String(item.id ?? item._id), key: item.key, name: item.name, status: item.status };
  }

  async recordHistory(chart, event, actor, before, after) {
    const user = actor.actorId ? await this.userRepository.findById(actor.actorId) : null;
    let roleNames = [];
    if (user?.roleIds?.length) {
      const roles = await this.roleRepository.findByIds(user.roleIds);
      roleNames = roles.map((role) => role.name);
    }
    await this.hierarchyHistoryRepository.append({
      hierarchyId: chart.id,
      event,
      actorId: actor.actorId ?? null,
      actorNameSnapshot: user?.name ?? user?.username ?? null,
      actorRoleNameSnapshots: roleNames,
      before: before ? before.map((node) => this.nodeDto(node)) : null,
      after: after ? after.map((node) => this.nodeDto(node)) : null,
      version: chart.version,
    });
  }

  async audit(action, chart, actor, metadata) {
    await this.auditService.record({
      action,
      actor: { userId: actor.actorId ?? null, roleKeys: actor.actorRoleKeys ?? [] },
      subject: { type: "HIERARCHY", id: String(chart.id ?? chart._id), summary: "hierarchy chart" },
      outcome: "SUCCESS",
      metadata,
      correlationId: actor.correlationId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  }
}

module.exports = { HierarchyService };
