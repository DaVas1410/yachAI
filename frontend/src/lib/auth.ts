export function saveAdminToken(token: string) {
  localStorage.setItem("admin_token", token)
}

export function clearAdminToken() {
  localStorage.removeItem("admin_token")
}

export function getAdminToken(): string | null {
  return localStorage.getItem("admin_token")
}

export function isAdmin(): boolean {
  return !!localStorage.getItem("admin_token")
}
