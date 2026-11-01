import { redirect } from 'next/navigation';

/** Bulk orders now live in the Orders sheet (Type column: Bulk). */
export default function BulkPage() {
  redirect('/orders');
}
