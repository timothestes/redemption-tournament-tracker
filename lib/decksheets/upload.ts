import { createClient } from "@supabase/supabase-js";

export async function uploadDeckArtifact(storagePath: string, body: Uint8Array, contentType: string) {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { error } = await supabase.storage.from("decklists")
    .upload(storagePath, body, { contentType, upsert: true });
  if (error) throw new Error(`decklists upload failed: ${error.message}`);
  const { data } = supabase.storage.from("decklists").getPublicUrl(storagePath);
  return { filename: storagePath, downloadUrl: data.publicUrl, createdAt: new Date().toISOString() };
}
