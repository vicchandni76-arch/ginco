-- Ginco app: write access for members, save functions, and a private photo bucket.
-- Only adds policies, functions and a bucket. No tables are changed and no data is touched.

-- 1. Members may add/edit rows in the tables the app writes to (matching the existing *_member_all policies)
drop policy if exists suppliers_member_write on public.suppliers;
create policy suppliers_member_write on public.suppliers
  for all to authenticated using (public.app_is_member(business_id)) with check (public.app_is_member(business_id));

drop policy if exists products_member_write on public.products;
create policy products_member_write on public.products
  for all to authenticated using (public.app_is_member(business_id)) with check (public.app_is_member(business_id));

drop policy if exists documents_member_write on public.documents;
create policy documents_member_write on public.documents
  for all to authenticated using (public.app_is_member(business_id)) with check (public.app_is_member(business_id));

drop policy if exists purchase_invoices_member_write on public.purchase_invoices;
create policy purchase_invoices_member_write on public.purchase_invoices
  for all to authenticated using (public.app_is_member(business_id)) with check (public.app_is_member(business_id));

drop policy if exists purchase_invoice_lines_member_write on public.purchase_invoice_lines;
create policy purchase_invoice_lines_member_write on public.purchase_invoice_lines
  for all to authenticated using (public.app_is_member(business_id)) with check (public.app_is_member(business_id));

drop policy if exists audit_events_member_insert on public.audit_events;
create policy audit_events_member_insert on public.audit_events
  for insert to authenticated with check (public.app_is_member(business_id));

-- 2. Find-or-create helpers (run as the caller, so row-level security still applies)
create or replace function public.ginco_find_or_create_supplier(p_business uuid, p_name text)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  if v_name = '' then raise exception 'Supplier name is required'; end if;
  select id into v_id from suppliers where business_id = p_business and lower(name) = lower(v_name) limit 1;
  if v_id is null then
    insert into suppliers(business_id, name) values (p_business, v_name) returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.ginco_find_or_create_product(p_business uuid, p_name text, p_unit text, p_pack numeric)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  if v_name = '' then return null; end if;
  select id into v_id from products
   where business_id = p_business
     and (lower(name) = lower(v_name) or lower(v_name) = any (select lower(a) from unnest(aliases) a))
   order by active desc limit 1;
  if v_id is null then
    insert into products(business_id, name, base_unit, pack_size)
      values (p_business, v_name, nullif(p_unit, ''), case when p_pack > 0 then p_pack end)
      returning id into v_id;
  end if;
  return v_id;
end $$;

