import { put, del } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../../utils/supabase/server";

const BLOB_PATH_PREFIX = "spoiler-images/";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Verify user is admin with manage_spoilers permission
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: isAdmin } = await supabase.rpc("check_admin_role");
    if (!isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: perms } = await supabase.rpc("get_my_admin_permissions");
    if (!Array.isArray(perms) || !perms.includes("manage_spoilers")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
    ];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Accepted: JPEG, PNG, WebP, GIF" },
        { status: 400 }
      );
    }

    // Max 10MB
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large. Maximum 10MB." },
        { status: 400 }
      );
    }

    const timestamp = Date.now();
    const sanitized = file.name
      .replace(/\.[^/.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .toLowerCase();
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const blobPathname = `${BLOB_PATH_PREFIX}${sanitized}_${timestamp}.${ext}`;

    const blob = await put(blobPathname, file, {
      access: "public",
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN!,
      contentType: file.type,
    });

    return NextResponse.json({
      url: blob.url,
      pathname: blob.pathname,
    });
  } catch (error) {
    console.error("Spoiler upload failed:", error);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: isAdmin } = await supabase.rpc("check_admin_role");
    if (!isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: perms } = await supabase.rpc("get_my_admin_permissions");
    if (!Array.isArray(perms) || !perms.includes("manage_spoilers")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { url } = await request.json();
    if (!url) {
      return NextResponse.json({ error: "No URL provided" }, { status: 400 });
    }

    await del(url, { token: process.env.BLOB_READ_WRITE_TOKEN! });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Spoiler delete failed:", error);
    return NextResponse.json(
      { error: "Delete failed" },
      { status: 500 }
    );
  }
}
