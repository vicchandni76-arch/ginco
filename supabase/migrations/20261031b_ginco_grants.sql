-- Table-level privileges needed by the member write policies (insert/update only)

grant insert, update on public.suppliers, public.products, public.documents, public.purchase_invoices, public.purchase_invoice_lines to authenticated;
grant insert on public.audit_events to authenticated;
alter function public.set_updated_at() set search_path = public;
