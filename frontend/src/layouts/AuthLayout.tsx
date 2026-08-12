import { Outlet, Navigate, useLocation } from "react-router-dom";

import { useAuth } from "@/features/auth/useAuth";
import { ROUTES } from "@/constants/routes";

/**
 * AuthLayout — public layout for login/forgot-password pages. An already
 * authenticated user is bounced back into the app.
 */
export default function AuthLayout() {
  const { isAuthenticated, isBootstrapping } = useAuth();
  const location = useLocation();

  if (isBootstrapping) return null;

  if (isAuthenticated) {
    return <Navigate to={ROUTES.DASHBOARD} replace state={{ from: location }} />;
  }

  return (
    <div>
      <Outlet />
    </div>
  );
}
