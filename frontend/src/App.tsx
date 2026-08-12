import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import AppRouter from "./routes/AppRouter";
import { SidebarProvider } from "./context/SidebarProvider";
import { AuthProvider } from "./features/auth/AuthProvider";
import { ToastHost } from "./components/ui/toast";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SidebarProvider>
          <AppRouter />
        </SidebarProvider>
        <ToastHost />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
