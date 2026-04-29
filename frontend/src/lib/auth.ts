export function saveAuth(token: string, isAdmin: boolean) {
  localStorage.setItem("token", token)
  localStorage.setItem("is_admin", String(isAdmin))
}

export function clearAuth() {
  localStorage.removeItem("token")
  localStorage.removeItem("is_admin")
}

export function getToken() {
  return localStorage.getItem("token")
}

export function isAdmin() {
  return localStorage.getItem("is_admin") === "true"
}

export function isLoggedIn() {
  return !!localStorage.getItem("token")
}
