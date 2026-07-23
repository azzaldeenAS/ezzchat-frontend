import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://kfxjkpsrszwmqgasbwgc.supabase.co';
const supabaseAnonKey = 'sb_publishable_IJ6m0EVE7n-B8lICDN2Fzw_M42UU3nC';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
