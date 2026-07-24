import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://kfxjkpsrszwmqgasbwgc.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_IJ6m0EVE7n-B8lICDN2Fzw_M42UU3nC';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
