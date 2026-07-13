import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Load the user's ongoing conversation, oldest first.
export const getChatHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("chat_messages")
      .select("id, role, content, sources, created_at")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data;
  });

// Clear the entire conversation for the current user.
export const clearChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("chat_messages")
      .delete()
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });
