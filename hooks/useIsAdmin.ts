import { useAdminContext } from "../components/providers/AdminProvider";

export function useIsAdmin() {
  return useAdminContext();
}
