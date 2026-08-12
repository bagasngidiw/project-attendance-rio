/**
 * Composition root (design §2): wire configuration, repositories, services,
 * middleware and routes into a single Express application.
 *
 * No business logic lives here — this file only assembles dependencies.
 */

const express = require("express");
const cors = require("cors");
require("dotenv").config();

const connectDB = require("./database");
const { createConfig } = require("./src/infrastructure/config");
const { EventBus } = require("./src/infrastructure/event-bus");
const { BcryptPasswordHasher } = require("./src/infrastructure/password-hasher");
const { JwtTokenProvider } = require("./src/infrastructure/token-provider");

const { UserRepository } = require("./src/infrastructure/repositories/user.repository");
const { RoleRepository } = require("./src/infrastructure/repositories/role.repository");
const { PermissionRepository } = require("./src/infrastructure/repositories/permission.repository");
const { UserRoleRepository } = require("./src/infrastructure/repositories/user-role.repository");
const { RolePermissionRepository } = require("./src/infrastructure/repositories/role-permission.repository");
const { SessionRepository } = require("./src/infrastructure/repositories/session.repository");
const { RefreshTokenRepository } = require("./src/infrastructure/repositories/refresh-token.repository");
const { AuditEventRepository } = require("./src/infrastructure/repositories/audit-event.repository");
const { ActivityLogRepository } = require("./src/infrastructure/repositories/activity.repository");
const { OutboxRepository } = require("./src/infrastructure/repositories/outbox.repository");
const { PlatformSettingRepository } = require("./src/infrastructure/repositories/platform-setting.repository");
const { RequestRepository } = require("./src/infrastructure/repositories/request.repository");
const { RequestEventRepository } = require("./src/infrastructure/repositories/request-event.repository");
const { RoutingRuleRepository } = require("./src/infrastructure/repositories/routing-rule.repository");
const { AttendanceRepository } = require("./src/infrastructure/repositories/attendance.repository");
const { AttachmentRepository } = require("./src/infrastructure/repositories/attachment.repository");
const { AttendanceCorrectionModel } = require("./src/infrastructure/models/attendance-correction.model");
const {
  ReportProviderRegistry,
  registerReportProviders,
} = require("./src/infrastructure/report-providers");
const { OrgRepository } = require("./src/infrastructure/repositories/org.repository");
const { ReportingRepository } = require("./src/infrastructure/repositories/reporting.repository");
const { NotificationRepository } = require("./src/infrastructure/repositories/notification.repository");
const { LeaveTypeRepository } = require("./src/infrastructure/repositories/leave-type.repository");
const { LeaveBalanceRepository } = require("./src/infrastructure/repositories/leave-balance.repository");
const { DelegationRepository } = require("./src/infrastructure/repositories/delegation.repository");
const { EscalationRepository } = require("./src/infrastructure/repositories/escalation.repository");
const { CutoffRuleRepository } = require("./src/infrastructure/repositories/cutoff-rule.repository");
const { ApprovalConfigurationRepository } = require("./src/infrastructure/repositories/approval-configuration.repository");
const { SicknessTypeRepository } = require("./src/infrastructure/repositories/sickness-type.repository");
const { ContractTypeRepository } = require("./src/infrastructure/repositories/contract-type.repository");
const { PlacementRepository } = require("./src/infrastructure/repositories/placement.repository");
const { LeaveQuotaService } = require("./src/application/leave-quota.service");
const { LeaveBalanceService } = require("./src/application/leave-balance.service");
const { AttendanceLeaveSyncService } = require("./src/application/attendance-leave-sync.service");
const { AttachmentService } = require("./src/application/attachment.service");
const { LocalDiskStorage } = require("./src/infrastructure/storage/local-disk.storage");

