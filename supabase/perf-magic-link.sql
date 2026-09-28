-- ============================================================
--  رابط دخول مؤقت (لمرة واحدة)
--  ------------------------------------------------------------
--  ⚠️ اقرأ قبل التشغيل: هذا الرابط يدخل الحساب **بلا كلمة مرور**.
--     من يملك الرابط يملك الحساب حتى يُستعمل أو تنتهي مدته.
--     لذلك: يُستعمل مرة واحدة · ينتهي بمدّة قصيرة · يُنشئه صاحب
--     صلاحية «المستخدمون» وحده · ويُسجَّل من أنشأه ومتى استُعمل.
--     أرسِله في قناة خاصة، ولا تنشره في مجموعة.
--
--  idempotent وليس فيه حذف بيانات. يُشغَّل بعد perf-setup.sql
-- ============================================================

create table if not exists public.perf_magic (
  token_hash  text primary key,          -- لا يُخزَّن الرمز نفسه أبداً
  app_user_id bigint not null references public.perf_users(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_by  bigint references public.perf_users(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.perf_magic enable row level security;
-- لا سياسة قراءة ولا كتابة: كل وصولٍ عبر الدالتين أدناه وحدهما
revoke all on public.perf_magic from authenticated, anon;

/* إنشاء الرابط: يُرجع الرمز مرة واحدة فقط، ويُخزَّن تجزئته */
create or replace function public.perf_magic_make(p_user text, p_minutes int default 60)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_me bigint := public.perf_my_id(); v_id bigint; v_tok text; v_min int;
begin
  if not public.perf_has_scope('users') then
    raise exception 'رابط الدخول المؤقت لصاحب صلاحية «المستخدمون» وحده';
  end if;
  v_min := least(greatest(coalesce(p_minutes, 60), 5), 1440);

  select u.id into v_id from public.perf_users u
   where u.active
     and (u.username = public.perf_norm_user(p_user)
          or public.perf_norm_name(u.display_name) = public.perf_norm_name(p_user))
   limit 1;
  if v_id is null then return jsonb_build_object('error','no_user'); end if;

  v_tok := replace(replace(replace(encode(gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'), '=', '');
  insert into public.perf_magic (token_hash, app_user_id, expires_at, created_by)
  values (encode(digest(v_tok, 'sha256'), 'hex'), v_id, now() + make_interval(mins => v_min), v_me);

  return jsonb_build_object('token', v_tok, 'minutes', v_min,
                            'user', (select display_name from public.perf_users where id = v_id));
end;
$$;
revoke all on function public.perf_magic_make(text, int) from public, anon;
grant execute on function public.perf_magic_make(text, int) to authenticated;

/* استعمال الرابط: مرة واحدة، وقبل انتهاء المدّة */
create or replace function public.perf_magic_use(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare m record; u record;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into m from public.perf_magic
   where token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex');
  if not found then return jsonb_build_object('error','bad'); end if;
  if m.used_at is not null then return jsonb_build_object('error','used'); end if;
  if m.expires_at < now() then return jsonb_build_object('error','expired'); end if;

  select * into u from public.perf_users where id = m.app_user_id and active;
  if not found then return jsonb_build_object('error','no_user'); end if;

  update public.perf_magic set used_at = now() where token_hash = m.token_hash;

  insert into public.perf_sessions (user_id, app_user_id, username, display_name, role, sector_ids)
  values (auth.uid(), u.id, u.username, u.display_name, u.role, u.sector_ids)
  on conflict (user_id) do update
    set app_user_id = excluded.app_user_id, username = excluded.username,
        display_name = excluded.display_name, role = excluded.role,
        sector_ids = excluded.sector_ids, granted_at = now();

  update public.perf_users set last_login = now() where id = u.id;

  return jsonb_build_object('id', u.id::text, 'username', u.username,
    'name', u.display_name, 'role', u.role, 'sectorIds', u.sector_ids);
end;
$$;
revoke all on function public.perf_magic_use(text) from public, anon;
grant execute on function public.perf_magic_use(text) to authenticated;

/* تنظيف: إبطال كل الروابط غير المستعملة لحسابٍ ما — عند الحاجة
   select public.perf_magic_revoke('عبدالله الحزامي'); */
create or replace function public.perf_magic_revoke(p_user text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.perf_has_scope('users') then raise exception 'forbidden'; end if;
  update public.perf_magic m set used_at = now()
    from public.perf_users u
   where u.id = m.app_user_id and m.used_at is null
     and (u.username = public.perf_norm_user(p_user)
          or public.perf_norm_name(u.display_name) = public.perf_norm_name(p_user));
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.perf_magic_revoke(text) from public, anon;
grant execute on function public.perf_magic_revoke(text) to authenticated;

select 'perf_magic' as "الجدول", 'جاهز' as "الحالة";
