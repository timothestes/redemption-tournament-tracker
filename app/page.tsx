import { redirect } from "next/navigation";

export default async function Index() {
  redirect("/decklist/community");
}
