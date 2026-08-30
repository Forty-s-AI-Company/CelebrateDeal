-- G7-35A: preserve an already-shipped parcel after a full refund and give it
-- an explicit merchant-resolvable lifecycle. Enum values are committed in a
-- separate migration before later SQL references them.

ALTER TYPE "ShippingFulfillmentStatus" ADD VALUE IF NOT EXISTS 'refund_review' AFTER 'shipped';
ALTER TYPE "ShippingFulfillmentStatus" ADD VALUE IF NOT EXISTS 'returned' AFTER 'delivered';
