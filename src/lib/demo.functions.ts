import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

const DEMO_EMAIL = "judge-demo@orderflow-ai.app";

function publicClient() {
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

/**
 * Public by design: hands out a session for the shared demo account. That account is flagged
 * is_demo and database rules only let it see rows marked is_sample — never real merchant data.
 * The demo password stays on the server.
 */
export const startDemoSession = createServerFn({ method: "POST" }).handler(async () => {
  const password = process.env["DEMO_ACCOUNT_PASSWORD"];
  if (!password) throw new Error("The demo workspace is not configured (DEMO_ACCOUNT_PASSWORD missing).");

  const client = publicClient();
  let signIn = await client.auth.signInWithPassword({ email: DEMO_EMAIL, password });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let userId = signIn.data.user?.id ?? null;
  if (!userId) {
    const created = await supabaseAdmin.auth.admin.createUser({
      email: DEMO_EMAIL,
      password,
      email_confirm: true,
      user_metadata: { business_name: "OrderFlow Demo Store" },
    });
    if (created.error) {
      // Account exists but password differs (secret rotated): reset it to the current secret.
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
      const existing = list?.users.find((u) => u.email === DEMO_EMAIL);
      if (!existing) {
        console.error("Demo account creation failed", created.error);
        throw new Error("Could not prepare the demo workspace.");
      }
      await supabaseAdmin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
      userId = existing.id;
    } else {
      userId = created.data.user.id;
    }
    signIn = await client.auth.signInWithPassword({ email: DEMO_EMAIL, password });
  }

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .upsert({ id: userId!, business_name: "OrderFlow Demo Store", is_demo: true });
  if (profileError) console.error("Demo profile flag failed", profileError);

  if (signIn.error || !signIn.data.session) {
    console.error("Demo sign-in failed", signIn.error);
    throw new Error("Could not open the demo workspace.");
  }
  return {
    access_token: signIn.data.session.access_token,
    refresh_token: signIn.data.session.refresh_token,
  };
});
