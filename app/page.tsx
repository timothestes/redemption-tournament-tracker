import { redirect } from "next/navigation";

export default async function Index(props: {
  searchParams: Promise<{ code?: string; error?: string; error_description?: string }>;
}) {
  const searchParams = await props.searchParams;

  if (searchParams.code) {
    redirect(
      `/auth/callback?code=${encodeURIComponent(searchParams.code)}&redirect_to=/tracker/reset-password`,
    );
  }

  if (searchParams.error) {
    // Token expired or invalid — send back to forgot-password with a message
    redirect(
      `/forgot-password?${new URLSearchParams({ error: searchParams.error_description ?? "The reset link has expired. Please request a new one." }).toString()}`,
    );
  }

  redirect("/decklist/community");
}