const { AuditService } = require("./src/application/audit.service");
const { SessionService } = require("./src/application/session.service");
const { RbacService } = require("./src/application/rbac.service");
const { RoleAdminService } = require("./src/application/role-admin.service");
const { AuthService } = require("./src/application/auth.service");
const { ManagerTeamService } = require("./src/application/manager-team.service");
const { PendingSummaryService } = require("./src/application/pending-summary.service");
const { PasswordService } = require("./src/application/password.service");
const { UserAdminService } = require("./src/application/user-admin.service");
const { RequestService } = require("./src/application/request.service");
const { LeaveService } = require("./src/application/leave.service");
const { OvertimeService } = require("./src/application/overtime.service");
const { TripService } = require("./src/application/trip.service");
const { RoutingService } = require("./src/application/routing.service");
const { ApprovalService } = require("./src/application/approval.service");
const { AttendanceService } = require("./src/application/attendance.service");
const { ReportService } = require("./src/application/report.service");
const { DashboardService } = require("./src/application/dashboard.service");
const { ProfileService } = require("./src/application/profile.service");
const { OrgService } = require("./src/application/org.service");
const { ReportingLineService } = require("./src/application/reporting-line.service");
const { NotificationService } = require("./src/application/notification.service");
const { SettingsService } = require("./src/application/settings.service");
const { LeaveTypeService } = require("./src/application/leave-type.service");
const { DelegationService } = require("./src/application/delegation.service");
const { EscalationService } = require("./src/application/escalation.service");
const { CutoffRuleService } = require("./src/application/cutoff-rule.service");
const { ApprovalConfigurationService } = require("./src/application/approval-configuration.service");
const { ApprovalTargetService } = require("./src/application/approval-target.service");
const { ApprovalEngineService } = require("./src/application/approval-engine.service");
const { PermissionService } = require("./src/application/permission.service");
const { SakitService } = require("./src/application/sakit.service");
const { SicknessTypeService } = require("./src/application/sickness-type.service");
const { ContractTypeService } = require("./src/application/contract-type.service");
const { PlacementService } = require("./src/application/placement.service");
const { BrandingService } = require("./src/application/branding.service");

const { createAuthenticate, createAuthorize } = require("./src/infrastructure/middleware/auth.middleware");
const { createRateLimiter } = require("./src/infrastructure/middleware/rate-limiter");
const { createSecurityHeaders } = require("./src/infrastructure/middleware/security-headers.middleware");
const {
  createErrorHandler,
  createNotFoundHandler,
} = require("./src/infrastructure/middleware/error-handler.middleware");

const { AuthController } = require("./src/presentation/controllers/auth.controller");
const { RbacController } = require("./src/presentation/controllers/rbac.controller");
const { RbacAdminController } = require("./src/presentation/controllers/rbac-admin.controller");
const { UserController } = require("./src/presentation/controllers/user.controller");
const { NavigationController } = require("./src/presentation/controllers/navigation.controller");
const { AuditController } = require("./src/presentation/controllers/audit.controller");
const { ManagerTeamController } = require("./src/presentation/controllers/manager-team.controller");
const { PlatformController } = require("./src/presentation/controllers/platform.controller");
const { RequestController } = require("./src/presentation/controllers/request.controller");
const { LeaveController } = require("./src/presentation/controllers/leave.controller");
const { OvertimeController } = require("./src/presentation/controllers/overtime.controller");
const { TripController } = require("./src/presentation/controllers/trip.controller");
const { ApprovalController } = require("./src/presentation/controllers/approval.controller");
const { RoutingAdminController } = require("./src/presentation/controllers/routing-admin.controller");
const { AttendanceController } = require("./src/presentation/controllers/attendance.controller");
const { ReportController } = require("./src/presentation/controllers/report.controller");
const { DashboardController } = require("./src/presentation/controllers/dashboard.controller");
const { ProfileController } = require("./src/presentation/controllers/profile.controller");
const { OrgController } = require("./src/presentation/controllers/org.controller");
const { ReportingController } = require("./src/presentation/controllers/reporting.controller");
const { NotificationController } = require("./src/presentation/controllers/notification.controller");
const { SettingsController } = require("./src/presentation/controllers/settings.controller");
const { LeaveTypeController } = require("./src/presentation/controllers/leave-type.controller");
const { DelegationController } = require("./src/presentation/controllers/delegation.controller");
const { EscalationController } = require("./src/presentation/controllers/escalation.controller");
const { ApprovalConfigurationController } = require("./src/presentation/controllers/approval-configuration.controller");
const { ApprovalTargetController } = require("./src/presentation/controllers/approval-target.controller");
const { PermissionController } = require("./src/presentation/controllers/permission.controller");
const { BrandingController } = require("./src/presentation/controllers/branding.controller");
const { SakitController } = require("./src/presentation/controllers/sakit.controller");
const { SicknessTypeController } = require("./src/presentation/controllers/sickness-type.controller");
const { ContractTypeController } = require("./src/presentation/controllers/contract-type.controller");
const { PlacementController } = require("./src/presentation/controllers/placement.controller");
const { AttachmentController } = require("./src/presentation/controllers/attachment.controller");
const { createAuthRoutes } = require("./src/presentation/routes/auth.routes");
const { createRbacRoutes } = require("./src/presentation/routes/rbac.routes");
const { createRbacAdminRoutes } = require("./src/presentation/routes/rbac-admin.routes");
const { createUserRoutes } = require("./src/presentation/routes/user.routes");
const { createNavigationRoutes } = require("./src/presentation/routes/navigation.routes");
const { createAuditRoutes } = require("./src/presentation/routes/audit.routes");
const { createManagerTeamRoutes } = require("./src/presentation/routes/manager-team.routes");
const { createPlatformRoutes } = require("./src/presentation/routes/platform.routes");
const { createRequestRoutes } = require("./src/presentation/routes/request.routes");
const { createLeaveRoutes } = require("./src/presentation/routes/leave.routes");
const { createOvertimeRoutes } = require("./src/presentation/routes/overtime.routes");
const { createTripRoutes } = require("./src/presentation/routes/trip.routes");
const { createApprovalRoutes, createCutoffAdminRoutes } = require("./src/presentation/routes/approval.routes");
const { createRoutingAdminRoutes } = require("./src/presentation/routes/routing-admin.routes");
const { createAttendanceRoutes } = require("./src/presentation/routes/attendance.routes");
const { createReportRoutes } = require("./src/presentation/routes/report.routes");
const { createDashboardRoutes } = require("./src/presentation/routes/dashboard.routes");
const { createProfileRoutes } = require("./src/presentation/routes/profile.routes");
const { createOrgRoutes } = require("./src/presentation/routes/org.routes");
const { createReportingRoutes } = require("./src/presentation/routes/reporting.routes");
const { createNotificationRoutes } = require("./src/presentation/routes/notification.routes");
const { createLeaveTypeAdminRoutes } = require("./src/presentation/routes/leave-type-admin.routes");
const { createDelegationRoutes } = require("./src/presentation/routes/delegation.routes");
const { createEscalationRoutes } = require("./src/presentation/routes/escalation.routes");
const { createApprovalConfigurationRoutes } = require("./src/presentation/routes/approval-configuration.routes");
const { createApprovalTargetRoutes } = require("./src/presentation/routes/approval-target.routes");
const { createPermissionRoutes } = require("./src/presentation/routes/permission.routes");
const { createSakitRoutes, createSicknessTypeRoutes, createSicknessTypeAdminRoutes } = require("./src/presentation/routes/sakit.routes");
const { createContractTypeRoutes, createContractTypeAdminRoutes } = require("./src/presentation/routes/contract-type.routes");
const { createPlacementRoutes, createPlacementAdminRoutes } = require("./src/presentation/routes/placement.routes");
const {
  createBrandingRoutes,
  createBrandingAssetRoutes,
  createPublicBrandingRoutes,
} = require("./src/presentation/routes/branding.routes");
const { createAttachmentRoutes } = require("./src/presentation/routes/attachment.routes");

const { AuditEventPublisher } = require("./src/infrastructure/audit-publisher");
const { HashChainVerifier } = require("./src/infrastructure/hash-chain-verifier");
const { TokenInvalidationService } = require("./src/infrastructure/token-invalidation.service");
const { createCorrelationMiddleware } = require("./src/infrastructure/middleware/correlation.middleware");

const { seedDatabase } = require("./src/infrastructure/seed/seed");

function buildApp(config) {
  const eventBus = new EventBus();

  // Infrastructure
  const passwordHasher = new BcryptPasswordHasher(config.security.bcryptRounds);
  const tokenProvider = new JwtTokenProvider({
    secret: config.security.jwtSecret,
    issuer: config.security.jwtIssuer,
    audience: config.security.jwtAudience,
    ttlSeconds: config.security.accessTokenTtlSeconds,
  });

  const userRepository = new UserRepository();
  const roleRepository = new RoleRepository();
  const permissionRepository = new PermissionRepository();
  const userRoleRepository = new UserRoleRepository();
  const rolePermissionRepository = new RolePermissionRepository();
  const sessionRepository = new SessionRepository();
  const refreshTokenRepository = new RefreshTokenRepository();
  const auditRepository = new AuditEventRepository();
  const activityRepository = new ActivityLogRepository();
  const outboxRepository = new OutboxRepository();
  const platformSettingRepository = new PlatformSettingRepository();
  const requestRepository = new RequestRepository();
  const requestEventRepository = new RequestEventRepository();
  const routingRuleRepository = new RoutingRuleRepository();
  const attendanceRepository = new AttendanceRepository();
  const attachmentRepository = new AttachmentRepository();
  const reportProviderRegistry = new ReportProviderRegistry();
  const orgRepository = new OrgRepository();
  const reportingRepository = new ReportingRepository();
  const notificationRepository = new NotificationRepository();
  const leaveTypeRepository = new LeaveTypeRepository();
  const delegationRepository = new DelegationRepository();
  const escalationRepository = new EscalationRepository();
  const cutoffRuleRepository = new CutoffRuleRepository();
  const approvalConfigurationRepository = new ApprovalConfigurationRepository();
  const sicknessTypeRepository = new SicknessTypeRepository();
  const contractTypeRepository = new ContractTypeRepository();
  const placementRepository = new PlacementRepository();
  const logoStorage = new LocalDiskStorage({
    storageDir: process.env.BRANDING_ASSETS_DIR || require("path").join(process.cwd(), "branding-assets"),
  });

  // Capture pipeline
  const auditPublisher = new AuditEventPublisher({
    outboxRepository,
    auditRepository,
    activityRepository,
    chainSalt: config.audit.chainSalt,
  });
  const chainVerifier = new HashChainVerifier({
    auditRepository,
    salt: config.audit.chainSalt,
  });

  // Application
  const auditService = new AuditService({
    publisher: auditPublisher,
    auditRepository,
    activityRepository,
    chainVerifier,
  });
  const sessionService = new SessionService({
    sessionRepository,
    refreshTokenRepository,
    config: config.security,
  });
  const rbacService = new RbacService({
    userRepository,
    roleRepository,
    userRoleRepository,
    permissionRepository,
    auditService,
  });
  const tokenInvalidation = new TokenInvalidationService({
    userRepository,
    userRoleRepository,
  });
  const roleAdminService = new RoleAdminService({
    roleRepository,
    permissionRepository,
    rolePermissionRepository,
    userRoleRepository,
    userRepository,
    tokenInvalidation,
    auditService,
  });
  const passwordService = new PasswordService({
    userRepository,
    passwordHasher,
    platformSettingRepository,
    auditService,
    config,
  });
  const authService = new AuthService({
    userRepository,
    passwordHasher,
    tokenProvider,
    sessionService,
    rbacService,
    auditService,
    roleRepository,
    userRoleRepository,
    passwordService,
    config: config.security,
  });
  const pendingSummaryService = new PendingSummaryService();
  const leaveTypeService = new LeaveTypeService({
    leaveTypeRepository,
    auditService,
  });
  const sicknessTypeService = new SicknessTypeService({
    sicknessTypeRepository,
    auditService,
  });
  const contractTypeService = new ContractTypeService({
    contractTypeRepository,
    auditService,
  });
  const placementService = new PlacementService({
    placementRepository,
    auditService,
  });
  const routingService = new RoutingService({
    routingRuleRepository,
    userRepository,
    roleRepository,
    userRoleRepository,
    auditService,
  });
  const requestService = new RequestService({
    requestRepository,
    requestEventRepository,
    userRepository,
    roleRepository,
    userRoleRepository,
    auditService,
    eventBus,
    routingService,
    leaveTypeService,
    sicknessTypeService,
  });
  const approvalService = new ApprovalService({
    requestService,
    requestRepository,
    requestEventRepository,
    auditService,
    eventBus,
    config,
    delegationService: null, // wired below after DelegationService construction
    cutoffRuleRepository,
    escalationService: null, // wired below after EscalationService construction
    userRepository,
  });
  const delegationService = new DelegationService({
    delegationRepository,
    userRepository,
    auditService,
  });
  const escalationService = new EscalationService({
    platformSettingRepository,
    requestRepository,
    requestEventRepository,
    escalationRepository,
    auditService,
    eventBus,
  });
  const cutoffRuleService = new CutoffRuleService({ cutoffRuleRepository, auditService });
  // FR-009/FR-063: attach the delegation + escalation hooks after construction.
  approvalService.delegationService = delegationService;
  approvalService.escalationService = escalationService;
  // FR-001/FR-002/FR-003: approval configuration + reusable engine + targets.
  const approvalConfigurationService = new ApprovalConfigurationService({
    approvalConfigurationRepository,
    roleRepository,
    userRoleRepository,
    userRepository,
    auditService,
  });
  const approvalTargetService = new ApprovalTargetService({ approvalConfigurationService });
  const approvalEngine = new ApprovalEngineService({
    approvalConfigurationService,
    requestService,
    requestRepository,
    requestEventRepository,
    userRepository,
    roleRepository,
    userRoleRepository,
    auditService,
    eventBus,
  });
  const leaveBalanceRepository = new LeaveBalanceRepository();
  // Authoritative leave-balance engine: reserve on submit, consume on approve,
  // release/restore on reject/cancel, plus quota (entitlement) management.
  const leaveBalanceService = new LeaveBalanceService({
    leaveBalanceRepository,
    leaveTypeRepository,
    requestRepository,
    auditService,
  });
  // Authoritative leave-balance engine must react to the request lifecycle:
  // reserve on submit, consume on approve, release on reject/cancel. (This
  // wiring was missing in production — unit tests subscribed explicitly.)
  leaveBalanceService.subscribeToEvents(eventBus);
  const leaveService = new LeaveService({ requestService, pendingSummaryService, leaveTypeService, approvalEngine, leaveBalanceService });
  const overtimeService = new OvertimeService({ requestService, pendingSummaryService, approvalEngine });
  const tripService = new TripService({ requestService, pendingSummaryService, approvalEngine });
  const permissionService = new PermissionService({
    requestService,
    pendingSummaryService,
    approvalEngine,
  });
  // TODO.md: Sickness (Sakit) module + its own master data.
  const sakitService = new SakitService({
    requestService,
    pendingSummaryService,
    approvalEngine,
    sicknessTypeService,
  });
  // FR-001/FR-002/FR-003: platform branding (identity + logo + colors).
  const brandingService = new BrandingService({
    platformSettingRepository,
    auditService,
    logoStorage,
  });
  const attendanceService = new AttendanceService({
    attendanceRepository,
    userRepository,
    requestRepository,
    correctionModel: AttendanceCorrectionModel,
    pendingSummaryService,
    auditService,
    config,
  });
  // FR-001: approved leave -> attendance LEAVE records (additive subscriber).
  const attendanceLeaveSyncService = new AttendanceLeaveSyncService({
    attendanceRepository,
    requestRepository,
  });
  attendanceLeaveSyncService.subscribeToEvents(eventBus);
  // FR-008/FR-010: request attachments (local disk, request-scoped access).
  const attachmentStorage = new LocalDiskStorage({
    storageDir: config.attachmentAssetsDir,
  });
  const attachmentService = new AttachmentService({
    attachmentRepository,
    requestRepository,
    userRepository,
    storage: attachmentStorage,
    platformSettingRepository,
    auditService,
    approvalConfigurationService,
  });
  const attachmentController = new AttachmentController({ attachmentService });
  const managerTeamService = new ManagerTeamService({
    userRepository,
    userRoleRepository,
    roleRepository,
    pendingSummaryService,
    auditService,
  });
  const userAdminService = new UserAdminService({
    userRepository,
    roleRepository,
    userRoleRepository,
    passwordHasher,
    passwordService,
    auditService,
    orgRepository,
    contractTypeService,
    placementService,
    eventBus,
    leaveTypeRepository,
    leaveBalanceService,
  });
  const leaveQuotaService = new LeaveQuotaService({
    userRepository,
    leaveTypeRepository,
    eventBus,
  });
  const reportService = new ReportService({
    registry: reportProviderRegistry,
    userRepository,
    auditService,
  });

  // Register the built-in report data providers (FR-027 extensibility).
  registerReportProviders({
    registry: reportProviderRegistry,
    attendanceRepository,
    requestRepository,
    userRepository,
    leaveTypeRepository,
    sicknessTypeRepository,
  });

  const dashboardService = new DashboardService({
    attendanceService,
    requestService,
    pendingSummaryService,
    attendanceRepository,
    requestRepository,
    userRepository,
  });
  const profileService = new ProfileService({
    userRepository,
    roleRepository,
    userRoleRepository,
    auditService,
  });
  const orgService = new OrgService({ orgRepository, auditService });
  const reportingLineService = new ReportingLineService({
    userRepository,
    reportingRepository,
    auditService,
  });
  const notificationService = new NotificationService({
    notificationRepository,
    userRepository,
    requestRepository,
  });
  notificationService.subscribeToEvents(eventBus);
  const settingsService = new SettingsService({
    platformSettingRepository,
    auditService,
  });

  // Middleware
  const authenticate = createAuthenticate({
    tokenProvider,
    userRepository,
    sessionService,
    config,
  });
  const authorize = createAuthorize({ auditService });
  // Global sliding-window limiter. A dedicated login limiter is intentionally
  // NOT applied: repeated credential checks during development kept surfacing
  // "Too many requests" on the sign-in form.
  const rateLimit = createRateLimiter(config.rateLimit);
  const securityHeaders = createSecurityHeaders();
  const correlation = createCorrelationMiddleware();

  // Controllers
  const authController = new AuthController({ authService });
  const rbacController = new RbacController({ rbacService });
  const rbacAdminController = new RbacAdminController({ roleAdminService });
  const userController = new UserController({
    userRepository,
    rbacService,
    userAdminService,
    passwordService,
  });
  const navigationController = new NavigationController({ rbacService });
  const auditController = new AuditController({ auditService });
  const managerTeamController = new ManagerTeamController({ managerTeamService });
  const platformController = new PlatformController({ passwordService });
  const requestController = new RequestController({ requestService, approvalService, approvalEngine });
  const leaveController = new LeaveController({ leaveService, leaveBalanceService });
  const overtimeController = new OvertimeController({ overtimeService });
  const tripController = new TripController({ tripService });
  const permissionController = new PermissionController({ permissionService });
  const sakitController = new SakitController({ sakitService });
  const sicknessTypeController = new SicknessTypeController({ sicknessTypeService });
  const contractTypeController = new ContractTypeController({ contractTypeService });
  const placementController = new PlacementController({ placementService });
  const approvalConfigurationController = new ApprovalConfigurationController({ approvalConfigurationService });
  const approvalTargetController = new ApprovalTargetController({ approvalTargetService });
  const brandingController = new BrandingController({ brandingService });
  const approvalController = new ApprovalController({ approvalService });
  const routingAdminController = new RoutingAdminController({ routingService });
  const attendanceMediaStorage = new LocalDiskStorage({
    storageDir:
      process.env.ATTENDANCE_MEDIA_DIR || require("path").join(process.cwd(), "attendance-media"),
  });
  const attendanceController = new AttendanceController({ attendanceService, mediaStorage: attendanceMediaStorage, auditService });
  const reportController = new ReportController({ reportService });
  const dashboardController = new DashboardController({ dashboardService });
  const profileController = new ProfileController({ profileService });
  const orgController = new OrgController({ orgService });
  const reportingController = new ReportingController({ reportingLineService });
  const notificationController = new NotificationController({ notificationService });
  const settingsController = new SettingsController({ settingsService });
  const leaveTypeController = new LeaveTypeController({ leaveTypeService });
  const delegationController = new DelegationController({ delegationService });
  const escalationController = new EscalationController({ escalationService });

  // App assembly
  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(
    cors({
      origin: config.security.corsOrigins,
      credentials: true,
    })
  );
  app.use(express.json({ limit: "1mb" }));
  // app.use(rateLimit);
  app.use(correlation);

  app.get("/health", (req, res) => res.json({ data: { status: "ok" } }));

  app.use("/api/v1/auth", createAuthRoutes({
    authController,
    authenticate,
    changePassword: userController.changePassword,
  }));
  app.use("/api/v1/rbac", createRbacRoutes({ rbacController, authenticate, authorize }));
  app.use("/api/v1/rbac/admin", createRbacAdminRoutes({ rbacAdminController, authenticate, authorize }));
  app.use("/api/v1/users", createUserRoutes({ userController, authenticate, authorize }));
  // Branding routes MUST be mounted before the generic platform router so the
  // `/settings/:key` route never shadows `/settings/branding` and the asset
  // fetch stays public (no authenticate).
  app.use("/api/v1/platform/settings/branding", createBrandingRoutes({
    brandingController,
    authenticate,
    authorize,
  }));
  app.use("/api/v1/platform/branding-assets", createBrandingAssetRoutes({ brandingController }));
  app.use("/api/v1/platform/branding", createPublicBrandingRoutes({ brandingController }));
  app.use("/api/v1/platform", createPlatformRoutes({
    platformController,
    settingsController,
    authenticate,
    authorize,
  }));
  app.use("/api/v1", createNavigationRoutes({ navigationController, authenticate }));
  app.use("/api/v1", createAuditRoutes({ auditController, authenticate, authorize }));
  app.use("/api/v1/manager", createManagerTeamRoutes({ managerTeamController, authenticate, authorize }));
  app.use("/api/v1/requests", createRequestRoutes({ requestController, authenticate, authorize }));
  // FR-008: request attachment surface (upload/list/download/delete). Mounted at
  // the /api/v1 root because the routes carry the full /requests/:requestId and
  // /attachments/:id prefixes. More specific than the requests router paths, so
  // /requests/:requestId/attachments never collides with /requests/:id.
  app.use("/api/v1", createAttachmentRoutes({ attachmentController, authenticate, authorize }));
  app.use("/api/v1/leave", createLeaveRoutes({ leaveController, leaveTypeController, authenticate, authorize }));
  app.use("/api/v1/admin/leave-types", createLeaveTypeAdminRoutes({ leaveTypeController, authenticate, authorize }));
  app.use("/api/v1/overtime", createOvertimeRoutes({ overtimeController, authenticate, authorize }));
  app.use("/api/v1/trip", createTripRoutes({ tripController, authenticate, authorize }));
  app.use("/api/v1/approvals", createEscalationRoutes({ escalationController, authenticate, authorize }));
  app.use("/api/v1/approvals", createApprovalRoutes({ approvalController, authenticate, authorize }));
  app.use("/api/v1/admin", createCutoffAdminRoutes({ cutoffRuleService, authenticate, authorize }));
  app.use("/api/v1/delegations", createDelegationRoutes({ delegationController, authenticate, authorize }));
  app.use("/api/v1/approval-configurations", createApprovalConfigurationRoutes({
    approvalConfigurationController,
    authenticate,
    authorize,
  }));
  app.use("/api/v1/approval-targets", createApprovalTargetRoutes({
    approvalTargetController,
    authenticate,
    authorize,
  }));
  app.use("/api/v1/permission", createPermissionRoutes({ permissionController, authenticate, authorize }));
  app.use("/api/v1/sakit", createSakitRoutes({ sakitController, authenticate, authorize }));
  app.use("/api/v1/sickness-types", createSicknessTypeRoutes({ sicknessTypeController, authenticate, authorize }));
  app.use("/api/v1/admin/sickness-types", createSicknessTypeAdminRoutes({ sicknessTypeController, authenticate, authorize }));
  app.use("/api/v1/contract-types", createContractTypeRoutes({ contractTypeController, authenticate, authorize }));
  app.use("/api/v1/admin/contract-types", createContractTypeAdminRoutes({ contractTypeController, authenticate, authorize }));
  app.use("/api/v1/placements", createPlacementRoutes({ placementController, authenticate, authorize }));
  app.use("/api/v1/admin/placements", createPlacementAdminRoutes({ placementController, authenticate, authorize }));
  app.use("/api/v1/admin", createRoutingAdminRoutes({ routingAdminController, authenticate, authorize }));
  app.use("/api/v1/attendance", createAttendanceRoutes({ attendanceController, authenticate, authorize }));
  app.use("/api/v1/reports", createReportRoutes({ reportController, authenticate, authorize }));
  app.use("/api/v1/dashboard", createDashboardRoutes({ dashboardController, authenticate, authorize }));
  app.use("/api/v1/profile", createProfileRoutes({ profileController, authenticate, authorize }));
  app.use("/api/v1/org", createOrgRoutes({ orgController, authenticate, authorize }));
  app.use("/api/v1/reporting", createReportingRoutes({ reportingController, authenticate, authorize }));
  app.use("/api/v1/notifications", createNotificationRoutes({ notificationController, authenticate }));

  app.use(createNotFoundHandler());
  app.use(createErrorHandler());

  return {
    app,
    eventBus,
    repositories: {
      userRepository,
      roleRepository,
      permissionRepository,
      leaveTypeRepository,
      sicknessTypeRepository,
      contractTypeRepository,
      placementRepository,
      approvalConfigurationRepository,
    },
  };
}

async function start() {
  const config = createConfig();
  await connectDB(config.mongoUri);

  // Seed is idempotent and safe on every boot.
  const { app, repositories } = buildApp(config);

  await seedDatabase({
    roleRepository: repositories.roleRepository,
    permissionRepository: repositories.permissionRepository,
    userRepository: repositories.userRepository,
    leaveTypeRepository: repositories.leaveTypeRepository,
    sicknessTypeRepository: repositories.sicknessTypeRepository,
    approvalConfigurationRepository: repositories.approvalConfigurationRepository,
    passwordHasher: new BcryptPasswordHasher(config.security.bcryptRounds),
    config,
  });

  app.listen(config.port, () => {
    console.log(`[server] HRIS API listening on port ${config.port} (${config.nodeEnv}).`);
  });
}

// Only auto-start when run directly (not when imported by tests).
if (require.main === module) {
  start().catch((err) => {
    console.error("[server] Failed to start:", err);
    process.exit(1);
  });
}

module.exports = { buildApp, start };
