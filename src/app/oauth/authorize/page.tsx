import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

interface Props {
  searchParams: Promise<{
    client_id?: string;
    redirect_uri?: string;
    scope?: string;
    state?: string;
    code_challenge?: string;
    client_name?: string;
  }>;
}

export default async function ConsentPage({ searchParams }: Props) {
  const params = await searchParams;
  const { client_id, redirect_uri, scope, state, code_challenge, client_name } = params;

  if (!client_id || !redirect_uri || !code_challenge) redirect("/");

  // Consent erfordert eine gültige Session. Ist keine da, zuerst einloggen —
  // mit next=<diese Consent-URL>, damit der OAuth-Flow danach nahtlos weiterläuft.
  const cookieStore = await cookies();
  const user = await verifySession(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) {
    const qs = new URLSearchParams({
      client_id, redirect_uri,
      scope: scope ?? "read",
      state: state ?? "",
      code_challenge,
      client_name: client_name ?? "",
    });
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${qs.toString()}`)}`);
  }

  return (
    <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-zinc-900 rounded-2xl border border-zinc-800 p-8 space-y-6">
        <div className="text-center space-y-1">
          <div className="text-2xl">🧠</div>
          <h1 className="text-lg font-semibold text-white">Zugriff erlauben</h1>
          <p className="text-sm text-zinc-400">
            <span className="text-white font-medium">{client_name ?? "Ein Client"}</span>
            {" "}möchte auf deinen Migräne-Tracker zugreifen.
          </p>
          <p className="text-xs text-zinc-500">Angemeldet als {user}</p>
        </div>

        <form action="/api/oauth/authorize" method="post" className="space-y-4">
          <input type="hidden" name="client_id" value={client_id} />
          <input type="hidden" name="redirect_uri" value={redirect_uri} />
          <input type="hidden" name="scope" value={scope ?? "read"} />
          <input type="hidden" name="state" value={state ?? ""} />
          <input type="hidden" name="code_challenge" value={code_challenge} />

          <button
            type="submit"
            className="w-full bg-violet-600 hover:bg-violet-500 text-white font-medium rounded-lg py-2.5 transition-colors"
          >
            Erlauben
          </button>
        </form>
      </div>
    </main>
  );
}
