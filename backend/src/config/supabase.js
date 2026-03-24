import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseKey = process.env.SUPABASE_ANON_KEY?.trim();
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

console.log('Supabase Config:');
console.log('- URL definida:', !!supabaseUrl, supabaseUrl ? `(${supabaseUrl.substring(0, 30)}...)` : '(vazia)');
console.log('- Anon key:', !!supabaseKey, supabaseKey ? `(${supabaseKey.substring(0, 20)}...)` : '(vazia)');
console.log('- Service role key:', supabaseServiceKey ? 'SIM (escrita com bypass de RLS)' : 'NÃO (escrita pode ser bloqueada por RLS)');

if (!supabaseUrl || !supabaseKey) {
    console.error('ERRO: SUPABASE_URL e SUPABASE_ANON_KEY são obrigatórios');
}

export const supabase = createClient(supabaseUrl || '', supabaseKey || '');

export const supabaseAdmin = createClient(
    supabaseUrl || '',
    supabaseServiceKey || supabaseKey || '',
    supabaseServiceKey ? { auth: { autoRefreshToken: false, persistSession: false } } : {}
);
