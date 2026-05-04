// Helpers for tech-scoped data access.
// Use `useScope()` in client components to know whether the caller is a
// technician (and which one), so list queries can apply the right filter.

export interface ScopeInfo {
  isTech: boolean;        // true when role === 'technician'
  isAdmin: boolean;       // admin/manager — gets full visibility
  technicianId: number | null;
}

export function deriveScope(tenantUser: { role?: string; technician_id?: number | null } | null): ScopeInfo {
  if (!tenantUser) {
    return { isTech: false, isAdmin: false, technicianId: null };
  }
  const role = tenantUser.role || "";
  return {
    isTech: role === "technician",
    isAdmin: role === "admin" || role === "manager" || role === "dispatcher",
    technicianId: tenantUser.technician_id ?? null,
  };
}
