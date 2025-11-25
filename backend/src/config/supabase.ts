import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables');
  }

export const supabase = createClient(supabaseUrl, supabaseKey);

// Create authenticated client with user's token for RLS
export function getAuthenticatedClient(accessToken: string) {
    return createClient(supabaseUrl!, supabaseKey!, {
        global: {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        }
    });
}
