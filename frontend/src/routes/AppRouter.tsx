import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import MainLayout from "@/layouts/MainLayout";
import AuthLayout from "@/layouts/AuthLayout";

import Login from "@/pages/Login";
import Forbidden from "@/pages/Forbidden";
import Dashboard from "@/pages/Dashboard";
import Attendance from "@/pages/Attendance";
import Overtime from "@/pages/Overtime";
import BusinessTrip from "@/pages/BusinessTrip";
import Leave from "@/pages/Leave";
import Permission from "@/pages/Permission";
import Sakit from "@/pages/Sakit";
import MyRequests from "@/pages/MyRequests";
import Notifications from "@/pages/Notifications";
import Users from "@/pages/Users";
import Reports from "@/pages/Reports";
import Profile from "@/pages/Profile";
import ChangePasswordPage from "@/pages/ChangePassword";
import PlatformSettings from "@/pages/PlatformSettings";

import RbacConsolePage from "@/features/rbac-admin/RbacConsolePage";
import { ApprovalInboxPage } from "@/features/approvals/ApprovalInboxPage";
import { ApprovalHistoryPage } from "@/features/approvals/ApprovalHistoryPage";
import { UnifiedApprovalPage } from "@/features/approvals/UnifiedApprovalPage";
import { ApprovalConfigPage } from "@/features/approval-config/ApprovalConfigPage";
import { MasterDataPage } from "@/features/admin/MasterDataPage";

import { ROUTES } from "@/constants/routes";
import { PERMISSIONS } from "@contracts/permissions";

