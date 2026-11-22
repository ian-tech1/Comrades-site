alter table public.portal_settings
  add column if not exists login_design text not null default 'cdacc';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'portal_settings_login_design_check'
      and conrelid = 'public.portal_settings'::regclass
  ) then
    alter table public.portal_settings
      add constraint portal_settings_login_design_check
      check (login_design in ('cdacc', 'classic', 'navy'));
  end if;
end
$$;
