import { LossDashboard } from "@/components/loss-dashboard";

export default function Home() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">netmatter</h1>
        <p className="text-sm text-muted-foreground">
          Packet loss over time across nodes and hops
        </p>
      </header>
      <LossDashboard />
    </main>
  );
}
