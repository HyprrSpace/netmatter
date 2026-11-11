import { connection } from "next/server";
import { Dashboard } from "@/components/dashboard";

export default async function Home() {
  await connection();
  return <Dashboard authEnabled={Boolean(process.env.PANEL_PASSWORD)} />;
}
