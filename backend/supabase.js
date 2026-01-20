import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseKey = process.env.SUPABASE_ANON_KEY?.trim();

console.log('Supabase Config:');
console.log('- URL definida:', !!supabaseUrl, supabaseUrl ? `(${supabaseUrl.substring(0, 30)}...)` : '(vazia)');
console.log('- Key definida:', !!supabaseKey, supabaseKey ? `(${supabaseKey.substring(0, 20)}...)` : '(vazia)');

if (!supabaseUrl || !supabaseKey) {
    console.error('ERRO: SUPABASE_URL e SUPABASE_ANON_KEY são obrigatórios');
}

export const supabase = createClient(supabaseUrl || '', supabaseKey || '');
