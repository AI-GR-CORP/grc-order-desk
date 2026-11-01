import 'server-only';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createSupabase } from './supabase/server';

export interface AppUser {
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'staff';
  isAdmin: boolean;
}

/** The signed-in dashboard user, or null. Cached per request. */
export const getAppUser = cache(async (): Promise<AppUser | null> => {
  const supabase = await createSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: row } = await supabase.from('app_user').select('role').eq('user_id', data.user.id).maybeSingle();
  if (!row) return null;
  const role = row.role as AppUser['role'];
  return { id: data.user.id, email: data.user.email ?? '', role, isAdmin: role === 'owner' || role === 'admin' };
});

export async function requireUser(): Promise<AppUser> {
  const supabase = await createSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  const user = await getAppUser();
  if (!user) redirect('/pending');
  return user;
}

/** For server actions: throws instead of redirecting. */
export async function assertUser(admin = false): Promise<AppUser> {
  const user = await getAppUser();
  if (!user) throw new Error('Sign in again to continue.');
  if (admin && !user.isAdmin) throw new Error('Only an owner can change this.');
  return user;
}
