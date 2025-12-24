import { NextResponse } from "next/server";

export function middleware(request) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/dashboard")) {
    const token = request.cookies.get("token")?.value;

    if (!token) {
      return NextResponse.redirect(new URL("/auth/login", request.url));
    }

    try {
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1], "base64").toString("utf8")
      );
      const expiry = payload.exp * 1000;

      if (Date.now() >= expiry) {
        const res = NextResponse.redirect(new URL("/auth/login", request.url));
        res.cookies.delete("token");
        return res;
      }
    } catch {
      const res = NextResponse.redirect(new URL("/auth/login", request.url));
      res.cookies.delete("token");
      return res;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
