export function getAuthToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

export function getAuthUser() {
  if (typeof window === "undefined") return null;
  const user = localStorage.getItem("user");
  return user ? JSON.parse(user) : null;
}

export function setAuthData(token, user) {
  if (typeof window === "undefined") return;
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(user));
}

export function clearAuthData() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

export function getAuthHeaders() {
  const token = getAuthToken();
  return {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
  };
}

export function isTokenExpired(token) {
  if (!token) return true;

  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    const expiry = payload.exp * 1000;
    return Date.now() >= expiry;
  } catch (error) {
    return true;
  }
}

export function redirectToLogin() {
  if (typeof window !== "undefined") {
    clearAuthData();
    window.location.href = "/auth/login";
  }
}
