import { PageLoading } from '@/components/page-loading'

// Route-level fallback: shows an instant skeleton while any dashboard page's
// server component / data is loading, for every (dashboard) navigation.
export default function Loading() {
  return (
    <div className="p-6">
      <PageLoading />
    </div>
  )
}
