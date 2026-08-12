import { createContext } from "react";

export interface SidebarContextType {
  collapsed: boolean;
  toggleSidebar: () => void;
  /** Mobile drawer state — only used below the `md` breakpoint. */
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

export const SidebarContext = createContext<
  SidebarContextType | undefined
>(undefined);
