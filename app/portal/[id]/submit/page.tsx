import { redirect } from 'next/navigation';

/**
 * Submitting a version is a drawer over the package now (2e), not a route.
 *
 * The page is kept as a redirect rather than removed: invitation emails and
 * bookmarks already in the wild point here, and landing on the package is a
 * better answer than a 404. The drawer opens from the package itself.
 */
export default function SubmitVersionRedirect({
  params,
}: {
  params: { id: string };
}) {
  redirect(`/portal/${params.id}`);
}
