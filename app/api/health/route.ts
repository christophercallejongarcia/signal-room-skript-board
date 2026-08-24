import { NextResponse } from "next/server";
import { apifyConfigured } from "@/lib/adapters/sources/apify-client";
import { storageKind } from "@/lib/adapters/storage";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ apify: apifyConfigured() ? "configured" : "missing", storage: storageKind() });
}
