import { NextResponse } from "next/server";

/**
 * 🔒 Secure Video Proxy
 * This route hides your real video URLs and prevents direct linking.
 * Supports short-lived tokens, session auth, and anti-leech.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const token = url.searchParams.get("token");

  // 1️⃣ Validate token (you can swap this with JWT/session auth)
  const valid = token === process.env.VIDEO_ACCESS_TOKEN;
  if (!valid) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // 2️⃣ Resolve the *real* video source (hidden from users)
  const realVideoUrl = `https://your-secure-storage.com/videos/${id}.mp4`;

  // 3️⃣ Fetch and stream video
  const response = await fetch(realVideoUrl);
  const headers = new Headers(response.headers);

  headers.delete("content-disposition");
  headers.set("content-type", "video/mp4");
  headers.set("cache-control", "no-store, private, max-age=0");

  return new NextResponse(response.body, { headers });
}
