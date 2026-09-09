/**
 * Shared Authorization-header construction for client-side API calls.
 * Reads the JWT from localStorage (`authToken`) the same way the fetch
 * wrapper and every form module do.
 */
export function authHeaders(): Record<string, string> {
 const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
 return token ? { Authorization: `Bearer ${token}` } : {};
}
