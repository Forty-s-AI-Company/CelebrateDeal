-- IDs participate in keyset/digest and payment joins; fence ID-only updates too.
CREATE OR REPLACE FUNCTION public.wp20_metric_order_tenant_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old_vendor TEXT; new_vendor TEXT; target TEXT;
BEGIN
 IF TG_LEVEL<>'ROW' OR TG_RELID NOT IN ('public."CommerceOrder"'::regclass,'public."PaymentTransaction"'::regclass) THEN
  RAISE EXCEPTION 'invalid tenant order source relation' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='CommerceOrder' THEN
   IF (NEW.id,NEW."vendorId",NEW."primaryPaymentTransactionId",NEW."createdAt",NEW.status)
    IS NOT DISTINCT FROM (OLD.id,OLD."vendorId",OLD."primaryPaymentTransactionId",OLD."createdAt",OLD.status) THEN RETURN NULL; END IF;
  ELSE
   IF (NEW.id,NEW."vendorId",NEW.metadata) IS NOT DISTINCT FROM (OLD.id,OLD."vendorId",OLD.metadata) THEN RETURN NULL; END IF;
  END IF;
 END IF;
 IF TG_OP<>'INSERT' THEN old_vendor:=OLD."vendorId"; END IF;
 IF TG_OP<>'DELETE' THEN new_vendor:=NEW."vendorId"; END IF;
 FOR target IN SELECT DISTINCT value FROM unnest(ARRAY[old_vendor,new_vendor]) value WHERE value IS NOT NULL ORDER BY value LOOP
  INSERT INTO public."LiveMetricOrderTenantSource"("vendorId") SELECT id FROM public."Vendor" WHERE id=target;
 END LOOP;
 RETURN NULL;
END $$;