-- 3. Save an invoice or delivery note (with its goods-in record) in one transaction
create or replace function public.ginco_save_goods(p jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_business uuid := (p->>'business_id')::uuid;
  v_kind text := coalesce(p->>'kind', 'invoice');
  v_supplier uuid; v_invoice uuid; v_receipt uuid; v_product uuid;
  v_line jsonb; v_n int := 0; v_inv_no text; v_doc uuid;
begin
  if v_business is null or not app_is_member(v_business) then raise exception 'Not a member of this business'; end if;
  if v_kind not in ('invoice', 'delivery_note') then raise exception 'kind must be invoice or delivery_note'; end if;

  v_supplier := coalesce(nullif(p->>'supplier_id', '')::uuid, ginco_find_or_create_supplier(v_business, p->>'supplier_name'));

  if p->>'image_sha256' is not null then
    insert into documents(business_id, source, source_key, storage_path, sha256, status, extracted_data)
      values (v_business, 'upload', p->>'image_sha256', p->>'storage_path', p->>'image_sha256', 'accepted', p->'extracted')
      on conflict (business_id, sha256) do update set status = 'accepted', extracted_data = excluded.extracted_data
      returning id into v_doc;
  end if;

  if v_kind = 'invoice' then
    v_inv_no := nullif(btrim(coalesce(p->>'invoice_number', '')), '');
    if v_inv_no is null then v_inv_no := 'INV-' || to_char(now(), 'YYYYMMDD-HH24MISS'); end if;
    if exists (select 1 from purchase_invoices where business_id = v_business and supplier_id = v_supplier and invoice_number = v_inv_no) then
      raise exception 'Invoice % from this supplier is already saved', v_inv_no;
    end if;
    insert into purchase_invoices(business_id, supplier_id, document_id, invoice_number, invoice_date, currency, net_amount, tax_amount, total_amount, status)
      values (v_business, v_supplier, v_doc, v_inv_no, nullif(p->>'invoice_date', '')::date, coalesce(nullif(p->>'currency', ''), 'GBP'),
              nullif(p->>'net_amount', '')::numeric, nullif(p->>'tax_amount', '')::numeric, nullif(p->>'total_amount', '')::numeric, 'approved')
      returning id into v_invoice;
  end if;

  insert into goods_receipts(business_id, supplier_id, received_date, delivery_note_no, invoice_id, received_by, notes)
    values (v_business, v_supplier, coalesce(nullif(p->>'received_date', '')::date, nullif(p->>'invoice_date', '')::date, current_date),
            case when v_kind = 'delivery_note' then nullif(p->>'invoice_number', '') end, v_invoice, auth.uid(), nullif(p->>'notes', ''))
    returning id into v_receipt;

  for v_line in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    v_n := v_n + 1;
    v_product := coalesce(nullif(v_line->>'product_id', '')::uuid,
                          ginco_find_or_create_product(v_business, coalesce(nullif(v_line->>'product_name', ''), v_line->>'description'),
                                                       v_line->>'unit', nullif(v_line->>'pack_size', '')::numeric));
    if v_invoice is not null then
      insert into purchase_invoice_lines(business_id, invoice_id, line_number, product_id, original_description, quantity, pack_size, unit, unit_price, tax_amount, line_total)
        values (v_business, v_invoice, v_n, v_product, coalesce(nullif(v_line->>'description', ''), 'Line ' || v_n),
                nullif(v_line->>'quantity', '')::numeric, nullif(nullif(v_line->>'pack_size', '')::numeric, 0), nullif(v_line->>'unit', ''),
                nullif(v_line->>'unit_price', '')::numeric, nullif(v_line->>'tax_amount', '')::numeric, nullif(v_line->>'line_total', '')::numeric);
    end if;
    insert into goods_receipt_lines(business_id, receipt_id, product_id, description, qty_received, unit, unit_price, vat_rate, batch_code, best_before, notes)
      values (v_business, v_receipt, v_product, coalesce(nullif(v_line->>'description', ''), 'Line ' || v_n),
              coalesce(nullif(v_line->>'quantity', '')::numeric, 0), nullif(v_line->>'unit', ''), nullif(v_line->>'unit_price', '')::numeric,
              nullif(v_line->>'vat_rate', '')::numeric, nullif(v_line->>'batch_code', ''),
              nullif(v_line->>'best_before', '')::date, nullif(v_line->>'notes', ''));
  end loop;

  insert into audit_events(business_id, actor_id, event_type, entity_type, entity_id, details)
    values (v_business, auth.uid(), 'goods.saved', v_kind, coalesce(v_invoice, v_receipt), jsonb_build_object('lines', v_n, 'via', coalesce(p->>'via', 'app')));

  return jsonb_build_object('invoice_id', v_invoice, 'receipt_id', v_receipt, 'supplier_id', v_supplier, 'lines', v_n);
end $$;

-- 4. Save a purchase order (from voice, text or a form)
create or replace function public.ginco_save_order(p jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_business uuid := (p->>'business_id')::uuid;
  v_supplier uuid; v_order uuid; v_product uuid; v_line jsonb; v_n int := 0; v_voice uuid;
begin
  if v_business is null or not app_is_member(v_business) then raise exception 'Not a member of this business'; end if;
  v_supplier := coalesce(nullif(p->>'supplier_id', '')::uuid, ginco_find_or_create_supplier(v_business, p->>'supplier_name'));

  insert into purchase_orders(business_id, supplier_id, order_number, order_date, expected_date, status, ordered_via, notes, created_by)
    values (v_business, v_supplier, nullif(p->>'order_number', ''), coalesce(nullif(p->>'order_date', '')::date, current_date),
            nullif(p->>'expected_date', '')::date, 'ordered', coalesce(nullif(p->>'ordered_via', ''), 'web'), nullif(p->>'notes', ''), auth.uid())
    returning id into v_order;

  for v_line in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    v_n := v_n + 1;
    v_product := coalesce(nullif(v_line->>'product_id', '')::uuid,
                          ginco_find_or_create_product(v_business, coalesce(nullif(v_line->>'product_name', ''), v_line->>'description'),
                                                       v_line->>'unit', nullif(v_line->>'pack_size', '')::numeric));
    insert into purchase_order_lines(business_id, order_id, line_number, product_id, description, qty_ordered, unit, agreed_unit_price, vat_rate)
      values (v_business, v_order, v_n, v_product, coalesce(nullif(v_line->>'description', ''), 'Line ' || v_n),
              greatest(coalesce(nullif(v_line->>'quantity', '')::numeric, 1), 0.001), nullif(v_line->>'unit', ''),
              nullif(v_line->>'unit_price', '')::numeric, nullif(v_line->>'vat_rate', '')::numeric);
  end loop;

  if nullif(p->>'transcript', '') is not null then
    insert into voice_entries(business_id, entry_type, transcript, parsed, status, linked_order_id, created_by)
      values (v_business, 'order', p->>'transcript', coalesce(p->'extracted', '{}'::jsonb), 'confirmed', v_order, auth.uid())
      returning id into v_voice;
  end if;

  insert into audit_events(business_id, actor_id, event_type, entity_type, entity_id, details)
    values (v_business, auth.uid(), 'order.saved', 'purchase_order', v_order, jsonb_build_object('lines', v_n, 'via', coalesce(p->>'ordered_via', 'web')));

  return jsonb_build_object('order_id', v_order, 'supplier_id', v_supplier, 'lines', v_n, 'voice_entry_id', v_voice);
end $$;

grant execute on function public.ginco_find_or_create_supplier(uuid, text) to authenticated;
grant execute on function public.ginco_find_or_create_product(uuid, text, text, numeric) to authenticated;
grant execute on function public.ginco_save_goods(jsonb) to authenticated;
grant execute on function public.ginco_save_order(jsonb) to authenticated;

-- 5. Private bucket for invoice photos; each business keeps its files under its own folder
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('invoices', 'invoices', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  on conflict (id) do nothing;

drop policy if exists invoices_member_read on storage.objects;
create policy invoices_member_read on storage.objects for select to authenticated
  using (bucket_id = 'invoices' and public.app_is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists invoices_member_insert on storage.objects;
create policy invoices_member_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'invoices' and public.app_is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists invoices_member_delete on storage.objects;
create policy invoices_member_delete on storage.objects for delete to authenticated
  using (bucket_id = 'invoices' and public.app_is_member(((storage.foldername(name))[1])::uuid));