import {
  RequireAuth,
  RequirePasswordChange,
  RequirePermission,
} from "@/features/auth/guards";

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={<Navigate to={ROUTES.LOGIN} />}
        />

        {/* Public routes */}
        <Route element={<AuthLayout />}>
          <Route
            path={ROUTES.LOGIN}
            element={<Login />}
          />
        </Route>

        {/* Protected shell: authentication is required for everything inside */}
        <Route element={<RequireAuth />}>
          {/* First-sign-in gate: the password-change page is reachable before
              the gate clears; everything else requires a personal password. */}
          <Route path={ROUTES.CHANGE_PASSWORD} element={<ChangePasswordPage />} />

          <Route element={<RequirePasswordChange />}>
            <Route element={<MainLayout />}>
            <Route
              path={ROUTES.DASHBOARD}
              element={
                <RequirePermission permission={PERMISSIONS.DASHBOARD_VIEW}>
                  <Dashboard />
                </RequirePermission>
              }
            />

            <Route
              path={ROUTES.ATTENDANCE}
              element={
                <RequirePermission
                  permission={[
                    PERMISSIONS.ATTENDANCE_CLOCK_IN,
                    PERMISSIONS.ATTENDANCE_VIEW_OWN,
                    PERMISSIONS.ATTENDANCE_VIEW_ALL,
                  ]}
                >
                  <Attendance />
                </RequirePermission>
              }
            />

            <Route
              path={ROUTES.OVERTIME}
              element={
                <RequirePermission
                  permission={[
                    PERMISSIONS.OVERTIME_SUBMIT,
                    PERMISSIONS.OVERTIME_VIEW_OWN,
                    PERMISSIONS.OVERTIME_VIEW_ALL,
                  ]}
                >
                  <Overtime />
                </RequirePermission>
              }
            />

            <Route
              path={ROUTES.BUSINESS_TRIP}
              element={
                <RequirePermission
                  permission={[
                    PERMISSIONS.TRIP_SUBMIT,
                    PERMISSIONS.TRIP_VIEW_OWN,
                    PERMISSIONS.TRIP_VIEW_ALL,
                  ]}
                >
                  <BusinessTrip />
                </RequirePermission>
              }
            />

            <Route
              path={ROUTES.LEAVE}
              element={
                <RequirePermission
                  permission={[
                    PERMISSIONS.LEAVE_SUBMIT,
                    PERMISSIONS.LEAVE_VIEW_OWN,
                    PERMISSIONS.LEAVE_VIEW_ALL,
                  ]}
                >
                  <Leave />
                </RequirePermission>
              }
            />

            <Route
              path={ROUTES.PERMISSION}
              element={
                <RequirePermission
                  permission={[
                    PERMISSIONS.PERMISSION_SUBMIT,
                    PERMISSIONS.PERMISSION_VIEW_OWN,
                    PERMISSIONS.PERMISSION_VIEW_ALL,
                  ]}
                >
                  <Permission />
                </RequirePermission>
              }
            />

            <Route
              path={ROUTES.SAKIT}
              element={
                <RequirePermission
                  permission={[
                    PERMISSIONS.SAKIT_SUBMIT,
                    PERMISSIONS.SAKIT_VIEW_OWN,
                    PERMISSIONS.SAKIT_VIEW_ALL,
                  ]}
                >
                  <Sakit />
                </RequirePermission>
              }
            />

            <Route
              path={ROUTES.MY_REQUESTS}
              element={
                <RequirePermission
                  permission={[
                    PERMISSIONS.LEAVE_VIEW_OWN,
                    PERMISSIONS.OVERTIME_VIEW_OWN,
                    PERMISSIONS.TRIP_VIEW_OWN,
                    PERMISSIONS.SAKIT_VIEW_OWN,
                  ]}
                >
                  <MyRequests />
                </RequirePermission>
              }
            />

            <Route
              path={ROUTES.NOTIFICATIONS}
              element={
                <RequirePermission permission={PERMISSIONS.DASHBOARD_VIEW}>
                  <Notifications />
                </RequirePermission>
              }
            />

            <Route
              path={ROUTES.USERS}
              element={
                <RequirePermission permission={PERMISSIONS.USERS_VIEW}>
                  <Users />
                </RequirePermission>
              }
            />

            <Route
              path={ROUTES.REPORTS}
              element={
                <RequirePermission permission={PERMISSIONS.REPORTING_VIEW}>
                  <Reports />
                </RequirePermission>
              }
            />

            <Route
              path={ROUTES.PROFILE}
              element={
                <RequirePermission permission={PERMISSIONS.PROFILE_VIEW}>
                  <Profile />
                </RequirePermission>
              }
            />

            <Route
              path={ROUTES.ADMIN_RBAC}
              element={
                <RequirePermission permission={PERMISSIONS.RBAC_VIEW_ROLES}>
                  <RbacConsolePage />
                </RequirePermission>
              }
            />

            <Route
              path={ROUTES.ADMIN_SETTINGS}
              element={
                <RequirePermission permission={PERMISSIONS.PLATFORM_SETTINGS}>
                  <PlatformSettings />
                </RequirePermission>
              }
            />

            <Route
              path={ROUTES.ADMIN_APPROVAL_CONFIG}
              element={
                <RequirePermission permission={PERMISSIONS.APPROVAL_CONFIG_MANAGE}>
                  <ApprovalConfigPage />
                </RequirePermission>
              }
            />

            <Route
              path={ROUTES.ADMIN_MASTER}
              element={
                <RequirePermission permission={PERMISSIONS.PLATFORM_SETTINGS}>
                  <MasterDataPage />
                </RequirePermission>
              }
            />

            <Route
              path={ROUTES.APPROVALS}
              element={
                <RequirePermission
                  permission={[
                    PERMISSIONS.LEAVE_APPROVE,
                    PERMISSIONS.OVERTIME_APPROVE,
                    PERMISSIONS.TRIP_APPROVE,
                    PERMISSIONS.PERMISSION_APPROVE,
                    PERMISSIONS.SAKIT_APPROVE,
                  ]}
                >
                  <UnifiedApprovalPage />
                </RequirePermission>
              }
            />

            <Route
              path={ROUTES.ADMIN_APPROVALS}
              element={
                <RequirePermission
                  permission={[
                    PERMISSIONS.LEAVE_APPROVE,
                    PERMISSIONS.OVERTIME_APPROVE,
                    PERMISSIONS.TRIP_APPROVE,
                    PERMISSIONS.PERMISSION_APPROVE,
                    PERMISSIONS.SAKIT_APPROVE,
                  ]}
                >
                  <ApprovalInboxPage />
                </RequirePermission>
              }
            />

            <Route
              path={ROUTES.ADMIN_APPROVAL_HISTORY}
              element={
                <RequirePermission
                  permission={[
                    PERMISSIONS.LEAVE_APPROVE,
                    PERMISSIONS.OVERTIME_APPROVE,
                    PERMISSIONS.TRIP_APPROVE,
                    PERMISSIONS.PERMISSION_APPROVE,
                    PERMISSIONS.SAKIT_APPROVE,
                  ]}
                >
                  <ApprovalHistoryPage />
                </RequirePermission>
              }
            />

            <Route
              path={ROUTES.FORBIDDEN}
              element={<Forbidden />}
            />
          </Route>
          </Route>
        </Route>

        {/* Anything else falls back to login */}
        <Route
          path="*"
          element={<Navigate to={ROUTES.LOGIN} replace />}
        />
      </Routes>
    </BrowserRouter>
  );
}
