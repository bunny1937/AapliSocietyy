import jwt from "jsonwebtoken";

const JWT_SECRET =
  process.env.JWT_SECRET || "your-super-secret-key-change-in-production";

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    console.error("JWT verification failed:", error.message);

    return null;
  }
}

/**
 * SECURE: Extract token from HttpOnly cookie (preferred) or Authorization header (for API clients)
 */
export function getTokenFromRequest(request) {
  // Priority 1: HttpOnly cookie (browser/web clients)
  const cookieToken = request.cookies.get("token")?.value;
  if (cookieToken) return cookieToken;

  // Priority 2: Authorization header (mobile apps, Postman)
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }

  return null;
}
