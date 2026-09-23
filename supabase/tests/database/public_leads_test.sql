begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- Nobody reaches this table through a session -------------------------------

select extensions.ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.marketing_leads'::regclass),
  'public lead capture enables and forces row level security'
);

select extensions.table_privs_are(
  'public', 'marketing_leads', 'authenticated', array[]::text[],
  'a member session cannot read or write anonymous leads'
);

select extensions.table_privs_are(
  'public', 'marketing_leads', 'anon', array[]::text[],
  'anonymous callers cannot reach leads except through the record function'
);

select extensions.function_privs_are(
  'public', 'record_public_lead', array['jsonb'], 'authenticated', array[]::text[],
  'only the service role may record a lead'
);

-- A first write records; a second write replays ------------------------------

select extensions.is(
  (public.record_public_lead(
    pg_catalog.jsonb_build_object(
      'email', 'Amina@Example.com',
      'intent', 'early-access',
      'source', 'coming-soon'
    )
  ) ->> 'outcome'),
  'recorded',
  'a first signup is recorded'
);

select extensions.is(
  (select email from public.marketing_leads where intent = 'early-access'),
  'amina@example.com',
  'the stored email is normalized to lowercase'
);

select extensions.is(
  (public.record_public_lead(
    pg_catalog.jsonb_build_object(
      'email', 'amina@example.com',
      'intent', 'early-access',
      'source', 'coming-soon'
    )
  ) ->> 'outcome'),
  'replayed',
  'resubmitting the same email and intent replays instead of erroring'
);

select extensions.is(
  (select pg_catalog.count(*)::integer from public.marketing_leads
   where email = 'amina@example.com' and intent = 'early-access'),
  1,
  'a replayed signup leaves exactly one row'
);

-- Walkthrough is a distinct intent, not a second early-access row -------------

select extensions.is(
  (public.record_public_lead(
    pg_catalog.jsonb_build_object(
      'email', 'amina@example.com',
      'intent', 'book-walkthrough',
      'name', 'Amina',
      'source', 'coming-soon'
    )
  ) ->> 'outcome'),
  'recorded',
  'the same email asking for a walkthrough is a new lead, not a replay'
);

select extensions.is(
  (select name from public.marketing_leads
   where email = 'amina@example.com' and intent = 'book-walkthrough'),
  'Amina',
  'the walkthrough name is stored on its own row'
);

select extensions.is(
  (public.record_public_lead(
    pg_catalog.jsonb_build_object(
      'email', 'amina@example.com',
      'intent', 'book-walkthrough',
      'source', 'coming-soon'
    )
  ) ->> 'outcome'),
  'replayed',
  'resubmitting the walkthrough without a name still replays'
);

select extensions.is(
  (select name from public.marketing_leads
   where email = 'amina@example.com' and intent = 'book-walkthrough'),
  'Amina',
  'a nameless replay keeps the name already stored'
);

-- The checks refuse what validation should never send ------------------------

select extensions.throws_ok(
  $$ select public.record_public_lead(
       pg_catalog.jsonb_build_object('email', 'amina@example.com', 'intent', 'buy-now')
     ) $$,
  '23514',
  null,
  'an unknown intent is refused'
);

select extensions.throws_ok(
  $$ insert into public.marketing_leads (email, intent)
     values ('not-an-email', 'early-access') $$,
  '23514',
  null,
  'an email without an @ sign is refused'
);

select extensions.throws_ok(
  $$ insert into public.marketing_leads (email, intent)
     values ('UPPER@EXAMPLE.COM', 'early-access') $$,
  '23514',
  null,
  'an unnormalized email is refused, so every writer normalizes'
);

select * from extensions.finish();
rollback;
